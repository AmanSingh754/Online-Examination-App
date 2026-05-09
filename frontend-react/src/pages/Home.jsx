import useBodyClass from "../hooks/useBodyClass.js";

function Home() {
  useBodyClass("landing-page student-landing");

  return (
    <div className="landing-shell">
        <header className="landing-header">
          <div className="brand">
            <img className="brand-logo" src="/assets/app-logo.png" alt="App logo" />
            <span className="brand-text">Online Examination App</span>
          </div>
        <nav className="landing-nav">
          <a href="#" className="nav-link">About</a>
          <a href="#" className="nav-link">Eligibility</a>
          <a href="#" className="nav-link">Exam Day</a>
          <a href="#" className="nav-link">Results</a>
          <a className="nav-cta" href="/student/login">Student Login</a>
        </nav>
      </header>

      <main className="landing-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-eyebrow">Online Examination App</p>
            <h1>Start your walk-in examination journey with one trusted portal.</h1>
            <p className="hero-subtitle">
              Access your walk-in exam account, track your exam schedule, and review results from one portal.
              Student accounts are provisioned directly by admin.
            </p>
            <div className="hero-actions">
              <a className="button-primary" href="/student/login">Login as Student</a>
              <a
                className="button-ghost"
                href="#"
                aria-disabled="true"
                onClick={(event) => event.preventDefault()}
              >
                Register Now
              </a>
            </div>
          </div>
          <div className="hero-art" />
        </section>

        <section className="landing-strip">
          <div className="strip-item">
            <h3>Clear Eligibility</h3>
            <p>See requirements, required documents, and key dates with step-by-step guidance.</p>
          </div>
          <div className="strip-item">
            <h3>Exam Guidance</h3>
            <p>Get test day instructions, center details, allowed materials, and syllabus updates.</p>
          </div>
          <div className="strip-item">
            <h3>Track Results</h3>
            <p>Check scores, rank lists, and scholarship offers with notifications as soon as they release.</p>
          </div>
        </section>
      </main>

            <footer className="landing-footer landing-footer-pro">
        <div className="footer-logo-row">
          <img
            className="footer-primary-logo"
            src="/image.png"
            alt="Online Examination App"
          />
        </div>

        <div className="footer-links-row footer-social-row">
          <a className="footer-social-link" href="#" target="_blank" rel="noreferrer" aria-label="Official Website" title="Official Website">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.02a15.6 15.6 0 0 0-1.38-5.01A8.02 8.02 0 0 1 19.93 11ZM12 4.04c.95 1.14 2.11 3.52 2.44 6.96H9.56C9.89 7.56 11.05 5.18 12 4.04ZM8.47 5.99A15.6 15.6 0 0 0 7.09 11H4.07a8.02 8.02 0 0 1 4.4-5.01ZM4.07 13h3.02c.13 1.8.6 3.53 1.38 5.01A8.02 8.02 0 0 1 4.07 13ZM12 19.96c-.95-1.14-2.11-3.52-2.44-6.96h4.88c-.33 3.44-1.49 5.82-2.44 6.96Zm3.53-1.95A15.6 15.6 0 0 0 16.91 13h3.02a8.02 8.02 0 0 1-4.4 5.01Z" />
            </svg>
          </a>
          <a className="footer-social-link" href="#" target="_blank" rel="noreferrer" aria-label="Facebook" title="Facebook">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13.5 21v-7h2.3l.4-3h-2.7V9.1c0-.87.24-1.46 1.5-1.46h1.3V5.02C15.9 5 15.2 5 14.4 5c-2.35 0-3.9 1.43-3.9 4.05V11H8v3h2.5v7h3Z" />
            </svg>
          </a>
          <a className="footer-social-link" href="#" target="_blank" rel="noreferrer" aria-label="Instagram" title="Instagram">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 7.3A4.7 4.7 0 1 0 16.7 12 4.7 4.7 0 0 0 12 7.3Zm0 7.8A3.1 3.1 0 1 1 15.1 12 3.1 3.1 0 0 1 12 15.1Z" />
              <circle cx="17.2" cy="6.8" r="1.1" />
              <path d="M7.4 2h9.2A5.4 5.4 0 0 1 22 7.4v9.2a5.4 5.4 0 0 1-5.4 5.4H7.4A5.4 5.4 0 0 1 2 16.6V7.4A5.4 5.4 0 0 1 7.4 2Zm0 1.7A3.7 3.7 0 0 0 3.7 7.4v9.2a3.7 3.7 0 0 0 3.7 3.7h9.2a3.7 3.7 0 0 0 3.7-3.7V7.4a3.7 3.7 0 0 0-3.7-3.7Z" />
            </svg>
          </a>
          <a className="footer-social-link" href="#" target="_blank" rel="noreferrer" aria-label="LinkedIn" title="LinkedIn">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.4 8.3a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6ZM4.8 9.8H8v9.4H4.8V9.8Zm5.1 0h3.1v1.3h.04c.43-.82 1.5-1.7 3.1-1.7 3.31 0 3.92 2.18 3.92 5.01v4.8h-3.2v-4.26c0-1.02-.02-2.34-1.42-2.34-1.43 0-1.65 1.11-1.65 2.26v4.34H9.9V9.8Z" />
            </svg>
          </a>
        </div>

        <div className="footer-divider" />
        <p className="footer-copy">© 2026 Online Examination App All rights reserved.</p>
      </footer>
    </div>
  );
}

export default Home;

