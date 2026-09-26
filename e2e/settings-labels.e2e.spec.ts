import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase 33.6 — /settings accessible labels.
 *
 * 12 controls on /settings shipped with NO accessible name: their visible
 * <label> had no `htmlFor` and the control had no `id`, so `el.labels.length === 0`
 * and `aria-label` was null. axe's `label` rule does NOT flag this (the DOM has a
 * label element; it is simply not associated), so these assertions are the
 * authoritative check — axe is run afterwards only to prove no regression.
 *
 * Fix mirrors client/src/components/create/create-studio.tsx: <label htmlFor> + matching
 * <input id>. The 5 Messaging-pillar inputs share one group label, so each carries its
 * own explicit `aria-label`. Placeholder text is never used as the label.
 */

const BRAND_PROFILE_CONTROLS: Array<{ testId: string; name: string }> = [
  { testId: "textarea-brand-voice", name: "Brand Voice" },
  { testId: "textarea-writing-style", name: "Writing Style Notes" },
  { testId: "textarea-audience", name: "Target Audience" },
  { testId: "textarea-content-goals", name: "Content Goals" },
  { testId: "input-niche", name: "Niche / Expertise" },
  { testId: "input-pillar-0", name: "Messaging pillar 1" },
  { testId: "input-pillar-1", name: "Messaging pillar 2" },
  { testId: "input-pillar-2", name: "Messaging pillar 3" },
  { testId: "input-pillar-3", name: "Messaging pillar 4" },
  { testId: "input-pillar-4", name: "Messaging pillar 5" },
];

const CONNECT_DIALOG_CONTROLS: Array<{ testId: string; name: string }> = [
  { testId: "input-connect-username", name: "Username" },
  { testId: "input-connect-token", name: "Access Token" },
];

test.describe("settings accessible labels (Phase 33.6)", () => {
  test("every Brand Profile control exposes a non-empty accessible name", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("text-settings-title")).toBeVisible();
    await page.getByTestId("tab-brand-profile").click();

    // The headline requirement: a role+name query must resolve.
    await expect(page.getByRole("textbox", { name: "Brand Voice" })).toBeVisible();

    for (const { testId, name } of BRAND_PROFILE_CONTROLS) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      await expect(control).toHaveAccessibleName(name);
    }

    // No control may fall back to relying on its placeholder.
    for (const { testId } of BRAND_PROFILE_CONTROLS) {
      const placeholder = await page.getByTestId(testId).getAttribute("placeholder");
      const accessibleName = await page.getByTestId(testId).evaluate((el) =>
        (el.getAttribute("aria-label") ?? "") ||
        (el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "") : ""),
      );
      expect(accessibleName.trim().length).toBeGreaterThan(0);
      expect(accessibleName.trim()).not.toBe((placeholder ?? "").trim());
    }
  });

  test("every Connect dialog control exposes a non-empty accessible name", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("text-settings-title")).toBeVisible();

    // A freshly registered E2E user has no connected accounts, so each platform
    // card renders a "Connect" button that opens the dialog.
    await page.getByTestId("button-connect-threads").click();
    await expect(page.getByTestId("input-connect-username")).toBeVisible();

    for (const { testId, name } of CONNECT_DIALOG_CONTROLS) {
      const control = page.getByTestId(testId);
      await expect(control).toBeVisible();
      await expect(control).toHaveAccessibleName(name);
    }

    // The label associations must be real (htmlFor <-> id), not just aria-label.
    for (const { testId } of CONNECT_DIALOG_CONTROLS) {
      const labelled = await page.getByTestId(testId).evaluate((el) => {
        const id = el.getAttribute("id");
        return !!id && !!document.querySelector(`label[for="${CSS.escape(id)}"]`);
      });
      expect(labelled).toBe(true);
    }
  });

  test("all 12 controls have a non-empty accessible name (aggregate)", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("text-settings-title")).toBeVisible();
    await page.getByTestId("tab-brand-profile").click();

    const total = BRAND_PROFILE_CONTROLS.length + CONNECT_DIALOG_CONTROLS.length;
    expect(total).toBe(12);

    const missing: string[] = [];
    for (const { testId, name } of BRAND_PROFILE_CONTROLS) {
      const handle = page.getByTestId(testId);
      const computed = await handle.evaluate((el) => {
        const id = el.getAttribute("id");
        const fromLabel = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? ""
          : "";
        return (el.getAttribute("aria-label") ?? "").trim() || fromLabel;
      });
      if (!computed || computed !== name) missing.push(`${testId} (got "${computed}")`);
    }

    if (missing.length) {
      // Surfaces the dialog controls too, so the aggregate names all offenders.
      await page.getByTestId("button-connect-threads").click();
      for (const { testId, name } of CONNECT_DIALOG_CONTROLS) {
        const computed = await page.getByTestId(testId).evaluate((el) => {
          const id = el.getAttribute("id");
          const fromLabel = id
            ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? ""
            : "";
          return (el.getAttribute("aria-label") ?? "").trim() || fromLabel;
        });
        if (!computed || computed !== name) missing.push(`${testId} (got "${computed}")`);
      }
    }
    expect(missing, `unnamed controls: ${missing.join(", ")}`).toEqual([]);
  });

  test("axe (full rule set) reports no regression on /settings", async ({ page }) => {
    // Settle Radix enter animations first: axe may sample the dialog mid-fade and
    // mis-report color-contrast while the content is translucent. The app honors
    // prefers-reduced-motion, so this yields the true settled result.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings");
    await expect(page.getByTestId("text-settings-title")).toBeVisible();

    const brandTab = await new AxeBuilder({ page }).analyze();
    expect(
      brandTab.violations.map((v) => v.id),
      JSON.stringify(brandTab.violations, null, 2),
    ).toEqual([]);

    await page.getByTestId("tab-brand-profile").click();
    const brandProfile = await new AxeBuilder({ page }).analyze();
    expect(
      brandProfile.violations.map((v) => v.id),
      JSON.stringify(brandProfile.violations, null, 2),
    ).toEqual([]);

    await page.getByTestId("tab-accounts").click();
    await page.getByTestId("button-connect-threads").click();
    await expect(page.getByTestId("input-connect-username")).toBeVisible();
    const connectDialog = await new AxeBuilder({ page }).analyze();
    expect(
      connectDialog.violations.map((v) => v.id),
      JSON.stringify(connectDialog.violations, null, 2),
    ).toEqual([]);
  });
});
