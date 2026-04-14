const STREAM_BY_CODE = {
    DS: "Data Science",
    DA: "Data Analytics",
    MERN: "MERN",
    AAI: "Agentic AI"
};

function getCanonicalWalkinStreamCode(value) {
    const raw = String(value || "").trim().toUpperCase();
    const compact = raw.replace(/[^A-Z]/g, "");
    if (compact === "DS" || compact.includes("DATASCIENCE")) return "DS";
    if (compact === "DA" || compact.includes("DATAANALYTICS")) return "DA";
    if (compact === "MERN" || compact.includes("FULLSTACK")) return "MERN";
    if (compact === "AAI" || compact.includes("AGENTICAI")) return "AAI";
    return null;
}

function getWalkinStreamCodeOrDefault(value, fallbackCode = "MERN") {
    return getCanonicalWalkinStreamCode(value) || fallbackCode;
}

function getWalkinStreamLabel(value) {
    const code = getWalkinStreamCodeOrDefault(value);
    return STREAM_BY_CODE[code] || STREAM_BY_CODE.MERN;
}

function getWalkinStreamQuestionKey(value) {
    const code = getWalkinStreamCodeOrDefault(value);
    if (code === "DS") return "datascience";
    if (code === "DA") return "dataanalytics";
    if (code === "AAI") return "agenticai";
    return "mern";
}

function isWalkinCodingEnabled(value) {
    const code = getWalkinStreamCodeOrDefault(value);
    return code !== "DA" && code !== "AAI";
}

module.exports = {
    STREAM_BY_CODE,
    getCanonicalWalkinStreamCode,
    getWalkinStreamCodeOrDefault,
    getWalkinStreamLabel,
    getWalkinStreamQuestionKey,
    isWalkinCodingEnabled
};
