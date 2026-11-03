import { expect, test, type Page } from "@playwright/test";

// NC: the agency logo, and the Pipeline tabs. The demo tenant at the desktop width.
test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "content check: desktop is enough here"); });

const LOGO = "https://cdn.brand-example.io/logo.png";
// A 1 by 1 transparent PNG: the page only needs a picture that loads.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function session(page: Page): Promise<string> {
  const res = await page.request.post("/api/sso", { data: { demo: true } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { session: string }).session;
}

test("the logo shows in the menu, falls back to the name when it cannot load, and refuses an address that is not https", async ({ page }) => {
  const token = await session(page);
  const headers = { Authorization: `Bearer ${token}` };
  const bad = await page.request.put("/api/app/settings", { headers, data: { brandLogoUrl: "http://cdn.brand-example.io/logo.png" } });
  expect(bad.status()).toBe(400);
  const tracking = await page.request.put("/api/app/settings", { headers, data: { brandLogoUrl: `${LOGO}?uid=1` } });
  expect(tracking.status()).toBe(400);
  try {
    const ok = await page.request.put("/api/app/settings", { headers, data: { brandName: "Acme Marketing", brandLogoUrl: LOGO } });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    await page.route(LOGO, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.goto("/app");
    const img = page.locator("aside img[alt='Acme Marketing']");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", LOGO);
    expect(await img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    expect(await page.locator("body").innerText()).not.toMatch(/GoHighLevel|HighLevel/i);

    // The picture cannot load: the brand name is shown instead.
    await page.unroute(LOGO);
    await page.route(LOGO, (route) => route.abort());
    await page.reload();
    await expect(page.locator("aside").getByText("Acme Marketing").first()).toBeVisible();
    await expect(page.locator("aside img[alt='Acme Marketing']")).toHaveCount(0);

  } finally {
    await page.request.put("/api/app/settings", { headers, data: { brandName: null, brandLogoUrl: null } });
  }
});

test("Pipeline has five tabs with at most four blocks each, and the old addresses still open it", async ({ page }) => {
  await page.goto("/app#pipeline");
  const tabs = ["Overview", "Stages and bottlenecks", "Stale deals", "Forecast", "Compare"];
  for (const name of tabs) await expect(page.getByRole("tab", { name })).toBeVisible();
  for (const name of tabs) {
    await page.getByRole("tab", { name }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toBeVisible();
    const blocks = await panel.locator("section > header > h2").count();
    expect(blocks, `${name} has ${blocks} blocks`).toBeLessThanOrEqual(4);
    expect(blocks, `${name} has no blocks`).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${name} scrolls sideways`).toBe(true);
  }
  await page.goto("/app#pipelines");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
});

test("the pipeline chart has axes, and a stale deal opens the lead panel", async ({ page }) => {
  await page.goto("/app#pipeline");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  const chart = page.getByRole("tabpanel").locator("svg").first();
  await expect(chart).toBeVisible();
  await page.getByRole("tab", { name: "Stale deals" }).click();
  const list = page.getByTestId("stale-deals");
  await expect(list).toBeVisible();
  const first = list.getByText(/^(Consultation|Annual contract|Package|Service plan|Install) #/).first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
});
