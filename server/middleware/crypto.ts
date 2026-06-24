import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * AES-256-GCM encryption for secrets at rest (e.g. xQuick API tokens, social
 * account access tokens stored in connected_accounts.accessToken).
 *
 * Format on disk: `enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`
 *
 * Key derivation: ENCRYPTION_KEY env (base64, 32 bytes). If absent, falls back
 * to scrypt(SESSION_SECRET, "contentforge.crypto.v1", 32) so dev environments
 * without an explicit key still work but production should always set one.
 */

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1";
const IV_LEN = 12; // GCM standard
const KEY_LEN = 32;
const SCRYPT_SALT = "contentforge.crypto.v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== KEY_LEN) {
      throw new Error(
        `ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${buf.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    cachedKey = buf;
    return buf;
  }

  const fallback = process.env.SESSION_SECRET;
  if (!fallback) {
    throw new Error("ENCRYPTION_KEY or SESSION_SECRET must be set to encrypt secrets at rest");
  }
  cachedKey = scryptSync(fallback, SCRYPT_SALT, KEY_LEN);
  return cachedKey;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("encryptSecret requires a string input");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) {
    // Backward-compat: plaintext (legacy) — return as-is. Callers should call
    // isEncrypted() first when they need to migrate without breaking reads.
    return stored;
  }
  const parts = stored.split(":");
  if (parts.length !== 5) {
    throw new Error("Malformed encrypted secret");
  }
  const [, , ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  if (iv.length !== IV_LEN || authTag.length !== 16) {
    throw new Error("Invalid encrypted secret IV or authTag length");
  }
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Encrypt a value if it is not already encrypted. Useful for storage upserts
 * that may receive either plaintext (legacy rows) or already-encrypted values
 * (after a backfill).
 */
export function ensureEncrypted(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  if (isEncrypted(value)) return value;
  return encryptSecret(value);
}
