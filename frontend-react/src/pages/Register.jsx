import { useEffect, useState } from "react";
import useBodyClass from "../hooks/useBodyClass.js";

function Register() {
  useBodyClass("landing-page student-landing auth-page");
  const [notice, setNotice] = useState("");
  const [colleges, setColleges] = useState([]);
  const [collegeError, setCollegeError] = useState("");
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    phone: "",
    dob: "",
    course: "",
    collegeId: "",
    password: "",
  });

  useEffect(() => {
    async function loadColleges() {
      try {
        const response = await fetch("/student/colleges");
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setColleges(data);
          setFormState((prev) => ({
            ...prev,
            collegeId: String(data[0].college_id)
          }));
          setCollegeError("");
        } else {
          setCollegeError("No colleges available yet.");
        }
      } catch (err) {
        console.error("College load error:", err);
        setCollegeError("Could not load colleges.");
      }
    }
    loadColleges();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setNotice("");

    if (!formState.name || !formState.email || !formState.phone || !formState.dob || !formState.course || !formState.collegeId || !formState.password) {
      setNotice("Please fill in all fields.");
      return;
    }

    try {
      const response = await fetch("/student/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formState.name,
          email: formState.email,
          phone: formState.phone,
          dob: formState.dob,
          course: formState.course,
          collegeId: formState.collegeId,
          password: formState.password,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        setNotice(data.message || "Registration failed.");
        return;
      }
      const successMessage = `Registration successful${data.studentId ? ` (Student ID: ${data.studentId})` : ""}. Please log in.`;
      setNotice(successMessage);
      setFormState({
        name: "",
        email: "",
        phone: "",
        dob: "",
        course: "",
        collegeId: "",
        password: "",
      });
    } catch (err) {
      console.error("Registration error:", err);
      setNotice("Server error during registration.");
    }
  };

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand">
          <span className="brand-mark">RP2</span>
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
          <p className="hero-eyebrow">Student Registration</p>
          <h1>Create your scholarship profile.</h1>
          <p className="hero-subtitle">
            Enter your details to register for the RP2 scholarship examination.
            You can log in anytime to update your information.
          </p>
        </section>

        <section className="auth-card">
          <h2>Create New Account</h2>
          <p className="auth-meta">Fill in the form carefully to avoid mistakes.</p>
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Full Name"
              value={formState.name}
              onChange={(event) => setFormState({ ...formState, name: event.target.value })}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={formState.email}
              onChange={(event) => setFormState({ ...formState, email: event.target.value })}
              required
            />
            <input
              type="text"
              placeholder="Phone Number"
              value={formState.phone}
              onChange={(event) => setFormState({ ...formState, phone: event.target.value })}
              required
            />
            <input
              type="date"
              value={formState.dob}
              onChange={(event) => setFormState({ ...formState, dob: event.target.value })}
              required
            />
            <input
              type="text"
              placeholder="Course (max 15 chars)"
              maxLength="15"
              value={formState.course}
              onChange={(event) => setFormState({ ...formState, course: event.target.value })}
              required
            />
            {collegeError && (
              <p className="auth-help" style={{ color: "#f8c7c7" }}>
                {collegeError}
              </p>
            )}
            <label className="auth-label">College</label>
            <select
              value={formState.collegeId}
              onChange={(event) => setFormState({ ...formState, collegeId: event.target.value })}
              required
            >
              <option value="">Select college</option>
              {colleges.map((college) => (
                <option key={college.college_id} value={college.college_id}>
                  {college.college_name}
                </option>
              ))}
            </select>
            <input
              type="password"
              placeholder="Create Password"
              value={formState.password}
              onChange={(event) => setFormState({ ...formState, password: event.target.value })}
              required
            />
            <button type="submit">Register</button>
          </form>
          {notice && <p className="auth-help">{notice}</p>}
          {!notice && (
            <p className="auth-help">
              Already registered? <a href="/student/login">Login here</a>
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

export default Register;
