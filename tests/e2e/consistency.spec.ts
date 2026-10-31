import { expect, test, type APIRequestContext } from "@playwright/test";

// The same number must be the same everywhere (runbook F1, docs/METRICS.md). The demo tenant is messy on purpose:
// open deals with no value, open deals with no owner, one $1,000,000 outlier, accounts with fewer than 20 closed deals.
// Each figure is read from every endpoint that reports it, then from the rendered screens.
test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "numbers do not change with the window width"); });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function session(request: APIRequestContext) {
  const res = await request.post("/api/sso", { data: { demo: true } });
  expect(res.ok()).toBeTruthy();
  return { Authorization: `Bearer ${((await res.json()) as { session: string }).session}` };
}
const get = async (request: APIRequestContext, headers: Record<string, string>, path: string): Promise<Json> => {
  const res = await request.get(`/api/app/${path}`, { headers });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
};
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

test("open pipeline is one number: Overview, Accounts, Pipeline and Clients agree on value and count", async ({ request }) => {
  const h = await session(request);
  const [overview, accounts, pipeline] = await Promise.all([get(request, h, "overview"), get(request, h, "accounts"), get(request, h, "pipeline-intel")]);
  const k = overview.kpis;
  expect(k.openValue, "the demo tenant has deals").toBeGreaterThan(0);
  expect(pipeline.totals.openValue, "Pipeline open value equals Overview open value").toBe(k.openValue);
  expect(pipeline.totals.open, "Pipeline open count equals Overview open count").toBe(k.openOpps);
  const live = (accounts.accounts as Json[]).filter((a) => !a.ignored);
  expect(live.reduce((s, a) => s + a.openValue, 0), "the accounts add up to the Overview total").toBe(k.openValue);
  expect(live.reduce((s, a) => s + a.openOpps, 0)).toBe(k.openOpps);
  // The accounts table inside Pipeline must add up too.
  expect((pipeline.accounts as Json[]).reduce((s, a) => s + a.openValue, 0)).toBe(k.openValue);
});

test("deals with no value or no owner are left out everywhere, and every screen says how many", async ({ request }) => {
  const h = await session(request);
  const [overview, pipeline] = await Promise.all([get(request, h, "overview"), get(request, h, "pipeline-intel")]);
  expect(overview.kpis.excludedDeals, "the demo tenant has junk deals on purpose").toBeGreaterThan(0);
  expect(pipeline.excluded.count, "Pipeline reports the same left-out deals as Overview").toBe(overview.kpis.excludedDeals);
  expect(pipeline.excluded.noValue + pipeline.excluded.noOwner).toBe(pipeline.excluded.count);
});

test("the $1,000,000 outlier is called out on both screens and is not the same as a normal deal", async ({ request }) => {
  const h = await session(request);
  const [overview, pipeline] = await Promise.all([get(request, h, "overview"), get(request, h, "pipeline-intel")]);
  expect(pipeline.distribution.largest[0].value, "the largest counted deal is the outlier").toBe(1_000_000);
  // The outlier note appears only when one deal is at least half the total, so check it against the numbers it is built on.
  const share = 1_000_000 / overview.kpis.openValue;
  if (share >= 0.5) {
    expect(overview.kpis.outlier?.value).toBe(1_000_000);
    expect(pipeline.outlier?.value).toBe(1_000_000);
  } else {
    expect(overview.kpis.outlier).toBeNull();
  }
});

test("no win rate or forecast is shown under the minimum number of closed deals", async ({ request }) => {
  const h = await session(request);
  const [overview, pipeline] = await Promise.all([get(request, h, "overview"), get(request, h, "pipeline-intel")]);
  expect(pipeline.minClosedDeals).toBe(20);
  expect(overview.kpis.minClosedDeals).toBe(20);
  const closed = pipeline.totals.won + pipeline.totals.lost;
  if (closed < 20) {
    expect(pipeline.totals.winRate, `${closed} closed deals is not enough for a win rate`).toBeNull();
    expect(pipeline.forecast.winRate).toBeNull();
    expect(pipeline.forecast.likely).toBe(0);
  } else {
    expect(pipeline.totals.winRate).not.toBeNull();
  }
  // An estimate on Overview needs at least one account with enough closed deals.
  if (overview.kpis.estimateAccounts === 0) expect(overview.kpis.expectedRevenue).toBeNull();
  // An estimate can never be larger than the pipeline it comes from.
  if (overview.kpis.expectedRevenue !== null) expect(overview.kpis.expectedRevenue).toBeLessThanOrEqual(overview.kpis.openValue);
});

test("the rendered screens show the same open pipeline value", async ({ page, request }) => {
  const h = await session(request);
  const k = (await get(request, h, "overview")).kpis;
  for (const view of ["overview", "pipeline"]) {
    await page.goto(`/app#${view}`);
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(money(k.openValue), { exact: false }).first(), `#${view} shows ${money(k.openValue)}`).toBeVisible();
  }
});

test("the Pipeline screen explains the numbers: left-out deals, the outlier and the estimate label", async ({ page }) => {
  await page.goto("/app#pipeline");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("not counted in these figures", { exact: false })).toBeVisible();
  await expect(page.getByText("Estimate, not a fact", { exact: false }).first()).toBeVisible();
});
