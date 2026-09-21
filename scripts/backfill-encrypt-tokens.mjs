// scripts/backfill-encrypt-tokens.mjs
// One-shot: re-encrypt every plaintext access_token / refresh_token in
// connected_accounts. Idempotent — already-encrypted rows (enc:v1:...) are
// skipped via isEncrypted().
//
// Usage:
//   DATABASE_URL=postgres://... \
//   ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
//   node scripts/backfill-encrypt-tokens.mjs
//
// Safe to run multiple times. Reads in batches of 100 to avoid loading
// every row at once on large tables. The crypto helpers are duplicated
// from server/middleware/crypto.ts so this script runs as plain node (.mjs)
// without tsx; keep them in sync if the on-disk format ever changes.

import "dotenv/config";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY && !process.env.SESSION_SECRET) {
  console.error("ENCRYPTION_KEY or SESSION_SECRET must be set (see .env.example)");
  process.exit(1);
}

// ── Inline crypto (mirror server/middleware/crypto.ts) ────────────────────
const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1";
const IV_LEN = 12;
const KEY_LEN = 32;
const SCRYPT_SALT = "contentforge.crypto.v1";

function getKey() {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== KEY_LEN) {
      throw new Error(`ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${buf.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
    }
    return buf;
  }
  return scryptSync(process.env.SESSION_SECRET, SCRYPT_SALT, KEY_LEN);
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

function encryptSecret(plaintext) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

// ── Main ──────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BATCH = 100;
let scanned = 0;
let encrypted = 0;
let skipped = 0;
let failed = 0;

async function main() {
  const client = await pool.connect();
  try {
    let lastId = 0;
    while (true) {
      const { rows } = await client.query(
        `SELECT id, access_token, refresh_token
         FROM connected_accounts
         WHERE id > $1
         ORDER BY id ASC
         LIMIT $2`,
        [lastId, BATCH],
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        scanned++;
        lastId = row.id;
        const updates = {};
        if (row.access_token && !isEncrypted(row.access_token)) {
          try {
            updates.access_token = encryptSecret(row.access_token);
          } catch (err) {
            failed++;
            console.error(`[fail] id=${row.id} access_token: ${err.message}`);
            continue;
          }
        } else if (row.access_token && isEncrypted(row.access_token)) {
          skipped++;
        }
        if (row.refresh_token && !isEncrypted(row.refresh_token)) {
          try {
            updates.refresh_token = encryptSecret(row.refresh_token);
          } catch (err) {
            failed++;
            console.error(`[fail] id=${row.id} refresh_token: ${err.message}`);
            continue;
          }
        } else if (row.refresh_token && isEncrypted(row.refresh_token)) {
          skipped++;
        }
        if (Object.keys(updates).length > 0) {
          const cols = Object.keys(updates);
          const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
          const values = cols.map((c) => updates[c]);
          await client.query(
            `UPDATE connected_accounts SET ${sets} WHERE id = $1`,
            [row.id, ...values],
          );
          encrypted++;
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`scanned=${scanned} encrypted=${encrypted} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
