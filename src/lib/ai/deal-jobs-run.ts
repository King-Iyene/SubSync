import { sql } from "../db";
import { forecast, overview, sources, wonLost, dealList, detail, type Filters, type Scope } from "../analytics/pipeline3-queries";
import { parsePlWindow } from "../analytics/pipeline3-intel";
import { atOf } from "../analytics/window-time";
import type { Pl3Row } from "../analytics/pipeline3-types";
import { realDeps } from "./brief";
import {
  asForecastOut, asHealthOut, asWinLossOut, bandOf, dealHealthFacts, dealIssues, DEAL_JOB_FLAG, followUpFacts, forecastFacts, forecastGate, HEALTH_HOW, HEALTH_WORDS, mapPlans, winLossFacts, winLossGate,
  type DealJobId, type DealJobRow, type ForecastOut, type HealthOut, type Issue, type PlanItem, type WinLossOut,
} from "./deal-jobs";
import { hashInput, idempotencyKey, runJob, type Deps } from "./gateway";
import { parseJsonAnswer } from "./safety";
import { dbStore, publicConnection } from "./store";

// The server side of the four deal jobs. Every figure the model sees comes from the Pipeline functions the screens already use (so the left-out rules of deal-trust.ts are in them), the
// rows are read for the verified session's accounts only (`scope.allowed`), and the model only writes words. Nothing here writes to the CRM; the "Add as an internal task" button is a
// separate, confirmed step through the existing deal-change route.

export type Sent = { fields: string[]; includesNames: boolean; text: string };
export type JobOut<T> =
  | { status: "ok"; data: T; runId: string; cached: boolean; costUsd: number; sent: Sent }
  | { status: "refused"; code: string; message: string; sent: Sent | null }
  | { status: "gate"; message: string }
  | { status: "none" };

export type Who = { installationId: string; userKey: string | null; allowed: string[] | null; /** A client's own staff see only deals assigned to them. */ onlyOwnerId: string | null };
type Opts = { deps?: Deps; now?: number; fresh?: boolean; trigger?: "preview" | "view" };

// ---------------- connection, state, peek ----------------

/** The connection a run for this account will use (the account's own, else the company's) and whether names may be sent. */
export async function connectionFor(inst: string, loc: string) {
  const own = loc ? await publicConnection(inst, loc) : null;
  if (own) return { scope: loc, conn: own };
  const co = await publicConnection(inst, "");
  return { scope: "", conn: co };
}

export type JobState = "off" | "no_connection" | "job_off" | "paused" | "needs_attention" | "ready";
/** What the screens show: nothing (off), a hint, or the button. `flagOn` is the job's own flag AND the global one. */
export async function jobState(inst: string, loc: string, job: DealJobId, flagOn: boolean): Promise<JobState> {
  if (!flagOn) return "off";
  const { conn } = await connectionFor(inst, loc);
  if (!conn) return "no_connection";
  if (conn.paused) return "paused";
  if (conn.status !== "connected") return "needs_attention";
  return conn.jobs[job] === true ? "ready" : "job_off";
}

async function peek<T>(inst: string, scope: string, job: DealJobId, text: string, parse: (j: unknown) => T | null, deps?: Deps): Promise<{ id: string; data: T } | null> {
  const hit = await (deps?.store ?? dbStore).cachedRun(inst, scope, idempotencyKey(inst, scope, job, hashInput(text)));
  if (!hit) return null;
  const data = parse(parseJsonAnswer(hit.output));
  return data ? { id: hit.id, data } : null;
}

async function viaJob<T>(a: { who: Who; scopeLoc: string; job: DealJobId; facts: { text: string; fields: string[]; includesNames: boolean }; parse: (j: unknown) => T | null } & Opts): Promise<JobOut<T>> {
  const sent: Sent = { fields: a.facts.fields, includesNames: a.facts.includesNames, text: a.facts.text };
  const r = await runJob(a.deps ?? realDeps(), { installationId: a.who.installationId, locationId: a.scopeLoc, userKey: a.who.userKey, job: a.job, trigger: a.trigger ?? "view", input: a.facts, fresh: a.fresh });
  if (!r.ok) return { status: "refused", code: r.code, message: r.message, sent };
  const data = a.parse(r.json);
  return data ? { status: "ok", data, runId: r.runId, cached: r.cached, costUsd: r.costUsd, sent } : { status: "refused", code: "rejected", message: "The AI answer was not readable, so it was not shown.", sent };
}

// ---------------- reading deals ----------------

const DAY = 86_400_000;

/** The four facts the Pipeline rows do not carry: last activity, the step's own normal, and whether the person has a phone or an email. One query per call, pairs inside the caller's installation. */
export async function enrich(inst: string, rows: readonly Pl3Row[], now = Date.now()): Promise<DealJobRow[]> {
  if (!rows.length) return [];
  const locs = rows.map((r) => r.locationId), ids = rows.map((r) => r.opportunityId);
  const x = await sql()`
    select o.location_id, o.opportunity_id, greatest(o.last_action_at, o.updated_remote_at) la, ss.median_days::float8 norm,
      (nullif(btrim(coalesce(ct.phone, '')), '') is not null) ph, (nullif(btrim(coalesce(ct.email, '')), '') is not null) em
    from cached_opportunities o
    left join deal_stage_stats ss on ss.installation_id = o.installation_id and ss.location_id = o.location_id and ss.stage_id = o.stage_id
    left join cached_contacts ct on ct.installation_id = o.installation_id and ct.location_id = o.location_id and ct.contact_id = o.contact_id
    where o.installation_id = ${inst} and (o.location_id, o.opportunity_id) in (select * from unnest(${locs}::text[], ${ids}::text[]))`;
  const by = new Map(x.map((r) => [`${r.location_id}|${r.opportunity_id}`, r]));
  return rows.map((r) => {
    const e = by.get(`${r.locationId}|${r.opportunityId}`);
    return { ...r, daysSinceActivity: e?.la instanceof Date ? Math.max(0, (now - e.la.getTime()) / DAY) : null, stageNormalDays: e?.norm == null ? null : Number(e.norm), hasPhone: e?.ph === true, hasEmail: e?.em === true };
  });
}

const mayTouch = (who: Who, r: Pick<Pl3Row, "ownerId">) => !who.onlyOwnerId || r.ownerId === who.onlyOwnerId;

/** One deal of an account the caller may read. Null when it is not there, not theirs, or not an account they may see. */
export async function loadDeal(who: Who, loc: string, id: string, now = Date.now()): Promise<DealJobRow | null> {
  const scope: Scope = { inst: who.installationId, allowed: who.allowed };
  const d = await detail(scope, loc, id, null);
  if (!d || !mayTouch(who, d.row)) return null;
  return (await enrich(who.installationId, [d.row], now))[0] ?? null;
}

// ---------------- 1. deal health ----------------

export type HealthView = {
  opportunityId: string; locationId: string; status: string; score: number | null; band: ReturnType<typeof bandOf>; word: string | null; issues: Issue[]; how: string;
  explanation: HealthOut | null; explanationRunId: string | null; cached: boolean; sent: Sent | null; message: string | null;
};

/** The badge and the findings come from rules, always. The explanation is added only from an earlier answer for exactly these facts (peek) or from a run the person asked for. */
export async function healthView(who: Who, loc: string, id: string, o: Opts & { run: boolean }): Promise<HealthView | null> {
  const now = o.now ?? Date.now(), row = await loadDeal(who, loc, id, now);
  if (!row) return null;
  const band = bandOf(row.health), issues = dealIssues(row, now);
  const base: HealthView = { opportunityId: row.opportunityId, locationId: row.locationId, status: row.status, score: row.health, band, word: band ? HEALTH_WORDS[band] : null, issues, how: HEALTH_HOW, explanation: null, explanationRunId: null, cached: false, sent: null, message: null };
  if (row.status !== "open") return { ...base, message: "Closed deals are not judged." };
  const { scope, conn } = await connectionFor(who.installationId, loc);
  const facts = dealHealthFacts(row, now, conn?.shareNames === true), sent: Sent = { fields: facts.fields, includesNames: facts.includesNames, text: facts.text };
  if (!o.run) {
    const hit = conn ? await peek(who.installationId, scope, "deal_health", facts.text, asHealthOut, o.deps) : null;
    return hit ? { ...base, explanation: hit.data, explanationRunId: hit.id, cached: true, sent } : base;
  }
  const r = await viaJob({ who, scopeLoc: loc, job: "deal_health", facts, parse: asHealthOut, deps: o.deps, fresh: o.fresh, trigger: o.trigger });
  if (r.status === "ok") return { ...base, explanation: r.data, explanationRunId: r.runId, cached: r.cached, sent: r.sent };
  return { ...base, message: r.status === "refused" ? r.message : null, sent: r.status === "refused" ? r.sent : null };
}

// ---------------- 2. follow-up plan ----------------

export type FollowUpView = { items: PlanItem[]; stuckTotal: number; asked: number; skippedDnd: number; dropped: number };
export type ListQuery = { from?: string | null; to?: string | null; fromTime?: string | null; toTime?: string | null; location?: string | null; pipeline?: string | null };

function filtersOf(q: ListQuery, now: number): { f: Filters; days: number } {
  const w = parsePlWindow(q.from ?? null, q.to ?? null, now, atOf({ get: (k: string) => (k === "fromTime" ? q.fromTime ?? null : k === "toTime" ? q.toTime ?? null : null) }));
  return { f: { from: w.from, to: w.to, location: q.location ?? null, pipeline: q.pipeline ? q.pipeline.trim().slice(0, 120) : null }, days: w.days };
}
/** Which account's connection a run over many accounts uses: the one account asked for, or the only account the caller has, else the company's own. */
const runLoc = (who: Who, q: ListQuery) => q.location ?? (who.allowed && who.allowed.length === 1 ? who.allowed[0] : "");

export async function followUp(who: Who, q: ListQuery, o: Opts): Promise<JobOut<FollowUpView>> {
  const now = o.now ?? Date.now(), scope: Scope = { inst: who.installationId, allowed: who.allowed }, { f } = filtersOf(q, now), loc = runLoc(who, q);
  const page = await dealList(scope, { f: { ...f, bucket: "stale" }, page: 0, size: 20 }, null);
  const rows = (await enrich(who.installationId, page.rows.filter((r) => mayTouch(who, r)), now));
  const { conn } = await connectionFor(who.installationId, loc);
  const pick = followUpFacts(rows, now, conn?.shareNames === true);
  if (pick.asked === 0) return { status: "gate", message: page.total === 0 ? "No stuck deals right now." : "No stuck deals to plan for (people who asked not to be contacted are never included)." };
  const r = await viaJob({ who, scopeLoc: loc, job: "deal_followup", facts: pick.facts, parse: (j) => (Array.isArray((j as { plans?: unknown } | null)?.plans) ? j : null), deps: o.deps, fresh: o.fresh, trigger: o.trigger });
  if (r.status !== "ok") return r as JobOut<never>;
  const m = mapPlans(r.data, pick.refs, now);
  return { ...r, data: { items: m.items, stuckTotal: page.total, asked: pick.asked, skippedDnd: pick.skippedDnd, dropped: m.dropped } };
}

// ---------------- 3. win and loss review ----------------

export type WinLossView = { words: WinLossOut; closed: number; won: number; lost: number };
export async function winLoss(who: Who, q: ListQuery, o: Opts): Promise<JobOut<WinLossView>> {
  const now = o.now ?? Date.now(), scope: Scope = { inst: who.installationId, allowed: who.allowed }, { f, days } = filtersOf(q, now), loc = runLoc(who, q);
  const wl = await wonLost(scope, { f, page: 0, size: 20 }, null);
  const gate = winLossGate(wl);
  if (!gate.ok) return { status: "gate", message: gate.message };
  const src = await sources(scope, f).catch(() => null);
  const facts = winLossFacts(wl, src, `the ${days} days chosen on the date bar`);
  const r = await viaJob({ who, scopeLoc: loc, job: "deal_winloss", facts, parse: asWinLossOut, deps: o.deps, fresh: o.fresh, trigger: o.trigger });
  if (r.status !== "ok") return r as JobOut<never>;
  return { ...r, data: { words: r.data, closed: wl.won.n + wl.lost.n, won: wl.won.n, lost: wl.lost.n } };
}

// ---------------- 4. forecast in words ----------------

export type ForecastView = { words: ForecastOut; mid: number; low: number; high: number; formula: string; closedDeals: number; minClosed: number };
export async function forecastWords(who: Who, q: ListQuery, o: Opts): Promise<JobOut<ForecastView>> {
  const now = o.now ?? Date.now(), scope: Scope = { inst: who.installationId, allowed: who.allowed }, { f, days } = filtersOf(q, now), loc = runLoc(who, q);
  const fc = await forecast(scope, f);
  const gate = forecastGate(fc);
  if (!gate.ok) return { status: "gate", message: gate.message };
  const ov = await overview(scope, f, days).catch(() => null);
  const r = await viaJob({ who, scopeLoc: loc, job: "deal_forecast", facts: forecastFacts(fc, ov), parse: asForecastOut, deps: o.deps, fresh: o.fresh, trigger: o.trigger });
  if (r.status !== "ok") return r as JobOut<never>;
  return { ...r, data: { words: r.data, mid: fc.next30.value as number, low: fc.next30.low as number, high: fc.next30.high as number, formula: fc.next30.formula, closedDeals: fc.closedDeals, minClosed: fc.minClosed } };
}

export { DEAL_JOB_FLAG };
