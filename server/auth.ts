import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "./db";
import { users, userProfile } from "@shared/schema";
import { eq, or } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

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

export async function findOrCreateGoogleUser(googleId: string, email: string | null, name: string, avatar: string | null) {
  // 1. Try to find by googleId first
  const conditions: any[] = [eq(users.googleId, googleId)];
  if (email) conditions.push(eq(users.email, email.toLowerCase()));

  const existing = await db.select().from(users).where(or(...conditions)).limit(1);

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}
