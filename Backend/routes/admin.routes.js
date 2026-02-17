const express = require("express");
const router = express.Router();
const db = require("../db");
const { generateQuestionsForCourse } = require("../Generator");
const util = require("util");
const queryAsync = util.promisify(db.query).bind(db);
const { openaiClient, gradeDescriptiveAnswerDetailed, generateWalkinPerformanceSummary } = require("../llm");
const {
    STREAM_BY_CODE,
    getCanonicalWalkinStreamCode,
    getWalkinStreamCodeOrDefault,
    getWalkinStreamLabel,
    getWalkinStreamQuestionKey
} = require("../utils/walkinStream");
const { isAtLeastAge } = require("../utils/ageValidation");

const WALKIN_STREAMS = Object.values(STREAM_BY_CODE);
const isWalkinCourse = (value) => Boolean(getCanonicalWalkinStreamCode(value));
let walkinAnswerSectionColumnChecked = false;
let walkinAttemptedAtColumnChecked = false;
let walkinExamStreamCodeColumnChecked = false;
const IST_OFFSET_MINUTES = 5.5 * 60;
const TWENTY_FOUR_HOUR_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const parseIstDateTimeToEpoch = (dateStr, timeStr) => {
    const dateRaw = String(dateStr || "").trim();
    const timeRaw = String(timeStr || "").trim();
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateRaw);
    const timeMatch = TWENTY_FOUR_HOUR_TIME_RE.exec(timeRaw);
    if (!dateMatch || !timeMatch) return null;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    const utcEpoch = Date.UTC(year, month - 1, day, hour, minute, 0);
    return utcEpoch - IST_OFFSET_MINUTES * 60 * 1000;
};

const toIstMysqlDateTime = (epochMs) => {
    const dateValue = new Date(Number(epochMs || 0) + IST_OFFSET_MINUTES * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${dateValue.getUTCFullYear()}-${pad(dateValue.getUTCMonth() + 1)}-${pad(dateValue.getUTCDate())} ${pad(dateValue.getUTCHours())}:${pad(dateValue.getUTCMinutes())}:${pad(dateValue.getUTCSeconds())}`;
};

async function ensureWalkinAnswerSectionColumn() {
    if (walkinAnswerSectionColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_student_answers
             ADD COLUMN section_name VARCHAR(32) NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add section_name column to walkin_student_answers:", msg);
        }
    } finally {
        walkinAnswerSectionColumnChecked = true;
    }
}

async function ensureWalkinAttemptedAtColumn() {
    if (walkinAttemptedAtColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_final_results
             ADD COLUMN attempted_at TIMESTAMP NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add attempted_at column to walkin_final_results:", msg);
        }
    } finally {
        walkinAttemptedAtColumnChecked = true;
    }
}

async function loadWalkinQuestionSet(stream) {
    const streamCode = getWalkinStreamCodeOrDefault(stream);
    const normalizedStreamKey = getWalkinStreamQuestionKey(streamCode);
    const includeCoding = streamCode !== "DA";
    const aptitudeRows = await queryAsync(`
        SELECT question_text, option_a, option_b, option_c, option_d, correct_option
        FROM walkin_aptitude_questions
        ORDER BY question_id
    `);
    const streamRows = await queryAsync(
        `
        SELECT question_text, section_name, question_type, option_a, option_b, option_c, option_d, correct_option
        FROM walkin_stream_questions
        WHERE REGEXP_REPLACE(LOWER(COALESCE(stream::text, '')), '[^a-z0-9]+', '', 'g') = ?
        ORDER BY question_id
        `,
        [normalizedStreamKey]
    );
    const codingRows = await queryAsync(
        `SELECT question_text FROM walkin_coding_questions ORDER BY question_id`
    );

    if (!aptitudeRows.length) {
        throw new Error("Walk-in aptitude question bank is empty");
    }

    const result = [];
    aptitudeRows.forEach((row) => {
        result.push({
            section_name: "Aptitude",
            question_type: "MCQ",
            question_text: row.question_text,
            option_a: row.option_a || "",
            option_b: row.option_b || "",
            option_c: row.option_c || "",
            option_d: row.option_d || "",
            correct_answer: row.correct_option || null
        });
    });

    const mcqRows = [];
    const descriptiveRows = [];

    streamRows.forEach((row) => {
        const normalizedType = (row.question_type || "").toLowerCase();
        const isMCQ = normalizedType.includes("mcq");
        const optionList = [row.option_a, row.option_b, row.option_c, row.option_d];
        const correctOptionStr = row.correct_option || "";
        const correctOptionIndex = ["A","B","C","D"].indexOf(correctOptionStr.toUpperCase());
        const formattedRow = {
            section_name: row.section_name || "Theory",
            question_type: isMCQ ? "MCQ" : "Descriptive",
            question_text: row.question_text,
            option_a: optionList[0] || "",
            option_b: optionList[1] || "",
            option_c: optionList[2] || "",
            option_d: optionList[3] || "",
            correct_answer:
                isMCQ && correctOptionIndex !== -1
                    ? ["A", "B", "C", "D"][correctOptionIndex]
                    : null
        };

        if (isMCQ) {
            mcqRows.push(formattedRow);
        } else {
            descriptiveRows.push(formattedRow);
        }
    });

    mcqRows.forEach((row) => result.push(row));
    descriptiveRows.forEach((row) => result.push(row));

    if (includeCoding) {
        codingRows.forEach((row) => {
            result.push({
                section_name: "Coding",
                question_type: "Coding",
                question_text: row.question_text,
                option_a: "",
                option_b: "",
                option_c: "",
                option_d: "",
                correct_answer: null
            });
        });
    }

    return result;
}

async function seedWalkinExamQuestions(examId, stream) {
    if (!stream) {
        throw new Error("Walk-in stream is required to seed questions");
    }
    const questions = await loadWalkinQuestionSet(stream);
    if (!questions.length) {
        throw new Error("Walk-in question set for the stream is empty");
    }

    await queryAsync(`DELETE FROM questions WHERE exam_id = ?`, [examId]);

    const insertSql = `
        INSERT INTO questions
        (question_text, option_a, option_b, option_c, option_d, correct_answer, section_name, question_type, exam_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const question of questions) {
        await queryAsync(insertSql, [
            question.question_text,
            question.option_a || "",
            question.option_b || "",
            question.option_c || "",
            question.option_d || "",
            question.correct_answer || null,
            question.section_name || "General",
            question.question_type || "MCQ",
            examId
        ]);
    }

    await queryAsync(
        `UPDATE exams SET exam_status = 'READY' WHERE exam_id = ?`,
        [examId]
    );
}

function ensureStudentTypeColumn() {
    const query = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_schema = current_schema()
          AND table_name = 'students'
          AND column_name = 'student_type'
    `;

    db.query(query, (err, rows) => {
        if (err) {
            console.error("Student type column check failed:", err);
            return;
        }

        if (rows?.length > 0) {
            return;
        }

        db.query(
            `ALTER TABLE students ADD COLUMN student_type TEXT NOT NULL DEFAULT 'REGULAR'`,
            err2 => {
                if (err2) {
                    console.error("Could not add student_type column:", err2);
                } else {
                    console.log("Added student_type column to students table");
                }
            }
        );
    });
}

ensureStudentTypeColumn();

function ensureWalkinExamColumn() {
    const query = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_schema = current_schema()
          AND table_name = 'students'
          AND column_name = 'walkin_exam_id'
    `;

    db.query(query, (err, rows) => {
        if (err) {
            console.error("walkin_exam_id column check failed:", err);
            return;
        }

        if (rows?.length > 0) {
            ensureWalkinExamForeignKey().catch((error) => {
                console.warn("walkin_exam_id FK setup failed:", String(error?.message || error));
            });
            return;
        }

        db.query(
            `ALTER TABLE students ADD COLUMN walkin_exam_id INT NULL`,
            err2 => {
                if (err2) {
                    console.error("Could not add walkin_exam_id column:", err2);
                } else {
                    console.log("Added walkin_exam_id column to students table");
                    ensureWalkinExamForeignKey().catch((error) => {
                        console.warn("walkin_exam_id FK setup failed:", String(error?.message || error));
                    });
                }
            }
        );
    });
}

ensureWalkinExamColumn();

async function ensureWalkinExamForeignKey() {
    const existing = await queryAsync(
        `
        SELECT c.conname AS constraint_name
        FROM pg_constraint c
        JOIN pg_class t
          ON t.oid = c.conrelid
        JOIN pg_namespace n
          ON n.oid = t.relnamespace
        JOIN pg_attribute a
          ON a.attrelid = t.oid
         AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f'
          AND n.nspname = current_schema()
          AND t.relname = 'students'
          AND a.attname = 'walkin_exam_id'
        LIMIT 1
        `
    );
    if (existing && existing.length > 0) return;

    // Repair old orphan mappings before applying FK.
    await queryAsync(
        `
        UPDATE students s
        SET walkin_exam_id = NULL
        WHERE s.walkin_exam_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM walkin_exams we
              WHERE we.walkin_exam_id = s.walkin_exam_id
          )
        `
    );

    try {
        await queryAsync(
            `CREATE INDEX IF NOT EXISTS idx_students_walkin_exam_id
             ON students (walkin_exam_id)`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateIndex =
            Number(error?.errno) === 1061 ||
            /duplicate key name/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateIndex) {
            console.warn("Could not add students.walkin_exam_id index:", msg);
        }
    }

    await queryAsync(
        `ALTER TABLE students
         ADD CONSTRAINT fk_students_walkin_exam
         FOREIGN KEY (walkin_exam_id)
         REFERENCES walkin_exams(walkin_exam_id)
         ON DELETE SET NULL
         ON UPDATE CASCADE`
    );
}

async function ensureWalkinExamStreamCodeColumn() {
    if (walkinExamStreamCodeColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_exams
             ADD COLUMN stream_code TEXT NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add stream_code column to walkin_exams:", msg);
        }
    }

    try {
        await queryAsync(
            `ALTER TABLE walkin_exams
             ALTER COLUMN stream_code TYPE TEXT
             USING stream_code::text`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const alreadyText = /cannot cast type text to text|is already of type/i.test(msg);
        if (!alreadyText) {
            console.warn("Could not normalize stream_code type to TEXT:", msg);
        }
    }

    try {
        await queryAsync(
            `
            UPDATE walkin_exams
            SET stream_code = CASE
                WHEN UPPER(REPLACE(TRIM(stream::text), ' ', '')) IN ('DS', 'DATASCIENCE') THEN 'DS'
                WHEN UPPER(REPLACE(TRIM(stream::text), ' ', '')) IN ('DA', 'DATAANALYTICS') THEN 'DA'
                WHEN UPPER(REPLACE(TRIM(stream::text), ' ', '')) IN ('MERN', 'FULLSTACK') THEN 'MERN'
                ELSE 'MERN'
            END
            WHERE stream_code IS NULL
            `
        );
    } catch (error) {
        console.warn("Could not backfill stream_code in walkin_exams:", String(error?.message || ""));
    }

    try {
        await queryAsync(
            `CREATE INDEX IF NOT EXISTS idx_walkin_exams_stream_code_status
             ON walkin_exams (stream_code, exam_status)`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateIndex =
            Number(error?.errno) === 1061 ||
            /duplicate key name/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateIndex) {
            console.warn("Could not add stream_code index on walkin_exams:", msg);
        }
    }

    walkinExamStreamCodeColumnChecked = true;
}

ensureWalkinExamStreamCodeColumn().catch((error) => {
    console.warn("walkin_exams stream_code normalization setup failed:", String(error?.message || error));
});

function ensureQuestionColumns() {
    const required = {
        section_name: "VARCHAR(128) NOT NULL DEFAULT 'General'",
        question_type: "TEXT NOT NULL DEFAULT 'MCQ'"
    };

    db.query(
        `
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE table_schema = current_schema()
              AND table_name = 'questions'
              AND column_name IN ('section_name', 'question_type')
        `,
        (err, rows) => {
            if (err) {
                console.error("Question schema check failed:", err);
                return;
            }

            const existing = new Set((rows || []).map((row) => row.COLUMN_NAME || row.column_name));
            Object.entries(required).forEach(([column, definition]) => {
                if (existing.has(column)) return;
                db.query(
                    `ALTER TABLE questions ADD COLUMN ${column} ${definition}`,
                    (alterErr) => {
                        if (alterErr) {
                            console.error(`Could not add ${column} column:`, alterErr);
                        } else {
                            console.log(`Added ${column} column to questions table`);
                        }
                    }
                );
            });
        }
    );
}

ensureQuestionColumns();

/* ================= ADMIN LOGIN API ================= */
router.post("/login", (req, res) => {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!email || !password) {
        return res.json({ success: false, message: "Missing credentials" });
    }

    const sql = `
        SELECT a.admin_id
        FROM admins a
        WHERE LOWER(a.email_id) = LOWER(?) AND a.password = ?
    `;
    db.query(sql, [email, password], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            console.error("Admin login error:", err);
            return res.json({ success: false });
        }

        req.session.admin = {
            adminId: rows[0].admin_id
        };

        res.json({
            success: true,
            adminId: rows[0].admin_id
        });
    });
});
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }
    req.session.destroy(() => res.json({ success: true }));
});

/* ================= AUTH ================= */
const ADMIN_AUTH_WHITELIST = ["/login"];

router.use((req, res, next) => {
    if (req.method === "OPTIONS" || ADMIN_AUTH_WHITELIST.includes(req.path)) {
        return next();
    }
    if (!req.session?.admin) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    next();
});

router.param("collegeId", (req, res, next, collegeId) => {
    if (!req.session?.admin) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    next();
});

router.post("/sessions/revoke-all", (req, res) => {
    const sessionStore = req.app?.locals?.sessionStore;
    if (!sessionStore || typeof sessionStore.clear !== "function") {
        return res.status(500).json({ success: false, message: "Session store unavailable" });
    }

    sessionStore.clear((err) => {
        if (err) {
            console.error("Session revoke-all failed:", err);
            return res.status(500).json({ success: false, message: "Could not revoke sessions" });
        }

        if (!req.session) {
            return res.json({ success: true, message: "All sessions revoked" });
        }

        req.session.destroy(() => {
            res.json({ success: true, message: "All sessions revoked" });
        });
    });
});

/* ================= COLLEGES MANAGEMENT ================= */
router.get("/colleges", async (req, res) => {
    try {
        const rows = await queryAsync(
            `
            SELECT college_id, college_name
            FROM college
            ORDER BY college_name
            `
        );
        return res.json({ success: true, colleges: rows || [] });
    } catch (error) {
        console.error("Colleges list error:", error);
        return res.status(500).json({ success: false, message: "Could not load colleges" });
    }
});

router.post("/colleges", async (req, res) => {
    const collegeName = String(req.body?.collegeName || "").trim();
    if (!collegeName) {
        return res.status(400).json({ success: false, message: "College name is required" });
    }

    try {
        const duplicate = await queryAsync(
            `
            SELECT college_id
            FROM college
            WHERE LOWER(TRIM(college_name)) = LOWER(?)
            LIMIT 1
            `,
            [collegeName]
        );
        if (duplicate.length) {
            return res.status(409).json({ success: false, message: "College already exists" });
        }

        try {
            const result = await queryAsync(
                `
                INSERT INTO college (college_name)
                VALUES (?)
                RETURNING college_id
                `,
                [collegeName]
            );
            return res.json({
                success: true,
                collegeId: result?.insertId || null,
                collegeName
            });
        } catch (insertError) {
            const missingDefaultCollegeId =
                Number(insertError?.errno) === 1364 &&
                /college_id/i.test(String(insertError?.sqlMessage || insertError?.message || ""));
            if (!missingDefaultCollegeId) {
                throw insertError;
            }

            const nextIdRows = await queryAsync(
                `
                SELECT COALESCE(MAX(college_id::bigint), 0) + 1 AS next_id
                FROM college
                `
            );
            const nextId = String(Number(nextIdRows?.[0]?.next_id || 1));

            await queryAsync(
                `
                INSERT INTO college (college_id, college_name)
                VALUES (?, ?)
                `,
                [nextId, collegeName]
            );

            return res.json({
                success: true,
                collegeId: nextId,
                collegeName
            });
        }
    } catch (error) {
        console.error("Create college error:", error);
        return res.status(500).json({ success: false, message: "Could not create college" });
    }
});

router.put("/colleges/:id", async (req, res) => {
    const collegeId = String(req.params.id || "").trim();
    const collegeName = String(req.body?.collegeName || "").trim();
    if (!collegeId || !collegeName) {
        return res.status(400).json({ success: false, message: "College id and name are required" });
    }

    try {
        const rows = await queryAsync(
            `
            SELECT college_id
            FROM college
            WHERE college_id = ?
            LIMIT 1
            `,
            [collegeId]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "College not found" });
        }

        const duplicate = await queryAsync(
            `
            SELECT college_id
            FROM college
            WHERE LOWER(TRIM(college_name)) = LOWER(?)
              AND college_id <> ?
            LIMIT 1
            `,
            [collegeName, collegeId]
        );
        if (duplicate.length) {
            return res.status(409).json({ success: false, message: "College name already exists" });
        }

        await queryAsync(
            `
            UPDATE college
            SET college_name = ?
            WHERE college_id = ?
            `,
            [collegeName, collegeId]
        );

        return res.json({ success: true, collegeId, collegeName });
    } catch (error) {
        console.error("Update college error:", error);
        return res.status(500).json({ success: false, message: "Could not update college" });
    }
});

/* ================= CREATE EVENT ================= */
router.post("/event", (req, res) => {
    return res.status(410).json({
        success: false,
        message: "Event flow removed. Manage exams directly by course/stream."
    });
});

/* ================= UPDATE EVENT STATUS ================= */
router.put("/event/status/:eventId", (req, res) => {
    return res.status(410).json({ success: false, message: "Event flow removed" });
});

/* ================= EVENT OVERRIDES ================= */
router.post("/event/override", (req, res) => {
    return res.status(410).json({ success: false, message: "Event flow removed" });
});

router.delete("/event/override", (req, res) => {
    return res.status(410).json({ success: false, message: "Event flow removed" });
});

/* ================= DELETE EVENT ================= */
router.put("/event/delete/:eventId", (req, res) => {
    return res.status(410).json({ success: false, message: "Event flow removed" });
});

/* ================= ADMIN EVENTS ================= */
router.get("/events/:collegeId", (req, res) => {
    return res.json([]);
});

/* ================= STUDENT COUNT ================= */
router.get("/students/count/:collegeId", (req, res) => {
    db.query(
        `SELECT COUNT(*) AS total FROM students WHERE college_id = ?`,
        [req.params.collegeId],
        (err, rows) => {
            if (err) {
                console.error("Student count error:", err);
                return res.json({ total: 0 });
            }
            res.json({ total: rows?.[0]?.total || 0 });
        }
    );
});

/* ================= EXAM COUNT ================= */
router.get("/exams/count/:collegeId", (req, res) => {
    db.query(
        `
        SELECT COUNT(*) AS total
        FROM exams e
        WHERE EXISTS (
            SELECT 1
            FROM students s
            WHERE s.college_id = ?
              AND s.course = e.course
        )
        `,
        [req.params.collegeId],
        (err, rows) => {
            if (err) {
                console.error("Exam count error:", err);
                return res.json({ total: 0 });
            }
            res.json({ total: rows?.[0]?.total || 0 });
        }
    );
});

/* ================= ACTIVE EXAM COUNT ================= */
router.get("/exams/active-count/:collegeId", (req, res) => {
    db.query(
        `
        SELECT COUNT(*) AS total
        FROM exams e
        WHERE e.exam_status = 'READY'
          AND EXISTS (
            SELECT 1
            FROM students s
            WHERE s.college_id = ?
              AND s.course = e.course
        )
        `,
        [req.params.collegeId],
        (err, rows) => {
            if (err) {
                console.error("Active exam count error:", err);
                return res.json({ total: 0 });
            }
            res.json({ total: rows?.[0]?.total || 0 });
        }
    );
});

/* ================= RECENT RESULTS ================= */
router.get("/results/:collegeId", (req, res) => {
    db.query(
        `
        SELECT r.result_id,
               r.student_id,
               s.name AS student_name,
               r.exam_id,
               r.attempt_status,
               r.total_marks,
               r.result_status,
               CONCAT(e.course, ' Exam') AS exam_name,
               NULL AS exam_start_date,
               NULL AS exam_end_date,
               e.course,
               COALESCE(q.total_questions, 0) AS total_questions,
               sa_stats.correct_answers AS correct_answers,
               CASE
                   WHEN r.result_status IS NOT NULL THEN r.result_status
                   WHEN q.total_questions > 0 AND sa_stats.correct_answers IS NOT NULL THEN 'COMPLETED'
                   ELSE 'PENDING'
               END AS pass_fail
        FROM results r
        JOIN exams e ON e.exam_id = r.exam_id
        JOIN students s ON s.student_id = r.student_id
        LEFT JOIN (
            SELECT sa.student_id,
                   sa.exam_id,
                   COUNT(*) AS answered_count,
                   SUM(sa.selected_option = q.correct_answer) AS correct_answers
            FROM student_answers sa
            JOIN questions q ON sa.question_id = q.question_id
            GROUP BY sa.student_id, sa.exam_id
        ) sa_stats ON sa_stats.student_id = r.student_id AND sa_stats.exam_id = r.exam_id
        LEFT JOIN (
            SELECT exam_id, COUNT(*) AS total_questions
            FROM questions
            GROUP BY exam_id
        ) q ON q.exam_id = e.exam_id
        WHERE s.college_id = ?
        ORDER BY r.result_id DESC
        LIMIT 10
        `,
        [req.params.collegeId],
        (err, rows) => {
            if (err) {
                console.error("Results load error:", err);
                return res.json([]);
            }
            res.json(rows || []);
        }
    );
});

router.get("/result-answers/:resultId", (req, res) => {
    const { resultId } = req.params;
    if (!resultId) {
        return res.status(400).json({ success: false });
    }

    const query = `
        SELECT 
            q.question_id,
            q.question_text,
            q.option_a,
            q.option_b,
            q.option_c,
            q.option_d,
            q.correct_answer,
            sa.selected_option
        FROM results r
        JOIN exams e ON e.exam_id = r.exam_id
        JOIN student_answers sa 
            ON sa.exam_id = e.exam_id 
            AND sa.student_id = r.student_id
        JOIN questions q ON q.question_id = sa.question_id
        WHERE r.result_id = ?
        ORDER BY q.question_id
    `;

    db.query(query, [resultId], (err, rows) => {
        if (err) {
            console.error("Result questions error:", err);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true, questions: rows || [] });
    });
});

/* ================= STUDENT PROFILES ================= */
router.get("/students/:collegeId", (req, res) => {
    db.query(
        `
        SELECT s.student_id,
               s.name,
               s.email_id,
               s.contact_number,
               s.course,
               s.dob,
               sc.password,
               CASE
                   WHEN s.student_type = 'WALK_IN' THEN 'WALKIN'
                   WHEN s.student_type = 'REGULAR' THEN 'REGULAR'
                   WHEN UPPER(REPLACE(TRIM(COALESCE(s.course, '')), ' ', '')) IN
                        ('DS', 'DATASCIENCE', 'DA', 'DATAANALYTICS', 'MERN', 'FULLSTACK') THEN 'WALKIN'
                   ELSE 'REGULAR'
               END AS student_type,
                s.status AS student_status
        FROM students s
        LEFT JOIN student_credentials sc ON sc.student_id = s.student_id
        WHERE s.college_id = ?
        ORDER BY s.name
        `,
        [req.params.collegeId],
        (err, rows) => {
            if (err) {
                console.error("Student list error:", err);
                return res.json([]);
            }
            res.json(rows || []);
        }
    );
});

const updateStudentStatus = async (req, res) => {
    const studentId = Number(req.params.studentId || 0);
    const requested = String(req.body?.status || "").trim().toUpperCase();
    const normalized = requested === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    if (!studentId) {
        return res.status(400).json({ success: false, message: "Invalid student id" });
    }

    try {
        const updateResult = await queryAsync(
            `UPDATE students SET status = ? WHERE student_id = ?`,
            [normalized, studentId]
        );
        if (!updateResult || Number(updateResult.affectedRows || 0) === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        if (normalized === "ACTIVE") {
            const studentRows = await queryAsync(
                `SELECT student_type, course, walkin_exam_id FROM students WHERE student_id = ? LIMIT 1`,
                [studentId]
            );
            const student = studentRows?.[0] || null;
            const type = String(student?.student_type || "").trim().toUpperCase().replace(/[\s-]/g, "_");
            const isWalkinType =
                type === "WALKIN" ||
                type === "WALK_IN" ||
                type === "WALK_INN" ||
                type === "WALK_IN_STUDENT";
            const currentWalkinExamId = Number(student?.walkin_exam_id || 0);

            if (isWalkinType && !currentWalkinExamId) {
                const streamCode = getCanonicalWalkinStreamCode(student?.course);
                if (streamCode) {
                    const streamLabel = getWalkinStreamLabel(streamCode);
                    const existingExamRows = await queryAsync(
                        `
                        SELECT walkin_exam_id
                        FROM walkin_exams
                        WHERE stream_code = ?
                          AND (exam_status = 'READY' OR exam_status IS NULL)
                        ORDER BY walkin_exam_id DESC
                        LIMIT 1
                        `,
                        [streamCode]
                    );
                    let resolvedWalkinExamId = Number(existingExamRows?.[0]?.walkin_exam_id || 0);

                    if (!resolvedWalkinExamId) {
                        const createdExam = await queryAsync(
                            `INSERT INTO walkin_exams (stream, stream_code, exam_status)
                             VALUES (?, ?, 'READY')
                             RETURNING walkin_exam_id`,
                            [streamLabel, streamCode]
                        );
                        resolvedWalkinExamId = Number(createdExam?.insertId || 0);
                    }

                    if (resolvedWalkinExamId) {
                        await queryAsync(
                            `UPDATE students SET walkin_exam_id = ? WHERE student_id = ?`,
                            [resolvedWalkinExamId, studentId]
                        );
                    }
                }
            }
        }

        const readRows = await queryAsync(
            `SELECT status, walkin_exam_id FROM students WHERE student_id = ? LIMIT 1`,
            [studentId]
        );
        const persisted = String(readRows?.[0]?.status || normalized).trim().toUpperCase();
        return res.json({
            success: true,
            status: persisted || normalized,
            walkinExamId: Number(readRows?.[0]?.walkin_exam_id || 0) || null
        });
    } catch (error) {
        console.error("Status update error:", error);
        return res.status(500).json({ success: false, message: "Could not update status" });
    }
};

router.patch("/students/:studentId/status", updateStudentStatus);
router.put("/students/:studentId/status", updateStudentStatus);
router.post("/students/:studentId/status", updateStudentStatus);

router.post("/walkin/grade-descriptive", async (req, res) => {
    if (!openaiClient) {
        return res.status(500).json({ success: false, message: "LLM client not configured" });
    }
    const { studentId, examId } = req.body;
    if (!studentId || !examId) {
        return res.status(400).json({ success: false, message: "Missing student or exam" });
    }

    try {
        const rows = await queryAsync(
            `
            SELECT wsa.submission_id, wsa.question_id, wsa.descriptive_answer, ws.descriptive_answer AS reference_answer, ws.marks AS full_marks
            FROM walkin_student_answers wsa
            JOIN walkin_stream_questions ws ON ws.question_id = wsa.question_id
            WHERE wsa.student_id = ?
              AND wsa.exam_id = ?
              AND wsa.question_type = 'DESCRIPTIVE'
        `,
            [studentId, examId]
        );

        if (!rows.length) {
            return res.json({ success: true, graded: [] });
        }

        const graded = [];
        for (const row of rows) {
            const grading = await gradeDescriptiveAnswerDetailed(
                row.reference_answer,
                row.descriptive_answer,
                Number(row.full_marks || 1)
            );
            const score = Number(grading?.score || 0);
            await queryAsync(
                `UPDATE walkin_student_answers SET marks_obtained = ? WHERE submission_id = ?`,
                [score, row.submission_id]
            );
            graded.push({
                submission_id: row.submission_id,
                score,
                meta: grading?.meta || null
            });
        }

        return res.json({ success: true, graded });
    } catch (error) {
        console.error("Walk-in grading error:", error);
        return res.status(500).json({ success: false, message: "Grading failed" });
    }
});

router.get("/walkin/results/:collegeId", async (req, res) => {
    const { collegeId } = req.params;
    try {
        const rows = await queryAsync(
            `
            SELECT wsa.student_id,
                   s.name,
                   wsa.exam_id,
                   SUM(COALESCE(wsa.marks_obtained, 0)) AS total_marks,
                   MAX(ws.stream) AS stream
            FROM walkin_student_answers wsa
            JOIN students s ON s.student_id = wsa.student_id
            LEFT JOIN walkin_stream_questions ws ON ws.question_id = wsa.question_id
            WHERE s.college_id = ?
              AND s.student_type = 'WALK_IN'
            GROUP BY wsa.student_id, wsa.exam_id
            ORDER BY s.name, wsa.exam_id
        `,
            [collegeId]
        );
        res.json(rows || []);
    } catch (error) {
        console.error("Walk-in results error:", error);
        res.status(500).json({ success: false, message: 'Could not load walk-in results' });
    }
});

router.get("/walkin/final-results/:collegeId", async (req, res) => {
    const { collegeId } = req.params;
    try {
        await ensureWalkinAttemptedAtColumn();
        const rows = await queryAsync(
            `
            SELECT wfr.*, s.name, COALESCE(we.stream, s.course) AS stream
            FROM walkin_final_results wfr
            JOIN students s ON s.student_id = wfr.student_id
            LEFT JOIN walkin_exams we ON we.walkin_exam_id = wfr.exam_id
            WHERE s.college_id = ?
              AND s.student_type = 'WALK_IN'
            ORDER BY COALESCE(wfr.attempted_at, '1970-01-01 00:00:00') DESC, wfr.result_id DESC
        `,
            [collegeId]
        );
        res.json(rows || []);
    } catch (error) {
        console.error("Walk-in final results error:", error);
        res.status(500).json({ success: false, message: 'Could not load walk-in results' });
    }
});

router.get("/dashboard-stats", async (req, res) => {
    try {
        const [eventsRows, studentRows, examRows, activeExamRows, resultRows] = await Promise.all([
            Promise.resolve([]),
            queryAsync(
                `SELECT COUNT(*) AS total FROM students`
            ),
            queryAsync(
                `
                SELECT COUNT(*) AS total
                FROM exams e
                WHERE EXISTS (
                    SELECT 1
                    FROM students s
                    WHERE s.course = e.course
                )
                `
            ),
            queryAsync(
                `
                SELECT COUNT(*) AS total
                FROM exams e
                WHERE e.exam_status = 'READY'
                  AND EXISTS (
                    SELECT 1
                    FROM students s
                    WHERE s.course = e.course
                )
                `
            ),
            queryAsync(
                `
                SELECT r.result_id,
                       r.student_id,
                       s.name AS student_name,
                       r.exam_id,
                       r.attempt_status,
                       r.total_marks,
                       r.result_status,
                       CONCAT(e.course, ' Exam') AS exam_name,
                       NULL AS exam_start_date,
                       NULL AS exam_end_date,
                       e.course
                FROM results r
                JOIN exams e ON e.exam_id = r.exam_id
                JOIN students s ON s.student_id = r.student_id
                ORDER BY r.result_id DESC
                LIMIT 20
                `
            )
        ]);

        return res.json({
            success: true,
            events: eventsRows || [],
            studentCount: Number(studentRows?.[0]?.total || 0),
            totalExamCount: Number(examRows?.[0]?.total || 0),
            totalActiveExamCount: Number(activeExamRows?.[0]?.total || 0),
            recentResults: resultRows || []
        });
    } catch (error) {
        console.error("Dashboard stats error:", error);
        return res.status(500).json({ success: false, message: "Could not load dashboard stats" });
    }
});

router.post("/walkin/final-results/recompute", async (req, res) => {
    const { studentId = null, examId = null, collegeId = null } = req.body || {};

    try {
        await ensureWalkinAnswerSectionColumn();
        const codingRows = await queryAsync(`
            SELECT question_id, LOWER(COALESCE(difficulty, '')) AS difficulty
            FROM walkin_coding_questions
        `);
        const aptitudeRows = await queryAsync(`
            SELECT question_id
            FROM walkin_aptitude_questions
        `);
        const streamRows = await queryAsync(`
            SELECT question_id
            FROM walkin_stream_questions
        `);

        const codingDifficulty = new Map(codingRows.map((row) => [Number(row.question_id), row.difficulty || ""]));
        const aptitudeQuestionIds = new Set(aptitudeRows.map((row) => Number(row.question_id)));
        const streamQuestionIds = new Set(streamRows.map((row) => Number(row.question_id)));

        const scopedRows = await queryAsync(
            `
            SELECT
                wsa.submission_id,
                wsa.student_id,
                wsa.exam_id,
                wsa.question_id,
                COALESCE(wsa.section_name, '') AS section_name,
                wsa.question_type,
                COALESCE(wsa.marks_obtained, 0) AS marks_obtained
            FROM walkin_student_answers wsa
            JOIN students s
              ON s.student_id = wsa.student_id
             AND s.student_type = 'WALK_IN'
            WHERE (?::BIGINT IS NULL OR wsa.student_id = ?::BIGINT)
              AND (?::BIGINT IS NULL OR wsa.exam_id = ?::BIGINT)
              AND (?::BIGINT IS NULL OR s.college_id = ?::BIGINT)
            ORDER BY
                wsa.student_id,
                wsa.exam_id,
                UPPER(COALESCE(wsa.section_name, '')),
                UPPER(COALESCE(wsa.question_type::text, '')),
                wsa.question_id,
                wsa.submission_id DESC
        `,
            [studentId, studentId, examId, examId, collegeId, collegeId]
        );

        const latestRows = [];
        const seenKeys = new Set();
        for (const row of scopedRows) {
            const key = `${row.student_id}|${row.exam_id}|${String(row.section_name || "").toUpperCase()}|${String(row.question_type || "").toUpperCase()}|${row.question_id}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            latestRows.push(row);
        }

        const aggregates = new Map();
        for (const row of latestRows) {
            const resultKey = `${row.student_id}|${row.exam_id}`;
            if (!aggregates.has(resultKey)) {
                aggregates.set(resultKey, {
                    student_id: Number(row.student_id),
                    exam_id: Number(row.exam_id),
                    aptitude_marks: 0,
                    technical_marks: 0,
                    coding_easy_marks: 0,
                    coding_medium_marks: 0,
                    coding_hard_marks: 0
                });
            }

            const agg = aggregates.get(resultKey);
            const qType = String(row.question_type || "").toUpperCase();
            const explicitSection = String(row.section_name || "").trim().toUpperCase();
            const qId = Number(row.question_id);
            const marks = Number(row.marks_obtained || 0);

            if (explicitSection === "CODING" || qType === "CODING") {
                const difficulty = String(codingDifficulty.get(qId) || "");
                if (difficulty.includes("easy")) {
                    agg.coding_easy_marks += marks;
                } else if (difficulty.includes("medium") || difficulty.includes("intermediate")) {
                    agg.coding_medium_marks += marks;
                } else {
                    agg.coding_hard_marks += marks;
                }
            } else if (explicitSection === "TECHNICAL" || qType === "DESCRIPTIVE") {
                agg.technical_marks += marks;
            } else if (qType === "MCQ") {
                if (explicitSection === "APTITUDE") {
                    agg.aptitude_marks += marks;
                } else if (explicitSection === "TECHNICAL") {
                    agg.technical_marks += marks;
                } else if (aptitudeQuestionIds.has(qId) && !streamQuestionIds.has(qId)) {
                    agg.aptitude_marks += marks;
                } else if (streamQuestionIds.has(qId)) {
                    agg.technical_marks += marks;
                }
            }
        }

        const upsertSql = `
            INSERT INTO walkin_final_results
            (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (student_id, exam_id) DO UPDATE SET
              aptitude_marks = EXCLUDED.aptitude_marks,
              technical_marks = EXCLUDED.technical_marks,
              coding_easy_marks = EXCLUDED.coding_easy_marks,
              coding_medium_marks = EXCLUDED.coding_medium_marks,
              coding_hard_marks = EXCLUDED.coding_hard_marks,
              total_marks = EXCLUDED.total_marks
        `;

        const upserted = [];
        for (const aggregate of aggregates.values()) {
            const aptitude = Number(aggregate.aptitude_marks.toFixed(2));
            const technical = Number(aggregate.technical_marks.toFixed(2));
            const codingEasy = Number(aggregate.coding_easy_marks.toFixed(2));
            const codingMedium = Number(aggregate.coding_medium_marks.toFixed(2));
            const codingHard = Number(aggregate.coding_hard_marks.toFixed(2));
            const total = Number((aptitude + technical + codingEasy + codingMedium + codingHard).toFixed(2));

            await queryAsync(upsertSql, [
                aggregate.student_id,
                aggregate.exam_id,
                aptitude,
                technical,
                codingEasy,
                codingMedium,
                codingHard,
                total
            ]);

            upserted.push({
                student_id: aggregate.student_id,
                exam_id: aggregate.exam_id,
                aptitude_marks: aptitude,
                technical_marks: technical,
                coding_easy_marks: codingEasy,
                coding_medium_marks: codingMedium,
                coding_hard_marks: codingHard,
                total_marks: total
            });
        }

        return res.json({
            success: true,
            recomputed_count: upserted.length,
            rows: upserted
        });
    } catch (error) {
        console.error("Walk-in recompute error:", error);
        return res.status(500).json({ success: false, message: "Could not recompute walk-in final results" });
    }
});

router.post("/walkin/final-results/fill-summaries", async (req, res) => {
    const { studentId = null, examId = null, collegeId = null, limit = 200 } = req.body || {};
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));

    const parseTestcaseCount = (payload) => {
        if (!payload) return 0;
        try {
            const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
            return Array.isArray(parsed) ? Math.min(parsed.length, 5) : 0;
        } catch {
            return 0;
        }
    };

    try {
        await ensureWalkinAnswerSectionColumn();
        const targets = await queryAsync(
            `
            SELECT wfr.student_id, wfr.exam_id
            FROM walkin_final_results wfr
            JOIN students s ON s.student_id = wfr.student_id
            WHERE (?::BIGINT IS NULL OR wfr.student_id = ?::BIGINT)
              AND (?::BIGINT IS NULL OR wfr.exam_id = ?::BIGINT)
              AND (?::BIGINT IS NULL OR s.college_id = ?::BIGINT)
              AND (wfr.performance_summary IS NULL OR TRIM(wfr.performance_summary) = '')
            ORDER BY wfr.result_id DESC
            LIMIT ?
            `,
            [studentId, studentId, examId, examId, collegeId, collegeId, safeLimit]
        );

        if (!targets.length) {
            return res.json({ success: true, updated: 0, skipped: 0, failed: 0, rows: [] });
        }

        const results = [];
        for (const target of targets) {
            const sid = Number(target.student_id);
            const eid = Number(target.exam_id);
            try {
                const studentRows = await queryAsync(
                    `SELECT student_id, name, course FROM students WHERE student_id = ? LIMIT 1`,
                    [sid]
                );
                const student = studentRows?.[0] || { student_id: sid, name: "Student", course: "" };

                const answerRows = await queryAsync(
                    `
                    SELECT
                        wsa.submission_id,
                        COALESCE(wsa.section_name, '') AS section_name,
                        UPPER(COALESCE(wsa.question_type::text, '')) AS question_type,
                        wsa.question_id,
                        COALESCE(wsa.marks_obtained, 0) AS marks_obtained,
                        COALESCE(wsa.testcases_passed, 0) AS testcases_passed,
                        wa.question_id AS aptitude_qid,
                        wc.question_id AS coding_qid,
                        COALESCE(wa.marks, ws.marks, wc.marks, 0) AS full_marks,
                        LOWER(COALESCE(wc.difficulty, '')) AS coding_difficulty,
                        wc.testcases AS coding_testcases
                    FROM walkin_student_answers wsa
                    JOIN (
                        SELECT MAX(submission_id) AS submission_id
                        FROM walkin_student_answers
                        WHERE student_id = ?
                          AND exam_id = ?
                        GROUP BY question_id, UPPER(COALESCE(question_type::text, '')), UPPER(COALESCE(section_name, ''))
                    ) latest ON latest.submission_id = wsa.submission_id
                    LEFT JOIN walkin_aptitude_questions wa
                        ON wa.question_id = wsa.question_id
                       AND UPPER(COALESCE(wsa.section_name, '')) = 'APTITUDE'
                    LEFT JOIN walkin_stream_questions ws
                        ON ws.question_id = wsa.question_id
                       AND UPPER(COALESCE(wsa.section_name, '')) = 'TECHNICAL'
                    LEFT JOIN walkin_coding_questions wc
                        ON wc.question_id = wsa.question_id
                       AND UPPER(COALESCE(wsa.section_name, '')) = 'CODING'
                    WHERE wsa.student_id = ?
                      AND wsa.exam_id = ?
                    ORDER BY wsa.submission_id
                    `,
                    [sid, eid, sid, eid]
                );

                const summaryRows = (answerRows || []).map((row) => {
                    const type = String(row.question_type || "").toUpperCase();
                    const explicitSection = String(row.section_name || "").trim().toUpperCase();
                    const isCoding = explicitSection === "CODING" || type === "CODING" || Boolean(row.coding_qid);
                    const isAptitude = explicitSection === "APTITUDE" || Boolean(row.aptitude_qid);
                    const sectionLabel = isCoding ? "Coding" : isAptitude ? "Aptitude" : "Technical";
                    return {
                        section_label: sectionLabel,
                        question_type: type === "DESCRIPTIVE" ? "Descriptive" : isCoding ? "Coding" : "MCQ",
                        marks_obtained: Number(row.marks_obtained || 0),
                        full_marks: Number(row.full_marks || 0),
                        coding_difficulty: String(row.coding_difficulty || ""),
                        testcases_passed: Number(row.testcases_passed || 0),
                        total_testcases: isCoding ? parseTestcaseCount(row.coding_testcases) : 0
                    };
                });

                const summaryPayload = await generateWalkinPerformanceSummary(student, summaryRows);
                const summary = String(summaryPayload?.summary || "").trim();
                if (!summary) {
                    results.push({ student_id: sid, exam_id: eid, status: "skipped", reason: "empty_summary" });
                    continue;
                }

                await queryAsync(
                    `
                    UPDATE walkin_final_results
                    SET performance_summary = ?
                    WHERE student_id = ? AND exam_id = ?
                    `,
                    [summary, sid, eid]
                );
                results.push({ student_id: sid, exam_id: eid, status: "updated" });
            } catch (rowError) {
                results.push({
                    student_id: sid,
                    exam_id: eid,
                    status: "failed",
                    reason: String(rowError?.message || rowError)
                });
            }
        }

        return res.json({
            success: true,
            updated: results.filter((item) => item.status === "updated").length,
            skipped: results.filter((item) => item.status === "skipped").length,
            failed: results.filter((item) => item.status === "failed").length,
            rows: results
        });
    } catch (error) {
        console.error("Walk-in summary backfill error:", error);
        return res.status(500).json({ success: false, message: "Could not fill walk-in summaries" });
    }
});

router.get("/walkin/review/:collegeId/:studentId/:examId", async (req, res) => {
    const { collegeId, studentId, examId } = req.params;
    try {
        await ensureWalkinAnswerSectionColumn();
        const studentRows = await queryAsync(
            `
            SELECT student_id, name, course
            FROM students
            WHERE student_id = ?
              AND college_id = ?
              AND student_type = 'WALK_IN'
            LIMIT 1
        `,
            [studentId, collegeId]
        );

        if (!studentRows.length) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        const answers = await queryAsync(
            `
            SELECT
                wsa.submission_id,
                wsa.student_id,
                wsa.exam_id,
                wsa.question_id,
                COALESCE(wsa.section_name, '') AS section_name,
                wsa.question_type,
                wsa.selected_option,
                wsa.descriptive_answer,
                wsa.code,
                wsa.testcases_passed,
                COALESCE(wsa.marks_obtained, 0) AS marks_obtained,
                COALESCE(wc.question_text, ws.question_text, wa.question_text, q.question_text) AS question_text,
                COALESCE(ws.option_a, wa.option_a, q.option_a) AS option_a,
                COALESCE(ws.option_b, wa.option_b, q.option_b) AS option_b,
                COALESCE(ws.option_c, wa.option_c, q.option_c) AS option_c,
                COALESCE(ws.option_d, wa.option_d, q.option_d) AS option_d,
                COALESCE(ws.correct_option, wa.correct_option, q.correct_answer) AS correct_option,
                ws.descriptive_answer AS reference_descriptive_answer,
                COALESCE(
                    wc.marks,
                    ws.marks,
                    wa.marks,
                    0
                ) AS full_marks,
                COALESCE(
                    CASE
                        WHEN wc.question_id IS NOT NULL THEN jsonb_array_length(COALESCE(wc.testcases, '[]'::jsonb))
                        ELSE NULL
                    END,
                    0
                ) AS total_testcases,
                wc.difficulty AS coding_difficulty,
                CASE
                    WHEN UPPER(COALESCE(wsa.section_name, '')) = 'APTITUDE' THEN 'Aptitude'
                    WHEN UPPER(COALESCE(wsa.section_name, '')) = 'TECHNICAL' THEN 'Technical'
                    WHEN UPPER(COALESCE(wsa.section_name, '')) = 'CODING' THEN 'Coding'
                    WHEN wc.question_id IS NOT NULL THEN 'Coding'
                    WHEN ws.question_id IS NOT NULL THEN 'Technical'
                    WHEN wa.question_id IS NOT NULL THEN 'Aptitude'
                    WHEN LOWER(COALESCE(q.question_type::text, '')) = 'coding' THEN 'Coding'
                    WHEN LOWER(COALESCE(q.section_name::text, '')) LIKE '%aptitude%' THEN 'Aptitude'
                    WHEN q.question_id IS NOT NULL THEN 'Technical'
                    ELSE 'Unknown'
                END AS section_label
            FROM walkin_student_answers wsa
            JOIN (
                SELECT MAX(submission_id) AS submission_id
                FROM walkin_student_answers
                WHERE student_id = ?
                  AND exam_id = ?
                GROUP BY UPPER(COALESCE(section_name, '')), UPPER(COALESCE(question_type::text, '')), question_id
            ) latest ON latest.submission_id = wsa.submission_id
            LEFT JOIN walkin_aptitude_questions wa
                ON wa.question_id = wsa.question_id
               AND (
                    UPPER(COALESCE(wsa.section_name, '')) = 'APTITUDE'
                    OR UPPER(COALESCE(wsa.section_name, '')) = ''
               )
            LEFT JOIN walkin_stream_questions ws
                ON ws.question_id = wsa.question_id
               AND (
                    UPPER(COALESCE(wsa.section_name, '')) = 'TECHNICAL'
                    OR UPPER(COALESCE(wsa.section_name, '')) = ''
               )
            LEFT JOIN walkin_coding_questions wc
                ON wc.question_id = wsa.question_id
               AND (
                    UPPER(COALESCE(wsa.section_name, '')) = 'CODING'
                    OR UPPER(COALESCE(wsa.question_type::text, '')) = 'CODING'
               )
            LEFT JOIN questions q
                ON q.question_id = wsa.question_id
            ORDER BY
                CASE
                    WHEN wa.question_id IS NOT NULL THEN 1
                    WHEN ws.question_id IS NOT NULL THEN 2
                    WHEN wc.question_id IS NOT NULL THEN 3
                    ELSE 4
                END,
                wsa.question_id
        `,
            [studentId, examId]
        );

        const normalizedAnswers = (answers || []).map((row) => ({
            ...row,
            question_text: row.question_text || "Question text unavailable",
            section_label: row.section_label || "Unknown"
        }));
        let performanceSummary = "";
        try {
            const summaryRows = await queryAsync(
                `
                SELECT performance_summary
                FROM walkin_final_results
                WHERE student_id = ?
                  AND exam_id = ?
                LIMIT 1
                `,
                [studentId, examId]
            );
            performanceSummary = String(summaryRows?.[0]?.performance_summary || "");
        } catch (summaryError) {
            const msg = String(summaryError?.message || "");
            if (!/unknown column.*performance_summary/i.test(msg)) {
                console.warn("Walk-in review summary read failed:", msg);
            }
        }

        return res.json({
            success: true,
            student: studentRows[0],
            exam_id: Number(examId),
            answers: normalizedAnswers,
            performance_summary: performanceSummary,
            performance_summary_meta: null
        });
    } catch (error) {
        console.error("Walk-in review error:", error);
        return res.status(500).json({ success: false, message: "Could not load walk-in answer review" });
    }
});
/* ================= WALK-IN STUDENT CREATION ================= */
router.post("/students/walkin", (req, res) => {
    const { name, email, phone, dob, course, collegeId: payloadCollegeId } = req.body;
    const collegeId = String(payloadCollegeId || "").trim();
    const streamCode = getCanonicalWalkinStreamCode(course);
    const streamLabel = streamCode ? getWalkinStreamLabel(streamCode) : "";

    if (!name || !email || !phone || !dob || !course) {
        return res.status(400).json({ success: false, message: "Missing required walk-in details" });
    }
    if (!isAtLeastAge(String(dob || "").trim(), 18)) {
        return res.status(400).json({ success: false, message: "Student must be at least 18 years old." });
    }

    if (!streamCode) {
        return res.status(400).json({ success: false, message: "Invalid walk-in stream. Use DS, DA, or MERN." });
    }

    if (!collegeId) {
        return res.status(400).json({ success: false, message: "College is required" });
    }

    db.query(
        `SELECT student_id FROM students WHERE email_id = ?`,
        [email],
        (err, rows) => {
            if (err) {
                console.error("Walk-in lookup error:", err);
                return res.status(500).json({ success: false, message: "Server error" });
            }

            if (rows.length > 0) {
                return res.status(400).json({ success: false, message: "Email already registered" });
            }

            db.query(
                `
                SELECT walkin_exam_id
                FROM walkin_exams
                WHERE stream_code = ?
                  AND (exam_status = 'READY' OR exam_status IS NULL)
                LIMIT 1
                `,
                [streamCode],
                (examLookupErr, examRows) => {
                    if (examLookupErr) {
                        console.error("Walk-in exam lookup error:", examLookupErr);
                        return res.status(500).json({ success: false, message: "Could not map walk-in exam" });
                    }
                    const createStudentWithWalkinExam = (walkinExamId) => {
                        db.query(
                            `
                INSERT INTO students
                (name, email_id, contact_number, dob, course, college_id, student_type, walkin_exam_id)
                VALUES (?, ?, ?, ?, ?, ?, 'WALK_IN', ?)
                RETURNING student_id
                `,
                            [name.trim(), email.trim(), phone.trim(), dob, streamLabel, collegeId, walkinExamId],
                            (err2, result) => {
                    if (err2) {
                        console.error("Walk-in insert error:", err2);
                        return res.status(500).json({ success: false, message: "Could not create walk-in student" });
                    }

                    const newStudentId = result?.insertId;
                    const normalizedName = String(name || "")
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z]/g, "");
                    const namePrefix = normalizedName.slice(0, 4) || "user";
                    const dobRaw = String(dob || "").trim();
                    let dayMonth = "0000";
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
                        const [, month, day] = dobRaw.split("-");
                        dayMonth = `${day}${month}`;
                    } else if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(dobRaw)) {
                        const [day, month] = dobRaw.split(/[/-]/);
                        dayMonth = `${day}${month}`;
                    } else {
                        const parsedDob = new Date(dobRaw);
                        if (!Number.isNaN(parsedDob.getTime())) {
                            const day = String(parsedDob.getDate()).padStart(2, "0");
                            const month = String(parsedDob.getMonth() + 1).padStart(2, "0");
                            dayMonth = `${day}${month}`;
                        }
                    }
                    const autoPassword = `${namePrefix}${dayMonth}`;

                    db.query(
                        `
                        INSERT INTO student_credentials
                        (student_id, password, role_id)
                        VALUES (?, ?, 1)
                        ON CONFLICT (student_id) DO UPDATE
                        SET password = EXCLUDED.password
                        `,
                        [newStudentId, autoPassword],
                        (err3) => {
                            if (err3) {
                                console.error("Walk-in credentials insert error:", err3);
                                return res.status(500).json({ success: false, message: "Could not generate walk-in credentials" });
                            }

                            res.json({
                                success: true,
                                credentials: {
                                    studentId: newStudentId,
                                    email: email.trim(),
                                    password: autoPassword
                                }
                            });
                        }
                    );
                            }
                        );
                    };

                    if (examRows && examRows.length > 0) {
                        return createStudentWithWalkinExam(Number(examRows[0].walkin_exam_id));
                    }

                    // If no READY walk-in exam exists for this stream, create one on demand.
                    db.query(
                        `
                        INSERT INTO walkin_exams (stream, stream_code, exam_status)
                        VALUES (?, ?, 'READY')
                        RETURNING walkin_exam_id
                        `,
                        [streamLabel, streamCode],
                        (createExamErr, createExamResult) => {
                            if (createExamErr) {
                                console.error("Walk-in exam auto-create error:", createExamErr);
                                return res.status(500).json({
                                    success: false,
                                    message: "Could not auto-create walk-in exam for this stream"
                                });
                            }

                            const createdWalkinExamId = Number(createExamResult?.insertId || 0);
                            if (!createdWalkinExamId) {
                                return res.status(500).json({
                                    success: false,
                                    message: "Could not resolve created walk-in exam id"
                                });
                            }

                            return createStudentWithWalkinExam(createdWalkinExamId);
                        }
                    );
                }
            );
        }
    );
});

/* ================= REGULAR STUDENT CREATION ================= */
router.post("/students/regular", (req, res) => {
    const {
        name,
        email,
        phone,
        dob,
        course,
        collegeId: payloadCollegeId,
        password
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanDob = String(dob || "").trim();
    const cleanCourse = String(course || "").trim();
    const cleanPassword = String(password || "");
    const selectedCollegeId = String(payloadCollegeId || "").trim();

    if (!cleanName || !cleanEmail || !cleanPhone || !cleanDob || !cleanCourse || !selectedCollegeId || !cleanPassword) {
        return res.status(400).json({ success: false, message: "Missing required regular student details" });
    }
    if (!isAtLeastAge(cleanDob, 18)) {
        return res.status(400).json({ success: false, message: "Student must be at least 18 years old." });
    }

    db.query(
        `SELECT student_id FROM students WHERE email_id = ?`,
        [cleanEmail],
        (err, rows) => {
            if (err) {
                console.error("Regular student lookup error:", err);
                return res.status(500).json({ success: false, message: "Server error" });
            }

            if (rows.length > 0) {
                return res.status(400).json({ success: false, message: "Email already registered" });
            }

            db.query(
                `
                INSERT INTO students
                (name, email_id, contact_number, dob, course, college_id, student_type)
                VALUES (?, ?, ?, ?, ?, ?, 'REGULAR')
                RETURNING student_id
                `,
                [cleanName, cleanEmail, cleanPhone, cleanDob, cleanCourse, selectedCollegeId],
                (err2, result) => {
                    if (err2) {
                        console.error("Regular student insert error:", err2);
                        return res.status(500).json({ success: false, message: "Could not create regular student" });
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
                                console.error("Regular credentials error:", err3);
                                return res.status(500).json({ success: false, message: "Could not save credentials" });
                            }

                            res.json({
                                success: true,
                                credentials: { studentId: newStudentId }
                            });
                        }
                    );
                }
            );
        }
    );
});

/* ================= ADMIN EXAMS ================= */
router.get("/exams", (req, res) => {
    db.query(
        `
        SELECT exam_id, course, exam_status, start_at, end_at, cutoff, duration_minutes, question_count
        FROM exams
        ORDER BY exam_id DESC
        `,
        (err, rows) => {
            if (err) {
                console.error("Load exams error:", err);
                return res.json([]);
            }
            res.json(rows || []);
        }
    );
});

router.get("/exams/:eventId", (req, res) => {
    db.query(
        `
        SELECT exam_id, course, exam_status, start_at, end_at, cutoff, duration_minutes, question_count
        FROM exams
        ORDER BY exam_id DESC
        `,
        (err, rows) => {
            if (err) {
                console.error("Load exams error:", err);
                return res.json([]);
            }
            res.json(rows || []);
        }
    );
});

/* ================= CREATE EXAM ================= */
router.post("/exam", (req, res) => {
    const { course, stream, startDate, startTime, cutoff, durationMinutes, questionCount } = req.body;
    if (stream && String(stream).trim()) {
        return res.json({
            success: false,
            message: "Walk-in exams are fixed. No exam creation needed; just create the student account."
        });
    }

    const payloadValue = String(course || "").trim();
    if (!payloadValue) {
        return res.status(400).json({ success: false, message: "Course or stream is required" });
    }
    if (!startDate || !startTime) {
        return res.status(400).json({ success: false, message: "Start date/time is required" });
    }
    if (!TWENTY_FOUR_HOUR_TIME_RE.test(String(startTime).trim())) {
        return res.status(400).json({ success: false, message: "Start time must be in 24-hour HH:mm format" });
    }
    const cutoffValue =
        cutoff === undefined || cutoff === null || String(cutoff).trim() === ""
            ? null
            : Number(cutoff);
    const durationValue =
        durationMinutes === undefined || durationMinutes === null || String(durationMinutes).trim() === ""
            ? null
            : Number(durationMinutes);
    const questionCountValue = Number(questionCount) || 5;
    if (durationValue !== null && (!Number.isFinite(durationValue) || durationValue <= 0)) {
        return res.status(400).json({ success: false, message: "Duration must be a positive number" });
    }
    if (durationValue === null) {
        return res.status(400).json({ success: false, message: "Duration is required" });
    }
    if (!Number.isFinite(questionCountValue) || questionCountValue <= 0) {
        return res.status(400).json({ success: false, message: "Question count must be a positive number" });
    }
    const startEpoch = parseIstDateTimeToEpoch(startDate, startTime);
    if (!Number.isFinite(startEpoch)) {
        return res.status(400).json({ success: false, message: "Invalid start date/time" });
    }
    const endEpoch = startEpoch + durationValue * 60 * 1000;
    const startAt = toIstMysqlDateTime(startEpoch);
    const endAt = toIstMysqlDateTime(endEpoch);

    db.query(
        `SELECT exam_id FROM exams WHERE LOWER(TRIM(course)) = LOWER(?) LIMIT 1`,
        [payloadValue],
        (lookupErr, examRows) => {
            if (lookupErr) {
                console.error("Create exam lookup error:", lookupErr);
                return res.status(500).json({ success: false, message: "Could not create exam" });
            }

            const onExamReady = async (examId) => {
                if (!isWalkinCourse(payloadValue)) {
                    try {
                        await queryAsync(`DELETE FROM questions WHERE exam_id = ?`, [examId]);
                        const generated = await generateQuestionsForCourse(payloadValue, questionCountValue);
                        const insertSql = `
                            INSERT INTO questions
                            (question_text, option_a, option_b, option_c, option_d, correct_answer, section_name, question_type, exam_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;
                        for (const q of generated) {
                            await queryAsync(insertSql, [
                                q.question_text,
                                q.option_a,
                                q.option_b,
                                q.option_c,
                                q.option_d,
                                q.correct_answer,
                                q.section_name || "General",
                                q.question_type || "MCQ",
                                examId
                            ]);
                        }
                        return res.json({ success: true, examId });
                    } catch (generationErr) {
                        console.error("Exam generation error:", generationErr);
                        return res.status(500).json({ success: false, message: "Could not generate questions" });
                    }
                }
                seedWalkinExamQuestions(examId, payloadValue)
                    .then(() => res.json({ success: true, examId }))
                    .catch((seedErr) => {
                        console.error("Walk-in question seed error:", seedErr);
                        res.status(500).json({ success: false, message: "Could not seed walk-in questions" });
                    });
            };

            if (examRows && examRows.length > 0) {
                const examId = examRows[0].exam_id;
                db.query(
                    `UPDATE exams
                     SET exam_status = 'READY',
                         course = ?,
                         start_at = ?,
                         end_at = ?,
                         cutoff = ?,
                         duration_minutes = ?,
                         question_count = ?
                     WHERE exam_id = ?`,
                    [payloadValue, startAt, endAt, cutoffValue, durationValue, questionCountValue, examId],
                    (updateErr) => {
                        if (updateErr) {
                            console.error("Update exam error:", updateErr);
                            return res.status(500).json({ success: false, message: "Could not create exam" });
                        }
                        return onExamReady(examId);
                    }
                );
                return;
            }

            db.query(
                `INSERT INTO exams (course, exam_status, start_at, end_at, cutoff, duration_minutes, question_count)
                 VALUES (?, 'READY', ?, ?, ?, ?, ?)
                 RETURNING exam_id`,
                [payloadValue, startAt, endAt, cutoffValue, durationValue, questionCountValue],
                (insertErr, result) => {
                    if (insertErr) {
                        console.error("Create exam error:", insertErr);
                        return res.status(500).json({
                            success: false,
                            message: "Exam insert failed. If exams.event_id is mandatory, make it nullable/defaulted in DB."
                        });
                    }
                    return onExamReady(result?.insertId);
                }
            );
        }
    );
});

/* ================= DELETE EXAM ================= */
router.delete("/exam/:examId", (req, res) => {
    const examId = req.params.examId;

    db.query(`DELETE FROM questions WHERE exam_id = ?`, [examId], err => {
        if (err) {
            console.error("âŒ Delete questions error:", err);
            return res.json({ success: false });
        }

        db.query(`DELETE FROM exams WHERE exam_id = ?`, [examId], err2 => {
            if (err2) {
                console.error("âŒ Delete exam error:", err2);
                return res.json({ success: false });
            }
            res.json({ success: true });
        });
    });
});

/* ================= GENERATE QUESTIONS ================= */
router.post("/generate-questions/:examId", async (req, res) => {
    const examId = req.params.examId;
    const requestedQuestionCount = Number(req.body.questionCount) || 0;

    db.query(
        `
        SELECT e.course, e.exam_status, e.question_count
        FROM exams e
        WHERE e.exam_id = ?
        `,
        [examId],
        async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return res.json({ success: false, message: "Exam not found" });
            }
            const configuredCount = Number(rows[0].question_count) || 5;
            const questionCount = requestedQuestionCount > 0 ? requestedQuestionCount : configuredCount;

            const sourceValue = String(rows[0].course || "").trim();
            const isWalkinEvent = isWalkinCourse(sourceValue);
            let walkinPreset = [];
            if (isWalkinEvent) {
                try {
                    walkinPreset = await loadWalkinQuestionSet(sourceValue);
                } catch (loadErr) {
                    console.error("Walk-in question load error:", loadErr);
                    return res.json({ success: false, message: "Walk-in question bank is not configured" });
                }
            }

            if (isWalkinEvent && walkinPreset.length === 0) {
                return res.json({
                    success: false,
                    message: "This walk-in stream has no predefined question set."
                });
            }

            if (!sourceValue) {
                return res.json({
                    success: false,
                    message: "Missing course/stream for question generation"
                });
            }

            try {
                if (!isWalkinEvent) {
                    await queryAsync(`DELETE FROM questions WHERE exam_id = ?`, [examId]);
                    const questions = await generateQuestionsForCourse(sourceValue, questionCount);

                    const insertSql = `
                        INSERT INTO questions
                        (question_text, option_a, option_b, option_c, option_d, correct_answer, section_name, question_type, exam_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    for (const q of questions) {
                        await new Promise((resolve, reject) => {
                            db.query(
                                insertSql,
                                [
                                    q.question_text,
                                    q.option_a,
                                    q.option_b,
                                    q.option_c,
                                    q.option_d,
                                    q.correct_answer,
                                    q.section_name || "General",
                                    q.question_type || "MCQ",
                                    examId
                                ],
                                err => (err ? reject(err) : resolve())
                            );
                        });
                    }
                }

                db.query(
                    `UPDATE exams SET exam_status = 'READY' WHERE exam_id = ?`,
                    [examId],
                    err2 => {
                        if (err2) {
                            console.error("Exam status update error:", err2);
                            return res.json({ success: false });
                        }
                        res.json({ success: true });
                    }
                );
            } catch (error) {
                console.error("Question generation error:", error);
                res.status(500).json({ success: false, message: "Question generation failed" });
            }
        }
    );
});


/* ================= WALK-IN QUESTION SHEET ================= */
router.get("/walkin/questions", async (req, res) => {
    try {
        const aptitude = await queryAsync(`
            SELECT question_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks
            FROM walkin_aptitude_questions
            ORDER BY question_id
        `);

        const streamRows = await queryAsync(`
            SELECT question_id, stream, section_name, question_type, question_text, option_a, option_b, option_c, option_d, correct_option, descriptive_answer, marks
            FROM walkin_stream_questions
            ORDER BY question_id
        `);

        const coding = await queryAsync(`
            SELECT question_id, question_text, marks
            FROM walkin_coding_questions
            ORDER BY question_id
        `);

        const streams = {};
        WALKIN_STREAMS.forEach((stream) => {
            const streamCode = getWalkinStreamCodeOrDefault(stream);
            streams[stream] = streamRows
                .filter((row) => getWalkinStreamCodeOrDefault(row.stream) === streamCode)
                .map((row) => ({
                    question_id: row.question_id,
                    section_name: row.section_name,
                    question_type: row.question_type,
                    question_text: row.question_text,
                    option_a: row.option_a,
                    option_b: row.option_b,
                    option_c: row.option_c,
                    option_d: row.option_d,
                    correct_option: row.correct_option,
                    descriptive_answer: row.descriptive_answer,
                    marks: row.marks
                }));
        });

        res.json({ success: true, aptitude, streams, coding });
    } catch (error) {
        console.error("Walk-in question sheet error:", error);
        res.status(500).json({ success: false, message: "Could not load walk-in questions" });
    }
});

module.exports = router;







