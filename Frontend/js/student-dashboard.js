console.log("Student dashboard JS loaded");

/* ================= AUTH GUARD ================= */
const studentId = localStorage.getItem("studentId");
const studentName = localStorage.getItem("studentName");
const studentEmail = localStorage.getItem("studentEmail");
const studentContact = localStorage.getItem("studentContact");

if (!studentId || !studentName) {
    alert("Please login first");
    window.location.href = "/";
}

function formatExamDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString();
}

function formatExamDateRange(exam) {
    const startText = formatExamDate(exam.exam_start_date || exam.exam_date);
    const endText = formatExamDate(exam.exam_end_date || exam.exam_date);
    if (startText && endText && startText !== endText) {
        return `${startText} to ${endText}`;
    }
    return startText || endText || "-";
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {

    // 👋 Show student name
    const nameEl = document.getElementById("studentNameText");
    if (nameEl) {
        nameEl.innerText = `Welcome, ${studentName}`;
    }

    loadStudentProfile();
    loadStudentExams(studentId);
    loadAttemptedExams(studentId);
});

/* ================= LOAD PROFILE ================= */
function loadStudentProfile() {
    const nameEl = document.getElementById("profileName");
    const rollEl = document.getElementById("profileRoll");
    const emailEl = document.getElementById("profileEmail");
    const contactEl = document.getElementById("profileContact");

    if (nameEl) {
        nameEl.innerText = studentName || "Not available";
    }

    if (rollEl) {
        rollEl.innerText = studentId || "Not available";
    }

    if (emailEl) {
        emailEl.innerText = studentEmail || "Not available";
    }

    if (contactEl) {
        contactEl.innerText = studentContact || "Not available";
    }
}

/* ================= LOAD AVAILABLE EXAMS ================= */
function loadStudentExams(studentId) {
    const table = document.getElementById("studentExamTable");
    table.innerHTML = "";

    fetch(`/student/exams/${studentId}`)
        .then(res => res.json())
        .then(data => {
            if (!data || data.length === 0) {
                table.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align:center;">
                            No exams available
                        </td>
                    </tr>
                `;
                return;
            }

            data.forEach(exam => {
            const row = document.createElement("tr");
            const displayDate = formatExamDateRange(exam);

            row.innerHTML = `
                    <td>${exam.exam_name}</td>
                    <td>${displayDate}</td>
                    <td>${exam.start_time} - ${exam.end_time}</td>
                    <td>${exam.course}</td>
                    <td>
                        <button onclick="startExam(${exam.exam_id})">
                            Start Exam
                        </button>
                    </td>
                `;
                table.appendChild(row);
            });
        })
        .catch(err => {
            console.error("Load available exams error:", err);
        });
}

/* ================= LOAD ATTEMPTED EXAMS ================= */
function loadAttemptedExams(studentId) {
    const table = document.getElementById("attemptedExamTable");
    table.innerHTML = "";

    fetch(`/student/attempted-exams/${studentId}`)
        .then(res => res.json())
        .then(data => {
           

            if (!data || data.length === 0) {
                table.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align:center;">
                            No attempted exams
                        </td>
                    </tr>
                `;
                return;
            }

            data.forEach(exam => {

                const row = document.createElement("tr");
                const displayDate = formatExamDateRange(exam);

                row.innerHTML = `
                    <td>${exam.exam_name}</td>
                    <td>${displayDate}</td>
                    <td>${exam.course}</td>
                    <td>${exam.attempt_status}</td>
                `;
                table.appendChild(row);
            });
        })
        .catch(err => {
            console.error("Load attempted exams error:", err);
        });
}

/* ================= START EXAM ================= */
function startExam(examId) {
    fetch(`/exam/attempted/${studentId}/${examId}`)
        .then(res => res.json())
        .then(data => {
            if (data.attempted) {
                alert("You have already attempted this exam.");
            } else {
                fetch("/exam/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ studentId, examId })
                })
                    .then(res => res.json())
                    .then(startData => {
                        if (!startData || !startData.success) {
                            alert(startData?.message || "Unable to start exam.");
                            return;
                        }
                        const studentExamId = Number(startData.studentExamId || 0);
                        const suffix = studentExamId > 0 ? `&studentExamId=${studentExamId}` : "";
                        window.location.href = `/exam.html?examId=${examId}${suffix}`;
                    })
                    .catch(() => {
                        alert("Unable to start exam.");
                    });
            }
        });
}

/* ================= LOGOUT ================= */
function logoutStudent() {
    fetch("/student/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => {
            localStorage.removeItem("studentId");
            localStorage.removeItem("studentName");
            localStorage.removeItem("studentEmail");
            localStorage.removeItem("studentContact");
            window.location.href = "/student/login";
        });
}
