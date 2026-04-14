import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

function Result() {
  const navigate = useNavigate();

  useEffect(() => {
    const studentId = localStorage.getItem("studentId");
    if (!studentId) {
      navigate("/student/login", { replace: true });
      return;
    }
    navigate("/student/dashboard", { replace: true });
  }, [navigate]);

  return null;
}

export default Result;
