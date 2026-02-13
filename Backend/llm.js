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

const GRADING_PROMPT_VERSION = "walkin-descriptive-v1";
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
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
    return cleaned.trim();
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

    return {
        sectionTotals,
        sectionPct,
        codingDifficulty,
        codingPassRate,
        majorWeaknessHints
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

            return {
                score: clampedScore,
                meta: {
                    ...baseMeta,
                    provider: "azure",
                    model: azureConfig.deployment,
                    rawOutput,
                    reason: "ok"
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

        return {
            score: clampedScore,
            meta: {
                ...baseMeta,
                provider: "openai",
                model: openaiModel,
                rawOutput,
                reason: "ok"
            }
        };
    } catch (error) {
        const fallbackScore = fallbackSimilarityScore(referenceText, studentText, normalizedMax);
        const openaiFailureReason = extractErrorMessage(error);
        const reason = azureFailureReason
            ? `azure_failed: ${azureFailureReason}; openai_failed: ${openaiFailureReason}`
            : openaiFailureReason === "openai_not_configured"
                ? "llm_not_configured"
                : openaiFailureReason;

        return {
            score: fallbackScore,
            meta: {
                ...baseMeta,
                usedFallback: true,
                reason
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
    const suggestions = [
        technicalPctValue < 55 ? "Revise SQL joins/constraints, DB normalization, and API-data flow basics." : null,
        codingPct < 70 ? "Practice testcase-first coding: handle edge cases, null/empty inputs, and boundary values." : null,
        aptitudePct < 50 ? "Do daily timed sets for percentages, ratios, and arithmetic shortcuts." : null
    ].filter(Boolean).slice(0, 3);
    const suggestionLine = suggestions.length
        ? suggestions.join(" ")
        : "Continue mixed practice across aptitude, technical theory, and coding to sustain balance.";
    const actionPlanLine =
        "Advice + Plan (next 7 days): 1) 30 mins aptitude drills, 2) 45 mins technical concept revision with short written answers, 3) 60 mins coding with post-run testcase analysis and 15 mins post-mortem for failed tests.";
    const overview = hardCodingWeak
        ? "Overall: Student is doing well in easier sections but must labor hard on harder coding problems to become interview-ready."
        : technicalPct <= 0.5
            ? "Overall: Coding potential is visible, but technical depth and expression need focused improvement."
            : "Overall: Balanced progress with room to improve consistency and exam-time accuracy.";

    return normalizeSummaryText([
        `Performance Summary of ${student?.name || "this student"} (${student?.course || "Walk-In"})`,
        `1. Aptitude: ${fmt(sectionStats.Aptitude.scored, sectionStats.Aptitude.max)} (${pct(sectionStats.Aptitude.scored, sectionStats.Aptitude.max)}).`,
        `2. Technical: ${fmt(sectionStats.Technical.scored, sectionStats.Technical.max)} (${pct(sectionStats.Technical.scored, sectionStats.Technical.max)}).`,
        `3. Coding: Easy ${fmt(codingByDifficulty.easy.scored, codingByDifficulty.easy.max)}, Medium ${fmt(codingByDifficulty.medium.scored, codingByDifficulty.medium.max)}, Hard ${fmt(codingByDifficulty.hard.scored, codingByDifficulty.hard.max)}; testcase trend E/M/H = ${codingByDifficulty.easy.passed}/${codingByDifficulty.easy.total}, ${codingByDifficulty.medium.passed}/${codingByDifficulty.medium.total}, ${codingByDifficulty.hard.passed}/${codingByDifficulty.hard.total}.`,
        `4. Major Weaknesses: ${weaknessLine}. Primary area to work hardest on: ${primaryWeakArea}.`,
        `5. Good Areas: ${strengthsLine}`,
        `6. Grammar/Spelling Check: ${grammarNote}`,
        `7. Suggestions: ${suggestionLine} ${actionPlanLine}`,
        `8. ${overview}`
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
        total_testcases: Number(row.total_testcases || 0)
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
        "Point 1: Aptitude performance (score + key mistakes pattern).",
        "Point 2: Technical performance (score + conceptual/writing gaps).",
        "Point 3: Coding performance (easy/medium/hard + testcase trend + where failures happened).",
        "Point 4: Major weaknesses (where student must labor hard; if hard coding is weak, state it clearly).",
        "Point 5: Good areas/strengths (max 2 short points only).",
        "Point 6: Grammar/spelling/clarity check for technical descriptive responses.",
        "Point 7: Actionable suggestions + short weekly action plan with time split.",
        "Point 8: Overall advisor note, clearly stating promotion blockers and next milestone.",
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
                    summary: normalizeSummaryText(summary),
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
                summary: normalizeSummaryText(summary),
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
