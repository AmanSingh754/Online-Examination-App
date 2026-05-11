# 🎓 RP2 – Scholarship Examination Portal (Backend)

The Node.js/Express backend for the Scholarship Examination Portal. This service manages students, exams, question generation, and result processing.

## 🚀 Features
- **Admin Module**: Exam event lifecycle management, course mapping, and bulk student uploads.
- **Student Module**: Secure login, eligible exam listing, and single-attempt enforcement.
- **Walk-in Workflow**: Self-registration with a `PENDING` -> `ACTIVE` approval state.
- **Question Engine**: Support for Aptitude, Technical (multiple streams), and Coding questions.
- **Post-Submission**: Automated result calculation and report generation.

## 🗂️ Project Structure
```text
Backend/
├── server.js          # Main entry point
├── db.js              # Database connection (PostgreSQL)
├── routes/
│   ├── admin.routes.js   # Admin dashboard and control logic
│   ├── student.routes.js # Student authentication and dashboard
│   └── exam.routes.js    # Exam attempt and submission logic
└── package.json
```

## 🧠 System Logic
- **Course-based Allocation**: Exams are mapped to courses (DS, MERN, DA, etc.).
- **Approval Workflow**: Walk-in students must be approved by an admin to transition from `PENDING` to `ACTIVE` status.
- **Duplicate Prevention**: Strict checks on `student_id` and `exam_id` to prevent multiple submissions.

## 🛠️ Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **AI**: GPT-4 (for grading and summaries)

## 🌐 API Overview
- `/admin/*`: Restricted to administrative tasks.
- `/student/*`: Student profile and dashboard access.
- `/exam/*`: Real-time examination session and submission.

## ▶️ Setup
1. Ensure PostgreSQL is running.
2. Configure `Backend/.env` with your credentials.
3. Run `npm install`.
4. Start with `node server.js`.
