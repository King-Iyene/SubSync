import { sql } from "../db";
import { loadRows } from "../analytics/speed-queries";
import { fetchThread } from "../ghl/workbench";
import { runJob, hashInput, idempotencyKey, type Deps, type JobResult } from "./gateway";
import { realDeps } from "./brief";
import type { LeadJobId } from "./jobs-lead";
import { cleanLines, coldFacts, leadSummaryFacts, replyFacts, type ColdLead, type ColdReport, type Facts, type LeadFacts, type ReplySituation } from "./lead-core";
import { dbStore, publicConnection } from "./store";

// The database and model half of the four lead AI jobs. Every read names the installation and is limited to `allowed` accounts (the router derived them from the verified session); the
// browser never names a company. Suggest only: nothing here messages a lead or writes to the CRM. The model sees our figures, never raw rows.

const DAY = 86_400_000;
type Conn = NonNullable<Awaited<ReturnType<typeof publicConnection>>>;

/** The account's own connection first, then the company's (the same rule the gateway uses). */
export async function connFor(installationId: string, locationId: string): Promise<Conn | null> {
  if (locationId) { const own = await publicConnection(installationId, locationId); if (own) return own; }
  return publicConnection(installationId, "");
}
/** Can this job run for this account right now? Never throws. */
export async function jobReady(installationId: string, locationId: string, job: LeadJobId): Promise<{ ready: boolean; shareNames: boolean; reason: "ok" | "no_connection" | "job_off" | "paused" | "needs_attention" }> {
  try {
    const c = await connFor(installationId, locationId);
    if (!c) return { ready: false, shareNames: false, reason: "no_connection" };
    if (c.paused) return { ready: false, shareNames: c.shareNames, reason: "paused" };
    if (c.status !== "connected") return { ready: false, shareNames: c.shareNames, reason: "needs_attention" };
    if (c.jobs[job] !== true) return { ready: false, shareNames: c.shareNames, reason: "job_off" };
    return { ready: true, shareNames: c.shareNames, reason: "ok" };
  } catch { return { ready: false, shareNames: false, reason: "no_connection" }; }
}

export type Shaped = { ok: true; text: string; json: unknown | null; runId: string; costUsd: number; cached: boolean; sent: Facts } | { ok: false; code: string; error: string; sent: Facts | null };
const shape = (r: JobResult, facts: Facts): Shaped => (r.ok ? { ok: true, text: r.text, json: r.json, runId: r.runId, costUsd: r.costUsd, cached: r.cached, sent: facts } : { ok: false, code: r.code, error: r.message, sent: facts });

type Run = { installationId: string; locationId: string; userKey: string | null; deps?: Deps };
const go = async (a: Run, job: LeadJobId, facts: Facts): Promise<Shaped> =>
  shape(await runJob(a.deps ?? realDeps(), { installationId: a.installationId, locationId: a.locationId, userKey: a.userKey, job, trigger: "view", input: facts }), facts);

/** The answer already written for exactly these facts (so opening a screen never calls the provider), or null. */
export async function peekCached(a: Run, job: LeadJobId, facts: Facts): Promise<string | null> {
  const c = await connFor(a.installationId, a.locationId);
  if (!c || c.paused || c.status !== "connected" || c.jobs[job] !== true) return null;
  const scope = (await publicConnection(a.installationId, a.locationId)) ? a.locationId : "";
  const hit = await (a.deps?.store ?? dbStore).cachedRun(a.installationId, scope, idempotencyKey(a.installationId, scope, job, hashInput(facts.text)));
  return hit?.output ?? null;
}

// ---------------------------------------------------------------- one lead (jobs 1 and 4 read the same facts)

export type LeadLoad = { facts: LeadFacts; firstName: string | null; business: string | null; dnd: boolean; conversationId: string | null; timeZone: string | null; source: string | null };

/** Everything the two lead jobs need about ONE lead, from our own copy of that account. Null when the lead is not in an account the caller may see. */
export async function loadLead(installationId: string, allowed: string[] | null, locationId: string, contactId: string, now = Date.now()): Promise<LeadLoad | null> {
  if (allowed && !allowed.includes(locationId)) return null;
  const db = sql();
  const [c] = await db`
    select c.first_name, nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') name, c.tags, nullif(c.source, '') source, nullif(c.assigned_to, '') owner, c.dnd, c.date_added, l.name location_name, l.timezone
    from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where c.installation_id = ${installationId} and c.location_id = ${locationId} and c.contact_id = ${contactId}`;
  if (!c) return null;
  const [t] = await db`
    select count(*) filter (where direction = 'inbound' and kind = 'message')::int inbound,
      count(*) filter (where direction = 'outbound' and kind <> 'failed' and not automated)::int human_out,
      count(*) filter (where direction = 'outbound' and kind <> 'failed' and automated)::int auto_out,
      count(*) filter (where kind = 'missed_call')::int missed,
      max(at) filter (where direction = 'inbound' and kind = 'message') last_in,
      max(at) filter (where direction = 'outbound' and kind <> 'failed' and not automated) last_human,
      min(at) filter (where direction = 'outbound' and kind <> 'failed' and not automated and at >= ${c.date_added ?? new Date(0)}) first_human
    from touch_events where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId}`;
  const created = c.date_added ? new Date(c.date_added as string).getTime() : null;
  const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null);
  let calls = 0, lastCall: string | null = null;
  try {
    const [k] = await db`select count(*)::int n, (array_agg(outcome order by created_at desc))[1] last from call_outcomes where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId}`;
    calls = Number(k?.n ?? 0); lastCall = ((k?.last as string | null) ?? null)?.replace(/_/g, " ") ?? null;
  } catch { /* an older database */ }
  const ap = { upcoming: 0, showed: 0, noShow: 0, total: 0 };
  try {
    for (const a of await db`select status, start_at from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by start_at desc nulls last limit 50`) {
      const s = String(a.status ?? "").toLowerCase();
      ap.total++;
      if (s === "showed" || s === "completed") ap.showed++;
      else if (s === "noshow") ap.noShow++;
      else if (!["cancelled", "invalid"].includes(s) && a.start_at && new Date(a.start_at as string).getTime() > now) ap.upcoming++;
    }
  } catch { /* an older database */ }
  const deals = { open: 0, openValue: 0, lost: 0, won: 0, stage: null as string | null };
  try {
    for (const d of await db`select status, coalesce(monetary_value, 0)::float8 v, stage_name from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by last_stage_change_at desc nulls last limit 50`) {
      const s = String(d.status ?? "open").toLowerCase();
      if (s === "won") deals.won++; else if (s === "lost" || s === "abandoned") deals.lost++;
      else { deals.open++; deals.openValue += Number(d.v); deals.stage ??= (d.stage_name as string | null) ?? null; }
    }
  } catch { /* an older database */ }
  const lastIn = ms(t?.last_in), lastHuman = ms(t?.last_human), firstHuman = ms(t?.first_human);
  const facts: LeadFacts = {
    name: (c.name as string | null) ?? null, account: (c.location_name as string | null) ?? null, source: (c.source as string | null) ?? null, tags: ((c.tags as string[] | null) ?? []).filter(Boolean),
    hasOwner: c.owner !== null, dnd: c.dnd === true, createdAgoMs: created === null ? null : Math.max(0, now - created),
    inbound: Number(t?.inbound ?? 0), humanOut: Number(t?.human_out ?? 0), autoOut: Number(t?.auto_out ?? 0), missedCalls: Number(t?.missed ?? 0),
    lastInboundAgoMs: lastIn === null ? null : Math.max(0, now - lastIn), lastHumanOutAgoMs: lastHuman === null ? null : Math.max(0, now - lastHuman),
    firstReplyMinutes: created !== null && firstHuman !== null ? Math.max(0, Math.round((firstHuman - created) / 60_000)) : null,
    callsLogged: calls, lastCallOutcome: lastCall, appointments: ap, deals,
  };
  const [convo] = await db`select conversation_id from cached_conversations where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by last_message_at desc nulls last limit 1`.catch(() => []);
  return { facts, firstName: (c.first_name as string | null) ?? null, business: facts.account, dnd: facts.dnd, conversationId: (convo?.conversation_id as string | undefined) ?? null, timeZone: (c.timezone as string | null) ?? null, source: facts.source };
}

/** The latest messages of the lead's conversation, read live from the CRM and held in memory for this one request. Only called when the account opted in. Never throws. */
export async function liveMessages(token: () => Promise<string>, conversationId: string | null): Promise<Array<{ dir: "in" | "out"; text: string }> | null> {
  if (!conversationId) return null;
  try { return (await fetchThread(await token(), conversationId)).filter((m) => m.text.trim()).slice(-8).map((m) => ({ dir: m.direction === "in" ? "in" as const : "out" as const, text: m.text })); } catch { return null; }
}

export const NOT_FOUND = { ok: false as const, code: "not_found", error: "Lead not found.", sent: null };
export const DND_REFUSAL = { ok: false as const, code: "dnd", error: "This person asked not to be contacted, so SubSync suggests nothing about reaching them.", sent: null };

type LeadArgs = Run & { allowed: string[] | null; contactId: string; token: () => Promise<string> };

/** Job 1. */
export async function summariseLead(a: LeadArgs): Promise<Shaped> {
  const lead = await loadLead(a.installationId, a.allowed, a.locationId, a.contactId);
  if (!lead) return NOT_FOUND;
  if (lead.dnd) return DND_REFUSAL;
  const st = await jobReady(a.installationId, a.locationId, "lead_summary");
  const messages = st.ready && st.shareNames ? await liveMessages(a.token, lead.conversationId) : null;
  const facts = leadSummaryFacts({ ...lead.facts, ...(messages ? { messages } : {}) }, st.shareNames);
  return go(a, "lead_summary", facts);
}

/** Job 4. The draft is text for a person to read and edit; nothing is sent and the composer's own checks are untouched. */
export async function draftReply(a: LeadArgs & { channel: "SMS" | "Email" }): Promise<Shaped> {
  const lead = await loadLead(a.installationId, a.allowed, a.locationId, a.contactId);
  if (!lead) return NOT_FOUND;
  if (lead.dnd) return DND_REFUSAL;
  const st = await jobReady(a.installationId, a.locationId, "reply_draft");
  const messages = st.ready && st.shareNames ? await liveMessages(a.token, lead.conversationId) : null;
  const f = lead.facts;
  const s: ReplySituation = {
    channel: a.channel, firstName: lead.firstName, business: lead.business, source: f.source, lastInboundAgoMs: f.lastInboundAgoMs, humanOut: f.humanOut,
    noShow: f.appointments.noShow > 0, upcomingAppointment: f.appointments.upcoming > 0, openDeal: f.deals.open > 0, ...(messages ? { messages } : {}),
  };
  return go(a, "reply_draft", replyFacts(s, st.shareNames));
}

// ---------------------------------------------------------------- job 2: ranking inputs and reasons

/** Tags and earlier replies for a set of (account, contact) pairs. Limited to the accounts the caller may see. */
export async function rankSignals(installationId: string, pairs: ReadonlyArray<{ locationId: string; contactId: string }>, allowed: string[] | null): Promise<Map<string, { tags: string[]; replies: number }>> {
  const out = new Map<string, { tags: string[]; replies: number }>();
  if (!pairs.length) return out;
  const locs = [...new Set(pairs.map((p) => p.locationId))].filter((l) => !allowed || allowed.includes(l));
  const ids = [...new Set(pairs.map((p) => p.contactId))];
  const db = sql();
  const [tags, replies] = await Promise.all([
    db`select location_id, contact_id, tags from cached_contacts where installation_id = ${installationId} and location_id = any(${locs}::text[]) and contact_id = any(${ids}::text[])`,
    db`select location_id, contact_id, count(*)::int n from touch_events where installation_id = ${installationId} and location_id = any(${locs}::text[]) and contact_id = any(${ids}::text[]) and direction = 'inbound' and kind = 'message' and at > now() - interval '90 days' group by 1, 2`.catch(() => []),
  ]);
  for (const t of tags) out.set(`${t.location_id}:${t.contact_id}`, { tags: ((t.tags as string[] | null) ?? []).filter(Boolean), replies: 0 });
  for (const r of replies) { const k = `${r.location_id}:${r.contact_id}`, cur = out.get(k); if (cur) cur.replies = Number(r.n); }
  return out;
}

/** The one-line reasons for an already-ranked top list. The order never depends on the model; lines for ids we did not ask about are dropped. */
export async function reasonLines(a: Run, facts: Facts, askedIds: string[]): Promise<{ lines: Record<string, string>; result: Shaped }> {
  const result = await go(a, "call_first", facts);
  return { lines: result.ok ? cleanLines(result.json, askedIds) : {}, result };
}

// ---------------------------------------------------------------- job 3: cold leads

export const COLD_DAYS = 30;
export const COLD_CAP = 20_000;
export type ColdLoad = { rows: ColdLead[]; truncated: boolean };

/** The last 30 days of leads for the accounts the caller may see, in the shape the pattern rules read. A person's reply is the first reply by a person (older records: the first touch). */
export async function loadCold(installationId: string, allowed: string[] | null, now: number, ownerId?: string): Promise<ColdLoad> {
  const rows = await loadRows(sql(), installationId, allowed, now - COLD_DAYS * DAY, now + DAY);
  const mine = ownerId === undefined ? rows : rows.filter((r) => r.assignedTo === ownerId);
  return {
    truncated: rows.length >= COLD_CAP,
    rows: mine.map((r) => ({
      key: `${r.locationId}:${r.contactId}`, locationId: r.locationId, contactId: r.contactId, name: r.name, leadAt: r.leadAt, humanAt: r.detailed ? r.humanAt ?? null : r.touchAt, autoAt: r.detailed ? r.autoAt ?? null : null,
      hasOwner: r.assigned === true, source: r.source ?? null, timeZone: r.timeZone ?? null, dnd: r.dnd === true,
    })),
  };
}

export async function explainCold(a: Run, report: ColdReport): Promise<Shaped> { return go(a, "cold_reasons", coldFacts(report)); }
