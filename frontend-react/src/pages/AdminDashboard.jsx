import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

const REGULAR_COURSES = [
  "Other Tech",
  "BCA",
  "BSc CS",
  "BSc IT",
  "MCA",
  "MTech IT",
  "MTech CS",
  "BTech CS",
  "Other Non-Tech",
  "BBA",
  "MBA",
  "BSc Physics",
  "MSc Physics",
  "MSc Chemistry",
  "MCom",
  "BCom"
];

const WALKIN_STREAMS = ["Data Science", "Data Analytics", "MERN"]
const WALKIN_OPTION_KEYS = [
  { key: "option_a", label: "A" },
  { key: "option_b", label: "B" },
  { key: "option_c", label: "C" },
  { key: "option_d", label: "D" }
];;

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
  if (["bca", "bsc cs", "bsc it", "mca", "mtech it", "mtech cs", "btech cs"].includes(normalized)) {
    return "TECH";
  }
  if (["bba", "mba", "bsc physics", "msc physics", "msc chemistry", "mcom", "bcom", "bsc phy", "msc phy", "msc che"].includes(normalized)) {
    return "NON_TECH";
  }
  return "";
};

const formatIST24 = (value) => {
  if (!value) return "--";
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

const WALKIN_COURSE_KEYS = new Set(["DS", "DATASCIENCE", "DA", "DATAANALYTICS", "MERN", "FULLSTACK"]);
const isDataAnalyticsStream = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized === "DA" || normalized === "DATAANALYTICS";
};
const getWalkinStreamLabel = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (normalized === "DS" || normalized.includes("DATASCIENCE")) return "Data Science";
  if (normalized === "DA" || normalized.includes("DATAANALYTICS")) return "Data Analytics";
  if (normalized === "MERN" || normalized.includes("FULLSTACK")) return "MERN";
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
  const [thisMonthRegistrations, setThisMonthRegistrations] = useState(0);
  const [registrationMonthOffset, setRegistrationMonthOffset] = useState(0);
  const [registrationTrend, setRegistrationTrend] = useState([]);
  const [regularResultedCount, setRegularResultedCount] = useState(0);
  const [walkinResultedCount, setWalkinResultedCount] = useState(0);
  const [recentResults, setRecentResults] = useState([]);
  const [students, setStudents] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");

  const [cutoff, setCutoff] = useState("");
  const [scheduleStartDate, setScheduleStartDate] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("");

  const [courseSelect, setCourseSelect] = useState("");
  const [customCourse, setCustomCourse] = useState("");
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
  const [regularQuestionCourse, setRegularQuestionCourse] = useState("");
  const [regularQuestionSheetData, setRegularQuestionSheetData] = useState(null);
  const [regularQuestionSheetLoading, setRegularQuestionSheetLoading] = useState(false);
  const [regularQuestionSheetError, setRegularQuestionSheetError] = useState("");
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
  const [walkinResults, setWalkinResults] = useState(null);
  const [walkinResultsLoading, setWalkinResultsLoading] = useState(false);
  const [walkinResultsError, setWalkinResultsError] = useState("");
  const [walkinRecomputeLoading, setWalkinRecomputeLoading] = useState(false);
  const [walkinRecomputeStatus, setWalkinRecomputeStatus] = useState("");
  const [walkinReviewData, setWalkinReviewData] = useState(null);
  const [walkinReviewLoading, setWalkinReviewLoading] = useState(false);
  const [walkinReviewError, setWalkinReviewError] = useState("");
  const [walkinReviewView, setWalkinReviewView] = useState("summary");
  const [walkinResultsSearch, setWalkinResultsSearch] = useState("");
  const [walkinResultsStreamFilter, setWalkinResultsStreamFilter] = useState("ALL");
  const [walkinResultsExamFilter, setWalkinResultsExamFilter] = useState("ALL");
  const [walkinStudentsSearch, setWalkinStudentsSearch] = useState("");
  const [walkinStudentsStreamFilter, setWalkinStudentsStreamFilter] = useState("ALL");
  const [bdeStudentsSearch, setBdeStudentsSearch] = useState("");
  const [bdeStudentsBdeFilter, setBdeStudentsBdeFilter] = useState("ALL");
  const [bdeStudentsCourseFilter, setBdeStudentsCourseFilter] = useState("ALL");
  const [bdeStudentsStatusFilter, setBdeStudentsStatusFilter] = useState("ALL");
  const [bdeAccountsSearch, setBdeAccountsSearch] = useState("");
  const [regularStudentsSearch, setRegularStudentsSearch] = useState("");
  const [regularStudentsCourseFilter, setRegularStudentsCourseFilter] = useState("ALL");
  const [regularResultsSearch, setRegularResultsSearch] = useState("");
  const [regularResultsExamFilter, setRegularResultsExamFilter] = useState("ALL");
  const [examListSearch, setExamListSearch] = useState("");
  const [examListStatusFilter, setExamListStatusFilter] = useState("ALL");
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
    course: "",
    collegeId: "",
    password: ""
  });
  const [regularStatus, setRegularStatus] = useState("");
  const [regularCredentials, setRegularCredentials] = useState(null);
  const [regularCreateSubmitting, setRegularCreateSubmitting] = useState(false);
  const [regularCollegeSearch, setRegularCollegeSearch] = useState("");
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
        setRegularForm((prev) => ({
          ...prev,
          collegeId: prev.collegeId || activeCollegeId
        }));
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
    try {
      const response = await fetch(`/admin/result-answers/${result.result_id}`);
      const data = await response.json();
      if (data.success) {
        navigate("/admin/result-review", {
          state: {
            resultId: result.result_id,
            result,
            questions: data.questions || []
          }
        });
      }
    } catch (err) {
      console.error("Result detail error:", err);
    } finally {
      // no-op
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
      setThisMonthRegistrations(Number(data.thisMonthRegistrations || 0));
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
        setThisMonthRegistrations(0);
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
        setThisMonthRegistrations(0);
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
    const trimmedCourse = regularForm.course.trim();
    const passwordValue = regularForm.password;
    const selectedCollegeId = regularForm.collegeId;

    if (
      !trimmedName ||
      !trimmedEmail ||
      !trimmedPhone ||
      !trimmedDob ||
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

      setRegularStatus("Regular student created. Credentials are now active.");
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

    const payload = {};

    const course = courseSelect === "OTHER" ? customCourse.trim() : courseSelect;
    if (!course) {
      alert("Select a course for regular exam");
      return;
    }
    if (!scheduleStartDate || !scheduleStartTime) {
      alert("Select start date/time");
      return;
    }
    payload.course = course;
    payload.startDate = scheduleStartDate;
    payload.startTime = scheduleStartTime;
    payload.cutoff = cutoff;

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
      setCourseSelect("");
      setCustomCourse("");
      setScheduleStartDate("");
      setScheduleStartTime("");
      setCutoff("");
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
    const courseValue = String(exam?.course || "").trim();
    const isKnownCourse = REGULAR_COURSES.includes(courseValue);
    setEditingExamId(Number(exam?.exam_id || 0) || null);
    setCourseSelect(isKnownCourse ? courseValue : "OTHER");
    setCustomCourse(isKnownCourse ? "" : courseValue);
    setScheduleStartDate(toISTDateInput(exam?.start_at));
    setScheduleStartTime(toISTTimeInput(exam?.start_at));
    setCutoff(exam?.cutoff === null || exam?.cutoff === undefined ? "" : String(exam.cutoff));
    setExamScheduleStatus(`Editing exam #${exam?.exam_id || ""}. Update fields and click Save Schedule.`);
  };

  const handleToggleExamStatus = async (exam) => {
    const examId = Number(exam?.exam_id || 0);
    if (!examId) return;
    const currentStatus = normalizeExamStatus(exam?.exam_status);
    const nextStatus = currentStatus === "READY" ? "DRAFT" : "READY";
    const confirmed = await openConfirmDialog({
      title: nextStatus === "READY" ? "Activate this exam?" : "Deactivate this exam?",
      message:
        nextStatus === "READY"
          ? "Students will be able to start this exam within its schedule window."
          : "Students will not be able to start this exam while it is deactivated.",
      confirmLabel: nextStatus === "READY" ? "Activate" : "Deactivate",
      tone: nextStatus === "READY" ? "default" : "warning"
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/admin/exam/${examId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not update exam status");
      }
      await loadExams();
      setExamScheduleStatus(`Exam #${examId} is now ${nextStatus}.`);
    } catch (error) {
      setExamScheduleStatus(error.message || "Could not update exam status.");
    }
  };

  const handleCancelExamEdit = () => {
    setEditingExamId(null);
    setCourseSelect("");
    setCustomCourse("");
    setScheduleStartDate("");
    setScheduleStartTime("");
    setCutoff("");
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

  const fetchRegularQuestionSheet = useCallback(async (courseOverride = "") => {
    const courseValue = String(courseOverride || regularQuestionCourse || "").trim();
    if (!courseValue) {
      setRegularQuestionSheetData(null);
      setRegularQuestionSheetError("Select a course to load regular question sheet.");
      return;
    }

    setRegularQuestionSheetLoading(true);
    setRegularQuestionSheetError("");
    try {
      const response = await fetch(`/admin/regular/questions?course=${encodeURIComponent(courseValue)}`, {
        credentials: "include",
        cache: "no-store"
      });
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
  }, [regularQuestionCourse]);

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

  const recomputeWalkinResults = async () => {
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

  useEffect(() => {
    if (activeSection === "walkin-questions" && !walkinSheetLoading && !walkinSheetData) {
      fetchWalkinSheet();
    }
  }, [activeSection, fetchWalkinSheet, walkinSheetData, walkinSheetLoading]);

  useEffect(() => {
    if (activeSection === "regular-questions" && regularQuestionCourse) {
      fetchRegularQuestionSheet(regularQuestionCourse);
    }
  }, [activeSection, regularQuestionCourse, fetchRegularQuestionSheet]);

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
    { label: "MERN", count: walkinStreamCounts.MERN, tone: "mern" }
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
      const matchExam =
        walkinResultsExamFilter === "ALL" || String(row.exam_id || "") === walkinResultsExamFilter;
      return matchQuery && matchStream && matchExam;
    });
  }, [walkinResults, walkinResultsSearch, walkinResultsStreamFilter, walkinResultsExamFilter]);
  const walkinResultStreams = useMemo(() => {
    const source = Array.isArray(walkinResults) ? walkinResults : [];
    return [...new Set(source.map((row) => String(row.stream || "")).filter(Boolean))];
  }, [walkinResults]);
  const walkinResultExams = useMemo(() => {
    const source = Array.isArray(walkinResults) ? walkinResults : [];
    return [...new Set(source.map((row) => String(row.exam_id || "")).filter(Boolean))];
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
  const regularResultExamIds = useMemo(() => {
    return [...new Set((recentResults || []).map((row) => String(row.exam_id || "")).filter(Boolean))];
  }, [recentResults]);
  const filteredRegularResults = useMemo(() => {
    const query = regularResultsSearch.trim().toLowerCase();
    return (recentResults || []).filter((row) => {
      const matchQuery =
        !query ||
        String(row.result_id || "").toLowerCase().includes(query) ||
        String(row.student_name || row.student_id || "").toLowerCase().includes(query) ||
        String(row.exam_name || row.exam_id || "").toLowerCase().includes(query);
      const matchExam =
        regularResultsExamFilter === "ALL" || String(row.exam_id || "") === regularResultsExamFilter;
      return matchQuery && matchExam;
    });
  }, [recentResults, regularResultsSearch, regularResultsExamFilter]);
  const examStatusOptions = useMemo(() => {
    return [...new Set((exams || []).map((exam) => normalizeExamStatus(exam.exam_status)).filter(Boolean))];
  }, [exams]);
  const filteredExams = useMemo(() => {
    const query = examListSearch.trim().toLowerCase();
    return (exams || [])
      .filter((exam) => {
        const matchQuery =
          !query ||
          String(exam.exam_id || "").toLowerCase().includes(query) ||
          String(exam.course || "").toLowerCase().includes(query);
        const matchStatus =
          examListStatusFilter === "ALL" ||
          normalizeExamStatus(exam.exam_status) === examListStatusFilter;
        return matchQuery && matchStatus;
      })
      .sort((a, b) => Number(b.exam_id || 0) - Number(a.exam_id || 0));
  }, [exams, examListSearch, examListStatusFilter]);
  const regularQuestionCourseOptions = useMemo(() => {
    const fromExams = (exams || []).map((exam) => String(exam.course || "").trim()).filter(Boolean);
    const fromStudents = (regularStudents || []).map((student) => String(student.course || "").trim()).filter(Boolean);
    return [...new Set([...fromExams, ...fromStudents])].sort((left, right) => left.localeCompare(right));
  }, [exams, regularStudents]);
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
              Course Schedules
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
            className={`nav-button ${activeSection === "regular-results" ? "active" : ""}`}
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
              <div className="dashboard-section admin-section" id="admin-analytics">
                <h2>Analytics</h2>
                <div className="analytics-layout">
                  <div className="stat-grid">
                    <div className="stat-card stat-card-neutral">
                      <span className="stat-label">Total Students</span>
                      <span className="stat-value">{studentCount}</span>
                      <span className="stat-meta">Registered learners</span>
                    </div>
                    <div className="stat-card stat-card-regular">
                      <span className="stat-label">Regular Exam Students</span>
                      <span className="stat-value">{regularStudentCount}</span>
                      <span className="stat-meta">{regularStudentsPercent.toFixed(0)}% of total students</span>
                    </div>
                    <div className="stat-card stat-card-walkin">
                      <span className="stat-label">Walk-In Exam Students</span>
                      <span className="stat-value">{walkinStudentCount}</span>
                      <span className="stat-meta">{walkinStudentsPercent.toFixed(0)}% of total students</span>
                    </div>
                    <div className="stat-card stat-card-regular-result">
                      <span className="stat-label">Regular Resulted Students</span>
                      <span className="stat-value">{regularResultedCount}</span>
                      <span className="stat-meta">{regularResultedPercent.toFixed(0)}% of regular students</span>
                    </div>
                    <div className="stat-card stat-card-walkin-result">
                      <span className="stat-label">Walk-In Resulted Students</span>
                      <span className="stat-value">{walkinResultedCount}</span>
                      <span className="stat-meta">{walkinResultedPercent.toFixed(0)}% of walk-in students</span>
                    </div>
                  </div>
                  <div className="chart-stack">
                    <div className="chart-row chart-row-primary">
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Monthly Registrations</h3>
                        </div>
                        <div className="chart-canvas chart-canvas-compact chart-canvas-monthly">
                          <button
                            type="button"
                            className="month-nav-btn month-nav-btn-inline month-nav-btn-left"
                            aria-label="Show previous month registrations"
                            onClick={() => setRegistrationMonthOffset((prev) => Math.min(prev + 1, 24))}
                          >
                            &#8249;
                          </button>
                          <div className="monthly-registrations-card">
                            <div className="monthly-registrations-summary">
                              <p className="monthly-summary-value">{Number(selectedRegistrationEntry?.total || 0)}</p>
                              <p className="monthly-summary-label">
                                Registrations in {selectedRegistrationEntry?.monthLabel || "--"}
                              </p>
                              <div className="monthly-summary-previous">
                                <span className="monthly-summary-previous-label">Previous Month</span>
                                <div className="monthly-summary-previous-meta">
                                  <strong>{Number(previousRegistrationEntry?.total || 0)}</strong>
                                  <span>{previousRegistrationEntry?.monthLabel || "--"}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="month-nav-btn month-nav-btn-inline month-nav-btn-right"
                            aria-label="Show next month registrations"
                            onClick={() => setRegistrationMonthOffset((prev) => Math.max(prev - 1, 0))}
                            disabled={registrationMonthOffset === 0}
                          >
                            &#8250;
                          </button>
                        </div>
                      </div>
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Regular vs Walk-In</h3>
                          <span>{studentCount} total</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <div className="simple-donut-row">
                            <div className="simple-donut-card">
                              <div
                                className="simple-donut"
                                style={{ "--donut-percent": `${regularStudentsPercent}%` }}
                              >
                                <div className="simple-donut-center">{regularStudentsPercent.toFixed(0)}%</div>
                              </div>
                              <p className="simple-donut-label">Regular ({regularStudentCount})</p>
                            </div>
                            <div className="simple-donut-card">
                              <div
                                className="simple-donut simple-donut-alt"
                                style={{ "--donut-percent": `${walkinStudentsPercent}%` }}
                              >
                                <div className="simple-donut-center">{walkinStudentsPercent.toFixed(0)}%</div>
                              </div>
                              <p className="simple-donut-label">Walk-In ({walkinStudentCount})</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="chart-row">
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Enrollment by Section</h3>
                          <span>{studentCount} total students</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <div className="section-enrollment-bars">
                            {enrollmentSectionBars.map((entry) => (
                              <div className={`section-enrollment-row tone-${entry.tone}`} key={`enroll-row-${entry.label}`}>
                                <div className="section-enrollment-head">
                                  <span>{entry.label}</span>
                                  <span>{entry.count} ({entry.percent.toFixed(0)}%)</span>
                                </div>
                                <div className="section-enrollment-track">
                                  <div
                                    className="section-enrollment-fill"
                                    style={{ width: `${entry.barPercent}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Registered BDEs</h3>
                          <span>{registeredBdeCount} total</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <div className="kpi-wrap">
                            <p className="kpi-value">{registeredBdeCount}</p>
                            <p className="kpi-label">Total Registered BDEs</p>
                            <div className="kpi-split">
                              <span>Assigned: {assignedBdeCount}</span>
                              <span>Unassigned: {unassignedBdeCount}</span>
                            </div>
                            <div className="kpi-split">
                              <span>Assignment Coverage: {toPercent(assignedBdeCount, registeredBdeCount || 1).toFixed(0)}%</span>
                              <span>Total Students: {studentCount}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {!showProfile && (
            <>
              {activeSection === "walkin-results" && (
                <div className="dashboard-section admin-section" id="walkin-results">
                  <div className="walkin-results-head">
                    <h2>Walk-In Results</h2>
                    <button
                      type="button"
                      className="small-outline-btn"
                      onClick={recomputeWalkinResults}
                      disabled={walkinRecomputeLoading}
                    >
                      {walkinRecomputeLoading ? "Recomputing..." : "Recompute Results"}
                    </button>
                  </div>
                  {walkinRecomputeStatus && <p className="section-placeholder">{walkinRecomputeStatus}</p>}
                  <div className="table-toolbar">
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
                    <select
                      value={walkinResultsExamFilter}
                      onChange={(event) => setWalkinResultsExamFilter(event.target.value)}
                    >
                      <option value="ALL">All Exams</option>
                      {walkinResultExams.map((examId) => (
                        <option key={`wr-exam-${examId}`} value={examId}>
                          Exam {examId}
                        </option>
                      ))}
                    </select>
                  </div>
                  {walkinResultsLoading && renderTableSkeleton(6)}
                  {walkinResultsError && <p className="auth-help">{walkinResultsError}</p>}
                  {walkinResults && walkinResultsRows.length === 0 && !walkinResultsLoading && !walkinResultsError && (
                    <p className="section-placeholder">No walk-in results yet.</p>
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
                                <p className="item-answer">Answer: {q.correct_option || "-"}</p>
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
                                  {row.question_type?.toLowerCase() === "mcq" && (
                                    <p className="item-answer">Answer: {row.correct_option || "-"}</p>
                                  )}
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
                  <div className="table-toolbar">
                    <select
                      value={regularQuestionCourse}
                      onChange={(event) => setRegularQuestionCourse(event.target.value)}
                    >
                      <option value="">Select Course</option>
                      {regularQuestionCourseOptions.map((course) => (
                        <option key={`rq-course-${course}`} value={course}>
                          {course}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => fetchRegularQuestionSheet(regularQuestionCourse)}
                      disabled={regularQuestionSheetLoading || !regularQuestionCourse}
                    >
                      {regularQuestionSheetLoading ? "Loading..." : "Load Questions"}
                    </button>
                  </div>
                  {regularQuestionSheetError && <p className="auth-help">{regularQuestionSheetError}</p>}
                  {regularQuestionSheetData?.exam && (
                    <p className="item-meta" style={{ marginTop: 8 }}>
                      Exam ID: {regularQuestionSheetData.exam.exam_id} | Status: {normalizeExamStatus(regularQuestionSheetData.exam.exam_status)} | Schedule: {formatIST24(regularQuestionSheetData.exam.start_at)} to {formatIST24(regularQuestionSheetData.exam.end_at)}
                    </p>
                  )}
                  {regularQuestionSheetLoading && renderTableSkeleton(8)}
                  {!regularQuestionSheetLoading && regularQuestionSections.length === 0 && regularQuestionCourse && !regularQuestionSheetError && (
                    <p className="section-placeholder">No regular exam questions found for this course.</p>
                  )}
                  {!regularQuestionSheetLoading && regularQuestionSections.length > 0 && (
                    <div className="walkin-sheet-grid walkin-sheet-grid-single">
                      {regularQuestionSections.map((sectionBlock) => (
                        <div className="walkin-sheet-block" key={`regular-section-${sectionBlock.sectionName}`}>
                          <h3>{sectionBlock.sectionName}</h3>
                          {sectionBlock.questions.map((question) => (
                            <div className="walkin-sheet-item" key={`regular-question-${question.question_id}`}>
                              <p className="item-meta">QID: {question.question_id} | Type: {String(question.question_type || "MCQ")}</p>
                              <p className="item-text">{question.question_text}</p>
                              {String(question.question_type || "").toLowerCase().includes("mcq") && (
                                <>
                                  {question.option_a && <p className="item-option"><span className="option-label">A.</span> {question.option_a}</p>}
                                  {question.option_b && <p className="item-option"><span className="option-label">B.</span> {question.option_b}</p>}
                                  {question.option_c && <p className="item-option"><span className="option-label">C.</span> {question.option_c}</p>}
                                  {question.option_d && <p className="item-option"><span className="option-label">D.</span> {question.option_d}</p>}
                                  <p className="item-answer">Answer: {question.correct_answer || "--"}</p>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeSection === "regular-results" && (
                <div className="dashboard-section admin-section" id="admin-results">
                  <h2>Regular Student Results</h2>
                  <div className="table-toolbar">
                    <input
                      type="text"
                      placeholder="Search by result, student, exam"
                      value={regularResultsSearch}
                      onChange={(event) => setRegularResultsSearch(event.target.value)}
                    />
                    <select
                      value={regularResultsExamFilter}
                      onChange={(event) => setRegularResultsExamFilter(event.target.value)}
                    >
                      <option value="ALL">All Exams</option>
                      {regularResultExamIds.map((examId) => (
                        <option key={`rr-exam-${examId}`} value={examId}>
                          Exam {examId}
                        </option>
                      ))}
                    </select>
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
                        <th>Submission Time</th>
                        <th>Feedback Snippet</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegularResults.length === 0 && (
                        <tr>
                          <td colSpan="10" style={{ textAlign: "center" }}>No results found</td>
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
                        const submissionTimeText = result.submission_time
                          ? formatIST24(result.submission_time)
                          : "--";
                        const feedbackSnippet = String(result.feedback_snippet || "").trim() || "--";
                        return (
                          <tr key={result.result_id}>
                            <td>{result.result_id}</td>
                            <td>{result.student_name || result.student_id}</td>
                            <td>{result.exam_name || result.exam_id}</td>
                            <td>{result.course}</td>
                            <td>{marksText}</td>
                            <td>{percentageText}</td>
                            <td>{submissionTimeText}</td>
                            <td title={feedbackSnippet}>{feedbackSnippet}</td>
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

              {activeSection === "walkin" && (
              <>
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
                  {!walkinTempLoading && walkinTempRequests.length === 0 && (
                    <p className="section-placeholder">No pending walk-in requests.</p>
                  )}
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

                <div className="dashboard-section admin-section" id="walkin-create">
                  <h2>Create Walk-In Student Account</h2>
                  <form className="form-row form-row-wide" autoComplete="off" onSubmit={handleWalkinCreation}>
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
                      <div className="table-toolbar">
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
                          {filteredWalkinStudents.length === 0 && (
                            <tr>
                              <td colSpan="6" style={{ textAlign: "center" }}>No walk-in students found</td>
                            </tr>
                          )}
                          {filteredWalkinStudents.map((student, index) => {
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
                <div className="dashboard-section admin-section" id="regular-create">
                  <h2>Create Regular Student Account</h2>
                  <form className="form-row form-row-wide" autoComplete="off" onSubmit={handleRegularCreation}>
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
                      <input
                        type="text"
                        placeholder="Search college"
                        value={regularCollegeSearch}
                        onChange={(event) => setRegularCollegeSearch(event.target.value)}
                      />
                      <select
                        value={regularForm.collegeId}
                        onChange={(event) => setRegularForm({ ...regularForm, collegeId: event.target.value })}
                        required
                      >
                        <option value="">Select college</option>
                        {collegeOptionsSortedByName
                          .filter((college) => {
                            const q = String(regularCollegeSearch || "").trim().toLowerCase();
                            return !q || String(college.college_name || "").toLowerCase().includes(q);
                          })
                          .map((college) => (
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
                      <label>Course</label>
                      <select
                        value={regularForm.course}
                        onChange={(event) => setRegularForm({ ...regularForm, course: event.target.value })}
                      >
                        <option value="">Select Course</option>
                        {REGULAR_COURSES.map((course) => (
                          <option key={course} value={course}>
                            {course}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Background</label>
                      <input
                        type="text"
                        value={getRegularBackgroundType(regularForm.course) || "--"}
                        readOnly
                      />
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
                  <div className="table-toolbar">
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
                      {filteredRegularStudents.length === 0 && (
                        <tr>
                          <td colSpan="7" style={{ textAlign: "center" }}>No regular students found</td>
                        </tr>
                      )}
                      {filteredRegularStudents.map((student, index) => {
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
                <div className="table-toolbar">
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
                        <td colSpan="7" style={{ textAlign: "center" }}>No students found</td>
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
                  <div className="table-toolbar">
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
                            <td colSpan="5" style={{ textAlign: "center" }}>No BDE accounts found</td>
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
                  <div className="table-toolbar">
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
                            <td colSpan="6" style={{ textAlign: "center" }}>No students mapped to BDE yet</td>
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
                <h2>Course Exam Schedule</h2>
                <div>
                  <h3>Update Schedule</h3>
                  <form className="form-row schedule-form" onSubmit={handleCreateExam}>
                    <select
                      value={courseSelect}
                      onChange={(event) => setCourseSelect(event.target.value)}
                    >
                      <option value="">Select Course</option>
                      {REGULAR_COURSES.map((course) => (
                        <option key={course} value={course}>
                          {course}
                        </option>
                      ))}
                      <option value="OTHER">Other</option>
                    </select>

                    {courseSelect === "OTHER" && (
                      <input
                        type="text"
                        placeholder="Enter custom course"
                        value={customCourse}
                        onChange={(event) => setCustomCourse(event.target.value)}
                      />
                    )}

                    <input
                      type="date"
                      value={scheduleStartDate}
                      onChange={(event) => setScheduleStartDate(event.target.value)}
                    />
                    <input
                      type="time"
                      value={scheduleStartTime}
                      onChange={(event) => setScheduleStartTime(event.target.value)}
                    />
                    <input
                      type="number"
                      placeholder="Cutoff % (optional)"
                      value={cutoff}
                      onChange={(event) => setCutoff(event.target.value)}
                    />
                    <div className="schedule-fixed-meta" aria-label="Fixed exam config">
                      Fixed: Duration 15 minutes | Questions 15
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
                  <h3>Scheduled Course Exams</h3>
                  <div className="table-toolbar">
                    <input
                      type="text"
                      placeholder="Search by exam id or course"
                      value={examListSearch}
                      onChange={(event) => setExamListSearch(event.target.value)}
                    />
                    <select
                      value={examListStatusFilter}
                      onChange={(event) => setExamListStatusFilter(event.target.value)}
                    >
                      <option value="ALL">All Status</option>
                      {examStatusOptions.map((status) => (
                        <option key={`ex-status-${status}`} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="table-shell" aria-label="Exams table container">
                  <table className="sticky-table" aria-label="Exams table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Course</th>
                        <th>Status</th>
                        <th>Schedule</th>
                        <th>Cutoff</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExams.length === 0 && (
                        <tr>
                          <td colSpan="6" style={{ textAlign: "center" }}>No exams found</td>
                        </tr>
                      )}
                      {filteredExams.map((exam) => (
                        <tr key={exam.exam_id}>
                          <td>{exam.exam_id}</td>
                          <td>{exam.course}</td>
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
                          <td>{exam.cutoff ?? "--"}</td>
                          <td>
                            <button className="secondary-btn" onClick={() => handleEditExam(exam)}>
                              Edit
                            </button>
                            <button
                              className="secondary-btn"
                              style={{ marginLeft: 8 }}
                              onClick={() => handleToggleExamStatus(exam)}
                            >
                              {normalizeExamStatus(exam.exam_status) === "READY" ? "Deactivate" : "Activate"}
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



