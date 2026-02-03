const express = require("express");
const router = express.Router();
const db = require("../db");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

router.use((req, res, next) => {
    if (req.method === "OPTIONS") {
        return next();
    }

    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
});

const CODE_RUNNERS = {
    python: { command: "python", ext: ".py" },
    javascript: { command: "node", ext: ".js" }
};
const TEMP_CODE_DIR = path.join(__dirname, "../tmp-code");

const runCodeWithRunner = async (language, code, input = "") => {
    const runner = CODE_RUNNERS[language];
    if (!runner) {
        throw new Error("Unsupported language");
    }
    await fs.promises.mkdir(TEMP_CODE_DIR, { recursive: true });
    const filename = `code-${Date.now()}-${Math.random().toString(36).slice(2)}${runner.ext}`;
    const filepath = path.join(TEMP_CODE_DIR, filename);
    await fs.promises.writeFile(filepath, code, { encoding: "utf8" });

    return await new Promise((resolve, reject) => {
        const child = spawn(runner.command, [filepath], {
            cwd: TEMP_CODE_DIR,
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"]
        });
        if (input) {
            child.stdin.write(input);
        }
        child.stdin.end();

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timeoutMs = 5000;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            fs.promises.unlink(filepath).catch(() => {});
            reject(err);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            fs.promises.unlink(filepath).catch(() => {});
            resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                timedOut,
                exitCode: code
            });
        });
    });
};

/* ================= CHECK ATTEMPT ================= */
router.get("/attempted/:studentId/:examId", (req, res) => {
    if (String(req.params.studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    db.query(
        `SELECT result_id FROM results WHERE student_id = ? AND exam_id = ?`,
        [req.params.studentId, req.params.examId],
        (err, rows) => {
            if (err) return res.json({ attempted: false });
            res.json({ attempted: rows.length > 0 });
        }
    );
});

/* ================= FETCH QUESTIONS ================= */
router.get("/questions/:examId", (req, res) => {
    db.query(
        `
        SELECT 
            question_id,
            question_text,
            option_a,
            option_b,
            option_c,
            option_d,
            section_name,
            question_type
        FROM questions
        WHERE exam_id = ?
        ORDER BY question_id
        `,
        [req.params.examId],
        (err, rows) => {
            if (err) return res.json([]);
            res.json(rows);
        }
    );
});

router.post("/run-code", async (req, res) => {
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { language, code, input } = req.body || {};
    if (!language || !code) {
        return res.status(400).json({ success: false, message: "Missing language or code" });
    }

    try {
        const result = await runCodeWithRunner(language, code, input);
        return res.json({
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
            exitCode: result.exitCode
        });
    } catch (err) {
        console.error("Code runner error:", err);
        return res.status(500).json({ success: false, message: err.message || "Execution failed" });
    }
});

/* ================= SUBMIT EXAM ================= */
router.post("/submit", (req, res) => {
    const { studentId, examId, answers } = req.body;

    if (!answers || answers.length === 0) {
        return res.json({ success: false });
    }

    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    db.query(
        `SELECT result_id FROM results WHERE student_id = ? AND exam_id = ?`,
        [studentId, examId],
        (err, rows) => {
            if (rows && rows.length > 0) {
                return res.json({ success: false });
            }

            const sql = `
                INSERT INTO student_answers
                (student_id, question_id, selected_option, exam_id)
                VALUES (?, ?, ?, ?)
            `;

            answers.forEach(a => {
                db.query(sql, [
                    studentId,
                    a.question_id,
                    a.selected_option,
                    examId
                ]);
            });

            db.query(
                `INSERT INTO results (student_id, exam_id, attempt_status)
                 VALUES (?, ?, 'SUBMITTED')`,
                [studentId, examId],
                () => res.json({
                    success: true,
                    message: "Exam submitted successfully"
                })
            );
            db.query(
                `
                INSERT INTO student_event_attempts (student_id, event_id)
                SELECT ?, event_id
                FROM exams
                WHERE exam_id = ?
                ON DUPLICATE KEY UPDATE attempted_at = CURRENT_TIMESTAMP
                `,
                [studentId, examId],
                err3 => {
                    if (err3) {
                        console.error("Event attempt mark error:", err3);
                    }
                }
            );
        }
    );
});

/* ================= EXAM RESULT ================= */
router.post("/result", (req, res) => {
    const { studentId, examId } = req.body;

    if (!studentId || !examId) {
        return res.json({ success: false, message: "Missing student or exam" });
    }

    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    db.query(
        `SELECT COUNT(*) AS total FROM questions WHERE exam_id = ?`,
        [examId],
        (err, totalRows) => {
            if (err) {
                console.error("Result total error:", err);
                return res.json({ success: false, message: "Server error" });
            }

            const total = totalRows?.[0]?.total || 0;
            if (total === 0) {
                return res.json({ success: false, message: "No questions found" });
            }

            db.query(
                `
                SELECT COUNT(*) AS correct
                FROM student_answers sa
                JOIN questions q ON sa.question_id = q.question_id
                WHERE sa.student_id = ? AND sa.exam_id = ? AND sa.selected_option = q.correct_answer
                `,
                [studentId, examId],
                (err2, correctRows) => {
                    if (err2) {
                        console.error("Result correct error:", err2);
                        return res.json({ success: false, message: "Server error" });
                    }

                    const correct = correctRows?.[0]?.correct || 0;

                    db.query(
                        `
                        SELECT ev.cutoff_percentage
                        FROM exams e
                        JOIN exam_event ev ON ev.event_id = e.event_id
                        WHERE e.exam_id = ?
                        `,
                        [examId],
                        (err3, cutoffRows) => {
                            if (err3) {
                                console.error("Result cutoff error:", err3);
                                return res.json({ success: false, message: "Server error" });
                            }

                            const cutoff = Number(cutoffRows?.[0]?.cutoff_percentage || 0);
                            const scorePercent = total > 0 ? (correct / total) * 100 : 0;
                            const resultStatus = scorePercent >= cutoff ? "PASS" : "FAIL";

                            res.json({
                                success: true,
                                totalMarks: `${correct}/${total}`,
                                resultStatus
                            });
                        }
                    );
                }
            );
        }
    );
});

module.exports = router;
