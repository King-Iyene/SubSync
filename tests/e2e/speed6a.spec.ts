import { expect, test, type Page } from "@playwright/test";

// Speed to lead, sixth pass, part 1 (restyle and clarity), on the demo company at desktop-1440 and phone-390. The demo has no real journey, ready list or waiting ladder, so those answers are
// replaced in the browser (route) with fixed ones: that tests what the screen DOES with them. Nothing is sent and nothing is written (the demo can never write).
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const noSideways = async (page: Page) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { s, w } = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(s, "no sideways scroll").toBeLessThanOrEqual(w + 1);
};
const person = (label: string) => ({ label, state: "named", photoUrl: null, initials: label.slice(0, 2).toUpperCase() });
const lead = (name: string, o: Record<string, unknown> = {}) => ({
  locationId: "L1", locationName: "Acme Roofing", contactId: `c-${name.replace(/\W/g, "")}`, name, url: "https://example.test/c", status: "waiting", neverAnswered: false, minutes: 90, source: "Website form",
  owner: null, unassigned: true, repliedBy: null, autoSeconds: null, detailed: true, phone: "+15555550101", email: null, dnd: false, timeZone: null, suggestion: null, leadAt: Date.now() - 90 * 60_000, ...o,
});
const STEPS = [["arrived", "Arrived", 40], ["touched", "First touch", 30], ["replied", "Replied", 20], ["booked", "Booked", 8], ["showed", "Showed", 5], ["won", "Won", 2]] as const;
const PULSE = {
  now: Date.now(), from: Date.now() - 30 * 86_400_000, to: Date.now(), total: 40, truncated: false,
  leadsByDay: Array.from({ length: 10 }, (_, i) => ({ day: `2026-10-${10 + i}`, n: i })), repliesByDay: Array.from({ length: 10 }, (_, i) => ({ day: `2026-10-${10 + i}`, n: 10 - i })),
  velocity: { days: 3.5, n: 8 },
  people: [
    { key: "u1", name: "Ana Reyes", leads: 3, replied: 2, booked: 1, showed: 1, rate: null, unassigned: false, sample: [lead("Pat One", { owner: person("Ana Reyes"), unassigned: false }), lead("Pat Two", { owner: person("Ana Reyes"), unassigned: false }), lead("Pat Three", { owner: person("Ana Reyes"), unassigned: false })].map((row, i) => ({ row, replied: i < 2, booked: i < 1, showed: i < 1 })) },
    { key: "__none", name: "Unassigned", leads: 2, replied: 0, booked: 0, showed: 0, rate: null, unassigned: true, sample: [lead("Nobody One"), lead("Nobody Two")].map((row) => ({ row, replied: false, booked: false, showed: false })) },
  ],
  ready: [{ ...lead("Rita Ready", { minutes: 3 * 1440 }), dollars: 4200, days: 3, nextStepNone: true }, { ...lead("Quick Quinn", { minutes: 30 }), dollars: 0, days: 0, nextStepNone: false }],
  reasons: [{ key: "no_owner", label: "No owner", n: 2, rows: [lead("Nobody One"), lead("Nobody Two")] }, { key: "unclear", label: "No clear reason", n: 1, rows: [lead("Mystery", { owner: person("Ben"), unassigned: false })] }],
  waitingTotal: 3,
};
const LADDER = { now: Date.now(), ladderReady: true, ladder: { enabled: true, nextAfterMin: 15, managerAfterMin: 45 }, note: "", accounts: [], leads: [{ locationId: "L1", contactId: "c-ruth", name: "Ruth Wait", account: "Acme Roofing", waitedMin: 50, targetMin: 5, step: 2, stepWords: "The next person is told", owner: "Ana", nextPerson: "Ben", toNext: 10 }] };

async function mock(page: Page, puts: Array<{ url: string; body: unknown }> = []) {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("keep-tour")) localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/part=pulse/, (r) => r.fulfill({ json: PULSE }));
  await page.route(/part=journey-list/, (r) => r.fulfill({ json: { count: 2, shown: 2, rows: [lead("Dropped One"), lead("Dropped Two")] } }));
  await page.route(/part=journey(&|$)/, (r) => r.fulfill({ json: { repliedRecorded: true, steps: STEPS.map(([step, label, count], i) => ({ step, label, count, dropped: i ? STEPS[i - 1][2] - count : 0, dropShare: null, medianFromPrev: null })) } }));
  await page.route(/part=ladder/, (r) => r.fulfill({ json: LADDER }));
  await page.route(/\/api\/app\/speed\/ladder/, (r) => { puts.push({ url: r.request().url(), body: r.request().postDataJSON() }); return r.fulfill({ json: { ok: true } }); });
  await page.route(/\/api\/app\/settings$/, (r) => { if (r.request().method() === "PUT") { puts.push({ url: r.request().url(), body: r.request().postDataJSON() }); return r.fulfill({ json: { ok: true } }); } return r.fallback(); });
}
async function open(page: Page) {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
}

test.describe.configure({ mode: "serial" });

test("first visit: a short tour appears once, skip remembers it, and the guide lists each question", async ({ page }) => {
  test.setTimeout(300_000);
  await page.route(/part=pulse/, (r) => r.fulfill({ json: PULSE }));
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("s6-tour")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("s6-tour")).toContainText("Race");
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("s6-tour")).toContainText("Pace");
  await page.getByTestId("tour-skip").click();
  await expect(page.getByTestId("s6-tour")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("s6-tour")).toHaveCount(0);
  await page.getByTestId("s6-guide-open").click();
  await expect(page.getByTestId("s6-guide")).toContainText("Who is slow?");
  await expect(page.getByTestId("s6-guide")).toContainText("Who was not called back?");
  await page.keyboard.press("Escape").catch(() => undefined);
});

test("Pace: the animated journey, drop-off buckets and steps open their people, ready list flags no next step, More shows the rest", async ({ page }) => {
  test.setTimeout(480_000);
  await mock(page);
  await open(page);
  await tab(page, "Pace").click();
  const flow = page.getByTestId("flow-card");
  await expect(flow).toBeVisible();
  await expect(flow).toContainText("Where do my leads go?");
  await expect(page.getByTestId("flow-step")).toHaveCount(6);
  await expect(page.getByTestId("flow-count").first()).toHaveText("40");
  await expect(page.getByTestId("flow-count").nth(5)).toHaveText("2");
  await expect(page.getByTestId("flow-bucket").first()).toContainText("10");
  await page.getByTestId("flow-replay").click();
  await page.getByTestId("flow-step").nth(2).locator("button").click();
  await expect(page.getByTestId("journey-list")).toBeVisible();
  await expect(page.getByTestId("journey-list-count")).toContainText("2 leads");
  await expect(page.getByTestId("journey-rows").getByTestId("speed-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByTestId("flow-bucket").first().click();
  await expect(page.getByTestId("journey-list-count")).toContainText("dropped");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("definitions")).toContainText("Click anything to see the people behind it");
  const ready = page.getByTestId("ready-card");
  await expect(ready).toContainText("Who should I reply to first?");
  await expect(page.getByTestId("ready-row")).toHaveCount(2);
  await expect(page.getByTestId("ready-nonext")).toHaveCount(1);
  await expect(page.getByTestId("ready-days").first()).toContainText("3 days waiting");
  await expect(page.getByTestId("velocity-card")).toBeHidden();
  await page.getByTestId("s6-more").click();
  await expect(page.getByTestId("velocity-value")).toContainText("3.5");
  await expect(page.getByTestId("hist-leads-total")).toHaveText("45");
  // a reason bar opens exactly its people, and each waiting lead carries its delay reason
  await page.getByTestId("reason-bar").first().click();
  await expect(page.getByTestId("pulse-list-count")).toContainText("2 leads waiting");
  await expect(page.getByTestId("pulse-rows").getByTestId("speed-row")).toHaveCount(2);
  await expect(page.getByTestId("pulse-rows").getByTestId("delay-reason").first()).toHaveText("No owner");
  expect(await page.getByTestId("pulse-rows").getByTestId("delay-reason").first().getAttribute("title")).toMatch(/Nobody is assigned/);
  await page.keyboard.press("Escape");
  expect(await page.locator("body").innerText()).not.toMatch(BANNED);
  await noSideways(page);
});

test("People: the person table adds up, an Unassigned row is last, and each number opens its people in the side popup", async ({ page }) => {
  test.setTimeout(480_000);
  await mock(page);
  await open(page);
  await page.getByRole("tab", { name: /^(People|Owners)$/ }).click();
  const rows = page.getByTestId("person-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.last()).toContainText("Unassigned");
  await expect(page.getByTestId("who-slow").or(page.getByTestId("s6-nodata")).first()).toBeVisible();
  await rows.first().getByTestId("person-leads").click();
  await expect(page.getByTestId("pulse-list-count")).toContainText("3 leads");
  await expect(page.getByTestId("pulse-rows").getByTestId("speed-row")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await rows.first().getByTestId("person-booked").click();
  await expect(page.getByTestId("pulse-list-count")).toContainText("1 lead");
  await expect(page.getByTestId("pulse-rows").getByTestId("speed-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await noSideways(page);
});

test("Rules: the stepper, the escalation toggle, the digest preview and a dry-run test, and waiting leads as cards that open the lead panel", async ({ page }) => {
  test.setTimeout(480_000);
  const puts: Array<{ url: string; body: unknown }> = [];
  await mock(page, puts);
  await open(page);
  await tab(page, "Rules").click();
  await expect(page.getByTestId("target-card")).toContainText("How fast must we reply?");
  const before = await page.getByTestId("target-value").innerText();
  const canChange = await page.getByTestId("target-plus").isEnabled();
  if (canChange) {
    await page.getByTestId("target-plus").click();
    expect(await page.getByTestId("target-value").innerText()).not.toBe(before);
    await page.getByTestId("target-save").click();
    await expect.poll(() => puts.some((p) => JSON.stringify(p.body).includes("speedTargetMinutes"))).toBe(true);
  }
  const toggle = page.getByTestId("ladder-enabled");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("ladder-next")).toHaveValue("15");
  if (await toggle.isEnabled()) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await page.getByTestId("ladder-next").fill("20");
    await page.getByTestId("ladder-save").click();
    await expect.poll(() => puts.some((p) => JSON.stringify(p.body).includes('"nextAfterMin":20'))).toBe(true);
  }
  // the summary email card is hidden until it can be edited and delivered
  await expect(page.getByTestId("digest-card")).toHaveCount(0);
  // waiting-now cards open the shared lead panel, never a small popup
  const card = page.getByTestId("ladder-lead");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Step 2 of 3");
  await expect(card).toContainText("Ruth Wait");
  await card.getByTestId("ladder-lead-open").click();
  await expect(page.getByRole("dialog", { name: /Lead: Ruth Wait/ })).toBeVisible();
  await expect(page.getByTestId("ladder-popup")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await card.getByTestId("ladder-reply").click();
  await expect(page.getByRole("dialog", { name: /Lead: Ruth Wait/ })).toBeVisible();
  await page.keyboard.press("Escape");
  // the proof report: compact cards on screen, the printable page is still in the document (hidden until printing)
  await page.getByTestId("s6-more").click();
  await expect(page.getByTestId("proof-cards")).toBeVisible();
  await expect(page.getByTestId("proof-report")).toBeHidden();
  await expect(page.getByTestId("proof-print")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(BANNED);
  await noSideways(page);
});
