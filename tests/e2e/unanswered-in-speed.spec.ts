import { expect, test, type Page } from "@playwright/test";
import { PHONE_ROW_HEIGHT, ROW_HEIGHT } from "../../src/lib/design/list-density";

// Unanswered messages is a tab of Speed to lead (stage merge-speed-waiting). Demo company, so nothing real is read or written. The demo answers slowly, so waits are long.
// Checks: the old #inbox address and the new #speed?tab=unanswered address open the tab; there is no separate menu entry; every number equals the rows its click shows (the headline, the
// segments, every bar of "How long have people waited", the quick chips); the dense list has one row of about 40 pixels on a desktop, two small lines on a phone, a default page of 50 and no
// sideways scroll; the density choice is remembered.
test.setTimeout(300_000);

async function open(page: Page, hash: string) {
  await page.goto(`/app${hash}`);
  await page.reload();
  await expect(page.getByTestId("unanswered-tab")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("wait-list-count")).toBeVisible({ timeout: 180_000 });
}
const num = (t: string | null) => Number((t ?? "").replace(/[^\d]/g, ""));
async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}

test("the old address and the new one open Speed to lead on the Unanswered tab", async ({ page }) => {
  await open(page, "#inbox");
  await expect(page.getByRole("tab", { name: /^Unanswered/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => window.location.hash), "the old address is rewritten to the new one").toContain("tab=unanswered");
  await open(page, "#speed?tab=unanswered");
  await expect(page.getByRole("tab", { name: /^Unanswered/ })).toHaveAttribute("aria-selected", "true");
  // the order: after Coverage
  const names = await page.getByRole("tablist", { name: "Speed to lead sections" }).getByRole("tab").allInnerTexts();
  expect(names.findIndex((x) => x.startsWith("Unanswered")), "Unanswered sits right after Coverage").toBe(names.findIndex((x) => x.startsWith("Coverage")) + 1);
  // no separate menu entry on a desktop
  if (page.viewportSize()!.width >= 1200) await expect(page.getByRole("complementary").getByRole("button", { name: "Unanswered messages", exact: true })).toHaveCount(0);
  await noSideScroll(page, "unanswered tab");
});

test("every number equals the rows its click shows: the headline, the segments, the quick chips and every bar", async ({ page }) => {
  await open(page, "#speed?tab=unanswered");
  const total = num(await page.getByTestId("wait-list-count").textContent());
  expect(total, "the demo has people waiting").toBeGreaterThan(0);
  // the headline number is the list's total (Today and this tab count people by one rule)
  const kpi = num(await page.getByTestId("kpi-waiting").getAttribute("aria-label"));
  expect(kpi).toBe(total);
  await expect(page.getByTestId("sub-queue")).toContainText(String(total));
  // segments: each count is its own list; the two add up to everyone
  const seg = { all: num(await page.getByTestId("seg-all-n").textContent()), new: num(await page.getByTestId("seg-new-n").textContent()), existing: num(await page.getByTestId("seg-existing-n").textContent()) };
  expect(seg.all).toBe(total);
  expect(seg.new + seg.existing).toBe(seg.all);
  for (const key of ["new", "existing"] as const) {
    await page.getByTestId(`seg-${key}`).click();
    await expect(page.getByTestId("wait-list-count")).toHaveText(String(seg[key]));
    if (seg[key] > 0) await expect(page.getByTestId("wait-row")).toHaveCount(Math.min(seg[key], 50));
  }
  await page.getByTestId("seg-all").click();
  await expect(page.getByTestId("wait-list-count")).toHaveText(String(total));
  // quick chips
  for (const id of ["chip-none", "chip-mine"]) {
    const chip = page.getByTestId(id);
    if ((await chip.count()) === 0 || (await chip.isDisabled())) continue;
    const n = num(await chip.locator("b").textContent());
    await chip.click();
    await expect(page.getByTestId("wait-list-count")).toHaveText(String(n));
    await chip.click();
  }
  await page.getByTestId("chip-everyone").click();
  await expect(page.getByTestId("wait-list-count")).toHaveText(String(total));
  // every bar of "How long have people waited" opens exactly its people
  await page.getByTestId("sub-trends").click();
  const bars = page.getByTestId("wait-bar");
  await expect(bars.first()).toBeVisible();
  const counts = await bars.evaluateAll((els) => els.map((e) => ({ key: e.getAttribute("data-bucket") ?? "", count: Number(e.getAttribute("data-count") ?? 0) })));
  expect(counts.reduce((s, b) => s + b.count, 0), "the bars add up to everyone waiting").toBe(total);
  for (const b of counts.filter((x) => x.count > 0)) {
    await page.getByTestId("sub-trends").click();
    await page.locator(`[data-testid=wait-bar][data-bucket="${b.key}"]`).click();
    await expect(page.getByTestId("wait-list-count"), `bar ${b.key}`).toHaveText(String(b.count));
    await expect(page.getByTestId("wait-row"), `bar ${b.key}`).toHaveCount(Math.min(b.count, 50));
  }
});

test("a dense list: one row about 40px on a desktop, two small lines on a phone, a page of 50, nothing sideways, density remembered", async ({ page }, testInfo) => {
  await open(page, "#speed?tab=unanswered");
  await expect(page.getByTestId("wait-list-size")).toHaveValue("50");
  const rows = page.getByTestId("wait-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count(), "never more rows than the page").toBeLessThanOrEqual(50);
  const h = (await rows.first().boundingBox())!.height;
  const wide = testInfo.project.name === "desktop-1440";
  const phone = testInfo.project.name === "phone-390";
  if (wide) { expect(h, "compact row").toBeGreaterThanOrEqual(ROW_HEIGHT.compact.min); expect(h).toBeLessThanOrEqual(ROW_HEIGHT.compact.max); }
  if (phone) { expect(h, "phone row").toBeGreaterThanOrEqual(PHONE_ROW_HEIGHT.min); expect(h).toBeLessThanOrEqual(PHONE_ROW_HEIGHT.max); }
  // the list scrolls inside a box of fixed height, so the page never grows with it
  const box = (await page.getByTestId("wait-list-scroll").boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(page.viewportSize()!.height * 0.7 + 4);
  // the header stays while the rows scroll (a desktop table)
  if (wide) await expect(page.locator(".ur-t-head")).toBeVisible();
  // small icons: nothing in the tab is drawn larger than 20px
  const big = await page.getByTestId("unanswered-tab").locator("svg.lucide").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 20).length);
  expect(big, "icons are small and alike").toBe(0);
  // the comfortable density keeps two lines, and the choice is remembered in this browser
  await page.getByTestId("density-comfortable").click();
  await expect(rows.first().locator(".ur-t-sub")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("density-comfortable")).toHaveAttribute("aria-pressed", "true", { timeout: 180_000 });
  await page.getByTestId("density-compact").click();
  await noSideScroll(page, "dense list");
  // keyboard: the arrow keys move from row to row
  await rows.first().getByTestId("wait-row-name").focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1).getByTestId("wait-row-name")).toBeFocused();
});

test("the sections inside the tab each open with room, and a person opens the lead panel", async ({ page }) => {
  await open(page, "#speed?tab=unanswered");
  for (const s of ["trends", "people", "rules", "queue"]) {
    const tab = page.getByTestId(`sub-${s}`);
    if ((await tab.count()) === 0) continue;
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await noSideScroll(page, s);
  }
  await page.getByTestId("wait-row-name").first().click();
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 60_000 });
});
