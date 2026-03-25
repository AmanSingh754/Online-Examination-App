"use strict";

const {
    SessionClient,
    assertOk,
    getRequiredEnv,
    getOptionalEnv,
    toIstParts
} = require("./smoke-helpers");

async function main() {
    const adminEmail = getRequiredEnv("SMOKE_ADMIN_EMAIL");
    const adminPassword = getRequiredEnv("SMOKE_ADMIN_PASSWORD");
    const regularStudentEmail = getRequiredEnv("SMOKE_REGULAR_STUDENT_EMAIL");
    const regularStudentPassword = getRequiredEnv("SMOKE_REGULAR_STUDENT_PASSWORD");
    const explicitCollegeId = getOptionalEnv("SMOKE_REGULAR_COLLEGE_ID");
    const otherStudentEmail = getOptionalEnv("SMOKE_OTHER_REGULAR_STUDENT_EMAIL");
    const otherStudentPassword = getOptionalEnv("SMOKE_OTHER_REGULAR_STUDENT_PASSWORD");

    const admin = new SessionClient();
    const regularStudent = new SessionClient();

    const adminLogin = await admin.json("/admin/login", {
        method: "POST",
        body: { email: adminEmail, password: adminPassword }
    });
    assertOk(adminLogin.response.ok && adminLogin.body?.success, `Admin login failed: ${JSON.stringify(adminLogin.body)}`);

    const studentLogin = await regularStudent.json("/student/login", {
        method: "POST",
        body: { email: regularStudentEmail, password: regularStudentPassword }
    });
    assertOk(studentLogin.response.ok && studentLogin.body?.success, `Regular student login failed: ${JSON.stringify(studentLogin.body)}`);

    const studentId = Number(studentLogin.body?.studentId || 0);
    const collegeName = String(studentLogin.body?.collegeName || "").trim();
    assertOk(studentId > 0, "Regular student login did not return a valid studentId");

    const collegesResp = await regularStudent.json("/student/colleges");
    assertOk(collegesResp.response.ok && Array.isArray(collegesResp.body), "Could not load colleges");
    const resolvedCollegeId = explicitCollegeId ||
        String(
            collegesResp.body.find((row) => String(row?.college_name || "").trim() === collegeName)?.college_id || ""
        ).trim();
    assertOk(resolvedCollegeId, `Could not resolve college_id for logged-in regular student college: ${collegeName || "--"}`);

    const { date, time } = toIstParts(new Date(Date.now() - 2 * 60 * 1000));
    const scheduleResp = await admin.json("/admin/exam", {
        method: "POST",
        body: {
            collegeId: resolvedCollegeId,
            startDate: date,
            startTime: time
        }
    });
    assertOk(scheduleResp.response.ok && scheduleResp.body?.success, `Regular exam scheduling failed: ${JSON.stringify(scheduleResp.body)}`);

    const examsResp = await admin.json("/admin/exams");
    assertOk(examsResp.response.ok && Array.isArray(examsResp.body), "Could not load admin exams");
    const matchingExam = examsResp.body.find((row) =>
        String(row?.exam_id || "") === String(scheduleResp.body?.examId || "") &&
        String(row?.college_id || "") === String(resolvedCollegeId)
    );
    assertOk(matchingExam, "Scheduled exam was not returned with the expected college_id");

    const availableResp = await regularStudent.json(`/student/exams/${studentId}`);
    assertOk(availableResp.response.ok && Array.isArray(availableResp.body), `Could not load regular student exams: ${JSON.stringify(availableResp.body)}`);
    const visibleExam = availableResp.body.find((row) => String(row?.exam_id || "") === String(scheduleResp.body?.examId || ""));
    assertOk(visibleExam, "Scheduled college-scoped regular exam is not visible to the matching student");

    const startResp = await regularStudent.json("/exam/regular/start", {
        method: "POST",
        body: {
            studentId,
            examId: Number(scheduleResp.body?.examId || 0)
        }
    });
    assertOk(startResp.response.ok && startResp.body?.success, `Regular exam start failed: ${JSON.stringify(startResp.body)}`);

    const questionsResp = await regularStudent.json(`/exam/regular/questions/${Number(scheduleResp.body?.examId || 0)}`);
    assertOk(questionsResp.response.ok && Array.isArray(questionsResp.body), `Regular exam questions fetch failed: ${JSON.stringify(questionsResp.body)}`);
    assertOk(questionsResp.body.length > 0, "Regular exam returned zero questions");

    if (otherStudentEmail && otherStudentPassword) {
        const otherStudent = new SessionClient();
        const otherLogin = await otherStudent.json("/student/login", {
            method: "POST",
            body: { email: otherStudentEmail, password: otherStudentPassword }
        });
        assertOk(otherLogin.response.ok && otherLogin.body?.success, `Other regular student login failed: ${JSON.stringify(otherLogin.body)}`);

        const otherStudentId = Number(otherLogin.body?.studentId || 0);
        const otherVisibleResp = await otherStudent.json(`/student/exams/${otherStudentId}`);
        assertOk(otherVisibleResp.response.ok && Array.isArray(otherVisibleResp.body), "Could not load other student exams");
        const leakedExam = otherVisibleResp.body.find((row) => String(row?.exam_id || "") === String(scheduleResp.body?.examId || ""));
        assertOk(!leakedExam, "Scheduled regular exam leaked to the comparison student");
    }

    console.log(JSON.stringify({
        success: true,
        examId: Number(scheduleResp.body?.examId || 0),
        collegeId: String(resolvedCollegeId),
        verifiedStudentId: studentId,
        comparedWithOtherStudent: Boolean(otherStudentEmail && otherStudentPassword)
    }, null, 2));
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
