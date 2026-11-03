import { expect, test } from "@playwright/test";

// Every page is reachable from the menu, and Settings, Getting started and What's new stay in view on a short window
// (they used to sit below a scroll area that looked like the end of the menu).
// Meeting notes is not in this list: King's decision of 1 Nov 2026 keeps that page behind its own switch, off by default, until stage E2a
// passes. This server runs with the real default switches, so the page must be absent from the menu (asserted below).
// The pilot menu (D0): plain group names, a short list on top, and everything else the app already shows under "More". Contact search, Leads and Call lists
// are tabs inside People. Nothing that was visible has disappeared.
const LABELS = ["Today", "Speed to lead", "Appointments", "Unanswered messages", "Account audit", "Clients", "People", "Overview", "Team", "Pipeline and deals", "Clean-up", "Settings", "Connections", "Getting started", "What's new"];
const GROUPS = ["Daily work", "Clients and people", "More"];

test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "the sidebar is the desktop layout"); });

test("the agency menu is the pilot menu with plain group names, keeps every other page under More, leaves out Meeting notes, and keeps Settings and help in view on a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  const side = page.getByRole("complementary");
  for (const label of LABELS) await expect(side.getByRole("button", { name: label, exact: true }), label).toBeAttached();
  await expect(side.getByRole("button", { name: "Meeting notes", exact: true }), "Meeting notes stays off the menu until its switch is on").toHaveCount(0);
  for (const label of ["Settings", "Getting started", "What's new"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is in view without scrolling`).toBeInViewport();
  for (const group of GROUPS) await expect(side.getByText(group, { exact: true }), `group "${group}"`).toBeAttached();
  await expect(side.getByText("Tidy up", { exact: true }), "no vague group name").toHaveCount(0);
  // Stage C1: Accounts and Setup are tabs of Clients now, not menu entries; their old addresses still open the module.
  for (const label of ["Accounts", "Setup"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is a tab of Clients`).toHaveCount(0);
  await side.getByRole("button", { name: "Clients", exact: true }).click();
  for (const tab of ["Health", "Onboarding", "Details and billing", "Compare", "Reviews (QBR)"]) await expect(page.getByRole("tab", { name: tab, exact: true }), `Clients tab: ${tab}`).toBeVisible();
  // Duplicates and Data cleanup are tabs of the one Clean-up module (stage C2).
  for (const label of ["Duplicates", "Data cleanup"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is a tab of Clean-up`).toHaveCount(0);
  await side.getByRole("button", { name: "Clean-up", exact: true }).click();
  for (const tab of ["Duplicates", "Formatting", "Tags", "Invalid and old leads"]) await expect(page.getByRole("tab", { name: tab, exact: true }), `Clean-up tab: ${tab}`).toBeVisible();
  // The pages that became tabs are still one click away, inside People.
  await side.getByRole("button", { name: "People", exact: true }).click();
  for (const tab of ["Search and filters", "Smart lists", "Going cold", "Imports and sources"]) await expect(page.getByRole("tab", { name: tab, exact: true }), `People tab: ${tab}`).toBeVisible();
});
