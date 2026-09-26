import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 33.6 — dialog focus restoration.
 *
 * Radix restores focus on close only when a dialog is opened through its own
 * `Trigger`: `DialogContent`/`AlertDialogContent` call `event.preventDefault()`
 * and then focus `triggerRef`, which is `null` for the controlled dialogs this
 * app opens from plain buttons. Radix's own `previouslyFocusedElement` fallback
 * is skipped because the default was prevented, so focus landed on `<body>`.
 *
 * These tests assert, via `document.activeElement`, that closing a dialog
 * returns focus to the control that opened it.
 */

const VAULT_ITEM = {
  id: 99,
  title: "Focus restoration probe",
  content: "Body",
  category: null,
  tags: null,
  sourceUrl: null,
  createdAt: new Date().toISOString(),
};

/** `data-testid` of the currently focused element, or `null` for `<body>`. */
async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
}

async function expectFocusTestId(page: Page, testId: string) {
  await expect
    .poll(() => activeTestId(page), { timeout: 5_000 })
    .toBe(testId);
}

/**
 * Saved-tab reads. The vault list always contains the same item so the opener
 * survives a confirmed delete too, isolating the focus behaviour under test.
 */
async function mockSavedTab(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route("**/api/vault", (route) =>
    route.request().method() === "GET" ? route.fulfill(json([VAULT_ITEM])) : route.fulfill(json({})),
  );
  await page.route("**/api/vault/99", (route) => route.fulfill(json({})));
  await page.route("**/api/ideas", (route) => route.fulfill(json([])));
  await page.route("**/api/references", (route) => route.fulfill(json([])));
  await page.route("**/api/research/**", (route) => route.fulfill(json([])));
  await page.route("**/api/research/capabilities", (route) =>
    route.fulfill(json({ providers: [], last30days: {}, openseo: {} })),
  );
}

const QUICK_CAPTURE_BUTTON = '[data-testid="button-quick-capture"]';
const QUICK_CAPTURE_DIALOG = '[data-testid="dialog-quick-capture"]';
const CONFIRM_DIALOG = '[data-testid="dialog-confirm"]';
const DELETE_VAULT_BUTTON = '[data-testid^="button-delete-saved-vault-"]';

test.describe("Phase 33.6 — dialog focus restoration", () => {
  test("dialog: Escape restores focus to a keyboard-activated opener", async ({ page }) => {
    await page.goto("/today");
    const opener = page.locator(QUICK_CAPTURE_BUTTON);
    await opener.focus();
    await expect(opener).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator(QUICK_CAPTURE_DIALOG)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(QUICK_CAPTURE_DIALOG)).toBeHidden();

    await expectFocusTestId(page, "button-quick-capture");
    await expect(opener).toBeFocused();
  });

  test("dialog: the close control restores focus to a mouse-activated opener", async ({ page }) => {
    await page.goto("/today");
    const opener = page.locator(QUICK_CAPTURE_BUTTON);
    await opener.click();
    await expect(page.locator(QUICK_CAPTURE_DIALOG)).toBeVisible();

    await page
      .locator(QUICK_CAPTURE_DIALOG)
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.locator(QUICK_CAPTURE_DIALOG)).toBeHidden();

    await expectFocusTestId(page, "button-quick-capture");
    await expect(opener).toBeFocused();
  });

  test("alert dialog: explicit cancel restores focus to its opener", async ({ page }) => {
    await mockSavedTab(page);
    await page.goto("/sources?view=vault");

    const opener = page.locator(DELETE_VAULT_BUTTON);
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.locator(CONFIRM_DIALOG)).toBeVisible();

    await page.locator('[data-testid="button-confirm-cancel"]').click();
    await expect(page.locator(CONFIRM_DIALOG)).toBeHidden();

    await expectFocusTestId(page, "button-delete-saved-vault-99");
    await expect(opener).toBeFocused();
  });

  test("alert dialog: explicit confirm restores focus to its opener", async ({ page }) => {
    await mockSavedTab(page);
    await page.goto("/sources?view=vault");

    const opener = page.locator(DELETE_VAULT_BUTTON);
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.locator(CONFIRM_DIALOG)).toBeVisible();

    await page.locator('[data-testid="button-confirm-action"]').click();
    await expect(page.locator(CONFIRM_DIALOG)).toBeHidden();

    await expectFocusTestId(page, "button-delete-saved-vault-99");
    await expect(opener).toBeFocused();
  });

  test("nested dialog: closing the stacked dialog returns focus to the dialog beneath", async ({ page }) => {
    await mockSavedTab(page);
    await page.goto("/sources?view=vault");

    // The confirm dialog is the lower dialog; its own opener is the delete button.
    const opener = page.locator(DELETE_VAULT_BUTTON);
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.locator(CONFIRM_DIALOG)).toBeVisible();
    await expect(page.locator('[data-testid="button-confirm-cancel"]')).toBeFocused();

    // The global Quick Capture dialog can open over any open dialog (its window
    // event is how Today's quick actions and Sources' header button reach it).
    await page.evaluate(() => window.dispatchEvent(new Event("contentforge:open-quick-capture")));
    await expect(page.locator(QUICK_CAPTURE_DIALOG)).toBeVisible();

    // Closing the top dialog restores focus inside the dialog still open.
    await page.keyboard.press("Escape");
    await expect(page.locator(QUICK_CAPTURE_DIALOG)).toBeHidden();
    await expect(page.locator(CONFIRM_DIALOG)).toBeVisible();
    await expectFocusTestId(page, "button-confirm-cancel");

    // Closing the lower dialog then returns focus to the original opener.
    await page.keyboard.press("Escape");
    await expect(page.locator(CONFIRM_DIALOG)).toBeHidden();
    await expectFocusTestId(page, "button-delete-saved-vault-99");
    await expect(opener).toBeFocused();
  });
});
