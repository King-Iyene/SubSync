import { expect, test, type APIRequestContext } from "@playwright/test";

// Stage F1 (numbers truth plus audits) on the demo tenant, which is messy on purpose: deals in a Disqualified stage and in a pipeline marked not in
// use, a cold list, conversations that are both unread and waiting. The checks that read the API run once (desktop); the ones that read the screen
// run at the three widths.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function headers(request: APIRequestContext) {
  const s = await request.post("/api/sso", { data: { demo: true } });
  expect(s.ok()).toBeTruthy();
  return { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
}
async function get(request: APIRequestContext, path: string, filter = ""): Promise<Json> {
  const res = await request.get(`/api/app/${path}${filter ? (path.includes("?") ? "&" : "?") + filter : ""}`, { headers: await headers(request) });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
}
const apiOnly = (testInfo: { project: { name: string } }) => testInfo.project.name !== "desktop-1440";

test.describe("numbers (API, desktop only)", () => {
  test.beforeEach(async ({}, testInfo) => { test.skip(apiOnly(testInfo), "the numbers do not change with the window width"); });

  test("unread is one figure on Today, Overview and the Inbox, and the Inbox says how many are also waiting (285 versus 259)", async ({ request }) => {
    const [daily, overview, inbox] = await Promise.all([get(request, "daily"), get(request, "overview"), get(request, "inbox")]);
    const unreadToday = (daily.headlines as Array<{ key: string; change: { today: number } }>).find((h) => h.key === "unread")!.change.today;
    expect(unreadToday, "Today and Overview count the same unread conversations").toBe(overview.kpis.unread);
    expect(inbox.unread.unread, "the Inbox shows that figure too").toBe(overview.kpis.unread);
    expect(inbox.unread.unreadAndWaiting + inbox.unread.unreadNotWaiting).toBe(inbox.unread.unread);
    expect(inbox.unread.unreadAndWaiting, "the demo has conversations that are both unread and waiting").toBeGreaterThan(0);
    const rows = inbox.items as Json[];
    expect(rows.filter((r) => r.unreadCount > 0).length).toBe(inbox.unread.unread);
    expect(rows.filter((r) => r.unreadCount > 0 && r.overSla).length).toBe(inbox.unread.unreadAndWaiting);
  });

  test("the wait chart counts the same customers as the list, and an old thread is never critical (N15)", async ({ request }) => {
    const [inbox, comms] = await Promise.all([get(request, "inbox"), get(request, "comms-intel")]);
    expect(comms.aging.total).toBe(inbox.waitingTotal);
    const waiting = (inbox.items as Json[]).filter((r) => r.overSla);
    expect(comms.aging.critical).toBe(waiting.filter((r) => r.waitingHours >= 24 && r.waitingHours < 168).length);
    expect(comms.aging.older).toBe(waiting.filter((r) => r.waitingHours >= 168).length);
    expect(comms.aging.critical + comms.aging.older).toBeLessThanOrEqual(comms.aging.total);
    expect(comms.aging.buckets.at(-1).label).toBe("Older than a week");
  });

  test("a label is never better than the customers waiting: at least 5 waiting is Watch or worse, 15 is At risk; nobody Healthy sits in Needs attention (N16)", async ({ request }) => {
    const [accounts, overview] = await Promise.all([get(request, "accounts"), get(request, "overview")]);
    const order = ["thriving", "healthy", "watch", "at_risk"];
    let held = 0;
    for (const a of accounts.accounts as Json[]) {
      if (a.unanswered >= 15) expect(a.band, `${a.name}: ${a.unanswered} waiting`).toBe("at_risk");
      else if (a.unanswered >= 5) expect(order.indexOf(a.band), `${a.name}: ${a.unanswered} waiting`).toBeGreaterThanOrEqual(order.indexOf("watch"));
      if (a.bandNote) { held++; expect(a.bandNote).toContain("waiting for a reply"); }
    }
    expect(held, "the demo has an account whose label was held down").toBeGreaterThan(0);
    for (const a of overview.attention as Json[]) expect(["watch", "at_risk"], `${a.name} in Needs attention`).toContain(a.band);
  });

  test("closed-out stages and unused pipelines are in the left-out count and never in open pipeline; the owner's controls say what decided it (N38)", async ({ request }) => {
    const [pipeline, overview] = await Promise.all([get(request, "pipeline-intel"), get(request, "overview")]);
    expect(pipeline.excluded.closedOut).toBeGreaterThanOrEqual(6);
    expect(pipeline.totals.openValue).toBe(overview.kpis.openValue);
    const c = pipeline.stageControls;
    expect(c.canEdit).toBe(true);
    const dq = (c.stages as Json[]).find((s) => s.stage === "Disqualified")!;
    expect(dq.out).toBe(true);
    expect(dq.source).toBe("name");
    expect(dq.why).toContain("name");
    expect(dq.treatment).toBe("Closed out");
    const legacy = (c.pipelines as Json[]).find((p) => String(p.name).includes("Not IN USE"))!;
    expect(legacy.notInUse).toBe(true);
    expect(legacy.source).toBe("name");
    // The stage table never lists a closed-out stage as a place deals are open in.
    expect((pipeline.stages as Json[]).some((s) => s.stageName === "Disqualified")).toBe(false);
    expect((pipeline.stages as Json[]).some((s) => s.pipelineName === "Legacy pipeline [Not IN USE]")).toBe(false);
  });

  test("the forecast says how it is worked out and never shows a number it cannot back (N37)", async ({ request }) => {
    const f = (await get(request, "pipeline-intel")).forecast;
    expect(["history", "owner", "none"]).toContain(f.method);
    expect(f.explain.formula.length).toBeGreaterThan(20);
    expect(f.explain.inputs.length).toBeGreaterThanOrEqual(3);
    expect(f.explain.excluded.length).toBeGreaterThanOrEqual(2);
    if (f.range === null) expect(f.basis).toContain("20 closed deals");
    else expect(f.range.low).toBeLessThan(f.range.high);
    if (f.horizons) {
      expect(new Set(f.horizons.map((h: Json) => h.likely)).size, "the 30, 60 and 90 day figures are not one number repeated").toBeGreaterThan(1);
      expect(f.cycleSample).toBeGreaterThanOrEqual(10);
    }
  });

  test("a percentage is only shown on a base big enough to measure one against (N6)", async ({ request }) => {
    const daily = await get(request, "daily");
    for (const h of daily.headlines as Array<{ key: string; money: boolean; change: Json }>) {
      const base = h.money ? 5000 : 10;
      if (h.change.yesterday !== null && h.change.yesterday < base) expect(h.change.vsYesterday, `${h.key}: yesterday ${h.change.yesterday}`).toBeNull();
    }
    const ex = await get(request, "exec-summary");
    for (const k of ex.kpis as Json[]) if (k.previous !== null && k.previous < (k.money ? 5000 : 10)) expect(k.pct, k.key).toBeNull();
  });

  test("history is not mixed across a change of definition: the pipeline line and the account trend say what was left out (N39)", async ({ request }) => {
    const p = await get(request, "pipeline-intel");
    const days = (p.trend as Json[]).map((t) => t.day);
    expect(new Set(days).size).toBe(days.length);
    if (p.trendNote) expect(p.trendNote).toContain("not drawn");
    const accounts = await get(request, "accounts");
    const detail = await get(request, `accounts/${accounts.accounts[0].locationId}`);
    for (const t of detail.trend as Json[]) expect(typeof t.dealsOk).toBe("boolean");
  });

  test("Leads: cold lists are apart from working leads, engagement is stated with its limit, and the open-deal counts are told apart (N45, UX-02)", async ({ request }) => {
    const d = await get(request, "contact-intel");
    const e = d.engagement;
    expect(e.working + e.cold).toBe(d.lifecycle.total);
    expect(e.recent + e.quietAfter + e.noneSeen).toBe(e.working);
    expect(e.cold, "the demo has a cold list").toBeGreaterThan(0);
    expect(e.coldLists.map((c: Json) => c.tag)).toContain("cold email outreach");
    expect(d.lifecycle.opportunitiesCounted).toBeLessThanOrEqual(d.lifecycle.opportunities);
    expect(d.canEditCold).toBe(true);
  });

  test("Leads: data quality says how many were checked, separates missing from invalid, and sources turn into an action (N46, N47)", async ({ request }) => {
    const q = (await get(request, "contact-intel")).quality;
    for (const k of ["invalidEmails", "invalidPhones", "disposableEmails", "missingEmails", "missingPhones"]) {
      expect(["checked", "not_checked"]).toContain(q[k].state);
      if (q[k].state === "checked") expect(q[k].of).toBeGreaterThan(0);
      else expect(q[k].reason.length).toBeGreaterThan(5);
    }
    expect(q.missingEmails.value, "missing is a count of its own").toBeGreaterThan(0);
    const s = (await get(request, "contact-intel")).sourceSummary;
    expect(s.kinds.length).toBeGreaterThan(0);
    if (s.noSourcePct !== null && s.noSourcePct >= 50 && s.total >= 20) expect(s.action.steps.length).toBe(3);
    else expect(s.action).toBeNull();
  });

  test("the same filter gives the same numbers on every page for the demo too (N8)", async ({ request }) => {
    for (const filter of ["owner=Sam", "industry=medical", "hideTest=1"]) {
      const [ov, acc, pi, ib, dl, co, tm] = await Promise.all(["overview", "accounts", "pipeline-intel", "inbox", "daily", "contact-intel", "team"].map((p) => get(request, p, filter)));
      const live = (acc.accounts as Json[]).filter((a) => !a.ignored);
      expect(ov.kpis.accounts, filter).toBe(live.length);
      expect(live.reduce((s, a) => s + a.openValue, 0), filter).toBe(ov.kpis.openValue);
      expect(pi.totals.openValue, filter).toBe(ov.kpis.openValue);
      expect(pi.totals.open, filter).toBe(ov.kpis.openOpps);
      expect(pi.excluded.count, filter).toBe(ov.kpis.excludedDeals);
      expect(ib.unread.unread, filter).toBe(ov.kpis.unread);
      expect(ib.waitingTotal, filter).toBe(ov.kpis.unanswered);
      expect(dl.accounts, filter).toBe(ov.kpis.accounts);
      expect(co.lifecycle.total, filter).toBe(ov.kpis.contacts);
      expect((tm.members as Json[]).reduce((s, m) => s + m.openCount, 0), filter).toBe(ov.kpis.openOpps);
    }
  });
});

test.describe("the screens", () => {
  test("Pipeline: the forecast with its method, the owner's stage controls and the left-out sentence", async ({ page }) => {
    await page.goto("/app#pipeline");
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Revenue forecast").first()).toBeVisible();
    await expect(page.getByTestId("forecast-how")).toBeVisible();
    await page.getByTestId("forecast-how").locator("summary").click();
    await expect(page.getByText("Left out", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Stages and pipelines", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("in a closed-out stage or a pipeline not in use", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Disqualified", { exact: false }).first()).toBeVisible();
  });

  test("Inbox: unread is told apart from waiting, in words", async ({ page, request }) => {
    const unread = (await get(request, "inbox")).unread;
    await page.goto("/app#inbox");
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(`Unread (${unread.unread})`)).toBeVisible();
    await expect(page.getByTestId("unread-explainer")).toContainText("not the same as waiting for a reply");
    await expect(page.getByTestId("unread-explainer")).toContainText(`${unread.unreadAndWaiting} of the ${unread.unread} are also waiting`);
    await expect(page.getByText("How long customers have been waiting")).toBeVisible();
  });

  test("Leads: cold lists, who has engaged, data quality with its denominators, and the sources action", async ({ page }) => {
    await page.goto("/app#leads");
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Cold lists", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Working leads: who has engaged")).toBeVisible();
    await expect(page.getByTestId("counted-note")).toContainText("with a value and an owner");
    await expect(page.getByTestId("quality")).toContainText("checked");
    await expect(page.getByText("Missing emails")).toBeVisible();
    await expect(page.getByText("Engaged, then quiet", { exact: false }).first()).toBeVisible();
  });

  test("Overview: the left-out sentence names the closed-out deals; an account in Needs attention is never Healthy", async ({ page }) => {
    await page.goto("/app#overview");
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("in a closed-out stage or a pipeline not in use", { exact: false }).first()).toBeVisible();
    const attention = page.locator("section", { has: page.getByRole("heading", { name: "Needs attention" }) }).first();
    await expect(attention).toBeVisible();
    await expect(attention.getByText("Healthy", { exact: true })).toHaveCount(0);
    await expect(attention.getByText("Thriving", { exact: true })).toHaveCount(0);
  });

  // One test per page (a single test opening eleven pages runs over the 90 second limit on this machine's slow database link).
  for (const view of ["today", "overview", "inbox", "speed", "appointments", "pipeline", "leads", "accounts", "calls", "alerts", "team"]) {
    test(`#${view} never says '1 contacts', '1 deals' or any other number one with a plural noun (N62)`, async ({ page }) => {
      const wrong = /\b1 (contacts|deals|leads|conversations|accounts|appointments|customers|messages|calls|people|alerts|stages|pipelines)\b/;
      await page.goto(`/app#${view}`);
      await page.reload();
      await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const text = await page.locator("body").innerText();
      expect(text.match(wrong)?.[0] ?? null, `#${view}`).toBeNull();
    });
  }
});
