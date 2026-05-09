const express = require("express");
const router = express.Router();
const db = require("../db");
const { getWalkinStreamCodeOrDefault, getWalkinStreamLabel } = require("../utils/walkinStream");
let studentStartupSchemaSyncAttempted = false;

const getWalkinDurationMinutes = (streamCode) => {
    if (streamCode === "DS") return 60;
    if (streamCode === "DA") return 50;
    if (streamCode === "AAI") return 60;
    if (streamCode === "INT") return 90;
    return 80; // MERN default
};

function ensureWalkinAttemptedAtColumn() {
    db.query(
        `ALTER TABLE walkin_final_results
         ADD COLUMN attempted_at TIMESTAMP NULL`,
        (err) => {
            const msg = String(err?.message || "");
            const duplicateColumn =
                Number(err?.errno) === 1060 ||
                /duplicate column/i.test(msg) ||
                /already exists/i.test(msg);
            if (err && !duplicateColumn) {
                console.warn("Could not add attempted_at column in walkin_final_results:", msg);
            }
        }
    );
}

function runStudentStartupSchemaSync() {
    if (studentStartupSchemaSyncAttempted) return;
    studentStartupSchemaSyncAttempted = true;

    db.query(`SELECT 1`, (probeErr) => {
        if (probeErr) {
            console.warn("Skipping student startup schema sync because PostgreSQL is unreachable:", String(probeErr?.message || probeErr));
            return;
        }

        ensureWalkinAttemptedAtColumn();
    });
}

runStudentStartupSchemaSync();

router.startupSchemaSync = async () => {
    runStudentStartupSchemaSync();
};

/* =================================================
   AUTH
================================================= */

/* STUDENT LOGIN API */
router.post("/login", (req, res) => {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!email || !password) {
        return res.json({ success: false, message: "Missing credentials" });
    }

    const sql = `
        SELECT 
            s.student_id,
            s.name,
            s.email_id,
            s.contact_number,
            s.dob,
            s.course,
            s.student_type,
            s.walkin_exam_id,
            c.college_name
        FROM students s
        JOIN student_credentials sc
            ON s.student_id = sc.student_id
        LEFT JOIN college c
            ON s.college_id = c.college_id
        WHERE LOWER(s.email_id) = LOWER(?) AND sc.password = ?
    `;
    db.query(sql, [email, password], (err, rows) => {
        if (err) {
            console.error("Student login query error:", err);
            return res.json({ success: false, message: "Invalid credentials" });
        }

        if (!rows || rows.length === 0) {
            return res.json({ success: false, message: "Invalid credentials" });
        }

        req.session.student = {
            studentId: rows[0].student_id,
            name: rows[0].name,
            email: rows[0].email_id,
            phone: rows[0].contact_number,
            dob: rows[0].dob,
            course: rows[0].course,
            studentType: rows[0].student_type || "REGULAR",
            walkinExamId: rows[0].walkin_exam_id || null,
            collegeName: rows[0].college_name
        };

        res.json({
            success: true,
            studentId: rows[0].student_id,
            name: rows[0].name,
            email: rows[0].email_id,
            phone: rows[0].contact_number,
            dob: rows[0].dob,
            course: rows[0].course,
            studentType: rows[0].student_type || "REGULAR",
            walkinExamId: rows[0].walkin_exam_id || null,
            collegeName: rows[0].college_name
        });
    });
});

/* ================= STUDENT REGISTER API ================= */
router.post("/register", (_req, res) => {
    return res.status(403).json({
        success: false,
        message: "Student self-registration is closed. Contact your admin for account creation."
    });
});

router.get("/colleges", (req, res) => {
    db.query(
        `
        SELECT college_id, college_name
        FROM college
        ORDER BY college_name
        `,
        (err, rows) => {
            if (err) {
                console.error("College list error:", err);
                return res.json([]);
            }
            res.json(Array.isArray(rows) ? rows : []);
        }
    );
});

/* =================================================
   AVAILABLE EXAMS (UPDATED FOR DATE RANGE)
================================================= */

router.get("/exams/:studentId", (req, res) => {
    const studentId = req.params.studentId;
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    db.query(
        `
        SELECT student_id, course, status, student_type, created_at, walkin_exam_id
        FROM students
        WHERE student_id = ?
        LIMIT 1
        `,
        [studentId],
        (err, studentRows) => {
            if (err || !studentRows || studentRows.length === 0) {
                if (err) console.error("Student lookup error:", err);
                return res.json([]);
            }

            const student = studentRows[0];
            if (String(student.status || "").toUpperCase() !== "ACTIVE") {
                return res.json([]);
            }

            const normalizedType = String(student.student_type || "")
                .trim()
                .toUpperCase()
                .replace(/[\s-]/g, "_");
            const isWalkin =
                normalizedType === "WALKIN" ||
                normalizedType === "WALK_IN" ||
                normalizedType === "WALK_INN" ||
                normalizedType === "WALK_IN_STUDENT";

            if (isWalkin) {
                const streamCode = getWalkinStreamCodeOrDefault(student.course);
                const streamLabel = getWalkinStreamLabel(streamCode);
                const durationMinutes = getWalkinDurationMinutes(streamCode);

                return db.query(
                    `
                    SELECT walkin_exam_id
                    FROM walkin_exams
                    WHERE stream_code = ?
                      AND (exam_status = 'READY' OR exam_status IS NULL)
                    ORDER BY walkin_exam_id DESC
                    LIMIT 1
                    `,
                    [streamCode],
                    (examErr, examRows) => {
                        if (examErr) {
                            console.error("Walk-in exam lookup error:", examErr);
                            return res.json([]);
                        }

                        const respondWithWalkinExam = (resolvedExamId) => {
                            if (!resolvedExamId) {
                                return res.json([]);
                            }
                            return res.json([
                                {
                                    exam_id: Number(resolvedExamId),
                                    exam_name: `${streamLabel} Walk-in Exam`,
                                    exam_start_date: new Date().toISOString().slice(0, 10),
                                    exam_end_date: new Date().toISOString().slice(0, 10),
                                    start_time: null,
                                    end_time: null,
                                    duration_minutes: durationMinutes,
                                    course: streamLabel
                                }
                            ]);
                        };

                        const resolvedExamId = Number(examRows?.[0]?.walkin_exam_id || 0);
                        if (resolvedExamId > 0) {
                            return respondWithWalkinExam(resolvedExamId);
                        }

                        return db.query(
                            `
                            INSERT INTO walkin_exams (stream, stream_code, exam_status)
                            VALUES (?, ?, 'READY')
                            RETURNING walkin_exam_id
                            `,
                            [streamLabel, streamCode],
                            (createErr, createRows) => {
                                if (createErr) {
                                    console.error("Walk-in exam auto-create error:", createErr);
                                    return res.json([]);
                                }
                                return respondWithWalkinExam(Number(createRows?.insertId || 0));
                            }
                        );
                    }
                );
            }

            return res.json([]);
        }
    );
});

/* ================= LOGOUT ================= */
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }
    req.session.destroy(() => res.json({ success: true }));
});

/* =================================================
   AUTH MIDDLEWARE
================================================= */

const STUDENT_AUTH_WHITELIST = ["/login", "/register"];

router.use((req, res, next) => {
    if (req.method === "OPTIONS" || STUDENT_AUTH_WHITELIST.includes(req.path)) {
        return next();
    }

    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    next();
});

router.param("studentId", (req, res, next, studentId) => {
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
});

/* =================================================
   ATTEMPTED EXAMS (UPDATED)
================================================= */

router.get("/attempted-exams/:studentId", (req, res) => {
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (String(req.params.studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const sql = `
        SELECT exam_id, exam_name, exam_start_date, exam_end_date, course, attempt_status
        FROM (
            SELECT
                wfr.exam_id,
                CONCAT(COALESCE(we.stream, s.course), ' Walk-in Exam') AS exam_name,
                DATE(COALESCE(wfr.attempted_at, CURRENT_DATE)) AS exam_start_date,
                DATE(COALESCE(wfr.attempted_at, CURRENT_DATE)) AS exam_end_date,
                COALESCE(we.stream, s.course) AS course,
                'SUBMITTED' AS attempt_status,
                (1000000000 + wfr.result_id) AS sort_id
            FROM walkin_final_results wfr
            JOIN students s ON s.student_id = wfr.student_id
            LEFT JOIN walkin_exams we ON we.walkin_exam_id = wfr.exam_id
            WHERE wfr.student_id = ?
        ) combined
        ORDER BY sort_id DESC
`;

    db.query(sql, [req.params.studentId, req.params.studentId], (err, rows) => {
        if (err) {
            console.error("Attempted exams error:", err);
            return res.json([]);
        }
        res.json(rows || []);
    });
});

module.exports = router;
