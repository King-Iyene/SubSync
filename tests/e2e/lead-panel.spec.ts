import { expect, test } from "@playwright/test";

// The lead panel (N49, N50): one column, tags with the day each was added (or the plain unknown wording), custom fields, a dated timeline, what the platform
// does not give, next steps, and a tag that opens that tag's list.
async function open(page: import("@playwright/test").Page) {
  await page.goto("/app#people");
  const first = page.getByTestId("people-list").locator("button[data-row-primary]").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  return page.getByTestId("lead-drawer");
}

test("the panel shows details, tags with a date line each, a timeline and what the platform does not give", async ({ page }) => {
  const d = await open(page);
  await expect(d.getByTestId("drawer-details")).toContainText("Account");
  await expect(d.getByTestId("drawer-details")).toContainText("Source");
  await expect(d.getByTestId("drawer-details")).toContainText("Added");
  await expect(d.getByTestId("drawer-timeline")).toBeVisible();
  const notAvail = d.getByTestId("drawer-not-available");
  for (const w of ["Notes", "Tasks", "What each message said"]) await expect(notAvail).toContainText(`${w}: Not available from the platform yet`);
  await expect(d.getByTestId("drawer-tags")).toBeVisible();
  const dates = d.getByTestId("drawer-tag-date");
  if (await dates.count()) {
    const text = (await dates.allInnerTexts()).join("|");
    expect(text).toMatch(/Added \d|Before SubSync started watching/);
  }
  expect(await d.locator("li").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a tag in the panel opens that tag's list with the people per day", async ({ page }) => {
  const d = await open(page);
  const tag = d.getByTestId("drawer-tag").first();
  test.skip((await tag.count()) === 0, "this lead has no tags");
  const name = (await tag.innerText()).trim();
  await tag.click();
  await expect(page.getByTestId("lead-drawer")).toHaveCount(0);
  await expect(page.getByTestId("tag-panel")).toContainText(`Tag: ${name}`);
});
