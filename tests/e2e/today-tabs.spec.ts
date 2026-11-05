import { expect, test, type Page } from "@playwright/test";
import { todayReady } from "./today-helpers";

// "Break it down": every tab switches, shows its own content (never a blank panel) and its first number opens the records behind it. Agency owner (six tabs) and a client's staff (two).
// The Forecast tab names what it looked at when nothing is about to slip, instead of one bare line.
test.beforeEach(({}, info) => { test.skip(!/^desktop-/.test(info.project.name), "the tab checks run at 1440 and 1024"); }); // eslint-disable-line no-empty-pattern

async function open(page: Page, path: string) {
  await page.goto(path);
  await todayReady(page);
  await page.getByTestId("more-detail-toggle").click();
  await expect(page.getByTestId("today-tabs")).toBeVisible();
}
const panel = (page: Page) => page.getByTestId("today-tabpanel");
async function drill(page: Page, testId: string) {
  await panel(page).getByTestId(testId).first().click();
  await expect(page.getByTestId("records-panel")).toBeVisible();
  await expect(page.getByTestId("records-count")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("records-panel")).toHaveCount(0);
}

test("agency owner: each of the six tabs switches, shows its content, and its first number opens the records", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app");
  const tabs = ["Forecast", "Proof", "People", "Sources", "Coverage", "Growth"];
  await expect(page.getByRole("tab")).toHaveText(tabs);
  for (const name of tabs) {
    const tab = page.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab, `${name} is selected`).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(panel(page), `${name} has a panel`).toBeVisible();
    expect((await panel(page).innerText()).trim().length, `${name} is not blank`).toBeGreaterThan(40);
  }
  // Forecast: either what is coming, or an honest statement of what was looked at (never one bare line).
  await page.getByRole("tab", { name: "Forecast" }).click();
  const none = page.getByTestId("coming-none");
  if (await none.count()) {
    await expect(none).toContainText("reply window");
    await expect(none).toContainText(/Already late|Nothing is late either/);
  } else {
    await expect(page.getByTestId("coming-block")).toBeVisible();
    await drill(page, "coming-next");
  }
  await page.getByRole("tab", { name: "Proof" }).click();
  await expect(page.getByTestId("today-proof")).toBeVisible();
  await drill(page, "proof-open-raised");
  await page.getByRole("tab", { name: "People" }).click();
  await expect(panel(page)).toContainText("Who has people waiting");
  await drill(page, "workload-row");
  await page.getByRole("tab", { name: "Sources" }).click();
  expect(await page.getByTestId("source-row").count(), "sources are listed").toBeGreaterThan(0);
  await drill(page, "source-row");
  await page.getByRole("tab", { name: "Coverage" }).click();
  await expect(page.getByTestId("hour-bar")).toHaveCount(24);
  await drill(page, "hour-bar");
  await page.getByRole("tab", { name: "Growth" }).click();
  await expect(page.getByTestId("growth-counters").locator("li")).toHaveCount(4);
  await drill(page, "growth-week");
  await drill(page, "growth-day");
  await drill(page, "source-slice");
  // Keyboard: the arrow keys move between tabs.
  await page.getByRole("tab", { name: "Growth" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Forecast" })).toHaveAttribute("aria-selected", "true");
  // The tab row never scrolls sideways and shows no scroll bar.
  const row = await page.getByRole("tablist").evaluate((e) => ({ over: e.scrollWidth - e.clientWidth, overflow: getComputedStyle(e).overflowX }));
  expect(row.over).toBeLessThanOrEqual(1);
  expect(row.overflow).toBe("visible");
});

test("a client's staff: Forecast and Growth work for their own client only", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "/app?as=client");
  await expect(page.getByRole("tab")).toHaveText(["Forecast", "Growth"]);
  await page.getByRole("tab", { name: "Growth" }).click();
  await expect(page.getByTestId("growth-tab")).toBeVisible();
  await expect(page.getByTestId("growth-league")).toHaveCount(0); // one client: no league table
  await expect(page.getByTestId("growth-rules")).toHaveCount(0);  // no settings for a client's staff
  await expect(page.getByTestId("goal-edit")).toHaveCount(0);     // a goal is read, not set
  await drill(page, "growth-month");
  await page.getByRole("tab", { name: "Forecast" }).click();
  await expect((await panel(page).innerText()).trim().length).toBeGreaterThan(20);
});

test("Growth: a goal is typed inline, saved, shown with its state, and removed again", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "/app");
  await page.getByRole("tab", { name: "Growth" }).click();
  const row = page.getByTestId("league-row").first();
  const loc = await row.getAttribute("data-location");
  await row.getByTestId("goal-edit").click();
  await row.getByTestId("goal-input").fill("0");
  await row.getByTestId("goal-save").click();
  await expect(row.getByRole("alert")).toContainText("whole number");
  await row.getByTestId("goal-input").fill("50");
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-testid="league-row"][data-location="${loc}"] [data-testid="goal-value"]`)).toHaveText("50");
  await expect(page.getByTestId("goal-card")).toContainText("with a goal");
  await page.locator(`[data-testid="league-row"][data-location="${loc}"] [data-testid="goal-edit"]`).click();
  await page.getByTestId("goal-input").fill("");
  await page.getByTestId("goal-save").click();
  await expect(page.getByTestId("goal-none")).toBeVisible();
});
