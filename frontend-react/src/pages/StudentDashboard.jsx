import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

function StudentDashboard() {
  useBodyClass("dashboard student-dashboard");

  const navigate = useNavigate();
  const studentId = localStorage.getItem("studentId");
  const studentName = localStorage.getItem("studentName");
  const studentEmail = localStorage.getItem("studentEmail");
  const studentContact = localStorage.getItem("studentContact");
  const studentDob = localStorage.getItem("studentDob");
  const studentCourse = localStorage.getItem("studentCourse");
  const studentCollegeName = localStorage.getItem("studentCollegeName");
  const studentType = String(localStorage.getItem("studentType") || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "_");

  const [availableExams, setAvailableExams] = useState([]);
  const [attemptedExams, setAttemptedExams] = useState([]);
  const [startingExamId, setStartingExamId] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const isWalkinDashboard = [...availableExams, ...attemptedExams].some((exam) =>
    /walk[\s-]*in/i.test(String(exam?.exam_name || ""))
  );
  const isWalkinStudent =
    studentType === "WALKIN" || studentType === "WALK_IN" || isWalkinDashboard;
  const courseLabel = isWalkinDashboard ? "Specialization" : "Course";

  useEffect(() => {
    if (![...availableExams, ...attemptedExams].length) return;
    localStorage.setItem("studentType", "WALK_IN");
  }, [attemptedExams, availableExams, isWalkinDashboard]);

  const loadAvailableExams = useCallback(async () => {
    try {
      const response = await fetch(`/student/exams/${studentId}`, {
        credentials: "include",
        cache: "no-store"
      });
      if (response.status === 401 || response.status === 403) {
        navigate("/student/login");
        return;
      }
      const data = await response.json();
      setAvailableExams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load available exams error:", err);
      setAvailableExams([]);
    }
  }, [navigate, studentId]);

  const loadAttemptedExams = useCallback(async () => {
    try {
      const response = await fetch(`/student/attempted-exams/${studentId}`, {
        credentials: "include",
        cache: "no-store"
      });
      if (response.status === 401 || response.status === 403) {
        navigate("/student/login");
        return;
      }
      const data = await response.json();
      setAttemptedExams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load attempted exams error:", err);
      setAttemptedExams([]);
    }
  }, [navigate, studentId]);

  useEffect(() => {
    if (!studentId || !studentName) {
      navigate("/student/login");
      return;
    }
    const run = setTimeout(() => {
      loadAvailableExams();
      loadAttemptedExams();
    }, 0);
    return () => clearTimeout(run);
  }, [loadAttemptedExams, loadAvailableExams, navigate, studentId, studentName]);

  const startExam = async (examId) => {
    if (startingExamId !== null) return;
    setStartingExamId(examId);
    try {
      const endpointBase = "/exam";
      const response = await fetch(`${endpointBase}/attempted/${studentId}/${examId}`, {
        credentials: "include"
      });
      const data = await response.json();
      if (data.attempted) {
        alert("You have already attempted this exam.");
        return;
      }
      const startResponse = await fetch(`${endpointBase}/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, examId })
      });
      const startData = await startResponse.json();
      if (!startResponse.ok || !startData.success) {
        const startsInSeconds = Number(startData?.startsInSeconds || 0);
        if (String(startData?.code || "") === "exam_not_started" && startsInSeconds > 0) {
          const hours = Math.floor(startsInSeconds / 3600);
          const minutes = Math.floor((startsInSeconds % 3600) / 60);
          const seconds = startsInSeconds % 60;
          const parts = [];
          if (hours > 0) parts.push(`${hours} hr`);
          if (minutes > 0 || hours > 0) parts.push(`${minutes} min`);
          parts.push(`${seconds} sec`);
          alert(`Exam has not started yet. ${parts.join(" ")} left.`);
          return;
        }
        if (String(startData?.code || "") === "exam_start_window_closed") {
          alert("The 10-minute start window has closed. You can no longer attend this regular exam.");
          return;
        }
        alert(startData.message || "Unable to start exam.");
        return;
      }
      const studentExamId = Number(startData.studentExamId || 0);
      const query = studentExamId > 0
        ? `/exam?examId=${examId}&studentExamId=${studentExamId}`
        : `/exam?examId=${examId}`;
      navigate(query);
    } catch (err) {
      console.error("Start exam error:", err);
      alert("A network error occurred. Please check your connection and try again.");
    } finally {
      setStartingExamId(null);
    }
  };

  const logoutStudent = () => {
    fetch("/student/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        localStorage.removeItem("studentId");
        localStorage.removeItem("studentName");
        localStorage.removeItem("studentEmail");
        localStorage.removeItem("studentContact");
        localStorage.removeItem("studentDob");
        localStorage.removeItem("studentCourse");
        localStorage.removeItem("studentCollegeName");
        localStorage.removeItem("studentType");
        navigate("/student/login");
      });
  };

  const handleProfileClick = () => {
    setShowProfile(true);
  };

  const handleDashboardClick = () => {
    setShowProfile(false);
  };

  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const formatDate = (value) => {
    if (!value) return "Not available";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatExamDate = (value) => {
    if (!value) return "Not available";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  };

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar student-header" id="student-overview">
        <div className="topbar-left">
          <div className="brand-logo">
            <img src="/dashboard-logo.png" alt="Online Examination App" />
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-profile"
            onClick={handleProfileClick}
          >
            <div className="profile-badge">S</div>
            <div>
              <span className="profile-name">{studentName || "Student"}</span>
              <span className="profile-role">Candidate</span>
            </div>
          </button>
          <button className="logout-btn" onClick={logoutStudent}>
            Logout
          </button>
        </div>
      </header>

      <div className="dashboard-layout student-layout">
        <aside className="dashboard-sidebar student-sidebar">
          <div className="sidebar-top">
            <div className="sidebar-profile">
              <div className="profile-badge">S</div>
              <div>
                <h3>Welcome</h3>
                <p>Your exam hub</p>
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

            {!showProfile && (
              <>
                <span className="nav-group">Exams</span>
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => scrollToSection("student-available")}
                >
                  Available Exams
                </button>
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => scrollToSection("student-attempted")}
                >
                  Attempted Exams
                </button>
                <span className="nav-break" aria-hidden="true" />
              </>
            )}

            <span className="nav-group">Account</span>
            <button
              type="button"
              className={`nav-button ${showProfile ? "active" : ""}`}
              onClick={handleProfileClick}
            >
              Profile
            </button>
            <span className="nav-break" aria-hidden="true" />
          </nav>

          <div className="sidebar-footer">
            <p>Need help? Contact your scholarship coordinator.</p>
          </div>
        </aside>

        <main className="dashboard-main student-main">
          <section className="dashboard-container">
            {!showProfile && (
              <>
                <div className="page-header">
                  <div>
                    <h1>Dashboard</h1>
                    <p>
                      Welcome back, {studentName || "Student"}. Your exam
                      workspace is ready.
                    </p>
                  </div>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={handleProfileClick}
                  >
                    View Profile
                  </button>
                </div>

                <div
                  className="dashboard-section student-section"
                  id="student-available"
                >
                  <h2>Available Exams</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Exam</th>
                        <th>Date</th>
                        <th>Time</th>
                        <th>{courseLabel}</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availableExams.length === 0 && (
                        <tr>
                          <td colSpan="5" style={{ textAlign: "center" }}>
                            No exams available
                          </td>
                        </tr>
                      )}
                      {availableExams.map((exam) => (
                        <tr key={exam.exam_id}>
                          <td>{exam.exam_name}</td>
                          <td>
                            {formatExamDate(exam.exam_start_date)} -{" "}
                            {formatExamDate(exam.exam_end_date)}
                          </td>
                          <td>
                            {Number(exam.duration_minutes || 0) > 0
                              ? `${Number(exam.duration_minutes)} min`
                              : `${exam.start_time || "-"} - ${exam.end_time || "-"}`}
                          </td>
                          <td>{exam.course}</td>
                          <td>
                            <button
                              onClick={() => startExam(exam.exam_id)}
                              disabled={startingExamId !== null}
                            >
                              {startingExamId === exam.exam_id ? "Starting..." : "Start Exam"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  className="dashboard-section student-section"
                  id="student-attempted"
                >
                  <h2>Attempted Exams</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Exam</th>
                        <th>Date</th>
                        <th>{courseLabel}</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attemptedExams.length === 0 && (
                        <tr>
                          <td colSpan="4" style={{ textAlign: "center" }}>
                            No attempted exams
                          </td>
                        </tr>
                      )}
                      {attemptedExams.map((exam) => (
                        <tr key={`${exam.exam_id}`}>
                          <td>{exam.exam_name}</td>
                          <td>
                            {formatExamDate(exam.exam_start_date)} -{" "}
                            {formatExamDate(exam.exam_end_date)}
                          </td>
                          <td>{exam.course}</td>
                          <td>{exam.attempt_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {showProfile && (
              <div
                className="dashboard-section student-section profile-section"
                id="student-profile"
              >
                <h2>Your Profile</h2>
                <div className="profile-grid">
                  <div className="profile-item">
                    <span className="profile-label">Full Name</span>
                    <span className="profile-value">{studentName}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">College</span>
                    <span className="profile-value">
                      {studentCollegeName}
                    </span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">DOB</span>
                    <span className="profile-value">
                      {formatDate(studentDob)}
                    </span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">{courseLabel}</span>
                    <span className="profile-value">{studentCourse}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Registration Number</span>
                    <span className="profile-value">{studentId}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Gmail</span>
                    <span className="profile-value">{studentEmail}</span>
                  </div>
                  <div className="profile-item">
                    <span className="profile-label">Contact</span>
                    <span className="profile-value">{studentContact}</span>
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
            alt="Online Examination App"
          />
        </div>
        <div className="dashboard-footer-divider" />
        <p className="dashboard-footer-copy">© 2026 Online Examination App All rights reserved.</p>
      </footer>
    </div>
  );
}

export default StudentDashboard;
