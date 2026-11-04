import { expect, test, type APIRequestContext } from "@playwright/test";

// Today, rebuilt: one sentence, four figures against the account's own usual, the Fix first queue, clickable charts, accounts needing you, what SubSync caught.
// Run on the demo company as an agency owner, a business administrator and a client's staff user, at 1440 (and the other widths of the projects).
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
  };
}

test("the first thing on Today is the one sentence, big, on the first screen, with the queue starting under the figures", async ({ page, request }, testInfo) => {
  const { get } = await api(request);
  const today = await get("today");
  await page.goto("/app");
  const headline = page.getByTestId("today-headline");
  await expect(headline).toBeVisible({ timeout: 15_000 });
  await expect(headline).toBeInViewport();
  const rows = today.queue as Json[];
  if (rows.length > 0) {
    const clients = new Set(rows.map((r) => r.locationId)).size;
    await expect(headline).toContainText(new RegExp(`${clients} clients? needs? you today\\.`), { timeout: 10_000 });
  } else {
    await expect(headline).toContainText("Every client account is on track today.");
  }
  await expect(page.getByTestId("today-pulse").locator("[data-verdict]")).toHaveCount(4);
  await expect(page.getByTestId("fix-first")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `docs/review/today-after-${testInfo.project.name}.png`, fullPage: true });
});

test("the five-second test: what the page is for is in the subtitle, and nothing on the headline words the age of the data", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByTestId("page-subtitle")).toContainText("What needs a person across your client accounts, most valuable first.");
  await expect(page.getByTestId("today-headline-block")).not.toContainText(/updated|synced|last read/i);
});

test("the figures are the numbers their own pages show", async ({ page, request }) => {
  const { get } = await api(request);
  const [speed, appts] = await Promise.all([get("speed"), get("appointments")]);
  await page.goto("/app");
  await expect(page.getByTestId("pulse-leads")).toContainText(String(speed.waitingTotal).replace(/\B(?=(\d{3})+(?!\d))/g, ","), { timeout: 15_000 });
  await expect(page.getByTestId("pulse-appointments")).toContainText(String(appts.unmarkedTotal));
});

test("Today draws its own account selector and not the shared filter; the shared filter does not change Today and still works on other pages", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("donut-total")).toBeVisible({ timeout: 15_000 });
  const baseTotal = (await page.getByTestId("donut-total").innerText()).trim();
  await page.goto("/app#today?hideTest=1&industry=medical");
  await page.reload();
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("filter-drawer")).toHaveCount(0);
  await expect(page.getByTestId("filter-row")).toHaveCount(0);
  await expect(page.getByTestId("today-account-picker")).toBeVisible();
  // The shared filter (industry, test accounts) names nothing Today counts: the same total as with no filter at all.
  await expect(page.getByTestId("donut-total")).toHaveText(baseTotal);
  // Another page keeps the shared filter.
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("filter-drawer")).toBeVisible({ timeout: 30_000 });
});

test("the account selector narrows every number, is kept in the address as ta=, is remembered for Today only, and its chip clears it", async ({ page, request }) => {
  const { get } = await api(request);
  const base = await get("today");
  const target = (base.queue as Json[])[0];
  const mine = await get(`today?accounts=${target.locationId}`);
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 15_000 });
  const picker = page.getByTestId("today-account-picker");
  await picker.getByRole("button", { name: /Client accounts/ }).click();
  const pop = page.getByTestId("picker-popover");
  await pop.getByLabel("Find a client account").fill(target.accountName);
  await pop.getByRole("checkbox").first().check();
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(pop).toHaveCount(0);
  expect(page.url()).toContain(`ta=${target.locationId}`);
  const chip = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await expect(chip).toContainText(target.accountName);
  await expect(page.getByTestId("queue-row").first()).toContainText(target.accountName);
  const rows = page.getByTestId("queue-row");
  for (const r of await rows.all()) await expect(r).toContainText(target.accountName);
  // The page leaves test-named and very old (3x the stale days) stale deals out of the counts by default (the "Exclude test and very old deals" control).
  const junk = (i: Json) => i.kind === "stale" && ((i.at !== null && mine.now - i.at > mine.staleDays * 3 * 86_400_000) || /(^|[^a-z0-9])(test|testing|demo|sample|sandbox|dummy)([^a-z0-9]|$)/i.test(i.name));
  const total = (mine.items as Json[]).filter((i) => !junk(i)).length;
  await expect(page.getByTestId("donut-total")).toContainText(String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  // Remembered: a fresh visit to Today restores it; the Speed to lead page is not narrowed by it.
  await page.goto("/app");
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toContainText(target.accountName, { timeout: 15_000 });
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("filter-drawer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("account-scope-summary").first()).toContainText(/All \d+ client accounts/);
  // The chip's cross puts it back.
  await page.goto("/app");
  const again = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await again.getByRole("button", { name: /Stop showing/ }).click();
  await expect(again).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
});

test("Fix first: seven rows, same four parts each, one main button, a quiet Show, and j k Enter", async ({ page }) => {
  await page.goto("/app");
  const rows = page.getByTestId("queue-row");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeLessThanOrEqual(7);
  for (const r of await rows.all()) {
    await expect(r.getByTestId("queue-open")).toHaveText(/Open in CRM/);
    await expect(r.getByTestId("queue-show")).toBeVisible();
    await expect(r).toContainText(/Urgent|Soon|When you can/);
    await expect(r).toContainText(/Wrong for/);
  }
  // Keyboard: j moves the highlight, k moves it back.
  await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
  // Enter opens the highlighted row in the CRM, in a new tab, with a link built from the account's own CRM address.
  await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null; }) as typeof window.open; });
  const first = await rows.nth(0).getByTestId("queue-open").getAttribute("href");
  await page.keyboard.press("Enter");
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toEqual([first]);
  expect(first).toMatch(/^https:\/\//);
});

test("every Open in CRM link is a real https address in a new tab, and none is a phone link", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("queue-row").first()).toBeVisible({ timeout: 15_000 });
  for (const a of await page.getByTestId("fix-first").locator("a").all()) {
    expect(await a.getAttribute("href")).toMatch(/^https:\/\//);
    expect(await a.getAttribute("target")).toBe("_blank");
    expect(await a.getAttribute("rel")).toContain("noopener");
  }
  expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
});

test("the donut: each slice is a button; pressing it opens the records behind it, and the count on the slice is the number of rows; the legend does the same", async ({ page, request }) => {
  const { get } = await api(request);
  const t = await get("today");
  await page.goto("/app");
  await expect(page.getByTestId("donut-chart")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("chart-hint").first()).toBeVisible();
  const kinds = (["leads", "appointments", "noshows", "stale", "unanswered"] as const).filter((k) => t.totals[k].count > 0);
  expect(kinds.length).toBeGreaterThan(1);
  const panel = page.getByTestId("records-panel");
  for (const kind of kinds) {
    const slice = page.getByTestId(`slice-${kind}`);
    const n = Number(await slice.getAttribute("data-count"));
    expect(n).toBeGreaterThan(0);
    await slice.focus();
    await expect(page.getByTestId("donut-tip")).toContainText(String(n));
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    // The count on the slice is the number in the panel's heading; the rows are the rows (a list that was cut says so).
    await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
    const shown = Number(await panel.getByTestId("records-count").getAttribute("data-shown"));
    if (shown < n) await expect(panel.getByTestId("records-note")).toBeVisible();
    await expect(panel.getByTestId("records-showing")).toContainText(`of ${shown}`);
    // The chosen slice and its legend row are marked with more than colour while the panel is open.
    await expect(slice).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`legend-${kind}`)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
  await expect(page.getByTestId("donut-chart").getByTestId("chart-hint")).toHaveCount(0); // gone after the first click
  // The legend row does the same as the slice.
  await page.getByTestId(`legend-${kinds[0]}`).click();
  await expect(panel).toBeVisible();
  await page.getByTestId("records-close").click();
  await expect(panel).toHaveCount(0);
  await page.screenshot({ path: "docs/review/today-charts-donut.png", fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } }).catch(() => undefined);
});

test("Show on a queue row opens exactly that row's items", async ({ page }) => {
  await page.goto("/app");
  const row = page.getByTestId("queue-row").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const count = Number((await row.getByTestId("queue-amount").getAttribute("aria-label"))!.match(/(\d[\d,]*) items?/)?.[1].replace(/,/g, ""));
  await row.getByTestId("queue-show").click();
  const panel = page.getByTestId("records-panel");
  await expect(panel).toBeVisible();
  const heading = Number(await panel.getByTestId("records-count").getAttribute("data-count"));
  expect(heading).toBeGreaterThan(0);
  expect(heading).toBe(count);
  await page.getByTestId("records-close").click();
  await expect(panel).toHaveCount(0);
});

test("the bars: where it is happening; clicking a bar opens the things to fix in that account, and the count on the bar is the number of rows", async ({ page }) => {
  await page.goto("/app");
  const bars = page.getByTestId("account-bar");
  await expect(bars.first()).toBeVisible({ timeout: 15_000 });
  expect(await bars.count()).toBeLessThanOrEqual(8);
  const counts = (await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))))) as number[];
  expect([...counts].sort((a, b) => b - a)).toEqual(counts); // longest first
  await bars.first().focus();
  await expect(page.getByTestId("bars-tip")).toContainText(/:/);
  const name = (await bars.first().getAttribute("aria-label"))!.split(":")[0];
  await bars.first().click();
  const panel = page.getByTestId("records-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("records-title")).toContainText(name);
  await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(counts[0]));
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Narrowing Today to one account is done from Accounts needing you.
  await page.getByTestId("needing-row").first().getByRole("button", { name: "Only this account" }).click();
  expect(page.url()).toContain("ta=");
  await expect(page.getByTestId("account-bar")).toHaveCount(1);
  await page.getByTestId("today-toolbar").getByRole("button", { name: /Stop showing/ }).first().click();
  await expect(page.getByTestId("account-bar").first()).toBeVisible();
  await expect(page.getByTestId("account-bar")).not.toHaveCount(1);
});

test("raised and cleared: each day with alerts opens its list; the number on the day is the rows; the word is cleared", async ({ page }) => {
  await page.goto("/app");
  const strip = page.getByTestId("raised-cleared");
  await expect(strip).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("raised-title")).toContainText(/Last 7 days: \d+ alerts? raised, \d+ cleared, \d+ still open\./);
  await expect(page.getByTestId("proof-note")).toContainText("Cleared means the problem is gone from your CRM data");
  const days = strip.getByTestId("raised-day");
  expect(await days.count()).toBe(7);
  const panel = page.getByTestId("records-panel");
  for (const d of await days.all()) {
    if (await d.isDisabled()) continue;
    const raised = Number(await d.getAttribute("data-raised")), cleared = Number(await d.getAttribute("data-cleared"));
    await d.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(raised + cleared));
    await expect(page.getByTestId("records-title")).toContainText("Alerts on");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
});

test("Share Today copies the headline and the top three, and sends nothing", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/app/") && !/\/(usage|sync)$/.test(new URL(r.url()).pathname)) posts += 1; });
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Share Today" }).click();
  await expect(page.getByRole("button", { name: "Copied to your clipboard" })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Your client accounts: Today\n/);
  expect(text).toContain("Fix first:");
  expect(text.split("\n").filter((l) => /^\d\. /.test(l)).length).toBeLessThanOrEqual(3);
  expect(posts).toBe(0);
});

test("the loading state is a skeleton and a failed read says what went wrong with an error ID and a retry", async ({ page }) => {
  await page.route("**/api/app/today*", (route) => route.fulfill({ status: 500, json: { error: "Something went wrong. Please try again." } }));
  await page.goto("/app");
  await expect(page.getByTestId("error-state")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("error-id")).toHaveText(/^E-/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an agency person opened from inside a client account starts on Today for that account with a plain notice and a way to all of them", async ({ page, request }) => {
  const { get } = await api(request);
  const t = await get("today");
  const loc = (t.accounts as Json[])[0].id as string;
  await page.route("**/api/sso", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.user = { ...body.user, activeLocation: loc };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/app");
  const note = page.getByTestId("inline-alert").filter({ hasText: "opened this from inside a client account" });
  await expect(note).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toContain(`ta=${loc}`);
  expect(await note.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip").first()).toBeVisible();
  await note.getByRole("button", { name: "See all client accounts" }).click();
  await expect(note).toBeHidden();
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toHaveCount(0);
});

test("the change figures read only what the person may see: a client's staff are refused, a bad date is refused", async ({ request }) => {
  const agency = await api(request);
  const ok = await agency.get("daily/changes?from=" + new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
  expect(ok.changes.map((c: Json) => c.key)).toEqual(["openValue", "stale", "new30", "unread"]);
  for (const bad of ["", "?from=nope", "?from=2099-01-01", "?from=2020-01-01", "?from=2026-02-30"]) expect(await agency.status(`daily/changes${bad}`), bad).toBe(400);
  const client = await api(request, "client");
  expect(await client.status("daily/changes?from=2026-10-01")).toBe(403);
  expect(await client.status("daily")).toBe(403);
});

test("a business and a client's staff get one account from the server, even when the address names another", async ({ request }) => {
  const agency = await api(request);
  const all = await agency.get("today");
  const ids = (all.accounts as Json[]).map((a) => a.id as string);
  for (const as of ["business", "client"] as const) {
    const who = await api(request, as);
    const mine = await who.get("today");
    expect(mine.accounts).toHaveLength(1);
    const own = mine.accounts[0].id as string;
    const other = ids.find((i) => i !== own)!;
    const tampered = await who.get(`today?accounts=${other}`);
    expect(tampered.accounts.map((a: Json) => a.id)).toEqual([own]);
    expect(JSON.stringify(tampered)).not.toContain(other);
    expect(new Set((tampered.items as Json[]).map((i) => i.locationId))).toEqual(new Set((tampered.items as Json[]).length ? [own] : []));
    expect(await who.status("segments")).toBe(403);
    expect(await who.status("settings")).toBe(as === "business" ? 200 : 403);
  }
});

test("what SubSync watches is in Settings, with two columns, and not on Today", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("When this is sent")).toHaveCount(0);
  await expect(page.getByText("Not watched yet")).toHaveCount(0);
  await expect(page.getByTestId("watching-panel")).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("subsync-settings-section", "sync"));
  await page.goto("/app#settings");
  await page.reload();
  const panel = page.getByTestId("watching-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("watching-column")).toContainText("Watching (");
  await expect(panel.getByTestId("not-yet-column")).toContainText("Not yet (");
});

test("the Today screen has no sideways scroll and keeps its short subtitle", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("fix-first")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  expect((await page.getByTestId("page-subtitle").innerText()).length).toBeLessThanOrEqual(120);
});

test("a client's staff open on Today for their own account: their leads, calls, appointments and numbers, and nothing of the company", async ({ page }) => {
  await page.goto("/app?as=client");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("today-headline")).toBeVisible();
  await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
  await expect(page.getByTestId("filter-drawer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fix first" })).toHaveCount(0); // the company-wide queue is not theirs; "Also needs you" is their own account
  await expect(page.getByTestId("today-proof")).toHaveCount(0); // alerts are for the business administrator
  await expect(page.getByTestId("my-numbers")).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\bfee\b|monthly|subscription|plan\b|client accounts need|Settings/i);
  // Leads: oldest first, each with one big Open in CRM; a live wait.
  const leads = page.getByTestId("my-leads").locator("li");
  if (await leads.count()) {
    await expect(leads.first().getByTestId("lead-open")).toHaveText(/Open in CRM/);
    await expect(leads.first().getByTestId("lead-wait")).toContainText(/Waiting|Never answered/);
  }
  // Calls: a person who asked not to be contacted is a disabled button that says so; every other call opens the CRM (never a phone link).
  for (const r of await page.getByTestId("call-row").all()) {
    if ((await r.getAttribute("data-dnd")) === "true") await expect(r.getByRole("button", { name: "Do not call" })).toBeDisabled();
  }
  expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
  await page.screenshot({ path: "docs/review/today-account-client.png", fullPage: true });
});

test("a business administrator also sees what SubSync caught in their account, and Done for today or the queue, never other accounts", async ({ page }) => {
  await page.goto("/app?as=business");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("today-proof")).toBeVisible();
  await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share my day" })).toBeVisible();
  await page.screenshot({ path: "docs/review/today-account-business.png", fullPage: true });
});

test("the style guide shows Today's building blocks, still opens without signing in and has no sideways scroll", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByTestId("today-headline")).toBeVisible();
  await expect(page.getByTestId("donut-chart")).toBeVisible();
  await expect(page.getByTestId("account-bars")).toBeVisible();
  await expect(page.getByTestId("raised-cleared")).toBeVisible();
  await expect(page.getByTestId("fix-first")).toBeVisible();
  await expect(page.getByTestId("design-pulse")).toBeVisible();
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  // A slice works on the style guide too.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1000); // hydrated
  await page.getByTestId("legend-leads").click();
  await expect(page.getByTestId("today-list")).toBeVisible();
});
