import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against the **production bundle** (`npm run build` → `dist/` + `server/public/`).
 * Requires PostgreSQL (`DATABASE_URL`) — same as the app.
 *
 * Local: `npm run build:verify`
 * CI: see `.github/workflows/e2e.yml`
 *
 * Session cookies: `SESSION_COOKIE_SECURE=0` so Playwright can authenticate over http://127.0.0.1
 * (see `server/index.ts` session `secure` flag).
 */
const port = process.env.E2E_PORT ?? "4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

const isCi = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  /** CI: GitHub annotations + HTML + JUnit for artifacts; local: list + HTML */
  reporter: isCi
    ? [
        ["list"],
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["junit", { outputFile: "test-results/e2e-junit.xml" }],
      ]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: [/auth\.setup\.ts$/, /api\.e2e\.spec\.ts$/],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      name: "api",
      testMatch: /api\.e2e\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run e2e:serve`,
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: port,
      DISABLE_CRON: "1",
      SESSION_COOKIE_SECURE: "0",
      /** Lets server/ai/config.ts boot without OPENAI_API_KEY (E2E does not call AI). */
      CONTENTFORGE_E2E_SERVER: "1",
    },
  },
});
