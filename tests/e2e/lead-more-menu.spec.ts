import { expect, test, type Page } from "@playwright/test";

// The "..." next to Call / Text / Email in the lead panel opens on top of the panel (it used to open underneath its backdrop), with real actions, closes on Esc, and writes only through the review sheet.
test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "one desktop run"); });

async function checkMenu(page: Page, where: string) {
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer.getByTestId("drawer-call")).toBeVisible({ timeout: 120_000 });
  const more = drawer.getByTestId("drawer-more");
  await more.click();
  const menu = page.getByTestId("pop-menu");
  await expect(menu, `${where}: menu visible`).toBeVisible();
  // It is the top layer at its own centre (nothing, such as the panel backdrop, sits over it) and inside the window.
  const box = (await menu.boundingBox())!, vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width); expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(await menu.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + 12); return !!t && el.contains(t); }), `${where}: on top`).toBe(true);
  await expect(menu.getByTestId("menu-copy")).toBeVisible();
  // Esc closes the menu only, not the panel.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(drawer).toBeVisible();
  // Add note opens the Update tab at the note box.
  await more.click();
  const note = page.getByTestId("menu-note");
  if (await note.count()) {
    await note.click();
    await expect(drawer.getByTestId("wb-note")).toBeVisible();
    await expect(drawer.locator("[data-testid=wb-note] textarea")).toBeFocused();
    // Do not disturb goes through the review sheet with the consent wording; nothing is sent until it is confirmed.
    await more.click();
    await page.getByTestId("menu-dnd").click();
    await expect(drawer.getByTestId("wb-review")).toBeVisible();
    await expect(drawer.getByTestId("wb-review-quote")).toContainText(/asked not to be contacted|told you it is fine/);
    await drawer.getByRole("button", { name: "Cancel" }).first().click();
  }
  // Outside click closes it.
  await more.click();
  await expect(page.getByTestId("pop-menu")).toBeVisible();
  await page.getByTestId("drawer-name").click();
  await expect(page.getByTestId("pop-menu")).toHaveCount(0);
}

test("the lead panel More menu opens on top and works (from a list)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/app#speed");
  const row = page.getByTestId("speed-row").first();
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.getByRole("button").first().click();
  await checkMenu(page, "speed list");
});

test("the lead panel More menu works when the panel is opened from a popup", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/app#cleanup");
  const client = page.getByTestId("quality-client").first();
  await expect(client).toBeVisible({ timeout: 180_000 });
  await client.getByTestId("quality-open").click();
  const show = page.locator('[data-testid="quality-finding"] [data-testid="finding-show"]').first();
  await expect(show).toBeVisible({ timeout: 180_000 });
  await show.click();
  await expect(page.getByTestId("records-panel")).toBeVisible({ timeout: 180_000 });
  const open = page.getByTestId("records-open").first();
  test.skip(!(await open.count()) || (await open.evaluate((e) => e.tagName)) === "A", "this list has no lead rows to open");
  await open.click({ force: true });
  await checkMenu(page, "popup");
});
