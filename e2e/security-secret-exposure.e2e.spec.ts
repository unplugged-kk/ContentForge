import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * Secret-exposure gate for connected-account credentials.
 *
 * These tests assert on the NEGATIVE: a known canary credential string must not
 * appear anywhere the browser can reach. The canary is shaped like a real token
 * and contains no natural substring, so a match is unambiguous.
 *
 * Covers the exposure surface named in the security brief: network responses,
 * rendered DOM/HTML, localStorage, sessionStorage, the URL, console output, and
 * cross-tenant access.
 */

const BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "4173"}`;

/** Shaped like a real API credential. If this string ever appears, it is a leak. */
const CANARY_TOKEN = "cfcanary_S3CRETVALUE_9f3b7a21deadbeefcafe";
const CANARY_LAST4 = CANARY_TOKEN.slice(-4);
const MASKED_CANARY = `••••••${CANARY_LAST4}`;

/**
 * An isolated context with NO inherited session.
 *
 * `playwrightRequest.newContext()` inherits the project's `use` options,
 * including the authenticated `storageState` — which would make an
 * "unauthenticated" test silently authenticated. Clearing it explicitly is the
 * difference between testing the anonymous path and not testing it at all.
 */
async function anonymousContext() {
  return playwrightRequest.newContext({
    baseURL: BASE,
    storageState: { cookies: [], origins: [] },
  });
}

/** Register a fresh user and return a context whose session is that user. */
async function userContext(tag: string) {
  const ctx = await anonymousContext();
  const csrf = (await (await ctx.get("/api/csrf-token")).json()).csrfToken;
  const email = `sec_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e2e.local`;
  const res = await ctx.post("/api/auth/register", {
    data: { email, password: "SecGateTest99!", name: `Sec ${tag}` },
    headers: { "X-CSRF-Token": csrf },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ctx;
}

/**
 * POST with a CSRF token fetched at call time. Registration rotates the session,
 * so a token captured earlier is invalid — this is why the token is not cached.
 */
async function post(ctx: APIRequestContext, url: string, data: unknown) {
  const csrf = (await (await ctx.get("/api/csrf-token")).json()).csrfToken;
  return ctx.post(url, { data, headers: { "X-CSRF-Token": csrf } });
}

test.describe("connected-account credential exposure", () => {
  test("a connected account's raw token never reaches the browser", async ({ page }) => {
    const connect = await post(page.request, "/api/accounts/connect", {
      platform: "threads",
      username: "canary_account",
      accessToken: CANARY_TOKEN,
    });
    expect(connect.ok(), await connect.text()).toBeTruthy();

    // The write path must not echo the credential back either.
    expect(await connect.text()).not.toContain(CANARY_TOKEN);

    const accountBodies: string[] = [];
    const consoleText: string[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/api/accounts")) {
        try {
          accountBodies.push(await res.text());
        } catch {
          /* body not readable for this response */
        }
      }
    });
    page.on("console", (m) => consoleText.push(m.text()));

    await page.goto("/settings");
    await expect(page.getByTestId("tab-accounts")).toBeVisible();

    // The account panel must actually have rendered, or the assertions below
    // would pass vacuously against an empty page. The row must show exactly the
    // mask and nothing else — not a truncation of the real value.
    const tokenRow = page.getByTestId("text-account-token-threads");
    await expect(tokenRow).toBeVisible();
    await expect(tokenRow).toHaveText(MASKED_CANARY);

    // Durable visual evidence for the security gate report.
    await tokenRow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/security-settings-masked-token.png" });

    // 1. Network — the read path.
    expect(accountBodies.length).toBeGreaterThan(0);
    for (const body of accountBodies) expect(body).not.toContain(CANARY_TOKEN);

    // 2. Rendered DOM / HTML.
    const html = await page.content();
    expect(html).not.toContain(CANARY_TOKEN);

    // 3. Client-side persistence.
    const storage = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(storage.local).not.toContain(CANARY_TOKEN);
    expect(storage.session).not.toContain(CANARY_TOKEN);

    // 4. URL / query string.
    expect(page.url()).not.toContain(CANARY_TOKEN);

    // 5. Console / logs.
    expect(consoleText.join("\n")).not.toContain(CANARY_TOKEN);
  });

  test("another user cannot read this account's credential", async () => {
    const owner = await userContext("owner");
    const stranger = await userContext("stranger");
    try {
      const connected = await post(owner, "/api/accounts/connect", {
        platform: "threads",
        username: "owner_only",
        accessToken: CANARY_TOKEN,
      });
      expect(connected.ok(), await connected.text()).toBeTruthy();
      const account = await connected.json();

      const list = await stranger.get("/api/accounts");
      expect(list.ok()).toBeTruthy();
      const listBody = await list.text();
      expect(listBody).not.toContain(CANARY_TOKEN);
      expect(listBody).not.toContain("owner_only");
      expect(JSON.parse(listBody)).toEqual([]);

      // The stranger cannot drive the owner's account even by id.
      const probe = await post(stranger, `/api/accounts/${account.id}/test`, {});
      expect(probe.status()).toBe(404);
      expect(await probe.text()).not.toContain(CANARY_TOKEN);
    } finally {
      await owner.dispose();
      await stranger.dispose();
    }
  });

  test("an unauthenticated caller cannot read connected accounts", async () => {
    const anon = await anonymousContext();
    try {
      const res = await anon.get("/api/accounts");
      expect(res.status()).toBe(401);
      expect(await res.text()).not.toContain(CANARY_TOKEN);
    } finally {
      await anon.dispose();
    }
  });

  test("logout removes access to connected accounts", async () => {
    const ctx = await userContext("logout");
    try {
      expect((await ctx.get("/api/accounts")).ok()).toBeTruthy();

      const out = await post(ctx, "/api/auth/logout", {});
      expect(out.ok(), await out.text()).toBeTruthy();

      const after = await ctx.get("/api/accounts");
      expect(after.status()).toBe(401);
      expect(await after.text()).not.toContain(CANARY_TOKEN);
    } finally {
      await ctx.dispose();
    }
  });
});
