function adminLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }

  fetch("/admin/login", {   // ✅ FIXED HERE
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })
    .then(res => res.json())
    .then(data => {
      if (!data.success) {
        alert("Invalid admin credentials");
        return;
      }

      localStorage.setItem("adminId", data.adminId);
      localStorage.setItem("collegeId", data.collegeId);
      localStorage.setItem("collegeName", data.collegeName || "");

      window.location.href = "/admin/dashboard";
    })
    .catch(err => {
      console.error("Admin login error:", err);
      alert("Server error");
    });
}

