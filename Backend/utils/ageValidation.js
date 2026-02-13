function parseIsoDate(input) {
    const raw = String(input || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
        dt.getUTCFullYear() !== year ||
        dt.getUTCMonth() !== month - 1 ||
        dt.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

function isAtLeastAge(dobIso, minAge) {
    const dob = parseIsoDate(dobIso);
    if (!dob) return false;

    const now = new Date();
    let age = now.getUTCFullYear() - dob.year;
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    if (month < dob.month || (month === dob.month && day < dob.day)) {
        age -= 1;
    }
    return age >= Number(minAge || 0);
}

module.exports = {
    isAtLeastAge
};
