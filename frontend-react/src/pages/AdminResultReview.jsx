import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";
import "../styles/admin-result-review.css";

function AdminResultReview() {
  useBodyClass("dashboard admin-dashboard");
  const location = useLocation();
  const navigate = useNavigate();
  const passedState = location.state || {};
  const [questions, setQuestions] = useState(Array.isArray(passedState.questions) ? passedState.questions : []);
  const [loading, setLoading] = useState(!questions.length);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  const result = passedState.result || null;
  const resultId = passedState.resultId || result?.result_id;
  const studentName = result?.student_name;

  useEffect(() => {
    if (questions.length || !resultId) {
      setLoading(false);
      return;
    }
    const loadQuestions = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/admin/result-answers/${resultId}`);
        const data = await response.json();
        if (data.success) {
          setQuestions(data.questions || []);
        } else {
          setError(data.message || "Unable to load exam questions.");
        }
      } catch (err) {
        console.error("Result review fetch error:", err);
        setError("Could not load exam questions.");
      } finally {
        setLoading(false);
      }
    };
    loadQuestions();
  }, [resultId, questions.length]);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex];
  const examTitle = useMemo(() => result?.exam_name || result?.exam_id || "Exam", [result]);

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const options = useMemo(() => {
    if (!currentQuestion) {
      return [];
    }
    return [
      { key: "A", label: currentQuestion.option_a },
      { key: "B", label: currentQuestion.option_b },
      { key: "C", label: currentQuestion.option_c },
      { key: "D", label: currentQuestion.option_d }
    ];
  }, [currentQuestion]);

  const isMarked = (optionKey) => optionKey === currentQuestion?.selected_option;
  const isCorrect = (optionKey) => optionKey === currentQuestion?.correct_answer;

  const handleBack = () => {
    navigate("/admin/dashboard", {
      replace: true,
      state: { activeSection: "regular-results" }
    });
  };

  return (
    <div className="dashboard-shell">
      <div className="result-review-shell">
        <div className="result-review-panel">
          <header className="result-review-header">
            <div className="result-review-heading">
              <h1>{examTitle} Review</h1>
              {studentName ? (
                <p className="result-review-student">Student: {studentName}</p>
              ) : result?.student_id ? (
                <p className="result-review-student">Student ID: {result.student_id}</p>
              ) : null}
              {resultId && <p className="result-review-id">Result #{resultId}</p>}
            </div>
            <button type="button" onClick={handleBack} className="ghost-action outline-large">
              Back to Results
            </button>
          </header>
          {loading ? (
            <p className="helper-text">Loading questions…</p>
          ) : error ? (
            <p className="helper-text error">{error}</p>
          ) : totalQuestions === 0 ? (
            <p className="helper-text">No questions found for this result.</p>
          ) : (
            <section className="question-review-card">
              <div className="question-review-meta">
                <span>
                  Question {currentIndex + 1} of {totalQuestions}
                </span>
                <span>
                  Selected: {currentQuestion.selected_option || "--"} | Correct:{" "}
                  {currentQuestion.correct_answer || "--"}
                </span>
              </div>
              <p className="question-review-text">
                <strong>Q:</strong> {currentQuestion.question_text}
              </p>
              <div className="question-options">
                {options.map((option) => (
                  <div
                    key={option.key}
                    className={[
                      "question-option",
                      isMarked(option.key) ? "selected" : "",
                      isCorrect(option.key) ? "correct" : "",
                      isMarked(option.key) && option.key !== currentQuestion.correct_answer
                        ? "incorrect"
                        : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="option-label">
                      <strong>{option.key}</strong>
                      <span>{option.label}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="review-controls">
                <button type="button" onClick={handlePrev} disabled={currentIndex === 0}>
                  Previous
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={currentIndex === totalQuestions - 1}
                >
                  Next
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminResultReview;
