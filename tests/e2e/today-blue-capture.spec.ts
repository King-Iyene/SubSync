import { test, type Page } from "@playwright/test";
import { openMore, todayReady } from "./today-helpers";

// Screenshots of Today in the blue palettes for the review: light and dark, at 1440 and 1024, the page, the Growth tab and an open menu. Saved to docs/review/today-blue-*.png.
const OUT = "docs/review/today-blue";

async function theme(page: Page, mode: "light" | "dark") {
  await page.getByRole("button", { name: mode === "dark" ? "Dark appearance" : "Light appearance" }).click();
  await page.waitForTimeout(300);
}

for (const mode of ["light", "dark"] as const) {
  test(`capture Today, ${mode}`, async ({ page }, info) => {
    test.skip(!/^desktop-/.test(info.project.name), "1440 and 1024 only");
    test.setTimeout(180_000);
    const w = info.project.name.replace("desktop-", "");
    await page.goto("/app");
    await todayReady(page);
    await theme(page, mode);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}-${mode}-${w}.png` });
    await page.screenshot({ path: `${OUT}-${mode}-${w}-full.png`, fullPage: true });
    await page.getByTestId("queue-more").nth(3).scrollIntoViewIfNeeded();
    await page.getByTestId("queue-more").nth(3).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}-${mode}-${w}-menu.png` });
    await page.keyboard.press("Escape");
    await openMore(page, "Growth");
    await page.waitForTimeout(1200);
    await page.getByTestId("growth-tab").screenshot({ path: `${OUT}-${mode}-${w}-growth.png` });
  });
}
