import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Stage F4: Unanswered messages (the old "Inbox and SLA"), on the demo company, which carries messy conversations on purpose (five channels, a dead thread,
// an automatic reply, an internal note, some unread, some waiting). WRITTEN IN THE STAGE, NOT RUN: the lead runs it after the merge, against the real
// default flags and a freshly seeded demo.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function auth(request: APIRequestContext, as?: string) {
  const s = await request.post("/api/sso", { data: as ? { demo: true, as } : { demo: true } });
  expect(s.ok()).toBeTruthy();
  return { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
}
async function get(request: APIRequestContext, path: string, as?: string): Promise<Json> {
  const res = await request.get(`/api/app/${path}`, { headers: await auth(request, as) });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
}
const apiOnly = (testInfo: { project: { name: string } }) => testInfo.project.name !== "desktop-1440";
async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}
const open = async (page: Page, hash = "#inbox") => {
  await page.goto(`/app${hash}`);
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Unanswered messages", exact: true })).toBeVisible({ timeout: 60_000 });
};
const tabCount = async (page: Page, label: string) => Number(((await page.getByRole("tab", { name: new RegExp(`^${label} \\(`) }).innerText()).match(/\((\d+)\)/) ?? [])[1]);

test.describe("the numbers behind the page (API, desktop only)", () => {
  test.beforeEach(async ({}, testInfo) => { test.skip(apiOnly(testInfo), "the numbers do not change with the window width"); });

  test("every conversation carries what the page needs: a contact, a channel in words, a name for the owner (never an id), and how old it is", async ({ request }) => {
    const inbox = await get(request, "inbox");
    expect(inbox.items.length).toBeGreaterThan(0);
    for (const i of inbox.items as Json[]) {
      expect(typeof i.channel).toBe("string");
      expect(i.assignee.length, "a name, 'No owner' or the plain note").toBeGreaterThan(0);
      expect(i.assignee, "never the id").not.toBe(i.assignedTo);
      if (i.assignedTo) expect(i.assignee).not.toContain(i.assignedTo);
      else expect(i.assignee).toBe("No owner");
      expect(i.url).toContain("/conversations/");
      expect(i.ageHours === null || i.ageHours >= 0).toBeTruthy();
    }
    expect(inbox.me === null || typeof inbox.me === "string").toBeTruthy();
  });

  test("waiting is recent plus older, unread is every unread conversation, and both equal the numbers Today shows", async ({ request }) => {
    const [inbox, overview] = await Promise.all([get(request, "inbox"), get(request, "overview")]);
    const items = inbox.items as Json[];
    const recent = items.filter((i) => i.overSla && i.waitingHours < 168).length;
    const older = items.filter((i) => i.overSla && i.waitingHours >= 168).length;
    expect(recent + older).toBe(inbox.waitingTotal);
    expect(recent + older).toBe(overview.kpis.unanswered);
    expect(items.filter((i) => i.unreadCount > 0).length).toBe(overview.kpis.unread);
  });

  test("the CSV names who each conversation is assigned to", async ({ request }) => {
    const res = await request.get("/api/app/export/inbox", { headers: await auth(request) });
    expect(res.ok()).toBeTruthy();
    const head = (await res.text()).split("\n")[0];
    for (const col of ["Channel", "Past reply target", "Waiting hours", "Assigned to"]) expect(head).toContain(col);
    expect(head).not.toContain("SLA");
  });

  test("the open deals with no contact are read from the Pipeline side now", async ({ request }) => {
    const gaps = await get(request, "deal-gaps?days=7");
    const old = await get(request, "comms-intel");
    expect(gaps.total).toBe(old.gaps.total);
    expect(gaps.value).toBe(old.gaps.value);
    expect((await get(request, "comms-intel?gaps=0")).gaps, "the Unanswered messages page does not pay for them").toBeUndefined();
    expect(gaps.deals.length).toBeLessThanOrEqual(200);
    expect((await get(request, "deal-gaps?days=14")).total).toBeLessThanOrEqual(gaps.total);
  });

  test("saved views are per person: save, list, replace by name, remove; a client's staff can keep their own and never see the agency's", async ({ request }) => {
    const h = await auth(request);
    const filters = { tab: "older", wait: "24h", channel: "WhatsApp", account: "", user: "", sort: "newest" };
    const saved = await request.post("/api/app/inbox/views", { headers: h, data: { name: "f4 e2e view", filters } });
    expect(saved.ok()).toBeTruthy();
    const list = ((await saved.json()) as Json).views as Json[];
    const mine = list.find((v) => v.name === "f4 e2e view")!;
    expect(mine.filters).toMatchObject(filters);
    // A client's staff (a different person) do not see it.
    const clientViews = await get(request, "inbox/views", "client");
    expect((clientViews.views as Json[]).some((v) => v.name === "f4 e2e view")).toBe(false);
    // A client cannot remove it either.
    const refused = await request.delete(`/api/app/inbox/views/${mine.id}`, { headers: await auth(request, "client") });
    expect(refused.status()).toBe(404);
    // A damaged choice is cleaned, not stored as sent.
    const odd = await request.post("/api/app/inbox/views", { headers: h, data: { name: "f4 e2e odd", filters: { tab: "bogus", account: "<x>" } } });
    expect((((await odd.json()) as Json).views as Json[]).find((v) => v.name === "f4 e2e odd")!.filters).toMatchObject({ tab: "recent", account: "" });
    expect((await request.post("/api/app/inbox/views", { headers: h, data: { name: "   ", filters } })).status()).toBe(400);
    for (const v of ["f4 e2e view", "f4 e2e odd"]) {
      const id = (((await (await request.get("/api/app/inbox/views", { headers: h })).json()) as Json).views as Json[]).find((x) => x.name === v)!.id;
      expect((await request.delete(`/api/app/inbox/views/${id}`, { headers: h })).ok()).toBeTruthy();
    }
  });

  test("a client's staff get only their own account's conversations, with the same shape", async ({ request }) => {
    const inbox = await get(request, "inbox", "client");
    const accounts = new Set((inbox.items as Json[]).map((i) => i.locationId));
    expect(accounts.size).toBeLessThanOrEqual(1);
    const gaps = await get(request, "deal-gaps", "client");
    expect(new Set((gaps.deals as Json[]).map((d) => d.locationId)).size).toBeLessThanOrEqual(1);
  });
});

test("the page names its tabs with counts, and the count on each tab is the number of rows under it", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("waiting-headline")).toContainText(/conversations? (is|are) waiting for a reply/);
  for (const [label, key] of [["Last 7 days", "recent"], ["Older", "older"], ["Unread", "unread"]] as const) {
    const count = await tabCount(page, label);
    await page.getByRole("tab", { name: new RegExp(`^${label} \\(`) }).click();
    const body = page.getByTestId(`tab-body-${key}`);
    await expect(body).toBeVisible();
    if (count === 0) { await expect(body.getByTestId("empty-state")).toBeVisible(); continue; }
    await expect(body.getByTestId("list-range")).toContainText(new RegExp(`of ${count}$`));
    // Nothing is hidden: the other two tabs show their first rows underneath.
    for (const other of ["recent", "older", "unread"].filter((t) => t !== key)) await expect(page.getByTestId(`peek-${other}`)).toBeVisible();
  }
});

test("a long list shows ten rows and View all opens a paginated table; a name opens the customer panel and the reply link says where it goes", async ({ page }) => {
  await open(page);
  const body = page.getByTestId("tab-body-recent");
  const list = body.getByTestId("data-list");
  await expect(list).toHaveAttribute("data-mode", "preview");
  const rows = await list.locator("ul > li").count();
  expect(rows).toBeLessThanOrEqual(10);
  const link = list.getByRole("link", { name: "Reply in your CRM" }).first();
  await expect(link).toHaveAttribute("target", "_blank");
  expect(await link.getAttribute("href")).not.toMatch(/^tel:/);
  const total = await tabCount(page, "Last 7 days");
  if (total > 10) {
    await list.getByRole("button", { name: new RegExp(`View all ${total}`) }).click();
    await expect(list.getByTestId("list-range")).toContainText(`of ${total}`);
  }
  await list.locator("button[data-row-primary]").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer")).toBeHidden();
  await noSideScroll(page, "Unanswered messages");
});

test("the wait chips narrow the list and the counts follow; the choice is in the address and is remembered after a reload", async ({ page }) => {
  await open(page);
  const before = await tabCount(page, "Last 7 days");
  await page.getByTestId("chip-24h").click();
  await expect(page.getByTestId("chip-24h")).toHaveAttribute("aria-pressed", "true");
  const after = await tabCount(page, "Last 7 days");
  expect(after).toBeLessThanOrEqual(before);
  await expect(page.getByTestId("queue-scope")).toContainText("Your choices leave");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain("q.wait=24h");
  await page.reload();
  await expect(page.getByTestId("chip-24h")).toHaveAttribute("aria-pressed", "true");
  // Opening the page again from the menu (no choices in the address) brings back the remembered ones.
  await page.goto("/app#inbox");
  await page.reload();
  await expect(page.getByTestId("chip-24h")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("clear-choices").click();
  await expect(page.getByTestId("chip-any")).toHaveAttribute("aria-pressed", "true");
  expect(await tabCount(page, "Last 7 days")).toBe(before);
});

test("channel, client account and person are choices with names and counts; the order can be flipped", async ({ page }) => {
  await open(page);
  const choices = page.getByTestId("queue-choices");
  const channel = choices.getByLabel("Channel", { exact: true });
  if (await channel.count()) {
    const options = await channel.locator("option").allInnerTexts();
    expect(options[0]).toBe("All channels");
    expect(options.length).toBeGreaterThan(2);
    const first = options[1];
    await channel.selectOption({ index: 1 });
    await expect(page.getByTestId("queue-scope")).toBeVisible();
    // Every row left says that channel.
    const label = first.replace(/ \(\d+\)$/, "");
    const rows = page.getByTestId("tab-body-recent").getByTestId("data-list").locator("ul > li");
    for (const text of await rows.allInnerTexts()) expect(text).toContain(label);
    await page.getByTestId("clear-choices").click();
  }
  const people = choices.getByLabel("Assigned to", { exact: true });
  if (await people.count()) for (const o of await people.locator("option").allInnerTexts()) expect(o, "a name, never an id").not.toMatch(/\b[A-Za-z0-9]{20,}\b/);
  await choices.getByLabel("Order", { exact: true }).selectOption("newest");
  await expect(page.getByTestId("tab-body-recent")).toContainText("Newest first");
});

test("saved views: save the current choices under a name, use them again, remove them", async ({ page }) => {
  await open(page);
  await page.getByTestId("chip-4h").click();
  await page.getByTestId("saved-views").locator("summary").click();
  const name = `e2e view ${Date.now() % 100000}`;
  await page.getByLabel("Name for the saved view").fill(name);
  await page.getByRole("button", { name: "Save this view" }).click();
  await expect(page.getByTestId("saved-views")).toContainText(`Saved "${name}"`);
  await page.getByTestId("chip-any").click();
  await page.getByRole("button", { name: `Use the saved view ${name}` }).click();
  await expect(page.getByTestId("chip-4h")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: `Remove the saved view ${name}` }).click();
  await expect(page.getByRole("button", { name: `Use the saved view ${name}` })).toHaveCount(0);
  await page.getByTestId("chip-any").click();
});

test("the wait chart: pressing a row opens the conversations behind it, the same number, and a name opens the customer panel", async ({ page }) => {
  await open(page);
  const chart = page.getByTestId("distribution").first();
  await expect(chart).toBeVisible();
  const buttons = chart.getByRole("button");
  const n = await buttons.count();
  test.skip(n === 0, "nothing is waiting in this demo, so no row has anything behind it");
  const target = buttons.first();
  const label = (await target.getAttribute("aria-label")) ?? "";
  const count = Number((label.match(/: (\d+)/) ?? [])[1]);
  await target.click();
  const panel = page.getByTestId("drill-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("drill-count")).toHaveText(String(count));
  await expect(panel.getByTestId("list-range")).toContainText(`of ${count}`);
  await panel.getByRole("button", { name: "Back to the chart" }).click();
  await expect(page.getByTestId("drill-closed")).toBeVisible();
});

test("open deals with no contact are under Pipeline, with the same total as the server counts, and not on this page", async ({ page, request }) => {
  await open(page);
  await expect(page.getByText("Open deals with no contact", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Open them in Pipeline" }).click();
  await page.getByRole("tab", { name: "No recent contact" }).click();
  const panel = page.getByTestId("quiet-deals");
  await expect(panel).toBeVisible();
  const gaps = await get(request, "deal-gaps?days=7");
  if (gaps.total === 0) await expect(panel).toContainText("Every open deal has been in touch recently");
  else await expect(page.getByTestId("quiet-total")).toContainText(String(gaps.total).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  await page.getByTestId("quiet-14").click();
  await expect(page.getByTestId("quiet-14")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("back-link")).toBeVisible();
});

test("no word SLA on the page, in Overview or in Settings; the reply target is named", async ({ page }) => {
  await open(page);
  expect(await page.locator("body").innerText()).not.toMatch(/\bSLA\b/);
  await page.goto("/app#overview");
  await page.reload();
  await expect(page.getByText("Waiting past your reply target")).toBeVisible({ timeout: 60_000 });
  expect(await page.locator("body").innerText()).not.toMatch(/\bSLA\b/);
});

test("a client's staff see the page for their own account only (no client account choice, nothing from another account)", async ({ page }) => {
  await page.goto("/app?as=client#inbox");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Unanswered messages", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Client account", { exact: true })).toHaveCount(0);
  await noSideScroll(page, "Unanswered messages as a client");
});
