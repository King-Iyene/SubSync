import { expect, test } from "@playwright/test";

// Every enabled module is reachable from the menu, and Settings, Getting started and What's new stay in view on a short window
// (they used to sit below a scroll area that looked like the end of the menu).
// The pilot menu: plain group names, a short list on top, and active secondary pages under "More". Contact search, Leads and Call lists are People tabs.
const LABELS = ["Today", "Speed to lead", "Appointments", "Unanswered messages", "Account audit", "Clients", "People", "Overview", "Team", "Pipeline and deals", "Clean-up", "Meeting notes", "Workflows", "Data health", "Settings", "Getting started", "What's new"];
const GROUPS = ["Reply", "Clients and people", "More"];

test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "the sidebar is the desktop layout"); });

test("the agency menu exposes all modules, keeps Settings and help visible, and shows all client tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  const side = page.getByRole("complementary");
  for (const label of LABELS) await expect(side.getByRole("button", { name: label, exact: true }), label).toBeAttached();
  await expect(side.getByRole("button", { name: "Duplicates", exact: true }), "Duplicates is available in the Clean-up module, not a second menu item").toHaveCount(0);
  for (const label of ["Settings", "Getting started", "What's new"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is in view without scrolling`).toBeInViewport();
  for (const group of GROUPS) await expect(side.getByText(group, { exact: true }), `group "${group}"`).toBeAttached();
  await expect(side.getByText("Tidy up", { exact: true }), "no vague group name").toHaveCount(0);
  // Connections is Settings, Integrations now: no menu entry of its own, and no second Integrations entry either (Settings holds it).
  for (const label of ["Connections", "Integrations"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is not a menu entry`).toHaveCount(0);
  // Stage C1: Accounts and Setup are tabs of Clients now, not menu entries; their old addresses still open the module.
  for (const label of ["Accounts", "Setup"]) await expect(side.getByRole("button", { name: label, exact: true }), `${label} is a tab of Clients`).toHaveCount(0);
  await side.getByRole("button", { name: "Clients", exact: true }).click();
  for (const tab of ["Clients", "Onboarding", "Industries"]) await expect(page.getByRole("tab", { name: tab, exact: true }), `Clients tab: ${tab}`).toBeVisible();
  for (const tab of ["Compare", "Reviews (QBR)"]) await expect(page.getByRole("tab", { name: tab, exact: true }), `available module tab: ${tab}`).toBeVisible();
  // The pages that became tabs are still one click away, inside People.
  await side.getByRole("button", { name: "People", exact: true }).click();
  for (const tab of ["Find and call", "Tags", "Going cold", "Sources"]) await expect(page.getByRole("tab", { name: tab, exact: true }), `People tab: ${tab}`).toBeVisible();
  await side.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByTestId("overview-metric"), "Overview stays within its six-metric cap").toHaveCount(6);
});
