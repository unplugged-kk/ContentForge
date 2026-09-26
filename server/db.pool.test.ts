/**
 * Phase 33.7 — PostgreSQL pool error-handling regression tests.
 *
 * Defect (observed live): `server/db.ts` registered no `'error'` listener on the
 * pg pool, so a Postgres `57P01` ("terminating connection due to administrator
 * command") on an *idle* client surfaced as `Unhandled 'error' event on
 * BoundPool` and killed the whole server process.
 *
 * These tests pin three things:
 *   1. a recoverable pool error no longer terminates the process, and the pool
 *      reconnects afterwards (live, against PostgreSQL when reachable);
 *   2. a genuine startup/configuration failure still fails loudly and is not
 *      swallowed by the new listener;
 *   3. the listener never writes credentials to the log.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { Pool } from "pg";

const DEFAULT_DB_URL = "postgresql://e2e@127.0.0.1:5433/contentforge_e2e";
// `server/db.ts` throws at import when DATABASE_URL is unset and reads it at
// module scope, so it must be present *before* the dynamic import below.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = DEFAULT_DB_URL;
const dbUrl: string = process.env.DATABASE_URL;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_MODULE_URL = pathToFileURL(path.join(REPO_ROOT, "server", "db.ts")).href;
const REDACED_DSN = dbUrl.replace(/\/\/[^@/]*@/, "//[redacted]@");

const { pool, classifyPoolError, describePoolError, redactDbCredentials } = await import("./db");

/** Is PostgreSQL reachable? Live tests skip (loudly) when it is not. */
async function probeReachable(): Promise<boolean> {
  const probe = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 2000 });
  probe.on("error", () => {});
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const live = await probeReachable();

function runChild(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run a snippet through tsx in a child process that imports server/db.ts. */
function runDbChild(body: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const code = `import(${JSON.stringify(DB_MODULE_URL)}).then(async ({ pool }) => {\n${body}\n}).catch((e) => { console.error(e); process.exit(9); });`;
  return runChild(["--import", "tsx", "--eval", code]);
}

/** Capture console.error lines emitted while `fn` runs. */
async function captureConsoleError(fn: () => void | Promise<void>): Promise<string[]> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

const recoverableErrors = [
  { code: "57P01", message: "terminating connection due to administrator command" },
  { code: "57P02", message: "crash shutdown of server" },
  { code: "57P03", message: "the database system is shutting down" },
  { code: "08006", message: "connection failure" },
  { code: "08003", message: "connection does not exist" },
  { code: "53300", message: "too many connections" },
  { code: "58030", message: "io error" },
  { code: "ECONNRESET", message: "read ECONNRESET" },
  { code: "EPIPE", message: "write EPIPE" },
  { code: "ETIMEDOUT", message: "connect ETIMEDOUT" },
  { code: undefined, message: "Connection terminated unexpectedly" },
];

const fatalErrors = [
  { code: "28P01", message: 'password authentication failed for user "e2e"' },
  { code: "28000", message: 'role "e2e" does not exist' },
  { code: "3D000", message: 'database "contentforge_e2e" does not exist' },
  { code: "42501", message: "permission denied for schema public" },
];

describe("classifyPoolError (Phase 33.7)", () => {
  for (const { code, message } of recoverableErrors) {
    it(`treats ${code ?? "<no code>"} as recoverable`, () => {
      assert.equal(classifyPoolError(Object.assign(new Error(message), { code })), "recoverable");
    });
  }

  for (const { code, message } of fatalErrors) {
    it(`treats ${code} as fatal (configuration/authorization)`, () => {
      assert.equal(classifyPoolError(Object.assign(new Error(message), { code })), "fatal");
    });
  }
});

describe("credential redaction", () => {
  it("redacts a password embedded in a connection URL", () => {
    const secret = "sup3r-s3cret-pw";
    const out = redactDbCredentials(`connect failed for postgresql://e2e:${secret}@127.0.0.1:5433/contentforge_e2e`);
    assert.ok(!out.includes(secret), out);
    assert.ok(out.includes("[redacted]@127.0.0.1:5433"), out);
  });

  it("redacts password key/value pairs and the configured DSN", () => {
    const secret = "another-secret";
    const dsnWithSecret = `postgresql://e2e:${secret}@127.0.0.1:5433/contentforge_e2e`;
    const out = redactDbCredentials(`password=${secret} for ${dsnWithSecret}`);
    assert.ok(!out.includes(secret), out);
    assert.ok(out.includes("password=[redacted]"), out);
  });

  it("describePoolError never carries credentials", () => {
    const secret = "leaky-password";
    const summary = describePoolError(
      Object.assign(new Error(`auth failed postgresql://e2e:${secret}@127.0.0.1:5433/db`), { code: "28P01" }),
    );
    assert.equal(summary.code, "28P01");
    assert.ok(!JSON.stringify(summary).includes(secret));
  });
});

describe("pool 'error' listener (regression)", () => {
  it("registers an 'error' listener — the exact defect was that none existed", () => {
    assert.ok(
      pool.listenerCount("error") >= 1,
      "server/db.ts must attach an 'error' handler or an idle-client error becomes uncaught",
    );
  });

  it("survives a recoverable idle-connection error instead of rethrowing", async () => {
    const error = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
    });
    const lines = await captureConsoleError(() => {
      assert.doesNotThrow(() => pool.emit("error", error));
    });
    assert.ok(
      lines.some((l) => l.includes("recoverable pool error") && l.includes("57P01")),
      `expected a recoverable log line, got: ${JSON.stringify(lines)}`,
    );
  });

  it("logs without credentials when the driver message embeds them", async () => {
    const secret = "never-print-me";
    const error = Object.assign(
      new Error(`read ECONNRESET for postgresql://e2e:${secret}@127.0.0.1:5433/contentforge_e2e`),
      { code: "ECONNRESET" },
    );
    const lines = await captureConsoleError(() => {
      pool.emit("error", error);
    });
    const joined = lines.join("\n");
    assert.ok(!joined.includes(secret), joined);
    assert.ok(joined.includes("[redacted]@"), joined);
  });
});

describe("reproduction: an unhandled pool 'error' event kills the process", () => {
  it('control — a pg.Pool with no \'error\' listener dies with "Unhandled \'error\' event"', async () => {
    const result = await runChild([
      "--input-type=module",
      "--eval",
      [
        'import { Pool } from "pg";',
        "const pool = new Pool({ connectionString: process.env.DATABASE_URL });",
        'setTimeout(() => pool.emit("error", Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })), 0);',
        'setTimeout(() => console.log("SURVIVED"), 50);',
      ].join("\n"),
    ]);
    assert.notEqual(result.code, 0, "process must die when no 'error' listener is attached");
    assert.match(result.stderr, /Unhandled 'error' event/);
    assert.ok(!result.stdout.includes("SURVIVED"));
  });

  it("fixed — server/db.ts survives the same recoverable error", async () => {
    const result = await runDbChild(
      [
        'setTimeout(() => pool.emit("error", Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })), 0);',
        "await new Promise((r) => setTimeout(r, 50));",
        'console.log("SURVIVED");',
        "await pool.end().catch(() => {});",
      ].join("\n"),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("SURVIVED"));
    assert.ok(!result.stderr.includes("Unhandled 'error' event"));
  });
});

describe("startup / configuration failures stay fatal and visible", () => {
  it("fails loudly at import when DATABASE_URL is missing", async () => {
    // `undefined` values are dropped by child_process, so this removes
    // DATABASE_URL from the child's environment entirely.
    const result = await runChild(
      [
        "--import",
        "tsx",
        "--eval",
        `import(${JSON.stringify(DB_MODULE_URL)}).then(() => console.log("JOINED")).catch((e) => { console.error(e.message); process.exit(7); });`,
      ],
      { DATABASE_URL: undefined },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /DATABASE_URL must be set/);
    assert.ok(!result.stdout.includes("JOINED"));
  });

  it("escalates a configuration error that reaches the pool listener (not swallowed)", async () => {
    const result = await runDbChild(
      [
        'process.on("uncaughtException", (e) => { console.log("ESCALATED:" + e.message); process.exit(0); });',
        'pool.emit("error", Object.assign(new Error(\'password authentication failed for user "e2e"\'), { code: "28P01" }));',
        "await new Promise((r) => setTimeout(r, 100));",
        'console.log("SWALLOWED");',
      ].join("\n"),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes("ESCALATED:"), result.stdout + result.stderr);
    assert.ok(!result.stdout.includes("SWALLOWED"), "a fatal config error must never be silently ignored");
  });
});

describe("live PostgreSQL pool resilience", () => {
  it(
    "survives an admin-terminated idle connection and reconnects",
    {
      skip: live ? false : `PostgreSQL at ${REDACED_DSN} unreachable — live test skipped`,
    },
    async () => {
      // Warm the pool so a real client is idle and holding a backend.
      const { rows } = await pool.query("SELECT pg_backend_pid() AS pid");
      const pid = rows[0].pid as number;

      // Terminate that backend "from another session", exactly as PostgreSQL
      // does for an administrator command (57P01).
      const admin = new Pool({ connectionString: dbUrl });
      admin.on("error", () => {});
      try {
        const sawError = new Promise<Error>((resolve) => pool.once("error", (e) => resolve(e as Error)));
        await admin.query("SELECT pg_terminate_backend($1)", [pid]);
        const error = await Promise.race([
          sawError,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("no pool error observed")), 5000),
          ),
        ]);
        assert.equal((error as Error & { code?: string }).code, "57P01");

        // Process is alive and the pool has reconnected.
        const after = await pool.query("SELECT 1 AS ok");
        assert.equal(after.rows[0].ok, 1);

        // And once more, to prove new connections are usable, not just one.
        const again = await pool.query("SELECT current_user AS who");
        assert.ok(again.rows[0].who);
      } finally {
        await admin.end().catch(() => {});
      }
    },
  );
});

after(async () => {
  await pool.end().catch(() => {});
});
