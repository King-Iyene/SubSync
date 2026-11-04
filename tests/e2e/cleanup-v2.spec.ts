import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// Clean-up, version 2 (stage CLEANUP; docs/features/CLEANUP.md), on the demo company, for the four roles and the three widths of the projects:
//   one menu entry, old addresses on the right tab, the match score with its reasons, a setting that changes the groups (shown before saving), data quality with a
//   count that equals the rows behind it, a check of a pasted file, the history, and a phone with no sideways scroll.
// The demo is slow (every call signs in again), so the waits are long. Nothing here changes a contact; every decision a test records is undone.
const ROLES = [
  { name: "agency, all accounts", path: "/app#cleanup", slug: "agency-all", tabs: ["Duplicates", "Data quality", "History", "Rules"], multi: true },
  { name: "agency, inside one account", path: "/app?as=location", slug: "agency-account", tabs: ["Duplicates", "Data quality", "History", "Rules"], multi: false, menu: true },
  { name: "a client's staff", path: "/app?as=client#duplicates", slug: "client-staff", tabs: ["Duplicates", "History"], multi: false },
  { name: "a business owner", path: "/app?as=business#cleanup", slug: "business-owner", tabs: ["Duplicates", "Data quality", "History", "Rules"], multi: false },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;
const width = (testInfo: { project: { name: string } }) => testInfo.project.name.split("-")[1];

async function openApp(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "Clean-up", exact: true }).first().click({ timeout: 180_000 });
  else await page.reload();
  await expect(page.getByRole("heading", { name: "Clean-up", level: 1 })).toBeVisible({ timeout: 180_000 });
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const noSideways = async (page: Page) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
};
const shot = async (page: Page, slug: string, testInfo: { project: { name: string } }, extra = "") => {
  mkdirSync("docs/review", { recursive: true });
  await page.screenshot({ path: `docs/review/cleanup-${slug}${extra}-${width(testInfo)}.png`, fullPage: false });
};

for (const role of ROLES) {
  test(`${role.name}: the right tabs, plain words, a score and its reasons, no sideways scroll`, async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    await openApp(page, role.path, "menu" in role && role.menu === true);
    for (const t of role.tabs) await expect(tab(page, t)).toBeVisible();
    if (role.tabs.length === 2) { await expect(tab(page, "Data quality")).toHaveCount(0); await expect(tab(page, "Rules")).toHaveCount(0); }
    // The Duplicates tab: the match score and why, in words.
    await tab(page, "Duplicates").click();
    await expect(page.getByTestId("dup-headline")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("dup-question")).toHaveText("Are these the same person?");
    await expect(page.getByTestId("dup-meter")).toBeVisible();
    await expect(page.getByTestId("dup-reason-line")).toBeVisible();
    await page.getByTestId("dup-how").locator("summary").first().click();
    await expect(page.getByTestId("dup-score")).toBeVisible();
    await expect(page.getByTestId("dup-score-n")).toHaveText(/^\d{1,3}$/);
    await expect(page.getByTestId("dup-reasons").locator("li").first()).toBeVisible();
    await expect(page.getByTestId("dup-rules-note")).toContainText(/How careful we are: (Careful|Normal|Thorough|Your own mix)/);
    if (role.multi) await expect(page.getByTestId("dup-clients")).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    await noSideways(page);
    if (role.tabs.length === 4) {
      await tab(page, "Data quality").click();
      await expect(page.getByTestId("quality-tab")).toBeVisible({ timeout: 180_000 });
      await expect(page.getByTestId(role.multi ? "quality-score-n" : "quality-account-score-n")).toHaveText(/^\d{1,3}$/, { timeout: 180_000 });
      expect(await page.locator("main").innerText()).not.toMatch(BANNED);
      await noSideways(page);
      await shot(page, role.slug, testInfo);
    } else {
      await shot(page, role.slug, testInfo);
    }
  });
}

test("the menu has one Clean-up entry, and the old addresses open the right tab", async ({ page }, testInfo) => {
  test.skip(width(testInfo) !== "1440", "the side menu is a desktop element; the tabs are checked at every width above");
  test.setTimeout(600_000);
  await page.goto("/app#cleanup");
  await expect(page.getByRole("heading", { name: "Clean-up", level: 1 })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Clean-up", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Duplicates", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Data cleanup", exact: true })).toHaveCount(0);
  await expect(tab(page, "Data quality")).toHaveAttribute("aria-selected", "true");
  await page.goto("/app#duplicates");
  await page.reload();
  await expect(tab(page, "Duplicates")).toHaveAttribute("aria-selected", "true", { timeout: 180_000 });
  await page.goto("/app?as=client#duplicates");
  await page.reload();
  await expect(page.getByRole("button", { name: "Clean-up", exact: true })).toHaveCount(1, { timeout: 180_000 });
});

test("a setting changes the groups, and the page says so before anything is saved", async ({ page, request }, testInfo) => {
  test.skip(width(testInfo) === "390", "checked at the wider widths; the phone layout is checked in the role tests");
  test.setTimeout(600_000);
  await openApp(page, "/app#cleanup");
  await tab(page, "Rules").click();
  await expect(page.getByTestId("rules-editor")).toBeVisible({ timeout: 180_000 });
  const groups = async () => Number((await page.getByTestId("rules-effect-groups").innerText()).replace(/,/g, ""));
  await page.getByTestId("preset-strict").check();
  await expect(page.getByTestId("rules-effect")).toBeVisible({ timeout: 180_000 });
  const strict = await groups();
  await page.getByTestId("preset-loose").check();
  await expect.poll(groups, { timeout: 180_000 }).toBeGreaterThan(strict);
  await page.getByTestId("preset-balanced").check();
  await expect(page.getByTestId("rules-effect")).toContainText("the same as now", { timeout: 180_000 });
  const a = await api(request);
  const view = await a.get("cleanup/rules");
  expect(view.selected.preset, "looking changed nothing").toBe("balanced");
  await expect(page.getByTestId("workflow-steps").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("prevent-recipe").locator("li")).toHaveCount(5);
  if (width(testInfo) === "1440") await shot(page, "agency-all", testInfo, "-rules");
});

test("data quality: the count on a row equals the rows behind it, and a pasted file is checked", async ({ page, request }, testInfo) => {
  test.skip(width(testInfo) === "390", "the phone layout is checked in the role tests");
  test.setTimeout(600_000);
  await openApp(page, "/app#cleanup");
  await expect(page.getByTestId("quality-score-n")).toBeVisible({ timeout: 180_000 });
  const clients = page.getByTestId("quality-client");
  expect(await clients.count(), "top five").toBeLessThanOrEqual(5);
  await expect(page.getByTestId("quality-see-all")).toBeVisible();
  await clients.first().getByTestId("quality-open").click();
  await expect(page.getByTestId("quality-account")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("quality-account-score-n")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("quality-parts").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("fix-card")).toHaveCount(3);
  await expect(page.getByTestId("fix-card").first().getByTestId("fix-card-count")).toHaveText(/^[\d,]+$/);
  // The same number through the page and through the API: the row says N and the list behind it holds N.
  const finding = page.locator('[data-testid="quality-finding"][data-finding="bad_email"]');
  await expect(finding).toBeVisible();
  const n = Number((await finding.getByTestId("finding-count").innerText()).replace(/,/g, ""));
  await finding.getByTestId("finding-show").click();
  await expect(page.getByTestId("records-panel")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("records-count")).toContainText(String(n));
  expect(await page.getByTestId("records-row").count(), "the rows equal the count (50 a page)").toBe(Math.min(n, 50));
  expect(await page.getByTestId("records-panel").locator('[data-testid="records-crm"]').count()).toBeGreaterThan(0);
  await page.getByTestId("records-close").click();
  const a = await api(request);
  const q = await a.get("cleanup/quality");
  const loc = (q.accounts.rows as Json[])[0].locationId as string;
  const one = await a.get(`cleanup/quality?account=${loc}`);
  for (const f of (one.findings as Json[]).slice(0, 4)) {
    const l = await a.get(`cleanup/quality/list?account=${loc}&finding=${f.id}`);
    expect(l.rows.length, `rows behind ${f.id}`).toBe(Math.min(f.count, 500));
    expect(l.count).toBe(f.count);
  }
  // The fixes as a CSV.
  await expect(page.getByTestId("finding-csv").first()).toBeVisible();
  // Check a file before importing: the first contact of the demo account is already there.
  const csv = "Name,Email,Phone\nSomeone New,someone.new@brand-new.example.net,\nNobody,not-an-email,";
  await page.getByTestId("import-text").fill(csv);
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-summary")).toContainText("of 2 are new", { timeout: 180_000 });
  await expect(page.getByTestId("import-rows").locator('[data-verdict="invalid"]')).toHaveCount(1);
  expect(await page.locator("main").innerText()).not.toMatch(BANNED);
});

test("history lists a decision with who and when, and takes it back", async ({ page }, testInfo) => {
  test.skip(width(testInfo) !== "1440", "one width is enough: the decision is recorded once");
  test.setTimeout(600_000);
  await openApp(page, "/app#duplicates");
  await expect(page.getByTestId("dup-step")).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("dup-not-dup").click();
  await expect(page.getByTestId("dup-toast")).toBeVisible({ timeout: 180_000 });
  await tab(page, "History").click();
  await expect(page.getByTestId("history-tab")).toBeVisible({ timeout: 180_000 });
  const first = page.getByTestId("history-row").first();
  await expect(first).toContainText(/not a duplicate/i, { timeout: 180_000 });
  await expect(first).toContainText(/Demo|Someone/);
  await first.getByTestId("history-undo").click();
  await expect(page.getByTestId("history-list").getByTestId("history-undo")).toHaveCount(0, { timeout: 180_000 });
  await page.getByTestId("history-kind").selectOption("decision");
  await expect(page.getByTestId("history-row").first()).toBeVisible();
  await shot(page, "agency-all", testInfo, "-history");
});

test("merging from SubSync explains every limit and sends nothing while the server switch is off", async ({ page }, testInfo) => {
  test.skip(width(testInfo) !== "1440", "one width is enough: nothing is recorded as a decision");
  test.setTimeout(600_000);
  await openApp(page, "/app#duplicates");
  await expect(page.getByTestId("dup-step")).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("dup-merge").click();
  const ack = page.getByTestId("dup-ack");
  if (await ack.count()) await ack.click();
  await expect(page.getByTestId("dup-sheet")).toBeVisible();
  await expect(page.getByTestId("dup-picks").or(page.getByTestId("dup-plan"))).toBeVisible();
  await page.getByTestId("dup-workflow-open").click();
  // The demo account has no merge workflow set up, so the page says what to do and offers no button that could send anything.
  await expect(page.getByTestId("dup-workflow-blockers")).toContainText(/no merge workflow/i);
  await expect(page.getByTestId("dup-workflow-run")).toHaveCount(0);
});
