const axios = require("axios");
const OpenAI = require("openai");

const openaiClient = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const azureConfig = {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT || "").trim(),
    deployment: (process.env.AZURE_OPENAI_DEPLOYMENT || "").trim(),
    apiVersion: (process.env.AZURE_OPENAI_API_VERSION || "").trim(),
    apiKey: (process.env.AZURE_OPENAI_API_KEY || "").trim()
};

const GRADING_PROMPT_VERSION = "walkin-descriptive-v2";
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_GRADE_TIMEOUT_MS || 8000);

function clampScore(value, maxMarks) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) return 0;
    return Number(Math.max(0, Math.min(parsed, maxMarks)).toFixed(2));
}

function parseNumericScore(rawText) {
    const raw = String(rawText || "");
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
}

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4);
}

function normalizeLooseText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[`"'.,;:!?()[\]{}]/g, "")
        .replace(/\s+/g, "")
        .trim();
}

function normalizeSentenceText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stemToken(token) {
    let normalized = String(token || "").toLowerCase().trim();
    const synonymMap = {
        holds: "store",
        hold: "store",
        holding: "store",
        stores: "store",
        storing: "store",
        stored: "store",
        values: "value",
        variables: "variable"
    };
    normalized = synonymMap[normalized] || normalized;

    if (normalized.length > 4 && normalized.endsWith("ing")) normalized = normalized.slice(0, -3);
    else if (normalized.length > 3 && normalized.endsWith("ed")) normalized = normalized.slice(0, -2);
    else if (normalized.length > 3 && normalized.endsWith("es")) normalized = normalized.slice(0, -2);
    else if (normalized.length > 3 && normalized.endsWith("s")) normalized = normalized.slice(0, -1);

    return normalized;
}

function keywordCoverage(reference, studentAnswer) {
    const stopwords = new Set([
        "the", "and", "for", "with", "that", "this", "from", "into", "used",
        "use", "are", "is", "was", "were", "have", "has", "had", "will", "what",
        "when", "where", "which", "inside", "output", "answer", "question"
    ]);
    const toKeywords = (text) =>
        String(text || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .map(stemToken)
            .filter((token) => token.length >= 4 && !stopwords.has(token));

    const refTokens = Array.from(new Set(toKeywords(reference)));
    const ansSet = new Set(toKeywords(studentAnswer));
    if (!refTokens.length) return 0;

    let hits = 0;
    for (const token of refTokens) {
        if (ansSet.has(token)) hits += 1;
    }
    return hits / refTokens.length;
}

function bigramSet(text) {
    const clean = normalizeSentenceText(text).replace(/\s+/g, " ");
    if (!clean) return new Set();
    if (clean.length < 2) return new Set([clean]);
    const set = new Set();
    for (let i = 0; i < clean.length - 1; i += 1) {
        set.add(clean.slice(i, i + 2));
    }
    return set;
}

function diceSimilarity(a, b) {
    const aSet = bigramSet(a);
    const bSet = bigramSet(b);
    if (!aSet.size || !bSet.size) return 0;
    let overlap = 0;
    for (const token of aSet) {
        if (bSet.has(token)) overlap += 1;
    }
    return (2 * overlap) / (aSet.size + bSet.size);
}

function computeFairnessFloorScore(reference, studentAnswer, maxMarks) {
    const referenceText = String(reference || "").trim();
    const studentText = String(studentAnswer || "").trim();
    if (!referenceText || !studentText || !maxMarks) return 0;

    const looseRef = normalizeLooseText(referenceText);
    const looseAns = normalizeLooseText(studentText);
    if (looseRef && looseRef === looseAns) {
        return clampScore(maxMarks, maxMarks);
    }

    const similarity = diceSimilarity(referenceText, studentText);
    const coverage = keywordCoverage(referenceText, studentText);
    let minRatio = 0;

    if (similarity >= 0.97) minRatio = 1;
    else if (similarity >= 0.9) minRatio = Math.max(minRatio, 0.9);
    else if (similarity >= 0.8) minRatio = Math.max(minRatio, 0.75);
    else if (similarity >= 0.7 && coverage >= 0.5) minRatio = Math.max(minRatio, 0.6);
    else if (similarity >= 0.62 && coverage >= 0.4) minRatio = Math.max(minRatio, 0.5);

    if (coverage >= 0.75) minRatio = Math.max(minRatio, 0.75);
    else if (coverage >= 0.6) minRatio = Math.max(minRatio, 0.6);

    return clampScore(minRatio * maxMarks, maxMarks);
}

function fallbackSimilarityScore(reference, studentAnswer, maxMarks) {
    const referenceTokens = tokenize(reference);
    const answerTokens = tokenize(studentAnswer);
    if (!referenceTokens.length || !answerTokens.length) return 0;

    const referenceSet = new Set(referenceTokens);
    let commonCount = 0;
    for (const token of answerTokens) {
        if (referenceSet.has(token)) commonCount += 1;
    }

    const ratio = commonCount / Math.max(referenceSet.size, 1);
    return clampScore(ratio * maxMarks, maxMarks);
}

function extractErrorMessage(error) {
    return String(
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        error ||
        "llm_error"
    );
}

function normalizeSummaryText(text) {
    const cleaned = String(text || "")
        .replace(/Main weak area:[^.]*\.?/gi, "")
        .replace(/Promotion blocked[^.\n]*[.\n]?/gi, "")
        .replace(/Next milestone[^.\n]*[.\n]?/gi, "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => !/promotion blocked|next milestone/i.test(line))
        .filter(Boolean)
        .join("\n");
    return cleaned.trim();
}

const INTERNAL_SKILL_TOPICS = [
    {
        name: "SQL",
        patterns: [/\bsql\b/i, /\bjoin\b/i, /\bgroup\s+by\b/i, /\bwhere\b/i, /\bindex(?:es)?\b/i, /\bprimary\s+key\b/i, /\bforeign\s+key\b/i, /\bnormali[sz]ation\b/i]
    },
    {
        name: "Power BI",
        patterns: [/\bpower\s*bi\b/i, /\bdax\b/i, /\bpower\s*query\b/i, /\bmeasure(?:s)?\b/i, /\bdata\s+model(?:ing)?\b/i, /\bvisuali[sz]ation\b/i]
    },
    {
        name: "Excel",
        patterns: [/\bexcel\b/i, /\bvlookup\b/i, /\bxlookup\b/i, /\bpivot\s*table\b/i, /\bspreadsheet\b/i]
    },
    {
        name: "Python",
        patterns: [/\bpython\b/i, /\bpandas\b/i, /\bnumpy\b/i, /\bdef\b/i]
    },
    {
        name: "JavaScript",
        patterns: [/\bjavascript\b/i, /\becmascript\b/i, /\bjs\b/i, /\basync\b/i, /\bpromise\b/i]
    },
    {
        name: "React",
        patterns: [/\breact\b/i, /\bjsx\b/i, /\buseeffect\b/i, /\bstate\b/i, /\bprops\b/i]
    },
    {
        name: "Node.js",
        patterns: [/\bnode(?:\.js)?\b/i, /\bexpress\b/i, /\bapi\b/i, /\bmiddleware\b/i]
    },
    {
        name: "DBMS",
        patterns: [/\bdbms\b/i, /\bacid\b/i, /\btransaction\b/i, /\bnormali[sz]ation\b/i, /\ber\s+diagram\b/i]
    },
    {
        name: "DSA",
        patterns: [/\balgorithm\b/i, /\bcomplexity\b/i, /\bbig[\s-]?o\b/i, /\barray\b/i, /\bstack\b/i, /\bqueue\b/i, /\btree\b/i, /\bgraph\b/i]
    }
];

function detectInternalSkillTopic(questionText, referenceAnswer) {
    const haystack = `${String(questionText || "")} ${String(referenceAnswer || "")}`;
    let bestName = "";
    let bestScore = 0;
    for (const topic of INTERNAL_SKILL_TOPICS) {
        let score = 0;
        for (const pattern of topic.patterns) {
            if (pattern.test(haystack)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestName = topic.name;
        }
    }
    return bestScore > 0 ? bestName : "";
}

function buildDescriptiveSkillAnalytics(rows = []) {
    const buckets = {};
    for (const row of rows || []) {
        const qType = String(row.question_type || "").toLowerCase();
        if (!qType.includes("descriptive")) continue;

        const topic = detectInternalSkillTopic(row.question_text, row.reference_answer);
        if (!topic) continue;

        if (!buckets[topic]) {
            buckets[topic] = {
                skill: topic,
                attempted: 0,
                answered: 0,
                scored: 0,
                max: 0,
                clarityLow: 0
            };
        }

        const scored = Number(row.marks_obtained || 0);
        const max = Number(row.full_marks || 0);
        const answerText = String(row.descriptive_answer || "").trim();
        const referenceText = String(row.reference_answer || "").trim();
        const answerWords = normalizeSentenceText(answerText).split(/\s+/).filter(Boolean).length;
        const refWords = normalizeSentenceText(referenceText).split(/\s+/).filter(Boolean).length;
        const minExpected = refWords > 0 ? Math.max(6, Math.ceil(refWords * 0.35)) : 6;

        buckets[topic].attempted += 1;
        buckets[topic].scored += scored;
        buckets[topic].max += max;
        if (answerText) {
            buckets[topic].answered += 1;
            if (answerWords > 0 && answerWords < minExpected) {
                buckets[topic].clarityLow += 1;
            }
        } else {
            buckets[topic].clarityLow += 1;
        }
    }

    const skills = Object.values(buckets)
        .map((entry) => {
            const pct = entry.max > 0 ? Math.round((entry.scored / entry.max) * 100) : 0;
            const answerRate = entry.attempted > 0 ? entry.answered / entry.attempted : 0;
            const clarityRiskRate = entry.attempted > 0 ? entry.clarityLow / entry.attempted : 0;
            let level = "Moderate";
            if (pct >= 70 && answerRate >= 0.75) level = "Strong";
            else if (pct < 50 || clarityRiskRate >= 0.5) level = "Weak";
            return {
                ...entry,
                pct,
                answerRate: Number(answerRate.toFixed(2)),
                clarityRiskRate: Number(clarityRiskRate.toFixed(2)),
                level
            };
        })
        .sort((a, b) => (b.max - a.max) || (a.pct - b.pct));

    const strongSkills = skills
        .filter((s) => s.level === "Strong")
        .slice(0, 3)
        .map((s) => `${s.skill} (${s.pct}%, ${s.attempted}Q)`);
    const weakSkills = skills
        .filter((s) => s.level === "Weak")
        .slice(0, 3)
        .map((s) => `${s.skill} (${s.pct}%, ${s.attempted}Q)`);

    return {
        skills,
        strongSkills,
        weakSkills
    };
}

function buildMandatorySectionLines(analytics) {
    const fmt = (scored, max) => `${Number(scored || 0).toFixed(2)}/${Number(max || 0).toFixed(2)}`;
    const pct = (scored, max) => (max > 0 ? `${Math.round((scored / max) * 100)}%` : "N/A");
    const aptitude = analytics?.sectionTotals?.Aptitude || { scored: 0, max: 0 };
    const technical = analytics?.sectionTotals?.Technical || { scored: 0, max: 0 };
    const coding = analytics?.codingDifficulty || {
        easy: { scored: 0, max: 0, passed: 0, total: 0 },
        medium: { scored: 0, max: 0, passed: 0, total: 0 },
        hard: { scored: 0, max: 0, passed: 0, total: 0 }
    };

    return [
        `1. Aptitude: ${fmt(aptitude.scored, aptitude.max)} (${pct(aptitude.scored, aptitude.max)}).`,
        `2. Technical: ${fmt(technical.scored, technical.max)} (${pct(technical.scored, technical.max)}).`,
        `3. Coding: Easy ${fmt(coding.easy.scored, coding.easy.max)} [TC ${coding.easy.passed}/${coding.easy.total}], Medium ${fmt(coding.medium.scored, coding.medium.max)} [TC ${coding.medium.passed}/${coding.medium.total}], Hard ${fmt(coding.hard.scored, coding.hard.max)} [TC ${coding.hard.passed}/${coding.hard.total}].`
    ];
}

function enforceMandatorySectionLines(summaryText, student, analytics, fallbackSummary) {
    const titleLine = `Performance Summary of ${student?.name || "this student"} (${student?.course || "Walk-In"})`;
    const mandatory = buildMandatorySectionLines(analytics);
    const source = normalizeSummaryText(summaryText || "");
    const fallback = normalizeSummaryText(fallbackSummary || "");
    const lines = source ? source.split("\n") : [];
    const fallbackLines = fallback ? fallback.split("\n") : [];
    const title = lines.find((line) => /^Performance Summary of /i.test(line)) || titleLine;

    const extraPointTexts = lines
        .filter((line) => /^\d+\.\s*/.test(line))
        .map((line) => line.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean)
        .slice(3);
    const fallbackPointTexts = fallbackLines
        .filter((line) => /^\d+\.\s*/.test(line))
        .map((line) => line.replace(/^\d+\.\s*/, "").trim())
        .filter(Boolean)
        .slice(3);

    const points4To8 = [];
    for (const text of extraPointTexts) {
        if (points4To8.length >= 5) break;
        points4To8.push(text);
    }
    for (const text of fallbackPointTexts) {
        if (points4To8.length >= 5) break;
        points4To8.push(text);
    }

    const sectionTitles = [
        "Strengths",
        "Areas for Improvement",
        "Communication and Writing Skills",
        "Topic-wise Stats",
        "Overall Advisor Note"
    ];
    const stripLegacyLabel = (value = "") =>
        String(value || "")
            .replace(/^(internal topics\s*-\s*good at|good areas\/strengths|strengths)\s*:\s*/i, "")
            .replace(/^(internal topics\s*-\s*needs labor|major weaknesses|areas for improvement)\s*:\s*/i, "")
            .replace(/^(grammar\/spelling(?:\/clarity)?|communication and writing skills)\s*:\s*/i, "")
            .replace(/^(topic-wise stats(?:\s*\+\s*internal skills \(from descriptive q&a\))?|topic-wise stats)\s*:\s*/i, "")
            .replace(/^(styled suggestions \+ final review|overall advisor note)\s*:\s*/i, "")
            .trim();
    const isGenericPlaceholder = (value = "", heading = "") => {
        const clean = String(value || "").trim().toLowerCase().replace(/[.:]/g, "");
        const headingClean = String(heading || "").trim().toLowerCase().replace(/[.:]/g, "");
        if (!clean) return true;
        if (clean === headingClean) return true;
        if (clean === "na" || clean === "n/a" || clean === "none" || clean === "not available") return true;
        return clean.length < 8;
    };

    const rebuilt = [title, ...mandatory];
    for (let i = 0; i < 5; i += 1) {
        const sectionTitle = sectionTitles[i] || `Point ${i + 4}`;
        const preferred = stripLegacyLabel(points4To8[i] || "");
        const fallbackBody = stripLegacyLabel(fallbackPointTexts[i] || "");
        const body = isGenericPlaceholder(preferred, sectionTitle) ? fallbackBody : preferred;
        if (isGenericPlaceholder(body, sectionTitle)) continue;
        rebuilt.push(`${i + 4}. ${sectionTitle}: ${body}`);
    }
    return normalizeSummaryText(rebuilt.join("\n"));
}

function buildWalkinSummaryAnalytics(rows = []) {
    const sectionTotals = {
        Aptitude: { scored: 0, max: 0, lowCount: 0, attempted: 0 },
        Technical: { scored: 0, max: 0, lowCount: 0, attempted: 0 },
        Coding: { scored: 0, max: 0, lowCount: 0, attempted: 0 }
    };
    const codingDifficulty = {
        easy: { scored: 0, max: 0, passed: 0, total: 0, attempted: 0 },
        medium: { scored: 0, max: 0, passed: 0, total: 0, attempted: 0 },
        hard: { scored: 0, max: 0, passed: 0, total: 0, attempted: 0 }
    };
    const topicTotals = {};

    for (const row of rows || []) {
        const section = String(row.section_label || "").trim();
        const sectionKey = sectionTotals[section] ? section : "Technical";
        const scored = Number(row.marks_obtained || 0);
        const max = Number(row.full_marks || 0);
        const ratio = max > 0 ? scored / max : 0;

        sectionTotals[sectionKey].scored += scored;
        sectionTotals[sectionKey].max += max;
        sectionTotals[sectionKey].attempted += 1;
        if (ratio < 0.5) {
            sectionTotals[sectionKey].lowCount += 1;
        }

        if (sectionKey === "Coding") {
            const difficultyRaw = String(row.coding_difficulty || "").toLowerCase();
            const bucket =
                difficultyRaw.includes("easy") ? "easy"
                    : difficultyRaw.includes("medium") || difficultyRaw.includes("intermediate") ? "medium"
                        : "hard";
            codingDifficulty[bucket].scored += scored;
            codingDifficulty[bucket].max += max;
            codingDifficulty[bucket].passed += Number(row.testcases_passed || 0);
            codingDifficulty[bucket].total += Number(row.total_testcases || 0);
            codingDifficulty[bucket].attempted += 1;
        }

        const questionType = String(row.question_type || "").trim().toUpperCase() || "UNKNOWN";
        const topicKey =
            sectionKey === "Coding"
                ? `Coding-${String(row.coding_difficulty || "hard").trim().toUpperCase()}`
                : `${sectionKey}-${questionType}`;
        if (!topicTotals[topicKey]) {
            topicTotals[topicKey] = { scored: 0, max: 0, attempted: 0 };
        }
        topicTotals[topicKey].scored += scored;
        topicTotals[topicKey].max += max;
        topicTotals[topicKey].attempted += 1;
    }

    const pct = (scored, max) => (max > 0 ? Math.round((scored / max) * 100) : 0);
    const sectionPct = {
        Aptitude: pct(sectionTotals.Aptitude.scored, sectionTotals.Aptitude.max),
        Technical: pct(sectionTotals.Technical.scored, sectionTotals.Technical.max),
        Coding: pct(sectionTotals.Coding.scored, sectionTotals.Coding.max)
    };
    const codingPassRate = {
        easy: codingDifficulty.easy.total > 0
            ? Number((codingDifficulty.easy.passed / codingDifficulty.easy.total).toFixed(2))
            : null,
        medium: codingDifficulty.medium.total > 0
            ? Number((codingDifficulty.medium.passed / codingDifficulty.medium.total).toFixed(2))
            : null,
        hard: codingDifficulty.hard.total > 0
            ? Number((codingDifficulty.hard.passed / codingDifficulty.hard.total).toFixed(2))
            : null
    };
    const majorWeaknessHints = [];
    if (sectionPct.Aptitude < 50) majorWeaknessHints.push("Aptitude accuracy/speed");
    if (sectionPct.Technical < 55) majorWeaknessHints.push("Technical conceptual clarity + written explanation");
    if ((codingPassRate.medium ?? 1) < 0.6) majorWeaknessHints.push("Medium coding (edge cases/testcase handling)");
    if ((codingPassRate.hard ?? 1) < 0.4 || codingDifficulty.hard.max > 0 && codingDifficulty.hard.scored === 0) {
        majorWeaknessHints.push("Hard coding (algorithmic depth/problem decomposition)");
    }

    const topicBreakdown = Object.entries(topicTotals)
        .map(([topic, stats]) => ({
            topic,
            scored: Number(stats.scored || 0),
            max: Number(stats.max || 0),
            attempted: Number(stats.attempted || 0),
            pct: stats.max > 0 ? Math.round((stats.scored / stats.max) * 100) : 0
        }))
        .sort((a, b) => (b.max - a.max) || (a.pct - b.pct));
    const internalSkills = buildDescriptiveSkillAnalytics(rows);

    return {
        sectionTotals,
        sectionPct,
        codingDifficulty,
        codingPassRate,
        majorWeaknessHints,
        topicBreakdown,
        internalSkills
    };
}

function isAzureConfigured() {
    return Boolean(
        azureConfig.endpoint &&
        azureConfig.deployment &&
        azureConfig.apiVersion &&
        azureConfig.apiKey
    );
}

async function gradeWithAzure(prompt, timeoutMs, options = {}) {
    const systemMessage = options.systemMessage || "You grade answers. Return only a numeric score.";
    const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1;
    const maxTokens = Number.isFinite(Number(options.maxTokens)) ? Number(options.maxTokens) : 16;
    const url =
        `${azureConfig.endpoint.replace(/\/+$/, "")}` +
        `/openai/deployments/${azureConfig.deployment}` +
        `/chat/completions?api-version=${azureConfig.apiVersion}`;

    const requestPromise = axios.post(
        url,
        {
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: prompt }
            ],
            temperature,
            max_tokens: maxTokens
        },
        {
            headers: {
                "Content-Type": "application/json",
                "api-key": azureConfig.apiKey
            }
        }
    );

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("llm_timeout")), timeoutMs)
    );

    const response = await Promise.race([requestPromise, timeoutPromise]);
    return String(response?.data?.choices?.[0]?.message?.content || "");
}

async function gradeWithOpenAI(prompt, model, timeoutMs, options = {}) {
    if (!openaiClient) {
        throw new Error("openai_not_configured");
    }
    const systemMessage = options.systemMessage || "You grade answers. Return only a numeric score.";
    const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1;
    const maxTokens = Number.isFinite(Number(options.maxTokens)) ? Number(options.maxTokens) : 16;

    const completionPromise = openaiClient.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt }
        ]
    });

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("llm_timeout")), timeoutMs)
    );

    const response = await Promise.race([completionPromise, timeoutPromise]);
    return String(response?.choices?.[0]?.message?.content || "");
}

async function gradeDescriptiveAnswerDetailed(reference, studentAnswer, maxMarks = 1) {
    const normalizedMax = Number(maxMarks) || 1;
    const referenceText = (reference || "").trim();
    const studentText = (studentAnswer || "").trim();
    const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const baseMeta = {
        provider: isAzureConfigured() ? "azure" : "openai",
        model: isAzureConfigured() ? azureConfig.deployment : openaiModel,
        promptVersion: GRADING_PROMPT_VERSION,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        usedFallback: false,
        rawOutput: "",
        reason: ""
    };

    if (normalizedMax <= 0 || !studentText) {
        return { score: 0, meta: { ...baseMeta, reason: "empty_input_or_zero_max" } };
    }

    const prompt = [
        `Score the student answer from 0 to ${normalizedMax}.`,
        "Be generous for short, factual or output-based answers.",
        "If the student answer is equivalent to the reference (same meaning/output), award full marks.",
        "Treat trivial formatting, casing, or punctuation differences as fully correct.",
        "Focus on conceptual correctness and semantic match.",
        "Return only a number.",
        `Reference: ${referenceText}`,
        `Student: ${studentText}`
    ].join("\n\n");

    let azureFailureReason = "";
    if (isAzureConfigured()) {
        try {
            const rawOutput = await gradeWithAzure(prompt, DEFAULT_TIMEOUT_MS);
            const parsedScore = parseNumericScore(rawOutput);
            const clampedScore = clampScore(parsedScore, normalizedMax);
            const fairnessFloorScore = computeFairnessFloorScore(referenceText, studentText, normalizedMax);
            const finalScore = Math.max(clampedScore, fairnessFloorScore);

            return {
                score: finalScore,
                meta: {
                    ...baseMeta,
                    provider: "azure",
                    model: azureConfig.deployment,
                    rawOutput,
                    reason: finalScore > clampedScore ? "ok_with_fairness_floor" : "ok"
                }
            };
        } catch (error) {
            azureFailureReason = extractErrorMessage(error);
        }
    }

    try {
        const rawOutput = await gradeWithOpenAI(prompt, openaiModel, DEFAULT_TIMEOUT_MS);
        const parsedScore = parseNumericScore(rawOutput);
        const clampedScore = clampScore(parsedScore, normalizedMax);
        const fairnessFloorScore = computeFairnessFloorScore(referenceText, studentText, normalizedMax);
        const finalScore = Math.max(clampedScore, fairnessFloorScore);

        return {
            score: finalScore,
            meta: {
                ...baseMeta,
                provider: "openai",
                model: openaiModel,
                rawOutput,
                reason: finalScore > clampedScore ? "ok_with_fairness_floor" : "ok"
            }
        };
    } catch (error) {
        const fallbackScore = fallbackSimilarityScore(referenceText, studentText, normalizedMax);
        const fairnessFloorScore = computeFairnessFloorScore(referenceText, studentText, normalizedMax);
        const finalFallbackScore = Math.max(fallbackScore, fairnessFloorScore);
        const openaiFailureReason = extractErrorMessage(error);
        const reason = azureFailureReason
            ? `azure_failed: ${azureFailureReason}; openai_failed: ${openaiFailureReason}`
            : openaiFailureReason === "openai_not_configured"
                ? "llm_not_configured"
                : openaiFailureReason;

        return {
            score: finalFallbackScore,
            meta: {
                ...baseMeta,
                usedFallback: true,
                reason: finalFallbackScore > fallbackScore ? `${reason}; fairness_floor_applied` : reason
            }
        };
    }
}

async function gradeDescriptiveAnswer(reference, studentAnswer, maxMarks = 1) {
    const result = await gradeDescriptiveAnswerDetailed(reference, studentAnswer, maxMarks);
    return result.score;
}

function buildDeterministicWalkinSummary(student, rows) {
    const sectionStats = {
        Aptitude: { scored: 0, max: 0, attempted: 0, low: 0 },
        Technical: { scored: 0, max: 0, attempted: 0, low: 0 },
        Coding: { scored: 0, max: 0, attempted: 0, low: 0 }
    };
    const codingByDifficulty = {
        easy: { scored: 0, max: 0, passed: 0, total: 0 },
        medium: { scored: 0, max: 0, passed: 0, total: 0 },
        hard: { scored: 0, max: 0, passed: 0, total: 0 }
    };
    const topicTotals = {};
    for (const row of rows || []) {
        const section = String(row.section_label || "Unknown");
        const sectionKey = sectionStats[section] ? section : "Technical";
        const scored = Number(row.marks_obtained || 0);
        const max = Number(row.full_marks || 0);
        sectionStats[sectionKey].scored += scored;
        sectionStats[sectionKey].max += max;
        sectionStats[sectionKey].attempted += 1;

        const ratio = max > 0 ? scored / max : 0;
        if (ratio <= 0.4) {
            sectionStats[sectionKey].low += 1;
        }

        if (sectionKey === "Coding") {
            const rawDifficulty = String(row.coding_difficulty || "").toLowerCase();
            const bucket =
                rawDifficulty.includes("easy") ? "easy"
                    : rawDifficulty.includes("medium") || rawDifficulty.includes("intermediate") ? "medium"
                        : "hard";
            codingByDifficulty[bucket].scored += scored;
            codingByDifficulty[bucket].max += max;
            codingByDifficulty[bucket].passed += Number(row.testcases_passed || 0);
            codingByDifficulty[bucket].total += Number(row.total_testcases || 0);
        }

        const questionType = String(row.question_type || "").trim().toUpperCase() || "UNKNOWN";
        const topicKey =
            sectionKey === "Coding"
                ? `Coding-${String(row.coding_difficulty || "Hard").trim()}`
                : `${sectionKey}-${questionType}`;
        if (!topicTotals[topicKey]) {
            topicTotals[topicKey] = { scored: 0, max: 0, attempted: 0 };
        }
        topicTotals[topicKey].scored += scored;
        topicTotals[topicKey].max += max;
        topicTotals[topicKey].attempted += 1;
    }

    const fmt = (scored, max) => `${Number(scored || 0).toFixed(2)}/${Number(max || 0).toFixed(2)}`;
    const pctNumber = (scored, max) => (max > 0 ? Math.round((scored / max) * 100) : 0);
    const pct = (scored, max) => (max > 0 ? `${pctNumber(scored, max)}%` : "N/A");
    const hardCodingWeak = codingByDifficulty.hard.total > 0 &&
        codingByDifficulty.hard.passed / Math.max(codingByDifficulty.hard.total, 1) < 0.4;
    const aptitudePct = pctNumber(sectionStats.Aptitude.scored, sectionStats.Aptitude.max);
    const technicalPctValue = pctNumber(sectionStats.Technical.scored, sectionStats.Technical.max);
    const codingPct = pctNumber(
        codingByDifficulty.easy.scored + codingByDifficulty.medium.scored + codingByDifficulty.hard.scored,
        codingByDifficulty.easy.max + codingByDifficulty.medium.max + codingByDifficulty.hard.max
    );
    const technicalPct = sectionStats.Technical.max > 0
        ? sectionStats.Technical.scored / sectionStats.Technical.max
        : 0;
    const grammarNote = technicalPct <= 0.55
        ? "Technical descriptive responses show grammar/spelling/clarity issues; the student needs to improve English communication and grammar skills."
        : "Technical descriptive responses are mostly clear with minor grammar refinements needed.";
    const majorWeaknesses = [];
    const strengths = [];

    if (aptitudePct >= 75) {
        strengths.push("Strong aptitude accuracy and question-solving speed");
    } else if (aptitudePct >= 60) {
        strengths.push("Good aptitude base with decent consistency");
    }
    if (technicalPctValue >= 65) {
        strengths.push("Solid technical understanding in descriptive/technical answers");
    }
    if (codingPct >= 65) {
        strengths.push("Good coding execution on solved questions");
    }

    if (aptitudePct < 50) {
        majorWeaknesses.push("Aptitude speed and arithmetic accuracy");
    }
    if (technicalPctValue < 55) {
        majorWeaknesses.push("Core technical concepts and structured written explanations");
    }
    if (codingByDifficulty.medium.total > 0 &&
        codingByDifficulty.medium.passed / Math.max(codingByDifficulty.medium.total, 1) < 0.6) {
        majorWeaknesses.push("Medium-level coding (edge cases and dry-run validation)");
    }
    if (hardCodingWeak) {
        majorWeaknesses.push("Hard-level coding (algorithm design and complexity control)");
    } else if (codingByDifficulty.hard.max > 0 && codingByDifficulty.hard.scored === 0) {
        majorWeaknesses.push("Hard-level coding not solved; needs stronger problem decomposition and planning");
    }
    const primaryWeakArea = majorWeaknesses.length
        ? majorWeaknesses[0]
        : "Consistency under mixed-difficulty questions";
    const weaknessLine = majorWeaknesses.length
        ? majorWeaknesses.slice(0, 3).join("; ")
        : primaryWeakArea;
    const strengthsLine = strengths.length
        ? strengths.slice(0, 2).join("; ")
        : "Shows willingness to attempt across sections, with scope to improve outcomes.";
    const topicStatsLine = Object.entries(topicTotals)
        .map(([topic, stats]) => {
            const topicPct = stats.max > 0 ? Math.round((stats.scored / stats.max) * 100) : 0;
            const topicLevel = topicPct >= 70 ? "Strong" : topicPct >= 50 ? "Moderate" : "Weak";
            return {
                text: `${topic} ${fmt(stats.scored, stats.max)} (${topicPct}%, ${Number(stats.attempted || 0)}Q, ${topicLevel})`,
                max: Number(stats.max || 0)
            };
        })
        .sort((a, b) => b.max - a.max)
        .slice(0, 5)
        .map((entry) => entry.text)
        .join("; ");
    const descriptiveSkill = buildDescriptiveSkillAnalytics(rows);
    const skillSignalLine = descriptiveSkill.skills.length
        ? descriptiveSkill.skills
            .slice(0, 5)
            .map((skill) => `${skill.skill} ${fmt(skill.scored, skill.max)} (${skill.pct}%, ${skill.level})`)
            .join("; ")
        : "Insufficient descriptive-topic evidence to infer internal skill strengths/weaknesses.";
    const internalStrongLine = descriptiveSkill.strongSkills.length
        ? descriptiveSkill.strongSkills.join("; ")
        : strengthsLine;
    const internalLaborLine = descriptiveSkill.weakSkills.length
        ? descriptiveSkill.weakSkills.join("; ")
        : weaknessLine;
    const suggestionPriority = hardCodingWeak
        ? "Prioritize hard-level coding with 1 timed problem daily plus edge-case dry runs."
        : technicalPctValue < 55
            ? "Prioritize technical concept clarity: revise one topic and write one structured explanation daily."
            : "Prioritize consistency: maintain accuracy with mixed-difficulty timed sets.";
    const suggestionPractice = aptitudePct < 60
        ? "Practice aptitude in 25-minute timed blocks focused on speed + error logging."
        : "Practice coding testcase validation before final submission to avoid avoidable misses.";
    const finalReview = majorWeaknesses.length
        ? `Current focus should remain on labor topics: ${majorWeaknesses.slice(0, 2).join("; ")}.`
        : "Current performance is stable; maintain momentum with regular timed practice and clarity-first explanations.";
    const styledSuggestionLine =
        `[Priority] ${suggestionPriority} | [Practice] ${suggestionPractice} | [Review] ${finalReview}`;

    return normalizeSummaryText([
        `Performance Summary of ${student?.name || "this student"} (${student?.course || "Walk-In"})`,
        `1. Aptitude: ${fmt(sectionStats.Aptitude.scored, sectionStats.Aptitude.max)} (${pct(sectionStats.Aptitude.scored, sectionStats.Aptitude.max)}).`,
        `2. Technical: ${fmt(sectionStats.Technical.scored, sectionStats.Technical.max)} (${pct(sectionStats.Technical.scored, sectionStats.Technical.max)}).`,
        `3. Coding: Easy ${fmt(codingByDifficulty.easy.scored, codingByDifficulty.easy.max)}, Medium ${fmt(codingByDifficulty.medium.scored, codingByDifficulty.medium.max)}, Hard ${fmt(codingByDifficulty.hard.scored, codingByDifficulty.hard.max)}; testcase trend E/M/H = ${codingByDifficulty.easy.passed}/${codingByDifficulty.easy.total}, ${codingByDifficulty.medium.passed}/${codingByDifficulty.medium.total}, ${codingByDifficulty.hard.passed}/${codingByDifficulty.hard.total}.`,
        `4. Strengths: ${internalStrongLine}.`,
        `5. Areas for Improvement: ${internalLaborLine}.`,
        `6. Communication and Writing Skills: ${grammarNote}`,
        `7. Topic-wise Stats: ${topicStatsLine || "Topic-wise marks unavailable for this attempt."} Skill signals: ${skillSignalLine}.`,
        `8. Overall Advisor Note: ${styledSuggestionLine}`
    ].join("\n"));
}

async function generateWalkinPerformanceSummary(student, rows = []) {
    const fallbackSummary = buildDeterministicWalkinSummary(student, rows);
    if (!Array.isArray(rows) || rows.length === 0) {
        return {
            summary: `Summary for ${student?.name || "this student"}: no answers found for this attempt.`,
            meta: { usedFallback: true, reason: "no_answers" }
        };
    }

    const condensedRows = rows.map((row) => ({
        section: row.section_label,
        type: row.question_type,
        marks_obtained: Number(row.marks_obtained || 0),
        full_marks: Number(row.full_marks || 0),
        coding_difficulty: row.coding_difficulty || "",
        testcases_passed: Number(row.testcases_passed || 0),
        total_testcases: Number(row.total_testcases || 0),
        question_text: String(row.question_text || ""),
        descriptive_answer: String(row.descriptive_answer || ""),
        reference_answer: String(row.reference_answer || "")
    }));
    const analytics = buildWalkinSummaryAnalytics(rows);

    const prompt = [
        "Create a concise, evidence-based performance summary for a walk-in student exam review.",
        "First line must be a title: Performance Summary of <Student Name> (<Stream>).",
        "After the title, return exactly 8 numbered points, each on a new line.",
        "Do not mention or quote specific question text.",
        "Use simple professional language with direct advisor tone.",
        "Prioritize weaknesses, mistakes, and weak areas over generic praise.",
        "Every weakness point should cite score/testcase evidence from the provided data.",
        "Point 1: Aptitude score only (marks and percentage only; no explanation).",
        "Point 2: Technical score only (marks and percentage only; no explanation).",
        "Point 3: Coding score only (easy/medium/hard marks + testcases passed/total only; no explanation).",
        "Point 4 heading must be exactly: Strengths. Content: internal topics the student is good at with evidence.",
        "Point 5 heading must be exactly: Areas for Improvement. Content: internal topics requiring labor with evidence.",
        "Point 6 heading must be exactly: Communication and Writing Skills. Content: grammar/spelling/clarity for descriptive answers.",
        "Point 7 heading must be exactly: Topic-wise Stats. Content: numeric stats plus inferred internal skills with marks %, attempt count, and Strong/Moderate/Weak label.",
        "Point 8 heading must be exactly: Overall Advisor Note. Content: styled suggestions using tags like [Priority], [Practice], [Review].",
        "Never use the phrases 'Promotion blocked' or 'Next milestone'.",
        "Keep the summary technical, metric-heavy, and evidence-led.",
        "Infer internal skills from question_text + reference_answer + student descriptive_answer.",
        "Always restart numbering from 1.",
        "Output plain text only.",
        `Student: ${student?.name || "Unknown"} | Stream: ${student?.course || "Unknown"}`,
        `Aggregated analytics JSON (use this for evidence): ${JSON.stringify(analytics)}`,
        `Answers data JSON: ${JSON.stringify(condensedRows)}`
    ].join("\n");

    const llmOptions = {
        systemMessage: "You are an exam performance analyst. Return plain text only.",
        temperature: 0.1,
        maxTokens: 420
    };
    const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

    let azureFailureReason = "";
    if (isAzureConfigured()) {
        try {
            const raw = await gradeWithAzure(prompt, DEFAULT_TIMEOUT_MS, llmOptions);
            const summary = String(raw || "").trim();
            if (summary) {
                return {
                    summary: enforceMandatorySectionLines(summary, student, analytics, fallbackSummary),
                    meta: { provider: "azure", model: azureConfig.deployment, usedFallback: false, reason: "ok" }
                };
            }
            azureFailureReason = "empty_summary_from_azure";
        } catch (error) {
            azureFailureReason = extractErrorMessage(error);
        }
    }

    try {
        const raw = await gradeWithOpenAI(prompt, openaiModel, DEFAULT_TIMEOUT_MS, llmOptions);
        const summary = String(raw || "").trim();
        if (summary) {
            return {
                summary: enforceMandatorySectionLines(summary, student, analytics, fallbackSummary),
                meta: { provider: "openai", model: openaiModel, usedFallback: false, reason: "ok" }
            };
        }
    } catch (error) {
        const openaiFailureReason = extractErrorMessage(error);
        const reason = azureFailureReason
            ? `azure_failed: ${azureFailureReason}; openai_failed: ${openaiFailureReason}`
            : openaiFailureReason;
        return {
            summary: fallbackSummary,
            meta: { usedFallback: true, reason }
        };
    }

    return {
        summary: fallbackSummary,
        meta: { usedFallback: true, reason: azureFailureReason || "empty_summary" }
    };
}

module.exports = {
    openaiClient,
    gradeDescriptiveAnswer,
    gradeDescriptiveAnswerDetailed,
    generateWalkinPerformanceSummary
};
