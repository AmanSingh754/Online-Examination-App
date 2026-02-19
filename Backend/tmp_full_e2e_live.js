const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');

const studentRoutes = require('./routes/student.routes');
const examRoutes = require('./routes/exam.routes');

function getSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') {
    const arr = headers.getSetCookie();
    return Array.isArray(arr) ? arr : [];
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function escapePy(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildPythonForTestcases(testcases) {
  const mapping = {};
  for (const tc of testcases) {
    const expected = tc?.expected_output === undefined || tc?.expected_output === null ? '' : String(tc.expected_output);
    const rawInput = JSON.stringify(tc?.input ?? '');
    mapping[rawInput] = expected;
    try {
      const parsed = JSON.parse(rawInput);
      const normalized = JSON.stringify(parsed);
      mapping[normalized] = expected;
      if (typeof parsed === 'string') {
        mapping[parsed] = expected;
        mapping[parsed.trim()] = expected;
      }
    } catch (_) {}
  }

  const entries = Object.entries(mapping)
    .map(([k, v]) => `    '${escapePy(k)}': '${escapePy(v)}'`)
    .join(',\n');

  return `import sys, json\nraw = sys.stdin.read()\nraw = '' if raw is None else str(raw).strip()\nmapv = {\n${entries}\n}\nif raw in mapv:\n    sys.stdout.write(mapv[raw])\nelse:\n    try:\n        parsed = json.loads(raw)\n        key = json.dumps(parsed)\n        if key in mapv:\n            sys.stdout.write(mapv[key])\n        elif isinstance(parsed, str) and parsed in mapv:\n            sys.stdout.write(mapv[parsed])\n        elif isinstance(parsed, str) and parsed.strip() in mapv:\n            sys.stdout.write(mapv[parsed.strip()])\n        else:\n            sys.stdout.write('')\n    except Exception:\n        sys.stdout.write('')\n`;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(session({ secret: 'e2e-secret', resave: false, saveUninitialized: false }));
  app.use('/student', studentRoutes);
  app.use('/exam', examRoutes);

  const port = 5058;
  const server = await new Promise((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });

  const base = `http://localhost:${port}`;
  let cookieJar = '';

  const pool = new Pool({
    host: process.env.PG_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.PG_PORT || process.env.DB_PORT || 5432),
    user: process.env.PG_USER || process.env.DB_USER,
    password: process.env.PG_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.PG_DATABASE || process.env.DB_NAME,
    ssl: String(process.env.PG_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false
  });

  const doFetch = async (urlPath, opts = {}) => {
    const headers = Object.assign({}, opts.headers || {});
    if (cookieJar) headers.Cookie = cookieJar;
    const res = await fetch(`${base}${urlPath}`, { ...opts, headers });
    const setCookies = getSetCookie(res.headers);
    if (setCookies.length) cookieJar = setCookies.map((s) => s.split(';')[0]).join('; ');
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };

  try {
    const { rows: students } = await pool.query(`
      SELECT s.student_id, s.email_id, sc.password, s.course, s.status, s.student_type
      FROM students s
      JOIN student_credentials sc ON sc.student_id = s.student_id
      WHERE UPPER(REPLACE(COALESCE(s.student_type::text,''),'-','_')) IN ('WALK_IN','WALKIN')
      ORDER BY s.student_id DESC
      LIMIT 25
    `);
    if (!students.length) throw new Error('No walk-in students with credentials found');

    let picked = null;
    let loginResp = null;
    for (const s of students) {
      await pool.query(`UPDATE students SET status='ACTIVE' WHERE student_id=$1`, [s.student_id]);
      const lr = await doFetch('/student/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: s.email_id, password: s.password })
      });
      if (lr.body?.success) { picked = s; loginResp = lr; break; }
    }
    if (!picked) throw new Error('Could not login with any walk-in student');

    const studentId = Number(picked.student_id);
    const examsResp = await doFetch(`/student/exams/${studentId}`);
    const exams = Array.isArray(examsResp.body) ? examsResp.body : [];
    if (!exams.length) throw new Error(`No available exam. Response: ${JSON.stringify(examsResp.body)}`);
    const examId = Number(exams[0].exam_id);

    const startResp = await doFetch('/exam/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, examId })
    });
    if (!startResp.body?.success) throw new Error(`Exam start failed: ${JSON.stringify(startResp.body)}`);

    const qResp = await doFetch(`/exam/questions/${examId}`);
    const questions = Array.isArray(qResp.body) ? qResp.body : [];
    if (!questions.length) throw new Error(`No questions for exam ${examId}`);

    const answers = [];
    const codingRunResults = [];

    for (const qn of questions) {
      const qid = Number(qn.question_id);
      const qtype = String(qn.question_type || '').toUpperCase();
      const sectionName = String(qn.section_name || '');

      if (qtype === 'MCQ') {
        const selected = String(qn.correct_answer || 'A').trim().toUpperCase().charAt(0) || 'A';
        answers.push({ question_id: qid, question_type: 'MCQ', section_name: sectionName, selected_option: selected });
        continue;
      }
      if (qtype === 'DESCRIPTIVE') {
        answers.push({ question_id: qid, question_type: 'DESCRIPTIVE', section_name: sectionName || 'Technical', descriptive_answer: 'Structured concise descriptive answer for automated E2E validation.' });
        continue;
      }

      let testcases = qn.testcases;
      if (typeof testcases === 'string') { try { testcases = JSON.parse(testcases); } catch { testcases = []; } }
      if (!Array.isArray(testcases)) testcases = [];

      const code = buildPythonForTestcases(testcases);
      const runResp = await doFetch('/exam/run-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'python', code, testcases })
      });

      const passed = Number(runResp.body?.passed || 0);
      const total = Number(runResp.body?.total || testcases.length || 0);
      codingRunResults.push({ question_id: qid, status: runResp.status, success: Boolean(runResp.body?.success), passed, total });

      answers.push({ question_id: qid, question_type: 'CODING', section_name: 'Coding', code, testcases_passed: passed, testcases_total: total });
    }

    const submitResp = await doFetch('/exam/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, examId, studentExamId: startResp.body?.studentExamId || null, answers })
    });

    const effectiveExamId = Number(submitResp.body?.examId || examId);
    const attemptedResp = await doFetch(`/student/attempted-exams/${studentId}`);

    const { rows: statusRows } = await pool.query(`SELECT status, walkin_exam_id FROM students WHERE student_id=$1 LIMIT 1`, [studentId]);
    const { rows: finalRows } = await pool.query(`SELECT result_id, total_marks FROM walkin_final_results WHERE student_id=$1 AND exam_id=$2 LIMIT 1`, [studentId, effectiveExamId]);

    const report = {
      student: { student_id: studentId, email: picked.email_id, course: picked.course },
      login: { status: loginResp.status, success: Boolean(loginResp.body?.success) },
      available_exams: { status: examsResp.status, count: exams.length, picked_exam_id: examId },
      exam_start: { status: startResp.status, success: Boolean(startResp.body?.success), body: startResp.body },
      question_counts: {
        total: questions.length,
        mcq: questions.filter((q) => String(q.question_type || '').toUpperCase() === 'MCQ').length,
        descriptive: questions.filter((q) => String(q.question_type || '').toUpperCase() === 'DESCRIPTIVE').length,
        coding: questions.filter((q) => String(q.question_type || '').toUpperCase() === 'CODING').length
      },
      coding_runs: codingRunResults,
      submit: { status: submitResp.status, success: Boolean(submitResp.body?.success), body: submitResp.body, effective_exam_id: effectiveExamId },
      attempted_after_submit: { status: attemptedResp.status, count: Array.isArray(attemptedResp.body) ? attemptedResp.body.length : -1 },
      db_after_submit: {
        student_status: statusRows?.[0]?.status || null,
        student_walkin_exam_id: Number(statusRows?.[0]?.walkin_exam_id || 0) || null,
        final_result_found: finalRows.length > 0,
        final_total_marks: Number(finalRows?.[0]?.total_marks || 0)
      }
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('[E2E_FAIL]', err?.stack || err);
  process.exit(1);
});
