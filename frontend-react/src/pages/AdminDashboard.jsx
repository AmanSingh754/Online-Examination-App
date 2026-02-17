import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

const REGULAR_COURSES = [
  "BCA",
  "BSc CS",
  "BTech CS",
  "BTech IT",
  "MCA",
  "MSc CS",
  "MTech CS",
  "MTech IT"
];

const WALKIN_STREAMS = ["Data Science", "Data Analytics", "MERN"]
const WALKIN_OPTION_KEYS = [
  { key: "option_a", label: "A" },
  { key: "option_b", label: "B" },
  { key: "option_c", label: "C" },
  { key: "option_d", label: "D" }
];;

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

function AdminDashboard() {
  useBodyClass("dashboard admin-dashboard");

  const location = useLocation();
  const navigate = useNavigate();
  const adminId = (localStorage.getItem("adminId") || "").trim();
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
  const [totalExamCount, setTotalExamCount] = useState(0);
  const [totalActiveExamCount, setTotalActiveExamCount] = useState(0);
  const [recentResults, setRecentResults] = useState([]);
  const [students, setStudents] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [scheduleDurationMinutes, setScheduleDurationMinutes] = useState("");
  const [scheduleQuestionCount, setScheduleQuestionCount] = useState("");

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
    stream: ""
  });
  const [walkinStatus, setWalkinStatus] = useState("");
  const [walkinCredentials, setWalkinCredentials] = useState(null);
  const [walkinSheetData, setWalkinSheetData] = useState(null);
  const [walkinStreamTab, setWalkinStreamTab] = useState(WALKIN_STREAMS[0]);
  const [walkinSheetLoading, setWalkinSheetLoading] = useState(false);
  const [walkinSheetError, setWalkinSheetError] = useState("");
  const [walkinResults, setWalkinResults] = useState(null);
  const [walkinResultsLoading, setWalkinResultsLoading] = useState(false);
  const [walkinResultsError, setWalkinResultsError] = useState("");
  const [walkinRecomputeLoading, setWalkinRecomputeLoading] = useState(false);
  const [walkinRecomputeStatus, setWalkinRecomputeStatus] = useState("");
  const [walkinReviewData, setWalkinReviewData] = useState(null);
  const [walkinReviewLoading, setWalkinReviewLoading] = useState(false);
  const [walkinReviewError, setWalkinReviewError] = useState("");
  const [walkinResultsSearch, setWalkinResultsSearch] = useState("");
  const [walkinResultsStreamFilter, setWalkinResultsStreamFilter] = useState("ALL");
  const [walkinResultsExamFilter, setWalkinResultsExamFilter] = useState("ALL");
  const [walkinStudentsSearch, setWalkinStudentsSearch] = useState("");
  const [walkinStudentsStreamFilter, setWalkinStudentsStreamFilter] = useState("ALL");
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
  const [newCollegeName, setNewCollegeName] = useState("");
  const [collegeActionStatus, setCollegeActionStatus] = useState("");
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
  const [collegeOptions, setCollegeOptions] = useState([]);
  const [collegeError, setCollegeError] = useState("");
  const landingSection = location.state?.activeSection;

  const renderWalkinOptions = (item) => {
    const hasOptions = WALKIN_OPTION_KEYS.some(({ key }) => item[key]);
    if (!hasOptions) return null;
    return (
      <div className="walkin-options">
        {WALKIN_OPTION_KEYS.map(({ key, label }) =>
          item[key] ? (
            <p className="item-option" key={key}>
              <span className="option-label">{label}.</span>
              <span className="option-text">{item[key]}</span>
            </p>
          ) : null
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
  const [detailLoading, setDetailLoading] = useState(false);
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
    if (!adminId) {
      navigate("/admin/login");
      return;
    }
    loadDashboardStats();
    if (collegeId) {
      loadStudents();
    }
  }, [adminId, collegeId, navigate]);

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

  const loadStudentCount = async () => {
    try {
      const response = await fetch(`/admin/students/count/${collegeId}`);
      const data = await response.json();
      setStudentCount(Number(data.total || 0));
    } catch (err) {
      console.error("Load student count error:", err);
      setStudentCount(0);
    }
  };

  const loadTotalExamCount = async () => {
    try {
      const response = await fetch(`/admin/exams/count/${collegeId}`);
      const data = await response.json();
      setTotalExamCount(Number(data.total || 0));
    } catch (err) {
      console.error("Load exam count error:", err);
      setTotalExamCount(0);
    }
  };

  const loadTotalActiveExamCount = async () => {
    try {
      const response = await fetch(`/admin/exams/active-count/${collegeId}`);
      const data = await response.json();
      setTotalActiveExamCount(Number(data.total || 0));
    } catch (err) {
      console.error("Load active exam count error:", err);
      setTotalActiveExamCount(0);
    }
  };

  const loadRecentResults = async () => {
    try {
      const response = await fetch(`/admin/results/${collegeId}`);
      const data = await response.json();
      setRecentResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load results error:", err);
      setRecentResults([]);
    }
  };

  const viewResultDetail = async (result) => {
    if (!result?.result_id) return;
    setDetailLoading(true);
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
      setDetailLoading(false);
    }
  };

  const loadStudents = async () => {
    try {
      const response = await fetch(`/admin/students/${collegeId}`);
      const data = await response.json();
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load students error:", err);
      setStudents([]);
    }
  };

  const loadCollegeList = useCallback(async () => {
    setCollegeListLoading(true);
    setCollegeListError("");
    try {
      const response = await fetch("/admin/colleges");
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load colleges");
      }
      const rows = Array.isArray(data.colleges) ? data.colleges : [];
      setCollegeList(rows);
      setCollegeOptions(rows);
    } catch (error) {
      console.error("Admin college list error:", error);
      setCollegeListError(error.message || "Could not load colleges");
      setCollegeList([]);
    } finally {
      setCollegeListLoading(false);
    }
  }, []);

  const loadDashboardStats = async () => {
    try {
      const response = await fetch(`/admin/dashboard-stats?t=${Date.now()}`, {
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load dashboard stats");
      }
      setStudentCount(Number(data.studentCount || 0));
      setTotalExamCount(Number(data.totalExamCount || 0));
      setTotalActiveExamCount(Number(data.totalActiveExamCount || 0));
      setRecentResults(Array.isArray(data.recentResults) ? data.recentResults : []);
    } catch (err) {
      console.error("Load dashboard stats error:", err);
      try {
        const [studentsResp, examsResp, activeResp, resultsResp] = await Promise.all([
          fetch(`/admin/students/count/${collegeId}`),
          fetch(`/admin/exams/count/${collegeId}`),
          fetch(`/admin/exams/active-count/${collegeId}`),
          fetch(`/admin/results/${collegeId}`)
        ]);

        const studentsData = await studentsResp.json();
        const examsData = await examsResp.json();
        const activeData = await activeResp.json();
        const resultsData = await resultsResp.json();

        setStudentCount(Number(studentsData.total || 0));
        setTotalExamCount(Number(examsData.total || 0));
        setTotalActiveExamCount(Number(activeData.total || 0));
        setRecentResults(Array.isArray(resultsData) ? resultsData : []);
      } catch (fallbackError) {
        console.error("Load dashboard fallback error:", fallbackError);
        setStudentCount(0);
        setTotalExamCount(0);
        setTotalActiveExamCount(0);
        setRecentResults([]);
      }
    }
  };

  const handleWalkinCreation = async (event) => {
    event.preventDefault();
    setWalkinStatus("");
    setWalkinCredentials(null);

    if (!walkinForm.name || !walkinForm.email || !walkinForm.phone || !walkinForm.dob || !walkinForm.stream) {
      setWalkinStatus("Fill all walk-in student details.");
      return;
    }
    if (!collegeId) {
      setWalkinStatus("Select a college before creating a walk-in student.");
      return;
    }

    try {
      const response = await fetch("/admin/students/walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: walkinForm.name,
          email: walkinForm.email,
          phone: walkinForm.phone,
          dob: walkinForm.dob,
          course: walkinForm.stream,
          collegeId
        })
      });
      const data = await response.json();
      if (!data.success) {
        setWalkinStatus(data.message || "Failed to create walk-in student.");
        return;
      }

      setWalkinStatus("Walk-in student created. Credentials generated automatically.");
      setWalkinCredentials(data.credentials);
      setWalkinForm({ name: "", email: "", phone: "", dob: "", stream: "" });
      loadStudents();
    } catch (err) {
      console.error("Walk-in creation error:", err);
      setWalkinStatus("Server error while creating walk-in student.");
    }
  };

  const handleRegularCreation = async (event) => {
    event.preventDefault();
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
      setRegularForm((prev) => ({
        ...prev,
        name: "",
        email: "",
        phone: "",
        dob: "",
        course: "",
        password: ""
      }));
      loadStudents();
    } catch (err) {
      console.error("Regular creation error:", err);
      setRegularStatus("Server error while creating regular student.");
    }
  };

  const loadExams = async () => {
    try {
      const response = await fetch(`/admin/exams`);
      const data = await response.json();
      setExams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load exams error:", err);
      setExams([]);
    }
  };

  const handleCreateExam = async (event) => {
    event.preventDefault();

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
    if (!scheduleDurationMinutes || Number(scheduleDurationMinutes) <= 0) {
      alert("Enter a valid duration in minutes");
      return;
    }
    if (!scheduleQuestionCount || Number(scheduleQuestionCount) <= 0) {
      alert("Enter a valid number of questions");
      return;
    }
    payload.course = course;
    payload.startDate = scheduleStartDate;
    payload.startTime = scheduleStartTime;
    payload.cutoff = cutoff;
    payload.durationMinutes = scheduleDurationMinutes;
    payload.questionCount = scheduleQuestionCount;

    await fetch("/admin/exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCourseSelect("");
    setCustomCourse("");
    setScheduleStartDate("");
    setScheduleStartTime("");
    setCutoff("");
    setScheduleDurationMinutes("");
    setScheduleQuestionCount("");
    loadExams();
  };

  const handleDeleteExam = async (examId) => {
    const confirmed = await openConfirmDialog({
      title: "Delete this exam?",
      message: "This will permanently remove this exam and all linked questions.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!confirmed) return;
    await fetch(`/admin/exam/${examId}`, { method: "DELETE" });
    loadExams();
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
    if (!collegeId) return;
    setWalkinResultsLoading(true);
    setWalkinResultsError("");
    try {
      const response = await fetch(`/admin/walkin/final-results/${collegeId}?t=${Date.now()}`, { cache: "no-store" });
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
  }, [collegeId]);

  const recomputeWalkinResults = async () => {
    if (!collegeId) return;
    setWalkinRecomputeLoading(true);
    setWalkinRecomputeStatus("");
    try {
      const response = await fetch("/admin/walkin/final-results/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: Number(collegeId) || collegeId })
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
    setCollegeActionStatus("");
    const collegeName = newCollegeName.trim();
    if (!collegeName) {
      setCollegeActionStatus("Enter a college name.");
      return;
    }
    try {
      const response = await fetch("/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeName })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not create college");
      }
      setNewCollegeName("");
      setCollegeActionStatus("College created.");
      await loadCollegeList();
    } catch (error) {
      setCollegeActionStatus(error.message || "Could not create college");
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
      setCollegeActionStatus("College updated.");
      cancelCollegeRename();
      await loadCollegeList();
    } catch (error) {
      setCollegeActionStatus(error.message || "Could not update college");
    }
  };

  const openWalkinReview = async (studentId, examId) => {
    if (!collegeId) return;
    setWalkinReviewLoading(true);
    setWalkinReviewError("");
    setWalkinReviewData(null);
    try {
      const response = await fetch(
        `/admin/walkin/review/${collegeId}/${studentId}/${examId}?t=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load answer review");
      }
      setWalkinReviewData(data);
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
    setActiveSection("walkin-results");
  };

  useEffect(() => {
    if (activeSection === "walkin-questions" && !walkinSheetLoading && !walkinSheetData) {
      fetchWalkinSheet();
    }
  }, [activeSection, fetchWalkinSheet, walkinSheetData, walkinSheetLoading]);

  useEffect(() => {
    if (activeSection === "walkin-results" && !walkinResultsLoading && walkinResults === null) {
      fetchWalkinResults();
    }
  }, [activeSection, fetchWalkinResults, walkinResults, walkinResultsLoading]);

  useEffect(() => {
    if (activeSection === "colleges" && !collegeListLoading && collegeList.length === 0) {
      loadCollegeList();
    }
  }, [activeSection, collegeListLoading, collegeList.length, loadCollegeList]);

  const activeExams = totalActiveExamCount;
  const activeExamsPercent = toPercent(activeExams, totalExamCount || 1);
  const isDashboardView = !showProfile && activeSection === "dashboard";
  const walkinStudents = students.filter((student) => student.student_type === "WALKIN");
  const regularStudents = students.filter((student) => student.student_type === "REGULAR");
  const reviewAnswers = walkinReviewData?.answers || [];
  const reviewSummary = String(walkinReviewData?.performance_summary || "")
    .replace(/Main weak area:[^.]*\.?/gi, "")
    .trim();
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
    });
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
    const now = Date.now();

    const runningByCourse = new Map();
    (exams || []).forEach((exam) => {
      const statusReady = normalizeExamStatus(exam.exam_status) === "READY";
      const startMs = exam.start_at ? new Date(exam.start_at).getTime() : NaN;
      const endMs = exam.end_at ? new Date(exam.end_at).getTime() : NaN;
      const hasValidWindow = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs;
      const isRunning = hasValidWindow && now >= startMs && now <= endMs;
      if (!statusReady || !isRunning) return;

      const courseKey = String(exam.course || "").trim().toLowerCase();
      const existing = runningByCourse.get(courseKey);
      if (!existing || Number(exam.exam_id || 0) > Number(existing.exam_id || 0)) {
        runningByCourse.set(courseKey, exam);
      }
    });

    return Array.from(runningByCourse.values())
      .filter((exam) => {
        const matchQuery =
          !query ||
          String(exam.exam_id || "").toLowerCase().includes(query) ||
          String(exam.course || "").toLowerCase().includes(query);
        return matchQuery;
      })
      .sort((a, b) => Number(b.exam_id || 0) - Number(a.exam_id || 0));
  }, [exams, examListSearch, examListStatusFilter]);
  const studentProfileCourseOptions = useMemo(() => {
    return [...new Set((students || []).map((student) => String(student.course || "")).filter(Boolean))];
  }, [students]);
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
              <img src="/image.png" alt="RP2 Rounded Professional Program" />
            </div>
          </div>
        <div className="topbar-actions">
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
          <span className="nav-group">Exam Management</span>
          {!showProfile && (
              <>
                <button
                  type="button"
                  className={`nav-button ${activeSection === "create-exam" ? "active" : ""}`}
                  onClick={() => handleSectionClick("create-exam")}
                >
                  Create/View Exams
                </button>
              </>
            )}
          <span className="nav-group">Walk-In Students</span>
          <button
            type="button"
            className={`nav-button ${activeSection === "walkin" ? "active" : ""}`}
            onClick={() => handleSectionClick("walkin")}
          >
            Walk-In Management
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
          <span className="nav-group">Regular Students</span>
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
          <span className="nav-group">Account</span>
          <button
            type="button"
            className={`nav-button ${showProfile ? "active" : ""}`}
            onClick={handleProfileClick}
          >
            Profile
          </button>
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
        </nav>

        <div className="sidebar-footer">
          <p>Need help? support@examportal</p>
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
                    <div className="stat-card">
                      <span className="stat-label">Total Students</span>
                      <span className="stat-value">{studentCount}</span>
                      <span className="stat-meta">Registered learners</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Walk-In Students</span>
                      <span className="stat-value">{walkinStudents.length}</span>
                      <span className="stat-meta">Walk-in profiles</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Active Exams</span>
                      <span className="stat-value">{activeExams}</span>
                      <span className="stat-meta">Ready to attempt</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Total Exams</span>
                      <span className="stat-value">{totalExamCount}</span>
                      <span className="stat-meta">Across all courses/streams</span>
                    </div>
                  </div>
                  <div className="chart-stack">
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3>Regular vs Walk-In</h3>
                        <span>{studentCount} total</span>
                      </div>
                      <div className="chart-canvas chart-canvas-compact">
                        <div className="donut-wrap">
                          <div
                            className="donut-chart"
                            style={{ "--donut-percent": `${toPercent(regularStudents.length, studentCount || 1)}%` }}
                          >
                            <div className="donut-center">
                              <p className="donut-value">{regularStudents.length}</p>
                              <p className="donut-label">Regular</p>
                            </div>
                          </div>
                          <p className="donut-meta">
                            {walkinStudents.length} walk-in ({toPercent(walkinStudents.length, studentCount || 1).toFixed(0)}%)
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="chart-row">
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Active Exams (Ready)</h3>
                          <span>{activeExams} total</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <div className="progress-wrap">
                            <div className="progress-track">
                              <div className="progress-fill progress-fill-exams" style={{ width: `${activeExamsPercent}%` }} />
                            </div>
                            <p className="progress-label">
                              {activeExams} of {totalExamCount} exams ready ({activeExamsPercent.toFixed(0)}%)
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Registered Students</h3>
                          <span>{studentCount} total</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <div className="kpi-wrap">
                            <p className="kpi-value">{studentCount}</p>
                            <p className="kpi-label">Total Registered Students</p>
                            <div className="kpi-split">
                              <span>Regular: {regularStudents.length}</span>
                              <span>Walk-In: {walkinStudents.length}</span>
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
                          <th>Easy Coding</th>
                          <th>Medium Coding</th>
                          <th>Hard Coding</th>
                          <th>Total (50)</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walkinResultsRows.map((row) => (
                          <tr key={`${row.student_id}-${row.exam_id}`}>
                            <td>{row.student_id}</td>
                            <td>{row.name || "--"}</td>
                            <td>{row.stream || "--"}</td>
                            <td>{row.exam_id}</td>
                            <td>{Number(row.aptitude_marks || 0).toFixed(2)}</td>
                            <td>{Number(row.technical_marks || 0).toFixed(2)}</td>
                            <td>{Number(row.coding_easy_marks || 0).toFixed(2)}</td>
                            <td>{Number(row.coding_medium_marks || 0).toFixed(2)}</td>
                            <td>{Number(row.coding_hard_marks || 0).toFixed(2)}</td>
                            <td>{Number(row.total_marks || 0).toFixed(2)}</td>
                            <td>
                              <button
                                type="button"
                                className="view-btn"
                                onClick={() => openWalkinReview(row.student_id, row.exam_id)}
                                disabled={walkinReviewLoading}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
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
                    <button type="button" className="small-outline-btn" onClick={closeWalkinReview}>
                      Back to Walk-In Results
                    </button>
                    <h2>
                      {walkinReviewData?.student?.name || "Student"} - Exam {walkinReviewData?.exam_id || "--"}
                    </h2>
                  </div>
                  {walkinReviewLoading && renderTableSkeleton(4)}
                  {walkinReviewError && <p className="auth-help">{walkinReviewError}</p>}
                  {!walkinReviewLoading && !walkinReviewError && reviewAnswers.length === 0 && (
                    <p className="section-placeholder">No answers found for this attempt.</p>
                  )}
                  {reviewAnswers.length > 0 && (
                    <div className="walkin-review-list">
                      {reviewSummary && (
                        <div className="walkin-review-card walkin-review-summary">
                          <p className="item-meta">{reviewSummaryTitle}</p>
                          {reviewSummaryBody && <p className="item-answer">{reviewSummaryBody}</p>}
                        </div>
                      )}
                      {reviewAnswers.map((reviewQuestion, index) => (
                        <div className="walkin-review-card" key={`review-${reviewQuestion.submission_id}`}>
                          <p className="item-meta">
                            {reviewQuestion.section_label} | Question {index + 1} | Marks: {Number(reviewQuestion.marks_obtained || 0).toFixed(2)} / {Number(reviewQuestion.full_marks || 0).toFixed(2)}
                          </p>
                          <p className="item-text">{reviewQuestion.question_text || "Question text unavailable"}</p>

                          {reviewQuestion.question_type === "MCQ" && (
                            <>
                              {renderWalkinOptions(reviewQuestion)}
                              <p className="item-answer">Selected: {reviewQuestion.selected_option || "No option selected"}</p>
                              <p className="item-answer">Correct: {reviewQuestion.correct_option || "-"}</p>
                              <p className="item-answer">
                                Verdict: {reviewQuestion.selected_option && reviewQuestion.correct_option && reviewQuestion.selected_option === reviewQuestion.correct_option ? "Right" : "Wrong"}
                              </p>
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
                    </div>
                  )}
                </div>
              )}
              {activeSection === "walkin-questions" && (
                <div className="dashboard-section admin-section" id="walkin-questions">
                  <h2>Walk-In Questions Sheet</h2>
                  {walkinSheetLoading && renderTableSkeleton(8)}
                  {walkinSheetError && <p className="auth-help">{walkinSheetError}</p>}
                  {walkinSheetData && (
                    <div className="walkin-sheet-grid">
                      <div className="walkin-sheet-block">
                        <h3>Aptitude Questions</h3>
                        {walkinSheetData.aptitude.length === 0 && <p>No aptitude questions defined.</p>}
                        {walkinSheetData.aptitude.map((q) => (
                          <div className="walkin-sheet-item" key={`aptitude-${q.question_id}`}>
                            <p className="item-meta">Marks: {q.marks ?? 1}</p>
                            <p className="item-text">{q.question_text}</p>
                            {renderWalkinOptions(q)}
                            <p className="item-answer">Answer: {q.correct_option || "-"}</p>
                          </div>
                        ))}
                      </div>
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
                            <div className="walkin-sheet-item" key={`stream-${walkinStreamTab}-${row.question_id}`}
                              >
                              <p class="item-meta">{row.section_name}  Marks: {row.marks ?? 1}</p>
                              <p class="item-text">{row.question_text}</p>
                              {row.question_type?.toLowerCase() === "mcq" && renderWalkinOptions(row)}
                              {row.question_type?.toLowerCase() === "mcq" && (
                                <p class="item-answer">Answer: {row.correct_option || "-"}</p>
                              )}
                              {row.descriptive_answer && (
                                <p class="item-answer">Sample solution: {row.descriptive_answer}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="walkin-sheet-block">
                        <h3>Coding Questions</h3>
                        {(walkinSheetData.coding || []).length === 0 && <p>No coding questions defined.</p>}
                        {(walkinSheetData.coding || []).map((row) => (
                          <div className="walkin-sheet-item" key={`coding-${row.question_id}`}>
                            <p className="item-meta">Marks: {row.marks ?? 1}</p>
                            <p className="item-text">{row.question_text}</p>
                          </div>
                        ))}
                      </div>
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
                        <th>Date</th>
                        <th>Course</th>
                        <th>Marks</th>
                        <th>Result</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegularResults.length === 0 && (
                        <tr>
                          <td colSpan="8" style={{ textAlign: "center" }}>No results found</td>
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
                        const resultLabel = result.pass_fail || result.result_status || "PENDING";

                        return (
                          <tr key={result.result_id}>
                            <td>{result.result_id}</td>
                            <td>{result.student_name || result.student_id}</td>
                            <td>{result.exam_name || result.exam_id}</td>
                            <td>
                              {result.exam_start_date && result.exam_end_date
                                ? `${new Date(result.exam_start_date).toLocaleDateString()}  to ${new Date(result.exam_end_date).toLocaleDateString()}`
                                : "--"}
                            </td>
                            <td>{result.course}</td>
                            <td>{marksText}</td>
                            <td>
                              <span className={resultLabel === "PASS" ? "status-active" : "status-inactive"}>
                                {resultLabel}
                              </span>
                            </td>
                            <td>{result.attempt_status}</td>
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
                <div className="dashboard-section admin-section" id="walkin-create">
                  <h2>Create Walk-In Student Account</h2>
                  <form className="form-row form-row-wide" onSubmit={handleWalkinCreation}>
                    <div className="form-field">
                      <label>Full Name</label>
                      <input
                        type="text"
                        placeholder="Enter full name"
                        value={walkinForm.name}
                        onChange={(event) => setWalkinForm({ ...walkinForm, name: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Email</label>
                      <input
                        type="email"
                        placeholder="Enter email"
                        value={walkinForm.email}
                        onChange={(event) => setWalkinForm({ ...walkinForm, email: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Phone Number</label>
                      <input
                        type="text"
                        placeholder="Enter contact number"
                        value={walkinForm.phone}
                        onChange={(event) => setWalkinForm({ ...walkinForm, phone: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Date of Birth</label>
                      <input
                        type="date"
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
                    <button type="submit">Create Walk-In Account</button>
                  </form>
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
                  <h2>Walk-In Students</h2>
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
                      <th>Student ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Contact</th>
                      <th>DOB</th>
                      <th>Specialization</th>
                      <th>Password</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                    </thead>
                    <tbody>
                      {filteredWalkinStudents.length === 0 && (
                        <tr>
                          <td colSpan="9" style={{ textAlign: "center" }}>No walk-in students found</td>
                        </tr>
                      )}
                      {filteredWalkinStudents.map((student) => {
                        const passwordRevealed = Boolean(revealedPasswords[student.student_id]);
                        const isUpdating = Boolean(walkinStatusUpdating[student.student_id]);
                        const statusLabel = student.student_status || "ACTIVE";
                        const buttonLabel = statusLabel === "ACTIVE" ? "Deactivate" : "Activate";
                        return (
                          <tr
                            key={student.student_id}
                            className={statusLabel === "INACTIVE" ? "student-row-inactive" : ""}
                          >
                            <td>{student.student_id}</td>
                            <td>{student.name}</td>
                            <td>{student.email_id}</td>
                            <td>{student.contact_number}</td>
                            <td>
                              {student.dob ? new Date(student.dob).toLocaleDateString() : "--"}
                            </td>
                            <td>{student.course}</td>
                            <td>
                              {student.password ? (
                                <button
                                  type="button"
                                  className="password-toggle"
                                  onClick={() => toggleWalkinPassword(student.student_id)}
                                >
                                  <span className="password-mask">
                                    {passwordRevealed ? student.password : "********"}
                                  </span>
                                  <span className="password-label">
                                    {passwordRevealed ? "Hide" : "Show"}
                                  </span>
                                </button>
                              ) : (
                                "Not set"
                              )}
                            </td>
                            <td>
                              <span className={"status-badge " + statusLabel.toLowerCase()}>
                                {statusLabel}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="status-action"
                                disabled={isUpdating}
                                onClick={() => handleWalkinStatusToggle(student.student_id, statusLabel)}
                              >
                                {isUpdating ? "Updating..." : buttonLabel}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
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
                        {collegeOptions.map((college) => (
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
                        placeholder="Enter email"
                        autoComplete="off"
                        value={regularForm.email}
                        onChange={(event) => setRegularForm({ ...regularForm, email: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Phone Number</label>
                      <input
                        type="text"
                        placeholder="Enter contact number"
                        value={regularForm.phone}
                        onChange={(event) => setRegularForm({ ...regularForm, phone: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Date of Birth</label>
                      <input
                        type="date"
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
                      <label>Password</label>
                      <input
                        type="password"
                        placeholder="Set password"
                        autoComplete="new-password"
                        value={regularForm.password}
                        onChange={(event) => setRegularForm({ ...regularForm, password: event.target.value })}
                      />
                    </div>
                    <button type="submit">Create Regular Account</button>
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
                  <h2>Regular Students</h2>
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
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Contact</th>
                        <th>DOB</th>
                        <th>Course</th>
                        <th>Password</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegularStudents.length === 0 && (
                        <tr>
                          <td colSpan="9" style={{ textAlign: "center" }}>No regular students found</td>
                        </tr>
                      )}
                      {filteredRegularStudents.map((student) => {
                        const passwordRevealed = Boolean(revealedPasswords[student.student_id]);
                        const isUpdating = Boolean(walkinStatusUpdating[student.student_id]);
                        const statusLabel = student.student_status || "ACTIVE";
                        const buttonLabel = statusLabel === "ACTIVE" ? "Deactivate" : "Activate";
                        return (
                          <tr
                            key={student.student_id}
                            className={statusLabel === "INACTIVE" ? "student-row-inactive" : ""}
                          >
                            <td>{student.student_id}</td>
                            <td>{student.name}</td>
                            <td>{student.email_id}</td>
                            <td>{student.contact_number}</td>
                            <td>{student.dob ? new Date(student.dob).toLocaleDateString() : "--"}</td>
                            <td>{student.course}</td>
                            <td>
                              {student.password ? (
                                <button
                                  type="button"
                                  className="password-toggle"
                                  onClick={() => toggleWalkinPassword(student.student_id)}
                                >
                                  <span className="password-mask">
                                    {passwordRevealed ? student.password : "********"}
                                  </span>
                                  <span className="password-label">
                                    {passwordRevealed ? "Hide" : "Show"}
                                  </span>
                                </button>
                              ) : (
                                "Not set"
                              )}
                            </td>
                            <td>
                              <span className={"status-badge " + statusLabel.toLowerCase()}>
                                {statusLabel}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="status-action"
                                disabled={isUpdating}
                                onClick={() => handleWalkinStatusToggle(student.student_id, statusLabel)}
                              >
                                {isUpdating ? "Updating..." : buttonLabel}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              </>
              )}

              {activeSection === "students" && (
              <div className="dashboard-section admin-section" id="admin-students">
                <h2>Student Profiles</h2>
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
                      <th>Contact</th>
                      <th>DOB</th>
                      <th>Course</th>
                      <th>Student Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudentProfiles.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ textAlign: "center" }}>No students found</td>
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
                        <td>{student.contact_number}</td>
                        <td>
                          {student.dob
                            ? new Date(student.dob).toLocaleDateString()
                            : "--"}
                        </td>
                        <td>{student.course}</td>
                        <td>
                          <span className={`status-${student.student_type === "WALKIN" ? "active" : "inactive"}`}>
                            {student.student_type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
              )}

              {activeSection === "colleges" && (
              <div className="dashboard-section admin-section" id="admin-colleges">
                <h2>Colleges</h2>
                <form className="form-row form-row-wide" onSubmit={handleCreateCollege}>
                  <div className="field-block">
                    <label htmlFor="newCollegeName">College Name</label>
                    <input
                      id="newCollegeName"
                      type="text"
                      placeholder="Enter college name"
                      value={newCollegeName}
                      onChange={(event) => setNewCollegeName(event.target.value)}
                    />
                  </div>
                  <button type="submit">Add College</button>
                </form>
                {collegeActionStatus && <p className="section-placeholder">{collegeActionStatus}</p>}
                {collegeListError && <p className="auth-help">{collegeListError}</p>}
                {collegeListLoading && renderTableSkeleton(5)}
                {!collegeListLoading && (
                  <div className="table-shell" aria-label="Colleges table container">
                    <table className="sticky-table" aria-label="Colleges table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Name</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {collegeList.length === 0 && (
                          <tr>
                            <td colSpan="3" style={{ textAlign: "center" }}>No colleges found</td>
                          </tr>
                        )}
                        {collegeList.map((college) => (
                          <tr key={`college-${college.college_id}`}>
                            <td>{college.college_id}</td>
                            <td>
                              {editingCollegeId === college.college_id ? (
                                <input
                                  type="text"
                                  value={editingCollegeName}
                                  onChange={(event) => setEditingCollegeName(event.target.value)}
                                  className="college-inline-input"
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
              </div>
              )}

              {(isDashboardView || activeSection === "create-exam") && (
              <div className="dashboard-section admin-section" id="admin-exams">
                <h2>Create &amp; View Exams</h2>
                <div>
                  <h3>Schedule Exam</h3>
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
                    <input
                      type="number"
                      placeholder="Duration (minutes)"
                      value={scheduleDurationMinutes}
                      onChange={(event) => setScheduleDurationMinutes(event.target.value)}
                    />
                    <input
                      type="number"
                      placeholder="No. of Questions"
                      value={scheduleQuestionCount}
                      onChange={(event) => setScheduleQuestionCount(event.target.value)}
                    />

                    <button type="submit" className="schedule-generate-btn">Generate Questions</button>
                  </form>
                </div>
                <div className="form-table-divider" aria-hidden="true" />
                <div style={{ marginTop: 24 }}>
                  <h3>Exams</h3>
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
                            <button className="danger-btn" onClick={() => handleDeleteExam(exam.exam_id)}>
                              Delete
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
          </section>
        </main>
      </div>
    </div>
  );
}

export default AdminDashboard;
