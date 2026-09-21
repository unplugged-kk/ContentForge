import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.join(__dirname, ".auth");
const authFile = path.join(authDir, "user.json");

setup.describe.configure({ mode: "serial" });

setup("register (or login) and persist session", async ({ request }) => {
  fs.mkdirSync(authDir, { recursive: true });

  const email =
    process.env.E2E_USER_EMAIL ??
    `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}@e2e.local`;
  const password = process.env.E2E_USER_PASSWORD ?? "E2ETestPass99!";
  const name = "Playwright E2E";

  let res = await request.post("/api/auth/register", {
    data: { email, password, name },
  });

  if (!res.ok()) {
    if (res.status() === 409) {
      res = await request.post("/api/auth/login", { data: { email, password } });
    } else {
      const body = await res.text();
      throw new Error(`Auth setup failed: POST /api/auth/register → ${res.status()} ${body}`);
    }
  }

  expect(res.ok(), await res.text()).toBeTruthy();
  await request.storageState({ path: authFile });
});
