import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Screenshots of the Speed to lead screen for the four roles at the three widths of the projects (docs/SPEED_REVIEW.md, docs/features/SPEED.md).
// Only runs when SPEED_CAPTURE is set to a name prefix: SPEED_CAPTURE=speed-old (the screen before the rebuild) or SPEED_CAPTURE=speed (after).
//   SPEED_CAPTURE=speed PW_BASE_URL=http://localhost:3131 npx playwright test tests/e2e/speed-capture.spec.ts --project=desktop-1440
const PREFIX = process.env.SPEED_CAPTURE ?? "";
test.skip(!PREFIX, "set SPEED_CAPTURE=<prefix> to capture screenshots");
mkdirSync("docs/review", { recursive: true });

const ROLES = [
  { slug: "agency-all", path: "/app#speed", menu: false },
  { slug: "agency-account", path: "/app?as=location", menu: true },
  { slug: "client-staff", path: "/app?as=client#speed", menu: false },
  { slug: "business-owner", path: "/app?as=business#speed", menu: false },
] as const;

for (const role of ROLES) {
  test(`capture ${role.slug}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const width = testInfo.project.name.replace(/\D+/g, "");
    await page.goto(role.path);
    if (role.menu) await page.getByRole("button", { name: "Speed to lead", exact: true }).first().click({ timeout: 90_000 });
    else await page.reload();
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `docs/review/${PREFIX}-${role.slug}-${width}.png`, fullPage: false });
    await page.screenshot({ path: `docs/review/${PREFIX}-${role.slug}-${width}-full.png`, fullPage: true });
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, text: document.querySelector("main")?.textContent?.slice(0, 200) ?? "" }));
    console.log(`${role.slug} ${width}: overflow=${m.overflow}`);
  });
}
