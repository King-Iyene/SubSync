import { expect, test } from "@playwright/test";

// Every page is reachable from the menu, and Settings, Getting started and What's new stay in view on a short window
// (they used to sit below a scroll area that looked like the end of the menu).
const LABELS = ["Today", "Account audit", "Overview", "Inbox & SLA", "Speed to lead", "Appointments", "Meeting notes", "Contact search", "Pipeline and deals", "Leads", "Call lists", "Accounts", "Clients", "Team", "Setup", "Duplicates", "Data cleanup", "Settings", "Getting started", "What's new and next"];

test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "the sidebar is the desktop layout"); });

test("the agency menu lists all 20 pages and keeps Settings and help in view on a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  const side = page.getByRole("complementary");
  for (const label of LABELS) await expect(side.getByRole("button", { name: label, exact: true }), label).toBeAttached();
  for (const label of ["Settings", "Getting started", "What's new and next"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is in view without scrolling`).toBeInViewport();
});
