import { expect, test, type Page } from "@playwright/test";

// Speed to lead, fifth pass (stage SPEED5), on the demo company at desktop-1440 and phone-390. The demo has no real duplicates or bookings, so the race answer is patched in the browser
// (route) to carry a duplicate, a repeat enquirer and a money meter: that tests what the screen DOES with them. Nothing is sent and nothing is written (the demo can never write).
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const noSideways = async (page: Page) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { s, w } = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(s, "no sideways scroll").toBeLessThanOrEqual(w + 1);
};
// The demo may have no new leads today: then one is added to the answer in the browser so the Race tests always run (nothing is written; the demo can never write).
function seedLead(body: { feed?: Array<Record<string, unknown>>; now?: number; targetMinutes?: number }) {
  if (!Array.isArray(body.feed)) body.feed = [];
  if (body.feed.length === 0) {
    const now = body.now ?? Date.now();
    body.feed.push({
      locationId: "seed-loc", locationName: "Seed Plumbing", contactId: "seed-1", name: "Sam Seeded", url: "https://example.test/seed-1",
      status: "waiting", neverAnswered: true, minutes: 3, source: "Website form", owner: null, unassigned: false, repliedBy: null, autoSeconds: null, detailed: true,
      phone: "+15555550101", email: "sam@example.test", dnd: false, timeZone: null, suggestion: null,
      arrivedAt: now - 3 * 60_000, touchedAt: null, targetMinutes: body.targetMinutes ?? 5, quality: 1, dollars: 0,
    });
  }
}
async function open(page: Page, path = "/app#speed") {
  await page.goto(path);
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 90_000 });
}

test("Race: the money meter opens its popup, a duplicate and a repeat enquirer are marked, and the reply panel says to reply to the older record", async ({ page }) => {
  test.setTimeout(480_000);
  let patched = false;
  await page.route("**/api/app/speed?part=race*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    seedLead(body);
    if (Array.isArray(body.feed) && body.feed.length > 0) {
      body.feed[0].duplicateOf = { contactId: "older-1", name: "Ann Older", score: 92, tier: "sure", reasons: ["same email", "same phone"], url: "https://example.test/older-1" };
      body.feed[0].repeat = true; body.feed[0].touchedAt = null;
      patched = true;
    }
    body.risk = { counted: 1200, estimate: 800, waiting: 2, bookingGapKnown: true, multiple: 3.1, estimateNote: null };
    await route.fulfill({ response: res, json: body });
  });
  await open(page);
  await expect(page.getByTestId("money-meter")).toBeVisible();
  await expect(page.getByTestId("meter-counted")).toContainText("$1,200");
  await page.getByTestId("money-meter").getByRole("button").first().click();
  await expect(page.getByTestId("meter-popup")).toContainText("estimate");
  await page.getByTestId("speed-popup-close").click();
  if (!patched) { test.skip(true, "no new leads on this demo"); return; }
  await expect(page.getByTestId("dup-chip").first()).toContainText("Possible duplicate of Ann Older");
  await expect(page.getByTestId("repeat-chip").first()).toBeVisible();
  await page.getByTestId("dup-chip").first().click();
  await expect(page.getByTestId("dup-popup")).toContainText("Reply to the older record");
  await expect(page.getByTestId("dup-cleanup")).toHaveAttribute("href", "#cleanup");
  await expect(page.getByTestId("dup-open-older")).toHaveAttribute("href", "https://example.test/older-1");
  await page.getByTestId("speed-popup-close").click();
  await page.getByTestId("race-row").first().getByRole("button").first().click();
  await expect(page.getByTestId("lead-drawer")).toContainText(/Possible duplicate of Ann Older: reply to the older record/, { timeout: 60_000 });
  expect(await page.locator("main").innerText()).not.toMatch(BANNED);
  await noSideways(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Race: a lead nobody owns offers the next person in line, as a preview first (dry run)", async ({ page }) => {
  test.setTimeout(480_000);
  await page.route("**/api/app/speed?part=race*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    seedLead(body);
    if (Array.isArray(body.feed) && body.feed.length > 0) Object.assign(body.feed[0], { unassigned: true, owner: null, touchedAt: null, roundRobin: { userId: "u-next", label: "Next Person" } });
    await route.fulfill({ response: res, json: body });
  });
  await open(page);
  const rr = page.getByTestId("race-assign-rr").first();
  if (!(await rr.count())) { test.skip(true, "no new leads on this demo"); return; }
  await expect(rr).toContainText("Next in line: Next Person");
  await rr.click();
  await expect(page.getByTestId("wb-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("wb-review-dry").or(page.getByTestId("wb-review-blockers")).first()).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Pace: the booking chart says what it knows, and a bar opens its popup", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page);
  await tab(page, "Pace").click();
  await expect(page.getByTestId("booking-card")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("booking-line")).toHaveText(/booked|Not enough leads yet|cannot be compared/);
  expect(await page.getByTestId("booking-bars").getByRole("button").count()).toBe(6);
  await page.getByTestId("booking-m5").click();
  await expect(page.getByTestId("booking-popup")).toContainText("Within 5 min");
  await page.getByTestId("speed-popup-close").click();
  expect(await page.getByTestId("booking-card").innerText()).not.toMatch(BANNED);
  await noSideways(page);
});

test("Rules: the ladder form and its dry-run preview are there for a manager and edit locally; the proof report is printable and carries no product name", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page);
  await tab(page, "Rules").click();
  await expect(page.getByTestId("ladder-card")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("ladder-next")).toBeEnabled();
  await page.getByTestId("ladder-next").fill("20");
  await expect(page.getByTestId("ladder-next")).toHaveValue("20");
  await expect(page.getByTestId("ladder-accounts").or(page.getByTestId("ladder-empty")).first()).toBeVisible();
  const lead = page.getByTestId("ladder-lead").first();
  if (await lead.count()) { await lead.click(); await expect(page.getByTestId("ladder-popup")).toContainText("The owner is told"); await page.getByTestId("speed-popup-close").click(); }
  await expect(page.getByTestId("proof-report")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("proof-print")).toBeVisible();
  const proof = await page.getByTestId("proof-report").innerText();
  expect(proof).not.toMatch(/subsync|gohighlevel|highlevel/i);
  expect(proof).toContain("Our response speed");
  expect(await page.getByTestId("ladder-card").innerText()).not.toMatch(BANNED);
  await noSideways(page);
});

test("a client's staff get no ladder (it names people), and the answer for it is refused on the server", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page, "/app?as=client#speed");
  await tab(page, "Rules").click();
  await expect(page.getByTestId("rules-tab")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("ladder-card")).toHaveCount(0);
  const status = await page.evaluate(async () => (await fetch("/api/app/speed?part=ladder", { credentials: "include" })).status);
  expect([401, 403]).toContain(status);
});
