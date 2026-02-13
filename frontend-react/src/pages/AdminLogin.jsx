import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

function AdminLogin() {
  useBodyClass("landing-page admin-landing auth-page");

  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    localStorage.removeItem("adminId");
    localStorage.removeItem("collegeId");
    localStorage.removeItem("collegeName");

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
      const response = await fetch("/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.message || "Invalid credentials.");
        return;
      }

      localStorage.setItem("adminId", data.adminId);
      navigate("/admin/dashboard");
    } catch (err) {
      console.error("Admin login error:", err);
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
          <a href="/admin" className="nav-link">Admin Home</a>
          <a href="#" className="nav-link">Support</a>
          <a className="nav-cta" href="/admin/login">Login</a>
        </nav>
      </header>

      <main className="auth-main">
        <section className="auth-copy">
          <p className="hero-eyebrow">Administrator Access</p>
          <h1>Secure control for scholarship exams.</h1>
          <p className="hero-subtitle">
            Manage schedules, monitor live sessions, and publish verified results with confidence.
            Sign in to continue to the admin console.
          </p>
          <div className="auth-highlight">
            <div>
              <span className="metric-value">Role Based</span>
              <span className="metric-label">Access controls</span>
            </div>
            <div>
              <span className="metric-value">Audit Trail</span>
              <span className="metric-label">Every action logged</span>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <h2>Admin Login</h2>
          <p className="auth-meta">Use your official admin email and password.</p>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Admin Email"
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
              Need access? Contact your scholarship coordinator.
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

export default AdminLogin;
