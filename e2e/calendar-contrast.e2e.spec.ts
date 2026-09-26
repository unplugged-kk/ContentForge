import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase 33.7 — Calendar tab text contrast.
 *
 * The Calendar view (the "Calendar" tab inside `/schedule`) shipped an
 * `opacity-40` class on the adjacent-month day cells. Opacity dims the cell's
 * own text, so the day numerals (`text-muted-foreground`) measured 1.89:1 in
 * light and 2.23:1 in dark — below WCAG 2.2 SC 1.4.3 (4.5:1) in BOTH themes.
 * The today numeral additionally used `text-primary`, which is a single
 * `217 91% 48%` blue in both themes; on the dark `--card` (#1a1a1a) it measured
 * only 3.21:1.
 *
 * These tests pin the corrected rendering: de-emphasis is now carried by
 * colour (full `text-foreground` for in-month days, `text-muted-foreground`
 * for adjacent-month days), never by `opacity`. We assert the measured ratio of
 * the real elements and run the FULL axe rule set in both themes.
 */

const MONTH_WITH_ADJACENT_DAYS = new Date("2026-06-15T12:00:00Z"); // June 2026 — grid starts in May and ends in July.

interface Measured {
  text: string;
  today: boolean;
  currentMonth: boolean;
  color: string;
  background: string;
  opacity: number;
  ratio: number;
}

/**
 * Measure the real composited foreground/background contrast of every calendar
 * day numeral on the page. Backgrounds are composited from the document root
 * down so a translucent surface (or any ancestor `opacity`) is accounted for.
 */
async function measureDayNumerals(page: Page): Promise<Measured[]> {
  return page.evaluate(() => {
    const parseColor = (s: string) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number; a: number }) => ({
      r: fg.a * fg.r + (1 - fg.a) * bg.r,
      g: fg.a * fg.g + (1 - fg.a) * bg.g,
      b: fg.a * fg.b + (1 - fg.a) * bg.b,
      a: 1,
    });
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (c: number) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: ReturnType<typeof parseColor>, b: ReturnType<typeof parseColor>) => {
      const l1 = lum(a!);
      const l2 = lum(b!);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const result: Measured[] = [];
    const cells = Array.from(document.querySelectorAll('[data-testid="text-calendar-day"]'));
    for (const el of cells) {
      const cs = getComputedStyle(el);
      const fgRaw = parseColor(cs.color);
      if (!fgRaw) continue;

      const chain: Element[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === 1) {
        chain.push(node);
        node = node.parentElement;
      }
      chain.reverse();

      let bg = { r: 255, g: 255, b: 255, a: 1 };
      let opacity = 1;
      for (const n of chain) {
        const ncs = getComputedStyle(n);
        const c = parseColor(ncs.backgroundColor);
        if (c && c.a > 0) bg = over(c, bg);
        opacity *= parseFloat(ncs.opacity || "1");
      }
      const fg = over({ ...fgRaw, a: fgRaw.a * opacity }, bg);
      result.push({
        text: (el.textContent || "").trim(),
        today: el.getAttribute("data-day-today") === "true",
        currentMonth: el.getAttribute("data-day-current-month") === "true",
        color: cs.color,
        background: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        opacity: Number(opacity.toFixed(3)),
        ratio: Number(ratio(fg, bg).toFixed(2)),
      });
    }
    return result;
  });
}

async function openCalendar(page: Page, theme: "light" | "dark") {
  await page.clock.setFixedTime(MONTH_WITH_ADJACENT_DAYS);
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto("/schedule?tab=calendar");
  await expect(page.getByTestId("text-current-month")).toHaveText("June 2026");
  await expect(page.getByTestId("tabs-schedule-views")).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`Calendar contrast — ${theme} theme`, () => {
    test("adjacent-month and today day numerals clear 4.5:1 and are not dimmed by opacity", async ({ page }) => {
      await openCalendar(page, theme);
      const measured = await measureDayNumerals(page);

      const adjacent = measured.filter((m) => !m.currentMonth);
      const inMonth = measured.filter((m) => m.currentMonth && !m.today);
      const today = measured.find((m) => m.today);

      // The fixture month must actually exercise adjacent-month cells.
      expect(adjacent.length, "expected adjacent-month day cells in June 2026").toBeGreaterThan(0);
      expect(today, "expected a today marker in June 2026").toBeTruthy();

      // Regression guard: no cell may reintroduce the opacity dimming.
      for (const m of [...adjacent, ...inMonth, ...(today ? [today] : [])]) {
        expect(m.opacity, `"${m.text}" is dimmed by an ancestor opacity`).toBe(1);
      }

      const threshold = 4.5; // 12px, weight 400–600 → normal text.
      const worst = (rows: Measured[]) => Math.min(...rows.map((r) => r.ratio));

      const adjacentWorst = worst(adjacent);
      expect(
        adjacentWorst,
        `adjacent-month numerals: ${JSON.stringify(adjacent)}`,
      ).toBeGreaterThanOrEqual(threshold);

      const inMonthWorst = worst(inMonth);
      expect(inMonthWorst, `in-month numerals: ${JSON.stringify(inMonth)}`).toBeGreaterThanOrEqual(threshold);

      expect(today!.ratio, `today numeral ${JSON.stringify(today)}`).toBeGreaterThanOrEqual(threshold);
    });

    test("full axe rule set reports no violations on the Calendar tab", async ({ page }) => {
      await openCalendar(page, theme);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        JSON.stringify(results.violations, null, 2),
      ).toEqual([]);
    });
  });
}
