import { expect, test, type APIRequestContext } from "@playwright/test";

// F8: every setting really changes behavior. Each test changes a setting on the demo tenant, reads the numbers it controls, and puts the
// setting back, so the demo is left as it was.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function client(request: APIRequestContext) {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  return {
    get: async (path: string): Promise<Json> => { const r = await request.get(`/api/app/${path}`, { headers }); expect(r.ok(), `${path}: ${r.status()}`).toBeTruthy(); return (await r.json()) as Json; },
    post: async (path: string, data: Json) => { const r = await request.post(`/api/app/${path}`, { headers, data }); expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBeTruthy(); },
    put: async (path: string, data: Json) => { const r = await request.put(`/api/app/${path}`, { headers, data }); expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBeTruthy(); },
  };
}

test.describe.configure({ mode: "serial" });

test("stale threshold: a shorter limit marks at least as many deals stale, a longer one at most as many", async ({ request }) => {
  const c = await client(request);
  const original = (await c.get("settings")).staleDays as number;
  try {
    await c.put("settings", { staleDays: 7 });
    const short = (await c.get("overview")).kpis.staleOpps as number;
    await c.put("settings", { staleDays: 365 });
    const long = (await c.get("overview")).kpis.staleOpps as number;
    expect(short, "7 days marks more deals stale than 365 days").toBeGreaterThan(long);
  } finally { await c.put("settings", { staleDays: original }); }
});

test("reply target: a tighter target counts at least as many conversations as waiting, a looser one at most as many", async ({ request }) => {
  const c = await client(request);
  const original = (await c.get("settings")).slaHours as number;
  try {
    await c.put("settings", { slaHours: 1 });
    const tight = (await c.get("overview")).kpis.unanswered as number;
    const inboxTight = (await c.get("inbox")).waitingTotal as number;
    await c.put("settings", { slaHours: 168 });
    const loose = (await c.get("overview")).kpis.unanswered as number;
    expect(tight).toBeGreaterThan(loose);
    expect(inboxTight, "the Inbox follows the same setting as Overview").toBe(tight);
  } finally { await c.put("settings", { slaHours: original }); }
});

test("speed target: the screen is judged against the target you set", async ({ request }) => {
  const c = await client(request);
  const original = (await c.get("settings")).speedTargetMinutes as number;
  try {
    await c.put("settings", { speedTargetMinutes: 5 });
    const tight = await c.get("speed");
    await c.put("settings", { speedTargetMinutes: 240 });
    const loose = await c.get("speed");
    expect(tight.targetMinutes).toBe(5);
    expect(loose.targetMinutes).toBe(240);
    expect(loose.overall.withinTarget, "a longer target is met at least as often").toBeGreaterThanOrEqual(tight.overall.withinTarget);
  } finally { await c.put("settings", { speedTargetMinutes: original }); }
});

test("bad values are refused with a plain message and change nothing", async ({ request }) => {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  for (const body of [{ staleDays: 2 }, { slaHours: 0 }, { speedTargetMinutes: 5000 }, { speedOpenHour: 18, speedCloseHour: 9 }, { brandName: "x".repeat(80) }, { appDomain: "not a domain" }]) {
    const r = await request.put("/api/app/settings", { headers, data: body });
    expect(r.status(), JSON.stringify(body)).toBe(400);
    expect(((await r.json()) as Json).error).toEqual(expect.any(String));
  }
});

test("business hours and the automatic-message option are saved and read back", async ({ request }) => {
  const c = await client(request);
  const before = await c.get("settings");
  try {
    await c.put("settings", { speedBusinessHours: true, speedOpenHour: 8, speedCloseHour: 18, countAutomatedTouches: true });
    const s = await c.get("settings");
    expect([s.speedBusinessHours, s.speedOpenHour, s.speedCloseHour, s.countAutomatedTouches]).toEqual([true, 8, 18, true]);
  } finally { await c.put("settings", { speedBusinessHours: before.speedBusinessHours, speedOpenHour: before.speedOpenHour, speedCloseHour: before.speedCloseHour, countAutomatedTouches: before.countAutomatedTouches }); }
});

test("brand name: sign-in carries it and the screens show it instead of ours", async ({ request, page }) => {
  const c = await client(request);
  await c.put("settings", { brandName: "Acme Marketing" });
  try {
    const sso = await request.post("/api/sso", { data: { demo: true } });
    expect(((await sso.json()) as Json).brand.name).toBe("Acme Marketing");
    await page.goto("/app#help");
    await page.reload();
    await expect(page.getByText("Acme Marketing").first()).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/subsync/i);
  } finally { await c.put("settings", { brandName: null }); }
});

test("Getting started ticks honestly: a step is done only when it is", async ({ request }) => {
  const c = await client(request);
  const steps = ((await c.get("start")).steps as Array<{ id: string; done: boolean }>);
  const by = Object.fromEntries(steps.map((s) => [s.id, s.done]));
  expect(by.connected).toBe(true);
  // The Slack step needs both a saved Slack address and the daily brief switched on; neither is true on the demo.
  expect(by.brief).toBe(false);
  await c.post("usage", { view: "search" });
  const after = Object.fromEntries((((await c.get("start")).steps) as Array<{ id: string; done: boolean }>).map((s) => [s.id, s.done]));
  expect(after.search, "opening Contact search ticks that step").toBe(true);
});

test("the What's new page lists today's changes and the roadmap, and a vote can be given and taken back", async ({ request }) => {
  const c = await client(request);
  const first = await c.get("roadmap");
  expect(first.changelog[0].title).toContain("Numbers you can trust");
  expect(first.items.length).toBeGreaterThan(0);
  const key = first.items[0].key as string;
  await c.post("roadmap", { key });
  expect(((await c.get("roadmap")).items as Json[]).find((i) => i.key === key)?.voted).toBe(true);
  await c.post("roadmap", { key }); // the same call again takes the vote back
  expect(((await c.get("roadmap")).items as Json[]).find((i) => i.key === key)?.voted).toBe(false);
});

test("the Settings page is in five groups with a jump list", async ({ page }) => {
  await page.goto("/app#settings");
  await page.reload();
  const jump = page.getByTestId("settings-jump");
  await expect(jump).toBeVisible();
  for (const label of ["Rules and targets", "Your brand", "Your clients", "Alerts and connections", "Privacy and data"]) await expect(jump.getByText(label)).toBeVisible();
  for (const id of ["g-rules", "g-brand", "g-alerts", "g-privacy"]) await expect(page.locator(`#${id}`)).toBeAttached();
});
