import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Screenshots of the Clients screen for the roles that can open it, at the three widths of the projects (docs/CLIENTS_REVIEW.md, docs/features/CLIENTS.md).
// Only runs when CLIENTS_CAPTURE is set to a name prefix: CLIENTS_CAPTURE=clients-old (the screen before the rebuild) or CLIENTS_CAPTURE=clients (after).
//   CLIENTS_CAPTURE=clients PW_BASE_URL=http://localhost:3181 npx playwright test tests/e2e/clients-capture.spec.ts --project=desktop-1440
const PREFIX = process.env.CLIENTS_CAPTURE ?? "";
test.skip(!PREFIX, "set CLIENTS_CAPTURE=<prefix> to capture screenshots");
mkdirSync("docs/review", { recursive: true });

const ROLES = [
  { slug: "agency", path: "/app#clients" },
  { slug: "client-staff", path: "/app?as=client#clients" },
  { slug: "business-owner", path: "/app?as=business#clients" },
] as const;

for (const role of ROLES) {
  test(`capture ${role.slug}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const width = testInfo.project.name.replace(/\D+/g, "");
    await page.goto(role.path);
    await page.reload();
    await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 90_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `docs/review/${PREFIX}-${role.slug}-${width}.png`, fullPage: false });
    await page.screenshot({ path: `docs/review/${PREFIX}-${role.slug}-${width}-full.png`, fullPage: true });
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, text: document.querySelector("main")?.textContent?.slice(0, 160) ?? "" }));
    console.log(`${role.slug} ${width}: overflow=${m.overflow} :: ${m.text}`);
  });
}

// The two screens behind the first one (the whole book, and one client's page): agency only.
for (const shot of ["all", "page"] as const) {
  test(`capture agency-${shot}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const width = testInfo.project.name.replace(/\D+/g, "");
    await page.goto("/app#clients");
    await page.reload();
    await expect(page.getByTestId("book")).toBeVisible({ timeout: 90_000 });
    if (shot === "all") await page.getByTestId("needs-all").click();
    else await page.getByTestId("open-client").first().click();
    await expect(page.getByTestId(shot === "all" ? "book-list-count" : "client-name")).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/review/${PREFIX}-agency-${shot}-${width}.png`, fullPage: false });
    await page.screenshot({ path: `docs/review/${PREFIX}-agency-${shot}-${width}-full.png`, fullPage: true });
    const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }));
    console.log(`agency-${shot} ${width}: overflow=${m.overflow}`);
  });
}
