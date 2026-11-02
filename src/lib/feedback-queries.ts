// The database side of feedback, problem reports, roadmap suggestions and the settings history (stage F8). Every function takes the installation id from the
// verified session (never from the request), and reads and writes only that installation's rows, except the admin summary, which only the server secret opens.
//
// Nothing here sends anything. "Telling King" is a dry-run audit line (recordWouldSend), through the same audit_log table the rest of the app writes to.
import { sql } from "./db";
import {
  DAILY_LIMIT, referenceOf, shippedNoticePlan, voteDigest, wouldSendDetail,
  type FeedbackInput, type NotifyEvent, type ProblemInput, type SuggestionInput,
} from "./feedback.ts";

export type Who = { installationId: string; kind: "agency" | "business" | "client"; limitTo: string | null; who: string; actor: string | null };

const audit = (installationId: string, actor: string | null, action: string, detail: Record<string, unknown>) =>
  sql()`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, ${action}, ${sql().json(detail as never)})`;

/** The "alert to King": a WOULD SEND line, ids only. Never the text, never an address. The real delivery is stage F9's dispatcher. */
export async function recordWouldSend(installationId: string, actor: string | null, event: NotifyEvent, ids: Record<string, string | number | null>): Promise<void> {
  await audit(installationId, actor, "notify.king.would_send", wouldSendDetail(event, ids));
}

export type Saved = { ok: true; id: string; reference: string } | { ok: false; tooMany: true };

async function sentToday(table: "feedback_items" | "roadmap_suggestions", w: Who): Promise<number> {
  const [r] = await sql()`select count(*)::int n from ${sql()(table)} where installation_id = ${w.installationId} and who = ${w.who} and created_at > now() - interval '1 day'`;
  return (r?.n as number) ?? 0;
}

export async function saveFeedback(w: Who, input: FeedbackInput): Promise<Saved> {
  if ((await sentToday("feedback_items", w)) >= DAILY_LIMIT) return { ok: false, tooMany: true };
  const [row] = await sql()`
    insert into feedback_items (installation_id, kind, who, role, location_id, page, severity, message)
    values (${w.installationId}, 'feedback', ${w.who}, ${w.kind}, ${w.limitTo}, ${input.page}, ${input.severity}, ${input.message}) returning id`;
  const id = row.id as string;
  await audit(w.installationId, w.actor, "feedback.received", { ref: referenceOf(id), page: input.page, severity: input.severity });
  await recordWouldSend(w.installationId, w.actor, "feedback", { ref: referenceOf(id), page: input.page });
  return { ok: true, id, reference: referenceOf(id) };
}

export async function saveProblem(w: Who, input: ProblemInput): Promise<Saved> {
  if ((await sentToday("feedback_items", w)) >= DAILY_LIMIT) return { ok: false, tooMany: true };
  const [row] = await sql()`
    insert into feedback_items (installation_id, kind, who, role, location_id, page, severity, message, error_id)
    values (${w.installationId}, 'problem', ${w.who}, ${w.kind}, ${w.limitTo}, ${input.page}, 'blocking', ${input.message}, ${input.errorId}) returning id`;
  const id = row.id as string;
  await audit(w.installationId, w.actor, "problem.reported", { ref: referenceOf(id), page: input.page, errorId: input.errorId });
  await recordWouldSend(w.installationId, w.actor, "problem", { ref: referenceOf(id), errorId: input.errorId, page: input.page });
  return { ok: true, id, reference: referenceOf(id) };
}

export async function saveSuggestion(w: Who, input: SuggestionInput): Promise<Saved> {
  if ((await sentToday("roadmap_suggestions", w)) >= DAILY_LIMIT) return { ok: false, tooMany: true };
  const [row] = await sql()`
    insert into roadmap_suggestions (installation_id, who, role, title, details, importance, page)
    values (${w.installationId}, ${w.who}, ${w.kind}, ${input.title}, ${input.details}, ${input.importance}, ${input.page}) returning id`;
  const id = row.id as string;
  await audit(w.installationId, w.actor, "roadmap.suggested", { ref: referenceOf(id), importance: input.importance });
  await recordWouldSend(w.installationId, w.actor, "suggestion", { ref: referenceOf(id), importance: input.importance });
  return { ok: true, id, reference: referenceOf(id) };
}

export type MySuggestion = { id: string; reference: string; title: string; importance: string; status: string; createdAt: string };

/** A person's own suggestions only: nobody else's, not even a colleague's in the same company. */
export async function mySuggestions(installationId: string, who: string): Promise<MySuggestion[]> {
  const rows = await sql()`select id, title, importance, status, created_at from roadmap_suggestions where installation_id = ${installationId} and who = ${who} order by created_at desc limit 20`;
  return rows.map((r) => ({ id: r.id as string, reference: referenceOf(r.id as string), title: r.title as string, importance: r.importance as string, status: r.status as string, createdAt: (r.created_at as Date).toISOString() }));
}

/** A vote was given: a line for the daily digest (ids only). Taking a vote back writes nothing. */
export async function recordVote(installationId: string, actor: string | null, itemKey: string): Promise<void> {
  await recordWouldSend(installationId, actor, "vote", { item: itemKey });
}

// ---- the history of settings changes (the audit log, read back) ----

const SETTINGS_ACTIONS = ["settings.changed", "accounts.flags_changed", "apikey.created", "apikey.revoked", "data.purged", "data.purge_refused", "connections.changed"];

/** Names only, never values: a key's name, an account id, a count. The Slack address and every other secret are never in the detail. */
export async function logSettingsChange(installationId: string, actor: string | null, kind: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await audit(installationId, actor, "settings.changed", { keys: keys.slice(0, 40), by: kind });
}

export async function logAccountFlags(installationId: string, actor: string | null, kind: string, locationId: string, keys: string[]): Promise<void> {
  await audit(installationId, actor, "accounts.flags_changed", { location: locationId, keys, by: kind });
}

export async function logKeyChange(installationId: string, actor: string | null, kind: string, created: boolean): Promise<void> {
  await audit(installationId, actor, created ? "apikey.created" : "apikey.revoked", { by: kind });
}

export type HistoryRow = { action: string; actor: string | null; at: string; keys: string[]; detail: string };

export async function settingsHistory(installationId: string, limit = 25): Promise<HistoryRow[]> {
  const rows = await sql()`select action, actor, detail, at from audit_log where installation_id = ${installationId} and action = any(${SETTINGS_ACTIONS}::text[]) order by at desc limit ${limit}`;
  return rows.map((r) => {
    const d = (r.detail ?? {}) as { keys?: unknown; location?: unknown; by?: unknown };
    return { action: r.action as string, actor: (r.actor as string | null) ?? null, at: (r.at as Date).toISOString(), keys: Array.isArray(d.keys) ? (d.keys as unknown[]).filter((k): k is string => typeof k === "string") : [], detail: typeof d.location === "string" ? "one client account" : "" };
  });
}

/** Setting names changed by this installation, for the Getting started ticks. */
export async function changedSettingKeys(installationId: string): Promise<Set<string>> {
  const rows = await sql()`select detail from audit_log where installation_id = ${installationId} and action = 'settings.changed' order by at desc limit 200`;
  const out = new Set<string>();
  for (const r of rows) { const k = (r.detail as { keys?: unknown } | null)?.keys; if (Array.isArray(k)) for (const x of k) if (typeof x === "string") out.add(x); }
  return out;
}

export async function feedbackGivenBy(installationId: string, who: string): Promise<number> {
  const [r] = await sql()`select (select count(*) from feedback_items where installation_id = ${installationId} and who = ${who})::int + (select count(*) from roadmap_suggestions where installation_id = ${installationId} and who = ${who})::int n`;
  return (r?.n as number) ?? 0;
}

// ---- King's admin view: only the server secret opens the route that calls this ----

export type AdminSummary = {
  generatedAt: string;
  feedback: Array<{ ref: string; company: string; role: string | null; kind: string; severity: string | null; page: string | null; errorId: string | null; status: string; message: string; at: string }>;
  suggestions: Array<{ ref: string; company: string; role: string | null; title: string; details: string | null; importance: string; status: string; page: string | null; at: string }>;
  votes: Array<{ itemKey: string; votes: number; companies: number; byKind: Record<string, number> }>;
};

/** Everything King reads: feedback, problem reports, suggestions and votes across every company. Companies are short ids, never names or emails. */
export async function adminSummary(limit = 100): Promise<AdminSummary> {
  const db = sql();
  const short = (id: string) => id.slice(0, 8);
  const [fb, sg, votes] = await Promise.all([
    db`select id, installation_id, role, kind, severity, page, error_id, status, message, created_at from feedback_items order by created_at desc limit ${limit}`,
    db`select id, installation_id, role, title, details, importance, status, page, created_at from roadmap_suggestions order by created_at desc limit ${limit}`,
    db`select item_key, installation_id, voter from roadmap_votes`,
  ]);
  return {
    generatedAt: new Date().toISOString(),
    feedback: fb.map((r) => ({ ref: referenceOf(r.id as string), company: short(r.installation_id as string), role: r.role as string | null, kind: r.kind as string, severity: r.severity as string | null, page: r.page as string | null, errorId: r.error_id as string | null, status: r.status as string, message: r.message as string, at: (r.created_at as Date).toISOString() })),
    suggestions: sg.map((r) => ({ ref: referenceOf(r.id as string), company: short(r.installation_id as string), role: r.role as string | null, title: r.title as string, details: r.details as string | null, importance: r.importance as string, status: r.status as string, page: r.page as string | null, at: (r.created_at as Date).toISOString() })),
    votes: voteDigest(votes.map((v) => ({ itemKey: v.item_key as string, installationId: v.installation_id as string, kind: String(v.voter).split(":")[0] }))),
  };
}

/** "Notify voters when it ships": one dry-run line per company that voted for the item. Run by King's script after an item is marked shipped. */
export async function recordShippedNotices(itemKey: string): Promise<Array<{ installationId: string; voters: number }>> {
  const votes = await sql()`select installation_id, voter from roadmap_votes where item_key = ${itemKey}`;
  const plan = shippedNoticePlan(votes.map((v) => ({ installationId: v.installation_id as string, voter: v.voter as string })));
  for (const p of plan) await recordWouldSend(p.installationId, "system", "shipped", { item: itemKey, voters: p.voters });
  return plan;
}
