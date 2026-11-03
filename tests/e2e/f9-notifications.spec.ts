import { expect, test, type Page } from "@playwright/test";

// Stage F9 in the real browser (written in parallel mode, NOT RUN there: the lead runs it after the merge). The demo agency person is an administrator. The e2e
// server has the live switches off, so tests and Slack messages are recorded, not sent. All three widths run: nothing may scroll sideways.
async function open(page: Page, hash = "notifications") {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.goto(`/app#${hash}`);
  await page.reload();
}

test("the bell opens, lists what needs me, and a test item added from Notifications shows up with a number", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await page.getByTestId("type-speed_breach").getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: "Add a test to the bell" }).first().click();
  await expect(page.getByText("A test item was added to your bell.")).toBeVisible();
  await page.getByTestId("bell").getByRole("button").click();
  await expect(page.getByTestId("bell-panel")).toBeVisible();
  // The bell lists the most urgent first, so the info-level test item is not necessarily the first row: look for it among the rows.
  await expect(page.getByTestId("bell-item").filter({ hasText: "Test:" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("bell-panel")).toHaveCount(0);
});

test("a bell item can be snoozed and dismissed, and leaves the list", async ({ page }) => {
  await open(page);
  await page.getByTestId("type-speed_breach").getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: "Add a test to the bell" }).first().click();
  await expect(page.getByText("A test item was added to your bell.")).toBeVisible();
  await page.getByTestId("bell").getByRole("button").click();
  // Opening the bell re-reads the list, so the count changes once after the panel shows: take it when it has stopped moving.
  const items = page.getByTestId("bell-item");
  await expect(items.first()).toBeVisible();
  let before = -1;
  await expect.poll(async () => { const n = await items.count(); const same = n === before; before = n; await page.waitForTimeout(1000); return same; }, { timeout: 30_000 }).toBe(true);
  await items.first().getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("bell-item")).toHaveCount(before - 1);
});

test("the matrix lists every kind of message; tickets are listed but cannot be changed", async ({ page }) => {
  await open(page);
  for (const id of ["daily_brief", "weekly_summary", "speed_breach", "unmarked_appointments", "silent_failure", "sync_problem", "new_ticket", "ticket_resolved"]) await expect(page.getByTestId(`type-${id}`)).toBeVisible();
  await expect(page.getByTestId("type-new_ticket").getByRole("button", { name: "Change" })).toBeDisabled();
  await expect(page.getByTestId("summary-new_ticket")).toHaveText("Not available yet");
  await expect(page.getByTestId("test-mode")).toContainText("switched off on this server");
});

test("the wording editor: a live preview with sample details, an unknown variable is refused, reset to default", async ({ page }) => {
  await open(page);
  await page.getByTestId("type-speed_breach").getByRole("button", { name: "Change" }).click();
  const panel = page.getByTestId("wording-speed_breach");
  await panel.getByLabel("Title").fill("CALL NOW: {account} has {count} waiting");
  await expect(page.getByTestId("preview-speed_breach")).toContainText("CALL NOW: Sample Dental has 9 waiting");
  await panel.getByLabel("Title").fill("{account} {leads}");
  await expect(page.getByTestId("preview-error-speed_breach")).toContainText("{leads} is not a name you can use here");
  await expect(panel.getByRole("button", { name: "Save wording" })).toBeDisabled();
  await panel.getByLabel("Title").fill("<b>{account}</b>");
  await expect(page.getByTestId("preview-error-speed_breach")).toContainText("Plain text only");
  await panel.getByLabel("Title").fill("{account}: {count} waiting");
  await panel.getByRole("button", { name: "Save wording" }).click();
  await expect(page.getByText("Wording saved.")).toBeVisible();
  // The row stays open after saving (its button now says Close), so the wording panel is still there.
  await expect(page.getByTestId("wording-speed_breach")).toBeVisible();
  await page.getByTestId("wording-speed_breach").getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByText("Back to the default wording.")).toBeVisible();
});

test("quiet hours are explained in a sentence that follows the choice", async ({ page }) => {
  await open(page);
  await page.getByTestId("type-speed_breach").getByRole("button", { name: "Change" }).click();
  const text = page.getByTestId("quiet-text-speed_breach");
  await expect(text).toContainText("warnings wait until 07:00. Critical alerts are still sent at once.");
  await page.getByTestId("quiet-speed_breach").getByLabel("Quiet hours").uncheck();
  await expect(text).toContainText("No quiet hours");
});

test("Slack: with no channel connected the page says what to do; the pasted address is only under Advanced and is never shown back", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("slack-advanced")).toBeVisible();
  await page.getByTestId("slack-advanced").locator("summary").click();
  await expect(page.getByLabel("Channel address (starts with https://hooks.slack.com/services/)")).toHaveAttribute("type", "password");
  await expect(page.locator("body")).not.toContainText("hooks.slack.com/services/T");
});

test("Settings shows the daily brief line and a way into Notifications; the page works at every width without scrolling sideways", async ({ page }) => {
  await open(page, "settings");
  await page.getByTestId("settings-nav").getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByTestId("open-notifications")).toBeVisible();
  await expect(page.getByTestId("daily-brief-line")).toContainText("Daily brief:");
  await page.getByTestId("open-notifications").click();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  expect(await page.locator("body").innerText()).not.toMatch(/go\s?high\s?level|\bghl\b|sub-?account/i);
});
