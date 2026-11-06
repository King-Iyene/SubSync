import { expect, test, type Page } from "@playwright/test";

// Call mode (stage DIAL) at desktop-1440 and phone-390: pick a list, start, the card for the first person, an outcome by keyboard (a dry-run note, nothing written), auto-advance past a
// person who asked not to be contacted, "call back later" with a time (a task), the session summary, big touch targets, and no sideways scroll. The browser talks to SubSync's own API, so the
// list, the lead's context and the gateway answers are mocked here; the server rules (ranking, DND, own-queue, the stats) are unit tested.
test.describe.configure({ mode: "serial" });

const item = (o: Record<string, unknown>) => ({ locationId: "L1", locationName: "Acme Roofing", timeZone: null, openValue: 0, ageHours: 2, priority: 50, reasons: ["Missed call, no callback yet"], url: "https://example.test/contact", dnd: false, phone: "+15550001111", ...o });
const ITEMS = [item({ contactId: "c-ana", name: "Ana Reyes", openValue: 5000 }), item({ contactId: "c-ben", name: "Ben Ito", dnd: true }), item({ contactId: "c-cy", name: "Cy Park", phone: "+15550002222" })];

async function mock(page: Page, posts: { outcomes: Array<Record<string, unknown>>; actions: Array<Record<string, unknown>> }) {
  await page.route(/\/api\/app\/dial\/queue/, (r) => r.fulfill({ json: { list: "missed", lists: [{ id: "missed", label: "Missed calls, no callback", help: "" }, { id: "new_unanswered", label: "New leads not yet reached", help: "" }], total: 3, ownOnly: false, me: "Test Agent", items: ITEMS } }));
  await page.route(/\/api\/app\/dial\/stats/, (r) => r.fulfill({ json: { people: [{ userId: "u1", name: "You", calls: 4, perHour: 8, outcomes: { spoke: 2, no_answer: 2 } }], own: false } }));
  await page.route(/\/api\/app\/dial\/script/, (r) => r.fulfill({ json: { script: null, default: "x", canEdit: true } }));
  await page.route(/\/api\/app\/dial\/outcome/, (r) => { posts.outcomes.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.route(/\/api\/app\/workbench\/context/, (r) => r.fulfill({ json: { mode: { masterOn: false, optedIn: false, live: false, demo: true }, tags: ["new-lead", "roof"], deals: [{ id: "d1", name: "Roof repair", stageName: "Quoted", value: 5000, status: "open" }], me: "Test Agent" } }));
  await page.route(/\/api\/app\/workbench\/preview/, (r) => r.fulfill({ json: { ok: true, mode: { live: false }, plan: { summary: "x", blockers: [], warnings: [], reversible: true, fields: [] } } }));
  await page.route(/\/api\/app\/workbench\/do/, (r) => { posts.actions.push(r.request().postDataJSON().action); return r.fulfill({ json: { ok: true, dryRun: true, message: "Nothing was sent." } }); });
  await page.route(/\/api\/app\/speed\?part=story/, (r) => r.fulfill({ json: { events: [{ at: Date.now() - 86_400_000, kind: "call", text: "Missed call" }] } }));
}

test("call mode: list, start, keyboard outcome, skip past do-not-contact, call back later, summary", async ({ page }) => {
  test.setTimeout(300_000);
  const posts = { outcomes: [] as Array<Record<string, unknown>>, actions: [] as Array<Record<string, unknown>> };
  await mock(page, posts);
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: /^Call mode/ }).click();

  await expect(page.getByTestId("dial-count")).toContainText("2 people ready to call");
  await expect(page.getByTestId("dial-stats")).toContainText("8 an hour");
  await page.getByTestId("dial-how").click();
  await expect(page.getByText("SubSync costs nothing extra for calling").first()).toBeVisible();
  await page.getByTestId("dial-start").click();

  await expect(page.getByTestId("dial-progress-text")).toHaveText("1 of 3");
  await expect(page.getByTestId("dial-name")).toHaveText("Ana Reyes");
  await expect(page.getByTestId("dial-phone")).toContainText("555");
  await expect(page.getByTestId("dial-story")).toContainText("Roof repair");
  await expect(page.getByTestId("dial-script-text")).toContainText("Hi Ana");
  const call = page.getByTestId("dial-call");
  await expect(call).toContainText("Call in your CRM");
  expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const o of ["no_answer", "spoke", "call_back"]) expect((await page.getByTestId(`dial-outcome-${o}`).boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // 1 = no answer, by keyboard. The do-not-contact person is skipped, so the next card is Cy.
  await page.keyboard.press("1");
  await expect(page.getByTestId("dial-name")).toHaveText("Cy Park");
  await expect(page.getByTestId("dial-status")).toContainText("Dry run");
  expect(posts.outcomes[0]).toMatchObject({ contactId: "c-ana", outcome: "no_answer" });
  expect(posts.actions[0]).toMatchObject({ kind: "note" });
  expect(posts.actions[0].text).toMatch(/no answer/);

  await page.getByTestId("dial-outcome-call_back").click();
  await expect(page.getByTestId("dial-callback")).toBeVisible();
  await page.getByTestId("dial-callback-save").click();
  await expect(page.getByTestId("dial-summary")).toBeVisible();
  expect(posts.outcomes[1]).toMatchObject({ contactId: "c-cy", outcome: "call_back" });
  expect(posts.outcomes[1].callbackAt).toBeTruthy();
  expect(posts.actions.at(-1)).toMatchObject({ kind: "task", title: "Call Cy Park back" });

  await expect(page.getByTestId("sum-calls")).toHaveText("2");
  await expect(page.getByTestId("sum-reached")).toHaveText("1");
  await expect(page.getByTestId("sum-skipped")).toContainText("1 skipped");
  expect(await page.locator("main").innerText()).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { s, w } = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(s, "no sideways scroll").toBeLessThanOrEqual(w + 1);
  await page.getByTestId("dial-done").click();
  await expect(page.getByTestId("dial-pick")).toBeVisible();
});
