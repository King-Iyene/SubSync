import { test, type Page } from "@playwright/test";
import { openMore, todayReady } from "./today-helpers";

// Screenshots for the review of the Today polish pass (status chips, alerts panel, chart cards), light and dark. Saved to docs/review/today-polish-*.png. 1440 only.
const OUT = "docs/review/today-polish";
async function theme(page: Page, mode: "light" | "dark") {
  await page.getByRole("button", { name: mode === "dark" ? "Dark appearance" : "Light appearance" }).click();
  await page.waitForTimeout(300);
}
for (const mode of ["light", "dark"] as const) {
  test(`capture polish, ${mode}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1440", "1440 only");
    test.setTimeout(240_000);
    await page.goto("/app");
    await todayReady(page);
    await theme(page, mode);
    console.log("headline:", await page.getByTestId("today-headline").innerText(), "| held:", (await page.getByTestId("held-link").count()) ? await page.getByTestId("held-link").getAttribute("data-count") : 0);
    await page.getByTestId("fix-first").screenshot({ path: `${OUT}-fixfirst-${mode}.png` });
    const spark = page.getByTestId("spark-surface");
    if (await spark.count()) { await spark.first().scrollIntoViewIfNeeded(); await spark.first().hover(); await page.waitForTimeout(300); await spark.first().screenshot({ path: `${OUT}-spark-${mode}.png` }); }
    const bars = page.getByTestId("account-bar").first();
    if (await bars.count()) { await bars.hover(); await page.waitForTimeout(300); await page.getByTestId("account-bars").screenshot({ path: `${OUT}-bars-${mode}.png` }); }
    await openMore(page, "Proof");
    await page.waitForTimeout(800);
    await page.getByTestId("raised-cleared-mark").nth(4).hover();
    await page.waitForTimeout(300);
    await page.getByTestId("today-proof").screenshot({ path: `${OUT}-proof-${mode}.png` });
    await page.getByTestId("proof-open-open").or(page.getByTestId("proof-open-raised")).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}-alerts-${mode}.png` });
    await page.keyboard.press("Escape");
    await openMore(page, "Lead flow");
    await page.waitForTimeout(2500);
    await page.getByTestId("flow-node").nth(1).hover();
    await page.waitForTimeout(300);
    await page.getByTestId("flow-tab").screenshot({ path: `${OUT}-leadflow-${mode}.png` });
    await openMore(page, "Growth");
    await page.waitForTimeout(2000);
    await page.getByTestId("growth-chart-mark").nth(10).hover();
    await page.waitForTimeout(300);
    await page.getByTestId("growth-chart").screenshot({ path: `${OUT}-growthchart-${mode}.png` });
    const slice = page.getByTestId("source-slice").first();
    if (await slice.count()) { await slice.hover(); await page.waitForTimeout(300); await page.getByTestId("source-mix").screenshot({ path: `${OUT}-donut-${mode}.png` }); }
    await page.getByTestId("growth-counters").screenshot({ path: `${OUT}-counters-${mode}.png` });
  });
}
