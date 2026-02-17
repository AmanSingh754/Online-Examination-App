const express = require("express");
const router = express.Router();
const db = require("../db");
const { getWalkinStreamCodeOrDefault, getWalkinStreamLabel } = require("../utils/walkinStream");
const { isAtLeastAge } = require("../utils/ageValidation");

const getWalkinDurationMinutes = (streamCode) => {
    if (streamCode === "DS") return 60;
    if (streamCode === "DA") return 50;
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
ensureWalkinAttemptedAtColumn();

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
router.post("/register", (req, res) => {
    const {
        name,
        email,
        phone,
        dob,
        course,
        collegeId,
        password
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanDob = String(dob || "").trim();
    const cleanCourse = String(course || "").trim();
    const cleanCollegeId = String(collegeId || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanName || !cleanEmail || !cleanPhone || !cleanDob || !cleanCourse || !cleanCollegeId || !cleanPassword) {
        return res.json({ success: false, message: "Missing required fields" });
    }
    if (!isAtLeastAge(cleanDob, 18)) {
        return res.json({ success: false, message: "Student must be at least 18 years old." });
    }

    db.query(
        `SELECT student_id FROM students WHERE email_id = ?`,
        [cleanEmail],
        (err, rows) => {
            if (err) {
                console.error("Register lookup error:", err);
                return res.json({ success: false, message: "Server error" });
            }

            if (rows.length > 0) {
                return res.json({ success: false, message: "Email already registered" });
            }

            db.query(
                `
                INSERT INTO students
                (name, email_id, contact_number, dob, course, college_id)
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING student_id
                `,
                [cleanName, cleanEmail, cleanPhone, cleanDob, cleanCourse, cleanCollegeId],
                (err2, result) => {
                    if (err2) {
                        console.error("Register student error:", err2);
                        return res.json({ success: false, message: "Registration failed" });
                    }

                    const newStudentId = result?.insertId;
                    db.query(
                        `
                        INSERT INTO student_credentials
                        (student_id, password)
                        VALUES (?, ?)
                        `,
                        [newStudentId, cleanPassword],
                        (err3) => {
                            if (err3) {
                                console.error("Register credentials error:", err3);
                                return res.json({ success: false, message: "Registration failed" });
                            }
                            res.json({ success: true, studentId: newStudentId });
                        }
                    );
                }
            );
        }
    );
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
                const walkinExamId = Number(student.walkin_exam_id || 0);
                if (!walkinExamId) {
                    return res.json([]);
                }
                return db.query(
                    `SELECT stream FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
                    [walkinExamId],
                    (err4, walkinExamRows) => {
                        if (err4) {
                            console.error("Walk-in stream lookup error:", err4);
                            return res.json([]);
                        }

                        const streamCode = getWalkinStreamCodeOrDefault(
                            walkinExamRows?.[0]?.stream || student.course
                        );
                        const durationMinutes = getWalkinDurationMinutes(streamCode);
                        const streamLabel = getWalkinStreamLabel(streamCode);

                        return res.json([
                            {
                                exam_id: walkinExamId,
                                exam_name: `${streamLabel} Walk-in Exam`,
                                exam_start_date: new Date().toISOString().slice(0, 10),
                                exam_end_date: new Date().toISOString().slice(0, 10),
                                start_time: null,
                                end_time: null,
                                duration_minutes: durationMinutes,
                                course: streamLabel
                            }
                        ]);
                    }
                );
            }

            db.query(
                `
                SELECT live_start_date, live_end_date
                FROM exam_window_config
                ORDER BY id DESC
                LIMIT 1
                `,
                [],
                (err2, windowRows) => {
                    if (err2 || !windowRows || windowRows.length === 0) {
                        if (err2) console.error("Exam window lookup error:", err2);
                        return res.json([]);
                    }

                    const examWindow = windowRows[0];
                    // Regular exam: depends on per-exam schedule window.
                    const sql = `
                        SELECT 
                            e.exam_id,
                            CONCAT(e.course, ' Exam') AS exam_name,
                            DATE(e.start_at) AS exam_start_date,
                            DATE(e.end_at) AS exam_end_date,
                            TIME(e.start_at) AS start_time,
                            TIME(e.end_at) AS end_time,
                            e.course
                        FROM students s
                        JOIN exams e ON e.course = s.course
                        WHERE s.student_id = ?
                          AND e.exam_status = 'READY'
                          AND NOW() BETWEEN e.start_at AND e.end_at
                          AND NOT EXISTS (
                              SELECT 1
                              FROM results r
                              WHERE r.student_id = s.student_id
                                AND r.exam_id = e.exam_id
                          )
                        ORDER BY e.exam_id DESC
                    `;

                    db.query(sql, [studentId], (err6, rows) => {
                        if (err6) {
                            console.error("Available exams error:", err6);
                            return res.json([]);
                        }
                        return res.json(rows || []);
                    });
                }
            );
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
                r.exam_id,
                CASE
                    WHEN we.walkin_exam_id IS NOT NULL THEN CONCAT(we.stream, ' Walk-in Exam')
                    ELSE CONCAT(COALESCE(e.course, s.course), ' Exam')
                END AS exam_name,
                NULL AS exam_start_date,
                NULL AS exam_end_date,
                COALESCE(e.course, we.stream, s.course) AS course,
                r.attempt_status,
                r.result_id AS sort_id
            FROM results r
            JOIN students s ON s.student_id = r.student_id
            LEFT JOIN exams e ON e.exam_id = r.exam_id
            LEFT JOIN walkin_exams we ON we.walkin_exam_id = r.exam_id
            WHERE r.student_id = ?

            UNION ALL

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
