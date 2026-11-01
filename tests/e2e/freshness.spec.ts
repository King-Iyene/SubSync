import { expect, test, type Page } from "@playwright/test";
import { NAV } from "../../src/app/app/nav";

// S0.4 / N74: every page shows the SAME freshness line, once, and no page words freshness on its own. The line comes from one function on the
// server; this opens every page of the menu in a real browser at the three widths and compares what is on the screen with what the server says.
// (The demo company has sample data, so the line says so. The wording for real data, "Updated 7 min ago", stale and failed, is checked on real
// rows by scripts/check-sync.ts and tests/unit/sync-reliability-db.test.ts.)
const PAGES = NAV.filter((n) => n.id !== "meetings"); // Meeting notes is switched off by default (S0.2b)
const GROUPS: Array<[string, string[]]> = [
  ["Daily work", ["today", "audit", "overview", "inbox", "speed", "appointments"]],
  ["People and pipeline", ["search", "pipeline", "leads", "calls"]],
  ["Clients and more", ["accounts", "clients", "team", "onboarding", "duplicates", "cleanup"]],
  ["Settings and help", ["settings", "help", "roadmap"]],
];
const BANNED = [/Data is under an hour old/i, /A sync is still running/i, /Last synced/, /Last completed/, /Still syncing your accounts/i, /Data is \d+ hours? old/i];

async function serverSentence(page: Page): Promise<string> {
  const s = await page.request.post("/api/sso", { data: { demo: true } });
  const token = ((await s.json()) as { session: string }).session;
  const r = await page.request.get("/api/app/freshness", { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
  return ((await r.json()) as { freshness: { text: string } }).freshness.text;
}

async function open(page: Page, label: string, parent?: string) {
  // A page inside a module (People holds Contact search, Leads and Call lists) is reached through its module's menu entry, then its tab.
  if (parent) {
    await page.getByRole("button", { name: parent, exact: true }).filter({ visible: true }).first().click();
    await page.getByRole("tab", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).filter({ visible: true }).first().click();
}

for (const [group, ids] of GROUPS) {
  test(`every page in "${group}" shows the one freshness line, the same as the server says, and nothing else about freshness`, async ({ page }) => {
    const wanted = await serverSentence(page);
    await page.goto("/app");
    await expect(page.getByTestId("freshness")).toBeVisible();
    for (const id of ids) {
      const nav = PAGES.find((n) => n.id === id)!;
      if (id !== "today") await open(page, nav.label, nav.parent ? PAGES.find((n) => n.id === nav.parent)!.label : undefined);
      await expect(page.getByTestId("freshness"), `${nav.label}: exactly one freshness line`).toHaveCount(1);
      await expect(page.getByTestId("freshness-text"), `${nav.label}: the same words as the server`).toHaveText(wanted);
      const body = (await page.locator("main").innerText()) + "\n" + (await page.locator("body").innerText());
      for (const b of BANNED) expect(body, `${nav.label}: ${b}`).not.toMatch(b);
      expect(await page.getByTestId("syncing-note").count(), `${nav.label}: no sync-running note for a normal refresh`).toBe(0);
    }
  });
}

test("Settings has one Sync status panel in place of the old Connection health and Data sync cards, and it says the same sentence", async ({ page }) => {
  const wanted = await serverSentence(page);
  await page.goto("/app");
  await open(page, "Settings");
  await expect(page.getByTestId("sync-panel-text")).toHaveText(wanted);
  await expect(page.getByRole("heading", { name: "Sync status" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Connection health" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Data sync" })).toHaveCount(0);
  // The demo has no real schedule to describe; the panel offers the refresh button and says its data is sample data.
  await expect(page.getByRole("button", { name: "Refresh insights" })).toBeVisible();
});

test("a business and a client's staff see the same line too", async ({ page }) => {
  for (const as of ["business", "client"]) {
    await page.goto(`/app?as=${as}`);
    await expect(page.getByTestId("freshness"), as).toHaveCount(1);
    await expect(page.getByTestId("freshness-text"), as).toHaveText(/Sample data/);
  }
});
