function AdminAnalyticsSection({
  studentCount,
  walkinStudentCount,
  walkinStudentsPercent,
  walkinResultedCount,
  walkinResultedPercent,
  selectedRegistrationEntry,
  previousRegistrationEntry,
  registrationMonthOffset,
  setRegistrationMonthOffset,
  enrollmentSectionBars
}) {
  return (
    <div className="dashboard-section admin-section" id="admin-analytics">
      <h2>Analytics</h2>
      <div className="analytics-layout">
        <div className="stat-grid">
          <div className="stat-card stat-card-neutral">
            <span className="stat-label">Total Students</span>
            <span className="stat-value">{studentCount}</span>
            <span className="stat-meta">Registered learners</span>
          </div>
          <div className="stat-card stat-card-walkin">
            <span className="stat-label">Walk-In Exam Students</span>
            <span className="stat-value">{walkinStudentCount}</span>
            <span className="stat-meta">{walkinStudentsPercent.toFixed(0)}% of total students</span>
          </div>
          <div className="stat-card stat-card-walkin-result">
            <span className="stat-label">Walk-In Resulted Students</span>
            <span className="stat-value">{walkinResultedCount}</span>
            <span className="stat-meta">{walkinResultedPercent.toFixed(0)}% of walk-in students</span>
          </div>
        </div>
        <div className="chart-stack">
          <div className="chart-row chart-row-primary">
            <div className="chart-card">
              <div className="chart-header">
                <h3>Monthly Registrations</h3>
              </div>
              <div className="chart-canvas chart-canvas-compact chart-canvas-monthly">
                <button
                  type="button"
                  className="month-nav-btn month-nav-btn-inline month-nav-btn-left"
                  aria-label="Show previous month registrations"
                  onClick={() => setRegistrationMonthOffset((prev) => Math.min(prev + 1, 24))}
                >
                  &#8249;
                </button>
                <div className="monthly-registrations-card">
                  <div className="monthly-registrations-summary">
                    <p className="monthly-summary-value">{Number(selectedRegistrationEntry?.total || 0)}</p>
                    <p className="monthly-summary-label">
                      Registrations in {selectedRegistrationEntry?.monthLabel || "--"}
                    </p>
                    <div className="monthly-summary-previous">
                      <span className="monthly-summary-previous-label">Previous Month</span>
                      <div className="monthly-summary-previous-meta">
                        <strong>{Number(previousRegistrationEntry?.total || 0)}</strong>
                        <span>{previousRegistrationEntry?.monthLabel || "--"}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="month-nav-btn month-nav-btn-inline month-nav-btn-right"
                  aria-label="Show next month registrations"
                  onClick={() => setRegistrationMonthOffset((prev) => Math.max(prev - 1, 0))}
                  disabled={registrationMonthOffset === 0}
                >
                  &#8250;
                </button>
              </div>
            </div>
            <div className="chart-card">
              <div className="chart-header">
                <h3>Enrollment by Section</h3>
                <span>{studentCount} total students</span>
              </div>
              <div className="chart-canvas chart-canvas-compact chart-canvas-enrollment">
                <div className="section-enrollment-bars">
                  {enrollmentSectionBars.map((entry) => (
                    <div className={`section-enrollment-row tone-${entry.tone}`} key={`enroll-row-${entry.label}`}>
                      <div className="section-enrollment-head">
                        <span>{entry.label}</span>
                        <span>{entry.count} ({entry.percent.toFixed(0)}%)</span>
                      </div>
                      <div className="section-enrollment-track">
                        <div
                          className="section-enrollment-fill"
                          style={{ width: `${entry.barPercent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminAnalyticsSection;
