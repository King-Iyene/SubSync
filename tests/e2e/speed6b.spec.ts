import { expect, test, type Page } from "@playwright/test";

// Call mode v2 (stage SPEED6) at desktop-1440 and phone-390: the control-room pick screen, the redial plan card, the board, and AUTO OUTCOME SYNC with a mocked call event: the rep calls in the CRM, SubSync
// reads the call it recorded, logs the outcome by itself, moves on with a toast, writes no second note, and only asks (chips) when the result is ambiguous. The browser talks to SubSync's own API, so the
// list, the detected signals and the gateway answers are mocked here; the inference and de-duplication rules are unit tested (src/lib/__tests__/autosync.test.ts).
test.describe.configure({ mode: "serial" });
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i;
const item = (o: Record<string, unknown>) => ({ locationId: "L1", locationName: "Acme Roofing", timeZone: null, openValue: 0, ageHours: 2, priority: 50, reasons: ["Missed call, no callback yet"], url: "https://example.test/contact", dnd: false, phone: "+15550001111", source: "Website form", ...o });
const ITEMS = [item({ contactId: "c-ana", name: "Ana Reyes", openValue: 5000 }), item({ contactId: "c-cy", name: "Cy Park", phone: "+15550002222" })];
const LISTS = [{ id: "missed", label: "Missed calls, no callback", help: "" }, { id: "redial", label: "Redial list", help: "" }, { id: "noshow_recovery", label: "No-show saver", help: "" }];

async function mock(page: Page, posts: { outcomes: Array<Record<string, unknown>>; actions: Array<Record<string, unknown>> }) {
  await page.addInitScript(() => { window.open = () => null; try { localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/\/api\/app\/dial\/queue/, (r) => r.fulfill({ json: { list: "missed", lists: LISTS, total: 2, ownOnly: false, me: "Sam", items: ITEMS } }));
  await page.route(/\/api\/app\/dial\/stats/, (r) => r.fulfill({ json: { people: [], own: false } }));
  await page.route(/\/api\/app\/dial\/script/, (r) => r.fulfill({ json: { script: null, default: "x", canEdit: true } }));
  await page.route(/\/api\/app\/dial\/insights/, (r) => r.fulfill({ json: { now: Date.now(), states: [], best: null, byAttempt: [], board: [{ id: "u1", name: "You", calls: 5, reached: 2, booked: 1, rank: 1, tier: "Orbit", score: 20, fastest: true }, { id: "u2", name: "Una", calls: 9, reached: 1, booked: 0, rank: 2, tier: "Surge", score: 10, fastest: false }], ownRank: { rank: 1, of: 2 }, teamVisible: true, activity: [] } }));
  await page.route(/\/api\/app\/dial\/detect/, (r) => {
    const u = r.request().url();
    const call = u.includes("c-ana") ? { status: "completed", durationSec: 240, at: Date.now() } : { status: "completed", durationSec: 12, at: Date.now() };
    return r.fulfill({ json: { call, tags: [], stageMoved: false, appointment: false, dnd: false, now: Date.now() } });
  });
  await page.route(/\/api\/app\/dial\/outcome/, (r) => { posts.outcomes.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.route(/\/api\/app\/workbench\/context/, (r) => r.fulfill({ json: { mode: { masterOn: false, optedIn: false, live: false, demo: true }, tags: [], deals: [], me: "Sam" } }));
  await page.route(/\/api\/app\/workbench\/preview/, (r) => r.fulfill({ json: { ok: true, mode: { live: false }, plan: { summary: "x", blockers: [], warnings: [], reversible: true, fields: [] } } }));
  await page.route(/\/api\/app\/workbench\/do/, (r) => { posts.actions.push(r.request().postDataJSON().action); return r.fulfill({ json: { ok: true, dryRun: true, message: "Nothing was sent." } }); });
  await page.route(/\/api\/app\/speed\?part=story/, (r) => r.fulfill({ json: { events: [] } }));
}
async function openCall(page: Page) {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: /^Call mode/ }).click();
}

test("pick screen: named as a question, redial and no-show lists, auto-detect switch, redial plan card, board, no vendor words", async ({ page }) => {
  test.setTimeout(480_000);
  await mock(page, { outcomes: [], actions: [] });
  await openCall(page);
  await expect(page.getByRole("heading", { name: "Who do I call next?" })).toBeVisible();
  await expect(page.getByTestId("dial-list-redial")).toContainText("Redial list");
  await expect(page.getByTestId("dial-list-noshow_recovery")).toContainText("No-show saver");
  await expect(page.getByTestId("dial-count")).toContainText("2 people ready to call");
  await expect(page.getByTestId("auto-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("cadence-card")).toContainText("How often do we try again?");
  await expect(page.getByTestId("board-row")).toHaveCount(2);
  await expect(page.getByTestId("board-row").first()).toContainText("Orbit");
  await page.getByTestId("dial-view-callbacks").click();
  await expect(page.getByTestId("callbacks-empty")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(BANNED);
  const { s, w } = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(s).toBeLessThanOrEqual(w + 1);
});

test("auto outcome sync: a detected conversation is logged by itself with a toast, no second note, the next lead appears, a short call asks with a preselected chip, and a change re-logs", async ({ page }) => {
  test.setTimeout(480_000);
  const posts = { outcomes: [] as Array<Record<string, unknown>>, actions: [] as Array<Record<string, unknown>> };
  await mock(page, posts);
  await openCall(page);
  await page.getByTestId("dial-start").click();
  await expect(page.getByTestId("dial-name")).toHaveText("Ana Reyes");
  await expect(page.getByTestId("dial-touch")).toContainText("touch 1 of 4");
  await page.getByTestId("dial-call").click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("dial-toast-text")).toHaveText("Spoke with Ana, 4 min");
  await expect(page.getByTestId("auto-synced")).toBeVisible();
  await expect(page.getByTestId("dial-name")).toHaveText("Cy Park");
  expect(posts.outcomes[0]).toMatchObject({ contactId: "c-ana", outcome: "spoke" });
  expect(posts.actions.filter((a) => a.kind === "note")).toHaveLength(0);
  // ambiguous: a 12 second call asks, with the likely answer preselected
  await page.getByTestId("dial-call").click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("dial-chips")).toBeVisible();
  await expect(page.getByTestId("chip-voicemail")).toHaveAttribute("aria-pressed", "true");
  expect(posts.outcomes).toHaveLength(1);
  await page.getByTestId("chip-voicemail").click();
  await expect(page.getByTestId("dial-summary")).toBeVisible();
  expect(posts.outcomes[1]).toMatchObject({ contactId: "c-cy", outcome: "voicemail" });
  expect(posts.actions.filter((a) => a.kind === "note")).toHaveLength(1);
});

test("auto-detect off: nothing is polled, the outcome buttons are open", async ({ page }) => {
  test.setTimeout(480_000);
  const posts = { outcomes: [] as Array<Record<string, unknown>>, actions: [] as Array<Record<string, unknown>> };
  await mock(page, posts);
  let detects = 0;
  await page.route(/\/api\/app\/dial\/detect/, (r) => { detects++; return r.fulfill({ json: { call: null, tags: [], stageMoved: false, appointment: false, dnd: false, now: Date.now() } }); });
  await openCall(page);
  await page.getByTestId("auto-toggle").click();
  await expect(page.getByTestId("auto-toggle")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("dial-start").click();
  await page.getByTestId("dial-call").click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("dial-outcome-no_answer")).toBeVisible();
  expect(detects).toBe(0);
  await page.keyboard.press("1");
  await expect(page.getByTestId("dial-name")).toHaveText("Cy Park");
});
