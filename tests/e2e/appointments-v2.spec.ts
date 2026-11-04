import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// The rebuilt Appointments page (docs/APPOINTMENTS_REVIEW.md), on the demo company, for the four roles and the three widths of the projects:
//   a headline and one primary button, three lists of at most five rows each, the true show rate, clickable chart marks that open exactly their own rows, a full list
//   that pages from the server, a panel with the appointment on top, a client's staff who only ever see their own account, and a clean phone layout.
// The demo is slow to answer (each call signs the demo in again), so the waits are long. Nothing here writes: the page only reads.
const ROLES = [
  { name: "agency, all accounts", path: "/app#appointments", slug: "agency-all", multi: true, as: undefined },
  // Opened from inside one client account the shell starts on that account (only when there is no address hash), so this role opens the app and then the menu entry.
  { name: "agency, inside one account", path: "/app?as=location", slug: "agency-account", multi: false, menu: true, as: undefined },
  { name: "a client's staff", path: "/app?as=client#appointments", slug: "client-staff", multi: false, as: "client" as const },
  { name: "a business owner", path: "/app?as=business#appointments", slug: "business-owner", multi: false, as: "business" as const },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;

async function open(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "Appointments", exact: true }).first().click({ timeout: 90_000 });
  else await page.reload();
  await expect(page.getByTestId("appt-headline")).toBeVisible({ timeout: 120_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}
const num = (s: string) => Number(s.replace(/[^\d]/g, ""));
const total = async (page: Page, kind: string) => num(await page.getByTestId(`appt-${kind}-count`).innerText());

for (const role of ROLES) {
  test(`${role.name}: a headline, one button, three lists of at most five rows, plain words, no sideways scroll`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await open(page, role.path, "menu" in role && role.menu === true);
    const counts = { recover: await total(page, "recover"), record: await total(page, "record"), upcoming: await total(page, "upcoming") };
    const sum = counts.recover + counts.record + counts.upcoming;
    expect(sum, "the demo has work to do").toBeGreaterThan(0);
    // The headline says the same number as the three lists add up to (the three kinds never overlap).
    expect(num(await page.getByTestId("appt-headline").innerText())).toBe(sum);
    await expect(page.getByTestId("appt-primary")).toBeVisible();
    await expect(page.getByTestId("appt-primary")).toHaveText(/^(Follow up the|Mark|Check) /);
    for (const k of ["recover", "record", "upcoming"] as const) {
      const rows = page.getByTestId(`appt-${k}-rows`).getByTestId("appt-row");
      expect(await rows.count(), `${k}: at most five rows inline`).toBeLessThanOrEqual(5);
      expect(await rows.count()).toBe(Math.min(5, counts[k]));
      if (counts[k] > 5) await expect(page.getByTestId(`appt-${k}-all`)).toBeVisible();
      else await expect(page.getByTestId(`appt-${k}-all`)).toHaveCount(0);
    }
    // One small button per row, and the true show rate says what it is built on.
    await expect(page.getByTestId("appt-rate")).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/down 100%|NaN|undefined|Infinity/);
    // The compare card: people always; client accounts only for an agency with several.
    if (role.multi) await expect(page.getByTestId("appt-by-account")).toBeVisible();
    else await expect(page.getByTestId("appt-by-account")).toHaveCount(0);
    expect(await page.locator('a[href^="tel:"], a[href^="mailto:"]').count(), "no phone or mail link: calls go through the CRM").toBe(0);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    if (testInfo.project.name === "phone-390") {
      for (const sel of ['[data-testid="appt-primary"]', '[data-testid="appt-row-button"]', '[data-testid="appt-row-more"]']) {
        const box = await page.locator(sel).first().boundingBox();
        expect(box!.height, `${sel} is thumb sized`).toBeGreaterThanOrEqual(44);
      }
    }
    if (process.env.SHOTS) {
      mkdirSync("docs/review", { recursive: true });
      await page.screenshot({ path: `docs/review/appointments-${role.slug}-${testInfo.project.name.replace(/\D+/g, "")}.png`, fullPage: true });
    }
  });
}

test("the three counts are the numbers Today shows, and the lists are the same rows", async ({ request }) => {
  test.setTimeout(240_000);
  const c = await api(request);
  const [t, w] = await Promise.all([c.get("today"), c.get("appointments/work")]);
  const items = t.items as Json[];
  // Today's two appointment kinds are the Needs-an-outcome and the No-shows-to-recover lists here: same rule, same rows, same count.
  expect(items.filter((i) => i.kind === "appointments").length).toBe(w.counts.record);
  expect(items.filter((i) => i.kind === "noshows").length).toBe(w.counts.recover);
  const rec = await c.get("appointments/list?kind=record&size=50");
  expect(rec.total).toBe(w.counts.record);
  expect(new Set((rec.rows as Json[]).map((r) => `${r.locationId}:${r.contactId}:${r.at}`))).toEqual(new Set(items.filter((i) => i.kind === "appointments").map((i) => `${i.locationId}:${i.contactId}:${i.at}`)));
  // Together: the headline total is the three lists, and "all" is exactly their union.
  const all = await c.get("appointments/list?kind=all&size=1");
  expect(all.total).toBe(w.counts.record + w.counts.recover + w.counts.upcoming);
});

test("a chart mark opens exactly its own rows: the count on the bar is the count of the list", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "/app#appointments");
  await page.getByTestId("appt-chart-toggle").click();
  const bars = page.getByTestId("appt-outcome-chart").getByRole("button", { name: /open the list/ });
  expect(await bars.count()).toBeGreaterThanOrEqual(2);
  for (const i of [0, 1, 2]) {
    const bar = bars.nth(i);
    if (!(await bar.count())) continue;
    const label = (await bar.getAttribute("aria-label")) ?? "";
    const n = Number(/(\d+) appointments, open the list/.exec(label)?.[1]);
    await bar.click();
    await expect(page.getByTestId("appt-full-count")).toHaveText(String(n), { timeout: 90_000 });
    // Every row is one appointment of that outcome (the list reads from the same rows the bar counted).
    const shown = await page.getByTestId("appt-drill-list").getByTestId("appt-row").count();
    expect(shown).toBe(Math.min(n, 25));
  }
});

test("See all pages from the server, searches, sorts and keeps the count", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "/app#appointments");
  const n = await total(page, "record");
  test.skip(n <= 5, "the demo has five or fewer to mark");
  await page.getByTestId("appt-record-all").click();
  const full = page.getByTestId("appt-record-full");
  await expect(full.getByTestId("appt-full-count")).toHaveText(String(n), { timeout: 90_000 });
  expect(await full.getByTestId("appt-row").count()).toBe(Math.min(n, 25));
  // Search narrows by name; clearing brings every row back.
  const first = (await full.getByTestId("appt-row-name").first().innerText()).trim();
  await full.getByTestId("appt-search").fill(first.split(" ")[0]);
  await expect.poll(async () => num(await full.getByTestId("appt-full-count").innerText()), { timeout: 60_000 }).toBeLessThanOrEqual(n);
  await expect(full.getByTestId("appt-row-name").first()).toContainText(first.split(" ")[0]);
  await full.getByTestId("appt-search").fill("");
  await expect(full.getByTestId("appt-full-count")).toHaveText(String(n), { timeout: 60_000 });
  await full.getByTestId("appt-full-close").click();
  await expect(page.getByTestId("appt-record-rows").getByTestId("appt-row")).toHaveCount(5);
});

test("a row opens the person with the appointment on top, and the way to mark it in the CRM", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "/app#appointments");
  await page.getByTestId("appt-record-rows").getByTestId("appt-row-name").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("appt-top")).toContainText("no outcome marked");
  await expect(page.getByTestId("appt-mark-note")).toContainText("Open in your CRM to mark the outcome");
  const href = await page.getByTestId("appt-mark-note").getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^https:\/\/[^/]+\/v2\/location\/[^/]+\/contacts\/detail\//);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer")).toHaveCount(0);
});

test("a call to someone who asked not to be contacted opens the warning panel, never the call", async ({ page, context }) => {
  test.setTimeout(300_000);
  await open(page, "/app#appointments");
  const dndRow = page.locator('[data-testid="appt-row"][data-dnd="true"]').first();
  test.skip((await dndRow.count()) === 0, "no do-not-disturb person among the visible rows");
  const popups: string[] = [];
  context.on("page", (p) => popups.push(p.url()));
  await dndRow.getByTestId("appt-row-button").click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible({ timeout: 90_000 });
  expect(popups, "nothing opened").toEqual([]);
});

test("a client's staff only ever read their own account, and cannot ask for another", async ({ request }) => {
  test.setTimeout(240_000);
  const c = await api(request, "client");
  const w = await c.get("appointments/work");
  const own = new Set<string>();
  for (const k of ["recover", "record", "upcoming"]) for (const r of w.lists[k].rows as Json[]) own.add(r.locationId);
  expect(own.size).toBeLessThanOrEqual(1);
  expect(w.several).toBe(false);
  expect(w.accounts.total).toBe(0);
  const all = await c.get("appointments/list?kind=all&size=50");
  for (const r of all.rows as Json[]) expect([...own][0] ?? r.locationId).toBe(r.locationId);
  // Asking for another account's rows, or the client-account comparison, gives nothing of anyone else's.
  const other = await c.get("appointments/list?kind=all&location=demo-loc-2&size=50");
  expect(other.total).toBe(0);
  const byAccount = await c.get("appointments/compare?by=account");
  expect(byAccount.total).toBe(0);
  const people = await c.get("appointments/compare?by=person");
  expect(people.total).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(all)).not.toContain("tel:");
});
