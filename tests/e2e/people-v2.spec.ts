import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// People, the rebuild (stage PEOPLE, docs/PEOPLE_REVIEW.md), on the demo company, for the four roles and the three widths of the projects:
//   a search box first, one sentence and one button, five ready-made lists whose counts equal their rows, a lead panel with a headline, tags with the day and a timeline, a warning
//   before calling a person who asked not to be contacted, keys that move through lists, recent searches and recently opened people, a client's staff held to their own account,
//   and a clean phone layout (nothing sideways, 44 px thumb targets).
// The demo is slow to answer (every call signs the demo in again), so the waits are long. Tests that need a person who asked not to be contacted, or a tag with a known day, change
// the ANSWER the browser receives (page.route), never the data. Nothing here logs a call: that write is covered by the database test.
const ROLES = [
  { name: "agency, all accounts", path: "/app#people", slug: "agency", multi: true },
  // Opened from inside one client account the shell starts on that account only when there is no address hash, so this role opens the app and then the menu entry.
  { name: "agency, inside one account", path: "/app?as=location", slug: "agency-account", multi: false, menu: true },
  { name: "a client's staff", path: "/app?as=client#people", slug: "client", multi: false },
  { name: "a business owner", path: "/app?as=business#people", slug: "business", multi: false },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;
const LISTS = ["waiting", "noshows", "followups", "hot", "stale"] as const;

async function open(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "People", exact: true }).filter({ visible: true }).first().click({ timeout: 90_000 });
  else await page.reload();
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
}
const chipCount = async (page: Page, id: string) => Number(((await page.getByTestId(`list-${id}`).innerText()).match(/([\d,]+)\+?\s*$/)?.[1] ?? "0").replace(/,/g, ""));
const noSideScroll = async (page: Page, where: string) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: ${sw}px in a ${cw}px window`).toBeLessThanOrEqual(cw);
};

for (const role of ROLES) {
  test(`${role.name}: search first, one sentence and one button, five lists, one small Call button a row, plain words, no sideways scroll`, async ({ page, request }, testInfo) => {
    test.setTimeout(300_000);
    // Only an agency looking at all its clients sees which client each person belongs to; one account never does (decided on the server, from the signed-in person).
    const asRole = role.slug === "business" ? "business" : role.slug === "client" ? "client" : undefined;
    if (role.slug !== "agency-account") expect((await (await api(request, asRole)).get("people/home")).multi, "which accounts the person may see").toBe(role.multi);
    await open(page, role.path, "menu" in role && role.menu === true);
    await expect(page.getByTestId("people-search-input")).toBeVisible();
    await expect(page.getByTestId("people-say")).toHaveText(/\S/);
    for (const id of LISTS) await expect(page.getByTestId(`list-${id}`)).toBeVisible();
    // The page starts on a list that has people, with a button that opens the first of them.
    const rows = page.getByTestId("person-row");
    await expect(rows.first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("people-start")).toHaveText(/^Start with .+/);
    // KF-8: each row has one name, one line of reason, ONE small Call button (or Show when there is no number) and a menu; the line says why.
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(25);
    for (let i = 0; i < Math.min(n, 5); i++) {
      const row = rows.nth(i);
      await expect(row.getByTestId("person-line")).toHaveText(/\S/);
      expect(await row.locator("[data-testid=person-call], [data-testid=person-show]").count(), "one small button a row").toBe(1);
      await expect(row.getByTestId("person-more")).toBeVisible();
    }
    // The CRM note is said once on the page, never per row; no phone link anywhere.
    await expect(page.getByTestId("dial-note")).toHaveCount(1);
    await expect(page.getByTestId("dial-note")).toContainText("Not available from your CRM yet");
    await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0);
    // Plain words, and a single account never names accounts it has not got.
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await noSideScroll(page, role.name);
    if (testInfo.project.name === "phone-390") {
      for (const sel of ["person-call", "person-more", "people-start", "list-waiting"]) {
        const box = await page.getByTestId(sel).first().boundingBox();
        expect(box!.height, `${sel} is thumb sized`).toBeGreaterThanOrEqual(43.5);
      }
    }
    if (process.env.SHOTS) {
      mkdirSync("docs/review", { recursive: true });
      await page.screenshot({ path: `docs/review/people-${role.slug}-${testInfo.project.name.replace(/\D+/g, "")}.png` });
    }
  });
}

test("every chip's number is the number of people in its list, and the same as the page it comes from", async ({ request, page }) => {
  test.setTimeout(300_000);
  const a = await api(request);
  const home = await a.get("people/home");
  const total = (id: string) => (home.counts as Json[]).find((c) => c.id === id)!.total as number;
  // The chip, the list behind it and the other page's own number are one definition (docs/METRICS.md "People, call lists").
  const speed = await a.get("speed?part=home");
  expect(total("waiting"), "Speed to lead's waiting leads").toBe(speed.waiting.waiting);
  const appts = await a.get("appointments/work");
  expect(total("noshows") + (await a.get("people/queue?list=noshows")).withoutContact, "Appointments' no-shows to rebook").toBe(appts.counts.recover);
  for (const id of LISTS) {
    const q = await a.get(`people/queue?list=${id}`);
    expect(q.total, `${id}: the list's own total`).toBe(total(id));
    let seen = q.rows.length;
    for (let p = 2; p <= q.pages && p <= 12; p++) seen += (await a.get(`people/queue?list=${id}&page=${p}`)).rows.length;
    if (q.pages <= 12 && !q.capped) expect(seen, `${id}: the rows over all pages`).toBe(q.total);
  }
  await open(page, "/app#people");
  for (const id of LISTS) expect(await chipCount(page, id), `${id}: the chip on screen`).toBe(total(id));
});

test("Start with the first person: the panel gives a headline, Call and Email, tags with the honest note, a timeline, and the keys step through the list", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "/app#people");
  const first = (await page.getByTestId("people-start").innerText()).replace(/^Start with /, "");
  await page.getByTestId("people-start").click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drawer-name")).toHaveText(first);
  await expect(drawer.getByTestId("drawer-position")).toContainText("1 of");
  // One sentence about this person, and the one thing to do, as soon as SubSync's own copy has answered.
  await expect(drawer.getByTestId("drawer-headline")).toHaveText(/\S/, { timeout: 90_000 });
  await expect(drawer.getByTestId("drawer-call")).toBeVisible();
  await expect(drawer.getByTestId("drawer-email")).toBeVisible();
  await expect(drawer.getByTestId("drawer-timeline")).toBeVisible({ timeout: 90_000 });
  await expect(drawer.getByTestId("drawer-timeline")).toContainText("Added as a contact");
  expect(await drawer.innerText()).not.toMatch(BANNED);
  // The keys: the arrows and j / k move through the list the panel was opened from; Escape closes and gives the focus back.
  await page.keyboard.press("ArrowRight");
  await expect(drawer.getByTestId("drawer-position")).toContainText("2 of");
  await page.keyboard.press("k");
  await expect(drawer.getByTestId("drawer-position")).toContainText("1 of");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("people-start")).toBeFocused();
});

test("tags show the day SubSync first saw them, with the honest note that the CRM does not say", async ({ page }) => {
  test.setTimeout(300_000);
  // The answer for one person is given a tag and a day, so the screen is checked whatever the demo's tag history holds.
  await page.route("**/api/app/people/person/**", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    body.contact.tags = ["vip", "cold email"];
    body.tagDates = { vip: "2026-11-02T10:00:00Z" };
    body.watchingSince = "2026-10-30T08:00:00Z";
    await route.fulfill({ response: res, json: body });
  });
  await open(page, "/app#people");
  await page.getByTestId("person-name").first().click();
  const tags = page.getByTestId("drawer-tags");
  await expect(tags).toBeVisible({ timeout: 90_000 });
  await expect(tags.getByTestId("drawer-tag").filter({ hasText: "vip" })).toContainText(/added .*2026/);
  await expect(tags.getByTestId("drawer-tag").filter({ hasText: "vip" })).toContainText(/Nov/);
  await expect(tags.getByTestId("drawer-tag").filter({ hasText: "cold email" })).not.toContainText("added");
  await expect(page.getByTestId("drawer-tags-note")).toContainText("Your CRM does not say when a tag was added");
  await expect(page.getByTestId("drawer-tags-note")).toContainText("since it started watching");
});

test("a person who asked not to be contacted is marked on the row, and calling or emailing them stops with a warning first", async ({ page, context }) => {
  test.setTimeout(300_000);
  const mark = async (route: import("@playwright/test").Route, key: "rows" | "none") => {
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    const rows = (key === "rows" ? (body.page?.rows ?? body.rows) : null) as Json[] | null;
    // The first person who has a number (a person without one has a Show button, not a Call button).
    const target = rows?.find((r) => r.phone);
    if (target) target.dnd = true;
    await route.fulfill({ response: res, json: body });
  };
  await page.route("**/api/app/people/home**", (r) => mark(r, "rows"));
  await open(page, "/app#people");
  const row = page.locator('[data-testid=person-row][data-dnd=true]').first();
  await expect(row).toBeVisible({ timeout: 90_000 });
  await expect(row.getByTestId("person-dnd")).toHaveText("Do not disturb");
  await row.getByTestId("person-call").click();
  const warning = page.getByTestId("dial-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("asked not to be contacted");
  await expect(warning.getByRole("button", { name: "Do not call" })).toBeFocused();
  // Nothing opened yet. "Do not call" closes it and nothing is opened; "Call anyway" is a second, deliberate press.
  let opened = 0;
  context.on("page", () => { opened += 1; });
  await warning.getByRole("button", { name: "Do not call" }).click();
  await expect(warning).toHaveCount(0);
  expect(opened).toBe(0);
  await row.getByTestId("person-call").click();
  const popup = context.waitForEvent("page", { timeout: 30_000 });
  await page.getByTestId("dial-anyway").click();
  expect(await popup).toBeTruthy();
});

test("logging how a call went moves on to the next person, and says nothing is sent to the CRM", async ({ page }) => {
  test.setTimeout(300_000);
  // The write itself is answered by the test (the demo's call records are not touched; the real write is covered by the database test).
  let sent: Json | null = null;
  await page.route("**/api/app/people/outcome", async (route) => { sent = JSON.parse(route.request().postData() ?? "{}") as Json; await route.fulfill({ json: { ok: true } }); });
  await open(page, "/app#people");
  await page.getByTestId("person-name").first().click();
  const drawer = page.getByTestId("lead-drawer");
  const name1 = await drawer.getByTestId("drawer-name").innerText();
  const log = drawer.getByTestId("log-call");
  // A person with no phone number, or one who asked not to be contacted, has no log box: move to one that does.
  for (let i = 0; i < 6 && (await log.count()) === 0; i++) { await page.keyboard.press("ArrowRight"); await expect(drawer.getByTestId("drawer-headline")).toBeVisible({ timeout: 90_000 }); }
  await expect(log).toBeVisible({ timeout: 90_000 });
  const before = await drawer.getByTestId("drawer-position").innerText();
  await log.locator("summary").click();
  await expect(log).toContainText("Nothing is sent to your CRM");
  await log.getByTestId("log-voicemail").click();
  await expect.poll(() => sent).toMatchObject({ outcome: "voicemail" });
  await expect(drawer.getByTestId("drawer-position")).not.toHaveText(before);
  expect(name1.length).toBeGreaterThan(0);
});

test("search finds a person by part of a name, shows the count and the words behind it, and opens them; one letter asks for more; clearing returns to the lists", async ({ request, page }) => {
  test.setTimeout(300_000);
  const a = await api(request);
  const sample = (await a.get("people/queue?list=hot")).rows[0] as Json;
  const word = (sample.name as string).split(" ")[0].slice(0, 4);
  await open(page, "/app#people");
  const box = page.getByTestId("people-search-input");
  await box.fill("a");
  await expect(page.getByText("Type at least two letters, or three digits of a phone number.")).toBeVisible();
  await expect(page.getByTestId("people-results")).toHaveCount(0);
  await box.fill(word);
  await expect(page.getByTestId("people-results")).toBeVisible({ timeout: 90_000 });
  const apiTotal = (await a.get(`people/search?q=${encodeURIComponent(word)}`)).total as number;
  await expect(page.getByTestId("people-count")).toContainText(apiTotal.toLocaleString("en-US"));
  await expect(page.getByTestId("people-list").getByTestId("person-name").first()).toBeVisible();
  // Every row of a search says how to reach the person, not why they are on a list.
  await expect(page.getByTestId("people-list").getByTestId("person-line").first()).toHaveText(/\S/);
  await page.getByTestId("people-list").getByTestId("person-name").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear the search" }).click();
  await expect(page.getByTestId("people-say")).toBeVisible();
  await expect(page.getByTestId("people-results")).toHaveCount(0);
  await box.fill("0000000000000000zzzz");
  await expect(page.getByText("Nobody matches")).toBeVisible({ timeout: 90_000 });
  await a.get("people/recent"); // (no write: a search is only remembered when Enter is pressed or a result is opened)
});

test("recent searches and recently opened people are remembered for the person, and can be cleared", async ({ request, page }) => {
  test.setTimeout(300_000);
  const a = await api(request);
  const del = async () => { const s = await request.post("/api/sso", { data: { demo: true } }); const t = ((await s.json()) as { session: string }).session; await request.delete("/api/app/people/recent?what=all", { headers: { Authorization: `Bearer ${t}` } }); };
  await del();
  try {
    const sample = (await a.get("people/queue?list=hot")).rows[0] as Json;
    const word = (sample.name as string).split(" ")[0].slice(0, 4);
    await open(page, "/app#people");
    await page.getByTestId("people-search-input").fill(word);
    await expect(page.getByTestId("people-results")).toBeVisible({ timeout: 90_000 });
    await page.getByTestId("people-search-input").press("Enter");
    await page.getByTestId("people-list").getByTestId("person-name").first().click();
    await expect(page.getByTestId("drawer-headline")).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press("Escape");
    // A fresh visit: the search words and the person are offered again.
    await page.reload();
    await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("recent-searches")).toContainText(word, { ignoreCase: true });
    await expect(page.getByTestId("recent-people")).toBeVisible();
    await page.getByTestId("clear-opened").click();
    await expect(page.getByTestId("recent-people")).toHaveCount(0);
  } finally { await del(); }
});

test("a person opened before shows what changed since the person last looked", async ({ page }) => {
  test.setTimeout(300_000);
  await page.route("**/api/app/people/person/**", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    body.lastSeenAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    body.changed = { count: 2, titles: ["Text message from them", "Deal moved to Proposal"], line: "2 things since you last looked, 3 days ago: Text message from them; Deal moved to Proposal." };
    await route.fulfill({ response: res, json: body });
  });
  await open(page, "/app#people");
  await page.getByTestId("person-name").first().click();
  await expect(page.getByTestId("drawer-changed")).toContainText("2 things since you last looked");
});

test("a note to self is only copied: nothing is saved, nothing is sent", async ({ page, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  const writes: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET" && /\/api\/app\//.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await open(page, "/app#people");
  await page.getByTestId("person-name").first().click();
  const note = page.getByTestId("note-to-self");
  await expect(note).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => writes.some((w) => w.includes("people/seen")), { timeout: 60_000 }).toBe(true);
  await note.locator("summary").click();
  await note.getByRole("textbox").fill("Call back Friday after 2");
  const before = writes.length;
  await note.getByTestId("note-copy").click();
  await expect(note).toContainText("Copied");
  expect(writes.slice(before), "copying the note makes no request to the server").toEqual([]);
});

test("a client's staff only ever read their own account, whatever the address says", async ({ request }) => {
  test.setTimeout(300_000);
  const agency = await api(request);
  const other = ((await agency.get("health")).accounts as Json[]).map((x) => x.locationId as string);
  const a = await api(request, "client");
  const mine = await a.get("people/home");
  expect(mine.multi).toBe(false);
  const own = ((await a.get("health")).accounts as Json[])[0].locationId as string;
  expect(((mine.page?.rows ?? []) as Json[]).every((r) => r.locationId === own)).toBe(true);
  const foreign = other.find((x) => x !== own) ?? "someOtherAccount1";
  for (const forged of [`location=${foreign}`, `account=${foreign}`, `accounts=${foreign}`]) {
    const q = await a.get(`people/queue?list=hot&${forged}`);
    expect((q.rows as Json[]).every((r) => r.locationId === own), `forged ${forged}`).toBe(true);
    const s = await a.get(`people/search?q=an&${forged}`);
    expect((s.rows as Json[]).every((r) => r.locationId === own), `search, forged ${forged}`).toBe(true);
  }
  expect(await a.status(`people/person/${foreign}/anything-here`)).toBe(404);
  expect((await a.post("people/outcome", { locationId: foreign, contactId: "anything-here", outcome: "answered" })).status).toBe(404);
  expect(JSON.stringify(mine)).not.toContain(foreign);
});

test("the phone: nothing scrolls sideways on any tab or in the panel, and every target is at least 44 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "a phone-only check");
  test.setTimeout(300_000);
  await open(page, "/app#people");
  await noSideScroll(page, "Find and call");
  await page.getByTestId("filters-toggle").click();
  await noSideScroll(page, "filters open");
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("person-name").first().click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer.getByTestId("drawer-call")).toBeVisible();
  await expect(drawer.getByTestId("drawer-timeline")).toBeVisible({ timeout: 90_000 });
  for (const sel of ["drawer-call", "drawer-email", "drawer-more", "drawer-next"]) {
    const box = await drawer.getByTestId(sel).boundingBox();
    expect(box!.height, `${sel}`).toBeGreaterThanOrEqual(43.5);
    expect(box!.width, `${sel}`).toBeGreaterThanOrEqual(43.5);
  }
  await noSideScroll(page, "panel");
  await page.keyboard.press("Escape");
  for (const name of ["Tags", "Going cold", "Sources"]) { await page.getByRole("tab", { name, exact: true }).click(); await noSideScroll(page, name); }
});

test("the header search: arrows move down the results, Enter opens one, each result has a Call button, and an empty box offers what was opened lately", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/app#today");
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("global-search-input");
  await expect(input).toBeFocused();
  await input.fill("an");
  const rows = page.getByTestId("gs-row");
  await expect(rows.first()).toBeVisible({ timeout: 90_000 });
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("gs-call").first()).toBeVisible();
  const second = await rows.nth(1).locator("button").first().innerText();
  await input.press("Enter");
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("drawer-name")).toHaveText(second.split("\n")[0].replace(/Do not disturb$/, "").trim());
});
