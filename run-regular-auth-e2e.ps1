Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$serverOut = Join-Path $PWD "backend-e2e.log"
$serverErr = Join-Path $PWD "backend-e2e.err.log"
if (Test-Path $serverOut) { Remove-Item $serverOut -Force }
if (Test-Path $serverErr) { Remove-Item $serverErr -Force }

$server = Start-Process -FilePath node -ArgumentList "Backend/server.js" -WorkingDirectory $PWD -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru

function Wait-Healthy {
  param([int]$Retries = 20)
  for ($i = 0; $i -lt $Retries; $i++) {
    Start-Sleep -Seconds 2
    try {
      $resp = Invoke-RestMethod -UseBasicParsing http://127.0.0.1:5000/healthz -TimeoutSec 10
      if ($resp.ok -eq $true) { return $resp }
    } catch {}
  }
  throw "Backend did not become healthy in time."
}

function Invoke-NodeJson {
  param(
    [Parameter(Mandatory = $true)][string]$Code,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    $output = @'
'@ + $Code + @'
'@ | node -
    $jsonLine = ($output -split "`r?`n" | Where-Object { $_.Trim().StartsWith("{") -or $_.Trim().StartsWith("[") } | Select-Object -Last 1)
    if (-not $jsonLine) {
      throw "Node helper did not return JSON. Output:`n$output"
    }
    return ($jsonLine | ConvertFrom-Json)
  }
  finally {
    Pop-Location
  }
}

try {
  Write-Host "[regular-smoke] waiting for backend health"
  $null = Wait-Healthy

  $setupCode = @'
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const { Client } = require("pg");
(async () => {
  const client = new Client({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT), user: process.env.PG_USER, password: process.env.PG_PASSWORD, database: process.env.PG_DATABASE, ssl: false });
  await client.connect();
  try {
    const colleges = await client.query(`
      SELECT c.college_id, c.college_name
      FROM college c
      LEFT JOIN students s ON s.college_id = c.college_id
      GROUP BY c.college_id, c.college_name
      HAVING COUNT(s.student_id) = 0
      ORDER BY c.college_id
      LIMIT 2
    `);
    if (colleges.rows.length < 2) throw new Error("Need two empty colleges for isolated smoke setup.");
    const stamp = Date.now();
    const adminEmail = `smoke.admin.${stamp}@example.com`;
    const adminPassword = `Admin!${stamp}`;
    const regularAEmail = `smoke.regular.a.${stamp}@example.com`;
    const regularBEmail = `smoke.regular.b.${stamp}@example.com`;
    const regularAPassword = `RegA!${stamp}`;
    const regularBPassword = `RegB!${stamp}`;
    const nextAdminIdRow = await client.query(`SELECT COALESCE(MAX(admin_id::bigint), 0) + 1 AS next_id FROM admins`);
    const nextAdminId = Number(nextAdminIdRow.rows[0].next_id || 1);
    const admin = await client.query(`INSERT INTO admins (admin_id, email_id, password) VALUES ($1, $2, $3) RETURNING admin_id`, [nextAdminId, adminEmail, adminPassword]);
    const regularA = await client.query(`
      INSERT INTO students (name, email_id, contact_number, dob, course, background_type, college_id, student_type, status, bde_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'REGULAR', 'ACTIVE', NULL)
      RETURNING student_id
    `, [`Smoke Regular A ${stamp}`, regularAEmail, '9876501010', '2000-01-15', 'BTech', 'TECH', Number(colleges.rows[0].college_id)]);
    const regularB = await client.query(`
      INSERT INTO students (name, email_id, contact_number, dob, course, background_type, college_id, student_type, status, bde_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'REGULAR', 'ACTIVE', NULL)
      RETURNING student_id
    `, [`Smoke Regular B ${stamp}`, regularBEmail, '9876502020', '2000-02-15', 'BCom', 'NON_TECH', Number(colleges.rows[1].college_id)]);
    await client.query(`INSERT INTO student_credentials (student_id, password) VALUES ($1, $2)`, [Number(regularA.rows[0].student_id), regularAPassword]);
    await client.query(`INSERT INTO student_credentials (student_id, password) VALUES ($1, $2)`, [Number(regularB.rows[0].student_id), regularBPassword]);
    const insertedTechQuestionIds = [];
    for (let i = 1; i <= 30; i += 1) {
      const techResult = await client.query(
        `INSERT INTO regular_technical_questions
         (question_text, option_a, option_b, option_c, option_d, correct_answer, background_type, section_name, question_type, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 'TECH', 'TECHNICAL_ADVANCED', 'MCQ', TRUE)
         RETURNING question_id`,
        [`Smoke TECH question ${stamp}-${i}`, 'A', 'B', 'C', 'D', 'A']
      );
      insertedTechQuestionIds.push(Number(techResult.rows[0].question_id));

      const nonTechResult = await client.query(
        `INSERT INTO regular_technical_questions
         (question_text, option_a, option_b, option_c, option_d, correct_answer, background_type, section_name, question_type, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 'NON_TECH', 'TECHNICAL_BASIC', 'MCQ', TRUE)
         RETURNING question_id`,
        [`Smoke NON_TECH question ${stamp}-${i}`, 'A', 'B', 'C', 'D', 'A']
      );
      insertedTechQuestionIds.push(Number(nonTechResult.rows[0].question_id));
    }

    const state = {
      admin: { adminId: Number(admin.rows[0].admin_id), email: adminEmail, password: adminPassword },
      regularA: { studentId: Number(regularA.rows[0].student_id), email: regularAEmail, password: regularAPassword, collegeId: String(colleges.rows[0].college_id) },
      regularB: { studentId: Number(regularB.rows[0].student_id), email: regularBEmail, password: regularBPassword, collegeId: String(colleges.rows[1].college_id) },
      seededTechnicalQuestionIds: insertedTechQuestionIds,
      cleanup: { examId: null }
    };
    fs.writeFileSync(path.resolve(process.cwd(), "smoke-regular-state.json"), JSON.stringify(state, null, 2));
    console.log(JSON.stringify(state));
  } finally {
    await client.end();
  }
})().catch((error) => { console.error(error?.stack || error?.message || error); process.exit(1); });
'@

  $state = Invoke-NodeJson -Code $setupCode -WorkingDirectory (Join-Path $PWD "Backend")

  $base = "http://127.0.0.1:5000"
  Write-Host "[regular-smoke] admin login"
  $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $adminLogin = Invoke-RestMethod -Uri "$base/admin/login" -Method Post -WebSession $adminSession -ContentType "application/json" -Body (@{ email = $state.admin.email; password = $state.admin.password } | ConvertTo-Json) -TimeoutSec 30
  if (-not $adminLogin.success) { throw "Admin login failed" }

  Write-Host "[regular-smoke] scheduling exam"
  $nowIst = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date).AddMinutes(-9), "India Standard Time")
  $schedule = Invoke-RestMethod -Uri "$base/admin/exam" -Method Post -WebSession $adminSession -ContentType "application/json" -Body (@{ collegeId = $state.regularA.collegeId; startDate = $nowIst.ToString("yyyy-MM-dd"); startTime = $nowIst.ToString("HH:mm") } | ConvertTo-Json) -TimeoutSec 30
  if (-not $schedule.success) { throw "Schedule failed" }

  $state.cleanup.examId = [int]$schedule.examId
  $state | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PWD "Backend\\smoke-regular-state.json")

  Write-Host "[regular-smoke] verifying admin exam list"
  $adminExams = Invoke-RestMethod -Uri "$base/admin/exams" -Method Get -WebSession $adminSession -TimeoutSec 30
  $scheduledExam = $adminExams | Where-Object { $_.exam_id -eq $schedule.examId } | Select-Object -First 1
  if (-not $scheduledExam) { throw "Scheduled exam missing in admin list" }
  if ("$($scheduledExam.college_id)" -ne "$($state.regularA.collegeId)") { throw "Scheduled exam college mismatch" }

  Write-Host "[regular-smoke] regular student login"
  $regSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $regLogin = Invoke-RestMethod -Uri "$base/student/login" -Method Post -WebSession $regSession -ContentType "application/json" -Body (@{ email = $state.regularA.email; password = $state.regularA.password } | ConvertTo-Json) -TimeoutSec 30
  if (-not $regLogin.success) { throw "Regular A login failed" }

  Write-Host "[regular-smoke] checking regular student visibility"
  $regExams = Invoke-RestMethod -Uri "$base/student/exams/$($regLogin.studentId)" -Method Get -WebSession $regSession -TimeoutSec 30
  if (-not ($regExams | Where-Object { $_.exam_id -eq $schedule.examId })) { throw "Matching college student cannot see scheduled exam" }

  Write-Host "[regular-smoke] starting regular exam"
  $regStart = Invoke-RestMethod -Uri "$base/exam/regular/start" -Method Post -WebSession $regSession -ContentType "application/json" -Body (@{ studentId = $regLogin.studentId; examId = $schedule.examId } | ConvertTo-Json) -TimeoutSec 30
  if (-not $regStart.success) { throw "Regular start failed" }

  Write-Host "[regular-smoke] waiting for question unlock"
  Start-Sleep -Seconds 65

  Write-Host "[regular-smoke] fetching regular questions"
  $regQuestions = Invoke-RestMethod -Uri "$base/exam/regular/questions/$($schedule.examId)" -Method Get -WebSession $regSession -TimeoutSec 30
  if (-not $regQuestions -or $regQuestions.Count -le 0) { throw "Regular questions missing" }

  Write-Host "[regular-smoke] comparison student login"
  $otherSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $otherLogin = Invoke-RestMethod -Uri "$base/student/login" -Method Post -WebSession $otherSession -ContentType "application/json" -Body (@{ email = $state.regularB.email; password = $state.regularB.password } | ConvertTo-Json) -TimeoutSec 30
  if (-not $otherLogin.success) { throw "Regular B login failed" }

  Write-Host "[regular-smoke] checking other student isolation"
  $otherExams = Invoke-RestMethod -Uri "$base/student/exams/$($otherLogin.studentId)" -Method Get -WebSession $otherSession -TimeoutSec 30
  if ($otherExams | Where-Object { $_.exam_id -eq $schedule.examId }) { throw "Scheduled exam leaked to student from other college" }

  [pscustomobject]@{
    success = $true
    regular_exam_id = [int]$schedule.examId
    regular_question_count = [int]$regQuestions.Count
  } | ConvertTo-Json -Depth 5
}
finally {
  try {
    $cleanupCode = @'
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const { Client } = require("pg");
(async () => {
  const statePath = path.resolve(process.cwd(), "smoke-regular-state.json");
  if (!fs.existsSync(statePath)) return;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const client = new Client({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT), user: process.env.PG_USER, password: process.env.PG_PASSWORD, database: process.env.PG_DATABASE, ssl: false });
  await client.connect();
  try {
    const examId = Number(state?.cleanup?.examId || 0) || null;
    const studentIds = [state?.regularA?.studentId, state?.regularB?.studentId].map((v) => Number(v || 0)).filter((v) => v > 0);
    const adminId = Number(state?.admin?.adminId || 0) || null;
    if (examId) {
      await client.query("DELETE FROM regular_exam_feedback WHERE exam_id = $1", [examId]);
      await client.query("DELETE FROM regular_student_answers WHERE exam_id = $1", [examId]);
      await client.query("DELETE FROM regular_student_exam WHERE exam_id = $1", [examId]);
      await client.query("DELETE FROM regular_student_results WHERE exam_id = $1", [examId]);
      await client.query("DELETE FROM regular_exam_questions WHERE exam_id = $1", [examId]);
      await client.query("DELETE FROM regular_question_sets WHERE exam_id = $1", [examId]);
      await client.query("DELETE FROM regular_exams WHERE exam_id = $1", [examId]);
    }
    for (const studentId of studentIds) {
      await client.query("DELETE FROM regular_exam_feedback WHERE student_id = $1", [studentId]);
      await client.query("DELETE FROM regular_student_answers WHERE student_id = $1", [studentId]);
      await client.query("DELETE FROM regular_student_results WHERE student_id = $1", [studentId]);
      await client.query("DELETE FROM regular_student_exam WHERE student_id = $1", [studentId]);
      await client.query("DELETE FROM student_credentials WHERE student_id = $1", [studentId]);
      await client.query("DELETE FROM students WHERE student_id = $1", [studentId]);
    }
    if (adminId) {
      await client.query("DELETE FROM admins WHERE admin_id = $1", [adminId]);
    }
    const seededTechnicalQuestionIds = Array.isArray(state?.seededTechnicalQuestionIds)
      ? state.seededTechnicalQuestionIds.map((value) => Number(value || 0)).filter((value) => value > 0)
      : [];
    if (seededTechnicalQuestionIds.length > 0) {
      await client.query("DELETE FROM regular_technical_questions WHERE question_id = ANY($1::bigint[])", [seededTechnicalQuestionIds]);
    }
  } finally {
    await client.end();
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
})().catch((error) => { console.error(error?.stack || error?.message || error); process.exit(1); });
'@
    $null = Invoke-NodeJson -Code $cleanupCode -WorkingDirectory (Join-Path $PWD "Backend")
  } catch {}

  try {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  } catch {}
}
