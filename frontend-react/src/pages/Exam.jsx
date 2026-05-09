import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useBodyClass from "../hooks/useBodyClass.js";
import Editor from "@monaco-editor/react";

const VIOLATION_LIMIT = 3;
const DEFAULT_LANGUAGE = "python";
const LANGUAGE_OPTIONS = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "cpp", label: "C++" }
];

const INSTRUCTIONS = [
  "When you click Next, your current answer will be saved and you can move forward.",
  "To revisit an earlier question, please use the Previous button.",
  "Please avoid refreshing or closing the browser while the exam is in progress."
];
const FEEDBACK_QUESTION =
  "Tell us about the exam, question quality, and overall difficulty (max 100 words).";
const LEETCODE_CODING_CONFIGS = {
  1: {
    methodName: "reverseString",
    pythonStarter: `class Solution:
    def reverseString(self, s):
        pass
`,
    javascriptStarter: `class Solution {
  reverseString(s) {
    
  }
}
`,
    cppStarter: `class Solution {
public:
    string reverseString(string s) {
        
    }
};
`
  },
  2: {
    methodName: "numberPyramid",
    pythonStarter: `class Solution:
    def numberPyramid(self, n):
        pass
`,
    javascriptStarter: `class Solution {
  numberPyramid(n) {
    
  }
}
`,
    cppStarter: `class Solution {
public:
    string numberPyramid(int n) {
        
    }
};
`
  },
  3: {
    methodName: "twoSum",
    pythonStarter: `class Solution:
    def twoSum(self, numbers, target):
        pass
`,
    javascriptStarter: `class Solution {
  twoSum(numbers, target) {
    
  }
}
`,
    cppStarter: `class Solution {
public:
    vector<int> twoSum(vector<int>& numbers, int target) {
        
    }
};
`
  }
};

const SECTION_INSTRUCTIONS = {
  aptitude: {
    title: "Aptitude Section",
    message:
      "This section measures logical reasoning, verbal ability, and numerical reasoning. Tackle each question calmly and move steadily."
  },
  technical: {
    title: "Technical Section",
    message:
      "This section includes both MCQ and descriptive questions covering core technical concepts. Read carefully, use the provided examples, and answer directly."
  },
  coding: {
    title: "Coding Section",
    message:
      "Now entering the coding section. Use the editor provided, select your language, and print the result before submitting."
  }
};
const getDescriptiveWordLimit = (questionId) => {
  const id = Number(questionId || 0);
  if ((id >= 1 && id <= 20) || (id >= 39 && id <= 44)) return 40;
  if (id >= 21 && id <= 30) return 15;
  if (id >= 31 && id <= 38) return 25;
  return null;
};
const countWords = (text) =>
  String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;



const getSectionInstruction = (sectionName) => {
  if (!sectionName) {
    return {
      title: "Next Section",
      message: "Prepare for the upcoming part of the exam and adjust your pace accordingly."
    };
  }
  const normalized = sectionName.toLowerCase().trim();
  const key = Object.keys(SECTION_INSTRUCTIONS).find((entry) =>
    normalized.includes(entry)
  );
  return SECTION_INSTRUCTIONS[key] || {
    title: `${sectionName} Section`,
    message: `You are about to begin the ${sectionName} section. Stay focused and keep your responses clear.`
  };
};
const getSectionDisplayName = (sectionName) => getSectionInstruction(sectionName).title;
const isTechnicalSection = (sectionName) =>
  String(sectionName || "").trim().toLowerCase().includes("technical");
const getLeetCodeConfig = (questionId) => LEETCODE_CODING_CONFIGS[Number(questionId || 0)] || null;
const getCodingStarterTemplate = (questionId, language) => {
  const config = getLeetCodeConfig(questionId);
  if (!config) return "";
  if (language === "python") return config.pythonStarter;
  if (language === "javascript") return config.javascriptStarter;
  if (language === "cpp") return config.cppStarter;
  return "";
};

const enterFullscreen = () => {
  const docEl = document.documentElement;
  if (!docEl) return;
  const request =
    docEl.requestFullscreen ||
    docEl.webkitRequestFullscreen ||
    docEl.mozRequestFullScreen ||
    docEl.msRequestFullscreen;
  if (request) {
    request.call(docEl).catch(() => {
      /* silence fullscreen denial */
    });
  }
};

const exitFullscreenSafe = async () => {
  const active =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement;
  if (!active) return;

  const exit =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen;
  if (!exit) return;

  try {
    await exit.call(document);
  } catch {
    /* ignore fullscreen exit errors */
  }
};

const isIOSPlatform = () => {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const platform = String(navigator.platform || "");
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
  const iOSByUA = /iPad|iPhone|iPod/i.test(ua);
  const iPadOSDesktopMode = platform === "MacIntel" && maxTouchPoints > 1;
  return iOSByUA || iPadOSDesktopMode;
};

const hasFullscreenSupport = () => {
  if (typeof document === "undefined") return false;
  const docEl = document.documentElement;
  if (!docEl) return false;
  return Boolean(
    docEl.requestFullscreen ||
      docEl.webkitRequestFullscreen ||
      docEl.mozRequestFullScreen ||
      docEl.msRequestFullscreen
  );
};

export default function Exam() {
  useBodyClass("exam-page");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const examId = params.get("examId");
  const studentExamIdParam = Number(params.get("studentExamId") || 0);
  const storedStudentType = String(localStorage.getItem("studentType") || "REGULAR")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "_");
  const isWalkinExamSession = true;
  const examApiBase = "/exam";

  const [questionBank, setQuestionBank] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preExamOpen, setPreExamOpen] = useState(true);
  const [preExamStep, setPreExamStep] = useState(1);
  const [violations, setViolations] = useState(0);
  const [currentSection, setCurrentSection] = useState("");
  const [visitedSections, setVisitedSections] = useState([]);
  const [pendingSection, setPendingSection] = useState("");
  const [pendingSectionIndex, setPendingSectionIndex] = useState(null);
  const [sectionOverlayOpen, setSectionOverlayOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [consoleLines, setConsoleLines] = useState([]);
  const [codingOutput, setCodingOutput] = useState("");
  const [codingLanguage, setCodingLanguage] = useState(DEFAULT_LANGUAGE);
  const [codingLanguageByQuestion, setCodingLanguageByQuestion] = useState({});
  const [isRunningCode, setIsRunningCode] = useState(false);
  const [testOutcomes, setTestOutcomes] = useState([]);
  const [codingRunSummary, setCodingRunSummary] = useState({});
  const [walkinCodingEntries, setWalkinCodingEntries] = useState([]);
  const [technicalStreams, setTechnicalStreams] = useState([]);
  const [currentTechnicalStream, setCurrentTechnicalStream] = useState("");
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedQuestions, setSavedQuestions] = useState({});
  const [autosaveStatus, setAutosaveStatus] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [submittedContext, setSubmittedContext] = useState(null);
  const [violationWarning, setViolationWarning] = useState({
    open: false,
    count: 0,
    reason: ""
  });
  const [securityNotice, setSecurityNotice] = useState("");
  const [securityNoticeKey, setSecurityNoticeKey] = useState(0);
  const [descriptiveLimitMessage, setDescriptiveLimitMessage] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  
  const isIOS = isIOSPlatform();
  const fullscreenSupported = hasFullscreenSupport();
  const strictProctoringEnabled = !isIOS && fullscreenSupported;
  const questionsLoadedRef = useRef(false);
  const instructionList = useMemo(
    () => [
      ...INSTRUCTIONS,
      strictProctoringEnabled
        ? "Fullscreen is mandatory. If fullscreen is disabled 3 times, your exam will be auto-submitted."
        : "Mobile-safe mode: fullscreen enforcement is disabled on this device."
    ],
    [strictProctoringEnabled]
  );
  const violationCooldownRef = useRef(0);
  const lastAutosavePayloadRef = useRef("");
  const autosaveInFlightRef = useRef(false);
  const autosaveQueuedRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  const autosavePayloadRef = useRef(null);
  const draftRecoveryAttemptedRef = useRef(false);
  const autoSubmitTriggeredRef = useRef(false);
  const timeAutoSubmitTriggeredRef = useRef(false);
  const focusLossActiveRef = useRef(false);
  const fullscreenViolationActiveRef = useRef(false);
  const securityNoticeTimeoutRef = useRef(null);
  const isRegularInstructionPhase = false;
  const headerTimerLabel = isRegularInstructionPhase ? "Questions unlock in" : "Time left";
  const headerTimerSeconds = isRegularInstructionPhase
    ? Number(regularTiming?.unlockInSeconds || 0)
    : remainingSeconds;

  useEffect(() => {
    return () => {
      if (securityNoticeTimeoutRef.current) {
        clearTimeout(securityNoticeTimeoutRef.current);
      }
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const shouldLockScroll =
      preExamOpen ||
      sectionOverlayOpen ||
      submitConfirmOpen ||
      feedbackOpen ||
      Boolean(submitMessage) ||
      violationWarning.open;
    if (!shouldLockScroll) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [feedbackOpen, preExamOpen, sectionOverlayOpen, submitConfirmOpen, submitMessage, violationWarning.open]);

  const getAnswerKey = useCallback((question, languageOverride = null) => {
    if (!question) return "";
    const basis = (question.section_name || question.question_type || "general").replace(/\s+/g, "").toLowerCase();
    const qType = String(question.question_type || "MCQ").toLowerCase();
    if (qType === "coding") {
      const lang = String(languageOverride || codingLanguage || DEFAULT_LANGUAGE).toLowerCase();
      return `${basis}-${question.question_id}-${lang}`;
    }
    return `${basis}-${question.question_id}`;
  }, [codingLanguage]);
  const readAnswer = useCallback(
    (question, languageOverride = null) =>
      (question ? answers[getAnswerKey(question, languageOverride)] || "" : ""),
    [answers, getAnswerKey]
  );

  const currentQuestion = questionBank[currentIndex];
  const questionType = (currentQuestion?.question_type || "MCQ").toLowerCase();
  const currentAnswer = readAnswer(currentQuestion, codingLanguage);
  const currentDescriptiveWordLimit =
    questionType === "descriptive" ? getDescriptiveWordLimit(currentQuestion?.question_id) : null;
  const currentDescriptiveWordCount =
    questionType === "descriptive" ? countWords(currentAnswer) : 0;
  const isCurrentDescriptiveOverLimit =
    Boolean(currentDescriptiveWordLimit) && currentDescriptiveWordCount > currentDescriptiveWordLimit;
  const isCurrentSaved = currentQuestion ? Boolean(savedQuestions[currentQuestion.question_id]) : false;
  const feedbackWordCount = useMemo(() => countWords(feedbackText), [feedbackText]);
  const isFeedbackTooLong = feedbackWordCount > 100;
  const parseTestcases = useCallback((payload) => {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    if (typeof payload === "string") {
      try {
        const parsed = JSON.parse(payload);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn("Invalid testcase payload:", err);
        return [];
      }
    }
    return [];
  }, []);

  const codingTestcases = useMemo(() => {
    const direct = parseTestcases(currentQuestion?.testcases);
    if (direct.length) {
      return direct;
    }
    if (!currentQuestion?.question_text) {
      return [];
    }
    const match = walkinCodingEntries.find(
      (item) => item.question_text?.trim() === currentQuestion.question_text?.trim()
    );
    return parseTestcases(match?.testcases);
  }, [currentQuestion?.testcases, currentQuestion?.question_text, walkinCodingEntries, parseTestcases]);

  const codingExamples = useMemo(() => {
    const direct = parseTestcases(currentQuestion?.examples);
    if (direct.length) {
      return direct;
    }
    if (!currentQuestion?.question_text) {
      return [];
    }
    const match = walkinCodingEntries.find(
      (item) => item.question_text?.trim() === currentQuestion.question_text?.trim()
    );
    return parseTestcases(match?.examples);
  }, [currentQuestion?.examples, currentQuestion?.question_text, walkinCodingEntries, parseTestcases]);

  const sectionQuestionMap = useMemo(() => {
    const map = {};
    questionBank.forEach((question) => {
      const section = (question.section_name || "Aptitude").trim();
      if (!map[section]) {
        map[section] = [];
      }
      map[section].push(question.question_id);
    });
    return map;
  }, [questionBank]);
  const sectionNavigator = useMemo(() => {
    const order = [];
    const firstIndexBySection = {};
    questionBank.forEach((question, index) => {
      const section = (question.section_name || "Aptitude").trim();
      if (!(section in firstIndexBySection)) {
        firstIndexBySection[section] = index;
        order.push(section);
      }
    });
    return {
      sections: order,
      firstIndexBySection
    };
  }, [questionBank]);
  const examOverview = useMemo(() => {
    const sectionTemplates = isWalkinExamSession
      ? [
          {
            key: "aptitude",
            label: "Aptitude",
            description: "Logical reasoning, verbal ability, and numerical problem solving."
          },
          {
            key: "technical",
            label: "Technical Section",
            description: "Core technical MCQ and descriptive questions."
          },
          {
            key: "coding",
            label: "Coding",
            description: "Programming questions with test-case based evaluation."
          }
        ]
      : [
          {
            key: "aptitude",
            label: "Aptitude",
            description: "Logical reasoning, verbal ability, and numerical problem solving."
          },
          {
            key: "technical",
            label: "Technical Section",
            description: "Core technical questions."
          }
        ];

    const breakdown = sectionTemplates.map((item) => {
      const count = (questionBank || []).filter((question) => {
        const section = String(question?.section_name || "").toLowerCase();
        if (item.key === "aptitude") return section.includes("aptitude");
        if (item.key === "technical") return section.includes("technical");
        if (item.key === "coding") return section.includes("coding");
        return false;
      }).length;
      return { ...item, count };
    });
    const sectionNames = breakdown.map((item) => item.label);

    return {
      totalQuestions: questionBank.length || 0,
      sectionCount: sectionNames.length || 0,
      sectionNames,
      breakdown,
      optionCount: 4,
      durationLabel:
        !isWalkinExamSession && regularTiming
          ? `${regularTiming.startGraceMinutes || 10} minutes instructions + ${durationMinutes || regularTiming.questionDurationMinutes || 60} minutes questions`
          : durationMinutes
            ? `${durationMinutes} minutes`
            : "As configured by admin"
    };
  }, [durationMinutes, isWalkinExamSession, questionBank, regularTiming]);

  const currentSectionProgress = useMemo(() => {
    if (!currentSection || !currentQuestion) {
      return null;
    }
    const section = (currentSection || "Aptitude").trim();
    const list = sectionQuestionMap[section] || [];
    const index = list.findIndex((qid) => qid === currentQuestion.question_id);
    if (index === -1) return null;
    return {
      section,
      number: index + 1,
      total: list.length
    };
  }, [currentSection, currentQuestion, sectionQuestionMap]);

  const currentCodingRun = useMemo(() => {
    if (!currentQuestion || questionType !== "coding") {
      return { passed: 0, total: 0 };
    }
    const summary = codingRunSummary[currentQuestion.question_id] || {};
    const totalFromSummary = Number(summary.total || 0);
    const fallbackTotal = codingTestcases.length;
    const total = totalFromSummary > 0 ? totalFromSummary : fallbackTotal;
    const passed = Math.max(0, Math.min(Number(summary.passed || 0), total));
    return { passed, total };
  }, [currentQuestion, questionType, codingRunSummary, codingTestcases.length]);

  const formatTestValue = useCallback((value) => {
    if (value === null || value === undefined) {
      return "<empty>";
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }, []);

  useEffect(() => {
    if (!examId) {
      setError("Invalid exam");
      setLoading(false);
      return;
    }

    if (questionsLoadedRef.current && questionBank.length) {
      setLoading(false);
      return;
    }

    if (!isWalkinExamSession && (!regularTiming || !regularTiming.questionsVisible)) {
      setLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const questionsEndpoint = isWalkinExamSession
      ? `/exam/regular_exam_questions/${examId}`
      : `${examApiBase}/questions/${examId}`;

    fetch(questionsEndpoint, { credentials: "include", signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (!isWalkinExamSession && String(data?.code || "") === "instruction_window_active") {
            setRegularTiming((prev) =>
              normalizeRegularTiming({
                ...(prev || {}),
                questionUnlockAt: data?.questionUnlockAt || prev?.questionUnlockAt
              })
            );
            return null;
          }
          throw new Error(data?.message || `Unable to load questions (${res.status})`);
        }
        return data;
      })
      .then((data) => {
        if (data === null) {
          return;
        }
        if (!Array.isArray(data)) {
          setError(String(data?.message || "Invalid questions payload."));
          return;
        }
        if (data.length === 0) {
          setError("No questions found for your assigned exam stream.");
          return;
        }
        questionsLoadedRef.current = true;
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
  }, [examApiBase, examId, isWalkinExamSession, questionBank.length, regularTiming]);

  useEffect(() => {
    if (!examId || !questionBank.length) return;
    if (draftRecoveryAttemptedRef.current) return;
    draftRecoveryAttemptedRef.current = true;

    const byQuestionId = new Map(
      questionBank.map((question) => [Number(question?.question_id || 0), question])
    );

    fetch(`${examApiBase}/draft/${examId}`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) return null;
        return data;
      })
      .then((data) => {
        const drafts = Array.isArray(data?.drafts) ? data.drafts : [];
        if (!drafts.length) return;

        const nextAnswers = {};
        const nextSavedQuestions = {};
        const nextCodingLanguageByQuestion = {};
        const nextCodingSummary = {};

        drafts.forEach((draft) => {
          const questionId = Number(draft?.question_id || 0);
          if (!questionId) return;
          const question = byQuestionId.get(questionId);
          if (!question) return;

          const qType = String(draft?.question_type || "").trim().toLowerCase();
          const base = (question.section_name || question.question_type || "general")
            .replace(/\s+/g, "")
            .toLowerCase();

          if (qType === "coding") {
            const lang = String(draft?.coding_language || DEFAULT_LANGUAGE).trim().toLowerCase() || DEFAULT_LANGUAGE;
            const key = `${base}-${questionId}-${lang}`;
            const code = String(draft?.code || "");
            nextAnswers[key] = code;
            nextCodingLanguageByQuestion[questionId] = lang;
            nextCodingSummary[questionId] = {
              passed: Number(draft?.testcases_passed || 0),
              total: Number(draft?.testcases_total || 0)
            };
            if (code.trim()) nextSavedQuestions[questionId] = true;
            return;
          }

          const key = `${base}-${questionId}`;
          if (qType === "descriptive") {
            const descriptive = String(draft?.descriptive_answer || "");
            nextAnswers[key] = descriptive;
            if (descriptive.trim()) nextSavedQuestions[questionId] = true;
            return;
          }

          const selected = String(draft?.selected_option || "").trim().toUpperCase();
          nextAnswers[key] = selected;
          if (selected) nextSavedQuestions[questionId] = true;
        });

        setAnswers((prev) => ({ ...prev, ...nextAnswers }));
        setSavedQuestions((prev) => ({ ...prev, ...nextSavedQuestions }));
        setCodingLanguageByQuestion((prev) => ({ ...prev, ...nextCodingLanguageByQuestion }));
        setCodingRunSummary((prev) => ({ ...prev, ...nextCodingSummary }));
        setAutosaveStatus("Recovered your saved answers.");
      })
      .catch((err) => {
        console.error("Draft recovery error:", err);
      });
  }, [examApiBase, examId, questionBank]);

  const buildAnswersPayload = useCallback(() => {
    return questionBank.map((question) => {
      const qId = question.question_id;
      const type = (question.question_type || "MCQ").toLowerCase();
      const codingSummary = codingRunSummary[qId] || {};
      const base = {
        question_id: qId,
        question_type: type,
        section_name: question.section_name || ""
      };
      const qIdNum = Number(qId || 0);
      if (type === "coding") {
        const selectedLanguage = codingLanguageByQuestion[qIdNum] || DEFAULT_LANGUAGE;
        const storedAnswer = readAnswer(question, selectedLanguage);
        const fallbackTotal = parseTestcases(question.testcases).length;
        return {
          ...base,
          code: storedAnswer || "",
          coding_language: selectedLanguage,
          testcases_passed: Number(codingSummary.passed || 0),
          testcases_total: Number(codingSummary.total || fallbackTotal || 0),
          status: savedQuestions[qId] ? "PASSED" : "RUNNING"
        };
      }
      const storedAnswer = readAnswer(question);
      if (type === "descriptive") {
        return {
          ...base,
          descriptive_answer: storedAnswer || "",
          selected_option: ""
        };
      }
      return {
        ...base,
        selected_option: storedAnswer || ""
      };
    });
  }, [
    codingLanguageByQuestion,
    codingRunSummary,
    parseTestcases,
    questionBank,
    readAnswer,
    savedQuestions
  ]);

  useEffect(() => {
    if (!examId) return;
    fetch(`${examApiBase}/duration/${examId}`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || `Unable to load exam duration (${res.status})`);
        }
        return data;
      })
      .then((data) => {
        const duration = Number(data?.durationMinutes || 0);
        if (duration > 0) {
          setDurationMinutes(duration);
          if (isWalkinExamSession) {
            setRemainingSeconds(duration * 60);
            setRegularTiming(null);
          } else {
            const timing = normalizeRegularTiming(data?.timing);
            setRegularTiming(timing);
            setRemainingSeconds(timing?.questionsVisible ? Number(timing?.remainingQuestionSeconds || 0) : null);
          }
        } else {
          setDurationMinutes(null);
          setRemainingSeconds(null);
          if (!isWalkinExamSession) {
            setRegularTiming(normalizeRegularTiming(data?.timing));
          }
        }
      })
      .catch(() => {
        setDurationMinutes(null);
        setRemainingSeconds(null);
        if (!isWalkinExamSession) {
          setRegularTiming(null);
        }
      });
  }, [examApiBase, examId, isWalkinExamSession]);

  useEffect(() => {
    questionsLoadedRef.current = false;
    setQuestionBank([]);
    setCurrentIndex(0);
  }, [examId]);

  const flushAutosave = useCallback(async () => {
    if (!examId || !questionBank.length) return;
    if (preExamOpen || submitSuccess || isSubmitting) return;

    const studentId = String(localStorage.getItem("studentId") || "").trim();
    if (!studentId) return;

    const payloadAnswers = autosavePayloadRef.current || buildAnswersPayload();
    if (!payloadAnswers.length) return;

    const serializedPayload = JSON.stringify(payloadAnswers);
    if (serializedPayload === lastAutosavePayloadRef.current) return;

    if (autosaveInFlightRef.current) {
      autosaveQueuedRef.current = true;
      return;
    }

    try {
      autosaveInFlightRef.current = true;
      autosaveQueuedRef.current = false;
      setAutosaveStatus("Saving...");
      const response = await fetch(`${examApiBase}/draft/autosave`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          examId,
          answers: payloadAnswers
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success) {
        lastAutosavePayloadRef.current = serializedPayload;
        setAutosaveStatus("Auto-saved");
        setTimeout(() => setAutosaveStatus(""), 3000);
        return;
      }
      if (data?.submitted) {
        setAutosaveStatus("Exam already submitted. Autosave stopped.");
        return;
      }
      setAutosaveStatus("Autosave retrying...");
      autosaveQueuedRef.current = true;
    } catch (error) {
      console.error("Exam autosave error:", error);
      setAutosaveStatus("Autosave retrying...");
      autosaveQueuedRef.current = true;
    } finally {
      autosaveInFlightRef.current = false;
      const latestPayload = autosavePayloadRef.current || buildAnswersPayload();
      const latestSerialized = JSON.stringify(latestPayload);
      if (autosaveQueuedRef.current || latestSerialized !== lastAutosavePayloadRef.current) {
        autosaveQueuedRef.current = false;
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
        }
        autosaveTimerRef.current = setTimeout(() => {
          flushAutosave();
        }, 250);
      }
    }
  }, [buildAnswersPayload, examApiBase, examId, isSubmitting, preExamOpen, questionBank.length, submitSuccess]);

  useEffect(() => {
    if (!examId || !questionBank.length) return;
    if (preExamOpen || submitSuccess || isSubmitting) return;

    const payloadAnswers = buildAnswersPayload();
    if (!payloadAnswers.length) return;
    autosavePayloadRef.current = payloadAnswers;

    const serializedPayload = JSON.stringify(payloadAnswers);
    if (serializedPayload === lastAutosavePayloadRef.current) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      flushAutosave();
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    answers,
    buildAnswersPayload,
    codingLanguageByQuestion,
    codingRunSummary,
    examId,
    flushAutosave,
    isSubmitting,
    preExamOpen,
    questionBank.length,
    submitSuccess
  ]);

  useEffect(() => {
    if (isWalkinExamSession) {
      if (preExamOpen) return;
      if (remainingSeconds === null) return;
      if (remainingSeconds <= 0) return;
      const timer = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev === null) return prev;
          return prev > 0 ? prev - 1 : 0;
        });
      }, 1000);
      return () => clearInterval(timer);
    }

    if (!regularTiming) return;
    const tick = () => {
      const next = normalizeRegularTiming(regularTiming);
      setRegularTiming(next);
      setRemainingSeconds(next?.questionsVisible ? Number(next?.remainingQuestionSeconds || 0) : null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isWalkinExamSession, preExamOpen, regularTiming, remainingSeconds]);

  useEffect(() => {
    if (preExamOpen) return;

    const toElement = (target) => {
      if (target instanceof Element) return target;
      if (target && target.parentElement instanceof Element) return target.parentElement;
      return null;
    };
    const isInsideMonaco = (target) =>
      Boolean(toElement(target)?.closest(".monaco-editor"));
    const isEditableTarget = (target) =>
      Boolean(toElement(target)?.closest("textarea, input, select, [contenteditable='true']"));
    const isAllowedCopyArea = (target) =>
      Boolean(toElement(target)?.closest(".console-body, .output-display"));

    const handleContextMenu = (event) => {
      if (
        isInsideMonaco(event.target) ||
        isEditableTarget(event.target) ||
        isAllowedCopyArea(event.target)
      ) return;
      // Block browser/OS mini menu that can open search/copy side actions during exam.
      event.preventDefault();
    };

    const handleSelectStart = (event) => {
      if (
        isInsideMonaco(event.target) ||
        isEditableTarget(event.target) ||
        isAllowedCopyArea(event.target)
      ) return;
      event.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("selectstart", handleSelectStart);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("selectstart", handleSelectStart);
    };
  }, [preExamOpen]);

  const formatTimer = (seconds) => {
    if (seconds === null || seconds === undefined) return "--:--";
    const safe = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  useEffect(() => {
    const updateFullscreen = () => {
      const fullscreenActive =
        Boolean(document.fullscreenElement) ||
        Boolean(document.webkitFullscreenElement) ||
        Boolean(document.mozFullScreenElement) ||
        Boolean(document.msFullscreenElement);
      setIsFullscreen(fullscreenActive);
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    document.addEventListener("webkitfullscreenchange", updateFullscreen);
    document.addEventListener("mozfullscreenchange", updateFullscreen);
    document.addEventListener("MSFullscreenChange", updateFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen);
      document.removeEventListener("webkitfullscreenchange", updateFullscreen);
      document.removeEventListener("mozfullscreenchange", updateFullscreen);
      document.removeEventListener("MSFullscreenChange", updateFullscreen);
    };
  }, []);

  useEffect(() => {
    if (preExamOpen || submitSuccess || isSubmitting) return;
    return undefined;
  }, [isFullscreen, preExamOpen, submitSuccess, isSubmitting]);

  useEffect(() => {
    if (!isWalkinExamSession) {
      setWalkinCodingEntries([]);
      return undefined;
    }
    fetch("/exam/walkin-coding-testcases", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setWalkinCodingEntries(data);
        }
      })
      .catch((err) => {
        console.error("Walkin testcases load error:", err);
      });
  }, [isWalkinExamSession]);

  useEffect(() => {
    if (!isWalkinExamSession) {
      setTechnicalStreams([]);
      return undefined;
    }
    fetch("/exam/walkin-streams", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        const cleaned = data
          .map((item) =>
            typeof item === "string" ? item : (item?.stream || "")
          )
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value);
        setTechnicalStreams(Array.from(new Set(cleaned)));
      })
      .catch((err) => {
        console.error("Walkin streams load error:", err);
      });
  }, [isWalkinExamSession]);

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
    if (!isTechnicalSection(currentSection) || !currentQuestion) {
      setCurrentTechnicalStream("");
      return;
    }
    const baseLabel = (currentQuestion.section_name || "").trim();
    const match =
      technicalStreams.find((stream) =>
        stream && baseLabel.toLowerCase().includes(stream.toLowerCase())
      ) || "";
    const resolved = match || baseLabel;
    setCurrentTechnicalStream(resolved || "");
    }, [currentSection, currentQuestion, technicalStreams]);

  useEffect(() => {
    setConsoleLines([]);
    setTestOutcomes([]);
    setCodingOutput("");
    setDescriptiveLimitMessage("");
  }, [currentQuestion?.question_id]);

  const updateAnswer = (question, value, languageOverride = null) => {
    const key = getAnswerKey(question, languageOverride);
    setAnswers((prev) => ({ ...prev, [key]: value }));
    if (question?.question_id) clearSaved(question.question_id);
  };

  useEffect(() => {
    if (!currentQuestion) return;
    if (questionType !== "coding") return;
    const qId = Number(currentQuestion.question_id || 0);
    const preferred = codingLanguageByQuestion[qId] || DEFAULT_LANGUAGE;
    if (preferred !== codingLanguage) {
      setCodingLanguage(preferred);
    }
  }, [currentQuestion, questionType, codingLanguageByQuestion, codingLanguage]);

  useEffect(() => {
    if (!currentQuestion || questionType !== "coding") return;
    const starter = getCodingStarterTemplate(currentQuestion.question_id, codingLanguage);
    if (!starter) return;
    if (currentAnswer) return;
    updateAnswer(currentQuestion, starter, codingLanguage);
  }, [codingLanguage, currentAnswer, currentQuestion, questionType]);

  const logConsole = useCallback((message) => {
    setConsoleLines((prev) => [...prev, message]);
  }, []);

  const handleRunCode = useCallback(async () => {
    if (!currentQuestion || isRunningCode) return;
    setIsRunningCode(true);
    setConsoleLines([]);
    setTestOutcomes([]);
    logConsole("> Code run invoked");

    try {
    const response = await fetch("/exam/run-code", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: codingLanguage,
        code: currentAnswer,
        questionId: currentQuestion?.question_id
      })
    });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Execution failed");
      }

      if (data.testResults && Array.isArray(data.testResults)) {
        const limitedResults = data.testResults.slice(0, 5);
        setTestOutcomes(limitedResults);
        setCodingRunSummary((prev) => ({
          ...prev,
          [currentQuestion.question_id]: {
            passed: Number(data.passed || 0),
            total: Number(data.total || 0)
          }
        }));
        limitedResults.forEach((result, index) => {
          const status = result.passed ? "PASS" : "FAIL";
          logConsole(`> Test ${index + 1}: ${status}`);
          if (result.stdout) {
            logConsole(`  > STDOUT: ${result.stdout.trim()}`);
          }
          if (result.stderr) {
            logConsole(`  > STDERR: ${result.stderr.trim()}`);
          }
          if (result.timedOut) {
            logConsole(`  > Execution timed out`);
          }
        });
        const hiddenCount = data.total - limitedResults.length;
        if (hiddenCount > 0) {
          logConsole(`> ${hiddenCount} hidden test(s) ran`);
        }
        logConsole(`> Summary: ${data.passed}/${data.total} tests passed`);
        setCodingOutput(`${data.passed}/${data.total} tests passed`);
      } else {
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
      }
    } catch (err) {
      logConsole(`> Error: ${err.message}`);
      setCodingOutput(err.message);
      console.error("Run code error:", err);
    } finally {
      setIsRunningCode(false);
    }
  }, [codingLanguage, codingTestcases, currentAnswer, currentQuestion, isRunningCode, logConsole]);

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
    if (questionType === "descriptive" && currentQuestion?.question_id) {
      markSaved(currentQuestion.question_id);
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
    if (questionType === "descriptive" && currentQuestion?.question_id) {
      markSaved(currentQuestion.question_id);
    }
    const targetIndex = Math.max(currentIndex - 1, 0);
    if (targetIndex === currentIndex) return;
    setCurrentIndex(targetIndex);
    const previousSection = (questionBank[targetIndex]?.section_name || "Aptitude").trim();
    if (previousSection !== currentSection) {
      setCurrentSection(previousSection);
      setVisitedSections((prev) =>
        prev.includes(previousSection) ? prev : [...prev, previousSection]
      );
    }
  };

  const handleSkip = () => {
    if (!currentQuestion) return;
    updateAnswer(currentQuestion, "");
    handleNext();
  };

  const handleOptionToggle = (value) => {
    if (!currentQuestion) return;
    const nextValue = currentAnswer === value ? "" : value;
    updateAnswer(currentQuestion, nextValue);
  };

  const handleJumpToSection = (sectionName) => {
    const targetSection = String(sectionName || "").trim();
    if (!targetSection) return;
    const targetIndex = sectionNavigator.firstIndexBySection[targetSection];
    if (targetIndex === undefined || targetIndex === null) return;
    setSectionOverlayOpen(false);
    setPendingSection("");
    setPendingSectionIndex(null);
    setCurrentIndex(targetIndex);
    setCurrentSection(targetSection);
    setVisitedSections((prev) =>
      prev.includes(targetSection) ? prev : [...prev, targetSection]
    );
  };

  const handleDescriptiveChange = (event) => {
    if (!currentQuestion) return;
    const nextValue = event.target.value || "";
    const wordLimit = getDescriptiveWordLimit(currentQuestion.question_id);
    const nextWordCount = countWords(nextValue);
    if (wordLimit && nextWordCount > wordLimit) {
      setDescriptiveLimitMessage(`Answer size exceeded. Max ${wordLimit} words allowed.`);
      return;
    }
    if (descriptiveLimitMessage) {
      setDescriptiveLimitMessage("");
    }
    updateAnswer(currentQuestion, nextValue);
  };

  const finalizeSubmissionFlow = useCallback(
    async (messageText) => {
      await exitFullscreenSafe();
      setSubmitMessage(messageText || "Exam submitted successfully. Thank you.");
      setTimeout(() => {
        navigate("/student/dashboard");
      }, 1800);
    },
    [navigate]
  );

  const handleSkipFeedback = useCallback(async () => {
    if (isSavingFeedback) return;
    const isAuto = Boolean(submittedContext?.autoSubmitted);
    const autoReason = String(submittedContext?.reason || "").toLowerCase();
    setFeedbackOpen(false);
    await finalizeSubmissionFlow(
      isAuto
        ? (autoReason === "time_over"
          ? "Exam auto-submitted because time is over."
          : strictProctoringEnabled
            ? "Exam auto-submitted after 3 fullscreen/focus violations."
            : "Exam auto-submitted due to security violations.")
        : "Exam submitted successfully. Thank you."
    );
  }, [finalizeSubmissionFlow, isSavingFeedback, strictProctoringEnabled, submittedContext]);

  const handleSubmitFeedback = useCallback(async () => {
    if (isSavingFeedback) return;
    const content = String(feedbackText || "").trim();
    if (!content) {
      setFeedbackError("Please share your feedback before submitting.");
      return;
    }
    if (isFeedbackTooLong) {
      setFeedbackError("Feedback cannot exceed 100 words.");
      return;
    }

    const studentId = Number(submittedContext?.studentId || localStorage.getItem("studentId") || 0);
    const finalExamId = Number(submittedContext?.examId || 0);
    if (!studentId || !finalExamId) {
      setFeedbackError("Missing feedback context. Please try again.");
      return;
    }

    setIsSavingFeedback(true);
    setFeedbackError("");
    try {
      const response = await fetch(`${examApiBase}/feedback`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          examId: finalExamId,
          questionText: FEEDBACK_QUESTION,
          feedbackText: content,
          submissionMode: submittedContext?.autoSubmitted ? "AUTO_SUBMIT" : "MANUAL"
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setFeedbackError(data?.message || "Could not save feedback. You can Skip and continue.");
        return;
      }
      setFeedbackOpen(false);
      const isAuto = Boolean(submittedContext?.autoSubmitted);
      const autoReason = String(submittedContext?.reason || "").toLowerCase();
      await finalizeSubmissionFlow(
        isAuto
          ? (autoReason === "time_over"
            ? "Exam auto-submitted because time is over."
            : strictProctoringEnabled
              ? "Exam auto-submitted after 3 fullscreen/focus violations."
              : "Exam auto-submitted due to security violations.")
          : "Exam submitted successfully. Thank you."
      );
    } catch (err) {
      console.error("Save feedback error:", err);
      setFeedbackError("Could not save feedback. You can Skip and continue.");
    } finally {
      setIsSavingFeedback(false);
    }
  }, [examApiBase, feedbackText, finalizeSubmissionFlow, isFeedbackTooLong, isSavingFeedback, strictProctoringEnabled, submittedContext]);

  const handleConfirmSubmit = useCallback(
    async (options = {}) => {
      const forceSubmit = Boolean(options.force);
      const forceReason = String(options.forceReason || "").trim().toLowerCase();
      if (isSubmitting) return;

      setIsSubmitting(true);
      setSubmitSuccess(false);
      let submitCompleted = false;
      const studentId = localStorage.getItem("studentId");
      if (!studentId) {
        setSubmitMessage("Unable to submit: student context missing. Please log in again.");
        setIsSubmitting(false);
        return;
      }
      if (!forceSubmit) {
        const exceededEntry = questionBank
          .filter((question) => (question.question_type || "").toLowerCase() === "descriptive")
          .map((question) => {
            const answerText = readAnswer(question);
            const limit = getDescriptiveWordLimit(question.question_id);
            const words = countWords(answerText);
            return { questionId: question.question_id, limit, words };
          })
          .find((entry) => entry.limit && entry.words > entry.limit);
        if (exceededEntry) {
          setSubmitSuccess(false);
          setSubmitMessage(
            `Question ${exceededEntry.questionId} exceeds word limit (${exceededEntry.words}/${exceededEntry.limit}).`
          );
          setIsSubmitting(false);
          return;
        }
      }
      try {
        const payload = {
          studentId,
          examId,
          studentExamId: studentExamIdParam > 0 ? studentExamIdParam : null,
          answers: buildAnswersPayload(),
          forceSubmit,
          forceReason: forceReason || null
        };
        const response = await fetch(`${examApiBase}/submit`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
          submitCompleted = true;
          setSubmitSuccess(true);
          setSubmitMessage("");
          setFeedbackText("");
          setFeedbackError("");
          setSubmittedContext({
            studentId: Number(studentId),
            examId: Number(data.examId || examId),
            autoSubmitted: Boolean(data.autoSubmitted || forceSubmit),
            reason: String(data.reason || forceReason || "")
          });
          setFeedbackOpen(true);
        } else {
          setSubmitSuccess(false);
          setSubmitMessage(data.message || "Submission failed. Please try again.");
        }
      } catch (err) {
        console.error("Submit exam error:", err);
        setSubmitSuccess(false);
        setSubmitMessage(err.message || "Submission failed. Please try again.");
      } finally {
        if (forceSubmit && !submitCompleted && forceReason === "violation") {
          autoSubmitTriggeredRef.current = false;
        }
        if (forceSubmit && !submitCompleted && forceReason === "time_over") {
          timeAutoSubmitTriggeredRef.current = false;
        }
        setIsSubmitting(false);
        setSubmitConfirmOpen(false);
      }
    },
    [buildAnswersPayload, examApiBase, examId, isSubmitting, questionBank, readAnswer, studentExamIdParam]
  );

  const registerViolation = useCallback(
    (reason) => {
      if (!strictProctoringEnabled) return;
      if (preExamOpen || isSubmitting || submitSuccess) return;
      const now = Date.now();
      if (now - violationCooldownRef.current < 700) return;
      violationCooldownRef.current = now;

      setViolations((prev) => {
        const next = Math.min(prev + 1, VIOLATION_LIMIT);
        const reasonText = String(reason || "Focus violation detected").trim();
        setViolationWarning({
          open: true,
          count: next,
          reason: reasonText
        });
        setSecurityNotice(
          `${reasonText}. Violation ${next}/${VIOLATION_LIMIT}.`
        );
        setSecurityNoticeKey((prevKey) => prevKey + 1);
        if (securityNoticeTimeoutRef.current) {
          clearTimeout(securityNoticeTimeoutRef.current);
        }
        securityNoticeTimeoutRef.current = setTimeout(() => {
          setSecurityNotice("");
        }, 4400);
        return next;
      });
      if (typeof window.focus === "function") {
        try {
          window.focus();
        } catch {
          /* ignore focus errors */
        }
      }
    },
    [isSubmitting, preExamOpen, strictProctoringEnabled, submitSuccess]
  );

  useEffect(() => {
    if (!strictProctoringEnabled) return;
    if (preExamOpen || submitSuccess || isSubmitting) return;
    if (violations < VIOLATION_LIMIT) return;
    if (autoSubmitTriggeredRef.current) return;

    autoSubmitTriggeredRef.current = true;
    setViolationWarning((prev) => ({ ...prev, open: false }));
    setSubmitConfirmOpen(false);
    setSecurityNotice("");

    const submitNow = async () => {
      try {
        await handleConfirmSubmit({ force: true, forceReason: "violation" });
      } catch {
        autoSubmitTriggeredRef.current = false;
      }
    };

    submitNow();
  }, [handleConfirmSubmit, isSubmitting, preExamOpen, strictProctoringEnabled, submitSuccess, violations]);

  useEffect(() => {
    if ((preExamOpen && isWalkinExamSession) || submitSuccess || isSubmitting) return;
    if (remainingSeconds === null) return;
    if (remainingSeconds > 0) return;
    if (timeAutoSubmitTriggeredRef.current) return;

    timeAutoSubmitTriggeredRef.current = true;
    setSubmitConfirmOpen(false);

    const submitOnTimeOver = async () => {
      try {
        await handleConfirmSubmit({ force: true, forceReason: "time_over" });
      } catch {
        timeAutoSubmitTriggeredRef.current = false;
      }
    };

    submitOnTimeOver();
  }, [handleConfirmSubmit, isSubmitting, isWalkinExamSession, preExamOpen, remainingSeconds, submitSuccess]);

  const handleViolationGoFullscreen = useCallback(() => {
    if (strictProctoringEnabled) {
      enterFullscreen();
    }
    setViolationWarning((prev) => ({ ...prev, open: false }));
    if (typeof window.focus === "function") {
      try {
        window.focus();
      } catch {
        /* ignore focus errors */
      }
    }
  }, [strictProctoringEnabled]);

  useEffect(() => {
    if (!strictProctoringEnabled) return;
    if (preExamOpen || submitSuccess || isSubmitting) return;
    const onFullscreenChange = () => {
      const fullscreenActive =
        Boolean(document.fullscreenElement) ||
        Boolean(document.webkitFullscreenElement) ||
        Boolean(document.mozFullScreenElement) ||
        Boolean(document.msFullscreenElement);
      if (!fullscreenActive) {
        registerViolation("Fullscreen disabled");
        fullscreenViolationActiveRef.current = true;
      } else {
        fullscreenViolationActiveRef.current = false;
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("mozfullscreenchange", onFullscreenChange);
    document.addEventListener("MSFullscreenChange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      document.removeEventListener("mozfullscreenchange", onFullscreenChange);
      document.removeEventListener("MSFullscreenChange", onFullscreenChange);
    };
  }, [isSubmitting, preExamOpen, registerViolation, strictProctoringEnabled, submitSuccess]);

  useEffect(() => {
    if (!strictProctoringEnabled) return;
    if (preExamOpen) return;
    if (submitSuccess) return;

    const markFocusLoss = (reason) => {
      if (focusLossActiveRef.current) return;
      focusLossActiveRef.current = true;
      registerViolation(reason);
    };

    const clearFocusLoss = () => {
      focusLossActiveRef.current = false;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markFocusLoss("Tab switch detected");
      } else {
        clearFocusLoss();
      }
    };

    const handleWindowBlur = () => {
      if (document.visibilityState === "visible") {
        markFocusLoss("Window focus lost");
      }
    };

    const handleWindowFocus = () => {
      clearFocusLoss();
    };

    const handlePageHide = () => {
      markFocusLoss("Window hidden");
    };

    const handleKeyDown = (event) => {
      const key = String(event.key || "").toLowerCase();
      const ctrlOrMeta = Boolean(event.ctrlKey || event.metaKey);
      const altTab = Boolean(event.altKey && key === "tab");
      const escPressed = key === "escape";
      const blocked =
        escPressed ||
        key === "f5" ||
        altTab ||
        (ctrlOrMeta && (key === "tab" || key === "w" || key === "r" || key === "l")) ||
        (ctrlOrMeta && event.shiftKey && key === "tab");
      if (blocked) {
        event.preventDefault();
        // For Esc, count a violation only when fullscreen actually exits
        // (handled in fullscreenchange listener) to avoid double-counting.
        if (altTab) {
          markFocusLoss("Alt+Tab attempt detected");
        }
      }
    };

    const focusGuard = setInterval(() => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        markFocusLoss("Window focus lost");
      } else {
        clearFocusLoss();
      }
    }, 1000);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(focusGuard);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [preExamOpen, registerViolation, strictProctoringEnabled, submitSuccess]);

  const markSaved = (questionId) => {
    if (!questionId) return;
    setSavedQuestions((prev) => ({ ...prev, [questionId]: true }));
  };

  const clearSaved = (questionId) => {
    setSavedQuestions((prev) => {
      if (!prev[questionId]) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  const handleSaveCurrent = () => {
    if (!currentQuestion) return;
    markSaved(currentQuestion.question_id);
  };

  const renderQuestionPrompt = () => {
    return (
      <div className="question-prompt">
        <div className="question-prompt-header">
          <span className="question-label">Q{currentIndex + 1}</span>
        </div>
        <p className="question-text">{currentQuestion.question_text}</p>
        {questionType === "descriptive" && currentDescriptiveWordLimit && (
          <p className="question-word-limit-note">
            Write your answer under ({currentDescriptiveWordLimit}) words.
          </p>
        )}
      </div>
    );
  };

  const renderExamples = () => {
    if (!codingExamples.length) {
      return null;
    }
    return (
      <div className="examples-panel">
        <div className="testcases-heading">Examples</div>
        <div className="testcases-grid">
          {codingExamples.map((testcase, idx) => (
            <div className="testcase-row" key={`example-${idx}`}>
              <div className="testcase-value">
                <label>Input</label>
                <p>{formatTestValue(testcase.input)}</p>
              </div>
              <div className="testcase-value">
                <label>Expected output</label>
                <p>{formatTestValue(testcase.output ?? testcase.expected_output)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCodingInstructions = () => (
    <div className="coding-instructions">
      <h4>Instructions</h4>
      <ul>
        {getLeetCodeConfig(currentQuestion?.question_id) ? (
          <>
            <li>
              Use LeetCode style. Implement <strong>{getLeetCodeConfig(currentQuestion?.question_id)?.methodName}</strong>
              {" "}inside <strong>class Solution</strong>. The platform will call your method automatically.
            </li>
            <li>Do not read input manually from stdin for these coding questions.</li>
            <li>Return the final answer from the method in the expected type and format.</li>
          </>
        ) : (
          <>
            <li>Read input from standard input (stdin) in your selected language.</li>
            <li>Print only the required output to stdout.</li>
          </>
        )}
        <li>The platform/compiler will provide test input automatically at runtime.</li>
        <li>Do not hardcode input values.</li>
        <li>Tests (including hidden ones) run automatically.</li>
        <li>Do not forget to click Save after running the code.</li>
      </ul>
    </div>
  );

  const renderOutputDisplay = () => (
    <div className="output-display">
      <span className="output-label">Output</span>
      <div className="output-value">{codingOutput || "<no output yet>"}</div>
    </div>
  );

  const renderTestOutcomeBoxes = () => {
    if (!testOutcomes.length) return null;
    return (
      <div className="test-outcome-row">
        {Array.from({ length: 5 }).map((_, idx) => {
          const outcome = testOutcomes[idx];
          const isHidden = idx >= 3;
          const status = outcome ? (outcome.passed ? "pass" : "fail") : "pending";
          return (
            <div key={`outcome-${idx}`} className={`test-outcome-box ${status}`}>
              <span className="test-label">
                {isHidden ? `Hidden ${idx - 2}` : `Test ${idx + 1}`}
              </span>
              <strong>{status === "pass" ? "\u2713\u2713" : status === "fail" ? "\u2717\u2717" : "--"}</strong>
              {!isHidden && outcome && (
                <div className="test-details">
                  <p className="test-detail">
                    <span>Input:</span> {formatTestValue(outcome.input)}
                  </p>
                  <p className="test-detail">
                    <span>Your Output:</span>{" "}
                    {formatTestValue(outcome.stdout)}
                  </p>
                  {!outcome.passed && (
                    <p className="test-detail">
                      <span>Expected:</span>{" "}
                      {formatTestValue(outcome.expected_output)}
                    </p>
                  )}
                </div>
              )}
              {isHidden && outcome && (
                <span className="hidden-note">{outcome.passed ? "hidden test passed" : "hidden test failed"}</span>
              )}
            </div>
          );
        })}
      </div>
    );
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
              onChange={(event) => {
                const nextLang = event.target.value;
                setCodingLanguage(nextLang);
                const qId = Number(currentQuestion?.question_id || 0);
                if (qId) {
                  setCodingLanguageByQuestion((prev) => ({ ...prev, [qId]: nextLang }));
                }
              }}
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
              height="100%"
              language={codingLanguage}
              theme="vs-dark"
              value={currentAnswer}
              onChange={(value) => updateAnswer(currentQuestion, value || "")}
              options={{
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                inlineSuggest: { enabled: false },
                wordBasedSuggestions: "off",
                snippetSuggestions: "none",
                acceptSuggestionOnEnter: "off",
                tabCompletion: "off"
              }}
            />
          </div>
        </div>
      );
    }

    if (questionType === "descriptive") {
      return (
        <div className="descriptive-answer">
          <textarea
            className="descriptive-input"
            placeholder={
              currentDescriptiveWordLimit
                ? `Type your answer here (max ${currentDescriptiveWordLimit} words)...`
                : "Type your answer here..."
            }
            value={currentAnswer}
            onChange={handleDescriptiveChange}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-ms-editor="false"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
          />
          {descriptiveLimitMessage && (
            <p className="descriptive-limit-message">{descriptiveLimitMessage}</p>
          )}
          {currentDescriptiveWordLimit && (
            <p
              className={`descriptive-word-count ${
                isCurrentDescriptiveOverLimit ? "invalid" : "valid"
              }`}
            >
              Words: {currentDescriptiveWordCount}/{currentDescriptiveWordLimit}
            </p>
          )}
        </div>
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
            onClick={(event) => {
              event.preventDefault();
              handleOptionToggle(option.value);
            }}
          >
            <input
              type="radio"
              name={`q_${currentQuestion.question_id}`}
              value={option.value}
              checked={currentAnswer === option.value}
              readOnly
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
            {preExamStep === 1 ? (
              <>
                <div className="preexam-notices">
                  <h2>Instructions</h2>
                  <ul>
                    {instructionList.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </div>
                <div className="preexam-actions">
                  <button
                    type="button"
                    className="start-btn"
                    onClick={() => setPreExamStep(2)}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="preexam-notices">
                  <h2>Exam Overview</h2>
                </div>
                <div className="preexam-status">
                  <div>
                    <p className="status-label">Total Questions</p>
                    <strong>{examOverview.totalQuestions || "--"}</strong>
                  </div>
                  <div>
                    <p className="status-label">Sections</p>
                    <strong>{examOverview.sectionCount || "--"}</strong>
                  </div>
                  <div>
                    <p className="status-label">Options Per MCQ</p>
                    <strong>{examOverview.optionCount}</strong>
                  </div>
                  <div>
                    <p className="status-label">Duration</p>
                    <strong>{examOverview.durationLabel}</strong>
                  </div>
                </div>
                {examOverview.sectionNames.length > 0 && (
                  <p className="preexam-footnote">
                    Sections: {examOverview.sectionNames.join(", ")}
                  </p>
                )}
                <div className="preexam-breakdown">
                  {examOverview.breakdown.map((section) => (
                    <div key={`overview-${section.key}`} className="preexam-breakdown-item">
                      <p className="preexam-breakdown-title">
                        {section.label} - {section.count} questions
                      </p>
                      <p className="preexam-breakdown-desc">{section.description}</p>
                    </div>
                  ))}
                </div>
                <div className="preexam-actions">
                  <button
                    type="button"
                    className="start-btn"
                    onClick={() => setPreExamStep(1)}
                  >
                    Back
                  </button>
                    <button
                      type="button"
                      className="start-btn"
                      onClick={() => {
                      if (strictProctoringEnabled) {
                        enterFullscreen();
                      }
                      setPreExamOpen(false);
                    }}
                  >
                    Start
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="background-glow" />
      {sectionOverlayOpen && (
        <div
          className="section-instruction-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="section-instruction-title"
          aria-describedby="section-instruction-body"
        >
          <div className="section-instruction-panel">
            <h2 id="section-instruction-title">{sectionInstruction.title}</h2>
            <p id="section-instruction-body">{sectionInstruction.message}</p>
            <button type="button" onClick={handleSectionOverlayClose}>
              Continue to {pendingSection ? getSectionDisplayName(pendingSection) : "next"} section
            </button>
          </div>
        </div>
      )}
      {submitConfirmOpen && (
        <div
          className="submit-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
          aria-describedby="submit-confirm-body"
        >
          <div className="submit-confirm-panel">
            <h2 id="submit-confirm-title">Submit exam</h2>
            <p id="submit-confirm-body">
              Once you submit, you cannot attempt this exam again. Are you sure
              you want to submit?
            </p>
            <p className="submit-warning">
              Please double-check all sections. After submission you'll see a
              confirmation message and be asked to wait for the results.
            </p>
            <div className="submit-confirm-actions">
              <button
                type="button"
                className="nav-btn secondary"
                onClick={() => setSubmitConfirmOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="nav-btn primary"
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Yes, submit"}
              </button>
            </div>
          </div>
        </div>
      )}
      {feedbackOpen && (
        <div
          className="submit-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
          aria-describedby="feedback-body"
        >
          <div className="submit-confirm-panel feedback-panel">
            <div className="feedback-header-row">
              <span className="feedback-kicker">POST EXAM REVIEW</span>
              <h2 id="feedback-title">Quick Feedback</h2>
              <p id="feedback-body">{FEEDBACK_QUESTION}</p>
            </div>
            <textarea
              className="feedback-textarea"
              value={feedbackText}
              onChange={(event) => {
                setFeedbackText(event.target.value || "");
                if (feedbackError) setFeedbackError("");
              }}
              placeholder="Share your feedback..."
              maxLength={900}
            />
            <div className="feedback-meta-row">
              <p className={`feedback-counter ${isFeedbackTooLong ? "error" : ""}`}>
                {feedbackWordCount}/100 words
              </p>
              <p className="feedback-meta-hint">Tip: mention question quality and difficulty level.</p>
            </div>
            {feedbackError ? <p className="feedback-error">{feedbackError}</p> : null}
            <div className="submit-confirm-actions feedback-actions">
              <button
                type="button"
                className="nav-btn secondary"
                onClick={handleSkipFeedback}
                disabled={isSavingFeedback}
              >
                Skip
              </button>
              <button
                type="button"
                className="nav-btn primary"
                onClick={handleSubmitFeedback}
                disabled={isSavingFeedback || isFeedbackTooLong}
              >
                {isSavingFeedback ? "Saving..." : "Submit Feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
      {(isSubmitting || submitMessage) && (
        <div className="submit-feedback-overlay" role="alertdialog" aria-modal="true" aria-labelledby="submit-feedback-title">
          <div className={`submit-feedback-panel ${isSubmitting ? "success" : submitSuccess ? "success" : "error"}`}>
            <h3 id="submit-feedback-title">
              {isSubmitting ? "Exam Submitting" : submitSuccess ? "Exam Submitted Successfully" : "Submission Failed"}
            </h3>
            <p>
              {isSubmitting
                ? "Exam is submitting. Please wait patiently."
                : submitMessage}
            </p>
            {!isSubmitting && !submitSuccess && (
              <button
                type="button"
                className="nav-btn"
                onClick={() => setSubmitMessage("")}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
      {strictProctoringEnabled && violationWarning.open && !submitSuccess && (
        <div
          className="violation-warning-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="violation-warning-title"
          aria-describedby="violation-warning-body"
        >
          <div className="violation-warning-panel">
            <h3 id="violation-warning-title">Warning</h3>
            <p id="violation-warning-body">
              You are trying to go outside the exam window.
            </p>
            <p className="violation-warning-count">
              Violations occurred: {violationWarning.count}/{VIOLATION_LIMIT}
            </p>
            {violationWarning.reason ? (
              <p className="violation-warning-reason">{violationWarning.reason}</p>
            ) : null}
            <div className="violation-warning-actions">
              <button type="button" className="nav-btn primary" onClick={handleViolationGoFullscreen}>
                Go Fullscreen
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="exam-header">
        <div>
          <p className="eyebrow">Live proctored session</p>
          <h1>Online Examination App</h1>
        </div>
        <div className="header-chips">
          <div className="chip">
            <span>Violations</span>
            <strong>
              {strictProctoringEnabled ? `${violations}/${VIOLATION_LIMIT}` : "N/A"}
            </strong>
          </div>
          <div className="chip subtle">
            <span>Fullscreen</span>
            <strong>{strictProctoringEnabled ? (isFullscreen ? "On" : "Off") : "Not Required"}</strong>
          </div>
          <div className="chip subtle">
            <span>Total marks</span>
            <strong>50</strong>
          </div>
          {durationMinutes || isRegularInstructionPhase ? (
            <div className="chip subtle">
              <span>{headerTimerLabel}</span>
              <strong>{formatTimer(headerTimerSeconds)}</strong>
            </div>
          ) : null}
          <div className="chip subtle">
            <span>Total Question</span>
            <strong>= {questionBank.length || (isRegularInstructionPhase ? "--" : "--")}</strong>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="submit-btn"
            onClick={() => setSubmitConfirmOpen(true)}
            disabled={isRegularInstructionPhase || (remainingSeconds !== null && remainingSeconds <= 0)}
          >
            {isRegularInstructionPhase
              ? "Questions Locked"
              : remainingSeconds !== null && remainingSeconds <= 0
                ? "Time Over"
                : "Submit Exam"}
          </button>
        </div>
      </div>
      {securityNotice && (
        <div
          key={`security-notice-${securityNoticeKey}`}
          className="security-notice"
          role="alert"
          aria-live="assertive"
        >
          {securityNotice}
        </div>
      )}
      {currentSection && questionBank.length > 0 && (
        <div className="section-banner-outside">
          {sectionNavigator.sections.length > 0 && (
            <select
              className="section-banner-select"
              aria-label="Change section"
              value={currentSection || sectionNavigator.sections[0]}
              onChange={(event) => handleJumpToSection(event.target.value)}
              disabled={loading || sectionOverlayOpen}
            >
              {sectionNavigator.sections.map((section) => (
                <option key={`jump-${section}`} value={section}>
                  {getSectionInstruction(section).title}
                </option>
              ))}
            </select>
          )}
          {sectionNavigator.sections.length === 0 && (
            <span className="section-banner-title">
              {getSectionInstruction(currentSection).title}
            </span>
          )}
        </div>
      )}
      <div className="exam-main">
        <section className="question-column">
          <div className="progress-top">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${questionBank.length ? ((currentIndex + 1) / questionBank.length) * 100 : 0}%` }}
              />
            </div>
            <small>{questionBank.length ? `${Math.round(((currentIndex + 1) / questionBank.length) * 100)}% complete` : "Preparing"}</small>
          </div>
          {currentSectionProgress && (
            <div className="section-progress">
              Section {currentSectionProgress.number} / {currentSectionProgress.total}
            </div>
          )}
          <div className="question-card-wrapper">
            <div className="question-card surface">
              {!loading && currentQuestion && (
                <>
                  {questionType === "coding" ? (
                    <div className="coding-layout">
                      <div className="coding-description">
                        <div className="coding-section-title">Coding Section</div>
                        {renderQuestionPrompt()}
                        {renderCodingInstructions()}
                        {renderExamples()}
                      </div>
                      <div className="coding-workspace">
                        {renderQuestionBody()}
                        <div className="coding-console-card">
                          <div className="console-header">
                            <div>STDOUT</div>
                            <div className="console-actions">
                              <button
                                type="button"
                                className="clear-btn"
                                onClick={() => {
                                  setConsoleLines([]);
                                  setTestOutcomes([]);
                                }}
                                disabled={isRunningCode}
                              >
                                Clear
                              </button>
                              <button className="run-btn" type="button" onClick={handleRunCode} disabled={isRunningCode}>
                                {isRunningCode ? "Running..." : "Run Code"}
                              </button>
                            </div>
                          </div>
                          <div className="coding-run-stats" aria-live="polite">
                            <div className="coding-run-stat">
                              <span>Last run</span>
                              <strong>{currentCodingRun.passed}/{currentCodingRun.total || codingTestcases.length || 0}</strong>
                            </div>
                          </div>
                          {renderTestOutcomeBoxes()}
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
                        </div>
                        {renderOutputDisplay()}
                      </div>
                    </div>
                  ) : (
                    <>
                      {renderQuestionPrompt()}
                      {renderQuestionBody()}
                    </>
                  )}
                </>
              )}
              {loading && <p className="status-text">Loading exam content...</p>}
              {!loading && isRegularInstructionPhase && (
                <div className="status-text">
                  <strong>Instruction window is active.</strong>
                  <br />
                  You have entered the exam successfully. Questions will unlock in {formatTimer(regularTiming?.unlockInSeconds || 0)}.
                  <br />
                  Late starts close at {new Date(regularTiming?.lateStartDeadlineAt || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "--:--"} and submission will auto-close at {new Date(regularTiming?.submissionDeadlineAt || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "--:--"}.
                </div>
              )}
              {!loading && error && <p className="status-text error-text">{error}</p>}
              <div className="question-actions">
                <div className="nav-buttons">
                  <button
                    type="button"
                    className="nav-btn secondary"
                    onClick={handlePrevious}
                    disabled={isRegularInstructionPhase || currentIndex === 0 || sectionOverlayOpen}
                  >
                    Previous
                  </button>
                  {questionType === "mcq" ? (
                    <button
                      type="button"
                      className="nav-btn primary"
                      onClick={() => {
                        if (!currentAnswer) {
                          handleSkip();
                        } else {
                          handleNext();
                        }
                      }}
                      disabled={isRegularInstructionPhase || currentIndex >= questionBank.length - 1 || sectionOverlayOpen}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="nav-btn primary"
                      onClick={handleNext}
                      disabled={isRegularInstructionPhase || currentIndex >= questionBank.length - 1 || sectionOverlayOpen}
                    >
                      Next
                    </button>
                  )}
                </div>
                {questionType === "coding" && (
                  <div className="save-row">
                    <button
                      type="button"
                      className="nav-btn secondary"
                      onClick={handleSaveCurrent}
                    >
                      Save
                    </button>
                    <span className="save-indicator">{isCurrentSaved ? "Saved" : ""}</span>
                  </div>
                )}
                {autosaveStatus && (
                  <div className="save-row">
                    <span className="save-indicator">{autosaveStatus}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

