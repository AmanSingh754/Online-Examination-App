import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

function StudentLogin() {
  useBodyClass("landing-page student-landing auth-page");

  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // ✅ CLEAR ONLY STUDENT LOGIN CACHE ON PAGE LOAD
  useEffect(() => {
    localStorage.removeItem("studentId");
    localStorage.removeItem("studentName");
    localStorage.removeItem("studentEmail");
    localStorage.removeItem("studentContact");
    localStorage.removeItem("studentDob");
    localStorage.removeItem("studentCourse");
    localStorage.removeItem("studentCollegeName");

    // reset form
    setEmail("");
    setPassword("");
    setError("");
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }

    try {
      const response = await fetch("/student/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.message || "Invalid credentials.");
        return;
      }

      // ✅ SET FRESH LOGIN DATA
      localStorage.setItem("studentId", data.studentId);
      localStorage.setItem("studentName", data.name);
      localStorage.setItem("studentEmail", data.email || email);

      if (data.phone) localStorage.setItem("studentContact", data.phone);
      if (data.dob) localStorage.setItem("studentDob", data.dob);
      if (data.course) localStorage.setItem("studentCourse", data.course);
      if (data.collegeName) {
        localStorage.setItem("studentCollegeName", data.collegeName);
      }

      navigate("/student/dashboard");
    } catch (err) {
      console.error("Student login error:", err);
      setError(err?.message || "Login failed. Please try again.");
    }
  };

  return (
    <div className="landing-shell">
        <header className="landing-header">
        <div className="brand">
          <img className="brand-logo" src="/assets/rp2-official.png" alt="RP2 logo" />
          <span className="brand-text">RP2 Scholarship Exam</span>
        </div>
        <nav className="landing-nav">
          <a href="/" className="nav-link">Student Home</a>
          <a href="/register" className="nav-link">Register</a>
          <a className="nav-cta" href="/student/login">Login</a>
        </nav>
      </header>

      <main className="auth-main">
        <section className="auth-copy">
          <p className="hero-eyebrow">Student Access</p>
          <h1>Log in to your scholarship dashboard.</h1>
          <p className="hero-subtitle">
            Track eligible exams, attempt live papers, and review your submission history.
            Use your registered email to continue.
          </p>
          <div className="auth-highlight">
            <div>
              <span className="metric-value">One Login</span>
              <span className="metric-label">All exams synced</span>
            </div>
            <div>
              <span className="metric-value">Instant</span>
              <span className="metric-label">Attempt status updates</span>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <h2>Student Login</h2>
          <p className="auth-meta">Use the email you registered with.</p>
          <form onSubmit={handleSubmit}>
           <input
  type="email"
  placeholder="Email"
  value={email}
  autoComplete="off"
  onChange={(event) => setEmail(event.target.value)}
  required
/>

              <input
                 type="password"
                 placeholder="Password"
                 value={password}
                 autoComplete="new-password"
                 onChange={(event) => setPassword(event.target.value)}
                  required
             />

            <button type="submit">Login</button>
          </form>
          {error && <p className="auth-help">{error}</p>}
          {!error && (
            <p className="auth-help">
              Need an account? <a href="/register">Register here</a>
            </p>
          )}
        </section>
      </main>

      <footer className="landing-footer">
        Ac 2025 Scholarship Examination Portal
      </footer>
    </div>
  );
}

export default StudentLogin;
