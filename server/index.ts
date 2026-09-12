import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool, db } from "./db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { existsSync } from "fs";
import { securityHeaders } from "./middleware/security";
import { globalLimiter } from "./middleware/rateLimit";
import { auditLog } from "./middleware/audit";
import { issueCsrfToken, verifyCsrf } from "./middleware/csrf";
import { errorHandler } from "./middleware/errorHandler";
import { sessionUser } from "./middleware/userContext";

const app = express();
const httpServer = createServer(app);

// Trust Railway's reverse proxy so req.secure and cookies work correctly
app.set("trust proxy", 1);

// Security headers must be FIRST so they are set on every response, including
// error responses and before any other middleware short-circuits.
app.use(securityHeaders);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Global rate limit applies only to /api/* (see rateLimit.skip). Placed early
// so abusive clients are dropped before they can hit expensive handlers.
app.use(globalLimiter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Create session table manually (connect-pg-simple's table.sql is lost after esbuild).
  // The PRIMARY KEY on sid is REQUIRED — connect-pg-simple uses INSERT ... ON CONFLICT (sid)
  // to upsert sessions. Without it, session saves fail silently and cookies never persist.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
  `);

  // If table already existed without the primary key (from a prior buggy deploy), add it.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
      ) THEN
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
      END IF;
    END$$;
  `);

  const PgStore = connectPg(session);
  app.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: false }),
      secret: process.env.SESSION_SECRET || "contentforge-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        // Allow http://localhost E2E against production build (SESSION_COOKIE_SECURE=0)
        secure:
          process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "0",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Run drizzle migrations automatically on every startup.
  // Migration files live in ./migrations/ (committed to repo, copied to dist/migrations/ by build).
  // drizzle tracks applied migrations in __drizzle_migrations — only new ones run.
  const migrationsFolder = path.join(__dirname, "migrations");
  if (!existsSync(migrationsFolder)) {
    throw new Error(`Missing migrations folder at startup: ${migrationsFolder}`);
  }
  await migrate(db, { migrationsFolder });
  log("database migrations applied", "db");

  const { seedDatabase } = await import("./seed");
  await seedDatabase().catch((err) => console.error("Seed error:", err));

  // Durable job runtime. Registers built-in providers + job types, then starts
  // workers. pg-boss only — no Redis, no BullMQ.
  const { startJobRuntime, stopJobRuntime } = await import("./jobs/bootstrap");
  await startJobRuntime();
  log("job runtime started", "jobs");

  // Audit log + CSRF token endpoint + CSRF verification are applied AFTER
  // session middleware (so they can read req.session) but BEFORE routes are
  // registered, so all routes in registerRoutes inherit the protection.
  app.use(auditLog);
  app.use(sessionUser);
  app.get("/api/csrf-token", (req, res) => issueCsrfToken(req, res));
  app.use(verifyCsrf);

  await registerRoutes(httpServer, app);

  // Research API. Enqueues work onto the job runtime; never runs research inline.
  const { createDefaultResearchRouter } = await import("./research/routes");
  app.use("/api/research", await createDefaultResearchRouter());

  // Story API. `ResearchJob → Story` is a cheap read of durable research: it
  // never enqueues and never re-runs research.
  const { createDefaultStoryRouter } = await import("./story/routes");
  app.use("/api/stories", await createDefaultStoryRouter());

  // Core content lifecycle API: Opportunity → GenerationJob → Artifact →
  // (approval) → Schedule → Publication → Result. Persists intent and enqueues
  // generation/publication; never runs them inline.
  const { createDefaultContentRouter } = await import("./content/routes");
  app.use("/api", await createDefaultContentRouter());

  const { startSchedulers } = await import("./scheduler");
  startSchedulers();

  // Startup validation for X_THREAD_FINISHER
  const finisher = process.env.X_THREAD_FINISHER?.trim();
  if (finisher && finisher.length > 275) {
    console.warn(`[x] X_THREAD_FINISHER is ${finisher.length} chars (max 275). It will be truncated at publish time.`);
  }

  // Standardized error handler: logs full error server-side, returns
  // sanitized message to client. Replaces the prior inline handler so stack
  // traces and internal details never leak on 5xx paths.
  app.use(errorHandler);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Graceful shutdown: stop accepting connections, let in-flight jobs finish
  // (pg-boss graceful stop), then exit.
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down`, "server");
    try {
      await stopJobRuntime();
    } catch (err) {
      console.error("Failed to stop job runtime:", err);
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
