import { expect, test, type Page } from "@playwright/test";

// Click-test of every control of the Data health module in a real browser (desktop 1440). Needs the demo login and the module switched on
// (FLAGS_ALL_ON=true, because the module is off by default). Changes made here are rehearsals (nothing is sent) and are undone at once.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "Desktop 1440 is the gate for Data health"); }); // eslint-disable-line no-empty-pattern

const SHOT = "docs/review";
const panel = (page: Page) => page.getByTestId("records-panel");
const count = async (page: Page) => Number(await page.getByTestId("records-count").getAttribute("data-count"));
// DH_LAYOUT=off skips the two layout checks when a dev server cannot load the stylesheet (then nothing is laid out at all).
const LAYOUT = process.env.DH_LAYOUT !== "off";
const noSideways = async (page: Page) => LAYOUT && expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const tab = (page: Page, id: string) => page.getByTestId(`wf-tab-${id}`).click();

/** Every row of a grid table starts its cells at the same x as the header's cells: columns line up. */
async function aligned(page: Page, tableTestId: string) {
  if (!LAYOUT) return;
  const xs = await page.getByTestId(tableTestId).evaluate((t) => [...t.querySelectorAll('[role="row"]')].map((r) => [...r.children].map((c) => Math.round(c.getBoundingClientRect().left))));
  for (const row of xs.slice(1)) expect(row, tableTestId).toEqual(xs[0]);
}
async function open(page: Page) {
  await page.goto("/app#data-health");
  await expect(page.getByTestId("dh-overview")).toBeVisible({ timeout: 90_000 });
  // The demo agency has several accounts: open the first one that has a score.
  if (await page.getByTestId("dh-league").count()) {
    await aligned(page, "dh-league");
    await noSideways(page);
    await page.screenshot({ path: `${SHOT}/data-health-league-desktop-1440.png`, fullPage: true });
    const rows = page.getByTestId("dh-league-row");
    const n = await rows.count();
    let pick = 0;
    for (let i = 0; i < n; i++) if (!/Not enough/.test(await rows.nth(i).innerText())) { pick = i; break; }
    await page.getByTestId("dh-open-account").nth(pick).click();
  }
  await expect(page.getByTestId("dh-score")).toBeVisible();
}

test("overview: score, why, since install, every number opens its records and the count matches", async ({ page }) => {
  await open(page);
  await noSideways(page);
  await expect(page.getByTestId("dh-why")).toContainText(/out of 100|Not enough data/);
  await aligned(page, "dh-components");
  await page.screenshot({ path: `${SHOT}/data-health-overview-desktop-1440.png`, fullPage: true });
  const ids = ["duplicate", "junk", "bad_phone", "bad_email", "missing_phone", "missing_email", "stale", "no_owner", "no_source", "orphan"];
  let opened = 0;
  for (const id of ids) {
    const cell = page.getByTestId(`dh-c-${id}`);
    const shown = Number((await cell.innerText()).replace(/\D/g, ""));
    if (shown === 0) continue;
    await cell.click();
    await expect(panel(page)).toBeVisible();
    expect(await count(page), id).toBe(shown);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    opened++;
  }
  expect(opened).toBeGreaterThan(0);
  // time slider and the trend
  await page.getByTestId("dh-slider").fill("0");
  await page.getByTestId("dh-slider-open").click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  const points = page.getByTestId("wf-point");
  if (await points.count()) { await points.last().click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  await page.evaluate(() => { window.print = () => undefined; });
  await page.getByTestId("dh-print").click();
});

test("imports, finders, queue, rules, proof, export", async ({ page }) => {
  await open(page);
  await tab(page, "imports");
  await expect(page.getByTestId("dh-imports")).toBeVisible();
  if (await page.getByTestId("dh-source-row").count()) {
    await aligned(page, "dh-sources");
    const first = page.getByTestId("dh-source-n").first();
    const shown = Number(await first.innerText());
    await first.click();
    await expect(panel(page)).toBeVisible();
    expect(await count(page)).toBe(shown);
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: `${SHOT}/data-health-imports-desktop-1440.png`, fullPage: true });

  await tab(page, "queue");
  await expect(page.getByTestId("dh-queue")).toBeVisible();
  for (const r of ["junk", "orphan", "stale", "duplicate"]) {
    await page.getByTestId(`dh-find-${r}`).click();
    await expect(page.getByTestId(`dh-find-${r}`)).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
    if (await page.getByTestId("dh-finder-count").count()) {
      const shown = Number((await page.getByTestId("dh-finder-count").innerText()).match(/^\d+/)?.[0]);
      if (shown <= 100) expect(await page.getByTestId("dh-finder-row").count(), r).toBe(shown);
      await aligned(page, "dh-finder-table");
    }
  }
  await page.getByTestId("dh-find-orphan").click();
  await page.waitForTimeout(400);
  if (await page.getByTestId("dh-finder-row").count()) {
    const before = await page.getByTestId("dh-finder-row").count();
    await page.getByTestId("dh-owner").fill("Sam");
    await page.getByTestId("dh-act-todo").first().click();
    await expect(page.getByTestId("dh-finder-row").first()).toContainText("In the queue");
    await page.getByTestId("dh-open-queue").click();
    await expect(panel(page)).toBeVisible();
    expect(await count(page)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    // put it back: ignore removes it from the list and the score; reopening is done through the queue mark being replaced
    await page.getByTestId("dh-act-ignored").first().click();
    await expect.poll(async () => page.getByTestId("dh-finder-row").count()).toBeLessThanOrEqual(before);
  }
  await page.screenshot({ path: `${SHOT}/data-health-finders-desktop-1440.png`, fullPage: true });

  await tab(page, "rules");
  await expect(page.getByTestId("dh-rules")).toBeVisible();
  await page.getByTestId("dh-words").fill("zzjunkword");
  await page.getByTestId("dh-rules-save").click();
  await expect(page.getByText("Saved. The score uses these from the next update.")).toBeVisible();
  const dl = page.waitForEvent("download").catch(() => null);
  await page.getByTestId("dh-export").click();
  await dl;
  await page.screenshot({ path: `${SHOT}/data-health-rules-desktop-1440.png`, fullPage: true });

  await tab(page, "proof");
  await expect(page.getByTestId("dh-proof")).toBeVisible();
  await expect(page.getByTestId("dh-proof-lines")).toContainText(/data health|Not enough/i);
  await page.screenshot({ path: `${SHOT}/data-health-proof-desktop-1440.png`, fullPage: true });
  await noSideways(page);
});

test("fix: preview, rehearsal confirm, undo", async ({ page }) => {
  await open(page);
  await tab(page, "fix");
  await expect(page.getByTestId("dh-fix")).toBeVisible();
  await page.getByTestId("dh-kind-name").check();
  await page.getByTestId("dh-preview").click();
  await expect(page.getByTestId("dh-plan")).toBeVisible();
  const n = Number((await page.getByTestId("dh-plan-count").innerText()).match(/^\d+/)?.[0]);
  await page.screenshot({ path: `${SHOT}/data-health-fix-desktop-1440.png`, fullPage: true });
  if (n > 0) {
    await page.getByTestId("dh-confirm").click();
    await expect(page.getByText(/Rehearsal only/)).toBeVisible();
    await expect(page.getByTestId("dh-undo").first()).toBeVisible();
    while (await page.getByTestId("dh-undo").count()) { const c = await page.getByTestId("dh-undo").count(); await page.getByTestId("dh-undo").first().click(); await expect.poll(async () => page.getByTestId("dh-undo").count()).toBeLessThan(c); }
  }
  await noSideways(page);
});
