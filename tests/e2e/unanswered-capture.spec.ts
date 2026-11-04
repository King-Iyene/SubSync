import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Screenshots of the Unanswered messages screen for the four roles at the three widths of the projects (docs/UNANSWERED_REVIEW.md, docs/features/UNANSWERED.md).
// Only runs when UNANS_CAPTURE is set to a name prefix: UNANS_CAPTURE=unanswered-old (the screen before the rebuild) or UNANS_CAPTURE=unanswered (after).
//   UNANS_CAPTURE=unanswered PW_BASE_URL=http://localhost:3171 npx playwright test tests/e2e/unanswered-capture.spec.ts --project=desktop-1440
const PREFIX = process.env.UNANS_CAPTURE ?? "";
test.skip(!PREFIX, "set UNANS_CAPTURE=<prefix> to capture screenshots");
mkdirSync("docs/review", { recursive: true });

const ROLES = [
  { slug: "agency-all", path: "/app#inbox", menu: false },
  { slug: "agency-account", path: "/app?as=location", menu: true },
  { slug: "client-staff", path: "/app?as=client#inbox", menu: false },
  { slug: "business-owner", path: "/app?as=business#inbox", menu: false },
] as const;

for (const role of ROLES) {
  test(`capture ${role.slug}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const width = testInfo.project.name.replace(/\D+/g, "");
    await page.goto(role.path);
    if (role.menu) await page.getByRole("button", { name: "Unanswered messages", exact: true }).first().click({ timeout: 90_000 });
    else await page.reload();
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `docs/review/${PREFIX}-${role.slug}-${width}.png`, fullPage: false });
    await page.screenshot({ path: `docs/review/${PREFIX}-${role.slug}-${width}-full.png`, fullPage: true });
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, text: document.querySelector("main")?.textContent?.slice(0, 300) ?? "" }));
    console.log(`${role.slug} ${width}: overflow=${m.overflow} :: ${m.text}`);
  });
}
