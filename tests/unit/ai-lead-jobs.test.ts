import { describe, expect, it } from "vitest";
import { runJob, type AiStore, type Conn, type Deps, type JobRequest, type RunRow } from "@/lib/ai/gateway";
import { JOBS, JOB_IDS } from "@/lib/ai/jobs";
import { LEAD_JOB_FLAG, LEAD_JOB_IDS } from "@/lib/ai/jobs-lead";
import {
  agoWords, callFirstFacts, cleanLines, coldFacts, coldReport, dealPoints, hotPoints, leadSummaryFacts, rankCallFirst, replyFacts, replyPoints, rowsOf, waitPoints,
  type ColdLead, type LeadFacts, type ReplySituation,
} from "@/lib/ai/lead-core";
import type { Fetch } from "@/lib/ai/providers";
import { DEFAULT_OFF } from "@/lib/flags-core";

// Golden tests for the four lead AI jobs. The provider is always a fake fetch: no real model is ever called.

const H = 3_600_000, D = 24 * H;
const NOW = Date.UTC(2026, 10, 13, 15);

function memStore(conn: Partial<Conn> | null, spend = 0) {
  const runs: RunRow[] = [];
  const all = Object.fromEntries(LEAD_JOB_IDS.map((j) => [j, true]));
  const store: AiStore = {
    connection: async (_i, scope) => (conn && (conn.scope ?? "") === scope ? ({ scope, method: "key", provider: "openai", baseUrl: null, apiKey: "sk-test-1234567890", model: "gpt-x", status: "connected", monthlyCapUsd: 5, paused: false, shareNames: false, jobs: all, ...conn } as Conn) : null),
    cachedRun: async (_i, _s, key) => { const r = runs.find((x) => x.idempotencyKey === key && x.status === "ok"); return r ? { id: "run-1", output: r.output ?? "" } : null; },
    monthSpendUsd: async () => spend + runs.reduce((a, r) => a + r.costUsd, 0),
    runsSince: async () => runs.length,
    insertRun: async (r) => { runs.push(r); return `run-${runs.length}`; },
    markNeedsAttention: async () => undefined,
  };
  return { store, runs };
}
const reply = (content: string) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
const okFetch = (replies: unknown[], calls: unknown[] = []): Fetch => async (url, init) => { calls.push([url, init]); return { status: 200, text: async () => JSON.stringify(replies.shift()) }; };
const never: Fetch = async () => { throw new Error("the provider must not be called"); };
const deps = (store: AiStore, fetch: Fetch, more: Partial<Deps> = {}): Deps => ({ store, fetch, sleep: async () => undefined, killAll: () => false, now: () => NOW, ...more });
const req = (job: JobRequest["job"], input: JobRequest["input"], more: Partial<JobRequest> = {}): JobRequest => ({ installationId: "inst-1", locationId: "", userKey: "u1", job, trigger: "view", input, ...more });

const lead = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  name: "Ann Lee", account: "Acme Plumbing", source: "Facebook", tags: ["quote requested", "hot lead"], hasOwner: false, dnd: false, createdAgoMs: 3 * D,
  inbound: 2, humanOut: 0, autoOut: 1, missedCalls: 1, lastInboundAgoMs: 5 * H, lastHumanOutAgoMs: null, firstReplyMinutes: null, callsLogged: 0, lastCallOutcome: null,
  appointments: { upcoming: 0, showed: 0, noShow: 1, total: 1 }, deals: { open: 1, openValue: 4000, lost: 0, won: 0, stage: "Quote sent" }, ...over,
});

describe("registry", () => {
  it("registers the four lead jobs: live, suggest only, each with its own flag that is OFF by default", () => {
    for (const id of LEAD_JOB_IDS) {
      expect(JOB_IDS).toContain(id);
      expect(JOBS[id]).toMatchObject({ status: "live", approval: "suggest" });
      expect(JOBS[id].tools).toEqual([]);
      expect(DEFAULT_OFF.has(LEAD_JOB_FLAG[id])).toBe(true);
    }
    expect(DEFAULT_OFF.has("ai_byo" as never)).toBe(true);
  });
});

describe("job 1: lead summary", () => {
  it("sends counts, ages and tags by default and no name, account name or message text", () => {
    const f = leadSummaryFacts(lead({ messages: [{ dir: "in", text: "Can you do Tuesday for $4,000?" }] }), false);
    expect(f.includesNames).toBe(false);
    expect(f.text).not.toMatch(/Ann Lee|Acme|Tuesday/);
    expect(f.text).toContain("hot lead");
    expect(f.text).toContain("Arrived: 3 days ago");
    expect(f.text).toContain("worth an estimated $4,000");
  });
  it("adds the name and the last messages only with the opt-in, and lists them in 'what was sent'", () => {
    const f = leadSummaryFacts(lead({ messages: [{ dir: "in", text: "Can you do Tuesday?" }, { dir: "out", text: "Yes" }] }), true);
    expect(f.includesNames).toBe(true);
    expect(f.text).toContain("Lead: Ann Lee");
    expect(f.text).toContain("<messages>");
    expect(f.fields.join(" ")).toMatch(/name/);
    expect(f.fields.join(" ")).toMatch(/text of the last 2 messages/);
  });
  it("cuts each message and keeps only the latest six", () => {
    const msgs = Array.from({ length: 9 }, (_, i) => ({ dir: "in" as const, text: `m${i} ${"x".repeat(500)}` }));
    const f = leadSummaryFacts(lead({ messages: msgs }), true);
    expect(f.text.split("\n").filter((l) => l.startsWith("Lead: m"))).toHaveLength(6);
    expect(f.text).not.toContain("m2 ");
    expect(Math.max(...f.text.split("\n").map((l) => l.length))).toBeLessThan(330);
  });
  it("passes the number guard when the model only uses given figures, and shows the three parts", async () => {
    const { store, runs } = memStore({});
    const out = JSON.stringify({ who: "A Facebook lead with a quote request.", happened: "Two messages came in, the last 5 hours ago, and nobody on the team has replied yet. One call was missed.", next: "Call now: the open deal is worth about $4,000." });
    const r = await runJob(deps(store, okFetch([reply(out)])), req("lead_summary", leadSummaryFacts(lead(), false)));
    expect(r.ok ? null : r.message).toBeNull();
    if (r.ok) expect((r.json as { next: string }).next).toContain("$4,000");
    expect(runs[0]).toMatchObject({ job: "lead_summary", status: "ok", includesNames: false });
    expect(runs[0].costUsd).toBeGreaterThan(0);
  });
  it("rejects an answer with an invented figure and shows nothing", async () => {
    const { store, runs } = memStore({});
    const out = JSON.stringify({ who: "A lead.", happened: "They called 7 times.", next: "Call." });
    expect(await runJob(deps(store, okFetch([reply(out)])), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ ok: false, code: "rejected" });
    expect(runs[0].status).toBe("rejected");
  });
  it("rejects a claim that something was sent, and an answer with the wrong shape", async () => {
    const s1 = memStore({});
    const bad = JSON.stringify({ who: "A lead.", happened: "We sent a text.", next: "Call." });
    expect(await runJob(deps(s1.store, okFetch([reply(bad)])), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "rejected" });
    const s2 = memStore({});
    expect(await runJob(deps(s2.store, okFetch([reply(JSON.stringify({ who: "x" }))])), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "rejected" });
  });
  it("is gated: names need the opt-in, then the job switch, pause, cap, kill switch and a connection", async () => {
    expect(await runJob(deps(memStore({ shareNames: false }).store, never), req("lead_summary", leadSummaryFacts(lead(), true)))).toMatchObject({ code: "rejected" });
    expect(await runJob(deps(memStore({ jobs: { lead_summary: false } }).store, never), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "job_off" });
    expect(await runJob(deps(memStore({ paused: true }).store, never), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "paused" });
    expect(await runJob(deps(memStore(null).store, never), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "no_connection" });
    expect(await runJob(deps(memStore({}).store, never, { killAll: () => true }), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "killed" });
    expect(await runJob(deps(memStore({ monthlyCapUsd: 5 }, 5).store, never), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ code: "cap" });
  });
  it("does not pay twice for the same facts", async () => {
    const { store } = memStore({});
    const calls: unknown[] = [];
    const out = JSON.stringify({ who: "A Facebook lead.", happened: "Nobody has replied.", next: "Call now." });
    const f = okFetch([reply(out), reply(out)], calls);
    await runJob(deps(store, f), req("lead_summary", leadSummaryFacts(lead(), false)));
    expect(await runJob(deps(store, f), req("lead_summary", leadSummaryFacts(lead(), false)))).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1);
  });
});

describe("job 2: who to call first (the ranking is plain code)", () => {
  const row = (key: string, over: Partial<{ ageHours: number | null; tags: string[]; openValue: number; replies: number; dnd: boolean }> = {}) => ({ key, ageHours: 30, tags: [] as string[], openValue: 0, replies: 0, dnd: false, ...over });
  it("scores wait, hot tags, deal value and earlier replies as documented", () => {
    expect([waitPoints(0.5), waitPoints(2), waitPoints(10), waitPoints(30), waitPoints(100), waitPoints(null)]).toEqual([8, 16, 24, 30, 22, 0]);
    expect(hotPoints(["new", "Quote requested"])).toEqual({ points: 25, tag: "Quote requested" });
    expect(hotPoints(["hot", "interested"]).points).toBe(30);
    expect(hotPoints(["newsletter"]).points).toBe(0);
    expect([dealPoints(0), dealPoints(1000), dealPoints(10_000), dealPoints(10_000_000)]).toEqual([0, 18, 24, 25]);
    expect([replyPoints(0), replyPoints(1), replyPoints(3)]).toEqual([0, 10, 15]);
  });
  it("orders by score with a stable tie-break, and explains itself without any AI", () => {
    const { ranked } = rankCallFirst([row("a", { ageHours: 2 }), row("b", { tags: ["hot"], openValue: 4000, replies: 2, ageHours: 50 }), row("c", { ageHours: 50 }), row("d", { ageHours: 30 })]);
    expect(ranked.map((r) => r.key)).toEqual(["b", "c", "d", "a"]);
    expect(ranked[0].reason).toBe("waiting 2 days; hot tag: hot; open deal of about $4,000; replied 2 times before");
    expect(ranked[0].score).toBe(30 + 25 + dealPoints(4000) + 15);
    expect(ranked[3].reason).toBe("waiting 2 hours");
    expect(rankCallFirst([row("z", { ageHours: null })]).ranked[0].reason).toBe("On the list; no other signal yet");
  });
  it("never ranks someone who asked not to be contacted, and counts them", () => {
    const r = rankCallFirst([row("a"), row("b", { dnd: true, tags: ["hot"], openValue: 99_999 })]);
    expect(r.ranked.map((x) => x.key)).toEqual(["a"]);
    expect(r.leftOutDnd).toBe(1);
  });
  it("sends the model the facts behind each rank, and names only with the opt-in", () => {
    const top = [{ n: 1, name: "Ann Lee", source: "Facebook", reason: "waiting 2 days; hot tag: hot", tags: ["hot"] }, { n: 2, name: "Bo Chan", source: null, reason: "waiting 5 hours", tags: [] }];
    expect(callFirstFacts(top, false).text).not.toMatch(/Ann|Bo/);
    expect(callFirstFacts(top, false).includesNames).toBe(false);
    expect(callFirstFacts(top, true).text).toContain("name: Ann Lee");
    expect(callFirstFacts(top, true).includesNames).toBe(true);
  });
  it("keeps only reasons for leads we asked about, once each, and drops invented figures at the gate", async () => {
    expect(cleanLines({ lines: [{ id: "1", line: "Waited 2 days." }, { id: "#2", line: "Hot tag." }, { id: "9", line: "Not asked." }, { id: "1", line: "Dup." }] }, ["1", "2"])).toEqual({ "1": "Waited 2 days.", "2": "Hot tag." });
    const facts = callFirstFacts([{ n: 1, name: null, source: null, reason: "waiting 2 days; hot tag: hot", tags: ["hot"] }], false);
    const good = JSON.stringify({ lines: [{ id: "1", line: "Waiting 2 days and marked hot." }] });
    const { store } = memStore({});
    expect(await runJob(deps(store, okFetch([reply(good)])), req("call_first", facts))).toMatchObject({ ok: true });
    const bad = JSON.stringify({ lines: [{ id: "1", line: "Waiting 9 days." }] });
    expect(await runJob(deps(memStore({}).store, okFetch([reply(bad)])), req("call_first", facts))).toMatchObject({ ok: false, code: "rejected" });
  });
  it("the ranking itself needs no connection: the job is only the add-on", async () => {
    expect(rankCallFirst([row("a")]).ranked).toHaveLength(1);
    expect(await runJob(deps(memStore(null).store, never), req("call_first", callFirstFacts([], false)))).toMatchObject({ code: "no_connection" });
  });
});

describe("job 3: why leads go cold", () => {
  const cl = (i: number, over: Partial<ColdLead> = {}): ColdLead => ({ key: `L:${i}`, locationId: "L", contactId: `c${i}`, name: `Lead ${i}`, leadAt: NOW - 3 * D - i * H, humanAt: null, autoAt: null, hasOwner: true, source: "Google", timeZone: "America/New_York", dnd: false, ...over });
  // 40 judged leads: 10 arrive after hours with no owner and no reply (Facebook), 30 are daytime Google leads that mostly got an answer.
  const rows = (): ColdLead[] => [
    ...Array.from({ length: 10 }, (_, i) => cl(i, { leadAt: Date.UTC(2026, 10, 9, 5 + (i % 3)), hasOwner: false, source: "Facebook", autoAt: NOW - 2 * D })),
    ...Array.from({ length: 30 }, (_, i) => cl(100 + i, { leadAt: Date.UTC(2026, 10, 9, 17), humanAt: i < 24 ? NOW - 2 * D : null, source: "Google" })),
  ];
  it("counts exactly the rows each pattern opens", () => {
    const all = rows(), rep = coldReport(all, NOW);
    expect(rep.judged).toBe(40);
    expect(rep.cold).toBe(16);
    expect(rep.patterns.length).toBeGreaterThan(0);
    for (const p of rep.patterns) expect(rowsOf(all, rep, p.key, NOW)).toHaveLength(p.cold);
    expect(rowsOf(all, rep, "all", NOW)).toHaveLength(16);
    expect(rowsOf(all, rep, "no_such_pattern", NOW)).toBeNull();
    const noOwner = rep.patterns.find((p) => p.key === "no_owner");
    expect(noOwner).toMatchObject({ cold: 10, of: 10, ratePct: 100 });
    expect(rep.patterns.find((p) => p.key === "after_hours")?.cold).toBe(10);
    expect(rep.patterns.find((p) => p.key === "source:facebook")).toMatchObject({ cold: 10, of: 10 });
  });
  it("leaves out fresh leads, people who asked not to be contacted, and groups too small to mean anything", () => {
    const rep = coldReport([...rows(), cl(500, { leadAt: NOW - 2 * H }), cl(501, { dnd: true })], NOW);
    expect(rep.judged).toBe(40);
    const thin = coldReport([cl(1), cl(2), cl(3), cl(4, { humanAt: 1 })], NOW);
    expect(thin.patterns).toEqual([]);
    expect(thin.cold).toBe(3);
  });
  it("sends the model aggregate counts only: no names, no account names", () => {
    const f = coldFacts(coldReport(rows(), NOW));
    expect(f.includesNames).toBe(false);
    expect(f.text).not.toMatch(/Lead \d|L:/);
    expect(f.text).toContain("10 of 10 such leads");
  });
  it("accepts an explanation that quotes our counts and rejects one that invents a count", async () => {
    const facts = coldFacts(coldReport(rows(), NOW));
    const good = JSON.stringify({ explanation: "Leads that arrive after hours with no owner never get a reply: 10 of 10.", fixes: ["Give every lead an owner.", "Add an after-hours rule.", "Review the Facebook form."] });
    expect(await runJob(deps(memStore({}).store, okFetch([reply(good)])), req("cold_reasons", facts))).toMatchObject({ ok: true });
    const bad = JSON.stringify({ explanation: "Probably 25 of 40 are lost.", fixes: ["a", "b", "c"] });
    expect(await runJob(deps(memStore({}).store, okFetch([reply(bad)])), req("cold_reasons", facts))).toMatchObject({ code: "rejected" });
    const four = JSON.stringify({ explanation: "x", fixes: ["a", "b", "c", "d"] });
    expect(await runJob(deps(memStore({}).store, okFetch([reply(four)])), req("cold_reasons", facts))).toMatchObject({ code: "rejected" });
  });
  it("is gated like every job", async () => {
    const facts = coldFacts(coldReport(rows(), NOW));
    expect(await runJob(deps(memStore({ jobs: { cold_reasons: false } }).store, never), req("cold_reasons", facts))).toMatchObject({ code: "job_off" });
    expect(await runJob(deps(memStore({}).store, never, { killAll: () => true }), req("cold_reasons", facts))).toMatchObject({ code: "killed" });
  });
});

describe("job 4: reply drafts", () => {
  const sit = (over: Partial<ReplySituation> = {}): ReplySituation => ({ channel: "SMS", firstName: "Ann", business: "Acme Plumbing", source: "Facebook", lastInboundAgoMs: 5 * H, humanOut: 0, noShow: true, upcomingAppointment: false, openDeal: true, ...over });
  it("uses [name] and [business] placeholders and no message text without the opt-in", () => {
    const f = replyFacts(sit({ messages: [{ dir: "in", text: "Call me about the leak" }] }), false);
    expect(f.text).toContain("[name]");
    expect(f.text).toContain("[business]");
    expect(f.text).not.toMatch(/Ann|Acme|leak/);
    expect(f.includesNames).toBe(false);
    const on = replyFacts(sit({ messages: [{ dir: "in", text: "Call me about the leak" }] }), true);
    expect(on.text).toContain("Ann");
    expect(on.text).toContain("leak");
    expect(on.includesNames).toBe(true);
  });
  it("returns a draft that passes the checks, and is text only (nothing else is produced)", async () => {
    const { store, runs } = memStore({ shareNames: true });
    const r = await runJob(deps(store, okFetch([reply("Hi Ann, sorry we missed you. Would you like to find a new time this week?")])), req("reply_draft", replyFacts(sit(), true)));
    expect(r).toMatchObject({ ok: true, json: null });
    expect(runs[0]).toMatchObject({ job: "reply_draft", status: "ok", includesNames: true });
  });
  it("rejects a draft that claims a call or text already happened, includes a link, or invents a figure", async () => {
    for (const bad of ["Hi Ann, I called you earlier, call me back.", "Hi Ann, book here https://x.example/book", "Hi Ann, we can do 3 pm for $99.", "I guarantee we will fix it."]) {
      expect(await runJob(deps(memStore({}).store, okFetch([reply(bad)])), req("reply_draft", replyFacts(sit(), false)))).toMatchObject({ ok: false, code: "rejected" });
    }
  });
  it("refuses names without the opt-in and respects every gate", async () => {
    expect(await runJob(deps(memStore({ shareNames: false }).store, never), req("reply_draft", replyFacts(sit(), true)))).toMatchObject({ code: "rejected" });
    expect(await runJob(deps(memStore({ jobs: { reply_draft: false } }).store, never), req("reply_draft", replyFacts(sit(), false)))).toMatchObject({ code: "job_off" });
    expect(await runJob(deps(memStore({ monthlyCapUsd: 5 }, 5).store, never), req("reply_draft", replyFacts(sit(), false)))).toMatchObject({ code: "cap" });
  });
});

describe("helpers", () => {
  it("writes durations the same way everywhere", () => {
    expect([agoWords(10 * 60_000), agoWords(H), agoWords(5 * H), agoWords(47 * H), agoWords(3 * D)]).toEqual(["less than an hour", "1 hour", "5 hours", "47 hours", "3 days"]);
  });
});
