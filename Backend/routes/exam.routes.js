const express = require("express");
const router = express.Router();
const db = require("../db");
const util = require("util");
const queryAsync = util.promisify(db.query).bind(db);
const { gradeDescriptiveAnswer, generateWalkinPerformanceSummary } = require("../llm");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
    getWalkinStreamCodeOrDefault,
    getWalkinStreamQuestionKey,
    getWalkinStreamLabel
} = require("../utils/walkinStream");

router.use((req, res, next) => {
    if (req.method === "OPTIONS") {
        return next();
    }

    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
});

const JAVA_HOME = process.env.JAVA_HOME;
const MINGW_HOME = process.env.MINGW_HOME;
const GPP_PATH = process.env.GPP_PATH;
const resolveCommand = (...segments) => {
    const resolved = path.join(...segments.filter(Boolean));
    return fs.existsSync(resolved) ? resolved : null;
};
const javacCommand = resolveCommand(JAVA_HOME, "bin", "javac") || "javac";
const javaCommand = resolveCommand(JAVA_HOME, "bin", "java") || "java";
const gppCommand =
    GPP_PATH ||
    resolveCommand(MINGW_HOME, "bin", "g++.exe") ||
    resolveCommand(MINGW_HOME, "mingw64", "bin", "g++.exe") ||
    resolveCommand("C:\\ProgramData\\mingw64\\mingw64\\bin", "g++.exe") ||
    resolveCommand("C:\\ProgramData\\mingw64\\mingw32\\bin", "g++.exe") ||
    "g++";
const cppExeExt = process.platform === "win32" ? ".exe" : "";
const MAX_CODING_TESTCASES = 5;
let walkinSummaryColumnChecked = false;
let walkinAttemptedAtColumnChecked = false;
let regularStudentExamTableChecked = false;
let walkinAnswerSectionColumnChecked = false;
const normalizeWalkinStream = (value) => getWalkinStreamCodeOrDefault(value);
const getWalkinStreamDbLabel = (value) => getWalkinStreamLabel(value);
const getWalkinDurationMinutes = (streamCode) => {
    if (streamCode === "DS") return 60;
    if (streamCode === "DA") return 50;
    return 80; // MERN default
};
const getDescriptiveWordLimit = (questionId) => {
    const id = Number(questionId || 0);
    if (id >= 1 && id <= 20) return 40;
    if (id >= 39 && id <= 44) return 40;
    if (id >= 21 && id <= 30) return 15;
    if (id >= 31 && id <= 38) return 25;
    return null;
};
const countWords = (text) =>
    String(text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

const CODE_RUNNERS = {
    python: {
        ext: ".py",
        exec: { command: "python", args: ["{{file}}"] }
    },
    javascript: {
        ext: ".js",
        exec: { command: "node", args: ["{{file}}"] }
    },
    java: {
        ext: ".java",
        exec: { command: javaCommand, args: ["-cp", "{{dir}}", "Main"] },
        compile: { command: javacCommand, args: ["{{file}}"] }
    },
    cpp: {
        ext: ".cpp",
        exeExt: cppExeExt,
        exec: { command: "{{exe}}", args: [] },
        compile: { command: gppCommand, args: ["{{file}}", "-o", "{{exe}}"] }
    },
    csharp: {
        ext: ".cs",
        exeExt: ".exe",
        exec: { command: "mono", args: ["{{exe}}"] },
        compile: { command: "mcs", args: ["-out:{{exe}}", "{{file}}"] }
    },
    go: {
        ext: ".go",
        exec: { command: "go", args: ["run", "{{file}}"] }
    }
};

const TEMP_CODE_DIR = path.join(__dirname, "../tmp-code");

const fillArgs = (args = [], ctx) =>
    args.map((arg) =>
        arg
            .replace(/\{\{file\}\}/g, ctx.file)
            .replace(/\{\{dir\}\}/g, ctx.dir)
            .replace(/\{\{exe\}\}/g, ctx.exe)
    );

const ensurePathHas = (envPath, folder) => {
    if (!folder) return envPath || "";
    const delimiter = path.delimiter;
    const parts = String(envPath || "").split(delimiter).filter(Boolean);
    const normalizedFolder = String(folder).toLowerCase();
    const exists = parts.some((entry) => String(entry || "").toLowerCase() === normalizedFolder);
    if (exists) return String(envPath || "");
    return [folder, ...parts].join(delimiter);
};

const spawnProcess = async (command, args, options) => {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, options);
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, 5000);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                timedOut,
                exitCode: code
            });
        });
    });
};

const runCodeWithRunner = async (language, code, input = "") => {
    const runner = CODE_RUNNERS[language];
    if (!runner) {
        throw new Error("Unsupported language");
    }
    await fs.promises.mkdir(TEMP_CODE_DIR, { recursive: true });
    const id = `code-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const filepath = path.join(TEMP_CODE_DIR, `${id}${runner.ext}`);
    const exePath = runner.exeExt
        ? path.join(TEMP_CODE_DIR, `${id}${runner.exeExt}`)
        : path.join(TEMP_CODE_DIR, id);
    await fs.promises.writeFile(filepath, code, { encoding: "utf8" });

    const ctx = { file: filepath, dir: TEMP_CODE_DIR, exe: exePath };
    const runnerEnv = { ...process.env };
    if (language === "cpp") {
        const mingwBin =
            (path.isAbsolute(gppCommand) ? path.dirname(gppCommand) : null) ||
            resolveCommand(MINGW_HOME, "bin") ||
            resolveCommand("C:\\ProgramData\\mingw64\\mingw64\\bin") ||
            resolveCommand("C:\\ProgramData\\mingw64\\mingw32\\bin");
        if (mingwBin) {
            runnerEnv.PATH = ensurePathHas(runnerEnv.PATH, mingwBin);
        }
    }

    if (runner.compile) {
        const compileArgs = fillArgs(runner.compile.args, ctx);
        try {
            const compileResult = await spawnProcess(runner.compile.command, compileArgs, {
                cwd: TEMP_CODE_DIR,
                env: runnerEnv,
                stdio: ["pipe", "pipe", "pipe"]
            });
            if (compileResult.timedOut) {
                throw new Error("Compilation timed out");
            }
            if (Number(compileResult.exitCode || 0) !== 0) {
                let compilerMessage = [compileResult.stderr, compileResult.stdout]
                    .filter(Boolean)
                    .join("\n")
                    .trim();
                const compileCmd = `${runner.compile.command} ${compileArgs.join(" ")}`.trim();
                // Some Windows toolchains return non-zero with empty stderr/stdout.
                // Retry once with verbose flag to surface an actionable error.
                if (!compilerMessage) {
                    const verboseResult = await spawnProcess(runner.compile.command, ["-v", ...compileArgs], {
                        cwd: TEMP_CODE_DIR,
                        env: runnerEnv,
                        stdio: ["pipe", "pipe", "pipe"]
                    });
                    compilerMessage = [verboseResult.stderr, verboseResult.stdout]
                        .filter(Boolean)
                        .join("\n")
                        .trim();
                }
                throw new Error(
                    compilerMessage ||
                    `Compilation failed (exit code ${compileResult.exitCode}). Command: ${compileCmd}`
                );
            }
            // For native compiled targets, ensure output binary exists before execution.
            if (runner.exec?.command === "{{exe}}" && !fs.existsSync(exePath)) {
                throw new Error("Compilation failed: executable was not generated");
            }
        } catch (err) {
            if (err.code === "ENOENT") {
                throw new Error(`Compiler not available: ${runner.compile.command}. Ensure the SDK is installed.`);
            }
            throw err;
        }
    }

    const execArgs = fillArgs(runner.exec.args, ctx);
    const execCommand = runner.exec.command.replace(/\{\{exe\}\}/g, ctx.exe);
    return await new Promise((resolve, reject) => {
        const child = spawn(execCommand, execArgs, {
            cwd: TEMP_CODE_DIR,
            env: runnerEnv,
            stdio: ["pipe", "pipe", "pipe"]
        });
        if (input) {
            child.stdin.write(input);
        }
        child.stdin.end();

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, 5000);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            fs.promises.unlink(filepath).catch(() => {});
            if (runner.exeExt) {
                fs.promises.unlink(exePath).catch(() => {});
            }
            if (err.code === "ENOENT") {
                reject(new Error(`Runtime not found: ${execCommand}`));
                return;
            }
            reject(err);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            fs.promises.unlink(filepath).catch(() => {});
            if (runner.exeExt) {
                fs.promises.unlink(exePath).catch(() => {});
            }
            resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                timedOut,
                exitCode: code
            });
        });
    });
};
const ALLOWED_CODING_LANGUAGES = new Set(["python", "javascript", "cpp"]);

const ensureWalkinSummaryColumn = async () => {
    if (walkinSummaryColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_final_results
             ADD COLUMN performance_summary TEXT NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add performance_summary column:", msg);
        }
    } finally {
        walkinSummaryColumnChecked = true;
    }
};

const ensureWalkinAttemptedAtColumn = async () => {
    if (walkinAttemptedAtColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_final_results
             ADD COLUMN attempted_at DATETIME NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add attempted_at column:", msg);
        }
    } finally {
        walkinAttemptedAtColumnChecked = true;
    }
};

const ensureRegularStudentExamTable = async () => {
    if (regularStudentExamTableChecked) return;
    await queryAsync(
        `CREATE TABLE IF NOT EXISTS regular_student_exam (
            student_exam_id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            exam_id INT NOT NULL,
            started_at DATETIME NULL,
            UNIQUE KEY uq_regular_student_exam (student_id, exam_id)
        )`
    );
    try {
        await queryAsync(
            `ALTER TABLE regular_student_exam ADD COLUMN started_at DATETIME NULL`
        );
    } catch (error) {
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            /duplicate column/i.test(String(error?.message || ""));
        if (!duplicateColumn) {
            throw error;
        }
    }
    regularStudentExamTableChecked = true;
};

const ensureWalkinAnswerSectionColumn = async () => {
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
};

const fetchAssignedWalkinExamId = async (studentId) => {
    const rows = await queryAsync(
        `SELECT walkin_exam_id FROM students WHERE student_id = ? LIMIT 1`,
        [studentId]
    );
    return Number(rows?.[0]?.walkin_exam_id || 0) || 0;
};

const parseTestcaseCount = (payload) => {
    if (!payload) return 0;
    try {
        const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
        return Array.isArray(parsed) ? Math.min(parsed.length, MAX_CODING_TESTCASES) : 0;
    } catch {
        return 0;
    }
};

const runWalkinPostSubmitProcessing = async (studentId, examId) => {
    await ensureWalkinSummaryColumn();
    await ensureWalkinAttemptedAtColumn();

    const descriptiveRows = await queryAsync(
        `
        SELECT
            wsa.submission_id,
            wsa.question_id,
            wsa.descriptive_answer,
            ws.descriptive_answer AS reference_answer,
            ws.marks AS full_marks
        FROM walkin_student_answers wsa
        JOIN walkin_stream_questions ws ON ws.question_id = wsa.question_id
        WHERE wsa.student_id = ?
          AND wsa.exam_id = ?
          AND UPPER(COALESCE(wsa.question_type, '')) = 'DESCRIPTIVE'
        `,
        [studentId, examId]
    );

    for (const row of descriptiveRows || []) {
        const marksPossible = Number(row.full_marks || 0);
        const obtained = await gradeDescriptiveAnswer(
            String(row.reference_answer || ""),
            String(row.descriptive_answer || ""),
            marksPossible
        );
        await queryAsync(
            `UPDATE walkin_student_answers SET marks_obtained = ? WHERE submission_id = ?`,
            [Number(obtained || 0), row.submission_id]
        );
    }

    const latestRows = await queryAsync(
        `
        SELECT
            wsa.submission_id,
            wsa.question_id,
            COALESCE(wsa.section_name, '') AS section_name,
            UPPER(COALESCE(wsa.question_type, '')) AS question_type,
            COALESCE(wsa.marks_obtained, 0) AS marks_obtained,
            COALESCE(wsa.testcases_passed, 0) AS testcases_passed,
            wa.question_id AS aptitude_qid,
            ws.question_id AS stream_qid,
            wc.question_id AS coding_qid,
            COALESCE(wa.marks, ws.marks, wc.marks, 0) AS full_marks,
            COALESCE(wa.question_text, ws.question_text, wc.question_text, '') AS question_text,
            LOWER(COALESCE(wc.difficulty, '')) AS coding_difficulty,
            wc.testcases AS coding_testcases
        FROM walkin_student_answers wsa
        JOIN (
            SELECT MAX(submission_id) AS submission_id
            FROM walkin_student_answers
            WHERE student_id = ?
              AND exam_id = ?
            GROUP BY question_id, UPPER(COALESCE(question_type, '')), UPPER(COALESCE(section_name, ''))
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
        [studentId, examId, studentId, examId]
    );

    let aptitudeMarksTotal = 0;
    let technicalMarksTotal = 0;
    let codingEasyMarksTotal = 0;
    let codingMediumMarksTotal = 0;
    let codingHardMarksTotal = 0;
    const walkinSummaryRows = [];

    for (const row of latestRows || []) {
        const questionType = String(row.question_type || "").toUpperCase();
        const explicitSection = String(row.section_name || "").trim().toUpperCase();
        const marks = Number(row.marks_obtained || 0);
        const fullMarks = Number(row.full_marks || 0);
        const isAptitude = explicitSection === "APTITUDE" || Boolean(row.aptitude_qid);
        const isCoding = explicitSection === "CODING" || questionType === "CODING" || Boolean(row.coding_qid);

        let sectionLabel = "Technical";
        if (isCoding) sectionLabel = "Coding";
        else if (isAptitude) sectionLabel = "Aptitude";

        if (isCoding) {
            const difficulty = String(row.coding_difficulty || "");
            if (difficulty.includes("easy")) codingEasyMarksTotal += marks;
            else if (difficulty.includes("medium") || difficulty.includes("intermediate")) codingMediumMarksTotal += marks;
            else codingHardMarksTotal += marks;
        } else if (questionType === "MCQ") {
            if (isAptitude) aptitudeMarksTotal += marks;
            else technicalMarksTotal += marks;
        } else {
            technicalMarksTotal += marks;
        }

        walkinSummaryRows.push({
            section_label: sectionLabel,
            question_type: questionType === "DESCRIPTIVE" ? "Descriptive" : questionType === "CODING" ? "Coding" : "MCQ",
            marks_obtained: marks,
            full_marks: fullMarks,
            coding_difficulty: String(row.coding_difficulty || ""),
            testcases_passed: Number(row.testcases_passed || 0),
            total_testcases: isCoding ? parseTestcaseCount(row.coding_testcases) : 0,
            question_text: String(row.question_text || "")
        });
    }

    const studentProfileRows = await queryAsync(
        `SELECT student_id, name, course FROM students WHERE student_id = ? LIMIT 1`,
        [studentId]
    );
    const studentProfile =
        studentProfileRows[0] || { student_id: studentId, name: "Student", course: "" };
    const summaryPayload = await generateWalkinPerformanceSummary(studentProfile, walkinSummaryRows);
    const performanceSummary = String(summaryPayload?.summary || "");
    const totalMarks = Number(
        (
            Number(aptitudeMarksTotal || 0) +
            Number(technicalMarksTotal || 0) +
            Number(codingEasyMarksTotal || 0) +
            Number(codingMediumMarksTotal || 0) +
            Number(codingHardMarksTotal || 0)
        ).toFixed(2)
    );

    try {
        await queryAsync(
            `INSERT INTO walkin_final_results
            (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks, performance_summary, attempted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              aptitude_marks = VALUES(aptitude_marks),
              technical_marks = VALUES(technical_marks),
              coding_easy_marks = VALUES(coding_easy_marks),
              coding_medium_marks = VALUES(coding_medium_marks),
              coding_hard_marks = VALUES(coding_hard_marks),
              total_marks = VALUES(total_marks),
              performance_summary = VALUES(performance_summary),
              attempted_at = COALESCE(walkin_final_results.attempted_at, VALUES(attempted_at))`,
            [
                studentId,
                examId,
                Number(aptitudeMarksTotal || 0),
                Number(technicalMarksTotal || 0),
                Number(codingEasyMarksTotal || 0),
                Number(codingMediumMarksTotal || 0),
                Number(codingHardMarksTotal || 0),
                totalMarks,
                performanceSummary
            ]
        );
    } catch (insertError) {
        const msg = String(insertError?.message || "");
        if (!/unknown column.*performance_summary/i.test(msg)) {
            throw insertError;
        }
        await queryAsync(
            `INSERT INTO walkin_final_results
            (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks, attempted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              aptitude_marks = VALUES(aptitude_marks),
              technical_marks = VALUES(technical_marks),
              coding_easy_marks = VALUES(coding_easy_marks),
              coding_medium_marks = VALUES(coding_medium_marks),
              coding_hard_marks = VALUES(coding_hard_marks),
              total_marks = VALUES(total_marks),
              attempted_at = COALESCE(walkin_final_results.attempted_at, VALUES(attempted_at))`,
            [
                studentId,
                examId,
                Number(aptitudeMarksTotal || 0),
                Number(technicalMarksTotal || 0),
                Number(codingEasyMarksTotal || 0),
                Number(codingMediumMarksTotal || 0),
                Number(codingHardMarksTotal || 0),
                totalMarks
            ]
        );
    }
};

const buildProvisionalWalkinSummary = (studentName, stream, scores) => {
    const aptitude = Number(scores?.aptitude || 0).toFixed(2);
    const technical = Number(scores?.technical || 0).toFixed(2);
    const codingEasy = Number(scores?.codingEasy || 0).toFixed(2);
    const codingMedium = Number(scores?.codingMedium || 0).toFixed(2);
    const codingHard = Number(scores?.codingHard || 0).toFixed(2);
    const total = Number(scores?.total || 0).toFixed(2);
    return [
        `Performance Summary of ${studentName || "Student"} (${stream || "Walk-In"})`,
        `1. Provisional summary generated at submission time.`,
        `2. Aptitude: ${aptitude}.`,
        `3. Technical: ${technical}.`,
        `4. Coding: Easy ${codingEasy}, Medium ${codingMedium}, Hard ${codingHard}.`,
        `5. Total Marks: ${total}.`,
        `6. Detailed strengths, weaknesses, and suggestions are being prepared.`,
        `7. Final advisory summary will be updated shortly.`,
        `8. Status: Submitted successfully.`
    ].join("\n");
};

/* ================= START EXAM ================= */
router.post("/start", async (req, res) => {
    const studentId = Number(req.body?.studentId || 0);
    const examId = Number(req.body?.examId || 0);

    if (!studentId || !examId) {
        return res.status(400).json({ success: false, message: "Missing student or exam" });
    }
    if (String(studentId) !== String(req.session.student?.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    try {
        const walkinRows = await queryAsync(
            `SELECT walkin_exam_id FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
            [examId]
        );
        if (walkinRows && walkinRows.length > 0) {
            const assignedWalkinExamId = await fetchAssignedWalkinExamId(studentId);
            if (!assignedWalkinExamId || assignedWalkinExamId !== examId) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            req.session.student.walkinExamId = assignedWalkinExamId;
            return res.json({ success: true, studentExamId: null });
        }

        await ensureRegularStudentExamTable();

        let rows = await queryAsync(
            `SELECT student_exam_id
             FROM regular_student_exam
             WHERE student_id = ? AND exam_id = ?
             LIMIT 1`,
            [studentId, examId]
        );

        if (!rows || rows.length === 0) {
            try {
                await queryAsync(
                    `INSERT INTO regular_student_exam (student_id, exam_id) VALUES (?, ?)`,
                    [studentId, examId]
                );
            } catch (insertError) {
                const duplicate = Number(insertError?.errno) === 1062;
                if (!duplicate) throw insertError;
            }
            rows = await queryAsync(
                `SELECT student_exam_id
                 FROM regular_student_exam
                 WHERE student_id = ? AND exam_id = ?
                 LIMIT 1`,
                [studentId, examId]
            );
        }
        await queryAsync(
            `UPDATE regular_student_exam
             SET started_at = COALESCE(started_at, NOW())
             WHERE student_id = ?
               AND exam_id = ?`,
            [studentId, examId]
        );

        return res.json({
            success: true,
            studentExamId: Number(rows?.[0]?.student_exam_id || 0) || null
        });
    } catch (error) {
        console.error("Start exam error:", error);
        return res.status(500).json({ success: false, message: "Could not start exam" });
    }
});

router.get("/duration/:examId", async (req, res) => {
    const examId = Number(req.params.examId || 0);
    if (!examId) {
        return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    try {
        const walkinRows = await queryAsync(
            `SELECT walkin_exam_id, stream FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
            [examId]
        );
        if (walkinRows && walkinRows.length > 0) {
            const streamCode = normalizeWalkinStream(walkinRows?.[0]?.stream);
            return res.json({ success: true, durationMinutes: getWalkinDurationMinutes(streamCode) });
        }
        const rows = await queryAsync(
            `SELECT duration_minutes FROM exams WHERE exam_id = ? LIMIT 1`,
            [examId]
        );
        return res.json({
            success: true,
            durationMinutes: Number(rows?.[0]?.duration_minutes || 0) || null
        });
    } catch (error) {
        console.error("Exam duration lookup error:", error);
        return res.status(500).json({ success: false, message: "Could not load exam duration" });
    }
});

/* ================= CHECK ATTEMPT ================= */
router.get("/attempted/:studentId/:examId", (req, res) => {
    if (String(req.params.studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    db.query(
        `
        SELECT walkin_exam_id
        FROM walkin_exams
        WHERE walkin_exam_id = ?
        LIMIT 1
        `,
        [req.params.examId],
        (walkinErr, walkinRows) => {
            if (walkinErr) return res.json({ attempted: false });
            if (walkinRows && walkinRows.length > 0) {
                return db.query(
                    `SELECT status FROM students WHERE student_id = ? LIMIT 1`,
                    [req.params.studentId],
                    (statusErr, statusRows) => {
                        if (statusErr) return res.json({ attempted: false });
                        const isActive = String(statusRows?.[0]?.status || "").toUpperCase() === "ACTIVE";
                        if (isActive) {
                            return res.json({ attempted: false });
                        }
                        return db.query(
                            `SELECT 1 FROM walkin_final_results WHERE student_id = ? AND exam_id = ? LIMIT 1`,
                            [req.params.studentId, req.params.examId],
                            (err2, rows2) => {
                                if (err2) return res.json({ attempted: false });
                                return res.json({ attempted: rows2.length > 0 });
                            }
                        );
                    }
                );
            }
            db.query(
                `SELECT result_id FROM results WHERE student_id = ? AND exam_id = ?`,
                [req.params.studentId, req.params.examId],
                (err3, rows3) => {
                    if (err3) return res.json({ attempted: false });
                    return res.json({ attempted: rows3.length > 0 });
                }
            );
        }
    );
});

/* ================= FETCH QUESTIONS ================= */
router.get("/questions/:examId", (req, res) => {
    const examIdNum = Number(req.params.examId);
    db.query(
        `
        SELECT walkin_exam_id, stream, exam_status
        FROM walkin_exams
        WHERE walkin_exam_id = ?
        LIMIT 1
        `,
        [examIdNum],
        (walkinErr, walkinExamRows) => {
            if (walkinErr) {
                console.error("Walk-in exam lookup error:", walkinErr);
                return res.json([]);
            }

            if (walkinExamRows && walkinExamRows.length > 0) {
                const walkinExam = walkinExamRows[0];
                const sessionAssignedWalkinExamId = Number(req.session?.student?.walkinExamId || 0);
                const enforceAssignmentAndLoad = (proceed) => {
                    if (sessionAssignedWalkinExamId > 0) {
                        if (sessionAssignedWalkinExamId !== examIdNum) {
                            return res.status(403).json({ success: false, message: "Forbidden" });
                        }
                        return proceed();
                    }
                    db.query(
                        `SELECT walkin_exam_id FROM students WHERE student_id = ? LIMIT 1`,
                        [req.session?.student?.studentId],
                        (mapErr, mapRows) => {
                            if (mapErr) {
                                console.error("Walk-in assignment lookup error:", mapErr);
                                return res.status(500).json({ success: false, message: "Could not verify walk-in assignment" });
                            }
                            const assignedWalkinExamId = Number(mapRows?.[0]?.walkin_exam_id || 0);
                            if (!assignedWalkinExamId || assignedWalkinExamId !== examIdNum) {
                                return res.status(403).json({ success: false, message: "Forbidden" });
                            }
                            if (req.session?.student) {
                                req.session.student.walkinExamId = assignedWalkinExamId;
                            }
                            return proceed();
                        }
                    );
                };
                if (String(walkinExam.exam_status || "READY").toUpperCase() !== "READY") {
                    return res.json([]);
                }
                const runWalkinQuestionQuery = () => {
                    const stream = String(walkinExam.stream || "").trim();
                    const streamCode = normalizeWalkinStream(stream);
                    const includeCoding = streamCode !== "DA";
                    const streamQuestionKey = getWalkinStreamQuestionKey(streamCode);

                    const walkinSql = `
        SELECT question_id, question_text, option_a, option_b, option_c, option_d, section_name,
               question_type, correct_answer, marks, testcases, examples
        FROM (
            SELECT question_id, question_text, option_a, option_b, option_c, option_d,
                   'Aptitude' AS section_name,
                   'MCQ' AS question_type,
                   correct_option AS correct_answer,
                   marks,
                   NULL AS testcases,
                   NULL AS examples,
                   1 AS source_order
            FROM walkin_aptitude_questions
            UNION ALL
            SELECT question_id, question_text, option_a, option_b, option_c, option_d,
                   COALESCE(section_name, 'Technical') AS section_name,
                   CASE
                       WHEN LOWER(question_type) LIKE '%mcq%' THEN 'MCQ'
                       ELSE 'Descriptive'
                   END AS question_type,
                   correct_option AS correct_answer,
                   marks,
                   NULL AS testcases,
                   NULL AS examples,
                   2 AS source_order
            FROM walkin_stream_questions
            WHERE LOWER(REPLACE(TRIM(stream), ' ', '')) = ?
            ${includeCoding ? `
            UNION ALL
            SELECT question_id, question_text, '' AS option_a, '' AS option_b, '' AS option_c, '' AS option_d,
                   'Coding' AS section_name,
                   'Coding' AS question_type,
                   NULL AS correct_answer,
                   marks,
                   testcases,
                   examples,
                   3 AS source_order
            FROM walkin_coding_questions
            ` : ""}
        ) combined
        ORDER BY source_order, question_id
                `;

                    db.query(walkinSql, [streamQuestionKey], (err2, walkinRows) => {
                        if (err2) {
                            console.error("Fetch walk-in questions error:", err2);
                            return res.json([]);
                        }
                        return res.json(Array.isArray(walkinRows) ? walkinRows : []);
                    });
                    return;
                };
                return enforceAssignmentAndLoad(runWalkinQuestionQuery);
            }

            db.query(
                `
                SELECT 
                    e.course
                FROM exams e
                WHERE e.exam_id = ?
                LIMIT 1
                `,
                [req.params.examId],
                (err, metaRows) => {
            if (err) {
                console.error("Fetch exam meta error:", err);
                return res.json([]);
            }

            if (!metaRows || !metaRows.length) {
                return res.json([]);
            }

            db.query(
                `
        SELECT 
            q.*,
            wc.testcases,
            wc.examples,
            COALESCE(wc.marks, ws.marks, wa.marks, 1) AS marks
        FROM questions q
        LEFT JOIN walkin_coding_questions wc ON wc.question_id = q.question_id
        LEFT JOIN walkin_stream_questions ws ON ws.question_id = q.question_id
        LEFT JOIN walkin_aptitude_questions wa ON wa.question_id = q.question_id
        WHERE q.exam_id = ?
        ORDER BY q.question_id
                `,
                [req.params.examId],
                (err2, rows) => {
                    if (err2) {
                        console.error("Fetch questions error:", err2);
                        return res.json([]);
                    }
                    res.json(rows);
                }
            );
                }
            );
        }
    );
});

router.get("/walkin-coding-testcases", (req, res) => {
    db.query(
        `
        SELECT question_id, question_text, testcases, examples
        FROM walkin_coding_questions
        `,
        (err, rows) => {
            if (err) {
                console.error("Walkin testcases error:", err);
                return res.json([]);
            }
            res.json(rows);
        }
    );
});

router.get("/walkin-streams", (req, res) => {
    db.query(
        `
        SELECT DISTINCT stream
        FROM walkin_stream_questions
        WHERE stream IS NOT NULL AND stream <> ''
        ORDER BY FIELD(stream, 'Data Science', 'Data Analytics', 'MERN'), stream
        `,
        (err, rows) => {
            if (err) {
                console.error("Walkin streams error:", err);
                return res.json([]);
            }
            res.json(Array.isArray(rows) ? rows : []);
        }
    );
});

router.post("/run-code", async (req, res) => {
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const requestedLanguage = String(req.body?.language || "").trim().toLowerCase();
    const { code } = req.body || {};
    if (!requestedLanguage || !code) {
        return res.status(400).json({ success: false, message: "Missing language or code" });
    }
    if (!ALLOWED_CODING_LANGUAGES.has(requestedLanguage)) {
        return res.status(400).json({
            success: false,
            message: "Only Python, JavaScript, and C++ are supported right now."
        });
    }

    const testcases = Array.isArray(req.body.testcases)
        ? req.body.testcases.slice(0, MAX_CODING_TESTCASES)
        : [];
    try {
        if (testcases.length) {
            const results = [];
            for (const testcase of testcases) {
                const testcaseInput = JSON.stringify(testcase.input || "");
                const result = await runCodeWithRunner(requestedLanguage, code, testcaseInput);
                const stdoutNormalized = result.stdout?.trim() || "";
                const expectedValue = testcase.expected_output;
                const expectedNormalized =
                    expectedValue === null || expectedValue === undefined
                        ? ""
                        : String(expectedValue).trim();

                results.push({
                    input: testcase.input,
                    expected_output: testcase.expected_output,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    passed: stdoutNormalized === expectedNormalized,
                    timedOut: result.timedOut
                });
            }

            const passedCount = results.filter((r) => r.passed).length;
            return res.json({
                success: true,
                testResults: results,
                total: results.length,
                passed: passedCount
            });
        }

        const result = await runCodeWithRunner(requestedLanguage, code, req.body.input || "");
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
router.post("/submit", async (req, res) => {
    const { studentId, examId, answers, studentExamId } = req.body;
    let txStarted = false;

    if (!answers || answers.length === 0) {
        return res.json({ success: false });
    }

    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    try {
        const examIdNum = Number(examId);
        let effectiveExamIdNum = examIdNum;
        const walkinExamRows = await queryAsync(
            `
            SELECT walkin_exam_id, stream
            FROM walkin_exams
            WHERE walkin_exam_id = ?
            LIMIT 1
            `,
            [examIdNum]
        );
        const existing = await queryAsync(
            `SELECT result_id FROM results WHERE student_id = ? AND exam_id = ?`,
            [studentId, examId]
        );
        if (existing && existing.length > 0) {
            return res.json({ success: false });
        }

        const normalizedStudentType = String(req.session.student?.studentType || "")
            .trim()
            .toUpperCase()
            .replace(/[\s-]/g, "_");
        const isWalkin =
            normalizedStudentType === "WALKIN" || normalizedStudentType === "WALK_IN";
        const isWalkinExamId = walkinExamRows && walkinExamRows.length > 0;
        if (isWalkinExamId && !isWalkin) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        if (isWalkin && !isWalkinExamId) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        if (isWalkin && isWalkinExamId) {
            const assignedWalkinExamId = await fetchAssignedWalkinExamId(studentId);
            if (!assignedWalkinExamId || assignedWalkinExamId !== examIdNum) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            req.session.student.walkinExamId = assignedWalkinExamId;
        }

        let effectiveStudentExamId = null;
        let regularDurationMinutes = null;
        let regularStartedAt = null;
        if (!isWalkin) {
            await ensureRegularStudentExamTable();
            const requestedStudentExamId = Number(studentExamId || 0);
            let mapRows = [];
            if (requestedStudentExamId > 0) {
                mapRows = await queryAsync(
                    `SELECT student_exam_id
                     FROM regular_student_exam
                     WHERE student_exam_id = ?
                       AND student_id = ?
                       AND exam_id = ?
                     LIMIT 1`,
                    [requestedStudentExamId, studentId, examId]
                );
            } else {
                mapRows = await queryAsync(
                    `SELECT student_exam_id
                     FROM regular_student_exam
                     WHERE student_id = ?
                       AND exam_id = ?
                     LIMIT 1`,
                    [studentId, examId]
                );
            }

            if (!mapRows || mapRows.length === 0) {
                try {
                    await queryAsync(
                        `INSERT INTO regular_student_exam (student_id, exam_id) VALUES (?, ?)`,
                        [studentId, examId]
                    );
                } catch (insertError) {
                    const duplicate = Number(insertError?.errno) === 1062;
                    if (!duplicate) throw insertError;
                }
                mapRows = await queryAsync(
                    `SELECT student_exam_id
                     FROM regular_student_exam
                     WHERE student_id = ?
                       AND exam_id = ?
                     LIMIT 1`,
                    [studentId, examId]
                );
            }
            effectiveStudentExamId = Number(mapRows?.[0]?.student_exam_id || 0) || null;

            const timerRows = await queryAsync(
                `SELECT rse.started_at, e.duration_minutes
                 FROM regular_student_exam rse
                 JOIN exams e ON e.exam_id = rse.exam_id
                 WHERE rse.student_id = ?
                   AND rse.exam_id = ?
                 LIMIT 1`,
                [studentId, examId]
            );
            regularStartedAt = timerRows?.[0]?.started_at || null;
            regularDurationMinutes = Number(timerRows?.[0]?.duration_minutes || 0) || null;
            if (regularDurationMinutes && regularDurationMinutes > 0 && regularStartedAt) {
                const expiryRows = await queryAsync(
                    `SELECT NOW() > DATE_ADD(?, INTERVAL ? MINUTE) AS expired`,
                    [regularStartedAt, regularDurationMinutes]
                );
                const expired = Number(expiryRows?.[0]?.expired || 0) === 1;
                if (expired) {
                    return res.status(400).json({
                        success: false,
                        message: "Exam time is over. Submission window closed."
                    });
                }
            }
        }
        let isDataAnalyticsWalkin = false;
        if (isWalkin) {
            if (walkinExamRows && walkinExamRows.length > 0) {
                const stream = String(walkinExamRows?.[0]?.stream || "");
                isDataAnalyticsWalkin = normalizeWalkinStream(stream) === "DA";
            } else {
                const examRows = await queryAsync(
                `
                SELECT course
                FROM exams
                WHERE exam_id = ?
                LIMIT 1
                `,
                [examId]
                );
                const course = String(examRows?.[0]?.course || "").trim().toLowerCase();
                isDataAnalyticsWalkin = course === "data analytics";
            }
        }

        if (isDataAnalyticsWalkin) {
            const hasCodingAnswer = answers.some(
                (answer) => String(answer?.question_type || "").toUpperCase() === "CODING"
            );
            if (hasCodingAnswer) {
                return res.status(400).json({
                    success: false,
                    message: "Coding section is not allowed for Data Analytics walk-in exams"
                });
            }
        }
        for (const answer of answers) {
            const questionType = String(answer?.question_type || "").toUpperCase();
            if (questionType !== "DESCRIPTIVE") continue;
            const wordLimit = getDescriptiveWordLimit(answer?.question_id);
            const descriptiveText = String(answer?.descriptive_answer || "");
            const descriptiveWords = countWords(descriptiveText);
            if (wordLimit && descriptiveWords > wordLimit) {
                return res.status(400).json({
                    success: false,
                    message: `Word limit exceeded for descriptive question ${answer?.question_id}. Max allowed is ${wordLimit} words.`
                });
            }
        }

        await queryAsync(`START TRANSACTION`);
        txStarted = true;

        const walkinSql = `
            INSERT INTO walkin_student_answers
            (student_id, exam_id, question_id, section_name, question_type, selected_option, descriptive_answer, code, testcases_passed, marks_obtained)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const walkinDeleteSql = `
            DELETE FROM walkin_student_answers
            WHERE student_id = ?
              AND exam_id = ?
              AND question_id = ?
              AND UPPER(COALESCE(section_name, '')) = UPPER(?)
              AND question_type = ?
        `;

        const regularSql = `
            INSERT INTO student_answers
            (student_id, question_id, selected_option, exam_id)
            VALUES (?, ?, ?, ?)
        `;

        const aptitudeMetaSql = `
            SELECT marks, correct_option, question_text
            FROM walkin_aptitude_questions
            WHERE question_id = ?
            LIMIT 1
        `;
        const streamMcqMetaSql = `
            SELECT marks, correct_option, question_text
            FROM walkin_stream_questions
            WHERE question_id = ?
              AND correct_option IS NOT NULL
            LIMIT 1
        `;
        const streamDescriptiveMetaSql = `
            SELECT marks, descriptive_answer, question_text
            FROM walkin_stream_questions
            WHERE question_id = ?
              AND (descriptive_answer IS NOT NULL OR correct_option IS NULL)
            LIMIT 1
        `;
        const codingMetaSql = `
            SELECT marks, testcases, difficulty, question_text
            FROM walkin_coding_questions
            WHERE question_id = ?
            LIMIT 1
        `;

        let aptitudeMarksTotal = 0;
        let technicalMarksTotal = 0;
        let codingEasyMarksTotal = 0;
        let codingMediumMarksTotal = 0;
        let codingHardMarksTotal = 0;

        if (isWalkin) {
            await ensureWalkinSummaryColumn();
            await ensureWalkinAttemptedAtColumn();
            await ensureWalkinAnswerSectionColumn();

            const priorFinalRows = await queryAsync(
                `SELECT result_id
                 FROM walkin_final_results
                 WHERE student_id = ?
                   AND exam_id = ?
                 LIMIT 1`,
                [studentId, examIdNum]
            );
            const isWalkinReattempt = Array.isArray(priorFinalRows) && priorFinalRows.length > 0;
            if (isWalkinReattempt) {
                const streamCode = normalizeWalkinStream(
                    walkinExamRows?.[0]?.stream || req.session?.student?.course || "MERN"
                );
                const baseStreamLabel = getWalkinStreamDbLabel(streamCode);
                const insertWalkinExamResult = await queryAsync(
                    `INSERT INTO walkin_exams (stream, stream_code, exam_status) VALUES (?, ?, 'READY')`,
                    [baseStreamLabel, streamCode]
                );
                const newWalkinExamId = Number(insertWalkinExamResult?.insertId || 0);
                if (!newWalkinExamId) {
                    throw new Error("Could not create reattempt walk-in exam");
                }
                effectiveExamIdNum = newWalkinExamId;
                await queryAsync(
                    `UPDATE students
                     SET walkin_exam_id = ?
                     WHERE student_id = ?`,
                    [effectiveExamIdNum, studentId]
                );
                req.session.student.walkinExamId = effectiveExamIdNum;
            }
        }

        for (const a of answers) {
            if (isWalkin) {
                const questionType = (a.question_type || "MCQ").toUpperCase();
                const sectionName = String(a.section_name || "").toLowerCase();
                const sectionLabel = questionType === "CODING"
                    ? "Coding"
                    : sectionName.includes("aptitude")
                        ? "Aptitude"
                        : "Technical";
                const storedQuestionType =
                    questionType === "DESCRIPTIVE" ? "Descriptive" :
                    questionType === "CODING" ? "Coding" : "MCQ";
                const selectedOption =
                    questionType === "MCQ" && typeof a.selected_option === "string"
                        ? (a.selected_option.trim().toUpperCase().charAt(0) || null)
                        : null;
                const descriptiveAnswer =
                    questionType === "DESCRIPTIVE" && typeof a.descriptive_answer === "string"
                        ? a.descriptive_answer
                        : null;
                const codePayload =
                    questionType === "CODING" && typeof a.code === "string"
                        ? a.code
                        : null;
                const rawPassCount = questionType === "CODING" ? Number(a.testcases_passed || 0) : 0;
                const rawTotalFromPayload = questionType === "CODING" ? Number(a.testcases_total || 0) : 0;
                let passCountForStore = 0;

                let marksObtained = 0;
                let fullMarksForSummary = 0;
                let questionTextForSummary = "";
                let codingDifficultyForSummary = "";
                let codingTotalCasesForSummary = 0;

                if (questionType === "MCQ") {
                    let metaRows;
                    if (sectionName.includes("aptitude")) {
                        metaRows = await queryAsync(aptitudeMetaSql, [a.question_id]);
                    } else {
                        metaRows = await queryAsync(streamMcqMetaSql, [a.question_id]);
                        if (!metaRows.length) {
                            metaRows = await queryAsync(aptitudeMetaSql, [a.question_id]);
                        }
                    }
                    const meta = metaRows[0] || {};
                    const marksPossible = Number(meta.marks || 0);
                    fullMarksForSummary = marksPossible;
                    questionTextForSummary = String(meta.question_text || "");
                    const correctOption = String(meta.correct_option || "").trim().toUpperCase().charAt(0);
                    marksObtained =
                        selectedOption && correctOption && selectedOption === correctOption
                            ? marksPossible
                            : 0;

                    if (sectionName.includes("aptitude")) {
                        aptitudeMarksTotal += marksObtained;
                    } else {
                        technicalMarksTotal += marksObtained;
                    }
                } else if (questionType === "DESCRIPTIVE") {
                    const metaRows = await queryAsync(streamDescriptiveMetaSql, [a.question_id]);
                    const meta = metaRows[0] || {};
                    const marksPossible = Number(meta.marks || 0);
                    fullMarksForSummary = marksPossible;
                    questionTextForSummary = String(meta.question_text || "");
                    // Grade descriptive answers asynchronously after submit success.
                    marksObtained = 0;
                } else if (questionType === "CODING") {
                    const metaRows = await queryAsync(codingMetaSql, [a.question_id]);
                    const meta = metaRows[0] || {};
                    const marksPossible = Number(meta.marks || 0);
                    fullMarksForSummary = marksPossible;
                    questionTextForSummary = String(meta.question_text || "");
                    let totalCases = rawTotalFromPayload > 0 ? rawTotalFromPayload : 0;

                    if (totalCases <= 0) {
                        try {
                            const parsed = meta.testcases ? JSON.parse(meta.testcases) : [];
                            totalCases = Array.isArray(parsed) ? parsed.length : 0;
                        } catch (e) {
                            totalCases = 0;
                        }
                    }

                    totalCases = Math.min(totalCases, MAX_CODING_TESTCASES);
                    const normalizedPassCount = totalCases > 0
                        ? Math.max(0, Math.min(rawPassCount, totalCases))
                        : 0;
                    passCountForStore = normalizedPassCount;
                    codingTotalCasesForSummary = totalCases;
                    codingDifficultyForSummary = String(meta.difficulty || "");

                    marksObtained = totalCases > 0
                        ? Number(((normalizedPassCount / totalCases) * marksPossible).toFixed(2))
                        : 0;

                    const difficulty = String(meta.difficulty || "").toLowerCase();
                    if (difficulty.includes("easy")) {
                        codingEasyMarksTotal += marksObtained;
                    } else if (difficulty.includes("medium") || difficulty.includes("intermediate")) {
                        codingMediumMarksTotal += marksObtained;
                    } else {
                        codingHardMarksTotal += marksObtained;
                    }
                }

                await queryAsync(walkinDeleteSql, [
                    studentId,
                    effectiveExamIdNum,
                    a.question_id,
                    sectionLabel,
                    storedQuestionType
                ]);
                await queryAsync(walkinSql, [
                    studentId,
                    effectiveExamIdNum,
                    a.question_id,
                    sectionLabel,
                    storedQuestionType,
                    selectedOption,
                    descriptiveAnswer,
                    codePayload,
                    passCountForStore,
                    Number(marksObtained || 0)
                ]);

            } else {
                const questionType = (a.question_type || "MCQ").toUpperCase();
                if (questionType === "MCQ") {
                    await queryAsync(regularSql, [
                        studentId,
                        a.question_id,
                        a.selected_option,
                        examId
                    ]);
                }
            }
        }

        if (isWalkin) {
            const totalMarks = Number(
                (
                    Number(aptitudeMarksTotal || 0) +
                    Number(technicalMarksTotal || 0) +
                    Number(codingEasyMarksTotal || 0) +
                    Number(codingMediumMarksTotal || 0) +
                    Number(codingHardMarksTotal || 0)
                ).toFixed(2)
            );

            await queryAsync(
                `DELETE FROM walkin_final_results WHERE student_id = ? AND exam_id = ?`,
                [studentId, effectiveExamIdNum]
            );
            const finalResultParams = [
                studentId,
                effectiveExamIdNum,
                Number(aptitudeMarksTotal || 0),
                Number(technicalMarksTotal || 0),
                Number(codingEasyMarksTotal || 0),
                Number(codingMediumMarksTotal || 0),
                Number(codingHardMarksTotal || 0),
                totalMarks
            ];
            const provisionalSummary = buildProvisionalWalkinSummary(
                req.session?.student?.name || "Student",
                req.session?.student?.course || "",
                {
                    aptitude: aptitudeMarksTotal,
                    technical: technicalMarksTotal,
                    codingEasy: codingEasyMarksTotal,
                    codingMedium: codingMediumMarksTotal,
                    codingHard: codingHardMarksTotal,
                    total: totalMarks
                }
            );
            try {
                await queryAsync(
                    `INSERT INTO walkin_final_results
                    (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks, performance_summary, attempted_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                       aptitude_marks = VALUES(aptitude_marks),
                       technical_marks = VALUES(technical_marks),
                       coding_easy_marks = VALUES(coding_easy_marks),
                       coding_medium_marks = VALUES(coding_medium_marks),
                       coding_hard_marks = VALUES(coding_hard_marks),
                       total_marks = VALUES(total_marks),
                       performance_summary = VALUES(performance_summary),
                       attempted_at = VALUES(attempted_at)`,
                    [...finalResultParams, provisionalSummary]
                );
            } catch (insertError) {
                const msg = String(insertError?.message || "");
                if (!/unknown column.*performance_summary/i.test(msg)) {
                    throw insertError;
                }
                await queryAsync(
                    `INSERT INTO walkin_final_results
                    (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks, attempted_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                       aptitude_marks = VALUES(aptitude_marks),
                       technical_marks = VALUES(technical_marks),
                       coding_easy_marks = VALUES(coding_easy_marks),
                       coding_medium_marks = VALUES(coding_medium_marks),
                       coding_hard_marks = VALUES(coding_hard_marks),
                       total_marks = VALUES(total_marks),
                       attempted_at = VALUES(attempted_at)`,
                    finalResultParams
                );
            }

        }

        if (!isWalkin) {
            await queryAsync(
                `INSERT INTO results (student_id, exam_id, attempt_status)
                 VALUES (?, ?, 'SUBMITTED')`,
                [studentId, examId]
            );
        }
        await queryAsync(
            `UPDATE students
             SET status = 'INACTIVE'
             WHERE student_id = ?`,
            [studentId]
        );
        await queryAsync(`COMMIT`);

        if (isWalkin) {
            setImmediate(async () => {
                try {
                    await runWalkinPostSubmitProcessing(Number(studentId), Number(effectiveExamIdNum));
                } catch (postProcessError) {
                    console.error("Walk-in post-submit processing error:", postProcessError);
                }
            });
        }

        return res.json({
            success: true,
            message: "Exam submitted successfully",
            studentExamId: effectiveStudentExamId,
            examId: isWalkin ? Number(effectiveExamIdNum) : Number(examIdNum)
        });
    } catch (error) {
        if (txStarted) {
            try {
                await queryAsync(`ROLLBACK`);
            } catch (rollbackError) {
                console.error("Submit rollback error:", rollbackError);
            }
        }
        if (Number(error?.statusCode || 0) === 400) {
            return res.status(400).json({ success: false, message: error.message || "Validation failed" });
        }
        console.error("Submit exam error:", error);
        return res.status(500).json({ success: false, message: "Submission failed" });
    }
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
        `
        SELECT walkin_exam_id
        FROM walkin_exams
        WHERE walkin_exam_id = ?
        LIMIT 1
        `,
        [examId],
        (walkinErr, walkinRows) => {
            if (walkinErr) {
                console.error("Walk-in result exam lookup error:", walkinErr);
                return res.json({ success: false, message: "Server error" });
            }
            if (walkinRows && walkinRows.length > 0) {
                db.query(
                    `
                    SELECT total_marks
                    FROM walkin_final_results
                    WHERE student_id = ?
                      AND exam_id = ?
                    LIMIT 1
                    `,
                    [studentId, examId],
                    (err, rows) => {
                        if (err) {
                            console.error("Walk-in result lookup error:", err);
                            return res.json({ success: false, message: "Server error" });
                        }
                        const totalMarks = Number(rows?.[0]?.total_marks || 0);
                        return res.json({
                            success: true,
                            totalMarks,
                            scorePercent: null
                        });
                    }
                );
                return;
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
                    const scorePercent = total > 0 ? Number(((correct / total) * 100).toFixed(2)) : 0;
                    return res.json({
                        success: true,
                        totalMarks: `${correct}/${total}`,
                        scorePercent
                    });
                }
            );
                }
            );
        }
    );
});

module.exports = router;


