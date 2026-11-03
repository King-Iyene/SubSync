import { expect, test } from "@playwright/test";

// F6: the public share page, checked logged out, and the print layout on A4 and Letter (the sample real estate audit is a real
// shared page under the demo installation).
const SAMPLE = "/audit/sample-real-estate-team-audit";
const SIZES = [["A4", 794], ["Letter", 816]] as const;

test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "print layout is checked once"); });

test("the public page opens while logged out, is not indexable, and its preview names nobody", async ({ browser }) => {
  const ctx = await browser.newContext(); // a fresh browser with no session, as a prospect would open it
  const page = await ctx.newPage();
  const res = await page.goto(SAMPLE);
  expect(res?.status()).toBe(200);
  await expect(page.getByText("What we found")).toBeVisible();
  await expect(page.getByText("One-page fix plan")).toBeVisible();
  await expect(page.getByText("Snapshot taken", { exact: false })).toBeVisible();
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
  expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toBe("Account audit");
  expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe("no-referrer");
  // Logged out, the app's data is out of reach.
  const api = await ctx.request.get("/api/app/overview");
  expect(api.status()).toBe(401);
  await ctx.close();
});

for (const [name, widthPx] of SIZES) {
  test(`the shared page prints cleanly on ${name}: light background, dark text, no sideways overflow, a real PDF`, async ({ page }) => {
    await page.setViewportSize({ width: widthPx, height: 1100 });
    await page.goto(SAMPLE);
    await expect(page.getByText("One-page fix plan")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const look = await page.evaluate(() => {
      const root = document.querySelector(".audit-root") as HTMLElement;
      const h1 = document.querySelector("h1") as HTMLElement;
      return { bg: getComputedStyle(root).backgroundColor, color: getComputedStyle(h1).color, scrollWidth: document.documentElement.scrollWidth, button: !!document.querySelector(".no-print") && getComputedStyle(document.querySelector(".no-print") as HTMLElement).display };
    });
    expect(look.bg).toBe("rgb(255, 255, 255)");
    expect(look.color).toBe("rgb(17, 17, 17)");
    expect(look.scrollWidth).toBeLessThanOrEqual(widthPx + 1);
    expect(look.button, "the sign-up button is not printed").toBe("none");
    const pdf = await page.pdf({ format: name === "A4" ? "A4" : "Letter", printBackground: false });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(8_000);
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages, `${name} PDF has ${pages} pages`).toBeLessThanOrEqual(2);
  });
}

test("the in-app audit prints without the menu and without sideways overflow on A4", async ({ page }) => {
  await page.setViewportSize({ width: 794, height: 1100 });
  await page.goto("/app#audit");
  await page.reload();
  await expect(page.getByText("What needs fixing")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(795);
  await expect(page.getByRole("complementary")).toBeHidden();
});

// ---------------- stage F6 (written in the parallel run, not run there: the lead runs them after the merge) ----------------

test("every number on the audit opens the list it was counted from, with the same count, and the way back is named", async ({ page }) => {
  await page.goto("/app#audit");
  await page.reload();
  await expect(page.getByText("What needs fixing")).toBeVisible({ timeout: 60_000 });
  const show = page.getByRole("button", { name: /^Show the [\d,]+ / }).first();
  test.skip(!(await show.count()), "the demo has nothing to list on this data");
  const n = Number(((await show.textContent()) ?? "").match(/Show the ([\d,]+)/)![1].replace(/,/g, ""));
  await show.click();
  await expect(page.getByTestId("drill-count")).toHaveText(String(n));
  await expect(page.getByTestId("drill-back")).toHaveText("Back to the audit");
  await page.getByTestId("drill-back").click();
  await expect(page.getByTestId("drill-panel")).toHaveCount(0);
});

test("every button that leaves the audit says where it goes", async ({ page }) => {
  await page.goto("/app#audit");
  await page.reload();
  await expect(page.getByText("What needs fixing")).toBeVisible({ timeout: 60_000 });
  const names = await page.getByRole("button", { name: /^Open/ }).and(page.locator(":not([data-nextjs-dev-tools-button])")).allTextContents();
  // The development server adds its own "Open Next.js Dev Tools" button to every page; it is not part of the app and does not exist in production.
  for (const name of names) expect(name, "an Open button with no destination").toMatch(/^Open in .{3,}/);
});

test("the printed audit opens with the sender's own name and colour, on light paper", async ({ page }) => {
  const res = await page.request.post("/api/sso", { data: { demo: true } });
  const token = ((await res.json()) as { session: string }).session;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await page.request.put("/api/app/settings", { headers, data: { brandName: "Acme Marketing", brandColor: "#aa3366" } })).ok()).toBeTruthy();
  try {
    await page.setViewportSize({ width: 794, height: 1100 });
    await page.goto("/app#audit");
    await page.reload();
    await expect(page.getByText("What needs fixing")).toBeVisible({ timeout: 60_000 });
    await page.emulateMedia({ media: "print" });
    const header = page.getByTestId("audit-print-header");
    await expect(header).toBeVisible();
    await expect(header).toContainText("Acme Marketing");
    expect(await header.evaluate((e) => getComputedStyle(e).borderBottomColor)).not.toBe("rgb(0, 0, 0)");
    // On paper the text is dark: the dark shell's pale text would be unreadable on white.
    const [r, g, b] = (await page.locator("h1").first().evaluate((e) => getComputedStyle(e).color)).match(/\d+/g)!.map(Number);
    expect(r, "heading text is not dark on paper").toBeLessThan(60);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(80);
  } finally {
    await page.request.put("/api/app/settings", { headers, data: { brandName: null, brandColor: null } });
  }
});
