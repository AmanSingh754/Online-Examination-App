const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
process.env.TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const MySQLSessionStore = require("./mysqlSessionStore");
const db = require("./db");


const studentRoutes = require("./routes/student.routes");
const examRoutes = require("./routes/exam.routes");
const regularExamRoutes = require("./routes/regularExam.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();
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
if (trustProxy > 0) {
    app.set("trust proxy", trustProxy);
}

const sessionStore = new MySQLSessionStore({
    host: process.env.PG_HOST || process.env.DB_HOST || "localhost",
    port: Number(process.env.PG_PORT || process.env.DB_PORT || 5432),
    user: process.env.PG_USER || process.env.DB_USER,
    password: process.env.PG_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.PG_DATABASE || process.env.DB_NAME,
    tableName: process.env.SESSION_TABLE_NAME || "user_sessions",
    ttlMs: sessionTtlMs,
    cleanupMs: Number(process.env.SESSION_CLEANUP_MS || 1000 * 60 * 15),
    ssl: String(process.env.PG_SSL || "").toLowerCase() === "true"
        ? { rejectUnauthorized: String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true" }
        : undefined
});
app.locals.sessionStore = sessionStore;

const reactDist = path.join(__dirname, "../frontend-react/dist");
const legacyFrontend = path.join(__dirname, "../Frontend");
const hasReactBuild = fs.existsSync(reactDist);

app.use(express.json());
const sessionMiddleware = session({
    store: sessionStore,
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
    if (req.path === "/healthz") {
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

if (hasReactBuild) {
    app.use(express.static(reactDist));
    app.use(express.static(legacyFrontend));
} else {
    app.use(express.static(legacyFrontend));
}

const sendIndex = (res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    if (hasReactBuild) {
        return res.sendFile(path.join(reactDist, "index.html"));
    }

    const legacyIndex = path.join(legacyFrontend, "index.html");
    if (fs.existsSync(legacyIndex)) {
        return res.sendFile(legacyIndex);
    }

    res.status(404).send("Missing frontend build");
};

const requireAdminPage = (req, res, next) => {
    if (req.session?.admin) {
        return next();
    }
    return res.redirect("/admin/login");
};

const requireBdePage = (req, res, next) => {
    const role = String(req.session?.admin?.role || "").trim().toUpperCase();
    if (req.session?.admin && role === "BDE") {
        return next();
    }
    return res.redirect("/bde/login");
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

app.get(["/bde", "/bde/"], (req, res) => {
    if (hasReactBuild) {
        return res.redirect("/bde/login");
    }
    return sendIndex(res);
});

app.get(["/bde/login", "/bde/login/"], (req, res) => {
    if (hasReactBuild) {
        return sendIndex(res);
    }
    return sendIndex(res);
});

app.get("/healthz", async (req, res) => {
    const [dbState, sessionState] = await Promise.all([
        db.healthCheck(),
        sessionStore.healthCheck()
    ]);
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

if (hasReactBuild) {
    app.get("/admin/dashboard", requireAdminPage, (req, res) => {
        sendIndex(res);
    });

    app.get("/bde/dashboard", requireBdePage, (req, res) => {
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
app.use("/exam/regular", regularExamRoutes);
app.use("/exam", examRoutes);
app.use("/admin", adminRoutes);

if (hasReactBuild) {
    app.get(/^\/(admin|student|bde)(\/.*)?$/, (req, res, next) => {
        if (
            req.path.startsWith("/admin/exams") ||
            req.path.startsWith("/admin/walkin") ||
            req.path.startsWith("/admin/bde") ||
            req.path.startsWith("/admin/bdes") ||
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
});

const closeSessionStore = async () => {
    if (sessionStore && typeof sessionStore.close === "function") {
        try {
            await sessionStore.close();
        } catch (error) {
            console.warn("Session store close warning:", String(error?.message || error));
        }
    }
};
process.on("SIGINT", async () => {
    await closeSessionStore();
    server.close(() => process.exit(0));
});
process.on("SIGTERM", async () => {
    await closeSessionStore();
    server.close(() => process.exit(0));
});
