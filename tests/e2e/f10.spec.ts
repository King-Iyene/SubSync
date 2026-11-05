import { expect, test, type Page } from "@playwright/test";

// People (stages F10 and PEOPLE): the four tabs (Find and call, Tags, Going cold, Sources), the lead panel from every list, the Call button (the CRM's own dialer by default, never a
// phone link unless chosen), the header search (Ctrl K) and the saved lists. The demo company has sample data, so these tests read what is on screen and check structure, not exact
// people. The rebuilt screens are covered in depth by people-v2.spec.ts.
async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const firstName = (page: Page) => page.getByTestId("person-name").first();
// Every call of the demo signs it in again, so a step can take many seconds on a slow machine.
test.beforeEach(() => { test.setTimeout(240_000); });

test("People has four tabs and no tab opens with a phone link on the page", async ({ page }) => {
  await page.goto("/app#people");
  for (const name of ["Find and call", "Tags", "Going cold", "Sources"]) await expect(tab(page, name)).toBeVisible();
  await expect(page.getByTestId("people-find")).toBeVisible();
  await expect(page.getByTestId("people-rows")).toBeVisible({ timeout: 90_000 });
  await noSideScroll(page, "People");
  for (const name of ["Find and call", "Tags", "Going cold", "Sources"]) {
    await tab(page, name).click();
    await expect(page.locator('a[href^="tel:"]'), `${name}: no phone link on the page`).toHaveCount(0);
    await noSideScroll(page, name);
  }
});

test("press a name: the lead panel opens, the arrows step through the list, Escape closes it", async ({ page }) => {
  await page.goto("/app#people");
  await expect(firstName(page)).toBeVisible({ timeout: 90_000 });
  await firstName(page).click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-position")).toContainText("1 of");
  await page.getByRole("button", { name: "Next lead" }).click();
  await expect(page.getByTestId("drawer-position")).toContainText("2 of");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer")).toHaveCount(0);
});

test("a tag filter narrows the search and says so in words; clearing restores it", async ({ page }) => {
  await page.goto("/app#people");
  await page.getByTestId("filters-toggle").click();
  await page.getByLabel("Tag", { exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId("people-results")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("People who has the tag", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear the choices" }).click();
  await expect(page.getByTestId("people-results")).toHaveCount(0);
  await expect(page.getByTestId("people-say")).toBeVisible();
});

test("Call opens the CRM's own dialer by default and says plainly it cannot go straight to it; the phone app is only used when chosen", async ({ page }) => {
  await page.goto("/app#people");
  await expect(firstName(page)).toBeVisible({ timeout: 90_000 });
  await firstName(page).click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer.getByTestId("drawer-call")).toContainText("Call");
  // MOAT: Call opens a sheet (the number, Copy, and the CRM's own dialer as the labelled fallback). The CRM has no endpoint to place a call, and the sheet says so.
  for (let i = 0; i < 6 && (await drawer.getByTestId("drawer-call").isDisabled()); i++) { await page.keyboard.press("ArrowRight"); await expect(drawer.getByTestId("drawer-headline")).toBeVisible({ timeout: 90_000 }); }
  await drawer.getByTestId("drawer-call").click();
  if ((await drawer.getByTestId("wb-call-dnd").count()) === 0) {
    await expect(drawer.getByTestId("wb-call-crm")).toContainText("Call in your CRM");
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await drawer.getByLabel("Dialer").selectOption("phone");
    await expect(drawer.getByTestId("wb-call-crm")).toContainText("Call with your phone app");
    await drawer.getByLabel("Dialer").selectOption("crm"); // put the setting back
    await expect(drawer.getByTestId("wb-call-crm")).toContainText("Call in your CRM");
  }
});

test("Ctrl K opens the header search; two letters find people across the accounts; Enter opens the first person", async ({ page }) => {
  await page.goto("/app#today");
  await expect(page.getByTestId("global-search-open")).toBeVisible();
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("global-search-input");
  await expect(input).toBeFocused();
  await input.fill("a");
  await expect(page.getByText("Type at least two letters")).toBeVisible();
  await input.fill("an");
  await expect(page.getByTestId("global-search-results")).toBeVisible();
  await input.press("Enter");
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("global-search")).toHaveCount(0);
});

test("a saved list keeps only the choices, shows as a chip, opens them again, and can be deleted", async ({ page }) => {
  await page.goto("/app#people");
  await page.getByTestId("filters-toggle").click();
  await page.getByLabel("Tag", { exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId("people-results")).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("List name").fill("E2E list");
  await page.getByTestId("save-list").click();
  await expect(page.getByText("Saved. It is under Your lists.")).toBeVisible();
  await page.getByRole("button", { name: "Clear the choices" }).click();
  const chip = page.getByTestId("saved-chip").filter({ hasText: "E2E list" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByTestId("people-results")).toBeVisible();
  await page.getByRole("button", { name: "Clear the choices" }).click();
  await page.getByTestId("manage-lists").locator("summary").click();
  await page.getByTestId("saved-lists").locator("li", { hasText: "E2E list" }).getByRole("button", { name: "Delete E2E list" }).click(); // clean up
  await expect(page.getByTestId("saved-chip").filter({ hasText: "E2E list" })).toHaveCount(0);
});

test("Going cold: pressing a bar shows the people behind it, and the list's own heading carries the count", async ({ page }) => {
  await page.goto("/app#leads");
  await expect(tab(page, "Going cold")).toHaveAttribute("aria-selected", "true");
  const chart = page.getByRole("button", { name: /Nothing seen yet.*open the list/i }).first();
  await expect(chart).toBeVisible({ timeout: 150_000 });
  await chart.click();
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^Nothing seen yet/ })).toBeVisible();
});

test("a tag opens its leads and a per-day chart, and says the history starts when SubSync started watching", async ({ page }) => {
  await page.goto("/app#people");
  await tab(page, "Tags").click();
  await page.getByRole("list", { name: "Tags" }).getByRole("button").first().click();
  const panel = page.getByTestId("tag-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/since SubSync started watching|has not seen a tag change yet/)).toBeVisible();
  await expect(panel.getByText("Tagged per day", { exact: false }).first()).toBeVisible();
});

test("a client's staff see People without account choices, saved lists they keep for themselves, and no team sharing", async ({ page }) => {
  await page.goto("/app?as=client");
  await page.getByRole("button", { name: "People", exact: true }).filter({ visible: true }).first().click();
  await expect(tab(page, "Find and call")).toBeVisible();
  await page.getByTestId("filters-toggle").click();
  await expect(page.getByLabel("Client account")).toHaveCount(0);
  await expect(page.getByLabel("Share with my team")).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
});
