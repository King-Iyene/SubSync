import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The lead panel: about 960 px at 1440 by default, much wider when expanded, flush right and full height on EVERY screen that opens it (it is drawn on the page body), a roomy
// conversation with a collapsible message box, folds, and the Appointments / Record / Deals tabs, in light and dark.
const SHOTS = "docs/review";

async function assertFlush(page: Page, where: string) {
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible({ timeout: 90_000 });
  const [box, vp] = [(await drawer.boundingBox())!, page.viewportSize()!];
  expect(Math.round(box.x + box.width), `${where}: right edge`).toBe(vp.width);
  expect(Math.round(box.y), `${where}: top`).toBe(0);
  expect(Math.round(box.height), `${where}: full height`).toBe(vp.height);
}

test("the panel is flush right and full height wherever it opens", async ({ page }) => {
  test.setTimeout(400_000);
  // People
  await page.goto("/app#people");
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("people-start").click();
  await assertFlush(page, "People");
  await page.keyboard.press("Escape");
  // Speed to lead
  await page.goto("/app#speed");
  const row = page.getByTestId("speed-row").first();
  await expect(row).toBeVisible({ timeout: 120_000 });
  await row.getByRole("button").first().click();
  await assertFlush(page, "Speed to lead");
  await page.keyboard.press("Escape");
  // Unanswered messages
  await page.goto("/app#inbox");
  const un = page.locator("[data-testid=unanswered-row] button, [data-testid=speed-row] button").first();
  if (await un.count()) { await un.click(); await assertFlush(page, "Unanswered"); await page.keyboard.press("Escape"); }
});

for (const scheme of ["light", "dark"] as const) {
  test(`wide panel, collapsible message box, folds and tabs (${scheme})`, async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.goto("/app#people");
    await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
    await page.locator("button", { hasText: scheme === "light" ? /^Light$/ : /^Dark$/ }).first().click();
    await page.getByTestId("people-start").click();
    const drawer = page.getByTestId("lead-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("drawer-headline")).toHaveText(/\S/, { timeout: 90_000 });
    const w1 = (await drawer.boundingBox())!.width;
    expect(w1, "wide by default").toBeGreaterThanOrEqual(900);
    expect(w1).toBeLessThanOrEqual(960);
    await drawer.getByTestId("drawer-wide").click();
    await expect.poll(async () => (await drawer.boundingBox())!.width).toBeGreaterThan(1200);
    // expanded: the timeline is its own column, in the account's time zone, with filters and a search
    await expect(drawer.getByTestId("drawer-timeline")).toBeVisible();
    await expect(drawer.getByTestId("timeline-zone")).toContainText("Times in");
    await drawer.getByTestId("timeline-chip-messages").click();
    await drawer.getByTestId("timeline-search").fill("zzzz-no-match");
    await expect(drawer.getByTestId("timeline-event")).toHaveCount(0);
    await drawer.getByTestId("timeline-search").fill("");
    await page.screenshot({ path: `${SHOTS}/panel-wide-timeline-${scheme}.png` });
    await page.reload();
    await page.getByTestId("people-start").click();
    await expect.poll(async () => (await page.getByTestId("lead-drawer").boundingBox())?.width ?? 0, { message: "the wide choice is remembered" }).toBeGreaterThan(1200);
    await drawer.getByTestId("drawer-wide").click();
    await drawer.getByTestId("wb-tab-timeline").click();
    await expect(drawer.getByTestId("drawer-timeline")).toBeVisible();
    await drawer.getByTestId("wb-tab-conversation").click();
    await expect(drawer.getByTestId("wb-thread")).toBeVisible({ timeout: 90_000 });
    // the message box is collapsed to a slim bar and opens on a click
    await expect(drawer.getByTestId("wb-composer-collapsed")).toBeVisible();
    const list = drawer.getByTestId("wb-messages");
    if (await list.count()) expect((await list.boundingBox())!.height).toBeGreaterThan(300);
    await page.screenshot({ path: `${SHOTS}/panel-wide-conversation-${scheme}.png` });
    await drawer.getByTestId("wb-composer-open").click();
    await expect(drawer.getByTestId("wb-composer")).toBeVisible();
    await drawer.getByTestId("wb-composer-collapse").click();
    await expect(drawer.getByTestId("wb-composer-collapsed")).toBeVisible();
    // folds
    await drawer.getByTestId("fold-about-toggle").click();
    await expect(drawer.getByText("Last activity")).toHaveCount(0);
    await drawer.getByTestId("fold-about-toggle").click();
    // tabs
    await drawer.getByTestId("wb-tab-deals").click();
    await expect(drawer.getByTestId("wb-newdeal-open")).toBeVisible();
    await drawer.getByTestId("wb-newdeal-open").click();
    await expect(drawer.getByTestId("wb-newdeal")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/panel-wide-deals-${scheme}.png` });
    await drawer.getByTestId("wb-tab-appointments").click();
    await expect(drawer.getByTestId("wb-appointments")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/panel-wide-appointments-${scheme}.png` });
    await drawer.getByTestId("wb-tab-record").click();
    await expect(drawer.getByTestId("wb-record")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/panel-wide-record-${scheme}.png` });
  });
}
