import { expect, test, type APIRequestContext } from "@playwright/test";

// F5: Today is the front door. In five seconds, in plain words: leads waiting, appointments to fix, accounts needing attention. WRITTEN in the parallel
// stage (branch stage/F5) and NOT RUN there: the lead runs it after the merge, on the demo company, at the three widths (390, 768, 1440).
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(request: APIRequestContext, as?: "business" | "client") {
  const s = await request.post("/api/sso", { data: { demo: true, ...(as ? { as } : {}) } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  return {
    get: async (path: string): Promise<Json> => {
      const res = await request.get(`/api/app/${path}`, { headers });
      expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
      return (await res.json()) as Json;
    },
    status: async (path: string): Promise<number> => (await request.get(`/api/app/${path}`, { headers })).status(),
    put: async (path: string, data: unknown): Promise<number> => (await request.put(`/api/app/${path}`, { headers, data })).status(),
  };
}

test("the first thing on Today is the leads-waiting sentence, in the first screen, within five seconds, with the button under it", async ({ page, request }, testInfo) => {
  const { get } = await api(request);
  const speed = await get("speed");
  const waiting = Math.max(0, speed.overall.stillWaiting - (speed.neverAnswered ?? 0));
  const never = speed.neverAnswered ?? 0;
  await page.goto("/app");
  const headline = page.getByTestId("leads-headline");
  await expect(headline).toBeVisible({ timeout: 5000 });
  await expect(headline, "the headline is on the first screen, not below the fold").toBeInViewport();
  if (waiting > 0) await expect(headline).toHaveText(new RegExp(`^${waiting} leads? (is|are) waiting for a reply`));
  else await expect(headline).toContainText(never > 0 ? "never answered" : "No leads are waiting");
  if (never > 0) await expect(headline).toContainText(`${never} ${never === 1 ? "was" : "were"} never answered`);
  // The one thing to do first is a button, on the first screen too, when there is something to do.
  if (waiting + never > 0) {
    const first = page.getByTestId("do-first");
    await expect(first.getByRole("button", { name: "Open Speed to lead" })).toBeInViewport();
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `docs/review/f5-today-${testInfo.project.name}.png`, fullPage: true });
});

test("the five-second test: the page says what it is for, and what to do next, before anything is pressed", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByTestId("page-subtitle")).toContainText("checked for leads waiting, missed appointments and stalled deals. Start at the top.");
  await expect(page.getByTestId("front-door")).toContainText("What needs you right now");
  // One status line, drawn by the shell, and nothing on Today words the age of the data a second time.
  await expect(page.getByTestId("front-door")).not.toContainText(/updated|synced|last read/i);
});

test("the lines are the same numbers their own pages show", async ({ page, request }) => {
  const { get } = await api(request);
  const [daily, appts] = await Promise.all([get("daily"), get("appointments")]);
  await page.goto("/app");
  const door = page.getByTestId("front-door");
  await expect(door).toBeVisible();
  const unmarked = appts.unmarkedTotal as number;
  if (unmarked > 0) await expect(door).toContainText(new RegExp(`${unmarked} past appointments? (has|have) no outcome recorded`));
  else await expect(door).toContainText("Every past appointment has an outcome recorded");
  const attention = daily.attention.length as number;
  if (attention > 0) await expect(door).toContainText(new RegExp(`${attention} client accounts? needs? attention today`));
  else await expect(door).toContainText("No client account needs you today");
  // The count on the list below is the count in the sentence.
  if (attention > 0) await expect(page.getByTestId("attention-list").locator(":scope > li")).toHaveCount(attention);
});

test("the sync banner is only for a first sync, and the filter sits in a drawer that explains itself", async ({ page, request }) => {
  // The "Hide test accounts" help only exists while a test-named account is counted. The demo leaves its test account out on purpose, so bring it back
  // for this test and put it back afterwards.
  const c = await api(request);
  const test_ = ((await c.get("settings")).testAccounts as Array<{ locationId: string; ignored: boolean }>).find((a) => a.ignored);
  if (test_) expect(await c.put(`accounts/${test_.locationId}/flags`, { ignored: false })).toBe(200);
  try {
  await page.goto("/app");
  await expect(page.getByTestId("front-door")).toBeVisible();
  await expect(page.getByText("First sync in progress")).toHaveCount(0);
  const drawer = page.getByTestId("filter-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Show only")).toBeHidden(); // closed until it is opened
  await drawer.getByText("Filter accounts").click();
  await expect(drawer.getByText("Show only")).toBeVisible();
  // N1: where the kind of business comes from, what the number in brackets counts, what a test account is.
  const help = drawer.getByTestId("filter-help");
  await expect(help).toContainText("the industry you typed for each client");
  await expect(help).toContainText("The number in brackets is how many client accounts have that kind");
  await expect(help).toContainText("contains test, demo, sample, sandbox or dummy");
  } finally {
    if (test_) await c.put(`accounts/${test_.locationId}/flags`, { ignored: true });
  }
});

test("what a filter hides is named, with the way to bring it back", async ({ page, request }) => {
  const { get } = await api(request);
  const seg = await get("segments");
  const test_ = (seg.accounts as Json[]).filter((a) => a.test && !a.ignored);
  await page.goto("/app#today?hideTest=1");
  await expect(page.getByTestId("front-door")).toBeVisible();
  const summary = page.getByTestId("filter-hidden-summary");
  if (test_.length > 0) {
    await expect(summary).toContainText(`${test_.length} test ${test_.length === 1 ? "account is" : "accounts are"} hidden because ${test_.length === 1 ? "its" : "their"} name says test: `);
    await expect(summary).toContainText(test_[0].name as string);
    await summary.getByRole("button", { name: "Show them" }).click();
    await expect(summary).toHaveCount(0);
  } else {
    await expect(summary).toHaveCount(0);
  }
});

test("Today for one client account: opened from the all-accounts list, it narrows to that account and the way back returns", async ({ page, request }) => {
  const { get } = await api(request);
  const daily = await get("daily");
  const first = (daily.attention as Json[])[0] ?? (daily.fine as Json[])[0];
  expect(first, "the demo company has at least one client account").toBeTruthy();
  await page.goto("/app");
  await expect(page.getByTestId("front-door")).toBeVisible();
  // From the attention list when it has the account, else from the "Fine today" list: either opens that one account's Today.
  const inAttention = (daily.attention as Json[]).length > 0;
  if (inAttention) await page.getByTestId("attention-list").getByRole("button", { name: /Open this account.s Today/ }).first().click();
  else await page.getByTestId("data-list").getByRole("button", { name: first.name as string }).first().click();
  await expect(page.getByTestId("page-subtitle")).toContainText("leads waiting, appointments to fix and deals that stopped moving");
  await expect(page.getByTestId("account-scope-summary")).toContainText("1 of");
  const back = page.getByTestId("back-link");
  await expect(back).toContainText("Back to Today");
  await back.click();
  await expect(page.getByTestId("page-subtitle")).toContainText("Every client account");
});

test("opened from inside a client account, SubSync starts on Today for that account with a plain notice and a way to all of them", async ({ page, request }) => {
  const { get } = await api(request);
  const accounts = await get("accounts");
  const loc = (accounts.accounts as Json[]).find((a) => !a.ignored)?.locationId as string;
  await page.route("**/api/sso", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.user = { ...body.user, activeLocation: loc };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/app");
  const note = page.getByTestId("inline-alert").filter({ hasText: "opened this from inside a client account" });
  await expect(note).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByTestId("page-subtitle")).toContainText("leads waiting, appointments to fix and deals that stopped moving");
  // The notice is a plain row: no tinted box (KF-1).
  expect(await note.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  // It is not remembered: showing every account again is one press, and the account filter drawer comes back.
  await note.getByRole("button", { name: "See all client accounts" }).click();
  await expect(note).toBeHidden();
  await expect(page.getByTestId("page-subtitle")).toContainText("Every client account");
});

test("what changed has its own range, states the window in words, and keeps it in the address", async ({ page }) => {
  await page.goto("/app");
  const card = page.getByTestId("card-range").first();
  await expect(card).toBeVisible();
  await expect(card.getByTestId("card-range-window")).toContainText("Last 7 days");
  await card.getByLabel("What changed: range").selectOption("30d");
  await expect(card.getByTestId("card-range-window")).toContainText("Last 30 days");
  expect(page.url()).toContain("r.today-changes=30d");
  const tiles = page.getByTestId("change-tiles");
  await expect(tiles).toBeVisible();
  await expect(tiles.locator("[data-testid^=tile-]")).toHaveCount(4);
  // A percentage appears only beside a base big enough for it; otherwise the page says the base is too small.
  for (const t of await tiles.locator("[data-testid^=tile-]").all()) {
    const text = await t.innerText();
    if (/\d+%/.test(text)) expect(text).not.toContain("too small a base");
    expect(text).toMatch(/Up |Down |No change|No earlier day/);
  }
});

test("the change figures read only what the person may see: a client's staff are refused, a bad date is refused", async ({ request }) => {
  const agency = await api(request);
  const ok = await agency.get("daily/changes?from=" + new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  expect(ok.changes.map((c: Json) => c.key)).toEqual(["openValue", "stale", "new30", "unread"]);
  for (const bad of ["", "?from=nope", "?from=2099-01-01", "?from=2020-01-01", "?from=2026-02-30"]) {
    expect(await agency.status(`daily/changes${bad}`), bad).toBe(400);
  }
  const client = await api(request, "client");
  expect(await client.status("daily/changes?from=2026-10-01")).toBe(403);
  expect(await client.status("daily")).toBe(403);
});

test("what SubSync watches is in Settings, with two columns, and not on Today", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("front-door")).toBeVisible();
  await expect(page.getByText("When this is sent")).toHaveCount(0);
  await expect(page.getByText("Not watched yet")).toHaveCount(0);
  await expect(page.getByTestId("watching-panel")).toHaveCount(0);
  // Since F8 Settings has eight sections; this panel is the top of "Sync status". The chosen section is remembered in the browser.
  await page.evaluate(() => localStorage.setItem("subsync-settings-section", "sync"));
  await page.goto("/app#settings");
  await page.reload();
  const panel = page.getByTestId("watching-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("watching-column")).toContainText("Watching (");
  await expect(panel.getByTestId("not-yet-column")).toContainText("Not yet (");
  await expect(panel.getByTestId("not-yet-column")).toContainText("Missed calls");
  await expect(panel.getByTestId("not-yet-column")).toContainText("Not built yet");
});

test("the Today screen has no sideways scroll and keeps its short subtitle", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("page-subtitle")).toBeVisible();
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  expect((await page.getByTestId("page-subtitle").innerText()).length).toBeLessThanOrEqual(120);
});

test("a client's staff open on My day, never on Today", async ({ page }) => {
  await page.goto("/app?as=client");
  await expect(page.getByRole("heading", { level: 1, name: "My day" })).toBeVisible();
  await expect(page.getByTestId("front-door")).toHaveCount(0);
});
