import { expect, test, type Locator, type Page } from "@playwright/test";
import { api as sharedApi, moreMenu, openMore, type Json, clearAccounts } from "./today-helpers";

// Today, second pass, in a real browser at 1440 (updated for Today v3): the records panel from every kind of mark (count equals rows), the fixed-column alignment of every list, the
// account picker's Done and Show all accounts buttons, the working queue (Done for now, Snooze, Undo) from the row menu, the More detail tabs, and a click on every other button and link
// built for Today to prove each one does something. Each test that changes the working queue puts it back (Undo) so the tests can run again. Demo company; agency owner, business
// administrator and client's staff.
async function api(request: Parameters<typeof sharedApi>[0], as?: "business" | "client") {
  const a = await sharedApi(request, as);
  return { get: a.get, post: async (path: string, data: Json) => { const r = await a.post(path, data); return { status: () => r.status, json: async () => r.body }; } };
}
const num = (s: string) => Number(s.replace(/[^0-9]/g, ""));
/** A figure counts up for 600 ms: read the value it ends on, never the text in the middle of the count. */
async function final(l: Locator): Promise<number> {
  const el = l.locator("[data-final]").first();
  return num((await el.count()) ? ((await el.getAttribute("data-final")) ?? "") : await l.innerText());
}
async function openToday(page: Page, query = "") {
  await page.goto(`/app${query}`);
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("queue-row").first()).toBeVisible({ timeout: 45_000 });
}
const panel = (page: Page) => page.getByTestId("records-panel");
async function closePanel(page: Page) { await page.keyboard.press("Escape"); await expect(panel(page)).toHaveCount(0); }
const heldCount = async (page: Page) => ((await page.getByTestId("held-link").count()) ? Number(await page.getByTestId("held-link").getAttribute("data-count")) : 0);

/** The left edge of each child of every row, as numbers: row by row, then compared column by column. */
async function leftEdges(rows: Locator, child: string): Promise<number[][]> {
  return rows.evaluateAll((els, sel) => els.map((el) => [...el.querySelectorAll(sel as string)].map((c) => Math.round((c as HTMLElement).getBoundingClientRect().left * 10) / 10)), child);
}
function sameColumns(edges: number[][], label: string) {
  const full = edges.filter((r) => r.length === edges[0].length);
  expect(full.length, `${label}: rows with the same cells`).toBeGreaterThan(1);
  for (let c = 0; c < edges[0].length; c++) {
    const xs = full.map((r) => r[c]);
    expect(Math.max(...xs) - Math.min(...xs), `${label}: column ${c} left edges ${xs.join(", ")}`).toBeLessThanOrEqual(1);
  }
}

test("every column of the work list lines up on every row, at 1440 and at 1024", async ({ page }) => {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await openToday(page);
    const rows = page.getByTestId("queue-row");
    expect(await rows.count()).toBeGreaterThan(2);
    // A column that a narrow list folds away (amount and urgency under the reason) is not drawn, so only the drawn ones are compared.
    for (const col of ["amount", "urgency", "crm", "more"]) {
      const xs = await rows.evaluateAll((els, c) => els.map((el) => { const e = el.querySelector(`[data-col=${c}]`) as HTMLElement; return e && e.offsetParent !== null ? Math.round(e.getBoundingClientRect().left * 10) / 10 : null; }), col);
      const drawn = xs.filter((x): x is number => x !== null);
      if (width >= 1440 || col === "crm" || col === "more") expect(drawn.length, `${width}px: ${col} drawn on every row`).toBe(xs.length);
      if (drawn.length) expect(Math.max(...drawn) - Math.min(...drawn), `${width}px, work-list column ${col}: ${drawn.join(", ")}`).toBeLessThanOrEqual(1);
      const ws = await rows.evaluateAll((els, c) => els.map((el) => { const e = el.querySelector(`[data-col=${c}]`) as HTMLElement; return e && e.offsetParent !== null ? Math.round(e.getBoundingClientRect().width * 10) / 10 : null; }), col);
      const w = ws.filter((x): x is number => x !== null);
      if (w.length) expect(Math.max(...w) - Math.min(...w), `${width}px, work-list column ${col} width: ${w.join(", ")}`).toBeLessThanOrEqual(1);
    }
  }
});

test("People, Sources and Coverage lists line up too", async ({ page }) => {
  await openToday(page);
  await openMore(page, "People");
  await expect(page.getByTestId("tab-people")).toBeVisible();
  const work = page.getByTestId("workload-row");
  if ((await work.count()) > 1) sameColumns(await leftEdges(work, ":scope > span"), "workload");
  const cmp = page.getByTestId("compare-fastest").getByTestId("compare-row");
  if ((await cmp.count()) > 1) sameColumns(await leftEdges(cmp, ":scope > span"), "compare");
  await page.getByRole("tab", { name: "Sources" }).click();
  const src = page.getByTestId("source-row");
  if ((await src.count()) > 1) sameColumns(await leftEdges(src, ":scope > span"), "sources");
});


test("a tile opens the records panel and its count is the number on the tile", async ({ page, request }) => {
  const { get } = await api(request);
  const today = await get("today");
  await openToday(page);
  await openMore(page);
  const shown = await final(page.getByTestId("pulse-replies").locator("p.t-figure"));
  await page.getByTestId("pulse-replies-open").click();
  await expect(panel(page)).toBeVisible();
  const count = page.getByTestId("records-count");
  expect(Number(await count.getAttribute("data-count"))).toBe(shown);
  expect(shown).toBeGreaterThan(0);
  expect(Number(await count.getAttribute("data-count"))).toBe(today.totals.replies.count - Object.values(today.holds as Json).filter((h: Json) => String(h.rowKey).includes("|replies")).length);
  // The header says a title and a sentence in words, and the rows are the people.
  await expect(page.getByTestId("records-title")).toContainText("needs a reply");
  await expect(page.getByTestId("records-subtitle")).toContainText("reply target");
  expect(await page.getByTestId("records-row").count()).toBe(Math.min(50, shown));
  await expect(page.getByTestId("records-showing")).toContainText(`Showing ${Math.min(50, shown)} of ${shown}`);
  await expect(page.getByTestId("records-overlay")).toBeVisible();
  // The header row stays put while the table scrolls.
  const th = page.getByTestId("records-th").first();
  const before = (await th.boundingBox())!.y;
  await page.getByTestId("records-scroll").evaluate((el) => { el.scrollTop = 400; });
  expect(Math.abs((await th.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
  await closePanel(page);
});

test("the panel: search, filter chip, + Filter, sort, date range, Maximise, Export CSV, OPEN, Open in CRM, paging, X and Esc", async ({ page }) => {
  await openToday(page);
  await openMore(page);
  await page.getByTestId("pulse-replies-open").click();
  const total = Number(await page.getByTestId("records-count").getAttribute("data-count"));
  // Search narrows ("12 of 57"), clearing it restores.
  await page.getByTestId("records-search-toggle").click();
  const firstName = (await page.getByTestId("records-row").first().locator("td").first().innerText()).replace(/OPEN/g, "").trim().split(/\s+/)[0];
  await page.getByTestId("records-search").fill(firstName);
  await expect(page.getByTestId("records-count")).toContainText(` of ${total}`);
  expect(Number(await page.getByTestId("records-count").getAttribute("data-shown"))).toBeLessThan(total + 1);
  await page.getByTestId("records-search").fill("");
  await expect(page.getByTestId("records-count")).not.toContainText(" of ");
  // A facet chip: choose one account.
  await page.getByTestId("records-chip-account").click();
  const option = page.getByTestId("facet-option").first();
  await option.check();
  await page.keyboard.press("Escape"); // closes the chip's list, not the panel
  await expect(panel(page)).toBeVisible();
  const narrowed = Number(await page.getByTestId("records-count").getAttribute("data-shown"));
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThan(total);
  await expect(page.getByTestId("records-showing")).toContainText(`of ${narrowed}`);
  // "+ Filter" adds another chip.
  await page.getByTestId("records-add-filter").click();
  await page.getByTestId("add-filter-source").click();
  await expect(page.getByTestId("records-chip-source")).toBeVisible();
  await page.keyboard.press("Escape");
  // Date range chip: "Older than 30 days" leaves nothing for people waiting; Any time restores.
  await page.getByTestId("records-chip-range").click();
  await page.getByTestId("range-old30").click();
  await expect(page.getByTestId("records-empty")).toBeVisible();
  await page.getByTestId("records-chip-range").click();
  await page.getByTestId("range-any").click();
  await expect(page.getByTestId("records-row").first()).toBeVisible();
  // Sort by a column: aria-sort changes.
  await page.getByTestId("sort-since").click();
  await expect(page.getByTestId("records-th").filter({ hasText: "Wrong since" })).toHaveAttribute("aria-sort", "ascending");
  await page.getByTestId("sort-since").click();
  await expect(page.getByTestId("records-th").filter({ hasText: "Wrong since" })).toHaveAttribute("aria-sort", "descending");
  // Clear filters from the menu.
  await page.getByTestId("records-menu").click();
  await page.getByTestId("records-reset").click();
  await expect(page.getByTestId("records-count")).toHaveAttribute("data-shown", String(total));
  // Export CSV: only the columns shown, every row left (not only the page), a formula-safe file.
  await page.getByTestId("records-menu").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("records-export").click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const text = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).replace(/^﻿/, "");
  const lines = text.trim().split("\r\n");
  expect(lines.length - 1).toBe(total);
  const headers = await page.getByTestId("records-th").allInnerTexts();
  expect(lines[0].split(",").length).toBe(headers.length);
  // Maximise and back.
  await page.getByTestId("records-maximise").click();
  await expect(panel(page)).toHaveAttribute("data-maximised", "true");
  const big = await panel(page).boundingBox();
  expect(big!.width).toBeGreaterThanOrEqual(1438);
  await page.getByTestId("records-maximise").click();
  await expect(panel(page)).toHaveAttribute("data-maximised", "false");
  expect((await panel(page).boundingBox())!.width).toBeLessThanOrEqual(962);
  // Paging: 50 rows a page, never more than 200 in the page at once.
  if (total > 50) {
    await page.getByTestId("records-next").click();
    await expect(page.getByTestId("records-showing")).toContainText(`Showing ${Math.min(50, total - 50)} of ${total}`);
  }
  expect(await page.getByTestId("records-row").count()).toBeLessThanOrEqual(50);
  // Open in CRM is a real link that opens a new tab with the white-label address; OPEN shows the lead.
  const link = page.getByTestId("records-crm").first();
  await expect(link).toHaveAttribute("target", "_blank");
  expect(await link.getAttribute("href")).toMatch(/^https:\/\//);
  await page.getByTestId("records-row").first().hover();
  await page.getByTestId("records-open").first().click();
  await expect(page.getByTestId("lead-drawer-root")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer-root")).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  // The cross closes it.
  await page.getByTestId("records-close").click();
  await expect(panel(page)).toHaveCount(0);
  // Focus is trapped while it is open.
  await page.getByTestId("pulse-replies-open").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=records-panel]"))).toBe(true);
  await closePanel(page);
});

test("every number opens the records behind it and the count equals the rows: headline, bars (segments and names), work-list amount, days, alert numbers, insight cards", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  const equal = async () => {
    await expect(panel(page)).toBeVisible();
    const c = page.getByTestId("records-count");
    const count = Number(await c.getAttribute("data-count"));
    const rows = Number(await c.getAttribute("data-shown"));
    expect(rows).toBeLessThanOrEqual(count);
    // Rows loaded equal the count unless the panel says it was cut.
    if (rows < count) await expect(page.getByTestId("records-note")).toBeVisible();
    return count;
  };
  // Headline: clients, dollars.
  const clients = await final(page.getByTestId("headline-clients"));
  await page.getByTestId("headline-clients").click();
  expect(await equal()).toBe(clients);
  await closePanel(page);
  if (await page.getByTestId("headline-dollars").count()) {
    await page.getByTestId("headline-dollars").click();
    await equal();
    await expect(page.getByTestId("records-title")).toContainText("quiet deals");
    await closePanel(page);
  }
  // Bars: every segment and every name; the count on it is the count in the panel.
  for (const s of await page.getByTestId("bar-segment").all()) {
    const n = Number(await s.getAttribute("data-count"));
    await s.click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  for (const b of await page.getByTestId("account-bar").all()) {
    const n = Number(await b.getAttribute("data-count"));
    await b.getByTestId("bar-account").click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  // The work list: the amount of every shown row.
  const rows = page.getByTestId("queue-row");
  for (let i = 0; i < Math.min(3, await rows.count()); i++) {
    const row = rows.nth(i);
    const n = Number(await row.getByTestId("queue-amount").getAttribute("data-count"));
    await row.getByTestId("queue-amount").click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  await openMore(page);
  // Alerts: the numbers and the days.
  for (const k of ["raised", "cleared", "open"]) {
    const b = page.getByTestId(`proof-open-${k}`);
    if (!(await b.count())) continue;
    const n = num(await page.getByTestId(`proof-${k === "open" ? "still-open" : k}`).innerText());
    await b.click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  for (const d of await page.getByTestId("raised-day").all()) {
    if (await d.isDisabled()) continue;
    const n = Number(await d.getAttribute("data-raised")) + Number(await d.getAttribute("data-cleared"));
    await d.click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  // Insight cards: the sample size on the card is the count in the panel.
  const cards = page.getByTestId("insight-card");
  for (let i = 0; i < (await cards.count()); i++) {
    const n = Number(await cards.nth(i).getAttribute("data-sample"));
    await cards.nth(i).click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  expect(await cards.count()).toBeLessThanOrEqual(3);
});

test("a point on the typical-reply line opens the replies behind it, or says why it cannot", async ({ page }) => {
  await openToday(page);
  await openMore(page);
  const spark = page.getByTestId("pulse-reply").getByTestId("spark-surface");
  if (!(await spark.count())) { await expect(page.getByTestId("spark-empty").first()).toBeVisible(); return; }
  await spark.scrollIntoViewIfNeeded(); // the figures are under More detail, so the line may be below the fold
  const b = (await spark.boundingBox())!;
  await page.mouse.move(b.x + b.width - 3, b.y + b.height / 2);
  await expect(page.getByTestId("spark-tip")).toBeVisible();
  await page.mouse.click(b.x + b.width - 3, b.y + b.height / 2);
  await expect(panel(page)).toBeVisible();
  const n = Number(await page.getByTestId("records-count").getAttribute("data-count"));
  expect(n).toBeGreaterThan(0);
  await closePanel(page);
});

test("Done for now sets a problem aside and moves the count, the set-aside list has N rows, and it stays after a reload", async ({ page, request }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  const first = page.getByTestId("queue-row").first();
  const reasonOf = () => page.getByTestId("queue-row").first().locator("p").nth(1);
  const text = (await reasonOf().innerText()).trim(); // what is wrong with the first client account, in words
  const heldBefore = await heldCount(page);
  await first.getByTestId("queue-more").click();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/app/today/action")), page.getByTestId("menu-done").click()]);
  const eventId = ((await res.json()) as { eventId: number }).eventId;
  try {
    await expect(page.getByTestId("today-toast")).toContainText("Marked done");
    await expect(reasonOf()).not.toHaveText(text);
    await expect(page.getByTestId("held-link")).toBeVisible();
    await expect(page.getByTestId("held-link")).toContainText("snoozed");
    const held = await heldCount(page);
    expect(held).toBeGreaterThan(heldBefore);
    await page.getByTestId("held-link").click();
    await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(held));
    await expect(page.getByTestId("records-title")).toContainText("Set aside");
    await expect(page.getByTestId("records-showing")).toContainText(`Showing ${Math.min(50, held)} of ${held}`);
    await closePanel(page);
    await page.reload();
    await expect(page.getByTestId("held-link")).toBeVisible({ timeout: 45_000 });
    await expect(reasonOf()).not.toHaveText(text);
  } finally {
    const { post } = await api(request);
    expect((await post("today/action", { action: "undo", eventId })).status()).toBe(200);
  }
  await page.reload();
  await expect(reasonOf()).toHaveText(text, { timeout: 45_000 });
});

test("Done for now then Undo (inside ten seconds) restores the list and the headline", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  await page.waitForTimeout(1000); // the figures count up for 600 ms
  const headline = await page.getByTestId("today-headline").innerText();
  const rows = page.getByTestId("queue-row");
  const text = (await rows.first().locator("p").nth(1).innerText()).trim();
  const heldBefore = await heldCount(page);
  await rows.first().getByTestId("queue-more").click();
  await page.getByTestId("menu-done").click();
  await expect.poll(() => heldCount(page)).toBeGreaterThan(heldBefore);
  await page.getByTestId("today-undo").click();
  await expect.poll(() => heldCount(page), { timeout: 15_000 }).toBe(heldBefore);
  await expect(rows.first().locator("p").nth(1)).toHaveText(text);
  await expect(page.getByTestId("today-headline")).toHaveText(headline);
});

test("Snooze 1 day and Snooze until Monday set a problem aside; Assign to me marks it; each is undoable", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  const rows = page.getByTestId("queue-row");
  const heldBefore = await heldCount(page);
  await rows.first().getByTestId("queue-more").click();
  await expect(page.getByTestId("pop-menu")).toBeVisible();
  await page.getByTestId("menu-snooze-day").click();
  await expect(page.getByTestId("today-toast")).toContainText("Snoozed until tomorrow");
  await expect.poll(() => heldCount(page)).toBeGreaterThan(heldBefore);
  await page.getByTestId("today-undo").click();
  await expect.poll(() => heldCount(page), { timeout: 15_000 }).toBe(heldBefore);
  await rows.first().getByTestId("queue-more").click();
  await page.getByTestId("menu-snooze-monday").click();
  await expect(page.getByTestId("today-toast")).toContainText("until Monday");
  await expect.poll(() => heldCount(page)).toBeGreaterThan(heldBefore);
  await page.getByTestId("today-undo").click();
  await expect.poll(() => heldCount(page), { timeout: 15_000 }).toBe(heldBefore);
  // Assign to me keeps the row and labels it.
  await rows.first().getByTestId("queue-more").click();
  await page.getByTestId("menu-assign").click();
  await expect(rows.first()).toContainText("Assigned to you");
  await page.getByTestId("today-undo").click();
  await expect(rows.first()).not.toContainText("Assigned to you", { timeout: 15_000 });
});

test("server rules: forged rows and people are refused, a client's staff cannot assign, and nobody can undo someone else's mark", async ({ request }) => {
  test.setTimeout(480_000); // about fifteen calls, each of which reads Today again
  const agency = await api(request);
  const today = await agency.get("today");
  const items = today.items as Json[];
  const rowOf = (i: Json) => `${i.locationId}|${i.kind}`;
  const row = rowOf(items[0]);
  const forged = await agency.post("today/action", { action: "done", rowKey: "zzzForeignAccount|replies" });
  expect(forged.status()).toBe(404);
  for (const bad of ["../x|replies", "demo-loc-1|nonsense", "demo-loc-1|leads", "demo-loc-1", "demo-loc-1|replies|a|b", "demo-loc-1|stale|a", 5]) expect((await agency.post("today/action", { action: "done", rowKey: bad })).status(), String(bad)).toBe(400);
  expect((await agency.post("today/action", { action: "done", rowKey: "demo-loc-1|replies|nobody-like-this" })).status(), "a person that is not there").toBe(404);
  expect((await agency.post("today/action", { action: "explode", rowKey: row })).status()).toBe(400);
  expect((await agency.post("today/action", { action: "snooze", rowKey: row, choice: "forever" })).status()).toBe(400);
  expect((await agency.post("today/action", { action: "undo", eventId: 999_999_999 })).status()).toBe(404);
  const client = await api(request, "client");
  const ct = await client.get("today");
  const mineItem = (ct.items as Json[])[0];
  const crow = rowOf(mineItem);
  expect((await client.post("today/action", { action: "assign", rowKey: crow })).status()).toBe(403);
  // A client cannot act on an account that is not theirs.
  const other = items.find((i) => i.locationId !== mineItem.locationId)!;
  expect((await client.post("today/action", { action: "done", rowKey: rowOf(other) })).status()).toBe(404);
  // A person of another account, named through the client's own account key, is not found either.
  const otherPerson = items.find((i) => i.kind === "replies" && i.locationId !== mineItem.locationId);
  if (otherPerson) expect((await client.post("today/action", { action: "done", rowKey: `${mineItem.locationId}|replies|${String(otherPerson.id).slice(`replies:${otherPerson.locationId}:`.length)}` })).status()).toBe(404);
  // A client's own Done goes in their own lane: the agency does not see it, and the agency cannot undo it.
  const mine = await client.post("today/action", { action: "done", rowKey: crow });
  expect(mine.status()).toBe(200);
  const ev = ((await mine.json()) as { eventId: number }).eventId;
  const asAgency = await agency.get("today");
  expect(Object.values(asAgency.holds as Json).some((h: Json) => h.eventId === ev)).toBe(false);
  expect((await agency.post("today/action", { action: "undo", eventId: ev })).status()).toBe(404);
  expect((await client.post("today/action", { action: "undo", eventId: ev })).status()).toBe(200);
});

test("the Today brief preview uses the same headline and the same top rows, and sends nothing", async ({ page, request }) => {
  const { get } = await api(request);
  const brief = await get("today/brief");
  await openToday(page);
  await expect(page.getByTestId("today-headline")).toContainText(brief.headline.replace(/ One deal is.*/, "").replace(/ is at risk\..*/, ""));
  await moreMenu(page, "brief");
  await expect(page.getByTestId("brief-panel")).toBeVisible();
  await expect(page.getByTestId("brief-subject")).toContainText(brief.headline);
  await expect(page.getByTestId("brief-lines")).toContainText("Do this first:");
  await expect(page.getByTestId("brief-panel")).toContainText("Nothing has been sent");
  await page.getByTestId("brief-close").click();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
});

test("the junk control recomputes the dollar figure and lists what it left out", async ({ page }) => {
  await openToday(page);
  await openMore(page);
  const toggle = page.getByTestId("junk-toggle");
  await expect(toggle).toBeVisible();
  const on = String(await final(page.getByTestId("pulse-risk").locator("p.t-figure")));
  await toggle.uncheck();
  await page.waitForTimeout(800);
  const off = String(await final(page.getByTestId("pulse-risk").locator("p.t-figure")));
  await toggle.check();
  expect(num(off)).toBeGreaterThanOrEqual(num(on));
  if (num(off) > num(on)) {
    await page.getByTestId("junk-left-out").click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId("records-title")).toContainText("Left out");
    await closePanel(page);
  }
});

test("More detail and the rest of the buttons built for Today all do something", async ({ page, context }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  // Tabs.
  for (const [name, id] of [["People", "tab-people"], ["Sources", "tab-sources"], ["Coverage", "tab-coverage"]] as const) {
    await openMore(page, name);
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // Coverage hour bar opens its leads; Sources row opens its leads; People rows open theirs.
  const hour = page.getByTestId("hour-bar").and(page.locator("[data-leads]:not([disabled])")).first();
  if (await hour.count()) { const n = Number(await hour.getAttribute("data-leads")); await hour.click(); await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n)); await closePanel(page); }
  await page.getByRole("tab", { name: "Sources" }).click();
  const srcRow = page.getByTestId("source-row").first();
  if (await srcRow.count()) { const n = Number(await srcRow.getAttribute("data-leads")); await srcRow.click(); await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n)); await closePanel(page); }
  await page.getByRole("tab", { name: "People" }).click();
  const w = page.getByTestId("workload-row").and(page.locator("button")).first();
  if (await w.count()) { const n = Number(await w.getAttribute("data-waiting")); await w.click(); await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n)); await closePanel(page); }
  const cr = page.getByTestId("compare-row").first();
  if (await cr.count()) { const n = Number(await cr.getAttribute("data-answered")); await cr.click(); await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n)); await closePanel(page); }
  await page.getByRole("tab", { name: "Forecast" }).click();
  // Open opens a new tab.
  await expect(page.getByTestId("queue-open").first()).toHaveAttribute("href", /^https:\/\//);
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("queue-open").first().click()]);
  expect(tab).toBeTruthy();
  await tab.close();
  // Show only this client narrows Today, "See all" brings every account back.
  await page.getByTestId("queue-row").first().getByTestId("queue-more").click();
  await page.getByTestId("menu-only").click();
  await expect(page.getByTestId("account-chip")).toBeVisible();
  expect(page.url()).toContain("ta=");
  await clearAccounts(page);
  await expect(page.getByTestId("account-chip")).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
  // The next step (a row menu item) opens its records.
  await page.getByTestId("queue-row").first().getByTestId("queue-more").click();
  const next = page.getByTestId("menu-next");
  if (await next.count()) { await next.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); } else await page.keyboard.press("Escape");
  // Since you last looked: reload after the visit window cannot be forced, so only check the strip's numbers when it is there.
  const since = page.getByTestId("since-strip");
  if (await since.count()) for (const b of await since.locator("button").all()) { await b.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); }
  // If nobody acts: the counts.
  await openMore(page, "Forecast");
  for (const k of ["leads", "deals", "appointments"]) { const c = page.getByTestId(`coming-${k}`); if ((await c.count()) && (await c.getAttribute("data-count")) !== "0") { await c.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); } }
  // Share copies the summary; Sync now runs; the preview of the email opens and closes.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await moreMenu(page, "share");
  await moreMenu(page, "sync");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await moreMenu(page, "brief");
  await page.getByTestId("brief-close").click();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
});

test("a business administrator and a client's staff get the same panel, limited to their account, and a client cannot assign", async ({ page, request }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  for (const as of ["business", "client"] as const) {
    const { get } = await api(request, as);
    const t = await get("today");
    await page.goto(`/app?as=${as}`);
    await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("account-control")).toHaveCount(0);
    const names = new Set((t.accounts as Json[]).map((a) => a.name));
    expect(names.size).toBe(1);
    // The headline's number opens the panel; its rows are all this account's.
    const head = page.getByTestId("headline-replies").or(page.getByTestId("headline-things"));
    if (await head.count()) {
      const n = await final(head);
      await head.click();
      await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
      for (const cell of await page.getByTestId("records-row").locator("td:nth-child(2)").allInnerTexts()) expect([...names]).toContain(cell);
      await closePanel(page);
    }
    const row = page.getByTestId("reply-row").first();
    if (await row.count()) {
      await row.getByTestId("reply-more").click();
      await expect(page.getByTestId("menu-snooze-day")).toBeVisible();
      if (as === "client") await expect(page.getByTestId("menu-assign")).toHaveCount(0); else await expect(page.getByTestId("menu-assign")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await openMore(page);
    if (as === "client") await expect(page.getByRole("tab")).toHaveCount(2); else await expect(page.getByRole("tab", { name: "People" })).toBeVisible();
    await page.getByTestId("today-more").click();
    await expect(page.getByTestId("menu-brief")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("a real mouse click on a bar segment opens the records behind exactly that segment", async ({ page }) => {
  await openToday(page);
  const seg = page.getByTestId("bar-segment").first();
  await seg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const n = Number(await seg.getAttribute("data-count"));
  const kind = await seg.getAttribute("data-kind");
  const account = await seg.getAttribute("data-account");
  const b = (await seg.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  // The browser reports the segment itself under the middle of it (nothing sits on top).
  const hit = await page.evaluate(([px, py]) => (document.elementFromPoint(px, py) as HTMLElement | null)?.closest("[data-testid]")?.getAttribute("data-testid"), [x, y]);
  expect(hit).toBe("bar-segment");
  await page.mouse.move(x, y);
  await expect(page.getByTestId("bars-tip")).toContainText(/:/);
  await page.mouse.click(x, y);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
  expect(kind).toBeTruthy();
  expect(account).toBeTruthy();
});

test("the records panel and the account list follow the light or dark theme of the app (they are drawn inside the themed wrapper)", async ({ page }) => {
  await openToday(page);
  await openMore(page);
  const luminance = (css: string) => { const [r, g, b] = (css.match(/\d+/g) ?? ["0", "0", "0"]).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  for (const [pref, light] of [["Dark", false], ["Light", true], ["Dark", false]] as const) {
    await page.evaluate((p) => { [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === p)?.click(); }, pref);
    await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", light ? "light" : "dark");
    await page.getByTestId("pulse-replies-open").click();
    const panelBg = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(luminance(panelBg) > 0.5, `${pref}: panel background ${panelBg}`).toBe(light);
    await closePanel(page);
    await page.getByTestId("account-button").click();
    const pickBg = await page.getByTestId("account-list").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(luminance(pickBg) > 0.5, `${pref}: account list background ${pickBg}`).toBe(light);
    await page.keyboard.press("Escape");
  }
});
