/**
 * Generator.js
 * Aptitude questions generated via Azure OpenAI based on course name or walk-in stream.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function getDifficultyByCourse(course) {
    const name = String(course || "").toLowerCase();

    if (name.includes("mtech")) return "HARD";
    if (name.includes("mca") || name.includes("btech")) return "MEDIUM";
    if (name.includes("bca") || name.includes("bsc")) return "EASY";

    return "MEDIUM";
}

function loadEnvFromCandidates() {
    const candidates = [
        path.resolve(__dirname, ".env"),
        path.resolve(__dirname, "../.env"),
        path.resolve(__dirname, "../../.env")
    ];

    candidates.forEach(candidate => {
        if (fs.existsSync(candidate)) {
            dotenv.config({ path: candidate });
        }
    });
}

loadEnvFromCandidates();

function getAzureConfig() {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").trim();
    const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT || "").trim();
    const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || "").trim();
    const apiKey = (process.env.AZURE_OPENAI_API_KEY || "").trim();

    if (!endpoint || !deployment || !apiVersion || !apiKey) {
        const missing = [
            endpoint ? null : "AZURE_OPENAI_ENDPOINT",
            deployment ? null : "AZURE_OPENAI_DEPLOYMENT",
            apiVersion ? null : "AZURE_OPENAI_API_VERSION",
            apiKey ? null : "AZURE_OPENAI_API_KEY"
        ]
            .filter(Boolean)
            .join(", ");

        throw new Error(
            `Azure OpenAI config missing in environment (${missing}). ` +
            "Use Backend/.env to set the values before starting the server."
        );
    }

    return { endpoint, deployment, apiVersion, apiKey };
}

function buildPrompt(course, difficulty, count, avoidList) {
    const avoidText = avoidList && avoidList.length > 0
        ? `Avoid these exact question texts:\n${avoidList.map(q => `- ${q}`).join("\n")}\n`
        : "";

    return `
Generate ${count} quantitative aptitude questions for the course "${course}".
Difficulty should be ${difficulty}.
Focus mainly on quantitative aptitude (percentages, ratios, time-speed-distance, algebra, number systems, probability, permutations/combinations, work/time, averages).
You may include a small number of reasoning questions, but avoid subject-specific technical questions.
${avoidText}
Return ONLY a JSON array of objects with these exact keys:
question_text, option_a, option_b, option_c, option_d, correct_answer
Rules:
- correct_answer must be one of: A, B, C, D
- exactly 4 options, only one correct
- no markdown, no extra text
- make questions different from each other
`;
}

function buildRegularAptitudePrompt(_, __, count, avoidList) {
    const avoidText = avoidList && avoidList.length > 0
        ? `Avoid these exact question texts:\n${avoidList.map(q => `- ${q}`).join("\n")}\n`
        : "";

    return `
Generate ${count} aptitude MCQ questions for a regular college scholarship exam.
This aptitude section is common for both tech and non-tech students.
Cover quantitative aptitude, logical reasoning, percentages, ratios, averages, work and time, time-speed-distance, probability, number series, and basic analytical reasoning.
Difficulty should be MEDIUM.
${avoidText}
Return ONLY a JSON array of objects with these exact keys:
question_text, option_a, option_b, option_c, option_d, correct_answer
Rules:
- correct_answer must be one of: A, B, C, D
- exactly 4 options, only one correct
- no markdown, no extra text
- avoid technical or programming-specific content
`;
}

function buildRegularTechnicalBasicPrompt(_, __, count, avoidList) {
    const avoidText = avoidList && avoidList.length > 0
        ? `Avoid these exact question texts:\n${avoidList.map(q => `- ${q}`).join("\n")}\n`
        : "";

    return `
Generate ${count} basic computer MCQ questions for non-tech regular college students.
Cover beginner-friendly topics only: computer fundamentals, hardware vs software, operating systems basics, MS Office basics, internet and email basics, cybersecurity basics, file types, simple networking basics, and everyday digital literacy.
Difficulty should be EASY.
${avoidText}
Return ONLY a JSON array of objects with these exact keys:
question_text, option_a, option_b, option_c, option_d, correct_answer
Rules:
- correct_answer must be one of: A, B, C, D
- exactly 4 options, only one correct
- no markdown, no extra text
- do not ask coding, programming, DBMS, DSA, or deep technical questions
`;
}

function buildRegularTechnicalAdvancedPrompt(_, __, count, avoidList) {
    const avoidText = avoidList && avoidList.length > 0
        ? `Avoid these exact question texts:\n${avoidList.map(q => `- ${q}`).join("\n")}\n`
        : "";

    return `
Generate ${count} advanced computer and IT MCQ questions for tech regular college students.
Cover deeper technical topics such as programming fundamentals, OOP basics, DBMS, operating systems, computer networks, SQL, web basics, data structures, software engineering, and debugging logic.
Difficulty should be MEDIUM to HARD.
${avoidText}
Return ONLY a JSON array of objects with these exact keys:
question_text, option_a, option_b, option_c, option_d, correct_answer
Rules:
- correct_answer must be one of: A, B, C, D
- exactly 4 options, only one correct
- no markdown, no extra text
- focus on conceptual technical understanding rather than long code snippets
`;
}

function buildStreamPrompt(stream, difficulty, count, avoidList) {
    const avoidText = avoidList && avoidList.length > 0
        ? `Avoid these exact question texts:\n${avoidList.map(q => `- ${q}`).join("\n")}\n`
        : "";

    return `
Generate ${count} analytical and applied reasoning questions for the walk-in stream "${stream}".
Difficulty should be ${difficulty}.
Prioritize data-and analytics-focused scenarios (data interpretation, logical reasoning, real-world problem solving, metrics, business math, estimations) that reflect what a walk-in student should master.
${avoidText}
Return ONLY a JSON array of objects with these exact keys:
question_text, option_a, option_b, option_c, option_d, correct_answer
Rules:
- correct_answer must be one of: A, B, C, D
- exactly 4 options, only one correct
- no markdown, no extra text
- keep options concise and varied
`;
}

function extractJsonArray(text) {
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
    } catch (_) {
        // fall through to extraction
    }

    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
        const slice = text.slice(start, end + 1);
        const parsed = JSON.parse(slice);
        if (Array.isArray(parsed)) return parsed;
    }

    throw new Error("Failed to parse JSON array from model response");
}

function normalizeQuestion(q) {
    const questionText = String(q.question_text || "").trim();
    const optionA = String(q.option_a || "").trim();
    const optionB = String(q.option_b || "").trim();
    const optionC = String(q.option_c || "").trim();
    const optionD = String(q.option_d || "").trim();
    const correct = String(q.correct_answer || "").trim().toUpperCase();

    if (!questionText || !optionA || !optionB || !optionC || !optionD) return null;
    if (!["A", "B", "C", "D"].includes(correct)) return null;

    return {
        question_text: questionText,
        option_a: optionA,
        option_b: optionB,
        option_c: optionC,
        option_d: optionD,
        correct_answer: correct
    };
}

async function callAzure(messages) {
    const { endpoint, deployment, apiVersion, apiKey } = getAzureConfig();
    const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const response = await axios.post(
        url,
        {
            messages,
            temperature: 0.7
        },
        {
            headers: {
                "Content-Type": "application/json",
                "api-key": apiKey
            }
        }
    );

    return response.data;
}

function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

async function generateBatch(source, difficulty, count, avoidList, promptBuilder) {
    const prompt = promptBuilder(source, difficulty, count, avoidList);
    const data = await callAzure([
        {
            role: "system",
            content: "You generate aptitude questions and output strict JSON only."
        },
        {
            role: "user",
            content: prompt
        }
    ]);

    const content = data?.choices?.[0]?.message?.content || "";
    const rawArray = extractJsonArray(content);
    const normalized = rawArray
        .map(normalizeQuestion)
        .filter(Boolean);

    if (normalized.length === 0) {
        throw new Error("Model returned no valid questions");
    }

    return normalized;
}

async function generateQuestionsForSource(source, difficulty, count, promptBuilder) {
    const cleanedSource = String(source || "").trim();
    if (!cleanedSource) {
        throw new Error("Missing source for question generation");
    }

    const unique = new Map();
    const maxAttempts = 3;
    let attempt = 0;

    while (unique.size < count && attempt < maxAttempts) {
        const remaining = count - unique.size;
        const avoidList = Array.from(unique.keys());
        const batch = await generateBatch(cleanedSource, difficulty, remaining, avoidList, promptBuilder);

        for (const q of batch) {
            const key = q.question_text.toLowerCase();
            if (!unique.has(key)) unique.set(key, q);
        }

        attempt += 1;
    }

    const result = Array.from(unique.values()).slice(0, count);
    shuffleInPlace(result);
    return result;
}

async function generateQuestionsForCourse(course, count = 10) {
    const difficulty = getDifficultyByCourse(course);
    return generateQuestionsForSource(course, difficulty, count, buildPrompt);
}

async function generateRegularExamQuestions(aptitudeCount = 20, technicalBasicCount = 30, technicalAdvancedCount = 30) {
    const normalizedAptitudeCount = Math.max(0, Number(aptitudeCount) || 0);
    const normalizedTechnicalBasicCount = Math.max(0, Number(technicalBasicCount) || 0);
    const normalizedTechnicalAdvancedCount = Math.max(0, Number(technicalAdvancedCount) || 0);
    const questions = [];
    if (normalizedAptitudeCount > 0) {
        const aptitudeQuestions = await generateQuestionsForSource(
            "regular aptitude",
            "MEDIUM",
            normalizedAptitudeCount,
            buildRegularAptitudePrompt
        );
        aptitudeQuestions.forEach((question) => {
            questions.push({
                ...question,
                section_name: "APTITUDE",
                question_type: "MCQ"
            });
        });
    }

    if (normalizedTechnicalBasicCount > 0) {
        const technicalBasicQuestions = await generateQuestionsForSource(
            "TECHNICAL_BASIC",
            "EASY",
            normalizedTechnicalBasicCount,
            buildRegularTechnicalBasicPrompt
        );
        technicalBasicQuestions.forEach((question) => {
            questions.push({
                ...question,
                section_name: "TECHNICAL_BASIC",
                question_type: "MCQ"
            });
        });
    }

    if (normalizedTechnicalAdvancedCount > 0) {
        const technicalAdvancedQuestions = await generateQuestionsForSource(
            "TECHNICAL_ADVANCED",
            "HARD",
            normalizedTechnicalAdvancedCount,
            buildRegularTechnicalAdvancedPrompt
        );
        technicalAdvancedQuestions.forEach((question) => {
            questions.push({
                ...question,
                section_name: "TECHNICAL_ADVANCED",
                question_type: "MCQ"
            });
        });
    }

    return questions;
}

async function generateQuestionsForStream(stream, count = 10) {
    const difficulty = getDifficultyByCourse(stream);
    return generateQuestionsForSource(stream, difficulty, count, buildStreamPrompt);
}

module.exports = {
    generateQuestionsForCourse,
    generateRegularExamQuestions,
    generateQuestionsForStream
};
