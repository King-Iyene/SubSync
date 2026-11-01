import { expect, test, type APIRequestContext } from "@playwright/test";

// F3: appointments on the messy demo tenant, and the Insights tab (never seen working before this stage).
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(request: APIRequestContext, path: string): Promise<Json> {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const res = await request.get(`/api/app/${path}`, { headers });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
}

test("appointment numbers are consistent between the To do tab and Insights", async ({ request }) => {
  const [list, ins] = await Promise.all([get(request, "appointments"), get(request, "appointment-insights")]);
  expect(ins.sampleSize).toBeGreaterThan(0);
  // The two tabs read the same rows with the same rules: the count with no outcome recorded must agree.
  const unmarkedList = list.unmarkedTotal ?? list.unmarked?.length ?? null;
  if (unmarkedList !== null && ins.health?.unmarked !== undefined) expect(ins.health.unmarked).toBe(unmarkedList);
  expect(ins.health.score).toBeGreaterThanOrEqual(0);
  expect(ins.health.score).toBeLessThanOrEqual(100);
});

test("no rate is shown without enough outcomes, and no change claim without a baseline of 10", async ({ request }) => {
  const list = await get(request, "appointments");
  const o = list.overview ?? list;
  for (const period of [o.last30, o.prior30].filter(Boolean)) {
    if (period.outcomes < 5) expect(period.showRate, "under 5 recorded outcomes there is no rate").toBeNull();
    if (period.outcomes >= 5) expect(period.showRate).not.toBeNull();
  }
  for (const line of (list.headline ?? []) as string[]) {
    if (/Show rate (rose|fell)/.test(line)) { expect(o.last30.outcomes).toBeGreaterThanOrEqual(10); expect(o.prior30.outcomes).toBeGreaterThanOrEqual(10); }
    if (/Bookings are (up|down)/.test(line)) expect(o.prior30.booked).toBeGreaterThanOrEqual(10);
    expect(line).not.toMatch(/100%/);
  }
});

test("the Insights tab opens, shows its cards without errors, and carries no alarming claim", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app#appointments");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Insights" }).first().click();
  await expect(page.getByText("Calendar health").first()).toBeVisible();
  await expect(page.getByText("Best times to book", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("No-show recovery", { exact: false }).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/down 100%|NaN|undefined|Infinity/);
  expect(errors, errors.join("\n")).toEqual([]);
  await page.screenshot({ path: `docs/review/f3-insights-${testInfo.project.name}.png`, fullPage: true });
});
