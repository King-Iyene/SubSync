import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The consolidated UI pass (column chart, dark-mode colours, sticky filter bar, Sync now). HDR_SHOTS=1 also writes screenshots to docs/review/hdr-*.png.
mkdirSync("docs/review", { recursive: true });
const SHOTS = Boolean(process.env.HDR_SHOTS);

for (const theme of ["dark", "light"] as const) {
  test(`Today and Speed read well in ${theme}`, async ({ page }, info) => {
    test.setTimeout(200_000);
    await page.addInitScript((t) => { try { localStorage.setItem("subsync-theme", t); } catch { /* none */ } }, theme);
    await page.goto("/app");
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(4000);
    if (SHOTS) await page.screenshot({ path: `docs/review/hdr-today-${theme}-${info.project.name}.png` });
    await page.goto("/app#speed");
    await page.reload();
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(5000);
    if (SHOTS) await page.screenshot({ path: `docs/review/hdr-speed-${theme}-${info.project.name}.png` });
    for (const tab of ["Pace", "Rules"]) {
      const t = page.getByRole("tab", { name: tab, exact: true }).first();
      if (await t.count()) { await t.click(); await page.waitForTimeout(2500); if (SHOTS) await page.screenshot({ path: `docs/review/hdr-speed-${tab.toLowerCase()}-${theme}-${info.project.name}.png` }); }
    }
  });
}

test("column chart: 150 clients fit, switch Top 50 / All, table view, keyboard", async ({ page }) => {
  await page.goto("/design");
  const chart = page.getByTestId("column-chart");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.getByTestId("column")).toHaveCount(50);
  await chart.getByTestId("cols-limit-all").click();
  await expect(chart.getByTestId("column")).toHaveCount(150);
  const m = await chart.evaluate((el) => { const sc = el.querySelector<HTMLElement>("[data-testid=cols-scroll]")!; const plot = el.querySelector<HTMLElement>("[data-testid=cols-plot]")!; return { box: sc.clientWidth, plot: plot.getBoundingClientRect().width, page: document.documentElement.scrollWidth <= window.innerWidth + 1, h: sc.getBoundingClientRect().height }; });
  expect(m.plot).toBeLessThanOrEqual(m.box + 1); expect(m.page).toBe(true); expect(m.h).toBeGreaterThanOrEqual(320);
  await chart.getByTestId("column").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(chart.getByTestId("cols-tip")).toContainText("Sample client");
  await chart.getByTestId("cols-table-toggle").click();
  await expect(chart.getByTestId("cols-table").locator("tbody tr")).toHaveCount(20);
  await chart.getByLabel("Rows per page").selectOption("100");
  await expect(chart.getByTestId("cols-table").locator("tbody tr")).toHaveCount(100);
});

test("Sync now: syncing, then what changed; a second press shows the wait; errors can retry", async ({ page }) => {
  let polls = 0, posts = 0;
  await page.route(/\/api\/app\/sync-run/, (r) => { polls++; const busy = polls < 2; r.fulfill({ json: busy ? { state: "syncing", accounts: [{ locationId: "a", name: "Bright Smile", pending: 2, done: 1, failed: 0 }], progress: { done: 1, total: 3 }, changed: { contacts: 0, conversations: 0, appointments: 0 }, changes: [], errors: [] } : { state: "done", accounts: [], progress: { done: 3, total: 3 }, changed: { contacts: 12, conversations: 3, appointments: 1 }, changes: [{ locationId: "a", name: "Bright Smile", contacts: 12, conversations: 3, appointments: 1 }], errors: [], line: "12 contacts, 3 conversations, 1 appointment updated" } }); });
  await page.route(/\/api\/app\/sync(\?|$)/, (r) => { if (r.request().method() !== "POST") return r.fallback(); posts++; return posts === 1 ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 429, json: { error: "A sync just started. Try again in 20 seconds.", retryAfterSec: 20 } }); });
  await page.goto("/app");
  await expect(page.getByTestId("sync-now-btn")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("sync-now-btn").click();
  await expect(page.getByTestId("sync-title")).toHaveText("Syncing...");
  await expect(page.getByTestId("sync-title")).toHaveText("Synced just now", { timeout: 20_000 });
  await expect(page.getByTestId("sync-line")).toContainText("12 contacts");
  await expect(page.getByTestId("sync-changes")).toContainText("Bright Smile");
  await page.getByTestId("sync-retry").click();
  await expect(page.getByTestId("sync-error")).toContainText("20 seconds");
});

test("Race waiting list with 100 leads grows downward: no overlap with what follows", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  const leads = Array.from({ length: 100 }, (_, i) => ({ contactId: `c${i}`, locationId: "l1", name: `Lead Person ${i}`, account: "Account One", url: "#", owner: null, step: 1 + (i % 3), stepWords: "Owner told", waitedMin: 30 + i * 9, targetMin: 15 }));
  await page.route(/part=ladder(&|$)/, (r) => r.fulfill({ json: { ladderReady: true, ladder: { enabled: true, nextAfterMin: 45, managerAfterMin: 120 }, leads } }));
  await page.route(/part=ladder-leads/, (r) => r.fulfill({ json: { counts: { 1: 40, 2: 30, 3: 30 }, total: 100, page: 0, pages: 1, from: 1, to: 100, leads } }));
  await page.goto("/app#speed"); await page.reload();
  await page.getByRole("tab", { name: "Rules", exact: true }).first().click({ timeout: 90_000 });
  const list = page.getByTestId("ladder-leads");
  await expect(list.getByTestId("ladder-lead")).toHaveCount(100, { timeout: 60_000 });
  await expect(list.getByTestId("ladder-wait").first()).toHaveText(/\d+ h|\d+ min/);
  const card = page.getByTestId("waiting-now");
  const cardBox = await card.boundingBox(); const listBox = await list.boundingBox();
  expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  const next = await page.evaluate(() => { const c = document.querySelector("[data-testid=waiting-now]")!; const n = c.nextElementSibling ?? c.parentElement?.nextElementSibling; return n ? Math.round(n.getBoundingClientRect().top) : null; });
  const bottom = Math.round((await card.evaluate((e) => e.getBoundingClientRect().bottom)));
  if (next !== null) expect(next).toBeGreaterThanOrEqual(bottom - 1);
  // The filter bar follows on scroll and does not cover the content (it sits in the flow).
  const y = await page.evaluate(() => { window.scrollTo(0, 900); return window.scrollY; });
  expect(y).toBeGreaterThan(300);
  expect(await page.getByTestId("global-filter-bar").evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBeLessThanOrEqual(2);
  const more = page.getByTestId("rules-fold").getByTestId("fold-more-row");
  if (await more.count()) expect((await more.first().evaluate((e) => e.getBoundingClientRect().top))).toBeGreaterThanOrEqual(24 + (await card.evaluate((e) => e.getBoundingClientRect().bottom)));
});
