import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable, type AnyPgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import {
  OFFBOARD_DELETE_ORDER,
  OFFBOARD_DELETE_PLAN,
  offboardUser,
  type OffboardDb,
  type OffboardTx,
} from "./offboard";

function listAllSchemaTables(): Array<{ exportName: string; table: AnyPgTable }> {
  const seen = new Set<string>();
  const result: Array<{ exportName: string; table: AnyPgTable }> = [];
  for (const [exportName, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (seen.has(config.name)) continue;
    seen.add(config.name);
    result.push({ exportName, table: value });
  }
  return result;
}

describe("per-user offboarding plan and hermetic behavior", () => {
  it("accounts for every user_id-bearing table in shared/schema.ts with no duplicates", () => {
    const uniqueOrder = new Set(OFFBOARD_DELETE_ORDER);
    assert.equal(uniqueOrder.size, OFFBOARD_DELETE_ORDER.length, "no duplicate table names");
    assert.equal(OFFBOARD_DELETE_ORDER[OFFBOARD_DELETE_ORDER.length - 1], "users", "users must be deleted last");

    const allTables = listAllSchemaTables();
    const missing: string[] = [];
    for (const { table } of allTables) {
      const config = getTableConfig(table);
      const hasUserId = config.columns.some((col) => col.name === "user_id");
      if (hasUserId && !uniqueOrder.has(config.name)) {
        missing.push(config.name);
      }
    }
    assert.deepEqual(missing, [], `missing user_id tables from OFFBOARD_DELETE_ORDER: ${missing.join(", ")}`);
  });

  it("orders every foreign-key child strictly before its parent", () => {
    const indexByName = new Map(OFFBOARD_DELETE_ORDER.map((name, idx) => [name, idx]));
    const allTables = listAllSchemaTables();
    const violations: string[] = [];

    for (const { table } of allTables) {
      const config = getTableConfig(table);
      const childIdx = indexByName.get(config.name);
      if (childIdx === undefined) continue;

      for (const fk of config.foreignKeys) {
        const ref = fk.reference();
        const parentName = getTableConfig(ref.foreignTable).name;
        if (parentName === config.name) continue; // self-reference handled separately
        // Explicit mutual cycle broken via pre-delete UPDATE on visual_generations.source_visual_asset_id
        if (config.name === "visual_generations" && parentName === "visual_assets") continue;

        const parentIdx = indexByName.get(parentName);
        if (parentIdx === undefined) {
          violations.push(`${config.name} -> ${parentName} (parent missing from plan)`);
        } else if (childIdx >= parentIdx) {
          violations.push(`${config.name} (${childIdx}) must precede ${parentName} (${parentIdx})`);
        }
      }
    }

    assert.deepEqual(violations, [], `FK order violations:\n${violations.join("\n")}`);
  });

  it("returns found: false and performs zero deletes when the user does not exist", async () => {
    let deleteCalls = 0;
    let updateCalls = 0;

    const fakeDb: OffboardDb = {
      async transaction(fn) {
        const tx: OffboardTx = {
          select: () => ({
            from: () => ({
              where: async () => [],
            }),
          }),
          update: () => ({
            set: () => ({
              where: async () => {
                updateCalls += 1;
              },
            }),
          }),
          delete: () => ({
            where: () => ({
              returning: async () => {
                deleteCalls += 1;
                return [];
              },
            }),
          }),
        };
        return fn(tx);
      },
    };

    const result = await offboardUser(fakeDb, 99999, { dryRun: false });
    assert.deepEqual(result, {
      userId: 99999,
      found: false,
      dryRun: false,
      counts: {},
      totalRows: 0,
    });
    assert.equal(deleteCalls, 0);
    assert.equal(updateCalls, 0);
  });

  it("counts rows in dryRun mode (default) and never calls delete or update", async () => {
    let deleteCalls = 0;
    let updateCalls = 0;

    const fakeDb: OffboardDb = {
      async transaction(fn) {
        const tx: OffboardTx = {
          select: (fields) => ({
            from: (table) => ({
              where: async () => {
                const name = getTableConfig(table).name;
                if ("id" in fields) {
                  if (name === "users") return [{ id: 42 }];
                  if (name === "schedules") return [{ id: 100 }];
                  if (name === "research_jobs") return [{ id: 200 }];
                  return [];
                }
                if (name === "posts") return [{ count: 3 }];
                if (name === "tweets") return [{ count: 5 }];
                if (name === "schedule_occurrences") return [{ count: 2 }];
                if (name === "users") return [{ count: 1 }];
                return [{ count: 0 }];
              },
            }),
          }),
          update: () => ({
            set: () => ({
              where: async () => {
                updateCalls += 1;
              },
            }),
          }),
          delete: () => ({
            where: () => ({
              returning: async () => {
                deleteCalls += 1;
                return [];
              },
            }),
          }),
        };
        return fn(tx);
      },
    };

    const result = await offboardUser(fakeDb, 42);
    assert.equal(result.found, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.counts.posts, 3);
    assert.equal(result.counts.tweets, 5);
    assert.equal(result.counts.schedule_occurrences, 2);
    assert.equal(result.counts.users, 1);
    assert.equal(result.totalRows, 11);
    assert.equal(deleteCalls, 0);
    assert.equal(updateCalls, 0);
  });

  it("deletes in strict OFFBOARD_DELETE_ORDER when dryRun is false", async () => {
    const deletedOrder: string[] = [];
    const updatedTables: string[] = [];

    const fakeDb: OffboardDb = {
      async transaction(fn) {
        const tx: OffboardTx = {
          select: () => ({
            from: (table) => ({
              where: async () => {
                const name = getTableConfig(table).name;
                if (name === "users") return [{ id: 7 }];
                if (name === "schedules") return [{ id: 10 }];
                if (name === "research_jobs") return [{ id: 20 }];
                return [];
              },
            }),
          }),
          update: (table) => ({
            set: () => ({
              where: async () => {
                updatedTables.push(getTableConfig(table).name);
              },
            }),
          }),
          delete: (table) => ({
            where: () => ({
              returning: async () => {
                const name = getTableConfig(table).name;
                deletedOrder.push(name);
                return name === "users" ? [{ ok: 1 }] : [];
              },
            }),
          }),
        };
        return fn(tx);
      },
    };

    const result = await offboardUser(fakeDb, 7, { dryRun: false });
    assert.equal(result.found, true);
    assert.equal(result.dryRun, false);
    assert.equal(result.counts.users, 1);
    assert.deepEqual(deletedOrder, OFFBOARD_DELETE_PLAN.map((s) => s.tableName));
    assert.ok(updatedTables.includes("visual_generations"));
    assert.ok(updatedTables.includes("style_profiles"));
  });
});
