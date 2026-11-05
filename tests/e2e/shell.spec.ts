import { expect, test, type Page } from "@playwright/test";

// Stage SHELL: the money-first menu, "Section > Page", visible tabs, ONE global filter bar on eight pages (accounts and dates), no account picker for a client's
// staff, the logo rule, and no sideways scroll on a phone. Demo company, so no real data is read or written.
test.setTimeout(120_000);
const PAGES = ["today", "speed", "appointments", "inbox", "people", "audit", "clients", "cleanup"];

async function open(page: Page, hash: string, as = "") {
  await page.goto(`/app${as}#${hash}`);
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
}

test("the menu is money first and the page says where you are", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "the sidebar is the desktop layout");
  await open(page, "speed");
  const side = page.getByRole("complementary");
  const labels = await side.getByRole("navigation", { name: "Sections" }).getByRole("button").allInnerTexts();
  const order = ["Today", "Speed to lead", "Unanswered messages", "Appointments", "Clients", "People", "Account audit", "Clean-up", "Overview", "Team", "Pipeline and deals"];
  const idx = order.map((l) => labels.findIndex((x) => x.startsWith(l)));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
  await expect(side.getByRole("button", { name: "Speed to lead", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("trail")).toContainText("Reply");
  await expect(page.getByTestId("trail")).toContainText("Speed to lead");
  // Sub-sections are visible tabs, never behind a triangle.
  await open(page, "appointments");
  await expect(page.getByRole("tab", { name: "Insights" })).toBeVisible();
  await expect(page.locator("main details > summary")).toHaveCount(0);
});

test("every page with numbers shows the filter bar, open, with the accounts and the dates", async ({ page }) => {
  for (const id of PAGES) {
    await open(page, id);
    const bar = page.getByTestId("global-filter-bar");
    await expect(bar, id).toBeVisible();
    await expect(bar.getByTestId("account-button"), id).toContainText(/client accounts/);
    await expect(bar.getByTestId("date-control").or(bar.getByTestId("date-now")), id).toBeVisible();
  }
});

test("the account picker searches, narrows to one client, and the dates change the window and the address", async ({ page }) => {
  await open(page, "speed");
  const bar = page.getByTestId("global-filter-bar");
  await bar.getByTestId("account-button").click();
  const list = page.getByTestId("account-list");
  const first = (await list.getByTestId("account-row").first().innerText()).split("\n")[0].trim();
  await list.getByLabel("Find a client account").fill(first.slice(0, 4));
  await expect(list.getByTestId("account-row").first()).toBeVisible();
  await list.getByRole("button", { name: /^Only / }).first().click();
  await expect(bar.getByTestId("account-button")).toContainText(/1 of \d+ client accounts/);
  await expect(bar.getByTestId("account-chip")).toHaveCount(1);
  await expect.poll(() => page.url()).toContain("accounts=");
  const before = await bar.getByTestId("date-window").innerText();
  await bar.getByRole("button", { name: "Last 7 days" }).click();
  await expect.poll(() => page.url()).toContain("r.page=7d");
  await expect(bar.getByTestId("date-window")).not.toHaveText(before);
  await bar.getByRole("button", { name: "Custom" }).click();
  await expect(bar.getByLabel("From date")).toBeVisible();
  await expect.poll(() => page.url()).toContain("r.page=custom");
});

test("a client's staff see the date range but no account picker", async ({ page }) => {
  await open(page, "speed", "?as=client");
  await expect(page.getByTestId("global-filter-bar")).toBeVisible();
  await expect(page.getByTestId("account-button")).toHaveCount(0);
});

test("the SubSync name and logo show unless the company has its own brand on", async ({ page }) => {
  await open(page, "today");
  const side = page.getByRole("complementary");
  await expect(side.getByText("SubSync", { exact: false }).first()).toBeVisible();
});

test("no sideways scroll, and the menu is at the bottom on a phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "phone only");
  for (const id of ["today", "speed", "settings"]) {
    await open(page, id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), id).toBe(true);
  }
  const box = await page.getByTestId("phone-menu").boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(800);
  const small = await page.getByTestId("phone-menu").getByRole("button").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  expect(small).toBe(0);
});
