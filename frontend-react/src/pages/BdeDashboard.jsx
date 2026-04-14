import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

const WALKIN_OPTION_KEYS = [
  { key: "option_a", label: "A" },
  { key: "option_b", label: "B" },
  { key: "option_c", label: "C" },
  { key: "option_d", label: "D" }
];
const WALKIN_STREAM_OPTIONS = ["Data Analytics", "Data Science", "MERN", "Agentic AI"];

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

const toPercent = (value, total) => {
  if (!total || total <= 0) return 0;
  const ratio = (Number(value || 0) / Number(total)) * 100;
  return Math.max(0, Math.min(100, ratio));
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

const normalizeStudentTypeLabel = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "WALK_IN" || normalized === "WALKIN") return "WALKIN";
  if (normalized === "REGULAR") return "REGULAR";
  return normalized || "--";
};

const normalizeStudentStatusLabel = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "ACTIVE") return "ACTIVE";
  if (normalized === "INACTIVE") return "INACTIVE";
  return normalized || "--";
};

function BdeDashboard() {
  useBodyClass("dashboard bde-dashboard");

  const navigate = useNavigate();
  const adminId = localStorage.getItem("adminId");
  const adminRole = String(localStorage.getItem("adminRole") || "").toUpperCase();
  const adminDisplayName = localStorage.getItem("adminDisplayName") || "BDE";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("dashboard");
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [registrationMonthOffset, setRegistrationMonthOffset] = useState(0);
  const [registrationTrend, setRegistrationTrend] = useState([]);
  const [requestStatusCounts, setRequestStatusCounts] = useState({ APPROVED: 0, PENDING: 0, REJECTED: 0 });
  const [recentStudents, setRecentStudents] = useState([]);
  const [enrolledStudents, setEnrolledStudents] = useState([]);
  const [recentSearch, setRecentSearch] = useState("");
  const [recentCourseFilter, setRecentCourseFilter] = useState("ALL");
  const [recentStatusFilter, setRecentStatusFilter] = useState("ALL");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentCourseFilter, setStudentCourseFilter] = useState("ALL");
  const [studentTypeFilter, setStudentTypeFilter] = useState("ALL");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showSelectedStudentPassword, setShowSelectedStudentPassword] = useState(false);
  const [walkinResults, setWalkinResults] = useState(null);
  const [walkinResultsLoading, setWalkinResultsLoading] = useState(false);
  const [walkinResultsError, setWalkinResultsError] = useState("");
  const [walkinResultsSearch, setWalkinResultsSearch] = useState("");
  const [walkinResultsStreamFilter, setWalkinResultsStreamFilter] = useState("ALL");
  const [walkinResultsExamFilter, setWalkinResultsExamFilter] = useState("ALL");
  const [walkinReviewData, setWalkinReviewData] = useState(null);
  const [walkinReviewLoading, setWalkinReviewLoading] = useState(false);
  const [walkinReviewError, setWalkinReviewError] = useState("");
  const [walkinReviewView, setWalkinReviewView] = useState("summary");
  const [bdeProfile, setBdeProfile] = useState({
    bde_id: "",
    name: adminDisplayName,
    email: "",
    phone_number: ""
  });
  const [collegeOptions, setCollegeOptions] = useState([]);
  const [collegeError, setCollegeError] = useState("");
  const [newCollegeName, setNewCollegeName] = useState("");
  const [collegeActionStatus, setCollegeActionStatus] = useState("");
  const [collegeCreateSubmitting, setCollegeCreateSubmitting] = useState(false);
  const [walkinForm, setWalkinForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    stream: "",
    collegeId: ""
  });
  const [walkinCreateSubmitting, setWalkinCreateSubmitting] = useState(false);
  const [walkinStatus, setWalkinStatus] = useState("");
  const [walkinPendingRows, setWalkinPendingRows] = useState([]);
  const [walkinRejectedRows, setWalkinRejectedRows] = useState([]);
  const [walkinPendingLoading, setWalkinPendingLoading] = useState(false);
  const [walkinPendingError, setWalkinPendingError] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: ""
  });
  const [passwordChangeSaving, setPasswordChangeSaving] = useState(false);
  const [passwordChangeStatus, setPasswordChangeStatus] = useState("");

  const loadColleges = useCallback(async () => {
    try {
      const response = await fetch("/admin/colleges", {
        credentials: "include",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load colleges");
      }
      const rows = Array.isArray(data.colleges) ? data.colleges : [];
      setCollegeOptions(rows);
      setCollegeError("");
    } catch (loadError) {
      console.error("BDE college list load error:", loadError);
      setCollegeOptions([]);
      setCollegeError(loadError.message || "Could not load colleges");
    }
  }, []);

  const loadPendingWalkinRequests = useCallback(async () => {
    setWalkinPendingLoading(true);
    setWalkinPendingError("");
    try {
      const [pendingResponse, rejectedResponse] = await Promise.all([
        fetch("/admin/walkin/temp-students?status=PENDING", {
          credentials: "include",
          cache: "no-store"
        }),
        fetch("/admin/walkin/temp-students?status=REJECTED", {
          credentials: "include",
          cache: "no-store"
        })
      ]);
      const [pendingData, rejectedData] = await Promise.all([
        pendingResponse.json(),
        rejectedResponse.json()
      ]);
      if (!pendingResponse.ok || !pendingData.success) {
        throw new Error(pendingData?.message || "Could not load pending requests");
      }
      if (!rejectedResponse.ok || !rejectedData.success) {
        throw new Error(rejectedData?.message || "Could not load rejected requests");
      }
      setWalkinPendingRows(Array.isArray(pendingData.requests) ? pendingData.requests : []);
      setWalkinRejectedRows(Array.isArray(rejectedData.requests) ? rejectedData.requests : []);
    } catch (loadError) {
      console.error("BDE pending walk-in load error:", loadError);
      setWalkinPendingRows([]);
      setWalkinRejectedRows([]);
      setWalkinPendingError(loadError.message || "Could not load walk-in requests");
    } finally {
      setWalkinPendingLoading(false);
    }
  }, []);

  const fetchWalkinResults = useCallback(async () => {
    setWalkinResultsLoading(true);
    setWalkinResultsError("");
    try {
      const response = await fetch(`/admin/walkin/final-results/ALL?t=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Could not load candidate results.");
      }
      setWalkinResults(Array.isArray(data) ? data : []);
    } catch (loadError) {
      console.error("BDE walk-in results load error:", loadError);
      setWalkinResults([]);
      setWalkinResultsError(loadError.message || "Could not load candidate results.");
    } finally {
      setWalkinResultsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!adminId || adminRole !== "BDE") {
      navigate("/bde/login");
      return;
    }
    const controller = new AbortController();
    let isActive = true;
    const loadDashboard = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/admin/bde/dashboard?monthOffset=${registrationMonthOffset}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal
        });
        const data = await response.json();
        if (!isActive) return;
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load dashboard");
        }
        const profile = data?.bde || {};
        setBdeProfile({
          bde_id: profile.bde_id || adminId || "",
          name: profile.name || adminDisplayName,
          email: profile.email || "",
          phone_number: profile.phone_number || ""
        });
        setTotalEnrolled(Number(data.totalEnrolled || 0));
        setRegistrationTrend(Array.isArray(data.registrationTrend) ? data.registrationTrend : []);
        setRequestStatusCounts({
          APPROVED: Number(data.requestStatusCounts?.APPROVED || 0),
          PENDING: Number(data.requestStatusCounts?.PENDING || 0),
          REJECTED: Number(data.requestStatusCounts?.REJECTED || 0)
        });
        setRecentStudents(Array.isArray(data.recentStudents) ? data.recentStudents : []);
        setEnrolledStudents(Array.isArray(data.enrolledStudents) ? data.enrolledStudents : []);
      } catch (err) {
        if (!isActive || err?.name === "AbortError") return;
        console.error("BDE dashboard load error:", err);
        setError(err.message || "Could not load dashboard");
        setTotalEnrolled(0);
        setRegistrationTrend([]);
        setRequestStatusCounts({ APPROVED: 0, PENDING: 0, REJECTED: 0 });
        setRecentStudents([]);
        setEnrolledStudents([]);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };
    loadDashboard();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [adminDisplayName, adminId, adminRole, navigate, registrationMonthOffset]);

  useEffect(() => {
    if (activeSection === "results" && walkinResults === null && !walkinResultsLoading) {
      fetchWalkinResults();
    }
  }, [activeSection, fetchWalkinResults, walkinResults, walkinResultsLoading]);

  useEffect(() => {
    loadColleges();
  }, [loadColleges]);

  useEffect(() => {
    if (activeSection === "register") {
      loadPendingWalkinRequests();
    }
  }, [activeSection, loadPendingWalkinRequests]);

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
        localStorage.removeItem("adminRole");
        localStorage.removeItem("adminDisplayName");
        setPasswordChangeStatus(data?.message || "Session expired. Please log in again.");
        navigate("/bde/login");
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
    } catch (changeError) {
      console.error("BDE change password error:", changeError);
      setPasswordChangeStatus("Could not update password.");
    } finally {
      setPasswordChangeSaving(false);
    }
  };

  const handleCreateCollege = async (event) => {
    event.preventDefault();
    if (collegeCreateSubmitting) return;
    const trimmedCollegeName = String(newCollegeName || "").trim();
    if (!trimmedCollegeName) {
      setCollegeActionStatus("Enter college name.");
      return;
    }

    setCollegeCreateSubmitting(true);
    setCollegeActionStatus("");
    try {
      const response = await fetch("/admin/colleges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeName: trimmedCollegeName })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not create college");
      }
      setCollegeActionStatus(`College "${trimmedCollegeName}" saved successfully.`);
      setNewCollegeName("");
      await loadColleges();
    } catch (createError) {
      console.error("BDE create college error:", createError);
      setCollegeActionStatus(createError.message || "Could not create college");
    } finally {
      setCollegeCreateSubmitting(false);
    }
  };

  const handleWalkinRegistration = async (event) => {
    event.preventDefault();
    if (walkinCreateSubmitting) return;
    const payload = {
      name: String(walkinForm.name || "").trim(),
      email: String(walkinForm.email || "").trim(),
      phone: String(walkinForm.phone || "").trim(),
      dob: String(walkinForm.dob || "").trim(),
      stream: String(walkinForm.stream || "").trim(),
      collegeId: String(walkinForm.collegeId || "").trim()
    };
    if (!payload.name || !payload.email || !payload.phone || !payload.dob || !payload.stream || !payload.collegeId) {
      setWalkinStatus("Fill all walk-in student details.");
      return;
    }

    setWalkinCreateSubmitting(true);
    setWalkinStatus("");
    try {
      const response = await fetch("/admin/walkin/temp-students", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not submit walk-in request");
      }
      setWalkinStatus(data.message || "Walk-in request submitted for admin approval.");
      setWalkinForm({
        name: "",
        email: "",
        phone: "",
        dob: "",
        stream: "",
        collegeId: ""
      });
      await loadPendingWalkinRequests();
    } catch (createError) {
      console.error("BDE walk-in request create error:", createError);
      setWalkinStatus(createError.message || "Could not submit walk-in request");
    } finally {
      setWalkinCreateSubmitting(false);
    }
  };

  const logout = () => {
    fetch("/admin/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        localStorage.removeItem("adminId");
        localStorage.removeItem("adminRole");
        localStorage.removeItem("adminDisplayName");
        navigate("/bde/login");
      });
  };

  const formatDate = (value) => {
    if (!value) return "--";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  };
  const recentCourseOptions = [...new Set(recentStudents.map((student) => String(student.course || "").trim()).filter(Boolean))];
  const filteredRecentStudents = recentStudents.filter((student) => {
    const query = recentSearch.trim().toLowerCase();
    const matchQuery =
      !query ||
      String(student.student_id || "").toLowerCase().includes(query) ||
      String(student.name || "").toLowerCase().includes(query) ||
      String(student.email_id || "").toLowerCase().includes(query);
    const matchCourse = recentCourseFilter === "ALL" || String(student.course || "") === recentCourseFilter;
    const statusLabel = String(student.student_status || student.status || "").trim().toUpperCase();
    const matchStatus = recentStatusFilter === "ALL" || statusLabel === recentStatusFilter;
    return matchQuery && matchCourse && matchStatus;
  }).sort((left, right) => Number(right?.student_id || 0) - Number(left?.student_id || 0));
  const studentCourseOptions = [...new Set(enrolledStudents.map((student) => String(student.course || "").trim()).filter(Boolean))];
  const filteredEnrolledStudents = enrolledStudents.filter((student) => {
    const query = studentSearch.trim().toLowerCase();
    const matchQuery =
      !query ||
      String(student.student_id || "").toLowerCase().includes(query) ||
      String(student.name || "").toLowerCase().includes(query) ||
      String(student.email_id || "").toLowerCase().includes(query);
    const matchCourse = studentCourseFilter === "ALL" || String(student.course || "") === studentCourseFilter;
    const typeLabel = normalizeStudentTypeLabel(student.student_type);
    const matchType = studentTypeFilter === "ALL" || typeLabel === studentTypeFilter;
    return matchQuery && matchCourse && matchType;
  }).sort((left, right) => Number(right?.student_id || 0) - Number(left?.student_id || 0));
  const studentTypeOptions = [...new Set(
    enrolledStudents
      .map((student) => normalizeStudentTypeLabel(student.student_type))
      .filter((type) => type && type !== "--")
  )];
  const visibleRegistrationTrend = useMemo(() => (registrationTrend || []).slice(-2), [registrationTrend]);
  const previousRegistrationEntry = visibleRegistrationTrend[0] || null;
  const selectedRegistrationEntry = visibleRegistrationTrend[visibleRegistrationTrend.length - 1] || null;
  const requestStatusTotal = Number(requestStatusCounts.APPROVED || 0) + Number(requestStatusCounts.PENDING || 0) + Number(requestStatusCounts.REJECTED || 0);
  const approvedPercent = toPercent(requestStatusCounts.APPROVED, requestStatusTotal || 1);
  const pendingPercent = toPercent(requestStatusCounts.PENDING, requestStatusTotal || 1);
  const rejectedPercent = toPercent(requestStatusCounts.REJECTED, requestStatusTotal || 1);
  const collegeDropdownOptions = useMemo(
    () =>
      [...collegeOptions].sort((left, right) =>
        String(left?.college_name || "").localeCompare(String(right?.college_name || ""), undefined, {
          sensitivity: "base"
        })
      ),
    [collegeOptions]
  );
  const sortedCollegeOptions = useMemo(
    () =>
      [...collegeOptions].sort((left, right) =>
        String(left?.college_name || "").localeCompare(String(right?.college_name || ""), undefined, {
          sensitivity: "base"
        })
      ),
    [collegeOptions]
  );
  const filteredCollegeOptions = useMemo(() => sortedCollegeOptions, [sortedCollegeOptions]);

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

  const openWalkinReview = async (row) => {
    const studentId = Number(row?.student_id || 0);
    const examId = Number(row?.exam_id || 0);
    const collegeId = Number(row?.college_id || 0);
    if (!studentId || !examId || !collegeId) {
      setWalkinReviewError("Missing review context for selected candidate.");
      return;
    }
    setWalkinReviewLoading(true);
    setWalkinReviewError("");
    setWalkinReviewData(null);
    try {
      const response = await fetch(`/admin/walkin/review/${collegeId}/${studentId}/${examId}?t=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.message || "Could not load answer review");
      }
      setWalkinReviewData(data);
      setWalkinReviewView("summary");
      setActiveSection("result-review");
    } catch (reviewError) {
      console.error("BDE walk-in review fetch error:", reviewError);
      setWalkinReviewError(reviewError.message || "Could not load answer review");
    } finally {
      setWalkinReviewLoading(false);
    }
  };

  const closeWalkinReview = () => {
    setWalkinReviewError("");
    setWalkinReviewData(null);
    setWalkinReviewView("summary");
    setActiveSection("results");
  };

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
        })}
      </div>
    );
  };

  const reviewAnswers = walkinReviewData?.answers || [];
  const reviewSummary = String(walkinReviewData?.performance_summary || "")
    .replace(/Main weak area:[^.]*\.?/gi, "")
    .trim();
  const reviewFeedbackText = String(walkinReviewData?.feedback_text || "").trim();
  const reviewFeedbackQuestion = String(walkinReviewData?.feedback_question_text || "").trim();
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

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar bde-topbar">
        <div className="topbar-left">
          <div className="brand-logo">
            <img src="/dashboard-logo.png" alt="RP2 Rounded Professional Program" />
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="topbar-profile" onClick={() => setActiveSection("profile")}>
            <div className="profile-badge">B</div>
            <div>
              <span className="profile-name">{bdeProfile.name || adminDisplayName}</span>
              <span className="profile-role">Business Development Executive</span>
            </div>
          </button>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="dashboard-layout bde-layout">
        <aside className="dashboard-sidebar">
          <div className="sidebar-top">
            <div className="sidebar-profile">
              <div className="profile-badge">B</div>
              <div>
                <h3>BDE Panel</h3>
                <p>Enrollment tracking</p>
              </div>
            </div>
            <nav className="sidebar-nav">
              <span className="nav-group">Overview</span>
              <button
                type="button"
                className={`nav-button ${activeSection === "dashboard" ? "active" : ""}`}
                onClick={() => setActiveSection("dashboard")}
              >
                Dashboard
              </button>
              <span className="nav-break" aria-hidden="true" />
              <span className="nav-group">Management</span>
              <button
                type="button"
                className={`nav-button ${activeSection === "register" ? "active" : ""}`}
                onClick={() => setActiveSection("register")}
              >
                Register Walk-In
              </button>
              <button
                type="button"
                className={`nav-button ${activeSection === "results" || activeSection === "result-review" ? "active" : ""}`}
                onClick={() => setActiveSection("results")}
              >
                Candidate Results
              </button>
              <span className="nav-break" aria-hidden="true" />
              <span className="nav-group">Profiles</span>
              <button
                type="button"
                className={`nav-button ${activeSection === "students" ? "active" : ""}`}
                onClick={() => setActiveSection("students")}
              >
                Registered Candidates
              </button>
              <button
                type="button"
                className={`nav-button ${activeSection === "colleges" ? "active" : ""}`}
                onClick={() => setActiveSection("colleges")}
              >
                Colleges
              </button>
              <button
                type="button"
                className={`nav-button ${activeSection === "profile" ? "active" : ""}`}
                onClick={() => setActiveSection("profile")}
              >
                My Profile
              </button>
              <span className="nav-break" aria-hidden="true" />
            </nav>
          </div>
        </aside>

        <main className="dashboard-main">
          <section className="dashboard-container">
            <div className="page-header">
              <div>
                <h1>BDE Dashboard</h1>
                <p>Track your registrations through your dashboard.</p>
              </div>
            </div>

            {activeSection === "dashboard" && (
              <>
                <div className="bde-dashboard-analytics">
                  <div className="dashboard-section bde-summary-card">
                    <h2>Registered Candidates</h2>
                    <div className="bde-summary-value">{loading ? "..." : totalEnrolled}</div>
                  </div>
                  <div className="bde-analytics-grid">
                    <div className="dashboard-section bde-analytics-card">
                      <div className="bde-analytics-header">
                        <h2>Monthly Registrations</h2>
                      </div>
                      <div className="bde-analytics-canvas bde-analytics-canvas-monthly">
                        <button
                          type="button"
                          className="bde-month-nav-btn bde-month-nav-btn-left"
                          aria-label="Show previous month registrations"
                          onClick={() => setRegistrationMonthOffset((prev) => Math.min(prev + 1, 24))}
                        >
                          &#8249;
                        </button>
                        <div className="bde-monthly-card">
                          <div className="bde-monthly-summary">
                            <p className="bde-monthly-summary-value">{Number(selectedRegistrationEntry?.total || 0)}</p>
                            <p className="bde-monthly-summary-label">
                              Registrations in {selectedRegistrationEntry?.monthLabel || "--"}
                            </p>
                            <div className="bde-monthly-summary-previous">
                              <span className="bde-monthly-summary-previous-label">Previous Month</span>
                              <div className="bde-monthly-summary-previous-meta">
                                <strong>{Number(previousRegistrationEntry?.total || 0)}</strong>
                                <span>{previousRegistrationEntry?.monthLabel || "--"}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="bde-month-nav-btn bde-month-nav-btn-right"
                          aria-label="Show next month registrations"
                          onClick={() => setRegistrationMonthOffset((prev) => Math.max(prev - 1, 0))}
                          disabled={registrationMonthOffset === 0}
                        >
                          &#8250;
                        </button>
                      </div>
                    </div>
                    <div className="dashboard-section bde-analytics-card">
                      <div className="bde-analytics-header">
                        <h2>Approved / Pending / Rejected</h2>
                        <span>{loading ? "..." : `${requestStatusTotal} total`}</span>
                      </div>
                      <div className="bde-analytics-canvas">
                        <div className="bde-donut-row">
                          <div className="bde-donut-card">
                            <div className="bde-donut bde-donut-approved" style={{ "--bde-donut-percent": `${approvedPercent}%` }}>
                              <div className="bde-donut-center">{approvedPercent.toFixed(0)}%</div>
                            </div>
                            <p className="bde-donut-label">Approved ({Number(requestStatusCounts.APPROVED || 0)})</p>
                          </div>
                          <div className="bde-donut-card">
                            <div className="bde-donut bde-donut-pending" style={{ "--bde-donut-percent": `${pendingPercent}%` }}>
                              <div className="bde-donut-center">{pendingPercent.toFixed(0)}%</div>
                            </div>
                            <p className="bde-donut-label">Pending ({Number(requestStatusCounts.PENDING || 0)})</p>
                          </div>
                          <div className="bde-donut-card">
                            <div className="bde-donut bde-donut-rejected" style={{ "--bde-donut-percent": `${rejectedPercent}%` }}>
                              <div className="bde-donut-center">{rejectedPercent.toFixed(0)}%</div>
                            </div>
                            <p className="bde-donut-label">Rejected ({Number(requestStatusCounts.REJECTED || 0)})</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="dashboard-section">
                  <h2>Recent Registered Candidates</h2>
                  {loading && <p className="section-placeholder">Loading enrollments...</p>}
                  {!loading && error && <p className="auth-help">{error}</p>}
                  {!loading && !error && (
                    <>
                      <div className="table-toolbar">
                        <input
                          type="text"
                          placeholder="Search by id, name, email"
                          value={recentSearch}
                          onChange={(event) => setRecentSearch(event.target.value)}
                        />
                        <select
                          value={recentCourseFilter}
                          onChange={(event) => setRecentCourseFilter(event.target.value)}
                        >
                          <option value="ALL">All Courses/Streams</option>
                          {recentCourseOptions.map((course) => (
                            <option key={`bde-recent-course-${course}`} value={course}>
                              {course}
                            </option>
                          ))}
                        </select>
                        <select
                          value={recentStatusFilter}
                          onChange={(event) => setRecentStatusFilter(event.target.value)}
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
                            <th>S.No</th>
                            <th>Student ID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Course/Stream</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRecentStudents.length === 0 && (
                            <tr>
                              <td colSpan="6" style={{ textAlign: "center" }}>No enrollments found</td>
                            </tr>
                          )}
                          {filteredRecentStudents.map((student, index) => (
                            <tr
                              key={`bde-student-recent-${student.student_id}`}
                              className={String(student.student_status || student.status || "").toUpperCase() === "INACTIVE" ? "student-row-inactive" : ""}
                            >
                              <td>{index + 1}</td>
                              <td>{student.student_id}</td>
                              <td>{student.name}</td>
                              <td>{student.email_id}</td>
                              <td>{student.course || "--"}</td>
                              <td>{String(student.student_status || student.status || "--").toUpperCase()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {activeSection === "register" && (
              <>
                <div className="dashboard-section">
                  <h2>Register Walk-In Student</h2>
                  <form className="form-row form-row-wide bde-walkin-form" autoComplete="off" onSubmit={handleWalkinRegistration}>
                    <label className="form-field">
                      Full Name
                      <input
                        type="text"
                        placeholder="Enter full name"
                        value={walkinForm.name}
                        onChange={(event) => setWalkinForm((prev) => ({ ...prev, name: event.target.value }))}
                      />
                    </label>
                    <label className="form-field">
                      Email
                      <input
                        type="email"
                        placeholder="Enter email address"
                        value={walkinForm.email}
                        onChange={(event) => setWalkinForm((prev) => ({ ...prev, email: event.target.value }))}
                      />
                    </label>
                    <label className="form-field">
                      Contact Number
                      <input
                        type="tel"
                        placeholder="Enter contact number"
                        value={walkinForm.phone}
                        onChange={(event) => setWalkinForm((prev) => ({ ...prev, phone: event.target.value }))}
                      />
                    </label>
                    <label className="form-field">
                      Date of Birth
                      <input
                        type="date"
                        placeholder="dd-mm-yyyy"
                        value={walkinForm.dob}
                        onChange={(event) => setWalkinForm((prev) => ({ ...prev, dob: event.target.value }))}
                      />
                    </label>
                    <label className="form-field">
                      Stream
                      <select
                        value={walkinForm.stream}
                        onChange={(event) => setWalkinForm((prev) => ({ ...prev, stream: event.target.value }))}
                      >
                        <option value="">Select stream</option>
                        {WALKIN_STREAM_OPTIONS.map((stream) => (
                          <option key={`bde-walkin-stream-${stream}`} value={stream}>
                            {stream}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      College
                      <select
                        value={walkinForm.collegeId}
                        onChange={(event) => setWalkinForm((prev) => ({ ...prev, collegeId: event.target.value }))}
                      >
                        <option value="">Select college</option>
                        {collegeDropdownOptions.map((college) => (
                          <option key={`bde-walkin-college-${college.college_id}`} value={college.college_id}>
                            {college.college_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="bde-primary-action" disabled={walkinCreateSubmitting}>
                      {walkinCreateSubmitting ? "Submitting..." : "Submit For Approval"}
                    </button>
                  </form>
                  {walkinStatus && <p className="section-placeholder">{walkinStatus}</p>}
                </div>

                <div className="dashboard-section">
                  <h2>My Pending Walk-In Requests</h2>
                  {walkinPendingLoading && <p className="section-placeholder">Loading pending requests...</p>}
                  {!walkinPendingLoading && walkinPendingError && (
                    <p className="auth-help">
                      {walkinPendingError}{" "}
                      <button type="button" className="secondary-btn" onClick={loadPendingWalkinRequests}>
                        Retry
                      </button>
                    </p>
                  )}
                  {!walkinPendingLoading && walkinPendingRows.length === 0 && (
                    <p className="section-placeholder">No pending requests.</p>
                  )}
                  {!walkinPendingLoading && walkinPendingRows.length > 0 && (
                    <div className="table-shell">
                      <table className="sticky-table">
                        <thead>
                          <tr>
                            <th>Req ID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Contact</th>
                            <th>DOB</th>
                            <th>Stream</th>
                            <th>College</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {walkinPendingRows.map((row) => (
                            <tr key={`bde-pending-${row.id}`}>
                              <td>{row.id}</td>
                              <td>{row.name || "--"}</td>
                              <td>{row.email_id || "--"}</td>
                              <td>{row.contact_number || "--"}</td>
                              <td>{row.dob ? formatDate(row.dob) : "--"}</td>
                              <td>{row.stream || "--"}</td>
                              <td>{row.college_name || row.college_id || "--"}</td>
                              <td>{row.status || "--"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="dashboard-section">
                  <h2>My Rejected Walk-In Requests</h2>
                  {walkinPendingLoading && <p className="section-placeholder">Loading rejected requests...</p>}
                  {!walkinPendingLoading && walkinPendingError && (
                    <p className="auth-help">
                      {walkinPendingError}{" "}
                      <button type="button" className="secondary-btn" onClick={loadPendingWalkinRequests}>
                        Retry
                      </button>
                    </p>
                  )}
                  {!walkinPendingLoading && walkinRejectedRows.length === 0 && (
                    <p className="section-placeholder">No rejected requests.</p>
                  )}
                  {!walkinPendingLoading && walkinRejectedRows.length > 0 && (
                    <div className="table-shell">
                      <table className="sticky-table">
                        <thead>
                          <tr>
                            <th>Req ID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Contact</th>
                            <th>DOB</th>
                            <th>Stream</th>
                            <th>College</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {walkinRejectedRows.map((row) => (
                            <tr key={`bde-rejected-${row.id}`}>
                              <td>{row.id}</td>
                              <td>{row.name || "--"}</td>
                              <td>{row.email_id || "--"}</td>
                              <td>{row.contact_number || "--"}</td>
                              <td>{row.dob ? formatDate(row.dob) : "--"}</td>
                              <td>{row.stream || "--"}</td>
                              <td>{row.college_name || row.college_id || "--"}</td>
                              <td>{row.status || "--"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeSection === "colleges" && (
              <div className="dashboard-section" id="bde-colleges">
                <h2>College Management</h2>
                <form className="form-row bde-college-form" onSubmit={handleCreateCollege}>
                  <input
                    type="text"
                    placeholder="Enter college name"
                    value={newCollegeName}
                    onChange={(event) => setNewCollegeName(event.target.value)}
                  />
                  <button type="submit" className="bde-primary-action" disabled={collegeCreateSubmitting}>
                    {collegeCreateSubmitting ? "Saving..." : "Add College"}
                  </button>
                </form>
                {collegeActionStatus && <p className="section-placeholder">{collegeActionStatus}</p>}
                {collegeError && <p className="auth-help">{collegeError}</p>}
                <div className="table-shell">
                  <table className="sticky-table">
                    <thead>
                      <tr>
                        <th>S.No</th>
                        <th>College ID</th>
                        <th>College Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCollegeOptions.length === 0 && (
                        <tr>
                          <td colSpan="3" style={{ textAlign: "center" }}>No colleges found</td>
                        </tr>
                      )}
                      {filteredCollegeOptions.map((college, index) => (
                        <tr key={`bde-college-${college.college_id}`}>
                          <td>{index + 1}</td>
                          <td>{college.college_id}</td>
                          <td>{college.college_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeSection === "students" && (
              <div className="dashboard-section">
                <h2>Student Profiles</h2>
                {loading && <p className="section-placeholder">Loading students...</p>}
                {!loading && error && <p className="auth-help">{error}</p>}
                {!loading && !error && !selectedStudent && (
                  <>
                    <div className="table-toolbar">
                      <input
                        type="text"
                        placeholder="Search by id, name, email"
                        value={studentSearch}
                        onChange={(event) => setStudentSearch(event.target.value)}
                      />
                      <select
                        value={studentTypeFilter}
                        onChange={(event) => setStudentTypeFilter(event.target.value)}
                      >
                        <option value="ALL">All Types</option>
                        {studentTypeOptions.map((type) => (
                          <option key={`bde-type-${type}`} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                      <select
                        value={studentCourseFilter}
                        onChange={(event) => setStudentCourseFilter(event.target.value)}
                      >
                        <option value="ALL">All Courses</option>
                        {studentCourseOptions.map((course) => (
                          <option key={`bde-course-${course}`} value={course}>
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
                            <th>Status</th>
                            <th>View Profile</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEnrolledStudents.length === 0 && (
                            <tr>
                              <td colSpan="8" style={{ textAlign: "center" }}>No students found</td>
                            </tr>
                          )}
                          {filteredEnrolledStudents.map((student, index) => (
                            <tr
                              key={`bde-student-all-${student.student_id}`}
                              className={String(student.student_status || student.status || "").toUpperCase() === "INACTIVE" ? "student-row-inactive" : ""}
                            >
                              <td>{index + 1}</td>
                              <td>{student.student_id}</td>
                              <td>{student.name || "--"}</td>
                              <td>{student.email_id || "--"}</td>
                              <td>{student.course || "--"}</td>
                              <td>{normalizeStudentTypeLabel(student.student_type)}</td>
                              <td>{normalizeStudentStatusLabel(student.student_status || student.status)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="view-btn"
                                  onClick={() => {
                                    setSelectedStudent(student);
                                    setShowSelectedStudentPassword(false);
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
                {!loading && !error && selectedStudent && (
                  <div className="dashboard-section profile-section">
                    <div className="profile-header-row">
                      <h2>Student Profile</h2>
                      <button
                        type="button"
                        className="profile-back-btn"
                        onClick={() => {
                          setSelectedStudent(null);
                          setShowSelectedStudentPassword(false);
                        }}
                      >
                        Back to Student List
                      </button>
                    </div>
                    <div className="profile-grid">
                      <div className="profile-item">
                        <span className="profile-label">Student ID</span>
                        <span className="profile-value">{selectedStudent.student_id || "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Name</span>
                        <span className="profile-value">{selectedStudent.name || "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Email</span>
                        <span className="profile-value">{selectedStudent.email_id || "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Password</span>
                        <span className="profile-value">
                          {selectedStudent.password ? (
                            <button
                              type="button"
                              className="password-toggle"
                              onClick={() => setShowSelectedStudentPassword((prev) => !prev)}
                            >
                              <span className="password-mask">
                                {showSelectedStudentPassword ? selectedStudent.password : "••••••••"}
                              </span>
                              <span className="password-label">
                                {showSelectedStudentPassword ? "Hide" : "Show"}
                              </span>
                            </button>
                          ) : (
                            "--"
                          )}
                        </span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Contact</span>
                        <span className="profile-value">{selectedStudent.contact_number || "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">DOB</span>
                        <span className="profile-value">{selectedStudent.dob ? formatDate(selectedStudent.dob) : "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Course</span>
                        <span className="profile-value">{selectedStudent.course || "--"}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Student Type</span>
                        <span className="profile-value">{normalizeStudentTypeLabel(selectedStudent.student_type)}</span>
                      </div>
                      <div className="profile-item">
                        <span className="profile-label">Status</span>
                        <span className="profile-value">
                          {normalizeStudentStatusLabel(selectedStudent.student_status || selectedStudent.status)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === "results" && (
              <div className="dashboard-section" id="bde-candidate-results">
                <div className="walkin-results-head">
                  <h2>Candidate Results</h2>
                </div>
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
                      <option key={`bde-wr-stream-${stream}`} value={stream}>
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
                      <option key={`bde-wr-exam-${examId}`} value={examId}>
                        Exam {examId}
                      </option>
                    ))}
                  </select>
                </div>
                {walkinResultsLoading && <p className="section-placeholder">Loading candidate results...</p>}
                {walkinResultsError && <p className="auth-help">{walkinResultsError}</p>}
                {walkinResults && walkinResultsRows.length === 0 && !walkinResultsLoading && !walkinResultsError && (
                  <p className="section-placeholder">No candidate results available yet.</p>
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
                          const hideCodingForStream = isDataAnalyticsStream(row.stream);
                          const codingTotal =
                            Number(row.coding_easy_marks || 0) +
                            Number(row.coding_medium_marks || 0) +
                            Number(row.coding_hard_marks || 0);
                          return (
                            <tr key={`bde-result-${row.student_id}-${row.exam_id}`}>
                              <td>{row.student_id}</td>
                              <td>{row.name || "--"}</td>
                              <td>{row.stream || "--"}</td>
                              <td>{row.exam_id}</td>
                              <td>{Number(row.aptitude_marks || 0).toFixed(2)}</td>
                              <td>{Number(row.technical_marks || 0).toFixed(2)}</td>
                              <td>{hideCodingForStream ? "N/A" : codingTotal.toFixed(2)}</td>
                              <td>{Number(row.total_marks || 0).toFixed(2)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="view-btn"
                                  onClick={() => openWalkinReview(row)}
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
              </div>
            )}

            {activeSection === "result-review" && (
              <div className="dashboard-section" id="bde-result-review">
                <div className="walkin-review-head">
                  <div className="walkin-review-topline">
                    <button type="button" className="small-outline-btn" onClick={closeWalkinReview}>
                      Back to Candidate Results
                    </button>
                    <h2>
                      {walkinReviewData?.student?.name || "Candidate"} - Exam {walkinReviewData?.exam_id || "--"}
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

                {walkinReviewLoading && <p className="section-placeholder">Loading review...</p>}
                {walkinReviewError && <p className="auth-help">{walkinReviewError}</p>}
                {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "summary" && !reviewSummary && (
                  <p className="section-placeholder">No summary found for this attempt.</p>
                )}
                {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "marks" && reviewAnswers.length === 0 && (
                  <p className="section-placeholder">No answers found for this attempt.</p>
                )}
                {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "feedback" && !reviewFeedbackText && (
                  <p className="section-placeholder">No feedback submitted by this candidate.</p>
                )}

                <div className="walkin-review-list">
                  {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "summary" && reviewSummary && (
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
                                <div className="summary-score-card summary-score-card-coding-level" key={`bde-coding-level-${level.name}`}>
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
                            <div className="summary-narrative-item" key={`bde-summary-line-${index}`}>
                              <p className="summary-narrative-label">{section.label}</p>
                              <ul className="summary-narrative-points">
                                {section.points.map((point, pointIndex) => (
                                  <li className="summary-narrative-body" key={`bde-summary-line-${index}-point-${pointIndex}`}>
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

                  {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "marks" && reviewAnswers.map((answer, index) => (
                    <div className="walkin-review-card" key={`bde-answer-${answer.submission_id || `${answer.question_id}-${index}`}`}>
                      <p className="item-meta">
                        {answer.section_label || "Unknown"} | Question {index + 1} | Marks: {Number(answer.marks_obtained || 0).toFixed(2)} / {Number(answer.full_marks || 0).toFixed(2)}
                      </p>
                      <p className="item-text">{answer.question_text || "Question text unavailable"}</p>
                      {answer.question_type === "MCQ" && renderWalkinOptions(answer)}
                      {answer.question_type === "Descriptive" && (
                        <>
                          <p className="item-answer item-answer-student">Student answer: {answer.descriptive_answer || "-"}</p>
                          <p className="item-answer item-answer-reference">Reference answer: {answer.reference_descriptive_answer || "-"}</p>
                        </>
                      )}
                      {answer.question_type === "Coding" && (
                        <>
                          <p className="item-answer">Passed testcases: {Number(answer.testcases_passed || 0)} / {Number(answer.total_testcases || 0)}</p>
                          <pre className="walkin-code-block">{answer.code || "--"}</pre>
                        </>
                      )}
                    </div>
                  ))}

                  {!walkinReviewLoading && !walkinReviewError && walkinReviewView === "feedback" && reviewFeedbackText && (
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
                      {reviewFeedbackQuestion && (
                        <div className="walkin-feedback-question-block">
                          <p className="walkin-feedback-label">Prompt</p>
                          <p className="item-answer item-answer-reference">{reviewFeedbackQuestion}</p>
                        </div>
                      )}
                      <div className="walkin-feedback-response-block">
                        <p className="item-answer item-answer-student">"{reviewFeedbackText}"</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSection === "profile" && (
              <div className="dashboard-section profile-section">
                <h2>My Profile</h2>
                <div className="profile-grid">
                  <div className="profile-item">
                    <span className="profile-label">BDE ID</span>
                    <span className="profile-value">{bdeProfile.bde_id || adminId || "--"}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Name</span>
                    <span className="profile-value">{bdeProfile.name || adminDisplayName || "--"}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Email</span>
                    <span className="profile-value">{bdeProfile.email || "--"}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Phone</span>
                    <span className="profile-value">{bdeProfile.phone_number || "--"}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Role</span>
                    <span className="profile-value">Business Development Executive</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Total Enrolled</span>
                    <span className="profile-value">{loading ? "..." : totalEnrolled}</span>
                  </div>
                </div>
                <h3 className="profile-subtitle">Change Password</h3>
                <form className="form-row form-row-wide bde-password-form" onSubmit={handleChangePasswordSubmit}>
                  <div className="profile-item">
                    <span className="profile-label">Account</span>
                    <span className="profile-value">{bdeProfile.email || "Not available"}</span>
                  </div>
                  <div className="form-field">
                    <label htmlFor="bde-current-password">Current Password</label>
                    <input
                      id="bde-current-password"
                      type="password"
                      autoComplete="current-password"
                      value={passwordForm.currentPassword}
                      onChange={(event) => handlePasswordFormChange("currentPassword", event.target.value)}
                      disabled={passwordChangeSaving}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bde-new-password">New Password</label>
                    <input
                      id="bde-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={passwordForm.newPassword}
                      onChange={(event) => handlePasswordFormChange("newPassword", event.target.value)}
                      disabled={passwordChangeSaving}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bde-confirm-password">Confirm New Password</label>
                    <input
                      id="bde-confirm-password"
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
        <p className="dashboard-footer-copy">&copy; 2026 RP2 Inc. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default BdeDashboard;
