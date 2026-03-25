const normalizeCourse = (input = "") =>
    String(input || "")
        .toLowerCase()
        .trim()
        .replace(/[.,]/g, "")
        .replace(/[&_]/g, " ")
        .replace(/[/-]/g, " ")
        .replace(/\s+/g, " ");

const TECH_ALIASES = new Set([
    "btech",
    "btech cs",
    "btech cse",
    "btech it",
    "mtech",
    "mtech cs",
    "mtech cse",
    "mtech it",
    "bca",
    "mca",
    "bsc cs",
    "bsc computer science",
    "bsc it",
    "msc it",
    "msc cs",
    "msc computer science",
    "other tech"
]);

const NON_TECH_ALIASES = new Set([
    "ba",
    "ma",
    "bba",
    "mba",
    "bcom",
    "mcom",
    "bsc physics",
    "bsc phy",
    "msc physics",
    "msc phy",
    "bsc chemistry",
    "bsc che",
    "msc chemistry",
    "msc che",
    "bsc agriculture",
    "other non tech"
]);

const REGULAR_TECHNICAL_SECTION_BY_BACKGROUND = {
    TECH: "TECHNICAL_ADVANCED",
    NON_TECH: "TECHNICAL_BASIC"
};

const getBackgroundType = (course = "") => {
    const normalized = normalizeCourse(course);
    if (!normalized) return null;
    if (TECH_ALIASES.has(normalized)) return "TECH";
    if (NON_TECH_ALIASES.has(normalized)) return "NON_TECH";
    if (/\b(it|computer|computers|software|programming|ai|data science|data analytics)\b/.test(normalized)) {
        return "TECH";
    }
    return null;
};

const getRegularTechnicalSection = (backgroundType = "") =>
    REGULAR_TECHNICAL_SECTION_BY_BACKGROUND[String(backgroundType || "").trim().toUpperCase()] || null;

module.exports = {
    normalizeCourse,
    getBackgroundType,
    getRegularTechnicalSection,
    TECH_ALIASES,
    NON_TECH_ALIASES,
    REGULAR_TECHNICAL_SECTION_BY_BACKGROUND
};
