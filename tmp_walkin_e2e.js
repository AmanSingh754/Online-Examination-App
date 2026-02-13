const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');

const studentRoutes = require('./Backend/routes/student.routes');
const examRoutes = require('./Backend/routes/exam.routes');

async function main() {
  const db = await mysql.createConnection({ host: 'localhost', user: 'root', password: '12345', database: 'Project1' });

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use('/student', studentRoutes);
  app.use('/exam', examRoutes);

  const port = 5055;
  const server = await new Promise((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });

  let cookie = '';
  const doFetch = async (path, options = {}) => {
    const headers = Object.assign({}, options.headers || {});
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`http://localhost:${port}${path}`, { ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let body = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body };
  };

  try {
    const studentId = 29;
    await db.query("UPDATE students SET status='ACTIVE' WHERE student_id=?", [studentId]);

    const [[studentRow]] = await db.query(
      `SELECT s.student_id, s.email_id, sc.password
       FROM students s JOIN student_credentials sc ON sc.student_id=s.student_id
       WHERE s.student_id=? LIMIT 1`,
      [studentId]
    );
    if (!studentRow) throw new Error('Student 29 not found');

    const login = await doFetch('/student/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: studentRow.email_id, password: studentRow.password })
    });
    if (!login.body?.success) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);

    const examsActive = await doFetch(`/student/exams/${studentId}`);

    await db.query("UPDATE students SET status='INACTIVE' WHERE student_id=?", [studentId]);
    const examsInactive = await doFetch(`/student/exams/${studentId}`);

    await db.query("UPDATE students SET status='ACTIVE' WHERE student_id=?", [studentId]);
    const examsReactivated = await doFetch(`/student/exams/${studentId}`);
    const exam = Array.isArray(examsReactivated.body) ? examsReactivated.body[0] : null;
    if (!exam?.exam_id) throw new Error(`No exam after reactivate: ${JSON.stringify(examsReactivated.body)}`);

    const qResp = await doFetch(`/exam/questions/${exam.exam_id}`);
    const questions = Array.isArray(qResp.body) ? qResp.body : [];
    if (!questions.length) throw new Error('No questions fetched');

    const expected = {
      aptitude: questions.filter((q) => String(q.section_name || '').trim().toUpperCase() === 'APTITUDE').length,
      technical: questions.filter((q) => String(q.question_type || '').toUpperCase() !== 'CODING' && String(q.section_name || '').trim().toUpperCase() !== 'APTITUDE').length,
      coding: questions.filter((q) => String(q.question_type || '').toUpperCase() === 'CODING').length,
      total: questions.length
    };

    const answers = questions.map((q) => {
      const qType = String(q.question_type || '').toUpperCase();
      if (qType === 'MCQ') {
        return {
          question_id: Number(q.question_id),
          question_type: 'MCQ',
          section_name: String(q.section_name || ''),
          selected_option: 'A'
        };
      }
      if (qType === 'DESCRIPTIVE') {
        return {
          question_id: Number(q.question_id),
          question_type: 'DESCRIPTIVE',
          section_name: String(q.section_name || 'Technical'),
          descriptive_answer: 'Sample answer for end-to-end alignment test.'
        };
      }
      return {
        question_id: Number(q.question_id),
        question_type: 'CODING',
        section_name: 'Coding',
        code: "print('ok')",
        testcases_passed: 0,
        testcases_total: 5
      };
    });

    const submit = await doFetch('/exam/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, examId: Number(exam.exam_id), answers })
    });
    if (!submit.body?.success) throw new Error(`Submit failed: ${JSON.stringify(submit.body)}`);
    const effectiveExamId = Number(submit.body.examId || exam.exam_id);

    // wait for async summary
    let summary = '';
    for (let i = 0; i < 20; i++) {
      const [[row]] = await db.query(
        `SELECT COALESCE(performance_summary,'') AS summary
         FROM walkin_final_results
         WHERE student_id=? AND exam_id=?
         LIMIT 1`,
        [studentId, effectiveExamId]
      );
      summary = String(row?.summary || '');
      if (summary.trim()) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    const [descRows] = await db.query(`DESCRIBE walkin_student_answers`);
    const hasSectionName = descRows.some((r) => String(r.Field).toLowerCase() === 'section_name');

    const [countRows] = await db.query(
      `SELECT UPPER(COALESCE(section_name,'')) AS sec, COUNT(*) AS c
       FROM walkin_student_answers
       WHERE student_id=? AND exam_id=?
       GROUP BY UPPER(COALESCE(section_name,''))
       ORDER BY sec`,
      [studentId, effectiveExamId]
    );

    const stored = {
      aptitude: 0,
      technical: 0,
      coding: 0,
      blank: 0,
      total: 0
    };
    for (const r of countRows) {
      const sec = String(r.sec || '');
      const c = Number(r.c || 0);
      stored.total += c;
      if (sec === 'APTITUDE') stored.aptitude += c;
      else if (sec === 'TECHNICAL') stored.technical += c;
      else if (sec === 'CODING') stored.coding += c;
      else stored.blank += c;
    }

    const result = {
      login_success: Boolean(login.body?.success),
      activation_visibility: {
        active_exam_count: Array.isArray(examsActive.body) ? examsActive.body.length : -1,
        inactive_exam_count: Array.isArray(examsInactive.body) ? examsInactive.body.length : -1,
        reactivated_exam_count: Array.isArray(examsReactivated.body) ? examsReactivated.body.length : -1
      },
      submission: {
        initial_exam_id: Number(exam.exam_id),
        effective_exam_id: effectiveExamId,
        success: Boolean(submit.body?.success)
      },
      schema: {
        walkin_student_answers_has_section_name: hasSectionName
      },
      alignment: {
        expected,
        stored
      },
      summary: {
        ready: summary.trim().length > 0,
        preview: summary.slice(0, 220)
      }
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.end();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
