"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_BASE_URL = process.env.BACKEND_BASE_URL || "http://localhost:5000";

const assertOk = (condition, message) => {
    if (!condition) {
        const error = new Error(message);
        error.statusCode = 400;
        throw error;
    }
};

const parseJsonSafe = async (response) => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

class SessionClient {
    constructor(baseUrl = DEFAULT_BASE_URL) {
        this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.cookieHeader = "";
    }

    async request(pathname, options = {}) {
        const target = new URL(`${this.baseUrl}${pathname}`);
        const transport = target.protocol === "https:" ? https : http;
        const headers = { ...(options.headers || {}) };
        if (this.cookieHeader) headers.Cookie = this.cookieHeader;

        return new Promise((resolve, reject) => {
            const req = transport.request(
                target,
                {
                    method: options.method || "GET",
                    headers
                },
                (res) => {
                    const chunks = [];
                    res.on("data", (chunk) => chunks.push(chunk));
                    res.on("end", async () => {
                        const raw = Buffer.concat(chunks).toString("utf8");
                        const setCookie = res.headers["set-cookie"];
                        if (Array.isArray(setCookie) && setCookie.length > 0) {
                            this.cookieHeader = setCookie.map((entry) => String(entry).split(";")[0]).join("; ");
                        }

                        const body = raw
                            ? (() => {
                                try {
                                    return JSON.parse(raw);
                                } catch {
                                    return raw;
                                }
                            })()
                            : null;

                        resolve({
                            response: {
                                ok: Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300,
                                status: Number(res.statusCode || 0),
                                headers: res.headers
                            },
                            body
                        });
                    });
                }
            );

            req.on("error", reject);
            if (options.body) req.write(options.body);
            req.end();
        });
    }

    async json(pathname, { method = "GET", body, headers } = {}) {
        const finalHeaders = { ...(headers || {}) };
        let payload = body;
        if (body && typeof body === "object" && !(body instanceof Buffer)) {
            finalHeaders["Content-Type"] = "application/json";
            payload = JSON.stringify(body);
        }
        return this.request(pathname, {
            method,
            headers: finalHeaders,
            body: payload
        });
    }
}

const toIstParts = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        date: `${map.year}-${map.month}-${map.day}`,
        time: `${map.hour}:${map.minute}`
    };
};

const getRequiredEnv = (name) => {
    const value = String(process.env[name] || "").trim();
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
};

const getOptionalEnv = (name) => String(process.env[name] || "").trim();

module.exports = {
    DEFAULT_BASE_URL,
    SessionClient,
    assertOk,
    getRequiredEnv,
    getOptionalEnv,
    toIstParts
};
