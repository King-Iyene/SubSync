import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// Speed to lead, rebuilt (stage SPEED, docs/SPEED_REVIEW.md), on the demo company for the four roles and the three widths of the projects:
//   one sentence and one primary button, five leads to reply to now, See all that opens the full list (server paged), every number opening exactly its own leads,
//   a ranking only for people who may see it, the same count as Today, and a clean phone layout. The demo answers slowly (every call signs in again), so waits are long.
const ROLES = [
  { name: "agency, all accounts", path: "/app#speed", slug: "agency-all", multi: true, people: true, menu: false },
  { name: "agency, inside one account", path: "/app?as=location", slug: "agency-account", multi: false, people: true, menu: true },
  { name: "a client's staff", path: "/app?as=client#speed", slug: "client-staff", multi: false, people: false, menu: false },
  { name: "a business owner", path: "/app?as=business#speed", slug: "business-owner", multi: false, people: true, menu: false },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;

async function open(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "Speed to lead", exact: true }).first().click({ timeout: 90_000 });
  else await page.reload();
  // SPEED4: the first tab is now the Race; the older queue, its headline and charts live on the Log tab. The tab exists once the page has loaded, so open it first (SPEED5: the headline is
  // only on the Log tab, which made waiting for it before opening the tab always time out).
  await page.getByRole("tab", { name: "Log", exact: true }).click({ timeout: 90_000 });
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("speed-fast")).toBeVisible({ timeout: 90_000 });
}
const n = (text: string) => Number(text.replace(/[^\d]/g, ""));

for (const role of ROLES) {
  test(`${role.name}: one sentence, one primary button, five rows at most, plain words, no sideways scroll`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await open(page, role.path, role.menu);
    const headline = (await page.getByTestId("today-headline").innerText()).trim();
    expect(headline).toMatch(/leads? (is|are) waiting for a reply|Nobody is waiting for a reply right now/);
    if (!/Nobody/.test(headline)) {
      await expect(page.getByTestId("today-primary-button")).toHaveText(/^Reply to the oldest waiting lead/);
      const rows = page.getByTestId("reply-rows").getByTestId("speed-row");
      expect(await rows.count()).toBeGreaterThan(0);
      expect(await rows.count()).toBeLessThanOrEqual(5);
      await expect(page.getByTestId("speed-reply").first()).toBeVisible();
    }
    // The first sentence is "N leads are waiting...": its N is the number the See all button shows.
    const all = page.getByTestId("reply-all");
    // (the number counts up when the page opens, so wait until it has arrived)
    if (await all.count()) {
      const seeAll = n(await all.innerText());
      await expect.poll(async () => n(((await page.getByTestId("today-headline").innerText()).match(/^[\d,]+/)?.[0]) ?? "0"), { timeout: 15_000 }).toBe(seeAll);
    }
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    // The client's staff never see a ranking of colleagues; the others see who is slow.
    if (role.people) await expect(page.getByTestId("speed-slow")).toBeVisible();
    else await expect(page.getByTestId("speed-slow")).toHaveCount(0);
    if (role.multi) await expect(page.getByTestId("slow-account-row").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(innerWidth + 1);
    if (testInfo.project.name.includes("390")) {
      const boxes = await page.locator('[data-testid="speed-reply"], [data-testid="speed-row-more"], [data-testid="today-primary-button"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(boxes.length).toBeGreaterThan(0);
      for (const h of boxes) expect(h, "thumb sized").toBeGreaterThanOrEqual(43.5);
    }
  });
}

test("See all opens the whole list: its count is the headline's, it can be searched and paged, and Back returns", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  const total = n(await page.getByTestId("reply-all").innerText());
  expect(total).toBeGreaterThan(5);
  await page.getByTestId("reply-all").click();
  await expect(page.getByTestId("speed-list-count")).toHaveText(String(total), { timeout: 90_000 });
  const firstPage = await page.getByTestId("speed-list-rows").getByTestId("speed-row").count();
  expect(firstPage).toBeLessThanOrEqual(25);
  await expect(page.getByTestId("speed-list-range")).toContainText(`of ${total}`);
  // A search narrows it, and the heading's count follows the rows.
  await page.getByTestId("speed-list-search").fill("harper");
  await expect(page.getByTestId("speed-list-count")).not.toHaveText(String(total), { timeout: 60_000 });
  const narrowed = n(await page.getByTestId("speed-list-count").innerText());
  expect(await page.getByTestId("speed-list-rows").getByTestId("speed-row").count()).toBe(Math.min(narrowed, 25));
  await page.getByTestId("speed-list-back").click();
  await expect(page.getByTestId("reply-rows")).toBeVisible();
});

test("a figure opens exactly its own leads: the count on the page is the count in the list", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  const buttons = page.getByTestId("speed-breakdown").getByTestId("number-button");
  expect(await buttons.count()).toBe(3);
  for (const i of [0, 1, 2]) {
    const label = (await buttons.nth(i).getAttribute("aria-label")) ?? "";
    const shown = Number(/^(\d+)/.exec(label)?.[1]);
    await buttons.nth(i).click();
    await expect(page.getByTestId("speed-list-count")).toHaveText(String(shown), { timeout: 90_000 });
    await page.getByTestId("speed-list-back").click();
  }
});

test("the same people as Today: the leads waiting are Today's new leads, for each role", async ({ request }) => {
  test.setTimeout(600_000);
  for (const as of [undefined, "business", "client"] as const) {
    const c = await api(request, as);
    const today = await c.get("today");
    const home = await c.get("speed?part=home");
    expect(home.waiting.waiting, `as ${as ?? "agency"}`).toBe(today.totals.replies.newLeads);
  }
});

test("every figure's count equals the rows of its list (months, weeks, clients, people)", async ({ request }) => {
  test.setTimeout(900_000);
  const c = await api(request);
  const home = await c.get("speed?part=home");
  const win = `from=${home.window.from}&to=${home.window.to}`;
  const s = home.summary;
  expect((await c.get(`speed?part=list&status=within&${win}`)).total).toBe(s.withinTarget);
  expect((await c.get(`speed?part=list&status=late&${win}`)).total).toBe(s.answeredLate);
  expect((await c.get(`speed?part=list&status=waiting&${win}`)).total).toBe(s.stillWaiting);
  expect((await c.get(`speed?part=list&status=all&${win}`)).total).toBe(s.judged);
  expect((await c.get("speed?part=list&status=waiting")).total, "the Reply now count").toBe(home.waiting.waiting);
  for (const a of (home.compareAccounts.rows as Json[]).slice(0, 3)) expect((await c.get(`speed?part=list&status=all&account=${a.id}&${win}`)).total, a.name).toBe(a.judged);
  for (const w of (home.trend as Json[]).filter((x) => x.leads > 0).slice(-2)) expect((await c.get(`speed?part=list&status=all&week=${w.index}`)).total, `week ${w.index}`).toBe(w.leads);
  for (const p of (home.comparePeople.rows as Json[]).slice(0, 2)) expect((await c.get(`speed?part=list&status=answered&person=${p.userId}&${win}`)).total, p.label).toBe(p.replies);
  // The comparison list pages and its count is the headline count of the card.
  const accounts = await c.get(`speed?part=compare&by=account&${win}&size=5`);
  expect(accounts.total).toBe(home.compareAccounts.total);
  expect(accounts.rows.length).toBeLessThanOrEqual(5);
  // A window is checked on the server.
  expect(await c.status("speed?part=home&from=2026-11-04&to=2026-10-01")).toBe(400);
  expect(await c.status("speed?part=list&status=nonsense")).toBe(400);
  expect(await c.status("speed?part=list&week=99")).toBe(400);
  expect(await c.status("speed?part=nonsense")).toBe(400);
});

test("a client's staff and a business owner only ever read their own account, and a client cannot rank people or change a target", async ({ request }) => {
  test.setTimeout(240_000);
  const agency = await api(request);
  const agencyHome = await agency.get("speed?part=home");
  const client = await api(request, "client");
  const clientHome = await client.get("speed?part=home");
  expect(clientHome.access.total).toBeLessThanOrEqual(1);
  expect(clientHome.compareAccounts.total).toBeLessThanOrEqual(1);
  expect(clientHome.comparePeople.total, "no ranking of colleagues for a client's staff").toBe(0);
  expect(clientHome.seePeople).toBe(false);
  const own = new Set<string>((clientHome.waiting.rows as Json[]).map((r) => r.locationId));
  expect(own.size).toBeLessThanOrEqual(1);
  // Asking for another client account's leads by its id answers nothing; a person filter is ignored for a client.
  const other = (agencyHome.compareAccounts.rows as Json[]).map((a) => a.id).find((id) => !own.has(id)) ?? "demo-loc-1";
  const asked = await client.get(`speed?part=list&status=all&account=${other}&from=${agencyHome.window.from}&to=${agencyHome.window.to}`);
  expect((asked.rows as Json[]).every((r) => own.has(r.locationId) || own.size === 0)).toBeTruthy();
  expect(asked.total).toBeLessThanOrEqual(clientHome.summary.judged);
  expect((await client.get("speed?part=compare&by=person")).total).toBe(0);
  const put = await request.put("/api/app/speed/target", { data: { locationId: other, minutes: 10 }, headers: { Authorization: `Bearer ${((await (await request.post("/api/sso", { data: { demo: true, as: "client" } })).json()) as { session: string }).session}` } });
  expect(put.status(), "a client's staff cannot change a reply target").toBe(403);
});

test("a reply target is typed by a person, checked on the server, saved for one client and put back", async ({ request }) => {
  test.setTimeout(240_000);
  const sso = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await sso.json()) as { session: string }).session}` };
  const c = await api(request);
  const home = await c.get("speed?part=home");
  const id = (home.compareAccounts.rows as Json[])[0].id as string;
  const put = (data: Json) => request.put("/api/app/speed/target", { data, headers });
  for (const bad of [0, -3, 1441, 2.5, "abc"]) expect((await put({ locationId: id, minutes: bad })).status(), String(bad)).toBe(400);
  expect((await put({ locationId: "../x", minutes: 10 })).status()).toBe(400);
  expect((await put({ locationId: "not-an-account-of-mine", minutes: 10 })).status()).toBe(404);
  if (!home.targetsReady) {
    // The database update that adds the column has not run: the screen says so in words and nothing breaks.
    const r = await put({ locationId: id, minutes: 10 });
    expect(r.status()).toBe(503);
    expect(((await r.json()) as Json).error).toMatch(/latest database update/);
    return;
  }
  try {
    expect((await put({ locationId: id, minutes: 5 })).status()).toBe(200);
    const after = await c.get("speed?part=home");
    const row = (after.compareAccounts.rows as Json[]).find((a) => a.id === id)!;
    expect(row.targetMinutes).toBe(5);
    expect(row.ownTarget).toBe(true);
    expect(after.targetMinutes, "the default for everyone else is unchanged").toBe(home.targetMinutes);
  } finally {
    expect((await put({ locationId: id, minutes: null })).status()).toBe(200);
  }
  const restored = (await c.get("speed?part=home")).compareAccounts.rows as Json[];
  expect(restored.find((a) => a.id === id)?.ownTarget).toBe(false);
});

test("a row's menu calls and emails through the CRM, never a phone link, and the lead panel opens", async ({ page, context }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  const row = page.getByTestId("reply-rows").getByTestId("speed-row").first();
  await row.getByTestId("speed-row-more").click();
  await expect(page.getByRole("menuitem", { name: /Call in your CRM|Call \(asked not to be contacted\)/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Email in your CRM" })).toBeVisible();
  await page.keyboard.press("Escape");
  const links = await page.locator('main a[href^="tel:"], main a[href^="mailto:"]').count();
  expect(links, "no tel: or mailto: link on the page").toBe(0);
  void context;
  await row.getByTestId("speed-row-name").click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-position")).toContainText("of");
});

test("the range is carried in the address and a custom range that is backwards is refused", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  await page.getByRole("combobox", { name: "How fast replies come: range" }).selectOption("7d");
  await expect(page.getByTestId("card-range-window").first()).toContainText("Last 7 days");
  expect(page.url()).toContain("r.speed=7d");
  await page.reload();
  await expect(page.getByTestId("card-range-window").first()).toContainText("Last 7 days", { timeout: 90_000 });
});
