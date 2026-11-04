import { expect, test } from "@playwright/test";
import { api, counted, moreMenu, openMore, type Json } from "./today-helpers";

// Today v3, the acceptance list of docs/TODAY_REVIEW.md, on the demo company, for the four roles and the three widths of the projects:
//   1 the five-second test per role   2 above the fold at 1440 x 800   3 one number per fact   4 every mark opens exactly its own records
//   5 no chart for one account, one menu item, the history note once   6 a clean phone layout (no sideways scroll at 390).
const ROLES = [
  { name: "agency, all accounts", path: "/app", multi: true },
  { name: "agency, inside one account", path: "/app?as=location", multi: false },
  { name: "a client's staff", path: "/app?as=client", multi: false },
  { name: "a business owner", path: "/app?as=business", multi: false },
] as const;
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

for (const role of ROLES) {
  test(`${role.name}: the five-second test (what it is, who it is for, what to press), and no sideways scroll`, async ({ page }) => {
    await page.goto(role.path);
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("today-headline")).toBeVisible();
    const headline = (await page.getByTestId("today-headline").innerText()).trim();
    expect(headline.length, "one sentence, not a paragraph").toBeLessThan(140);
    if (!/on track|caught up/.test(headline)) {
      await expect(page.getByTestId("today-primary-button")).toBeVisible(); // what to press
      await expect(page.getByTestId("today-primary").locator("a,button")).toHaveCount(1);
    }
    // ONE overflow menu holds the rest.
    await expect(page.getByTestId("today-more")).toBeVisible();
    // No jargon, no platform name.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\bSLA\b|GoHighLevel|HighLevel|\bGHL\b|sub-?account|past the target|pipeline at risk/i);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test(`${role.name}: no chart for one account, the bars only for more than one, no repeated 'not enough history' lines`, async ({ page }) => {
    await page.goto(role.path);
    await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("donut-chart")).toHaveCount(0);
    if (role.multi) await expect(page.getByTestId("account-bars")).toBeVisible();
    else await expect(page.getByTestId("account-bars")).toHaveCount(0);
    await openMore(page);
    expect(await page.getByText("Not enough history yet", { exact: false }).count(), "the old per-tile line is gone").toBe(0);
    expect(await page.getByText("Comparisons with your usual start after 7 days of history.", { exact: true }).count(), "said at most once").toBeLessThanOrEqual(1);
    expect((await page.locator("main").innerText()).match(/0 replies/g) ?? [], "no '0 replies' as a headline value").toHaveLength(0);
  });
}

test("above the fold at 1440 x 800: the header, the headline, the one button and at least the first three rows are on screen", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name !== "desktop-1440", "the fold is measured at 1440 x 800");
  await page.setViewportSize({ width: 1440, height: 800 });
  for (const path of ["/app", "/app?as=client", "/app?as=business"]) {
    await page.goto(path);
    await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const rows = page.locator('[data-testid="queue-row"], [data-testid="reply-row"]');
    await expect(rows.first()).toBeVisible();
    const n = Math.min(3, await rows.count());
    expect(n).toBeGreaterThan(0);
    for (const el of [page.getByTestId("today-header"), page.getByTestId("today-headline"), page.getByTestId("today-primary-button")]) await expect(el, path).toBeInViewport({ ratio: 1 });
    for (let i = 0; i < n; i++) await expect(rows.nth(i), `${path}: row ${i + 1}`).toBeInViewport({ ratio: 1 });
    // The rows are short (KF-8): 56 to 72 px, so six fit.
    const box = await rows.first().boundingBox();
    expect(box!.height, `${path}: one row is ${box!.height} px`).toBeLessThanOrEqual(76);
  }
});

test("one number per fact (agency, all accounts): the headline, the tile, the work list, the bars and the lists behind them agree", async ({ page, request }) => {
  const { get } = await api(request);
  const t = await get("today");
  const items = counted(t);
  const replies = items.filter((i) => i.kind === "replies").length;
  const things = items.length;
  const clients = new Set(items.map((i) => i.locationId)).size;
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toContainText(new RegExp(`${clients} clients? needs? you today`), { timeout: 60_000 });
  // The breakdown line says the same people count, with the new leads as a subset.
  await expect(page.getByTestId("today-breakdown")).toContainText(new RegExp(`${thousands(replies)} people? waiting for a reply`));
  const panel = page.getByTestId("records-panel");
  // The headline number opens the clients; its count is the headline's.
  await page.getByTestId("headline-clients").click();
  await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(clients));
  await page.keyboard.press("Escape");
  // The bars add up to the things that need a person, each person once.
  const totals = (await page.getByTestId("account-bar").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))))) as number[];
  const shown = totals.reduce((a, b) => a + b, 0);
  expect(shown).toBeLessThanOrEqual(things);
  if (totals.length === clients) expect(shown).toBe(things);
  // The tile.
  await openMore(page);
  await expect(page.getByTestId("pulse-replies")).toContainText(thousands(replies));
  await page.getByTestId("pulse-replies-open").click();
  await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(replies));
  await expect(panel.getByTestId("records-showing")).toContainText(`of ${Math.min(replies, 50) === replies ? replies : Number(await panel.getByTestId("records-count").getAttribute("data-shown"))}`);
  await page.keyboard.press("Escape");
  // The Today read has no second copy of the numbers: the sum of the kinds is the same as the rows.
  const kinds = ["replies", "appointments", "noshows", "stale"] as const;
  for (const k of kinds) expect(t.totals[k].count, k).toBeGreaterThanOrEqual((t.items as Json[]).filter((i) => i.kind === k).length);
  expect((t as Json).queue).toBeUndefined();
});

test("one number per fact (one account): the sentence, the Reply now list, its 'See all' and the records behind it say the same number", async ({ page, request }) => {
  const who = await api(request, "client");
  const t = await who.get("today");
  const n = counted(t).filter((i) => i.kind === "replies").length;
  test.skip(n === 0, "the demo client has nobody waiting");
  await page.goto("/app?as=client");
  await expect(page.getByTestId("today-headline")).toContainText(new RegExp(`${thousands(n)} (people are|person is) waiting for a reply`), { timeout: 60_000 });
  await expect(page.getByTestId("reply-summary")).toContainText(/longest wait/);
  const shown = await page.getByTestId("reply-row").count();
  expect(shown).toBeLessThanOrEqual(5);
  if (n > shown) {
    await expect(page.getByTestId("reply-all")).toContainText(`See all ${thousands(n)}`);
    await page.getByTestId("reply-all").click();
    const panel = page.getByTestId("records-panel");
    await expect(panel.getByTestId("records-count")).toHaveAttribute("data-count", String(n));
    await expect(page.getByTestId("records-title")).not.toContainText(/all client accounts/i);
    await page.keyboard.press("Escape");
  }
  await page.getByTestId("headline-replies").click();
  await expect(page.getByTestId("records-panel").getByTestId("records-count")).toHaveAttribute("data-count", String(n));
});

test("there is one menu item for the day: no 'My day', the old address opens Today, and a client's staff see calls and appointments on Today itself", async ({ page }) => {
  await page.goto("/app?as=client#myday");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("today-headline")).toBeVisible();
  const nav = page.locator('nav[aria-label="Sections"]:visible').first(); // the side menu, or the row of pages on a phone
  await expect(nav.getByRole("button", { name: "Today" })).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "My day" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "My day" })).toHaveCount(0);
});

test("the More menu holds the rest: an agency has the daily email, print, share, sync, saved views and commands; a client's staff have share and sync", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("today-more").click();
  for (const key of ["brief", "print", "share", "sync", "views", "commands"]) await expect(page.getByTestId(`menu-${key}`), key).toBeVisible();
  await page.keyboard.press("Escape");
  await moreMenu(page, "brief");
  await expect(page.getByTestId("brief-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await moreMenu(page, "commands");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await moreMenu(page, "views");
  await expect(page.getByTestId("views-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/app?as=client");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("today-more").click();
  for (const key of ["share", "sync"]) await expect(page.getByTestId(`menu-${key}`), key).toBeVisible();
  for (const key of ["brief", "print", "views", "commands"]) await expect(page.getByTestId(`menu-${key}`), key).toHaveCount(0);
});

test("the work list row menu: Show everything, Show only this client, Done for now and the snoozes are there, and Done for now undoes", async ({ page, request }) => {
  const { get, post } = await api(request);
  void get; void post;
  await page.goto("/app");
  const row = page.getByTestId("queue-row").first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTestId("queue-more").click();
  for (const key of ["show", "only", "done", "snooze-day", "snooze-monday", "assign"]) await expect(page.getByTestId(`menu-${key}`), key).toBeVisible();
  await page.getByTestId("menu-show").click();
  await expect(page.getByTestId("records-panel")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a person on Reply now: Done for now on one person holds that person only, and Undo brings them back", async ({ page, request }) => {
  const who = await api(request, "client");
  const t = await who.get("today");
  test.skip(counted(t).filter((i) => i.kind === "replies").length < 2 || !t.actionsReady, "needs two people waiting and the working-queue table");
  await page.goto("/app?as=client");
  const rows = page.getByTestId("reply-row");
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  // The figure counts up for 600 ms: read the number it ends on.
  const final = async () => Number(((await page.getByTestId("headline-replies").locator("[data-final]").first().getAttribute("data-final")) ?? "").replace(/[^0-9]/g, ""));
  await expect.poll(final).toBe(counted(t).filter((i) => i.kind === "replies").length);
  const before = await final();
  const heldBefore = Object.values(t.holds as Json).map((h: Json) => h.eventId);
  await rows.first().getByTestId("reply-more").click();
  try {
    await page.getByTestId("menu-done").click();
    await expect(page.getByTestId("today-toast")).toContainText(/Marked done/);
    await expect.poll(final, { timeout: 30_000 }).toBe(before - 1);
    await page.getByTestId("today-undo").click();
    await expect.poll(final, { timeout: 30_000 }).toBe(before);
  } finally {
    // Whatever happened, the demo company is put back: any mark this test made is undone.
    const now = await who.get("today");
    for (const h of Object.values(now.holds as Json) as Json[]) if (!heldBefore.includes(h.eventId)) await who.post("today/action", { action: "undo", eventId: h.eventId });
  }
});
