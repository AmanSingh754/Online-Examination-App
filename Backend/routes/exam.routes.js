const express = require("express");
const router = express.Router();
const db = require("../db");
const util = require("util");
const queryAsync = util.promisify(db.query).bind(db);
const { gradeDescriptiveAnswer, generateWalkinPerformanceSummary } = require("../llm");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
    getCanonicalWalkinStreamCode,
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
let regularExamFeedbackTableChecked = false;
let resultsSubmittedAtColumnChecked = false;
let walkinStudentExamTableChecked = false;
let walkinAnswerSectionColumnChecked = false;
let walkinAnswerSubmittedColumnChecked = false;
const normalizeWalkinStream = (value) => getWalkinStreamCodeOrDefault(value);
const normalizeWalkinStreamStrict = (value) => getCanonicalWalkinStreamCode(value);
const getWalkinStreamDbLabel = (value) => getWalkinStreamLabel(value);
const isWalkinStudentType = (value) => {
    const normalized = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]/g, "_");
    return normalized === "WALKIN" || normalized === "WALK_IN";
};
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

const fetchLatestReadyRegularExamForCourse = async (course) => {
    const normalizedCourse = String(course || "").trim();
    if (!normalizedCourse) return null;
    const rows = await queryAsync(
        `SELECT exam_id, course, exam_status, start_at, end_at
         FROM regular_exams
         WHERE LOWER(TRIM(course)) = LOWER(TRIM(?))
           AND COALESCE(is_deleted, FALSE) = FALSE
           AND exam_status = 'READY'
         ORDER BY start_at DESC NULLS LAST, exam_id DESC
         LIMIT 1`,
        [normalizedCourse]
    );
    return rows?.[0] || null;
};

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
const DEFAULT_OS_TEMP_CODE_DIR = path.join(os.tmpdir(), "exam-portal-code-runner");

const getCodeTempDirCandidates = () => {
    const envDir = String(process.env.CODE_RUN_TEMP_DIR || "").trim();
    const dirs = [
        envDir,
        DEFAULT_OS_TEMP_CODE_DIR,
        TEMP_CODE_DIR
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    return [...new Set(dirs)];
};

const isPermissionExecutionError = (error) => {
    const code = String(error?.code || "").toUpperCase();
    const msg = String(error?.message || "");
    if (code === "EPERM" || code === "EACCES") return true;
    return /operation not permitted|access is denied|permission denied/i.test(msg);
};

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

const getRuntimeCommandCandidates = (language, primaryCommand) => {
    const normalizedPrimary = String(primaryCommand || "").trim();
    if (language !== "python") {
        return normalizedPrimary ? [normalizedPrimary] : [];
    }
    const envPreferred = String(process.env.PYTHON_CMD || "").trim();
    const candidates = [envPreferred, normalizedPrimary, "python3", "python", "py"]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    return [...new Set(candidates)];
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

const runCodeWithRunnerAtDir = async (language, code, input = "", tempDir) => {
    const runner = CODE_RUNNERS[language];
    if (!runner) {
        throw new Error("Unsupported language");
    }
    await fs.promises.mkdir(tempDir, { recursive: true });
    const id = `code-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const filepath = path.join(tempDir, `${id}${runner.ext}`);
    const exePath = runner.exeExt
        ? path.join(tempDir, `${id}${runner.exeExt}`)
        : path.join(tempDir, id);
    await fs.promises.writeFile(filepath, code, { encoding: "utf8" });

    const ctx = { file: filepath, dir: tempDir, exe: exePath };
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
                cwd: tempDir,
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
                        cwd: tempDir,
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
    const runtimeCandidates = getRuntimeCommandCandidates(language, execCommand);
    return await new Promise((resolve, reject) => {
        const cleanupTempFiles = () => {
            fs.promises.unlink(filepath).catch(() => {});
            if (runner.exeExt || runner.exec?.command === "{{exe}}") {
                fs.promises.unlink(exePath).catch(() => {});
            }
        };

        const trySpawn = (index) => {
            const commandToRun = runtimeCandidates[index];
            const child = spawn(commandToRun, execArgs, {
                cwd: tempDir,
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
                if (err.code === "ENOENT" && index < runtimeCandidates.length - 1) {
                    trySpawn(index + 1);
                    return;
                }
                cleanupTempFiles();
                if (err.code === "ENOENT") {
                    reject(new Error(`Runtime not found. Tried: ${runtimeCandidates.join(", ")}`));
                    return;
                }
                reject(err);
            });

            child.on("close", (code) => {
                clearTimeout(timer);
                cleanupTempFiles();
                resolve({
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    timedOut,
                    exitCode: code
                });
            });
        };

        if (!runtimeCandidates.length) {
            cleanupTempFiles();
            reject(new Error("Runtime command is not configured"));
            return;
        }
        trySpawn(0);
    });
};

const runCodeWithRunner = async (language, code, input = "") => {
    const tempDirs = getCodeTempDirCandidates();
    let lastPermissionError = null;

    for (const dir of tempDirs) {
        try {
            return await runCodeWithRunnerAtDir(language, code, input, dir);
        } catch (error) {
            if (isPermissionExecutionError(error)) {
                lastPermissionError = error;
                continue;
            }
            throw error;
        }
    }

    if (lastPermissionError) {
        const dirsTried = tempDirs.join(", ");
        const err = new Error(
            `Code execution blocked by OS permissions. Tried temp directories: ${dirsTried}. Configure CODE_RUN_TEMP_DIR to a writable/executable local path.`
        );
        err.code = String(lastPermissionError.code || "EPERM");
        throw err;
    }

    throw new Error("Code execution failed: no runnable temp directory available.");
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
             ADD COLUMN attempted_at TIMESTAMP NULL`
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
            student_exam_id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            student_id INT NOT NULL,
            exam_id INT NOT NULL,
            started_at TIMESTAMP NULL,
            CONSTRAINT uq_regular_student_exam UNIQUE (student_id, exam_id)
        )`
    );
    try {
        await queryAsync(
            `ALTER TABLE regular_student_exam ADD COLUMN started_at TIMESTAMP NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            throw error;
        }
    }
    regularStudentExamTableChecked = true;
};

const ensureRegularExamFeedbackTable = async () => {
    if (regularExamFeedbackTableChecked) return;
    await queryAsync(
        `CREATE TABLE IF NOT EXISTS regular_exam_feedback (
            feedback_id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            student_id INT NOT NULL,
            exam_id INT NOT NULL,
            question_text TEXT NULL,
            feedback_text TEXT NOT NULL,
            submission_mode VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
            submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_regular_exam_feedback UNIQUE (student_id, exam_id)
        )`
    );
    regularExamFeedbackTableChecked = true;
};

const ensureResultsSubmittedAtColumn = async () => {
    if (resultsSubmittedAtColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE regular_student_results
             ADD COLUMN submitted_at TIMESTAMP NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add submitted_at column to regular_student_results:", msg);
        }
    } finally {
        resultsSubmittedAtColumnChecked = true;
    }
};

const ensureWalkinStudentExamTable = async () => {
    if (walkinStudentExamTableChecked) return;
    await queryAsync(
        `CREATE TABLE IF NOT EXISTS walkin_student_exam (
            walkin_student_exam_id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            student_id INT NOT NULL,
            exam_id INT NOT NULL,
            started_at TIMESTAMP NULL,
            CONSTRAINT uq_walkin_student_exam UNIQUE (student_id, exam_id)
        )`
    );
    try {
        await queryAsync(
            `ALTER TABLE walkin_student_exam ADD COLUMN started_at TIMESTAMP NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            throw error;
        }
    }
    walkinStudentExamTableChecked = true;
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

const ensureWalkinAnswerSubmittedColumn = async () => {
    if (walkinAnswerSubmittedColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_student_answers
             ADD COLUMN is_submitted BOOLEAN NOT NULL DEFAULT FALSE`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add is_submitted column to walkin_student_answers:", msg);
        }
    } finally {
        walkinAnswerSubmittedColumnChecked = true;
    }
};

const isExamSubmitted = async (studentId, examId) => {
    const walkinRows = await queryAsync(
        `SELECT walkin_exam_id FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
        [examId]
    );
    if (walkinRows && walkinRows.length > 0) {
        const statusRows = await queryAsync(
            `SELECT status FROM students WHERE student_id = ? LIMIT 1`,
            [studentId]
        );
        const statusLabel = String(statusRows?.[0]?.status || "").trim().toUpperCase();
        return statusLabel === "INACTIVE";
    }

    const rows = await queryAsync(
        `SELECT result_id FROM regular_student_results WHERE student_id = ? AND exam_id = ? LIMIT 1`,
        [studentId, examId]
    );
    return Boolean(rows && rows.length > 0);
};

const getWalkinResultProcessingState = async (studentId, examId) => {
    await ensureWalkinAnswerSubmittedColumn();
    const [finalRows, submittedAnswerRows] = await Promise.all([
        queryAsync(
            `SELECT 1
             FROM walkin_final_results
             WHERE student_id = ?
               AND exam_id = ?
             LIMIT 1`,
            [studentId, examId]
        ),
        queryAsync(
            `SELECT 1
             FROM walkin_student_answers
             WHERE student_id = ?
               AND exam_id = ?
               AND COALESCE(is_submitted, FALSE) = TRUE
             LIMIT 1`,
            [studentId, examId]
        )
    ]);

    const hasFinalResult = Boolean(finalRows?.length);
    const hasSubmittedAnswers = Boolean(submittedAnswerRows?.length);
    return {
        ready: hasFinalResult,
        processing: !hasFinalResult && hasSubmittedAnswers
    };
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

const WALKIN_SUBMIT_GRACE_SECONDS = Number(process.env.WALKIN_SUBMIT_GRACE_SECONDS || 60);

const normalizeWalkinSectionLabel = (value, qType = "") => {
    const typeUpper = String(qType || "").trim().toUpperCase();
    if (typeUpper === "CODING") return "Coding";
    const section = String(value || "").trim().toUpperCase();
    if (section.includes("APTITUDE")) return "Aptitude";
    if (section.includes("CODING")) return "Coding";
    return "Technical";
};

const normalizeWalkinStoredQuestionType = (value = "") => {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "DESCRIPTIVE") return "Descriptive";
    if (normalized === "CODING") return "Coding";
    return "MCQ";
};

const mapWalkinRowsToAnswers = (rows = []) => {
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const rawType = String(row?.question_type || "").trim().toUpperCase();
        const mappedType =
            rawType === "DESCRIPTIVE" ? "DESCRIPTIVE"
                : rawType === "CODING" ? "CODING"
                    : "MCQ";
        return {
            question_id: Number(row?.question_id || 0),
            question_type: mappedType,
            section_name: String(row?.section_name || ""),
            selected_option: row?.selected_option || null,
            descriptive_answer: row?.descriptive_answer || null,
            code: row?.code || null,
            coding_language: "",
            testcases_passed: Number(row?.testcases_passed || 0),
            testcases_total: Number(row?.testcases_total || 0)
        };
    }).filter((entry) => Number(entry.question_id || 0) > 0);
};

const normalizeAutosaveAnswers = (answers = []) => {
    const deduped = new Map();
    for (const answer of Array.isArray(answers) ? answers : []) {
        const questionId = Number(answer?.question_id || 0);
        if (!questionId) continue;

        const qType = String(answer?.question_type || "MCQ").trim().toUpperCase() || "MCQ";
        const sectionName = String(answer?.section_name || "").trim() || null;
        const codingLanguage =
            qType === "CODING"
                ? String(answer?.coding_language || "").trim().toLowerCase()
                : "";
        const selectedOption =
            qType === "MCQ"
                ? String(answer?.selected_option || "").trim().toUpperCase().charAt(0) || null
                : null;
        const descriptiveAnswer =
            qType === "DESCRIPTIVE"
                ? String(answer?.descriptive_answer || "")
                : null;
        const codePayload =
            qType === "CODING"
                ? String(answer?.code || "")
                : null;

        const parsedPassed = Number(answer?.testcases_passed);
        const parsedTotal = Number(answer?.testcases_total);
        const testcasesPassed =
            qType === "CODING" && Number.isFinite(parsedPassed)
                ? parsedPassed
                : null;
        const testcasesTotal =
            qType === "CODING" && Number.isFinite(parsedTotal)
                ? parsedTotal
                : null;

        const key = `${questionId}|${qType}|${codingLanguage}`;
        deduped.set(key, {
            questionId,
            sectionName,
            qType,
            selectedOption,
            descriptiveAnswer,
            codePayload,
            codingLanguage,
            testcasesPassed,
            testcasesTotal
        });
    }
    return Array.from(deduped.values());
};

const runWalkinPostSubmitProcessing = async (studentId, examId) => {
    await ensureWalkinSummaryColumn();
    await ensureWalkinAttemptedAtColumn();
    await ensureWalkinAnswerSubmittedColumn();

    const gradingRows = await queryAsync(
        `
        SELECT
            wsa.submission_id,
            wsa.question_id,
            UPPER(COALESCE(wsa.section_name, '')) AS section_name,
            UPPER(COALESCE(wsa.question_type::text, '')) AS question_type,
            COALESCE(wsa.selected_option, '') AS selected_option,
            wsa.descriptive_answer,
            COALESCE(wsa.testcases_passed, 0) AS testcases_passed,
            wa.correct_option AS aptitude_correct_option,
            wa.marks AS aptitude_marks,
            ws.correct_option AS stream_correct_option,
            ws.descriptive_answer AS reference_answer,
            COALESCE(ws.question_text, '') AS stream_question_text,
            ws.marks AS stream_marks,
            wc.marks AS coding_marks,
            wc.testcases AS coding_testcases
        FROM walkin_student_answers wsa
        LEFT JOIN walkin_aptitude_questions wa
               ON wa.question_id = wsa.question_id
        LEFT JOIN walkin_stream_questions ws
               ON ws.question_id = wsa.question_id
        LEFT JOIN walkin_coding_questions wc
               ON wc.question_id = wsa.question_id
        WHERE wsa.student_id = ?
          AND wsa.exam_id = ?
          AND COALESCE(wsa.is_submitted, FALSE) = TRUE
        `,
        [studentId, examId]
    );

    for (const row of gradingRows || []) {
        const questionType = String(row.question_type || "").toUpperCase();
        const sectionName = String(row.section_name || "").toUpperCase();
        let obtained = 0;

        if (questionType === "MCQ") {
            const marksPossible = Number(
                sectionName === "APTITUDE" ? row.aptitude_marks : row.stream_marks
            ) || 0;
            const selected = String(row.selected_option || "").trim().toUpperCase().charAt(0);
            const correct = String(
                sectionName === "APTITUDE" ? row.aptitude_correct_option : row.stream_correct_option
            )
                .trim()
                .toUpperCase()
                .charAt(0);
            obtained = selected && correct && selected === correct ? marksPossible : 0;
        } else if (questionType === "DESCRIPTIVE") {
            const marksPossible = Number(row.stream_marks || 0);
            obtained = await gradeDescriptiveAnswer(
                String(row.reference_answer || ""),
                String(row.descriptive_answer || ""),
                marksPossible,
                { questionText: String(row.stream_question_text || "") }
            );
        } else if (questionType === "CODING") {
            const marksPossible = Number(row.coding_marks || 0);
            const totalCases = parseTestcaseCount(row.coding_testcases);
            const passedRaw = Number(row.testcases_passed || 0);
            const passed = totalCases > 0 ? Math.max(0, Math.min(passedRaw, totalCases)) : 0;
            obtained = totalCases > 0
                ? Number(((passed / totalCases) * marksPossible).toFixed(2))
                : 0;
        }

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
            UPPER(COALESCE(wsa.question_type::text, '')) AS question_type,
            COALESCE(wsa.descriptive_answer, '') AS descriptive_answer,
            COALESCE(wsa.code, '') AS code,
            COALESCE(wsa.marks_obtained, 0) AS marks_obtained,
            COALESCE(wsa.testcases_passed, 0) AS testcases_passed,
            wa.question_id AS aptitude_qid,
            ws.question_id AS stream_qid,
            wc.question_id AS coding_qid,
            COALESCE(wa.marks, ws.marks, wc.marks, 0) AS full_marks,
            COALESCE(wa.question_text, ws.question_text, wc.question_text, '') AS question_text,
            COALESCE(ws.descriptive_answer, '') AS reference_descriptive_answer,
            LOWER(COALESCE(wc.difficulty, '')) AS coding_difficulty,
            wc.testcases AS coding_testcases
        FROM walkin_student_answers wsa
        JOIN (
            SELECT MAX(submission_id) AS submission_id
            FROM walkin_student_answers
            WHERE student_id = ?
              AND exam_id = ?
              AND COALESCE(is_submitted, FALSE) = TRUE
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
          AND COALESCE(wsa.is_submitted, FALSE) = TRUE
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
            question_text: String(row.question_text || ""),
            code: String(row.code || ""),
            descriptive_answer: String(row.descriptive_answer || ""),
            reference_answer: String(row.reference_descriptive_answer || "")
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
            ON CONFLICT (student_id, exam_id) DO UPDATE SET
              aptitude_marks = EXCLUDED.aptitude_marks,
              technical_marks = EXCLUDED.technical_marks,
              coding_easy_marks = EXCLUDED.coding_easy_marks,
              coding_medium_marks = EXCLUDED.coding_medium_marks,
              coding_hard_marks = EXCLUDED.coding_hard_marks,
              total_marks = EXCLUDED.total_marks,
              performance_summary = EXCLUDED.performance_summary,
              attempted_at = COALESCE(walkin_final_results.attempted_at, EXCLUDED.attempted_at)`,
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
            ON CONFLICT (student_id, exam_id) DO UPDATE SET
              aptitude_marks = EXCLUDED.aptitude_marks,
              technical_marks = EXCLUDED.technical_marks,
              coding_easy_marks = EXCLUDED.coding_easy_marks,
              coding_medium_marks = EXCLUDED.coding_medium_marks,
              coding_hard_marks = EXCLUDED.coding_hard_marks,
              total_marks = EXCLUDED.total_marks,
              attempted_at = COALESCE(walkin_final_results.attempted_at, EXCLUDED.attempted_at)`,
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
            const studentRows = await queryAsync(
                `SELECT status, course, student_type FROM students WHERE student_id = ? LIMIT 1`,
                [studentId]
            );
            const student = studentRows?.[0] || {};
            const isActive = String(student.status || "").trim().toUpperCase() === "ACTIVE";
            if (!isActive) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            if (!isWalkinStudentType(student.student_type)) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            const examRows = await queryAsync(
                `SELECT stream FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
                [examId]
            );
            const examStreamCode = normalizeWalkinStreamStrict(examRows?.[0]?.stream || "");
            const studentStreamCode = normalizeWalkinStreamStrict(student.course || "");
            if (!examStreamCode || !studentStreamCode || examStreamCode !== studentStreamCode) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            await ensureWalkinStudentExamTable();
            try {
                await queryAsync(
                    `INSERT INTO walkin_student_exam (student_id, exam_id) VALUES (?, ?)`,
                    [studentId, examId]
                );
            } catch (insertError) {
                const duplicate =
                    Number(insertError?.errno) === 1062 ||
                    String(insertError?.code || "").toUpperCase() === "23505" ||
                    /duplicate key/i.test(String(insertError?.message || ""));
                if (!duplicate) throw insertError;
            }
            await queryAsync(
                `UPDATE walkin_student_exam
                 SET started_at = COALESCE(started_at, NOW())
                 WHERE student_id = ?
                   AND exam_id = ?`,
                [studentId, examId]
            );
            await queryAsync(
                `UPDATE students
                 SET walkin_exam_id = ?
                 WHERE student_id = ?`,
                [examId, studentId]
            );
            req.session.student.walkinExamId = examId;
            return res.json({ success: true, studentExamId: null });
        }

        const regularStudentRows = await queryAsync(
            `SELECT status, course, student_type
             FROM students
             WHERE student_id = ?
             LIMIT 1`,
            [studentId]
        );
        const regularStudent = regularStudentRows?.[0] || {};
        const isStudentActive = String(regularStudent.status || "").trim().toUpperCase() === "ACTIVE";
        if (!isStudentActive) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        if (isWalkinStudentType(regularStudent.student_type)) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        const studentCourseRaw = String(regularStudent.course || "").trim();
        const studentCourse = studentCourseRaw.toLowerCase();
        if (!studentCourse) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        const latestRegularExam = await fetchLatestReadyRegularExamForCourse(studentCourseRaw);
        if (!latestRegularExam) {
            return res.status(404).json({ success: false, message: "No READY exam found for this course." });
        }
        if (Number(latestRegularExam.exam_id || 0) !== Number(examId)) {
            return res.status(403).json({ success: false, message: "Only latest course exam can be started." });
        }
        const regularExam = latestRegularExam;

        const startAtMs = new Date(regularExam.start_at).getTime();
        const endAtMs = new Date(regularExam.end_at).getTime();
        const nowMs = Date.now();
        if (Number.isFinite(startAtMs) && nowMs < startAtMs) {
            const startsInSeconds = Math.max(0, Math.ceil((startAtMs - nowMs) / 1000));
            const hours = Math.floor(startsInSeconds / 3600);
            const minutes = Math.floor((startsInSeconds % 3600) / 60);
            const seconds = startsInSeconds % 60;
            const parts = [];
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
            parts.push(`${seconds}s`);
            return res.status(409).json({
                success: false,
                code: "exam_not_started",
                startsAt: regularExam.start_at,
                now: new Date(nowMs).toISOString(),
                startsInSeconds,
                message: `Exam starts in ${parts.join(" ")}`
            });
        }
        if (Number.isFinite(endAtMs) && nowMs > endAtMs) {
            return res.status(410).json({ success: false, message: "Exam window is closed." });
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
                const duplicate =
                    Number(insertError?.errno) === 1062 ||
                    String(insertError?.code || "").toUpperCase() === "23505" ||
                    /duplicate key/i.test(String(insertError?.message || ""));
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
            `SELECT duration_minutes FROM regular_exams WHERE exam_id = ? LIMIT 1`,
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
                                if (rows2.length > 0) {
                                    return res.json({ attempted: true });
                                }
                                return db.query(
                                    `SELECT 1
                                     FROM walkin_student_answers
                                     WHERE student_id = ?
                                       AND exam_id = ?
                                       AND COALESCE(is_submitted, FALSE) = TRUE
                                     LIMIT 1`,
                                    [req.params.studentId, req.params.examId],
                                    (err3, rows3) => {
                                        if (err3) return res.json({ attempted: false });
                                        if (rows3 && rows3.length > 0) {
                                            return res.json({
                                                attempted: false,
                                                processing: true,
                                                message: "Result is processing. Please retry shortly."
                                            });
                                        }
                                        return res.json({ attempted: false });
                                    }
                                );
                            }
                        );
                    }
                );
            }
            db.query(
                `SELECT result_id FROM regular_student_results WHERE student_id = ? AND exam_id = ?`,
                [req.params.studentId, req.params.examId],
                (err3, rows3) => {
                    if (err3) return res.json({ attempted: false });
                    return res.json({ attempted: rows3.length > 0 });
                }
            );
        }
    );
});

/* ================= FETCH regular_exam_questions ================= */
router.get("/regular_exam_questions/:examId", (req, res) => {
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
                        `SELECT walkin_exam_id, status, course, student_type FROM students WHERE student_id = ? LIMIT 1`,
                        [req.session?.student?.studentId],
                        (mapErr, mapRows) => {
                            if (mapErr) {
                                console.error("Walk-in assignment lookup error:", mapErr);
                                return res.status(500).json({ success: false, message: "Could not verify walk-in assignment" });
                            }
                            const student = mapRows?.[0] || {};
                            const isActive = String(student.status || "").trim().toUpperCase() === "ACTIVE";
                            if (!isActive) {
                                return res.status(403).json({ success: false, message: "Forbidden" });
                            }
                            if (!isWalkinStudentType(student.student_type)) {
                                return res.status(403).json({ success: false, message: "Forbidden" });
                            }
                            const assignedWalkinExamId = Number(student.walkin_exam_id || 0);
                            const examStreamCode = normalizeWalkinStreamStrict(walkinExam.stream || "");
                            const studentStreamCode = normalizeWalkinStreamStrict(student.course || "");
                            const streamMatch = Boolean(
                                examStreamCode &&
                                studentStreamCode &&
                                examStreamCode === studentStreamCode
                            );
                            if (!streamMatch && (!assignedWalkinExamId || assignedWalkinExamId !== examIdNum)) {
                                return res.status(403).json({ success: false, message: "Forbidden" });
                            }
                            if (req.session?.student) {
                                req.session.student.walkinExamId =
                                    streamMatch ? examIdNum : assignedWalkinExamId;
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
                    const streamQuestionKey = String(getWalkinStreamQuestionKey(streamCode) || "").toLowerCase();
                    const streamLabelCompact = String(getWalkinStreamDbLabel(streamCode) || "")
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, "");
                    const streamCodeCompact = String(streamCode || "").toLowerCase();
                    const streamTokens = [streamQuestionKey, streamCodeCompact, streamLabelCompact];

                    const walkinSql = `
        SELECT question_id, question_text, option_a, option_b, option_c, option_d, section_name,
               question_type, correct_answer, marks, testcases, examples
        FROM (
            SELECT question_id, question_text, option_a, option_b, option_c, option_d,
                   'Aptitude' AS section_name,
                   'MCQ' AS question_type,
                   correct_option::text AS correct_answer,
                   marks,
                   NULL::jsonb AS testcases,
                   NULL::jsonb AS examples,
                   1 AS source_order
            FROM walkin_aptitude_questions
            UNION ALL
            SELECT question_id, question_text, option_a, option_b, option_c, option_d,
                   COALESCE(section_name::text, 'Technical') AS section_name,
                   CASE
                       WHEN LOWER(COALESCE(question_type::text, '')) LIKE '%mcq%' THEN 'MCQ'
                       ELSE 'Descriptive'
                   END AS question_type,
                   correct_option::text AS correct_answer,
                   marks,
                   NULL::jsonb AS testcases,
                   NULL::jsonb AS examples,
                   2 AS source_order
            FROM walkin_stream_questions
            WHERE REGEXP_REPLACE(LOWER(COALESCE(stream::text, '')), '[^a-z0-9]+', '', 'g') IN (?, ?, ?)
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

                    db.query(walkinSql, streamTokens, (err2, walkinRows) => {
                        if (err2) {
                            console.error("Fetch walk-in regular_exam_questions error:", err2);
                            return res.json([]);
                        }
                        return res.json(Array.isArray(walkinRows) ? walkinRows : []);
                    });
                    return;
                };
                return enforceAssignmentAndLoad(runWalkinQuestionQuery);
            }

            (async () => {
                try {
                    const studentId = Number(req.session?.student?.studentId || 0);
                    const studentRows = await queryAsync(
                        `SELECT status, course, student_type
                         FROM students
                         WHERE student_id = ?
                         LIMIT 1`,
                        [studentId]
                    );
                    const student = studentRows?.[0] || {};
                    const isActive = String(student.status || "").trim().toUpperCase() === "ACTIVE";
                    if (!isActive) {
                        return res.status(403).json({ success: false, message: "Forbidden" });
                    }
                    if (isWalkinStudentType(student.student_type)) {
                        return res.status(403).json({ success: false, message: "Forbidden" });
                    }

                    const latestRegularExam = await fetchLatestReadyRegularExamForCourse(student.course);
                    if (!latestRegularExam) {
                        return res.status(404).json({ success: false, message: "No READY exam found for this course." });
                    }
                    if (Number(latestRegularExam.exam_id || 0) !== Number(examIdNum)) {
                        return res.status(403).json({ success: false, message: "Only latest course exam regular_exam_questions are accessible." });
                    }

                    const nowMs = Date.now();
                    const startAtMs = new Date(latestRegularExam.start_at).getTime();
                    const endAtMs = new Date(latestRegularExam.end_at).getTime();
                    if (Number.isFinite(startAtMs) && nowMs < startAtMs) {
                        const startsInSeconds = Math.max(0, Math.ceil((startAtMs - nowMs) / 1000));
                        return res.status(409).json({
                            success: false,
                            code: "exam_not_started",
                            startsAt: latestRegularExam.start_at,
                            now: new Date(nowMs).toISOString(),
                            startsInSeconds,
                            message: "Exam has not started yet."
                        });
                    }
                    if (Number.isFinite(endAtMs) && nowMs > endAtMs) {
                        return res.status(410).json({ success: false, message: "Exam window is closed." });
                    }

                    const rows = await queryAsync(
                        `
                        SELECT 
                            q.*,
                            wc.testcases,
                            wc.examples,
                            COALESCE(wc.marks, ws.marks, wa.marks, 1) AS marks
                        FROM regular_exam_questions q
                        LEFT JOIN walkin_coding_questions wc ON wc.question_id = q.question_id
                        LEFT JOIN walkin_stream_questions ws ON ws.question_id = q.question_id
                        LEFT JOIN walkin_aptitude_questions wa ON wa.question_id = q.question_id
                        WHERE q.exam_id = ?
                        ORDER BY q.question_id
                        `,
                        [req.params.examId]
                    );
                    return res.json(rows || []);
                } catch (error) {
                    console.error("Fetch regular_exam_questions error:", error);
                    return res.json([]);
                }
            })();
            return;
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
        SELECT stream
        FROM (
            SELECT DISTINCT stream::text AS stream
            FROM walkin_stream_questions
            WHERE stream IS NOT NULL
              AND TRIM(stream::text) <> ''
        ) ws
        ORDER BY
            CASE LOWER(TRIM(stream::text))
                WHEN 'data science' THEN 1
                WHEN 'data analytics' THEN 2
                WHEN 'mern' THEN 3
                ELSE 4
            END,
            stream
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
            const regular_student_results = [];
            for (const testcase of testcases) {
                const testcaseInput = JSON.stringify(testcase.input || "");
                const result = await runCodeWithRunner(requestedLanguage, code, testcaseInput);
                const stdoutNormalized = result.stdout?.trim() || "";
                const expectedValue = testcase.expected_output;
                const expectedNormalized =
                    expectedValue === null || expectedValue === undefined
                        ? ""
                        : String(expectedValue).trim();

                regular_student_results.push({
                    input: testcase.input,
                    expected_output: testcase.expected_output,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    passed: stdoutNormalized === expectedNormalized,
                    timedOut: result.timedOut
                });
            }

            const passedCount = regular_student_results.filter((r) => r.passed).length;
            return res.json({
                success: true,
                testResults: regular_student_results,
                total: regular_student_results.length,
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

router.get("/draft/:examId", async (req, res) => {
    const examId = Number(req.params.examId || 0);
    const studentId = Number(req.session?.student?.studentId || 0);
    if (!examId || !studentId) {
        return res.status(400).json({ success: false, message: "Invalid exam context" });
    }
    try {
        const walkinRows = await queryAsync(
            `SELECT walkin_exam_id FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
            [examId]
        );
        const isWalkinExam = Boolean(walkinRows && walkinRows.length > 0);
        if (isWalkinExam) {
            await ensureWalkinAnswerSubmittedColumn();
            const rows = await queryAsync(
                `SELECT question_id, section_name, question_type, selected_option, descriptive_answer, code,
                        testcases_passed, 0 AS testcases_total, submission_id AS updated_at
                 FROM walkin_student_answers
                 WHERE student_id = ? AND exam_id = ? AND is_submitted = FALSE
                 ORDER BY submission_id DESC`,
                [studentId, examId]
            );
            return res.json({ success: true, drafts: mapWalkinRowsToAnswers(rows) });
        }

        return res.json({ success: true, drafts: [] });
    } catch (error) {
        console.error("Load exam drafts error:", error);
        return res.status(500).json({ success: false, message: "Could not load saved answers" });
    }
});

router.post("/draft/autosave", async (req, res) => {
    const studentId = Number(req.session?.student?.studentId || 0);
    const bodyStudentId = Number(req.body?.studentId || 0);
    const examId = Number(req.body?.examId || 0);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!studentId || !bodyStudentId || !examId) {
        return res.status(400).json({ success: false, message: "Invalid autosave payload" });
    }
    if (studentId !== bodyStudentId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (answers.length === 0) {
        return res.json({ success: true, saved: 0 });
    }
    const normalizedAnswers = normalizeAutosaveAnswers(answers);
    if (normalizedAnswers.length === 0) {
        return res.json({ success: true, saved: 0 });
    }

    try {
        const alreadySubmitted = await isExamSubmitted(studentId, examId);
        if (alreadySubmitted) {
            return res.json({
                success: false,
                submitted: true,
                message: "Exam already submitted. Autosave is locked."
            });
        }

        const walkinRows = await queryAsync(
            `SELECT walkin_exam_id FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
            [examId]
        );
        const isWalkinExam = Boolean(walkinRows && walkinRows.length > 0);

        if (isWalkinExam) {
            await ensureWalkinAnswerSectionColumn();
            await ensureWalkinAnswerSubmittedColumn();
            await db.withTransaction(async (txQuery) => {
                for (const answer of normalizedAnswers) {
                    const sectionLabel = normalizeWalkinSectionLabel(answer.sectionName, answer.qType);
                    const storedQuestionType = normalizeWalkinStoredQuestionType(answer.qType);
                    const passCountForStore =
                        storedQuestionType === "Coding" && Number.isFinite(Number(answer.testcasesPassed))
                            ? Math.max(0, Number(answer.testcasesPassed))
                            : 0;
                    await txQuery(
                        `INSERT INTO walkin_student_answers
                         (student_id, exam_id, question_id, section_name, question_type, selected_option, descriptive_answer, code, testcases_passed, marks_obtained, is_submitted)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
                         ON CONFLICT (student_id, exam_id, question_id, question_type)
                         DO UPDATE SET
                            section_name = EXCLUDED.section_name,
                            selected_option = EXCLUDED.selected_option,
                            descriptive_answer = EXCLUDED.descriptive_answer,
                            code = EXCLUDED.code,
                            testcases_passed = EXCLUDED.testcases_passed,
                            marks_obtained = 0,
                            is_submitted = FALSE`,
                        [
                            studentId,
                            examId,
                            answer.questionId,
                            sectionLabel,
                            storedQuestionType,
                            answer.selectedOption,
                            answer.descriptiveAnswer,
                            answer.codePayload,
                            passCountForStore,
                            0
                        ]
                    );
                }
            });

            return res.json({ success: true, saved: normalizedAnswers.length });
        }
        // Draft autosave is disabled for regular regular_exams.
        return res.json({ success: true, saved: 0 });
    } catch (error) {
        console.error("Exam autosave error:", error);
        return res.status(500).json({ success: false, message: "Could not autosave answers" });
    }
});

/* ================= SUBMIT EXAM ================= */
router.post("/submit", async (req, res) => {
    const { studentId, examId, answers, studentExamId } = req.body;
    let submittedAnswers = Array.isArray(answers) ? answers : [];
    let walkinLoadedFromLiveRows = false;
    const requestedForceSubmit = Boolean(req.body?.forceSubmit);
    const requestedForceReason = String(req.body?.forceReason || "").trim().toUpperCase();
    const isViolationAutoSubmit = requestedForceSubmit && requestedForceReason === "VIOLATION_LIMIT";
    let autoSubmitReason = isViolationAutoSubmit ? "VIOLATION_LIMIT" : null;

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
        const alreadySubmitted = await isExamSubmitted(Number(studentId), Number(examId));
        if (alreadySubmitted) {
            return res.json({
                success: true,
                alreadySubmitted: true,
                message: "Exam already submitted"
            });
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
        if (!submittedAnswers || submittedAnswers.length === 0) {
            if (isWalkin && isWalkinExamId) {
                await ensureWalkinAnswerSubmittedColumn();
                const liveRows = await queryAsync(
                    `SELECT question_id, section_name, question_type, selected_option, descriptive_answer, code, testcases_passed
                     FROM walkin_student_answers
                     WHERE student_id = ? AND exam_id = ? AND is_submitted = FALSE
                     ORDER BY submission_id DESC`,
                    [studentId, examIdNum]
                );
                submittedAnswers = mapWalkinRowsToAnswers(liveRows);
                walkinLoadedFromLiveRows = true;
            } else {
                submittedAnswers = [];
            }
        }
        if (!submittedAnswers || submittedAnswers.length === 0) {
            const allowEmptyWalkinAutoSubmit =
                isWalkin && isWalkinExamId && (autoSubmitReason === "TIME_OVER" || autoSubmitReason === "VIOLATION_LIMIT");
            if (!allowEmptyWalkinAutoSubmit) {
                return res.status(400).json({ success: false, message: "No answers available to submit." });
            }
            submittedAnswers = [];
        }
        if (!isWalkin) {
            const invalidAnswer = submittedAnswers.find((answer) => {
                const qType = String(answer?.question_type || "MCQ").trim().toUpperCase();
                const hasDescriptive = String(answer?.descriptive_answer || "").trim().length > 0;
                const hasCode = String(answer?.code || "").trim().length > 0;
                return qType !== "MCQ" || hasDescriptive || hasCode;
            });
            if (invalidAnswer) {
                return res.status(400).json({
                    success: false,
                    message: "Regular regular_exams accept only Aptitude/Technical MCQ answers."
                });
            }
        }
        let walkinStreamCode = "";
        if (isWalkin && isWalkinExamId) {
            const studentRows = await queryAsync(
                `SELECT status, course FROM students WHERE student_id = ? LIMIT 1`,
                [studentId]
            );
            const student = studentRows?.[0] || {};
            const isActive = String(student.status || "").trim().toUpperCase() === "ACTIVE";
            if (!isActive) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            const examStreamCode = normalizeWalkinStream(walkinExamRows?.[0]?.stream || "");
            const studentStreamCode = normalizeWalkinStream(student.course || "");
            if (!examStreamCode || !studentStreamCode || examStreamCode !== studentStreamCode) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            walkinStreamCode = examStreamCode;
            req.session.student.walkinExamId = examIdNum;
        }

        let effectiveStudentExamId = null;
        let regularDurationMinutes = null;
        let regularStartedAt = null;
        let walkinExpiredBeyondGrace = false;
        if (!isWalkin) {
            const regularStudentRows = await queryAsync(
                `SELECT status, course
                 FROM students
                 WHERE student_id = ?
                 LIMIT 1`,
                [studentId]
            );
            const regularStudent = regularStudentRows?.[0] || {};
            const isStudentActive = String(regularStudent.status || "").trim().toUpperCase() === "ACTIVE";
            if (!isStudentActive) {
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            const studentCourse = String(regularStudent.course || "").trim();
            const latestRegularExam = await fetchLatestReadyRegularExamForCourse(studentCourse);
            if (!latestRegularExam) {
                return res.status(404).json({ success: false, message: "No READY exam found for this course." });
            }
            if (Number(latestRegularExam.exam_id || 0) !== Number(examId)) {
                return res.status(403).json({ success: false, message: "Submit allowed only for latest course exam." });
            }

            const regularExamRows = await queryAsync(
                `SELECT exam_id, exam_status, start_at, end_at
                 FROM regular_exams
                 WHERE exam_id = ?
                 LIMIT 1`,
                [examId]
            );
            const regularExam = regularExamRows?.[0] || null;
            if (!regularExam) {
                return res.status(404).json({ success: false, message: "Exam not found" });
            }
            if (String(regularExam.exam_status || "").trim().toUpperCase() !== "READY") {
                return res.status(400).json({ success: false, message: "Exam is not ready" });
            }
            const regularStartMs = new Date(regularExam.start_at).getTime();
            const regularEndMs = new Date(regularExam.end_at).getTime();
            const regularNowMs = Date.now();
            if (Number.isFinite(regularStartMs) && regularNowMs < regularStartMs) {
                return res.status(400).json({ success: false, message: "Exam has not started yet." });
            }
            if (Number.isFinite(regularEndMs) && regularNowMs > regularEndMs) {
                return res.status(400).json({ success: false, message: "Exam time is over. Submission window closed." });
            }

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
                    const duplicate =
                        Number(insertError?.errno) === 1062 ||
                        String(insertError?.code || "").toUpperCase() === "23505" ||
                        /duplicate key/i.test(String(insertError?.message || ""));
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
            await queryAsync(
                `UPDATE regular_student_exam
                 SET started_at = COALESCE(started_at, NOW())
                 WHERE student_id = ?
                   AND exam_id = ?`,
                [studentId, examId]
            );

            const timerRows = await queryAsync(
                `SELECT rse.started_at, e.duration_minutes
                 FROM regular_student_exam rse
                 JOIN regular_exams e ON e.exam_id = rse.exam_id
                 WHERE rse.student_id = ?
                   AND rse.exam_id = ?
                 LIMIT 1`,
                [studentId, examId]
            );
            regularStartedAt = timerRows?.[0]?.started_at || null;
            regularDurationMinutes = Number(timerRows?.[0]?.duration_minutes || 0) || null;
            if (regularDurationMinutes && regularDurationMinutes > 0 && regularStartedAt) {
                const expiryRows = await queryAsync(
                    `SELECT NOW() > ($1::timestamp + ($2::int * INTERVAL '1 minute')) AS expired`,
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
        if (isWalkin) {
            await ensureWalkinStudentExamTable();
            try {
                await queryAsync(
                    `INSERT INTO walkin_student_exam (student_id, exam_id) VALUES (?, ?)`,
                    [studentId, examIdNum]
                );
            } catch (insertError) {
                const duplicate =
                    Number(insertError?.errno) === 1062 ||
                    String(insertError?.code || "").toUpperCase() === "23505" ||
                    /duplicate key/i.test(String(insertError?.message || ""));
                if (!duplicate) throw insertError;
            }
            await queryAsync(
                `UPDATE walkin_student_exam
                 SET started_at = COALESCE(started_at, NOW())
                 WHERE student_id = ?
                   AND exam_id = ?`,
                [studentId, examIdNum]
            );
            const walkinTimerRows = await queryAsync(
                `SELECT started_at
                 FROM walkin_student_exam
                 WHERE student_id = ?
                   AND exam_id = ?
                 LIMIT 1`,
                [studentId, examIdNum]
            );
            const walkinStartedAt = walkinTimerRows?.[0]?.started_at || null;
            const walkinDurationMinutes = getWalkinDurationMinutes(walkinStreamCode);
            if (walkinDurationMinutes && walkinDurationMinutes > 0 && walkinStartedAt) {
                const expiryRows = await queryAsync(
                    `SELECT
                        NOW() > ($1::timestamp + ($2::int * INTERVAL '1 minute')) AS expired,
                        NOW() > ($1::timestamp + ($2::int * INTERVAL '1 minute') + ($3::int * INTERVAL '1 second')) AS expired_beyond_grace`,
                    [walkinStartedAt, walkinDurationMinutes, WALKIN_SUBMIT_GRACE_SECONDS]
                );
                const expiredBeyondGrace = Boolean(expiryRows?.[0]?.expired_beyond_grace);
                if (expiredBeyondGrace) {
                    walkinExpiredBeyondGrace = true;
                    autoSubmitReason = "TIME_OVER";
                    await ensureWalkinAnswerSubmittedColumn();
                    const liveRows = await queryAsync(
                        `SELECT question_id, section_name, question_type, selected_option, descriptive_answer, code,
                                testcases_passed
                         FROM walkin_student_answers
                         WHERE student_id = ? AND exam_id = ? AND is_submitted = FALSE
                         ORDER BY submission_id DESC`,
                        [studentId, examIdNum]
                    );
                    const liveAnswers = mapWalkinRowsToAnswers(liveRows);
                    if (liveAnswers.length > 0) {
                        submittedAnswers = liveAnswers;
                        walkinLoadedFromLiveRows = true;
                    }
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
                FROM regular_exams
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
            const hasCodingAnswer = submittedAnswers.some(
                (answer) => {
                    const qType = String(answer?.question_type || "").trim().toUpperCase();
                    const section = String(answer?.section_name || "").trim().toUpperCase();
                    const hasCodePayload = String(answer?.code || "").trim().length > 0;
                    return qType === "CODING" || section.includes("CODING") || hasCodePayload;
                }
            );
            if (hasCodingAnswer) {
                return res.status(400).json({
                    success: false,
                    message: "Coding section is not allowed for Data Analytics walk-in regular_exams"
                });
            }
        }
        for (const answer of submittedAnswers) {
            const questionType = String(answer?.question_type || "").toUpperCase();
            if (questionType !== "DESCRIPTIVE") continue;
            if (autoSubmitReason) continue;
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
        if (isWalkin) {
            await ensureWalkinSummaryColumn();
            await ensureWalkinAttemptedAtColumn();
            await ensureWalkinAnswerSectionColumn();
            await ensureWalkinAnswerSubmittedColumn();
        }

        await db.withTransaction(async (txQuery) => {
        const queryAsync = txQuery;

        const walkinSql = `
            INSERT INTO walkin_student_answers
            (student_id, exam_id, question_id, section_name, question_type, selected_option, descriptive_answer, code, testcases_passed, marks_obtained, is_submitted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
            ON CONFLICT (student_id, exam_id, question_id, question_type)
            DO UPDATE SET
                section_name = EXCLUDED.section_name,
                selected_option = EXCLUDED.selected_option,
                descriptive_answer = EXCLUDED.descriptive_answer,
                code = EXCLUDED.code,
                testcases_passed = EXCLUDED.testcases_passed,
                marks_obtained = 0,
                is_submitted = FALSE
        `;

        const regularSql = `
            INSERT INTO regular_student_answers
            (student_id, question_id, selected_option, exam_id)
            VALUES (?, ?, ?, ?)
        `;

        if (isWalkin) {
            effectiveExamIdNum = examIdNum;
            req.session.student.walkinExamId = examIdNum;
        }

        for (const a of submittedAnswers) {
            if (isWalkin) {
                if (walkinLoadedFromLiveRows) continue;
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
                let passCountForStore = 0;

                if (questionType === "CODING") {
                    passCountForStore = Number.isFinite(rawPassCount)
                        ? Math.max(0, rawPassCount)
                        : 0;
                }

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
                    0
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

        if (!isWalkin) {
            await ensureResultsSubmittedAtColumn();
            await queryAsync(
                `INSERT INTO regular_student_results (student_id, exam_id, attempt_status, submitted_at)
                 VALUES (?, ?, 'SUBMITTED', NOW())`,
                [studentId, examId]
            );
        }
        await queryAsync(
            `UPDATE students
             SET status = 'INACTIVE'
             WHERE student_id = ?`,
            [studentId]
        );
        if (isWalkin) {
            await queryAsync(
                `UPDATE walkin_student_answers
                 SET is_submitted = TRUE
                 WHERE student_id = ?
                   AND exam_id = ?
                   AND is_submitted = FALSE`,
                [studentId, effectiveExamIdNum]
            );
        }
        });

        let walkinResultProcessing = false;
        if (isWalkin) {
            try {
                await runWalkinPostSubmitProcessing(Number(studentId), Number(effectiveExamIdNum));
            } catch (postProcessError) {
                walkinResultProcessing = true;
                console.error("Walk-in post-submit processing error:", postProcessError);
                setImmediate(async () => {
                    try {
                        await runWalkinPostSubmitProcessing(Number(studentId), Number(effectiveExamIdNum));
                    } catch (retryError) {
                        console.error("Walk-in post-submit processing retry error:", retryError);
                    }
                });
            }
        }

        return res.json({
            success: true,
            message:
                autoSubmitReason === "TIME_OVER"
                    ? "Exam auto-submitted from latest saved answers after time over."
                    : (autoSubmitReason === "VIOLATION_LIMIT"
                        ? "Exam auto-submitted due to violation limit."
                        : "Exam submitted successfully"),
            studentExamId: effectiveStudentExamId,
            examId: isWalkin ? Number(effectiveExamIdNum) : Number(examIdNum),
            autoSubmitted: Boolean(autoSubmitReason),
            reason: autoSubmitReason,
            resultProcessing: walkinResultProcessing
        });
    } catch (error) {
        if (Number(error?.statusCode || 0) === 400) {
            return res.status(400).json({ success: false, message: error.message || "Validation failed" });
        }
        console.error("Submit exam error:", error);
        return res.status(500).json({ success: false, message: "Submission failed" });
    }
});

/* ================= WALK-IN FEEDBACK ================= */
router.post("/feedback", async (req, res) => {
    const studentId = Number(req.session?.student?.studentId || 0);
    const bodyStudentId = Number(req.body?.studentId || 0);
    const examId = Number(req.body?.examId || req.body?.walkinExamId || 0);
    const feedbackText = String(req.body?.feedbackText || "").trim();
    const questionText = String(req.body?.questionText || "").trim();
    const modeRaw = String(req.body?.submissionMode || "MANUAL").trim().toUpperCase();
    const submissionMode = modeRaw === "AUTO_SUBMIT" ? "AUTO_SUBMIT" : "MANUAL";

    if (!studentId || !bodyStudentId || !examId) {
        return res.status(400).json({ success: false, message: "Missing required feedback context." });
    }
    if (studentId !== bodyStudentId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (!feedbackText) {
        return res.status(400).json({ success: false, message: "Feedback is required." });
    }

    const words = countWords(feedbackText);
    if (words > 100) {
        return res.status(400).json({ success: false, message: "Feedback cannot exceed 100 words." });
    }

    try {
        const walkinRows = await queryAsync(
            `SELECT walkin_exam_id
             FROM walkin_exams
             WHERE walkin_exam_id = ?
             LIMIT 1`,
            [examId]
        );
        if (walkinRows?.length) {
            const processingState = await getWalkinResultProcessingState(studentId, examId);
            if (!processingState.ready) {
                if (processingState.processing) {
                    return res.status(409).json({
                        success: false,
                        code: "result_processing",
                        message: "Result is processing. Please retry in a few seconds."
                    });
                }
                return res.status(400).json({ success: false, message: "Feedback can be submitted only after exam submission." });
            }

            await queryAsync(
                `INSERT INTO walkin_exam_feedback
                 (student_id, walkin_exam_id, feedback_text, submission_mode)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (student_id, walkin_exam_id)
                 DO UPDATE SET
                    feedback_text = EXCLUDED.feedback_text,
                    submission_mode = EXCLUDED.submission_mode`,
                [
                    studentId,
                    examId,
                    feedbackText,
                    submissionMode
                ]
            );
            return res.json({ success: true });
        }

        const regularExamRows = await queryAsync(
            `SELECT exam_id
             FROM regular_exams
             WHERE exam_id = ?
             LIMIT 1`,
            [examId]
        );
        if (!regularExamRows?.length) {
            return res.status(400).json({ success: false, message: "Invalid exam id." });
        }

        const submittedRows = await queryAsync(
            `SELECT 1
             FROM regular_student_results
             WHERE student_id = ?
               AND exam_id = ?
             LIMIT 1`,
            [studentId, examId]
        );
        if (!submittedRows?.length) {
            return res.status(400).json({ success: false, message: "Feedback can be submitted only after exam submission." });
        }

        await ensureRegularExamFeedbackTable();
        await queryAsync(
            `INSERT INTO regular_exam_feedback
             (student_id, exam_id, question_text, feedback_text, submission_mode)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (student_id, exam_id)
             DO UPDATE SET
                question_text = EXCLUDED.question_text,
                feedback_text = EXCLUDED.feedback_text,
                submission_mode = EXCLUDED.submission_mode,
                submitted_at = NOW()`,
            [
                studentId,
                examId,
                questionText || "Tell us about the exam, question quality, and overall difficulty.",
                feedbackText,
                submissionMode
            ]
        );

        return res.json({ success: true });
    } catch (error) {
        console.error("Walk-in feedback save error:", error);
        return res.status(500).json({ success: false, message: "Could not save feedback." });
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
        SELECT walkin_exam_id, stream::text AS stream, stream_code::text AS stream_code
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
                (async () => {
                    try {
                        let processingState = await getWalkinResultProcessingState(Number(studentId), Number(examId));
                        if (!processingState.ready && processingState.processing) {
                            try {
                                await runWalkinPostSubmitProcessing(Number(studentId), Number(examId));
                                processingState = await getWalkinResultProcessingState(Number(studentId), Number(examId));
                            } catch (processError) {
                                console.warn("Walk-in result finalization warning:", processError);
                            }
                        }
                        if (!processingState.ready && processingState.processing) {
                            return res.status(409).json({
                                success: false,
                                code: "result_processing",
                                message: "Result is processing. Please retry in a few seconds."
                            });
                        }

                        let rows = await queryAsync(
                            `
                            SELECT total_marks, performance_summary
                            FROM walkin_final_results
                            WHERE student_id = ?
                              AND exam_id = ?
                            LIMIT 1
                            `,
                            [studentId, examId]
                        );

                        const summaryText = String(rows?.[0]?.performance_summary || "");
                        const needsFinalize =
                            rows?.length &&
                            /provisional summary generated at submission time/i.test(summaryText);
                        if (needsFinalize) {
                            await runWalkinPostSubmitProcessing(Number(studentId), Number(examId));
                            rows = await queryAsync(
                                `
                                SELECT total_marks, performance_summary
                                FROM walkin_final_results
                                WHERE student_id = ?
                                  AND exam_id = ?
                                LIMIT 1
                                `,
                                [studentId, examId]
                            );
                        }

                        const totalMarks = Number(rows?.[0]?.total_marks || 0);
                        const streamCode = normalizeWalkinStream(
                            walkinRows?.[0]?.stream_code || walkinRows?.[0]?.stream || ""
                        );
                        const streamQuestionKey = String(getWalkinStreamQuestionKey(streamCode) || "").toLowerCase();
                        const streamLabelCompact = String(getWalkinStreamLabel(streamCode) || "")
                            .toLowerCase()
                            .replace(/[^a-z0-9]/g, "");
                        const streamCodeCompact = String(streamCode || "").toLowerCase();
                        const includeCoding = streamCode !== "DA";
                        const maxRows = await queryAsync(
                            `
                            SELECT
                                COALESCE((SELECT SUM(marks) FROM walkin_aptitude_questions), 0)
                                + COALESCE((
                                    SELECT SUM(marks)
                                    FROM walkin_stream_questions
                                    WHERE REGEXP_REPLACE(LOWER(COALESCE(stream::text, '')), '[^a-z0-9]+', '', 'g') IN (?, ?, ?)
                                ), 0)
                                ${includeCoding ? `+ COALESCE((SELECT SUM(marks) FROM walkin_coding_questions), 0)` : ""}
                                AS max_marks
                            `,
                            [streamQuestionKey, streamCodeCompact, streamLabelCompact]
                        );
                        const maxMarks = Number(maxRows?.[0]?.max_marks || 0);
                        const scorePercent =
                            maxMarks > 0 ? Number(((totalMarks / maxMarks) * 100).toFixed(2)) : null;
                        return res.json({
                            success: true,
                            totalMarks,
                            scorePercent
                        });
                    } catch (error) {
                        console.error("Walk-in result lookup error:", error);
                        return res.json({ success: false, message: "Server error" });
                    }
                })();
                return;
            }

            db.query(
                `SELECT COUNT(*) AS total FROM regular_exam_questions WHERE exam_id = ?`,
                [examId],
                (err, totalRows) => {
            if (err) {
                console.error("Result total error:", err);
                return res.json({ success: false, message: "Server error" });
            }

            const total = totalRows?.[0]?.total || 0;
            if (total === 0) {
                return res.json({ success: false, message: "No regular_exam_questions found" });
            }

            db.query(
                `
                SELECT COUNT(*) AS correct
                FROM regular_student_answers sa
                JOIN regular_exam_questions q ON sa.question_id = q.question_id
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



