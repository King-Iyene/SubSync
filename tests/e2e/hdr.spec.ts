import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The consolidated UI pass (column chart, dark-mode colours, sticky filter bar, Sync now). HDR_SHOTS=1 also writes screenshots to docs/review/hdr-*.png.
mkdirSync("docs/review", { recursive: true });
const SHOTS = Boolean(process.env.HDR_SHOTS);

for (const theme of ["dark", "light"] as const) {
  test(`Today and Speed read well in ${theme}`, async ({ page }, info) => {
    test.setTimeout(200_000);
    await page.addInitScript((t) => { try { localStorage.setItem("subsync-theme", t); } catch { /* none */ } }, theme);
    await page.goto("/app");
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(4000);
    if (SHOTS) await page.screenshot({ path: `docs/review/hdr-today-${theme}-${info.project.name}.png` });
    await page.goto("/app#speed");
    await page.reload();
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(5000);
    if (SHOTS) await page.screenshot({ path: `docs/review/hdr-speed-${theme}-${info.project.name}.png` });
    for (const tab of ["Pace", "Rules"]) {
      const t = page.getByRole("tab", { name: tab, exact: true }).first();
      if (await t.count()) { await t.click(); await page.waitForTimeout(2500); if (SHOTS) await page.screenshot({ path: `docs/review/hdr-speed-${tab.toLowerCase()}-${theme}-${info.project.name}.png` }); }
    }
  });
}
