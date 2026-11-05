import { expect, test, type Page } from "@playwright/test";
import { clearAccounts } from "./today-helpers";

// Today, second pass: real-browser checks of the two live bugs King found (rows out of line in the work list; "Done" and "Show all accounts" in the account picker doing
// nothing) and a click on every control of the page. Desktop 1440 is the gate; the alignment test also resizes to 1024.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "Desktop 1440 is the gate for Today's second pass"); }); // eslint-disable-line no-empty-pattern

async function openToday(page: Page) {
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("queue-row").first()).toBeVisible();
}

/** The left edge (or right edge) of each column of each row. A column is right where every row has the same x within one pixel. */
async function edges(page: Page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="queue-row"]')];
    const visible = (el: Element | null) => (el && (el as HTMLElement).offsetParent !== null ? el : null);
    const pick = (row: Element, sel: string, side: "left" | "right") => { const el = visible(row.querySelector(sel)); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round((side === "left" ? r.left : r.right) * 10) / 10; };
    return rows.map((row) => ({
      amountRight: pick(row, '[data-testid="queue-amount"]', "right"), urgency: pick(row, '[data-col="urgency"]', "left"),
      open: pick(row, '[data-testid="queue-open"]', "left"), openRight: pick(row, '[data-testid="queue-open"]', "right"), more: pick(row, '[data-testid="queue-more"]', "left"),
      height: Math.round(row.getBoundingClientRect().height),
    }));
  });
}

for (const width of [1440, 1024]) {
  test(`the work list: amount, urgency and the action sit at the same x on every row at ${width}, rows are short, and the headings line up`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openToday(page);
    const rows = await edges(page);
    expect(rows.length, "rows on screen").toBeGreaterThanOrEqual(5);
    // At 1024 the list is narrow (amount and urgency fold under the reason); the action and the menu are still one column.
    const cols = (width >= 1440 ? ["amountRight", "urgency", "open", "openRight", "more"] : ["open", "openRight", "more"]) as Array<"amountRight" | "urgency" | "open" | "openRight" | "more">;
    for (const col of cols) {
      const xs = rows.map((r) => r[col]).filter((x): x is number => x !== null);
      expect(xs.length, `${col} is drawn on every row`).toBe(rows.length);
      expect(Math.max(...xs) - Math.min(...xs), `${col} left or right edge differs between rows at ${width}: ${JSON.stringify([...new Set(xs)])}`).toBeLessThanOrEqual(1);
    }
    // KF-8: one small button of one constant word, and a short row (about 56 to 72 px; a reason that wraps on a narrow list may add a line).
    const labels = (await page.getByTestId("queue-open").allInnerTexts()).map((l) => l.trim().split(/\s/)[0]); // the first word (the rest is for a screen reader)
    expect(new Set(labels)).toEqual(new Set(["Open"]));
    const btn = await page.getByTestId("queue-open").first().boundingBox();
    expect(btn!.height, "the button is small").toBeLessThanOrEqual(width >= 1440 ? 36 : 48);
    for (const r of rows) expect(r.height, "a row is short").toBeLessThanOrEqual(width >= 1440 ? 76 : 100);
    if (width >= 1440) {
      // The headings use the same tracks as the cells: "At stake" ends where the amounts end, "Urgency" starts where the urgency words start.
      const head = await page.evaluate(() => {
        const h = document.querySelector('[data-testid="queue-header"]')!;
        const spans = [...h.querySelectorAll("span")].map((e) => e.getBoundingClientRect());
        const first = document.querySelector('[data-testid="queue-row"]')!;
        const amount = first.querySelector('[data-testid="queue-amount"]')!.getBoundingClientRect();
        const urgency = first.querySelector('[data-col="urgency"]')!.getBoundingClientRect();
        return { atStakeRight: spans[1].right, amountRight: amount.right, urgencyLeft: spans[2].left, urgencyCell: urgency.left };
      });
      expect(Math.abs(head.atStakeRight - head.amountRight)).toBeLessThanOrEqual(6);
      expect(Math.abs(head.urgencyLeft - head.urgencyCell)).toBeLessThanOrEqual(1);
    }
    // Nothing runs off the row or the page.
    const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(sw.s).toBeLessThanOrEqual(sw.c);
  });
}

test("the account choice (the shared filter bar): a row ticks anywhere on it, Done closes and applies, All client accounts clears, a click outside closes, the buttons are not covered", async ({ page }) => {
  await openToday(page);
  const pop = page.getByTestId("account-list");
  const button = page.getByTestId("account-button");
  await expect(button).toHaveText(/^All \d+ client accounts$/);
  const total = Number((await button.innerText()).match(/\d+/)![0]);

  // Tick two rows; the button and the address say it, Done closes.
  await button.click();
  await expect(pop).toBeVisible();
  await pop.getByRole("checkbox", { name: "Bright Smile Dental" }).check();
  await pop.getByRole("checkbox", { name: "Blue Door Realty" }).check();
  await expect(pop.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(button).toHaveText(`2 of ${total} client accounts`);
  await expect.poll(() => (new URL(page.url()).hash.match(/ta=([^&]*)/)?.[1] ?? "").split(",").filter(Boolean).length).toBe(2);
  await pop.getByRole("button", { name: "Done", exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect(page.getByTestId("account-chip")).toHaveCount(2);
  // Today is narrowed to those two.
  await expect(page.getByTestId("queue-row").filter({ hasNotText: /Bright Smile Dental|Blue Door Realty/ })).toHaveCount(0);

  // All client accounts: every client is back, no chips, no ta= in the address.
  await clearAccounts(page);
  await expect(button).toHaveText(`All ${total} client accounts`);
  await expect(page.getByTestId("account-chip")).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");

  // A click outside closes the list.
  await button.click();
  await expect(pop).toBeVisible();
  await page.getByTestId("today-breakdown").click();
  await expect(pop).toHaveCount(0);

  // The footer buttons are the topmost element at their own centre, in a short window too.
  await page.setViewportSize({ width: 1024, height: 560 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await button.click();
  for (const name of ["Done", "All client accounts"]) {
    const el = pop.getByRole("button", { name, exact: true });
    const box = await el.boundingBox();
    expect(box, name).not.toBeNull();
    const ok = await el.evaluate((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === top || e.contains(top); });
    expect(ok, `${name} is covered by something`).toBe(true);
  }
  await pop.getByRole("button", { name: "Done", exact: true }).click();
  await expect(pop).toHaveCount(0);
});
