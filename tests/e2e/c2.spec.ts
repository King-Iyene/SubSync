import { expect, test } from "@playwright/test";

// C2: the Clean-up module. One page, four tabs, plain words, a three-step guided merge, no sideways scrolling, and no group of different
// people shown as a sure match. Screenshots are saved to docs/review/c2-*.png at the desktop width.

const noSideways = async (page: import("@playwright/test").Page) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "the page does not scroll sideways").toBeLessThanOrEqual(1);
};

test("Clean-up has four tabs, the old addresses open it, and Duplicates shows no jargon and no sideways scroll", async ({ page }, testInfo) => {
  await page.goto("/app#cleanup");
  await expect(page.getByRole("heading", { name: "Clean-up", level: 1 })).toBeVisible();
  for (const t of ["Duplicates", "Formatting", "Tags", "Invalid and old leads"]) await expect(page.getByRole("tab", { name: t })).toBeVisible();
  await expect(page.getByTestId("dupe-groups")).toBeVisible();
  const body = await page.locator("main, body").first().innerText();
  for (const bad of ["Merge into kept", "I merged these in the platform", "Save this record to keep", "Exact match"]) expect(body, bad).not.toContain(bad);
  expect(body).toContain("Where they came from");
  await noSideways(page);
  if (testInfo.project.name === "desktop-1440") await page.screenshot({ path: "docs/review/c2-after-duplicates.png", fullPage: false });

  // The old Duplicates address opens the same module on the same tab.
  await page.goto("/app#duplicates");
  await expect(page.getByRole("heading", { name: "Clean-up", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Duplicates", selected: true })).toBeVisible();
});

test("a group opens into pairs with three steps, and one that shares a phone is labelled as different people", async ({ page }, testInfo) => {
  await page.goto("/app#duplicates");
  const groups = page.getByTestId("dupe-groups").locator("> li");
  await expect(groups.first()).toBeVisible();
  const likely = groups.filter({ hasText: /% sure/ }).first();
  await likely.getByRole("button").first().click();
  const pair = page.getByTestId("dupe-pair").first();
  await expect(pair).toBeVisible();
  await expect(pair).toContainText("1. Pick the contact to keep");
  await expect(pair).toContainText("2. Check the differences");
  await expect(pair.locator("input[type=radio]")).toHaveCount(2);
  expect(await page.getByTestId("dupe-pair").count()).toBeLessThanOrEqual(3);
  await noSideways(page);
  if (testInfo.project.name === "desktop-1440") await page.screenshot({ path: "docs/review/c2-after-pair.png", fullPage: true });
  const shared = groups.filter({ hasText: "probably different people" });
  if (await shared.count()) {
    await expect(shared.first()).not.toContainText("% sure");
    await shared.first().getByRole("button").first().click();
    await expect(page.getByTestId("dupe-pair").first()).toBeVisible();
    await expect(page.getByTestId("dupe-pair")).not.toContainText("3. Merge in your CRM");
    if (testInfo.project.name === "desktop-1440") await page.screenshot({ path: "docs/review/c2-after-different-people.png", fullPage: true });
  }
});

test("Formatting, Tags and Invalid and old leads open and do not scroll sideways", async ({ page }) => {
  await page.goto("/app#cleanup");
  for (const t of ["Formatting", "Tags", "Invalid and old leads"]) {
    await page.getByRole("tab", { name: t }).click();
    await expect(page.getByRole("tab", { name: t, selected: true })).toBeVisible();
    await noSideways(page);
  }
  await expect(page.getByTestId("leads-counts").or(page.getByText("Nothing to tidy"))).toBeVisible();
});
