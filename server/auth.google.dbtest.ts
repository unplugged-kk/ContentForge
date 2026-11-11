import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "./db";
import { findOrCreateGoogleUser } from "./auth";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SAME_DB = Boolean(CONNECTION && process.env.DATABASE_URL && CONNECTION === process.env.DATABASE_URL);
const describeDb = SAME_DB ? describe : describe.skip;
const RUN = `gl${Date.now().toString(36)}`;

describeDb("findOrCreateGoogleUser (legacy direct Google, db)", () => {
  it("prefers the google_id match over a different user matched by email", async () => {
    // The email row is older, so an unordered `googleId OR email LIMIT 1` finds it first.
    const [byEmail] = await db.insert(users).values({ email: `${RUN}-other@example.test` }).returning();
    const [byId] = await db.insert(users).values({ email: `${RUN}-id@example.test`, googleId: `${RUN}-gid` }).returning();
    const user = await findOrCreateGoogleUser(`${RUN}-gid`, byEmail.email, "G", null);
    assert.equal(user.id, byId.id);
    assert.equal((await db.select().from(users).where(eq(users.id, byEmail.id)))[0].googleId, null);
  });

  it("does not link by email when Google did not verify it (email passed as null)", async () => {
    const [existing] = await db.insert(users).values({ email: `${RUN}-victim@example.test` }).returning();
    const user = await findOrCreateGoogleUser(`${RUN}-attacker-gid`, null, "Attacker", null);
    assert.notEqual(user.id, existing.id);
    assert.equal((await db.select().from(users).where(eq(users.id, existing.id)))[0].googleId, null);
  });

  it("links a verified email to the existing user when no google_id matches", async () => {
    const [existing] = await db.insert(users).values({ email: `${RUN}-link@example.test` }).returning();
    const user = await findOrCreateGoogleUser(`${RUN}-link-gid`, `${RUN}-LINK@example.test`, "L", null);
    assert.equal(user.id, existing.id);
    assert.equal(user.googleId, `${RUN}-link-gid`);
  });
});
