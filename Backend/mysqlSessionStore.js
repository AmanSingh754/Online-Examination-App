const session = require("express-session");
const { Pool } = require("pg");

class MySQLSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        this.ttlMs = Number(options.ttlMs || 1000 * 60 * 60 * 8);
        this.tableName = String(options.tableName || "user_sessions");
        this.cleanupMs = Number(options.cleanupMs || 1000 * 60 * 15);
        this.pool = new Pool({
            host: options.host || process.env.PG_HOST || "localhost",
            port: Number(options.port || process.env.PG_PORT || 5432),
            user: options.user || process.env.PG_USER || "postgres",
            password: options.password || process.env.PG_PASSWORD || "",
            database: options.database || process.env.PG_DATABASE || "postgres",
            ssl: options.ssl || undefined,
            max: Number(options.max || 10),
            idleTimeoutMillis: Number(options.idleTimeoutMillis || 30000)
        });
        this.ready = this.ensureTable();
        this.cleanupTimer = setInterval(() => {
            this.clearExpired().catch(() => {});
        }, this.cleanupMs);
        if (typeof this.cleanupTimer.unref === "function") {
            this.cleanupTimer.unref();
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
        await this.pool.query(sql);
        await this.pool.query(
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
                const { rows } = await this.pool.query(
                    `SELECT data, expires FROM ${this.tableName} WHERE session_id = $1 LIMIT 1`,
                    [sid]
                );
                if (!rows || rows.length === 0) {
                    return callback(null, null);
                }

                const row = rows[0];
                const expires = Number(row.expires || 0);
                if (expires <= Date.now()) {
                    await this.pool.query(
                        `DELETE FROM ${this.tableName} WHERE session_id = $1`,
                        [sid]
                    );
                    return callback(null, null);
                }

                try {
                    const parsed = JSON.parse(String(row.data || "{}"));
                    return callback(null, parsed);
                } catch (error) {
                    await this.pool.query(
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
                this.pool.query(
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
                this.pool.query(
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
                this.pool.query(
                    `DELETE FROM ${this.tableName} WHERE session_id = $1`,
                    [sid]
                )
            )
            .then(() => callback && callback(null))
            .catch((error) => callback && callback(error));
    }

    clear(callback) {
        this.ready
            .then(() => this.pool.query(`DELETE FROM ${this.tableName}`))
            .then(() => callback && callback(null))
            .catch((error) => callback && callback(error));
    }

    async clearExpired() {
        await this.ready;
        await this.pool.query(
            `DELETE FROM ${this.tableName} WHERE expires <= $1`,
            [Date.now()]
        );
    }

    close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        return this.pool.end();
    }
}

module.exports = MySQLSessionStore;
