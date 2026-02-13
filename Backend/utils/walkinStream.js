const STREAM_BY_CODE = {
    DS: "Data Science",
    DA: "Data Analytics",
    MERN: "MERN"
};

function getCanonicalWalkinStreamCode(value) {
    const raw = String(value || "").trim().toUpperCase();
    const compact = raw.replace(/[^A-Z]/g, "");
    if (compact === "DS" || compact.includes("DATASCIENCE")) return "DS";
    if (compact === "DA" || compact.includes("DATAANALYTICS")) return "DA";
    if (compact === "MERN" || compact.includes("FULLSTACK")) return "MERN";
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
    return "mern";
}

module.exports = {
    STREAM_BY_CODE,
    getCanonicalWalkinStreamCode,
    getWalkinStreamCodeOrDefault,
    getWalkinStreamLabel,
    getWalkinStreamQuestionKey
};
