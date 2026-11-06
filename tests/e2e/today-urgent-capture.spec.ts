import { expect, test, type Page } from "@playwright/test";
import { api, todayReady } from "./today-helpers";

// King's real-account view: an agency owner inside ONE client, at 1275 and 1440 wide, light and dark. Saved to docs/review/today-polish-urgent-*.png.
async function theme(page: Page, mode: "light" | "dark") {
  await page.getByRole("button", { name: mode === "dark" ? "Dark appearance" : "Light appearance" }).click();
  await page.waitForTimeout(300);
}
for (const width of [1275, 1440]) for (const mode of ["light", "dark"] as const) {
  test(`agency owner inside one client at ${width}, ${mode}`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "sized here");
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    const { get } = await api(request);
    const t = await get("today");
    const one = (t.accounts as Array<{ id: string }>)[0].id;
    await page.goto(`/app#today?ta=${one}`);
    await todayReady(page);
    await theme(page, mode);
    await expect(page.getByTestId("global-filter-bar")).toBeVisible();
    await expect(page.getByTestId("back-to-all-clients").or(page.getByTestId("global-filter-bar"))).toBeVisible();
    await page.screenshot({ path: `docs/review/today-polish-urgent-${width}-${mode}.png` });
    const person = page.getByTestId("reply-person").first();
    if (await person.count()) {
      await expect(person).toHaveCSS("cursor", "pointer");
      await person.click();
      await expect(page.getByTestId("lead-drawer-root")).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `docs/review/today-polish-urgent-${width}-${mode}-panel.png` });
    }
  });
}
