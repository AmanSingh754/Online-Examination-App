🎓 RP2 – Scholarship Examination Portal

A full-stack Scholarship Examination Portal designed to manage online exams for colleges.
The system provides separate workflows for Admins and Students, ensuring secure exam creation, allocation, and submission based on academic courses.

🚀 Features
👨‍💼 Admin Module
Secure admin login
Create and manage exam events
Activate / deactivate events
Create exams mapped to courses (BCA, MCA, BTech, etc.)
Generate questions automatically
Manage exam lifecycle (Draft → Ready)

👨‍🎓 Student Module

Secure student login
View available exams based on course
Attempt exams only once
Submit answers online
View attempted exam history

🧠 System Logic
Course-based exam allocation (replaced old class-based logic)
Prevents duplicate exam attempts
Clean separation of Admin, Student, and Exam APIs
Robust database relationships using MySQL

🗂️ Project Structure
RP2-Examination-Portal/
│
├── Backend/
│   ├── server.js
│   ├── db.js
│   ├── Generator.js
│   ├── routes/
│   │   ├── admin.routes.js
│   │   ├── student.routes.js
│   │   └── exam.routes.js
│   └── package.json
│
├── Frontend/
│   ├── admin-login.html
│   ├── admin-dashboard.html
│   ├── student-login.html
│   ├── student-dashboard.html
│   ├── result.html
│   ├── css/
│   └── js/
│
├── .gitignore
└── README.md

🔄 Application Workflow
Admin logs in
Admin creates exam events
Admin activates events
Admin creates exams mapped to courses
Admin generates questions
Student logs in
Student sees only eligible exams (course-based)
Student attempts and submits exam
System records attempt and prevents re-attempt

🌐 Important URLs
Admin
/admin – Admin login
/admin/dashboard – Admin dashboard
/admin/events/:collegeId – Fetch events
/admin/exam – Create exam

Student
/student/login – Student login API
/student/dashboard – Student dashboard
/student/exams/:studentId – Available exams
/student/attempted-exams/:studentId – Exam history

Exam

/exam/questions/:examId – Fetch questions
/exam/submit – Submit exam

🛠️ Tech Stack
Frontend: HTML, CSS, JavaScript
Backend: Node.js, Express.js
Database: MySQL
Version Control: Git & GitHub
LLM - gpt 5.0 

▶️ How to Run Locally
# Backend
cd Backend
npm install
node server.js
Make sure MySQL is running and .env is configured.


👤 Author
Aman Kumar Singh
📧 amank@idatalytics.com
🔗 GitHub: https://github.com/AmanSinghidl

⭐ Notes
Designed following real-world backend practices
Clean Git history and modular routing
Suitable for college exams, scholarship tests, and assessments
