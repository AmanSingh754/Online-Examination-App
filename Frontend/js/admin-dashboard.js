console.log("Admin dashboard JS loaded");

const adminId = localStorage.getItem("adminId");
const collegeName = localStorage.getItem("collegeName");

document.addEventListener("DOMContentLoaded", () => {
    if (!adminId) {
        window.location.href = "/admin";
        return;
    }

    const collegeEl = document.getElementById("collegeNameText");
    if (collegeEl && collegeName) {
        collegeEl.innerText = collegeName;
    }

    document.getElementById("createExamBtn")?.addEventListener("click", createExam);
    document.getElementById("generateBtn")?.addEventListener("click", generateQuestions);
    document.getElementById("courseSelect")?.addEventListener("change", (e) => {
        const customInput = document.getElementById("customCourse");
        if (!customInput) return;
        if (e.target.value === "OTHER") {
            customInput.style.display = "block";
        } else {
            customInput.style.display = "none";
            customInput.value = "";
        }
    });

    updateExamFields();
    loadExams();
});

function loadExams() {
    fetch("/admin/exams")
        .then((res) => res.json())
        .then((data) => {
            const rows = Array.isArray(data) ? data : [];
            const table = document.getElementById("examTable");
            const examSelect = document.getElementById("examSelect");

            if (!table || !examSelect) return;

            table.innerHTML = "";
            examSelect.innerHTML = `<option value="">Select Exam</option>`;

            if (!rows.length) {
                table.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center;">No exams found</td>
                    </tr>`;
                return;
            }

            rows.forEach((exam) => {
                const row = document.createElement("tr");
                const scheduleText = exam.start_at && exam.end_at
                    ? `${new Date(exam.start_at).toLocaleString()} to ${new Date(exam.end_at).toLocaleString()}`
                    : "--";
                row.innerHTML = `
                    <td>${exam.exam_id}</td>
                    <td>${exam.course}</td>
                    <td>${exam.exam_status}</td>
                    <td>${scheduleText}</td>
                    <td>${exam.cutoff ?? "--"}</td>
                    <td>
                        <button class="danger-btn" onclick="deleteExam(${exam.exam_id})">
                            Delete
                        </button>
                    </td>
                `;
                table.appendChild(row);

                const opt = document.createElement("option");
                opt.value = exam.exam_id;
                opt.textContent = `Exam ${exam.exam_id} (${exam.course})`;
                examSelect.appendChild(opt);
            });
        })
        .catch((err) => console.error("Load exams error:", err));
}

function createExam() {
    const courseSelect = document.getElementById("courseSelect")?.value || "";
    const customCourse = document.getElementById("customCourse")?.value?.trim() || "";
    const startDate = document.getElementById("startDate")?.value || "";
    const startTime = document.getElementById("startTime")?.value || "";
    const endDate = document.getElementById("endDate")?.value || "";
    const endTime = document.getElementById("endTime")?.value || "";
    const cutoff = document.getElementById("cutoffInput")?.value || "";
    const payload = {};
    const course = courseSelect === "OTHER" ? customCourse : courseSelect;
    if (!course) {
        alert("Select a course for regular exam");
        return;
    }
    if (!startDate || !startTime || !endDate || !endTime) {
        alert("Select start and end date/time");
        return;
    }
    payload.course = course;
    payload.startDate = startDate;
    payload.startTime = startTime;
    payload.endDate = endDate;
    payload.endTime = endTime;
    payload.cutoff = cutoff;

    fetch("/admin/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then((res) => res.json())
        .then((data) => {
            if (!data.success) {
                alert(data.message || "Exam creation failed");
                return;
            }
            const courseInput = document.getElementById("courseSelect");
            const customInput = document.getElementById("customCourse");
            if (courseInput) courseInput.value = "";
            if (customInput) {
                customInput.value = "";
                customInput.style.display = "none";
            }
            const startDateInput = document.getElementById("startDate");
            const startTimeInput = document.getElementById("startTime");
            const endDateInput = document.getElementById("endDate");
            const endTimeInput = document.getElementById("endTime");
            const cutoffInput = document.getElementById("cutoffInput");
            if (startDateInput) startDateInput.value = "";
            if (startTimeInput) startTimeInput.value = "";
            if (endDateInput) endDateInput.value = "";
            if (endTimeInput) endTimeInput.value = "";
            if (cutoffInput) cutoffInput.value = "";
            loadExams();
        })
        .catch((err) => console.error("Create exam error:", err));
}

function updateExamFields() {
    const courseSelect = document.getElementById("courseSelect");
    const customInput = document.getElementById("customCourse");

    if (!courseSelect || !customInput) return;

    courseSelect.style.display = "block";
    if (courseSelect.value === "OTHER") {
        customInput.style.display = "block";
    } else {
        customInput.style.display = "none";
    }
}

function deleteExam(examId) {
    if (!confirm("Delete this exam?")) return;
    fetch(`/admin/exam/${examId}`, { method: "DELETE" })
        .then(() => loadExams())
        .catch((err) => console.error("Delete exam error:", err));
}

function generateQuestions() {
    const examId = document.getElementById("examSelect")?.value;
    const questionCount = document.getElementById("questionCount")?.value;
    const status = document.getElementById("generateStatus");

    if (!examId || !questionCount) {
        alert("Select exam and number of questions");
        return;
    }

    if (status) status.innerText = "Generating questions...";

    fetch(`/admin/generate-questions/${examId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionCount: Number(questionCount) })
    })
        .then((res) => res.json())
        .then((data) => {
            if (status) {
                status.innerText = data.success
                    ? "Questions generated successfully"
                    : (data.message || "Generation failed");
            }
        })
        .catch(() => {
            if (status) status.innerText = "Server error during generation";
        });
}

function logoutAdmin() {
    fetch("/admin/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => {
            localStorage.clear();
            window.location.href = "/admin/login";
        });
}
