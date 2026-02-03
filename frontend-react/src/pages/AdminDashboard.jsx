import { useEffect, useRef, useState } from "react";
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

const WALKIN_STREAMS = ["Data Science", "Data Analytics", "MERN"];

function AdminDashboard() {
  useBodyClass("dashboard admin-dashboard");

  const location = useLocation();
  const navigate = useNavigate();
  const adminId = localStorage.getItem("adminId");
  const collegeId = localStorage.getItem("collegeId");
  const collegeName = localStorage.getItem("collegeName") || "Scholarship Examination System";

  const [events, setEvents] = useState([]);
  const [exams, setExams] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [totalExamCount, setTotalExamCount] = useState(0);
  const [totalActiveExamCount, setTotalActiveExamCount] = useState(0);
  const [recentResults, setRecentResults] = useState([]);
  const [students, setStudents] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [eventStatus, setEventStatus] = useState("");
  const [generateStatus, setGenerateStatus] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedExamId, setSelectedExamId] = useState("");
  const [questionCount, setQuestionCount] = useState("");

  const [eventName, setEventName] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [cutoff, setCutoff] = useState("");
  const [eventType, setEventType] = useState("REGULAR");

  const [courseSelect, setCourseSelect] = useState("");
  const [customCourse, setCustomCourse] = useState("");
  const [selectedStream, setSelectedStream] = useState("");
  const [walkinForm, setWalkinForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    stream: ""
  });
  const [walkinStatus, setWalkinStatus] = useState("");
  const [walkinCredentials, setWalkinCredentials] = useState(null);
  const [walkinPasswordForm, setWalkinPasswordForm] = useState({
    email: "",
    password: ""
  });
  const [walkinPasswordStatus, setWalkinPasswordStatus] = useState("");
  const [regularForm, setRegularForm] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    course: "",
    collegeId: collegeId || "",
    password: ""
  });
  const [regularStatus, setRegularStatus] = useState("");
  const [regularCredentials, setRegularCredentials] = useState(null);
  const [collegeOptions, setCollegeOptions] = useState([]);
  const [collegeError, setCollegeError] = useState("");
  const landingSection = location.state?.activeSection;

  useEffect(() => {
    if (!landingSection) return;
    setShowProfile(false);
    setActiveSection(landingSection);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: undefined });
  }, [landingSection, location.pathname, location.search, navigate]);
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [generatedExamId, setGeneratedExamId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const selectedEvent = events.find(
    (event) => String(event.event_id) === String(selectedEventId)
  );
  const selectedEventType = (
    (selectedEvent?.event_type || "REGULAR") + ""
  ).toUpperCase();
  const isWalkinEventSelected = selectedEventType === "WALKIN";

  const eventChartRef = useRef(null);
  const examChartRef = useRef(null);
  const studentChartRef = useRef(null);
  const chartsRef = useRef({ event: null, exam: null, student: null });
  const activeSectionRef = useRef(activeSection);

  useEffect(() => {
    if (!adminId || !collegeId) {
      navigate("/admin/login");
      return;
    }
    loadEvents();
    loadStudentCount();
    loadTotalExamCount();
    loadTotalActiveExamCount();
    loadRecentResults();
    loadStudents();
  }, [adminId, collegeId, navigate]);

  useEffect(() => {
    const loadColleges = async () => {
      try {
        const response = await fetch("/student/colleges");
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) {
          setCollegeOptions([]);
          setCollegeError("No colleges available yet.");
          return;
        }
        setCollegeOptions(data);
        setCollegeError("");
        setRegularForm((prev) => ({
          ...prev,
          collegeId: prev.collegeId || String(collegeId || data[0].college_id)
        }));
      } catch (err) {
        console.error("College load error:", err);
        setCollegeError("Could not load colleges.");
      }
    };
    loadColleges();
  }, [collegeId]);

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
    if (selectedEventId) {
      loadExams(selectedEventId);
    } else {
      setExams([]);
    }
  }, [selectedEventId]);

  useEffect(() => {
    if (showProfile || activeSection !== "dashboard") return;
    const Chart = window.Chart;
    if (!Chart || !eventChartRef.current) return;

    const activeCount = events.filter((event) => event.is_active === "YES").length;
    const inactiveCount = Math.max(events.length - activeCount, 0);

    if (chartsRef.current.event) {
      chartsRef.current.event.destroy();
    }

    chartsRef.current.event = new Chart(eventChartRef.current, {
      type: "doughnut",
      data: {
        labels: ["Active Events", "Inactive Events"],
        datasets: [
          {
            data: [activeCount, inactiveCount],
            backgroundColor: ["#f2d07e", "#4b4f66"],
            borderColor: "rgba(20, 24, 40, 0.9)",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "rgba(233, 236, 246, 0.85)",
              font: { size: 12 },
            },
          },
        },
      },
    });

    return () => {
      if (chartsRef.current.event) {
        chartsRef.current.event.destroy();
        chartsRef.current.event = null;
      }
    };
  }, [events, showProfile, activeSection]);

  useEffect(() => {
    if (showProfile || activeSection !== "dashboard") return;
    const Chart = window.Chart;
    if (!Chart || !examChartRef.current) return;

    const activeCount = totalActiveExamCount;
    const labels = ["Active Exams"];
    const values = [activeCount];
    const valueLabelPlugin = {
      id: "valueLabel",
      afterDatasetsDraw(chart) {
        const { ctx, data } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta?.data?.length) return;
        ctx.save();
        ctx.fillStyle = "rgba(233, 236, 246, 0.9)";
        ctx.font = "600 12px \"Space Grotesk\", sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        meta.data.forEach((bar, index) => {
          const value = data.datasets[0].data[index];
          if (value === null || value === undefined) return;
          ctx.fillText(String(value), bar.x, bar.y - 6);
        });
        ctx.restore();
      },
    };

    if (chartsRef.current.exam) {
      chartsRef.current.exam.destroy();
    }

    chartsRef.current.exam = new Chart(examChartRef.current, {
      type: "bar",
      plugins: [valueLabelPlugin],
      data: {
        labels,
        datasets: [
          {
            label: "Active Exams",
            data: values,
            backgroundColor: "rgba(115, 120, 240, 0.7)",
            borderColor: "rgba(115, 120, 240, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "rgba(233, 236, 246, 0.85)" },
            grid: { color: "rgba(120, 126, 153, 0.2)" },
          },
          y: {
            ticks: { color: "rgba(233, 236, 246, 0.85)", precision: 0 },
            grid: { color: "rgba(120, 126, 153, 0.2)" },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
        },
      },
    });

    return () => {
      if (chartsRef.current.exam) {
        chartsRef.current.exam.destroy();
        chartsRef.current.exam = null;
      }
    };
  }, [totalActiveExamCount, showProfile, activeSection]);

  useEffect(() => {
    if (showProfile || activeSection !== "dashboard") return;
    const Chart = window.Chart;
    if (!Chart || !studentChartRef.current) return;

    if (chartsRef.current.student) {
      chartsRef.current.student.destroy();
    }

    chartsRef.current.student = new Chart(studentChartRef.current, {
      type: "bar",
      data: {
        labels: ["Registered"],
        datasets: [
          {
            label: "Students",
            data: [studentCount],
            backgroundColor: "rgba(242, 208, 126, 0.7)",
            borderColor: "rgba(242, 208, 126, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "rgba(233, 236, 246, 0.85)" },
            grid: { color: "rgba(120, 126, 153, 0.2)" },
          },
          y: {
            ticks: { color: "rgba(233, 236, 246, 0.85)", precision: 0 },
            grid: { color: "rgba(120, 126, 153, 0.2)" },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
        },
      },
    });

    return () => {
      if (chartsRef.current.student) {
        chartsRef.current.student.destroy();
        chartsRef.current.student = null;
      }
    };
  }, [studentCount, showProfile, activeSection]);

  const loadEvents = async () => {
    try {
      const response = await fetch(`/admin/events/${collegeId}`);
      const data = await response.json();
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load events error:", err);
      setEvents([]);
    }
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

  const handleWalkinCreation = async (event) => {
    event.preventDefault();
    setWalkinStatus("");
    setWalkinCredentials(null);

    if (!walkinForm.name || !walkinForm.email || !walkinForm.phone || !walkinForm.dob || !walkinForm.stream) {
      setWalkinStatus("Fill all walk-in student details.");
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
        })
      });
      const data = await response.json();
      if (!data.success) {
        setWalkinStatus(data.message || "Failed to create walk-in student.");
        return;
      }

      setWalkinStatus("Walk-in student created. Set credentials using the panel below.");
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

  const handleWalkinPasswordUpdate = async (event) => {
    event.preventDefault();
    setWalkinPasswordStatus("");

    if (!walkinPasswordForm.email || !walkinPasswordForm.password) {
      setWalkinPasswordStatus("Provide email and new password.");
      return;
    }

    try {
      const response = await fetch("/admin/students/walkin/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: walkinPasswordForm.email,
          password: walkinPasswordForm.password
        })
      });
      const data = await response.json();
      if (!data.success) {
        setWalkinPasswordStatus(data.message || "Failed to update password.");
        return;
      }

      setWalkinPasswordStatus("Password updated.");
      setWalkinPasswordForm({ email: "", password: "" });
    } catch (err) {
      console.error("Walk-in password error:", err);
      setWalkinPasswordStatus("Server error while updating password.");
    }
  };

  const loadExams = async (eventId) => {
    try {
      const response = await fetch(`/admin/exams/${eventId}`);
      const data = await response.json();
      setExams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load exams error:", err);
      setExams([]);
    }
  };

  const handleToggleEventStatus = async (eventId, currentStatus) => {
    const newStatus = currentStatus === "YES" ? "NO" : "YES";
    await fetch(`/admin/event/status/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadEvents();
  };

  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm("Delete this event?")) return;
    await fetch(`/admin/event/delete/${eventId}`, { method: "PUT" });
    loadEvents();
  };

  const handleCreateEvent = async (event) => {
    event.preventDefault();
    setEventStatus("");

    if (!eventName || !eventStartDate || !eventEndDate || !startTime || !endTime || !cutoff || !eventType) {
      setEventStatus("Fill all event details.");
      return;
    }

    try {
      const response = await fetch("/admin/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          college_id: collegeId,
          exam_name: eventName,
          exam_start_date: eventStartDate,
          exam_end_date: eventEndDate,
          start_time: startTime,
          end_time: endTime,
          cutoff_percentage: cutoff,
          event_type: eventType,
        }),
      });
      const data = await response.json();
      setEventStatus(data.success ? "Event created." : "Event creation failed.");
      setEventName("");
      setEventStartDate("");
      setEventEndDate("");
      setStartTime("");
      setEndTime("");
      setCutoff("");
      setEventType("REGULAR");
      loadEvents();
    } catch (err) {
      console.error("Create event error:", err);
      setEventStatus("Server error.");
    }
  };

  const handleCreateExam = async (event) => {
    event.preventDefault();

    if (!selectedEventId) {
      alert("Select an event");
      return;
    }

    const eventType = selectedEventType;

    const payload = { event_id: selectedEventId };

    if (eventType === "WALKIN") {
      if (!selectedStream) {
        alert("Select a stream for walk-in events");
        return;
      }
      payload.stream = selectedStream;
    } else {
      const course = courseSelect === "OTHER" ? customCourse.trim() : courseSelect;
      if (!course) {
        alert("Select a course for regular events");
        return;
      }
      payload.course = course;
    }

    await fetch("/admin/exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCourseSelect("");
    setCustomCourse("");
    setSelectedStream("");
    loadExams(selectedEventId);
  };

  const handleDeleteExam = async (examId) => {
    if (!window.confirm("Delete this exam?")) return;
    await fetch(`/admin/exam/${examId}`, { method: "DELETE" });
    loadExams(selectedEventId);
  };

  const handleGenerateQuestions = async (event) => {
    event.preventDefault();
    setGenerateStatus("");

    if (isWalkinEventSelected) {
      setGenerateStatus("Walk-in exams already consume the fixed question bank.");
      return;
    }

    if (!selectedExamId || !questionCount) {
      setGenerateStatus("Select exam and number of questions.");
      return;
    }

    if (selectedExamId === generatedExamId) {
      setGenerateStatus("Questions already generated for this exam.");
      return;
    }

    setGenerateStatus("Generating questions...");
    try {
      const response = await fetch(`/admin/generate-questions/${selectedExamId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionCount: Number(questionCount) }),
      });
      const data = await response.json();
      setGenerateStatus(
        data.success ? "Questions generated successfully." : data.message || "Generation failed."
      );
      if (data.success) {
        setGeneratedExamId(selectedExamId);
      }
    } catch (err) {
      console.error("Generate questions error:", err);
      setGenerateStatus("Server error during generation.");
    }
  };

  const logoutAdmin = () => {
    fetch("/admin/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        localStorage.clear();
        navigate("/admin/login");
      });
  };

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

  const activeEvents = events.filter((event) => event.is_active === "YES").length;
  const activeExams = totalActiveExamCount;
  const isDashboardView = !showProfile && activeSection === "dashboard";
  const walkinStudents = students.filter((student) => student.student_type === "WALKIN");
  const regularStudents = students.filter((student) => student.student_type === "REGULAR");

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
              <p>Manage exams & events</p>
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
                className={`nav-button ${activeSection === "events" ? "active" : ""}`}
                onClick={() => handleSectionClick("events")}
              >
                Create/View Events
              </button>
              <button
                type="button"
                className={`nav-button ${activeSection === "create-exam" ? "active" : ""}`}
                onClick={() => handleSectionClick("create-exam")}
              >
                Create/View Exams
              </button>
              <button
                type="button"
                className={`nav-button ${activeSection === "generate" ? "active" : ""}`}
                onClick={() => handleSectionClick("generate")}
              >
                Generate Questions
              </button>
              <button
                type="button"
                className={`nav-button ${activeSection === "results" ? "active" : ""}`}
                onClick={() => handleSectionClick("results")}
              >
                Results
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
          <span className="nav-group">Regular Students</span>
          <button
            type="button"
            className={`nav-button ${activeSection === "regular" ? "active" : ""}`}
            onClick={() => handleSectionClick("regular")}
          >
            Regular Student Management
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
                      <span className="stat-label">Total Events</span>
                      <span className="stat-value">{events.length}</span>
                      <span className="stat-meta">All scheduled events</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Active Events</span>
                      <span className="stat-value">{activeEvents}</span>
                      <span className="stat-meta">Currently open</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Active Exams</span>
                      <span className="stat-value">{activeExams}</span>
                      <span className="stat-meta">Ready to attempt</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Total Exams</span>
                      <span className="stat-value">{totalExamCount}</span>
                      <span className="stat-meta">Across all events</span>
                    </div>
                  </div>
                  <div className="chart-stack">
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3>Active Events</h3>
                        <span>{events.length} total</span>
                      </div>
                      <div className="chart-canvas chart-canvas-compact">
                        <canvas ref={eventChartRef} />
                      </div>
                    </div>
                    <div className="chart-row">
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Active Exams (Ready)</h3>
                          <span>All events</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <canvas ref={examChartRef} />
                        </div>
                      </div>
                      <div className="chart-card">
                        <div className="chart-header">
                          <h3>Registered Students</h3>
                          <span>{studentCount} total</span>
                        </div>
                        <div className="chart-canvas chart-canvas-compact">
                          <canvas ref={studentChartRef} />
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
              {activeSection === "results" && (
              <div className="dashboard-section admin-section" id="admin-results">
                <h2>Recent Results</h2>
                  <table>
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
                    {recentResults.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ textAlign: "center" }}>No results found</td>
                      </tr>
                    )}
                    {recentResults.map((result) => {
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
                          ID: <strong>{walkinCredentials.studentId}</strong>
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="dashboard-section admin-section" id="walkin-credentials">
                  <h2>Set Walk-In ID / Password</h2>
                  <form className="form-row form-row-wide" onSubmit={handleWalkinPasswordUpdate}>
                    <div className="form-field">
                      <label>Walk-in Email</label>
                      <input
                        type="email"
                        placeholder="Enter email"
                        value={walkinPasswordForm.email}
                        onChange={(event) => setWalkinPasswordForm({ ...walkinPasswordForm, email: event.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>New Password</label>
                      <input
                        type="password"
                        placeholder="Set new password"
                        value={walkinPasswordForm.password}
                        onChange={(event) => setWalkinPasswordForm({ ...walkinPasswordForm, password: event.target.value })}
                      />
                    </div>
                    <button type="submit">Update Password</button>
                  </form>
                  {walkinPasswordStatus && (
                    <p className="auth-help" style={{ marginTop: 10 }}>
                      {walkinPasswordStatus}
                    </p>
                  )}
                </div>

                <div className="dashboard-section admin-section" id="walkin-list">
                  <h2>Walk-In Students</h2>
                  <table>
                    <thead>
                    <tr>
                      <th>Student ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Contact</th>
                      <th>DOB</th>
                      <th>Course</th>
                      <th>Password</th>
                    </tr>
                    </thead>
                    <tbody>
                      {walkinStudents.length === 0 && (
                        <tr>
                          <td colSpan="5" style={{ textAlign: "center" }}>No walk-in students found</td>
                        </tr>
                      )}
                      {walkinStudents.map((student) => {
                        const passwordRevealed = Boolean(revealedPasswords[student.student_id]);
                        return (
                          <tr key={student.student_id}>
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
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                  <table>
                    <thead>
                      <tr>
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Contact</th>
                        <th>DOB</th>
                        <th>Course</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regularStudents.length === 0 && (
                        <tr>
                          <td colSpan="6" style={{ textAlign: "center" }}>No regular students found</td>
                        </tr>
                      )}
                      {regularStudents.map((student) => (
                        <tr key={student.student_id}>
                          <td>{student.student_id}</td>
                          <td>{student.name}</td>
                          <td>{student.email_id}</td>
                          <td>{student.contact_number}</td>
                          <td>{student.dob ? new Date(student.dob).toLocaleDateString() : "--"}</td>
                          <td>{student.course}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
              )}

          {(isDashboardView || activeSection === "events") && (
          <div className="dashboard-section admin-section" id="admin-events">
            <h2>Create &amp; View Events</h2>
            <div>
              <h3>Create Exam Event</h3>
              <form className="form-row form-row-wide" onSubmit={handleCreateEvent}>
                <div className="field-block">
                  <label htmlFor="eventNameInput">Event Name</label>
                  <input
                    id="eventNameInput"
                    type="text"
                    placeholder="Event Name"
                    value={eventName}
                    onChange={(event) => setEventName(event.target.value)}
                  />
                </div>
                <div className="field-block">
                  <label htmlFor="eventStartDateInput">Event Start Date</label>
                  <input
                    id="eventStartDateInput"
                    type="date"
                    value={eventStartDate}
                    onChange={(event) => setEventStartDate(event.target.value)}
                  />
                </div>
                <div className="field-block">
                  <label htmlFor="eventEndDateInput">Event End Date</label>
                  <input
                    id="eventEndDateInput"
                    type="date"
                    value={eventEndDate}
                    onChange={(event) => setEventEndDate(event.target.value)}
                  />
                </div>
                <div className="field-block">
                  <label htmlFor="startTimeInput">Start Time</label>
                  <input
                    id="startTimeInput"
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                </div>
                <div className="field-block">
                  <label htmlFor="endTimeInput">End Time</label>
                  <input
                    id="endTimeInput"
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                </div>
                <div className="field-block">
                  <label htmlFor="eventTypeInput">Event Type</label>
                  <select
                    id="eventTypeInput"
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value)}
                  >
                    <option value="REGULAR">Regular</option>
                    <option value="WALKIN">Walk-In</option>
                  </select>
                </div>
                <div className="field-block">
                  <label htmlFor="cutoffInput">Cutoff %</label>
                  <input
                    id="cutoffInput"
                    type="number"
                    placeholder="Cutoff %"
                    value={cutoff}
                    onChange={(event) => setCutoff(event.target.value)}
                  />
                </div>
                <button type="submit">Create</button>
              </form>
              {eventStatus && <p id="eventStatus">{eventStatus}</p>}
            </div>
            <div className="form-table-divider" aria-hidden="true" />
            <div style={{ marginTop: 24 }}>
              <h3>Exam Events</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Cutoff</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 && (
                    <tr>
                      <td colSpan="7" style={{ textAlign: "center" }}>No events found</td>
                    </tr>
                  )}
                  {events.map((event) => (
                    <tr
                      key={event.event_id}
                      className={event.is_active === "YES" ? "" : "event-row-disabled"}
                    >
                      <td>{event.event_id}</td>
                      <td>{event.exam_name}</td>
                      <td>
                        {event.exam_start_date && event.exam_end_date
                          ? `${new Date(event.exam_start_date).toLocaleDateString()} to ${new Date(event.exam_end_date).toLocaleDateString()}`
                          : "--"}
                      </td>
                      <td>{event.start_time} - {event.end_time}</td>
                      <td>{event.cutoff_percentage}</td>
                      <td>
                        <span className={event.is_active === "YES" ? "status-active" : "status-inactive"}>
                          {event.is_active}
                        </span>
                      </td>
                      <td>
                        <button onClick={() => handleToggleEventStatus(event.event_id, event.is_active)}>
                          {event.is_active === "YES" ? "Deactivate" : "Activate"}
                        </button>
                        <button className="danger-btn" onClick={() => handleDeleteEvent(event.event_id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

              {activeSection === "students" && (
              <div className="dashboard-section admin-section" id="admin-students">
                <h2>Student Profiles</h2>
                <table>
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
                    {students.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ textAlign: "center" }}>No students found</td>
                      </tr>
                    )}
                    {students.map((student, index) => (
                      <tr key={student.student_id}>
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
              )}

              {(isDashboardView || activeSection === "create-exam") && (
              <div className="dashboard-section admin-section" id="admin-exams">
                <h2>Create &amp; View Exams</h2>
                <div>
                  <h3>Create Exam</h3>
                  <form className="form-row" onSubmit={handleCreateExam}>
                    <select
                      value={selectedEventId}
                      onChange={(event) => {
                        setSelectedEventId(event.target.value);
                        setCourseSelect("");
                        setCustomCourse("");
                        setSelectedStream("");
                      }}
                    >
                      <option value="">Select Event</option>
                      {events.map((event) => (
                        <option key={event.event_id} value={event.event_id}>
                          {event.exam_name}
                        </option>
                      ))}
                    </select>

                    {selectedEventType === "WALKIN" ? (
                      <select
                        value={selectedStream}
                        onChange={(event) => setSelectedStream(event.target.value)}
                      >
                        <option value="">Select Stream</option>
                        {WALKIN_STREAMS.map((stream) => (
                          <option key={stream} value={stream}>
                            {stream}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
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
                      </>
                    )}

                    <button type="submit">Create</button>
                  </form>
                </div>
                <div className="form-table-divider" aria-hidden="true" />
                <div style={{ marginTop: 24 }}>
                  <h3>Exams</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Course</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEventId && exams.length === 0 && (
                        <tr>
                          <td colSpan="4" style={{ textAlign: "center" }}>No exams found</td>
                        </tr>
                      )}
                      {!selectedEventId && (
                        <tr>
                          <td colSpan="4" style={{ textAlign: "center" }}>Select an event</td>
                        </tr>
                      )}
                      {exams.map((exam) => (
                        <tr key={exam.exam_id}>
                          <td>{exam.exam_id}</td>
                          <td>{exam.course}</td>
                          <td>{exam.exam_status}</td>
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
              )}

              {(isDashboardView || activeSection === "generate") && (
              <div className="dashboard-section admin-section" id="admin-generate">
                <h2>Generate Questions</h2>
                {isWalkinEventSelected ? (
                  <p className="auth-help" style={{ color: "#a5f3fc" }}>
                    Walk-in exams automatically pull the shared aptitude bank, the stream-specific
                    descriptive section, and the coding questions. The exam is marked ready as soon as
                    it is created.
                  </p>
                ) : (
                  <form className="form-row" onSubmit={handleGenerateQuestions}>
                    <select
                      value={selectedExamId}
                      onChange={(event) => setSelectedExamId(event.target.value)}
                    >
                      <option value="">Select Exam</option>
                      {exams.map((exam) => (
                        <option key={exam.exam_id} value={exam.exam_id}>
                          Exam {exam.exam_id} ({exam.course})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="No. of Questions"
                      value={questionCount}
                      onChange={(event) => setQuestionCount(event.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={!selectedExamId || selectedExamId === generatedExamId}
                    >
                      Generate
                    </button>
                  </form>
                )}
                {generateStatus && <p id="generateStatus">{generateStatus}</p>}
                {!isWalkinEventSelected && selectedExamId && selectedExamId === generatedExamId && (
                  <p
                    className="auth-help"
                    style={{ marginTop: 8, color: "#ffb3b3" }}
                  >
                    Questions already generated for this exam.
                  </p>
                )}
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
          </section>
        </main>
      </div>
    </div>
  );
}

export default AdminDashboard;
