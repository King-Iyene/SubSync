import { expect, test } from "@playwright/test";

// The Capture tab used to show its skeleton forever when the growth read never answered (a very large account). Now it says so calmly after a wait and offers Retry. The wait is shortened here.
test("Capture: a read that never answers ends in a calm message with Retry, not an endless skeleton", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => { (window as unknown as { __speedTimeoutMs: number }).__speedTimeoutMs = 1500; try { localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/today\/growth/, () => { /* never answered */ });
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByText("This is taking too long")).toBeVisible();
  await page.getByTestId("capture-retry").click();
  await expect(page.getByText("This is taking too long")).toBeVisible();
});

test("each tab says once which time zone its times are in", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => { try { localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/part=zones/, (r) => r.fulfill({ json: { zones: [{ zone: "Africa/Lagos", label: "Lagos time (GMT+1)" }] } }));
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("tz-note").first()).toContainText("Lagos time (GMT+1)");
  await page.getByRole("tab", { name: "Pace", exact: true }).click();
  await expect(page.getByTestId("tz-note").first()).toContainText("Times here are in Lagos time");
});
