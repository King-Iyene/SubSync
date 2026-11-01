import { expect, test, type APIRequestContext } from "@playwright/test";

// F2: speed to lead on the messy demo tenant. Every account has 30 leads of which four are not people to chase (a spam tag, a test
// name, a CSV import and a repeat of the first contact's email); Blue Door Realty has Facebook and Instagram lead forms and portals.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function headers(request: APIRequestContext) {
  const res = await request.post("/api/sso", { data: { demo: true } });
  return { Authorization: `Bearer ${((await res.json()) as { session: string }).session}` };
}
const speed = async (request: APIRequestContext): Promise<Json> => {
  const res = await request.get("/api/app/speed", { headers: await headers(request) });
  expect(res.ok(), `speed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
};

test("contacts that are not leads are left out and the screen says why", async ({ request }) => {
  const d = await speed(request);
  const reasons = new Map<string, number>((d.leftOut as Json[]).map((r) => [r.reason, r.n]));
  for (const r of ["import", "spam", "test", "duplicate"]) expect(reasons.get(r) ?? 0, `${r} contacts are left out`).toBeGreaterThan(0);
  const total = [...reasons.values()].reduce((s, n) => s + n, 0);
  expect(total, "about four per account across the live accounts").toBeGreaterThanOrEqual(20);
});

test("no left-out contact appears in the waiting list, and the figures add up", async ({ request }) => {
  const d = await speed(request);
  const o = d.overall as Json;
  expect(o.leads).toBe(o.withinTarget + o.answeredLate + o.stillWaiting);
  expect(o.answered).toBe(o.withinTarget + o.answeredLate);
  expect(d.waiting.every((w: Json) => w.waitingMinutes > d.targetMinutes), "every waiting lead is past the target").toBeTruthy();
  // The per-account rows add up to the overall figure: one definition everywhere.
  const sum = (k: string) => (d.perAccount as Json[]).reduce((s, a) => s + a[k], 0);
  expect(sum("leads")).toBe(o.leads);
  expect(sum("stillWaiting")).toBe(o.stillWaiting);
  expect(sum("withinTarget")).toBe(o.withinTarget);
});

test("Facebook and Instagram lead forms are their own source with their own target", async ({ request }) => {
  const d = await speed(request);
  const meta = (d.bySource as Json[]).find((s) => s.cls === "meta");
  expect(meta, "a Meta lead form row exists").toBeTruthy();
  expect(meta?.targetMinutes).toBe(10);
  expect(meta?.leads).toBeGreaterThan(0);
  const classes = (d.bySource as Json[]).map((s) => s.cls);
  expect(classes).toContain("portal"); // Zillow, Realtor.com and open house sign-ins
});

test("the speed screen uses plain words and shows the left-out sentence", async ({ page }, testInfo) => {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/leads? (is|are) waiting for a reply|No leads are waiting for a reply/).first()).toBeVisible();
  await expect(page.getByText("were not counted as leads", { exact: false })).toBeVisible();
  await expect(page.getByText("Facebook and Instagram lead forms", { exact: false }).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `docs/review/f2-speed-${testInfo.project.name}.png`, fullPage: true });
});

test("the real estate sample audit page opens and says it is fictional", async ({ page }, testInfo) => {
  await page.goto("/audit/sample-real-estate-team-audit");
  await expect(page.getByText("Sample real estate team (fictional data)").first()).toBeVisible();
  await expect(page.getByText("Facebook and Instagram lead-form leads", { exact: false }).first()).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b|sub-?account|\blocations?\b/i);
  await page.screenshot({ path: `docs/review/f2-sample-audit-${testInfo.project.name}.png`, fullPage: true });
});
