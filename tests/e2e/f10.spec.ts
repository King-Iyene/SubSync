import { expect, test, type Page } from "@playwright/test";

// F10: People (Search and filters, Smart lists, Going cold, Imports and sources), the lead panel from every list, the Dial button (the CRM's own dialer by
// default, never a phone link unless chosen), the header search (Ctrl K) and the call lists. WRITTEN, NOT RUN in the stage (parallel mode: no browser runs).
// The demo company has sample data, so these tests read what is on screen and check structure, not exact people.
async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test("People has four tabs and no tab opens with a phone link on the page", async ({ page }) => {
  await page.goto("/app#people");
  for (const name of ["Search and filters", "Smart lists", "Going cold", "Imports and sources"]) await expect(tab(page, name)).toBeVisible();
  await expect(page.getByTestId("people-list")).toBeVisible();
  await noSideScroll(page, "People");
  for (const name of ["Search and filters", "Smart lists", "Going cold", "Imports and sources"]) {
    await tab(page, name).click();
    await expect(page.locator('a[href^="tel:"]'), `${name}: no phone link on the page`).toHaveCount(0);
    await noSideScroll(page, name);
  }
});

test("press a name: the lead panel opens, the arrows step through the list, Escape closes it", async ({ page }) => {
  await page.goto("/app#people");
  const first = page.getByTestId("people-list").locator("button[data-row-primary]").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-position")).toContainText("1 of");
  await page.getByRole("button", { name: "Next lead" }).click();
  await expect(page.getByTestId("drawer-position")).toContainText("2 of");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer")).toHaveCount(0);
});

test("a tag filter narrows the list and says so in words; clearing restores it", async ({ page }) => {
  await page.goto("/app#people");
  const heading = page.getByRole("heading", { level: 2 }).filter({ hasText: /\d+ people?/ }).first();
  await expect(heading).toBeVisible();
  const before = await heading.innerText();
  await page.getByLabel("Tag", { exact: true }).selectOption({ index: 1 });
  await expect(heading).not.toHaveText(before);
  await expect(page.getByText("People who has the tag", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear all choices" }).click();
  await expect(heading).toHaveText(before);
});

test("Dial opens the CRM's own dialer by default and says plainly it cannot go straight to it", async ({ page }) => {
  await page.goto("/app#people");
  await page.getByTestId("people-list").locator("button[data-row-primary]").first().click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer.getByTestId("dial-button")).toHaveText("Call in your CRM");
  await expect(drawer.getByTestId("dial-note")).toContainText("Not available from your CRM yet");
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(drawer.getByLabel("Dialer")).toHaveCount(0);
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

test("Smart lists holds the saved lists and the built-in call lists with last call, tries and result", async ({ page }) => {
  await page.goto("/app#calls");
  await expect(tab(page, "Smart lists")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("saved-lists").or(page.getByText("No saved lists yet"))).toBeVisible();
  await expect(page.getByText("Call lists", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("calls-count").or(page.getByText("Nobody on this list right now"))).toBeVisible();
  await expect(page.getByText("Last call, tries, result").first()).toBeAttached();
  await noSideScroll(page, "Smart lists");
});

test("a saved list keeps only the choices and opens them again on Search and filters", async ({ page }) => {
  await page.goto("/app#people");
  await page.getByLabel("Tag", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("List name").fill("E2E list");
  await page.getByRole("button", { name: "Save as a smart list" }).click();
  await expect(page.getByText("Saved. It is under Smart lists.")).toBeVisible();
  await tab(page, "Smart lists").click();
  const row = page.getByTestId("saved-lists").locator("li", { hasText: "E2E list" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open" }).click();
  await expect(tab(page, "Search and filters")).toHaveAttribute("aria-selected", "true");
  await tab(page, "Smart lists").click();
  await page.getByTestId("saved-lists").locator("li", { hasText: "E2E list" }).getByRole("button", { name: "Delete E2E list" }).click(); // clean up
  await expect(page.getByTestId("saved-lists").locator("li", { hasText: "E2E list" })).toHaveCount(0);
});

test("Going cold: pressing a bar shows the people behind it, and the list's own heading carries the count", async ({ page }) => {
  await page.goto("/app#leads");
  await expect(tab(page, "Going cold")).toHaveAttribute("aria-selected", "true");
  const chart = page.getByRole("button", { name: /Nothing seen yet.*open the list/i }).first();
  await expect(chart).toBeVisible();
  await chart.click();
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^Nothing seen yet/ })).toBeVisible();
});

test("a tag opens its leads and a per-day chart, and says the history starts when SubSync started watching", async ({ page }) => {
  await page.goto("/app#people");
  await page.getByRole("list", { name: "Tags" }).getByRole("button").first().click();
  const panel = page.getByTestId("tag-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/since SubSync started watching|has not seen a tag change yet/)).toBeVisible();
  await expect(panel.getByText("Tagged per day", { exact: false }).first()).toBeVisible();
});

test("a client's staff see People without account choices, saved lists they keep for themselves, and no team sharing", async ({ page }) => {
  await page.goto("/app?as=client");
  await page.getByRole("button", { name: "People", exact: true }).filter({ visible: true }).first().click();
  await expect(tab(page, "Search and filters")).toBeVisible();
  await expect(page.getByLabel("Client account")).toHaveCount(0);
  await expect(page.getByLabel("Share with my team")).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
});
