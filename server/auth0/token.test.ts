import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from "jose";
import { createAuth0TokenVerifier, fetchAuth0Profile, readAuth0Config, type Auth0Config } from "./token";

const config: Auth0Config = {
  domain: "tenant.example.auth0.com",
  clientId: "spa-client",
  audience: "https://api.contentforge.test",
  issuer: "https://tenant.example.auth0.com/",
};

const now = () => Math.floor(Date.now() / 1000);

describe("readAuth0Config", () => {
  it("is null unless domain, client id and audience are all set", () => {
    assert.equal(readAuth0Config({ AUTH0_DOMAIN: "t.auth0.com", AUTH0_CLIENT_ID: "c" }), null);
  });

  it("derives the https issuer Auth0 puts in tokens", () => {
    assert.deepEqual(
      readAuth0Config({ AUTH0_DOMAIN: "t.auth0.com", AUTH0_CLIENT_ID: "c", AUTH0_AUDIENCE: "https://api" }),
      { domain: "t.auth0.com", clientId: "c", audience: "https://api", issuer: "https://t.auth0.com/" },
    );
  });

  it("accepts plain http only on loopback", () => {
    assert.equal(
      readAuth0Config({ AUTH0_DOMAIN: "http://127.0.0.1:4455", AUTH0_CLIENT_ID: "c", AUTH0_AUDIENCE: "a" })?.issuer,
      "http://127.0.0.1:4455/",
    );
    assert.throws(
      () => readAuth0Config({ AUTH0_DOMAIN: "http://evil.example", AUTH0_CLIENT_ID: "c", AUTH0_AUDIENCE: "a" }),
      /must be an https host/,
    );
  });
});

describe("createAuth0TokenVerifier", () => {
  let signingKey: CryptoKey;
  let strangerKey: CryptoKey;
  let keys: JWTVerifyGetKey;

  before(async () => {
    const pair = await generateKeyPair("RS256");
    signingKey = pair.privateKey;
    strangerKey = (await generateKeyPair("RS256")).privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
  });

  function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; kid?: string } = {}) {
    const { iss = config.issuer, aud = config.audience, sub = "google-oauth2|123", iat = now(), exp = now() + 600, ...rest } =
      claims as Record<string, never>;
    const jwt = new SignJWT({ ...rest, ...(sub === null ? {} : { sub }) })
      .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "k1" })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt(iat)
      .setExpirationTime(exp);
    return jwt.sign(opts.key ?? signingKey);
  }

  it("returns the subject of a valid token", async () => {
    const verify = createAuth0TokenVerifier(config, keys);
    assert.deepEqual(await verify(await token()), { subject: "google-oauth2|123" });
  });

  it("accepts a token whose audience list includes the API", async () => {
    const verify = createAuth0TokenVerifier(config, keys);
    const aud = [config.audience, "https://tenant.example.auth0.com/userinfo"];
    assert.deepEqual(await verify(await token({ aud } as never)), { subject: "google-oauth2|123" });
  });

  const rejected: Array<[string, () => Promise<string>]> = [
    ["wrong issuer", () => token({ iss: "https://attacker.auth0.com/" } as never)],
    ["wrong audience", () => token({ aud: "spa-client" } as never)],
    ["expired", () => token({ iat: now() - 7200, exp: now() - 3600 } as never)],
    ["not yet valid", () => token({ nbf: now() + 3600 } as never)],
    ["signed by another key", () => token({}, { key: strangerKey })],
    ["unknown key id", () => token({}, { kid: "k2" })],
    ["missing subject", () => token({ sub: null } as never)],
    ["malformed", async () => "not.a.jwt"],
    ["unsigned alg none", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ iss: config.issuer, aud: config.audience, sub: "x", exp: now() + 600, iat: now() })).toString("base64url");
      return `${header}.${body}.`;
    }],
  ];

  for (const [name, make] of rejected) {
    it(`rejects a token that is ${name}`, async () => {
      const verify = createAuth0TokenVerifier(config, keys);
      assert.equal(await verify(await make()), null);
    });
  }

  it("never writes the token to the log", async () => {
    const verify = createAuth0TokenVerifier(config, keys);
    const bad = await token({ aud: "spa-client" } as never);
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => lines.push(args.join(" "));
    try {
      await verify(bad);
    } finally {
      console.warn = original;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[auth0\] bearer rejected: ERR_JWT_CLAIM_VALIDATION_FAILED \(aud\)$/);
    assert.ok(!lines[0].includes(bad));
  });
});

describe("fetchAuth0Profile", () => {
  it("reads email and email_verified from /userinfo with the bearer token", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), auth: new Headers(init.headers).get("authorization") };
      return Response.json({ sub: "auth0|9", email: "A@Example.com", email_verified: true, name: "Ada" });
    }) as unknown as typeof fetch;
    assert.deepEqual(await fetchAuth0Profile(config, "tok", fakeFetch), {
      subject: "auth0|9",
      email: "A@Example.com",
      emailVerified: true,
      name: "Ada",
      picture: null,
    });
    assert.deepEqual(seen, { url: "https://tenant.example.auth0.com/userinfo", auth: "Bearer tok" });
  });

  it("treats a missing or non-boolean email_verified as unverified", async () => {
    const fakeFetch = (async () => Response.json({ sub: "x", email: "a@b.c", email_verified: "true" })) as unknown as typeof fetch;
    assert.equal((await fetchAuth0Profile(config, "tok", fakeFetch)).emailVerified, false);
  });
});
