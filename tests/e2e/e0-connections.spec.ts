import { expect, test, type Page } from "@playwright/test";

// Stage E0 in the real browser (written in parallel mode, NOT RUN there: the lead runs it after the merge). The demo agency person is an administrator, so
// both sections show. Zoom and Google Meet are off at the e2e server's real default switches. All three widths run: nothing may scroll sideways.
const NAMED = /zoom|google meet/i;
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

async function openConnections(page: Page) {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.goto("/app#connections");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My connections", exact: true })).toBeVisible();
}

test("the page has a section for me and a section for admins, and a plain how-to that can be dismissed", async ({ page }) => {
  await openConnections(page);
  await expect(page.getByRole("heading", { name: "Team connections (admins)", exact: true })).toBeVisible();
  await expect(page.getByTestId("how-to")).toContainText("A connection is yours alone");
  await page.getByRole("button", { name: "Hide this tip" }).click();
  await expect(page.getByTestId("how-to")).toHaveCount(0);
});

test("Fathom is offered with a plain next step; Zoom and Google Meet are not mentioned anywhere", async ({ page }) => {
  await openConnections(page);
  const card = page.getByTestId("my-fathom");
  await expect(card.getByRole("heading", { name: "Fathom", exact: true })).toBeVisible();
  await expect(card).toContainText("Not connected. Press Connect and sign in with your own account.");
  expect(flat(await page.locator("body").innerText()), "Connections names Zoom or Google Meet").not.toMatch(NAMED);
  await expect(page.getByTestId("my-zoom")).toHaveCount(0);
});

test("pressing Connect in the demo says plainly that it needs a real install, and nothing is left waiting", async ({ page }) => {
  await openConnections(page);
  await page.getByTestId("my-fathom").getByRole("button", { name: /Connect|Try again/ }).first().click();
  await expect(page.getByTestId("inline-alert").filter({ hasText: "not available in the demo" })).toBeVisible();
  await expect(page.getByText("Waiting for you...")).toHaveCount(0);
});

test("the team section explains that a connection cannot be made for someone, and shows who is connected without any content", async ({ page }) => {
  await openConnections(page);
  const team = page.locator("#team-connections");
  await expect(team.getByTestId("team-summary")).toContainText("Nobody has connected a tool yet.");
  await expect(team).toContainText("a connection is personal, so you cannot do it for them");
  await expect(team.getByTestId("slack-card")).toContainText("Only an admin connects it");
  await expect(team.getByTestId("meeting-rules")).toContainText("Allow full transcripts in your CRM");
  const text = flat(await team.innerText());
  expect(text).not.toMatch(/token|secret|webhook/i);
});

test("nothing scrolls sideways at this width", async ({ page }) => {
  await openConnections(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page is wider than the screen").toBeLessThanOrEqual(1);
});

test("Settings points to Connections", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.goto("/app#settings");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  // Settings is in sections now; the pointer lives under Integrations.
  await page.getByTestId("settings-nav").getByRole("button", { name: "Integrations", exact: true }).click();
  await page.getByRole("link", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My connections", exact: true })).toBeVisible();
});
