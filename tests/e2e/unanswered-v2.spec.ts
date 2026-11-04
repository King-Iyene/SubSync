import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// Unanswered messages, rebuilt (stage UNANS, docs/UNANSWERED_REVIEW.md), on the demo company for the four roles and the three widths of the projects: one sentence and one
// primary button, five people to reply to now, See all that opens the whole list (server paged), every bar and number opening exactly its own people, a ranking only for people who
// may see it, Today's number explained, and a clean phone layout. The demo answers slowly (every call signs in again), so waits are long.
const ROLES = [
  { name: "agency, all accounts", path: "/app#inbox", multi: true, owners: false, menu: false },
  { name: "agency, inside one account", path: "/app?as=location", multi: false, owners: true, menu: true },
  { name: "a client's staff", path: "/app?as=client#inbox", multi: false, owners: false, menu: false },
  { name: "a business owner", path: "/app?as=business#inbox", multi: false, owners: true, menu: false },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;

async function open(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "Unanswered messages", exact: true }).first().click({ timeout: 90_000 });
  else await page.reload();
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 90_000 });
}
const n = (text: string) => Number(text.replace(/[^\d]/g, ""));

for (const role of ROLES) {
  test(`${role.name}: one sentence, one primary button, five rows at most, plain words, no sideways scroll`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await open(page, role.path, role.menu);
    const headline = (await page.getByTestId("today-headline").innerText()).trim();
    expect(headline).toMatch(/(person is|people are) waiting for a reply|Nobody is waiting for a reply/);
    if (!/Nobody/.test(headline)) {
      await expect(page.getByTestId("today-primary-button")).toHaveText(/^Reply to the (oldest of the [\d,]+ people|person) waiting/);
      const rows = page.getByTestId("reply-rows").getByTestId("wait-row");
      expect(await rows.count()).toBeGreaterThan(0);
      expect(await rows.count()).toBeLessThanOrEqual(5);
      await expect(page.getByTestId("wait-reply").first()).toBeVisible();
      await expect(page.getByTestId("wait-picture")).toBeVisible();
      // The first sentence's number is the number the See all button shows (the number counts up when the page opens).
      const all = page.getByTestId("wait-all");
      if (await all.count()) {
        const seeAll = n(await all.innerText());
        await expect.poll(async () => n(((await page.getByTestId("today-headline").innerText()).match(/^[\d,]+/)?.[0]) ?? "0"), { timeout: 15_000 }).toBe(seeAll);
      }
    }
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    // Clients are ranked for an agency with more than one; owners inside one account; a client's staff get neither (the server sends none).
    if (role.multi) await expect(page.getByTestId("rank-account-row").first()).toBeVisible();
    else if (role.owners) await expect(page.getByTestId("rank-owner-row").first()).toBeVisible();
    else { await expect(page.getByTestId("rank-owner-row")).toHaveCount(0); await expect(page.getByTestId("rank-account-row")).toHaveCount(0); }
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(innerWidth + 1);
    if (testInfo.project.name.includes("390")) {
      const boxes = await page.locator('[data-testid="wait-reply"], [data-testid="wait-row-more"], [data-testid="today-primary-button"], [data-testid="wait-bar"][data-count]:not([data-count="0"])').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(boxes.length).toBeGreaterThan(0);
      for (const h of boxes) expect(h, "thumb sized").toBeGreaterThanOrEqual(43.5);
    }
  });
}

/**
 * Presses a number and checks that the list it opens holds exactly that many people. The number was read when the page loaded and the list is read when it is pressed; on the
 * slow demo that is minutes apart, and a person can cross the reply target in between (the clock moves, each number is right at its moment). So when the two differ the page is
 * loaded again and the pair is retaken, up to 4 times; a list that is always different still fails.
 */
async function opensItsPeople(page: Page, press: () => Promise<number>, back = true) {
  let lastShown = -1, lastCount = -2;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) { await page.reload(); await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 90_000 }); }
    lastShown = await press();
    try { await expect(page.getByTestId("wait-list-count")).toHaveText(String(lastShown), { timeout: 45_000 }); lastCount = lastShown; break; }
    catch { lastCount = n(await page.getByTestId("wait-list-count").innerText().catch(() => "-1")); }
  }
  expect(lastCount, "the list holds the number that was pressed").toBe(lastShown);
  if (back) await page.getByTestId("wait-list-back").click();
}

test("See all opens the whole list: its count is the headline's, it can be searched and paged, and Back returns", async ({ page }) => {
  test.setTimeout(420_000);
  await open(page, "/app#inbox");
  let total = 0;
  await opensItsPeople(page, async () => { total = n(await page.getByTestId("wait-all").innerText()); expect(total).toBeGreaterThan(5); await page.getByTestId("wait-all").click(); return total; }, false);
  expect(await page.getByTestId("wait-list-rows").getByTestId("wait-row").count()).toBeLessThanOrEqual(25);
  await expect(page.getByTestId("wait-list-range")).toContainText(`of ${total}`);
  await page.getByTestId("wait-list-search").fill("santos");
  await expect(page.getByTestId("wait-list-count")).not.toHaveText(String(total), { timeout: 60_000 });
  const narrowed = n(await page.getByTestId("wait-list-count").innerText());
  expect(await page.getByTestId("wait-list-rows").getByTestId("wait-row").count()).toBe(Math.min(narrowed, 25));
  await page.getByTestId("wait-list-back").click();
  await expect(page.getByTestId("reply-rows")).toBeVisible();
});

test("a bar opens exactly its people: the number on the bar is the number in the list", async ({ page }) => {
  test.setTimeout(600_000);
  await open(page, "/app#inbox");
  const live = page.locator('[data-testid="wait-bar"]:not([data-count="0"])');
  expect(await live.count()).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(await live.count(), 3); i++) {
    await opensItsPeople(page, async () => {
      const bar = live.nth(i);
      const shown = Number(await bar.getAttribute("data-count"));
      await bar.click();
      return shown;
    });
  }
});

test("a client's number opens exactly its people, and See all of the clients is searched on the server", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "/app#inbox");
  const first = page.getByTestId("rank-account-row").first();
  const label = (await first.getByTestId("number-button").getAttribute("aria-label")) ?? "";
  const shown = Number(/: (\d+)/.exec(label)?.[1]);
  await first.getByTestId("number-button").click();
  await expect(page.getByTestId("wait-list-count")).toHaveText(String(shown), { timeout: 90_000 });
  await page.getByTestId("wait-list-back").click();
  const seeAll = page.getByTestId("rank-see-all");
  if (await seeAll.count()) {
    await seeAll.click();
    await expect(page.getByTestId("rank-all")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("rank-search").fill("zzz-nobody");
    await expect(page.getByTestId("empty-state")).toBeVisible({ timeout: 60_000 });
  }
});

// The demo answers slowly, so two reads are a few minutes apart and a person can cross the reply target between them (the clock moves, the number is right at each moment).
// A figure and its list are therefore compared as a pair taken one after the other, and the pair is retaken (at most 6 times, 4 seconds apart) if the clock moved between them, or if a demo sign-in made elsewhere re-made the sample conversations (it deletes and inserts them, so for a moment they are missing).
async function pair<T>(read: () => Promise<[T, T]>, label: string): Promise<void> {
  let last: [T, T] | null = null;
  for (let i = 0; i < 6; i++) { last = await read(); if (last[0] === last[1]) return; await new Promise((r) => setTimeout(r, 4000)); }
  expect(last![1], label).toBe(last![0]);
}

test("every number agrees with its list, and with Today: Today's count is the people here plus the new leads nobody has replied to", async ({ request }) => {
  test.setTimeout(900_000);
  for (const as of [undefined, "business", "client"] as const) {
    const c = await api(request, as);
    const home = await c.get("inbox?part=home");
    const today = await c.get("today");
    const w = home.waiting;
    const who = as ?? "agency";
    await pair(async () => { const h = await c.get("inbox?part=home"); return [h.waiting.people as number, (await c.get("inbox?part=list")).total as number]; }, `the headline is the list (${who})`);
    for (const b of home.buckets as Json[]) {
      await pair(async () => { const h = await c.get("inbox?part=home"); const hb = (h.buckets as Json[]).find((x) => x.key === b.key)?.count ?? 0; return [hb as number, (await c.get(`inbox?part=list&bucket=${b.key}`)).total as number]; }, `${b.label} (${who})`);
    }
    expect(home.buckets.reduce((s: number, b: Json) => s + b.count, 0), "the bars add up to the headline").toBe(w.people);
    for (const a of ((home.accounts?.rows ?? []) as Json[]).slice(0, 3)) {
      await pair(async () => { const h = await c.get("inbox?part=home"); const ha = (h.accounts?.rows as Json[] | undefined)?.find((x) => x.id === a.id)?.count ?? 0; return [ha as number, (await c.get(`inbox?part=list&account=${a.id}`)).total as number]; }, a.name);
    }
    for (const o of ((home.owners?.rows ?? []) as Json[]).slice(0, 3)) {
      await pair(async () => { const h = await c.get("inbox?part=home"); const ho = (h.owners?.rows as Json[] | undefined)?.find((x) => x.key === o.key)?.count ?? 0; return [ho as number, (await c.get(`inbox?part=list&owner=${o.key}`)).total as number]; }, o.label);
    }
    // Today: the same function counts the same people; the difference is the new leads who have no waiting conversation, and nothing else.
    expect(home.today, `as ${who}`).not.toBeNull();
    expect(home.today.count).toBe(home.today.people + home.today.newLeadsOnly);
    expect(w.newLeads, "new leads among the people here").toBe(home.today.newLeadsAmongThem);
    // Today's own count, read before and after this screen's: the number this screen says Today shows lies between them (the clock may move a person across the target meanwhile).
    let sandwiched = false, t1 = 0, hh = 0, t2 = 0;
    for (let i = 0; i < 6 && !sandwiched; i++) {
      t1 = (await c.get("today")).totals.replies.count as number; hh = (await c.get("inbox?part=home")).today.count as number; t2 = (await c.get("today")).totals.replies.count as number;
      sandwiched = hh >= Math.min(t1, t2) && hh <= Math.max(t1, t2);
      if (!sandwiched) await new Promise((r) => setTimeout(r, 4000));
    }
    expect(sandwiched, `Today's headline count (${who}): Today ${t1} then ${t2}, this screen says ${hh}`).toBe(true);
    void today;
  }
});

test("the first screen is small and the server refuses what it should", async ({ request }) => {
  test.setTimeout(300_000);
  const c = await api(request);
  const home = await c.get("inbox?part=home");
  expect(JSON.stringify(home).length, "the first answer stays small").toBeLessThan(40_000);
  expect(home.waiting.rows.length).toBeLessThanOrEqual(5);
  expect((home.accounts?.rows ?? []).length).toBeLessThanOrEqual(5);
  expect(await c.status("inbox?part=list&bucket=nonsense")).toBe(400);
  expect(await c.status("inbox?part=list&sort=nonsense")).toBe(400);
  expect(await c.status("inbox?part=list&channel=%3Cscript%3E")).toBe(400);
  expect(await c.status("inbox?part=list&owner=a%20b")).toBe(400);
  expect(await c.status("inbox?part=nonsense")).toBe(400);
  const paged = await c.get("inbox?part=list&size=2&page=1");
  expect(paged.rows.length).toBeLessThanOrEqual(2);
  expect(paged.page).toBe(1);
  expect((await c.get("inbox?part=list&size=500")).rows.length, "never more than 50 a page").toBeLessThanOrEqual(50);
  // The older answer is still served for the exports and the older tests.
  expect((await c.get("inbox")).waitingTotal).toBe(home.waiting.conversations);
});

test("a client's staff and a business owner only read their own account, and a client cannot rank people or look at a colleague by id", async ({ request }) => {
  test.setTimeout(300_000);
  const agency = await api(request);
  const agencyHome = await agency.get("inbox?part=home");
  const client = await api(request, "client");
  const clientHome = await client.get("inbox?part=home");
  expect(clientHome.seePeople).toBe(false);
  expect(clientHome.owners, "no ranking of colleagues for a client's staff").toBeNull();
  expect(clientHome.accounts).toBeNull();
  const own = new Set<string>((clientHome.waiting.rows as Json[]).map((r) => r.locationId));
  expect(own.size).toBeLessThanOrEqual(1);
  const other = ((agencyHome.accounts?.rows ?? []) as Json[]).map((a) => a.id).find((id) => !own.has(id)) ?? "demo-loc-1";
  const asked = await client.get(`inbox?part=list&account=${other}`);
  expect((asked.rows as Json[]).every((r) => own.has(r.locationId))).toBeTruthy();
  expect((await client.get("inbox?part=ranks&by=owner")).total).toBe(0);
  const byColleague = ((agencyHome.owners?.rows ?? []) as Json[])[0]?.key ?? "user-c3d7";
  const viaId = await client.get(`inbox?part=list&owner=${byColleague}`);
  expect(viaId.total, "a colleague's id does not narrow a client's list").toBe((await client.get("inbox?part=list")).total);
  const biz = await api(request, "business");
  const bizHome = await biz.get("inbox?part=home");
  expect(new Set((bizHome.waiting.rows as Json[]).map((r) => r.locationId)).size).toBeLessThanOrEqual(1);
});

test("a row's menu calls and emails through the CRM, never a phone link, and the person panel opens", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#inbox");
  const row = page.getByTestId("reply-rows").getByTestId("wait-row").first();
  await row.getByTestId("wait-row-more").click();
  await expect(page.getByRole("menuitem", { name: /Call in your CRM|Call \(asked not to be contacted\)/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Email in your CRM" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.locator('main a[href^="tel:"], main a[href^="mailto:"]').count(), "no tel: or mailto: link on the page").toBe(0);
  await row.getByTestId("wait-row-name").click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-position")).toContainText("of");
});
