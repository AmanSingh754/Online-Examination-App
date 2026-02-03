import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";
import Editor from "@monaco-editor/react";

const EXAM_DURATION_SECONDS = 30 * 60;
const VIOLATION_LIMIT = 3;
const DEFAULT_LANGUAGE = "python";
const LANGUAGE_OPTIONS = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "go", label: "Go" }
];

const INSTRUCTIONS = [
  "Remain in fullscreen until the session completes.",
  "Keep this tab active; tab switching counts as a violation.",
  "Answer a question before moving forward and review only by using Previous.",
  "Avoid refreshing or closing the browser while the exam is live.",
  "Reach out to support immediately if the question content looks broken."
];

const SECTION_INSTRUCTIONS = {
  aptitude: {
    title: "Aptitude Section",
    message:
      "This section measures your reasoning, calculation speed, and logical accuracy. Stay calm and work steadily."
  },
  coding: {
    title: "Coding Section",
    message:
      "Now entering the coding section. Use the editor on the right, select the desired language, and run your code before submitting."
  },
  descriptive: {
    title: "Theory Section",
    message:
      "This section probes your understanding of concepts. Answer in 50-80 words, focus on clarity, and avoid bullet dumps."
  }
};

const getSectionInstruction = (sectionName) => {
  if (!sectionName) {
    return {
      title: "Next Section",
      message: "Prepare to continue with the next section and adjust your approach accordingly."
    };
  }
  const normalized = sectionName.toLowerCase().trim();
  const key = Object.keys(SECTION_INSTRUCTIONS).find((entry) =>
    normalized.includes(entry)
  );
  return SECTION_INSTRUCTIONS[key] || {
    title: `${sectionName} Section`,
    message: `You are about to start the ${sectionName} section. Take a breath and refocus.`
  };
};

export default function Exam() {
  useBodyClass("exam-page");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const examId = params.get("examId");

  const [questionBank, setQuestionBank] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preExamOpen, setPreExamOpen] = useState(true);
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_SECONDS);
  const [violations, setViolations] = useState(0);
  const [proctorMessage, setProctorMessage] = useState("");
  const [currentSection, setCurrentSection] = useState("");
  const [visitedSections, setVisitedSections] = useState([]);
  const [pendingSection, setPendingSection] = useState("");
  const [pendingSectionIndex, setPendingSectionIndex] = useState(null);
  const [sectionOverlayOpen, setSectionOverlayOpen] = useState(false);

  const [consoleLines, setConsoleLines] = useState([]);
  const [codingInput, setCodingInput] = useState("");
  const [codingOutput, setCodingOutput] = useState("");
  const [codingLanguage, setCodingLanguage] = useState(DEFAULT_LANGUAGE);
  const [isRunningCode, setIsRunningCode] = useState(false);

  const currentQuestion = questionBank[currentIndex];
  const questionType = (currentQuestion?.question_type || "MCQ").toLowerCase();
  const currentAnswer = currentQuestion ? answers[currentQuestion.question_id] || "" : "";

  useEffect(() => {
    if (!examId) {
      setError("Invalid exam");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch(`/exam/questions/${examId}`, { credentials: "include", signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) {
          setError("No questions found.");
          return;
        }
        setQuestionBank(data);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Load questions error:", err);
          setError("Unable to load questions.");
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [examId]);

  useEffect(() => {
    if (!questionBank.length) return;
    const firstSection = (questionBank[0].section_name || "Aptitude").trim();
    setCurrentSection(firstSection);
    setVisitedSections([firstSection]);
    setPendingSection("");
    setPendingSectionIndex(null);
    setSectionOverlayOpen(false);
  }, [questionBank]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [timeLeft]);

  const updateAnswer = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const logConsole = useCallback((message) => {
    setConsoleLines((prev) => [...prev, message]);
  }, []);

  const handleRunCode = useCallback(async () => {
    if (!currentQuestion || isRunningCode) return;
    setIsRunningCode(true);
    logConsole("> Code run invoked");
    logConsole(`> Input: ${codingInput || "<NO INPUT>"}`);

    try {
      const response = await fetch("/exam/run-code", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: codingLanguage,
          code: currentAnswer,
          input: codingInput
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Execution failed");
      }

      if (data.stdout) {
        data.stdout.split(/\r?\n/).forEach((line) => {
          if (line.trim()) {
            logConsole(`> STDOUT: ${line}`);
          }
        });
      }
      if (data.stderr) {
        data.stderr.split(/\r?\n/).forEach((line) => {
          if (line.trim()) {
            logConsole(`> STDERR: ${line}`);
          }
        });
      }
      if (data.timedOut) {
        logConsole("> Execution timed out");
      }

      const outputDisplay = (data.stdout || data.stderr || "<no output>").trim();
      setCodingOutput(outputDisplay);
    } catch (err) {
      logConsole(`> Error: ${err.message}`);
      setCodingOutput(err.message);
      console.error("Run code error:", err);
    } finally {
      setIsRunningCode(false);
    }
  }, [codingInput, codingLanguage, currentAnswer, currentQuestion, isRunningCode, logConsole]);

  const handleSectionOverlayClose = () => {
    if (!pendingSection || pendingSectionIndex === null) {
      setSectionOverlayOpen(false);
      return;
    }
    setCurrentIndex(pendingSectionIndex);
    setCurrentSection(pendingSection);
    setVisitedSections((prev) =>
      prev.includes(pendingSection) ? prev : [...prev, pendingSection]
    );
    setPendingSection("");
    setPendingSectionIndex(null);
    setSectionOverlayOpen(false);
  };

  const handleNext = () => {
    if (sectionOverlayOpen) {
      return;
    }
    const targetIndex = Math.min(currentIndex + 1, questionBank.length - 1);
    const nextSection = (questionBank[targetIndex]?.section_name || "Aptitude").trim();
    if (
      targetIndex > currentIndex &&
      nextSection !== currentSection &&
      !visitedSections.includes(nextSection)
    ) {
      setPendingSection(nextSection);
      setPendingSectionIndex(targetIndex);
      setSectionOverlayOpen(true);
      return;
    }
    setCurrentIndex(targetIndex);
    if (nextSection !== currentSection) {
      setCurrentSection(nextSection);
      setVisitedSections((prev) =>
        prev.includes(nextSection) ? prev : [...prev, nextSection]
      );
    }
  };

  const handlePrevious = () => {
    if (sectionOverlayOpen) return;
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  const renderQuestionBody = () => {
    if (!currentQuestion) {
      return <p className="status-text">No question available.</p>;
    }

    if (questionType === "coding") {
      return (
        <div className="coding-answer">
          <div className="coding-language-selector">
            <label htmlFor="coding-language">Language</label>
            <select
              id="coding-language"
              value={codingLanguage}
              onChange={(event) => setCodingLanguage(event.target.value)}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="coding-editor">
            <Editor
              height="320px"
              language={codingLanguage}
              theme="vs-dark"
              value={currentAnswer}
              onChange={(value) => updateAnswer(currentQuestion.question_id, value || "")}
              options={{
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false
              }}
            />
          </div>
        </div>
      );
    }

    if (questionType === "descriptive") {
      return (
        <textarea
          className="descriptive-input"
          placeholder="Type your answer here (50-80 words)..."
          value={currentAnswer}
          onChange={(event) => updateAnswer(currentQuestion.question_id, event.target.value)}
        />
      );
    }

    const options = ["A", "B", "C", "D"].map((key) => ({
      value: key,
      label: currentQuestion[`option_${key.toLowerCase()}`] || ""
    }));

    return (
      <div className="option-list">
        {options.map((option) => (
          <label
            key={option.value}
            className={`option-item ${currentAnswer === option.value ? "selected" : ""}`}
          >
            <input
              type="radio"
              name={`q_${currentQuestion.question_id}`}
              value={option.value}
              checked={currentAnswer === option.value}
              onChange={() => updateAnswer(currentQuestion.question_id, option.value)}
            />
            <span className="option-index">{option.value}</span>
            <span className="option-text">{option.label}</span>
          </label>
        ))}
      </div>
    );
  };

  const sectionInstruction = getSectionInstruction(pendingSection || currentSection);

  return (
    <div className="exam-shell new-layout" aria-hidden={preExamOpen}>
      {preExamOpen && (
        <div className="preexam-overlay">
          <div className="preexam-panel">
            <header className="preexam-header">
              <p className="eyebrow">Pre-exam briefing</p>
              <h1>Review the notice board</h1>
              <p>
                You are about to enter a fully proctored session. This briefing captures the key
                notices, violation rules, and what you must do before the exam timer starts. Once you
                tap "Start exam," the countdown cannot be reset.
              </p>
            </header>
            <div className="preexam-notices">
              <h2>Instructions</h2>
              <ul>
                {INSTRUCTIONS.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
            <div className="preexam-actions">
              <button
                type="button"
                className="start-btn"
                onClick={() => {
                  setPreExamOpen(false);
                  setProctorMessage("Exam session started. Keep fullscreen and stay focused.");
                }}
              >
                Start exam
              </button>
              <p className="preexam-footnote">
                Closing this overlay will begin the session immediately. Keep the browser stable and
                avoid refreshing.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="background-glow" />
      {sectionOverlayOpen && (
        <div className="section-instruction-overlay">
          <div className="section-instruction-panel">
            <h2>{sectionInstruction.title}</h2>
            <p>{sectionInstruction.message}</p>
            <button type="button" onClick={handleSectionOverlayClose}>
              Continue to {pendingSection || "next"} section
            </button>
          </div>
        </div>
      )}
      <div className="exam-header">
        <div>
          <p className="eyebrow">Live proctored session</p>
          <h1>RP2 Scholarship Exam</h1>
        </div>
        <div className="header-chips">
          <div className="chip">
            <span>Time remaining</span>
            <strong>{formattedTime}</strong>
          </div>
          <div className="chip">
            <span>Violations</span>
            <strong>
              {violations}/{VIOLATION_LIMIT}
            </strong>
          </div>
          <div className="chip subtle">Fullscreen active</div>
        </div>
      </div>

      <div className="exam-main">
        <section className="question-column">
          <div className="progress-top">
            <div>
              <span className="eyebrow">Live question</span>
              <strong>
                {questionBank.length ? currentIndex + 1 : "--"} / {questionBank.length || "--"}
              </strong>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${questionBank.length ? ((currentIndex + 1) / questionBank.length) * 100 : 0}%` }}
              />
            </div>
            <small>{questionBank.length ? `${Math.round(((currentIndex + 1) / questionBank.length) * 100)}% complete` : "Preparing"}</small>
          </div>
          <div className="question-card surface">
            {!loading && currentQuestion && (
              <>
                <div className="question-prompt">
                  <span className="question-label">Q{currentIndex + 1}</span>
                  <p className="question-text">{currentQuestion.question_text}</p>
                </div>
                {renderQuestionBody()}
                {questionType === "coding" && (
                  <div className="coding-console-card">
                    <div className="console-header">
                      <div>STDOUT</div>
                      <button className="run-btn" type="button" onClick={handleRunCode} disabled={isRunningCode}>
                        {isRunningCode ? "Running..." : "Run Code"}
                      </button>
                    </div>
                    <div className="console-body">
                      {consoleLines.length ? (
                        consoleLines.map((line, index) => (
                          <div key={index} className="console-line">
                            {line}
                          </div>
                        ))
                      ) : (
                        <div className="console-line muted">Awaiting commands...</div>
                      )}
                    </div>
                    <div className="io-panel">
                      <div className="io-column">
                        <label>Input</label>
                        <textarea
                          value={codingInput}
                          onChange={(event) => setCodingInput(event.target.value)}
                          placeholder="Enter input for your program"
                        />
                      </div>
                      <div className="io-column">
                        <label>Output</label>
                        <div className="output-area">{codingOutput || "<no output yet>"}</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {loading && <p className="status-text">Loading exam content...</p>}
            {!loading && error && <p className="status-text error-text">{error}</p>}
              <div className="question-actions">
                <button
                  type="button"
                  className="nav-btn"
                  onClick={handlePrevious}
                  disabled={currentIndex === 0 || sectionOverlayOpen}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="nav-btn primary"
                  onClick={handleNext}
                  disabled={currentIndex >= questionBank.length - 1 || sectionOverlayOpen}
                >
                  Next
                </button>
              </div>
          </div>
        </section>
      </div>
    </div>
  );
}
