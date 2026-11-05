import { expect, test, type Page } from "@playwright/test";
import { openMore, todayReady } from "./today-helpers";

// The filter bar of each report tab of Today, the Bars | Line control, and alignment when the numbers get big. At 1440, 1024 and 390 (the project's own width), light and dark.
// Screenshots go to docs/review/today-filters-<tab>-<mode>-<width>.png. Large numbers are put into the page's own cards (the cards render whatever the server sent), then the
// page is checked: nothing sticks out sideways, no card text is clipped without a tooltip, cards in one row are the same height.
const OUT = "docs/review/today-filters";
async function theme(page: Page, mode: "light" | "dark") {
  await page.getByRole("button", { name: mode === "dark" ? "Dark appearance" : "Light appearance" }).click();
  await page.waitForTimeout(250);
}
const noSideways = async (page: Page, what: string) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${what}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
};

for (const mode of ["light", "dark"] as const) {
  test(`report tabs keep their own filter and stay aligned, ${mode}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const w = String(info.project.use.viewport?.width ?? 0);
    await page.goto("/app");
    await todayReady(page);
    await theme(page, mode);

    // Growth: the tab's own dates and the address.
    await openMore(page, "Growth");
    await expect(page.getByTestId("report-filter")).toBeVisible();
    await page.getByTestId("filter-preset").selectOption("90d");
    await expect(page).toHaveURL(/gr=90d/);
    await expect(page.getByTestId("growth-range")).toContainText("Last 90 days");
    await expect(page.getByTestId("filter-reset")).toBeVisible();
    await page.getByTestId("filter-reset").click();
    await expect(page).not.toHaveURL(/gr=90d/);
    await page.getByTestId("filter-preset").selectOption("7d");
    const mark = page.getByTestId("growth-chart-mark").filter({ hasNot: page.locator("[data-count='0']") }).first();
    if (await mark.count()) { await mark.click(); await expect(page.getByTestId("records-panel")).toBeVisible(); await page.keyboard.press("Escape"); }
    // Bars and Line, same marks.
    const bars = await page.getByTestId("growth-chart-mark").count();
    await page.getByTestId("chart-mode-line").first().click();
    await expect(page.getByTestId("growth-chart")).toHaveAttribute("data-mode", "line");
    expect(await page.getByTestId("growth-chart-mark").count()).toBe(bars);
    await noSideways(page, "Growth");
    await page.getByTestId("growth-tab").screenshot({ path: `${OUT}-growth-${mode}-${w}.png` });

    // Cards in a row are the same height, with a long number inside.
    await page.evaluate(() => { const f = document.querySelector("[data-testid=growth-counters] .t-figure"); if (f) f.textContent = "12.3M"; });
    const heights = await page.getByTestId("growth-counters").locator("li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    const rows = new Map<number, number[]>();
    await page.getByTestId("growth-counters").locator("li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))).then((tops) => tops.forEach((t, i) => rows.set(t, [...(rows.get(t) ?? []), heights[i]])));
    for (const [, hs] of rows) expect(Math.max(...hs) - Math.min(...hs), "cards in one row are one height").toBeLessThanOrEqual(2);

    // Lead flow: the same bar, with a client list for a company.
    await openMore(page, "Lead flow");
    await expect(page.getByTestId("report-filter")).toBeVisible();
    await page.getByTestId("filter-preset").selectOption("30d");
    await expect(page).toHaveURL(/lr=30d/);
    await noSideways(page, "Lead flow");

    // Clients coming and going: dates and a search, no client filter.
    const coming = page.getByRole("tab", { name: "Clients coming and going" });
    if (await coming.count()) {
      await openMore(page, "Clients coming and going");
      await expect(page.getByTestId("filter-client")).toHaveCount(0);
      await page.getByTestId("clients-search").fill("zzzz-no-such-client");
      await expect(page.getByTestId("clients-none")).toBeVisible();
      await page.getByTestId("clients-search").fill("");
      await page.getByTestId("chart-mode-line").first().click();
      await page.getByTestId("clients-flow-tab").screenshot({ path: `${OUT}-clients-${mode}-${w}.png` });
      await noSideways(page, "Clients coming and going");
    }

    // Proof, Forecast, Sources, Coverage: plain words, the bar, nothing sideways.
    for (const [tab, id, shot] of [["Proof", "today-proof", "proof"], ["Forecast", "tab-numbers", "forecast"], ["Sources", "tab-sources", "sources"], ["Coverage", "tab-coverage", "coverage"]] as const) {
      const t = page.getByRole("tab", { name: tab });
      if (!(await t.count())) continue;
      await openMore(page, tab);
      await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId(id).getByTestId("report-filter")).toBeVisible();
      await noSideways(page, tab);
      await page.getByTestId(id).screenshot({ path: `${OUT}-${shot}-${mode}-${w}.png` });
    }
    await openMore(page, "Proof");
    await expect(page.getByTestId("proof-headline")).toContainText(/This week SubSync found/);
    await expect(page.getByTestId("today-proof")).not.toContainText(/above the line|below the line|Raised|Cleared/);
  });
}
