import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import useBodyClass from "../hooks/useBodyClass.js";
import AdminAnalyticsSection from "./admin-dashboard/AdminAnalyticsSection.jsx";

const TECH_REGULAR_COURSES = [
  "BTech",
  "BTech CS",
  "BTech IT",
  "MTech",
  "MTech IT",
  "MTech CS",
  "BCA",
  "BSc CS",
  "BSc IT",
  "MCA",
  "MSc IT",
  "MSc CS",
  "Other Tech"
];

const NON_TECH_REGULAR_COURSES = [
  "BA",
  "MA",
  "BBA",
  "BCom",
  "MBA",
  "MCom",
  "BSc Agriculture",
  "BSc Physics",
  "BSc Chemistry",
  "MSc Physics",
  "MSc Chemistry",
  "Other Non-Tech"
];

const REGULAR_COURSES = [...TECH_REGULAR_COURSES, ...NON_TECH_REGULAR_COURSES];

const WALKIN_STREAMS = ["Data Science", "Data Analytics", "MERN", "Agentic AI"];
const WALKIN_OPTION_KEYS = [
  { key: "option_a", label: "A" },
  { key: "option_b", label: "B" },
  { key: "option_c", label: "C" },
  { key: "option_d", label: "D" }
];;
const REGULAR_BULK_TEMPLATE_COLUMNS = ["Name", "Email", "Phone", "DOB", "Course"];

const normalizeCourseForBackground = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[.]/g, "")
    .replace(/[/-]/g, " ")
    .replace(/\s+/g, " ");

const getRegularBackgroundType = (courseValue) => {
  const normalized = normalizeCourseForBackground(courseValue);
  if (!normalized) return "";
  if (normalized === "other tech") return "TECH";
  if (normalized === "other non tech") return "NON_TECH";
  if ([
    "btech",
    "btech cs",
    "btech it",
    "mtech",
    "mtech it",
    "mtech cs",
    "bca",
    "bsc cs",
    "bsc computer science",
    "bsc it",
    "mca",
    "msc it",
    "msc cs",
    "msc computer science"
  ].includes(normalized)) {
    return "TECH";
  }
  if ([
    "ba",
    "ma",
    "bba",
    "bcom",
    "mba",
    "mcom",
    "bsc physics",
    "bsc chemistry",
    "bsc agriculture",
    "msc physics",
    "msc chemistry",
    "bsc phy",
    "msc phy",
    "msc che"
  ].includes(normalized)) {
    return "NON_TECH";
  }
  return "";
};

const getRegularCoursesByBackground = (background) => {
  const normalized = String(background || "").trim().toUpperCase();
  if (normalized === "TECH") return TECH_REGULAR_COURSES;
  if (normalized === "NON_TECH") return NON_TECH_REGULAR_COURSES;
  return [];
};

const parseStoredTimestampParts = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z)?$/
  );
  if (!match) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4] || "00",
    minute: match[5] || "00",
    second: match[6] || "00"
  };
};

const formatStoredDateLabel = (dateKey) => {
  const parts = parseStoredTimestampParts(`${dateKey}T00:00:00`);
  if (!parts) return dateKey;
  const parsed = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  );
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(parsed);
};

const formatIST24 = (value) => {
  if (!value) return "--";
  const storedParts = parseStoredTimestampParts(value);
  if (storedParts) {
    return `${storedParts.day}/${storedParts.month}/${storedParts.year}, ${storedParts.hour}:${storedParts.minute}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
};

const toISTDateInput = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(parsed);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const toISTTimeInput = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(parsed);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.hour}:${map.minute}`;
};

const toIsoDateString = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeSpreadsheetDob = (value) => {
  if (value instanceof Date) {
    return toIsoDateString(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return toIsoDateString(parsed);
};

const getSpreadsheetCellValue = (row, keys) => {
  const entries = Object.entries(row || {});
  for (const expectedKey of keys) {
    const match = entries.find(([key]) => String(key || "").trim().toLowerCase() === expectedKey.toLowerCase());
    if (match) return match[1];
  }
  return "";
};

const getRegistrationDateKey = (value) => {
  if (!value) return "unknown";
  const storedParts = parseStoredTimestampParts(value);
  if (storedParts) {
    return `${storedParts.year}-${storedParts.month}-${storedParts.day}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(parsed);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const formatRegistrationDateLabel = (value) => {
  if (value === "unknown") return "Registration Date Unavailable";
  return formatStoredDateLabel(value);
};

const buildStudentDateGroups = (students) => {
  const source = Array.isArray(students) ? [...students] : [];
  source.sort((left, right) => {
    const leftTime = left?.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right?.created_at ? new Date(right.created_at).getTime() : 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return Number(right?.student_id || 0) - Number(left?.student_id || 0);
  });

  const groups = [];
  source.forEach((student) => {
    const dateKey = getRegistrationDateKey(student?.created_at);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.dateKey !== dateKey) {
      groups.push({ dateKey, students: [student] });
      return;
    }
    lastGroup.students.push(student);
  });
  return groups;
};

const parseFraction = (value) => {
  const match = String(value || "").match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const scored = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(scored) || !Number.isFinite(total) || total <= 0) return null;
  return { scored, total };
};

const parsePercent = (value) => {
  const match = String(value || "").match(/\((\d+(?:\.\d+)?)\s*%\)/);
  if (!match) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) ? percent : null;
};

const parseSectionSummary = (lines, label) => {
  const line = lines.find((entry) => new RegExp(`^\\d+\\.\\s*${label}\\s*:`, "i").test(entry));
  if (!line) return null;
  const detail = line.replace(/^\d+\.\s*[^:]+:\s*/i, "").trim();
  const marks = parseFraction(detail);
  if (!marks) return null;
  const percent = parsePercent(detail) ?? (marks.scored / marks.total) * 100;
  return {
    label,
    scored: marks.scored,
    total: marks.total,
    percent: Math.max(0, Math.min(100, percent)),
    detail
  };
};

const parseCodingSummary = (lines) => {
  const line = lines.find((entry) => /^\d+\.\s*Coding\s*:/i.test(entry));
  if (!line) return null;
  const detail = line.replace(/^\d+\.\s*Coding\s*:\s*/i, "").trim();
  const levels = [];
  const levelRegex = /(Easy|Medium|Hard)\s+([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*\[TC\s*([0-9]+)\s*\/\s*([0-9]+)\]/gi;
  let levelMatch = levelRegex.exec(detail);
  while (levelMatch) {
    const scored = Number(levelMatch[2]);
    const total = Number(levelMatch[3]);
    const passed = Number(levelMatch[4]);
    const tcTotal = Number(levelMatch[5]);
    levels.push({
      name: levelMatch[1],
      scored,
      total,
      passed,
      tcTotal,
      percent: total > 0 ? Math.max(0, Math.min(100, (scored / total) * 100)) : 0,
      tcPercent: tcTotal > 0 ? Math.max(0, Math.min(100, (passed / tcTotal) * 100)) : 0
    });
    levelMatch = levelRegex.exec(detail);
  }
  if (levels.length === 0) return null;
  const scoredTotal = levels.reduce((sum, level) => sum + level.scored, 0);
  const maxTotal = levels.reduce((sum, level) => sum + level.total, 0);
  const percent = maxTotal > 0 ? Math.max(0, Math.min(100, (scoredTotal / maxTotal) * 100)) : 0;
  return {
    label: "Coding",
    scored: scoredTotal,
    total: maxTotal,
    percent,
    detail,
    levels
  };
};

const parseCodingLevelName = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "Coding";
  if (normalized.includes("easy")) return "Easy";
  if (normalized.includes("intermediate") || normalized.includes("medium")) return "Medium";
  if (normalized.includes("advanced") || normalized.includes("hard")) return "Hard";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const normalizeBdeNameForDashboard = (value, registeredBdeNames = new Set()) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const otherMatch = raw.match(/^other\s*\((.+)\)$/i);
  if (otherMatch) {
    const innerName = String(otherMatch[1] || "").trim();
    return innerName ? `Others(${innerName})` : "Others";
  }
  const normalizedKey = raw.toLowerCase();
  if (registeredBdeNames.has(normalizedKey)) {
    return raw;
  }
  return `Others(${raw})`;
};

const normalizeRegularReviewSection = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "APTITUDE") return "APTITUDE";
  if (normalized === "TECHNICAL_BASIC" || normalized === "TECHNICAL_ADVANCED") return "TECHNICAL";
  return normalized || "GENERAL";
};

const buildRegularReviewSectionMetrics = (questions = []) => {
  const sectionMap = new Map();
  (Array.isArray(questions) ? questions : []).forEach((question) => {
    const sectionKey = normalizeRegularReviewSection(question?.section_name);
    const current = sectionMap.get(sectionKey) || { correct: 0, total: 0, attempted: 0, wrong: 0 };
    current.total += 1;
    const selected = String(question?.selected_option || "").trim().toUpperCase();
    const correct = String(question?.correct_answer || "").trim().toUpperCase();
    if (selected) {
      current.attempted += 1;
      if (selected === correct) {
        current.correct += 1;
      } else {
        current.wrong += 1;
      }
    }
    sectionMap.set(sectionKey, current);
  });
  return {
    aptitude: sectionMap.get("APTITUDE") || { correct: 0, total: 0, attempted: 0, wrong: 0 },
    technical: sectionMap.get("TECHNICAL") || { correct: 0, total: 0, attempted: 0, wrong: 0 }
  };
};

const CODING_LEVEL_ORDER = ["Easy", "Medium", "Hard"];

const getCodingLevelKey = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("easy")) return "Easy";
  if (normalized.includes("medium") || normalized.includes("intermediate")) return "Medium";
  if (normalized.includes("hard") || normalized.includes("advanced")) return "Hard";
  return "";
};

const normalizeCodingLevels = (codingSummary) => {
  const source = Array.isArray(codingSummary?.levels) ? codingSummary.levels : [];
  const byLevel = new Map();
  source.forEach((entry) => {
    const key = getCodingLevelKey(entry?.name);
    if (key) byLevel.set(key, entry);
  });
  return CODING_LEVEL_ORDER.map((levelName) => {
    const found = byLevel.get(levelName);
    if (found) return { ...found, name: levelName };
    return { name: levelName, scored: 0, total: 0, percent: 0, passed: 0, tcTotal: 0, tcPercent: 0 };
  });
};

const splitNarrativePoints = (body = "") => {
  const compact = String(body || "").replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const segments = compact
    .split(/\s*\|\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.flatMap((segment) =>
    segment
      .split(/;\s+|\. (?=[A-Z0-9[])/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
  );
};

const formatNarrativePoint = (label = "", point = "") => {
  const section = String(label || "").trim().toLowerCase();
  const text = String(point || "").trim().replace(/\.+$/, "");
  if (!text) return "";

  if (section === "areas for improvement") {
    const match = text.match(/^([a-z0-9.+#\-\s]+)\((\d+)%\s*,\s*(\d+)q\)$/i);
    if (match) {
      const topic = match[1].trim();
      const percent = Number(match[2]);
      const attempted = Number(match[3]);
      return `${topic}: ${percent}% across ${attempted} question(s). Strengthen fundamentals and add timed implementation practice with edge-case checks.`;
    }
  }

  if (section === "overall advisor note") {
    const tagged = text.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (tagged) {
      const tag = tagged[1].trim();
      const rest = tagged[2].trim();
      return `${tag}: ${rest}`;
    }
  }

  return text;
};

const parseCodingSummaryFromTopicStats = (lines) => {
  const codingLines = lines.filter((entry) => /^coding[-\s_]/i.test(entry));
  if (codingLines.length === 0) return null;
  const levels = [];
  codingLines.forEach((entry) => {
    const match = entry.match(
      /^coding[-\s_]*([a-z]+)\s+([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/i
    );
    if (!match) return;
    const scored = Number(match[2]);
    const total = Number(match[3]);
    if (!Number.isFinite(scored) || !Number.isFinite(total)) return;
    levels.push({
      name: parseCodingLevelName(match[1]),
      scored,
      total,
      passed: 0,
      tcTotal: 0,
      percent: total > 0 ? Math.max(0, Math.min(100, (scored / total) * 100)) : 0,
      tcPercent: 0
    });
  });
  if (levels.length === 0) return null;
  const scoredTotal = levels.reduce((sum, level) => sum + level.scored, 0);
  const maxTotal = levels.reduce((sum, level) => sum + level.total, 0);
  return {
    label: "Coding",
    scored: scoredTotal,
    total: maxTotal,
    percent: maxTotal > 0 ? Math.max(0, Math.min(100, (scoredTotal / maxTotal) * 100)) : 0,
    detail: codingLines.join(" | "),
    levels
  };
};

const buildCodingSummaryFromAnswers = (answers) => {
  const codingAnswers = (Array.isArray(answers) ? answers : []).filter(
    (answer) => String(answer?.question_type || "").toLowerCase() === "coding"
  );
  if (codingAnswers.length === 0) return null;
  const bucket = new Map();
  codingAnswers.forEach((answer) => {
    const rawLevel = String(
      answer?.coding_difficulty ||
      answer?.difficulty ||
      answer?.section_label ||
      answer?.section_name ||
      "Coding"
    );
    const levelName = parseCodingLevelName(rawLevel);
    if (!bucket.has(levelName)) {
      bucket.set(levelName, {
        name: levelName,
        scored: 0,
        total: 0,
        passed: 0,
        tcTotal: 0
      });
    }
    const level = bucket.get(levelName);
    level.scored += Number(answer?.marks_obtained || 0);
    level.total += Number(answer?.full_marks || 0);
    level.passed += Number(answer?.testcases_passed || 0);
    level.tcTotal += Number(answer?.total_testcases || 0);
  });
  const levelSortOrder = { Easy: 1, Medium: 2, Hard: 3 };
  const levels = Array.from(bucket.values())
    .map((level) => ({
      ...level,
      percent: level.total > 0 ? Math.max(0, Math.min(100, (level.scored / level.total) * 100)) : 0,
      tcPercent: level.tcTotal > 0 ? Math.max(0, Math.min(100, (level.passed / level.tcTotal) * 100)) : 0
    }))
    .sort((left, right) => (levelSortOrder[left.name] || 99) - (levelSortOrder[right.name] || 99));
  const scoredTotal = levels.reduce((sum, level) => sum + level.scored, 0);
  const maxTotal = levels.reduce((sum, level) => sum + level.total, 0);
  return {
    label: "Coding",
    scored: scoredTotal,
    total: maxTotal,
    percent: maxTotal > 0 ? Math.max(0, Math.min(100, (scoredTotal / maxTotal) * 100)) : 0,
    detail: "Derived from coding answers",
    levels
  };
};

const WALKIN_COURSE_KEYS = new Set(["DS", "DATASCIENCE", "DA", "DATAANALYTICS", "MERN", "FULLSTACK", "AAI", "AGENTICAI"]);
const isDataAnalyticsStream = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return (
    normalized === "DA" ||
    normalized === "DATAANALYTICS" ||
    normalized === "AAI" ||
    normalized === "AGENTICAI"
  );
};
const getWalkinStreamLabel = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (normalized === "DS" || normalized.includes("DATASCIENCE")) return "Data Science";
  if (normalized === "DA" || normalized.includes("DATAANALYTICS")) return "Data Analytics";
  if (normalized === "MERN" || normalized.includes("FULLSTACK")) return "MERN";
  if (normalized === "AAI" || normalized.includes("AGENTICAI")) return "Agentic AI";
  return "";
};
const isWalkinStudentRow = (student) => {
  const typeNormalized = String(student?.student_type || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (typeNormalized === "WALKIN" || typeNormalized === "WALK_IN") {
    return true;
  }
  const courseKey = String(student?.course || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return WALKIN_COURSE_KEYS.has(courseKey);
};

function AdminDashboard() {
  useBodyClass("dashboard admin-dashboard");

  const location = useLocation();
  const navigate = useNavigate();
  const adminId = (localStorage.getItem("adminId") || "").trim();
  const adminEmail = (
    localStorage.getItem("adminEmail") ||
    localStorage.getItem("adminDisplayName") ||
    ""
  ).trim();
  const [selectedCollegeId, setSelectedCollegeId] = useState(() => {
    const storedCollegeId = (localStorage.getItem("collegeId") || "").trim();
    if (
      storedCollegeId &&
      storedCollegeId !== "null" &&
      storedCollegeId !== "undefined"
    ) {
      return storedCollegeId;
    }
    return "";
  });
  const collegeId = selectedCollegeId;
  const collegeName = "Scholarship Examination System";

  const [exams, setExams] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [registrationMonthOffset, setRegistrationMonthOffset] = useState(0);
  const [registrationTrend, setRegistrationTrend] = useState([]);
  const [regularResultedCount, setRegularResultedCount] = useState(0);
  const [walkinResultedCount, setWalkinResultedCount] = useState(0);
  const [recentResults, setRecentResults] = useState([]);
  const [students, setStudents] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");

  const [scheduleStartDate, setScheduleStartDate] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleCollegeId, setScheduleCollegeId] = useState("");

  const [walkinForm, setWalkinForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    stream: "",
    collegeId: "",
    bdeName: "",
    bdeNameOther: ""
  });
  const [walkinCreateOpen, setWalkinCreateOpen] = useState(false);
  const [walkinStatus, setWalkinStatus] = useState("");
  const [walkinCredentials, setWalkinCredentials] = useState(null);
  const [walkinCreateSubmitting, setWalkinCreateSubmitting] = useState(false);
  const [walkinTempRequests, setWalkinTempRequests] = useState([]);
  const [walkinTempLoading, setWalkinTempLoading] = useState(false);
  const [walkinTempActionLoading, setWalkinTempActionLoading] = useState({});
  const [walkinTempStatus, setWalkinTempStatus] = useState("");
  const [walkinApprovedCredentials, setWalkinApprovedCredentials] = useState(null);
  const [walkinPendingCount, setWalkinPendingCount] = useState(0);
  const [walkinSheetData, setWalkinSheetData] = useState(null);
  const [walkinStreamTab, setWalkinStreamTab] = useState(WALKIN_STREAMS[0]);
  const [walkinSheetSectionTab, setWalkinSheetSectionTab] = useState("aptitude");
  const [walkinSheetLoading, setWalkinSheetLoading] = useState(false);
  const [walkinSheetError, setWalkinSheetError] = useState("");
  const [regularQuestionSectionTab, setRegularQuestionSectionTab] = useState("aptitude");
  const [regularQuestionSheetData, setRegularQuestionSheetData] = useState(null);
  const [regularQuestionSheetLoading, setRegularQuestionSheetLoading] = useState(false);
  const [regularQuestionSheetError, setRegularQuestionSheetError] = useState("");
  const [regularCreateOpen, setRegularCreateOpen] = useState(false);
  const [regularCreateMode, setRegularCreateMode] = useState("manual");
  const [walkinQuestionEditor, setWalkinQuestionEditor] = useState({
    open: false,
    category: "",
    questionId: 0,
    questionType: "",
    stream: "",
    sectionName: "",
    questionText: "",
    marks: "",
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    correctOption: "A",
    descriptiveAnswer: ""
  });
  const [walkinQuestionEditSaving, setWalkinQuestionEditSaving] = useState(false);
  const [walkinQuestionEditStatus, setWalkinQuestionEditStatus] = useState("");
  const [regularQuestionEditor, setRegularQuestionEditor] = useState({
    open: false,
    category: "",
    questionId: 0,
    questionType: "MCQ",
    sectionName: "",
    backgroundType: "",
    questionText: "",
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    correctOption: "A"
  });
  const [regularQuestionEditSaving, setRegularQuestionEditSaving] = useState(false);
  const [regularQuestionEditStatus, setRegularQuestionEditStatus] = useState("");
  const [walkinResults, setWalkinResults] = useState(null);
  const [walkinResultsLoading, setWalkinResultsLoading] = useState(false);
  const [walkinResultsError, setWalkinResultsError] = useState("");
  const [walkinRecomputeLoading, setWalkinRecomputeLoading] = useState(false);
  const [walkinRecomputeStatus, setWalkinRecomputeStatus] = useState("");
  const [walkinReviewData, setWalkinReviewData] = useState(null);
  const [walkinReviewLoading, setWalkinReviewLoading] = useState(false);
  const [walkinReviewError, setWalkinReviewError] = useState("");
  const [walkinReviewView, setWalkinReviewView] = useState("summary");
  const [regularReviewData, setRegularReviewData] = useState(null);
  const [regularReviewLoading, setRegularReviewLoading] = useState(false);
  const [regularReviewError, setRegularReviewError] = useState("");
  const [regularReviewView, setRegularReviewView] = useState("summary");
  const [walkinResultsSearch, setWalkinResultsSearch] = useState("");
  const [walkinResultsStreamFilter, setWalkinResultsStreamFilter] = useState("ALL");
  const [walkinStudentsSearch, setWalkinStudentsSearch] = useState("");
  const [walkinStudentsStreamFilter, setWalkinStudentsStreamFilter] = useState("ALL");
  const [walkinResultsExportStatus, setWalkinResultsExportStatus] = useState("");
  const [bdeStudentsSearch, setBdeStudentsSearch] = useState("");
  const [bdeStudentsBdeFilter, setBdeStudentsBdeFilter] = useState("ALL");
  const [bdeStudentsCourseFilter, setBdeStudentsCourseFilter] = useState("ALL");
  const [bdeStudentsStatusFilter, setBdeStudentsStatusFilter] = useState("ALL");
  const [bdeAccountsSearch, setBdeAccountsSearch] = useState("");
  const [regularStudentsSearch, setRegularStudentsSearch] = useState("");
  const [regularStudentsCourseFilter, setRegularStudentsCourseFilter] = useState("ALL");
  const [regularResultsSearch, setRegularResultsSearch] = useState("");
  const [examListSearch, setExamListSearch] = useState("");
  const examListStatusFilter = "ALL";
  const [studentProfilesSearch, setStudentProfilesSearch] = useState("");
  const [studentProfilesTypeFilter, setStudentProfilesTypeFilter] = useState("ALL");
  const [studentProfilesCourseFilter, setStudentProfilesCourseFilter] = useState("ALL");
  const [collegeList, setCollegeList] = useState([]);
  const [collegeListLoading, setCollegeListLoading] = useState(false);
  const [collegeListError, setCollegeListError] = useState("");
  const [recentCollegeId, setRecentCollegeId] = useState(null);
  const [newCollegeName, setNewCollegeName] = useState("");
  const [collegeActionStatus, setCollegeActionStatus] = useState("");
  const [collegeCreateSubmitting, setCollegeCreateSubmitting] = useState(false);
  const [newBdeForm, setNewBdeForm] = useState({
    bdeName: "",
    phoneNumber: "",
    email: "",
    password: ""
  });
  const [allowBdeManualInput, setAllowBdeManualInput] = useState(false);
  const [bdeActionStatus, setBdeActionStatus] = useState("");
  const [bdeCreateSubmitting, setBdeCreateSubmitting] = useState(false);
  const [editingCollegeId, setEditingCollegeId] = useState(null);
  const [editingCollegeName, setEditingCollegeName] = useState("");

  const [regularForm, setRegularForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    background: "",
    course: "",
    collegeId: "",
    password: ""
  });
  const [regularStatus, setRegularStatus] = useState("");
  const [regularCredentials, setRegularCredentials] = useState(null);
  const [regularCreateSubmitting, setRegularCreateSubmitting] = useState(false);
  const [regularBulkCollegeId, setRegularBulkCollegeId] = useState("");
  const [regularBulkRows, setRegularBulkRows] = useState([]);
  const [regularBulkFileName, setRegularBulkFileName] = useState("");
  const [regularBulkStatus, setRegularBulkStatus] = useState("");
  const [regularBulkSubmitting, setRegularBulkSubmitting] = useState(false);
  const [regularBulkResult, setRegularBulkResult] = useState(null);
  const [collegeOptions, setCollegeOptions] = useState([]);
  const [collegeError, setCollegeError] = useState("");
  const [bdeOptions, setBdeOptions] = useState([]);
  const [bdeError, setBdeError] = useState("");
  const [examCreateSubmitting, setExamCreateSubmitting] = useState(false);
  const [examScheduleStatus, setExamScheduleStatus] = useState("");
  const [editingExamId, setEditingExamId] = useState(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: ""
  });
  const [passwordChangeStatus, setPasswordChangeStatus] = useState("");
  const [passwordChangeSaving, setPasswordChangeSaving] = useState(false);
  const regularBulkFileInputRef = useRef(null);
  const landingSection = location.state?.activeSection;

  const renderWalkinOptions = (item) => {
    const hasOptions = WALKIN_OPTION_KEYS.some(({ key }) => item[key]);
    if (!hasOptions) return null;
    const selectedOption = String(item?.selected_option || "").trim().toUpperCase();
    const correctOption = String(item?.correct_option || "").trim().toUpperCase();
    return (
      <div className="walkin-options">
        {WALKIN_OPTION_KEYS.map(({ key, label }) => {
          const normalizedLabel = String(label || "").trim().toUpperCase();
          const isSelected = Boolean(selectedOption) && selectedOption === normalizedLabel;
          const isCorrect = Boolean(correctOption) && correctOption === normalizedLabel;
          const optionStateClass = isSelected
            ? (isCorrect ? "option-selected-correct" : "option-selected-wrong")
            : (isCorrect ? "option-correct-answer" : "");
          const resultBadge = isSelected
            ? (isCorrect ? "Your Answer ✓" : "Your Answer ✗")
            : (isCorrect ? "Correct ✓" : "");
          return item[key] ? (
            <p className={`item-option ${optionStateClass}`.trim()} key={key}>
              <span className="option-label">{label}.</span>
              <span className="option-text">{item[key]}</span>
              {resultBadge ? <span className="option-result-badge">{resultBadge}</span> : null}
            </p>
          ) : null;
        }
        )}
      </div>
    );
  };

  const renderRegularQuestionSheetOptions = (item) => {
    const hasOptions = WALKIN_OPTION_KEYS.some(({ key }) => item[key]);
    if (!hasOptions) return null;
    const correctOption = String(item?.correct_answer || item?.correct_option || "").trim().toUpperCase();
    return (
      <div className="walkin-options">
        {WALKIN_OPTION_KEYS.map(({ key, label }) => {
          const normalizedLabel = String(label || "").trim().toUpperCase();
          const isCorrect = Boolean(correctOption) && correctOption === normalizedLabel;
          return item[key] ? (
            <p className={`item-option ${isCorrect ? "option-correct-answer" : ""}`.trim()} key={key}>
              <span className="option-label">{label}.</span>
              <span className="option-text">{item[key]}</span>
              {isCorrect ? <span className="option-result-badge">Correct</span> : null}
            </p>
          ) : null;
        })}
      </div>
    );
  };

  const renderRegularReviewOptions = (item) => {
    const hasOptions = WALKIN_OPTION_KEYS.some(({ key }) => item[key]);
    if (!hasOptions) return null;
    const selectedOption = String(item?.selected_option || "").trim().toUpperCase();
    const correctOption = String(item?.correct_answer || "").trim().toUpperCase();
    return (
      <div className="walkin-options">
        {WALKIN_OPTION_KEYS.map(({ key, label }) => {
          const normalizedLabel = String(label || "").trim().toUpperCase();
          const isSelected = Boolean(selectedOption) && selectedOption === normalizedLabel;
          const isCorrect = Boolean(correctOption) && correctOption === normalizedLabel;
          const optionStateClass = isSelected
            ? (isCorrect ? "option-selected-correct" : "option-selected-wrong")
            : (isCorrect ? "option-correct-answer" : "");
          const resultBadge = isSelected
            ? (isCorrect ? "Your Answer ✓" : "Your Answer ✗")
            : (isCorrect ? "Correct ✓" : "");
          return item[key] ? (
            <p className={`item-option ${optionStateClass}`.trim()} key={key}>
              <span className="option-label">{label}.</span>
              <span className="option-text">{item[key]}</span>
              {resultBadge ? <span className="option-result-badge">{resultBadge}</span> : null}
            </p>
          ) : null;
        })}
      </div>
    );
  };

    useEffect(() => {
    if (!landingSection) return;
    setShowProfile(false);
    setActiveSection(landingSection);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: undefined });
  }, [landingSection, location.pathname, location.search, navigate]);
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [revealedBdePasswords, setRevealedBdePasswords] = useState({});
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    tone: "default"
  });
  const confirmResolverRef = useRef(null);

  const activeSectionRef = useRef(activeSection);
  const dashboardStatsRequestRef = useRef(0);
  const collegeOptionsSortedByName = useMemo(
    () =>
      [...collegeOptions].sort((left, right) =>
        String(left?.college_name || "").localeCompare(String(right?.college_name || ""), undefined, {
          sensitivity: "base"
        })
      ),
    [collegeOptions]
  );
  const collegeListSortedByName = useMemo(
    () =>
      [...collegeList].sort((left, right) =>
        String(left?.college_name || "").localeCompare(String(right?.college_name || ""), undefined, {
          sensitivity: "base"
        })
      ),
    [collegeList]
  );

  const openConfirmDialog = useCallback((options) => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        open: true,
        title: options?.title || "Please confirm",
        message: options?.message || "",
        confirmLabel: options?.confirmLabel || "Confirm",
        cancelLabel: options?.cancelLabel || "Cancel",
        tone: options?.tone === "danger" ? "danger" : "default"
      });
    });
  }, []);

  const resolveConfirmDialog = useCallback((confirmed) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog((prev) => ({ ...prev, open: false }));
    if (typeof resolver === "function") {
      resolver(Boolean(confirmed));
    }
  }, []);

  useEffect(() => {
    const loadColleges = async () => {
      try {
        const response = await fetch("/student/colleges");
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) {
          setSelectedCollegeId("");
          localStorage.removeItem("collegeId");
          setCollegeOptions([]);
          setCollegeError("No colleges available yet.");
          return;
        }
        setCollegeOptions(data);
        setCollegeError("");
        const activeCollegeId = String(collegeId || data[0].college_id || "");
        setSelectedCollegeId(activeCollegeId);
        localStorage.setItem("collegeId", activeCollegeId);
      } catch (err) {
        console.error("College load error:", err);
        setCollegeError("Could not load colleges.");
      }
    };
    loadColleges();
  }, [collegeId]);

  useEffect(() => {
    const loadBdes = async () => {
      try {
        const response = await fetch("/admin/bdes", {
          credentials: "include",
          cache: "no-store"
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load BDE list");
        }
        const rows = Array.isArray(data.bdes) ? data.bdes : [];
        setBdeOptions(rows);
        setBdeError("");
      } catch (error) {
        console.error("BDE list load error:", error);
        setBdeOptions([]);
        setBdeError(error.message || "Could not load BDE list");
      }
    };
    loadBdes();
  }, []);

  useEffect(() => {
    if (activeSection === "regular" && activeSectionRef.current !== "regular") {
      setRegularForm((prev) => ({
        ...prev,
        email: "",
        password: ""
      }));
    }
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    loadExams();
  }, []);

  const toPercent = (value, total) => {
    if (!total || total <= 0) return 0;
    const ratio = (Number(value || 0) / Number(total)) * 100;
    return Math.max(0, Math.min(100, ratio));
  };
  const normalizeExamStatus = (value) => {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "READY" ? "READY" : "DRAFT";
  };


  const viewResultDetail = async (result) => {
    if (!result?.result_id) return;
    setRegularReviewLoading(true);
    setRegularReviewError("");
    setRegularReviewView("summary");
    try {
      const response = await fetch(`/admin/result-answers/${result.result_id}`);
      const data = await response.json();
      if (data.success) {
        setRegularReviewData({
          result,
          review: data.review || null,
          questions: data.questions || []
        });
        setActiveSection("regular-review");
      } else {
        setRegularReviewError(data.message || "Could not load regular result review.");
      }
    } catch (err) {
      console.error("Result detail error:", err);
      setRegularReviewError("Could not load regular result review.");
    } finally {
      setRegularReviewLoading(false);
    }
  };

  const loadStudents = useCallback(async () => {
    const fetchStudentsByScope = async (scope) => {
      const response = await fetch(`/admin/students/${scope}`, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Student load failed (${response.status})`);
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    };

    const fallbackCollegeId = String(
      collegeId || localStorage.getItem("collegeId") || ""
    ).trim();

    try {
      const allRows = await fetchStudentsByScope("ALL");
      if (allRows.length > 0 || !fallbackCollegeId) {
        setStudents(allRows);
        return;
      }

      const scopedRows = await fetchStudentsByScope(fallbackCollegeId);
      setStudents(scopedRows);
    } catch (err) {
      try {
        if (fallbackCollegeId) {
          const scopedRows = await fetchStudentsByScope(fallbackCollegeId);
          setStudents(scopedRows);
          return;
        }
      } catch (fallbackErr) {
        console.error("Load students fallback error:", fallbackErr);
      }
      console.error("Load students error:", err);
      setStudents([]);
    }
  }, [collegeId]);

  const loadCollegeList = useCallback(async (prioritizeCollegeId = null) => {
    setCollegeListLoading(true);
    setCollegeListError("");
    try {
      const response = await fetch("/admin/colleges");
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load colleges");
      }
      const rows = Array.isArray(data.colleges) ? data.colleges : [];
      const preferredId = String(prioritizeCollegeId || recentCollegeId || "").trim();
      const sortedRows = [...rows].sort((left, right) => {
        const leftId = String(left?.college_id || "");
        const rightId = String(right?.college_id || "");
        if (preferredId) {
          if (leftId === preferredId && rightId !== preferredId) return -1;
          if (rightId === preferredId && leftId !== preferredId) return 1;
        }
        return Number(right?.college_id || 0) - Number(left?.college_id || 0);
      });
      setCollegeList(sortedRows);
      setCollegeOptions(sortedRows);
    } catch (error) {
      console.error("Admin college list error:", error);
      setCollegeListError(error.message || "Could not load colleges");
      setCollegeList([]);
    } finally {
      setCollegeListLoading(false);
    }
  }, [recentCollegeId]);

  const loadDashboardStats = useCallback(async () => {
    const requestId = dashboardStatsRequestRef.current + 1;
    dashboardStatsRequestRef.current = requestId;
    try {
      const response = await fetch(`/admin/dashboard-stats?t=${Date.now()}&monthOffset=${registrationMonthOffset}`, {
        cache: "no-store"
      });
      const data = await response.json();
      if (dashboardStatsRequestRef.current !== requestId) {
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load dashboard stats");
      }
      setStudentCount(Number(data.studentCount || 0));
      setRegistrationTrend(Array.isArray(data.registrationTrend) ? data.registrationTrend : []);
      setRegularResultedCount(Number(data.regularResultedCount || 0));
      setWalkinResultedCount(Number(data.walkinResultedCount || 0));
      setRecentResults(Array.isArray(data.recentResults) ? data.recentResults : []);
    } catch (err) {
      if (dashboardStatsRequestRef.current !== requestId) {
        return;
      }
      console.error("Load dashboard stats error:", err);
      try {
        const [studentsResp, resultsResp, walkinResultsResp] = await Promise.all([
          fetch(`/admin/students/count/${collegeId}`),
          fetch(`/admin/results/ALL`),
          fetch(`/admin/walkin/final-results/ALL?t=${Date.now()}`, { cache: "no-store" })
        ]);

        const studentsData = await studentsResp.json();
        const resultsData = await resultsResp.json();
        const walkinData = await walkinResultsResp.json();
        if (dashboardStatsRequestRef.current !== requestId) {
          return;
        }
        const regularStudentIds = new Set(
          (Array.isArray(resultsData) ? resultsData : []).map((row) => String(row.student_id || "")).filter(Boolean)
        );
        const walkinStudentIds = new Set(
          (Array.isArray(walkinData) ? walkinData : []).map((row) => String(row.student_id || "")).filter(Boolean)
        );

        setStudentCount(Number(studentsData.total || 0));
        setRegistrationTrend([]);
        setRegularResultedCount(regularStudentIds.size);
        setWalkinResultedCount(walkinStudentIds.size);
        setRecentResults(Array.isArray(resultsData) ? resultsData : []);
      } catch (fallbackError) {
        if (dashboardStatsRequestRef.current !== requestId) {
          return;
        }
        console.error("Load dashboard fallback error:", fallbackError);
        setStudentCount(0);
        setRegistrationTrend([]);
        setRegularResultedCount(0);
        setWalkinResultedCount(0);
        setRecentResults([]);
      }
    }
  }, [collegeId, registrationMonthOffset]);

  useEffect(() => {
    if (!adminId) {
      navigate("/admin/login");
      return;
    }
    loadDashboardStats();
    loadStudents();
  }, [adminId, loadDashboardStats, loadStudents, navigate]);

  const handleWalkinCreation = async (event) => {
    event.preventDefault();
    if (walkinCreateSubmitting) return;
    setWalkinStatus("");
    setWalkinCredentials(null);

    const selectedBdeName = String(walkinForm.bdeName || "").trim();
    const customBdeName = String(walkinForm.bdeNameOther || "").trim();
    const bdeNameMissing =
      !selectedBdeName || (selectedBdeName.toUpperCase() === "OTHER" && !customBdeName);
    if (!walkinForm.name || !walkinForm.email || !walkinForm.phone || !walkinForm.dob || !walkinForm.stream || !walkinForm.collegeId || bdeNameMissing) {
      setWalkinStatus("Fill all walk-in student details.");
      return;
    }

    try {
      setWalkinCreateSubmitting(true);
      const response = await fetch("/admin/students/walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: walkinForm.name,
          email: walkinForm.email,
          phone: walkinForm.phone,
          dob: walkinForm.dob,
          course: walkinForm.stream,
          collegeId: walkinForm.collegeId,
          bdeName: walkinForm.bdeName,
          bdeNameOther: walkinForm.bdeNameOther
        })
      });
      const data = await response.json();
      if (!data.success) {
        setWalkinStatus(data.message || "Failed to create walk-in student.");
        return;
      }

      setWalkinStatus("Walk-in student created. Credentials generated automatically.");
      setWalkinCredentials(data.credentials);
      const createdCollegeId = String(walkinForm.collegeId || "").trim();
      if (createdCollegeId && createdCollegeId !== collegeId) {
        setSelectedCollegeId(createdCollegeId);
        localStorage.setItem("collegeId", createdCollegeId);
      }
      setWalkinForm((prev) => ({
        ...prev,
        name: "",
        email: "",
        phone: "",
        dob: "",
        stream: "",
        bdeName: "",
        collegeId: "",
        bdeNameOther: ""
      }));
      await loadStudents();
    } catch (err) {
      console.error("Walk-in creation error:", err);
      setWalkinStatus("Server error while creating walk-in student.");
    } finally {
      setWalkinCreateSubmitting(false);
    }
  };

  const handleApproveWalkinTemp = async (requestId) => {
    const normalizedId = Number(requestId || 0);
    if (!normalizedId) return;

    setWalkinTempActionLoading((prev) => ({ ...prev, [normalizedId]: true }));
    setWalkinTempStatus("");
    setWalkinApprovedCredentials(null);
    try {
      const response = await fetch(`/admin/walkin/temp-students/${normalizedId}/approve`, {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not approve request");
      }
      setWalkinTempStatus(data.message || "Walk-in request approved.");
      setWalkinApprovedCredentials(data.credentials || null);
      await Promise.all([fetchWalkinTempRequests(), loadStudents(), loadDashboardStats()]);
    } catch (error) {
      console.error("Approve walk-in temp request error:", error);
      setWalkinTempStatus(error.message || "Could not approve walk-in request.");
    } finally {
      setWalkinTempActionLoading((prev) => ({ ...prev, [normalizedId]: false }));
    }
  };

  const handleRejectWalkinTemp = async (requestId) => {
    const normalizedId = Number(requestId || 0);
    if (!normalizedId) return;

    setWalkinTempActionLoading((prev) => ({ ...prev, [normalizedId]: true }));
    setWalkinTempStatus("");
    try {
      const response = await fetch(`/admin/walkin/temp-students/${normalizedId}/reject`, {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not reject request");
      }
      setWalkinTempStatus(data.message || "Walk-in request rejected.");
      await fetchWalkinTempRequests();
    } catch (error) {
      console.error("Reject walk-in temp request error:", error);
      setWalkinTempStatus(error.message || "Could not reject walk-in request.");
    } finally {
      setWalkinTempActionLoading((prev) => ({ ...prev, [normalizedId]: false }));
    }
  };

  const handleRegularCreation = async (event) => {
    event.preventDefault();
    if (regularCreateSubmitting) return;
    setRegularStatus("");
    setRegularCredentials(null);

    const trimmedName = regularForm.name.trim();
    const trimmedEmail = regularForm.email.trim();
    const trimmedPhone = regularForm.phone.trim();
    const trimmedDob = regularForm.dob.trim();
    const trimmedBackground = regularForm.background.trim();
    const trimmedCourse = regularForm.course.trim();
    const passwordValue = regularForm.password;
    const selectedCollegeId = regularForm.collegeId;

    if (
      !trimmedName ||
      !trimmedEmail ||
      !trimmedPhone ||
      !trimmedDob ||
      !trimmedBackground ||
      !trimmedCourse ||
      !passwordValue ||
      !selectedCollegeId
    ) {
      setRegularStatus("Fill all regular student details.");
      return;
    }

    try {
      setRegularCreateSubmitting(true);
      const response = await fetch("/admin/students/regular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          dob: trimmedDob,
          course: trimmedCourse,
          collegeId: selectedCollegeId,
          password: passwordValue
        })
      });
      const data = await response.json();
      if (!data.success) {
        setRegularStatus(data.message || "Failed to create regular student.");
        return;
      }

      setRegularStatus(`Regular student created. Background: ${trimmedBackground || "--"}. Credentials are now active.`);
      setRegularCredentials(data.credentials);
      if (selectedCollegeId && selectedCollegeId !== collegeId) {
        setSelectedCollegeId(selectedCollegeId);
        localStorage.setItem("collegeId", selectedCollegeId);
      }
      setRegularForm((prev) => ({
        ...prev,
        name: "",
        email: "",
        phone: "",
        dob: "",
        background: "",
        course: "",
        password: ""
      }));
      await loadStudents();
    } catch (err) {
      console.error("Regular creation error:", err);
      setRegularStatus("Server error while creating regular student.");
    } finally {
      setRegularCreateSubmitting(false);
    }
  };

  const handleDownloadRegularBulkTemplate = useCallback(() => {
    const worksheet = XLSX.utils.aoa_to_sheet([REGULAR_BULK_TEMPLATE_COLUMNS]);
    worksheet["!cols"] = [
      { wch: 24 },
      { wch: 32 },
      { wch: 16 },
      { wch: 14 },
      { wch: 18 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Regular Students");
    XLSX.writeFile(workbook, "regular-student-bulk-template.xlsx");
    setRegularBulkStatus("Downloaded the regular student bulk upload template.");
  }, []);

  const clearRegularBulkUpload = useCallback(() => {
    setRegularBulkRows([]);
    setRegularBulkFileName("");
    setRegularBulkResult(null);
    if (regularBulkFileInputRef.current) {
      regularBulkFileInputRef.current.value = "";
    }
  }, []);

  const handleRegularBulkFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    setRegularBulkStatus("");
    setRegularBulkResult(null);
    setRegularBulkRows([]);
    setRegularBulkFileName(file?.name || "");

    if (!file) {
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheetName = workbook.SheetNames?.[0];
      if (!firstSheetName) {
        throw new Error("The uploaded workbook has no sheets.");
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
      const parsedRows = rawRows
        .map((row, index) => {
          const name = String(getSpreadsheetCellValue(row, ["Name", "Full Name", "Student Name"]) || "").trim();
          const email = String(getSpreadsheetCellValue(row, ["Email", "Email ID"]) || "").trim();
          const phone = String(getSpreadsheetCellValue(row, ["Phone", "Phone Number", "Contact Number"]) || "").trim();
          const dob = normalizeSpreadsheetDob(getSpreadsheetCellValue(row, ["DOB", "Date of Birth"]));
          const course = String(getSpreadsheetCellValue(row, ["Course", "Specialization"]) || "").trim();
          return {
            rowNumber: index + 2,
            name,
            email,
            phone,
            dob,
            course
          };
        })
        .filter((row) => Object.values(row).some((value) => String(value || "").trim()));

      if (parsedRows.length === 0) {
        throw new Error("The uploaded file does not contain any student rows.");
      }

      setRegularBulkRows(parsedRows);
      setRegularBulkStatus(`Loaded ${parsedRows.length} student rows from ${file.name}.`);
    } catch (error) {
      console.error("Regular bulk file parse error:", error);
      setRegularBulkFileName("");
      setRegularBulkRows([]);
      setRegularBulkStatus(error.message || "Could not read the uploaded XLSX file.");
    } finally {
      if (event.target) {
        event.target.value = "";
      }
    }
  }, []);

  const handleRegularBulkUpload = async (event) => {
    event.preventDefault();
    if (regularBulkSubmitting) return;

    setRegularBulkStatus("");
    setRegularBulkResult(null);

    if (!regularBulkCollegeId) {
      setRegularBulkStatus("Select the college for this bulk upload.");
      return;
    }
    if (regularBulkRows.length === 0) {
      setRegularBulkStatus("Upload a valid XLSX file before starting bulk registration.");
      return;
    }

    try {
      setRegularBulkSubmitting(true);
      const response = await fetch("/admin/students/regular/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId: regularBulkCollegeId,
          students: regularBulkRows
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not complete the bulk regular student registration.");
      }

      setRegularBulkResult(data);
      setRegularBulkStatus(
        `${Number(data.registeredCount || 0)} student${Number(data.registeredCount || 0) === 1 ? "" : "s"} registered successfully.` +
        (Number(data.failedCount || 0) > 0 ? ` ${Number(data.failedCount || 0)} failed.` : "")
      );
      if (Number(data.registeredCount || 0) > 0) {
        if (String(regularBulkCollegeId) !== String(collegeId || "")) {
          setSelectedCollegeId(String(regularBulkCollegeId));
          localStorage.setItem("collegeId", String(regularBulkCollegeId));
        }
        await loadStudents();
      }
    } catch (error) {
      console.error("Regular bulk upload error:", error);
      setRegularBulkStatus(error.message || "Could not complete the bulk upload.");
    } finally {
      setRegularBulkSubmitting(false);
    }
  };

  const loadExams = async () => {
    try {
      const response = await fetch(`/admin/exams`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Could not load exam schedules");
      }
      setExams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load exams error:", err);
      setExams([]);
    }
  };

  const handleCreateExam = async (event) => {
    event.preventDefault();
    if (examCreateSubmitting) return;
    setExamScheduleStatus("");

    if (!scheduleStartDate || !scheduleStartTime) {
      alert("Select start date/time");
      return;
    }
    if (!String(scheduleCollegeId || "").trim()) {
      alert("Select a college");
      return;
    }
    const payload = {
      startDate: scheduleStartDate,
      startTime: scheduleStartTime,
      collegeId: String(scheduleCollegeId || "").trim()
    };

    try {
      setExamCreateSubmitting(true);
      const isEditing = Number(editingExamId || 0) > 0;
      const response = await fetch(isEditing ? `/admin/exam/${editingExamId}` : "/admin/exam", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not save exam schedule");
      }
      setScheduleStartDate("");
      setScheduleStartTime("");
      setScheduleCollegeId("");
      setEditingExamId(null);
      await loadExams();
      setExamScheduleStatus(isEditing ? "Schedule updated successfully." : "Schedule saved successfully.");
    } catch (error) {
      const message = error.message || "Could not save exam schedule";
      setExamScheduleStatus(message);
      alert(message);
    } finally {
      setExamCreateSubmitting(false);
    }
  };

  const handleEditExam = (exam) => {
    setEditingExamId(Number(exam?.exam_id || 0) || null);
    setScheduleStartDate(toISTDateInput(exam?.start_at));
    setScheduleStartTime(toISTTimeInput(exam?.start_at));
    setScheduleCollegeId(String(exam?.college_id || ""));
    setExamScheduleStatus(`Editing exam #${exam?.exam_id || ""}. Update fields and click Save Schedule.`);
  };

  const handleCancelExamEdit = () => {
    setEditingExamId(null);
    setScheduleStartDate("");
    setScheduleStartTime("");
    setScheduleCollegeId("");
    setExamScheduleStatus("");
  };

  const logoutAdmin = () => {
    fetch("/admin/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        localStorage.clear();
        navigate("/admin/login");
      });
  };

  const [walkinStatusUpdating, setWalkinStatusUpdating] = useState({});
  const [selectedWalkinProfile, setSelectedWalkinProfile] = useState(null);
  const [selectedRegularProfile, setSelectedRegularProfile] = useState(null);
  const [walkinProfileEditMode, setWalkinProfileEditMode] = useState(false);
  const [walkinProfileSaving, setWalkinProfileSaving] = useState(false);
  const [walkinProfileEditStatus, setWalkinProfileEditStatus] = useState("");
  const [walkinProfileForm, setWalkinProfileForm] = useState({
    name: "",
    email: "",
    contact: "",
    dob: "",
    stream: "",
    collegeId: "",
    bdeName: "",
    password: ""
  });

  const toggleWalkinPassword = (studentId) => {
    setRevealedPasswords((prev) => {
      const isRevealed = Boolean(prev[studentId]);
      if (isRevealed) {
        const { [studentId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [studentId]: true };
    });
  };

  const handleWalkinStatusToggle = async (studentId, currentStatus) => {
    const normalizedCurrentStatus = String(currentStatus || "").trim().toUpperCase();
    const nextStatus = normalizedCurrentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const confirmConfig =
      nextStatus === "ACTIVE"
        ? {
            title: "Activate this student?",
            message: "The student will regain exam access on their dashboard.",
            confirmLabel: "Activate",
            tone: "default"
          }
        : {
            title: "Deactivate this student?",
            message: "The assigned exam will be hidden from the dashboard until you activate the student again.",
            confirmLabel: "Deactivate",
            tone: "danger"
          };
    const confirmed = await openConfirmDialog(confirmConfig);
    if (!confirmed) {
      return;
    }
    setWalkinStatusUpdating((prev) => ({ ...prev, [studentId]: true }));
    try {
      const methods = ["PATCH", "PUT", "POST"];
      let updated = false;
      let lastError = "Could not update status";

      for (const method of methods) {
        const response = await fetch(`/admin/students/${studentId}/status`, {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          localStorage.removeItem("adminId");
          localStorage.removeItem("collegeId");
          localStorage.removeItem("collegeName");
          alert(data?.message || "Session expired. Please log in again.");
          navigate("/admin/login");
          return;
        }
        if (response.ok && data.success) {
          updated = true;
          setStudents((prev) =>
            prev.map((student) =>
              String(student.student_id) === String(studentId)
                ? { ...student, student_status: data.status || nextStatus }
                : student
            )
          );
          await loadStudents();
          break;
        }
        lastError = data?.message || `Status update failed (${response.status})`;
        if (response.status !== 404 && response.status !== 405) {
          break;
        }
      }

      if (!updated) {
        console.error("Walk-in status update failed:", lastError);
        alert(lastError);
      }
    } catch (error) {
      console.error("Walk-in status toggle error:", error);
      alert("Could not update status. Please retry.");
    } finally {
      setWalkinStatusUpdating((prev) => {
        const { [studentId]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const formatDobInputValue = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  };

  useEffect(() => {
    if (!selectedWalkinProfile) {
      setWalkinProfileEditMode(false);
      setWalkinProfileEditStatus("");
      return;
    }
    setWalkinProfileEditMode(false);
    setWalkinProfileEditStatus("");
    setWalkinProfileForm({
      name: String(selectedWalkinProfile.name || ""),
      email: String(selectedWalkinProfile.email_id || ""),
      contact: String(selectedWalkinProfile.contact_number || ""),
      dob: formatDobInputValue(selectedWalkinProfile.dob),
      stream: String(selectedWalkinProfile.course || ""),
      collegeId: String(selectedWalkinProfile.college_id || ""),
      bdeName: String(selectedWalkinProfile.bde_name || ""),
      password: String(selectedWalkinProfile.password || "")
    });
  }, [selectedWalkinProfile]);

  const handleWalkinProfileSave = async () => {
    if (!selectedWalkinProfile?.student_id) return;

    const payload = {
      name: String(walkinProfileForm.name || "").trim(),
      email: String(walkinProfileForm.email || "").trim(),
      phone: String(walkinProfileForm.contact || "").trim(),
      dob: String(walkinProfileForm.dob || "").trim(),
      course: String(walkinProfileForm.stream || "").trim(),
      collegeId: String(walkinProfileForm.collegeId || "").trim(),
      bdeName: String(walkinProfileForm.bdeName || "").trim(),
      password: String(walkinProfileForm.password || "")
    };
    if (payload.phone) {
      const phoneDigits = payload.phone.replace(/\D/g, "");
      if (!/^\d{10}$/.test(phoneDigits)) {
        setWalkinProfileEditStatus("Phone number must be exactly 10 digits.");
        return;
      }
      payload.phone = phoneDigits;
    }

    setWalkinProfileSaving(true);
    setWalkinProfileEditStatus("");
    try {
      const response = await fetch(`/admin/students/${selectedWalkinProfile.student_id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        localStorage.removeItem("adminId");
        localStorage.removeItem("collegeId");
        localStorage.removeItem("collegeName");
        alert(data?.message || "Session expired. Please log in again.");
        navigate("/admin/login");
        return;
      }
      if (!response.ok || !data.success) {
        setWalkinProfileEditStatus(data?.message || "Could not update student profile.");
        return;
      }
      const updated = data.student || {};
      setStudents((prev) =>
        prev.map((student) =>
          String(student.student_id) === String(selectedWalkinProfile.student_id)
            ? { ...student, ...updated }
            : student
        )
      );
      setSelectedWalkinProfile((prev) => (prev ? { ...prev, ...updated } : prev));
      setWalkinProfileEditMode(false);
      setWalkinProfileEditStatus("Profile updated successfully.");
    } catch (error) {
      console.error("Walk-in profile update error:", error);
      setWalkinProfileEditStatus("Could not update student profile.");
    } finally {
      setWalkinProfileSaving(false);
    }
  };

  const toggleBdePassword = (bdeId) => {
    setRevealedBdePasswords((prev) => {
      const isRevealed = Boolean(prev[bdeId]);
      if (isRevealed) {
        const { [bdeId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [bdeId]: true };
    });
  };

  const handleProfileClick = () => {
    setShowProfile(true);
  };

  const handleDashboardClick = () => {
    setShowProfile(false);
    setActiveSection("dashboard");
  };

  const handleSectionClick = (sectionId) => {
    setShowProfile(false);
    setActiveSection(sectionId);
  };

  const handlePasswordFormChange = (field, value) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
    if (passwordChangeStatus) {
      setPasswordChangeStatus("");
    }
  };

  const handleChangePasswordSubmit = async (event) => {
    event.preventDefault();
    const currentPassword = String(passwordForm.currentPassword || "");
    const newPassword = String(passwordForm.newPassword || "");
    const confirmNewPassword = String(passwordForm.confirmNewPassword || "");

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordChangeStatus("Please fill current password, new password, and confirm password.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeStatus("New password and confirm password do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordChangeStatus("New password must be different from current password.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordChangeStatus("New password must be at least 6 characters.");
      return;
    }

    setPasswordChangeSaving(true);
    setPasswordChangeStatus("");
    try {
      const response = await fetch("/admin/account/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        localStorage.removeItem("adminId");
        localStorage.removeItem("collegeId");
        localStorage.removeItem("collegeName");
        alert(data?.message || "Session expired. Please log in again.");
        navigate("/admin/login");
        return;
      }
      if (!response.ok || !data.success) {
        setPasswordChangeStatus(data?.message || "Could not update password.");
        return;
      }

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: ""
      });
      setPasswordChangeStatus(data?.message || "Password updated successfully.");
    } catch (error) {
      console.error("Admin change password error:", error);
      setPasswordChangeStatus("Could not update password.");
    } finally {
      setPasswordChangeSaving(false);
    }
  };

  const fetchWalkinSheet = useCallback(async () => {
    setWalkinSheetLoading(true);
    setWalkinSheetError("");
    try {
      const response = await fetch("/admin/walkin/questions");
      if (!response.ok) {
        throw new Error("Failed to fetch walk-in questions");
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || "Could not load walk-in questions");
      }
      setWalkinSheetData(data);
    } catch (error) {
      console.error("Walk-in sheet fetch error:", error);
      setWalkinSheetError(error.message || "Could not load walk-in questions");
    } finally {
      setWalkinSheetLoading(false);
    }
  }, []);

  const fetchWalkinResults = useCallback(async () => {
    setWalkinResultsLoading(true);
    setWalkinResultsError("");
    try {
      const response = await fetch(`/admin/walkin/final-results/ALL?t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      if (Array.isArray(data)) {
        setWalkinResults(data);
      } else {
        setWalkinResults([]);
      }
    } catch (err) {
      console.error("Load walk-in results error:", err);
      setWalkinResultsError("Could not load walk-in results.");
      setWalkinResults([]);
    } finally {
      setWalkinResultsLoading(false);
    }
  }, []);

  const fetchWalkinTempRequests = useCallback(async () => {
    setWalkinTempLoading(true);
    setWalkinTempStatus("");
    try {
      const response = await fetch(`/admin/walkin/temp-students?status=PENDING&t=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not load walk-in approval requests");
      }
      const rows = Array.isArray(data.requests) ? data.requests : [];
      setWalkinTempRequests(rows);
      setWalkinPendingCount(rows.length);
    } catch (error) {
      console.error("Walk-in temp requests load error:", error);
      setWalkinTempStatus(error.message || "Could not load walk-in approval requests.");
      setWalkinTempRequests([]);
      setWalkinPendingCount(0);
    } finally {
      setWalkinTempLoading(false);
    }
  }, []);

  const refreshWalkinPendingCount = useCallback(async () => {
    try {
      const response = await fetch(`/admin/walkin/temp-students?status=PENDING&t=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.success) return;
      const rows = Array.isArray(data.requests) ? data.requests : [];
      setWalkinPendingCount(rows.length);
    } catch {
      // no-op
    }
  }, []);

  const fetchRegularQuestionSheet = useCallback(async () => {
    setRegularQuestionSheetLoading(true);
    setRegularQuestionSheetError("");
    try {
      const response = await fetch(
        `/admin/regular/questions?collegeId=${encodeURIComponent(String(collegeId || ""))}`,
        {
        credentials: "include",
        cache: "no-store"
        }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load regular question sheet");
      }
      setRegularQuestionSheetData(data);
    } catch (error) {
      console.error("Regular question sheet fetch error:", error);
      setRegularQuestionSheetData(null);
      setRegularQuestionSheetError(error.message || "Could not load regular question sheet");
    } finally {
      setRegularQuestionSheetLoading(false);
    }
  }, [collegeId]);

  const openWalkinQuestionEditor = (category, row, stream = "") => {
    const questionTypeRaw =
      category === "aptitude"
        ? "MCQ"
        : (category === "coding" ? "Coding" : String(row?.question_type || ""));
    const normalizedType = String(questionTypeRaw || "").trim().toLowerCase();
    setWalkinQuestionEditStatus("");
    setWalkinQuestionEditor({
      open: true,
      category: String(category || "").toLowerCase(),
      questionId: Number(row?.question_id || 0),
      questionType: questionTypeRaw || "MCQ",
      stream: stream || "",
      sectionName: String(row?.section_name || ""),
      questionText: String(row?.question_text || ""),
      marks: row?.marks ?? "",
      optionA: String(row?.option_a || ""),
      optionB: String(row?.option_b || ""),
      optionC: String(row?.option_c || ""),
      optionD: String(row?.option_d || ""),
      correctOption: ["A", "B", "C", "D"].includes(String(row?.correct_option || "").toUpperCase())
        ? String(row.correct_option).toUpperCase()
        : "A",
      descriptiveAnswer: normalizedType.includes("mcq") ? "" : String(row?.descriptive_answer || "")
    });
  };

  const closeWalkinQuestionEditor = () => {
    if (walkinQuestionEditSaving) return;
    setWalkinQuestionEditor((prev) => ({ ...prev, open: false }));
    setWalkinQuestionEditStatus("");
  };

  const openRegularQuestionEditor = (category, row) => {
    setRegularQuestionEditStatus("");
    setRegularQuestionEditor({
      open: true,
      category: String(category || "").toLowerCase(),
      questionId: Number(row?.question_id || 0),
      questionType: String(row?.question_type || "MCQ"),
      sectionName: String(row?.section_name || ""),
      backgroundType: String(row?.background_type || ""),
      questionText: String(row?.question_text || ""),
      optionA: String(row?.option_a || ""),
      optionB: String(row?.option_b || ""),
      optionC: String(row?.option_c || ""),
      optionD: String(row?.option_d || ""),
      correctOption: ["A", "B", "C", "D"].includes(String(row?.correct_answer || "").toUpperCase())
        ? String(row.correct_answer).toUpperCase()
        : "A"
    });
  };

  const closeRegularQuestionEditor = () => {
    if (regularQuestionEditSaving) return;
    setRegularQuestionEditor((prev) => ({ ...prev, open: false }));
    setRegularQuestionEditStatus("");
  };

  const handleRegularQuestionEditorChange = (field, value) => {
    setRegularQuestionEditor((prev) => ({ ...prev, [field]: value }));
  };

  const handleWalkinQuestionEditorChange = (field, value) => {
    setWalkinQuestionEditor((prev) => ({ ...prev, [field]: value }));
  };

  const saveWalkinQuestionEdit = async () => {
    const category = String(walkinQuestionEditor.category || "").trim().toLowerCase();
    const questionId = Number(walkinQuestionEditor.questionId || 0);
    const questionText = String(walkinQuestionEditor.questionText || "").trim();
    if (!category || !questionId) {
      setWalkinQuestionEditStatus("Invalid question context.");
      return;
    }
    if (!questionText) {
      setWalkinQuestionEditStatus("Question text cannot be empty.");
      return;
    }

    const marksValue =
      walkinQuestionEditor.marks === "" || walkinQuestionEditor.marks === null
        ? null
        : Number(walkinQuestionEditor.marks);
    if (marksValue !== null && (!Number.isFinite(marksValue) || marksValue < 0)) {
      setWalkinQuestionEditStatus("Marks must be a valid non-negative number.");
      return;
    }

    const payload = {
      question_text: questionText,
      marks: marksValue
    };

    const normalizedType = String(walkinQuestionEditor.questionType || "").toLowerCase();
    const isMcq = category === "aptitude" || normalizedType.includes("mcq");
    if (isMcq) {
      const optionA = String(walkinQuestionEditor.optionA || "").trim();
      const optionB = String(walkinQuestionEditor.optionB || "").trim();
      const optionC = String(walkinQuestionEditor.optionC || "").trim();
      const optionD = String(walkinQuestionEditor.optionD || "").trim();
      const correctOption = String(walkinQuestionEditor.correctOption || "").trim().toUpperCase();
      if (!optionA || !optionB || !optionC || !optionD) {
        setWalkinQuestionEditStatus("All options are required.");
        return;
      }
      if (!["A", "B", "C", "D"].includes(correctOption)) {
        setWalkinQuestionEditStatus("Select a valid correct answer.");
        return;
      }
      payload.option_a = optionA;
      payload.option_b = optionB;
      payload.option_c = optionC;
      payload.option_d = optionD;
      payload.correct_option = correctOption;
    } else if (category === "stream") {
      const descriptiveAnswer = String(walkinQuestionEditor.descriptiveAnswer || "").trim();
      if (!descriptiveAnswer) {
        setWalkinQuestionEditStatus("Sample solution cannot be empty.");
        return;
      }
      payload.descriptive_answer = descriptiveAnswer;
    }

    setWalkinQuestionEditSaving(true);
    setWalkinQuestionEditStatus("");
    try {
      const response = await fetch(`/admin/walkin/questions/${category}/${questionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not update question");
      }
      await fetchWalkinSheet();
      setWalkinQuestionEditor((prev) => ({ ...prev, open: false }));
      setWalkinQuestionEditStatus("Question updated successfully.");
    } catch (error) {
      console.error("Walk-in question update error:", error);
      setWalkinQuestionEditStatus(error.message || "Could not update question.");
    } finally {
      setWalkinQuestionEditSaving(false);
    }
  };

  const saveRegularQuestionEdit = async () => {
    const category = String(regularQuestionEditor.category || "").trim().toLowerCase();
    const questionId = Number(regularQuestionEditor.questionId || 0);
    const questionText = String(regularQuestionEditor.questionText || "").trim();
    const optionA = String(regularQuestionEditor.optionA || "").trim();
    const optionB = String(regularQuestionEditor.optionB || "").trim();
    const optionC = String(regularQuestionEditor.optionC || "").trim();
    const optionD = String(regularQuestionEditor.optionD || "").trim();
    const correctAnswer = String(regularQuestionEditor.correctOption || "").trim().toUpperCase();

    if (!category || !questionId) {
      setRegularQuestionEditStatus("Invalid regular question context.");
      return;
    }
    if (!questionText) {
      setRegularQuestionEditStatus("Question text cannot be empty.");
      return;
    }
    if (!optionA || !optionB || !optionC || !optionD) {
      setRegularQuestionEditStatus("All options are required.");
      return;
    }
    if (!["A", "B", "C", "D"].includes(correctAnswer)) {
      setRegularQuestionEditStatus("Select a valid correct answer.");
      return;
    }

    setRegularQuestionEditSaving(true);
    setRegularQuestionEditStatus("");
    try {
      const response = await fetch(`/admin/regular/questions/${category}/${questionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: questionText,
          option_a: optionA,
          option_b: optionB,
          option_c: optionC,
          option_d: optionD,
          correct_answer: correctAnswer
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not update regular question");
      }
      await fetchRegularQuestionSheet();
      setRegularQuestionEditor((prev) => ({ ...prev, open: false }));
      setRegularQuestionEditStatus("Question updated successfully.");
    } catch (error) {
      console.error("Regular question update error:", error);
      setRegularQuestionEditStatus(error.message || "Could not update regular question.");
    } finally {
      setRegularQuestionEditSaving(false);
    }
  };

  const recomputeWalkinResults = async () => {
    if (walkinRecomputeLoading) return;
    const confirmed = await openConfirmDialog({
      title: "Recompute Walk-In Results",
      message: "Are you sure you want to recompute the walk-in results?",
      confirmLabel: "Recompute",
      cancelLabel: "Cancel"
    });
    if (!confirmed) {
      setWalkinRecomputeStatus("Walk-in result recompute cancelled.");
      return;
    }
    setWalkinRecomputeLoading(true);
    setWalkinRecomputeStatus("");
    try {
      const response = await fetch("/admin/walkin/final-results/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not recompute walk-in results");
      }
      setWalkinRecomputeStatus(`Recomputed ${Number(data.recomputed_count || 0)} result rows.`);
      await fetchWalkinResults();
    } catch (error) {
      console.error("Walk-in recompute error:", error);
      setWalkinRecomputeStatus(error.message || "Could not recompute walk-in results");
    } finally {
      setWalkinRecomputeLoading(false);
    }
  };

  const handleCreateCollege = async (event) => {
    event.preventDefault();
    if (collegeCreateSubmitting) return;
    setCollegeActionStatus("");
    if (editingCollegeId !== null) {
      setCollegeActionStatus("Finish or cancel current rename before adding a new college.");
      return;
    }
    const collegeName = newCollegeName.trim();
    if (!collegeName) {
      setCollegeActionStatus("Enter a college name.");
      return;
    }
    try {
      setCollegeCreateSubmitting(true);
      const response = await fetch("/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeName })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not create college");
      }
      const createdCollegeId = String(data.collegeId || "").trim();
      setRecentCollegeId(createdCollegeId || null);
      setNewCollegeName("");
      setCollegeActionStatus("College created.");
      await loadCollegeList(createdCollegeId);
    } catch (error) {
      setCollegeActionStatus(error.message || "Could not create college");
    } finally {
      setCollegeCreateSubmitting(false);
    }
  };

  const handleCreateBde = async (event) => {
    event.preventDefault();
    if (bdeCreateSubmitting) return;
    setBdeActionStatus("");

    const bdeName = String(newBdeForm.bdeName || "").trim();
    const phoneNumber = String(newBdeForm.phoneNumber || "").replace(/\D/g, "");
    const email = String(newBdeForm.email || "").trim();
    const password = String(newBdeForm.password || "");

    if (!bdeName || !phoneNumber || !email || !password) {
      setBdeActionStatus("Enter BDE name, phone number, email, and password.");
      return;
    }
    if (!/^\d{10}$/.test(phoneNumber)) {
      setBdeActionStatus("Phone number must be exactly 10 digits.");
      return;
    }

    try {
      setBdeCreateSubmitting(true);
      const response = await fetch("/admin/bdes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bdeName, phoneNumber, email, password })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not create BDE account");
      }

      setNewBdeForm({ bdeName: "", phoneNumber: "", email: "", password: "" });
      setAllowBdeManualInput(false);
      setBdeActionStatus("BDE account created successfully.");
      const bdeResponse = await fetch("/admin/bdes", {
        credentials: "include",
        cache: "no-store"
      });
      const bdeData = await bdeResponse.json();
      if (bdeResponse.ok && bdeData.success) {
        const rows = Array.isArray(bdeData.bdes) ? bdeData.bdes : [];
        setBdeOptions(rows);
      }
    } catch (error) {
      console.error("Create BDE error:", error);
      setBdeActionStatus(error.message || "Could not create BDE account");
    } finally {
      setBdeCreateSubmitting(false);
    }
  };

  const startCollegeRename = (college) => {
    setEditingCollegeId(college.college_id);
    setEditingCollegeName(String(college.college_name || ""));
    setCollegeActionStatus("");
  };

  const cancelCollegeRename = () => {
    setEditingCollegeId(null);
    setEditingCollegeName("");
  };

  const handleUpdateCollege = async (collegeId) => {
    setCollegeActionStatus("");
    const collegeName = editingCollegeName.trim();
    if (!collegeName) {
      setCollegeActionStatus("College name cannot be empty.");
      return;
    }
    try {
      const response = await fetch(`/admin/colleges/${collegeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeName })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not update college");
      }
      const updatedCollegeId = String(collegeId || "").trim();
      setRecentCollegeId(updatedCollegeId || null);
      setCollegeActionStatus("College updated.");
      cancelCollegeRename();
      await loadCollegeList(updatedCollegeId);
    } catch (error) {
      setCollegeActionStatus(error.message || "Could not update college");
    }
  };

  const openWalkinReview = async (studentId, examId, reviewCollegeId) => {
    const scopedCollegeId = String(reviewCollegeId || collegeId || "").trim();
    if (!scopedCollegeId) {
      setWalkinReviewError("Missing college scope for selected student.");
      return;
    }
    setWalkinReviewLoading(true);
    setWalkinReviewError("");
    setWalkinReviewData(null);
    try {
      const response = await fetch(
        `/admin/walkin/review/${scopedCollegeId}/${studentId}/${examId}?t=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load answer review");
      }
      setWalkinReviewData(data);
      setWalkinReviewView("summary");
      setActiveSection("walkin-review");
    } catch (error) {
      console.error("Walk-in review fetch error:", error);
      setWalkinReviewError(error.message || "Could not load answer review");
    } finally {
      setWalkinReviewLoading(false);
    }
  };

  const closeWalkinReview = () => {
    setWalkinReviewData(null);
    setWalkinReviewError("");
    setWalkinReviewView("summary");
    setActiveSection("walkin-results");
  };

  const closeRegularReview = () => {
    setRegularReviewError("");
    setRegularReviewView("summary");
    setActiveSection("regular-results");
  };

  useEffect(() => {
    if (activeSection === "walkin-questions" && !walkinSheetLoading && !walkinSheetData) {
      fetchWalkinSheet();
    }
  }, [activeSection, fetchWalkinSheet, walkinSheetData, walkinSheetLoading]);

  useEffect(() => {
    if (activeSection === "regular-questions") {
      fetchRegularQuestionSheet();
    }
  }, [activeSection, fetchRegularQuestionSheet]);

  useEffect(() => {
    if (activeSection === "walkin-results" && !walkinResultsLoading && walkinResults === null) {
      fetchWalkinResults();
    }
  }, [activeSection, fetchWalkinResults, walkinResults, walkinResultsLoading]);

  useEffect(() => {
    if (activeSection === "walkin") {
      fetchWalkinTempRequests();
    }
  }, [activeSection, fetchWalkinTempRequests]);

  useEffect(() => {
    refreshWalkinPendingCount();
    const timerId = setInterval(() => {
      refreshWalkinPendingCount();
    }, 45000);
    return () => clearInterval(timerId);
  }, [refreshWalkinPendingCount]);

  useEffect(() => {
    if (activeSection === "colleges" && !collegeListLoading && collegeList.length === 0) {
      loadCollegeList();
    }
  }, [activeSection, collegeListLoading, collegeList.length, loadCollegeList]);

  const isDashboardView = !showProfile && activeSection === "dashboard";
  const walkinStudents = students.filter((student) => isWalkinStudentRow(student));
  const regularStudents = students.filter((student) => !isWalkinStudentRow(student));
  const regularStudentCount = regularStudents.length;
  const walkinStudentCount = walkinStudents.length;
  const registeredBdeCount = Array.isArray(bdeOptions) ? bdeOptions.length : 0;
  const bdeNamesWithStudents = new Set(
    students
      .map((row) => String(row?.bde_name || "").trim().toUpperCase())
      .filter(Boolean)
  );
  const assignedBdeCount = (Array.isArray(bdeOptions) ? bdeOptions : []).reduce((count, row) => {
    const bdeName = String(row?.bde_name || "").trim().toUpperCase();
    if (!bdeName) return count;
    return bdeNamesWithStudents.has(bdeName) ? count + 1 : count;
  }, 0);
  const unassignedBdeCount = Math.max(registeredBdeCount - assignedBdeCount, 0);
  const regularStudentsPercent = toPercent(regularStudentCount, studentCount || 1);
  const walkinStudentsPercent = toPercent(walkinStudentCount, studentCount || 1);
  const regularResultedPercent = toPercent(regularResultedCount, regularStudentCount || 1);
  const walkinResultedPercent = toPercent(walkinResultedCount, walkinStudentCount || 1);
  const visibleRegistrationTrend = useMemo(() => {
    return (registrationTrend || []).slice(-2);
  }, [registrationTrend]);
  const previousRegistrationEntry = visibleRegistrationTrend[0] || null;
  const selectedRegistrationEntry = visibleRegistrationTrend[visibleRegistrationTrend.length - 1] || null;
  const walkinStreamCounts = WALKIN_STREAMS.reduce((acc, stream) => {
    acc[stream] = 0;
    return acc;
  }, {});
  walkinStudents.forEach((student) => {
    const streamLabel = getWalkinStreamLabel(student?.course);
    if (streamLabel && walkinStreamCounts[streamLabel] !== undefined) {
      walkinStreamCounts[streamLabel] += 1;
    }
  });
  const regularWalkinRows = [
    { label: "Regular", count: regularStudentCount, tone: "regular" },
    { label: "Data Science", count: walkinStreamCounts["Data Science"], tone: "data-science" },
    { label: "Data Analytics", count: walkinStreamCounts["Data Analytics"], tone: "data-analytics" },
    { label: "MERN", count: walkinStreamCounts.MERN, tone: "mern" },
    { label: "Agentic AI", count: walkinStreamCounts["Agentic AI"], tone: "agentic-ai" }
  ].map((entry) => ({
    ...entry,
    percent: toPercent(entry.count, studentCount || 1)
  }));
  const enrollmentSectionRows = regularWalkinRows.filter((entry) => entry.tone !== "regular");
  const maxEnrollmentInSection = Math.max(
    ...enrollmentSectionRows.map((entry) => Number(entry.count || 0)),
    1
  );
  const enrollmentSectionBars = enrollmentSectionRows.map((entry) => ({
    ...entry,
    barPercent: (Number(entry.count || 0) / maxEnrollmentInSection) * 100
  }));
  const reviewAnswers = walkinReviewData?.answers || [];
  const reviewSummary = String(walkinReviewData?.performance_summary || "")
    .replace(/Main weak area:[^.]*\.?/gi, "")
    .trim();
  const reviewFeedbackText = String(walkinReviewData?.feedback_text || "").trim();
  const reviewFeedbackMode = String(walkinReviewData?.feedback_submission_mode || "").trim().toUpperCase();
  const reviewSummaryLines = reviewSummary
    ? reviewSummary.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const legacyStudentLineMatch =
    reviewSummaryLines.length > 0
      ? reviewSummaryLines[0].match(/^1\.\s*Student:\s*(.+)$/i)
      : null;
  const reviewSummaryTitle = reviewSummaryLines.length > 0
    ? (/^Performance Summary of /i.test(reviewSummaryLines[0])
        ? reviewSummaryLines[0]
        : legacyStudentLineMatch
          ? `Performance Summary of ${legacyStudentLineMatch[1].replace(/\.+$/, "").trim()}`
          : "Performance Summary")
    : "Performance Summary";
  const reviewSummaryBody = reviewSummaryLines.length > 0
    ? ((/^Performance Summary of /i.test(reviewSummaryLines[0]) || legacyStudentLineMatch)
        ? reviewSummaryLines.slice(1).join("\n")
        : reviewSummaryLines.join("\n"))
    : "";
  const reviewSummaryBodyLines = reviewSummaryBody
    ? reviewSummaryBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const aptitudeSummary = parseSectionSummary(reviewSummaryBodyLines, "Aptitude");
  const technicalSummary = parseSectionSummary(reviewSummaryBodyLines, "Technical");
  const codingSummary =
    parseCodingSummary(reviewSummaryBodyLines) ||
    buildCodingSummaryFromAnswers(reviewAnswers) ||
    parseCodingSummaryFromTopicStats(reviewSummaryBodyLines);
  const hideCodingSummaryCardsForStudent = isDataAnalyticsStream(walkinReviewData?.student?.course);
  const displayedCodingSummary = hideCodingSummaryCardsForStudent ? null : codingSummary;
  const reviewNarrativeLines = reviewSummaryBodyLines
    .filter((line) => !/^\d+\.\s*(Aptitude|Technical|Coding)\s*:/i.test(line))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  const reviewTopicSections = reviewNarrativeLines.map((line) => {
    const separatorIndex = line.indexOf(":");
    const hasLabel = separatorIndex > 0;
    const label = hasLabel ? line.slice(0, separatorIndex).trim() : "Topic";
    const body = hasLabel ? line.slice(separatorIndex + 1).trim() : line;
    const pointChunks = splitNarrativePoints(body)
      .map((chunk) => formatNarrativePoint(label, chunk))
      .filter(Boolean);
    return {
      label,
      points: pointChunks.length ? pointChunks : [body]
    };
  });
  const codingLevelCards = normalizeCodingLevels(displayedCodingSummary);
  const regularReviewResult = regularReviewData?.result || null;
  const regularReviewMeta = regularReviewData?.review || null;
  const regularReviewAnswers = regularReviewData?.questions || [];
  const regularReviewStudentName =
    regularReviewMeta?.student_name || regularReviewResult?.student_name || "Student";
  const regularReviewExamNumber =
    regularReviewMeta?.exam_id || regularReviewResult?.exam_id || "--";
  const regularReviewSections = buildRegularReviewSectionMetrics(regularReviewAnswers);
  const regularAptitudePercent = toPercent(
    regularReviewSections.aptitude.correct,
    regularReviewSections.aptitude.total
  );
  const regularTechnicalPercent = toPercent(
    regularReviewSections.technical.correct,
    regularReviewSections.technical.total
  );
  const regularFeedbackText = String(regularReviewMeta?.feedback_text || "").trim();
  const regularFeedbackMode = String(regularReviewMeta?.feedback_submission_mode || "").trim().toUpperCase();
  const walkinResultsRows = useMemo(() => {
    const source = Array.isArray(walkinResults) ? walkinResults : [];
    const query = walkinResultsSearch.trim().toLowerCase();
    return source.filter((row) => {
      const matchQuery =
        !query ||
        String(row.student_id || "").toLowerCase().includes(query) ||
        String(row.name || "").toLowerCase().includes(query) ||
        String(row.exam_id || "").toLowerCase().includes(query) ||
        String(row.stream || "").toLowerCase().includes(query);
      const matchStream =
        walkinResultsStreamFilter === "ALL" || String(row.stream || "") === walkinResultsStreamFilter;
      return matchQuery && matchStream;
    });
  }, [walkinResults, walkinResultsSearch, walkinResultsStreamFilter]);
  const walkinResultStreams = useMemo(() => {
    const source = Array.isArray(walkinResults) ? walkinResults : [];
    return [...new Set(source.map((row) => String(row.stream || "")).filter(Boolean))];
  }, [walkinResults]);
  const filteredWalkinStudents = useMemo(() => {
    const query = walkinStudentsSearch.trim().toLowerCase();
    return walkinStudents.filter((student) => {
      const matchQuery =
        !query ||
        String(student.student_id || "").toLowerCase().includes(query) ||
        String(student.name || "").toLowerCase().includes(query) ||
        String(student.email_id || "").toLowerCase().includes(query);
      const matchStream =
        walkinStudentsStreamFilter === "ALL" || String(student.course || "") === walkinStudentsStreamFilter;
      return matchQuery && matchStream;
    }).sort((left, right) => Number(right.student_id || 0) - Number(left.student_id || 0));
  }, [walkinStudents, walkinStudentsSearch, walkinStudentsStreamFilter]);
  const walkinStudentDateGroups = useMemo(
    () => buildStudentDateGroups(filteredWalkinStudents),
    [filteredWalkinStudents]
  );
  const handleDownloadWalkinResultsReport = useCallback(() => {
    setWalkinResultsExportStatus("");
    if (walkinResultsRows.length === 0) {
      setWalkinResultsExportStatus("No walk-in results match the current filters.");
      return;
    }

    const rows = walkinResultsRows.map((row) => {
      const streamKey = String(row.stream || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      const codingDisabled = streamKey === "dataanalytics" || streamKey === "da" || streamKey === "agenticai" || streamKey === "aai";
      const codingMarks =
        Number(row.coding_easy_marks || 0) +
        Number(row.coding_medium_marks || 0) +
        Number(row.coding_hard_marks || 0);
      return {
        "Student ID": Number(row.student_id || 0) || "",
        Name: String(row.name || "").trim(),
        Stream: String(row.stream || "").trim(),
        "Exam ID": Number(row.exam_id || 0) || "",
        Email: String(row.email_id || "").trim(),
        "Contact Number": String(row.contact_number || "").trim(),
        Aptitude: Number(row.aptitude_marks || 0).toFixed(2),
        Technical: Number(row.technical_marks || 0).toFixed(2),
        Coding: codingDisabled ? "N/A" : codingMarks.toFixed(2),
        "Total (50)": Number(row.total_marks || 0).toFixed(2)
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const columnWidths = [
      { wch: 12 },
      { wch: 28 },
      { wch: 18 },
      { wch: 10 },
      { wch: 32 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 }
    ];
    worksheet["!cols"] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Walk-In Results");
    const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    XLSX.writeFile(workbook, `walkin-results-report-${timestamp}.xlsx`);
    setWalkinResultsExportStatus(`Downloaded ${rows.length} walk-in result records.`);
  }, [walkinResultsRows]);
  const filteredRegularStudents = useMemo(() => {
    const query = regularStudentsSearch.trim().toLowerCase();
    return regularStudents.filter((student) => {
      const matchQuery =
        !query ||
        String(student.student_id || "").toLowerCase().includes(query) ||
        String(student.name || "").toLowerCase().includes(query) ||
        String(student.email_id || "").toLowerCase().includes(query);
      const matchCourse =
        regularStudentsCourseFilter === "ALL" || String(student.course || "") === regularStudentsCourseFilter;
      return matchQuery && matchCourse;
    });
  }, [regularStudents, regularStudentsSearch, regularStudentsCourseFilter]);
  const regularStudentDateGroups = useMemo(
    () => buildStudentDateGroups(filteredRegularStudents),
    [filteredRegularStudents]
  );
  const filteredRegularResults = useMemo(() => {
    const query = regularResultsSearch.trim().toLowerCase();
    return (recentResults || []).filter((row) => {
      const matchQuery =
        !query ||
        String(row.result_id || "").toLowerCase().includes(query) ||
        String(row.student_name || row.student_id || "").toLowerCase().includes(query) ||
        String(row.exam_name || row.exam_id || "").toLowerCase().includes(query);
      return matchQuery;
    });
  }, [recentResults, regularResultsSearch]);
  const filteredExams = useMemo(() => {
    const query = examListSearch.trim().toLowerCase();
    return (exams || [])
      .filter((exam) => {
        const matchQuery =
          !query ||
          String(exam.exam_id || "").toLowerCase().includes(query) ||
          String(exam.course || "").toLowerCase().includes(query) ||
          String(exam.college_name || exam.college_id || "").toLowerCase().includes(query);
        const matchStatus =
          examListStatusFilter === "ALL" ||
          normalizeExamStatus(exam.exam_status) === examListStatusFilter;
        return matchQuery && matchStatus;
      })
      .sort((a, b) => Number(b.exam_id || 0) - Number(a.exam_id || 0));
  }, [exams, examListSearch, examListStatusFilter]);
  const regularQuestionSections = useMemo(() => {
    const rows = Array.isArray(regularQuestionSheetData?.questions) ? regularQuestionSheetData.questions : [];
    const grouped = new Map();
    rows.forEach((row) => {
      const section = String(row?.section_name || "General").trim() || "General";
      if (!grouped.has(section)) grouped.set(section, []);
      grouped.get(section).push(row);
    });
    return Array.from(grouped.entries()).map(([sectionName, questions]) => ({ sectionName, questions }));
  }, [regularQuestionSheetData]);
  const regularAptitudeQuestions = useMemo(
    () => regularQuestionSections.find((section) => String(section.sectionName || "").toUpperCase() === "APTITUDE")?.questions || [],
    [regularQuestionSections]
  );
  const regularTechnicalQuestions = useMemo(
    () => regularQuestionSections
      .filter((section) => String(section.sectionName || "").toUpperCase() !== "APTITUDE")
      .flatMap((section) => section.questions || []),
    [regularQuestionSections]
  );
  const regularTechBackgroundQuestions = useMemo(
    () => regularTechnicalQuestions.filter((question) => String(question.background_type || "").trim().toUpperCase() === "TECH"),
    [regularTechnicalQuestions]
  );
  const regularNonTechBackgroundQuestions = useMemo(
    () => regularTechnicalQuestions.filter((question) => String(question.background_type || "").trim().toUpperCase() === "NON_TECH"),
    [regularTechnicalQuestions]
  );
  const studentProfileCourseOptions = useMemo(() => {
    return [...new Set((students || []).map((student) => String(student.course || "")).filter(Boolean))];
  }, [students]);
  const registeredBdeNameSet = useMemo(() => {
    return new Set(
      (bdeOptions || [])
        .map((bde) => String(bde.bde_name || "").trim().toLowerCase())
        .filter(Boolean)
    );
  }, [bdeOptions]);
  const bdeStudentRows = useMemo(() => {
    return (students || [])
      .map((student) => {
        const rawBdeName = String(student.bde_name || "").trim();
        const normalizedBdeName = normalizeBdeNameForDashboard(rawBdeName, registeredBdeNameSet);
        return {
          student_id: student.student_id,
          name: student.name,
          email_id: student.email_id,
          course: student.course,
          student_status: student.student_status,
          bde_name: normalizedBdeName,
          bde_name_raw: rawBdeName
        };
      })
      .filter((student) => student.bde_name)
      .sort((left, right) => Number(right.student_id || 0) - Number(left.student_id || 0));
  }, [students, registeredBdeNameSet]);
  const bdeStudentNameOptions = useMemo(() => {
    return [...new Set(bdeStudentRows.map((row) => String(row.bde_name || "").trim()).filter(Boolean))];
  }, [bdeStudentRows]);
  const bdeStudentCourseOptions = useMemo(() => {
    return [...new Set(bdeStudentRows.map((row) => String(row.course || "").trim()).filter(Boolean))];
  }, [bdeStudentRows]);
  const filteredBdeStudentRows = useMemo(() => {
    const query = bdeStudentsSearch.trim().toLowerCase();
    return bdeStudentRows.filter((row) => {
      const matchQuery =
        !query ||
        String(row.student_id || "").toLowerCase().includes(query) ||
        String(row.name || "").toLowerCase().includes(query) ||
        String(row.email_id || "").toLowerCase().includes(query);
      const matchBde =
        bdeStudentsBdeFilter === "ALL" || String(row.bde_name || "") === bdeStudentsBdeFilter;
      const matchCourse =
        bdeStudentsCourseFilter === "ALL" || String(row.course || "") === bdeStudentsCourseFilter;
      const matchStatus =
        bdeStudentsStatusFilter === "ALL" ||
        String(row.student_status || "").trim().toUpperCase() === bdeStudentsStatusFilter;
      return matchQuery && matchBde && matchCourse && matchStatus;
    });
  }, [
    bdeStudentRows,
    bdeStudentsSearch,
    bdeStudentsBdeFilter,
    bdeStudentsCourseFilter,
    bdeStudentsStatusFilter
  ]);
  const bdeSummaryRows = useMemo(() => {
    const countByName = new Map();
    bdeStudentRows.forEach((student) => {
      const key = String(student.bde_name || "").trim();
      if (!key) return;
      countByName.set(key, Number(countByName.get(key) || 0) + 1);
    });
    return (bdeOptions || []).map((bde) => {
      const name = String(bde.bde_name || "").trim();
      return {
        bde_id: bde.bde_id,
        bde_name: name,
        phone_number: bde.phone_number || "--",
        email_id: bde.email_id || "--",
        password: bde.password || "--",
        student_count: Number(countByName.get(name) || 0)
      };
    });
  }, [bdeOptions, bdeStudentRows]);
  const filteredBdeSummaryRows = useMemo(() => {
    const query = bdeAccountsSearch.trim().toLowerCase();
    if (!query) return bdeSummaryRows;
    return bdeSummaryRows.filter((row) =>
      String(row.bde_name || "").toLowerCase().includes(query) ||
      String(row.email_id || "").toLowerCase().includes(query) ||
      String(row.phone_number || "").toLowerCase().includes(query)
    );
  }, [bdeSummaryRows, bdeAccountsSearch]);
  const filteredStudentProfiles = useMemo(() => {
    const query = studentProfilesSearch.trim().toLowerCase();
    return (students || []).filter((student) => {
      const matchQuery =
        !query ||
        String(student.student_id || "").toLowerCase().includes(query) ||
        String(student.name || "").toLowerCase().includes(query) ||
        String(student.email_id || "").toLowerCase().includes(query);
      const matchType =
        studentProfilesTypeFilter === "ALL" || String(student.student_type || "") === studentProfilesTypeFilter;
      const matchCourse =
        studentProfilesCourseFilter === "ALL" || String(student.course || "") === studentProfilesCourseFilter;
      return matchQuery && matchType && matchCourse;
    }).sort((left, right) => {
      const leftTime = left?.created_at ? new Date(left.created_at).getTime() : NaN;
      const rightTime = right?.created_at ? new Date(right.created_at).getTime() : NaN;
      const leftHasTime = Number.isFinite(leftTime);
      const rightHasTime = Number.isFinite(rightTime);
      if (leftHasTime && rightHasTime && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return Number(right?.student_id || 0) - Number(left?.student_id || 0);
    });
  }, [students, studentProfilesSearch, studentProfilesTypeFilter, studentProfilesCourseFilter]);
  const renderTableSkeleton = (rows = 5) => (
    <div className="table-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={`sk-${index}`} className="skeleton-line" />
      ))}
    </div>
  );

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar admin-header" id="admin-overview">
          <div className="topbar-left">
            <div className="brand-logo">
              <img src="/dashboard-logo.png" alt="RP2 Rounded Professional Program" />
            </div>
          </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`topbar-notification ${walkinPendingCount > 0 ? "has-pending" : ""}`}
            onClick={() => handleSectionClick("walkin")}
            aria-label={
              walkinPendingCount > 0
                ? `${walkinPendingCount} walk-in approval requests pending`
                : "No pending walk-in approval requests"
            }
            title={
              walkinPendingCount > 0
                ? `${walkinPendingCount} pending walk-in approvals`
                : "No pending walk-in approvals"
            }
          >
            <span className="topbar-notification-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path
                  d="M12 3a6 6 0 0 0-6 6v3.2l-1.6 2.7a1 1 0 0 0 .86 1.5h13.48a1 1 0 0 0 .86-1.5L18 12.2V9a6 6 0 0 0-6-6Zm0 18a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 21Z"
                  fill="currentColor"
                />
              </svg>
            </span>
            {walkinPendingCount > 0 && (
              <span className="topbar-notification-badge">
                {walkinPendingCount > 99 ? "99+" : walkinPendingCount}
              </span>
            )}
          </button>
          <button type="button" className="topbar-profile" onClick={handleProfileClick}>
            <div className="profile-badge">A</div>
            <div>
              <span className="profile-name">Admin</span>
              <span className="profile-role">Administrator</span>
            </div>
          </button>
          <button className="logout-btn" onClick={logoutAdmin}>Logout</button>
        </div>
      </header>

      <div className="dashboard-layout admin-layout">
        <aside className="dashboard-sidebar admin-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-profile">
            <div className="profile-badge">A</div>
            <div>
              <h3>Welcome Admin</h3>
              <p>Manage exams</p>
            </div>
          </div>
        </div>

          <nav className="sidebar-nav">
          <span className="nav-group">Overview</span>
          <button
            type="button"
            className={`nav-button ${showProfile ? "" : "active"}`}
            onClick={handleDashboardClick}
          >
            Dashboard
          </button>
          <span className="nav-break" aria-hidden="true" />
          <span className="nav-group">Walk-In Students</span>
          <button
            type="button"
            className={`nav-button ${activeSection === "walkin" ? "active" : ""}`}
            onClick={() => handleSectionClick("walkin")}
          >
            Walk-In Management
            {walkinPendingCount > 0 && (
              <span className="admin-nav-count">{walkinPendingCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`nav-button ${activeSection === "walkin-results" ? "active" : ""}`}
            onClick={() => handleSectionClick("walkin-results")}
          >
            Walk-In Results
          </button>
          <button
            type="button"
            className={`nav-button ${activeSection === "walkin-questions" ? "active" : ""}`}
            onClick={() => handleSectionClick("walkin-questions")}
          >
            Walk-In Questions Sheet
          </button>
          <span className="nav-break" aria-hidden="true" />
          <span className="nav-group">Regular Students</span>
          {!showProfile && (
            <button
              type="button"
              className={`nav-button ${activeSection === "create-exam" ? "active" : ""}`}
              onClick={() => handleSectionClick("create-exam")}
            >
              Schedule exams
            </button>
          )}
          <button
            type="button"
            className={`nav-button ${activeSection === "regular" ? "active" : ""}`}
            onClick={() => handleSectionClick("regular")}
          >
            Regular Student Management
          </button>
          <button
            type="button"
            className={`nav-button ${activeSection === "regular-results" || activeSection === "regular-review" ? "active" : ""}`}
            onClick={() => handleSectionClick("regular-results")}
          >
            Regular Results
          </button>
          <button
            type="button"
            className={`nav-button ${activeSection === "regular-questions" ? "active" : ""}`}
            onClick={() => handleSectionClick("regular-questions")}
          >
            Regular Questions Sheet
          </button>
          <span className="nav-break" aria-hidden="true" />
          <span className="nav-group">Account</span>
          <button
            type="button"
            className={`nav-button ${activeSection === "students" ? "active" : ""}`}
            onClick={() => handleSectionClick("students")}
          >
            Student Profiles
          </button>
          <button
            type="button"
            className={`nav-button ${activeSection === "colleges" ? "active" : ""}`}
            onClick={() => handleSectionClick("colleges")}
          >
            Colleges
          </button>
          <button
            type="button"
            className={`nav-button ${activeSection === "business-executives" ? "active" : ""}`}
            onClick={() => handleSectionClick("business-executives")}
          >
            Our Business Executives
          </button>
          <button
            type="button"
            className={`nav-button ${showProfile ? "active" : ""}`}
            onClick={handleProfileClick}
          >
            My Profile
          </button>
          <span className="nav-break" aria-hidden="true" />
        </nav>

        <div className="sidebar-footer">
          <p>Need help? Contact your scholarship coordinator.</p>
        </div>
      </aside>

        <main className="dashboard-main admin-main">
          <section className="dashboard-container">
          {!showProfile && isDashboardView && (
            <>
              <div className="page-header">
                <div>
                  <h1>Dashboard</h1>
                  <p>Welcome back, {collegeName}. Manage exams and track live readiness.</p>
                </div>
                <button className="primary-action" type="button">Download Reports</button>
              </div>
              <AdminAnalyticsSection
                studentCount={studentCount}
                regularStudentCount={regularStudentCount}
                regularStudentsPercent={regularStudentsPercent}
                walkinStudentCount={walkinStudentCount}
                walkinStudentsPercent={walkinStudentsPercent}
                regularResultedCount={regularResultedCount}
                regularResultedPercent={regularResultedPercent}
                walkinResultedCount={walkinResultedCount}
                walkinResultedPercent={walkinResultedPercent}
                selectedRegistrationEntry={selectedRegistrationEntry}
                previousRegistrationEntry={previousRegistrationEntry}
                registrationMonthOffset={registrationMonthOffset}
                setRegistrationMonthOffset={setRegistrationMonthOffset}
                enrollmentSectionBars={enrollmentSectionBars}
                registeredBdeCount={registeredBdeCount}
                assignedBdeCount={assignedBdeCount}
                unassignedBdeCount={unassignedBdeCount}
                assignmentCoveragePercent={toPercent(assignedBdeCount, registeredBdeCount || 1)}
              />
            </>
          )}

          {!showProfile && (
            <>
              {activeSection === "walkin-results" && (
                <div className="dashboard-section admin-section" id="walkin-results">
                  <div className="walkin-results-head">
                    <h2>Walk-In Results</h2>
                    <div className="walkin-results-head-actions">
                      <button
                        type="button"
                        className="small-outline-btn"
                        onClick={handleDownloadWalkinResultsReport}
                      >
                        Download Report
                      </button>
                      <button
                        type="button"
                        className="small-outline-btn"
                        onClick={recomputeWalkinResults}
                        disabled={walkinRecomputeLoading}
                      >
                        {walkinRecomputeLoading ? "Recomputing..." : "Recompute Results"}
                      </button>
                    </div>
                  </div>
                  {walkinRecomputeStatus && <p className="section-placeholder">{walkinRecomputeStatus}</p>}
                  <div className="table-toolbar table-toolbar-upgraded">
                    <div className="table-toolbar-head">
                      <span className="table-toolbar-title">Walk-In Results</span>
                      <span className="table-toolbar-meta">{walkinResultsRows.length} records</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search by student, exam, stream"
                      value={walkinResultsSearch}
                      onChange={(event) => setWalkinResultsSearch(event.target.value)}
                    />
                    <select
                      value={walkinResultsStreamFilter}
                      onChange={(event) => setWalkinResultsStreamFilter(event.target.value)}
                    >
                      <option value="ALL">All Streams</option>
                      {walkinResultStreams.map((stream) => (
                        <option key={`wr-stream-${stream}`} value={stream}>
                          {stream}
                        </option>
                      ))}
                    </select>
                  </div>
                  {walkinResultsExportStatus && <p className="section-placeholder">{walkinResultsExportStatus}</p>}
                  {walkinResultsLoading && renderTableSkeleton(6)}
                  {walkinResultsError && <p className="auth-help">{walkinResultsError}</p>}
                  {walkinResults && walkinResultsRows.length === 0 && !walkinResultsLoading && !walkinResultsError && (
                    <div className="section-placeholder section-placeholder-panel">No walk-in results yet.</div>
                  )}
                  {walkinResults && walkinResultsRows.length > 0 && (
                    <div className="table-shell">
                    <table className="results-table sticky-table">
                      <thead>
                        <tr>
                          <th>Student ID</th>
                          <th>Name</th>
                          <th>Stream</th>
                          <th>Exam ID</th>
                          <th>Aptitude</th>
                          <th>Technical</th>
                          <th>Coding</th>
                          <th>Total (50)</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walkinResultsRows.map((row) => {
                          const streamKey = String(row.stream || "").trim().toLowerCase().replace(/\s+/g, "");
                          const isDataAnalytics = streamKey === "dataanalytics" || streamKey === "da";
                          const codingTotal =
                            Number(row.coding_easy_marks || 0) +
                            Number(row.coding_medium_marks || 0) +
                            Number(row.coding_hard_marks || 0);
                          return (
                          <tr key={`${row.student_id}-${row.exam_id}`}>
                            <td>{row.student_id}</td>
                            <td>{row.name || "--"}</td>
                            <td>{row.stream || "--"}</td>
                            <td>{row.exam_id}</td>
                            <td>{Number(row.aptitude_marks || 0).toFixed(2)}</td>
                            <td>{Number(row.technical_marks || 0).toFixed(2)}</td>
                            <td>{isDataAnalytics ? "N/A" : codingTotal.toFixed(2)}</td>
                            <td>{Number(row.total_marks || 0).toFixed(2)}</td>
                            <td>
                              <button
                                type="button"
                                className="view-btn"
                                onClick={() => openWalkinReview(row.student_id, row.exam_id, row.college_id)}
                                disabled={walkinReviewLoading}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                        })}
                      </tbody>
                    </table>
                    </div>
                  )}
                  {walkinReviewLoading && renderTableSkeleton(4)}
                  {walkinReviewError && <p className="auth-help">{walkinReviewError}</p>}
                </div>
              )}
              {activeSection === "walkin-review" && (
                <div className="dashboard-section admin-section" id="walkin-review">
                  <div className="walkin-review-head">
                    <div className="walkin-review-topline">
                      <button type="button" className="small-outline-btn" onClick={closeWalkinReview}>
                        ← Back to Walk-In Results
                      </button>
                      <h2>
                        {walkinReviewData?.student?.name || "Student"} - Exam {walkinReviewData?.exam_id || "--"}
                      </h2>
                    </div>
                    <div className="walkin-review-view-switch">
                      <button
                        type="button"
                        className={`small-outline-btn ${walkinReviewView === "summary" ? "active" : ""}`}
                        onClick={() => setWalkinReviewView("summary")}
                      >
                        Solutions Summary
                      </button>
                      <button
                        type="button"
                        className={`small-outline-btn ${walkinReviewView === "marks" ? "active" : ""}`}
                        onClick={() => setWalkinReviewView("marks")}
                      >
                        Student Solution
                      </button>
                      <button
                        type="button"
                        className={`small-outline-btn ${walkinReviewView === "feedback" ? "active" : ""}`}
                        onClick={() => setWalkinReviewView("feedback")}
                      >
                        Student Feedback
                      </button>
                    </div>
                  </div>
                  {walkinReviewLoading && renderTableSkeleton(4)}
                  {walkinReviewError && <p className="auth-help">{walkinReviewError}</p>}
                  {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "summary" && !reviewSummary && (
                    <p className="section-placeholder">No summary found for this attempt.</p>
                  )}
                  {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "marks" && reviewAnswers.length === 0 && (
                    <p className="section-placeholder">No answers found for this attempt.</p>
                  )}
                  {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "feedback" && !reviewFeedbackText && (
                    <p className="section-placeholder">No feedback submitted by the student.</p>
                  )}
                  {(reviewAnswers.length > 0 || reviewSummary || reviewFeedbackText) && (
                    <div className="walkin-review-list">
                      {walkinReviewView === "summary" && reviewSummary && (
                        <div className="walkin-review-card walkin-review-summary">
                          <p className="item-meta summary-title">{reviewSummaryTitle}</p>
                          {(aptitudeSummary || technicalSummary || displayedCodingSummary) && (
                            <div className="summary-score-grid">
                              {aptitudeSummary && (
                                <div className="summary-score-card summary-score-card-aptitude">
                                  <p className="summary-score-label">Aptitude</p>
                                  <div
                                    className="summary-donut"
                                    style={{ "--summary-percent": `${aptitudeSummary.percent}%` }}
                                  >
                                    <div className="summary-donut-center">
                                      <p className="summary-donut-value">{Math.round(aptitudeSummary.percent)}%</p>
                                      <p className="summary-donut-sub">score</p>
                                    </div>
                                  </div>
                                  <p className="summary-score-marks">
                                    {aptitudeSummary.scored.toFixed(2)} / {aptitudeSummary.total.toFixed(2)}
                                  </p>
                                </div>
                              )}
                              {technicalSummary && (
                                <div className="summary-score-card summary-score-card-technical">
                                  <p className="summary-score-label">Technical</p>
                                  <div
                                    className="summary-donut"
                                    style={{ "--summary-percent": `${technicalSummary.percent}%` }}
                                  >
                                    <div className="summary-donut-center">
                                      <p className="summary-donut-value">{Math.round(technicalSummary.percent)}%</p>
                                      <p className="summary-donut-sub">score</p>
                                    </div>
                                  </div>
                                  <p className="summary-score-marks">
                                    {technicalSummary.scored.toFixed(2)} / {technicalSummary.total.toFixed(2)}
                                  </p>
                                </div>
                              )}
                              {displayedCodingSummary && (
                                <div className="summary-coding-level-grid">
                                  {codingLevelCards.map((level) => (
                                    <div className="summary-score-card summary-score-card-coding-level" key={`coding-level-${level.name}`}>
                                      <p className="summary-score-label">Coding {level.name}</p>
                                      <div
                                        className="summary-donut summary-donut-coding"
                                        style={{ "--summary-percent": `${level.percent}%` }}
                                      >
                                        <div className="summary-donut-center">
                                          <p className="summary-donut-value">{Math.round(level.percent)}%</p>
                                          <p className="summary-donut-sub">score</p>
                                        </div>
                                      </div>
                                      <p className="summary-score-marks">
                                        {level.scored.toFixed(2)} / {level.total.toFixed(2)}
                                      </p>
                                      <p className="summary-coding-level-tc">
                                        TC {level.passed}/{level.tcTotal} ({Math.round(level.tcPercent)}%)
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {reviewTopicSections.length > 0 && (
                            <div className="summary-narrative-list">
                              <p className="summary-narrative-head">Topic Summary</p>
                              {reviewTopicSections.map((section, index) => (
                                <div className="summary-narrative-item" key={`summary-line-${index}`}>
                                  <p className="summary-narrative-label">{section.label}</p>
                                  <ul className="summary-narrative-points">
                                    {section.points.map((point, pointIndex) => (
                                      <li className="summary-narrative-body" key={`summary-line-${index}-point-${pointIndex}`}>
                                        {point}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {walkinReviewView === "marks" && reviewAnswers.map((reviewQuestion, index) => (
                        <div className="walkin-review-card" key={`review-${reviewQuestion.submission_id}`}>
                          <p className="item-meta">
                            {reviewQuestion.section_label} | Question {index + 1} | Marks: {Number(reviewQuestion.marks_obtained || 0).toFixed(2)} / {Number(reviewQuestion.full_marks || 0).toFixed(2)}
                          </p>
                          <p className="item-text">{reviewQuestion.question_text || "Question text unavailable"}</p>

                          {reviewQuestion.question_type === "MCQ" && (
                            <>
                              {renderWalkinOptions(reviewQuestion)}
                            </>
                          )}

                          {reviewQuestion.question_type === "Descriptive" && (
                            <>
                              <p className="item-answer item-answer-student">Student answer: {reviewQuestion.descriptive_answer || "-"}</p>
                              <p className="item-answer item-answer-reference">Reference answer: {reviewQuestion.reference_descriptive_answer || "-"}</p>
                            </>
                          )}

                          {reviewQuestion.question_type === "Coding" && (
                            <>
                              <p className="item-answer">Passed testcases: {Number(reviewQuestion.testcases_passed || 0)} / {Number(reviewQuestion.total_testcases || 0)}</p>
                              <pre className="walkin-code-block">{reviewQuestion.code || "--"}</pre>
                            </>
                          )}
                        </div>
                      ))}
                      {walkinReviewView === "feedback" && reviewFeedbackText && (
                        <div className="walkin-review-card walkin-review-summary walkin-feedback-card">
                          <div className="walkin-feedback-head">
                            <p className="item-meta summary-title">Student Feedback</p>
                            {reviewFeedbackMode && (
                              <span
                                className={`walkin-feedback-mode-badge ${
                                  reviewFeedbackMode === "AUTO_SUBMIT" ? "auto" : "manual"
                                }`}
                              >
                                {reviewFeedbackMode === "AUTO_SUBMIT" ? "Auto Submit" : "Manual Submit"}
                              </span>
                            )}
                          </div>
                          <div className="walkin-feedback-response-block">
                            <p className="item-answer item-answer-student">"{reviewFeedbackText}"</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {activeSection === "walkin-questions" && (
                <div className="dashboard-section admin-section" id="walkin-questions">
                  <h2>Walk-In Questions Sheet</h2>
                  {walkinSheetLoading && renderTableSkeleton(8)}
                  {walkinSheetError && <p className="auth-help">{walkinSheetError}</p>}
                  {walkinQuestionEditStatus && <p className="section-placeholder">{walkinQuestionEditStatus}</p>}
                  {walkinSheetData && (
                    <>
                      <div className="walkin-sheet-section-tabs">
                        <button
                          type="button"
                          className={`walkin-tab ${walkinSheetSectionTab === "aptitude" ? "active" : ""}`}
                          onClick={() => setWalkinSheetSectionTab("aptitude")}
                        >
                          Aptitude Questions
                        </button>
                        <button
                          type="button"
                          className={`walkin-tab ${walkinSheetSectionTab === "stream" ? "active" : ""}`}
                          onClick={() => setWalkinSheetSectionTab("stream")}
                        >
                          Stream Questions
                        </button>
                        <button
                          type="button"
                          className={`walkin-tab ${walkinSheetSectionTab === "coding" ? "active" : ""}`}
                          onClick={() => setWalkinSheetSectionTab("coding")}
                        >
                          Coding Questions
                        </button>
                      </div>

                      <div className="walkin-sheet-grid walkin-sheet-grid-single">
                        {walkinSheetSectionTab === "aptitude" && (
                          <div className="walkin-sheet-block">
                            <h3>Aptitude Questions</h3>
                            {walkinSheetData.aptitude.length === 0 && <p>No aptitude questions defined.</p>}
                            {walkinSheetData.aptitude.map((q) => (
                              <div className="walkin-sheet-item" key={`aptitude-${q.question_id}`}>
                                <div className="walkin-sheet-item-head">
                                  <p className="item-meta">Marks: {q.marks ?? 1}</p>
                                  <button
                                    type="button"
                                    className="walkin-question-edit-btn"
                                    onClick={() => openWalkinQuestionEditor("aptitude", q)}
                                  >
                                    Edit
                                  </button>
                                </div>
                                <p className="item-text">{q.question_text}</p>
                                {renderWalkinOptions(q)}
                              </div>
                            ))}
                          </div>
                        )}

                        {walkinSheetSectionTab === "stream" && (
                          <div className="walkin-sheet-block">
                            <h3>Stream Questions</h3>
                            <div className="walkin-stream-tabs">
                              {WALKIN_STREAMS.map((stream) => (
                                <button
                                  key={`tab-${stream}`}
                                  type="button"
                                  className={`walkin-tab ${walkinStreamTab === stream ? "active" : ""}`}
                                  onClick={() => setWalkinStreamTab(stream)}
                                >
                                  {stream}
                                </button>
                              ))}
                            </div>
                            <div className="walkin-stream-group">
                              <h4>{walkinStreamTab}</h4>
                              {(walkinSheetData.streams?.[walkinStreamTab] || []).length === 0 && (
                                <p className="section-placeholder">No questions for this stream yet.</p>
                              )}
                              {(walkinSheetData.streams?.[walkinStreamTab] || []).map((row) => (
                                <div className="walkin-sheet-item" key={`stream-${walkinStreamTab}-${row.question_id}`}>
                                  <div className="walkin-sheet-item-head">
                                    <p className="item-meta">{row.section_name}  Marks: {row.marks ?? 1}</p>
                                    <button
                                      type="button"
                                      className="walkin-question-edit-btn"
                                      onClick={() => openWalkinQuestionEditor("stream", row, walkinStreamTab)}
                                    >
                                      Edit
                                    </button>
                                  </div>
                                  <p className="item-text">{row.question_text}</p>
                                  {row.question_type?.toLowerCase() === "mcq" && renderWalkinOptions(row)}
                                  {row.descriptive_answer && (
                                    <p className="item-answer">Sample solution: {row.descriptive_answer}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {walkinSheetSectionTab === "coding" && (
                          <div className="walkin-sheet-block">
                            <h3>Coding Questions</h3>
                            {(walkinSheetData.coding || []).length === 0 && <p>No coding questions defined.</p>}
                            {(walkinSheetData.coding || []).map((row) => (
                              <div className="walkin-sheet-item" key={`coding-${row.question_id}`}>
                                <div className="walkin-sheet-item-head">
                                  <p className="item-meta">Marks: {row.marks ?? 1}</p>
                                  <button
                                    type="button"
                                    className="walkin-question-edit-btn"
                                    onClick={() => openWalkinQuestionEditor("coding", row)}
                                  >
                                    Edit
                                  </button>
                                </div>
                                <p className="item-text">{row.question_text}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSection === "regular-questions" && (
                <div className="dashboard-section admin-section" id="regular-questions">
                  <h2>Regular Exam Questions Sheet</h2>
                  {regularQuestionEditStatus && <p className="section-placeholder">{regularQuestionEditStatus}</p>}
                  {regularQuestionSheetError && <p className="auth-help">{regularQuestionSheetError}</p>}
                  {regularQuestionSheetData?.exam && (
                    <p className="section-placeholder" style={{ marginTop: 8 }}>
                      Exam ID: {regularQuestionSheetData.exam.exam_id} | Status: {normalizeExamStatus(regularQuestionSheetData.exam.exam_status)} | Schedule: {formatIST24(regularQuestionSheetData.exam.start_at)} to {formatIST24(regularQuestionSheetData.exam.end_at)}
                    </p>
                  )}
                  {regularQuestionSheetLoading && renderTableSkeleton(8)}
                  {!regularQuestionSheetLoading && regularQuestionSections.length === 0 && !regularQuestionSheetError && (
                    <p className="section-placeholder">No regular exam questions found.</p>
                  )}
                  {!regularQuestionSheetLoading && regularQuestionSections.length > 0 && (
                    <>
                      <div className="walkin-sheet-section-tabs">
                        <button
                          type="button"
                          className={`walkin-tab ${regularQuestionSectionTab === "aptitude" ? "active" : ""}`}
                          onClick={() => setRegularQuestionSectionTab("aptitude")}
                        >
                          Aptitude Questions
                        </button>
                        <button
                          type="button"
                          className={`walkin-tab ${regularQuestionSectionTab === "technical" ? "active" : ""}`}
                          onClick={() => setRegularQuestionSectionTab("technical")}
                        >
                          Tech Questions
                        </button>
                        <button
                          type="button"
                          className={`walkin-tab ${regularQuestionSectionTab === "non-technical" ? "active" : ""}`}
                          onClick={() => setRegularQuestionSectionTab("non-technical")}
                        >
                          Non Tech Questions
                        </button>
                      </div>

                      <div className="walkin-sheet-grid walkin-sheet-grid-single regular-question-sections">
                        {regularQuestionSectionTab === "aptitude" && (
                          <div className="walkin-sheet-block">
                            <h3>Aptitude Questions</h3>
                            {regularAptitudeQuestions.length === 0 && <p>No aptitude questions defined.</p>}
                            {regularAptitudeQuestions.map((question, index) => (
                              <div className="walkin-sheet-item" key={`regular-aptitude-${question.question_id}`}>
                                <div className="walkin-sheet-item-head">
                                  <p className="item-meta">S.No. {index + 1} | QID: {question.question_id} | Type: {String(question.question_type || "MCQ")}</p>
                                  <button
                                    type="button"
                                    className="walkin-question-edit-btn"
                                    onClick={() => openRegularQuestionEditor("aptitude", question)}
                                  >
                                    Edit
                                  </button>
                                </div>
                                <p className="item-text">{question.question_text}</p>
                                {renderRegularQuestionSheetOptions(question)}
                              </div>
                            ))}
                          </div>
                        )}

                        {regularQuestionSectionTab === "technical" && (
                          <div className="walkin-sheet-block">
                            <h3>Tech Questions</h3>
                            {regularTechBackgroundQuestions.length === 0 && <p>No technical questions defined.</p>}
                            {regularTechBackgroundQuestions.map((question, index) => (
                              <div className="walkin-sheet-item" key={`regular-technical-tech-${question.question_id}`}>
                                <div className="walkin-sheet-item-head">
                                  <p className="item-meta">S.No. {index + 1} | QID: {question.question_id} | Type: {String(question.question_type || "MCQ")}</p>
                                  <button
                                    type="button"
                                    className="walkin-question-edit-btn"
                                    onClick={() => openRegularQuestionEditor("technical", question)}
                                  >
                                    Edit
                                  </button>
                                </div>
                                <p className="item-text">{question.question_text}</p>
                                {renderRegularQuestionSheetOptions(question)}
                              </div>
                            ))}
                          </div>
                        )}

                        {regularQuestionSectionTab === "non-technical" && (
                          <div className="walkin-sheet-block">
                            <h3>Non Tech Questions</h3>
                            {regularNonTechBackgroundQuestions.length === 0 && <p>No non technical questions defined.</p>}
                            {regularNonTechBackgroundQuestions.map((question, index) => (
                              <div className="walkin-sheet-item" key={`regular-technical-non-tech-${question.question_id}`}>
                                <div className="walkin-sheet-item-head">
                                  <p className="item-meta">S.No. {index + 1} | QID: {question.question_id} | Type: {String(question.question_type || "MCQ")}</p>
                                  <button
                                    type="button"
                                    className="walkin-question-edit-btn"
                                    onClick={() => openRegularQuestionEditor("technical", question)}
                                  >
                                    Edit
                                  </button>
                                </div>
                                <p className="item-text">{question.question_text}</p>
                                {renderRegularQuestionSheetOptions(question)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSection === "regular-results" && (
                <div className="dashboard-section admin-section" id="admin-results">
                  <h2>Regular Student Results</h2>
                  <div className="table-toolbar table-toolbar-upgraded">
                    <div className="table-toolbar-head">
                      <span className="table-toolbar-title">Regular Results</span>
                      <span className="table-toolbar-meta">{filteredRegularResults.length} matches</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search by result, student, exam"
                      value={regularResultsSearch}
                      onChange={(event) => setRegularResultsSearch(event.target.value)}
                    />
                  </div>
                  <div className="table-shell">
                  <table className="sticky-table">
                    <thead>
                      <tr>
                        <th>Result ID</th>
                        <th>Student</th>
                        <th>Exam</th>
                        <th>Course</th>
                        <th>Marks</th>
                        <th>Percentage</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegularResults.length === 0 && (
                        <tr>
                          <td colSpan="8" className="table-empty-cell">No results found</td>
                        </tr>
                      )}
                      {filteredRegularResults.map((result) => {
                        const totalQuestions = Number(result.total_questions || 0);
                        const earnedMarksValue =
                          result.correct_answers ?? result.total_marks;
                        const parsedEarned =
                          earnedMarksValue != null ? Number(earnedMarksValue) : null;
                        const marksText =
                          parsedEarned !== null && Number.isFinite(parsedEarned)
                            ? `${parsedEarned}/${totalQuestions > 0 ? totalQuestions : "--"}`
                            : "--";
                        const percentageValue = Number(result.percentage);
                        const percentageText = Number.isFinite(percentageValue)
                          ? `${percentageValue.toFixed(2)}%`
                          : "--";
                        return (
                          <tr key={result.result_id}>
                            <td>{result.result_id}</td>
                            <td>{result.student_name || result.student_id}</td>
                            <td>{result.exam_name || result.exam_id}</td>
                            <td>{result.course}</td>
                            <td>{marksText}</td>
                            <td>{percentageText}</td>
                            <td>{result.result_status || result.pass_fail || result.attempt_status || "--"}</td>
                            <td>
                              <button
                                className="ghost-action"
                                type="button"
                                onClick={() => viewResultDetail(result)}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {activeSection === "regular-review" && (
                <div className="dashboard-section admin-section" id="regular-review">
                  <div className="walkin-review-head">
                    <div className="walkin-review-topline">
                      <button type="button" className="small-outline-btn" onClick={closeRegularReview}>
                        ← Back to Regular Results
                      </button>
                      <h2>
                        {String(regularReviewStudentName || "Student").toUpperCase()} - EXAM {regularReviewExamNumber}
                      </h2>
                    </div>
                    <div className="walkin-review-view-switch">
                      <button
                        type="button"
                        className={`small-outline-btn ${regularReviewView === "summary" ? "active" : ""}`}
                        onClick={() => setRegularReviewView("summary")}
                      >
                        Solutions Summary
                      </button>
                      <button
                        type="button"
                        className={`small-outline-btn ${regularReviewView === "marks" ? "active" : ""}`}
                        onClick={() => setRegularReviewView("marks")}
                      >
                        Student Solution
                      </button>
                      <button
                        type="button"
                        className={`small-outline-btn ${regularReviewView === "feedback" ? "active" : ""}`}
                        onClick={() => setRegularReviewView("feedback")}
                      >
                        Student Feedback
                      </button>
                    </div>
                  </div>
                  {regularReviewLoading && renderTableSkeleton(4)}
                  {regularReviewError && <p className="auth-help">{regularReviewError}</p>}
                  {!regularReviewLoading &&
                    !regularReviewError &&
                    regularReviewView === "summary" &&
                    regularReviewAnswers.length === 0 && (
                      <p className="section-placeholder">No summary found for this attempt.</p>
                    )}
                  {!regularReviewLoading &&
                    !regularReviewError &&
                    regularReviewView === "marks" &&
                    regularReviewAnswers.length === 0 && (
                      <p className="section-placeholder">No answers found for this attempt.</p>
                    )}
                  {!regularReviewLoading &&
                    !regularReviewError &&
                    regularReviewView === "feedback" &&
                    !regularFeedbackText && (
                      <p className="section-placeholder">No feedback submitted by the student.</p>
                    )}
                  {(regularReviewAnswers.length > 0 || regularFeedbackText) && (
                    <div className="walkin-review-list">
                      {regularReviewView === "summary" && regularReviewAnswers.length > 0 && (
                        <div className="walkin-review-card walkin-review-summary">
                          <p className="item-meta summary-title">
                            Performance Summary of {regularReviewStudentName} ({regularReviewResult?.course || "Regular"})
                          </p>
                          <div className="summary-score-grid">
                            <div className="summary-score-card summary-score-card-aptitude">
                              <p className="summary-score-label">Aptitude</p>
                              <div
                                className="summary-donut"
                                style={{ "--summary-percent": `${regularAptitudePercent}%` }}
                              >
                                <div className="summary-donut-center">
                                  <p className="summary-donut-value">{Math.round(regularAptitudePercent)}%</p>
                                  <p className="summary-donut-sub">score</p>
                                </div>
                              </div>
                              <p className="summary-score-marks">
                                {regularReviewSections.aptitude.correct.toFixed(2)} / {regularReviewSections.aptitude.total.toFixed(2)}
                              </p>
                              <p className="summary-score-accuracy">
                                Attempted {regularReviewSections.aptitude.attempted} | Wrong {regularReviewSections.aptitude.wrong}
                              </p>
                            </div>
                            <div className="summary-score-card summary-score-card-technical">
                              <p className="summary-score-label">Technical</p>
                              <div
                                className="summary-donut"
                                style={{ "--summary-percent": `${regularTechnicalPercent}%` }}
                              >
                                <div className="summary-donut-center">
                                  <p className="summary-donut-value">{Math.round(regularTechnicalPercent)}%</p>
                                  <p className="summary-donut-sub">score</p>
                                </div>
                              </div>
                              <p className="summary-score-marks">
                                {regularReviewSections.technical.correct.toFixed(2)} / {regularReviewSections.technical.total.toFixed(2)}
                              </p>
                              <p className="summary-score-accuracy">
                                Attempted {regularReviewSections.technical.attempted} | Wrong {regularReviewSections.technical.wrong}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      {regularReviewView === "marks" &&
                        regularReviewAnswers.map((reviewQuestion, index) => {
                          const sectionLabel = normalizeRegularReviewSection(reviewQuestion.section_name);
                          const isCorrectAnswer =
                            String(reviewQuestion.selected_option || "").trim().toUpperCase() ===
                            String(reviewQuestion.correct_answer || "").trim().toUpperCase();
                          const marksObtained = reviewQuestion.selected_option ? (isCorrectAnswer ? 1 : 0) : 0;
                          return (
                            <div className="walkin-review-card" key={`regular-review-${reviewQuestion.question_id}`}>
                              <p className="item-meta">
                                {sectionLabel === "APTITUDE" ? "Aptitude" : "Technical"} | Question {index + 1} | Marks: {marksObtained.toFixed(2)} / 1.00
                              </p>
                              <p className="item-text">{reviewQuestion.question_text || "Question text unavailable"}</p>
                              {renderRegularReviewOptions(reviewQuestion)}
                            </div>
                          );
                        })}
                      {regularReviewView === "feedback" && regularFeedbackText && (
                        <div className="walkin-review-card walkin-review-summary walkin-feedback-card">
                          <div className="walkin-feedback-head">
                            <p className="item-meta summary-title">Student Feedback</p>
                            {regularFeedbackMode && (
                              <span
                                className={`walkin-feedback-mode-badge ${
                                  regularFeedbackMode === "AUTO_SUBMIT" ? "auto" : "manual"
                                }`}
                              >
                                {regularFeedbackMode === "AUTO_SUBMIT" ? "Auto Submit" : "Manual Submit"}
                              </span>
                            )}
                          </div>
                          <div className="walkin-feedback-response-block">
                            <p className="item-answer item-answer-student">"{regularFeedbackText}"</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeSection === "walkin" && (
              <>
                {(walkinTempLoading || walkinTempRequests.length > 0) && (
                <div className="dashboard-section admin-section" id="walkin-approval">
                  <h2>Pending Walk-In Approval Requests ({walkinTempRequests.length})</h2>
                  {walkinTempStatus && (
                    <p className="section-placeholder">
                      {walkinTempStatus}
                      {walkinApprovedCredentials && (
                        <span>
                          <br />
                          Student ID: <strong>{walkinApprovedCredentials.studentId}</strong>
                          <br />
                          Email: <strong>{walkinApprovedCredentials.email}</strong>
                          <br />
                          Password: <strong>{walkinApprovedCredentials.password}</strong>
                        </span>
                      )}
                    </p>
                  )}
                  {walkinTempLoading && renderTableSkeleton(4)}
                  {!walkinTempLoading && walkinTempRequests.length > 0 && (
                    <div className="table-shell">
                      <table className="sticky-table pending-approval-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Contact</th>
                            <th>DOB</th>
                            <th>Stream</th>
                            <th>College</th>
                            <th>BDE</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {walkinTempRequests.map((row) => {
                            const isBusy = Boolean(walkinTempActionLoading[row.id]);
                            return (
                              <tr key={`walkin-temp-${row.id}`}>
                                <td>{row.name || "--"}</td>
                                <td>{row.email_id || "--"}</td>
                                <td>{row.contact_number || "--"}</td>
                                <td>{row.dob ? String(row.dob).slice(0, 10) : "--"}</td>
                                <td>{row.stream || "--"}</td>
                                <td>{row.college_name || row.college_id || "--"}</td>
                                <td>{row.bde_name || "--"}</td>
                                <td>
                                  <div className="walkin-approval-actions">
                                    <button
                                      type="button"
                                      className="approval-btn approve"
                                      onClick={() => handleApproveWalkinTemp(row.id)}
                                      disabled={isBusy}
                                      aria-label="Approve student"
                                      title="Approve"
                                    >
                                      {isBusy ? "..." : "✓"}
                                    </button>
                                    <button
                                      type="button"
                                      className="approval-btn reject"
                                      onClick={() => handleRejectWalkinTemp(row.id)}
                                      disabled={isBusy}
                                      aria-label="Reject student"
                                      title="Reject"
                                    >
                                      {isBusy ? "..." : "✕"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                )}

                <div
                  className={`dashboard-section admin-section create-panel ${walkinCreateOpen ? "is-open" : "is-collapsed"}`}
                  id="walkin-create"
                >
                  <div className="create-panel-header">
                    <h2>Create Walk-In Student Account</h2>
                    <button
                      type="button"
                      className="small-outline-btn create-panel-toggle"
                      onClick={() => setWalkinCreateOpen((prev) => !prev)}
                      aria-expanded={walkinCreateOpen}
                      aria-controls="walkin-create-form"
                    >
                      {walkinCreateOpen ? "Close" : "Create"}
                    </button>
                  </div>
                  {walkinCreateOpen && (
                  <form
                    id="walkin-create-form"
                    className="form-row form-row-wide"
                    autoComplete="off"
                    onSubmit={handleWalkinCreation}
                  >
                    <div className="form-field">
                      <label>Full Name</label>
                      <input
                        type="text"
                        name="walkin_full_name_input"
                        autoComplete="new-password"
                        placeholder="Enter full name"
                        value={walkinForm.name}
                        onChange={(event) => setWalkinForm({ ...walkinForm, name: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Email</label>
                      <input
                        type="email"
                        name="walkin_email_input"
                        autoComplete="new-password"
                        placeholder="Enter email"
                        value={walkinForm.email}
                        onChange={(event) => setWalkinForm({ ...walkinForm, email: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Phone Number</label>
                      <input
                        type="text"
                        name="walkin_phone_input"
                        autoComplete="new-password"
                        placeholder="Enter contact number"
                        value={walkinForm.phone}
                        onChange={(event) => setWalkinForm({ ...walkinForm, phone: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Date of Birth</label>
                      <input
                        type="date"
                        name="walkin_dob_input"
                        autoComplete="off"
                        value={walkinForm.dob}
                        onChange={(event) => setWalkinForm({ ...walkinForm, dob: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Stream</label>
                      <select
                        value={walkinForm.stream}
                        onChange={(event) => setWalkinForm({ ...walkinForm, stream: event.target.value })}
                      >
                        <option value="">Select Stream</option>
                        {WALKIN_STREAMS.map((stream) => (
                          <option key={stream} value={stream}>
                            {stream}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>BDE</label>
                      <select
                        value={walkinForm.bdeName}
                        onChange={(event) => setWalkinForm({ ...walkinForm, bdeName: event.target.value })}
                      >
                        <option value="">Select BDE</option>
                        {bdeOptions.map((bde) => (
                          <option key={`walkin-bde-${bde.bde_id || bde.bde_name}`} value={bde.bde_name}>
                            {bde.bde_name || bde.email_id}
                          </option>
                        ))}
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                    {String(walkinForm.bdeName || "").toUpperCase() === "OTHER" && (
                      <div className="form-field">
                        <label>Other BDE Name</label>
                        <input
                          type="text"
                          placeholder="Enter BDE name"
                          value={walkinForm.bdeNameOther}
                          onChange={(event) => setWalkinForm({ ...walkinForm, bdeNameOther: event.target.value })}
                        />
                      </div>
                    )}
                    <div className="form-field">
                      <label>College</label>
                      <select
                        value={walkinForm.collegeId}
                        onChange={(event) => setWalkinForm({ ...walkinForm, collegeId: event.target.value })}
                      >
                        <option value="">Select college</option>
                        {collegeOptionsSortedByName.map((college) => (
                          <option key={`walkin-college-${college.college_id}`} value={college.college_id}>
                            {college.college_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" disabled={walkinCreateSubmitting}>
                      {walkinCreateSubmitting ? "Creating..." : "Create Walk-In Account"}
                    </button>
                  </form>
                  )}
                  {collegeError && (
                    <p className="auth-help" style={{ marginTop: 10 }}>
                      {collegeError}
                    </p>
                  )}
                  {bdeError && (
                    <p className="auth-help" style={{ marginTop: 10 }}>
                      {bdeError}
                    </p>
                  )}
                  {walkinStatus && (
                    <p className="auth-help" style={{ marginTop: 10 }}>
                      {walkinStatus}
                      {walkinCredentials && (
                        <span>
                          <br />
                          Email: <strong>{walkinCredentials.email}</strong>
                          <br />
                          Password: <strong>{walkinCredentials.password}</strong>
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="dashboard-section admin-section" id="walkin-list">
                  <div className="walkin-list-head">
                    {!selectedWalkinProfile && <h2>Walk-In Students</h2>}
                    {selectedWalkinProfile && (
                      <button
                        type="button"
                        className="secondary-btn walkin-profile-back-btn"
                        onClick={() => setSelectedWalkinProfile(null)}
                      >
                        Back
                      </button>
                    )}
                  </div>
                  {!selectedWalkinProfile && (
                    <>
                      <div className="table-toolbar table-toolbar-upgraded">
                        <div className="table-toolbar-head">
                          <span className="table-toolbar-title">Walk-In Students</span>
                          <span className="table-toolbar-meta">{filteredWalkinStudents.length} matches</span>
                        </div>
                        <input
                          type="text"
                          placeholder="Search by id, name, email"
                          value={walkinStudentsSearch}
                          onChange={(event) => setWalkinStudentsSearch(event.target.value)}
                        />
                        <select
                          value={walkinStudentsStreamFilter}
                          onChange={(event) => setWalkinStudentsStreamFilter(event.target.value)}
                        >
                          <option value="ALL">All Streams</option>
                          {WALKIN_STREAMS.map((stream) => (
                            <option key={`ws-stream-${stream}`} value={stream}>
                            {stream}
                          </option>
                        ))}
                        </select>
                      </div>
                      {filteredWalkinStudents.length === 0 ? (
                        <div className="table-shell">
                          <table className="sticky-table">
                            <thead>
                              <tr>
                                <th>S.No</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Specialization</th>
                                <th>Status</th>
                                <th>View Profile</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td colSpan="6" className="table-empty-cell">No walk-in students found</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="student-date-groups">
                          {walkinStudentDateGroups.map((group) => (
                            <div className="student-date-group" key={`walkin-group-${group.dateKey}`}>
                              <div className="student-date-heading">
                                <span className="student-date-row-label">{formatRegistrationDateLabel(group.dateKey)}</span>
                                <span className="student-date-row-count">{group.students.length} registered</span>
                              </div>
                              <div className="table-shell">
                                <table className="sticky-table">
                                  <thead>
                                    <tr>
                                      <th>S.No</th>
                                      <th>Name</th>
                                      <th>Email</th>
                                      <th>Specialization</th>
                                      <th>Status</th>
                                      <th>View Profile</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.students.map((student, index) => {
                                      const statusLabel = String(student.student_status || "ACTIVE").trim().toUpperCase();
                                      return (
                                        <tr
                                          key={student.student_id}
                                          className={statusLabel === "INACTIVE" ? "student-row-inactive" : ""}
                                        >
                                          <td>{index + 1}</td>
                                          <td>{student.name}</td>
                                          <td>{student.email_id}</td>
                                          <td>{student.course}</td>
                                          <td>
                                            <span className={"status-badge " + statusLabel.toLowerCase()}>
                                              {statusLabel}
                                            </span>
                                          </td>
                                          <td>
                                            <button
                                              type="button"
                                              className="secondary-btn"
                                              onClick={() => setSelectedWalkinProfile(student)}
                                            >
                                              View Profile
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {selectedWalkinProfile && (
                    <div className={`dashboard-section admin-section profile-section walkin-inline-profile ${walkinProfileEditMode ? "edit-mode" : ""}`}>
                      <h2>{`${selectedWalkinProfile.name || "Student"} Profile`}</h2>
                      {walkinProfileEditStatus && <p className="auth-help">{walkinProfileEditStatus}</p>}
                      <div className="profile-grid">
                        <div className="profile-item"><span className="profile-label">Student ID</span><span className="profile-value">{selectedWalkinProfile.student_id || "--"}</span></div>
                        <div className="profile-item">
                          <span className="profile-label">Name</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <input
                                type="text"
                                value={walkinProfileForm.name}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, name: event.target.value }))}
                              />
                            ) : (selectedWalkinProfile.name || "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Email</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <input
                                type="email"
                                value={walkinProfileForm.email}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, email: event.target.value }))}
                              />
                            ) : (selectedWalkinProfile.email_id || "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Contact</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={10}
                                value={walkinProfileForm.contact}
                                onChange={(event) =>
                                  setWalkinProfileForm((prev) => ({
                                    ...prev,
                                    contact: String(event.target.value || "").replace(/\D/g, "").slice(0, 10)
                                  }))
                                }
                              />
                            ) : (selectedWalkinProfile.contact_number || "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">DOB</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <input
                                type="date"
                                value={walkinProfileForm.dob}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, dob: event.target.value }))}
                              />
                            ) : (selectedWalkinProfile.dob ? new Date(selectedWalkinProfile.dob).toLocaleDateString() : "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Stream</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <select
                                value={walkinProfileForm.stream}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, stream: event.target.value }))}
                              >
                                <option value="">Select Stream</option>
                                {WALKIN_STREAMS.map((stream) => (
                                  <option key={`walkin-profile-stream-${stream}`} value={stream}>
                                    {stream}
                                  </option>
                                ))}
                              </select>
                            ) : (selectedWalkinProfile.course || "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">College</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <select
                                value={walkinProfileForm.collegeId || String(selectedWalkinProfile.college_id || "")}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, collegeId: event.target.value }))}
                              >
                                <option value="">Select College</option>
                                {selectedWalkinProfile.college_id &&
                                  !collegeOptionsSortedByName.some(
                                    (college) => String(college.college_id) === String(selectedWalkinProfile.college_id)
                                  ) && (
                                    <option value={String(selectedWalkinProfile.college_id)}>
                                      {selectedWalkinProfile.college_name || `College ${selectedWalkinProfile.college_id}`}
                                    </option>
                                  )}
                                {collegeOptionsSortedByName.map((college) => (
                                  <option key={`walkin-profile-college-${college.college_id}`} value={college.college_id}>
                                    {college.college_name}
                                  </option>
                                ))}
                              </select>
                            ) : (selectedWalkinProfile.college_name || "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">BDE</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <select
                                value={walkinProfileForm.bdeName || String(selectedWalkinProfile.bde_name || "")}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, bdeName: event.target.value }))}
                              >
                                <option value="">Select BDE</option>
                                {selectedWalkinProfile.bde_name &&
                                  !bdeOptions.some(
                                    (bde) => String(bde.bde_name || "") === String(selectedWalkinProfile.bde_name || "")
                                  ) && (
                                    <option value={String(selectedWalkinProfile.bde_name || "")}>
                                      {selectedWalkinProfile.bde_name}
                                    </option>
                                  )}
                                {bdeOptions.map((bde) => (
                                  <option key={`walkin-profile-bde-${bde.bde_id || bde.bde_name}`} value={bde.bde_name}>
                                    {bde.bde_name}
                                  </option>
                                ))}
                              </select>
                            ) : (selectedWalkinProfile.bde_name || "--")}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Password</span>
                          <span className="profile-value">
                            {walkinProfileEditMode ? (
                              <input
                                type="text"
                                value={walkinProfileForm.password}
                                onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, password: event.target.value }))}
                              />
                            ) : selectedWalkinProfile.password ? (
                              <button
                                type="button"
                                className="password-toggle"
                                onClick={() => toggleWalkinPassword(selectedWalkinProfile.student_id)}
                              >
                                <span className="password-mask">
                                  {revealedPasswords[selectedWalkinProfile.student_id]
                                    ? selectedWalkinProfile.password
                                    : "********"}
                                </span>
                                <span className="password-label">
                                  {revealedPasswords[selectedWalkinProfile.student_id] ? "Hide" : "Show"}
                                </span>
                              </button>
                            ) : (
                              "Not set"
                            )}
                          </span>
                        </div>
                        <div className="profile-item">
                          <span className="profile-label">Status</span>
                          <span className="profile-value">
                            <span className={"status-badge " + String(selectedWalkinProfile.student_status || "ACTIVE").trim().toLowerCase()}>
                              {String(selectedWalkinProfile.student_status || "ACTIVE").trim().toUpperCase()}
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="admin-confirm-actions">
                        {walkinProfileEditMode ? (
                          <>
                            <button
                              type="button"
                              className="secondary-btn"
                              disabled={walkinProfileSaving}
                              onClick={() => {
                                setWalkinProfileEditMode(false);
                                setWalkinProfileEditStatus("");
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="status-action"
                              disabled={walkinProfileSaving}
                              onClick={handleWalkinProfileSave}
                            >
                              {walkinProfileSaving ? "Saving..." : "Save Changes"}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                              setWalkinProfileEditMode(true);
                              setWalkinProfileEditStatus("");
                            }}
                          >
                            Edit Profile
                          </button>
                        )}
                        <button
                          type="button"
                          className="status-action"
                          disabled={Boolean(walkinStatusUpdating[selectedWalkinProfile.student_id]) || walkinProfileSaving}
                          onClick={async () => {
                            const currentStatus = String(selectedWalkinProfile.student_status || "ACTIVE").trim().toUpperCase();
                            await handleWalkinStatusToggle(selectedWalkinProfile.student_id, currentStatus);
                            setSelectedWalkinProfile((prev) => {
                              if (!prev) return prev;
                              const nextStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
                              return { ...prev, student_status: nextStatus };
                            });
                          }}
                        >
                          {walkinStatusUpdating[selectedWalkinProfile.student_id]
                            ? "Updating..."
                            : String(selectedWalkinProfile.student_status || "ACTIVE").trim().toUpperCase() === "ACTIVE"
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
              )}

              {activeSection === "regular" && (
              <>
                <div
                  className={`dashboard-section admin-section create-panel ${regularCreateOpen ? "is-open" : "is-collapsed"}`}
                  id="regular-create"
                >
                  <div className="create-panel-header">
                    <h2>Create Regular Student Account</h2>
                    <button
                      type="button"
                      className="small-outline-btn create-panel-toggle"
                      onClick={() => {
                        setRegularCreateOpen((prev) => !prev);
                        setRegularCreateMode("manual");
                      }}
                      aria-expanded={regularCreateOpen}
                      aria-controls="regular-create-form"
                    >
                      {regularCreateOpen ? "Close" : "Create"}
                    </button>
                  </div>
                  {regularCreateOpen && (
                  <>
                  <div className="regular-create-mode-switch">
                    <button
                      type="button"
                      className={`regular-create-mode-btn ${regularCreateMode === "manual" ? "active" : ""}`}
                      onClick={() => setRegularCreateMode("manual")}
                    >
                      Manual Registration
                    </button>
                    <button
                      type="button"
                      className={`regular-create-mode-btn ${regularCreateMode === "bulk" ? "active" : ""}`}
                      onClick={() => setRegularCreateMode("bulk")}
                    >
                      Bulk Registration
                    </button>
                  </div>

                  {regularCreateMode === "manual" && (
                    <div className="regular-create-mode-panel">
                      <div className="regular-create-mode-head">
                        <h3>Manual Registration</h3>
                        <p>Create one regular student account at a time.</p>
                      </div>
                      <form
                        id="regular-create-form"
                        className="form-row form-row-wide"
                        autoComplete="off"
                        onSubmit={handleRegularCreation}
                      >
                        <div className="form-field">
                          <label>Full Name</label>
                          <input
                            type="text"
                            name="regular_full_name_input"
                            autoComplete="new-password"
                            placeholder="Enter full name"
                            value={regularForm.name}
                            onChange={(event) => setRegularForm({ ...regularForm, name: event.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label>College</label>
                          <select
                            value={regularForm.collegeId}
                            onChange={(event) => setRegularForm({ ...regularForm, collegeId: event.target.value })}
                            required
                          >
                            <option value="">Select college</option>
                            {collegeOptionsSortedByName.map((college) => (
                              <option key={college.college_id} value={college.college_id}>
                                {college.college_name}
                              </option>
                            ))}
                          </select>
                          {collegeError && (
                            <p className="auth-help" style={{ color: "#f8c7c7" }}>
                              {collegeError}
                            </p>
                          )}
                        </div>
                        <div className="form-field">
                          <label>Email</label>
                          <input
                            type="email"
                            name="regular_email_input"
                            placeholder="Enter email"
                            autoComplete="new-password"
                            value={regularForm.email}
                            onChange={(event) => setRegularForm({ ...regularForm, email: event.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label>Phone Number</label>
                          <input
                            type="text"
                            name="regular_phone_input"
                            autoComplete="new-password"
                            placeholder="Enter contact number"
                            value={regularForm.phone}
                            onChange={(event) => setRegularForm({ ...regularForm, phone: event.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label>Date of Birth</label>
                          <input
                            type="date"
                            name="regular_dob_input"
                            autoComplete="off"
                            value={regularForm.dob}
                            onChange={(event) => setRegularForm({ ...regularForm, dob: event.target.value })}
                          />
                        </div>
                        <div className="form-field">
                          <label>Background</label>
                          <select
                            value={regularForm.background}
                            onChange={(event) =>
                              setRegularForm({
                                ...regularForm,
                                background: event.target.value,
                                course: ""
                              })
                            }
                          >
                            <option value="">Select Background</option>
                            <option value="TECH">TECH</option>
                            <option value="NON_TECH">NON_TECH</option>
                          </select>
                        </div>
                        <div className="form-field">
                          <label>Course</label>
                          <select
                            value={regularForm.course}
                            onChange={(event) => setRegularForm({ ...regularForm, course: event.target.value })}
                            disabled={!regularForm.background}
                          >
                            <option value="">{regularForm.background ? "Select Course" : "Select Background First"}</option>
                            {getRegularCoursesByBackground(regularForm.background).map((course) => (
                              <option key={course} value={course}>
                                {course}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-field">
                          <label>Password</label>
                          <input
                            type="password"
                            name="regular_password_input"
                            placeholder="Set password"
                            autoComplete="new-password"
                            value={regularForm.password}
                            onChange={(event) => setRegularForm({ ...regularForm, password: event.target.value })}
                          />
                        </div>
                        <button type="submit" disabled={regularCreateSubmitting}>
                          {regularCreateSubmitting ? "Creating..." : "Create Regular Account"}
                        </button>
                      </form>
                    </div>
                  )}

                  {regularCreateMode === "bulk" && (
                    <div className="regular-create-mode-panel regular-bulk-panel">
                      <div className="regular-bulk-head">
                        <div>
                          <h3>Bulk Registration</h3>
                          <p>
                            Use one XLSX file per college. Select the college here, download the template,
                            fill the required student columns, and upload the file.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="small-outline-btn"
                          onClick={handleDownloadRegularBulkTemplate}
                        >
                          Download Template
                        </button>
                      </div>

                      <form className="regular-bulk-form" onSubmit={handleRegularBulkUpload}>
                        <div className="form-field">
                          <label>College for This Upload</label>
                          <select
                            value={regularBulkCollegeId}
                            onChange={(event) => setRegularBulkCollegeId(event.target.value)}
                            required
                          >
                            <option value="">Select college</option>
                            {collegeOptionsSortedByName.map((college) => (
                              <option key={`regular-bulk-college-${college.college_id}`} value={college.college_id}>
                                {college.college_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="form-field">
                          <label>XLSX File</label>
                          <input
                            ref={regularBulkFileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleRegularBulkFileChange}
                          />
                        </div>

                        <div className="regular-bulk-actions">
                          <button
                            type="button"
                            className="small-outline-btn"
                            onClick={clearRegularBulkUpload}
                            disabled={regularBulkSubmitting}
                          >
                            Clear File
                          </button>
                          <button type="submit" disabled={regularBulkSubmitting}>
                            {regularBulkSubmitting ? "Registering..." : "Start Bulk Registration"}
                          </button>
                        </div>
                      </form>

                      <div className="regular-bulk-meta">
                        <span>Required columns: {REGULAR_BULK_TEMPLATE_COLUMNS.join(", ")}</span>
                        <span>Selected file: {regularBulkFileName || "--"}</span>
                        <span>Loaded rows: {regularBulkRows.length}</span>
                      </div>

                      {regularBulkStatus && (
                        <p className="auth-help" style={{ marginTop: 10 }}>
                          {regularBulkStatus}
                        </p>
                      )}

                      {regularBulkResult && (
                        <div className="regular-bulk-result">
                          <div className="regular-bulk-summary-grid">
                            <div className="regular-bulk-summary-card">
                              <span>College</span>
                              <strong>{regularBulkResult.collegeName || "--"}</strong>
                            </div>
                            <div className="regular-bulk-summary-card">
                              <span>Registered</span>
                              <strong>{Number(regularBulkResult.registeredCount || 0)}</strong>
                            </div>
                            <div className="regular-bulk-summary-card">
                              <span>Failed</span>
                              <strong>{Number(regularBulkResult.failedCount || 0)}</strong>
                            </div>
                          </div>

                          {Array.isArray(regularBulkResult.failedStudents) && regularBulkResult.failedStudents.length > 0 && (
                            <div className="regular-bulk-failure-shell">
                              <h4>Failed Registrations</h4>
                              <div className="table-shell">
                                <table className="sticky-table regular-bulk-failure-table">
                                  <thead>
                                    <tr>
                                      <th>Row</th>
                                      <th>Name</th>
                                      <th>Email</th>
                                      <th>Phone</th>
                                      <th>DOB</th>
                                      <th>Course</th>
                                      <th>Issue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {regularBulkResult.failedStudents.map((student) => (
                                      <tr key={`regular-bulk-failure-${student.rowNumber}-${student.email || student.name}`}>
                                        <td>{student.rowNumber || "--"}</td>
                                        <td>{student.name || "--"}</td>
                                        <td>{student.email || "--"}</td>
                                        <td>{student.phone || "--"}</td>
                                        <td>{student.dob || "--"}</td>
                                        <td>{student.course || "--"}</td>
                                        <td>{student.reason || "Registration failed"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  </>
                  )}
                  {regularStatus && (
                    <p className="auth-help" style={{ marginTop: 10 }}>
                      {regularStatus}
                      {regularCredentials && (
                        <span>
                          <br />
                          ID: <strong>{regularCredentials.studentId}</strong>
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="dashboard-section admin-section" id="regular-list">
                  <div className="walkin-list-head">
                    {!selectedRegularProfile && <h2>Regular Students</h2>}
                    {selectedRegularProfile && (
                      <button
                        type="button"
                        className="secondary-btn walkin-profile-back-btn"
                        onClick={() => setSelectedRegularProfile(null)}
                      >
                        Back
                      </button>
                    )}
                  </div>
                  {!selectedRegularProfile && (
                    <>
                  <div className="table-toolbar table-toolbar-upgraded">
                    <div className="table-toolbar-head">
                      <span className="table-toolbar-title">Regular Students</span>
                      <span className="table-toolbar-meta">{filteredRegularStudents.length} matches</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search by id, name, email"
                      value={regularStudentsSearch}
                      onChange={(event) => setRegularStudentsSearch(event.target.value)}
                    />
                    <select
                      value={regularStudentsCourseFilter}
                      onChange={(event) => setRegularStudentsCourseFilter(event.target.value)}
                    >
                      <option value="ALL">All Courses</option>
                      {REGULAR_COURSES.map((course) => (
                        <option key={`rs-course-${course}`} value={course}>
                          {course}
                        </option>
                      ))}
                    </select>
                  </div>
                  {filteredRegularStudents.length === 0 ? (
                    <div className="table-shell">
                      <table className="sticky-table">
                        <thead>
                          <tr>
                            <th>S.No</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Specialization</th>
                            <th>Background</th>
                            <th>Status</th>
                            <th>View Profile</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td colSpan="7" className="table-empty-cell">No regular students found</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="student-date-groups">
                      {regularStudentDateGroups.map((group) => (
                        <div className="student-date-group" key={`regular-group-${group.dateKey}`}>
                          <div className="student-date-heading">
                            <span className="student-date-row-label">{formatRegistrationDateLabel(group.dateKey)}</span>
                            <span className="student-date-row-count">{group.students.length} registered</span>
                          </div>
                          <div className="table-shell">
                            <table className="sticky-table">
                              <thead>
                                <tr>
                                  <th>S.No</th>
                                  <th>Name</th>
                                  <th>Email</th>
                                  <th>Specialization</th>
                                  <th>Background</th>
                                  <th>Status</th>
                                  <th>View Profile</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.students.map((student, index) => {
                                  const statusLabel = String(student.student_status || "ACTIVE").trim().toUpperCase();
                                  return (
                                    <tr
                                      key={student.student_id}
                                      className={statusLabel === "INACTIVE" ? "student-row-inactive" : ""}
                                    >
                                      <td>{index + 1}</td>
                                      <td>{student.name}</td>
                                      <td>{student.email_id}</td>
                                      <td>{student.course}</td>
                                      <td>{String(student.background_type || "").trim().toUpperCase() || getRegularBackgroundType(student.course) || "--"}</td>
                                      <td>
                                        <span className={"status-badge " + statusLabel.toLowerCase()}>
                                          {statusLabel}
                                        </span>
                                      </td>
                                      <td>
                                        <button
                                          type="button"
                                          className="secondary-btn"
                                          onClick={() => {
                                            setSelectedRegularProfile(student);
                                          }}
                                        >
                                          View Profile
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                    </>
                  )}
                  {selectedRegularProfile && (
                    <div className="dashboard-section admin-section profile-section walkin-inline-profile">
                      <h2>{`${selectedRegularProfile.name || "Student"} Profile`}</h2>
                      <div className="profile-grid">
                        <div className="profile-item"><span className="profile-label">Student ID</span><span className="profile-value">{selectedRegularProfile.student_id || "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Name</span><span className="profile-value">{selectedRegularProfile.name || "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Email</span><span className="profile-value">{selectedRegularProfile.email_id || "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Contact</span><span className="profile-value">{selectedRegularProfile.contact_number || "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">DOB</span><span className="profile-value">{selectedRegularProfile.dob ? new Date(selectedRegularProfile.dob).toLocaleDateString() : "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Registered On</span><span className="profile-value">{selectedRegularProfile.created_at ? formatIST24(selectedRegularProfile.created_at) : "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Specialization</span><span className="profile-value">{selectedRegularProfile.course || "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Background</span><span className="profile-value">{String(selectedRegularProfile.background_type || "").trim().toUpperCase() || getRegularBackgroundType(selectedRegularProfile.course) || "--"}</span></div>
                        <div className="profile-item"><span className="profile-label">Status</span><span className="profile-value"><span className={"status-badge " + String(selectedRegularProfile.student_status || "ACTIVE").trim().toLowerCase()}>{String(selectedRegularProfile.student_status || "ACTIVE").trim().toUpperCase()}</span></span></div>
                      </div>
                    </div>
                  )}
                </div>
              </>
              )}

              {activeSection === "students" && (
              <div className="dashboard-section admin-section" id="admin-students">
                <h2>Student Profiles</h2>
                {!selectedWalkinProfile && (
                  <>
                <div className="table-toolbar table-toolbar-upgraded">
                  <div className="table-toolbar-head">
                    <span className="table-toolbar-title">Student Profiles</span>
                    <span className="table-toolbar-meta">{filteredStudentProfiles.length} matches</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Search by id, name, email"
                    value={studentProfilesSearch}
                    onChange={(event) => setStudentProfilesSearch(event.target.value)}
                  />
                  <select
                    value={studentProfilesTypeFilter}
                    onChange={(event) => setStudentProfilesTypeFilter(event.target.value)}
                  >
                    <option value="ALL">All Types</option>
                    <option value="REGULAR">Regular</option>
                    <option value="WALKIN">Walk-In</option>
                  </select>
                  <select
                    value={studentProfilesCourseFilter}
                    onChange={(event) => setStudentProfilesCourseFilter(event.target.value)}
                  >
                    <option value="ALL">All Courses</option>
                    {studentProfileCourseOptions.map((course) => (
                      <option key={`sp-course-${course}`} value={course}>
                        {course}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="table-shell">
                <table className="sticky-table">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Student ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Course</th>
                      <th>Student Type</th>
                      <th>View Profile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudentProfiles.length === 0 && (
                      <tr>
                        <td colSpan="7" className="table-empty-cell">No students found</td>
                      </tr>
                    )}
                    {filteredStudentProfiles.map((student, index) => (
                      <tr
                        key={student.student_id}
                        className={String(student.student_status || "").toUpperCase() === "INACTIVE" ? "student-row-inactive" : ""}
                      >
                        <td>{index + 1}</td>
                        <td>{student.student_id}</td>
                        <td>{student.name}</td>
                        <td>{student.email_id}</td>
                        <td>{student.course}</td>
                        <td>
                          <span className={`status-${student.student_type === "WALKIN" ? "active" : "inactive"}`}>
                            {student.student_type}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                              setSelectedWalkinProfile(student);
                              setWalkinProfileEditMode(false);
                              setWalkinProfileEditStatus("");
                            }}
                          >
                            View Profile
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                  </>
                )}
                {selectedWalkinProfile && (
                  <div className={`dashboard-section admin-section profile-section walkin-inline-profile ${walkinProfileEditMode ? "edit-mode" : ""}`}>
                    <div className="walkin-list-head">
                      <h2>{`${selectedWalkinProfile.name || "Student"} Profile`}</h2>
                      <button
                        type="button"
                        className="secondary-btn walkin-profile-back-btn"
                        onClick={() => {
                          setSelectedWalkinProfile(null);
                          setWalkinProfileEditMode(false);
                          setWalkinProfileEditStatus("");
                        }}
                      >
                        Back
                      </button>
                    </div>
                    {walkinProfileEditStatus && <p className="auth-help">{walkinProfileEditStatus}</p>}
                    <div className="profile-grid">
                      <div className="profile-item"><span className="profile-label">Student ID</span><span className="profile-value">{selectedWalkinProfile.student_id || "--"}</span></div>
                      <div className="profile-item">
                        <span className="profile-label">Name</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <input
                              type="text"
                              value={walkinProfileForm.name}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, name: event.target.value }))}
                            />
                          ) : (selectedWalkinProfile.name || "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Email</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <input
                              type="email"
                              value={walkinProfileForm.email}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, email: event.target.value }))}
                            />
                          ) : (selectedWalkinProfile.email_id || "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Contact</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={10}
                              value={walkinProfileForm.contact}
                              onChange={(event) =>
                                setWalkinProfileForm((prev) => ({
                                  ...prev,
                                  contact: String(event.target.value || "").replace(/\D/g, "").slice(0, 10)
                                }))
                              }
                            />
                          ) : (selectedWalkinProfile.contact_number || "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">DOB</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <input
                              type="date"
                              value={walkinProfileForm.dob}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, dob: event.target.value }))}
                            />
                          ) : (selectedWalkinProfile.dob ? new Date(selectedWalkinProfile.dob).toLocaleDateString() : "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Registered On</span>
                        <span className="profile-value">{selectedWalkinProfile.created_at ? formatIST24(selectedWalkinProfile.created_at) : "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Stream</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <select
                              value={walkinProfileForm.stream}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, stream: event.target.value }))}
                            >
                              <option value="">Select Stream</option>
                              {WALKIN_STREAMS.map((stream) => (
                                <option key={`walkin-profile-stream-${stream}`} value={stream}>
                                  {stream}
                                </option>
                              ))}
                            </select>
                          ) : (selectedWalkinProfile.course || "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">College</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <select
                              value={walkinProfileForm.collegeId || String(selectedWalkinProfile.college_id || "")}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, collegeId: event.target.value }))}
                            >
                              <option value="">Select College</option>
                              {selectedWalkinProfile.college_id &&
                                !collegeOptionsSortedByName.some(
                                  (college) => String(college.college_id) === String(selectedWalkinProfile.college_id)
                                ) && (
                                  <option value={String(selectedWalkinProfile.college_id)}>
                                    {selectedWalkinProfile.college_name || `College ${selectedWalkinProfile.college_id}`}
                                  </option>
                                )}
                              {collegeOptionsSortedByName.map((college) => (
                                <option key={`walkin-profile-college-${college.college_id}`} value={college.college_id}>
                                  {college.college_name}
                                </option>
                              ))}
                            </select>
                          ) : (selectedWalkinProfile.college_name || "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">BDE</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <select
                              value={walkinProfileForm.bdeName || String(selectedWalkinProfile.bde_name || "")}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, bdeName: event.target.value }))}
                            >
                              <option value="">Select BDE</option>
                              {selectedWalkinProfile.bde_name &&
                                !bdeOptions.some(
                                  (bde) => String(bde.bde_name || "") === String(selectedWalkinProfile.bde_name || "")
                                ) && (
                                  <option value={String(selectedWalkinProfile.bde_name || "")}>
                                    {selectedWalkinProfile.bde_name}
                                  </option>
                                )}
                              {bdeOptions.map((bde) => (
                                <option key={`walkin-profile-bde-${bde.bde_id || bde.bde_name}`} value={bde.bde_name}>
                                  {bde.bde_name}
                                </option>
                              ))}
                            </select>
                          ) : (selectedWalkinProfile.bde_name || "--")}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Password</span>
                        <span className="profile-value">
                          {walkinProfileEditMode ? (
                            <input
                              type="text"
                              value={walkinProfileForm.password}
                              onChange={(event) => setWalkinProfileForm((prev) => ({ ...prev, password: event.target.value }))}
                            />
                          ) : selectedWalkinProfile.password ? (
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => toggleWalkinPassword(selectedWalkinProfile.student_id)}
                            >
                              <span className="password-mask">
                                {revealedPasswords[selectedWalkinProfile.student_id]
                                  ? selectedWalkinProfile.password
                                  : "********"}
                              </span>
                              <span className="password-label">
                                {revealedPasswords[selectedWalkinProfile.student_id] ? "Hide" : "Show"}
                              </span>
                            </button>
                          ) : (
                            "Not set"
                          )}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Status</span>
                        <span className="profile-value">
                          <span className={"status-badge " + String(selectedWalkinProfile.student_status || "ACTIVE").trim().toLowerCase()}>
                            {String(selectedWalkinProfile.student_status || "ACTIVE").trim().toUpperCase()}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="admin-confirm-actions">
                      {walkinProfileEditMode ? (
                        <>
                          <button
                            type="button"
                            className="secondary-btn"
                            disabled={walkinProfileSaving}
                            onClick={() => {
                              setWalkinProfileEditMode(false);
                              setWalkinProfileEditStatus("");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="status-action"
                            disabled={walkinProfileSaving}
                            onClick={handleWalkinProfileSave}
                          >
                            {walkinProfileSaving ? "Saving..." : "Save Changes"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => {
                            setWalkinProfileEditMode(true);
                            setWalkinProfileEditStatus("");
                          }}
                        >
                          Edit Profile
                        </button>
                      )}
                      <button
                        type="button"
                        className="status-action"
                        disabled={Boolean(walkinStatusUpdating[selectedWalkinProfile.student_id]) || walkinProfileSaving}
                        onClick={async () => {
                          const currentStatus = String(selectedWalkinProfile.student_status || "ACTIVE").trim().toUpperCase();
                          await handleWalkinStatusToggle(selectedWalkinProfile.student_id, currentStatus);
                          setSelectedWalkinProfile((prev) => {
                            if (!prev) return prev;
                            const nextStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
                            return { ...prev, student_status: nextStatus };
                          });
                        }}
                      >
                        {walkinStatusUpdating[selectedWalkinProfile.student_id]
                          ? "Updating..."
                          : String(selectedWalkinProfile.student_status || "ACTIVE").trim().toUpperCase() === "ACTIVE"
                            ? "Deactivate"
                            : "Activate"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}

              {activeSection === "colleges" && (
                <div className="dashboard-section admin-section" id="admin-colleges">
                  <h2>Colleges</h2>
                  {collegeActionStatus && <p className="section-placeholder">{collegeActionStatus}</p>}
                  {collegeListError && <p className="auth-help">{collegeListError}</p>}
                  {collegeListLoading && renderTableSkeleton(5)}
                  {!collegeListLoading && (
                    <div className="table-shell" aria-label="Colleges table container">
                      <table className="sticky-table" aria-label="Colleges table">
                        <thead>
                          <tr>
                            <th>S.No</th>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {collegeListSortedByName.length === 0 && (
                            <tr>
                              <td colSpan="4" style={{ textAlign: "center" }}>No colleges found</td>
                            </tr>
                          )}
                          {collegeListSortedByName.map((college, index) => (
                              <tr key={`college-${college.college_id}`}>
                                <td>{index + 1}</td>
                                <td>{college.college_id}</td>
                                <td>
                                  {editingCollegeId === college.college_id ? (
                                    <input
                                      type="text"
                                      value={editingCollegeName}
                                      onChange={(event) => setEditingCollegeName(event.target.value)}
                                      className="college-inline-input"
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          handleUpdateCollege(college.college_id);
                                        }
                                      }}
                                    />
                                  ) : (
                                    college.college_name
                                  )}
                                </td>
                                <td>
                                  {editingCollegeId === college.college_id ? (
                                    <div className="college-actions">
                                      <button
                                        type="button"
                                        className="secondary-btn"
                                        onClick={() => handleUpdateCollege(college.college_id)}
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary-btn"
                                        onClick={cancelCollegeRename}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className="secondary-btn"
                                      onClick={() => startCollegeRename(college)}
                                    >
                                      Rename
                                    </button>
                                  )}
                                </td>
                              </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <form className="form-row form-row-wide college-add-form" onSubmit={handleCreateCollege}>
                    <div className="field-block">
                      <input
                        id="newCollegeName"
                        type="text"
                        aria-label="College name"
                        placeholder="Enter college name"
                        value={newCollegeName}
                        onChange={(event) => setNewCollegeName(event.target.value)}
                        disabled={editingCollegeId !== null}
                      />
                    </div>
                    <button
                      type="submit"
                      className="college-add-btn"
                      disabled={editingCollegeId !== null || collegeCreateSubmitting}
                    >
                      {collegeCreateSubmitting ? "Adding..." : "Add College"}
                    </button>
                  </form>
                </div>
              )}
              {activeSection === "business-executives" && (
              <>
                <div className="dashboard-section admin-section" id="admin-business-executives-create">
                  <h2>Our Business Executives</h2>
                  <form className="form-row form-row-wide" autoComplete="off" onSubmit={handleCreateBde}>
                    <input
                      type="text"
                      name="bde_fake_user"
                      autoComplete="username"
                      tabIndex={-1}
                      aria-hidden="true"
                      style={{ position: "absolute", left: "-9999px", opacity: 0, pointerEvents: "none" }}
                    />
                    <input
                      type="password"
                      name="bde_fake_pass"
                      autoComplete="current-password"
                      tabIndex={-1}
                      aria-hidden="true"
                      style={{ position: "absolute", left: "-9999px", opacity: 0, pointerEvents: "none" }}
                    />
                    <div className="field-block">
                      <input
                        type="text"
                        name="bde_name_input"
                        autoComplete="off"
                        aria-label="BDE Name"
                        placeholder="Enter BDE name"
                        value={newBdeForm.bdeName}
                        readOnly={!allowBdeManualInput}
                        onMouseDown={() => setAllowBdeManualInput(true)}
                        onFocus={() => setAllowBdeManualInput(true)}
                        onChange={(event) => setNewBdeForm({ ...newBdeForm, bdeName: event.target.value })}
                      />
                    </div>
                    <div className="field-block">
                      <input
                        type="text"
                        name="bde_phone_input"
                        autoComplete="off"
                        aria-label="BDE Phone Number"
                        placeholder="Enter BDE phone number"
                        value={newBdeForm.phoneNumber}
                        inputMode="numeric"
                        maxLength={10}
                        readOnly={!allowBdeManualInput}
                        onMouseDown={() => setAllowBdeManualInput(true)}
                        onFocus={() => setAllowBdeManualInput(true)}
                        onChange={(event) => {
                          const digits = String(event.target.value || "").replace(/\D/g, "").slice(0, 10);
                          setNewBdeForm({ ...newBdeForm, phoneNumber: digits });
                        }}
                      />
                    </div>
                    <div className="field-block">
                      <input
                        type="email"
                        name="bde_email_input"
                        autoComplete="new-password"
                        aria-label="BDE Email"
                        placeholder="Enter BDE email"
                        value={newBdeForm.email}
                        readOnly={!allowBdeManualInput}
                        onMouseDown={() => setAllowBdeManualInput(true)}
                        onFocus={() => setAllowBdeManualInput(true)}
                        onChange={(event) => setNewBdeForm({ ...newBdeForm, email: event.target.value })}
                      />
                    </div>
                    <div className="field-block">
                      <input
                        type="password"
                        name="bde_password_input"
                        autoComplete="new-password"
                        aria-label="BDE Password"
                        placeholder="Enter BDE password"
                        value={newBdeForm.password}
                        readOnly={!allowBdeManualInput}
                        onMouseDown={() => setAllowBdeManualInput(true)}
                        onFocus={() => setAllowBdeManualInput(true)}
                        onChange={(event) => setNewBdeForm({ ...newBdeForm, password: event.target.value })}
                      />
                    </div>
                    <button type="submit" disabled={bdeCreateSubmitting}>
                      {bdeCreateSubmitting ? "Creating..." : "Create BDE"}
                    </button>
                  </form>
                  {bdeActionStatus && <p className="section-placeholder">{bdeActionStatus}</p>}
                  {bdeError && <p className="auth-help">{bdeError}</p>}
                </div>

                <div className="dashboard-section admin-section" id="admin-business-executives-list">
                  <h2>BDE Accounts</h2>
                  <div className="table-toolbar table-toolbar-upgraded">
                    <div className="table-toolbar-head">
                      <span className="table-toolbar-title">BDE Accounts</span>
                      <span className="table-toolbar-meta">{filteredBdeSummaryRows.length} matches</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search by BDE name, email, phone"
                      value={bdeAccountsSearch}
                      onChange={(event) => setBdeAccountsSearch(event.target.value)}
                    />
                  </div>
                  <div className="table-shell">
                    <table className="sticky-table">
                      <thead>
                        <tr>
                          <th>BDE Name</th>
                          <th>Phone</th>
                          <th>Email</th>
                          <th>Password</th>
                          <th>Total Students</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBdeSummaryRows.length === 0 && (
                          <tr>
                            <td colSpan="5" className="table-empty-cell">No BDE accounts found</td>
                          </tr>
                        )}
                        {filteredBdeSummaryRows.map((row) => (
                          <tr key={`bde-row-${row.bde_name}-${row.email_id}`}>
                            <td>{row.bde_name || "--"}</td>
                            <td>{row.phone_number || "--"}</td>
                            <td>{row.email_id || "--"}</td>
                            <td>
                              {row.password && row.password !== "--" ? (
                                <button
                                  type="button"
                                  className="password-toggle"
                                  onClick={() => toggleBdePassword(row.bde_id || row.email_id)}
                                >
                                  <span className="password-mask">
                                    {revealedBdePasswords[row.bde_id || row.email_id]
                                      ? row.password
                                      : "********"}
                                  </span>
                                  <span className="password-label">
                                    {revealedBdePasswords[row.bde_id || row.email_id] ? "Hide" : "Show"}
                                  </span>
                                </button>
                              ) : (
                                "--"
                              )}
                            </td>
                            <td>{row.student_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="dashboard-section admin-section" id="admin-business-executives-students">
                  <h2>BDE Students List</h2>
                  <div className="table-toolbar table-toolbar-upgraded">
                    <div className="table-toolbar-head">
                      <span className="table-toolbar-title">BDE Mapping</span>
                      <span className="table-toolbar-meta">{filteredBdeStudentRows.length} matches</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search by id, name, email"
                      value={bdeStudentsSearch}
                      onChange={(event) => setBdeStudentsSearch(event.target.value)}
                    />
                    <select
                      value={bdeStudentsBdeFilter}
                      onChange={(event) => setBdeStudentsBdeFilter(event.target.value)}
                    >
                      <option value="ALL">All BDEs</option>
                      {bdeStudentNameOptions.map((name) => (
                        <option key={`bde-student-name-${name}`} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bdeStudentsCourseFilter}
                      onChange={(event) => setBdeStudentsCourseFilter(event.target.value)}
                    >
                      <option value="ALL">All Courses/Streams</option>
                      {bdeStudentCourseOptions.map((course) => (
                        <option key={`bde-student-course-${course}`} value={course}>
                          {course}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bdeStudentsStatusFilter}
                      onChange={(event) => setBdeStudentsStatusFilter(event.target.value)}
                    >
                      <option value="ALL">All Status</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  </div>
                  <div className="table-shell">
                    <table className="sticky-table">
                      <thead>
                        <tr>
                          <th>Student ID</th>
                          <th>Student Name</th>
                          <th>Email</th>
                          <th>Course/Stream</th>
                          <th>Status</th>
                          <th>BDE Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBdeStudentRows.length === 0 && (
                          <tr>
                            <td colSpan="6" className="table-empty-cell">No students mapped to BDE yet</td>
                          </tr>
                        )}
                        {filteredBdeStudentRows.map((row) => (
                          <tr key={`bde-student-${row.student_id}`}>
                            <td>{row.student_id}</td>
                            <td>{row.name}</td>
                            <td>{row.email_id}</td>
                            <td>{row.course || "--"}</td>
                            <td>{row.student_status || "--"}</td>
                            <td>{row.bde_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
              )}

              {activeSection === "create-exam" && (
              <div className="dashboard-section admin-section" id="admin-exams">
                <h2>Regular Exam Schedule</h2>
                <div>
                  <h3>Update Schedule</h3>
                  <p className="section-placeholder">
                    Schedule one regular exam for all regular-course students in the selected college. Course selection is not required here.
                  </p>
                  <form className="form-row schedule-form" onSubmit={handleCreateExam}>
                    <div className="form-field">
                      <label htmlFor="regular-exam-college">College</label>
                      <select
                        id="regular-exam-college"
                        value={scheduleCollegeId}
                        onChange={(event) => setScheduleCollegeId(event.target.value)}
                      >
                        <option value="">Select college</option>
                        {collegeOptionsSortedByName.map((college) => (
                          <option key={`regular-exam-college-${college.college_id}`} value={college.college_id}>
                            {college.college_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label htmlFor="regular-exam-start-date">Start Date</label>
                      <input
                        id="regular-exam-start-date"
                        type="date"
                        value={scheduleStartDate}
                        onChange={(event) => setScheduleStartDate(event.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="regular-exam-start-time">Start Time</label>
                      <input
                        id="regular-exam-start-time"
                        type="time"
                        value={scheduleStartTime}
                        onChange={(event) => setScheduleStartTime(event.target.value)}
                      />
                    </div>

                    <button type="submit" className="schedule-generate-btn" disabled={examCreateSubmitting}>
                      {examCreateSubmitting ? "Saving..." : (editingExamId ? "Update Schedule" : "Save Schedule")}
                    </button>
                    {editingExamId && (
                      <button type="button" className="secondary-btn" onClick={handleCancelExamEdit}>
                        Cancel Edit
                      </button>
                    )}
                  </form>
                  {examScheduleStatus && (
                    <p style={{ marginTop: 12, color: "#d6deff" }}>{examScheduleStatus}</p>
                  )}
                </div>
                <div className="form-table-divider" aria-hidden="true" />
                <div style={{ marginTop: 24 }}>
                  <h3>Scheduled Regular Exams</h3>
                  <div className="table-toolbar table-toolbar-upgraded">
                    <div className="table-toolbar-head">
                      <span className="table-toolbar-title">Exams</span>
                      <span className="table-toolbar-meta">{filteredExams.length} matches</span>
                    </div>
                    <input
                      type="text"
                      placeholder="Search by exam id"
                      value={examListSearch}
                      onChange={(event) => setExamListSearch(event.target.value)}
                    />
                  </div>
                  <div className="table-shell" aria-label="Exams table container">
                  <table className="sticky-table" aria-label="Exams table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>College</th>
                        <th>Status</th>
                        <th>Schedule</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExams.length === 0 && (
                        <tr>
                          <td colSpan="5" className="table-empty-cell">No exams found</td>
                        </tr>
                      )}
                      {filteredExams.map((exam) => (
                        <tr key={exam.exam_id}>
                          <td>{exam.exam_id}</td>
                          <td>{exam.college_name || exam.college_id || "--"}</td>
                          <td>
                            <span className={`status-badge ${normalizeExamStatus(exam.exam_status) === "READY" ? "active" : "inactive"}`}>
                              {normalizeExamStatus(exam.exam_status)}
                            </span>
                          </td>
                          <td>
                            {formatIST24(exam.start_at)}{" "}
                            to{" "}
                            {formatIST24(exam.end_at)}
                          </td>
                          <td>
                            <button className="secondary-btn" onClick={() => handleEditExam(exam)}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
              )}
            </>
          )}
          {showProfile && (
            <div className="dashboard-section admin-section profile-section" id="admin-profile">
              <h2>Admin Profile</h2>
              <div className="profile-grid">
                <div className="profile-item">
                  <span className="profile-label">Admin ID</span>
                  <span className="profile-value">{adminId || "Not available"}</span>
                </div>
                <div className="profile-item">
                  <span className="profile-label">College</span>
                  <span className="profile-value">{collegeName || "Not available"}</span>
                </div>
                <div className="profile-item">
                  <span className="profile-label">Role</span>
                  <span className="profile-value">Administrator</span>
                </div>
              </div>
              <h3>Change Password</h3>
              <form className="form-row form-row-wide" onSubmit={handleChangePasswordSubmit}>
                <div className="profile-item">
                  <span className="profile-label">Account</span>
                  <span className="profile-value">{adminEmail || "Not available"}</span>
                </div>
                <div className="form-field">
                  <label htmlFor="admin-current-password">Current Password</label>
                  <input
                    id="admin-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => handlePasswordFormChange("currentPassword", event.target.value)}
                    disabled={passwordChangeSaving}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="admin-new-password">New Password</label>
                  <input
                    id="admin-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={(event) => handlePasswordFormChange("newPassword", event.target.value)}
                    disabled={passwordChangeSaving}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="admin-confirm-password">Confirm New Password</label>
                  <input
                    id="admin-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={passwordForm.confirmNewPassword}
                    onChange={(event) => handlePasswordFormChange("confirmNewPassword", event.target.value)}
                    disabled={passwordChangeSaving}
                  />
                </div>
                <button type="submit" disabled={passwordChangeSaving}>
                  {passwordChangeSaving ? "Updating..." : "Change Password"}
                </button>
              </form>
              {passwordChangeStatus && <p className="section-placeholder">{passwordChangeStatus}</p>}
            </div>
          )}
          {confirmDialog.open && (
            <div
              className="admin-confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-confirm-title"
              aria-describedby="admin-confirm-message"
              onClick={() => resolveConfirmDialog(false)}
            >
              <div className="admin-confirm-card" onClick={(event) => event.stopPropagation()}>
                <h3 id="admin-confirm-title">{confirmDialog.title}</h3>
                <p id="admin-confirm-message">{confirmDialog.message}</p>
                <div className="admin-confirm-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => resolveConfirmDialog(false)}
                  >
                    {confirmDialog.cancelLabel}
                  </button>
                  <button
                    type="button"
                    className={`admin-confirm-btn ${confirmDialog.tone === "danger" ? "danger" : ""}`}
                    onClick={() => resolveConfirmDialog(true)}
                  >
                    {confirmDialog.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          )}
          {walkinQuestionEditor.open && (
            <div
              className="admin-confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="walkin-edit-title"
              onClick={closeWalkinQuestionEditor}
            >
              <div className="admin-confirm-card walkin-question-editor-card" onClick={(event) => event.stopPropagation()}>
                <h3 id="walkin-edit-title">Edit Walk-In Question</h3>
                <p className="item-meta">
                  {walkinQuestionEditor.category.toUpperCase()} | QID: {walkinQuestionEditor.questionId}
                  {walkinQuestionEditor.stream ? ` | ${walkinQuestionEditor.stream}` : ""}
                </p>
                <div className="walkin-question-editor-grid">
                  <label className="walkin-question-editor-field">
                    <span>Question Text</span>
                    <textarea
                      value={walkinQuestionEditor.questionText}
                      onChange={(event) => handleWalkinQuestionEditorChange("questionText", event.target.value)}
                      rows={4}
                      disabled={walkinQuestionEditSaving}
                    />
                  </label>
                  <label className="walkin-question-editor-field">
                    <span>Marks</span>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={walkinQuestionEditor.marks}
                      onChange={(event) => handleWalkinQuestionEditorChange("marks", event.target.value)}
                      disabled={walkinQuestionEditSaving}
                    />
                  </label>
                  {(walkinQuestionEditor.category === "aptitude" ||
                    String(walkinQuestionEditor.questionType || "").toLowerCase().includes("mcq")) && (
                    <>
                      <label className="walkin-question-editor-field">
                        <span>Option A</span>
                        <input
                          type="text"
                          value={walkinQuestionEditor.optionA}
                          onChange={(event) => handleWalkinQuestionEditorChange("optionA", event.target.value)}
                          disabled={walkinQuestionEditSaving}
                        />
                      </label>
                      <label className="walkin-question-editor-field">
                        <span>Option B</span>
                        <input
                          type="text"
                          value={walkinQuestionEditor.optionB}
                          onChange={(event) => handleWalkinQuestionEditorChange("optionB", event.target.value)}
                          disabled={walkinQuestionEditSaving}
                        />
                      </label>
                      <label className="walkin-question-editor-field">
                        <span>Option C</span>
                        <input
                          type="text"
                          value={walkinQuestionEditor.optionC}
                          onChange={(event) => handleWalkinQuestionEditorChange("optionC", event.target.value)}
                          disabled={walkinQuestionEditSaving}
                        />
                      </label>
                      <label className="walkin-question-editor-field">
                        <span>Option D</span>
                        <input
                          type="text"
                          value={walkinQuestionEditor.optionD}
                          onChange={(event) => handleWalkinQuestionEditorChange("optionD", event.target.value)}
                          disabled={walkinQuestionEditSaving}
                        />
                      </label>
                      <label className="walkin-question-editor-field">
                        <span>Correct Option</span>
                        <select
                          value={walkinQuestionEditor.correctOption}
                          onChange={(event) => handleWalkinQuestionEditorChange("correctOption", event.target.value)}
                          disabled={walkinQuestionEditSaving}
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                      </label>
                    </>
                  )}
                  {walkinQuestionEditor.category === "stream" &&
                    !String(walkinQuestionEditor.questionType || "").toLowerCase().includes("mcq") && (
                      <label className="walkin-question-editor-field">
                        <span>Sample Solution</span>
                        <textarea
                          value={walkinQuestionEditor.descriptiveAnswer}
                          onChange={(event) => handleWalkinQuestionEditorChange("descriptiveAnswer", event.target.value)}
                          rows={4}
                          disabled={walkinQuestionEditSaving}
                        />
                      </label>
                    )}
                </div>
                <div className="admin-confirm-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={closeWalkinQuestionEditor}
                    disabled={walkinQuestionEditSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-confirm-btn"
                    onClick={saveWalkinQuestionEdit}
                    disabled={walkinQuestionEditSaving}
                  >
                    {walkinQuestionEditSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {regularQuestionEditor.open && (
            <div
              className="admin-confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="regular-edit-title"
              onClick={closeRegularQuestionEditor}
            >
              <div className="admin-confirm-card walkin-question-editor-card" onClick={(event) => event.stopPropagation()}>
                <h3 id="regular-edit-title">Edit Regular Question</h3>
                <p className="item-meta">
                  {regularQuestionEditor.category.toUpperCase()} | QID: {regularQuestionEditor.questionId}
                  {regularQuestionEditor.backgroundType ? ` | ${regularQuestionEditor.backgroundType}` : ""}
                  {regularQuestionEditor.sectionName ? ` | ${regularQuestionEditor.sectionName}` : ""}
                </p>
                <div className="walkin-question-editor-grid">
                  <label className="walkin-question-editor-field">
                    <span>Question Text</span>
                    <textarea
                      value={regularQuestionEditor.questionText}
                      onChange={(event) => handleRegularQuestionEditorChange("questionText", event.target.value)}
                      rows={4}
                      disabled={regularQuestionEditSaving}
                    />
                  </label>
                  <label className="walkin-question-editor-field">
                    <span>Option A</span>
                    <input
                      type="text"
                      value={regularQuestionEditor.optionA}
                      onChange={(event) => handleRegularQuestionEditorChange("optionA", event.target.value)}
                      disabled={regularQuestionEditSaving}
                    />
                  </label>
                  <label className="walkin-question-editor-field">
                    <span>Option B</span>
                    <input
                      type="text"
                      value={regularQuestionEditor.optionB}
                      onChange={(event) => handleRegularQuestionEditorChange("optionB", event.target.value)}
                      disabled={regularQuestionEditSaving}
                    />
                  </label>
                  <label className="walkin-question-editor-field">
                    <span>Option C</span>
                    <input
                      type="text"
                      value={regularQuestionEditor.optionC}
                      onChange={(event) => handleRegularQuestionEditorChange("optionC", event.target.value)}
                      disabled={regularQuestionEditSaving}
                    />
                  </label>
                  <label className="walkin-question-editor-field">
                    <span>Option D</span>
                    <input
                      type="text"
                      value={regularQuestionEditor.optionD}
                      onChange={(event) => handleRegularQuestionEditorChange("optionD", event.target.value)}
                      disabled={regularQuestionEditSaving}
                    />
                  </label>
                  <label className="walkin-question-editor-field">
                    <span>Correct Option</span>
                    <select
                      value={regularQuestionEditor.correctOption}
                      onChange={(event) => handleRegularQuestionEditorChange("correctOption", event.target.value)}
                      disabled={regularQuestionEditSaving}
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                    </select>
                  </label>
                </div>
                <div className="admin-confirm-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={closeRegularQuestionEditor}
                    disabled={regularQuestionEditSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-confirm-btn"
                    onClick={saveRegularQuestionEdit}
                    disabled={regularQuestionEditSaving}
                  >
                    {regularQuestionEditSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}
          </section>
        </main>
      </div>
      <footer className="dashboard-footer-pro">
        <div className="dashboard-footer-logo-row">
          <img
            className="dashboard-footer-logo"
            src="/image.png"
            alt="RP2 Rounded Professional Program - Elevating Employability"
          />
        </div>
        <div className="dashboard-footer-divider" />
        <p className="dashboard-footer-copy">© 2026 RP2 Inc. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default AdminDashboard;



