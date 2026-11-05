import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The wide lead panel: 640-720 px by default at 1440, extra wide (960) on request, the conversation as a roomy docked thread, the tab bar, Appointments and Record tabs.
test("the panel is wide, can be made extra wide, and every tab opens (light and dark)", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync("docs/review", { recursive: true });
  await page.goto("/app#people");
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("people-start").click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drawer-headline")).toHaveText(/\S/, { timeout: 90_000 });
  const w1 = (await drawer.boundingBox())!.width;
  expect(w1, "wide by default").toBeGreaterThanOrEqual(640);
  expect(w1).toBeLessThanOrEqual(720);
  await drawer.getByTestId("drawer-wide").click();
  await expect.poll(async () => (await drawer.boundingBox())!.width).toBeGreaterThan(900);
  await drawer.getByTestId("drawer-wide").click();
  await expect.poll(async () => (await drawer.boundingBox())!.width).toBeLessThanOrEqual(720);
  await expect(drawer.getByTestId("wb-thread")).toBeVisible({ timeout: 90_000 });
  await expect(drawer.getByTestId("wb-open-crm")).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((s) => document.documentElement.classList.toggle("dark", s === "dark"), scheme);
    await drawer.getByTestId("wb-tab-conversation").click();
    await page.screenshot({ path: `docs/review/panel-wide-conversation-${scheme}.png` });
    await drawer.getByTestId("wb-tab-appointments").click();
    await expect(drawer.getByTestId("wb-appointments")).toBeVisible();
    await page.screenshot({ path: `docs/review/panel-wide-appointments-${scheme}.png` });
    await drawer.getByTestId("wb-tab-record").click();
    await expect(drawer.getByTestId("wb-record")).toBeVisible();
    await page.screenshot({ path: `docs/review/panel-wide-record-${scheme}.png` });
  }
});
