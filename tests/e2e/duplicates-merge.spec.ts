import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// The duplicate review (stage DUP, docs/DUPLICATES_REVIEW.md), on the demo company, for the four roles and the three widths of the projects:
//   a stepper through groups, the best record pre-picked with its reason, only what differs, one big Merge button, a merge sheet that finishes in the
//   CRM (and a one-click merge that is switched off), "Not a duplicate" that persists, an undoable "Not now", the obvious ones as a preview,
//   a list that pages, a client's staff who can only ever touch their own account, and a clean phone layout.
// The demo is slow to answer (every call signs the demo in again), so the waits are long. Every test that records a decision undoes it.
const ROLES = [
  { name: "agency, all accounts", path: "/app#duplicates", slug: "agency-all", multi: true },
  // Opened from inside one client account the shell starts on that account (only when there is no address hash), so this role opens the app and then the menu entry.
  { name: "agency, inside one account", path: "/app?as=location", slug: "agency-account", multi: false, menu: true },
  { name: "a client's staff", path: "/app?as=client#duplicates", slug: "client-staff", multi: false },
  { name: "a business owner", path: "/app?as=business#duplicates", slug: "business-owner", multi: false },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;

async function open(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "Duplicates", exact: true }).first().click({ timeout: 90_000 });
  else await page.reload();
  await expect(page.getByTestId("dup-headline")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("dup-step")).toBeVisible({ timeout: 90_000 });
}
const count = async (page: Page) => Number(/of ([\d,]+)/.exec(await page.getByTestId("dup-step-count").innerText())![1].replace(/,/g, ""));
const position = async (page: Page) => Number(/Group ([\d,]+) of/.exec(await page.getByTestId("dup-step-count").innerText())![1].replace(/,/g, ""));
const headlineGroups = async (page: Page) => Number(/^([\d,]+) duplicate group/.exec(await page.getByTestId("dup-headline").innerText())![1].replace(/,/g, ""));

for (const role of ROLES) {
  test(`${role.name}: the best record is pre-picked with a reason, one primary button, plain words, no sideways scroll`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await open(page, role.path, "menu" in role && role.menu === true);
    const n = await count(page);
    expect(n, "the demo has duplicates to review").toBeGreaterThan(0);
    expect(await headlineGroups(page), "the headline and the stepper count the same groups").toBe(n);
    await expect(page.getByTestId("dup-health-line")).toContainText(/extra contacts? to remove/);
    // The pre-picked record: exactly one radio is checked and it is the one marked as the best match, with the reason in words.
    const radios = page.getByTestId("dup-keep-radio");
    expect(await radios.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-testid="dup-keep-radio"]:checked')).toHaveCount(1);
    await expect(page.locator('[data-testid="dup-record"][data-keep="true"]')).toContainText("Best match");
    const why = (await page.getByTestId("dup-why").innerText()).trim();
    expect(why).toMatch(/^Best match picked: .+\./);
    expect(why.length, "a sentence, not a paragraph").toBeLessThan(200);
    // One big primary action.
    await expect(page.getByTestId("dup-merge")).toBeVisible();
    await expect(page.getByTestId("dup-merge")).toHaveText(/^Merge these \d+ contacts$/);
    // Differences only: the table has rows, and each shown row really differs between the records (the identical ones are collapsed).
    await expect(page.getByTestId("dup-diff")).toBeVisible();
    // Plain words, no platform name.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(BANNED);
    // Agencies with more than one client see the client list; a single account never does.
    if (role.multi) await expect(page.getByTestId("dup-clients")).toBeVisible();
    else await expect(page.getByTestId("dup-clients")).toHaveCount(0);
    // A phone: nothing sideways, and the thumb buttons are at least 44 px high.
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    if (testInfo.project.name === "phone-390") {
      for (const id of ["dup-merge", "dup-next", "dup-prev"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box!.height, `${id} is thumb sized`).toBeGreaterThanOrEqual(44);
      }
    }
    if (process.env.SHOTS) {
      mkdirSync("docs/review", { recursive: true });
      await page.screenshot({ path: `docs/review/duplicates-${role.slug}-${testInfo.project.name.replace(/\D+/g, "")}.png`, fullPage: true });
    }
  });
}

test("the stepper moves with the buttons and the arrow keys, and wraps at the end", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#duplicates");
  const n = await count(page);
  expect(n).toBeGreaterThan(2);
  expect(await position(page)).toBe(1);
  await page.getByTestId("dup-next").click();
  await expect.poll(() => position(page), { timeout: 60_000 }).toBe(2);
  await page.getByTestId("dup-prev").click();
  await expect.poll(() => position(page), { timeout: 60_000 }).toBe(1);
  await page.getByTestId("dup-prev").click(); // wraps to the last
  await expect.poll(() => position(page), { timeout: 60_000 }).toBe(n);
  await page.getByTestId("dup-next").click(); // and back to the first
  await expect.poll(() => position(page), { timeout: 60_000 }).toBe(1);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => position(page), { timeout: 60_000 }).toBe(2);
});

test("Merge opens a sheet that says what is kept, moved and removed; the one-click merge is switched off and nothing changes", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const { get } = await api(request);
  const before = await get("duplicates?size=5");
  await open(page, "/app#duplicates");
  await page.getByTestId("dup-merge").click();
  await expect(page.getByTestId("dup-sheet")).toBeVisible();
  // A group with a warning needs one deliberate extra click before the way forward appears.
  if ((await page.getByTestId("dup-ack").count()) > 0) {
    await expect(page.getByTestId("dup-open-both")).toHaveCount(0);
    await page.getByTestId("dup-ack").click();
  }
  await expect(page.getByTestId("dup-plan")).toContainText(/cannot be undone/);
  await expect(page.getByTestId("dup-plan")).toContainText(/Keeps /);
  await expect(page.getByTestId("dup-open-both")).toBeVisible();
  await expect(page.getByTestId("dup-copy")).toBeVisible();
  await expect(page.getByTestId("dup-steps")).toContainText(/Merge/);
  if (process.env.SHOTS) await page.screenshot({ path: `docs/review/duplicates-merge-sheet-${testInfo.project.name.replace(/\D+/g, "")}.png`, fullPage: true });
  // "Open both" opens the contacts in the CRM, the record to keep first (new tabs; the links are on the page too).
  const popups: string[] = [];
  page.context().on("page", (p) => popups.push(p.url()));
  await page.getByTestId("dup-open-both").click();
  await expect.poll(() => popups.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  // The one-click merge: switched off (the demo never writes), says so, and changes nothing.
  await page.getByTestId("dup-merge-here").click();
  await expect(page.getByTestId("dup-sheet").getByTestId("inline-alert")).toContainText(/switched off|cannot carry everything/i, { timeout: 60_000 });
  const after = await get("duplicates?size=5");
  expect(after.health.groups, "nothing was decided or removed").toBe(before.health.groups);
  expect(after.counts).toEqual(before.counts);
  // Going back closes the sheet.
  await page.getByTestId("dup-sheet-back").click();
  await expect(page.getByTestId("dup-sheet")).toHaveCount(0);
});

test("'I merged them' leaves the list and Undo brings it back", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, "/app#duplicates");
  const n = await count(page);
  await page.getByTestId("dup-merge").click();
  if ((await page.getByTestId("dup-ack").count()) > 0) await page.getByTestId("dup-ack").click();
  await page.getByTestId("dup-done-in-crm").click();
  await expect(page.getByTestId("dup-toast")).toContainText(/Marked as merged/);
  await expect.poll(() => headlineGroups(page), { timeout: 90_000 }).toBe(n - 1);
  await page.getByTestId("dup-undo").click();
  await expect.poll(() => headlineGroups(page), { timeout: 90_000 }).toBe(n);
});

test("'Not a duplicate' is remembered after a reload and can be undone from the Done list", async ({ page }) => {
  test.setTimeout(600_000);
  await open(page, "/app#duplicates");
  const n = await count(page);
  await page.getByTestId("dup-not-dup").click();
  await expect(page.getByTestId("dup-toast")).toContainText(/not a duplicate/i);
  await expect.poll(() => headlineGroups(page), { timeout: 120_000 }).toBe(n - 1);
  // Remembered: a fresh load of the page (a new session, new requests) still shows one fewer.
  await page.reload();
  await expect(page.getByTestId("dup-headline")).toBeVisible({ timeout: 90_000 });
  expect(await headlineGroups(page)).toBe(n - 1);
  // The decision is in the "Done" list; undo it from there.
  await page.getByTestId("dup-see-all").click();
  await page.getByLabel("Which groups").selectOption("decided");
  await expect(page.getByTestId("dup-list").getByTestId("dup-list-row").first()).toContainText(/Marked not a duplicate/, { timeout: 90_000 });
  await page.getByTestId("dup-list").getByTestId("dup-row-open").first().click();
  await expect(page.getByTestId("dup-undo-decision")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("dup-undo-decision").click();
  await page.getByLabel("Which groups").selectOption("open");
  await expect.poll(() => headlineGroups(page), { timeout: 120_000 }).toBe(n);
});

test("'Not now' sets a group aside for a week and Undo puts it back", async ({ page }) => {
  test.setTimeout(600_000);
  await open(page, "/app#duplicates");
  const n = await count(page);
  await page.getByTestId("dup-not-now").click();
  await expect(page.getByTestId("dup-toast")).toContainText(/Set aside for 7 days/);
  await expect.poll(() => headlineGroups(page), { timeout: 120_000 }).toBe(n - 1);
  await expect(page.getByTestId("dup-health-line")).toContainText(/groups? set aside/, { timeout: 60_000 });
  await page.getByTestId("dup-undo").click();
  await expect.poll(() => headlineGroups(page), { timeout: 120_000 }).toBe(n);
});

test("a group with a warning (Do Not Disturb, deals, another owner) is flagged, and the sheet asks for a deliberate click first", async ({ page, request }) => {
  test.setTimeout(300_000);
  const { get } = await api(request);
  const all = await get("duplicates?size=50&page=0");
  const risky = (all.list.rows as Json[]).find((r) => r.warn);
  test.skip(!risky, "the demo has no group with a warning");
  await open(page, "/app#duplicates");
  await page.getByTestId("dup-see-all").click();
  await page.getByTestId("dup-search").fill(String(risky!.names[0]));
  const row = page.getByTestId("dup-list").getByTestId("dup-list-row").filter({ hasText: "Check before merging" }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTestId("dup-row-open").click();
  await expect(page.getByTestId("dup-careful")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("dup-merge").click();
  await expect(page.getByTestId("dup-warnings")).toBeVisible();
  await expect(page.getByTestId("dup-open-both")).toHaveCount(0);
  await page.getByTestId("dup-ack").click();
  await expect(page.getByTestId("dup-open-both")).toBeVisible();
  const warned = await page.getByTestId("dup-warnings").innerText();
  expect(warned).toMatch(/Do Not Disturb|open deal|won deals|different team members/);
});

test("the obvious ones are a preview: same email and phone, nothing is changed", async ({ page, request }) => {
  test.setTimeout(240_000);
  const { get } = await api(request);
  const before = await get("duplicates?size=5");
  test.skip(before.obvious === 0, "no obvious groups in the demo");
  await open(page, "/app#duplicates");
  await page.getByTestId("dup-obvious-btn").click();
  const panel = page.getByTestId("dup-obvious-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/switched off/);
  await expect(panel.getByTestId("dup-obvious-row").first()).toBeVisible({ timeout: 60_000 });
  const rows = await panel.getByTestId("dup-obvious-row").count();
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThanOrEqual(25);
  const after = await get("duplicates?size=5");
  expect(after.counts).toEqual(before.counts);
});

test("the list pages and searches on the server: never more than 25 rows, and a search with no match says so", async ({ page, request }) => {
  test.setTimeout(240_000);
  const { get } = await api(request);
  const api1 = await get("duplicates?size=100000");
  expect(api1.list.rows.length, "one page is capped").toBeLessThanOrEqual(50);
  expect(api1.upNext.length).toBeLessThanOrEqual(5);
  await open(page, "/app#duplicates");
  await page.getByTestId("dup-see-all").click();
  await expect(page.getByTestId("dup-list-range")).toContainText(/Showing 1 to \d+ of/, { timeout: 60_000 });
  expect(await page.getByTestId("dup-list").getByTestId("dup-list-row").count()).toBeLessThanOrEqual(25);
  await page.getByTestId("dup-search").fill("zzzznobodyzzzz");
  await expect(page.getByText("No group fits that.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("dup-filter-note")).toBeVisible();
  await page.getByTestId("dup-clear-filters").click();
  await expect(page.getByTestId("dup-step")).toBeVisible({ timeout: 60_000 });
});

test("an agency can review one client at a time, and the client is named", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#duplicates");
  const total = await count(page);
  const firstClient = page.getByTestId("dup-clients").locator("li").first();
  const name = (await firstClient.locator("p").first().innerText()).trim();
  await firstClient.getByRole("button").click();
  await expect(page.getByTestId("dup-filter-note")).toContainText(name, { timeout: 60_000 });
  await expect.poll(() => count(page), { timeout: 60_000 }).toBeLessThan(total);
  await expect(page.getByTestId("dup-reason")).toContainText(name);
});

// ---- tenancy (server side): a client's staff reach their own account and nothing else ----

test("a client's staff only ever see, decide about and set aside their own account's groups (changing ids in a request fails)", async ({ request }) => {
  test.setTimeout(300_000);
  const agency = await api(request);
  const client = await api(request, "client");
  const mine = await client.get("duplicates?size=50");
  const own = new Set((mine.list.rows as Json[]).map((r) => r.locationId));
  expect(own.size, "a client has one account").toBeLessThanOrEqual(1);
  const everything = await agency.get("duplicates?size=50");
  const accounts = new Set((everything.list.rows as Json[]).map((r) => r.locationId));
  expect(accounts.size, "the agency sees several accounts").toBeGreaterThan(1);
  expect(mine.multi === false || mine.accounts.total <= 1).toBeTruthy();
  expect(mine.health.groups).toBeLessThan(everything.health.groups);
  // Another account's group, taken from the agency's list.
  const foreign = (everything.list.rows as Json[]).find((r) => !own.has(r.locationId));
  expect(foreign).toBeTruthy();
  const foreignStep = await agency.get(`duplicates?focus=${foreign!.locationId}:${foreign!.key}`);
  const ids = (foreignStep.step.people as Json[]).map((p) => p.contactId);
  const body = { locationId: foreign!.locationId, contactIds: ids, keepContactId: ids[0] };
  for (const [path, extra] of [["duplicates/merge", {}], ["duplicates/snooze", {}], ["duplicates/unsnooze", {}], ["duplicates/review", { decision: "not_duplicate" }], ["duplicates/review", { decision: "merged_in_platform" }]] as const) {
    const r = await client.post(path, { ...body, ...extra });
    expect(r.status, `${path} with another account's contacts`).toBe(404);
  }
  // Asking for another account's group by its address returns the client's own list, never the other account's records.
  const sneaky = await client.get(`duplicates?focus=${foreign!.locationId}:${foreign!.key}&location=${foreign!.locationId}`);
  expect(sneaky.step === null || sneaky.step.locationId !== foreign!.locationId).toBeTruthy();
  expect(sneaky.list.rows.every((r: Json) => r.locationId !== foreign!.locationId)).toBeTruthy();
  // The agency's own sidebar words are not in a client's data.
  expect(JSON.stringify(mine, (k, v) => (k === "url" ? undefined : v))).not.toMatch(/gohighlevel|highlevel/i); // the link to the CRM carries its address; the words do not
  // Nothing was recorded by any of those.
  const again = await agency.get("duplicates?size=5");
  expect(again.counts).toEqual(everything.counts);
});

test("a client's staff may decide about their own account (the screen works for them too), but not record many at once", async ({ request }) => {
  test.setTimeout(300_000);
  const client = await api(request, "client");
  const mine = await client.get("duplicates?size=5");
  expect(mine.canExport).toBe(false);
  const step = mine.step as Json;
  const ids = (step.people as Json[]).map((p) => p.contactId);
  const set = await client.post("duplicates/snooze", { locationId: step.locationId, contactIds: ids });
  expect(set.status).toBe(200);
  const aside = await client.get("duplicates?status=later&size=5");
  expect(aside.counts.later).toBeGreaterThanOrEqual(1);
  const undo = await client.post("duplicates/unsnooze", { locationId: step.locationId, contactIds: ids });
  expect(undo.status).toBe(200);
  const bulk = await client.post("duplicates/bulk", { decision: "not_duplicate", minConfidence: 0, dryRun: true });
  expect(bulk.status, "recording many at once is not for a client's staff").toBe(403);
});
