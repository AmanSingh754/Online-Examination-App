const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "12345",
    database: process.env.DB_NAME || "Project1",
    timezone: process.env.DB_TIMEZONE || "+05:30"
});

db.connect((err) => {
    if (err) {
        console.error("MySQL connection failed:", err);
    } else {
        db.query(
            "SET time_zone = ?",
            [process.env.DB_TIMEZONE || "+05:30"],
            (tzErr) => {
                if (tzErr) {
                    console.warn("Could not set MySQL session timezone:", tzErr?.message || tzErr);
                }
                console.log("MySQL connected successfully");
            }
        );
    }
});

module.exports = db;
