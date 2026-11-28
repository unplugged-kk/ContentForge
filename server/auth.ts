import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from "crypto";
import { db } from "./db";
import { users, userProfile } from "@shared/schema";
import { eq } from "drizzle-orm";

const SCRYPT_V1_PREFIX = "scrypt:v1:";
const SCRYPT_KEY_LEN = 64;
const MAX_PASSWORD_LEN = 128;
const SCRYPT_V1_OPTIONS: ScryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_LEGACY_OPTIONS: ScryptOptions = { N: 16384, r: 8, p: 1 };

function deriveScrypt(password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = await deriveScrypt(password, salt, SCRYPT_KEY_LEN, SCRYPT_V1_OPTIONS);
  return `${SCRYPT_V1_PREFIX}${buf.toString("hex")}.${salt}`;
}

export async function comparePassword(supplied: string, stored: string): Promise<boolean> {
  if (typeof supplied !== "string" || typeof stored !== "string") return false;
  if (supplied.length > MAX_PASSWORD_LEN) return false;

  const isV1 = stored.startsWith(SCRYPT_V1_PREFIX);
  const payload = isV1 ? stored.slice(SCRYPT_V1_PREFIX.length) : stored;
  const parts = payload.split(".");
  if (parts.length !== 2) return false;

  const [hashed, salt] = parts;
  if (!hashed || !salt || hashed.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hashed)) {
    return false;
  }

  const hashedBuf = Buffer.from(hashed, "hex");
  const options = isV1 ? SCRYPT_V1_OPTIONS : SCRYPT_LEGACY_OPTIONS;
  const suppliedBuf = await deriveScrypt(supplied, salt, SCRYPT_KEY_LEN, options);
  if (hashedBuf.length !== suppliedBuf.length) return false;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export async function getUserById(id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return user;
}

export async function createUser(email: string, password: string, name: string) {
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, name })
    .returning();
  await db.insert(userProfile).values({ userId: user.id });
  return user;
}

/**
 * Legacy direct-Google login, kept during the Auth0 migration. `email` must
 * be null unless Google marked it verified. The google_id match wins; the
 * email is consulted only when no user carries this google_id, so a row
 * matched by id is never swapped for a different row matched by email.
 */
export async function findOrCreateGoogleUser(googleId: string, email: string | null, name: string, avatar: string | null) {
  let existing = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  if (existing.length === 0 && email) {
    existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  }

  if (existing.length > 0) {
    const user = existing[0];
    // Update googleId and avatar if needed
    const updates: any = {};
    if (!user.googleId) updates.googleId = googleId;
    if (!user.avatar && avatar) updates.avatar = avatar;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
      return updated;
    }
    return user;
  }

  if (process.env.REGISTRATION_DISABLED === "1") {
    const err = new Error("Registration is currently disabled") as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = "REGISTRATION_DISABLED";
    throw err;
  }

  // 2. Create new user
  const [user] = await db
    .insert(users)
    .values({
      email: email ? email.toLowerCase() : null,
      googleId,
      name,
      avatar: avatar || null,
    })
    .returning();
  await db.insert(userProfile).values({ userId: user.id });
  return user;
}

export { requireAuthMiddleware as requireAuth } from "./middleware/userContext";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    authMethod?: import("./httpHardening").SessionAuthMethod;
    youtubeOAuth?: {
      state: string;
      ownerUserId?: number;
      createdAt: number;
    };
  }
}
