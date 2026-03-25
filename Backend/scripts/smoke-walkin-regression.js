"use strict";

const {
    SessionClient,
    assertOk,
    getRequiredEnv
} = require("./smoke-helpers");

async function main() {
    const walkinStudentEmail = getRequiredEnv("SMOKE_WALKIN_STUDENT_EMAIL");
    const walkinStudentPassword = getRequiredEnv("SMOKE_WALKIN_STUDENT_PASSWORD");

    const walkin = new SessionClient();
    const loginResp = await walkin.json("/student/login", {
        method: "POST",
        body: { email: walkinStudentEmail, password: walkinStudentPassword }
    });
    assertOk(loginResp.response.ok && loginResp.body?.success, `Walk-in login failed: ${JSON.stringify(loginResp.body)}`);

    const studentId = Number(loginResp.body?.studentId || 0);
    const studentType = String(loginResp.body?.studentType || "").trim().toUpperCase();
    assertOk(studentId > 0, "Walk-in login did not return a valid studentId");
    assertOk(studentType === "WALK_IN" || studentType === "WALKIN", `Expected WALK_IN student type, received: ${studentType || "--"}`);

    const availableResp = await walkin.json(`/student/exams/${studentId}`);
    assertOk(availableResp.response.ok && Array.isArray(availableResp.body), `Could not load walk-in student exams: ${JSON.stringify(availableResp.body)}`);
    assertOk(availableResp.body.length > 0, "Walk-in student has no available exam");

    const examId = Number(availableResp.body[0]?.exam_id || 0);
    assertOk(examId > 0, "Walk-in exam_id missing from available exam list");

    const startResp = await walkin.json("/exam/start", {
        method: "POST",
        body: {
            studentId,
            examId
        }
    });
    assertOk(startResp.response.ok && startResp.body?.success, `Walk-in exam start failed: ${JSON.stringify(startResp.body)}`);

    const questionsResp = await walkin.json(`/exam/regular_exam_questions/${examId}`);
    assertOk(questionsResp.response.ok && Array.isArray(questionsResp.body), `Walk-in questions fetch failed: ${JSON.stringify(questionsResp.body)}`);
    assertOk(questionsResp.body.length > 0, "Walk-in exam returned zero questions");

    const durationResp = await walkin.json(`/exam/duration/${examId}`);
    assertOk(durationResp.response.ok && durationResp.body?.success, `Walk-in duration fetch failed: ${JSON.stringify(durationResp.body)}`);
    assertOk(Number(durationResp.body?.durationMinutes || 0) > 0, "Walk-in durationMinutes was not returned");

    console.log(JSON.stringify({
        success: true,
        studentId,
        examId,
        durationMinutes: Number(durationResp.body?.durationMinutes || 0),
        questionCount: questionsResp.body.length
    }, null, 2));
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
