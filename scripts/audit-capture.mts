/**
 * Design-audit capture, chunked so Chromium never coexists with itself.
 * Each invocation captures a slice of the matrix and exits, freeing memory.
 *
 * Usage: node --import tsx scripts/audit-capture.mts <chunk>
 *   chunk = "auth" | "vp:<width>" | "dark" | "measure" | "focus"
 */
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const OUT = process.env.AUDIT_OUT!;
const AUTH_STATE = path.join(OUT, "auth-state.json");
const CHUNK = process.argv[2] ?? "auth";

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  "1440": { width: 1440, height: 900 },
  "1280": { width: 1280, height: 800 },
  "1024": { width: 1024, height: 768 },
  "820": { width: 820, height: 1180 },
  "768": { width: 768, height: 1024 },
  "430": { width: 430, height: 932 },
  "390": { width: 390, height: 844 },
  "320": { width: 320, height: 640 },
};

const ROUTES = [
  { name: "today", path: "/today" },
  { name: "create", path: "/create" },
  { name: "sources", path: "/sources" },
  { name: "agent", path: "/agent" },
  { name: "schedule", path: "/schedule" },
  { name: "insights", path: "/insights" },
  { name: "insights-ai-usage", path: "/insights?view=ai-usage" },
  { name: "settings", path: "/settings" },
  { name: "queue", path: "/queue" },
  { name: "generate", path: "/generate" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Browser-side code is passed as a string; esbuild's __name helper never applies. */
async function inPage(page: Page, body: string) {
  return page.evaluate(`(${body})()`);
}

async function launch(): Promise<ReturnType<typeof chromium.launch>> {
  return chromium.launch({
    args: ["--disable-dev-shm-usage", "--renderer-process-limit=1", "--js-flags=--max-old-space-size=256"],
  });
}

function state(): any {
  return { storageState: AUTH_STATE };
}

async function captureRoutes(page: Page, prefix: string) {
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r.path}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, `${prefix}__${r.name}.png`), fullPage: true });
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();

  if (CHUNK === "auth") {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const email = process.env.AUDIT_EMAIL!;
    const password = "AuditPass99!";
    let res = await ctx.request.post(`${BASE}/api/auth/register`, {
      data: { email, password, name: "Kishore Kumar Behera" },
    });
    if (res.status() === 409) {
      res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
    }
    console.log("auth:", res.status());
    await ctx.storageState({ path: AUTH_STATE });
    await ctx.close();
  }

  if (CHUNK.startsWith("vp:")) {
    const key = CHUNK.slice(3);
    const vp = VIEWPORTS[key];
    const ctx = await browser.newContext({ ...state(), viewport: vp, deviceScaleFactor: 2 });
    await captureRoutes(await ctx.newPage(), `${key}x${vp.height}`);
    await ctx.close();
  }

  if (CHUNK === "dark") {
    const ctx = await browser.newContext({
      ...state(),
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
      deviceScaleFactor: 2,
    });
    await captureRoutes(await ctx.newPage(), "dark-1440x900");
    await ctx.close();
  }

  if (CHUNK === "measure") {
    const MEASURE = `(function () {
      const de = document.documentElement;
      const cs = getComputedStyle(de);
      const pick = (v) => cs.getPropertyValue(v).trim();
      const overflowPx = de.scrollWidth - de.clientWidth;

      const wide = [];
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1)) {
          wide.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 70) +
            ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
        }
      }

      const small = [];
      const unnamed = [];
      const interactive = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]');
      for (const el of interactive) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') ||
          (el.textContent || '').trim() || el.getAttribute('placeholder') || '').trim();
        const id = el.tagName.toLowerCase() + (el.getAttribute('href') ? '[href]' : '') + '."' +
          String(el.className).slice(0, 45) + '"';
        if (r.width < 44 || r.height < 44) {
          small.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + name.slice(0, 30) + '"');
        }
        if (!name && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')) unnamed.push(id);
      }

      const headings = [];
      document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
        headings.push(h.tagName + ' "' + (h.textContent || '').trim().slice(0, 45) + '"');
      });

      const fontSizes = {};
      for (const el of document.querySelectorAll('*')) {
        if (!el.childNodes.length) continue;
        let hasText = false;
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) hasText = true;
        if (!hasText) continue;
        const fs = Math.round(parseFloat(getComputedStyle(el).fontSize));
        fontSizes[fs] = (fontSizes[fs] || 0) + 1;
      }

      return {
        overflowPx,
        tokens: {
          primary: pick('--primary'), ring: pick('--ring'),
          background: pick('--background'), foreground: pick('--foreground'),
          muted: pick('--muted-foreground'), border: pick('--border'),
          shadowSm: pick('--shadow-sm'), shadowMd: pick('--shadow-md'), shadowLg: pick('--shadow-lg'),
          chart1: pick('--chart-1'), chart2: pick('--chart-2'), chart3: pick('--chart-3'),
          chart4: pick('--chart-4'), chart5: pick('--chart-5'),
        },
        overflowing: wide.slice(0, 10),
        smallTargets: { count: small.length, sample: small.slice(0, 14) },
        unnamedButtons: unnamed.slice(0, 12),
        headings: headings.slice(0, 28),
        fontSizeHistogram: fontSizes,
        landmarks: {
          main: document.querySelectorAll('main').length,
          nav: document.querySelectorAll('nav').length,
          h1: document.querySelectorAll('h1').length,
          skipLink: !!document.querySelector('a[href="#main-content"]'),
        },
        liveRegions: document.querySelectorAll('[aria-live], [role="status"], [role="alert"]').length,
        textLength: document.body.innerText.length,
        cards: document.querySelectorAll('[class*="rounded-"][class*="border"]').length,
      };
    })`;

    const ctx = await browser.newContext({ ...state(), viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const out: Record<string, unknown> = {};
    for (const r of ROUTES) {
      await page.goto(`${BASE}${r.path}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await sleep(700);
      out[r.path] = await inPage(page, MEASURE);
    }
    fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(out, null, 2));

    // narrow-viewport overflow sweep
    const narrow: Record<string, unknown> = {};
    for (const key of ["390", "320"]) {
      const vp = VIEWPORTS[key];
      const nctx = await browser.newContext({ ...state(), viewport: vp });
      const npage = await nctx.newPage();
      for (const r of ROUTES) {
        await npage.goto(`${BASE}${r.path}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
        await sleep(500);
        narrow[`${vp.width}px ${r.path}`] = await inPage(
          npage,
          `(function(){const de=document.documentElement;const o=[];for(const el of document.querySelectorAll('*')){const r=el.getBoundingClientRect();if(r.width>0&&(r.right>de.clientWidth+1||r.left<-1)){o.push(el.tagName.toLowerCase()+'.'+String(el.className).slice(0,60)+' ['+Math.round(r.left)+'..'+Math.round(r.right)+']');}}return{overflowPx:de.scrollWidth-de.clientWidth,elems:o.slice(0,6)};})`,
        );
      }
      await nctx.close();
    }
    fs.writeFileSync(path.join(OUT, "overflow.json"), JSON.stringify(narrow, null, 2));
    await ctx.close();
  }

  if (CHUNK === "focus") {
    const ctx = await browser.newContext({ ...state(), viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/today`, { waitUntil: "networkidle" });
    await sleep(800);

    // Tab until a filled (primary) button is focused, then capture its real indicator.
    const seen: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await inPage(
        page,
        `(function(){const a=document.activeElement;if(!a||a===document.body)return null;const cs=getComputedStyle(a);return{tag:a.tagName,label:((a.getAttribute('aria-label')||a.textContent||'').trim()).slice(0,30),bg:cs.backgroundColor,outline:cs.outline,boxShadow:cs.boxShadow.slice(0,80),className:String(a.className).slice(0,90)};})`,
      );
      if (!info) break;
      seen.push(info);
      const filled = (info as any).bg && (info as any).bg !== "rgba(0, 0, 0, 0)";
      if (filled) {
        await page.screenshot({ path: path.join(OUT, "focus-filled-button.png") });
      }
    }
    fs.writeFileSync(path.join(OUT, "focus-tab-order.json"), JSON.stringify(seen, null, 2));
    await ctx.close();
  }

  await browser.close();
  console.log("chunk done:", CHUNK);
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e);
  process.exit(1);
});
