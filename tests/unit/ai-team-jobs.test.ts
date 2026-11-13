import { describe, expect, it } from "vitest";
import { JOB_IDS, JOBS, liveJobs } from "@/lib/ai/jobs";
import type { AiStore, Conn, Deps, RunRow } from "@/lib/ai/gateway";
import type { Fetch } from "@/lib/ai/providers";
import { OPT_IN_JOBS, TEAM_JOB_IDS } from "@/lib/ai/team/jobs";
import {
  anomalyFacts, candidateText, coachFacts, dayLabel, fallbackLine, leadFacts, meetingFacts, oneThingFacts, pickOneThing, reportFacts, shameProblem, summaryReady, summaryText,
  type Anomaly, type Journey, type PersonNums, type TeamMiddle,
} from "@/lib/ai/team/facts";
import { effective, cleanJobs } from "@/lib/ai/team/prefs";
import { coachNote, explainAnomaly, leadStories, meetingDraft, oneThing, reportSummary } from "@/lib/ai/team/run";
import { defaultSections, reportText, samplePayload } from "@/lib/analytics/proof-core";
import { DEFAULT_OFF } from "@/lib/flags-core";

// Golden tests for the team and client AI jobs. No real provider is called: every request goes to a fake fetch. The account's own choice is passed in (`eff`), so no database is needed.

const ALL_ON = { jobs: Object.fromEntries(TEAM_JOB_IDS.map((j) => [j, true])) as Record<(typeof TEAM_JOB_IDS)[number], boolean>, leadNames: false, tone: "plain" as const };
const connJobs = Object.fromEntries(TEAM_JOB_IDS.map((j) => [j, true]));

function memStore(conn: Partial<Conn> | null, spend = 0) {
  const runs: RunRow[] = [];
  const store: AiStore = {
    connection: async (_i, scope) => (conn && (conn.scope ?? "") === scope ? ({ scope, method: "key", provider: "openai", baseUrl: null, apiKey: "sk-test-1234567890", model: "gpt-x", status: "connected", monthlyCapUsd: 5, paused: false, shareNames: false, jobs: connJobs, ...conn } as Conn) : null),
    cachedRun: async (_i, _s, key) => { const r = runs.find((x) => x.idempotencyKey === key && x.status === "ok"); return r ? { id: "run-1", output: r.output ?? "" } : null; },
    monthSpendUsd: async () => spend + runs.reduce((a, r) => a + r.costUsd, 0),
    runsSince: async () => runs.length,
    insertRun: async (r) => { runs.push(r); return `run-${runs.length}`; },
    markNeedsAttention: async () => undefined,
  };
  return { store, runs };
}
const reply = (o: unknown) => ({ choices: [{ message: { content: typeof o === "string" ? o : JSON.stringify(o) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } });
const okFetch = (replies: unknown[], calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = []): Fetch => async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => JSON.stringify(replies.shift()) }; };
const never: Fetch = async () => { throw new Error("must not be called"); };
const deps = (store: AiStore, fetch: Fetch, more: Partial<Deps> = {}): Deps => ({ store, fetch, sleep: async () => undefined, killAll: () => false, now: () => Date.UTC(2026, 10, 12, 7), ...more });
const who = (d: Deps, loc = "loc-1", more: Record<string, unknown> = {}) => ({ installationId: "inst-1", locationId: loc, userKey: "u1", trigger: "preview" as const, deps: d, eff: ALL_ON, ...more });
const NOW = new Date(Date.UTC(2026, 10, 12));

describe("registry and flags", () => {
  it("registers the six jobs live, suggest-only, and the rest of the registry is unchanged", () => {
    for (const j of TEAM_JOB_IDS) { expect(JOB_IDS).toContain(j); expect(JOBS[j].status).toBe("live"); expect(JOBS[j].approval).toBe("suggest"); expect(liveJobs().map((x) => x.id)).toContain(j); }
    expect(JOBS.brief.status).toBe("live");
  });
  it("every job has its own feature flag, default off, and coaching and meetings are opt-in", () => {
    for (const f of ["ai_report", "ai_leads", "ai_coach", "ai_anomaly", "ai_meeting", "ai_one_thing"]) expect(DEFAULT_OFF.has(f as never)).toBe(true);
    expect([...OPT_IN_JOBS].sort()).toEqual(["coach_note", "meeting_summary"]);
  });
  it("the per-account choice: opt-in jobs default off, an account overrides the company, tone comes from the company", () => {
    const d = effective(null, null);
    expect(d.jobs.report_summary).toBe(true); expect(d.jobs.coach_note).toBe(false); expect(d.jobs.meeting_summary).toBe(false); expect(d.leadNames).toBe(false); expect(d.tone).toBe("plain");
    const e = effective({ jobs: { coach_note: true }, leadNames: true, tone: "warm" }, { jobs: { coach_note: false, report_summary: false }, leadNames: null, tone: null });
    expect(e.jobs.coach_note).toBe(false); expect(e.jobs.report_summary).toBe(false); expect(e.leadNames).toBe(true); expect(e.tone).toBe("warm");
    expect(cleanJobs({ coach_note: true, evil: true, one_thing: "yes" })).toEqual({ coach_note: true });
  });
});

describe("1. monthly client report summary", () => {
  const p = samplePayload(NOW);
  it("sends only measured figures, never the account name, and the tone line follows the setting", () => {
    const f = reportFacts(p, "warm");
    expect(f.text).toContain("Tone: warm and friendly");
    expect(reportFacts(p, "formal").text).toContain("Tone: professional");
    expect(f.text).toContain("New leads: 142");
    expect(f.text).not.toContain("Sample Roofing");
    expect(f.includesNames).toBe(false);
    const thin = { ...p, replyMedian: { current: null, previous: null } };
    expect(reportFacts(thin, "plain").text).toContain("not measured this month");
  });
  it("is not ready when nothing was recorded", () => {
    expect(summaryReady(p)).toBe(true);
    expect(summaryReady({ ...p, leads: { current: null, previous: null }, booked: { current: null, previous: null }, won: { deals: { current: null, previous: null }, value: { current: null, previous: null } }, caught: { found: null, fixed: null, stillOpen: null, typicalFixMinutes: null } })).toBe(false);
  });
  const good = { whatHappened: "142 new leads came in and 91% got a first reply within 5 min.", caughtAndFixed: "23 problems were caught and 20 were cleared.", wins: ["Reply time got faster."], nextMonth: ["Keep replies under 5 min."] };
  it("writes a draft from a valid answer and renders it as headed, editable text", async () => {
    const { store, runs } = memStore({});
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const r = await reportSummary(who(deps(store, okFetch([reply(good)], calls))), p);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.text).toContain("What happened\n142 new leads"); expect(r.text).toContain("Wins\n- Reply time got faster."); expect(r.toneUsed).toBe("plain"); }
    expect(runs[0]).toMatchObject({ installationId: "inst-1", scope: "", job: "report_summary", status: "ok", includesNames: false });
    expect(JSON.parse(calls[0].init.body as string).messages.at(-1).content).toContain("Period:");
  });
  it("the number guard throws away a figure we did not give it", async () => {
    const { store, runs } = memStore({});
    const r = await reportSummary(who(deps(store, okFetch([reply({ ...good, whatHappened: "187 new leads came in." })]))), p);
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(runs[0].status).toBe("rejected");
    const spelled = await reportSummary(who(deps(memStore({}).store, okFetch([reply({ ...good, wins: ["Nearly three hundred leads."] })]))), p);
    expect(spelled).toMatchObject({ ok: false, code: "rejected" });
  });
  it("refuses promises, claims of work done, links and vendor names", async () => {
    for (const bad of ["We guarantee more leads.", "We have sent the report to your customers.", "See https://example.com", "Your GoHighLevel account is healthy."]) {
      const r = await reportSummary(who(deps(memStore({}).store, okFetch([reply({ ...good, whatHappened: bad })]))), p);
      expect(r).toMatchObject({ ok: false, code: "rejected" });
    }
  });
  it("is off when the account switched it off, when the connection's own switch is off, when paused, over the cap and under the kill switch: nothing is sent", async () => {
    expect(await reportSummary(who(deps(memStore({}).store, never), "loc-1", { eff: { ...ALL_ON, jobs: { ...ALL_ON.jobs, report_summary: false } } }), p)).toMatchObject({ ok: false, code: "job_off" });
    expect(await reportSummary(who(deps(memStore({ jobs: { ...connJobs, report_summary: false } }).store, never)), p)).toMatchObject({ ok: false, code: "job_off" });
    expect(await reportSummary(who(deps(memStore({ paused: true }).store, never)), p)).toMatchObject({ ok: false, code: "paused" });
    expect(await reportSummary(who(deps(memStore({}, 5).store, never)), p)).toMatchObject({ ok: false, code: "cap" });
    expect(await reportSummary(who(deps(memStore({}).store, never, { killAll: () => true })), p)).toMatchObject({ ok: false, code: "killed" });
    expect(await reportSummary(who(deps(memStore(null).store, never)), p)).toMatchObject({ ok: false, code: "no_connection" });
  });
  it("does not pay twice for the same figures, and 'peek' never calls the provider", async () => {
    const { store } = memStore({});
    const calls: unknown[] = [];
    const f: Fetch = async (u, i) => { calls.push([u, i]); return { status: 200, text: async () => JSON.stringify(reply(good)) }; };
    expect((await reportSummary(who(deps(store, f)), p)).ok).toBe(true);
    const again = await reportSummary(who(deps(store, f), "loc-1", { trigger: "view" }), p);
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1);
    expect((await reportSummary(who(deps(store, never), "loc-1", { mode: "peek" }), p)).ok).toBe(true);
    expect(await reportSummary(who(deps(memStore({}).store, never), "loc-1", { mode: "peek" }), p)).toMatchObject({ ok: false, code: "not_written" });
  });
  it("the edit, copy and print path carries only the reviewed summary", () => {
    const brand = { name: "Acme Agency", logoUrl: null, color: null };
    const text = summaryText(good);
    expect(reportText(p, brand, null, defaultSections(), text)).toContain("What happened\n142 new leads");
    expect(reportText(p, brand, null, defaultSections())).not.toContain("What happened");
    expect(summaryText({ ...good, whatHappened: "x".repeat(5000) }).length).toBeLessThanOrEqual(2500);
  });
});

describe("2. what happened to each lead", () => {
  const day = Date.UTC(2026, 10, 4, 12);
  const j = (n: number, o: Partial<Journey> = {}): Journey => ({ contactId: `c${n}`, name: `Person Number${n}`, arrivedAt: day, arrivedOn: dayLabel(day, "UTC"), source: "Facebook", firstReplyMinutes: 3, replyBy: "person", inTarget: true, bookings: 1, apptStatus: "showed", deal: "won", ...o });
  it("never sends names or contact ids, labels leads L1, L2 and caps the page", () => {
    const f = leadFacts([j(1), j(2)], 15, "plain");
    expect(f.text).toContain("L1: arrived Wed 4 Nov from Facebook");
    expect(f.text).not.toMatch(/Person Number|c1\b/);
    expect(f.includesNames).toBe(false);
    expect(leadFacts(Array.from({ length: 40 }, (_, i) => j(i)), 15, "plain").text.split("\n").filter((l) => /^L\d+:/.test(l))).toHaveLength(25);
  });
  it("describes a lead nobody answered in plain words", () => {
    expect(fallbackLine(j(1, { firstReplyMinutes: null, replyBy: null, inTarget: null, bookings: 0, apptStatus: null, deal: null }), 15)).toBe("Arrived Wed 4 Nov from Facebook; no reply recorded; no appointment booked.");
  });
  it("uses the AI sentence when it passes, and the code sentence for a lead the AI skipped or invented", async () => {
    const { store } = memStore({});
    const answer = { stories: [{ id: "L1", line: "Arrived Wed 4 Nov and a person replied after 3 min." }, { id: "ZZ", line: "Invented." }] };
    const r = await leadStories(who(deps(store, okFetch([reply(answer)]))), [j(1), j(2)], 15);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.aiLines).toEqual([true, false]); expect(r.lines[0]).toContain("3 min"); expect(r.lines[1]).toBe(fallbackLine(j(2), 15)); }
    const bad = await leadStories(who(deps(memStore({}).store, okFetch([reply({ stories: [{ id: "L1", line: "A person replied after 7 min." }] })]))), [j(1)], 15);
    expect(bad).toMatchObject({ ok: false, code: "rejected" });
  });
  it("is off per account", async () => {
    expect(await leadStories(who(deps(memStore({}).store, never), "loc-1", { eff: { ...ALL_ON, jobs: { ...ALL_ON.jobs, lead_story: false } } }), [j(1)], 15)).toMatchObject({ ok: false, code: "job_off" });
  });
});

describe("3. coaching notes", () => {
  const me: PersonNums = { firstReplies: 40, replyMinutes: 4, inTimePct: 80, showPct: 70, apptsSet: 12, outcomesMarked: 20, touches: 300, days: 30 };
  const team: TeamMiddle = { people: 5, replyMinutes: 6, inTimePct: 70, showPct: 65, apptsSet: 10, touches: 250 };
  it("compares a person only with the middle of their own team, never names or ranks, and drops the comparison for a tiny team", () => {
    const f = coachFacts(me, team, 15, "plain");
    expect(f.text).toContain("Typical first reply: 4 min (the middle figure of their own team: 6 min)");
    expect(f.text).not.toMatch(/rank|best|worst/i);
    expect(coachFacts(me, { ...team, people: 2 }, 15, "plain").text).toContain("do not compare");
    expect(coachFacts(me, { ...team, people: 2 }, 15, "plain").text).not.toContain("middle figure of their own team: 6");
  });
  const good = { strengths: ["Your first reply time of 4 min is quicker than the team middle of 6 min."], fix: "Mark the outcome of every appointment: 20 are marked so far." };
  it("writes a neutral note from a valid answer", async () => {
    const r = await coachNote(who(deps(memStore({}).store, okFetch([reply(good)]))), me, team, 15);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fix).toContain("Mark the outcome");
  });
  it("is opt-in: off unless the account switched it on, and nothing is sent", async () => {
    const off = { ...ALL_ON, jobs: { ...ALL_ON.jobs, coach_note: false } };
    expect(await coachNote(who(deps(memStore({}).store, never), "loc-1", { eff: off }), me, team, 15)).toMatchObject({ ok: false, code: "job_off" });
    expect(effective(null, null).jobs.coach_note).toBe(false);
  });
  it("needs enough replies for a fair note, before anything is sent", async () => {
    expect(await coachNote(who(deps(memStore({}).store, never)), { ...me, firstReplies: 4 }, team, 15)).toMatchObject({ ok: false, code: "not_enough" });
  });
  it("refuses wording that ranks or shames", async () => {
    expect(shameProblem("You are the worst on the team.")).not.toBeNull();
    expect(shameProblem("Your first reply time is quicker than the team middle.")).toBeNull();
    const r = await coachNote(who(deps(memStore({}).store, okFetch([reply({ strengths: [], fix: "You are lazy about marking the 20 outcomes." })]))), me, team, 15);
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    const ranked = await coachNote(who(deps(memStore({}).store, okFetch([reply({ strengths: [], fix: "You are ranked at the bottom for 20 marks." })]))), me, team, 15);
    expect(ranked).toMatchObject({ ok: false, code: "rejected" });
  });
});

describe("4. anomaly explanations", () => {
  const a: Anomaly = { key: "leads", label: "New leads per week", direction: "below", current: 40, usual: 90, unit: "count", relativePct: 56 };
  it("states the movement and the context as the only figures", () => {
    const f = anomalyFacts(a, ["New leads in the last seven days: 40 (usual week: 90)"], "plain");
    expect(f.text).toContain("Last seven days: 40");
    expect(f.text).toContain("Usual (the average of the four weeks before): 90");
    expect(f.includesNames).toBe(false);
  });
  it("returns candidate reasons with something to check, and rejects an invented figure", async () => {
    const ok = await explainAnomaly(who(deps(memStore({}).store, okFetch([reply({ summary: "New leads fell from 90 to 40 a week.", reasons: [{ reason: "A lead source may have slowed down.", check: "Open the lead sources report." }] })]))), a, ["New leads in the last seven days: 40 (usual week: 90)"]);
    expect(ok.ok).toBe(true);
    const bad = await explainAnomaly(who(deps(memStore({}).store, okFetch([reply({ summary: "Leads fell by 75%.", reasons: [{ reason: "May be ads.", check: "Check ads." }] })]))), a, []);
    expect(bad).toMatchObject({ ok: false, code: "rejected" });
  });
});

describe("5. meeting summary and follow-up draft", () => {
  const m = { summary: "Talked through pricing. Agreed to send a quote by Friday.", actionItems: ["Send the quote"] };
  it("sends the meeting text only after the opt-in: the gateway refuses it otherwise and nothing is sent", async () => {
    expect(meetingFacts(m, "plain").includesNames).toBe(true);
    const noOptIn = await meetingDraft(who(deps(memStore({ shareNames: false }).store, never)), m);
    expect(noOptIn).toMatchObject({ ok: false, code: "rejected" });
    const withOptIn = await meetingDraft(who(deps(memStore({ shareNames: true }).store, okFetch([reply({ summary: "Pricing was discussed.", followUp: "Thanks for your time today. As agreed, I will send the quote by Friday." })]))), m);
    expect(withOptIn.ok).toBe(true);
  });
  it("is opt-in per account and needs a summary", async () => {
    const off = { ...ALL_ON, jobs: { ...ALL_ON.jobs, meeting_summary: false } };
    expect(await meetingDraft(who(deps(memStore({ shareNames: true }).store, never), "loc-1", { eff: off }), m)).toMatchObject({ ok: false, code: "job_off" });
    expect(await meetingDraft(who(deps(memStore({ shareNames: true }).store, never)), { summary: null, actionItems: [] })).toMatchObject({ ok: false, code: "not_enough" });
  });
  it("never lets a draft claim it was sent", async () => {
    const r = await meetingDraft(who(deps(memStore({ shareNames: true }).store, okFetch([reply({ summary: "Pricing.", followUp: "We have sent your quote already." })]))), m);
    expect(r).toMatchObject({ ok: false, code: "rejected" });
  });
});

describe("6. weekly one thing to fix", () => {
  it("picks money first, then a fixed urgency order, and builds the count in code", () => {
    const stale = { key: "stale_deals" as const, count: 12, dollars: 18400, text: candidateText("stale_deals", 12) };
    const never_ = { key: "never_answered" as const, count: 30, dollars: null, text: candidateText("never_answered", 30) };
    expect(pickOneThing([never_, stale])?.top.key).toBe("stale_deals");
    expect(pickOneThing([{ ...stale, dollars: null }, never_])?.top.key).toBe("never_answered");
    expect(pickOneThing([{ ...stale, count: 0 }])).toBeNull();
    expect(oneThingFacts(stale, [never_], "plain").text).toContain("Recorded value of those deals: $18,400");
  });
  it("words the chosen item, and rejects a figure that is not the SQL figure", async () => {
    const stale = { key: "stale_deals" as const, count: 12, dollars: 18400, text: candidateText("stale_deals", 12) };
    const ok = await oneThing(who(deps(memStore({}).store, okFetch([reply("12 open deals have not moved, worth about $18,400 recorded. Start by calling the owners.")]))), [stale]);
    expect(ok.ok).toBe(true);
    const bad = await oneThing(who(deps(memStore({}).store, okFetch([reply("12 open deals are worth about $20,000.")]))), [stale]);
    expect(bad).toMatchObject({ ok: false, code: "rejected" });
    expect(await oneThing(who(deps(memStore({}).store, never)), [])).toMatchObject({ ok: false, code: "not_enough" });
  });
});

describe("the client's report page", () => {
  it("shows the reviewed summary only when there is one, and never the draft wording", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ProofReport } = await import("@/app/app/views/pr/report");
    const p = samplePayload(NOW), brand = { name: "Acme Agency", logoUrl: null, color: null };
    const props = { p, brand, intro: null, sections: defaultSections(), nameStaff: false };
    const withSummary = renderToStaticMarkup(createElement(ProofReport, { ...props, summary: "What happened\n142 new leads came in." }));
    expect(withSummary).toContain('data-testid="pr-summary"');
    expect(withSummary).toContain("142 new leads came in.");
    expect(withSummary).not.toMatch(/Draft for your review/i);
    expect(renderToStaticMarkup(createElement(ProofReport, props))).not.toContain('data-testid="pr-summary"');
  });
});
