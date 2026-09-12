/**
 * DB-backed tests for the migration chain.
 *
 * Verifies the acceptance requirement: a completely fresh PostgreSQL database
 * reaches the current schema through the project's migration mechanism, and a
 * database that already has the historical migrations applied upgrades cleanly.
 * Requires TEST_DATABASE_URL (skipped otherwise).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;
const RUN = `mig${Date.now().toString(36)}`;
const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "migrations");

const FRESH_DB = `cf_mig_fresh_${RUN}`;
const EXISTING_DB = `cf_mig_existing_${RUN}`;

interface JournalEntry {
  tag: string;
  when: number;
}

function readJournal(): JournalEntry[] {
  const raw = fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function databaseUrl(dbName: string): string {
  const url = new URL(CONNECTION!);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function applySqlFile(pool: pg.Pool, fileName: string): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATIONS_FOLDER, fileName), "utf8");
  for (const chunk of sql.split("--> statement-breakpoint")) {
    const statement = chunk.trim();
    if (statement) await pool.query(statement);
  }
}

async function publicTables(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  return result.rows.map((row) => row.tablename);
}

async function migrationCount(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ c: number }>(
    "select count(*)::int c from drizzle.__drizzle_migrations",
  );
  return result.rows[0].c;
}

async function createDatabase(admin: pg.Pool, name: string): Promise<void> {
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}"`);
}

async function dropDatabase(admin: pg.Pool, name: string): Promise<void> {
  await admin.query(`drop database if exists "${name}"`);
}

describeDb("migration chain (db)", () => {
  let admin: pg.Pool;

  before(async () => {
    admin = new pg.Pool({ connectionString: CONNECTION! });
  });

  after(async () => {
    if (!CONNECTION) return;
    await dropDatabase(admin, FRESH_DB).catch(() => {});
    await dropDatabase(admin, EXISTING_DB).catch(() => {});
    await admin.end();
  });

  it("bootstraps a completely fresh database from zero", async () => {
    await createDatabase(admin, FRESH_DB);
    const pool = new pg.Pool({ connectionString: databaseUrl(FRESH_DB) });
    try {
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

      const tables = await publicTables(pool);
      assert.equal(tables.length, 42, `expected 42 tables, got ${tables.length}`);
      assert.equal(await migrationCount(pool), 12, "all twelve migrations recorded");

      for (const table of [
        "research_jobs",
        "research_sources",
        "research_evidence",
        "stories",
        "opportunities",
        "generation_jobs",
        "artifacts",
        "schedules",
        "schedule_occurrences",
        "publications",
        "results",
        "voices",
        "content_templates",
        "generation_policies",
        "rss_sources",
      ]) {
        assert.ok(tables.includes(table), `missing ${table}`);
      }

      // Story provenance is FK-protected: research cannot be deleted out from
      // under a Story (0006 adds the FK, not just the column).
      const storyFk = await pool.query<{ conname: string }>(
        `select conname from pg_constraint
          where conrelid = 'stories'::regclass and contype = 'f'`,
      );
      assert.equal(storyFk.rows.length, 1, "stories.research_job_id has one FK");

      // Artifact content immutability is enforced by the database, not just by
      // convention (0007 trigger).
      const trigger = await pool.query<{ tgname: string }>(
        `select tgname from pg_trigger
          where tgrelid = 'artifacts'::regclass and not tgisinternal`,
      );
      assert.deepEqual(
        trigger.rows.map((r) => r.tgname),
        ["artifacts_no_content_mutation"],
      );

      // 0003's duplicate DDL targeted tables 0002 created, so a successful fresh
      // run proves the guards no longer collide; the replayed columns must exist.
      const rssColumns = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'rss_sources'
            and column_name in ('autopost','autopost_platform','user_id')
          order by column_name`,
      );
      assert.deepEqual(
        rssColumns.rows.map((row) => row.column_name),
        ["autopost", "autopost_platform", "user_id"],
      );
    } finally {
      await pool.end();
    }
  });

  it("upgrades a database that already applied the historical migrations", async () => {
    await createDatabase(admin, EXISTING_DB);
    const pool = new pg.Pool({ connectionString: databaseUrl(EXISTING_DB) });
    try {
      // Simulate the pre-existing state: 0000-0002 applied and recorded.
      await pool.query("create schema if not exists drizzle");
      await pool.query(
        "create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)",
      );
      await applySqlFile(pool, "0000_init.sql");
      await applySqlFile(pool, "0001_shallow_captain_cross.sql");
      await applySqlFile(pool, "0002_brand_rss_youtube.sql");

      const journal = readJournal();
      for (const tag of ["0000_init", "0001_shallow_captain_cross", "0002_brand_rss_youtube"]) {
        const entry = journal.find((item) => item.tag === tag);
        assert.ok(entry, `journal entry ${tag} missing`);
        await pool.query(
          "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
          [`legacy-${tag}`, entry!.when],
        );
      }
      assert.equal(await migrationCount(pool), 3, "three migrations recorded before upgrade");

      // The forward migration must apply 0003-0011 without a db:push.
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

      const tables = await publicTables(pool);
      assert.equal(tables.length, 42, `expected 42 tables after upgrade, got ${tables.length}`);
      assert.equal(await migrationCount(pool), 12, "0003-0011 recorded after upgrade");
      assert.ok(tables.includes("audit_logs"), "0003 table created on the upgrade path");
      assert.ok(tables.includes("research_jobs"), "0005 table created on the upgrade path");
      assert.ok(tables.includes("stories"), "0006 table created on the upgrade path");
      assert.ok(tables.includes("artifacts"), "0007 table created on the upgrade path");

      // The upgraded schema must match a freshly bootstrapped one.
      const freshPool = new pg.Pool({ connectionString: databaseUrl(FRESH_DB) });
      try {
        assert.deepEqual(tables, await publicTables(freshPool));
      } finally {
        await freshPool.end();
      }
    } finally {
      await pool.end();
    }
  });
});
