const session = require("express-session");
const { Pool } = require("pg");

class MySQLSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        this.ttlMs = Number(options.ttlMs || 1000 * 60 * 60 * 8);
        this.tableName = String(options.tableName || "user_sessions");
        this.cleanupMs = Number(options.cleanupMs || 1000 * 60 * 15);
        this.retryOnConnReset = String(options.retryOnConnReset ?? process.env.PG_RETRY_ON_CONN_RESET ?? "true").toLowerCase() !== "false";
        this.connectionTimeoutMs = Number(options.connectionTimeoutMillis || process.env.PG_CONNECT_TIMEOUT_MS || 5000);
        this.queryTimeoutMs = Number(options.queryTimeoutMillis || process.env.PG_QUERY_TIMEOUT_MS || 30000);
        this.keepAliveDelayMs = Number(options.keepAliveInitialDelayMillis || process.env.PG_KEEPALIVE_INITIAL_DELAY_MS || 10000);
        this.lastErrorMessage = "";
        this.lastHealthyAt = 0;
        this.pool = new Pool({
            host: options.host || process.env.PG_HOST || "localhost",
            port: Number(options.port || process.env.PG_PORT || 5432),
            user: options.user || process.env.PG_USER || "postgres",
            password: options.password || process.env.PG_PASSWORD || "",
            database: options.database || process.env.PG_DATABASE || "postgres",
            ssl: options.ssl || undefined,
            max: Number(options.max || 10),
            idleTimeoutMillis: Number(options.idleTimeoutMillis || 30000),
            connectionTimeoutMillis: this.connectionTimeoutMs,
            query_timeout: this.queryTimeoutMs,
            keepAlive: true,
            keepAliveInitialDelayMillis: this.keepAliveDelayMs
        });
        this.pool.on("error", (err) => {
            this.lastErrorMessage = String(err?.message || err || "Unknown pool error");
            if (this.isConnectionResetLikeError(err)) {
                console.warn("Session store PostgreSQL idle connection reset (pool will reconnect):", err?.message || err);
                return;
            }
            console.error("Session store PostgreSQL pool error:", err?.message || err);
        });
        this.ready = this.ensureTable();
        this.ready.catch((error) => {
            this.lastErrorMessage = String(error?.message || error || "Initialization failed");
            console.error("Session store initialization failed:", error?.message || error);
        });
        this.cleanupTimer = setInterval(() => {
            this.clearExpired().catch(() => {});
        }, this.cleanupMs);
        if (typeof this.cleanupTimer.unref === "function") {
            this.cleanupTimer.unref();
        }
    }

    isConnectionResetLikeError(error) {
        const code = String(error?.code || "").toUpperCase();
        const message = String(error?.message || "");
        if (code === "ECONNRESET" || code === "EPIPE") return true;
        if (["08000", "08003", "08006", "57P01", "57P02", "57P03"].includes(code)) return true;
        return /econnreset|connection terminated unexpectedly|socket hang up|terminating connection/i.test(message);
    }

    async runQuery(sql, params = [], attempt = 0) {
        try {
            const result = await this.pool.query(sql, params);
            this.lastErrorMessage = "";
            this.lastHealthyAt = Date.now();
            return result;
        } catch (error) {
            this.lastErrorMessage = String(error?.message || error || "Query failed");
            const shouldRetry =
                this.retryOnConnReset &&
                attempt === 0 &&
                this.isConnectionResetLikeError(error);
            if (!shouldRetry) throw error;
            await new Promise((resolve) => setTimeout(resolve, 80));
            return this.runQuery(sql, params, attempt + 1);
        }
    }

    async ensureTable() {
        const sql = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                session_id VARCHAR(128) NOT NULL PRIMARY KEY,
                expires BIGINT NOT NULL,
                data TEXT NOT NULL
            )
        `;
        await this.runQuery(sql);
        await this.runQuery(
            `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires ON ${this.tableName} (expires)`
        );
    }

    computeExpires(sessionData) {
        const explicitExpiry = sessionData?.cookie?.expires
            ? new Date(sessionData.cookie.expires).getTime()
            : 0;
        const now = Date.now();
        if (Number.isFinite(explicitExpiry) && explicitExpiry > now) {
            return explicitExpiry;
        }
        return now + this.ttlMs;
    }

    get(sid, callback) {
        this.ready
            .then(async () => {
                const { rows } = await this.runQuery(
                    `SELECT data, expires FROM ${this.tableName} WHERE session_id = $1 LIMIT 1`,
                    [sid]
                );
                if (!rows || rows.length === 0) {
                    return callback(null, null);
                }

                const row = rows[0];
                const expires = Number(row.expires || 0);
                if (expires <= Date.now()) {
                    await this.runQuery(
                        `DELETE FROM ${this.tableName} WHERE session_id = $1`,
                        [sid]
                    );
                    return callback(null, null);
                }

                try {
                    const parsed = JSON.parse(String(row.data || "{}"));
                    return callback(null, parsed);
                } catch (error) {
                    await this.runQuery(
                        `DELETE FROM ${this.tableName} WHERE session_id = $1`,
                        [sid]
                    );
                    return callback(error);
                }
            })
            .catch((error) => callback(error));
    }

    set(sid, sessionData, callback) {
        const expires = this.computeExpires(sessionData);
        const payload = JSON.stringify(sessionData || {});

        this.ready
            .then(() =>
                this.runQuery(
                    `
                    INSERT INTO ${this.tableName} (session_id, expires, data)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (session_id) DO UPDATE
                    SET expires = EXCLUDED.expires,
                        data = EXCLUDED.data
                    `,
                    [sid, expires, payload]
                )
            )
            .then(() => callback && callback(null))
            .catch((error) => callback && callback(error));
    }

    touch(sid, sessionData, callback) {
        const expires = this.computeExpires(sessionData);
        this.ready
            .then(() =>
                this.runQuery(
                    `UPDATE ${this.tableName} SET expires = $1 WHERE session_id = $2`,
                    [expires, sid]
                )
            )
            .then(() => callback && callback(null))
            .catch((error) => callback && callback(error));
    }

    destroy(sid, callback) {
        this.ready
            .then(() =>
                this.runQuery(
                    `DELETE FROM ${this.tableName} WHERE session_id = $1`,
                    [sid]
                )
            )
            .then(() => callback && callback(null))
            .catch((error) => callback && callback(error));
    }

    clear(callback) {
        this.ready
            .then(() => this.runQuery(`DELETE FROM ${this.tableName}`))
            .then(() => callback && callback(null))
            .catch((error) => callback && callback(error));
    }

    async clearExpired() {
        await this.ready;
        await this.runQuery(
            `DELETE FROM ${this.tableName} WHERE expires <= $1`,
            [Date.now()]
        );
    }

    async healthCheck() {
        try {
            await this.ready;
            await this.runQuery("SELECT 1");
            return { ok: true, lastHealthyAt: this.lastHealthyAt || Date.now() };
        } catch (error) {
            return {
                ok: false,
                error: String(error?.message || this.lastErrorMessage || "Session store unavailable"),
                lastHealthyAt: this.lastHealthyAt || null
            };
        }
    }

    close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        return this.pool.end();
    }
}

module.exports = MySQLSessionStore;
