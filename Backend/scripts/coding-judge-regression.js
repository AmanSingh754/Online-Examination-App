"use strict";

const {
    SessionClient,
    assertOk,
    getRequiredEnv
} = require("./smoke-helpers");

const CODING_SOLUTIONS = {
    1: {
        language: "python",
        code: `class Solution:
    def reverseString(self, s):
        return s[::-1]
`
    },
    2: {
        language: "python",
        code: `class Solution:
    def numberPyramid(self, n):
        lines = []
        for i in range(1, n + 1):
            left = ''.join(str(x) for x in range(1, i + 1))
            right = ''.join(str(x) for x in range(i - 1, 0, -1))
            spaces = ' ' * (n - i)
            lines.append(spaces + left + right)
        return '\\n'.join(lines)
`
    },
    3: {
        language: "python",
        code: `class Solution:
    def twoSum(self, numbers, target):
        left, right = 0, len(numbers) - 1
        while left < right:
            total = numbers[left] + numbers[right]
            if total == target:
                return [left + 1, right + 1]
            if total < target:
                left += 1
            else:
                right -= 1
        return []
`
    }
};

async function main() {
    const walkinStudentEmail = getRequiredEnv("SMOKE_WALKIN_STUDENT_EMAIL");
    const walkinStudentPassword = getRequiredEnv("SMOKE_WALKIN_STUDENT_PASSWORD");

    const client = new SessionClient();
    const loginResp = await client.json("/student/login", {
        method: "POST",
        body: { email: walkinStudentEmail, password: walkinStudentPassword }
    });
    assertOk(loginResp.response.ok && loginResp.body?.success, `Walk-in login failed: ${JSON.stringify(loginResp.body)}`);

    const studentId = Number(loginResp.body?.studentId || 0);
    assertOk(studentId > 0, "Walk-in login did not return a valid studentId");

    const examsResp = await client.json(`/student/exams/${studentId}`);
    assertOk(examsResp.response.ok && Array.isArray(examsResp.body) && examsResp.body.length > 0, "No walk-in exam available");

    const examId = Number(examsResp.body[0]?.exam_id || 0);
    assertOk(examId > 0, "Missing walk-in exam_id");

    const questionsResp = await client.json(`/exam/regular_exam_questions/${examId}`);
    const questions = Array.isArray(questionsResp.body) ? questionsResp.body : [];
    const codingQuestions = questions.filter((question) => String(question.question_type || "").toUpperCase() === "CODING");
    assertOk(codingQuestions.length >= 3, `Expected at least 3 coding questions, received ${codingQuestions.length}`);

    const results = [];
    for (const question of codingQuestions) {
        const questionId = Number(question.question_id || 0);
        const fixture = CODING_SOLUTIONS[questionId];
        assertOk(Boolean(fixture), `No regression fixture configured for coding question ${questionId}`);

        const runResp = await client.json("/exam/run-code", {
            method: "POST",
            body: {
                questionId,
                language: fixture.language,
                code: fixture.code,
                testcases: question.testcases || []
            }
        });
        assertOk(runResp.response.ok && runResp.body?.success, `run-code failed for question ${questionId}: ${JSON.stringify(runResp.body)}`);
        assertOk(
            Number(runResp.body?.passed || 0) === Number(runResp.body?.total || 0),
            `Coding regression failed for question ${questionId}: ${JSON.stringify(runResp.body)}`
        );
        results.push({
            question_id: questionId,
            passed: Number(runResp.body?.passed || 0),
            total: Number(runResp.body?.total || 0)
        });
    }

    console.log(JSON.stringify({ success: true, results }, null, 2));
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
