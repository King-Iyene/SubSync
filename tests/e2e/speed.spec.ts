import { expect, test, type APIRequestContext } from "@playwright/test";

// F2: speed to lead on the messy demo tenant. Every account has 30 leads of which four are not people to chase (a spam tag, a test
// name, a CSV import and a repeat of the first contact's email); Blue Door Realty has Facebook and Instagram lead forms and portals.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function headers(request: APIRequestContext, as?: "business" | "client") {
  const res = await request.post("/api/sso", { data: { demo: true, ...(as ? { as } : {}) } });
  return { Authorization: `Bearer ${((await res.json()) as { session: string }).session}` };
}
const speed = async (request: APIRequestContext): Promise<Json> => {
  const res = await request.get("/api/app/speed", { headers: await headers(request) });
  expect(res.ok(), `speed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
};

test("contacts that are not leads are left out and the screen says why", async ({ request }) => {
  const d = await speed(request);
  const reasons = new Map<string, number>((d.leftOut as Json[]).map((r) => [r.reason, r.n]));
  for (const r of ["import", "spam", "test", "duplicate"]) expect(reasons.get(r) ?? 0, `${r} contacts are left out`).toBeGreaterThan(0);
  const total = [...reasons.values()].reduce((s, n) => s + n, 0);
  expect(total, "about four per account across the live accounts").toBeGreaterThanOrEqual(20);
});

test("no left-out contact appears in the waiting list, and the figures add up", async ({ request }) => {
  const d = await speed(request);
  const o = d.overall as Json;
  expect(o.leads).toBe(o.withinTarget + o.answeredLate + o.stillWaiting);
  expect(o.answered).toBe(o.withinTarget + o.answeredLate);
  expect(d.waiting.every((w: Json) => w.waitingMinutes > d.targetMinutes), "every waiting lead is past the target").toBeTruthy();
  // The per-account rows add up to the overall figure: one definition everywhere.
  const sum = (k: string) => (d.perAccount as Json[]).reduce((s, a) => s + a[k], 0);
  expect(sum("leads")).toBe(o.leads);
  expect(sum("stillWaiting")).toBe(o.stillWaiting);
  expect(sum("withinTarget")).toBe(o.withinTarget);
});

test("Facebook and Instagram lead forms are their own source with their own target", async ({ request }) => {
  const d = await speed(request);
  const meta = (d.bySource as Json[]).find((s) => s.cls === "meta");
  expect(meta, "a Meta lead form row exists").toBeTruthy();
  expect(meta?.targetMinutes).toBe(10);
  expect(meta?.leads).toBeGreaterThan(0);
  const classes = (d.bySource as Json[]).map((s) => s.cls);
  expect(classes).toContain("portal"); // Zillow, Realtor.com and open house sign-ins
});

test("the speed screen uses plain words and shows the left-out sentence", async ({ page }, testInfo) => {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/leads? (is|are) waiting for a reply|No leads are waiting for a reply/).first()).toBeVisible();
  await expect(page.getByText("were not counted as leads", { exact: false })).toBeVisible();
  await expect(page.getByText("Facebook and Instagram lead forms", { exact: false }).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `docs/review/f2-speed-${testInfo.project.name}.png`, fullPage: true });
});

test("the real estate sample audit page opens and says it is fictional", async ({ page }, testInfo) => {
  await page.goto("/audit/sample-real-estate-team-audit");
  await expect(page.getByText("Sample real estate team (fictional data)").first()).toBeVisible();
  await expect(page.getByText("Facebook and Instagram lead-form leads", { exact: false }).first()).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b|sub-?account|\blocations?\b/i);
  await page.screenshot({ path: `docs/review/f2-sample-audit-${testInfo.project.name}.png`, fullPage: true });
});

// ---- stage F2 delta: names, progress, automatic touch apart, sources, per-card ranges, lists behind every figure ----
const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const part = async (request: APIRequestContext, p: string, days = 30, as?: "business" | "client"): Promise<Json> => {
  const res = await request.get(`/api/app/speed?part=${p}&from=${ymd(days - 1)}&to=${ymd(0)}`, { headers: await headers(request, as) });
  expect(res.ok(), `speed part ${p}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
};

test("the main answer says how it is measured and never shows a raw id or a placeholder name", async ({ request }) => {
  const d = await speed(request);
  expect(d.measuring).toMatchObject({ targetMinutes: expect.any(Number), countAutomated: expect.any(Boolean), canChange: true });
  const text = JSON.stringify(d.people) + JSON.stringify(d.waiting);
  expect(text, "no placeholder name such as Team member ZWol").not.toMatch(/Team member [A-Za-z0-9]{4}\b/);
  expect(text, "no raw demo user id").not.toMatch(/user-[0-9a-f]{4}/);
  expect(d.people.some((p: Json) => p.label === "Former team member"), "the demo's unnamed person is explained").toBeTruthy();
  expect(d.waiting.length).toBeLessThanOrEqual(d.waitingTotal);
  expect(d.waiting.every((w: Json) => typeof w.source === "string" && "owner" in w)).toBeTruthy();
});

test("every card's list holds as many leads as its figure, for the window the card chose", async ({ request }) => {
  const s = await part(request, "summary");
  expect(s.lists.within.count).toBe(s.summary.withinTarget);
  expect(s.lists.late.count).toBe(s.summary.answeredLate);
  expect(s.lists.waiting.count).toBe(s.summary.stillWaiting);
  expect(s.lists.onlyAuto.count).toBe(s.autoVsHuman.onlyAutoPastTarget);
  expect(s.lists.within.rows.length).toBe(s.lists.within.shown);
  expect(s.lists.within.rows.every((l: Json) => typeof l.url === "string" && l.url.startsWith("https://"))).toBeTruthy();
  const src = await part(request, "source");
  for (const r of src.rows as Json[]) expect(r.members.count, r.label).toBe(r.leads);
  expect(src.unknown.members.count).toBe(src.unknown.n);
  const who = await part(request, "people");
  for (const p of who.rows as Json[]) expect(p.members.count, p.label).toBe(p.replies);
  const acc = await part(request, "accounts");
  for (const a of (acc.rows as Json[]).filter((x) => x.access !== "needs_permission")) expect(a.members.count, a.name).toBe(a.leads);
});

test("the automatic first message is shown apart from the person's reply", async ({ request }) => {
  const s = await part(request, "summary", 90);
  const a = s.autoVsHuman as Json;
  expect(a.read).toBeGreaterThan(0);
  expect(a.autoSent).toBeGreaterThan(0);
  expect(a.alsoPerson).toBeLessThanOrEqual(a.autoSent);
});

test("a window is checked on the server, and a client only sees its own account", async ({ request }) => {
  const bad = async (q: string) => (await request.get(`/api/app/speed?part=summary&${q}`, { headers: await headers(request) })).status();
  expect(await bad(`from=${ymd(0)}&to=${ymd(5)}`), "backwards").toBe(400);
  expect(await bad("from=2026-02-30&to=2026-03-01"), "not a date").toBe(400);
  expect(await bad(`from=${ymd(400)}&to=${ymd(0)}`), "longer than a year").toBe(400);
  expect(await bad("from=2026-10-01"), "no end").toBe(400);
  expect((await request.get("/api/app/speed?part=nonsense&from=2026-10-01&to=2026-10-02", { headers: await headers(request) })).status()).toBe(400);
  const mine = await part(request, "accounts", 30, "client");
  expect((mine.rows as Json[]).length, "one account at most").toBeLessThanOrEqual(1);
  const lead = await part(request, "summary", 30, "client");
  const own = new Set([...lead.lists.within.rows, ...lead.lists.late.rows, ...lead.lists.waiting.rows].map((l: Json) => l.locationId));
  expect(own.size).toBeLessThanOrEqual(1);
});

test("in the browser: the first lead to chase is at the top, the page says it does not send replies, and a figure opens its list", async ({ page }) => {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("speed-headline")).toBeVisible();
  const measuring = page.getByTestId("measuring");
  await expect(measuring).toContainText("does not send any replies itself");
  await expect(measuring).toContainText("Automatic messages");
  await expect(page.getByTestId("speed-settings-link")).toBeVisible();
  // The list of leads comes before the cards: the first thing under the headline is a lead to chase.
  const list = page.getByTestId("data-list").first();
  const card = page.getByRole("heading", { name: "How fast replies come" });
  await expect(card).toBeVisible();
  const [a, b] = [await list.boundingBox(), await card.boundingBox()];
  expect(a && b && a.y < b.y, "the list is above the first card").toBeTruthy();
  // No raw id, no placeholder, no 13 d 0 h.
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/Team member [A-Za-z0-9]{4}\b|user-[0-9a-f]{4}/);
  expect(body).not.toMatch(/\b\d+ d \d+ h\b/);
  // Every card has its own range.
  for (const label of ["Reply speed", "Where leads come from", "By client account", "Who replies fastest"]) await expect(page.getByRole("group", { name: `Range for ${label}` })).toBeVisible();
  // A figure opens the leads behind it, and the heading's count is the figure.
  const late = page.getByRole("button", { name: /^Answered late: \d+ leads?, open the list$/ });
  const n = Number(/(\d+) lead/.exec((await late.getAttribute("aria-label")) ?? "")?.[1]);
  await late.click();
  await expect(page.getByTestId("drill-count")).toHaveText(String(n));
  await page.getByTestId("drill-back").click();
  await expect(page.getByTestId("drill-panel")).toHaveCount(0);
});

test("in the browser: a card's range is its own and is carried in the address", async ({ page }) => {
  await page.goto("/app#speed");
  await page.reload();
  const range = page.getByRole("group", { name: "Range for Reply speed" });
  await range.getByRole("combobox", { name: "Reply speed: range" }).selectOption("7d");
  await expect(page.getByTestId("card-range-window").first()).toContainText("Last 7 days");
  expect(page.url()).toContain("r.speed-summary=7d");
  // Another card kept its own range.
  expect(page.url()).not.toContain("r.speed-source=7d");
  await page.reload();
  await expect(page.getByTestId("card-range-window").first()).toContainText("Last 7 days");
});
