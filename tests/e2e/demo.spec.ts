import { expect, test } from "@playwright/test";

const VIEWS = ["today", "audit", "speed", "appointments", "accounts"];

test("the demo tenant loads, says it is sample data, and shows no real account or person", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /today/i }).first()).toBeVisible();
  const text = (await page.locator("body").innerText()).toLowerCase();
  for (const real of ["kd squares", "niger delta", "iyene", "squares ltd"]) expect(text, `real name "${real}" must not appear in the demo`).not.toContain(real);
});

for (const view of VIEWS) {
  test(`no horizontal page scroll on ${view}`, async ({ page }) => {
    await page.goto(`/app#${view}`);
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, `the page is ${scrollWidth}px wide in a ${innerWidth}px window`).toBeLessThanOrEqual(innerWidth + 1);
  });
}

test("the maintenance screen shows when sign-in answers that the app is down", async ({ page }) => {
  await page.route("**/api/sso", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "SubSync is down for a short maintenance. It will be back shortly.", maintenance: true }) }));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Back shortly" })).toBeVisible();
  await expect(page.getByText("short maintenance", { exact: false })).toBeVisible();
});

test("a plain browser tab keeps the 'open from your account menu' message and never flips to a sign-in error", async ({ page }) => {
  await page.route("**/api/sso", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Demo mode is off" }) }));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Open SubSync from your account menu" })).toBeVisible();
  await page.waitForTimeout(9000); // longer than the 6 second wait for the host page
  await expect(page.getByRole("heading", { name: "Open SubSync from your account menu" })).toBeVisible();
  await expect(page.getByText("We could not sign you in")).toHaveCount(0);
});
