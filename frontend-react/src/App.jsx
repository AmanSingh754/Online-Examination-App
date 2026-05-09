import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

const Home = lazy(() => import("./pages/Home.jsx"));
const AdminLogin = lazy(() => import("./pages/AdminLogin.jsx"));
const StudentLogin = lazy(() => import("./pages/StudentLogin.jsx"));
const Register = lazy(() => import("./pages/Register.jsx"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.jsx"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard.jsx"));

const Exam = lazy(() => import("./pages/Exam.jsx"));
const Result = lazy(() => import("./pages/Result.jsx"));

function App() {
  return (
    <Suspense fallback={<div className="app-route-loading">Loading...</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<Navigate to="/admin/login" replace />} />

        <Route path="/student" element={<Navigate to="/student/login" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />

        <Route path="/student/login" element={<StudentLogin />} />
        <Route path="/register" element={<Register />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />

        <Route path="/student/dashboard" element={<StudentDashboard />} />
        <Route path="/exam" element={<Exam />} />
        <Route path="/result" element={<Result />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
