const express = require("express");
const router = express.Router();
const db = require("../db");
const util = require("util");
const queryAsync = util.promisify(db.query).bind(db);
const { openaiClient, gradeDescriptiveAnswerDetailed, generateWalkinPerformanceSummary } = require("../llm");
const {
    STREAM_BY_CODE,
    getCanonicalWalkinStreamCode,
    getWalkinStreamCodeOrDefault,
    getWalkinStreamLabel,
    getWalkinStreamQuestionKey,
    isWalkinCodingEnabled
} = require("../utils/walkinStream");
const { isAtLeastAge } = require("../utils/ageValidation");
const { getBackgroundType, getRegularTechnicalSection } = require("../utils/courseBackground");

const WALKIN_STREAMS = Object.values(STREAM_BY_CODE);
const isWalkinCourse = (value) => Boolean(getCanonicalWalkinStreamCode(value));
let walkinAnswerSectionColumnChecked = false;
let walkinAttemptedAtColumnChecked = false;
let walkinSubmissionColumnsChecked = false;
let walkinExamStreamCodeColumnChecked = false;
let walkinTempStudentsTableChecked = false;
let regularExamFeedbackTableChecked = false;
let resultsSubmittedAtColumnChecked = false;
let resultsSubmissionColumnsChecked = false;
let adminStartupSchemaSyncAttempted = false;
let regularExamCollegeColumnChecked = false;
let regularQuestionBankTablesChecked = false;
let resultsFeedbackColumnsChecked = false;
const IST_OFFSET_MINUTES = 5.5 * 60;
const TWENTY_FOUR_HOUR_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const REGULAR_FIXED_DURATION_MINUTES = 60;
const REGULAR_FIXED_QUESTION_COUNT = 50;
const REGULAR_APTITUDE_QUESTION_COUNT = 20;
const REGULAR_TECHNICAL_QUESTION_COUNT = REGULAR_FIXED_QUESTION_COUNT - REGULAR_APTITUDE_QUESTION_COUNT;
const REGULAR_GLOBAL_TECH_BANK_COUNT = 30;
const REGULAR_BACKGROUND_TO_SECTION_SQL = (studentAlias) => `
    CASE
        WHEN UPPER(REPLACE(TRIM(COALESCE(${studentAlias}.background_type::text, '')), '-', '_')) = 'TECH'
            THEN 'TECHNICAL_ADVANCED'
        WHEN UPPER(REPLACE(TRIM(COALESCE(${studentAlias}.background_type::text, '')), '-', '_')) = 'NON_TECH'
            THEN 'TECHNICAL_BASIC'
        ELSE NULL
    END
`;
const REGULAR_ALLOWED_SECTION_SQL = (questionAlias, studentAlias) => `
    (
        UPPER(COALESCE(${questionAlias}.section_name, '')) = 'APTITUDE'
        OR UPPER(COALESCE(${questionAlias}.section_name, '')) = ${REGULAR_BACKGROUND_TO_SECTION_SQL(studentAlias)}
    )
`;
const getRegularQuestionSetJoinKey = (rowAlias) => `COALESCE(${rowAlias}.question_set_id, 0)`;
const WALKIN_TEMP_STATUS = {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED"
};

const STREAM_LABEL_BY_CODE = {
    DS: "Data Science",
    DA: "Data Analytics",
    MERN: "MERN",
    AAI: "Agentic AI",
    INT: "Interns Test"
};

const parseCodingTestcaseCount = (payload) => {
    if (!payload) return 0;
    try {
        const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
        return Array.isArray(parsed) ? Math.min(parsed.length, 5) : 0;
    } catch {
        return 0;
    }
};

const buildWalkinSummaryRows = (answerRows = []) => {
    return (answerRows || []).map((row) => {
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
            total_testcases: isCoding ? parseCodingTestcaseCount(row.coding_testcases) : 0,
            question_text: String(row.question_text || ""),
            descriptive_answer: String(row.descriptive_answer || ""),
            reference_answer: String(row.reference_descriptive_answer || "")
        };
    });
};

const refreshWalkinPerformanceSummary = async (studentId, examId) => {
    const sid = Number(studentId || 0);
    const eid = Number(examId || 0);
    if (!sid || !eid) return false;

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
            COALESCE(wsa.descriptive_answer, '') AS descriptive_answer,
            COALESCE(wsa.marks_obtained, 0) AS marks_obtained,
            COALESCE(wsa.testcases_passed, 0) AS testcases_passed,
            wa.question_id AS aptitude_qid,
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

    const summaryRows = buildWalkinSummaryRows(answerRows);
    const summaryPayload = await generateWalkinPerformanceSummary(student, summaryRows);
    const summary = String(summaryPayload?.summary || "").trim();
    if (!summary) return false;

    await queryAsync(
        `
        UPDATE walkin_final_results
        SET performance_summary = ?
        WHERE student_id = ? AND exam_id = ?
        `,
        [summary, sid, eid]
    );
    return true;
};

const normalizeWalkinStreamLabel = (value) => {
    const streamCode = getCanonicalWalkinStreamCode(value);
    return streamCode ? STREAM_LABEL_BY_CODE[streamCode] : "";
};

const normalizeRegularBackgroundType = (value) => {
    const normalized = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    if (normalized === "TECH") return "TECH";
    if (normalized === "NON_TECH") return "NON_TECH";
    return "";
};

const getRegularSectionNameForBackground = (backgroundType) =>
    normalizeRegularBackgroundType(backgroundType) === "TECH" ? "TECHNICAL_ADVANCED" : "TECHNICAL_BASIC";

const ensureRegularQuestionBankTables = async () => {
    if (regularQuestionBankTablesChecked) return;

    

    

    try {
        
    } catch (error) {
        const msg = String(error?.message || "");
        if (
            String(error?.code || "").toUpperCase() !== "42701" &&
            !/duplicate column/i.test(msg) &&
            !/already exists/i.test(msg)
        ) {
            throw error;
        }
    }

    try {
        
    } catch (error) {
        const msg = String(error?.message || "");
        if (
            String(error?.code || "").toUpperCase() !== "42701" &&
            !/duplicate column/i.test(msg) &&
            !/already exists/i.test(msg)
        ) {
            throw error;
        }
    }

    

    
    
    

    regularQuestionBankTablesChecked = true;
};

const loadRegularQuestionBank = async (txQuery = queryAsync) => {
    await ensureRegularQuestionBankTables();
    const [aptitudeRows, technicalRows] = await Promise.all([
        txQuery(
            `SELECT question_id, question_text, option_a, option_b, option_c, option_d, correct_answer
             FROM regular_aptitude_questions
             ORDER BY question_id`
        ),
        txQuery(
            `SELECT question_id, question_text, option_a, option_b, option_c, option_d, correct_answer, background_type, section_name, question_type
             FROM regular_technical_questions
             WHERE COALESCE(is_active, TRUE) = TRUE
             ORDER BY question_id`
        )
    ]);
    return {
        aptitude: Array.isArray(aptitudeRows) ? aptitudeRows : [],
        technical: Array.isArray(technicalRows) ? technicalRows : []
    };
};

const pickRandomRows = (rows, count) => {
    const source = Array.isArray(rows) ? [...rows] : [];
    for (let i = source.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [source[i], source[j]] = [source[j], source[i]];
    }
    return source.slice(0, Math.max(0, Number(count || 0) || 0));
};

const validateRegularQuestionBankCoverage = (bank) => {
    const aptitudeCount = Array.isArray(bank?.aptitude) ? bank.aptitude.length : 0;
    const nonTechCount = Array.isArray(bank?.technical)
        ? bank.technical.filter((row) => normalizeRegularBackgroundType(row.background_type) === "NON_TECH").length
        : 0;
    const techCount = Array.isArray(bank?.technical)
        ? bank.technical.filter((row) => normalizeRegularBackgroundType(row.background_type) === "TECH").length
        : 0;

    const shortages = [];
    if (aptitudeCount < REGULAR_APTITUDE_QUESTION_COUNT) {
        shortages.push(`Aptitude bank has ${aptitudeCount}; at least ${REGULAR_APTITUDE_QUESTION_COUNT} required`);
    }
    if (nonTechCount < REGULAR_GLOBAL_TECH_BANK_COUNT) {
        shortages.push(`Non-tech technical bank has ${nonTechCount}; at least ${REGULAR_GLOBAL_TECH_BANK_COUNT} required`);
    }
    if (techCount < REGULAR_GLOBAL_TECH_BANK_COUNT) {
        shortages.push(`Tech technical bank has ${techCount}; at least ${REGULAR_GLOBAL_TECH_BANK_COUNT} required`);
    }

    if (shortages.length > 0) {
        const error = new Error(`Regular question bank is incomplete. ${shortages.join(". ")}`);
        error.code = "REGULAR_QUESTION_BANK_INCOMPLETE";
        throw error;
    }
};

const buildRegularExamQuestionsFromBank = async () => {
    const bank = await loadRegularQuestionBank();
    validateRegularQuestionBankCoverage(bank);
    const aptitudeSource = pickRandomRows(bank.aptitude, REGULAR_APTITUDE_QUESTION_COUNT).map((row) => ({
        question_text: row.question_text,
        option_a: row.option_a,
        option_b: row.option_b,
        option_c: row.option_c,
        option_d: row.option_d,
        correct_answer: row.correct_answer,
        section_name: "APTITUDE",
        question_type: "MCQ"
    }));

    const technicalBasicSource = pickRandomRows(
        bank.technical.filter((row) => normalizeRegularBackgroundType(row.background_type) === "NON_TECH"),
        REGULAR_GLOBAL_TECH_BANK_COUNT
    ).map((row) => ({
        question_text: row.question_text,
        option_a: row.option_a,
        option_b: row.option_b,
        option_c: row.option_c,
        option_d: row.option_d,
        correct_answer: row.correct_answer,
        section_name: "TECHNICAL_BASIC",
        question_type: row.question_type || "MCQ"
    }));

    const technicalAdvancedSource = pickRandomRows(
        bank.technical.filter((row) => normalizeRegularBackgroundType(row.background_type) === "TECH"),
        REGULAR_GLOBAL_TECH_BANK_COUNT
    ).map((row) => ({
        question_text: row.question_text,
        option_a: row.option_a,
        option_b: row.option_b,
        option_c: row.option_c,
        option_d: row.option_d,
        correct_answer: row.correct_answer,
        section_name: "TECHNICAL_ADVANCED",
        question_type: row.question_type || "MCQ"
    }));

    return [
        ...aptitudeSource,
        ...technicalBasicSource,
        ...technicalAdvancedSource
    ];
};

const createAndActivateRegularQuestionSet = async (examId) => {
    const questions = await buildRegularExamQuestionsFromBank();

    return db.withTransaction(async (txQuery) => {
        await txQuery(
            `UPDATE regular_question_sets
             SET set_status = 'INACTIVE'
             WHERE exam_id = ?
               AND set_status = 'ACTIVE'`,
            [examId]
        );

        const insertedSet = await txQuery(
            `INSERT INTO regular_question_sets (exam_id, set_status)
             VALUES (?, 'ACTIVE')
             RETURNING question_set_id`,
            [examId]
        );
        const questionSetId = Number(insertedSet?.insertId || insertedSet?.[0]?.question_set_id || 0) || null;
        if (!questionSetId) {
            throw new Error("Could not create active regular question set");
        }

        const insertSql = `
            INSERT INTO regular_exam_questions
            (question_text, option_a, option_b, option_c, option_d, correct_answer, section_name, question_type, exam_id, question_set_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        for (const q of questions) {
            await txQuery(insertSql, [
                q.question_text,
                q.option_a,
                q.option_b,
                q.option_c,
                q.option_d,
                q.correct_answer,
                q.section_name || "General",
                q.question_type || "MCQ",
                examId,
                questionSetId
            ]);
        }

        return { questionSetId };
    });
};

const getCurrentRole = (req) => String(req.session?.admin?.role || "").trim().toUpperCase();
const isAdminUser = (req) => getCurrentRole(req) === "ADMIN";
const isBdeUser = (req) => getCurrentRole(req) === "BDE";

const buildWalkinAutoPassword = (name, dob) => {
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
    return `${namePrefix}${dayMonth}`;
};

const normalizeBulkCell = (value) => String(value ?? "").trim();

const getInsertedId = (result, key) =>
    Number(result?.insertId || result?.[0]?.[key] || result?.rows?.[0]?.[key] || 0) || null;

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
            if (
                String(error?.code || "").toUpperCase() !== "42701" &&
                !/duplicate column/i.test(msg) &&
                !/already exists/i.test(msg)
            ) {
                throw error;
            }
        }
    }

    try {
        
    } catch (error) {
        const msg = String(error?.message || "");
        if (String(error?.code || "").toUpperCase() !== "42P01" && !/does not exist/i.test(msg)) {
            throw error;
        }
    }

    resultsFeedbackColumnsChecked = true;
};

const ensureResultsSubmissionColumns = async () => { return; };

const getResolvedBackgroundType = async (course) => {
    const normalizedCourse = String(course || "").trim();
    if (!normalizedCourse) return null;

    try {
        const rows = [];
        const mappedType = String(rows?.[0]?.background_type || "").trim().toUpperCase();
        if (mappedType === "TECH") return "TECH";
        if (mappedType === "NON_TECH") return "NON_TECH";
    } catch (error) {
        const code = String(error?.code || "").toUpperCase();
        if (code !== "42P01") {
            console.warn("regular_course_stream_map lookup failed:", String(error?.message || error));
        }
    }

    return getBackgroundType(normalizedCourse);
};

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
    const second = Number(timeMatch[3] || 0);

    const utcEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
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
        const duplicateColumn = Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add section_name column to walkin_student_answers:", msg);
        }
    } finally {
        walkinAnswerSectionColumnChecked = true;
    }
}

async function dummy() { return; 
    if (regularExamCollegeColumnChecked) return;
    try {
        const existingColumnRows = [];
        if (Array.isArray(existingColumnRows) && existingColumnRows.length > 0) {
            regularExamCollegeColumnChecked = true;
            return;
        }
    } catch (error) {
        console.warn("Could not inspect regular_exams.college_id column:", String(error?.message || error));
    }
    try {
        
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn =
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add college_id column to regular_exams:", msg);
        }
    }
    try {
        
    } catch (error) {
        console.warn("Could not add regular_exams.college_id index:", String(error?.message || error));
    }
    regularExamCollegeColumnChecked = true;
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
        const duplicateColumn = Number(error?.errno) === 1060 ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add attempted_at column to walkin_final_results:", msg);
        }
    } finally {
        walkinAttemptedAtColumnChecked = true;
    }
}

async function ensureWalkinSubmissionColumns() {
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
}

async function ensureWalkinTempStudentsTable() {
    if (walkinTempStudentsTableChecked) return;
    await queryAsync(
        `CREATE TABLE IF NOT EXISTS walkin_temp_students (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
            name TEXT NOT NULL,
            email_id TEXT NOT NULL,
            contact_number TEXT NOT NULL,
            dob DATE NOT NULL,
            stream TEXT NOT NULL,
            college_id INT NOT NULL REFERENCES college(college_id) ON UPDATE CASCADE ON DELETE RESTRICT,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
            bde_name TEXT NULL
        )`
    );
    try {
        await queryAsync(`ALTER TABLE walkin_temp_students DROP CONSTRAINT IF EXISTS walkin_temp_students_stream_check`);
        await queryAsync(
            `ALTER TABLE walkin_temp_students
             ADD CONSTRAINT walkin_temp_students_stream_check
             CHECK (stream IN ('Data Analytics', 'Data Science', 'MERN', 'Agentic AI', 'Interns Test', 'Interns Test (DA)', 'Interns Test (DS)', 'Interns Test (MERN)', 'Interns Test (AAI)'))`
        );
    } catch (error) {
        const msg = String(error?.message || "");
        if (!/already exists/i.test(msg)) {
            throw error;
        }
    }
    await queryAsync(`CREATE INDEX IF NOT EXISTS idx_walkin_temp_students_status ON walkin_temp_students(status)`);
    await queryAsync(`CREATE INDEX IF NOT EXISTS idx_walkin_temp_students_college_id ON walkin_temp_students(college_id)`);
    await queryAsync(`CREATE INDEX IF NOT EXISTS idx_walkin_temp_students_email_id ON walkin_temp_students(email_id)`);
    walkinTempStudentsTableChecked = true;
}

async function dummy() { return; 
    if (regularExamFeedbackTableChecked) return;
    
    regularExamFeedbackTableChecked = true;
}

async function dummy() { return; 
    if (resultsSubmittedAtColumnChecked) return;
    try {
        
    } catch (error) {
        const msg = String(error?.message || "");
        const duplicateColumn = Number(error?.errno) === 1060 ||
            String(error?.code || "").toUpperCase() === "42701" ||
            /duplicate column/i.test(msg) ||
            /already exists/i.test(msg);
        if (!duplicateColumn) {
            console.warn("Could not add submitted_at column to regular_student_results:", msg);
        }
    } finally {
        resultsSubmittedAtColumnChecked = true;
    }
}

async function loadWalkinQuestionSet(stream) {
    const streamCode = getWalkinStreamCodeOrDefault(stream);
    const normalizedStreamKey = getWalkinStreamQuestionKey(streamCode);
    const includeCoding = isWalkinCodingEnabled(streamCode);
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

function ensureBdeNameColumn() {
    const query = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_schema = current_schema()
          AND table_name = 'students'
          AND column_name = 'bde_name'
    `;

    db.query(query, (err, rows) => {
        if (err) {
            console.error("bde_name column check failed:", err);
            return;
        }

        if (rows?.length > 0) {
            return;
        }

        db.query(
            `ALTER TABLE students ADD COLUMN bde_name TEXT NULL`,
            err2 => {
                if (err2) {
                    console.error("Could not add bde_name column:", err2);
                } else {
                    console.log("Added bde_name column to students table");
                }
            }
        );
    });
}

function ensureBackgroundTypeColumn() {
    const query = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_schema = current_schema()
          AND table_name = 'students'
          AND column_name = 'background_type'
    `;

    db.query(query, (err, rows) => {
        if (err) {
            console.error("background_type column check failed:", err);
            return;
        }

        if (rows?.length > 0) {
            return;
        }

        db.query(
            `ALTER TABLE students ADD COLUMN background_type TEXT NULL`,
            err2 => {
                if (err2) {
                    console.error("Could not add background_type column:", err2);
                } else {
                    console.log("Added background_type column to students table");
                }
            }
        );
    });
}

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
        const duplicateColumn = Number(error?.errno) === 1060 ||
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
                WHEN UPPER(REPLACE(TRIM(stream::text), ' ', '')) IN ('AAI', 'AGENTICAI') THEN 'AAI'
                WHEN UPPER(REPLACE(TRIM(stream::text), ' ', '')) IN ('INT', 'INTERNSTEST', 'INTERNSHIPTEST') THEN 'INT'
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

function dummy2() { return; 
    db.query(
        `
        CREATE TABLE IF NOT EXISTS bdes (
            bde_id BIGSERIAL PRIMARY KEY TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            email_id TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL
        )
        `,
        (error) => {
            if (error) {
                console.warn("Could not ensure bdes table:", String(error?.message || error));
            }
        }
    );
}

function dummy2() { return; 
    db.query(
        `ALTER TABLE students ADD COLUMN bde_name TEXT NULL`,
        (error) => {
            const msg = String(error?.message || "");
            const duplicateColumn = Number(error?.errno) === 1060 ||
                /duplicate column/i.test(msg) ||
                /already exists/i.test(msg);
            if (error && !duplicateColumn) {
                console.warn("Could not add students.bde_name column:", msg);
            }
        }
    );
}

function ensureQuestionColumns() { return; }

async function runAdminStartupSchemaSync() {
    if (adminStartupSchemaSyncAttempted) return;
    adminStartupSchemaSyncAttempted = true;

    try {
        await queryAsync(`SELECT 1`);
    } catch (error) {
        console.warn("Skipping admin startup schema sync because PostgreSQL is unreachable:", String(error?.message || error));
        return;
    }

    ensureStudentTypeColumn();
    ensureBackgroundTypeColumn();
    ensureBdeNameColumn();
    ensureWalkinExamColumn();
    
    
    
    await ensureWalkinTempStudentsTable();
    ensureWalkinExamStreamCodeColumn().catch((error) => {
        console.warn("walkin_exams stream_code normalization setup failed:", String(error?.message || error));
    });
    ensureQuestionColumns();
    
    
    await ensureWalkinAttemptedAtColumn();
    await ensureWalkinSubmissionColumns();
    await ensureResultsFeedbackColumns();
    await ensureRegularQuestionBankTables();
}

runAdminStartupSchemaSync().catch((error) => {
    console.warn("Admin startup schema sync failed:", String(error?.message || error));
});

/* ================= ADMIN LOGIN API ================= */
router.post("/login", (req, res) => {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "").trim();
    const loginInput = email;

    if (!email || !password) {
        return res.json({ success: false, message: "Missing credentials" });
    }

    const adminSql = `
        SELECT a.admin_id, a.email_id
        FROM admins a
        WHERE LOWER(a.email_id) = LOWER(?) AND a.password = ?
    `;
    db.query(adminSql, [loginInput, password], (adminErr, adminRows) => {
        if (adminErr) {
            console.error("Admin login error:", adminErr);
            return res.json({ success: false });
        }
        if (adminRows && adminRows.length > 0) {
            req.session.admin = {
                adminId: adminRows[0].admin_id,
                role: "ADMIN",
                email: adminRows[0].email_id,
                displayName: adminRows[0].email_id
            };
            return res.json({
                success: true,
                adminId: adminRows[0].admin_id,
                role: "ADMIN",
                email: adminRows[0].email_id,
                displayName: adminRows[0].email_id
            });
        }

        return res.json({ success: false, message: "Invalid credentials" });
    });
});
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }
    req.session.destroy(() => res.json({ success: true }));
});

router.get("/", (req, res) => {
    res.redirect("/admin/login");
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

router.post("/account/change-password", async (req, res) => {
    const role = String(req.session?.admin?.role || "").trim().toUpperCase();
    const accountId = Number(req.session?.admin?.adminId || 0);
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmNewPassword = String(req.body?.confirmNewPassword || "");

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return res.status(400).json({ success: false, message: "Current password, new password, and confirm password are required" });
    }
    if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ success: false, message: "New password and confirm password must match" });
    }
    if (newPassword === currentPassword) {
        return res.status(400).json({ success: false, message: "New password must be different from current password" });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }
    if (!accountId) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }

    try {
        if (role === "ADMIN") {
            const adminRows = await queryAsync(
                `
                SELECT admin_id
                FROM admins
                WHERE admin_id = ? AND password = ?
                LIMIT 1
                `,
                [accountId, currentPassword]
            );
            if (!Array.isArray(adminRows) || adminRows.length === 0) {
                return res.status(400).json({ success: false, message: "Current password is incorrect" });
            }
            await queryAsync(
                `
                UPDATE admins
                SET password = ?
                WHERE admin_id = ?
                `,
                [newPassword, accountId]
            );
            return res.json({ success: true, message: "Password updated successfully" });
        }

        if (role === "BDE") {
            const bdeRows = await queryAsync(
                `
                SELECT bde_id
                FROM bdes
                WHERE bde_id = ? AND password = ?
                LIMIT 1
                `,
                [accountId, currentPassword]
            );
            if (!Array.isArray(bdeRows) || bdeRows.length === 0) {
                return res.status(400).json({ success: false, message: "Current password is incorrect" });
            }
            await queryAsync(
                `
                UPDATE bdes
                SET password = ?
                WHERE bde_id = ?
                `,
                [newPassword, accountId]
            );
            return res.json({ success: true, message: "Password updated successfully" });
        }

        return res.status(403).json({ success: false, message: "Unsupported account role" });
    } catch (error) {
        console.error("Account password change error:", error);
        return res.status(500).json({ success: false, message: "Could not update password" });
    }
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

        const insertWithDefaultId = async () => {
            const result = await queryAsync(
                `
                INSERT INTO college (college_name)
                VALUES (?)
                RETURNING college_id
                `,
                [collegeName]
            );
            return Number(result?.insertId || result?.[0]?.college_id || 0) || null;
        };

        const syncCollegeIdSequence = async () => {
            await queryAsync(
                `
                SELECT setval(
                    pg_get_serial_sequence('college', 'college_id'),
                    COALESCE((SELECT MAX(college_id)::bigint FROM college), 0) + 1,
                    false
                )
                `
            );
        };

        try {
            const createdCollegeId = await insertWithDefaultId();
            return res.json({
                success: true,
                collegeId: createdCollegeId,
                collegeName
            });
        } catch (insertError) {
            const insertErrMsg = String(insertError?.sqlMessage || insertError?.message || "");
            const insertErrCode = String(insertError?.code || "");
            const missingDefaultCollegeId =
                (
                    Number(insertError?.errno) === 1364 ||
                    insertErrCode === "23502"
                ) &&
                /college_id/i.test(insertErrMsg);
            const duplicateCollegePrimaryKey =
                insertErrCode === "23505" &&
                /college_pkey|college_id/i.test(insertErrMsg);

            if (duplicateCollegePrimaryKey) {
                await syncCollegeIdSequence();
                const createdCollegeId = await insertWithDefaultId();
                return res.json({
                    success: true,
                    collegeId: createdCollegeId,
                    collegeName
                });
            }

            if (!missingDefaultCollegeId) {
                throw insertError;
            }

            for (let attempt = 0; attempt < 3; attempt += 1) {
                const nextIdRows = await queryAsync(
                    `
                    SELECT COALESCE(MAX(college_id::bigint), 0) + 1 AS next_id
                    FROM college
                    `
                );
                const nextId = String(Number(nextIdRows?.[0]?.next_id || 1));

                try {
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
                } catch (manualInsertError) {
                    const manualErrCode = String(manualInsertError?.code || "");
                    const manualErrMsg = String(manualInsertError?.sqlMessage || manualInsertError?.message || "");
                    const duplicateManualPk =
                        manualErrCode === "23505" &&
                        /college_pkey|college_id/i.test(manualErrMsg);
                    if (!duplicateManualPk || attempt === 2) {
                        throw manualInsertError;
                    }
                }
            }
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
router.get("/exams/count/:collegeId", (req, res) => { res.json({ total: 0 }); });

/* ================= ACTIVE EXAM COUNT ================= */
router.get("/exams/active-count/:collegeId", (req, res) => { res.json({ total: 0 }); });

/* ================= RECENT RESULTS ================= */
router.get("/results/:collegeId", async (req, res) => { res.json([]); });

router.get("/result-answers/:resultId", async (req, res) => { res.json({ success: true, questions: [], review: null }); });

/* ================= STUDENT PROFILES ================= */
router.get("/students/:collegeId", (req, res) => {
    const rawCollegeId = String(req.params.collegeId || "").trim();
    const wantsAllColleges =
        !rawCollegeId ||
        /^all$/i.test(rawCollegeId) ||
        rawCollegeId === "*";
    const parsedCollegeId = Number(rawCollegeId);
    if (!wantsAllColleges && (!Number.isFinite(parsedCollegeId) || parsedCollegeId <= 0)) {
        return res.json([]);
    }

    const baseSelect = `
        SELECT s.student_id,
               s.name,
               s.email_id,
               s.contact_number,
               s.college_id,
               s.course,
               s.background_type,
               s.dob,
               s.created_at,
               sc.password,
               c.college_name,
               CASE
                   WHEN UPPER(REPLACE(TRIM(COALESCE(s.student_type::text, '')), '-', '_')) IN ('WALK_IN', 'WALKIN') THEN 'WALKIN'
                   WHEN UPPER(REPLACE(TRIM(COALESCE(s.student_type::text, '')), '-', '_')) = 'REGULAR' THEN 'REGULAR'
                   WHEN UPPER(REPLACE(TRIM(COALESCE(s.course, '')), ' ', '')) IN
                        ('DS', 'DATASCIENCE', 'DA', 'DATAANALYTICS', 'MERN', 'FULLSTACK', 'AAI', 'AGENTICAI', 'INT', 'INTERNSTEST', 'INTERNSHIPTEST') THEN 'WALKIN'
                   ELSE 'REGULAR'
               END AS student_type,
               s.status AS student_status
        FROM students s
        LEFT JOIN student_credentials sc ON sc.student_id = s.student_id
        LEFT JOIN college c ON c.college_id = s.college_id
    `;
    const sql = wantsAllColleges
        ? `${baseSelect} ORDER BY s.name`
        : `${baseSelect} WHERE s.college_id = ? ORDER BY s.name`;
    const params = wantsAllColleges ? [] : [parsedCollegeId];
    db.query(
        sql,
        params,
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

        // Walk-in exam IDs are no longer pre-assigned on activation.
        // A fresh walkin_exam_id is allocated only at successful submission time.

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

const updateWalkinStudentProfile = async (req, res) => {
    const studentId = Number(req.params.studentId || 0);
    const nameInput = String(req.body?.name || "").trim();
    const emailInput = String(req.body?.email || "").trim().toLowerCase();
    const phoneInput = String(req.body?.phone || "").replace(/\D/g, "").trim();
    const dobInput = String(req.body?.dob || "").trim();
    const courseRawInput = String(req.body?.course || "").trim();
    const collegeIdInput = Number(req.body?.collegeId || 0);
    const bdeNameInput = String(req.body?.bdeName || "").trim();
    const passwordInput = String(req.body?.password || "");

    if (!studentId) {
        return res.status(400).json({ success: false, message: "Invalid student id" });
    }

    try {
        const studentRows = await queryAsync(
            `SELECT student_id, student_type, name, email_id, contact_number, dob, course, background_type, college_id
             FROM students WHERE student_id = ? LIMIT 1`,
            [studentId]
        );
        if (!studentRows || studentRows.length === 0) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }
        const row = studentRows[0] || {};
        const typeNormalized = String(row?.student_type || "")
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, "_");
        const isWalkin =
            typeNormalized === "WALK_IN" ||
            typeNormalized === "WALKIN" ||
            isWalkinCourse(row?.course);

        const courseFromInput = isWalkin
            ? (getWalkinStreamLabel(courseRawInput) || getWalkinStreamLabel(getWalkinStreamCodeOrDefault(courseRawInput)))
            : courseRawInput;
        const courseFromExisting = isWalkin
            ? (getWalkinStreamLabel(row?.course) || getWalkinStreamLabel(getWalkinStreamCodeOrDefault(row?.course)))
            : String(row?.course || "").trim();

        const name = nameInput || String(row?.name || "").trim();
        const email = emailInput || String(row?.email_id || "").trim().toLowerCase();
        const phone = phoneInput || String(row?.contact_number || "").replace(/\D/g, "").trim();
        const dob = dobInput || (row?.dob ? String(row.dob).slice(0, 10) : "");
        const course = courseFromInput || courseFromExisting;
        const backgroundType = isWalkin
            ? String(row?.background_type || "").trim().toUpperCase() || null
            : await getResolvedBackgroundType(course);
        const collegeId = collegeIdInput || Number(row?.college_id || 0);
        const bdeName = bdeNameInput || String(row?.bde_name || "").trim();
        const password = passwordInput;

        if (phone && !/^\d{10}$/.test(phone)) {
            return res.status(400).json({ success: false, message: "Phone number must be exactly 10 digits." });
        }
        if (dob && !isAtLeastAge(dob, 18)) {
            return res.status(400).json({ success: false, message: "Student must be at least 18 years old." });
        }

        if (email) {
            const duplicateRows = await queryAsync(
                `SELECT student_id FROM students WHERE LOWER(TRIM(email_id)) = LOWER(?) AND student_id <> ? LIMIT 1`,
                [email, studentId]
            );
            if (duplicateRows && duplicateRows.length > 0) {
                return res.status(400).json({ success: false, message: "Email already registered" });
            }
        }

        if (collegeId) {
            const collegeRows = await queryAsync(
                `SELECT college_id FROM college WHERE college_id = ? LIMIT 1`,
                [collegeId]
            );
            if (!collegeRows || collegeRows.length === 0) {
                return res.status(400).json({ success: false, message: "Selected college not found" });
            }
        }

        await queryAsync(
            `UPDATE students
             SET name = ?, email_id = ?, contact_number = ?, dob = ?, course = ?, background_type = ?, college_id = ?
             WHERE student_id = ?`,
            [name || null, email || null, phone || null, dob || null, course || null, backgroundType || null, collegeId || null, studentId]
        );

        if (password) {
            const credentialRows = await queryAsync(
                `SELECT student_id FROM student_credentials WHERE student_id = ? LIMIT 1`,
                [studentId]
            );
            if (credentialRows && credentialRows.length > 0) {
                await queryAsync(
                    `UPDATE student_credentials SET password = ? WHERE student_id = ?`,
                    [password, studentId]
                );
            } else {
                await queryAsync(
                    `INSERT INTO student_credentials (student_id, email_id, password) VALUES (?, ?, ?)`,
                    [studentId, email, password]
                );
            }
        } else {
            await queryAsync(
                `UPDATE student_credentials SET email_id = ? WHERE student_id = ?`,
                [email, studentId]
            );
        }

        const updatedRows = await queryAsync(
            `
            SELECT s.student_id,
                   s.name,
                   s.email_id,
                   s.contact_number,
                   s.college_id,
                   s.course,
                   s.background_type,
                   s.dob,
                   sc.password,
                   c.college_name,
                   s.status AS student_status
            FROM students s
            LEFT JOIN student_credentials sc ON sc.student_id = s.student_id
            LEFT JOIN college c ON c.college_id = s.college_id
            WHERE s.student_id = ?
            LIMIT 1
            `,
            [studentId]
        );

        return res.json({
            success: true,
            student: updatedRows?.[0] || null
        });
    } catch (error) {
        console.error("Walk-in profile update error:", error);
        return res.status(500).json({ success: false, message: "Could not update walk-in profile" });
    }
};

router.patch("/students/:studentId/status", updateStudentStatus);
router.put("/students/:studentId/status", updateStudentStatus);
router.post("/students/:studentId/status", updateStudentStatus);
router.put("/students/:studentId", updateWalkinStudentProfile);
router.patch("/students/:studentId", updateWalkinStudentProfile);




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
    const rawCollegeId = String(collegeId || "").trim();
    const wantsAllColleges = !rawCollegeId || /^all$/i.test(rawCollegeId) || rawCollegeId === "*";
    const parsedCollegeId = Number(rawCollegeId);
    const role = String(req.session?.admin?.role || "").trim().toUpperCase();
    const scopedBdeName = String(req.session?.admin?.displayName || "").trim();
    const isBdeUser = role === "BDE";
    if (isBdeUser && !scopedBdeName) {
        return res.status(403).json({ success: false, message: "BDE access only" });
    }
    if (!wantsAllColleges && (!Number.isFinite(parsedCollegeId) || parsedCollegeId <= 0)) {
        return res.json([]);
    }
    try {
        const whereClauses = [
            `UPPER(REPLACE(TRIM(COALESCE(s.student_type::text, '')), '-', '_')) IN ('WALK_IN', 'WALKIN')`
        ];
        const params = [];
        if (!wantsAllColleges) {
            whereClauses.push(`s.college_id = ?`);
            params.push(parsedCollegeId);
        }
        if (isBdeUser) {
            whereClauses.push(`LOWER(TRIM(COALESCE(s.bde_name, ''))) = LOWER(?)`);
            params.push(scopedBdeName);
        }
        const scopedSql = `
            SELECT wsa.student_id,
                   s.name,
                   wsa.exam_id,
                   SUM(COALESCE(wsa.marks_obtained, 0)) AS total_marks,
                   MAX(ws.stream) AS stream
            FROM walkin_student_answers wsa
            JOIN students s ON s.student_id = wsa.student_id
            LEFT JOIN walkin_stream_questions ws ON ws.question_id = wsa.question_id
            WHERE ${whereClauses.join("\n              AND ")}
            GROUP BY wsa.student_id, wsa.exam_id
            ORDER BY s.name, wsa.exam_id
        `;
        const rows = await queryAsync(scopedSql, params);
        res.json(rows || []);
    } catch (error) {
        console.error("Walk-in results error:", error);
        res.status(500).json({ success: false, message: 'Could not load walk-in results' });
    }
});

router.get("/walkin/final-results/:collegeId", async (req, res) => {
    const { collegeId } = req.params;
    const rawCollegeId = String(collegeId || "").trim();
    const wantsAllColleges = !rawCollegeId || /^all$/i.test(rawCollegeId) || rawCollegeId === "*";
    const parsedCollegeId = Number(rawCollegeId);
    const role = String(req.session?.admin?.role || "").trim().toUpperCase();
    const scopedBdeName = String(req.session?.admin?.displayName || "").trim();
    const isBdeUser = role === "BDE";
    if (isBdeUser && !scopedBdeName) {
        return res.status(403).json({ success: false, message: "BDE access only" });
    }
    if (!wantsAllColleges && (!Number.isFinite(parsedCollegeId) || parsedCollegeId <= 0)) {
        return res.json([]);
    }
    try {
        await ensureWalkinAttemptedAtColumn();
        await ensureWalkinSubmissionColumns();
        const whereClauses = [
            `UPPER(REPLACE(TRIM(COALESCE(s.student_type::text, '')), '-', '_')) IN ('WALK_IN', 'WALKIN')`
        ];
        const params = [];
        if (!wantsAllColleges) {
            whereClauses.push(`s.college_id = ?`);
            params.push(parsedCollegeId);
        }
        if (isBdeUser) {
            whereClauses.push(`LOWER(TRIM(COALESCE(s.bde_name, ''))) = LOWER(?)`);
            params.push(scopedBdeName);
        }
        const scopedSql = `
            SELECT wfr.*, s.name, s.email_id, s.contact_number, s.college_id, COALESCE(we.stream, s.course) AS stream
            FROM walkin_final_results wfr
            JOIN students s ON s.student_id = wfr.student_id
            LEFT JOIN walkin_exams we ON we.walkin_exam_id = wfr.exam_id
            WHERE ${whereClauses.join("\n              AND ")}
            ORDER BY COALESCE(wfr.attempted_at, '1970-01-01 00:00:00') DESC, wfr.result_id DESC
        `;
        const rows = await queryAsync(scopedSql, params);
        res.json(rows || []);
    } catch (error) {
        console.error("Walk-in final results error:", error);
        res.status(500).json({ success: false, message: 'Could not load walk-in results' });
    }
});

router.get("/dashboard-stats", async (req, res) => {
    try {
        const monthOffsetRaw = Number(req.query?.monthOffset ?? 0);
        const monthOffset = Number.isFinite(monthOffsetRaw)
            ? Math.max(0, Math.min(Math.trunc(monthOffsetRaw), 24))
            : 0;
        
        
        
        const [eventsRows, studentRows, studentTypeRows, walkinStreamRows, bdeRows, thisMonthRegistrationRows, registrationTrendRows, examRows, activeExamRows, resultRows, regularResultedRows, walkinResultedRows] = await Promise.all([
            Promise.resolve([]),
            queryAsync(
                `SELECT COUNT(*) AS total FROM students`
            ),
            queryAsync(
                `
                SELECT
                    COUNT(*) FILTER (
                        WHERE UPPER(REPLACE(TRIM(COALESCE(student_type::text, '')), '-', '_')) IN ('WALK_IN', 'WALKIN')
                    ) AS walkin_count,
                    COUNT(*) FILTER (
                        WHERE UPPER(REPLACE(TRIM(COALESCE(student_type::text, '')), '-', '_')) NOT IN ('WALK_IN', 'WALKIN')
                    ) AS regular_count
                FROM students
                `
            ),
            queryAsync(
                `
                SELECT course, COUNT(*) AS total
                FROM students
                WHERE UPPER(REPLACE(TRIM(COALESCE(student_type::text, '')), '-', '_')) IN ('WALK_IN', 'WALKIN')
                GROUP BY course
                `
            ),
            Promise.resolve([]),
            queryAsync(
                `
                SELECT COUNT(*) AS total
                FROM students
                WHERE timezone('Asia/Kolkata', created_at) >= date_trunc('month', timezone('Asia/Kolkata', NOW()) - (? * INTERVAL '1 month'))
                  AND timezone('Asia/Kolkata', created_at) < date_trunc('month', timezone('Asia/Kolkata', NOW()) - (? * INTERVAL '1 month')) + INTERVAL '1 month'
                `,
                [monthOffset, monthOffset]
            ),
            queryAsync(
                `
                WITH requested_months AS (
                    SELECT (? + 2) AS month_offset
                    UNION ALL
                    SELECT (? + 1) AS month_offset
                    UNION ALL
                    SELECT ? AS month_offset
                )
                SELECT rm.month_offset,
                       TO_CHAR(
                           date_trunc('month', timezone('Asia/Kolkata', NOW()) - (rm.month_offset * INTERVAL '1 month')),
                           'Mon YYYY'
                       ) AS month_label,
                       COALESCE(COUNT(s.student_id), 0) AS total
                FROM requested_months rm
                LEFT JOIN students s
                  ON timezone('Asia/Kolkata', s.created_at) >= date_trunc('month', timezone('Asia/Kolkata', NOW()) - (rm.month_offset * INTERVAL '1 month'))
                 AND timezone('Asia/Kolkata', s.created_at) < date_trunc('month', timezone('Asia/Kolkata', NOW()) - (rm.month_offset * INTERVAL '1 month')) + INTERVAL '1 month'
                GROUP BY rm.month_offset
                ORDER BY rm.month_offset DESC
                `,
                [monthOffset, monthOffset, monthOffset]
            ),
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([]),
            Promise.resolve([]),
            queryAsync(
                `
                SELECT COUNT(DISTINCT wfr.student_id) AS total
                FROM walkin_final_results wfr
                JOIN students s ON s.student_id = wfr.student_id
                WHERE UPPER(REPLACE(TRIM(COALESCE(s.student_type::text, '')), '-', '_')) IN ('WALK_IN', 'WALKIN')
                `
            )
        ]);

        const walkinStreamCounts = {
            "Data Science": 0,
            "Data Analytics": 0,
            "MERN": 0,
            "Agentic AI": 0,
            "Interns Test": 0
        };
        (walkinStreamRows || []).forEach((row) => {
            const normalizedCourse = String(row?.course || "")
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "");
            let label = "";
            if (normalizedCourse === "DS" || normalizedCourse.includes("DATASCIENCE")) label = "Data Science";
            else if (normalizedCourse === "DA" || normalizedCourse.includes("DATAANALYTICS")) label = "Data Analytics";
            else if (normalizedCourse === "MERN" || normalizedCourse.includes("FULLSTACK")) label = "MERN";
            else if (normalizedCourse === "AAI" || normalizedCourse.includes("AGENTICAI")) label = "Agentic AI";
            else if (
                normalizedCourse === "INT" ||
                normalizedCourse.includes("INTERNSTEST") ||
                normalizedCourse.includes("INTERNSHIPTEST")
            ) {
                label = "Interns Test";
            }
            if (label) {
                walkinStreamCounts[label] = Number(row?.total || 0);
            }
        });

        const regularStudentCount = Number(studentTypeRows?.[0]?.regular_count || 0);
        const walkinStudentCount = Number(studentTypeRows?.[0]?.walkin_count || 0);
        const registeredBdeCount = Number(bdeRows?.[0]?.registered_bde_count || 0);
        const assignedBdeCount = Number(bdeRows?.[0]?.assigned_bde_count || 0);
        const unassignedBdeCount = Math.max(registeredBdeCount - assignedBdeCount, 0);

        return res.json({
            success: true,
            events: eventsRows || [],
            studentCount: Number(studentRows?.[0]?.total || 0),
            regularStudentCount,
            walkinStudentCount,
            walkinStreamCounts,
            registeredBdeCount,
            assignedBdeCount,
            unassignedBdeCount,
            thisMonthRegistrations: Number(thisMonthRegistrationRows?.[0]?.total || 0),
            registrationMonthOffset: monthOffset,
            registrationTrend: Array.isArray(registrationTrendRows)
                ? registrationTrendRows.map((row) => ({
                    monthOffset: Number(row?.month_offset || 0),
                    monthLabel: String(row?.month_label || "").trim(),
                    total: Number(row?.total || 0)
                }))
                : [],
            totalExamCount: Number(examRows?.[0]?.total || 0),
            totalActiveExamCount: Number(activeExamRows?.[0]?.total || 0),
            regularResultedCount: Number(regularResultedRows?.[0]?.total || 0),
            walkinResultedCount: Number(walkinResultedRows?.[0]?.total || 0),
            recentResults: resultRows || []
        });
    } catch (error) {
        console.error("Dashboard stats error:", error);
        return res.status(500).json({ success: false, message: "Could not load dashboard stats" });
    }
});

router.post("/walkin/final-results/recompute", async (req, res) => {
    const { studentId = null, examId = null, collegeId = null } = req.body || {};
    const regradeDescriptive = String(req.body?.regradeDescriptive ?? "true").toLowerCase() !== "false";
    const recentLimit = Math.max(1, Math.min(Number(req.body?.recentLimit || 3), 50));
    const useRecentScope = !studentId && !examId && !collegeId;

    try {
        await ensureWalkinAnswerSectionColumn();
        await ensureWalkinSubmissionColumns();
        let scopedKeySet = null;
        if (useRecentScope) {
            const recentRows = await queryAsync(
                `
                SELECT wfr.student_id, wfr.exam_id
                FROM walkin_final_results wfr
                JOIN students s ON s.student_id = wfr.student_id
                WHERE s.student_type = 'WALK_IN'
                ORDER BY
                    wfr.attempted_at DESC NULLS LAST,
                    wfr.result_id DESC
                LIMIT ?
                `,
                [recentLimit]
            );
            const scopedKeys = (recentRows || []).map((row) => `${Number(row.student_id)}|${Number(row.exam_id)}`);
            if (!scopedKeys.length) {
                return res.json({
                    success: true,
                    recomputed_count: 0,
                    descriptive_regraded: 0,
                    rows: []
                });
            }
            scopedKeySet = new Set(scopedKeys);
        }

        let descriptiveRegraded = 0;
        if (regradeDescriptive) {
            const descriptiveRows = await queryAsync(
                `
                SELECT
                    wsa.submission_id,
                    wsa.student_id,
                    wsa.exam_id,
                    wsa.question_id,
                    COALESCE(wsa.descriptive_answer, '') AS descriptive_answer,
                    COALESCE(ws.descriptive_answer, '') AS reference_answer,
                    COALESCE(ws.marks, 0) AS full_marks
                FROM walkin_student_answers wsa
                JOIN (
                    SELECT MAX(submission_id) AS submission_id
                    FROM walkin_student_answers
                    WHERE UPPER(COALESCE(question_type::text, '')) = 'DESCRIPTIVE'
                    GROUP BY student_id, exam_id, question_id, UPPER(COALESCE(section_name, ''))
                ) latest ON latest.submission_id = wsa.submission_id
                JOIN students s
                  ON s.student_id = wsa.student_id
                 AND s.student_type = 'WALK_IN'
                LEFT JOIN walkin_stream_questions ws
                  ON ws.question_id = wsa.question_id
                WHERE (?::BIGINT IS NULL OR wsa.student_id = ?::BIGINT)
                  AND (?::BIGINT IS NULL OR wsa.exam_id = ?::BIGINT)
                  AND (?::BIGINT IS NULL OR s.college_id = ?::BIGINT)
                `,
                [studentId, studentId, examId, examId, collegeId, collegeId]
            );

            const filteredDescriptiveRows = scopedKeySet
                ? (descriptiveRows || []).filter((row) => scopedKeySet.has(`${Number(row.student_id)}|${Number(row.exam_id)}`))
                : (descriptiveRows || []);

            for (const row of filteredDescriptiveRows) {
                const maxMarks = Number(row.full_marks || 0);
                if (maxMarks <= 0) continue;
                const grading = await gradeDescriptiveAnswerDetailed(
                    String(row.reference_answer || ""),
                    String(row.descriptive_answer || ""),
                    maxMarks
                );
                await queryAsync(
                    `UPDATE walkin_student_answers SET marks_obtained = ? WHERE submission_id = ?`,
                    [Number(grading?.score || 0), row.submission_id]
                );
                descriptiveRegraded += 1;
            }
        }
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
        const filteredScopedRows = scopedKeySet
            ? (scopedRows || []).filter((row) => scopedKeySet.has(`${Number(row.student_id)}|${Number(row.exam_id)}`))
            : (scopedRows || []);

        const latestRows = [];
        const seenKeys = new Set();
        for (const row of filteredScopedRows) {
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

        const summaryRefreshResults = [];
        for (const row of upserted) {
            try {
                const refreshed = await refreshWalkinPerformanceSummary(row.student_id, row.exam_id);
                summaryRefreshResults.push({
                    student_id: row.student_id,
                    exam_id: row.exam_id,
                    refreshed
                });
            } catch (summaryError) {
                summaryRefreshResults.push({
                    student_id: row.student_id,
                    exam_id: row.exam_id,
                    refreshed: false,
                    reason: String(summaryError?.message || summaryError)
                });
            }
        }

        return res.json({
            success: true,
            recomputed_count: upserted.length,
            descriptive_regraded: descriptiveRegraded,
            rows: upserted,
            summaries_refreshed: summaryRefreshResults.filter((item) => item.refreshed).length,
            summary_rows: summaryRefreshResults
        });
    } catch (error) {
        console.error("Walk-in recompute error:", error);
        return res.status(500).json({ success: false, message: "Could not recompute walk-in final results" });
    }
});

router.post("/walkin/final-results/fill-summaries", async (req, res) => {
    const { studentId = null, examId = null, collegeId = null, limit = 200 } = req.body || {};
    const forceRefresh =
        String(req.body?.force ?? "").toLowerCase() === "true" ||
        Boolean(studentId || examId || collegeId);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));

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
              AND (?::BOOLEAN = TRUE OR wfr.performance_summary IS NULL OR TRIM(wfr.performance_summary) = '')
            ORDER BY wfr.result_id DESC
            LIMIT ?
            `,
            [studentId, studentId, examId, examId, collegeId, collegeId, forceRefresh, safeLimit]
        );

        if (!targets.length) {
            return res.json({ success: true, updated: 0, skipped: 0, failed: 0, rows: [] });
        }

        const results = [];
        for (const target of targets) {
            const sid = Number(target.student_id);
            const eid = Number(target.exam_id);
            try {
                const refreshed = await refreshWalkinPerformanceSummary(sid, eid);
                if (!refreshed) {
                    results.push({ student_id: sid, exam_id: eid, status: "skipped", reason: "empty_summary" });
                    continue;
                }
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
    const parsePositiveId = (value) => {
        const raw = String(value || "").trim();
        const normalized = raw.startsWith("=") ? raw.slice(1).trim() : raw;
        if (!/^\d+$/.test(normalized)) return null;
        const parsed = Number(normalized);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const parsedCollegeId = parsePositiveId(collegeId);
    const parsedStudentId = parsePositiveId(studentId);
    const parsedExamId = parsePositiveId(examId);
    if (!parsedCollegeId || !parsedStudentId || !parsedExamId) {
        console.warn("Walk-in review invalid route params:", { collegeId, studentId, examId });
        return res.status(400).json({ success: false, message: "Invalid walk-in review context" });
    }
    const role = String(req.session?.admin?.role || "").trim().toUpperCase();
    const scopedBdeName = String(req.session?.admin?.displayName || "").trim();
    const isBdeUser = role === "BDE";
    if (isBdeUser && !scopedBdeName) {
        return res.status(403).json({ success: false, message: "BDE access only" });
    }
    try {
        await ensureWalkinAnswerSectionColumn();
        const studentScopeClause = isBdeUser
            ? `AND LOWER(TRIM(COALESCE(bde_name, ''))) = LOWER(?)`
            : ``;
        const studentScopeParams = isBdeUser
            ? [parsedStudentId, parsedCollegeId, scopedBdeName]
            : [parsedStudentId, parsedCollegeId];
        const studentRows = await queryAsync(
            `
            SELECT student_id, name, course
            FROM students
            WHERE student_id = ?
              AND college_id = ?
              AND student_type = 'WALK_IN'
              ${studentScopeClause}
            LIMIT 1
        `,
            studentScopeParams
        );

        if (!studentRows.length) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        const answers = [];
        const normalizedAnswers = (answers || []).map((row) => ({
            ...row,
            question_text: row.question_text || "Question text unavailable",
            section_label: row.section_label || "Unknown"
        }));
        let performanceSummary = "";
        let feedbackText = "";
        let feedbackQuestionText = "Tell us about the exam, question quality, and overall difficulty.";
        let feedbackSubmissionMode = "";
        let submissionMode = "";
        let submissionReason = "";
        try {
            const summaryRows = await queryAsync(
                `
                SELECT performance_summary, submission_mode, submission_reason
                FROM walkin_final_results
                WHERE student_id = ?
                  AND exam_id = ?
                LIMIT 1
                `,
                [parsedStudentId, parsedExamId]
            );
            performanceSummary = String(summaryRows?.[0]?.performance_summary || "");
            submissionMode = String(summaryRows?.[0]?.submission_mode || "").trim().toUpperCase();
            submissionReason = String(summaryRows?.[0]?.submission_reason || "").trim().toUpperCase();
        } catch (summaryError) {
            const msg = String(summaryError?.message || "");
            if (!/unknown column.*performance_summary/i.test(msg)) {
                console.warn("Walk-in review summary read failed:", msg);
            }
        }
        try {
            const feedbackRows = await queryAsync(
                `
                SELECT feedback_text, submission_mode
                FROM walkin_exam_feedback
                WHERE student_id = ?
                  AND walkin_exam_id = ?
                LIMIT 1
                `,
                [parsedStudentId, parsedExamId]
            );
            feedbackText = String(feedbackRows?.[0]?.feedback_text || "").trim();
            feedbackSubmissionMode = String(feedbackRows?.[0]?.submission_mode || "").trim().toUpperCase();
        } catch (feedbackError) {
            console.warn("Walk-in review feedback read failed:", String(feedbackError?.message || feedbackError));
        }

        return res.json({
            success: true,
            student: studentRows[0],
            exam_id: parsedExamId,
            answers: normalizedAnswers,
            performance_summary: performanceSummary,
            performance_summary_meta: null,
            feedback_text: feedbackText,
            feedback_question_text: feedbackQuestionText,
            feedback_submission_mode: feedbackSubmissionMode,
            submission_mode: submissionMode,
            submission_reason: submissionReason
        });
    } catch (error) {
        console.error("Walk-in review error:", error);
        return res.status(500).json({ success: false, message: "Could not load walk-in answer review" });
    }
});

/* ================= WALK-IN TEMP STUDENT REQUESTS ================= */
router.post("/walkin/temp-students", async (req, res) => {
    if (!isBdeUser(req)) {
        return res.status(403).json({ success: false, message: "Only BDE users can register walk-in requests" });
    }

    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const dob = String(req.body?.dob || "").trim();
    const stream = normalizeWalkinStreamLabel(req.body?.stream);
    const collegeId = Number(req.body?.collegeId || 0);
    const bdeName = String(req.session?.admin?.displayName || "").trim();

    if (!name || !email || !phone || !dob || !stream || !collegeId || !bdeName) {
        return res.status(400).json({ success: false, message: "Missing required walk-in details" });
    }
    if (!isAtLeastAge(dob, 18)) {
        return res.status(400).json({ success: false, message: "Student must be at least 18 years old." });
    }

    try {
        const [collegeRows, studentRows, pendingRows] = await Promise.all([
            queryAsync(`SELECT college_id FROM college WHERE college_id = ? LIMIT 1`, [collegeId]),
            queryAsync(`SELECT student_id FROM students WHERE LOWER(TRIM(email_id)) = LOWER(?) LIMIT 1`, [email]),
            queryAsync(
                `SELECT id
                 FROM walkin_temp_students
                 WHERE LOWER(TRIM(email_id)) = LOWER(?)
                   AND status = ?
                 LIMIT 1`,
                [email, WALKIN_TEMP_STATUS.PENDING]
            )
        ]);

        if (!collegeRows || collegeRows.length === 0) {
            return res.status(400).json({ success: false, message: "Selected college not found" });
        }
        if (studentRows && studentRows.length > 0) {
            return res.status(400).json({ success: false, message: "Email already registered as student" });
        }
        if (pendingRows && pendingRows.length > 0) {
            return res.status(400).json({ success: false, message: "A pending walk-in request already exists for this email" });
        }

        const insertResult = await queryAsync(
            `INSERT INTO walkin_temp_students
             (name, email_id, contact_number, dob, stream, college_id, bde_name, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
            [name, email, phone, dob, stream, collegeId, bdeName, WALKIN_TEMP_STATUS.PENDING]
        );

        const requestId = getInsertedId(insertResult, "id");
        return res.json({
            success: true,
            message: "Walk-in request submitted for admin approval.",
            requestId
        });
    } catch (error) {
        console.error("Create walk-in temp student error:", error);
        return res.status(500).json({ success: false, message: "Could not save walk-in request" });
    }
});

router.get("/walkin/temp-students", async (req, res) => {
    const role = getCurrentRole(req);
    if (role !== "ADMIN" && role !== "BDE") {
        return res.status(403).json({ success: false, message: "Unauthorized role" });
    }

    const statusRaw = String(req.query?.status || "PENDING").trim().toUpperCase();
    const filterByStatus =
        [WALKIN_TEMP_STATUS.PENDING, WALKIN_TEMP_STATUS.APPROVED, WALKIN_TEMP_STATUS.REJECTED].includes(statusRaw)
            ? statusRaw
            : "";

    const whereClauses = [];
    const params = [];
    if (filterByStatus) {
        whereClauses.push(`wts.status = ?`);
        params.push(filterByStatus);
    }
    if (role === "BDE") {
        const bdeName = String(req.session?.admin?.displayName || "").trim();
        whereClauses.push(`LOWER(TRIM(COALESCE(wts.bde_name, ''))) = LOWER(?)`);
        params.push(bdeName);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    try {
        const rows = await queryAsync(
            `
            SELECT wts.id,
                   wts.name,
                   wts.email_id,
                   wts.contact_number,
                   wts.dob,
                   wts.stream,
                   wts.college_id,
                   c.college_name,
                   wts.bde_name,
                   wts.status
            FROM walkin_temp_students wts
            LEFT JOIN college c ON c.college_id = wts.college_id
            ${whereSql}
            ORDER BY wts.id DESC
            `,
            params
        );
        return res.json({ success: true, requests: Array.isArray(rows) ? rows : [] });
    } catch (error) {
        console.error("List walk-in temp students error:", error);
        return res.status(500).json({ success: false, message: "Could not load walk-in requests" });
    }
});

router.post("/walkin/temp-students/:id/approve", async (req, res) => {
    if (!isAdminUser(req)) {
        return res.status(403).json({ success: false, message: "Only admin can approve walk-in requests" });
    }

    const requestId = Number(req.params.id || 0);
    if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid request id" });
    }

    try {
        const approvalResult = await db.withTransaction(async (txQuery) => {
            const rows = await txQuery(
                `
                SELECT id, name, email_id, contact_number, dob, stream, college_id, status
                FROM walkin_temp_students
                WHERE id = ?
                FOR UPDATE
                `,
                [requestId]
            );
            const requestRow = rows?.[0];
            if (!requestRow) {
                return { statusCode: 404, body: { success: false, message: "Walk-in request not found" } };
            }
            if (String(requestRow.status || "").toUpperCase() !== WALKIN_TEMP_STATUS.PENDING) {
                return { statusCode: 400, body: { success: false, message: "Only pending requests can be approved" } };
            }

            const duplicateRows = await txQuery(
                `SELECT student_id FROM students WHERE LOWER(TRIM(email_id)) = LOWER(?) LIMIT 1`,
                [requestRow.email_id]
            );
            if (duplicateRows && duplicateRows.length > 0) {
                return {
                    statusCode: 400,
                    body: { success: false, message: "A student account with this email already exists" }
                };
            }

            const streamLabel = normalizeWalkinStreamLabel(requestRow.stream);
            if (!streamLabel) {
                return { statusCode: 400, body: { success: false, message: "Invalid stream on walk-in request" } };
            }

            const insertStudentResult = await txQuery(
                `
                INSERT INTO students
                (name, email_id, contact_number, dob, course, college_id, student_type, bde_name)
                VALUES (?, ?, ?, ?, ?, ?, 'WALK_IN', ?)
                RETURNING student_id
                `,
                [
                    String(requestRow.name || "").trim(),
                    String(requestRow.email_id || "").trim(),
                    String(requestRow.contact_number || "").trim(),
                    requestRow.dob,
                    streamLabel,
                    Number(requestRow.college_id || 0),
                    String(requestRow.bde_name || "").trim()
                ]
            );

            const newStudentId = getInsertedId(insertStudentResult, "student_id");
            if (!newStudentId) {
                throw new Error("Could not create student account");
            }

            const autoPassword = buildWalkinAutoPassword(requestRow.name, requestRow.dob);
            await txQuery(
                `
                INSERT INTO student_credentials
                (student_id, password, role_id)
                VALUES (?, ?, 1)
                ON CONFLICT (student_id) DO UPDATE
                SET password = EXCLUDED.password
                `,
                [newStudentId, autoPassword]
            );

            await txQuery(
                `UPDATE walkin_temp_students
                 SET status = ?
                 WHERE id = ?`,
                [WALKIN_TEMP_STATUS.APPROVED, requestId]
            );

            return {
                statusCode: 200,
                body: {
                    success: true,
                    message: "Walk-in request approved and student account created.",
                    credentials: {
                        studentId: newStudentId,
                        email: String(requestRow.email_id || "").trim(),
                        password: autoPassword
                    }
                }
            };
        });

        return res.status(approvalResult.statusCode).json(approvalResult.body);
    } catch (error) {
        console.error("Approve walk-in temp student error:", error);
        return res.status(500).json({ success: false, message: "Could not approve walk-in request" });
    }
});

router.post("/walkin/temp-students/:id/reject", async (req, res) => {
    if (!isAdminUser(req)) {
        return res.status(403).json({ success: false, message: "Only admin can reject walk-in requests" });
    }

    const requestId = Number(req.params.id || 0);
    if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid request id" });
    }

    try {
        const existingRows = await queryAsync(
            `SELECT id, status FROM walkin_temp_students WHERE id = ? LIMIT 1`,
            [requestId]
        );
        if (!existingRows || existingRows.length === 0) {
            return res.status(404).json({ success: false, message: "Walk-in request not found" });
        }
        if (String(existingRows[0].status || "").toUpperCase() !== WALKIN_TEMP_STATUS.PENDING) {
            return res.status(400).json({ success: false, message: "Only pending requests can be rejected" });
        }

        await queryAsync(
            `UPDATE walkin_temp_students
             SET status = ?
             WHERE id = ?`,
            [WALKIN_TEMP_STATUS.REJECTED, requestId]
        );
        return res.json({ success: true, message: "Walk-in request rejected." });
    } catch (error) {
        console.error("Reject walk-in temp student error:", error);
        return res.status(500).json({ success: false, message: "Could not reject walk-in request" });
    }
});
/* ================= WALK-IN STUDENT CREATION ================= */
router.post("/students/walkin", (req, res) => {
    const {
        name,
        email,
        phone,
        dob,
        course,
        collegeId: payloadCollegeId,
        bdeName: payloadBdeName,
        bdeNameOther: payloadBdeNameOther
    } = req.body;
    const collegeId = String(payloadCollegeId || "").trim();
    const bdeName = String(payloadBdeName || "").trim();
    const bdeNameOther = String(payloadBdeNameOther || "").trim();
    const streamCode = getCanonicalWalkinStreamCode(course);
    const streamLabel = streamCode ? getWalkinStreamLabel(streamCode) : "";

    if (!name || !email || !phone || !dob || !course) {
        return res.status(400).json({ success: false, message: "Missing required walk-in details" });
    }
    if (!isAtLeastAge(String(dob || "").trim(), 18)) {
        return res.status(400).json({ success: false, message: "Student must be at least 18 years old." });
    }

    if (!streamCode) {
        return res.status(400).json({ success: false, message: "Invalid walk-in stream. Use DS, DA, MERN, AAI, or INT." });
    }

    if (!collegeId) {
        return res.status(400).json({ success: false, message: "College is required" });
    }
    if (!Number.isFinite(Number(collegeId)) || Number(collegeId) <= 0) {
        return res.status(400).json({ success: false, message: "Invalid college selection" });
    }
    if (!bdeName) {
        return res.status(400).json({ success: false, message: "BDE is required" });
    }

    const normalizedBdeName = bdeName.toUpperCase();
    const assignedFromOther = normalizedBdeName === "OTHER" ? bdeNameOther : "";

    const createStudentWithBde = (assignedBdeName) => {
        db.query(
            `SELECT college_id FROM college WHERE college_id = ? LIMIT 1`,
            [Number(collegeId)],
            (collegeErr, collegeRows) => {
                if (collegeErr) {
                    console.error("Walk-in college validation error:", collegeErr);
                    return res.status(500).json({ success: false, message: "Server error" });
                }
                if (!collegeRows || collegeRows.length === 0) {
                    return res.status(400).json({ success: false, message: "Selected college not found" });
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
                    INSERT INTO students
                    (name, email_id, contact_number, dob, course, college_id, student_type, bde_name)
                    VALUES (?, ?, ?, ?, ?, ?, 'WALK_IN', ?)
                    RETURNING student_id
                    `,
                    [
                        name.trim(),
                        email.trim(),
                        phone.trim(),
                        dob,
                        streamLabel,
                        collegeId,
                        assignedBdeName
                    ],
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
            }
                );
            }
        );
    };

    if (normalizedBdeName === "OTHER") {
        if (!assignedFromOther) {
            return res.status(400).json({ success: false, message: "Other BDE name is required" });
        }
        return createStudentWithBde(assignedFromOther);
    }

    const resolveBdeAndProceed = () => {
        db.query(
            `
            SELECT bde_name
            FROM bdes
            WHERE LOWER(TRIM(bde_name)) = LOWER(?)
            LIMIT 1
            `,
            [bdeName],
            (bdeErr, bdeRows) => {
                if (bdeErr) {
                    console.error("Walk-in BDE validation error:", bdeErr);
                    return res.status(500).json({ success: false, message: "Server error" });
                }
                if (!bdeRows || bdeRows.length === 0) {
                    return res.status(400).json({ success: false, message: "Selected BDE not found" });
                }
                const assignedBdeName = String(bdeRows[0].bde_name || "").trim();
                return createStudentWithBde(assignedBdeName);
            }
        );
    };

    resolveBdeAndProceed();
});

/* ================= REGULAR STUDENT CREATION ================= */

router.post("/students/regular/bulk", async (req, res) => {
    const collegeId = Number(req.body?.collegeId || 0);
    const sourceRows = Array.isArray(req.body?.students) ? req.body.students : [];

    if (!collegeId) {
        return res.status(400).json({ success: false, message: "Select a college for this bulk upload." });
    }
    if (!Number.isInteger(collegeId) || collegeId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid college selection" });
    }
    if (sourceRows.length === 0) {
        return res.status(400).json({ success: false, message: "Upload at least one regular student row." });
    }

    try {
        const collegeRows = await queryAsync(
            `SELECT college_id, college_name FROM college WHERE college_id = ? LIMIT 1`,
            [collegeId]
        );
        if (!collegeRows || collegeRows.length === 0) {
            return res.status(400).json({ success: false, message: "Selected college not found" });
        }

        const collegeName = String(collegeRows[0]?.college_name || "").trim();
        const createdStudents = [];
        const failedStudents = [];
        const seenEmails = new Set();

        for (let index = 0; index < sourceRows.length; index += 1) {
            const row = sourceRows[index] || {};
            const rowNumber = Number(row?.rowNumber || 0) || index + 2;
            const name = normalizeBulkCell(row?.name);
            const email = normalizeBulkCell(row?.email);
            const phone = normalizeBulkCell(row?.phone);
            const dob = normalizeBulkCell(row?.dob);
            const course = normalizeBulkCell(row?.course);
            const failureBase = { rowNumber, name, email, phone, dob, course };

            if (!name || !email || !phone || !dob || !course) {
                failedStudents.push({ ...failureBase, reason: "Missing one or more required fields" });
                continue;
            }

            const normalizedEmail = email.toLowerCase();
            if (seenEmails.has(normalizedEmail)) {
                failedStudents.push({ ...failureBase, reason: "Duplicate email in the uploaded file" });
                continue;
            }
            seenEmails.add(normalizedEmail);

            if (!isAtLeastAge(dob, 18)) {
                failedStudents.push({ ...failureBase, reason: "Student must be at least 18 years old" });
                continue;
            }

            const backgroundType = await getResolvedBackgroundType(course);
            if (!backgroundType || !getRegularTechnicalSection(backgroundType)) {
                failedStudents.push({
                    ...failureBase,
                    reason: "Course is not mapped to a valid TECH/NON_TECH regular background"
                });
                continue;
            }

            const duplicateRows = await queryAsync(
                `SELECT student_id FROM students WHERE LOWER(TRIM(email_id)) = LOWER(TRIM(?)) LIMIT 1`,
                [email]
            );
            if (duplicateRows && duplicateRows.length > 0) {
                failedStudents.push({ ...failureBase, reason: "Email already registered" });
                continue;
            }

            try {
                const createResult = await db.withTransaction(async (txQuery) => {
                    const insertStudentResult = await txQuery(
                        `
                        INSERT INTO students
                        (name, email_id, contact_number, dob, course, background_type, college_id, student_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'REGULAR', NULL)
                        RETURNING student_id
                        `,
                        [name, email, phone, dob, course, backgroundType, collegeId]
                    );

                    const newStudentId = getInsertedId(insertStudentResult, "student_id");
                    if (!newStudentId) {
                        throw new Error("Could not create regular student account");
                    }

                    const autoPassword = buildWalkinAutoPassword(name, dob);
                    await txQuery(
                        `
                        INSERT INTO student_credentials
                        (student_id, password)
                        VALUES (?, ?)
                        `,
                        [newStudentId, autoPassword]
                    );

                    return {
                        studentId: newStudentId,
                        password: autoPassword
                    };
                });

                createdStudents.push({
                    rowNumber,
                    studentId: createResult.studentId,
                    name,
                    email,
                    phone,
                    dob,
                    course,
                    backgroundType,
                    password: createResult.password
                });
            } catch (error) {
                const message = String(error?.message || error);
                const normalizedMessage = message.toLowerCase();
                const reason = normalizedMessage.includes("duplicate key") || normalizedMessage.includes("unique")
                    ? "Email already registered"
                    : "Could not create this student";
                failedStudents.push({ ...failureBase, reason });
            }
        }

        return res.json({
            success: true,
            collegeId,
            collegeName,
            registeredCount: createdStudents.length,
            failedCount: failedStudents.length,
            hasFailures: failedStudents.length > 0,
            message: `${createdStudents.length} regular student${createdStudents.length === 1 ? "" : "s"} registered successfully.`,
            createdStudents,
            failedStudents
        });
    } catch (error) {
        console.error("Regular bulk student creation error:", error);
        return res.status(500).json({ success: false, message: "Could not process the bulk regular student upload" });
    }
});

/* ================= ADMIN EXAMS ================= */
router.get("/exams", (req, res) => {
    db.query(
        `
        SELECT e.exam_id, e.exam_status, e.start_at, e.end_at, e.duration_minutes, e.college_id, c.college_name
        FROM regular_exams e
        LEFT JOIN college c ON c.college_id = e.college_id
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
        SELECT e.exam_id, e.exam_status, e.start_at, e.end_at, e.duration_minutes, e.college_id, c.college_name
        FROM regular_exams e
        LEFT JOIN college c ON c.college_id = e.college_id
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
    const { stream, startDate, startTime } = req.body;
    const collegeId = Number(req.body?.collegeId || 0);
    if (stream && String(stream).trim()) {
        return res.json({
            success: false,
            message: "Walk-in exams are fixed. No exam creation needed; just create the student account."
        });
    }
    if (!startDate || !startTime) {
        return res.status(400).json({ success: false, message: "Start date/time is required" });
    }
    if (!collegeId) {
        return res.status(400).json({ success: false, message: "College is required" });
    }
    if (!TWENTY_FOUR_HOUR_TIME_RE.test(String(startTime).trim())) {
        return res.status(400).json({ success: false, message: "Start time must be in 24-hour HH:mm (or HH:mm:ss) format" });
    }
    const durationValue = REGULAR_FIXED_DURATION_MINUTES;
    const startEpoch = parseIstDateTimeToEpoch(startDate, startTime);
    if (!Number.isFinite(startEpoch)) {
        return res.status(400).json({ success: false, message: "Invalid start date/time" });
    }
    const endEpoch = startEpoch + durationValue * 60 * 1000;
    const startAt = toIstMysqlDateTime(startEpoch);
    const endAt = toIstMysqlDateTime(endEpoch);

    db.query(
        `SELECT college_id FROM college WHERE college_id = ? LIMIT 1`,
        [collegeId],
        (collegeErr, collegeRows) => {
            if (collegeErr) {
                console.error("Create exam college lookup error:", collegeErr);
                return res.status(500).json({ success: false, message: "Could not save exam schedule" });
            }
            if (!collegeRows || collegeRows.length === 0) {
                return res.status(400).json({ success: false, message: "Selected college was not found" });
            }

            db.query(
                `
                SELECT exam_id
                FROM regular_exams
                WHERE exam_status = 'READY'
                  AND COALESCE(is_deleted, FALSE) = FALSE
                  AND college_id = ?
                ORDER BY exam_id DESC
                LIMIT 1
                `,
                [collegeId],
                (lookupErr, examRows) => {
                    if (lookupErr) {
                        console.error("Create exam lookup error:", lookupErr);
                        return res.status(500).json({ success: false, message: "Could not save exam schedule" });
                    }

                    const onExamReady = async (readyExamId) => {
                        try {
                            await createAndActivateRegularQuestionSet(readyExamId);
                            return res.json({ success: true, examId: readyExamId });
                        } catch (generationError) {
                            console.error("Regular exam question bank generation error:", generationError);
                            return res.status(500).json({ success: false, message: "Could not prepare regular exam question bank" });
                        }
                    };

                    if (examRows && examRows.length > 0) {
                        const readyExamId = examRows[0].exam_id;
                        db.query(
                            `UPDATE regular_exams
                             SET exam_status = 'READY',
                                 start_at = ?,
                                 end_at = ?,
                                 duration_minutes = ?,
                                 college_id = ?
                             WHERE exam_id = ?`,
                            [
                                startAt,
                                endAt,
                                durationValue,
                                collegeId,
                                readyExamId
                            ],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error("Update exam error:", updateErr);
                                    return res.status(500).json({ success: false, message: "Could not save exam schedule" });
                                }
                                return onExamReady(readyExamId);
                            }
                        );
                        return;
                    }

                    db.query(
                        `INSERT INTO regular_exams (exam_status, start_at, end_at, duration_minutes, college_id)
                         VALUES ('READY', ?, ?, ?, ?)
                         RETURNING exam_id`,
                        [
                            startAt,
                            endAt,
                            durationValue,
                            collegeId
                        ],
                        async (insertErr, result) => {
                            if (insertErr) {
                                const insertErrCode = String(insertErr?.code || "");
                                const insertErrMsg = String(insertErr?.sqlMessage || insertErr?.message || "");
                                const missingLegacyEventId =
                                    (insertErrCode === "23502" || Number(insertErr?.errno) === 1364) &&
                                    /event_id/i.test(insertErrMsg);
                                const missingLegacyExamId =
                                    (insertErrCode === "23502" || Number(insertErr?.errno) === 1364) &&
                                    /exam_id/i.test(insertErrMsg);
                                if (missingLegacyEventId || missingLegacyExamId) {
                                    try {
                                        const insertColumns = [
                                            "exam_status",
                                            "start_at",
                                            "end_at",
                                            "duration_minutes",
                                            "college_id"
                                        ];
                                        const insertValues = [
                                            "READY",
                                            startAt,
                                            endAt,
                                            durationValue,
                                            collegeId
                                        ];

                                        if (missingLegacyEventId) {
                                            const nextEventIdRows = [];
        const nextEventId = Number(nextEventIdRows?.[0]?.next_event_id || 1);
                                            insertColumns.unshift("event_id");
                                            insertValues.unshift(nextEventId);
                                        }

                                        if (missingLegacyExamId) {
                                            const nextExamIdRows = [];
        const nextExamId = Number(nextExamIdRows?.[0]?.next_exam_id || 1);
                                            insertColumns.unshift("exam_id");
                                            insertValues.unshift(nextExamId);
                                        }

                                        const placeholders = insertColumns.map(() => "?").join(", ");
                                        const fallbackResult = [];
        const fallbackExamId =
                                            Number(fallbackResult?.insertId || fallbackResult?.[0]?.exam_id || 0) || null;
                                        return onExamReady(fallbackExamId);
                                    } catch (fallbackErr) {
                                        console.error("Create exam fallback error:", fallbackErr);
                                        return res.status(500).json({ success: false, message: "Could not save exam schedule" });
                                    }
                                }

                                console.error("Create exam error:", insertErr);
                                return res.status(500).json({ success: false, message: "Could not save exam schedule" });
                            }
                            return onExamReady(result?.insertId);
                        }
                    );
                }
            );
        }
    );
});

/* ================= UPDATE EXAM ================= */
router.put("/exam/:examId", (req, res) => {
    const examId = Number(req.params.examId || 0);
    const { startDate, startTime } = req.body || {};
    const collegeId = Number(req.body?.collegeId || 0);
    if (!Number.isInteger(examId) || examId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    if (!startDate || !startTime) {
        return res.status(400).json({ success: false, message: "Start date/time is required" });
    }
    if (!collegeId) {
        return res.status(400).json({ success: false, message: "College is required" });
    }
    if (!TWENTY_FOUR_HOUR_TIME_RE.test(String(startTime).trim())) {
        return res.status(400).json({ success: false, message: "Start time must be in 24-hour HH:mm (or HH:mm:ss) format" });
    }
    const durationValue = REGULAR_FIXED_DURATION_MINUTES;
    const questionCountValue = REGULAR_FIXED_QUESTION_COUNT;
    const startEpoch = parseIstDateTimeToEpoch(startDate, startTime);
    if (!Number.isFinite(startEpoch)) {
        return res.status(400).json({ success: false, message: "Invalid start date/time" });
    }
    const endEpoch = startEpoch + durationValue * 60 * 1000;
    const startAt = toIstMysqlDateTime(startEpoch);
    const endAt = toIstMysqlDateTime(endEpoch);

    db.query(
        `SELECT college_id FROM college WHERE college_id = ? LIMIT 1`,
        [collegeId],
        (collegeErr, collegeRows) => {
            if (collegeErr) {
                console.error("Update exam college lookup error:", collegeErr);
                return res.status(500).json({ success: false, message: "Could not update exam schedule" });
            }
            if (!collegeRows || collegeRows.length === 0) {
                return res.status(400).json({ success: false, message: "Selected college was not found" });
            }

            db.query(
                `UPDATE regular_exams
                 SET start_at = ?,
                     end_at = ?,
                     duration_minutes = ?,
                     college_id = ?
                 WHERE exam_id = ?`,
                [
                    startAt,
                    endAt,
                    durationValue,
                    collegeId,
                    examId
                ],
                (updateErr, result) => {
                    if (updateErr) {
                        console.error("Update exam schedule error:", updateErr);
                        return res.status(500).json({ success: false, message: "Could not update exam schedule" });
                    }
                    if (!Number(result?.affectedRows || 0)) {
                        return res.status(404).json({ success: false, message: "Exam not found" });
                    }
                    return res.json({ success: true, examId });
                }
            );
        }
    );
});

/* ================= TOGGLE EXAM STATUS ================= */
router.patch("/exam/:examId/status", (req, res) => {
    const examId = Number(req.params.examId || 0);
    const statusRaw = String(req.body?.status || "").trim().toUpperCase();
    if (!Number.isInteger(examId) || examId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid exam id" });
    }
    if (!["READY", "DRAFT"].includes(statusRaw)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
    }

    db.query(
        `UPDATE regular_exams
         SET exam_status = ?
         WHERE exam_id = ?`,
        [statusRaw, examId],
        (updateErr, result) => {
            if (updateErr) {
                console.error("Update exam status error:", updateErr);
                return res.status(500).json({ success: false, message: "Could not update exam status" });
            }
            if (!Number(result?.affectedRows || 0)) {
                return res.status(404).json({ success: false, message: "Exam not found" });
            }
            return res.json({ success: true, examId, exam_status: statusRaw });
        }
    );
});

/* ================= DELETE EXAM ================= */
router.delete("/exam/:examId", (req, res) => {
    const examId = req.params.examId;

    (async () => {
        try {
            
            
            
            
            
            
            
            return res.json({ success: true });
        } catch (error) {
            console.error("Regular exam delete error:", error);
            return res.json({ success: false });
        }
    })();
});

/* ================= GENERATE QUESTIONS ================= */
router.post("/generate-questions/:examId", async (req, res) => {
    const examId = req.params.examId;

    db.query(
        `
        SELECT e.exam_status
        FROM regular_exams e
        WHERE e.exam_id = ?
        `,
        [examId],
        async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return res.json({ success: false, message: "Exam not found" });
            }
            const aptitudeCount = REGULAR_APTITUDE_QUESTION_COUNT;

            try {
                await createAndActivateRegularQuestionSet(examId);

                db.query(
                    `UPDATE regular_exams SET exam_status = 'READY' WHERE exam_id = ?`,
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
                const errorCode = String(error?.code || "").trim().toUpperCase();
                const safeMessage =
                    errorCode === "REGULAR_QUESTION_BANK_INCOMPLETE"
                        ? String(error?.message || "Regular question bank is incomplete.")
                        : "Question generation failed";
                res.status(500).json({ success: false, message: safeMessage });
            }
        }
    );
});


/* ================= REGULAR QUESTION SHEET ================= */

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

router.put("/regular/questions/:category/:questionId", async (req, res) => {
    const category = String(req.params.category || "").trim().toLowerCase();
    const questionId = Number(req.params.questionId);
    if (!["aptitude", "technical"].includes(category)) {
        return res.status(400).json({ success: false, message: "Invalid regular question category" });
    }
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid question id" });
    }

    const questionText = String(req.body?.question_text || "").trim();
    const optionA = String(req.body?.option_a || "").trim();
    const optionB = String(req.body?.option_b || "").trim();
    const optionC = String(req.body?.option_c || "").trim();
    const optionD = String(req.body?.option_d || "").trim();
    const correctAnswer = String(req.body?.correct_answer || "").trim().toUpperCase();

    if (!questionText) {
        return res.status(400).json({ success: false, message: "Question text is required" });
    }
    if (!optionA || !optionB || !optionC || !optionD) {
        return res.status(400).json({ success: false, message: "All four options are required" });
    }
    if (!["A", "B", "C", "D"].includes(correctAnswer)) {
        return res.status(400).json({ success: false, message: "Correct answer must be A, B, C, or D" });
    }

    try {
        await ensureRegularQuestionBankTables();
        const tableName = category === "aptitude" ? "regular_aptitude_questions" : "regular_technical_questions";
        const existingRows = await queryAsync(
            `SELECT question_id FROM ${tableName} WHERE question_id = ? LIMIT 1`,
            [questionId]
        );
        if (!existingRows.length) {
            return res.status(404).json({ success: false, message: "Regular question not found" });
        }

        await queryAsync(
            `UPDATE ${tableName}
             SET question_text = ?,
                 option_a = ?,
                 option_b = ?,
                 option_c = ?,
                 option_d = ?,
                 correct_answer = ?
             WHERE question_id = ?`,
            [questionText, optionA, optionB, optionC, optionD, correctAnswer, questionId]
        );

        return res.json({
            success: true,
            message: category === "aptitude" ? "Regular aptitude question updated" : "Regular technical question updated"
        });
    } catch (error) {
        console.error("Regular question update error:", error);
        return res.status(500).json({ success: false, message: "Could not update regular question" });
    }
});

router.put("/walkin/questions/:category/:questionId", async (req, res) => {
    const category = String(req.params.category || "").trim().toLowerCase();
    const questionId = Number(req.params.questionId);
    if (!["aptitude", "stream", "coding"].includes(category)) {
        return res.status(400).json({ success: false, message: "Invalid question category" });
    }
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid question id" });
    }

    const questionText = String(req.body?.question_text || "").trim();
    if (!questionText) {
        return res.status(400).json({ success: false, message: "Question text is required" });
    }

    const marksRaw = req.body?.marks;
    const parsedMarks = marksRaw === null || marksRaw === undefined || marksRaw === ""
        ? null
        : Number(marksRaw);
    if (parsedMarks !== null && (!Number.isFinite(parsedMarks) || parsedMarks < 0)) {
        return res.status(400).json({ success: false, message: "Marks must be a valid non-negative number" });
    }
    const marks = parsedMarks === null ? null : Number(parsedMarks.toFixed(2));

    try {
        if (category === "coding") {
            const existingRows = await queryAsync(
                `SELECT question_id FROM walkin_coding_questions WHERE question_id = ? LIMIT 1`,
                [questionId]
            );
            if (!existingRows.length) {
                return res.status(404).json({ success: false, message: "Coding question not found" });
            }

            await queryAsync(
                `UPDATE walkin_coding_questions
                 SET question_text = ?, marks = COALESCE(?, marks)
                 WHERE question_id = ?`,
                [questionText, marks, questionId]
            );
            return res.json({ success: true, message: "Coding question updated" });
        }

        if (category === "aptitude") {
            const optionA = String(req.body?.option_a || "").trim();
            const optionB = String(req.body?.option_b || "").trim();
            const optionC = String(req.body?.option_c || "").trim();
            const optionD = String(req.body?.option_d || "").trim();
            const correctOption = String(req.body?.correct_option || "").trim().toUpperCase();
            if (!optionA || !optionB || !optionC || !optionD) {
                return res.status(400).json({ success: false, message: "All four options are required for MCQ questions" });
            }
            if (!["A", "B", "C", "D"].includes(correctOption)) {
                return res.status(400).json({ success: false, message: "Correct option must be A, B, C, or D" });
            }

            const existingRows = await queryAsync(
                `SELECT question_id FROM walkin_aptitude_questions WHERE question_id = ? LIMIT 1`,
                [questionId]
            );
            if (!existingRows.length) {
                return res.status(404).json({ success: false, message: "Aptitude question not found" });
            }

            await queryAsync(
                `UPDATE walkin_aptitude_questions
                 SET question_text = ?,
                     option_a = ?,
                     option_b = ?,
                     option_c = ?,
                     option_d = ?,
                     correct_option = ?,
                     marks = COALESCE(?, marks)
                 WHERE question_id = ?`,
                [questionText, optionA, optionB, optionC, optionD, correctOption, marks, questionId]
            );
            return res.json({ success: true, message: "Aptitude question updated" });
        }

        const existingRows = await queryAsync(
            `SELECT question_id, question_type
             FROM walkin_stream_questions
             WHERE question_id = ?
             LIMIT 1`,
            [questionId]
        );
        if (!existingRows.length) {
            return res.status(404).json({ success: false, message: "Stream question not found" });
        }

        const currentType = String(existingRows[0].question_type || "").trim().toLowerCase();
        const isMcq = currentType.includes("mcq");
        if (isMcq) {
            const optionA = String(req.body?.option_a || "").trim();
            const optionB = String(req.body?.option_b || "").trim();
            const optionC = String(req.body?.option_c || "").trim();
            const optionD = String(req.body?.option_d || "").trim();
            const correctOption = String(req.body?.correct_option || "").trim().toUpperCase();
            if (!optionA || !optionB || !optionC || !optionD) {
                return res.status(400).json({ success: false, message: "All four options are required for MCQ questions" });
            }
            if (!["A", "B", "C", "D"].includes(correctOption)) {
                return res.status(400).json({ success: false, message: "Correct option must be A, B, C, or D" });
            }

            await queryAsync(
                `UPDATE walkin_stream_questions
                 SET question_text = ?,
                     option_a = ?,
                     option_b = ?,
                     option_c = ?,
                     option_d = ?,
                     correct_option = ?,
                     descriptive_answer = NULL,
                     marks = COALESCE(?, marks)
                 WHERE question_id = ?`,
                [questionText, optionA, optionB, optionC, optionD, correctOption, marks, questionId]
            );
            return res.json({ success: true, message: "Stream MCQ question updated" });
        }

        const descriptiveAnswer = String(req.body?.descriptive_answer || "").trim();
        if (!descriptiveAnswer) {
            return res.status(400).json({ success: false, message: "Sample solution is required for descriptive questions" });
        }

        await queryAsync(
            `UPDATE walkin_stream_questions
             SET question_text = ?,
                 option_a = NULL,
                 option_b = NULL,
                 option_c = NULL,
                 option_d = NULL,
                 correct_option = NULL,
                 descriptive_answer = ?,
                 marks = COALESCE(?, marks)
             WHERE question_id = ?`,
            [questionText, descriptiveAnswer, marks, questionId]
        );
        return res.json({ success: true, message: "Stream descriptive question updated" });
    } catch (error) {
        console.error("Walk-in question update error:", error);
        return res.status(500).json({ success: false, message: "Could not update walk-in question" });
    }
});

router.startupSchemaSync = runAdminStartupSchemaSync;

module.exports = router;







