function AdminAnalyticsSection({
  studentCount,
  regularStudentCount,
  regularStudentsPercent,
  walkinStudentCount,
  walkinStudentsPercent,
  regularResultedCount,
  regularResultedPercent,
  walkinResultedCount,
  walkinResultedPercent,
  selectedRegistrationEntry,
  previousRegistrationEntry,
  registrationMonthOffset,
  setRegistrationMonthOffset,
  enrollmentSectionBars,
  registeredBdeCount,
  assignedBdeCount,
  unassignedBdeCount,
  assignmentCoveragePercent
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
          <div className="stat-card stat-card-regular">
            <span className="stat-label">Regular Exam Students</span>
            <span className="stat-value">{regularStudentCount}</span>
            <span className="stat-meta">{regularStudentsPercent.toFixed(0)}% of total students</span>
          </div>
          <div className="stat-card stat-card-walkin">
            <span className="stat-label">Walk-In Exam Students</span>
            <span className="stat-value">{walkinStudentCount}</span>
            <span className="stat-meta">{walkinStudentsPercent.toFixed(0)}% of total students</span>
          </div>
          <div className="stat-card stat-card-regular-result">
            <span className="stat-label">Regular Resulted Students</span>
            <span className="stat-value">{regularResultedCount}</span>
            <span className="stat-meta">{regularResultedPercent.toFixed(0)}% of regular students</span>
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
                <h3>Regular vs Walk-In</h3>
                <span>{studentCount} total</span>
              </div>
              <div className="chart-canvas chart-canvas-compact">
                <div className="simple-donut-row">
                  <div className="simple-donut-card">
                    <div
                      className="simple-donut"
                      style={{ "--donut-percent": `${regularStudentsPercent}%` }}
                    >
                      <div className="simple-donut-center">{regularStudentsPercent.toFixed(0)}%</div>
                    </div>
                    <p className="simple-donut-label">Regular ({regularStudentCount})</p>
                  </div>
                  <div className="simple-donut-card">
                    <div
                      className="simple-donut simple-donut-alt"
                      style={{ "--donut-percent": `${walkinStudentsPercent}%` }}
                    >
                      <div className="simple-donut-center">{walkinStudentsPercent.toFixed(0)}%</div>
                    </div>
                    <p className="simple-donut-label">Walk-In ({walkinStudentCount})</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="chart-row">
            <div className="chart-card">
              <div className="chart-header">
                <h3>Enrollment by Section</h3>
                <span>{studentCount} total students</span>
              </div>
              <div className="chart-canvas chart-canvas-compact">
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
            <div className="chart-card">
              <div className="chart-header">
                <h3>Registered BDEs</h3>
                <span>{registeredBdeCount} total</span>
              </div>
              <div className="chart-canvas chart-canvas-compact">
                <div className="kpi-wrap">
                  <p className="kpi-value">{registeredBdeCount}</p>
                  <p className="kpi-label">Total Registered BDEs</p>
                  <div className="kpi-split">
                    <span>Assigned: {assignedBdeCount}</span>
                    <span>Unassigned: {unassignedBdeCount}</span>
                  </div>
                  <div className="kpi-split">
                    <span>Assignment Coverage: {assignmentCoveragePercent.toFixed(0)}%</span>
                    <span>Total Students: {studentCount}</span>
                  </div>
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
