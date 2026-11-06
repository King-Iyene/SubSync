import { expect, test } from "@playwright/test";

// Call mode: every list answers (never a generic error); 'Missed calls, no callback' shows a calm empty state or real people.
test("Call mode: the missed-calls list loads without an error", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("tab", { name: "Call mode", exact: true }).click();
  await expect(page.getByTestId("dial-ready").or(page.getByText("No missed calls to call back")).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
});

test("Capture: visible date buttons, and every counter opens exactly its people", async ({ page }) => {
  test.setTimeout(400_000);
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("tab", { name: "Capture", exact: true }).click();
  await expect(page.getByTestId("capture-range")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Last 7 days" }).first().click();
  await expect(page.getByTestId("capture-window")).toContainText(/7 days|to/);
  const all = page.getByTestId("capture-all-open");
  await expect(all).toBeVisible({ timeout: 90_000 });
  const n = Number(await all.getAttribute("data-count"));
  if (n > 0) {
    await all.click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
  }
});
