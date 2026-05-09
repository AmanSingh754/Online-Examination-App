import useBodyClass from "../hooks/useBodyClass.js";

function Register() {
  useBodyClass("landing-page student-landing auth-page");

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand">
          <img className="brand-logo" src="/assets/rp2-official.png" alt="App logo" />
          <span className="brand-text">Online Examination App</span>
        </div>
        <nav className="landing-nav">
          <a href="/" className="nav-link">Student Home</a>
          <a
            href="#"
            className="nav-link"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
          >
            Register
          </a>
          <a className="nav-cta" href="/student/login">Login</a>
        </nav>
      </header>

      <main className="auth-main">
        <section className="auth-copy">
          <p className="hero-eyebrow">Registration Closed</p>
          <h1>Regular student accounts are created by admin only.</h1>
        </section>

        <section className="auth-card">
          <h2>Account Creation Disabled</h2>
          <p className="auth-meta">
            For regular exams, student accounts are created from the admin dashboard. Contact your college admin to receive your login credentials.
          </p>
          <p className="auth-help">
            Already have credentials? <a href="/student/login">Login here</a>
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

