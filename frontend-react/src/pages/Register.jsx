import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";

function Register() {
  useBodyClass("landing-page student-landing auth-page");
  const navigate = useNavigate();

  const [colleges, setColleges] = useState([]);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    stream: "",
    collegeId: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchColleges = async () => {
      try {
        const response = await fetch("/student/colleges");
        const data = await response.json();
        setColleges(data);
      } catch (err) {
        console.error("Failed to fetch colleges:", err);
      }
    };
    fetchColleges();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/student/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await response.json();

      if (data.success) {
        setMessage(data.message);
        setFormData({
          name: "",
          email: "",
          phone: "",
          dob: "",
          stream: "",
          collegeId: "",
        });
      } else {
        setError(data.message || "Registration failed.");
      }
    } catch (err) {
      console.error("Registration error:", err);
      setError("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const STREAMS = [
    "Data Science",
    "Data Analytics",
    "MERN",
    "Agentic AI",
    "Interns Test",
  ];

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand">
          <img className="brand-logo" src="/assets/app-logo.png" alt="App logo" />
          <span className="brand-text">Online Examination App</span>
        </div>
        <nav className="landing-nav">
          <Link to="/" className="nav-link">Student Home</Link>
          <Link to="/register" className="nav-link active">Register</Link>
          <Link className="nav-cta" to="/student/login">Login</Link>
        </nav>
      </header>

      <main className="auth-main">
        <section className="auth-copy">
          <p className="hero-eyebrow">Join the Portal</p>
          <h1>Register for Walk-in Examination</h1>
          <p>Fill out the form to request access. An admin will review and approve your registration.</p>
        </section>

        <section className="auth-card">
          <h2>Walk-in Registration</h2>
          {message ? (
            <div className="auth-success-state">
              <p className="auth-meta success">{message}</p>
              <button className="nav-cta" onClick={() => navigate("/student/login")} style={{width: '100%'}}>
                Go to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                name="name"
                placeholder="Full Name"
                value={formData.name}
                onChange={handleChange}
                required
              />
              <input
                type="email"
                name="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={handleChange}
                required
              />
              <input
                type="tel"
                name="phone"
                placeholder="Contact Number"
                value={formData.phone}
                onChange={handleChange}
                required
              />
              <div className="form-row">
                <label style={{fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '4px'}}>Date of Birth</label>
                <input
                  type="date"
                  name="dob"
                  value={formData.dob}
                  onChange={handleChange}
                  required
                />
              </div>
              <select
                name="stream"
                value={formData.stream}
                onChange={handleChange}
                required
              >
                <option value="">Select Stream</option>
                {STREAMS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                name="collegeId"
                value={formData.collegeId}
                onChange={handleChange}
                required
              >
                <option value="">Select College</option>
                {colleges.map((c) => (
                  <option key={c.college_id} value={c.college_id}>
                    {c.college_name}
                  </option>
                ))}
              </select>

              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit Registration"}
              </button>
              {error && <p className="auth-help" style={{color: '#ff4d4d'}}>{error}</p>}
            </form>
          )}
          <p className="auth-help">
            Already have an account? <a href="/student/login">Login here</a>
          </p>
        </section>
      </main>

      <footer className="landing-footer">
        © 2026 Online Examination App All rights reserved.
      </footer>
    </div>
  );
}

export default Register;


