const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });


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
const pgConnectTimeoutMs = Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000);
const pgQueryTimeoutMs = Number(process.env.PG_QUERY_TIMEOUT_MS || 30000);
const pgKeepAliveDelayMs = Number(process.env.PG_KEEPALIVE_INITIAL_DELAY_MS || 10000);
const pgRetryOnConnReset =
    String(process.env.PG_RETRY_ON_CONN_RESET || "true").toLowerCase() !== "false";

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
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: pgConnectTimeoutMs,
    query_timeout: pgQueryTimeoutMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: pgKeepAliveDelayMs
});

const withConnectionHint = (error) => {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "");
    const isTimeout =
        code === "ETIMEDOUT" ||
        /connection timeout|connect etimedout|connection terminated due to connection timeout/i.test(message);
    if (!isTimeout) {
        return error;
    }

    const hinted = new Error(
        `connect ETIMEDOUT ${pgHost}:${pgPort}. Verify PG_HOST/PG_PORT, PostgreSQL firewall rules, and network reachability.`
    );
    return Object.assign(hinted, error, { code: "ETIMEDOUT" });
};

const isConnectionResetLikeError = (error) => {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "");
    if (code === "ECONNRESET" || code === "EPIPE") return true;
    if (["08000", "08003", "08006", "57P01", "57P02", "57P03"].includes(code)) return true;
    return /econnreset|connection terminated unexpectedly|socket hang up|terminating connection/i.test(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const convertMysqlPlaceholdersToPg = (sql) => {
    const source = String(sql);
    let idx = 0;
    let result = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        const next = source[i + 1];

        if (inLineComment) {
            result += char;
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            result += char;
            if (char === "*" && next === "/") {
                result += next;
                i += 1;
                inBlockComment = false;
            }
            continue;
        }

        if (inSingleQuote) {
            result += char;
            if (char === "'" && next === "'") {
                result += next;
                i += 1;
                continue;
            }
            if (char === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            result += char;
            if (char === "\"") {
                inDoubleQuote = false;
            }
            continue;
        }

        if (char === "-" && next === "-") {
            result += char + next;
            i += 1;
            inLineComment = true;
            continue;
        }

        if (char === "/" && next === "*") {
            result += char + next;
            i += 1;
            inBlockComment = true;
            continue;
        }

        if (char === "'") {
            result += char;
            inSingleQuote = true;
            continue;
        }

        if (char === "\"") {
            result += char;
            inDoubleQuote = true;
            continue;
        }

        if (char === "?") {
            idx += 1;
            result += `$${idx}`;
            continue;
        }

        result += char;
    }

    return result;
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
        const execute = async (attempt = 0) => {
            try {
                const result = await pool.query(pgSql, params);
                return [normalizePgResult(result), []];
            } catch (err) {
                const canRetry =
                    pgRetryOnConnReset &&
                    attempt === 0 &&
                    isConnectionResetLikeError(err);
                if (canRetry) {
                    await sleep(80);
                    return execute(attempt + 1);
                }
                throw withConnectionHint(err);
            }
        };
        const queryPromise = execute(0);

        if (typeof cb === "function") {
            queryPromise
                .then(([rows, fields]) => cb(null, rows, fields))
                .catch((err) => cb(err));
            return;
        }

        return queryPromise;
    },

    async withTransaction(work) {
        if (typeof work !== "function") {
            throw new Error("withTransaction requires a callback");
        }

        const client = await pool.connect();
        const txQuery = async (sql, values) => {
            const params = Array.isArray(values) ? values : [];
            const pgSql = convertMysqlPlaceholdersToPg(sql);
            const result = await client.query(pgSql, params);
            return normalizePgResult(result);
        };

        try {
            await client.query("BEGIN");
            const output = await work(txQuery);
            await client.query("COMMIT");
            return output;
        } catch (error) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("PostgreSQL transaction rollback error:", rollbackError?.message || rollbackError);
            }
            throw withConnectionHint(error);
        } finally {
            client.release();
        }
    },

    async healthCheck() {
        try {
            await pool.query("SELECT 1");
            return { ok: true };
        } catch (error) {
            const hinted = withConnectionHint(error);
            return {
                ok: false,
                error: String(hinted?.message || hinted)
            };
        }
    }
};

pool.on("error", (err) => {
    const hinted = withConnectionHint(err);
    if (isConnectionResetLikeError(hinted)) {
        console.warn("PostgreSQL idle connection reset (pool will reconnect):", hinted?.message || hinted);
        return;
    }
    console.error("PostgreSQL pool idle client error:", hinted);
});

pool
    .query("SELECT NOW() AS connected_at")
    .then(() => {
        console.log("PostgreSQL connected successfully");
    })
    .catch((err) => {
        console.error("PostgreSQL connection failed:", withConnectionHint(err));
    });

module.exports = db;
