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
    STREAM_BY_CODE,
    getCanonicalWalkinStreamCode,
    getWalkinStreamCodeOrDefault,
    getWalkinStreamQuestionKey,
    getWalkinStreamLabel,
    isWalkinCodingEnabled
} = require("../utils/walkinStream");
const { getRegularTechnicalSection } = require("../utils/courseBackground");

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
let walkinSubmissionColumnsChecked = false;
let regularStudentExamTableChecked = false;
let regularExamFeedbackTableChecked = false;
let resultsSubmittedAtColumnChecked = false;
let resultsSubmissionColumnsChecked = false;
let resultsFeedbackColumnsChecked = false;
let walkinStudentExamTableChecked = false;
let walkinAnswerSectionColumnChecked = false;
let walkinAnswerSubmittedColumnChecked = false;
let walkinAnswerCodingLanguageColumnChecked = false;
const REGULAR_START_GRACE_MINUTES = 10;
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
const isWalkinSessionStudent = (req) => isWalkinStudentType(req.session?.student?.studentType);
const getWalkinDurationMinutes = (streamCode) => {
    if (streamCode === "DS") return 60;
    if (streamCode === "DA") return 50;
    if (streamCode === "AAI") return 60;
    if (streamCode === "INT") return 90;
    return 80; // MERN default
};
const normalizeSubmissionReason = (forceSubmit, rawReason) => {
    if (!forceSubmit) return "MANUAL";
    const normalized = String(rawReason || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (["TIME_OVER", "TIMEOUT", "TIME_UP", "TIMER_OVER"].includes(normalized)) {
        return "TIME_OVER";
    }
    if (["VIOLATION", "VIOLATION_LIMIT", "PROCTORING_VIOLATION", "SECURITY_VIOLATION"].includes(normalized)) {
        return "VIOLATION_LIMIT";
    }
    return "AUTO_SUBMIT";
};
const getSubmissionMode = (reason) => reason === "MANUAL" ? "MANUAL" : "AUTO_SUBMIT";
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

const normalizeCodeExecutionOutput = (value) =>
    String(value ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n+$/g, "");

const normalizeOutputForComparison = (value, questionId) => {
    const normalized = normalizeCodeExecutionOutput(value);
    
    // For question 2 (number pyramid), remove spaces within each line
    // but preserve the line structure
    if (questionId === 2) {
        return normalized
            .split("\n")
            .map(line => line.replace(/\s+/g, "")) // Remove all spaces within the line
            .join("\n");
    }
    
    return normalized;
};

const addMinutes = (dateValue, minutes) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getTime() + (Number(minutes || 0) * 60 * 1000));
};

const getRegularExamTiming = (regularExam, nowMs = Date.now()) => {
    const startAt = new Date(regularExam?.start_at || "");
    const durationMinutes = Math.max(1, Number(regularExam?.duration_minutes || 60) || 60);
    if (Number.isNaN(startAt.getTime())) {
        return null;
    }

    const questionUnlockAt = addMinutes(startAt, REGULAR_START_GRACE_MINUTES);
    const submissionDeadlineAt = addMinutes(questionUnlockAt, durationMinutes);
    if (!questionUnlockAt || !submissionDeadlineAt) {
        return null;
    }

    const startAtMs = startAt.getTime();
    const questionUnlockAtMs = questionUnlockAt.getTime();
    const submissionDeadlineMs = submissionDeadlineAt.getTime();
    const beforeStart = nowMs < startAtMs;
    const withinInstructionWindow = nowMs >= startAtMs && nowMs < questionUnlockAtMs;
    const withinQuestionWindow = nowMs >= questionUnlockAtMs && nowMs <= submissionDeadlineMs;

    return {
        startGraceMinutes: REGULAR_START_GRACE_MINUTES,
        questionDurationMinutes: durationMinutes,
        startAt: startAt.toISOString(),
        lateStartDeadlineAt: questionUnlockAt.toISOString(),
        questionUnlockAt: questionUnlockAt.toISOString(),
        submissionDeadlineAt: submissionDeadlineAt.toISOString(),
        startsInSeconds: beforeStart ? Math.max(0, Math.ceil((startAtMs - nowMs) / 1000)) : 0,
        unlockInSeconds: withinInstructionWindow ? Math.max(0, Math.ceil((questionUnlockAtMs - nowMs) / 1000)) : 0,
        remainingQuestionSeconds: withinQuestionWindow ? Math.max(0, Math.ceil((submissionDeadlineMs - nowMs) / 1000)) : 0,
        canStart: nowMs >= startAtMs && nowMs <= questionUnlockAtMs,
        instructionWindowActive: withinInstructionWindow,
        questionsVisible: nowMs >= questionUnlockAtMs,
        submissionClosed: nowMs > submissionDeadlineMs,
        lateStartClosed: nowMs > questionUnlockAtMs
    };
};

const fetchLatestReadyRegularExamForCollege = async (collegeId) => {
    return rows?.[0] || null;
};

const fetchActiveRegularQuestionSet = async (examId, txQuery = queryAsync) => {
    const rows = await txQuery(
        `SELECT question_set_id
         FROM regular_question_sets
         WHERE exam_id = ?
           AND set_status = 'ACTIVE'
         ORDER BY generated_at DESC, question_set_id DESC
         LIMIT 1`,
        [examId]
    );
    return Number(rows?.[0]?.question_set_id || 0) || null;
};

const ensureRegularStudentQuestionSet = async ({ studentId, examId, requestedStudentExamId = 0, txQuery = queryAsync }) => {
    await ensureRegularStudentExamTable();

    let rows = [];
    if (Number(requestedStudentExamId || 0) > 0) {
        rows = await txQuery(
            `SELECT student_exam_id, question_set_id, started_at
             FROM regular_student_exam
             WHERE student_exam_id = ?
               AND student_id = ?
               AND exam_id = ?
             LIMIT 1`,
            [requestedStudentExamId, studentId, examId]
        );
    } else {
        rows = await txQuery(
            `SELECT student_exam_id, question_set_id, started_at
             FROM regular_student_exam
             WHERE student_id = ?
               AND exam_id = ?
             LIMIT 1`,
            [studentId, examId]
        );
    }

    if (!rows?.length) {
        try {
            await txQuery(
                `INSERT INTO regular_student_exam (student_id, exam_id) VALUES (?, ?)`,
                [studentId, examId]
            );
        } catch (insertError) {
            
                Number(insertError?.errno) === 1062 ||
                String(insertError?.code || "").toUpperCase() === "23505" ||
                /duplicate key/i.test(String(insertError?.message || ""));
            if (!duplicate) throw insertError;
        }
        rows = await txQuery(
            `SELECT student_exam_id, question_set_id, started_at
             FROM regular_student_exam
             WHERE student_id = ?
               AND exam_id = ?
             LIMIT 1`,
            [studentId, examId]
        );
    }

    const studentExamId = Number(rows?.[0]?.student_exam_id || 0) || null;
    let questionSetId = Number(rows?.[0]?.question_set_id || 0) || null;
    if (!questionSetId) {
        questionSetId = await fetchActiveRegularQuestionSet(examId, txQuery);
        if (!questionSetId) {
            throw new Error("NO_ACTIVE_REGULAR_QUESTION_SET");
        }
    }

    await txQuery(
        `UPDATE regular_student_exam
         SET started_at = COALESCE(started_at, NOW()),
             question_set_id = COALESCE(question_set_id, ?)
         WHERE student_id = ?
           AND exam_id = ?`,
        [questionSetId, studentId, examId]
    );

    return { studentExamId, questionSetId };
};

const fetchRegularStudentAttempt = async ({ studentId, examId, requestedStudentExamId = 0, txQuery = queryAsync }) => {
    await ensureRegularStudentExamTable();
    const params = [];
    let sql =
        `SELECT student_exam_id, question_set_id, started_at
         FROM regular_student_exam
         WHERE student_id = ?
           AND exam_id = ?`;
    params.push(studentId, examId);
    if (Number(requestedStudentExamId || 0) > 0) {
        sql += ` AND student_exam_id = ?`;
        params.push(requestedStudentExamId);
    }
    sql += ` LIMIT 1`;
    const rows = await txQuery(sql, params);
    return rows?.[0] || null;
};

const loadRegularSavedAnswers = async ({ studentId, examId, questionSetId, txQuery = queryAsync }) => {
    if (!studentId || !examId || !questionSetId) return [];
    return await txQuery(
        `SELECT sa.question_id,
                sa.selected_option,
                q.question_type,
                q.section_name
         FROM regular_student_answers sa
         JOIN regular_exam_questions q
           ON q.exam_id = sa.exam_id
          AND q.question_set_id = sa.question_set_id
          AND q.question_id = sa.question_id
         WHERE sa.student_id = ?
           AND sa.exam_id = ?
           AND sa.question_set_id = ?`,
        [studentId, examId, questionSetId]
    );
};

const mergeRegularSubmittedAnswers = ({ payloadAnswers = [], savedRows = [] }) => {
    const merged = new Map();

    savedRows.forEach((row) => {
        const questionId = Number(row?.question_id || 0);
        if (!questionId) return;
        const selectedOption = String(row?.selected_option || "").trim().toUpperCase();
        if (!selectedOption) return;
        merged.set(questionId, {
            question_id: questionId,
            question_type: String(row?.question_type || "MCQ").trim().toLowerCase(),
            section_name: String(row?.section_name || "").trim(),
            selected_option: selectedOption
        });
    });

    payloadAnswers.forEach((answer) => {
        const questionId = Number(answer?.question_id || 0);
        if (!questionId) return;
        const selectedOption = String(answer?.selected_option || "").trim().toUpperCase();
        if (!selectedOption) {
            merged.delete(questionId);
            return;
        }
        merged.set(questionId, {
            question_id: questionId,
            question_type: String(answer?.question_type || "MCQ").trim().toLowerCase(),
            section_name: String(answer?.section_name || "").trim(),
            selected_option: selectedOption
        });
    });

    return [...merged.values()];
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
                stdout: normalizeCodeExecutionOutput(stdout),
                stderr: normalizeCodeExecutionOutput(stderr),
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
                    stdout: normalizeCodeExecutionOutput(stdout),
                    stderr: normalizeCodeExecutionOutput(stderr),
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

const LEETCODE_CODING_CONFIGS = {
    1: {
        methodName: "reverseString",
        title: "Reverse String"
    },
    2: {
        methodName: "numberPyramid",
        title: "Number Pyramid"
    },
    3: {
        methodName: "twoSum",
        title: "Two Sum II"
    }
};

const hasCppMainFunction = (code) => /\bint\s+main\s*\(/i.test(String(code || ""));

const buildPythonLeetCodeWrapper = (code, questionId, methodName) => {
    const escapedMethodName = JSON.stringify(methodName);
    return `${code}

import ast as __lc_ast
import re as __lc_re
import inspect as __lc_inspect
import sys as __lc_sys

def __lc_parse_q1(raw):
    return raw.rstrip("\\n").rstrip("\\r")

def __lc_parse_q2(raw):
    value = raw.strip()
    return int(value) if value else 0

def __lc_parse_q3(raw):
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) >= 2:
        return __lc_ast.literal_eval(lines[0]), int(lines[1])
    numbers_match = __lc_re.search(r'numbers\\s*=\\s*(\\[[^\\]]*\\])', raw)
    target_match = __lc_re.search(r'target\\s*=\\s*(-?\\d+)', raw)
    if not numbers_match or not target_match:
        raise ValueError("Invalid testcase input for twoSum")
    return __lc_ast.literal_eval(numbers_match.group(1)), int(target_match.group(1))

def __lc_format(value):
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(str(item) for item in value) + "]"
    return str(value)

def __lc_pick_callable():
    method_name = ${escapedMethodName}
    solution_cls = globals().get("Solution")
    if __lc_inspect.isclass(solution_cls):
        instance = solution_cls()
        method = getattr(instance, method_name, None)
        if callable(method):
            return method
    free_fn = globals().get(method_name)
    if callable(free_fn):
        return free_fn
    return None

def __lc_args(question_id, raw):
    if question_id == 1:
        return (__lc_parse_q1(raw),)
    if question_id == 2:
        return (__lc_parse_q2(raw),)
    if question_id == 3:
        return __lc_parse_q3(raw)
    return (raw,)

def __lc_main():
    raw = __lc_sys.stdin.read()
    fn = __lc_pick_callable()
    if fn is None:
        return
    result = fn(*__lc_args(${Number(questionId || 0)}, raw))
    formatted = __lc_format(result)
    if formatted is not None:
        print(formatted)

if __name__ == "__main__":
    __lc_main()
`;
};

const buildJavascriptLeetCodeWrapper = (code, questionId, methodName) => {
    const escapedMethodName = JSON.stringify(methodName);
    return `${code}

const __lc_fs = require("fs");

function __lc_parseQ1(raw) {
    return raw.replace(/[\\r\\n]+$/, "");
}

function __lc_parseQ2(raw) {
    const value = raw.trim();
    return value ? Number(value) : 0;
}

function __lc_parseQ3(raw) {
    const lines = raw.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length >= 2) {
        return [JSON.parse(lines[0]), Number(lines[1])];
    }
    const numbersMatch = raw.match(/numbers\\s*=\\s*(\\[[^\\]]*\\])/);
    const targetMatch = raw.match(/target\\s*=\\s*(-?\\d+)/);
    if (!numbersMatch || !targetMatch) {
        throw new Error("Invalid testcase input for twoSum");
    }
    return [JSON.parse(numbersMatch[1]), Number(targetMatch[1])];
}

function __lc_format(value) {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return "[" + value.join(",") + "]";
    return String(value);
}

function __lc_pickCallable() {
    const methodName = ${escapedMethodName};
    if (typeof Solution === "function") {
        const instance = new Solution();
        if (typeof instance[methodName] === "function") {
            return instance[methodName].bind(instance);
        }
    }
    if (typeof globalThis[methodName] === "function") {
        return globalThis[methodName].bind(globalThis);
    }
    return null;
}

function __lc_args(questionId, raw) {
    if (questionId === 1) return [__lc_parseQ1(raw)];
    if (questionId === 2) return [__lc_parseQ2(raw)];
    if (questionId === 3) return __lc_parseQ3(raw);
    return [raw];
}

(async () => {
    const raw = __lc_fs.readFileSync(0, "utf8");
    const fn = __lc_pickCallable();
    if (!fn) return;
    const result = await fn(...__lc_args(${Number(questionId || 0)}, raw));
    const formatted = __lc_format(result);
    if (formatted !== null) {
        process.stdout.write(formatted);
    }
})();
`;
};

const buildCppLeetCodeWrapper = (code, questionId, methodName) => {
    const numericQuestionId = Number(questionId || 0);
    return `#include <bits/stdc++.h>
using namespace std;

static string __lc_read_all() {
    return string((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
}

static string __lc_rstrip_newlines(string value) {
    while (!value.empty() && (value.back() == '\\n' || value.back() == '\\r')) {
        value.pop_back();
    }
    return value;
}

static string __lc_trim(const string& value) {
    size_t start = 0;
    while (start < value.size() && isspace(static_cast<unsigned char>(value[start]))) start++;
    size_t end = value.size();
    while (end > start && isspace(static_cast<unsigned char>(value[end - 1]))) end--;
    return value.substr(start, end - start);
}

static vector<string> __lc_split_lines(const string& raw) {
    vector<string> lines;
    string current;
    stringstream ss(raw);
    while (getline(ss, current)) {
        string trimmed = __lc_trim(current);
        if (!trimmed.empty()) lines.push_back(trimmed);
    }
    return lines;
}

static vector<int> __lc_parse_int_array(string text) {
    vector<int> values;
    string number;
    for (char ch : text) {
        if (isdigit(static_cast<unsigned char>(ch)) || ch == '-') {
            number.push_back(ch);
        } else if (!number.empty()) {
            values.push_back(stoi(number));
            number.clear();
        }
    }
    if (!number.empty()) values.push_back(stoi(number));
    return values;
}

static pair<vector<int>, int> __lc_parse_q3(const string& raw) {
    auto lines = __lc_split_lines(raw);
    if (lines.size() >= 2) {
        return { __lc_parse_int_array(lines[0]), stoi(lines[1]) };
    }
    smatch numbersMatch;
    smatch targetMatch;
    regex numbersRegex(R"(numbers\\s*=\\s*(\\[[^\\]]*\\]))");
    regex targetRegex(R"(target\\s*=\\s*(-?\\d+))");
    if (!regex_search(raw, numbersMatch, numbersRegex) || !regex_search(raw, targetMatch, targetRegex)) {
        throw runtime_error("Invalid testcase input for twoSum");
    }
    return { __lc_parse_int_array(numbersMatch[1].str()), stoi(targetMatch[1].str()) };
}

static string __lc_format_vector(const vector<int>& values) {
    string out = "[";
    for (size_t i = 0; i < values.size(); ++i) {
        if (i) out += ",";
        out += to_string(values[i]);
    }
    out += "]";
    return out;
}

${code}

int main() {
    string raw = __lc_read_all();
    Solution sol;
${numericQuestionId === 1 ? `    auto result = sol.${methodName}(__lc_rstrip_newlines(raw));
    cout << result;` : ""}
${numericQuestionId === 2 ? `    auto result = sol.${methodName}(stoi(__lc_trim(raw)));
    cout << result;` : ""}
${numericQuestionId === 3 ? `    auto parsed = __lc_parse_q3(raw);
    auto result = sol.${methodName}(parsed.first, parsed.second);
    cout << __lc_format_vector(result);` : ""}
    return 0;
}
`;
};

const buildLeetCodeWrappedCode = (language, code, questionId) => {
    const config = LEETCODE_CODING_CONFIGS[Number(questionId || 0)];
    if (!config) return code;
    if (language === "python") {
        return buildPythonLeetCodeWrapper(code, questionId, config.methodName);
    }
    if (language === "javascript") {
        return buildJavascriptLeetCodeWrapper(code, questionId, config.methodName);
    }
    if (language === "cpp") {
        if (hasCppMainFunction(code)) {
            return code;
        }
        return buildCppLeetCodeWrapper(code, questionId, config.methodName);
    }
    return code;
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
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
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
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add attempted_at column:", msg);
        }
    } finally {
        walkinAttemptedAtColumnChecked = true;
    }
};

const ensureWalkinSubmissionColumns = async () => {
    if (walkinSubmissionColumnsChecked) return;
    const columns = [
        { name: "submission_mode", definition: "VARCHAR(20) NOT NULL DEFAULT 'MANUAL'" },
        { name: "submission_reason", definition: "VARCHAR(40) NOT NULL DEFAULT 'MANUAL'" }
    ];
    for (const column of columns) {
        try {
            await queryAsync(
                `ALTER TABLE walkin_final_results
                 ADD COLUMN ${column.name} ${column.definition}`
            );
        } catch (error) {
            const msg = String(error?.message || "");
            
                const duplicateColumn = Number(error?.errno) === 1060 ||
                String(error?.code || "").toUpperCase() === "42701" ||
                /duplicate column/i.test(msg) ||
                /already exists/i.test(msg);
            if (!duplicateColumn) {
                console.warn(`Could not add ${column.name} column to walkin_final_results:`, msg);
            }
        }
    }
    walkinSubmissionColumnsChecked = true;
};

const ensureRegularStudentExamTable = async () => {
    if (regularStudentExamTableChecked) return;
    
    try {
        
    } catch (error) {
        const msg = String(error?.message || "");
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            throw error;
        }
    }
    regularStudentExamTableChecked = true;
};

const ensureRegularExamFeedbackTable = async () => { return; };

const ensureResultsSubmittedAtColumn = async () => { return; };

const ensureResultsSubmissionColumns = async () => { return; };

const ensureResultsFeedbackColumns = async () => {
    if (resultsFeedbackColumnsChecked) return;
    const columns = [
        { name: "feedback_text", definition: "TEXT NULL" },
        { name: "feedback_question_text", definition: "TEXT NULL" },
        { name: "feedback_submission_mode", definition: "VARCHAR(20) NULL" }
    ];
    for (const column of columns) {
        try {
            
        } catch (error) {
            const msg = String(error?.message || "");
            
                const duplicateColumn = Number(error?.errno) === 1060 ||
                String(error?.code || "").toUpperCase() === "42701" ||
                /duplicate column/i.test(msg) ||
                /already exists/i.test(msg);
            if (!duplicateColumn) {
                throw error;
            }
        }
    }
    resultsFeedbackColumnsChecked = true;
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
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
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
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
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
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
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

const ensureWalkinAnswerCodingLanguageColumn = async () => {
    if (walkinAnswerCodingLanguageColumnChecked) return;
    try {
        await queryAsync(
            `ALTER TABLE walkin_student_answers
             ADD COLUMN coding_language VARCHAR(20) NULL`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        
            const duplicateColumn = Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add coding_language column to walkin_student_answers:", msg);
        }
    } finally {
        walkinAnswerCodingLanguageColumnChecked = true;
    }
};

const isExamSubmitted = async (studentId, examId, { walkin = false } = {}) => {
    if (walkin) {
        const statusRows = await queryAsync(
            `SELECT status FROM students WHERE student_id = ? LIMIT 1`,
            [studentId]
        );
        const statusLabel = String(statusRows?.[0]?.status || "").trim().toUpperCase();
        return statusLabel === "INACTIVE";
    }

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
            coding_language: String(row?.coding_language || "").trim().toLowerCase(),
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
        
            qType === "CODING"
                ? String(answer?.coding_language || "").trim().toLowerCase()
                : "";
        
            qType === "MCQ"
                ? String(answer?.selected_option || "").trim().toUpperCase().charAt(0) || null
                : null;
        
            qType === "DESCRIPTIVE"
                ? String(answer?.descriptive_answer || "")
                : null;
        
            qType === "CODING"
                ? String(answer?.code || "")
                : null;

        const parsedPassed = Number(answer?.testcases_passed);
        const parsedTotal = Number(answer?.testcases_total);
        
            qType === "CODING" && Number.isFinite(parsedPassed)
                ? parsedPassed
                : null;
        
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

const runWalkinPostSubmitProcessing = async (studentId, examId, submissionMeta = {}) => {
    await ensureWalkinSummaryColumn();
    await ensureWalkinAttemptedAtColumn();
    await ensureWalkinSubmissionColumns();
    await ensureWalkinAnswerSubmittedColumn();
    const submissionReason = normalizeSubmissionReason(
        String(submissionMeta?.mode || "").toUpperCase() === "AUTO_SUBMIT",
        submissionMeta?.reason
    );
    const submissionMode = getSubmissionMode(submissionReason);

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
            (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks, performance_summary, attempted_at, submission_mode, submission_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
            ON CONFLICT (student_id, exam_id) DO UPDATE SET
              aptitude_marks = EXCLUDED.aptitude_marks,
              technical_marks = EXCLUDED.technical_marks,
              coding_easy_marks = EXCLUDED.coding_easy_marks,
              coding_medium_marks = EXCLUDED.coding_medium_marks,
              coding_hard_marks = EXCLUDED.coding_hard_marks,
              total_marks = EXCLUDED.total_marks,
              performance_summary = EXCLUDED.performance_summary,
              attempted_at = COALESCE(walkin_final_results.attempted_at, EXCLUDED.attempted_at),
              submission_mode = CASE
                WHEN EXCLUDED.submission_reason = 'MANUAL' THEN COALESCE(walkin_final_results.submission_mode, EXCLUDED.submission_mode)
                ELSE EXCLUDED.submission_mode
              END,
              submission_reason = CASE
                WHEN EXCLUDED.submission_reason = 'MANUAL' THEN COALESCE(walkin_final_results.submission_reason, EXCLUDED.submission_reason)
                ELSE EXCLUDED.submission_reason
              END`,
            [
                studentId,
                examId,
                Number(aptitudeMarksTotal || 0),
                Number(technicalMarksTotal || 0),
                Number(codingEasyMarksTotal || 0),
                Number(codingMediumMarksTotal || 0),
                Number(codingHardMarksTotal || 0),
                totalMarks,
                performanceSummary,
                submissionMode,
                submissionReason
            ]
        );
    } catch (insertError) {
        const msg = String(insertError?.message || "");
        if (!/unknown column.*performance_summary/i.test(msg)) {
            throw insertError;
        }
        await queryAsync(
            `INSERT INTO walkin_final_results
            (student_id, exam_id, aptitude_marks, technical_marks, coding_easy_marks, coding_medium_marks, coding_hard_marks, total_marks, attempted_at, submission_mode, submission_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
            ON CONFLICT (student_id, exam_id) DO UPDATE SET
              aptitude_marks = EXCLUDED.aptitude_marks,
              technical_marks = EXCLUDED.technical_marks,
              coding_easy_marks = EXCLUDED.coding_easy_marks,
              coding_medium_marks = EXCLUDED.coding_medium_marks,
              coding_hard_marks = EXCLUDED.coding_hard_marks,
              total_marks = EXCLUDED.total_marks,
              attempted_at = COALESCE(walkin_final_results.attempted_at, EXCLUDED.attempted_at),
              submission_mode = CASE
                WHEN EXCLUDED.submission_reason = 'MANUAL' THEN COALESCE(walkin_final_results.submission_mode, EXCLUDED.submission_mode)
                ELSE EXCLUDED.submission_mode
              END,
              submission_reason = CASE
                WHEN EXCLUDED.submission_reason = 'MANUAL' THEN COALESCE(walkin_final_results.submission_reason, EXCLUDED.submission_reason)
                ELSE EXCLUDED.submission_reason
              END`,
            [
                studentId,
                examId,
                Number(aptitudeMarksTotal || 0),
                Number(technicalMarksTotal || 0),
                Number(codingEasyMarksTotal || 0),
                Number(codingMediumMarksTotal || 0),
                Number(codingHardMarksTotal || 0),
                totalMarks,
                submissionMode,
                submissionReason
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
        if (isWalkinSessionStudent(req)) {
            console.log(`[DEBUG] Walk-in start attempt: studentId=${studentId}, examId=${examId}`);
            const walkinRows = await queryAsync(
                `SELECT walkin_exam_id FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
                [examId]
            );
            if (!walkinRows?.length) {
                return res.status(404).json({ success: false, message: "Walk-in exam not found." });
            }
            const studentRows = await queryAsync(
                `SELECT status, course, student_type FROM students WHERE student_id = ? LIMIT 1`,
                [studentId]
            );
            const student = studentRows?.[0] || {};
            const isActive = String(student.status || "").trim().toUpperCase() === "ACTIVE";
            if (!isActive) {
                console.log(`[DEBUG] Walk-in start failed: Student ${studentId} is NOT active (status: ${student.status})`);
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
                console.log(`[DEBUG] Walk-in start failed: Stream mismatch. Student(${student.course})->${studentStreamCode} vs Exam(${examRows?.[0]?.stream})->${examStreamCode}`);
                return res.status(403).json({ success: false, message: "Forbidden" });
            }
            await ensureWalkinStudentExamTable();
            try {
                await queryAsync(
                    `INSERT INTO walkin_student_exam (student_id, exam_id) VALUES (?, ?)`,
                    [studentId, examId]
                );
            } catch (insertError) {
                
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
            `SELECT status, course, student_type, college_id
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
        const latestRegularExam = await fetchLatestReadyRegularExamForCollege(regularStudent.college_id);
        if (!latestRegularExam) {
            return res.status(404).json({ success: false, message: "No READY regular exam found." });
        }
        if (Number(latestRegularExam.exam_id || 0) !== Number(examId)) {
            return res.status(403).json({ success: false, message: "Only the latest regular exam can be started." });
        }
        const regularExam = latestRegularExam;
        const nowMs = Date.now();
        const timing = getRegularExamTiming(regularExam, nowMs);
        if (!timing) {
            return res.status(500).json({ success: false, message: "Invalid regular exam schedule." });
        }
        if (timing.startsInSeconds > 0) {
            const startsInSeconds = timing.startsInSeconds;
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
                lateStartDeadlineAt: timing.lateStartDeadlineAt,
                message: `Exam starts in ${parts.join(" ")}`
            });
        }
        if (timing.lateStartClosed) {
            return res.status(410).json({
                success: false,
                code: "exam_start_window_closed",
                lateStartDeadlineAt: timing.lateStartDeadlineAt,
                message: "The 10-minute start window is closed. You can no longer attend this regular exam."
            });
        }

        let regularAttempt;
        try {
            regularAttempt = await ensureRegularStudentQuestionSet({
                studentId,
                examId
            });
        } catch (questionSetError) {
            if (String(questionSetError?.message || "") === "NO_ACTIVE_REGULAR_QUESTION_SET") {
                return res.status(404).json({ success: false, message: "No active regular question set found." });
            }
            throw questionSetError;
        }

        return res.json({
            success: true,
            studentExamId: regularAttempt.studentExamId,
            timing
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
        if (isWalkinSessionStudent(req)) {
            const walkinRows = await queryAsync(
                `SELECT walkin_exam_id, stream FROM walkin_exams WHERE walkin_exam_id = ? LIMIT 1`,
                [examId]
            );
            if (!walkinRows?.length) {
                return res.status(404).json({ success: false, message: "Walk-in exam not found." });
            }
            const streamCode = normalizeWalkinStream(walkinRows?.[0]?.stream);
            return res.json({ success: true, durationMinutes: getWalkinDurationMinutes(streamCode) });
        }
        
        const exam = rows?.[0] || null;
        return res.json({
            success: true,
            durationMinutes: Number(exam?.duration_minutes || 0) || null,
            startGraceMinutes: REGULAR_START_GRACE_MINUTES,
            timing: getRegularExamTiming(exam)
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

    if (isWalkinSessionStudent(req)) {
        return db.query(
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
                return res.json({ attempted: false });
            }
        );
    }

    return res.json({ attempted: false });
});

/* ================= FETCH regular_exam_questions ================= */
router.get("/regular_exam_questions/:examId", (req, res) => {
    const examIdNum = Number(req.params.examId);
    if (!isWalkinSessionStudent(req)) {
        (async () => {
            try {
                const studentId = Number(req.session?.student?.studentId || 0);
                const studentRows = await queryAsync(
                    `SELECT status, course, student_type, background_type, college_id
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

                const latestRegularExam = await fetchLatestReadyRegularExamForCollege(student.college_id);
                if (!latestRegularExam) {
                    return res.status(404).json({ success: false, message: "No READY regular exam found." });
                }
                if (Number(latestRegularExam.exam_id || 0) !== Number(examIdNum)) {
                    return res.status(403).json({ success: false, message: "Only the latest regular exam questions are accessible." });
                }

                const nowMs = Date.now();
                const timing = getRegularExamTiming(latestRegularExam, nowMs);
                if (!timing) {
                    return res.status(500).json({ success: false, message: "Invalid regular exam schedule." });
                }
                if (timing.startsInSeconds > 0) {
                    return res.status(409).json({
                        success: false,
                        code: "exam_not_started",
                        startsAt: latestRegularExam.start_at,
                        now: new Date(nowMs).toISOString(),
                        startsInSeconds: timing.startsInSeconds,
                        message: "Exam has not started yet."
                    });
                }
                const existingAttempt = await fetchRegularStudentAttempt({ studentId, examId: examIdNum });
                if (!existingAttempt) {
                    return res.status(403).json({ success: false, message: "Start the exam first to access the question paper." });
                }
                if (timing.instructionWindowActive) {
                    return res.status(409).json({
                        success: false,
                        code: "instruction_window_active",
                        questionUnlockAt: timing.questionUnlockAt,
                        unlockInSeconds: timing.unlockInSeconds,
                        message: "Instructions are active. Questions will appear after the 10-minute start window closes."
                    });
                }
                if (timing.submissionClosed) {
                    return res.status(410).json({ success: false, message: "Exam window is closed." });
                }

                const allowedTechnicalSection = getRegularTechnicalSection(student.background_type);
                let questionSetId = null;
                try {
                    const attempt = await ensureRegularStudentQuestionSet({
                        studentId,
                        examId: examIdNum
                    });
                    questionSetId = attempt.questionSetId;
                } catch (questionSetError) {
                    if (String(questionSetError?.message || "") === "NO_ACTIVE_REGULAR_QUESTION_SET") {
                        return res.status(404).json({ success: false, message: "No active regular question set found." });
                    }
                    throw questionSetError;
                }
                return res.json(rows || []);
            } catch (error) {
                console.error("Fetch regular_exam_questions error:", error);
                return res.json([]);
            }
        })();
        return;
    }

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
                console.log(`[DEBUG] regular_exam_questions (walk-in): examId=${examIdNum}, stream=${walkinExam.stream}`);
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
                    const includeCoding = isWalkinCodingEnabled(streamCode);
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

            return res.json([]);
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
                WHEN 'agentic ai' THEN 4
                WHEN 'interns test' THEN 5
                ELSE 6
            END,
            stream
        `,
        (err, rows) => {
            if (err) {
                console.error("Walkin streams error:", err);
                return res.json([]);
            }
            const configuredStreams = Object.values(STREAM_BY_CODE).map((stream) => ({ stream }));
            const combined = [...configuredStreams, ...(Array.isArray(rows) ? rows : [])];
            const seen = new Set();
            const unique = combined.filter((row) => {
                const key = String(row?.stream || "").trim().toLowerCase();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            res.json(unique);
        }
    );
});

router.post("/run-code", async (req, res) => {
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const requestedLanguage = String(req.body?.language || "").trim().toLowerCase();
    const { code } = req.body || {};
    const questionId = Number(req.body?.questionId || 0);
    if (!requestedLanguage || !code) {
        return res.status(400).json({ success: false, message: "Missing language or code" });
    }
    if (!ALLOWED_CODING_LANGUAGES.has(requestedLanguage)) {
        return res.status(400).json({
            success: false,
            message: "Only Python, JavaScript, and C++ are supported right now."
        });
    }

    let testcases = [];
    if (questionId) {
        try {
            const rows = await queryAsync(
                `SELECT testcases FROM walkin_coding_questions WHERE question_id = ?`,
                [questionId]
            );
            if (rows.length && rows[0].testcases) {
                const parsed = typeof rows[0].testcases === "string"
                    ? JSON.parse(rows[0].testcases)
                    : rows[0].testcases;
                testcases = Array.isArray(parsed) ? parsed.slice(0, MAX_CODING_TESTCASES) : [];
            }
        } catch (tcErr) {
            console.warn("Could not load testcases for question", questionId, tcErr.message);
        }
    }
    try {
        const executableCode = buildLeetCodeWrappedCode(requestedLanguage, code, questionId);
        if (testcases.length) {
            const execution_results = [];
            for (const testcase of testcases) {
                
                    testcase.input === null || testcase.input === undefined
                        ? ""
                        : String(testcase.input);
                const result = await runCodeWithRunner(requestedLanguage, executableCode, testcaseInput);
                const stdoutNormalized = normalizeOutputForComparison(result.stdout, questionId);
                const expectedValue = testcase.expected_output;
                
                    expectedValue === null || expectedValue === undefined
                        ? ""
                        : normalizeOutputForComparison(expectedValue, questionId);

                execution_results.push({
                    input: testcase.input,
                    expected_output: testcase.expected_output,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    passed: stdoutNormalized === expectedNormalized,
                    timedOut: result.timedOut
                });
            }

            const passedCount = execution_results.filter((r) => r.passed).length;
            return res.json({
                success: true,
                testResults: execution_results,
                total: execution_results.length,
                passed: passedCount
            });
        }

        const result = await runCodeWithRunner(requestedLanguage, executableCode, req.body.input || "");
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
        const isWalkinExam = isWalkinSessionStudent(req);
        if (isWalkinExam) {
            await ensureWalkinAnswerSubmittedColumn();
            await ensureWalkinAnswerCodingLanguageColumn();
            const rows = await queryAsync(
                `SELECT question_id, section_name, question_type, selected_option, descriptive_answer, code,
                        coding_language,
                        testcases_passed, 0 AS testcases_total, submission_id AS updated_at
                 FROM walkin_student_answers
                 WHERE student_id = ? AND exam_id = ? AND is_submitted = FALSE
                 ORDER BY submission_id DESC`,
                [studentId, examId]
            );
            return res.json({ success: true, drafts: mapWalkinRowsToAnswers(rows) });
        }

        const attempt = await fetchRegularStudentAttempt({ studentId, examId });
        if (!attempt?.question_set_id) {
            return res.json({ success: true, drafts: [] });
        }
        const drafts = await loadRegularSavedAnswers({
            studentId,
            examId,
            questionSetId: Number(attempt.question_set_id || 0)
        });
        return res.json({ success: true, drafts });
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
        const alreadySubmitted = await isExamSubmitted(studentId, examId, {
            walkin: isWalkinSessionStudent(req)
        });
        if (alreadySubmitted) {
            return res.json({
                success: false,
                submitted: true,
                message: "Exam already submitted. Autosave is locked."
            });
        }

        const isWalkinExam = isWalkinSessionStudent(req);

        if (isWalkinExam) {
            await ensureWalkinAnswerSectionColumn();
            await ensureWalkinAnswerSubmittedColumn();
            await ensureWalkinAnswerCodingLanguageColumn();
            await db.withTransaction(async (txQuery) => {
                for (const answer of normalizedAnswers) {
                    const sectionLabel = normalizeWalkinSectionLabel(answer.sectionName, answer.qType);
                    const storedQuestionType = normalizeWalkinStoredQuestionType(answer.qType);
                    
                        storedQuestionType === "Coding" && Number.isFinite(Number(answer.testcasesPassed))
                            ? Math.max(0, Number(answer.testcasesPassed))
                            : 0;
                    await txQuery(
                        `INSERT INTO walkin_student_answers
                         (student_id, exam_id, question_id, section_name, question_type, selected_option, descriptive_answer, code, coding_language, testcases_passed, marks_obtained, is_submitted)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
                         ON CONFLICT (student_id, exam_id, question_id, question_type)
                         DO UPDATE SET
                            section_name = EXCLUDED.section_name,
                            selected_option = EXCLUDED.selected_option,
                            descriptive_answer = EXCLUDED.descriptive_answer,
                            code = EXCLUDED.code,
                            coding_language = EXCLUDED.coding_language,
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
                            answer.codingLanguage,
                            passCountForStore,
                            0
                        ]
                    );
                }
            });

            return res.json({ success: true, saved: normalizedAnswers.length });
        }
        const studentRows = await queryAsync(
            `SELECT status, college_id
             FROM students
             WHERE student_id = ?
             LIMIT 1`,
            [studentId]
        );
        const regularStudent = studentRows?.[0] || {};
        const latestRegularExam = await fetchLatestReadyRegularExamForCollege(regularStudent.college_id);
        if (!latestRegularExam || Number(latestRegularExam.exam_id || 0) !== examId) {
            return res.status(403).json({ success: false, message: "Autosave is allowed only for the latest regular exam." });
        }

        const attempt = await ensureRegularStudentQuestionSet({ studentId, examId });
        const questionSetId = Number(attempt.questionSetId || 0);
        const regularAnswers = normalizedAnswers
            .filter((answer) => String(answer.qType || "MCQ").trim().toUpperCase() === "MCQ")
            .map((answer) => ({
                questionId: Number(answer.questionId || 0),
                selectedOption: String(answer.selectedOption || "").trim().toUpperCase()
            }))
            .filter((answer) => answer.questionId > 0 && ["A", "B", "C", "D"].includes(answer.selectedOption));

        await db.withTransaction(async (txQuery) => {
            await txQuery(
                `DELETE FROM regular_student_answers
                 WHERE student_id = ?
                   AND exam_id = ?
                   AND question_set_id = ?`,
                [studentId, examId, questionSetId]
            );
            for (const answer of regularAnswers) {
                await txQuery(
                    `INSERT INTO regular_student_answers
                     (student_id, question_id, selected_option, exam_id, question_set_id)
                     VALUES (?, ?, ?, ?, ?)`,
                    [studentId, answer.questionId, answer.selectedOption, examId, questionSetId]
                );
            }
        });

        return res.json({ success: true, saved: regularAnswers.length });
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
    const requestedSubmissionReason = normalizeSubmissionReason(requestedForceSubmit, req.body?.forceReason);
    let autoSubmitReason = requestedSubmissionReason === "MANUAL" ? null : requestedSubmissionReason;

    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    try {
        const examIdNum = Number(examId);
        let effectiveExamIdNum = examIdNum;
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
        
            normalizedStudentType === "WALKIN" || normalizedStudentType === "WALK_IN";
        const walkinExamRows = isWalkin
            ? await queryAsync(
                `
                SELECT walkin_exam_id, stream
                FROM walkin_exams
                WHERE walkin_exam_id = ?
                LIMIT 1
                `,
                [examIdNum]
            )
            : [];
        const isWalkinExamId = walkinExamRows && walkinExamRows.length > 0;
        if (isWalkin && !isWalkinExamId) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        if (!submittedAnswers || submittedAnswers.length === 0) {
            if (isWalkin && isWalkinExamId) {
                await ensureWalkinAnswerSubmittedColumn();
                await ensureWalkinAnswerCodingLanguageColumn();
                const liveRows = await queryAsync(
                    `SELECT question_id, section_name, question_type, selected_option, descriptive_answer, code, coding_language, testcases_passed
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
            
                isWalkin && isWalkinExamId && (autoSubmitReason === "TIME_OVER" || autoSubmitReason === "VIOLATION_LIMIT");
            const allowEmptyRegularSubmit = !isWalkin;
            if (!allowEmptyWalkinAutoSubmit && !allowEmptyRegularSubmit) {
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
        let regularQuestionSetId = null;
        let walkinExpiredBeyondGrace = false;
        if (!isWalkin) {
            
            const regularStudentRows = await queryAsync(
                `SELECT status, college_id
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
            const latestRegularExam = await fetchLatestReadyRegularExamForCollege(regularStudent.college_id);
            if (!latestRegularExam) {
                return res.status(404).json({ success: false, message: "No READY regular exam found." });
            }
            if (Number(latestRegularExam.exam_id || 0) !== Number(examId)) {
                return res.status(403).json({ success: false, message: "Submit is allowed only for the latest regular exam." });
            }

            const regularTiming = getRegularExamTiming(latestRegularExam, Date.now());
            if (!regularTiming) {
                return res.status(500).json({ success: false, message: "Invalid regular exam schedule." });
            }
            if (regularTiming.startsInSeconds > 0) {
                return res.status(400).json({ success: false, message: "Exam has not started yet." });
            }

            const requestedStudentExamId = Number(studentExamId || 0);
            try {
                const regularAttempt = await ensureRegularStudentQuestionSet({
                    studentId,
                    examId,
                    requestedStudentExamId
                });
                effectiveStudentExamId = regularAttempt.studentExamId;
                regularQuestionSetId = regularAttempt.questionSetId;
            } catch (questionSetError) {
                if (String(questionSetError?.message || "") === "NO_ACTIVE_REGULAR_QUESTION_SET") {
                    return res.status(404).json({ success: false, message: "No active regular question set found." });
                }
                throw questionSetError;
            }

            const existingAttempt = await fetchRegularStudentAttempt({
                studentId,
                examId,
                requestedStudentExamId
            });
            if (!existingAttempt) {
                return res.status(403).json({ success: false, message: "Start the exam first to submit." });
            }
            regularQuestionSetId = Number(existingAttempt?.question_set_id || regularQuestionSetId || 0) || null;
            if (regularTiming.instructionWindowActive) {
                return res.status(400).json({ success: false, message: "Question paper is not unlocked yet." });
            }
            if (regularTiming.submissionClosed) {
                autoSubmitReason = autoSubmitReason || "TIME_OVER";
            }

            const savedRegularRows = await loadRegularSavedAnswers({
                studentId: Number(studentId),
                examId: Number(examId),
                questionSetId: regularQuestionSetId
            });
            submittedAnswers = mergeRegularSubmittedAnswers({
                payloadAnswers: submittedAnswers,
                savedRows: savedRegularRows
            });
            if (!submittedAnswers.length) {
                return res.status(400).json({ success: false, message: "No answers available to submit." });
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
                    await ensureWalkinAnswerCodingLanguageColumn();
                    const liveRows = await queryAsync(
                        `SELECT question_id, section_name, question_type, selected_option, descriptive_answer, code,
                                coding_language, testcases_passed
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
        let codingDisabledForWalkin = false;
        if (isWalkin) {
            if (walkinExamRows && walkinExamRows.length > 0) {
                const stream = String(walkinExamRows?.[0]?.stream || "");
                codingDisabledForWalkin = !isWalkinCodingEnabled(stream);
            } else {
                
                const course = String(examRows?.[0]?.course || "").trim();
                codingDisabledForWalkin = !isWalkinCodingEnabled(course);
            }
        }

        if (codingDisabledForWalkin) {
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
                    message: "Coding section is not allowed for this walk-in exam"
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
            await ensureWalkinSubmissionColumns();
            await ensureWalkinAnswerSectionColumn();
            await ensureWalkinAnswerSubmittedColumn();
            await ensureWalkinAnswerCodingLanguageColumn();
        }

        const finalSubmissionReason = autoSubmitReason || "MANUAL";
        const finalSubmissionMode = getSubmissionMode(finalSubmissionReason);

        await db.withTransaction(async (txQuery) => {
        const queryAsync = txQuery;

        const walkinSql = `
            INSERT INTO walkin_student_answers
            (student_id, exam_id, question_id, section_name, question_type, selected_option, descriptive_answer, code, coding_language, testcases_passed, marks_obtained, is_submitted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
            ON CONFLICT (student_id, exam_id, question_id, question_type)
            DO UPDATE SET
                section_name = EXCLUDED.section_name,
                selected_option = EXCLUDED.selected_option,
                descriptive_answer = EXCLUDED.descriptive_answer,
                code = EXCLUDED.code,
                coding_language = EXCLUDED.coding_language,
                testcases_passed = EXCLUDED.testcases_passed,
                marks_obtained = 0,
                is_submitted = FALSE
        `;

        const regularSql = `
            INSERT INTO regular_student_answers
            (student_id, question_id, selected_option, exam_id, question_set_id)
            VALUES (?, ?, ?, ?, ?)
        `;

        if (isWalkin) {
            effectiveExamIdNum = examIdNum;
            req.session.student.walkinExamId = examIdNum;
        }

        if (!isWalkin && regularQuestionSetId) {
            
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
                
                    questionType === "DESCRIPTIVE" ? "Descriptive" :
                    questionType === "CODING" ? "Coding" : "MCQ";
                
                    questionType === "MCQ" && typeof a.selected_option === "string"
                        ? (a.selected_option.trim().toUpperCase().charAt(0) || null)
                        : null;
                
                    questionType === "DESCRIPTIVE" && typeof a.descriptive_answer === "string"
                        ? a.descriptive_answer
                        : null;
                
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
                    String(a.coding_language || "").trim().toLowerCase() || null,
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
                        examId,
                        regularQuestionSetId
                    ]);
                }
            }
        }

        if (!isWalkin) {
            
            
            
            
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
                await runWalkinPostSubmitProcessing(Number(studentId), Number(effectiveExamIdNum), {
                    mode: finalSubmissionMode,
                    reason: finalSubmissionReason
                });
            } catch (postProcessError) {
                walkinResultProcessing = true;
                console.error("Walk-in post-submit processing error:", postProcessError);
                setImmediate(async () => {
                    try {
                        await runWalkinPostSubmitProcessing(Number(studentId), Number(effectiveExamIdNum), {
                            mode: finalSubmissionMode,
                            reason: finalSubmissionReason
                        });
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
            autoSubmitted: finalSubmissionMode === "AUTO_SUBMIT",
            submissionMode: finalSubmissionMode,
            reason: finalSubmissionReason,
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
        const walkinRows = isWalkinSessionStudent(req)
            ? await queryAsync(
                `SELECT walkin_exam_id
                 FROM walkin_exams
                 WHERE walkin_exam_id = ?
                 LIMIT 1`,
                [examId]
            )
            : [];
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

        
        if (!regularExamRows?.length) {
            return res.status(400).json({ success: false, message: "Invalid exam id." });
        }

        
        if (!submittedRows?.length) {
            return res.status(400).json({ success: false, message: "Feedback can be submitted only after exam submission." });
        }

        await ensureResultsFeedbackColumns();
        

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

    if (isWalkinSessionStudent(req)) {
        return db.query(
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
                        const includeCoding = isWalkinCodingEnabled(streamCode);
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

                return res.json({ success: false, message: "Walk-in exam not found" });
            }
        );
    }

    db.query(
        `
        SELECT s.background_type,
               COALESCE(rse.question_set_id, 0) AS question_set_id
        FROM students s
        LEFT JOIN regular_student_exam rse
          ON rse.student_id = s.student_id
         AND rse.exam_id = ?
        WHERE s.student_id = ?
        LIMIT 1
        `,
        [examId, studentId],
        (bgErr, bgRows) => {
            if (bgErr) {
                console.error("Result background error:", bgErr);
                return res.json({ success: false, message: "Server error" });
            }
            const allowedTechnicalSection = getRegularTechnicalSection(bgRows?.[0]?.background_type);
            const questionSetId = Number(bgRows?.[0]?.question_set_id || 0) || null;
            if (!questionSetId) {
                return res.json({ success: false, message: "Regular question set not found" });
            }
            db.query(
                `SELECT COUNT(*) AS total
                 FROM regular_exam_questions
                 WHERE exam_id = ?
                   AND question_set_id = ?
                   AND (
                       UPPER(COALESCE(section_name, '')) = 'APTITUDE'
                       OR UPPER(COALESCE(section_name, '')) = UPPER(COALESCE(?, section_name))
                       OR UPPER(COALESCE(section_name, '')) NOT IN ('TECHNICAL_BASIC', 'TECHNICAL_ADVANCED')
                   )`,
                [examId, questionSetId, allowedTechnicalSection || null],
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
                JOIN regular_exam_questions q
                  ON sa.question_id = q.question_id
                 AND q.question_set_id = COALESCE(sa.question_set_id, ?)
                WHERE sa.student_id = ? AND sa.exam_id = ? AND sa.selected_option = q.correct_answer
                  AND COALESCE(sa.question_set_id, ?) = ?
                  AND (
                      UPPER(COALESCE(q.section_name, '')) = 'APTITUDE'
                      OR UPPER(COALESCE(q.section_name, '')) = UPPER(COALESCE(?, q.section_name))
                      OR UPPER(COALESCE(q.section_name, '')) NOT IN ('TECHNICAL_BASIC', 'TECHNICAL_ADVANCED')
                  )
                `,
                [questionSetId, studentId, examId, questionSetId, questionSetId, allowedTechnicalSection || null],
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

const runExamStartupSchemaSync = async () => {
    await queryAsync(`SELECT 1`);
    await ensureWalkinSummaryColumn();
    await ensureWalkinAttemptedAtColumn();
    await ensureWalkinSubmissionColumns();
    await ensureRegularStudentExamTable();
    
    
    
    await ensureResultsFeedbackColumns();
    await ensureWalkinStudentExamTable();
    await ensureWalkinAnswerSectionColumn();
    await ensureWalkinAnswerSubmittedColumn();
};

router.startupSchemaSync = runExamStartupSchemaSync;

module.exports = router;



