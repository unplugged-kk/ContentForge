#!/usr/bin/env node
/**
 * Auth0 migration E2E against the production bundle. TEST INFRASTRUCTURE.
 *
 * Runs `node dist/index.cjs` with NODE_ENV=production, points AUTH0_DOMAIN at
 * a local mock issuer (script/auth0-mock-issuer.mjs) and drives the real
 * @auth0/auth0-react SDK in Chromium: Universal Login redirect, PKCE code
 * exchange, session exchange, owner checks, logout through Auth0, and the
 * bearer rejections. Legacy password and direct-Google routes are checked to
 * still work. Real Auth0 + Google is the operator's final browser check.
 *
 *   npm run build && E2E_AUTH0_DATABASE_URL=postgres://e2e:e2e@127.0.0.1:5433/contentforge_e2e npm run test:e2e:auth0
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { generateKeyPair } from "jose";
import { chromium } from "playwright";
import { startAuth0Mock } from "./auth0-mock-issuer.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_URL = process.env.E2E_AUTH0_DATABASE_URL ?? "";
const APP_PORT = Number(process.env.E2E_AUTH0_APP_PORT ?? 4391);
const MOCK_PORT = Number(process.env.E2E_AUTH0_MOCK_PORT ?? 4455);
const APP = `http://127.0.0.1:${APP_PORT}`;
const CLIENT_ID = "e2e-spa-client";
const AUDIENCE = "https://api.contentforge.e2e";
const SESSION_SECRET = `e2e-auth0-${Date.now()}`;
const GOOGLE_SECRET = `e2e-google-secret-${Date.now()}`;
const RUN = `a0e2e${Date.now().toString(36)}`;

const dbHost = (() => {
  try {
    const url = new URL(DB_URL);
    return { host: url.hostname, name: url.pathname.slice(1) };
  } catch {
    return null;
  }
})();
if (!dbHost || !["127.0.0.1", "localhost"].includes(dbHost.host) || !/e2e|test/.test(dbHost.name)) {
  console.error(`REFUSING TO RUN: E2E_AUTH0_DATABASE_URL must be a local *e2e*/*test* database, got "${DB_URL}"`);
  process.exit(2);
}
if (!existsSync(path.join(ROOT, "dist/index.cjs"))) {
  console.error("dist/index.cjs is missing. Run `npm run build` first.");
  process.exit(2);
}

const results = [];
const tokensSeen = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`  ${ok ? "✔" : "✖"} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : undefined);
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pool = new pg.Pool({ connectionString: DB_URL });
const userBySubject = async (sub) =>
  (await pool.query("select id, email, auth0_subject, password_hash from users where auth0_subject = $1", [sub])).rows;
const usersByEmail = async (email) =>
  (await pool.query("select id, auth0_subject from users where lower(email) = lower($1)", [email])).rows;

const mock = await startAuth0Mock({
  port: MOCK_PORT,
  clientId: CLIENT_ID,
  audience: AUDIENCE,
  callbackUrl: `${APP}/auth/callback`,
  logoutUrl: APP,
});

const logPath = path.join(ROOT, "test-results", `e2e-auth0-${RUN}.log`);
mkdirSync(path.dirname(logPath), { recursive: true });
const appLog = createWriteStream(logPath);
const app = spawn("node", ["dist/index.cjs"], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    DATABASE_URL: DB_URL,
    SESSION_SECRET,
    SESSION_COOKIE_SECURE: "0",
    CONTENTFORGE_E2E_SERVER: "1",
    AI_API_KEY: "fixture-key",
    OPENAI_API_KEY: "fixture-key",
    AUTH0_DOMAIN: mock.issuer.replace(/\/$/, ""),
    AUTH0_CLIENT_ID: CLIENT_ID,
    AUTH0_AUDIENCE: AUDIENCE,
    GOOGLE_CLIENT_ID: "e2e-google-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    GOOGLE_CALLBACK_URL: `${APP}/api/auth/google/callback`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
app.stdout.pipe(appLog);
app.stderr.pipe(appLog);

let browser;
try {
  for (let i = 0; ; i++) {
    const ok = await fetch(`${APP}/api/ready`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    if (i > 120 || app.exitCode !== null) throw new Error(`app did not become ready, see ${logPath}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`app ready on ${APP}, mock issuer ${mock.issuer}`);

  browser = await chromium.launch();

  const cookieOf = async (context) => (await context.cookies(APP)).find((c) => c.name === "connect.sid")?.value;
  const meWithCookie = (sid) => fetch(`${APP}/api/auth/me`, { headers: { cookie: `connect.sid=${sid}` } });

  async function universalLogin(page, { sub, email, verified = true }) {
    await page.getByTestId("button-auth0-signin").click();
    await page.waitForURL(`${mock.issuer}authorize**`);
    await page.locator('input[name="mock_sub"]').fill(sub);
    await page.locator('input[name="mock_email"]').fill(email);
    await page.locator('input[name="mock_email_verified"]').setChecked(verified);
    await page.getByRole("button", { name: "Continue" }).click();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  const subjectA = `google-oauth2|${RUN}-a`;
  const emailA = `${RUN}-a@example.test`;
  let userIdA = 0;
  let plantedSid = "";

  await check("anonymous visitor sees the sign-in page with Universal Login", async () => {
    await page.goto(APP);
    await page.getByTestId("button-auth0-signin").waitFor();
    assert(await page.getByTestId("tab-login").isVisible(), "password login still offered during migration");
  });

  await check("public config exposes only domain, client id and audience", async () => {
    const body = await (await fetch(`${APP}/api/auth/config`)).json();
    assert(JSON.stringify(body.auth0) === JSON.stringify({ domain: mock.issuer.replace(/\/$/, ""), clientId: CLIENT_ID, audience: AUDIENCE }), JSON.stringify(body));
  });

  await check("a session planted before login exists", async () => {
    await page.evaluate(() => fetch("/api/csrf-token", { credentials: "include" }));
    plantedSid = (await cookieOf(context)) ?? "";
    assert(plantedSid, "no pre-login connect.sid");
  });

  await check("login redirects to Universal Login with Authorization Code + PKCE S256", async () => {
    await page.getByTestId("button-auth0-signin").click();
    await page.waitForURL(`${mock.issuer}authorize**`);
    const p = mock.events.authorize.at(-1);
    assert(p.response_type === "code", `response_type=${p.response_type}`);
    assert(p.code_challenge_method === "S256" && p.code_challenge?.length >= 43, "missing S256 code challenge");
    assert(p.redirect_uri === `${APP}/auth/callback`, p.redirect_uri);
    assert(p.audience === AUDIENCE && /openid/.test(p.scope) && /email/.test(p.scope), `${p.audience} ${p.scope}`);
    await page.goBack();
  });

  await check("callback provisions a new user and lands in the app", async () => {
    await page.goto(APP);
    await universalLogin(page, { sub: subjectA, email: emailA });
    await page.getByTestId("button-logout").waitFor({ timeout: 30_000 });
    const landed = new URL(page.url());
    assert(landed.pathname !== "/auth/callback" && !landed.search.includes("code="), `landed on ${page.url()}`);
    const tokenEvent = mock.events.token.at(-1);
    assert(tokenEvent.pkceOk && !tokenEvent.clientSecretSent, JSON.stringify(tokenEvent));
    const rows = await userBySubject(subjectA);
    assert(rows.length === 1 && rows[0].email === emailA, JSON.stringify(rows));
    userIdA = rows[0].id;
    return `users.id=${userIdA}`;
  });

  await check("login regenerated the session id and the planted id is dead", async () => {
    const sid = await cookieOf(context);
    assert(sid && sid !== plantedSid, "connect.sid did not change at login");
    assert((await meWithCookie(plantedSid)).status === 401, "planted sid still authenticates");
  });

  await check("GET /api/auth/me and a protected API succeed on the cookie alone", async () => {
    const sid = await cookieOf(context);
    const me = await (await meWithCookie(sid)).json();
    assert(me.id === userIdA && me.email === emailA, JSON.stringify(me));
    const posts = await fetch(`${APP}/api/posts`, { headers: { cookie: `connect.sid=${sid}` } });
    assert(posts.status === 200, `GET /api/posts ${posts.status}`);
  });

  await check("logout ends the app session and the Auth0 session", async () => {
    const sid = await cookieOf(context);
    const before = mock.events.logout.length;
    await page.getByTestId("button-logout").click();
    await page.getByTestId("button-auth0-signin").waitFor({ timeout: 30_000 });
    assert(mock.events.logout.length === before + 1, "Auth0 /v2/logout was not called");
    assert(mock.events.logout.at(-1).returnTo === APP, mock.events.logout.at(-1).returnTo);
    assert((await meWithCookie(sid)).status === 401, "old cookie still authenticates");
    await page.goBack().catch(() => {});
    await page.goto(`${APP}/settings`);
    await page.getByTestId("button-auth0-signin").waitFor();
  });

  await check("returning user resolves to the same users.id without a new row", async () => {
    await page.goto(APP);
    await universalLogin(page, { sub: subjectA, email: emailA });
    await page.getByTestId("button-logout").waitFor({ timeout: 30_000 });
    const rows = await usersByEmail(emailA);
    assert(rows.length === 1 && rows[0].id === userIdA, JSON.stringify(rows));
  });

  await check("post-login return keeps the deep link the visitor started from", async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${APP}/settings`);
    await universalLogin(p, { sub: subjectA, email: emailA });
    await p.waitForURL(`${APP}/settings`, { timeout: 30_000 });
    await ctx.close();
  });

  await check("existing password user is linked by verified email, id and password unchanged", async () => {
    const email = `${RUN}-pw@example.test`;
    const reg = await fetch(`${APP}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "E2EPassword99!", name: "Password Person" }),
    });
    assert(reg.ok, `register ${reg.status}`);
    const { id } = await reg.json();
    const [{ password_hash: hashBefore }] = (await pool.query("select password_hash from users where id=$1", [id])).rows;
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(APP);
    await universalLogin(p, { sub: `auth0|${RUN}-pw`, email: email.toUpperCase() });
    await p.getByTestId("button-logout").waitFor({ timeout: 30_000 });
    const rows = await usersByEmail(email);
    assert(rows.length === 1 && rows[0].id === id && rows[0].auth0_subject === `auth0|${RUN}-pw`, JSON.stringify(rows));
    const [{ password_hash: hashAfter }] = (await pool.query("select password_hash from users where id=$1", [id])).rows;
    assert(hashAfter === hashBefore, "password hash changed");
    const login = await fetch(`${APP}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "E2EPassword99!" }),
    });
    assert(login.ok, `password login after linking ${login.status}`);
    await ctx.close();
  });

  await check("unverified email is refused with an actionable message and no user", async () => {
    const email = `${RUN}-unverified@example.test`;
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(APP);
    await universalLogin(p, { sub: `auth0|${RUN}-unverified`, email, verified: false });
    const alert = p.getByTestId("alert-auth0-failure");
    await alert.waitFor({ timeout: 30_000 });
    assert(/verify your email/i.test(await alert.innerText()), await alert.innerText());
    assert((await usersByEmail(email)).length === 0, "user was created");
    assert(!(await cookieOf(ctx)), "a session cookie was issued");
    await ctx.close();
  });

  await check("email already linked to another subject is refused, not merged", async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(APP);
    await universalLogin(p, { sub: `auth0|${RUN}-intruder`, email: emailA });
    await p.getByTestId("alert-auth0-failure").waitFor({ timeout: 30_000 });
    const rows = await usersByEmail(emailA);
    assert(rows.length === 1 && rows[0].auth0_subject === subjectA, JSON.stringify(rows));
    await ctx.close();
  });

  const strangerKey = (await generateKeyPair("RS256")).privateKey;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const bearerCases = [
    ["wrong audience", () => mock.mint({ sub: subjectA, aud: "https://other.api" })],
    ["wrong issuer", () => mock.mint({ sub: subjectA, iss: "https://evil.example/" })],
    ["expired", () => mock.mint({ sub: subjectA }, { expiresIn: Math.floor(Date.now() / 1000) - 60 })],
    ["invalid signature", () => mock.mint({ sub: subjectA }, { key: strangerKey })],
    ["unknown key id", () => mock.mint({ sub: subjectA }, { kid: "rotated-away" })],
    ["missing sub", () => mock.mint({})],
    ["malformed", async () => "abc.def.ghi"],
  ];

  await check("valid Auth0 bearer reaches /api/auth/me and protected APIs as the same users.id", async () => {
    const token = await mock.mint({ sub: subjectA });
    tokensSeen.push(token);
    const me = await (await fetch(`${APP}/api/auth/me`, { headers: bearer(token) })).json();
    assert(me.id === userIdA, JSON.stringify(me));
    const create = await fetch(`${APP}/api/posts`, {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ postType: "single", tweets: [{ content: `bearer ${RUN}`, position: 0 }] }),
    });
    assert(create.status === 201, `bearer POST without CSRF ${create.status}`);
  });

  for (const [name, make] of bearerCases) {
    await check(`bearer ${name} is 401`, async () => {
      const token = await make();
      tokensSeen.push(token);
      const res = await fetch(`${APP}/api/posts`, { headers: bearer(token) });
      assert(res.status === 401, `got ${res.status}`);
      assert(JSON.stringify(await res.json()) === '{"message":"Unauthorized"}', "error body leaks detail");
    });
  }

  await check("owner checks still use users.id: bearer user B cannot read user A's post", async () => {
    const tokenA = await mock.mint({ sub: subjectA });
    const created = await (
      await fetch(`${APP}/api/posts`, {
        method: "POST",
        headers: { ...bearer(tokenA), "content-type": "application/json" },
        body: JSON.stringify({ postType: "single", tweets: [{ content: `owner ${RUN}`, position: 0 }] }),
      })
    ).json();
    const subB = `auth0|${RUN}-b`;
    mock.setUser(subB, { email: `${RUN}-b@example.test`, email_verified: true, name: "B" });
    const tokenB = await mock.mint({ sub: subB });
    tokensSeen.push(tokenA, tokenB);
    const read = await fetch(`${APP}/api/posts/${created.id}`, { headers: bearer(tokenB) });
    assert(read.status === 404, `B read A's post: ${read.status}`);
    const own = await fetch(`${APP}/api/posts/${created.id}`, { headers: bearer(tokenA) });
    assert(own.status === 200, `A read own post: ${own.status}`);
  });

  await check("cookie for A plus bearer for B acts as B only", async () => {
    const sid = await cookieOf(context);
    const tokenB = await mock.mint({ sub: `auth0|${RUN}-b` });
    const me = await (await fetch(`${APP}/api/auth/me`, { headers: { ...bearer(tokenB), cookie: `connect.sid=${sid}` } })).json();
    assert(me.email === `${RUN}-b@example.test`, JSON.stringify(me));
  });

  await check("PUT /api/auth/me now requires CSRF on a cookie session", async () => {
    const sid = await cookieOf(context);
    const res = await fetch(`${APP}/api/auth/me`, {
      method: "PUT",
      headers: { cookie: `connect.sid=${sid}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "csrf victim" }),
    });
    assert(res.status === 403, `got ${res.status}`);
  });

  await check("legacy direct Google login route still redirects to Google", async () => {
    const res = await fetch(`${APP}/api/auth/google`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    assert(res.status === 302 && location.startsWith("https://accounts.google.com/"), `${res.status} ${location}`);
  });

  await check("callback URL with a foreign returnTo stays on this origin", async () => {
    const ctx = await browser.newContext();
    // Tamper with the stored destination as the callback page loads.
    await ctx.addInitScript(() => {
      if (location.pathname === "/auth/callback") sessionStorage.setItem("cf.auth0.returnTo", "//evil.example/x");
    });
    const p = await ctx.newPage();
    await p.goto(APP);
    await universalLogin(p, { sub: subjectA, email: emailA });
    await p.getByTestId("button-logout").waitFor({ timeout: 30_000 });
    assert(new URL(p.url()).origin === APP, p.url());
    await ctx.close();
  });

  await check("no secret reaches the frontend bundle", async () => {
    const pub = path.join(ROOT, "dist/public");
    const files = [];
    const walk = (dir) => readdirSync(dir).forEach((f) => {
      const full = path.join(dir, f);
      statSync(full).isDirectory() ? walk(full) : files.push(full);
    });
    walk(pub);
    // The SDK names `client_secret` in its own code; what must never ship is
    // a value: this run's secrets, or any literal assigned to a secret field.
    const literal = /(client_secret|clientSecret|SESSION_SECRET|GOOGLE_CLIENT_SECRET)["']?\s*[:=]\s*["'][^"']{8,}["']/;
    const leaks = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      return text.includes(GOOGLE_SECRET) || text.includes(SESSION_SECRET) || literal.test(text);
    });
    assert(leaks.length === 0, leaks.join(", "));
    const html = await (await fetch(APP)).text();
    assert(!html.includes(GOOGLE_SECRET) && !html.includes(SESSION_SECRET), "secret in served HTML");
    return `${files.length} files scanned`;
  });

  await check("no access token or session cookie appears in the server log", async () => {
    appLog.write("");
    await new Promise((r) => setTimeout(r, 500));
    const log = readFileSync(logPath, "utf8");
    const leaked = tokensSeen.filter((t) => t.length > 20 && log.includes(t));
    assert(leaked.length === 0, `${leaked.length} tokens in log`);
    assert(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(log), "JWT-shaped string in log");
    assert(!log.includes(plantedSid), "session id in log");
  });

  await check("no browser console errors on the Auth0 path", async () => {
    const relevant = consoleErrors.filter((e) => !/401|Failed to load resource/.test(e));
    assert(relevant.length === 0, relevant.join(" | "));
  });
} catch (error) {
  record("harness", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser?.close();
  app.kill("SIGTERM");
  await mock.close();
  await pool.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. App log: ${path.relative(ROOT, logPath)}`);
