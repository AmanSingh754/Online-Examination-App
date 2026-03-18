const normalizeCourse = (input = "") =>
    String(input || "")
        .toLowerCase()
        .trim()
        .replace(/[.]/g, "")
        .replace(/[/-]/g, " ")
        .replace(/\s+/g, " ");

const TECH_ALIASES = new Set([
    "bsc cs",
    "bsc it",
    "mca",
    "mtech it",
    "mtech cs",
    "btech cs",
    "bca",
    "other tech"
]);

const NON_TECH_ALIASES = new Set([
    "bba",
    "mba",
    "bsc phy",
    "msc phy",
    "msc che",
    "mcom",
    "bcom",
    "other non tech"
]);

const getBackgroundType = (course = "") => {
    const normalized = normalizeCourse(course);
    if (!normalized) return null;
    if (TECH_ALIASES.has(normalized)) return "TECH";
    if (NON_TECH_ALIASES.has(normalized)) return "NON_TECH";
    return null;
};

module.exports = {
    normalizeCourse,
    getBackgroundType,
    TECH_ALIASES,
    NON_TECH_ALIASES
};
