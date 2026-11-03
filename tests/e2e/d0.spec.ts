import { expect, test, type Page } from "@playwright/test";

// D0: the style guide at /design, the shared components on the M1 pages, and the layout at the three widths (390, 768 and 1440 px, one per project).
// The rule for every page: no sideways scroll. The demo company has sample data, so these tests read what is on screen and check the structure.
const M1 = [
  ["today", "Today"], ["speed", "Speed to lead"], ["appointments", "Appointments"], ["audit", "Account audit"], ["overview", "Overview"],
] as const;

async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}

test("the style guide opens without signing in, says it awaits approval, and every colour pair passes in dark and light", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/design");
  await expect(page.getByRole("heading", { level: 1, name: "SubSync style guide" })).toBeVisible();
  await expect(page.getByText("Style awaiting King's approval")).toBeVisible();
  await expect(page.getByText("Sample data only")).toBeVisible();
  await noSideScroll(page, "/design");
  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: theme, exact: true }).click();
    await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", theme.toLowerCase());
    await expect.poll(async () => page.locator('[data-testid="contrast-ratio"]').count()).toBeGreaterThan(15);
    const fails = await page.locator('[data-testid="contrast-ratio"][data-pass="false"]').count();
    expect(fails, `${theme}: colour pairs below the required contrast`).toBe(0);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the style guide shows the plain status words and notices: no pill, dot, tint or icon", async ({ page }) => {
  await page.goto("/design");
  const badges = page.getByTestId("badge-examples").locator("[data-tone]");
  expect(await badges.count()).toBeGreaterThanOrEqual(5);
  for (const b of await badges.all()) {
    const css = await b.evaluate((el) => { const s = getComputedStyle(el); return { radius: s.borderTopLeftRadius, bg: s.backgroundColor, left: s.borderLeftWidth }; });
    expect(css.radius, "no pill").toBe("0px");
    expect(css.bg, "no tint").toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(css.left, "a thin rule").toBe("2px");
  }
  for (const a of await page.getByTestId("inline-alert").all()) {
    expect(await a.locator("svg").count(), "a notice has no icon").toBe(0);
    expect(await a.evaluate((el) => getComputedStyle(el).backgroundColor), "no tinted box").toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  }
});

test("the style guide's list, lead panel and charts work", async ({ page }) => {
  await page.goto("/design");
  const list = page.getByTestId("data-list").first();
  await expect(list).toHaveAttribute("data-mode", "preview");
  await expect(list.getByTestId("list-range")).toHaveText("Showing 10 of 37");
  await list.getByRole("button", { name: "View all 37" }).click();
  await expect(list.getByTestId("list-range")).toHaveText("Showing 1 to 25 of 37");
  await list.getByRole("button", { name: "Next page" }).click();
  await expect(list.getByTestId("list-range")).toHaveText("Showing 26 to 37 of 37");
  await list.getByRole("button", { name: "Show fewer" }).click();
  // The lead panel: opens from a name, steps with the arrows, closes with Escape.
  await list.getByRole("button", { name: /\w+ \w+/ }).first().click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("drawer-position")).toHaveText("1 of 37");
  await expect(drawer.getByRole("button", { name: "Previous lead" })).toBeDisabled();
  await drawer.getByRole("button", { name: "Next lead" }).click();
  await expect(page.getByTestId("drawer-position")).toHaveText("2 of 37");
  await expect(drawer.getByRole("link", { name: "Open in your CRM" })).toBeVisible();
  await noSideScroll(page, "/design with the lead panel open");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // A bar shows its tooltip on focus; the chart under its minimum is one placeholder.
  await page.getByTestId("bar-chart").first().getByRole("button").nth(1).focus();
  await expect(page.getByRole("tooltip").first()).toBeVisible();
  await expect(page.getByTestId("chart-placeholder")).toContainText("at least 5 replies");
});

test("a company's own colour sits on top and stays readable", async ({ page }) => {
  await page.goto("/design");
  const before = await page.locator("[data-theme]").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim());
  await page.getByRole("button", { name: "Use #02244f" }).click();
  const after = await page.locator("[data-theme]").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim());
  expect(after).not.toBe(before);
  await expect(page.getByText("Nudged so text stays readable.")).toBeVisible(); // a navy brand colour is too dark for text on the dark theme
  expect(await page.locator('[data-testid="contrast-ratio"][data-pass="false"]').count()).toBe(0);
});

for (const [hash, heading] of M1) {
  test(`${heading} (#${hash}) has no sideways scroll, one title, and uses the shared page`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/app#${hash}`);
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("page")).toHaveCount(1);
    await expect(page.getByTestId("freshness")).toHaveCount(1);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await noSideScroll(page, heading);
    // The subtitle is short enough to read: at most two lines.
    const sub = page.getByTestId("page-subtitle");
    if (await sub.count()) expect((await sub.innerText()).length).toBeLessThanOrEqual(130);
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("Speed to lead: ten rows and View all, a name opens the lead panel, the badges are plain words", async ({ page }) => {
  await page.goto("/app#speed");
  await page.reload();
  const list = page.getByTestId("data-list").first();
  await expect(list).toBeVisible({ timeout: 60_000 });
  const rows = await list.locator("ul > li").count();
  expect(rows).toBeLessThanOrEqual(10);
  const badge = list.locator("[data-tone='bad']").first();
  await expect(badge).toContainText(/never answered|waiting/);
  expect(await badge.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
  if (await list.getByRole("button", { name: /^View all/ }).count()) {
    await list.getByRole("button", { name: /^View all/ }).click();
    await expect(list).toHaveAttribute("data-mode", "all");
    await noSideScroll(page, "Speed to lead, full list");
    await list.getByRole("button", { name: "Show fewer" }).click();
  }
  await list.locator("ul > li button").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer")).toBeHidden();
});

test("a filter is carried in the address and survives a reload", async ({ page }) => {
  await page.goto("/app#speed");
  const drawer = page.getByTestId("filter-drawer");
  await expect(drawer).toBeVisible({ timeout: 60_000 });
  await drawer.getByText("Filter accounts").click();
  // The demo company has no test account, so the owner choice stands in for any filter: it goes into the address and the page says what is hidden.
  await drawer.getByLabel("Account owner").selectOption({ index: 1 });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#speed\?.*owner=/);
  await expect(page.getByTestId("filter-hidden-summary")).toContainText("are shown");
  await page.getByTestId("filter-hidden-summary").getByRole("button", { name: "Show all" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#speed");
  await drawer.getByLabel("Account owner").selectOption({ index: 1 });
  await page.reload();
  await expect(page.getByTestId("filter-drawer").getByText("Filter accounts (on)")).toBeVisible({ timeout: 60_000 });
});

test("Back goes to where you came from, with the browser's Back button too", async ({ page }) => {
  await page.goto("/app#audit");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Account audit" })).toBeVisible({ timeout: 60_000 });
  const open = page.getByRole("button", { name: /^Open in / }).first();
  await open.waitFor({ timeout: 60_000 }).catch(() => undefined); // the title shows while the findings are still loading
  test.skip(!(await open.count()), "the audit has no finding to open on this data");
  await open.click();
  const back = page.getByTestId("back-link");
  await expect(back).toContainText("Back to Account audit");
  await back.click();
  await expect(page.getByRole("heading", { level: 1, name: "Account audit" })).toBeVisible();
  await expect(page.getByTestId("back-link")).toHaveCount(0);
  await page.getByRole("button", { name: /^Open in / }).first().click();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Account audit" })).toBeVisible();
});

test("the light and dark choice changes the page and is remembered", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-1440", "the appearance buttons sit in the desktop menu");
  await page.goto("/app");
  const shell = page.locator("[data-theme]").first();
  await expect(shell).toBeVisible({ timeout: 60_000 });
  await expect(shell).toHaveAttribute("data-theme", "dark"); // the look people had before themes
  const dark = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole("group", { name: "Appearance" }).getByRole("button", { name: "Light appearance" }).click();
  await expect(shell).toHaveAttribute("data-theme", "light");
  expect(await shell.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(dark);
  await page.reload();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light", { timeout: 60_000 });
  await page.getByRole("group", { name: "Appearance" }).getByRole("button", { name: "Dark appearance" }).click(); // leave it as it was
});

test("a client's staff land on My day: one column, large tap targets, no sideways scroll", async ({ page }) => {
  await page.goto("/app?as=client");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "My day", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await noSideScroll(page, "My day");
  const leads = page.getByTestId("myday-leads").getByRole("button");
  for (const b of (await leads.all()).slice(0, 5)) {
    const box = await b.boundingBox();
    expect(box?.height ?? 0, "a lead is at least 44 px tall to tap").toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0); // no settings for a client's staff
});

// ---- KF-2, KF-4, KF-6 ----
test("a chart is clickable: the bar opens the leads behind it, the count is the same everywhere, Back keeps the bar marked, Enter works", async ({ page }) => {
  await page.goto("/design");
  const card = page.getByRole("region", { name: /^List behind/ });
  // The trend chart only: the key-figure strip above it also has buttons that open a list, but those are not bars.
  const bar = page.getByRole("figure").getByRole("button", { name: /open the list/ }).first();
  await bar.scrollIntoViewIfNeeded();
  const label = (await bar.getAttribute("aria-label")) ?? "";
  const count = Number(/(\d+) leads, open the list/.exec(label)?.[1]);
  expect(count).toBeGreaterThan(0);
  await bar.focus();
  await expect(page.getByRole("tooltip").first()).toContainText("Click to see the list");
  await page.keyboard.press("Enter");
  const heading = page.getByTestId("drill-count");
  await expect(heading).toHaveText(String(count));
  await expect(card).toBeVisible();
  // The list holds exactly the leads the bar counts: ten shown, and View all reaches the rest.
  const list = card.getByTestId("data-list");
  await expect(list.getByTestId("list-range")).toHaveText(`Showing ${Math.min(10, count)} of ${count}`);
  if (count > 10) {
    await list.getByRole("button", { name: `View all ${count}` }).click();
    await expect(list.getByTestId("list-range")).toContainText(`of ${count}`);
  }
  // A name opens the lead panel, which steps through THIS list.
  await list.locator("button[data-row-primary]").first().click();
  await expect(page.getByTestId("drawer-position")).toHaveText(`1 of ${count}`);
  await page.keyboard.press("Escape");
  // Back to the chart: the list closes and the bar stays marked.
  await page.getByTestId("drill-back").click();
  await expect(page.getByTestId("drill-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show the list" }).click();
  await expect(page.getByTestId("drill-count")).toHaveText(String(count));
  await noSideScroll(page, "/design with a drilled list");
});

test("a card has its own range: the window is stated in words, carried in the address, remembered, and a bad range is refused in words", async ({ page }) => {
  await page.goto("/design#design");
  const range = page.getByTestId("card-range").first();
  await expect(range.getByTestId("card-range-window")).toContainText("Last 90 days", { timeout: 30_000 });
  await expect(range.getByTestId("card-range-window")).toContainText("compared with");
  await range.getByLabel("Replies by week: range").selectOption("7d");
  await expect(range.getByTestId("card-range-window")).toContainText("Last 7 days");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain("r.design-trend=7d.prev");
  await range.getByLabel("Replies by week: compare with").selectOption("none");
  await expect(range.getByTestId("card-range-window")).not.toContainText("compared with");
  await range.getByLabel("Replies by week: range").selectOption("custom");
  await range.getByLabel("Replies by week: from").fill("2026-12-30");
  await range.getByLabel("Replies by week: to").fill("2026-12-01");
  await expect(range.getByRole("status")).toContainText("end date is before the start date");
  // The choice survives a reload from the address, and from this browser's memory when the address has none.
  await range.getByLabel("Replies by week: range").selectOption("30d");
  await page.reload();
  await expect(page.getByTestId("card-range").first().getByTestId("card-range-window")).toContainText("Last 30 days", { timeout: 30_000 });
  await page.goto("/design");
  await expect(page.getByTestId("card-range").first().getByTestId("card-range-window")).toContainText("Last 30 days", { timeout: 30_000 });
});

test("the filter says WHICH client accounts are in, by name, and which are left out and why", async ({ page }) => {
  await page.goto("/design");
  const scope = page.getByTestId("account-scope").first();
  await scope.scrollIntoViewIfNeeded();
  await expect(scope.getByTestId("account-scope-summary")).toContainText("All 6 client accounts");
  await expect(scope.getByTestId("account-left-out")).toContainText("Left out (1)");
  await scope.getByTestId("account-left-out").getByText("Left out (1)").click();
  await expect(scope.getByTestId("account-left-out")).toContainText("Old Client");
  await expect(scope.getByTestId("account-left-out")).toContainText("set to ignore");
  // Hide the test account: it moves to the left-out list with its reason, and the summary names who is left.
  await page.getByRole("checkbox", { name: "Hide 1 test account" }).first().check();
  await expect(scope.getByTestId("account-scope-summary")).toContainText("5 of 6 client accounts");
  await expect(scope.getByTestId("account-left-out")).toContainText("test account, hidden");
  // Remove one name from the list.
  await scope.getByTestId("account-scope-summary").click();
  await scope.getByRole("button", { name: "Leave out Maple Dental" }).click();
  await expect(scope.getByTestId("account-scope-summary")).toContainText("4 of 6 client accounts");
  await expect(scope.getByTestId("account-left-out")).toContainText("not picked");
});

test("Speed to lead: the bars of the trend are clickable and the list behind a bar has as many leads as the bar counts", async ({ page, request }) => {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const speed = (await (await request.get("/api/app/speed", { headers })).json()) as { trend: Array<{ leads: number; members: unknown[] }> };
  for (const w of speed.trend) expect(w.members.length, "the server sends the rows behind each bar").toBe(Math.min(w.leads, 60));
  await page.goto("/app#speed");
  await page.reload();
  // The trend chart only: the key-figure strip above it also has buttons that open a list, but those are not bars.
  const bar = page.getByRole("figure").getByRole("button", { name: /open the list/ }).first();
  await bar.waitFor({ timeout: 90_000 });
  const label = (await bar.getAttribute("aria-label")) ?? "";
  const count = Number(/(\d+) leads, open the list/.exec(label)?.[1]);
  await bar.click();
  await expect(page.getByTestId("drill-count")).toHaveText(String(count));
  const list = page.getByTestId("drill-panel").getByTestId("data-list");
  await expect(list.getByTestId("list-range")).toHaveText(`Showing ${Math.min(10, count)} of ${count}`);
  await list.locator("button[data-row-primary]").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("drill-back").click();
  await expect(page.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
  await noSideScroll(page, "Speed to lead with the trend list");
});
