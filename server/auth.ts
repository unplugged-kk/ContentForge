import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "./db";
import { users, userProfile } from "@shared/schema";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePassword(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
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
