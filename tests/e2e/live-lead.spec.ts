import { expect, test } from "@playwright/test";

// Live read-through in the lead panel, on the demo company with the live answer mocked in the browser (page.route): no CRM is ever called.
// The panel first shows "Checking", then "Live", then the open tasks the CRM holds; when the CRM does not answer it says it shows the last sync.
test("lead panel: Live badge and live tasks, then the honest fallback when the CRM does not answer", async ({ page }) => {
  test.setTimeout(240_000);
  let calls = 0;
  await page.route("**/workbench/live**", async (route) => {
    calls++;
    if (calls < 3) return route.fulfill({ json: { state: "ok", readAt: Date.now(), rev: "r1", full: true, missing: [], tags: [], calls: [], notes: [{ id: "n1", at: null, by: null, text: "Asked for a call back" }], tasks: [{ id: "t1", title: "Call back at 3pm", due: null, done: false }] } });
    return route.fulfill({ json: { state: "unavailable", note: "Your CRM did not answer." } });
  });
  await page.goto("/app#people");
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("people-start").click({ timeout: 60_000 });
  const badge = page.getByTestId("live-badge");
  await expect(badge).toHaveAttribute("data-live", "1", { timeout: 30_000 });
  await expect(badge).toContainText("Live");
  await expect(page.getByTestId("live-extras")).toContainText("Call back at 3pm");
  await expect(badge).toHaveAttribute("data-live", "0", { timeout: 60_000 });
  await expect(badge).toContainText("From the last sync");
});
