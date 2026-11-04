import { expect, test, type Page } from "@playwright/test";

// Connections left the main menu and became Settings, Integrations (4 Nov 2026). Browser checks at the three widths, for the four roles the demo can play:
//   agency            all client accounts (the demo agency owner)
//   location          an agency person who opened SubSync from inside one client account (?as=location)
//   business          a business owner with one account (?as=business)
//   client            a client's staff, who have no Settings (?as=client): their one entry is called Integrations
// The old address (#connections) must land on Integrations; nothing may scroll sideways at any width.
const ROLES = [
  { as: "", name: "agency", settings: true, team: true },
  { as: "?as=location", name: "agency person inside one account", settings: true, team: true },
  { as: "?as=business", name: "business owner", settings: true, team: true },
  // The demo client is the account's administrator: it sees the team part for its OWN account only (rules for this account). An account user never does (tests/unit/e0-connections-db.test.ts).
  { as: "?as=client", name: "client's staff", settings: false, team: true },
] as const;

// This machine reads the demo data slowly (Settings, then My connections, then Team connections, one after the other): give each test and each wait room.
test.setTimeout(240_000);
const SLOW = { timeout: 120_000 };
const NAMED = /zoom|google meet/i;
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page is wider than the screen").toBeLessThanOrEqual(1);
}

async function open(page: Page, as: string, hash: string) {
  // A saved link: the address is loaded fresh, as a person pasting it into a new tab would.
  await page.goto(`/app${as}#${hash}`);
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible(SLOW);
}

for (const role of ROLES) {
  test.describe(role.name, () => {
    test("the menu has no Connections entry; Settings holds it (a client's staff, who have no Settings, keep one entry called Integrations)", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-1440", "the sidebar is the desktop layout");
      await open(page, role.as, "today");
      const side = page.getByRole("complementary");
      await expect(side.getByRole("button", { name: "Today", exact: true })).toBeVisible();
      await expect(side.getByRole("button", { name: "Connections", exact: true })).toHaveCount(0);
      if (role.settings) {
        await expect(side.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
        await expect(side.getByRole("button", { name: "Integrations", exact: true }), "no second entry beside Settings").toHaveCount(0);
      } else {
        await expect(side.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
        await expect(side.getByRole("button", { name: "Integrations", exact: true })).toBeVisible();
      }
    });

    test("the old #connections address lands on Integrations, in one click from the menu, with the address rewritten", async ({ page }) => {
      await open(page, role.as, "connections");
      await expect(page.getByRole("heading", { name: "My connections", exact: true })).toBeVisible(SLOW);
      await expect(page.getByTestId("my-fathom")).toBeVisible(SLOW);
      if (role.settings) {
        await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
        await expect(page.getByTestId("section-integrations")).toBeVisible(SLOW);
        await expect(page.getByTestId("settings-nav").getByRole("button", { name: "Integrations", exact: true })).toHaveAttribute("aria-current", "page");
        await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#settings/);
      } else {
        await expect(page.getByRole("heading", { name: "Integrations", exact: true, level: 1 })).toBeVisible();
        await expect(page.getByTestId("settings-nav")).toHaveCount(0);
      }
      if (role.team) await expect(page.getByRole("heading", { name: "Team connections (admins)", exact: true })).toBeVisible(SLOW);
      // A client's administrator sees the rules for their own account only, never the company's.
      if (role.name === "client's staff") await expect(page.getByTestId("meeting-rules")).toContainText("Rules for this account", SLOW);
      else if (role.team) await expect(page.getByRole("heading", { name: /^Rules for/ })).toBeVisible(SLOW);
      expect(flat(await page.locator("body").innerText()), "Integrations names Zoom or Google Meet").not.toMatch(NAMED);
      await noSidewaysScroll(page);
    });

    test("from the menu: one click on Settings, then Integrations (or the one Integrations entry), and the connections are there", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-1440", "the sidebar is the desktop layout");
      await open(page, role.as, "today");
      const side = page.getByRole("complementary");
      if (role.settings) {
        await side.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByTestId("settings-nav").getByRole("button", { name: "Integrations", exact: true }).click();
        await expect(page.getByTestId("section-integrations")).toBeVisible(SLOW);
      } else {
        await side.getByRole("button", { name: "Integrations", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Integrations", exact: true, level: 1 })).toBeVisible();
      }
      await expect(page.getByRole("heading", { name: "My connections", exact: true })).toBeVisible(SLOW);
      // The menu keeps the right entry highlighted.
      await expect(side.getByRole("button", { name: role.settings ? "Settings" : "Integrations", exact: true })).toHaveAttribute("aria-current", "page");
    });

    test("on a phone Integrations is usable with a thumb: the connect button is at least 44 px tall and nothing scrolls sideways", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone-390", "phone layout");
      await open(page, role.as, "connections");
      await expect(page.getByTestId("my-fathom")).toBeVisible(SLOW);
      const connect = page.getByTestId("my-fathom").getByRole("button", { name: /Connect|Try again/ }).first();
      await expect(connect).toBeVisible();
      const box = await connect.boundingBox();
      expect(box?.height ?? 0, "the connect button is a thumb target").toBeGreaterThanOrEqual(44);
      if (role.settings) {
        const tab = page.getByTestId("settings-nav").getByRole("button", { name: "Integrations", exact: true });
        await expect(tab).toBeVisible();
        expect((await tab.boundingBox())?.height ?? 0, "the Integrations tab is a thumb target").toBeGreaterThanOrEqual(44);
      }
      await noSidewaysScroll(page);
    });
  });
}

test("typing the old address while SubSync is already open also lands on Integrations (agency)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "content check");
  await open(page, "", "settings");
  await expect(page.getByTestId("settings-nav")).toBeVisible(SLOW);
  await page.getByTestId("settings-nav").getByRole("button", { name: "Brand", exact: true }).click();
  await expect(page.getByTestId("section-brand")).toBeVisible();
  await page.evaluate(() => { window.location.hash = "#connections"; });
  await expect(page.getByTestId("section-integrations")).toBeVisible(SLOW);
  await expect(page.getByTestId("settings-nav").getByRole("button", { name: "Integrations", exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#settings/);
});

test("the Meeting notes pointer and the sign-in return both use the new name (no 'Open Connections' anywhere in Settings)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "content check");
  await open(page, "", "settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
  await page.getByTestId("settings-nav").getByRole("button", { name: "Integrations", exact: true }).click();
  expect(flat(await page.getByTestId("section-integrations").innerText())).not.toMatch(/Open Connections|Connections in the menu/);
  await expect(page.getByTestId("section-integrations").getByRole("heading", { name: "What SubSync can read" })).toBeVisible();
});
