const express = require("express");
const router = express.Router();
const db = require("../db");

/* =================================================
   AUTH
================================================= */

/* STUDENT LOGIN API */
router.post("/login", (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "").trim();

    if (!email || !password) {
        return res.json({ success: false, message: "Missing credentials" });
    }

    const sql = `
        SELECT 
            s.student_id,
            s.name,
            s.email_id,
            s.contact_number,
            s.dob,
            s.course,
            c.college_name
        FROM students s
        JOIN student_credentials sc
            ON s.student_id = sc.student_id
        LEFT JOIN college c
            ON s.college_id = c.college_id
        WHERE LOWER(s.email_id) = LOWER(?) AND sc.password = ?
    `;

    db.query(sql, [email, password], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            if (err) console.error("Student login query error:", err);
            return res.json({ success: false, message: "Invalid credentials" });
        }

        req.session.student = {
            studentId: rows[0].student_id,
            name: rows[0].name,
            email: rows[0].email_id,
            phone: rows[0].contact_number,
            dob: rows[0].dob,
            course: rows[0].course,
            collegeName: rows[0].college_name
        };

        res.json({
            success: true,
            studentId: rows[0].student_id,
            name: rows[0].name,
            email: rows[0].email_id,
            phone: rows[0].contact_number,
            dob: rows[0].dob,
            course: rows[0].course,
            collegeName: rows[0].college_name
        });
    });
});

/* ================= STUDENT REGISTER API ================= */
router.post("/register", (req, res) => {
    const {
        name,
        email,
        phone,
        dob,
        course,
        collegeId,
        password
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanDob = String(dob || "").trim();
    const cleanCourse = String(course || "").trim();
    const cleanCollegeId = String(collegeId || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanName || !cleanEmail || !cleanPhone || !cleanDob || !cleanCourse || !cleanCollegeId || !cleanPassword) {
        return res.json({ success: false, message: "Missing required fields" });
    }

    db.query(
        `SELECT student_id FROM students WHERE email_id = ?`,
        [cleanEmail],
        (err, rows) => {
            if (err) {
                console.error("Register lookup error:", err);
                return res.json({ success: false, message: "Server error" });
            }

            if (rows.length > 0) {
                return res.json({ success: false, message: "Email already registered" });
            }

            db.query(
                `
                INSERT INTO students
                (name, email_id, contact_number, dob, course, college_id)
                VALUES (?, ?, ?, ?, ?, ?)
                `,
                [cleanName, cleanEmail, cleanPhone, cleanDob, cleanCourse, cleanCollegeId],
                (err2, result) => {
                    if (err2) {
                        console.error("Register student error:", err2);
                        return res.json({ success: false, message: "Registration failed" });
                    }

                    const newStudentId = result?.insertId;
                    db.query(
                        `
                        INSERT INTO student_credentials
                        (student_id, password)
                        VALUES (?, ?)
                        `,
                        [newStudentId, cleanPassword],
                        (err3) => {
                            if (err3) {
                                console.error("Register credentials error:", err3);
                                return res.json({ success: false, message: "Registration failed" });
                            }
                            res.json({ success: true, studentId: newStudentId });
                        }
                    );
                }
            );
        }
    );
});

router.get("/colleges", (req, res) => {
    db.query(
        `
        SELECT college_id, college_name
        FROM college
        ORDER BY college_name
        `,
        (err, rows) => {
            if (err) {
                console.error("College list error:", err);
                return res.json([]);
            }
            res.json(Array.isArray(rows) ? rows : []);
        }
    );
});

/* =================================================
   AVAILABLE EXAMS (UPDATED FOR DATE RANGE)
================================================= */

router.get("/exams/:studentId", (req, res) => {
    const sql = `
        SELECT 
            e.exam_id,
            ev.exam_name,
            ev.exam_start_date,
            ev.exam_end_date,
            ev.start_time,
            ev.end_time,
            e.course
        FROM students s
        JOIN exams e ON e.course = s.course
        JOIN exam_event ev ON ev.event_id = e.event_id
        LEFT JOIN student_event_attempts sea
            ON sea.student_id = s.student_id
            AND sea.event_id = e.event_id
        LEFT JOIN student_event_overrides seo
            ON seo.student_id = s.student_id
            AND seo.event_id = e.event_id
            AND seo.is_allowed = TRUE
        WHERE s.student_id = ?
          AND e.exam_status = 'READY'
          AND ev.is_active = 'YES'
          AND (ev.is_deleted = 'NO' OR ev.is_deleted IS NULL)
          AND CURDATE() BETWEEN ev.exam_start_date AND ev.exam_end_date
          AND NOT EXISTS (
              SELECT 1
              FROM results r
              WHERE r.student_id = s.student_id
                AND r.exam_id = e.exam_id
          )
          AND (sea.student_event_attempt_id IS NULL OR seo.student_event_override_id IS NOT NULL)
        ORDER BY ev.exam_start_date
    `;

    db.query(sql, [req.params.studentId], (err, rows) => {
        if (err) {
            console.error("Available exams error:", err);
            return res.json([]);
        }
        res.json(rows || []);
    });
});

/* ================= LOGOUT ================= */
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }
    req.session.destroy(() => res.json({ success: true }));
});

/* =================================================
   AUTH MIDDLEWARE
================================================= */

const STUDENT_AUTH_WHITELIST = ["/login", "/register"];

router.use((req, res, next) => {
    if (req.method === "OPTIONS" || STUDENT_AUTH_WHITELIST.includes(req.path)) {
        return next();
    }

    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    next();
});

router.param("studentId", (req, res, next, studentId) => {
    if (!req.session?.student) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (String(studentId) !== String(req.session.student.studentId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
});

/* =================================================
   ATTEMPTED EXAMS (UPDATED)
================================================= */

router.get("/attempted-exams/:studentId", (req, res) => {
    const sql = `
        SELECT 
            e.exam_id,
            ev.exam_name,
            ev.exam_start_date,
            ev.exam_end_date,
            e.course,
            r.attempt_status
        FROM results r
        JOIN exams e ON e.exam_id = r.exam_id
        JOIN exam_event ev ON ev.event_id = e.event_id
        WHERE r.student_id = ?
        ORDER BY ev.exam_start_date DESC
    `;

    db.query(sql, [req.params.studentId], (err, rows) => {
        if (err) {
            console.error("Attempted exams error:", err);
            return res.json([]);
        }
        res.json(rows || []);
    });
});

module.exports = router;
