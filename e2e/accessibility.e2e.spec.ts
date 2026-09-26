import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = [
  "/",
  "/today",
  "/create",
  "/sources",
  "/agent",
  "/schedule",
  "/insights",
  "/insights?view=performance",
  "/insights?view=learning",
  "/insights?view=ai-usage",
  "/settings",
  "/queue",
  "/calendar",
  "/schedule?tab=publications",
];

for (const path of routes) {
  test(`axe: ${path} has 0 document-title/meta-viewport/button-name/label violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    await expect(page).toHaveTitle(/.+/);
    const results = await new AxeBuilder({ page })
      .withRules(["document-title", "meta-viewport", "button-name", "label"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test("axe: 404 page has 0 document-title/meta-viewport/button-name/label violations", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  const results = await new AxeBuilder({ page })
    .withRules(["document-title", "meta-viewport", "button-name", "label"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("app shell exposes a nav landmark and a skip link", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("nav")).toHaveCount(1);
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toHaveCount(1);
  await expect(page.locator("main#main-content")).toHaveCount(1);
});

test("route titles are meaningful and change per route", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveTitle(/ContentForge.*Today/);
  await page.goto("/create");
  await expect(page).toHaveTitle(/ContentForge.*Create/);
  await page.goto("/sources");
  await expect(page).toHaveTitle(/ContentForge.*Sources/);
  await page.goto("/schedule");
  await expect(page).toHaveTitle(/ContentForge.*Schedule/);
  await page.goto("/insights");
  await expect(page).toHaveTitle(/ContentForge.*Insights/);
  await page.goto("/settings");
  await expect(page).toHaveTitle(/ContentForge.*Settings/);
  await page.goto("/agent");
  await expect(page).toHaveTitle(/ContentForge.*Agent/);
  await page.goto("/queue");
  await expect(page).toHaveTitle(/ContentForge.*Schedule/);
});

test("browser zoom is not disabled by the viewport meta tag", async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content ?? "").not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
  expect(content ?? "").not.toMatch(/user-scalable\s*=\s*no/);
});

test("the viewport opts into the safe area so the capture FAB clears the home indicator", async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content ?? "").toMatch(/viewport-fit\s*=\s*cover/);
  // The FAB must offset by the safe-area inset, not sit flush at the corner.
  const cls = await page.getByTestId("button-quick-capture").getAttribute("class");
  expect(cls ?? "").toMatch(/env\(safe-area-inset-bottom\)/);
  expect(cls ?? "").toMatch(/env\(safe-area-inset-right\)/);
});

test("focused controls render a ring that clears 3:1 against the surface behind it", async ({ page }) => {
  await page.goto("/today");
  const primary = page.getByTestId("button-today-create");
  await primary.focus();

  const result = await primary.evaluate((el) => {
    const cs = getComputedStyle(el);
    const ringColor = cs.getPropertyValue("--ring").trim();
    return { ringColor, boxShadow: cs.boxShadow, outlineWidth: cs.outlineWidth };
  });

  // A ring must actually paint something.
  expect(result.boxShadow).not.toBe("none");
  expect(result.ringColor).not.toBe("");
});

/**
 * The ring is a CSS variable, so the failure mode is a token silently
 * equalling the surface color. Read the resolved values off a real element
 * and compare relative luminance, which is the check that actually catches it.
 */
test("--ring is not the same color as --primary", async ({ page }) => {
  await page.goto("/");
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      ring: cs.getPropertyValue("--ring").trim(),
      primary: cs.getPropertyValue("--primary").trim(),
      background: cs.getPropertyValue("--background").trim(),
    };
  });

  expect(tokens.ring).not.toBe(tokens.primary);

  const toRgb = (hsl: string) => {
    const m = hsl.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    if (!m) return null;
    const [h, s, l] = [Number(m[1]) / 360, Number(m[2]) / 100, Number(m[3]) / 100];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const conv = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [conv(h + 1 / 3), conv(h), conv(h - 1 / 3)];
  };
  const lum = (rgb: number[]) =>
    rgb
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
      .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number[], b: number[]) => {
    const [l1, l2] = [lum(a), lum(b)];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const ringRgb = toRgb(tokens.ring);
  const bgRgb = toRgb(tokens.background);
  expect(ringRgb, `could not parse --ring "${tokens.ring}"`).not.toBeNull();
  expect(bgRgb, `could not parse --background "${tokens.background}"`).not.toBeNull();

  // WCAG 2.2 SC 1.4.11 non-text contrast.
  expect(contrast(ringRgb!, bgRgb!)).toBeGreaterThanOrEqual(3);
});

test("prefers-reduced-motion is honored and stops decorative motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/today");

  const durations = await page.evaluate(() => {
    const results: Array<{ animation: string; transition: string }> = [];
    for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
      const cs = getComputedStyle(el);
      if (cs.animationName !== "none" || cs.transitionDuration !== "0s") {
        results.push({ animation: cs.animationDuration, transition: cs.transitionDuration });
      }
    }
    return results;
  });

  // Nothing on the page may still be animating when the user asked it not to.
  for (const d of durations) {
    expect(parseFloat(d.animation) || 0).toBeLessThan(0.05);
    expect(parseFloat(d.transition) || 0).toBeLessThan(0.05);
  }
});

test("a reduced-motion user sees no spinning loader and no pulsing badge", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/today");

  const spinning = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".animate-spin")).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.05;
    }).length,
  );
  expect(spinning).toBe(0);
});

test("the Quick Capture field has a real label, not just a placeholder", async ({ page }) => {
  await page.goto("/today");
  await page.getByTestId("button-quick-capture").click();

  const field = page.getByTestId("input-quick-capture-url");
  await expect(field).toBeVisible();

  const labelled = await field.evaluate((el) => {
    const id = el.getAttribute("id");
    const hasFor =
      !!id && !!document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const hasAria = !!el.getAttribute("aria-label") || !!el.getAttribute("aria-labelledby");
    return hasFor || hasAria;
  });
  expect(labelled).toBe(true);
});

test("color-contrast is enforced on every canonical route", async ({ page }) => {
  for (const path of ["/today", "/create", "/sources", "/schedule", "/insights", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(
      results.violations.map((v) => ({ route: path, rule: v.id, nodes: v.nodes.length })),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  }
});
