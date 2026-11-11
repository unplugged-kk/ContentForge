import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from "jose";
import { users, userProfile } from "@shared/schema";
import { db } from "../db";
import { createUser } from "../auth";
import { resolveAuth0User } from "./identity";
import { createAuth0Authenticator } from "./index";
import type { Auth0Config, Auth0Profile } from "./token";

const CONNECTION = process.env.TEST_DATABASE_URL;
const SAME_DB = Boolean(CONNECTION && process.env.DATABASE_URL && CONNECTION === process.env.DATABASE_URL);
const describeDb = SAME_DB ? describe : describe.skip;
const RUN = `a0${Date.now().toString(36)}`;

let seq = 0;
const email = (label: string) => `${RUN}-${label}-${seq++}@example.test`;
const subjectFor = (label: string) => `google-oauth2|${RUN}-${label}-${seq++}`;
const profile = (subject: string, overrides: Partial<Auth0Profile> = {}): Auth0Profile => ({
  subject,
  email: null,
  emailVerified: true,
  name: "Auth0 Person",
  picture: null,
  ...overrides,
});
const open = { registrationOpen: true };

async function userRow(id: number) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

describeDb("resolveAuth0User (db)", () => {
  it("creates a user with a profile row for a new subject with a verified email", async () => {
    const subject = subjectFor("new");
    const address = email("new");
    const outcome = await resolveAuth0User(subject, async () => profile(subject, { email: address }), open);
    assert.equal(outcome.kind, "resolved");
    assert.equal(outcome.kind === "resolved" && outcome.via, "created");
    const userId = outcome.kind === "resolved" ? outcome.userId : 0;
    const row = await userRow(userId);
    assert.equal(row.auth0Subject, subject);
    assert.equal(row.email, address);
    assert.equal(row.passwordHash, null);
    const profiles = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
    assert.equal(profiles.length, 1);
  });

  it("returns a linked subject by id without calling userinfo", async () => {
    const subject = subjectFor("returning");
    const first = await resolveAuth0User(subject, async () => profile(subject, { email: email("returning") }), open);
    const again = await resolveAuth0User(
      subject,
      async () => {
        throw new Error("userinfo must not be called for a known subject");
      },
      open,
    );
    assert.deepEqual(again, { kind: "resolved", userId: first.kind === "resolved" ? first.userId : -1, via: "subject" });
  });

  it("links an existing password user by verified email and keeps id and password", async () => {
    const address = email("pw");
    const existing = await createUser(address, "correct horse", "Password User");
    const subject = subjectFor("pw");
    const outcome = await resolveAuth0User(subject, async () => profile(subject, { email: address.toUpperCase() }), open);
    assert.deepEqual(outcome, { kind: "resolved", userId: existing.id, via: "linked" });
    const row = await userRow(existing.id);
    assert.equal(row.auth0Subject, subject);
    assert.equal(row.passwordHash, existing.passwordHash);
  });

  it("links an existing direct-Google user and keeps google_id", async () => {
    const address = email("google");
    const [existing] = await db
      .insert(users)
      .values({ email: address, googleId: `${RUN}-gid-${seq++}`, name: "Google User" })
      .returning();
    const subject = subjectFor("google");
    const outcome = await resolveAuth0User(subject, async () => profile(subject, { email: address }), open);
    assert.deepEqual(outcome, { kind: "resolved", userId: existing.id, via: "linked" });
    assert.equal((await userRow(existing.id)).googleId, existing.googleId);
  });

  it("refuses an email already linked to a different subject and leaves it untouched", async () => {
    const address = email("conflict");
    const firstSubject = subjectFor("conflict-a");
    const first = await resolveAuth0User(firstSubject, async () => profile(firstSubject, { email: address }), open);
    const secondSubject = subjectFor("conflict-b");
    const outcome = await resolveAuth0User(secondSubject, async () => profile(secondSubject, { email: address }), open);
    assert.deepEqual(outcome, { kind: "refused", reason: "subject_conflict" });
    assert.equal((await userRow(first.kind === "resolved" ? first.userId : 0)).auth0Subject, firstSubject);
  });

  it("refuses an unverified email and creates nothing", async () => {
    const address = email("unverified");
    const existing = await createUser(address, "correct horse", "Victim");
    const subject = subjectFor("unverified");
    const outcome = await resolveAuth0User(
      subject,
      async () => profile(subject, { email: address, emailVerified: false }),
      open,
    );
    assert.deepEqual(outcome, { kind: "refused", reason: "email_unverified" });
    assert.equal((await userRow(existing.id)).auth0Subject, null);
    assert.equal((await db.select().from(users).where(eq(users.auth0Subject, subject))).length, 0);
  });

  it("refuses a sign-in with no email", async () => {
    const subject = subjectFor("noemail");
    assert.deepEqual(await resolveAuth0User(subject, async () => profile(subject), open), {
      kind: "refused",
      reason: "email_missing",
    });
  });

  it("refuses to guess when the email matches more than one user", async () => {
    const address = email("dup");
    await db.insert(users).values([{ email: address }, { email: address.toUpperCase() }]);
    const subject = subjectFor("dup");
    const outcome = await resolveAuth0User(subject, async () => profile(subject, { email: address }), open);
    assert.deepEqual(outcome, { kind: "refused", reason: "email_ambiguous" });
  });

  it("refuses a new user when registration is closed but still links an existing one", async () => {
    const closed = { registrationOpen: false };
    const subject = subjectFor("closed-new");
    assert.deepEqual(
      await resolveAuth0User(subject, async () => profile(subject, { email: email("closed-new") }), closed),
      { kind: "refused", reason: "registration_disabled" },
    );
    const address = email("closed-existing");
    const existing = await createUser(address, "correct horse", "Existing");
    const linkSubject = subjectFor("closed-existing");
    assert.deepEqual(
      await resolveAuth0User(linkSubject, async () => profile(linkSubject, { email: address }), closed),
      { kind: "resolved", userId: existing.id, via: "linked" },
    );
  });

  it("rejects a userinfo answer for a different subject", async () => {
    const subject = subjectFor("mismatch");
    await assert.rejects(
      resolveAuth0User(subject, async () => profile("auth0|someone-else", { email: email("mismatch") }), open),
      /does not match/,
    );
  });

  it("creates exactly one user when the same subject signs in concurrently", async () => {
    const subject = subjectFor("race");
    const address = email("race");
    // Every caller waits here until all six have missed the subject lookup,
    // so the inserts genuinely race instead of running one after another.
    const callers = 6;
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const loadProfile = async () => {
      if (++arrived === callers) release();
      await barrier;
      return profile(subject, { email: address });
    };
    const outcomes = await Promise.all(
      Array.from({ length: callers }, () => resolveAuth0User(subject, loadProfile, open)),
    );
    const ids = new Set(outcomes.map((o) => (o.kind === "resolved" ? o.userId : -1)));
    assert.equal(ids.size, 1);
    assert.ok(!ids.has(-1));
    assert.equal((await db.select().from(users).where(like(users.email, address))).length, 1);
  });

  it("gives one new email to exactly one of two concurrent subjects", async () => {
    const address = email("race-email");
    const [a, b] = [subjectFor("race-a"), subjectFor("race-b")];
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const loadProfile = (subject: string) => async () => {
      if (++arrived === 2) release();
      await barrier;
      return profile(subject, { email: address });
    };
    const outcomes = await Promise.all([
      resolveAuth0User(a, loadProfile(a), open),
      resolveAuth0User(b, loadProfile(b), open),
    ]);
    const kinds = outcomes.map((o) => (o.kind === "resolved" ? o.via : o.reason)).sort();
    assert.deepEqual(kinds, ["created", "subject_conflict"]);
    assert.equal((await db.select().from(users).where(like(users.email, address))).length, 1);
  });
});

describeDb("createAuth0Authenticator (db)", () => {
  const config: Auth0Config = {
    domain: "tenant.example.auth0.com",
    clientId: "spa",
    audience: "https://api.contentforge.test",
    issuer: "https://tenant.example.auth0.com/",
  };
  let key: CryptoKey;
  let keys: JWTVerifyGetKey;

  before(async () => {
    const pair = await generateKeyPair("RS256");
    key = pair.privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
  });

  const sign = (sub: string, aud = config.audience) =>
    new SignJWT({ sub })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(config.issuer)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);

  it("turns a valid token for a new verified user into a users.id", async () => {
    const subject = subjectFor("authn");
    const address = email("authn");
    const authenticate = createAuth0Authenticator(config, {
      keys,
      loadProfile: async () => profile(subject, { email: address }),
    });
    const result = await authenticate(await sign(subject));
    assert.equal(result.ok, true);
    const [row] = await db.select().from(users).where(eq(users.auth0Subject, subject));
    assert.deepEqual(result, { ok: true, userId: row.id });
  });

  it("answers 403 with an actionable message for an unverified email", async () => {
    const subject = subjectFor("authn-unverified");
    const authenticate = createAuth0Authenticator(config, {
      keys,
      loadProfile: async () => profile(subject, { email: email("authn-unverified"), emailVerified: false }),
    });
    assert.deepEqual(await authenticate(await sign(subject)), {
      ok: false,
      status: 403,
      message: "Verify your email address with the sign-in provider, then sign in again.",
    });
  });

  it("answers 401 for a token minted for another audience", async () => {
    const authenticate = createAuth0Authenticator(config, {
      keys,
      loadProfile: async () => {
        throw new Error("must not resolve an invalid token");
      },
    });
    assert.deepEqual(await authenticate(await sign(subjectFor("aud"), "spa")), {
      ok: false,
      status: 401,
      message: "Unauthorized",
    });
  });
});
