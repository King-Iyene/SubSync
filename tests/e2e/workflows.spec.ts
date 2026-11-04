import { expect, test, type Page } from "@playwright/test";

// Click-test of every control of the Workflows module in a real browser (desktop 1440). Needs the demo login and the module switched on
// (FLAGS_ALL_ON=true, because the module is off by default). Anything that changes the demo is undone at once through History.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "Desktop 1440 is the gate for Workflows"); }); // eslint-disable-line no-empty-pattern

const SHOT = "docs/review";
async function open(page: Page) {
  await page.goto("/app#workflows");
  await expect(page.getByTestId("wf-overview")).toBeVisible({ timeout: 60_000 });
}
const panel = (page: Page) => page.getByTestId("records-panel");
const count = async (page: Page) => Number(await page.getByTestId("records-count").getAttribute("data-count"));
const noSideways = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const tab = (page: Page, id: string) => page.getByTestId(`wf-tab-${id}`).click();

test("the overview: every number, slice, bar and legend row opens the records behind it, and the count matches", async ({ page }) => {
  await open(page);
  await noSideways(page);
  await expect(page.getByTestId("wf-next")).toBeVisible();
  await page.screenshot({ path: `${SHOT}/workflows-overview-desktop-1440.png`, fullPage: true });
  for (const id of ["wf-n-total", "wf-n-failing", "wf-n-never", "wf-n-draft"]) {
    const tile = page.getByTestId(id);
    const shown = Number((await tile.innerText()).match(/\d+/g)?.pop());
    await tile.click();
    await expect(panel(page)).toBeVisible();
    expect(await count(page), id).toBe(shown);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  }
  for (const sel of ['[data-testid^="wf-slice-"]', '[data-testid^="wf-legend-"]', '[data-testid^="wf-bar-"]']) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    // A ring's bounding box centre is its empty middle, so a slice is pressed through its own click handler; the legend row beside it is clicked for real.
    if (sel.includes("slice")) await el.dispatchEvent("click"); else await el.click();
    await expect(panel(page), sel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  }
  // a legend row's number equals the rows in its panel
  const legend = page.locator('[data-testid^="wf-legend-"]').first();
  const n = Number((await legend.innerText()).match(/\d+/g)?.pop());
  await legend.click();
  expect(await count(page)).toBe(n);
  await page.keyboard.press("Escape");
  const points = page.getByTestId("wf-point");
  if (await points.count()) { await points.last().click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  // the Show switch and the print button
  for (const s of ["campaign", "both", "workflow"]) { await page.getByTestId(`wf-show-${s}`).click(); await expect(page.getByTestId(`wf-show-${s}`)).toHaveAttribute("aria-pressed", "true"); }
  await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
  await page.getByTestId("wf-print").click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.getByTestId("wf-sync")).toBeEnabled();
});

test("the list: search, state, paging controls, columns line up, a row opens its panel with notes that save", async ({ page }) => {
  await open(page);
  await tab(page, "list");
  await expect(page.getByTestId("wf-table")).toBeVisible();
  const rows = page.getByTestId("wf-row");
  expect(await rows.count()).toBeGreaterThan(3);
  // every column starts at the same x on every row (fixed tracks)
  const xs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="wf-row"]')].map((r) => [...r.children].map((c) => Math.round((c as HTMLElement).getBoundingClientRect().x)).join(",")));
  expect(new Set(xs).size).toBe(1);
  await page.getByTestId("wf-search").fill("zzzz-nothing");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await page.getByTestId("wf-search").fill("Missed");
  expect(await rows.count()).toBeGreaterThan(0);
  await page.getByTestId("wf-search").fill("");
  await page.getByTestId("wf-state").selectOption("draft");
  const drafts = await rows.count();
  expect(drafts).toBeGreaterThan(0);
  await page.getByTestId("wf-state").selectOption("all");
  await page.screenshot({ path: `${SHOT}/workflows-list-desktop-1440.png`, fullPage: true });
  await page.getByTestId("wf-open").first().click();
  await expect(page.getByTestId("wf-panel")).toBeVisible();
  await expect(page.getByTestId("wf-detail")).toBeVisible();
  await page.getByTestId("wf-decision-review").click();
  await page.getByTestId("wf-rate-4").click();
  await page.getByTestId("wf-labels").fill("lead handling, test");
  await page.getByTestId("wf-owner").fill("Dana");
  await page.getByTestId("wf-note").fill("Checked in the test");
  await page.getByTestId("wf-save").click();
  await expect(page.getByTestId("wf-save-msg")).toContainText("Saved in SubSync");
  await page.getByTestId("wf-watch").click();
  await page.screenshot({ path: `${SHOT}/workflows-panel-desktop-1440.png` });
  await page.getByTestId("wf-panel-close").click();
  await expect(page.getByTestId("wf-panel")).toBeHidden();
  await page.getByTestId("wf-open").first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wf-panel")).toBeHidden();
  // undo what the test set
  await page.getByTestId("wf-open").first().click();
  await page.getByTestId("wf-decision-review").click();
  await page.getByTestId("wf-rate-4").click();
  await page.getByTestId("wf-labels").fill("");
  await page.getByTestId("wf-owner").fill("");
  await page.getByTestId("wf-note").fill("");
  await page.getByTestId("wf-save").click();
  await expect(page.getByTestId("wf-save-msg")).toContainText("Saved");
  await page.getByTestId("wf-watch").click();
  await page.getByTestId("wf-panel-close").click();
});

test("changing: pick rows, preview, back, cancel; delete needs the typed words; rename confirms and History undoes it", async ({ page }) => {
  await open(page);
  await tab(page, "list");
  await page.getByTestId("wf-state").selectOption("draft");
  await page.getByTestId("wf-pick").first().check();
  await expect(page.getByTestId("wf-actions")).toBeVisible();
  await expect(page.getByTestId("wf-picked")).toContainText("1 picked");
  // delete: the Confirm button stays off until the exact words are typed
  await page.getByTestId("wf-do-delete").click();
  await expect(page.getByTestId("wf-dialog")).toBeVisible();
  await page.getByTestId("wf-preview-btn").click();
  await expect(page.getByTestId("wf-preview")).toBeVisible();
  const phrase = (await page.getByTestId("wf-phrase").innerText()).trim();
  await expect(page.getByTestId("wf-confirm")).toBeDisabled();
  await page.getByTestId("wf-typed").fill("nope");
  await expect(page.getByTestId("wf-confirm")).toBeDisabled();
  await page.getByTestId("wf-typed").fill(phrase);
  await expect(page.getByTestId("wf-confirm")).toBeEnabled();
  await page.getByTestId("wf-back").click();
  await expect(page.getByTestId("wf-simple")).toBeVisible();
  await page.getByTestId("wf-back").click();
  await expect(page.getByTestId("wf-dialog")).toBeHidden();
  // publish and pause previews
  for (const k of ["publish", "unpublish"]) {
    await page.getByTestId(`wf-do-${k}`).click();
    await page.getByTestId("wf-preview-btn").click();
    await expect(page.getByTestId("wf-preview")).toBeVisible();
    await page.getByTestId("wf-dialog-close").click();
    await expect(page.getByTestId("wf-dialog")).toBeHidden();
  }
  // copy needs a target first
  await page.getByTestId("wf-do-clone").click();
  await expect(page.getByTestId("wf-preview-btn")).toBeDisabled();
  await page.getByTestId("wf-target").selectOption({ index: 1 });
  await page.getByTestId("wf-preview-btn").click();
  await expect(page.getByTestId("wf-preview-row").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wf-dialog")).toBeHidden();
  // rename: preview shows before and after, confirm applies it in the demo, History undoes it
  await page.getByTestId("wf-do-rename").click();
  await expect(page.getByTestId("wf-preview-btn")).toBeDisabled();
  await page.getByTestId("wf-prefix").fill("[Test] ");
  await page.getByTestId("wf-preview-btn").click();
  await expect(page.getByTestId("wf-preview-row").first()).toContainText("[Test]");
  await page.screenshot({ path: `${SHOT}/workflows-rename-preview-desktop-1440.png` });
  await page.getByTestId("wf-confirm").click();
  await expect(page.getByTestId("wf-result")).toBeVisible();
  await page.getByTestId("wf-done").click();
  await tab(page, "history");
  await expect(page.getByTestId("wf-history")).toBeVisible();
  await expect(page.getByTestId("wf-history-row").first()).toContainText("[Test]");
  await page.screenshot({ path: `${SHOT}/workflows-history-desktop-1440.png`, fullPage: true });
  await page.getByTestId("wf-undo").first().click();
  await expect(page.getByTestId("wf-history-row").filter({ hasText: "undone" })).toHaveCount(1, { timeout: 15_000 });
});

test("health: each finding explains itself, Mark fixed and Snooze set it aside, Bring back returns it", async ({ page }) => {
  await open(page);
  await tab(page, "health");
  await expect(page.getByTestId("wf-health")).toBeVisible();
  const findings = page.getByTestId("wf-finding");
  expect(await findings.count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOT}/workflows-health-desktop-1440.png`, fullPage: true });
  const before = await findings.count();
  await page.getByTestId("wf-fixed").first().click();
  await expect(findings).toHaveCount(before - 1);
  await expect(page.getByTestId("wf-muted")).toBeVisible();
  await page.getByTestId("wf-snooze").first().click();
  await expect(findings).toHaveCount(before - 2);
  const back = page.getByTestId("wf-reopen");
  for (let i = await back.count(); i > 0; i--) { await back.first().click(); await expect(back).toHaveCount(i - 1, { timeout: 10_000 }); }
  await expect(findings).toHaveCount(before);
  await page.getByTestId("wf-finding-open").first().click();
  await expect(page.getByTestId("wf-panel")).toBeVisible();
  await page.getByTestId("wf-panel-close").click();
  await expect(page.getByTestId("wf-coverage")).toBeVisible();
});

test("campaign delivery: filters, numbers open the campaigns behind them, compare, and what the platform does not give is said", async ({ page }) => {
  await open(page);
  await tab(page, "delivery");
  await expect(page.getByTestId("wf-delivery")).toBeVisible();
  await expect(page.getByTestId("wf-d-numbers")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("wf-d-na")).toContainText("not available from the platform yet");
  await page.screenshot({ path: `${SHOT}/workflows-delivery-desktop-1440.png`, fullPage: true });
  await page.getByTestId("wf-d-n-sent").click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("wf-d-n-bounced").click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  for (const sel of ['[data-testid^="wf-bar-"]']) { await page.locator(sel).first().click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  await page.getByTestId("wf-d-range").selectOption("90");
  await page.getByTestId("wf-d-range").selectOption("all");
  await page.getByTestId("wf-d-status").selectOption({ index: 1 });
  await page.getByTestId("wf-d-status").selectOption("all");
  await page.getByTestId("wf-d-source").selectOption({ index: 1 });
  await page.getByTestId("wf-d-source").selectOption("all");
  const picks = page.getByTestId("wf-d-pick");
  await picks.nth(0).check();
  await picks.nth(1).check();
  await expect(page.getByTestId("wf-d-compare")).toBeVisible();
  await expect(page.getByTestId("wf-d-league")).toBeVisible();
  await noSideways(page);
});

test("proof: the weekly numbers open their alerts, the period switches, and it prints", async ({ page }) => {
  await open(page);
  await tab(page, "proof");
  await expect(page.getByTestId("wf-proof")).toBeVisible();
  await page.getByTestId("wf-proof-30").click();
  await expect(page.getByTestId("wf-proof-30")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("wf-proof-7").click();
  for (const id of ["wf-proof-raised", "wf-proof-cleared", "wf-proof-open"]) {
    await page.getByTestId(id).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => { window.print = () => undefined; });
  await page.getByTestId("wf-proof-print").click();
  await page.screenshot({ path: `${SHOT}/workflows-proof-desktop-1440.png`, fullPage: true });
});

test("a client's staff see their own account only, with no change buttons", async ({ page }) => {
  await page.goto("/app?as=client#workflows");
  await expect(page.getByTestId("wf-overview")).toBeVisible({ timeout: 60_000 });
  await tab(page, "list");
  await expect(page.getByTestId("wf-pick")).toHaveCount(0);
  await expect(page.getByTestId("wf-sync")).toHaveCount(0);
  await page.getByTestId("wf-open").first().click();
  await expect(page.getByTestId("wf-save")).toHaveCount(0);
  await page.getByTestId("wf-panel-close").click();
});

test("only the page's own account picker shows: the shell's account bar is hidden here and still there on other pages", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("toolbar").getByText("Filter accounts")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Client accounts/ })).toBeVisible();
  await page.goto("/app#overview");
  await expect(page.getByTestId("toolbar").getByText("Filter accounts")).toBeVisible({ timeout: 30_000 });
});

test("tidy up: names to fix preview before they change, duplicates and the same workflow across accounts open their rows", async ({ page }) => {
  await open(page);
  await tab(page, "tidy");
  await expect(page.getByTestId("wf-tidy")).toBeVisible();
  await expect(page.getByTestId("wf-names")).toBeVisible();
  await page.screenshot({ path: `${SHOT}/workflows-tidy-desktop-1440.png`, fullPage: true });
  // the one-tap fix opens the rename preview with the rule already filled in; nothing is sent until Confirm
  await page.getByTestId("wf-fix-copy").click();
  await expect(page.getByTestId("wf-dialog")).toBeVisible();
  await page.getByTestId("wf-allow-paused").check();
  await page.getByTestId("wf-preview-btn").click();
  await expect(page.getByTestId("wf-preview-row").first()).toBeVisible();
  await expect(page.getByTestId("wf-confirm")).toBeEnabled();
  await page.getByTestId("wf-dialog-close").click();
  await expect(page.getByTestId("wf-dialog")).toBeHidden();
  await page.getByTestId("wf-dupe-show").first().click();
  await expect(panel(page)).toBeVisible();
  expect(await count(page)).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await page.getByTestId("wf-compare-show").first().click();
  await expect(panel(page)).toBeVisible();
  expect(await count(page)).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wf-compare-row").first()).toContainText("accounts");
});

test("the turned-off check, saved views and the command palette", async ({ page }) => {
  await open(page);
  await tab(page, "health");
  await expect(page.getByTestId("wf-findings")).toContainText("was turned off");
  // saved view: name it, save it, change the page, apply it
  await page.getByTestId("wf-view-name").fill("My tidy view");
  await page.getByTestId("wf-tab-tidy").click();
  await page.getByTestId("wf-show-both").click();
  await page.getByTestId("wf-view-save").click();
  await expect(page.getByTestId("wf-view-pick")).toBeVisible();
  await page.getByTestId("wf-tab-overview").click();
  await page.getByTestId("wf-show-workflow").click();
  await page.getByTestId("wf-view-pick").selectOption("My tidy view");
  await expect(page.getByTestId("wf-tidy")).toBeVisible();
  await expect(page.getByTestId("wf-show-both")).toHaveAttribute("aria-pressed", "true");
  // palette by keyboard: Ctrl Shift K, type, Enter
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByTestId("wf-palette")).toBeVisible();
  await page.getByTestId("wf-palette-input").fill("proof");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("wf-proof")).toBeVisible();
  // palette by mouse: open a workflow by name
  await page.getByTestId("wf-palette-open").click();
  await page.getByTestId("wf-palette-input").fill("Missed Call");
  await page.getByTestId("wf-palette-row").filter({ hasText: "Items" }).first().click();
  await expect(page.getByTestId("wf-panel")).toBeVisible();
  await page.getByTestId("wf-panel-close").click();
  await page.keyboard.press("Control+Shift+K");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wf-palette")).toBeHidden();
  // tidy up after the test: remove the saved view through the API the page uses
  await page.evaluate(async () => { const t = (await fetch("/api/sso/demo", { method: "POST" }).catch(() => null)); void t; });
});
