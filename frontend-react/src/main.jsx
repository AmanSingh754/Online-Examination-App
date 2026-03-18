import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/common.css";
import "./styles/dashboard-base.css";
import "./styles/admin-dashboard.css";
import "./styles/student-dashboard.css";
import "./styles/bde-dashboard.css";
import "./styles/exam.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
