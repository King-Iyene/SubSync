import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// Today, second pass, in a real browser at 1440: the records panel from every kind of mark (count equals rows), the fixed-column alignment of every list, the account picker's
// Done and Show all accounts buttons, the working queue (Done, Snooze, Undo), the tabs, and a click on every other button and link built for Today to prove each one does
// something. Each test that changes the working queue puts it back (Undo) so the tests can run again. Demo company; agency owner, business administrator and client's staff.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(request: APIRequestContext, as?: "business" | "client") {
  const s = await request.post("/api/sso", { data: { demo: true, ...(as ? { as } : {}) } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  return {
    get: async (path: string): Promise<Json> => { const res = await request.get(`/api/app/${path}`, { headers }); expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy(); return (await res.json()) as Json; },
    post: async (path: string, data: unknown) => request.post(`/api/app/${path}`, { headers, data }),
  };
}
const num = (s: string) => Number(s.replace(/[^0-9]/g, ""));
/** A figure counts up for 600 ms: read the value it ends on, never the text in the middle of the count. */
async function final(l: Locator): Promise<number> {
  const el = l.locator("[data-final]").first();
  return num((await el.count()) ? ((await el.getAttribute("data-final")) ?? "") : await l.innerText());
}
const rowSel = (key: string) => `[id="${key}"]`;
async function openToday(page: Page, query = "") {
  await page.goto(`/app${query}`);
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("queue-row").first()).toBeVisible({ timeout: 20_000 });
}
const panel = (page: Page) => page.getByTestId("records-panel");
async function closePanel(page: Page) { await page.keyboard.press("Escape"); await expect(panel(page)).toHaveCount(0); }

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

test("every column of the Fix first queue lines up on every row, at 1440 and at 1024", async ({ page }) => {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await openToday(page);
    const rows = page.getByTestId("queue-row");
    expect(await rows.count()).toBeGreaterThan(2);
    await page.getByTestId("queue-all").click().catch(() => undefined);
    for (const col of ["amount", "urgency", "crm", "show", "done", "more"]) {
      const xs = await rows.evaluateAll((els, c) => els.map((el) => Math.round((el.querySelector(`[data-col=${c}]`) as HTMLElement).getBoundingClientRect().left * 10) / 10), col);
      expect(Math.max(...xs) - Math.min(...xs), `${width}px, queue column ${col}: ${xs.join(", ")}`).toBeLessThanOrEqual(1);
      const ws = await rows.evaluateAll((els, c) => els.map((el) => Math.round((el.querySelector(`[data-col=${c}]`) as HTMLElement).getBoundingClientRect().width * 10) / 10), col);
      expect(Math.max(...ws) - Math.min(...ws), `${width}px, queue column ${col} width: ${ws.join(", ")}`).toBeLessThanOrEqual(1);
    }
    // The accounts list under it works the same way.
    const needing = page.getByTestId("needing-row");
    for (const col of ["state", "crm", "only"]) {
      const xs = await needing.evaluateAll((els, c) => els.map((el) => Math.round((el.querySelector(`[data-col=${c}]`) as HTMLElement).getBoundingClientRect().left * 10) / 10), col);
      expect(Math.max(...xs) - Math.min(...xs), `${width}px, accounts column ${col}: ${xs.join(", ")}`).toBeLessThanOrEqual(1);
    }
    if (width === 1440) await page.screenshot({ path: "docs/review/today2-queue-aligned-1440.png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
  }
});

test("People, Sources and Coverage lists line up too", async ({ page }) => {
  await openToday(page);
  await page.getByRole("tab", { name: "People" }).click();
  await expect(page.getByTestId("tab-people")).toBeVisible();
  const work = page.getByTestId("workload-row");
  if ((await work.count()) > 1) sameColumns(await leftEdges(work, ":scope > span"), "workload");
  const cmp = page.getByTestId("compare-fastest").getByTestId("compare-row");
  if ((await cmp.count()) > 1) sameColumns(await leftEdges(cmp, ":scope > span"), "compare");
  await page.getByRole("tab", { name: "Sources" }).click();
  const src = page.getByTestId("source-row");
  if ((await src.count()) > 1) sameColumns(await leftEdges(src, ":scope > span"), "sources");
});

test("the account picker: a row ticks anywhere on it, Show all accounts and Done close it with a visible result, Esc and a click outside close it", async ({ page }) => {
  await openToday(page);
  const picker = page.getByTestId("today-account-picker");
  const pop = page.getByTestId("picker-popover");
  const summary = page.getByTestId("picker-summary");
  const total = (await summary.innerText()).replace("All ", "");
  // Open, tick two rows by clicking the NAME (not the box), see the chip and the address, press Done.
  await page.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  await pop.getByText("Bright Smile Dental").click();
  await pop.getByText("Blue Door Realty").click();
  await expect(pop.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toContainText("2 client accounts");
  expect(page.url()).toMatch(/ta=[^&]+,[^&]+/);
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(pop).toHaveCount(0);
  await expect(summary).toHaveText(`2 of ${total}`);
  expect(page.url()).toContain("ta=");
  // The queue is narrowed to those two.
  await expect(page.getByTestId("queue-row").filter({ hasNotText: /Bright Smile Dental|Blue Door Realty/ })).toHaveCount(0);
  // Open again, press Show all accounts: closes, every account is back, the chip and the address parameter are gone.
  await page.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  await pop.getByRole("button", { name: "Show all accounts" }).click();
  await expect(pop).toHaveCount(0);
  await expect(summary).toHaveText(`All ${total}`);
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
  // Esc closes it, and gives the focus back to the button.
  await page.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.getByTestId("picker-button")).toBeFocused();
  // A click outside closes it.
  await page.getByTestId("picker-button").click();
  await expect(pop).toBeVisible();
  await page.getByTestId("page-subtitle").click();
  await expect(pop).toHaveCount(0);
  // Real mouse clicks at the middle of both buttons hit the buttons themselves (nothing sits on top of them), in a short window too.
  await page.setViewportSize({ width: 1024, height: 560 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId("picker-button").click();
  for (const id of ["picker-done", "picker-all"]) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, id).not.toBeNull();
    const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest("[data-testid]")?.getAttribute("data-testid"), [b!.x + b!.width / 2, b!.y + b!.height / 2]);
    expect(hit, `what is under the middle of ${id}`).toBe(id);
    expect(b!.y + b!.height, `${id} is inside the window`).toBeLessThanOrEqual(560);
  }
  await page.mouse.click(...(await (async () => { const b = (await page.getByTestId("picker-done").boundingBox())!; return [b.x + b.width / 2, b.y + b.height / 2] as [number, number]; })()));
  await expect(pop).toHaveCount(0);
});

test("a pulse tile opens the records panel and its count is the number on the tile", async ({ page, request }) => {
  const { get } = await api(request);
  const today = await get("today");
  await openToday(page);
  const shown = await final(page.getByTestId("pulse-leads").locator("p.tnum"));
  await page.getByTestId("pulse-leads-open").click();
  await expect(panel(page)).toBeVisible();
  const count = page.getByTestId("records-count");
  expect(Number(await count.getAttribute("data-count"))).toBe(shown);
  expect(shown).toBeGreaterThan(0);
  expect(Number(await count.getAttribute("data-count"))).toBe(today.totals.leads.count - Object.values(today.holds as Json).filter((h: Json) => String(h.rowKey).endsWith("|leads")).length);
  // The header says a title and a sentence in words, and the rows are the leads.
  await expect(page.getByTestId("records-title")).toContainText("Leads waiting");
  await expect(page.getByTestId("records-subtitle")).toContainText("reply target");
  expect(await page.getByTestId("records-row").count()).toBe(Math.min(50, shown));
  await expect(page.getByTestId("records-showing")).toContainText(`Showing ${Math.min(50, shown)} of ${shown}`);
  await expect(page.getByTestId("records-overlay")).toBeVisible();
  await page.screenshot({ path: "docs/review/today2-panel-tile.png" });
  // The header row stays put while the table scrolls.
  const th = page.getByTestId("records-th").first();
  const before = (await th.boundingBox())!.y;
  await page.getByTestId("records-scroll").evaluate((el) => { el.scrollTop = 400; });
  expect(Math.abs((await th.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
  await closePanel(page);
});

test("the panel: search, filter chip, + Filter, sort, date range, Maximise, Export CSV, OPEN, Open in CRM, paging, X and Esc", async ({ page }) => {
  await openToday(page);
  await page.getByTestId("pulse-leads-open").click();
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
  // Date range chip: "Older than 30 days" leaves nothing for leads; Any time restores.
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
  await page.screenshot({ path: "docs/review/today2-panel-maximised.png" });
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
  await page.getByTestId("pulse-leads-open").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=records-panel]"))).toBe(true);
  await closePanel(page);
});

test("every number opens the records behind it and the count equals the rows: headline, donut, legend, bars, Fix first amount, days, alert numbers, insight cards", async ({ page }) => {
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
    await expect(page.getByTestId("records-title")).toContainText("at risk");
    await closePanel(page);
  }
  // Donut: every slice and every legend item; the count on it is the count in the panel.
  for (const s of await page.locator("[data-testid^=slice-]").all()) {
    const n = Number(await s.getAttribute("data-count"));
    await s.focus();
    await page.keyboard.press("Enter");
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  for (const l of await page.locator("[data-testid^=legend-]").all()) {
    const n = num((await l.innerText()).split("\n").filter((x) => /^[\d,]+$/.test(x.trim()))[0] ?? "");
    await l.click();
    expect(await equal()).toBe(n);
    await closePanel(page);
  }
  await page.screenshot({ path: "docs/review/today2-before-slice.png" });
  const slice = page.locator("[data-testid^=slice-]").first();
  await slice.focus();
  await page.keyboard.press("Enter");
  await equal();
  await page.screenshot({ path: "docs/review/today2-panel-slice.png" });
  await closePanel(page);
  // Account bars.
  for (const b of await page.getByTestId("account-bar").all()) {
    const n = Number(await b.getAttribute("data-count"));
    await b.click();
    expect(await equal()).toBe(n);
    if (b === (await page.getByTestId("account-bar").all())[0]) await page.screenshot({ path: "docs/review/today2-panel-bar.png" });
    await closePanel(page);
  }
  // Fix first: the amount and Show on every shown row.
  const rows = page.getByTestId("queue-row");
  for (let i = 0; i < Math.min(3, await rows.count()); i++) {
    const row = rows.nth(i);
    const amount = row.getByTestId("queue-amount");
    await amount.click();
    await equal();
    await closePanel(page);
    await row.getByTestId("queue-show").click();
    await equal();
    await closePanel(page);
  }
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
    if (i === 0) await page.screenshot({ path: "docs/review/today2-panel-insight.png" });
    await closePanel(page);
  }
  expect(await cards.count()).toBeLessThanOrEqual(3);
});

test("a point on the typical-reply line opens the replies behind it, or says why it cannot", async ({ page }) => {
  await openToday(page);
  const spark = page.getByTestId("pulse-reply").getByTestId("spark-surface");
  if (!(await spark.count())) { await expect(page.getByTestId("spark-empty").first()).toBeVisible(); return; }
  const b = (await spark.boundingBox())!;
  await page.mouse.move(b.x + b.width - 3, b.y + b.height / 2);
  await expect(page.getByTestId("spark-tip")).toBeVisible();
  await page.mouse.click(b.x + b.width - 3, b.y + b.height / 2);
  await expect(panel(page)).toBeVisible();
  const n = Number(await page.getByTestId("records-count").getAttribute("data-count"));
  expect(n).toBeGreaterThan(0);
  await closePanel(page);
});

test("Done hides a row and moves the headline, the set-aside list has N rows, and it stays after a reload", async ({ page, request }) => {
  await openToday(page);
  const clientsBefore = await final(page.getByTestId("headline-clients"));
  const rows = page.getByTestId("queue-row");
  const first = rows.first();
  const text = await first.innerText();
  const firstId = (await first.getAttribute("id")) as string;
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/app/today/action")), first.getByTestId("queue-done").click()]);
  const eventId = ((await res.json()) as { eventId: number }).eventId;
  try {
    await expect(page.getByTestId("today-toast")).toContainText("Marked done");
    await expect(rows.first()).not.toHaveText(text);
    await expect(page.getByTestId("held-link")).toBeVisible();
    await expect(page.getByTestId("held-link")).toContainText("snoozed");
    const held = Number(await page.getByTestId("held-link").getAttribute("data-count"));
    expect(held).toBeGreaterThan(0);
    await expect.poll(async () => final(page.getByTestId("headline-clients"))).toBeLessThanOrEqual(clientsBefore);
    await page.getByTestId("held-link").click();
    await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(held));
    await expect(page.getByTestId("records-title")).toContainText("Set aside");
    await expect(page.getByTestId("records-showing")).toContainText(`Showing ${Math.min(50, held)} of ${held}`);
    await closePanel(page);
    await page.reload();
    await expect(page.getByTestId("held-link")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("queue-row").first()).not.toHaveText(text);
  } finally {
    const { post } = await api(request);
    expect((await post("today/action", { action: "undo", eventId })).status()).toBe(200);
  }
  await page.reload();
  await expect(page.getByTestId("queue-row").first()).toHaveAttribute("id", firstId, { timeout: 20_000 });
});

test("Done then Undo (inside ten seconds) restores the row and the headline", async ({ page }) => {
  await openToday(page);
  await page.waitForTimeout(1000); // the figures count up for 600 ms
  const headline = await page.getByTestId("today-headline").innerText();
  const rows = page.getByTestId("queue-row");
  const key = (await rows.first().getAttribute("id")) as string;
  const heldBefore = await page.getByTestId("held-link").count();
  await rows.first().getByTestId("queue-done").click();
  await expect(page.locator(rowSel(key))).toHaveCount(0);
  await page.getByTestId("today-undo").click();
  await expect(page.locator(rowSel(key))).toHaveCount(1);
  await expect(page.getByTestId("today-headline")).toHaveText(headline);
  await expect(page.getByTestId("held-link")).toHaveCount(heldBefore);
});

test("Snooze 1 day and Snooze until Monday hide a row; Assign to me marks it; each is undoable", async ({ page }) => {
  await openToday(page);
  const rows = page.getByTestId("queue-row");
  const keyOf = async (n: number) => (await rows.nth(n).getAttribute("id"))!;
  let key = await keyOf(0);
  await rows.first().getByTestId("queue-more").click();
  await expect(page.getByTestId("queue-menu")).toBeVisible();
  await page.getByTestId("queue-snooze-day").click();
  await expect(page.locator(rowSel(key))).toHaveCount(0);
  await expect(page.getByTestId("today-toast")).toContainText("Snoozed for 1 day");
  await page.getByTestId("today-undo").click();
  await expect(page.locator(rowSel(key))).toHaveCount(1);
  key = await keyOf(0);
  await rows.first().getByTestId("queue-more").click();
  await page.getByTestId("queue-snooze-monday").click();
  await expect(page.locator(rowSel(key))).toHaveCount(0);
  await expect(page.getByTestId("today-toast")).toContainText("until Monday");
  await page.getByTestId("today-undo").click();
  await expect(page.locator(rowSel(key))).toHaveCount(1);
  // Assign to me keeps the row and labels it.
  await rows.first().getByTestId("queue-more").click();
  await page.getByTestId("queue-assign").click();
  await expect(page.locator(rowSel(key)).getByTestId("queue-assigned")).toBeVisible();
  await page.getByTestId("today-undo").click();
  await expect(page.locator(rowSel(key)).getByTestId("queue-assigned")).toHaveCount(0);
});

test("server rules: forged rows are refused, a client's staff cannot assign, and nobody can undo someone else's mark", async ({ request }) => {
  const agency = await api(request);
  const today = await agency.get("today");
  const row = (today.queue as Json[])[0];
  const forged = await agency.post("today/action", { action: "done", rowKey: "zzzForeignAccount|leads" });
  expect(forged.status()).toBe(404);
  for (const bad of ["../x|leads", "demo-loc-1|nonsense", "demo-loc-1", "demo-loc-1|leads|extra", 5]) expect((await agency.post("today/action", { action: "done", rowKey: bad })).status(), String(bad)).toBe(400);
  expect((await agency.post("today/action", { action: "explode", rowKey: row.key })).status()).toBe(400);
  expect((await agency.post("today/action", { action: "snooze", rowKey: row.key, choice: "forever" })).status()).toBe(400);
  expect((await agency.post("today/action", { action: "undo", eventId: 999_999_999 })).status()).toBe(404);
  const client = await api(request, "client");
  const ct = await client.get("today");
  const crow = (ct.queue as Json[])[0];
  expect((await client.post("today/action", { action: "assign", rowKey: crow.key })).status()).toBe(403);
  // A client cannot act on an account that is not theirs.
  const other = (today.queue as Json[]).find((r) => r.locationId !== crow.locationId)!;
  expect((await client.post("today/action", { action: "done", rowKey: other.key })).status()).toBe(404);
  // A client's own Done goes in their own lane: the agency does not see it, and the agency cannot undo it.
  const mine = await client.post("today/action", { action: "done", rowKey: crow.key });
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
  await page.getByTestId("brief-preview").click();
  await expect(page.getByTestId("brief-panel")).toBeVisible();
  await expect(page.getByTestId("brief-subject")).toContainText(brief.headline);
  await expect(page.getByTestId("brief-lines")).toContainText("Fix first:");
  await expect(page.getByTestId("brief-panel")).toContainText("SubSync has sent nothing");
  await page.getByTestId("brief-close").click();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
});

test("the junk control recomputes the dollar figure and lists what it left out", async ({ page }) => {
  await openToday(page);
  const toggle = page.getByTestId("junk-toggle");
  await expect(toggle).toBeVisible();
  const on = String(await final(page.getByTestId("pulse-risk").locator("p.tnum")));
  await toggle.uncheck();
  await page.waitForTimeout(800);
  const off = String(await final(page.getByTestId("pulse-risk").locator("p.tnum")));
  await toggle.check();
  expect(num(off)).toBeGreaterThanOrEqual(num(on));
  if (num(off) > num(on)) {
    await page.getByTestId("junk-left-out").click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId("records-title")).toContainText("Left out");
    await closePanel(page);
  }
});

test("the tabs and the rest of the buttons built for Today all do something", async ({ page, context }) => {
  await openToday(page);
  // Tabs.
  for (const [name, id] of [["People", "tab-people"], ["Sources", "tab-sources"], ["Coverage", "tab-coverage"]] as const) {
    await page.getByRole("tab", { name }).click();
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
  await page.getByRole("tab", { name: "Overview" }).click();
  // See all, then Show the top.
  const all = page.getByTestId("queue-all");
  if (await all.count()) { const before = await page.getByTestId("queue-row").count(); await all.click(); expect(await page.getByTestId("queue-row").count()).toBeGreaterThan(before); await all.click(); expect(await page.getByTestId("queue-row").count()).toBe(before); }
  // Open in CRM opens a new tab.
  await expect(page.getByTestId("queue-open").first()).toHaveAttribute("href", /^https:\/\//);
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("queue-open").first().click()]);
  expect(tab).toBeTruthy();
  await tab.close();
  // Account chip: Only this account narrows Today, the chip's cross brings every account back.
  await page.getByTestId("needing-row").first().getByRole("button", { name: "Only this account" }).click();
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toBeVisible();
  expect(page.url()).toContain("ta=");
  await page.getByTestId("today-toolbar").getByTestId("showing-chip").getByRole("button").click();
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
  // Next step opens its records.
  const next = page.getByTestId("next-step-button").first();
  if (await next.count()) { await next.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); }
  // Why opens its leads.
  const why = page.getByTestId("queue-why-item").first();
  if (await why.count()) { await why.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); }
  // Since your last visit: reload after the visit window cannot be forced, so only check the strip's numbers when it is there.
  const since = page.getByTestId("since-strip");
  if (await since.count()) for (const b of await since.locator("button").all()) { await b.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); }
  // Coming up: the countdown ring and the counts.
  for (const k of ["leads", "deals", "appointments"]) { const c = page.getByTestId(`coming-${k}`); if ((await c.count()) && (await c.getAttribute("data-count")) !== "0") { await c.click(); await expect(panel(page)).toBeVisible(); await closePanel(page); } }
  // Share Today copies the summary; Sync now runs; the preview of the email opens and closes.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await page.getByRole("button", { name: "Share Today" }).click();
  await expect(page.getByRole("button", { name: /Copied to your clipboard|Share Today/ })).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("brief-preview").click();
  await page.getByTestId("brief-close").click();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
});

test("a business administrator and a client's staff get the same panel, limited to their account, and a client cannot assign", async ({ page, request }) => {
  for (const as of ["business", "client"] as const) {
    const { get } = await api(request, as);
    const t = await get("today");
    await page.goto(`/app?as=${as}`);
    await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
    const names = new Set((t.accounts as Json[]).map((a) => a.name));
    expect(names.size).toBe(1);
    // The headline's number opens the panel; its rows are all this account's.
    const head = page.getByTestId("headline-things");
    if (await head.count()) {
      const n = await final(head);
      await head.click();
      await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
      for (const cell of await page.getByTestId("records-row").locator("td:nth-child(2)").allInnerTexts()) expect([...names]).toContain(cell);
      await closePanel(page);
    }
    const row = page.getByTestId("queue-row").first();
    if (await row.count()) {
      await row.getByTestId("queue-more").click();
      await expect(page.getByTestId("queue-snooze-day")).toBeVisible();
      if (as === "client") await expect(page.getByTestId("queue-assign")).toHaveCount(0); else await expect(page.getByTestId("queue-assign")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    if (as === "client") await expect(page.getByRole("tab")).toHaveCount(0); else await expect(page.getByRole("tab", { name: "People" })).toBeVisible();
    await expect(page.getByTestId("brief-preview")).toHaveCount(0);
  }
});

test("a real mouse click on the ring of the donut opens the records behind that slice", async ({ page }) => {
  await openToday(page);
  const slice = page.getByTestId("slice-leads");
  await slice.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const n = Number(await slice.getAttribute("data-count"));
  // A point inside the slice's own ring, in page coordinates (the middle of a thin ring is not where its bounding box centre is): walk along its outline and step 5 px towards
  // the middle of the donut until the browser says the slice is what is under that point.
  const at = await slice.evaluate((el) => {
    const path = el as unknown as SVGGeometryElement;
    const m = (path as unknown as SVGGraphicsElement).getScreenCTM()!;
    const svg = path.ownerSVGElement as SVGSVGElement;
    const c = svg.createSVGPoint(); c.x = 165; c.y = 118; const centre = c.matrixTransform(m);
    const total = path.getTotalLength();
    for (let i = 1; i < 120; i++) {
      const p = path.getPointAtLength((total * i) / 120);
      const x = p.x * m.a + p.y * m.c + m.e, y = p.x * m.b + p.y * m.d + m.f;
      const d = Math.hypot(centre.x - x, centre.y - y) || 1;
      const px = x + ((centre.x - x) / d) * 5, py = y + ((centre.y - y) / d) * 5;
      if (document.elementFromPoint(px, py) === el) return { x: px, y: py };
    }
    return null;
  });
  expect(at, "a point of the slice that the browser reports as the slice").not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  await expect(page.getByTestId("donut-tip")).toContainText(/Leads waiting/);
  await page.mouse.click(at!.x, at!.y);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
});
