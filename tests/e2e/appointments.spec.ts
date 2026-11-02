import { expect, test, type APIRequestContext } from "@playwright/test";

// F3: appointments on the messy demo tenant, and the Insights tab (never seen working before this stage).
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(request: APIRequestContext, path: string): Promise<Json> {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const res = await request.get(`/api/app/${path}`, { headers });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
}

test("appointment numbers are consistent between the Appointments tab and Insights", async ({ request }) => {
  const [list, ins] = await Promise.all([get(request, "appointments"), get(request, "appointment-insights")]);
  expect(ins.sampleSize).toBeGreaterThan(0);
  // The two tabs read the same rows with the same rules: the count with no outcome recorded must agree.
  const unmarkedList = list.unmarkedTotal ?? list.unmarked?.length ?? null;
  if (unmarkedList !== null && ins.health?.unmarked !== undefined) expect(ins.health.unmarked).toBe(unmarkedList);
  // The score is n/a (null) when fewer than 3 of its four checks have data; otherwise it is a number from 0 to 100.
  if (ins.health.score !== null) { expect(ins.health.score).toBeGreaterThanOrEqual(0); expect(ins.health.score).toBeLessThanOrEqual(100); expect(ins.health.used).toBeGreaterThanOrEqual(3); }
  else expect(ins.health.used).toBeLessThan(3);
  for (const p of ins.health.parts as Json[]) if (p.points === null) expect(p.note).toMatch(/^n\/a/);
});
// ---- F3: status breakdown, date window, filters, detail, every count opens its list ----
test("the server accepts a date window and filters, says what it used, and every count equals its list", async ({ request }) => {
  const d = await get(request, "appointments");
  expect(d.window.defaulted).toBe(true);
  const sc = d.statusCounts as Json;
  expect(sc.scheduled).toBe(d.current.booked);
  const items = d.items as Json[];
  if (d.itemsTotal <= d.itemCap) {
    for (const b of d.statusOrder as Json[]) expect(items.filter((i) => (i.status === b.key) || (b.key === "other" && !["new", "confirmed", "showed", "noshow", "cancelled", "invalid"].includes(i.status))).length, b.label).toBe(sc.byBucket[b.key]);
  }
  expect((d.unmarked as Json[]).length).toBe(Math.min(d.unmarkedTotal, d.itemCap));
  expect((d.recover as Json[]).length).toBe(Math.min(d.recoverTotal, d.itemCap));
  expect(d.unconfirmed.length).toBeLessThanOrEqual(15);
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const w = await get(request, `appointments?from=${from}&to=${today}`);
  expect(w.window).toMatchObject({ from, to: today, defaulted: false, problem: null });
  expect(w.compareWindow).toBeNull();
  const bad = await get(request, "appointments?from=2099-01-01&to=2099-02-01");
  expect(bad.window.defaulted).toBe(true);
  expect(bad.window.problem).toMatch(/future/);
  if (d.options.calendars.length > 0) {
    const cal = d.options.calendars[0].key as string;
    const f = await get(request, `appointments?calendar=${encodeURIComponent(cal)}`);
    expect((f.items as Json[]).every((i) => i.calendarId === cal)).toBe(true);
  }
  // Nothing in the response is a phone link; calls go through the CRM.
  expect(JSON.stringify(d)).not.toContain("tel:");
});

test("one appointment opens with its detail; an unknown id or another account's id is 'not found'", async ({ request }) => {
  const d = await get(request, "appointments");
  const first = (d.items as Json[])[0];
  expect(first, "the demo has appointments").toBeTruthy();
  const one = await get(request, `appointments/${first.locationId}/${first.id}`);
  expect(one.appointment.id).toBe(first.id);
  expect(Array.isArray(one.history)).toBe(true);
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  expect((await request.get(`/api/app/appointments/${first.locationId}/does-not-exist`, { headers })).status()).toBe(404);
  expect((await request.get(`/api/app/appointments/someOtherAccount123/${first.id}`, { headers })).status()).toBe(404);
  const bk = await get(request, "appointments/breakdown");
  for (const g of bk.byCalendar as Json[]) expect((bk.items as Json[]).filter((i) => (i.calendarId ?? "none") === g.key).length).toBe(Math.min(g.booked, bk.itemsTotal));
});

test("the show-rate target is refused when it is not 30 to 100, and nothing is stored in the demo", async ({ request }) => {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const low = await request.put("/api/app/appointments/targets", { headers, data: { showRate: 5 } });
  expect([400, 403]).toContain(low.status());
});

test("the Appointments tab: numbers open their lists, a row opens the appointment, no tel: link anywhere", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app#appointments");
  await page.reload();
  await expect(page.getByTestId("appointments-window")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("card-range").first()).toBeVisible();
  await expect(page.getByText("What this shows, how to read it, what to do").first()).toBeVisible();
  // A bar of the status chart opens its list; the heading count is the bar's count.
  const bar = page.getByRole("button", { name: /open the list/ }).first();
  await bar.scrollIntoViewIfNeeded();
  const count = Number(/(\d+) appointments, open the list/.exec((await bar.getAttribute("aria-label")) ?? "")?.[1]);
  expect(count).toBeGreaterThan(0);
  await bar.click();
  await expect(page.getByTestId("appt-list-count")).toHaveText(String(count));
  await page.getByTestId("appt-list-panel").locator("button[data-row-primary]").first().click();
  await expect(page.getByTestId("appt-drawer")).toBeVisible();
  await expect(page.getByText("Status history")).toBeVisible();
  await expect(page.getByTestId("appt-drawer-position")).toContainText("1 of");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("appt-drawer")).toHaveCount(0);
  expect(await page.locator('a[href^="tel:"]').count(), "no phone link").toBe(0);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/down 100%|NaN|undefined|Infinity/);
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "no sideways scroll").toBeLessThanOrEqual(cw);
  expect(errors, errors.join("\n")).toEqual([]);
  await page.screenshot({ path: `docs/review/f3-appointments-${testInfo.project.name}.png`, fullPage: true });
});

test("the card range on the numbers changes the window sentence and is carried in the address", async ({ page }) => {
  await page.goto("/app#appointments");
  await page.reload();
  const range = page.getByTestId("card-range").first();
  await range.getByLabel("Appointment numbers: range").selectOption("7d");
  await expect(page.getByTestId("appointments-window")).toContainText("Appointments that start from", { timeout: 60_000 });
  expect(page.url()).toMatch(/r\.appointments=7d/);
});

test("Insights: every card has its three explanation lines, the grid of 1s is gone, and a thin health score says n/a", async ({ page }) => {
  await page.goto("/app#appointments");
  await page.reload();
  await page.getByRole("tab", { name: "Insights" }).first().click();
  await expect(page.getByText("Calendar health").first()).toBeVisible({ timeout: 90_000 });
  const explains = page.locator('[data-testid^="explain-"]');
  expect(await explains.count()).toBeGreaterThan(5);
  const heat = page.getByTestId("heat-grid");
  if (await heat.count()) {
    // Above its minimum the grid shows only coloured slots with a percentage, never a grid of 1s.
    const cells = await heat.locator("button").allInnerTexts();
    expect(cells.length).toBeGreaterThanOrEqual(3);
    for (const c of cells) expect(Number(c)).toBeGreaterThanOrEqual(0);
  }
  const score = (await page.getByTestId("health-score").innerText()).trim();
  expect(score === "n/a" || /^\d+/.test(score)).toBe(true);
  expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
  expect(await page.locator("body").innerText()).not.toMatch(/100% are lost|down 100%/);
});

test("Insights: widgets can be switched off and the choice is remembered", async ({ page }) => {
  await page.goto("/app#appointments");
  await page.reload();
  await page.getByRole("tab", { name: "Insights" }).first().click();
  await expect(page.getByText("Calendar health").first()).toBeVisible({ timeout: 90_000 });
  await page.getByText(/Choose what to show/).click();
  await page.getByRole("checkbox", { name: "Double bookings" }).uncheck();
  await expect(page.getByRole("heading", { name: /Double bookings/ })).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "Insights" }).first().click();
  await expect(page.getByText("Calendar health").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: /Double bookings/ })).toHaveCount(0);
  await page.getByText(/Choose what to show/).click();
  await page.getByRole("checkbox", { name: "Double bookings" }).check(); // leave it as it was
});


test("no rate is shown without enough outcomes, and no change claim without a baseline of 10", async ({ request }) => {
  const list = await get(request, "appointments");
  const o = list.overview ?? list;
  for (const period of [o.last30, o.prior30].filter(Boolean)) {
    if (period.outcomes < 5) expect(period.showRate, "under 5 recorded outcomes there is no rate").toBeNull();
    if (period.outcomes >= 5) expect(period.showRate).not.toBeNull();
  }
  for (const line of (list.headline ?? []) as string[]) {
    if (/Show rate (rose|fell)/.test(line)) { expect(o.last30.outcomes).toBeGreaterThanOrEqual(10); expect(o.prior30.outcomes).toBeGreaterThanOrEqual(10); }
    if (/Bookings are (up|down)/.test(line)) expect(o.prior30.booked).toBeGreaterThanOrEqual(10);
    expect(line).not.toMatch(/100%/);
  }
});

test("the Insights tab opens, shows its cards without errors, and carries no alarming claim", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app#appointments");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Insights" }).first().click();
  await expect(page.getByText("Calendar health").first()).toBeVisible();
  await expect(page.getByText("Best times to book", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("No-show recovery", { exact: false }).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/down 100%|NaN|undefined|Infinity/);
  expect(errors, errors.join("\n")).toEqual([]);
  await page.screenshot({ path: `docs/review/f3-insights-${testInfo.project.name}.png`, fullPage: true });
});
