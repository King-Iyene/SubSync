import { describe, expect, it } from "vitest";
import { leftOutReasons, type TrustDeal } from "@/lib/analytics/deal-trust";
import { bucketOf } from "@/lib/analytics/pipeline3-intel";
import type { Pl3Forecast, Pl3Overview, Pl3Sources, Pl3WonLost } from "@/lib/analytics/pipeline3-types";
import {
  asHealthOut, bandOf, dealHealthFacts, dealIssues, DEAL_JOB_DEFS, DEAL_JOB_FLAG, DEAL_JOB_IDS, dollarCounted, dueFor, followUpFacts, forecastFacts, forecastGate, mapPlans, MAX_FOLLOWUP_DEALS, notEnoughClosed,
  valueText, winLossFacts, winLossGate, type DealJobRow,
} from "@/lib/ai/deal-jobs";
import { runJob, type AiStore, type Conn, type Deps, type JobRequest, type RunRow } from "@/lib/ai/gateway";
import { JOBS, JOB_IDS, liveJobs } from "@/lib/ai/jobs";
import type { Fetch } from "@/lib/ai/providers";
import { jobState } from "@/lib/ai/deal-jobs-run";
import { DEFAULT_OFF } from "@/lib/flags-core";

// Golden tests for the four deal jobs. No real provider is ever called: every request goes to a fake fetch, and every number the model sees is read back from the facts the builders make.

const NOW = Date.UTC(2026, 10, 12, 9);
const row = (o: Partial<DealJobRow> = {}): DealJobRow => {
  const base: DealJobRow = {
    opportunityId: "opp1", locationId: "locA", accountName: "Acme", contactId: "c1", contactName: "Ann Lee", name: "Roof job", url: null, pipelineId: "p1", pipelineName: "Sales", stageId: "s2", stageName: "Proposal",
    status: "open", value: 4200, bucket: "stale", ownerId: "u1", ownerName: "Sam", source: "Facebook", lostReason: null, createdAt: null, lastStageChangeAt: null, daysInStage: 21.6, staleLimitDays: 12.2, stale: true,
    health: 55, healthWhy: "x", appointment: null, why: null, dnd: false, outlier: false, isTest: false, leftOutReason: null,
    daysSinceActivity: 18.4, stageNormalDays: 6.1, hasPhone: true, hasEmail: true,
  };
  return { ...base, ...o };
};

describe("registry and flags", () => {
  it("registers the four deal jobs as live, suggest-only, tool-free, each behind its own default-off flag", () => {
    expect(DEAL_JOB_IDS).toEqual(["deal_health", "deal_followup", "deal_winloss", "deal_forecast"]);
    for (const id of DEAL_JOB_IDS) {
      expect(JOB_IDS).toContain(id);
      expect(JOBS[id]).toMatchObject({ status: "live", approval: "suggest", tools: [], maxToolRounds: 0 });
      expect(JOBS[id].output.kind).toBe("json");
      expect(liveJobs().map((j) => j.id)).toContain(id);
      expect(DEAL_JOB_DEFS[id].system).toMatch(/Never say anything was sent, fixed, moved or changed/);
    }
    expect(JOBS.deal_health.privacy).toBe("names_optin");
    expect(JOBS.deal_followup.privacy).toBe("names_optin");
    expect(JOBS.deal_winloss.privacy).toBe("aggregate");
    expect(JOBS.deal_forecast.privacy).toBe("aggregate");
  });
  it("the flags exist and default off", () => {
    for (const id of DEAL_JOB_IDS) expect(DEFAULT_OFF.has(DEAL_JOB_FLAG[id] as never)).toBe(true);
  });
  it("with the flag off the button state is off and no database is read", async () => {
    expect(await jobState("inst", "", "deal_health", false)).toBe("off");
  });
});

describe("deal-trust parity: the AI is never given a figure the screens leave out", () => {
  it("only counted deals carry a dollar figure; the rest say why they are not counted, never the amount", () => {
    expect(dollarCounted(row())).toBe(true);
    expect(valueText(row())).toBe("$4,200");
    expect(valueText(row({ bucket: "test", isTest: true, value: 3300 }))).toBe("not counted (looks like a test deal)");
    expect(valueText(row({ bucket: "outlier", outlier: true, leftOutReason: "default_value", value: 2000 }))).toBe("not counted (looks like a default value)");
    expect(valueText(row({ bucket: "outlier", outlier: true, leftOutReason: "outlier", value: 1_000_000 }))).not.toContain("1,000,000");
    expect(valueText(row({ bucket: "no_owner", ownerId: null, value: 9100 }))).toBe("not counted (nobody owns the deal)");
    expect(valueText(row({ bucket: "no_value", value: 0 }))).toBe("no value set");
    expect(valueText(row({ status: "won", bucket: "won" }))).not.toBe("$4,200");
  });
  it("agrees with the pure left-out rules on a fixture: the dollars in the facts equal the counted dollars", () => {
    const deals: TrustDeal[] = [
      { id: "a", locationId: "L", pipelineKey: "sales", stageKey: "q", value: 4000, owner: "u" },
      { id: "b", locationId: "L", pipelineKey: "sales", stageKey: "q", value: 6000, owner: "u" },
      { id: "t", locationId: "L", pipelineKey: "sales", stageKey: "q", value: 3300, owner: "u", name: "Test deal" },
      { id: "m", locationId: "L", pipelineKey: "sales", stageKey: "q", value: 1_000_000, owner: "u" },
      ...Array.from({ length: 25 }, (_, i): TrustDeal => ({ id: `c${i}`, locationId: "L", pipelineKey: "cold", stageKey: "c1", value: 2000, owner: "u" })),
    ];
    const left = leftOutReasons(deals);
    const rows = deals.map((d) => {
      const why = left.get(d.id) ?? null, isTest = why === "test", outlier = why !== null && why !== "test";
      return row({ opportunityId: d.id, value: d.value, isTest, outlier, leftOutReason: why, stale: false, bucket: bucketOf({ status: "open", stale: false, outlier, isTest, ownerId: "u", value: d.value, counted: why === null }) });
    });
    const shown = rows.filter((r) => dollarCounted(r)).reduce((a, r) => a + (r.value ?? 0), 0);
    expect(shown).toBe(10_000);
    const text = followUpFacts(rows.slice(0, 4).map((r) => ({ ...r, stale: true })), NOW, false).facts.text;
    expect(text).toContain("$4,000");
    expect(text).toContain("$6,000");
    expect(text).not.toContain("3,300");
    expect(text).not.toContain("1,000,000");
  });
});

describe("1. deal health", () => {
  it("the badge is a rule on the score", () => {
    expect([bandOf(95), bandOf(80), bandOf(79), bandOf(50), bandOf(49), bandOf(null)]).toEqual(["healthy", "healthy", "needs_look", "needs_look", "at_risk", null]);
  });
  it("finds what is stuck and missing from the deal's own fields and the step's own normal", () => {
    const ids = dealIssues(row({ ownerId: null, value: 0 }), NOW).map((i) => i.id);
    expect(ids).toEqual(["no_owner", "no_value", "stuck", "quiet", "no_appointment"]);
    expect(dealIssues(row({ stale: false, daysSinceActivity: 3, appointment: { appointmentId: "a", startAt: new Date(NOW + 86_400_000).toISOString(), status: "confirmed" } }), NOW)).toEqual([]);
    expect(dealIssues(row({ status: "won" }), NOW)).toEqual([]);
  });
  it("sends whole numbers, no phone, email or name unless the account opted in", () => {
    const f = dealHealthFacts(row(), NOW, false);
    expect(f.includesNames).toBe(false);
    expect(f.text).toContain("Days in this step: 21");
    expect(f.text).toContain("Usual limit for this step in this account: 12 days");
    expect(f.text).toContain("Days since any activity: 18");
    expect(f.text).toContain("55 out of 100, Needs a look");
    expect(f.text).not.toMatch(/Ann Lee|Roof job|@|\d{7}/);
    const n = dealHealthFacts(row(), NOW, true);
    expect(n.text).toContain("Ann Lee");
    expect(n.includesNames).toBe(true);
    expect(n.fields.join(" ")).toMatch(/contact name/);
  });
  it("a closed deal is not judged", () => {
    expect(dealHealthFacts(row({ status: "lost", health: null }), NOW, false).text).toContain("Health: not judged");
  });
});

describe("2. follow-up plan", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ opportunityId: `o${i}`, contactId: `c${i}`, name: `Deal ${i}` }));
  it("caps at ten, never includes a person who asked not to be contacted, and labels each deal", () => {
    const pick = followUpFacts([...many(14), row({ opportunityId: "dnd", dnd: true })], NOW, false);
    expect(pick.asked).toBe(MAX_FOLLOWUP_DEALS);
    expect(pick.refs.size).toBe(10);
    expect([...pick.refs.keys()][0]).toBe("D1");
    expect(pick.facts.text).not.toContain("Deal 3");
    expect(followUpFacts([row({ dnd: true })], NOW, false)).toMatchObject({ asked: 0, skippedDnd: 1 });
    expect(pick.facts.text).toContain("can be reached by phone and email");
    expect(pick.facts.text).not.toMatch(/@|\+?\d{7,}/);
  });
  it("maps the plans: unknown and repeated labels dropped, a channel nobody can use becomes review, the task and its due time come from our code", () => {
    const rows = [row({ opportunityId: "o1", hasPhone: false, hasEmail: false }), row({ opportunityId: "o2", hasPhone: true, hasEmail: false, contactId: null })];
    const pick = followUpFacts(rows, NOW, false);
    const out = mapPlans({ plans: [
      { ref: "D1", channel: "call", timing: "today", say: "Ask if the quote still fits", why: "quiet for 18 days" },
      { ref: "D2", channel: "email", timing: "tomorrow", say: "Check in", why: "w" },
      { ref: "D9", channel: "call", timing: "today", say: "x", why: "y" },
      { ref: "D1", channel: "text", timing: "today", say: "again", why: "y" },
    ] }, pick.refs, NOW);
    expect(out.dropped).toBe(2);
    expect(out.items.map((i) => [i.ref, i.channel])).toEqual([["D1", "review"], ["D2", "call"]]);
    expect(out.items[0].task?.title).toContain("Roof job");
    expect(out.items[0].task?.dueDate).toBe(dueFor("today", NOW));
    expect(out.items[1].task).toBeNull();
  });
});

describe("3. win and loss review", () => {
  const wl = (won: number, lost: number): Pl3WonLost => ({
    won: { value: 52_000, n: won }, lost: { value: 31_000, n: lost }, winRate: { value: won / Math.max(1, won + lost), n: won, of: won + lost, enough: won + lost >= 15 }, avgWon: { value: 5200, n: won, enough: won >= 15 }, medianCycleDays: 21.4,
    lostReasons: [{ reason: "Price", count: 6, value: 9000, noReason: false }, { reason: "No reason recorded", count: 3, value: 100, noReason: true }], lostReasonsEnough: lost >= 10, noReasonShare: 0.25,
    bookedToWon: { booked: 12, won: 8, rate: { value: 0.66, n: 8, of: 12, enough: false } }, byMonth: [{ month: "2026-10", won: 3, lost: 4, wonValue: 1, lostValue: 1 }], list: { rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false },
  });
  it("below 15 closed deals the answer is the plain sentence and no AI runs", () => {
    expect(winLossGate(wl(6, 8))).toEqual({ ok: false, closed: 14, needed: 15, message: "Not enough closed deals yet (14 of 15 needed)" });
    expect(winLossGate(wl(7, 8))).toEqual({ ok: true });
    expect(notEnoughClosed(0)).toBe("Not enough closed deals yet (0 of 15 needed)");
  });
  it("sends aggregates only, with sources only where there are enough deals", () => {
    const src: Pl3Sources = { bySource: [{ source: "Facebook", created: 20, open: 4, won: 6, lost: 6, winRate: { value: 0.5, n: 6, of: 12, enough: false }, wonValue: 1, avgCycleDays: 3 }, { source: "Google", created: 30, open: 5, won: 10, lost: 10, winRate: { value: 0.5, n: 10, of: 20, enough: true }, wonValue: 1, avgCycleDays: 3 }], byValueBand: [], sourceBlank: 0 };
    const f = winLossFacts(wl(8, 10), src, "the 30 days chosen on the date bar");
    expect(f.includesNames).toBe(false);
    expect(f.text).toContain("Closed deals: 18 (won 8, lost 10)");
    expect(f.text).toContain("Price 6");
    expect(f.text).toContain("Google won 10 of 20 closed (50%)");
    expect(f.text).not.toContain("Facebook");
  });
});

describe("4. forecast in words", () => {
  const est = (value: number | null, enough: boolean) => ({ value, low: value === null ? null : 8000, high: value === null ? null : 16000, enough, estimate: true as const, formula: "the formula", minNote: null });
  const fc = (closed: number, ok = true): Pl3Forecast => ({ next30: est(ok ? 12_000 : null, ok), weightedOpen: est(null, false), velocity: est(null, false), stageProb: [], capped: [], track: { enough: false, coverage: { value: null, n: 0, of: 0, enough: false }, bias: null, months: [] }, minClosed: 15, closedDeals: closed });
  const ov = { openCount: 40, openValue: { value: 90_000, n: 40 }, stale: { count: 9, value: 21_000 }, winRate: { value: 0.4, n: 12, of: 30, enough: true }, medianWonCycleDays: 17.2, trust: { counting: "c", leftOutLine: "l", leftOutDeals: 6, notJudged: 0, howStale: "", howLeftOut: "" }, health: { score: 70, noOwner: 3, noValue: 1, test: 2, outliers: 1 } } as unknown as Pl3Overview;
  it("gates on the minimum and on nothing to forecast, with no AI", () => {
    expect(forecastGate(fc(9, false))).toMatchObject({ ok: false, message: "Not enough closed deals yet (9 of 15 needed)" });
    expect(forecastGate(fc(20, false))).toMatchObject({ ok: false, message: "There are no counted open deals to forecast from yet." });
    expect(forecastGate(fc(20))).toEqual({ ok: true });
  });
  it("the forecast figure in the words input is exactly the one from our code", () => {
    const f = forecastFacts(fc(30), ov);
    expect(f.text).toContain("about $12,000, in a range of $8,000 to $16,000");
    expect(f.text).toContain("Stuck open deals: 9, worth $21,000");
    expect(f.text).toContain("Left out of every money figure (never deleted): 6 deals");
    expect(f.includesNames).toBe(false);
  });
});

// ---------------- through the gateway, with a mock provider ----------------

function memStore(conn: Partial<Conn> | null, spend = 0) {
  const runs: RunRow[] = [];
  const store: AiStore = {
    connection: async (_i, scope) => (conn && (conn.scope ?? "") === scope ? ({ scope, method: "key", provider: "openai", baseUrl: null, apiKey: "sk-test-1234567890", model: "gpt-x", status: "connected", monthlyCapUsd: 5, paused: false, shareNames: false, jobs: Object.fromEntries(DEAL_JOB_IDS.map((j) => [j, true])), ...conn } as Conn) : null),
    cachedRun: async (_i, _s, key) => { const r = runs.find((x) => x.idempotencyKey === key && x.status === "ok"); return r ? { id: "run-1", output: r.output ?? "" } : null; },
    monthSpendUsd: async () => spend + runs.reduce((a, r) => a + r.costUsd, 0),
    runsSince: async () => runs.length,
    insertRun: async (r) => { runs.push(r); return `run-${runs.length}`; },
    markNeedsAttention: async () => undefined,
  };
  return { store, runs };
}
const reply = (content: unknown) => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
const okFetch = (replies: unknown[], calls: unknown[] = []): Fetch => async (url, init) => { calls.push([url, init]); return { status: 200, text: async () => JSON.stringify(replies.shift()) }; };
const deps = (store: AiStore, fetch: Fetch, more: Partial<Deps> = {}): Deps => ({ store, fetch, sleep: async () => undefined, killAll: () => false, now: () => NOW, ...more });
const req = (job: JobRequest["job"], facts: JobRequest["input"], more: Partial<JobRequest> = {}): JobRequest => ({ installationId: "inst-1", locationId: "locA", userKey: "u1", job, trigger: "view", input: facts, ...more });

describe("the deal jobs through the gateway", () => {
  it("health: a good answer passes the number check and parses; the log keeps one ok run", async () => {
    const { store, runs } = memStore({});
    const facts = dealHealthFacts(row(), NOW, false);
    const r = await runJob(deps(store, okFetch([reply({ summary: "This deal has sat 21 days in Proposal; the usual limit is 12.", stuck: "It is stuck in Proposal.", missing: "No appointment is booked.", likelyReason: "Probably the quote went quiet." })])), req("deal_health", facts));
    expect(r.ok).toBe(true);
    expect(r.ok && asHealthOut(r.json)?.summary).toContain("21 days");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ok", job: "deal_health", includesNames: false });
  });
  it("health: a number we did not give it is rejected and shown to nobody", async () => {
    const { store, runs } = memStore({});
    const r = await runJob(deps(store, okFetch([reply({ summary: "Stuck for 45 days.", stuck: "", missing: "", likelyReason: "" })])), req("deal_health", dealHealthFacts(row(), NOW, false)));
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(runs[0].status).toBe("rejected");
  });
  it("health: a claim that something was done is rejected, a wrong shape is rejected", async () => {
    const f = dealHealthFacts(row(), NOW, false);
    expect(await runJob(deps(memStore({}).store, okFetch([reply({ summary: "We sent a reminder to the lead.", stuck: "", missing: "", likelyReason: "" })])), req("deal_health", f))).toMatchObject({ ok: false, code: "rejected" });
    expect(await runJob(deps(memStore({}).store, okFetch([reply({ summary: "ok" })])), req("deal_health", f))).toMatchObject({ ok: false, code: "rejected" });
  });
  it("opt-in gating: facts with names are refused unless the account opted in, and nothing is sent", async () => {
    const calls: unknown[] = [];
    const named = dealHealthFacts(row(), NOW, true);
    expect(await runJob(deps(memStore({ shareNames: false }).store, okFetch([], calls)), req("deal_health", named))).toMatchObject({ ok: false, code: "rejected" });
    expect(calls).toHaveLength(0);
    const ok = await runJob(deps(memStore({ shareNames: true }).store, okFetch([reply({ summary: "Ann Lee's deal has sat 21 days in Proposal.", stuck: "", missing: "", likelyReason: "" })])), req("deal_health", named));
    expect(ok.ok).toBe(true);
    const plan = followUpFacts([row()], NOW, true).facts;
    expect(await runJob(deps(memStore({ shareNames: false }).store, okFetch([], calls)), req("deal_followup", plan))).toMatchObject({ ok: false, code: "rejected" });
    expect(calls).toHaveLength(0);
  });
  it("follow-up: only labels from the list survive, and the model's words pass the number check", async () => {
    const pick = followUpFacts([row(), row({ opportunityId: "o2" })], NOW, false);
    const good = { plans: [{ ref: "D1", channel: "call", timing: "today", say: "Ask how the quote looks", why: "Quiet for 18 days" }, { ref: "D2", channel: "email", timing: "tomorrow", say: "Check in", why: "No appointment" }] };
    const r = await runJob(deps(memStore({}).store, okFetch([reply(good)])), req("deal_followup", pick.facts));
    expect(r.ok).toBe(true);
    expect(mapPlans(r.ok ? r.json : null, pick.refs, NOW).items).toHaveLength(2);
    const bad = { plans: [{ ref: "D1", channel: "call", timing: "today", say: "Call within 48 hours", why: "x" }] };
    expect(await runJob(deps(memStore({}).store, okFetch([reply(bad)])), req("deal_followup", pick.facts))).toMatchObject({ ok: false, code: "rejected" });
    const wrongChannel = { plans: [{ ref: "D1", channel: "fax", timing: "today", say: "x", why: "y" }] };
    expect(await runJob(deps(memStore({}).store, okFetch([reply(wrongChannel)])), req("deal_followup", pick.facts))).toMatchObject({ ok: false, code: "rejected" });
  });
  it("win/loss and forecast: pass with the given figures, fail with an invented one", async () => {
    const wlFacts = winLossFacts({ won: { value: 52_000, n: 8 }, lost: { value: 31_000, n: 10 }, winRate: { value: 0.44, n: 8, of: 18, enough: true }, avgWon: { value: 6500, n: 8, enough: false }, medianCycleDays: 21, lostReasons: [{ reason: "Price", count: 6, value: 1, noReason: false }], lostReasonsEnough: true, noReasonShare: null, bookedToWon: { booked: 0, won: 0, rate: { value: null, n: 0, of: 0, enough: false } }, byMonth: [], list: { rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false } }, null, "the 30 days chosen on the date bar");
    const okWl = { summary: "Price was the main reason deals were lost, 6 of 10.", wins: [], losses: ["Price came up 6 times."], tryNext: [] };
    expect((await runJob(deps(memStore({}).store, okFetch([reply(okWl)])), req("deal_winloss", wlFacts, { locationId: "" }))).ok).toBe(true);
    expect(await runJob(deps(memStore({}).store, okFetch([reply({ ...okWl, summary: "Price caused 7 of the losses." })])), req("deal_winloss", wlFacts, { locationId: "" }))).toMatchObject({ code: "rejected" });
    const fcFacts = forecastFacts({ next30: { value: 12_000, low: 8000, high: 16_000, enough: true, estimate: true, formula: "f", minNote: null }, weightedOpen: { value: null, low: null, high: null, enough: false, estimate: true, formula: "", minNote: null }, velocity: { value: null, low: null, high: null, enough: false, estimate: true, formula: "", minNote: null }, stageProb: [], capped: [], track: { enough: false, coverage: { value: null, n: 0, of: 0, enough: false }, bias: null, months: [] }, minClosed: 15, closedDeals: 30 }, null);
    const okFc = { summary: "It is an estimate of about $12,000 and rests on 30 closed deals.", couldMoveUp: [], couldMoveDown: [], doNext: [] };
    expect((await runJob(deps(memStore({}).store, okFetch([reply(okFc)])), req("deal_forecast", fcFacts, { locationId: "" }))).ok).toBe(true);
    expect(await runJob(deps(memStore({}).store, okFetch([reply({ ...okFc, summary: "Expect about $13,000." })])), req("deal_forecast", fcFacts, { locationId: "" }))).toMatchObject({ code: "rejected" });
  });
  it("cap, pause, job switch, no connection and the global kill switch all stop a deal job before any call", async () => {
    const never: Fetch = async () => { throw new Error("must not be called"); };
    const f = dealHealthFacts(row(), NOW, false);
    expect(await runJob(deps(memStore({ monthlyCapUsd: 5 }, 5).store, never), req("deal_health", f))).toMatchObject({ code: "cap" });
    expect(await runJob(deps(memStore({ paused: true }).store, never), req("deal_health", f))).toMatchObject({ code: "paused" });
    expect(await runJob(deps(memStore({ jobs: { deal_health: false } }).store, never), req("deal_health", f))).toMatchObject({ code: "job_off" });
    expect(await runJob(deps(memStore(null).store, never), req("deal_health", f))).toMatchObject({ code: "no_connection" });
    expect(await runJob(deps(memStore({}).store, never, { killAll: () => true }), req("deal_health", f))).toMatchObject({ code: "killed" });
  });
  it("does not call the provider twice for the same facts", async () => {
    const { store } = memStore({});
    const calls: unknown[] = [];
    const f = okFetch([reply({ summary: "21 days in Proposal.", stuck: "", missing: "", likelyReason: "" })], calls);
    const facts = dealHealthFacts(row(), NOW, false);
    await runJob(deps(store, f), req("deal_health", facts));
    expect(await runJob(deps(store, f), req("deal_health", facts))).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1);
  });
});
