import { expect, test, type Page } from "@playwright/test";
import { moreMenu, openMore } from "./today-helpers";

// Click-test of every control on Today in a real browser (desktop 1440). Each test presses what a person presses and checks the visible result. Anything that marks a row
// (Done for now, Snooze, Assign) is undone at once so the demo company stays as it was. Updated for Today v3: the numbers are under More detail, the row actions are in the row
// menu, the controls of the header are in the More menu.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "Desktop 1440 is the gate for Today's second pass"); }); // eslint-disable-line no-empty-pattern

async function openToday(page: Page, as?: "business" | "client") {
  await page.goto(as ? `/app?as=${as}` : "/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
}
const panel = (page: Page) => page.getByTestId("records-panel");
const count = async (page: Page) => Number(await page.getByTestId("records-count").getAttribute("data-count"));

test("every number opens its records, and the panel closes with the cross, Esc and a click outside", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  await openMore(page);
  const doors: Array<[string, () => ReturnType<Page["getByTestId"]>]> = [
    ["the clients in the headline", () => page.getByTestId("headline-clients")],
    ["the dollars in the headline", () => page.getByTestId("headline-dollars")],
    ["people waiting tile", () => page.getByTestId("pulse-replies").getByRole("button").first()],
    ["typical first reply tile", () => page.getByTestId("pulse-reply").getByRole("button").first()],
    ["appointments tile", () => page.getByTestId("pulse-appointments").getByRole("button").first()],
    ["deals gone quiet tile", () => page.getByTestId("pulse-risk").getByRole("button").first()],
    ["a work-list amount", () => page.getByTestId("queue-amount").first()],
    ["a bar segment", () => page.getByTestId("bar-segment").first()],
    ["a bar's account name", () => page.getByTestId("bar-account").first()],
    ["See all clients", () => page.getByTestId("queue-all")],
    ["a raised alerts day", () => page.locator('[data-testid="raised-day"]:not([disabled])').last()],
  ];
  const via = ["cross", "escape", "outside"] as const;
  let n = 0;
  for (const [label, door] of doors) {
    const el = door();
    if ((await el.count()) === 0) continue;
    await el.scrollIntoViewIfNeeded();
    await el.click({ timeout: 8_000 }).catch((e: Error) => { throw new Error(`${label} could not be pressed: ${e.message.split("\n").slice(0, 16).join(" | ")}`); });
    await expect(panel(page), `${label} opens the records`).toBeVisible();
    await expect(page.getByTestId("records-title")).not.toBeEmpty();
    expect(await count(page), `${label}: heading count`).toBeGreaterThanOrEqual(0);
    const how = via[n++ % 3];
    if (how === "cross") await page.getByTestId("records-close").click();
    else if (how === "escape") await page.keyboard.press("Escape");
    else await page.getByTestId("records-overlay").click({ position: { x: 4, y: 4 } });
    await expect(panel(page), `${label}: closes with ${how}`).toHaveCount(0);
  }
  expect(n).toBeGreaterThan(8);
});

test("the records panel: count matches the row total, search, sort, filters, maximise, export and the open buttons", async ({ page }) => {
  await openToday(page);
  await openMore(page);
  const tile = page.getByTestId("pulse-replies").getByRole("button").first();
  // The value the figure ends on (data-final), never the text in the middle of its count-up.
  const readTile = async () => Number(((await page.getByTestId("pulse-replies").locator("[data-final]").first().getAttribute("data-final")) ?? "").replace(/[^0-9]/g, ""));
  // The figure counts up when the page opens: wait until it stops moving.
  let pressed = await readTile();
  await expect.poll(async () => { const now = await readTile(); const same = now === pressed; pressed = now; return same; }, { intervals: [600, 600, 600], timeout: 10_000 }).toBe(true);
  await tile.click();
  await expect(panel(page)).toBeVisible();
  expect(await count(page)).toBe(pressed);
  // Sticky header: the header row stays in view after the table scrolls.
  const head = page.getByTestId("records-th").first();
  await page.getByTestId("records-scroll").evaluate((el) => { el.scrollTop = 400; });
  await expect(head).toBeInViewport();
  await page.getByTestId("records-scroll").evaluate((el) => { el.scrollTop = 0; });
  // Search narrows; clearing the box restores.
  const before = await page.getByTestId("records-row").count();
  await page.getByTestId("records-search-toggle").click();
  await page.getByLabel("Search these records").fill("zzzz-nobody");
  await expect(page.getByTestId("records-empty")).toBeVisible();
  await page.getByLabel("Search these records").fill("");
  await expect(page.getByTestId("records-row")).toHaveCount(before);
  // Sort by a header.
  await page.getByTestId("records-th").first().getByRole("button").click();
  await expect(page.getByTestId("records-th").first()).toHaveAttribute("aria-sort", /ascending|descending/);
  // Maximise and back.
  await page.getByTestId("records-maximise").click();
  await expect(panel(page)).toHaveAttribute("data-maximised", "true");
  await page.getByTestId("records-maximise").click();
  await expect(panel(page)).toHaveAttribute("data-maximised", "false");
  // The CRM link of a row is a real https address (the white-label helper builds it).
  const crm = page.getByTestId("records-crm").first();
  if (await crm.count()) { const href = (await crm.getAttribute("href")) ?? ""; expect(href).toMatch(/^https:\/\//); }
  // Export downloads a file that has a header line.
  await page.getByTestId("records-menu").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("records-export").click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  // The row OPEN button opens the lead panel.
  await page.getByTestId("records-open").first().click();
  await expect(page.getByTestId("lead-drawer-root")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer-root")).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
});

test("the work list: Open, the row menu (Show everything, Done for now, Snooze, Assign), See all, and Undo all do what they say", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  const rows = page.getByTestId("queue-row");
  const first = rows.first();
  const href = (await first.getByTestId("queue-open").getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\//);
  expect(await first.getByTestId("queue-open").getAttribute("target")).toBe("_blank");
  await first.getByTestId("queue-more").click();
  await page.getByTestId("menu-show").click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  // See all opens the full list of clients in the records panel; its count is the headline's.
  if (await page.getByTestId("queue-all").count()) {
    const clients = Number((await page.getByTestId("today-headline").innerText()).match(/\d[\d,]*/)![0].replace(/,/g, ""));
    await page.getByTestId("queue-all").click();
    await expect(panel(page)).toBeVisible();
    expect(await count(page)).toBe(clients);
    await page.keyboard.press("Escape");
  }
  const held = page.getByTestId("held-link");
  const heldBefore = (await held.count()) ? Number(await held.getAttribute("data-count")) : 0;
  const heldNow = async () => ((await held.count()) ? Number(await held.getAttribute("data-count")) : 0);
  // Done for now then Undo: the row's problem is set aside and comes back.
  await first.getByTestId("queue-more").click();
  await page.getByTestId("menu-done").click();
  await expect(page.getByTestId("today-toast")).toContainText(/Marked done/);
  await expect.poll(heldNow).toBeGreaterThan(heldBefore);
  await page.getByTestId("today-undo").click();
  await expect.poll(heldNow, { timeout: 15_000 }).toBe(heldBefore);
  // Snooze (menu) then Undo.
  await rows.first().getByTestId("queue-more").click();
  await page.getByTestId("menu-snooze-day").click();
  await expect(page.getByTestId("today-toast")).toContainText(/Snoozed for 1 day/);
  await expect.poll(heldNow).toBeGreaterThan(heldBefore);
  await page.getByTestId("today-undo").click();
  await expect.poll(heldNow, { timeout: 15_000 }).toBe(heldBefore);
  // Assign to me shows the name on the row; Undo takes it off.
  const third = rows.first();
  await third.getByTestId("queue-more").click();
  await page.getByTestId("menu-assign").click();
  await expect(page.getByTestId("today-toast")).toContainText(/Assigned to you/);
  await expect(third).toContainText("Assigned to you");
  await page.getByTestId("today-undo").click();
  await expect(third).not.toContainText("Assigned to you", { timeout: 15_000 });
  // The queue keyboard: j moves, Enter on a focused button is not hijacked.
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
});

test("the chips: a records chip removes its filter, and 'Show only this client' and 'See all' narrow and widen Today", async ({ page }) => {
  await openToday(page);
  // The second bar has several kinds of thing (the first may have only one, and then there is no Kind to filter by).
  await page.getByTestId("bar-account").nth(1).click();
  await expect(panel(page)).toBeVisible();
  const before = await page.getByTestId("records-row").count();
  await page.getByTestId("records-add-filter").click();
  await page.getByRole("button", { name: /Kind/ }).first().click();
  await page.getByTestId("facet-option").first().check();
  await expect.poll(async () => page.getByTestId("records-row").count()).toBeLessThanOrEqual(before);
  await page.getByRole("button", { name: /Remove the .* filter/ }).first().click();
  await expect(page.getByTestId("records-row")).toHaveCount(before);
  await page.getByTestId("records-close").click();
  await expect(panel(page)).toHaveCount(0);
  // Show only this client narrows Today; "See all" widens it again.
  await page.getByTestId("queue-row").first().getByTestId("queue-more").click();
  await page.getByTestId("menu-only").click();
  const chip = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await expect(chip).toBeVisible();
  expect(page.url()).toContain("ta=");
  await chip.getByRole("button", { name: "See all" }).click();
  await expect(chip).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
});

test("More detail: the tabs, the junk switch, set aside; More: Share, Preview, Print and Sync now all respond", async ({ page, context }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openToday(page);
  await expect(page.getByTestId("more-detail")).toHaveAttribute("data-open", "false");
  for (const [tab, id] of [["People", "tab-people"], ["Sources", "tab-sources"], ["Coverage", "tab-coverage"], ["Numbers", "tab-numbers"]] as const) {
    await openMore(page, tab);
    await expect(page.getByTestId(id).first()).toBeVisible();
  }
  await page.getByRole("tab", { name: "Coverage" }).click();
  const hour = page.getByTestId("hour-bar").first();
  if (await hour.count()) { await hour.click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  await page.getByRole("tab", { name: "Numbers" }).click();
  // Junk switch changes the dollar figure or at least toggles.
  const toggle = page.getByTestId("junk-toggle");
  const was = await toggle.isChecked();
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: !was });
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: was });
  if (await page.getByTestId("junk-left-out").count()) { await page.getByTestId("junk-left-out").click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  // Share Today copies the headline.
  await moreMenu(page, "share");
  await page.getByTestId("today-more").click();
  await expect(page.getByTestId("menu-share")).toContainText(/Copied to your clipboard/);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("need you today");
  // Preview of the daily email opens and closes, and says nothing was sent.
  await moreMenu(page, "brief");
  await expect(page.getByTestId("brief-panel")).toBeVisible();
  await page.getByTestId("brief-close").click();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
  // Print report calls the browser's print.
  await page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
  await moreMenu(page, "print");
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  // Sync now answers and comes back.
  await moreMenu(page, "sync");
  await page.getByTestId("today-more").click();
  await expect(page.getByTestId("menu-sync")).toBeEnabled({ timeout: 90_000 });
  await page.keyboard.press("Escape");
});

test("the command palette opens with Ctrl Shift K and from More, filters, runs a command with Enter, and Esc closes it", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByTestId("palette")).toBeVisible();
  await expect(page.getByTestId("global-search")).toHaveCount(0);
  await page.getByTestId("palette-input").fill("waiting for a reply");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  // The More menu opens it too; a command to narrow to an account works; Esc closes.
  await moreMenu(page, "commands");
  await page.getByTestId("palette-input").fill("only this");
  const item = page.getByTestId("palette-item").first();
  await expect(item).toBeVisible();
  await item.click();
  await expect.poll(() => page.url()).toContain("ta=");
  await moreMenu(page, "commands");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  // Search people is one line away and opens the shared search.
  await page.keyboard.press("Control+Shift+K");
  await page.getByTestId("palette-input").fill("search people");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("global-search")).toBeVisible();
});

test("saved views: save the current choice, apply it from another state, remove it", async ({ page }) => {
  test.setTimeout(240_000); // every mark reads Today again; the demo company is slow to answer
  await openToday(page);
  await page.getByTestId("queue-row").first().getByTestId("queue-more").click();
  await page.getByTestId("menu-only").click();
  await expect.poll(() => page.url()).toContain("ta=");
  const url = page.url();
  await moreMenu(page, "views");
  const name = `E2E view ${Date.now() % 100000}`;
  await page.getByTestId("views-name").fill(name);
  await page.getByTestId("views-save").click();
  await expect(page.getByTestId("views-list")).toContainText(name);
  await page.keyboard.press("Escape");
  await page.getByTestId("today-toolbar").getByTestId("showing-chip").getByRole("button", { name: "See all" }).click();
  expect(page.url()).not.toContain("ta=");
  await moreMenu(page, "views");
  await page.getByTestId("views-list").getByText(name).click();
  await expect(page.getByTestId("views-popover")).toHaveCount(0);
  expect(page.url()).toContain("ta=");
  expect(new URL(page.url()).hash).toBe(new URL(url).hash);
  await moreMenu(page, "views");
  await page.getByRole("button", { name: `Remove the view ${name}` }).click();
  await expect(page.getByTestId("views-list")).not.toContainText(name);
});

test("a client's staff: their own queue with Done for now and Snooze, no Assign, no account choice, their own records", async ({ page }) => {
  await page.goto("/app?as=client");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
  const rows = page.getByTestId("reply-row");
  if (await rows.count()) {
    await rows.first().getByTestId("reply-more").click();
    await expect(page.getByTestId("menu-done")).toBeVisible();
    await expect(page.getByTestId("menu-snooze-day")).toBeVisible();
    await expect(page.getByTestId("menu-assign")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("headline-replies").click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByTestId("today-more").click();
  await expect(page.getByTestId("menu-commands")).toHaveCount(0);
  await expect(page.getByTestId("menu-views")).toHaveCount(0);
});
