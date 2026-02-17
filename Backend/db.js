const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

// const mysql = require("mysql2");
//
// const db = mysql.createConnection({
//     host: process.env.DB_HOST || "localhost",
//     port: Number(process.env.DB_PORT || 3306),
//     user: process.env.DB_USER || "root",
//     password: process.env.DB_PASSWORD || "12345",
//     database: process.env.DB_NAME || "Project1",
//     timezone: process.env.DB_TIMEZONE || "+05:30"
// });
//
// db.connect((err) => {
//     if (err) {
//         console.error("MySQL connection failed:", err);
//     } else {
//         db.query(
//             "SET time_zone = ?",
//             [process.env.DB_TIMEZONE || "+05:30"],
//             (tzErr) => {
//                 if (tzErr) {
//                     console.warn("Could not set MySQL session timezone:", tzErr?.message || tzErr);
//                 }
//                 console.log("MySQL connected successfully");
//             }
//         );
//     }
// });
//
// module.exports = db;

const { Pool } = require("pg");

const pgHost = String(process.env.PG_HOST || process.env.DB_HOST || "localhost").trim();
const pgPort = Number(process.env.PG_PORT || process.env.DB_PORT || 5432);
const pgUser = String(process.env.PG_USER || process.env.DB_USER || "").trim();
const pgPassword = String(process.env.PG_PASSWORD || process.env.DB_PASSWORD || "").trim();
const pgDatabase = String(process.env.PG_DATABASE || process.env.DB_NAME || "").trim();
const isLocalPgHost = ["localhost", "127.0.0.1", "::1"].includes(pgHost);
const usePgSsl =
    String(process.env.PG_SSL || "").toLowerCase() === "true" ||
    (!process.env.PG_SSL && !isLocalPgHost);
const rejectUnauthorized =
    String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true";

if (!pgUser || !pgPassword || !pgDatabase) {
    console.error("PostgreSQL env configuration is incomplete. Set PG_USER, PG_PASSWORD, and PG_DATABASE in Backend/.env");
}

const pool = new Pool({
    host: pgHost,
    port: pgPort,
    user: pgUser,
    password: pgPassword,
    database: pgDatabase,
    ssl: usePgSsl ? { rejectUnauthorized } : false,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)
});

const convertMysqlPlaceholdersToPg = (sql) => {
    let idx = 0;
    return String(sql).replace(/\?/g, () => `$${++idx}`);
};

const normalizePgResult = (result) => {
    const command = String(result?.command || "").toUpperCase();
    if (command === "SELECT") {
        return result?.rows || [];
    }

    const packet = {
        affectedRows: Number(result?.rowCount || 0),
        insertId: 0,
        rowCount: Number(result?.rowCount || 0),
        rows: result?.rows || []
    };

    if (command === "INSERT" && Array.isArray(packet.rows) && packet.rows.length > 0) {
        const first = packet.rows[0] || {};
        const preferredIdKey =
            Object.keys(first).find((key) => /(^id$|_id$)/i.test(key)) ||
            Object.keys(first)[0];
        const parsed = Number(first[preferredIdKey]);
        if (Number.isFinite(parsed) && parsed > 0) {
            packet.insertId = parsed;
        }
    }

    return packet;
};

const db = {
    query(sql, values, callback) {
        let params = values;
        let cb = callback;

        if (typeof values === "function") {
            cb = values;
            params = [];
        }
        if (!Array.isArray(params)) {
            params = [];
        }

        const pgSql = convertMysqlPlaceholdersToPg(sql);
        const queryPromise = pool.query(pgSql, params).then((result) => [normalizePgResult(result), []]);

        if (typeof cb === "function") {
            queryPromise
                .then(([rows, fields]) => cb(null, rows, fields))
                .catch((err) => cb(err));
            return;
        }

        return queryPromise;
    }
};

pool
    .query("SELECT NOW() AS connected_at")
    .then(() => {
        console.log("PostgreSQL connected successfully");
    })
    .catch((err) => {
        console.error("PostgreSQL connection failed:", err);
    });

module.exports = db;
