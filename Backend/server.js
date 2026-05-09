const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
process.env.TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const express = require("express");
const session = require("express-session");
const fs = require("fs");

const db = require("./db");


const studentRoutes = require("./routes/student.routes");
const examRoutes = require("./routes/exam.routes");

const adminRoutes = require("./routes/admin.routes");

const app = express();
app.disable("x-powered-by");
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const sessionSecret = String(process.env.SESSION_SECRET || "").trim();
if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required. Set a strong random secret in Backend/.env");
}
const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const rawSessionCookieSecure = String(process.env.SESSION_COOKIE_SECURE || "").trim().toLowerCase();
const hasSessionCookieSecureOverride =
    rawSessionCookieSecure === "true" ||
    rawSessionCookieSecure === "false" ||
    rawSessionCookieSecure === "auto";
const sessionCookieSecure = hasSessionCookieSecureOverride
    ? (rawSessionCookieSecure === "auto" ? "auto" : rawSessionCookieSecure === "true")
    : isProduction;
const rawSessionCookieSameSite = String(process.env.SESSION_COOKIE_SAME_SITE || "lax").trim().toLowerCase();
const allowedSameSite = new Set(["lax", "strict", "none"]);
const sessionCookieSameSite = allowedSameSite.has(rawSessionCookieSameSite)
    ? rawSessionCookieSameSite
    : "lax";
const rawSessionCookieHttpOnly = String(process.env.SESSION_COOKIE_HTTP_ONLY || "true").trim().toLowerCase();
const sessionCookieHttpOnly = rawSessionCookieHttpOnly !== "false";
const sessionCookieDomain = String(process.env.SESSION_COOKIE_DOMAIN || "").trim() || undefined;
const sessionCookiePath = String(process.env.SESSION_COOKIE_PATH || "/").trim() || "/";
const trustProxy = Number(process.env.TRUST_PROXY || (isProduction ? 1 : 0));
if (isProduction && sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production.");
}
if (trustProxy > 0) {
    app.set("trust proxy", trustProxy);
}

// Session store removed for Vercel

const reactDist = path.join(__dirname, "../frontend-react/dist");
const hasReactBuild = fs.existsSync(reactDist) && fs.existsSync(path.join(reactDist, "index.html"));
const startupState = {
    startedAt: new Date().toISOString(),
    ready: false,
    completedAt: null,
    lastError: ""
};

const createRateLimiter = ({
    windowMs,
    max,
    keyBuilder,
    skip
}) => {
    const buckets = new Map();
    const prune = () => {
        const now = Date.now();
        for (const [key, bucket] of buckets.entries()) {
            if (bucket.resetAt <= now) buckets.delete(key);
        }
    };
    const timer = setInterval(prune, Math.max(1000, Math.min(windowMs, 60000)));
    if (typeof timer.unref === "function") timer.unref();

    return (req, res, next) => {
        if (typeof skip === "function" && skip(req)) return next();
        const key =
            (typeof keyBuilder === "function" ? keyBuilder(req) : "") ||
            req.ip ||
            "anonymous";
        const now = Date.now();
        const existing = buckets.get(key);
        if (!existing || existing.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        existing.count += 1;
        if (existing.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
            res.set("Retry-After", String(retryAfterSeconds));
            return res.status(429).json({
                success: false,
                message: "Too many requests. Please retry shortly."
            });
        }
        return next();
    };
};

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use((req, res, next) => {
    const requestId = String(
        req.headers["x-request-id"] ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    );
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (isProduction) {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
});
const sessionMiddleware = session({
    name: process.env.SESSION_COOKIE_NAME || "exam.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: trustProxy > 0,
    cookie: {
        httpOnly: sessionCookieHttpOnly,
        sameSite: sessionCookieSameSite,
        secure: sessionCookieSecure,
        domain: sessionCookieDomain,
        path: sessionCookiePath,
        maxAge: sessionTtlMs
    }
});
const isAuthOrSessionSensitivePath = (urlPath = "") =>
    /^\/(student|exam|admin|bde)(\/|$)/i.test(String(urlPath || ""));
app.use((req, res, next) => {
    if (req.path === "/healthz" || req.path === "/readyz") {
        return next();
    }
    sessionMiddleware(req, res, (error) => {
        if (!error) return next();
        console.error("Session middleware error:", String(error?.message || error));
        if (isAuthOrSessionSensitivePath(req.path)) {
            return res.status(503).json({
                success: false,
                message: "Service temporarily unavailable. Please retry shortly."
            });
        }
        return next(error);
    });
});
app.use(
    createRateLimiter({
        windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
        max: Number(process.env.AUTH_RATE_LIMIT_MAX || 25),
        keyBuilder: (req) => `${req.ip}|${req.path}`,
        skip: (req) => !/^\/(student|admin)\/login$/i.test(req.path)
    })
);
app.use(
    createRateLimiter({
        windowMs: Number(process.env.EXAM_MUTATION_RATE_LIMIT_WINDOW_MS || 60 * 1000),
        max: Number(process.env.EXAM_MUTATION_RATE_LIMIT_MAX || 60),
        keyBuilder: (req) =>
            `${req.ip}|${req.session?.student?.studentId || req.session?.admin?.adminId || "anon"}|${req.path}`,
        skip: (req) =>
            !/^\/exam(\/regular)?\/(submit|feedback|draft\/autosave)$/i.test(req.path)
    })
);

if (hasReactBuild) {
    app.use(express.static(reactDist));
}

const sendIndex = (res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    if (hasReactBuild) {
        return res.sendFile(path.join(reactDist, "index.html"));
    }
    return res.status(404).send("Frontend build not found");
};

const requireAdminPage = (req, res, next) => {
    if (req.session?.admin) {
        return next();
    }
    return res.redirect("/admin/login");
};



const requireStudentPage = (req, res, next) => {
    if (req.session?.student) {
        return next();
    }
    return res.redirect("/student/login");
};

/* âœ… ROOT ROUTE (ADD THIS) */
app.get("/", (req, res) => {
    sendIndex(res);
});

app.get(["/admin", "/admin/"], (req, res) => {
    if (hasReactBuild) {
        return res.redirect("/admin/login");
    }

    const legacyAdminLogin = path.join(legacyFrontend, "admin-login.html");
    if (fs.existsSync(legacyAdminLogin)) {
        return res.sendFile(legacyAdminLogin);
    }

    return sendIndex(res);
});

app.get(["/admin/login", "/admin/login/"], (req, res) => {
    if (hasReactBuild) {
        return sendIndex(res);
    }

    const legacyAdminLogin = path.join(legacyFrontend, "admin-login.html");
    if (fs.existsSync(legacyAdminLogin)) {
        return res.sendFile(legacyAdminLogin);
    }

    return sendIndex(res);
});



app.get("/healthz", async (req, res) => {
    const [dbState] = await Promise.all([
        db.healthCheck()
    ]);
    const sessionState = { ok: true };
    const ok = Boolean(dbState?.ok) && Boolean(sessionState?.ok);
    return res.status(ok ? 200 : 503).json({
        ok,
        service: "exam-portal-backend",
        timestamp: new Date().toISOString(),
        checks: {
            database: dbState,
            sessionStore: sessionState
        }
    });
});

app.get("/readyz", async (req, res) => {
    const [dbState] = await Promise.all([
        db.healthCheck()
    ]);
    const sessionState = { ok: true };
    const ok = startupState.ready && Boolean(dbState?.ok) && Boolean(sessionState?.ok);
    return res.status(ok ? 200 : 503).json({
        ok,
        service: "exam-portal-backend",
        timestamp: new Date().toISOString(),
        startup: startupState,
        checks: {
            database: dbState,
            sessionStore: sessionState
        }
    });
});

if (hasReactBuild) {
    app.get("/admin/dashboard", requireAdminPage, (req, res) => {
        sendIndex(res);
    });



    app.get("/student/dashboard", requireStudentPage, (req, res) => {
        sendIndex(res);
    });

    app.get("/exam.html", (req, res) => {
        res.sendFile(path.join(legacyFrontend, "exam.html"));
    });

    app.get("/result.html", (req, res) => {
        res.sendFile(path.join(legacyFrontend, "result.html"));
    });
}

/* ROUTES */
app.use("/student", studentRoutes);

app.use("/exam", examRoutes);
app.use("/admin", adminRoutes);

const runStartupTasks = async () => {
    try {
        const routeStartupTasks = [
            studentRoutes.startupSchemaSync,
            examRoutes.startupSchemaSync,
            adminRoutes.startupSchemaSync
        ].filter((task) => typeof task === "function");
        for (const task of routeStartupTasks) {
            await task();
        }
        startupState.ready = true;
        startupState.completedAt = new Date().toISOString();
        startupState.lastError = "";
        console.log("Startup checks completed successfully");
    } catch (error) {
        startupState.ready = false;
        startupState.lastError = String(error?.message || error);
        console.error("Startup checks failed:", startupState.lastError);
    }
};

if (hasReactBuild) {
    app.get(/^\/(admin|student|bde)(\/.*)?$/, (req, res, next) => {
        if (
            req.path.startsWith("/admin/exams") ||
            req.path.startsWith("/admin/walkin") ||

            req.path.startsWith("/student/exams") ||
            req.path.startsWith("/student/attempted-exams")
        ) {
            return next();
        }
        sendIndex(res);
    });

    app.get(["/register", "/exam", "/result"], (req, res) => {
        sendIndex(res);
    });
}

const port = Number(process.env.PORT || 5000);
const server = app.listen(port, () => {
    if (hasReactBuild) {
    } else {
        console.log("Serving legacy frontend (React dist not found)");
    }
    console.log(`Server running at http://localhost:${port}`);
    runStartupTasks();
});

app.use((error, req, res, next) => {
    const requestId = String(req?.requestId || "unknown");
    console.error(`Unhandled request error [${requestId}]:`, error?.stack || error?.message || error);
    if (res.headersSent) {
        return next(error);
    }
    return res.status(500).json({
        success: false,
        message: "Internal server error",
        requestId
    });
});

const closeSessionStore = async () => {
    // Session store removed
};
process.on("SIGINT", async () => {
    await closeSessionStore();
    server.close(() => process.exit(0));
});
process.on("SIGTERM", async () => {
    await closeSessionStore();
    server.close(() => process.exit(0));
});

module.exports = app;
