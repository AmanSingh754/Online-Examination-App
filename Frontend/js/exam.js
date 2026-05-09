console.log("Exam page loaded");

// ================= AUTH =================
const studentId = localStorage.getItem("studentId");
if (!studentId) {
    window.location.href = "/";
}

// ================= GET EXAM ID =================
const params = new URLSearchParams(window.location.search);
const examId = params.get("examId");
const studentExamId = Number(params.get("studentExamId") || 0);

if (!examId) {
    alert("Invalid exam");
    window.location.href = "/student";
}

// ================= STATE =================
let questionBank = [];
let answerMap = new Map();

// ================= PREVENT RE-ATTEMPT =================
fetch(`/exam/attempted/${studentId}/${examId}`)
    .then(res => res.json())
    .then(data => {
        if (data.attempted) {
            alert("You have already attempted this exam.");
            window.location.href = "/student";
        }
    })
    .catch(err => {
        console.error("Attempt check error:", err);
        alert("Unable to verify exam now");
        window.location.href = "/student";
    });

// ================= LOAD QUESTIONS =================
fetch(`/exam/questions/${examId}`)
    .then(res => res.json())
    .then(data => {
        const container = document.getElementById("questionsContainer");

        if (!data || data.length === 0) {
            container.innerHTML = "<p>No questions found.</p>";
            return;
        }

        questionBank = data;
        let currentIndex = 0;

        const counterEl = document.getElementById("questionCounter");
        const progressEl = document.getElementById("questionProgress");
        const prevBtn = document.getElementById("prevBtn");
        const nextBtn = document.getElementById("nextBtn");
        const submitBtn = document.getElementById("submitBtn");

        const updateNav = () => {
            counterEl.innerText = `Question ${currentIndex + 1} of ${questionBank.length}`;
            progressEl.innerText = `${currentIndex + 1}/${questionBank.length}`;
            prevBtn.disabled = currentIndex === 0;
            nextBtn.style.display = currentIndex === questionBank.length - 1 ? "none" : "inline-block";
            submitBtn.style.display = currentIndex === questionBank.length - 1 ? "inline-block" : "none";
        };

        const renderQuestion = (direction) => {
            const q = questionBank[currentIndex];
            const div = document.createElement("div");
            div.className = "question-box";
            if (direction) {
                div.classList.add(direction === "next" ? "slide-in-right" : "slide-in-left");
            }

            div.innerHTML = `
                <p><strong>Q${currentIndex + 1}. ${q.question_text}</strong></p>

                <label>
                    <input type="radio" name="q_${q.question_id}" value="A">
                    <span class="option-index">A</span>
                    <span class="option-text">${q.option_a}</span>
                </label>

                <label>
                    <input type="radio" name="q_${q.question_id}" value="B">
                    <span class="option-index">B</span>
                    <span class="option-text">${q.option_b}</span>
                </label>

                <label>
                    <input type="radio" name="q_${q.question_id}" value="C">
                    <span class="option-index">C</span>
                    <span class="option-text">${q.option_c}</span>
                </label>

                <label>
                    <input type="radio" name="q_${q.question_id}" value="D">
                    <span class="option-index">D</span>
                    <span class="option-text">${q.option_d}</span>
                </label>
            `;

            container.innerHTML = "";
            container.appendChild(div);

            const saved = answerMap.get(q.question_id);
            if (saved) {
                const input = div.querySelector(`input[value="${saved}"]`);
                if (input) input.checked = true;
            }
        };

        container.addEventListener("change", (event) => {
            if (event.target && event.target.matches("input[type=radio]")) {
                const name = event.target.name;
                const questionId = name.split("_")[1];
                answerMap.set(Number(questionId), event.target.value);
            }
        });

        prevBtn.addEventListener("click", () => {
            if (currentIndex === 0) return;
            currentIndex -= 1;
            renderQuestion("prev");
            updateNav();
        });

        nextBtn.addEventListener("click", () => {
            if (currentIndex >= questionBank.length - 1) return;
            currentIndex += 1;
            renderQuestion("next");
            updateNav();
        });

        renderQuestion("next");
        updateNav();
    })
    .catch(err => {
        console.error("Load questions error:", err);
        document.getElementById("questionsContainer").innerHTML =
            "<p>Error loading questions</p>";
    });

// ================= SUBMIT EXAM =================
document.getElementById("examForm").addEventListener("submit", e => {
    e.preventDefault();

    const answers = Array.from(answerMap.entries()).map(([questionId, value]) => ({
        question_id: questionId,
        selected_option: value
    }));

    if (answers.length === 0) {
        alert("Please answer at least one question");
        return;
    }

    fetch("/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            studentId,
            examId,
            studentExamId: studentExamId > 0 ? studentExamId : null,
            answers
        })
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            alert(data.message || "Submission failed");
            return;
        }

        // ✅ STORE SUCCESS MESSAGE
        localStorage.setItem(
            "examSuccessMessage",
            "Exam submitted successfully. Results will be published soon."
        );

        // ✅ REDIRECT TO DASHBOARD
        window.location.href = "/student";
    })
    .catch(err => {
        console.error("Exam submit error:", err);
        alert("Server error during submission");
    });
});
