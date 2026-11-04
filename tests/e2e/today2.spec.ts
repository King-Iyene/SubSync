import { expect, test, type Page } from "@playwright/test";

// Today, second pass: real-browser checks of the two live bugs King found (rows out of line in Fix first; "Done" and "Show all accounts" in the account picker doing
// nothing) and a click on every control of the page. Desktop 1440 is the gate; the alignment test also resizes to 1024.
test.skip(({}, info) => info.project.name !== "desktop-1440", "Desktop 1440 is the gate for Today's second pass");

async function openToday(page: Page) {
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("queue-row").first()).toBeVisible();
}

/** The left edge (or right edge) of each column of each row. A column is right where every row has the same x within one pixel. */
async function edges(page: Page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="queue-row"]')];
    const pick = (row: Element, sel: string, side: "left" | "right") => { const el = row.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round((side === "left" ? r.left : r.right) * 10) / 10; };
    return rows.map((row) => ({
      amount: pick(row, '[data-col="amount"]', "left"), amountRight: pick(row, '[data-testid="queue-amount"], [data-col="amount"] .tnum', "right"),
      urgency: pick(row, '[data-col="urgency"]', "left"), open: pick(row, '[data-testid="queue-open"]', "left"), show: pick(row, '[data-testid="queue-show"]', "left"),
      done: pick(row, '[data-testid="queue-done"]', "left"), more: pick(row, '[data-testid="queue-more"]', "left"), top: Math.round(row.getBoundingClientRect().top),
    }));
  });
}

for (const width of [1440, 1024]) {
  test(`Fix first: amount, urgency and every button sit at the same x on every row at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openToday(page);
    if (await page.getByTestId("queue-all").count()) await page.getByTestId("queue-all").click();
    const rows = await edges(page);
    expect(rows.length, "rows on screen").toBeGreaterThan(4);
    for (const col of ["amount", "amountRight", "urgency", "open", "show", "done", "more"] as const) {
      const xs = rows.map((r) => r[col]).filter((x): x is number => x !== null);
      expect(xs.length, `${col} is drawn on every row`).toBe(rows.length);
      expect(Math.max(...xs) - Math.min(...xs), `${col} left or right edge differs between rows at ${width}: ${JSON.stringify([...new Set(xs)])}`).toBeLessThanOrEqual(1);
    }
    // The button label is one short constant word, so its width is the same on every row.
    const labels = await page.getByTestId("queue-show").allInnerTexts();
    expect(new Set(labels.map((l) => l.trim()))).toEqual(new Set(["Show"]));
    // Nothing runs off the row or the page.
    const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(sw.s).toBeLessThanOrEqual(sw.c);
  });
}

test("the account picker: rows toggle on a click anywhere on them, Done closes and applies, Show all accounts selects every account, Esc and a click outside close", async ({ page }) => {
  await openToday(page);
  const picker = page.getByTestId("today-account-picker");
  const pop = page.getByTestId("picker-popover");
  const summary = page.getByTestId("picker-summary");
  await expect(summary).toHaveText(/^All \d+$/);
  const total = Number((await summary.innerText()).replace("All ", ""));

  // A click on the name text of a row (not on the box) ticks it.
  await picker.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  const names = pop.getByTestId("picker-list").getByRole("listitem");
  await names.nth(0).getByText(/.+/).first().click();
  await names.nth(1).getByText(/.+/).first().click();
  await expect(pop.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await pop.getByTestId("picker-done").click();
  await expect(pop).toHaveCount(0);
  await expect(summary).toHaveText(`2 of ${total}`);
  await expect.poll(() => (new URL(page.url()).hash.match(/ta=([^&]*)/)?.[1] ?? "").split(",").filter(Boolean).length).toBe(2);
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip").first()).toContainText("2 client accounts");

  // Show all accounts: closes, every account counts again, the address has no ta=.
  await picker.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  await pop.getByTestId("picker-all").click();
  await expect(pop).toHaveCount(0);
  await expect(summary).toHaveText(`All ${total}`);
  await expect.poll(() => page.url().includes("ta=")).toBe(false);

  // Show all accounts when nothing was picked still closes (it used to do nothing).
  await picker.getByTestId("picker-button").click();
  await pop.getByTestId("picker-all").click();
  await expect(pop).toHaveCount(0);

  // Esc closes and keeps what was ticked.
  await picker.getByTestId("picker-button").click();
  await pop.getByTestId("picker-list").getByRole("listitem").nth(2).click();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(summary).not.toHaveText(`All ${total}`);

  // A click outside closes it.
  await picker.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Today" }).click();
  await expect(pop).toHaveCount(0);

  // The footer buttons are the topmost element at their own centre (nothing sits over them).
  await picker.getByTestId("picker-button").click();
  for (const id of ["picker-done", "picker-all"]) {
    const ok = await page.getByTestId(id).evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === top || el.contains(top); });
    expect(ok, `${id} is covered by something`).toBe(true);
  }
});
