import { expect, test } from "@playwright/test";
import { api, counted, moreMenu, openMore, type Json } from "./today-helpers";

// Today (third pass): one sentence and one button, then the work list; one row per client account for an agency, Reply now for one account; a stacked bar per account only when
// there is more than one; every mark opens exactly its own records. Run on the demo company as an agency owner, a business administrator and a client's staff user, at the three widths
// of the projects. The v3 rules (counting, above the fold, roles, phone) are in today3.spec.ts.
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

test("the first thing on Today is the one sentence, big, on the first screen, with the work list under it and the numbers behind More detail", async ({ page, request }, testInfo) => {
  const { get } = await api(request);
  const today = await get("today");
  await page.goto("/app");
  const headline = page.getByTestId("today-headline");
  await expect(headline).toBeVisible({ timeout: 45_000 });
  await expect(headline).toBeInViewport();
  const items = counted(today);
  if (items.length > 0) {
    const clients = new Set(items.map((r) => r.locationId)).size;
    await expect(headline).toContainText(new RegExp(`${clients} clients? needs? you today\\.`), { timeout: 10_000 });
    await expect(page.getByTestId("today-primary-button")).toBeVisible();
  } else {
    await expect(headline).toContainText("Every client account is on track today.");
  }
  // The four figures are behind "More detail", closed until it is asked for.
  await expect(page.getByTestId("today-pulse")).toHaveCount(0);
  await openMore(page);
  await expect(page.getByTestId("today-pulse")).toBeVisible();
  await expect(page.getByTestId("today-pulse").locator("[data-verdict]")).toHaveCount(4);
  await expect(page.getByTestId("fix-first")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
});

test("the five-second test: a title, one sentence, one button, and nothing on the headline words the age of the data", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("page-subtitle")).toHaveCount(0); // no paragraph under the title
  await expect(page.getByTestId("today-headline-block")).not.toContainText(/updated|synced|last read/i);
  await expect(page.getByTestId("today-headline")).toContainText(/clients? needs? you today|on track/);
  await expect(page.getByTestId("today-primary").getByRole("link")).toHaveCount(1); // exactly one primary button
  await expect(page.getByTestId("freshness")).toBeVisible(); // the quiet "Updated ..." line is in the top row, once
});

test("the figures are the numbers their own pages show, and the people waiting are counted once", async ({ page, request }) => {
  const { get } = await api(request);
  const [today, speed, appts] = await Promise.all([get("today"), get("speed"), get("appointments")]);
  await page.goto("/app");
  await openMore(page);
  await expect(page.getByTestId("pulse-replies")).toContainText(thousands(today.totals.replies.count), { timeout: 15_000 });
  // New leads are a subset of the people waiting: never more of them than people.
  expect(speed.waitingTotal).toBeLessThanOrEqual(today.totals.replies.count);
  expect(today.totals.replies.newLeads).toBeLessThanOrEqual(today.totals.replies.count);
  await expect(page.getByTestId("pulse-appointments")).toContainText(String(appts.unmarkedTotal));
});

test("Today draws its own account selector and not the shared filter; the shared filter does not change Today and still works on other pages", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1000); // the figure counts up for 600 ms
  const base = (await page.getByTestId("today-headline").innerText()).trim();
  await page.goto("/app#today?hideTest=1&industry=medical");
  await page.reload();
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("filter-drawer")).toHaveCount(0);
  await expect(page.getByTestId("filter-row")).toHaveCount(0);
  await expect(page.getByTestId("today-account-picker")).toBeVisible();
  // The shared filter (industry, test accounts) names nothing Today counts: the same sentence as with no filter at all.
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("today-headline")).toHaveText(base);
  // Another page keeps the shared filter.
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("filter-drawer")).toBeVisible({ timeout: 30_000 });
});

test("the account selector narrows every number, is kept in the address as ta=, is remembered for Today only, and its 'See all' clears it", async ({ page, request }) => {
  test.setTimeout(240_000); // five page loads of the demo company in one test
  const { get } = await api(request);
  const base = await get("today");
  const first = counted(base).find((i) => i.kind === "replies") ?? counted(base)[0];
  const target = { id: first.locationId as string, name: first.accountName as string };
  const mine = await get(`today?accounts=${target.id}`);
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("today-account-picker").getByRole("button", { name: /Client accounts/ }).click();
  const pop = page.getByTestId("picker-popover");
  await pop.getByLabel("Find a client account").fill(target.name);
  await pop.getByRole("checkbox").first().check();
  await pop.getByRole("button", { name: "Done" }).click();
  await expect(pop).toHaveCount(0);
  expect(page.url()).toContain(`ta=${target.id}`);
  const chip = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await expect(chip).toContainText(target.name);
  // One account: the one-account page (Reply now, no account chart), and its sentence is that account's count.
  await expect(page.getByTestId("account-bars")).toHaveCount(0);
  const replies = counted(mine).filter((i) => i.kind === "replies").length;
  if (replies > 0) await expect(page.getByTestId("today-headline")).toContainText(new RegExp(`^\\s*${thousands(replies)}\\s+(people are|person is) waiting for a reply`), { timeout: 15_000 });
  for (const r of await page.getByTestId("reply-row").all()) await expect(r).toBeVisible();
  // Remembered: a fresh visit to Today restores it; the Speed to lead page is not narrowed by it.
  await page.goto("/app");
  await expect(page.getByTestId("today-toolbar").getByTestId("showing-chip")).toContainText(target.name, { timeout: 45_000 });
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("filter-drawer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("account-scope-summary").first()).toContainText(/All \d+ client accounts/);
  // "See all" puts it back.
  await page.goto("/app");
  const again = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await again.getByRole("button", { name: "See all" }).click();
  await expect(again).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
});

test("the work list: at most five rows, one small Open button each, urgency in words, no inline Show or Done, and j k Enter", async ({ page }) => {
  await page.goto("/app");
  const rows = page.getByTestId("queue-row");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  expect(await rows.count()).toBeLessThanOrEqual(5);
  for (const r of await rows.all()) {
    await expect(r.getByTestId("queue-open")).toHaveText(/^Open/);
    await expect(r).toContainText(/Urgent|Soon|When you can/);
    await expect(r.getByTestId("queue-more")).toBeVisible();
  }
  await expect(page.getByTestId("queue-show")).toHaveCount(0);
  await expect(page.getByTestId("queue-done")).toHaveCount(0);
  // The first row is not drawn as selected until the keyboard is used; j moves down, k moves back.
  await expect(rows.nth(0)).not.toHaveAttribute("aria-current", "true");
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

test("every Open link is a real https address in a new tab, and none is a phone link", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("queue-row").first()).toBeVisible({ timeout: 45_000 });
  for (const a of await page.getByTestId("fix-first").locator("a").all()) {
    expect(await a.getAttribute("href")).toMatch(/^https:\/\//);
    expect(await a.getAttribute("target")).toBe("_blank");
    expect(await a.getAttribute("rel")).toContain("noopener");
  }
  expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
});

test("there is no donut: every bar segment opens exactly its own records, and the count on the segment is the number of rows", async ({ page, request }) => {
  const { get } = await api(request);
  const t = await get("today");
  await page.goto("/app");
  await expect(page.getByTestId("account-bars")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("donut-chart")).toHaveCount(0);
  const panel = page.getByTestId("records-panel");
  const segments = page.getByTestId("bar-segment");
  expect(await segments.count()).toBeGreaterThan(1);
  const kinds = new Set<string>();
  for (const seg of (await segments.all()).slice(0, 8)) {
    const n = Number(await seg.getAttribute("data-count"));
    const kind = (await seg.getAttribute("data-kind"))!;
    const account = (await seg.getAttribute("data-account"))!;
    kinds.add(kind);
    const mine = counted(t).filter((i) => i.locationId === account && i.kind === kind).length;
    expect(n, `the segment count is the rows of ${kind} in that account`).toBe(mine);
    await seg.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
    await expect(panel.getByTestId("records-showing")).toContainText(`of ${n}`);
    const name = (t.accounts as Json[]).find((a) => a.id === account)!.name as string;
    await expect(page.getByTestId("records-title")).toContainText(name); // the title says exactly what was clicked
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
  expect(kinds.size).toBeGreaterThan(0);
});

test("the amount on a work-list row opens exactly that client account's records, and the count equals the rows", async ({ page }) => {
  await page.goto("/app");
  const row = page.getByTestId("queue-row").first();
  await expect(row).toBeVisible({ timeout: 45_000 });
  const count = Number(await row.getByTestId("queue-amount").getAttribute("data-count"));
  await row.getByTestId("queue-amount").click();
  const panel = page.getByTestId("records-panel");
  await expect(panel).toBeVisible();
  const heading = Number(await panel.getByTestId("records-count").getAttribute("data-count"));
  expect(heading).toBeGreaterThan(0);
  expect(heading).toBe(count);
  await page.getByTestId("records-close").click();
  await expect(panel).toHaveCount(0);
});

test("the bars: one per client account, longest first, at most 8 and a '+N more'; the name opens that account's records; 'Show only this client' leaves one account and no chart", async ({ page }) => {
  await page.goto("/app");
  const bars = page.getByTestId("account-bar");
  await expect(bars.first()).toBeVisible({ timeout: 45_000 });
  expect(await bars.count()).toBeLessThanOrEqual(8);
  const counts = (await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))))) as number[];
  expect([...counts].sort((a, b) => b - a)).toEqual(counts); // longest first
  await bars.first().getByTestId("bar-account").focus();
  await expect(page.getByTestId("bars-tip")).toContainText(/:/);
  const name = (await bars.first().getByTestId("bar-account").getAttribute("aria-label"))!.split(",")[0];
  await bars.first().getByTestId("bar-account").click();
  const panel = page.getByTestId("records-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("records-title")).toContainText(name);
  await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(counts[0]));
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Narrowing Today to one account is done from the row's menu.
  await page.getByTestId("queue-row").first().getByTestId("queue-more").click();
  await page.getByTestId("menu-only").click();
  expect(page.url()).toContain("ta=");
  await expect(page.getByTestId("account-bar")).toHaveCount(0);
  await page.getByTestId("showing-clear").click();
  await expect(page.getByTestId("account-bar").first()).toBeVisible();
  expect(await page.getByTestId("account-bar").count()).toBeGreaterThan(1);
});

test("raised and cleared: each day with alerts opens its list; the number on the day is the rows; the word is cleared", async ({ page }) => {
  await page.goto("/app");
  await openMore(page);
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

test("Share Today (in More) copies the headline and the top three, and sends nothing", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/app/") && !/\/(usage|sync)$/.test(new URL(r.url()).pathname)) posts += 1; });
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await moreMenu(page, "share");
  await page.getByTestId("today-more").click();
  await expect(page.getByTestId("menu-share")).toContainText("Copied to your clipboard");
  await page.keyboard.press("Escape");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Your client accounts: Today\r?\n/);
  expect(text).toContain("Fix first:");
  expect(text.split(/\r?\n/).filter((l) => /^\d\. /.test(l)).length).toBeLessThanOrEqual(3);
  expect(posts).toBe(0);
});

test("the loading state is a skeleton and a failed read says what went wrong with an error ID and a retry", async ({ page }) => {
  await page.route("**/api/app/today*", (route) => route.fulfill({ status: 500, json: { error: "Something went wrong. Please try again." } }));
  await page.goto("/app");
  await expect(page.getByTestId("error-state")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("error-id")).toHaveText(/^E-/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an agency person opened from inside a client account starts on Today for that account, with a one-line 'Showing ... See all' and no second banner", async ({ page, request }) => {
  const { get } = await api(request);
  const t = await get("today");
  const loc = (t.accounts as Json[])[0].id as string;
  const name = (t.accounts as Json[])[0].name as string;
  await page.route("**/api/sso", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.user = { ...body.user, activeLocation: loc };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/app");
  const chip = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await expect(chip).toContainText(name, { timeout: 45_000 });
  expect(page.url()).toContain(`ta=${loc}`);
  // The old banner is gone from Today (it stays on the other pages): one line in the top row says it.
  await expect(page.getByTestId("inline-alert").filter({ hasText: "opened this from inside a client account" })).toHaveCount(0);
  await expect(page.getByTestId("account-bars")).toHaveCount(0);
  await chip.getByRole("button", { name: "See all" }).click();
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
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
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

test("the Today screen has no sideways scroll", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("fix-first")).toBeVisible({ timeout: 45_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
});

test("a client's staff open on Today for their own account: Reply now, calls, appointments, and nothing of the company", async ({ page }) => {
  await page.goto("/app?as=client");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("today-headline")).toBeVisible();
  await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
  await expect(page.getByTestId("filter-drawer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fix first" })).toHaveCount(0);
  await expect(page.getByTestId("account-bars")).toHaveCount(0);
  await expect(page.getByTestId("donut-chart")).toHaveCount(0);
  await expect(page.getByTestId("today-proof")).toHaveCount(0); // alerts are for the business administrator
  await openMore(page);
  await expect(page.getByTestId("my-numbers")).toBeVisible();
  await expect(page.getByTestId("today-proof")).toHaveCount(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\bfee\b|monthly|subscription|plan\b|client accounts need|Settings|\bSLA\b/i);
  // People waiting: oldest first, each with one small Reply button; a live wait.
  const leads = page.getByTestId("reply-row");
  if (await leads.count()) {
    await expect(leads.first().getByTestId("lead-open")).toHaveText(/^Reply/);
    await expect(leads.first().getByTestId("lead-wait")).toContainText(/Waiting|Never answered/);
  }
  // Calls: a person who asked not to be contacted is a disabled button that says so; every other call opens the CRM (never a phone link).
  for (const r of await page.getByTestId("call-row").all()) {
    if ((await r.getAttribute("data-dnd")) === "true") await expect(r.getByRole("button", { name: "No calls" })).toBeDisabled();
  }
  expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
});

test("a business administrator also sees what SubSync caught in their account, never other accounts", async ({ page }) => {
  await page.goto("/app?as=business");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await openMore(page);
  await expect(page.getByTestId("today-proof")).toBeVisible();
  await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
  await page.getByTestId("today-more").click();
  await expect(page.getByTestId("menu-share")).toContainText("Share my day");
  await page.keyboard.press("Escape");
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
  await page.getByTestId("legend-replies").click();
  await expect(page.getByTestId("today-list")).toBeVisible();
});

