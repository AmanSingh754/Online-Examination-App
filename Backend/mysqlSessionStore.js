const session = require("express-session");
const mysql = require("mysql2/promise");

class MySQLSessionStore extends session.Store {
    constructor(options = {}) {
        super();
        this.ttlMs = Number(options.ttlMs || 1000 * 60 * 60 * 8);
        this.tableName = String(options.tableName || "user_sessions");
        this.cleanupMs = Number(options.cleanupMs || 1000 * 60 * 15);
        this.dbTimezone = String(options.timezone || "+05:30");
        this.pool = mysql.createPool({
            host: options.host || "localhost",
            port: Number(options.port || 3306),
            user: options.user || "root",
            password: options.password || "12345",
            database: options.database || "Project1",
            timezone: this.dbTimezone,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
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
        await this.pool.query("SET time_zone = ?", [this.dbTimezone]);
        const sql = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                session_id VARCHAR(128) NOT NULL PRIMARY KEY,
                expires BIGINT UNSIGNED NOT NULL,
                data MEDIUMTEXT NOT NULL,
                INDEX idx_${this.tableName}_expires (expires)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `;
        await this.pool.query(sql);
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
                const [rows] = await this.pool.query(
                    `SELECT data, expires FROM ${this.tableName} WHERE session_id = ? LIMIT 1`,
                    [sid]
                );
                if (!rows || rows.length === 0) {
                    return callback(null, null);
                }

                const row = rows[0];
                const expires = Number(row.expires || 0);
                if (expires <= Date.now()) {
                    await this.pool.query(
                        `DELETE FROM ${this.tableName} WHERE session_id = ?`,
                        [sid]
                    );
                    return callback(null, null);
                }

                try {
                    const parsed = JSON.parse(String(row.data || "{}"));
                    return callback(null, parsed);
                } catch (error) {
                    await this.pool.query(
                        `DELETE FROM ${this.tableName} WHERE session_id = ?`,
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
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        expires = VALUES(expires),
                        data = VALUES(data)
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
                    `UPDATE ${this.tableName} SET expires = ? WHERE session_id = ?`,
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
                    `DELETE FROM ${this.tableName} WHERE session_id = ?`,
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
            `DELETE FROM ${this.tableName} WHERE expires <= ?`,
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
