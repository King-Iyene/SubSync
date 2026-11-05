import { test, type Page } from "@playwright/test";
import { openMore, todayReady } from "./today-helpers";

// Screenshots for the review: Lead flow (30 days, a step open) and Clients coming and going, light and dark. Saved to docs/review/today-flow-*.png.
const OUT = "docs/review/today-flow";
async function theme(page: Page, mode: "light" | "dark") {
  await page.getByRole("button", { name: mode === "dark" ? "Dark appearance" : "Light appearance" }).click();
  await page.waitForTimeout(300);
}
for (const mode of ["light", "dark"] as const) {
  test(`capture Lead flow and Clients coming and going, ${mode}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1440", "1440 only");
    test.setTimeout(180_000);
    await page.goto("/app");
    await todayReady(page);
    await theme(page, mode);
    await openMore(page, "Lead flow");
    await page.getByTestId("flow-preset").selectOption("30d");
    await page.waitForTimeout(2500);
    await page.getByTestId("flow-tab").screenshot({ path: `${OUT}-leadflow-${mode}.png` });
    await openMore(page, "Clients coming and going");
    await page.waitForTimeout(1500);
    await page.getByTestId("clients-flow-tab").screenshot({ path: `${OUT}-clients-${mode}.png` });
    await openMore(page, "Growth");
    await page.waitForTimeout(1500);
    await page.getByTestId("email-leads").screenshot({ path: `${OUT}-emails-${mode}.png` });
  });
}
