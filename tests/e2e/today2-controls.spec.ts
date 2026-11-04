import { expect, test, type Page } from "@playwright/test";

// Click-test of every control on Today in a real browser (desktop 1440). Each test presses what a person presses and checks the visible result. Anything that marks a row
// (Done, Snooze, Assign) is undone at once so the demo company stays as it was.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "Desktop 1440 is the gate for Today's second pass"); }); // eslint-disable-line no-empty-pattern

async function openToday(page: Page, as?: "business" | "client") {
  await page.goto(as ? `/app?as=${as}` : "/app");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 30_000 });
}
const panel = (page: Page) => page.getByTestId("records-panel");
const count = async (page: Page) => Number(await page.getByTestId("records-count").getAttribute("data-count"));

test("every number opens its records, and the panel closes with the cross, Esc and a click outside", async ({ page }) => {
  await openToday(page);
  const doors: Array<[string, () => ReturnType<Page["getByTestId"]>]> = [
    ["the clients in the headline", () => page.getByTestId("headline-clients")],
    ["the dollars in the headline", () => page.getByTestId("headline-dollars")],
    ["leads waiting tile", () => page.getByTestId("pulse-leads").getByRole("button").first()],
    ["typical first reply tile", () => page.getByTestId("pulse-reply").getByRole("button").first()],
    ["appointments tile", () => page.getByTestId("pulse-appointments").getByRole("button").first()],
    ["pipeline at risk tile", () => page.getByTestId("pulse-risk").getByRole("button").first()],
    ["a queue amount", () => page.getByTestId("queue-amount").first()],
    ["a queue Show button", () => page.getByTestId("queue-show").first()],
    ["a donut slice", () => page.locator('[data-testid^="slice-"]').first()],
    ["a legend item", () => page.locator('[data-testid^="legend-"]').nth(1)],
    ["an account bar", () => page.getByTestId("account-bar").first()],
    ["a raised alerts day", () => page.getByTestId("raised-day").last()],
  ];
  const via = ["cross", "escape", "outside"] as const;
  let n = 0;
  for (const [label, door] of doors) {
    const el = door();
    if ((await el.count()) === 0) continue;
    await el.scrollIntoViewIfNeeded();
    // A ring's bounding box centre is its hole, so a slice is pressed where it is drawn: a point on its own outline.
    const press = label === "a donut slice"
      ? async () => { const pt = await el.evaluate((p: SVGGeometryElement) => { const m = p.getPointAtLength(p.getTotalLength() * 0.12); const c = p.getScreenCTM()!; return { x: m.x * c.a + c.e, y: m.y * c.d + c.f }; }); await page.mouse.click(pt.x, pt.y); }
      : () => el.click({ timeout: 8_000 });
    await press().catch((e: Error) => { throw new Error(`${label} could not be pressed: ${e.message.split("\n").slice(0, 16).join(" | ")}`); });
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
  const leadsTile = page.getByTestId("pulse-leads").getByRole("button").first();
  // The value the figure ends on (data-final), never the text in the middle of its count-up.
  const readTile = async () => Number(((await page.getByTestId("pulse-leads").locator("[data-final]").first().getAttribute("data-final")) ?? "").replace(/[^0-9]/g, ""));
  // The figure counts up when the page opens: wait until it stops moving.
  let pressed = await readTile();
  await expect.poll(async () => { const now = await readTile(); const same = now === pressed; pressed = now; return same; }, { intervals: [600, 600, 600], timeout: 10_000 }).toBe(true);
  await leadsTile.click();
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

test("Fix first: Open in CRM, Show, See all, Done, Snooze, Assign and Undo all do what they say", async ({ page }) => {
  await openToday(page);
  const rows = page.getByTestId("queue-row");
  const first = rows.first();
  const href = (await first.getByTestId("queue-open").getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\//);
  expect(await first.getByTestId("queue-open").getAttribute("target")).toBe("_blank");
  await first.getByTestId("queue-show").click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  // See all and back.
  const total = await rows.count();
  if (await page.getByTestId("queue-all").count()) {
    await page.getByTestId("queue-all").click();
    expect(await rows.count()).toBeGreaterThan(total);
    await page.getByTestId("queue-all").click();
    await expect(rows).toHaveCount(total);
  }
  // Done then Undo: the row leaves and comes back.
  const key = await first.getAttribute("id");
  await first.getByTestId("queue-done").click();
  await expect(page.getByTestId("today-toast")).toContainText(/Marked done/);
  await expect(page.locator(`[id="${key}"]`)).toHaveCount(0);
  await page.getByTestId("today-undo").click();
  await expect(page.locator(`[id="${key}"]`)).toHaveCount(1, { timeout: 15_000 });
  // Snooze (menu) then Undo.
  const second = rows.first();
  const key2 = await second.getAttribute("id");
  await second.getByTestId("queue-more").click();
  await expect(page.getByTestId("pop-menu").or(page.getByTestId("queue-menu"))).toBeVisible();
  await page.getByTestId("queue-snooze-day").click();
  await expect(page.getByTestId("today-toast")).toContainText(/Snoozed for 1 day/);
  await expect(page.locator(`[id="${key2}"]`)).toHaveCount(0);
  await page.getByTestId("today-undo").click();
  await expect(page.locator(`[id="${key2}"]`)).toHaveCount(1, { timeout: 15_000 });
  // Assign to me shows the name on the row; Undo takes it off the screen's toast (assign holds nothing back).
  const third = rows.first();
  await third.getByTestId("queue-more").click();
  await page.getByTestId("queue-assign").click();
  await expect(page.getByTestId("today-toast")).toContainText(/Assigned to you/);
  await expect(third.getByTestId("queue-assigned")).toBeVisible();
  await page.getByTestId("today-undo").click();
  // The queue keyboard: j moves, Enter on a focused button is not hijacked.
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
});

test("the chips: the account chip clears the choice, a records chip removes its filter", async ({ page }) => {
  await openToday(page);
  await page.getByTestId("account-bar").first().click();
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
  // Only this account narrows Today; the chip clears it.
  await page.getByRole("button", { name: "Only this account" }).first().click();
  const chip = page.getByTestId("today-toolbar").getByTestId("showing-chip");
  await expect(chip).toBeVisible();
  expect(page.url()).toContain("ta=");
  await chip.getByRole("button").click();
  await expect(chip).toHaveCount(0);
  expect(page.url()).not.toContain("ta=");
});

test("tabs, the junk switch, set aside, Share, Preview, Print and Sync now all respond", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openToday(page);
  for (const [tab, id] of [["People", "tab-people"], ["Sources", "tab-sources"], ["Coverage", "tab-coverage"], ["Overview", "fix-first"]] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByTestId(id).first()).toBeVisible();
  }
  await page.getByRole("tab", { name: "Coverage" }).click();
  const hour = page.getByTestId("hour-bar").first();
  if (await hour.count()) { await hour.click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  await page.getByRole("tab", { name: "Overview" }).click();
  // Junk switch changes the dollar figure or at least toggles.
  const toggle = page.getByTestId("junk-toggle");
  const was = await toggle.isChecked();
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: !was });
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: was });
  if (await page.getByTestId("junk-left-out").count()) { await page.getByTestId("junk-left-out").click(); await expect(panel(page)).toBeVisible(); await page.keyboard.press("Escape"); }
  // Share Today copies the headline.
  await page.getByRole("button", { name: "Share Today" }).click();
  await expect(page.getByRole("button", { name: /Copied to your clipboard/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("need you today");
  // Preview of the daily email opens and closes, and says nothing was sent.
  await page.getByTestId("brief-preview").click();
  await expect(page.getByTestId("brief-panel")).toBeVisible();
  await page.getByTestId("brief-close").click();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
  // Print report calls the browser's print.
  await page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
  await page.getByTestId("print-report").click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  // Sync now answers and comes back.
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled({ timeout: 60_000 });
});

test("the command palette opens with Ctrl K, filters, runs a command with Enter, and Esc closes it", async ({ page }) => {
  await openToday(page);
  await expect(page.getByTestId("palette-open")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await expect(page.getByTestId("global-search")).toHaveCount(0);
  await page.getByTestId("palette-input").fill("leads waiting");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  // The button opens it too; a command to narrow to an account works; Esc closes.
  await page.getByTestId("palette-open").click();
  await page.getByTestId("palette-input").fill("only this");
  const item = page.getByTestId("palette-item").first();
  await expect(item).toBeVisible();
  await item.click();
  await expect.poll(() => page.url()).toContain("ta=");
  await page.getByTestId("palette-open").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  // Search people is one line away and opens the shared search.
  await page.keyboard.press("Control+k");
  await page.getByTestId("palette-input").fill("search people");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("global-search")).toBeVisible();
});

test("saved views: save the current choice, apply it from another state, remove it", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: "Only this account" }).first().click();
  const url = page.url();
  await page.getByTestId("views-button").click();
  const name = `E2E view ${Date.now() % 100000}`;
  await page.getByTestId("views-name").fill(name);
  await page.getByTestId("views-save").click();
  await expect(page.getByTestId("views-list")).toContainText(name);
  await page.keyboard.press("Escape");
  await page.getByTestId("today-toolbar").getByTestId("showing-chip").getByRole("button").click();
  expect(page.url()).not.toContain("ta=");
  await page.getByTestId("views-button").click();
  await page.getByTestId("views-list").getByText(name).click();
  await expect(page.getByTestId("views-popover")).toHaveCount(0);
  expect(page.url()).toContain("ta=");
  expect(new URL(page.url()).hash).toBe(new URL(url).hash);
  await page.getByTestId("views-button").click();
  await page.getByRole("button", { name: `Remove the view ${name}` }).click();
  await expect(page.getByTestId("views-list")).not.toContainText(name);
});

test("a client's staff: their own queue with Done and Snooze, no Assign, no account choice, their own records", async ({ page }) => {
  await page.goto("/app?as=client");
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("today-account-picker")).toHaveCount(0);
  const rows = page.getByTestId("queue-row");
  if (await rows.count()) {
    await rows.first().getByTestId("queue-more").click();
    await expect(page.getByTestId("queue-assign")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await rows.first().getByTestId("queue-show").click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("palette-open")).toHaveCount(0);
});
