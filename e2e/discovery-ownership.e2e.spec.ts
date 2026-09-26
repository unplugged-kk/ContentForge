import { test, expect } from "@playwright/test";
import { Client } from "pg";
import fs from "fs";
import path from "path";

/**
 * Phase 33.7 — discovery_settings ownership.
 *
 * Before this phase `discovery_settings` was a global singleton with no owner
 * column: every authenticated user read and overwrote the same row (id 1), so
 * owner B could read and clobber owner A's custom keywords. The fix adds
 * `user_id` (NOT NULL) + a unique one-row-per-owner index, scopes the storage
 * read/write by the authenticated owner, and backfills the existing singleton
 * row via a migration that fails closed unless there is exactly one user.
 *
 * This spec proves:
 *   • cross-owner read is blocked;
 *   • cross-owner overwrite is blocked;
 *   • a spoofed `userId`/`id` in the request body cannot re-attribute the row;
 *   • anonymous GET/PUT is rejected with 401;
 *   • the migration attributes the singleton row when there is exactly one user;
 *   • the migration ABORTS (no data loss) when there are multiple users.
 *
 * The HTTP layer uses global `fetch` with per-owner cookies taken from each
 * registration response. (Playwright's `request.newContext()` instances created
 * inside one worker collapse to a single cookie jar here — both contexts ended
 * up logged in as the second registrant — so an explicit cookie per owner is
 * the only way to exercise two truly distinct identities.)
 *
 * The migration tests run against an isolated throwaway schema on the same
 * database the server uses, so they never touch the shared public tables.
 */

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "4173"}`;
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ETestPass99!";

test.describe.configure({ mode: "serial" });

// ── HTTP helpers ──────────────────────────────────────────────────────────────
type Owner = { cookie: string; csrf: string };

function cookieHeader(res: Response): string {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [
    res.headers.get("set-cookie") ?? "",
  ];
  return raw
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function registerOwner(tag: string): Promise<Owner> {
  const email = `dsc_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e2e.local`;
  const reg = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, name: `DSC ${tag}` }),
  });
  expect(reg.ok, `${BASE_URL} register ${tag} -> ${reg.status} ${await reg.text()}`).toBeTruthy();
  const cookie = cookieHeader(reg);
  const tok = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie } });
  expect(tok.ok).toBeTruthy();
  const { csrfToken } = await tok.json();
  return { cookie, csrf: csrfToken };
}

const getSettings = (o: Owner) => fetch(`${BASE_URL}/api/discover/settings`, { headers: { cookie: o.cookie } });
const putSettings = (o: Owner, data: Record<string, unknown>) =>
  fetch(`${BASE_URL}/api/discover/settings`, {
    method: "PUT",
    headers: { cookie: o.cookie, "content-type": "application/json", "X-CSRF-Token": o.csrf },
    body: JSON.stringify(data),
  });

let A: Owner;
let B: Owner;

test.beforeAll(async () => {
  A = await registerOwner("A");
  B = await registerOwner("B");
});

test("cross-owner read and overwrite of discovery keywords are both blocked", async () => {
  const KW_A = `owner_a_${Date.now()}`;
  const KW_B = `owner_b_${Date.now()}`;

  // A writes private keywords.
  const aWrite = await putSettings(A, { customKeywords: [KW_A] });
  expect(aWrite.status).toBe(200);
  const aRow = await aWrite.json();
  expect(aRow.customKeywords).toEqual([KW_A]);

  // B reads its own settings — A's keywords must NOT be visible.
  const bRead = await getSettings(B);
  expect(bRead.status).toBe(200);
  const bRow = await bRead.json();
  expect(bRow.customKeywords ?? []).not.toContain(KW_A);
  expect(bRow.id).not.toBe(aRow.id); // distinct rows, not the shared singleton

  // B writes its own keywords — A's row must be untouched.
  const bWrite = await putSettings(B, { customKeywords: [KW_B] });
  expect(bWrite.status).toBe(200);

  const aAgain = await (await getSettings(A)).json();
  expect(aAgain.customKeywords).toEqual([KW_A]);
  expect(aAgain.id).toBe(aRow.id);
});

test("a spoofed userId/id in the body cannot re-attribute the settings row", async () => {
  const aBefore = await (await getSettings(A)).json();
  const bRow = await (await getSettings(B)).json();

  // Owner A tries to hand its row to owner B by supplying userId/id in the body.
  const spoof = await putSettings(A, {
    customKeywords: ["spoof_attempt"],
    userId: bRow.userId,
    id: bRow.id,
  });
  expect(spoof.status).toBe(200);
  const spoofed = await spoof.json();

  expect(spoofed.userId).toBe(aBefore.userId); // still A
  expect(spoofed.id).toBe(aBefore.id); // same row, not B's
});

test("anonymous GET and PUT /api/discover/settings return 401", async () => {
  const get = await fetch(`${BASE_URL}/api/discover/settings`);
  expect(get.status).toBe(401);

  const put = await fetch(`${BASE_URL}/api/discover/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customKeywords: ["x"] }),
  });
  expect(put.status).toBe(401);
});

// ── Migration fail-closed behaviour (isolated schema) ─────────────────────────
const MIGRATION_FILE = path.resolve("migrations/0031_discovery_settings_ownership.sql");
const TMP_SCHEMA = "cf337_discovery_mig";

function migrationStatements(): string[] {
  return fs
    .readFileSync(MIGRATION_FILE, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

test.describe("0031 migration fail-closed guard", () => {
  let client: Client;

  test.beforeAll(async () => {
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set — skipping migration DB tests");
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  test.afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS ${TMP_SCHEMA} CASCADE`).catch(() => {});
      await client.end();
    }
  });

  /** Build the pre-migration (ownerless singleton) shape in a throwaway schema. */
  async function seedPreMigration(userCount: number) {
    await client.query(`DROP SCHEMA IF EXISTS ${TMP_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${TMP_SCHEMA}`);
    await client.query(`SET search_path TO ${TMP_SCHEMA}`);
    await client.query(`CREATE TABLE users (id serial PRIMARY KEY, email varchar(255), name varchar(200))`);
    await client.query(
      `CREATE TABLE discovery_settings (
         id serial PRIMARY KEY,
         auto_refresh_frequency varchar(20) DEFAULT 'daily',
         custom_keywords text[] DEFAULT '{}'::text[],
         monitored_x_accounts text[] DEFAULT '{}'::text[],
         enabled_sources jsonb,
         min_viral_score decimal(3,1) DEFAULT '5.0',
         updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL)`,
    );
    for (let i = 0; i < userCount; i++) {
      await client.query(`INSERT INTO users (email, name) VALUES ($1, $2)`, [`u${i}@e2e.local`, `U${i}`]);
    }
    await client.query(`INSERT INTO discovery_settings (custom_keywords) VALUES (ARRAY['keep_me'])`);
  }

  /** Apply the migration exactly like drizzle does: one transaction per run. */
  async function runMigration() {
    await client.query("BEGIN");
    try {
      for (const stmt of migrationStatements()) await client.query(stmt);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  async function hasUserIdColumn(): Promise<boolean> {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'discovery_settings' AND column_name = 'user_id'`,
      [TMP_SCHEMA],
    );
    return r.rows[0].n === 1;
  }

  test("Scenario A — exactly one user: migration succeeds and attributes the singleton row", async () => {
    await seedPreMigration(1);
    const userId = (await client.query(`SELECT id FROM users LIMIT 1`)).rows[0].id;

    await expect(runMigration()).resolves.toBeUndefined();

    expect(await hasUserIdColumn()).toBe(true);
    const row = (await client.query(`SELECT user_id, custom_keywords FROM discovery_settings`)).rows[0];
    expect(row.user_id).toBe(userId);
    expect(row.custom_keywords).toEqual(["keep_me"]);
  });

  test("Scenario B — multiple users: migration aborts and loses no data", async () => {
    await seedPreMigration(2);

    await expect(runMigration()).rejects.toThrow(/aborted|expected exactly one user/i);

    // Fail closed: transaction rolled back — no column, row and users intact.
    expect(await hasUserIdColumn()).toBe(false);
    const rows = (await client.query(`SELECT custom_keywords FROM discovery_settings`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].custom_keywords).toEqual(["keep_me"]);
    const users = (await client.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n;
    expect(users).toBe(2);
  });
});
