import { expect, test } from "@playwright/test";

// Unanswered round 3, slices A and C (control room, filters, search). Needs the flags on (FLAGS_ALL_ON=true) and the demo tenant. Runs at the three widths of the config.
test.describe("Unanswered control room", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app#inbox");
    await page.reload();
    await expect(page.getByTestId("wait-headline")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("wait-list-count")).toBeVisible({ timeout: 120_000 });
  });

  test("no sideways scroll, and the waiting number opens exactly that many people", async ({ page }) => {
    const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw.sw).toBeLessThanOrEqual(sw.cw);
    const kpi = Number(((await page.getByTestId("kpi-waiting").getAttribute("aria-label")) ?? "").match(/: (\d+)/)?.[1]);
    const count = Number(await page.getByTestId("wait-list-count").innerText());
    expect(count).toBe(kpi);
  });

  test("a chip's number is the list behind it", async ({ page }) => {
    if ((await page.getByTestId("filters-toggle").isVisible())) await page.getByTestId("filters-toggle").click();
    const chip = page.getByTestId("chip-h48");
    const n = Number(((await chip.innerText()).match(/(\d+)\s*$/) ?? [])[1]);
    await chip.click();
    await expect(page.getByTestId("wait-list-count")).toHaveText(String(n), { timeout: 60_000 });
  });

  test("pressing a person opens the lead panel, not only a reply link", async ({ page }) => {
    await page.getByTestId("wait-row-name").first().click();
    await expect(page.getByTestId("lead-drawer")).toBeVisible({ timeout: 60_000 });
  });

  test("the waiting-on-them tab and a page size of 50", async ({ page }) => {
    await page.getByTestId("tab-them").click();
    await expect(page.getByTestId("wait-list-title")).toContainText("gone quiet", { timeout: 60_000 });
    await page.getByTestId("wait-list-size").selectOption("50");
    await expect(page.getByTestId("wait-list-range")).toContainText(/^1 to /, { timeout: 60_000 });
    expect(await page.getByTestId("wait-row").count()).toBeLessThanOrEqual(50);
  });

  test("find anyone searches across clients on the server", async ({ page }) => {
    await page.getByTestId("find-input").fill("an");
    await page.getByTestId("find-go").click();
    await expect(page.getByTestId("find-count")).toBeVisible({ timeout: 60_000 });
    expect(await page.getByTestId("find-row").count()).toBeLessThanOrEqual(20);
  });

  test("keys: j moves, o opens", async ({ page, isMobile }) => {
    test.skip(isMobile === true || (page.viewportSize()?.width ?? 0) < 768, "keys are for a keyboard");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await expect(page.locator("[data-cursor='1']")).toHaveCount(1);
    await page.keyboard.press("o");
    await expect(page.getByTestId("lead-drawer")).toBeVisible({ timeout: 60_000 });
  });

  test("a saved view can be saved and removed", async ({ page }) => {
    await page.getByTestId("views-toggle").click();
    await page.getByTestId("view-name").fill("xtest view");
    await page.getByTestId("view-save").click();
    await expect(page.getByTestId("view-apply").filter({ hasText: "xtest view" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Remove the view xtest view" }).click();
    await expect(page.getByTestId("view-apply").filter({ hasText: "xtest view" })).toHaveCount(0, { timeout: 30_000 });
  });
});
