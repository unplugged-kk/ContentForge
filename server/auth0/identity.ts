import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { users, userProfile } from "@shared/schema";
import type { Auth0Profile } from "./token";

/**
 * Maps an Auth0 subject to an application user. users.id stays the key every
 * owner check uses; auth0_subject is only a lookup column.
 *
 * Order: exact subject, then exactly one row with the same verified email
 * (linked, never overwriting another subject), then a new user when
 * registration is open. Every other case is a refusal, never a guess.
 */
export type Auth0Refusal =
  | "email_missing"
  | "email_unverified"
  | "email_ambiguous"
  | "subject_conflict"
  | "registration_disabled";

export type Auth0Resolution =
  | { kind: "resolved"; userId: number; via: "subject" | "linked" | "created" }
  | { kind: "refused"; reason: Auth0Refusal };

export async function findUserIdByAuth0Subject(subject: string): Promise<number | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.auth0Subject, subject));
  return row?.id ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } }).code
    ?? (err as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

async function linkOrCreate(
  subject: string,
  profile: Auth0Profile,
  registrationOpen: boolean,
): Promise<Auth0Resolution> {
  const email = profile.email!.toLowerCase();
  return db.transaction(async (tx) => {
    const matches = await tx
      .select({ id: users.id, auth0Subject: users.auth0Subject })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .for("update");

    if (matches.length > 1) return { kind: "refused", reason: "email_ambiguous" };

    if (matches.length === 1) {
      const [match] = matches;
      if (match.auth0Subject && match.auth0Subject !== subject) {
        return { kind: "refused", reason: "subject_conflict" };
      }
      await tx
        .update(users)
        .set({ auth0Subject: subject, updatedAt: new Date() })
        .where(eq(users.id, match.id));
      return { kind: "resolved", userId: match.id, via: "linked" };
    }

    if (!registrationOpen) return { kind: "refused", reason: "registration_disabled" };

    const [created] = await tx
      .insert(users)
      .values({ email, name: profile.name, avatar: profile.picture, auth0Subject: subject })
      .returning({ id: users.id });
    await tx.insert(userProfile).values({ userId: created.id });
    return { kind: "resolved", userId: created.id, via: "created" };
  });
}

/**
 * `loadProfile` runs only when the subject is not linked yet, so a returning
 * user costs one indexed lookup and no call to Auth0.
 */
export async function resolveAuth0User(
  subject: string,
  loadProfile: () => Promise<Auth0Profile>,
  options: { registrationOpen: boolean },
): Promise<Auth0Resolution> {
  const known = await findUserIdByAuth0Subject(subject);
  if (known) return { kind: "resolved", userId: known, via: "subject" };

  const profile = await loadProfile();
  if (profile.subject !== subject) throw new Error("Auth0 userinfo subject does not match the token");
  if (!profile.email) return { kind: "refused", reason: "email_missing" };
  if (!profile.emailVerified) return { kind: "refused", reason: "email_unverified" };

  // Two concurrent first logins race on the unique subject or email. The
  // loser re-resolves once and sees the winner's committed row.
  for (let attempt = 0; ; attempt++) {
    try {
      return await linkOrCreate(subject, profile, options.registrationOpen);
    } catch (err) {
      if (!isUniqueViolation(err) || attempt > 0) throw err;
      const winner = await findUserIdByAuth0Subject(subject);
      if (winner) return { kind: "resolved", userId: winner, via: "subject" };
    }
  }
}
