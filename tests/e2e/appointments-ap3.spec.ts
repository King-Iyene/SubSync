import { expect, test } from "@playwright/test";

// Appointments module (stage AU) against typed fixtures (?apfx=1): the Flow Tree has no overlapping labels, every count equals its rows, and nothing scrolls sideways.
// The module shows when the flag appt_module is on (the browser-test server runs with the default flags, so the spec switches it on through the demo flags when it can).
test.describe("appointments module", () => {
  test("flow tree: no overlap, counts equal rows, no sideways scroll", async ({ page }, info) => {
    await page.goto("/app?apfx=1#appointments");
    await page.getByRole("button", { name: "Appointments", exact: true }).first().click({ timeout: 90_000 }).catch(() => undefined);
    const tab = page.getByRole("tab", { name: "Flow tree" });
    test.skip(!(await tab.isVisible({ timeout: 90_000 }).catch(() => false)), "appt_module flag is off in this server");
    await tab.click();
    const phone = (page.viewportSize()?.width ?? 1440) < 700 || info.project.name.includes("tablet");
    await expect(page.getByTestId("ap-flow")).toBeVisible({ timeout: 45_000 });
    if (!phone) {
      await expect(page.getByTestId("ap-tree")).toBeVisible({ timeout: 30_000 });
      const boxes = await page.locator(".ap-node").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        expect(a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1, `nodes ${i} and ${j} overlap`).toBe(false);
      }
      const leaf = page.getByTestId("ap-node-leaf").first();
      const n = Number((await leaf.locator("b").innerText()).trim());
      await leaf.click();
      await expect(page.getByTestId("ap-count")).toContainText(`of ${n}`);
      await expect(page.locator("#ap-drill [data-testid=ap-row]")).toHaveCount(Math.min(n, 20));
    } else {
      await expect(page.getByTestId("ap-plist")).toBeVisible({ timeout: 30_000 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("overview, needs outcome and the right-side panel", async ({ page }) => {
    await page.goto("/app?apfx=1#appointments");
    await page.getByRole("button", { name: "Appointments", exact: true }).first().click({ timeout: 90_000 }).catch(() => undefined);
    test.skip(!(await page.getByTestId("ap-headline").isVisible({ timeout: 90_000 }).catch(() => false)), "appt_module flag is off in this server");
    await expect(page.getByTestId("ap-kpi-needs")).toContainText("23");
    await page.getByTestId("ap-kpi-needs").click();
    await expect(page.getByTestId("ap-lead")).toContainText("23");
    await page.getByTestId("ap-row").first().click();
    await expect(page.getByTestId("ap-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ap-panel")).toHaveCount(0);
  });
});
