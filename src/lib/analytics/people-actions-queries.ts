import { sql } from "../db";
import { properCase } from "./people-labels";
import { WAITING_WINDOW_DAYS } from "./waiting";
import {
  WAITING_HOURS, type AwayInput, type AwayReason, type Candidate, type IdleFacts, type LogRow, type NoteInput, type NoteRow, type PeriodStats, type ProofFacts, type ProofStaff, type TargetMetric, type WeekPerson,
} from "./people-actions";

// The data behind the Team module's actions and reports (slice PB). Every query names the installation (from the verified session). Account ids come ONLY from the routes, which have
// already proved them with the shared ownedLocation guard; a user id is used only after userScope has found that person in this installation (and, for a limited caller, in an account
// the caller may read). Nothing stored here is a message, a phone number or an email: ids, names the CRM already gave, counts, and the manager's own typed notes.
// The tables need the slice PB migration; until it is applied the callers get `ready: false` and say so instead of failing.

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : v == null ? null : Date.parse(String(v)));
const isMissing = (e: unknown) => /relation .* does not exist|42P01|column .* does not exist|42703/i.test(String((e as Error)?.message ?? e));
const DAY = 86_400_000;
type Allowed = readonly string[] | null;
const arr = (a: Allowed) => (a ? [...a] : null);

// ---------------- people: proof that a user belongs here ----------------

export type UserScope = { userId: string; name: string | null; locations: string[] };

/**
 * Is this user a person of THIS installation, and in which of the accounts the caller may read? Null when the id is unknown or in no account the caller may read: the caller then answers
 * "not found", the same answer as for an id that does not exist, so a foreign id is never confirmed. Reads the account member list (users.readonly) and, when the Team identity
 * tables are applied, their access list too.
 */
export async function userScope(inst: string, allowed: Allowed, userId: string): Promise<UserScope | null> {
  const db = sql();
  const a = arr(allowed);
  const locs = new Set<string>(); let name: string | null = null;
  try {
    const rows = await db`select location_id, name from location_users where installation_id = ${inst} and user_id = ${userId} ${a ? db`and location_id = any(${a}::text[])` : db``} limit 500`;
    for (const r of rows) { locs.add(r.location_id as string); name ??= (r.name as string | null) ?? null; }
  } catch (e) { if (!isMissing(e)) throw e; }
  try {
    const rows = await db`select location_id from team_member_access where installation_id = ${inst} and user_id = ${userId} ${a ? db`and location_id = any(${a}::text[])` : db``} limit 500`;
    for (const r of rows) locs.add(r.location_id as string);
  } catch (e) { if (!isMissing(e)) throw e; }
  if (locs.size === 0) return null;
  if (!name) {
    const [n] = await db`select name from team_names where installation_id = ${inst} and user_id = ${userId}`.catch(() => []);
    name = (n?.name as string | undefined) ?? null;
  }
  return { userId, name: name ? properCase(name) : null, locations: [...locs] };
}

/** The people of ONE account (already proved by the route). */
export async function membersOf(inst: string, locationId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const rows = await sql()`select user_id, name from location_users where installation_id = ${inst} and location_id = ${locationId} order by lower(name) limit 500`;
    return rows.map((r) => ({ id: r.user_id as string, name: properCase((r.name as string) || "Team member") }));
  } catch (e) { if (isMissing(e)) return []; throw e; }
}

/** Names for some user ids of this installation. An id with no name known is left out (the caller says "Team member"). */
export async function namesOf(inst: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const list = [...new Set(ids)];
  try {
    const rows = await sql()`select distinct on (user_id) user_id, name from location_users where installation_id = ${inst} and user_id = any(${list}::text[]) order by user_id, seen_at desc`;
    for (const r of rows) out.set(r.user_id as string, properCase(r.name as string));
  } catch (e) { if (!isMissing(e)) throw e; }
  const rest = list.filter((i) => !out.has(i));
  if (rest.length) {
    try {
      const rows = await sql()`select user_id, name from team_names where installation_id = ${inst} and user_id = any(${rest}::text[])`;
      for (const r of rows) out.set(r.user_id as string, properCase(r.name as string));
    } catch (e) { if (!isMissing(e)) throw e; }
  }
  return out;
}

// ---------------- coaching notes ----------------

const noteOf = (r: Record<string, unknown>): NoteRow => ({
  id: r.id as string, subjectUserId: r.subject_user_id as string, title: r.title as string, body: r.body as string, shared: r.shared_with_subject === true,
  authorUserId: (r.author_user_id as string | null) ?? null, authorName: (r.author_name as string | null) ?? null, createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});

/** Notes about one person (a user already proved by userScope). `visibility` is decided by the route from the verified viewer. */
export async function listNotes(inst: string, subject: string, v: { only: "all" | "shared" | "authored"; userId: string | null }): Promise<{ ready: boolean; rows: NoteRow[] }> {
  try {
    const db = sql();
    const rows = await db`select id, subject_user_id, title, body, shared_with_subject, author_user_id, author_name, created_at, updated_at from coaching_notes
      where installation_id = ${inst} and subject_user_id = ${subject} and removed_at is null
        ${v.only === "shared" ? db`and shared_with_subject` : v.only === "authored" ? db`and author_user_id = ${v.userId ?? ""}` : db``}
      order by created_at desc limit 200`;
    return { ready: true, rows: rows.map(noteOf) };
  } catch (e) { if (isMissing(e)) return { ready: false, rows: [] }; throw e; }
}
export async function noteById(inst: string, id: string): Promise<NoteRow | null> {
  try {
    const [r] = await sql()`select id, subject_user_id, title, body, shared_with_subject, author_user_id, author_name, created_at, updated_at from coaching_notes where installation_id = ${inst} and id = ${id} and removed_at is null`;
    return r ? noteOf(r) : null;
  } catch (e) { if (isMissing(e)) return null; throw e; }
}
export async function addNote(inst: string, subject: string, locationId: string | null, n: NoteInput, author: { userId: string | null; name: string | null }): Promise<string | null> {
  try {
    const [r] = await sql()`insert into coaching_notes (installation_id, subject_user_id, location_id, title, body, shared_with_subject, author_user_id, author_name)
      values (${inst}, ${subject}, ${locationId}, ${n.title}, ${n.body}, ${n.shared}, ${author.userId}, ${author.name}) returning id`;
    return r.id as string;
  } catch (e) { if (isMissing(e)) return null; throw e; }
}
export async function editNote(inst: string, id: string, n: NoteInput): Promise<boolean> {
  const r = await sql()`update coaching_notes set title = ${n.title}, body = ${n.body}, shared_with_subject = ${n.shared}, updated_at = now() where installation_id = ${inst} and id = ${id} and removed_at is null returning id`;
  return r.length === 1;
}
/** Takes the note out of sight. The row stays (removed_at) so the audit trail is whole; the route has already checked the typed confirmation. */
export async function removeNote(inst: string, id: string): Promise<boolean> {
  const r = await sql()`update coaching_notes set removed_at = now() where installation_id = ${inst} and id = ${id} and removed_at is null returning id`;
  return r.length === 1;
}

// ---------------- targets ----------------

export type TargetRow = { locationId: string | null; metric: TargetMetric; target: number; setBy: string | null; updatedAt: number };
export async function listTargets(inst: string, userId: string, allowed: Allowed): Promise<{ ready: boolean; rows: TargetRow[] }> {
  try {
    const db = sql();
    const a = arr(allowed);
    const rows = await db`select location_id, metric, target, set_by, updated_at from user_targets where installation_id = ${inst} and user_id = ${userId} ${a ? db`and (location_id = '' or location_id = any(${a}::text[]))` : db``} order by metric, location_id`;
    return { ready: true, rows: rows.map((r) => ({ locationId: (r.location_id as string) || null, metric: r.metric as TargetMetric, target: Number(r.target), setBy: (r.set_by as string | null) ?? null, updatedAt: ms(r.updated_at) ?? 0 })) };
  } catch (e) { if (isMissing(e)) return { ready: false, rows: [] }; throw e; }
}
export async function getTarget(inst: string, userId: string, locationId: string | null, metric: TargetMetric): Promise<number | null> {
  try {
    const [r] = await sql()`select target from user_targets where installation_id = ${inst} and user_id = ${userId} and location_id = ${locationId ?? ""} and metric = ${metric}`;
    return r ? Number(r.target) : null;
  } catch (e) { if (isMissing(e)) return null; throw e; }
}
export async function setTarget(inst: string, userId: string, locationId: string | null, metric: TargetMetric, value: number | null, by: string | null): Promise<boolean> {
  try {
    const db = sql();
    if (value === null) {
      await db`delete from user_targets where installation_id = ${inst} and user_id = ${userId} and location_id = ${locationId ?? ""} and metric = ${metric}`;
      return true;
    }
    await db`insert into user_targets (installation_id, user_id, location_id, metric, target, set_by) values (${inst}, ${userId}, ${locationId ?? ""}, ${metric}, ${value}, ${by})
      on conflict (installation_id, user_id, location_id, metric) do update set target = excluded.target, set_by = excluded.set_by, updated_at = now()`;
    return true;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}
/** The account's own reply target in minutes (its own, else the company's default). */
export async function accountReplyTarget(inst: string, locationId: string): Promise<number> {
  try {
    const [r] = await sql()`select l.speed_target_minutes own, s.speed_target_minutes dflt from locations l left join settings s on s.installation_id = l.installation_id where l.installation_id = ${inst} and l.location_id = ${locationId}`;
    return Number(r?.own ?? r?.dflt ?? 15);
  } catch { return 15; }
}

// ---------------- away and idle snoozes ----------------

export type AwayRow = { id: string; userId: string; kind: "away" | "idle_snooze"; reason: AwayReason | null; until: number; setBy: string | null };
export async function activeAway(inst: string, userIds: readonly string[] | null, now: number): Promise<{ ready: boolean; rows: AwayRow[] }> {
  try {
    const db = sql();
    const rows = await db`select id, user_id, kind, reason, until, set_by from user_away where installation_id = ${inst} and released_at is null and until > ${new Date(now)}
      ${userIds ? db`and user_id = any(${[...userIds]}::text[])` : db``} order by until limit 500`;
    return { ready: true, rows: rows.map((r) => ({ id: r.id as string, userId: r.user_id as string, kind: r.kind as AwayRow["kind"], reason: (r.reason as AwayReason | null) ?? null, until: ms(r.until) ?? 0, setBy: (r.set_by as string | null) ?? null })) };
  } catch (e) { if (isMissing(e)) return { ready: false, rows: [] }; throw e; }
}
/** One mark of each kind per person at a time: a new one replaces the old (the old is released, so the history stays). */
export async function addAway(inst: string, a: AwayInput, by: string | null): Promise<string | null> {
  try {
    const db = sql();
    await db`update user_away set released_at = now() where installation_id = ${inst} and user_id = ${a.userId} and kind = ${a.kind} and released_at is null`;
    const [r] = await db`insert into user_away (installation_id, user_id, kind, reason, until, set_by) values (${inst}, ${a.userId}, ${a.kind}, ${a.kind === "away" ? a.reason : null}, ${new Date(a.until)}, ${by}) returning id`;
    return r.id as string;
  } catch (e) { if (isMissing(e)) return null; throw e; }
}
export async function releaseAway(inst: string, id: string, userIds: readonly string[] | null): Promise<boolean> {
  try {
    const db = sql();
    const r = await db`update user_away set released_at = now() where installation_id = ${inst} and id = ${id} and released_at is null ${userIds ? db`and user_id = any(${[...userIds]}::text[])` : db``} returning id`;
    return r.length === 1;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}

// ---------------- the reassign log ----------------

export type WriteLogRow = { locationId: string; batchId: string; action: "reassign" | "undo"; contactId: string; before: string | null; after: string | null; suggested: boolean; result: string; actor: string | null };
/** One row per lead. Ids only. A log that cannot be written never turns a finished change into an error (the gateway audit line still holds it). */
export async function logWrites(inst: string, rows: readonly WriteLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = sql();
    await db`insert into people_write_log ${db(rows.map((r) => ({ installation_id: inst, location_id: r.locationId, batch_id: r.batchId, action: r.action, contact_id: r.contactId, before_owner: r.before, after_owner: r.after, suggested: r.suggested, result: r.result, actor: r.actor })))}`;
  } catch (e) { if (!isMissing(e)) throw e; }
}
export async function batchOf(inst: string, locationId: string, batchId: string): Promise<LogRow[]> {
  try {
    const rows = await sql()`select contact_id, before_owner, after_owner, result, created_at from people_write_log where installation_id = ${inst} and location_id = ${locationId} and batch_id = ${batchId} and action = 'reassign'`;
    return rows.map((r) => ({ contactId: r.contact_id as string, before: (r.before_owner as string | null) ?? null, after: (r.after_owner as string | null) ?? null, result: r.result as string, at: ms(r.created_at) ?? 0 }));
  } catch (e) { if (isMissing(e)) return []; throw e; }
}
/** Has this batch already been put back (so a second Undo does nothing)? */
export async function alreadyUndone(inst: string, locationId: string, contactIds: readonly string[], since: number): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();
  try {
    const rows = await sql()`select contact_id from people_write_log where installation_id = ${inst} and location_id = ${locationId} and action = 'undo' and result = 'done' and contact_id = any(${[...contactIds]}::text[]) and created_at >= ${new Date(since)}`;
    return new Set(rows.map((r) => r.contact_id as string));
  } catch (e) { if (isMissing(e)) return new Set(); throw e; }
}
export async function recentWrites(inst: string, allowed: Allowed, limit = 50): Promise<Array<{ at: number; locationId: string; action: string; contactId: string; before: string | null; after: string | null; suggested: boolean; result: string; actor: string | null }>> {
  try {
    const db = sql(); const a = arr(allowed);
    const rows = await db`select created_at, location_id, action, contact_id, before_owner, after_owner, suggested, result, actor from people_write_log where installation_id = ${inst} ${a ? db`and location_id = any(${a}::text[])` : db``} order by created_at desc limit ${Math.min(limit, 200)}`;
    return rows.map((r) => ({ at: ms(r.created_at) ?? 0, locationId: r.location_id as string, action: r.action as string, contactId: r.contact_id as string, before: (r.before_owner as string | null) ?? null, after: (r.after_owner as string | null) ?? null, suggested: r.suggested === true, result: r.result as string, actor: (r.actor as string | null) ?? null }));
  } catch (e) { if (isMissing(e)) return []; throw e; }
}
/** The platform's own copy now shows the new owner, so the next sync sees no change and records no owner change of its own for a move SubSync made. */
export async function applyOwnerLocal(inst: string, locationId: string, contactId: string, to: string): Promise<void> {
  const db = sql();
  await db`update cached_contacts set assigned_to = ${to} where installation_id = ${inst} and location_id = ${locationId} and contact_id = ${contactId}`.catch(() => undefined);
  // The conversation list shows the owner too, so "leads waiting on each person" is right straight away instead of after the next sync.
  await db`update cached_conversations set assigned_to = ${to} where installation_id = ${inst} and location_id = ${locationId} and contact_id = ${contactId}`.catch(() => undefined);
}

// ---------------- the suggestion's facts ----------------

/**
 * The people of ONE account with what the estimate needs: leads waiting on each, new leads each answered first in the last 28 days, how many days of history exist, the typical first
 * reply (overall and for this lead's source). All SQL aggregates; nothing is looped over in the app. `source` is the lead's own source text, or null.
 */
export async function candidatesFor(inst: string, locationId: string, source: string | null, now: number): Promise<Candidate[]> {
  const db = sql();
  const members = await membersOf(inst, locationId);
  if (members.length === 0) return [];
  const ids = members.map((m) => m.id);
  const [waiting, stats, away] = await Promise.all([
    db`select nullif(assigned_to, '') owner, count(*)::int n from cached_conversations where installation_id = ${inst} and location_id = ${locationId}
        and last_message_direction = 'inbound' and last_message_at > ${new Date(now - WAITING_WINDOW_DAYS * DAY)} and nullif(assigned_to, '') = any(${ids}::text[]) group by 1`,
    db`select t.touch_user_id uid,
        count(*) filter (where t.lead_at > ${new Date(now - 28 * DAY)})::int leads,
        extract(epoch from (${new Date(now)}::timestamptz - min(t.lead_at)))/86400 days,
        percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at)))) / 60) filter (where t.lead_at > ${new Date(now - 28 * DAY)}) med,
        count(*) filter (where t.lead_at > ${new Date(now - 28 * DAY)} and ${source ? db`lower(btrim(c.source)) = lower(btrim(${source}))` : db`false`})::int src_leads,
        percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at)))) / 60) filter (where t.lead_at > ${new Date(now - 28 * DAY)} and ${source ? db`lower(btrim(c.source)) = lower(btrim(${source}))` : db`false`}) src_med
      from lead_touches t left join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
      where t.installation_id = ${inst} and t.location_id = ${locationId} and t.excluded is null and t.touch_at is not null and t.touch_user_id = any(${ids}::text[]) and t.lead_at > ${new Date(now - 56 * DAY)}
      group by t.touch_user_id`,
    activeAway(inst, ids, now),
  ]);
  const w = new Map(waiting.map((r) => [r.owner as string, Number(r.n)]));
  const s = new Map(stats.map((r) => [r.uid as string, r]));
  const awayIds = new Set(away.rows.filter((r) => r.kind === "away").map((r) => r.userId));
  return members.map((m): Candidate => {
    const r = s.get(m.id);
    return {
      userId: m.id, name: m.name, waiting: w.get(m.id) ?? 0, leads: Number(r?.leads ?? 0), days: Math.floor(Number(r?.days ?? 0)),
      medianReplyMinutes: r?.med == null ? null : Number(r.med), ...(source ? { sourceLeads: Number(r?.src_leads ?? 0), sourceMedianMinutes: r?.src_med == null ? null : Number(r.src_med) } : {}),
      away: awayIds.has(m.id),
    };
  });
}

/** A lead's source text (for a source-aware estimate). One contact of one proved account. */
export async function sourceOf(inst: string, locationId: string, contactId: string): Promise<string | null> {
  const [r] = await sql()`select nullif(btrim(source), '') source from cached_contacts where installation_id = ${inst} and location_id = ${locationId} and contact_id = ${contactId}`;
  return (r?.source as string | undefined) ?? null;
}

// ---------------- one thing to work on ----------------

/**
 * A person's own numbers for one period, over the accounts the caller may read: their leads (the leads that are theirs now), how many they answered first, how many of those inside the
 * account's reply target, and the typical first reply. The owner is read today, which is labelled on the screen; SubSync does not guess who owned a lead earlier.
 */
export async function periodStats(inst: string, userId: string, allowed: Allowed, fromMs: number, toMs: number): Promise<PeriodStats> {
  const db = sql(); const a = arr(allowed);
  const [r] = await db`
    select count(*)::int leads,
      count(*) filter (where t.touch_user_id = ${userId} and t.touch_at is not null)::int answered,
      count(*) filter (where t.touch_user_id = ${userId} and t.touch_at is not null and extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at))) <= coalesce(l.speed_target_minutes, s.speed_target_minutes, 15) * 60)::int in_time,
      percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at)))) / 60) filter (where t.touch_user_id = ${userId} and t.touch_at is not null) med
    from lead_touches t
    join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id and c.assigned_to = ${userId}
    join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
    left join settings s on s.installation_id = t.installation_id
    where t.installation_id = ${inst} and t.excluded is null and t.lead_at >= ${new Date(fromMs)} and t.lead_at < ${new Date(toMs)} ${a ? db`and t.location_id = any(${a}::text[])` : db``}`;
  return { leads: Number(r?.leads ?? 0), answered: Number(r?.answered ?? 0), inTime: Number(r?.in_time ?? 0), medianReplyMinutes: r?.med == null ? null : Number(r.med) };
}

// ---------------- the client receipt ----------------

export async function proofPrefs(inst: string, locationId: string): Promise<{ ready: boolean; nameStaff: boolean }> {
  try {
    const [r] = await sql()`select name_staff from people_proof_prefs where installation_id = ${inst} and location_id = ${locationId}`;
    return { ready: true, nameStaff: r?.name_staff === true };
  } catch (e) { if (isMissing(e)) return { ready: false, nameStaff: false }; throw e; }
}
export async function setProofPrefs(inst: string, locationId: string, nameStaff: boolean, by: string | null): Promise<boolean> {
  try {
    await sql()`insert into people_proof_prefs (installation_id, location_id, name_staff, updated_by) values (${inst}, ${locationId}, ${nameStaff}, ${by})
      on conflict (installation_id, location_id) do update set name_staff = excluded.name_staff, updated_by = excluded.updated_by, updated_at = now()`;
    return true;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}

/**
 * One account, one period: the team's handling of the account's new leads (counted exactly as the Speed to lead screen counts them: the same lead rows, the same exclusions, the same
 * reply target), the appointments that fell due, and, per person, the leads they answered first. SQL aggregates only; a person with no name known is "Team member".
 */
export async function proofFacts(inst: string, locationId: string, fromMs: number, toMs: number, targetMinutes: number): Promise<Omit<ProofFacts, "nameStaff" | "accountName"> & { accountName: string }> {
  const db = sql();
  const from = new Date(fromMs), to = new Date(toMs);
  const secs = db`greatest(0, extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at))))`;
  const [loc, team, staff, appts] = await Promise.all([
    db`select name from locations where installation_id = ${inst} and location_id = ${locationId}`,
    db`select count(*)::int leads, count(*) filter (where t.touch_at is not null)::int answered,
        count(*) filter (where t.touch_at is not null and ${secs} <= ${targetMinutes * 60})::int in_time,
        percentile_cont(0.5) within group (order by ${secs} / 60) filter (where t.touch_at is not null) med
      from lead_touches t where t.installation_id = ${inst} and t.location_id = ${locationId} and t.excluded is null and t.lead_at >= ${from} and t.lead_at < ${to}`,
    db`select t.touch_user_id uid, count(*)::int leads, count(*)::int answered, count(*) filter (where ${secs} <= ${targetMinutes * 60})::int in_time,
        percentile_cont(0.5) within group (order by ${secs} / 60) med
      from lead_touches t where t.installation_id = ${inst} and t.location_id = ${locationId} and t.excluded is null and t.touch_at is not null and t.touch_user_id is not null and t.lead_at >= ${from} and t.lead_at < ${to}
      group by t.touch_user_id order by count(*) desc limit 200`,
    db`select count(*) filter (where coalesce(status, 'new') not in ('cancelled', 'invalid'))::int held,
        count(*) filter (where status = 'showed')::int showed, count(*) filter (where status = 'noshow')::int noshow,
        count(*) filter (where coalesce(status, 'new') not in ('cancelled', 'invalid', 'showed', 'noshow'))::int unmarked
      from cached_appointments where installation_id = ${inst} and location_id = ${locationId} and start_at >= ${from} and start_at < ${to}`,
  ]);
  const names = await namesOf(inst, staff.map((s) => s.uid as string));
  const t = team[0] ?? {}; const a = appts[0] ?? {};
  const people: ProofStaff[] = staff.map((s) => ({ userId: s.uid as string, name: names.get(s.uid as string) ?? "Team member", leads: Number(s.leads), answered: Number(s.answered), inTime: Number(s.in_time), medianReplyMinutes: s.med == null ? null : Number(s.med) }));
  return {
    accountName: (loc[0]?.name as string | undefined) ?? "This account", from: fromMs, to: toMs, targetMinutes,
    team: { leads: Number(t.leads ?? 0), answered: Number(t.answered ?? 0), inTime: Number(t.in_time ?? 0), medianReplyMinutes: t.med == null ? null : Number(t.med) },
    appointments: { held: Number(a.held ?? 0), showed: Number(a.showed ?? 0), noShow: Number(a.noshow ?? 0), unmarked: Number(a.unmarked ?? 0) },
    staff: people,
  };
}

// ---------------- the weekly team lines for the summary email ----------------

/** The last 7 days: each person's new leads answered first and how many in time (at least 10 are compared), and the new leads nobody answered. All accounts of the installation. */
export async function weekTeamFacts(inst: string, now: number): Promise<{ people: WeekPerson[]; noPersonReply: number }> {
  const db = sql();
  const from = new Date(now - 7 * DAY);
  const [rows, [none]] = await Promise.all([
    db`select t.touch_user_id uid, count(*)::int leads,
        count(*) filter (where greatest(0, extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at)))) <= coalesce(l.speed_target_minutes, s.speed_target_minutes, 15) * 60)::int in_time
      from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
      left join settings s on s.installation_id = t.installation_id
      where t.installation_id = ${inst} and t.excluded is null and t.touch_at is not null and t.touch_user_id is not null and t.lead_at >= ${from}
      group by t.touch_user_id having count(*) >= 10 order by count(*) desc limit 100`,
    db`select count(*)::int n from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
      where t.installation_id = ${inst} and t.excluded is null and t.touch_at is null and t.lead_at >= ${from} and t.lead_at < ${new Date(now - 3_600_000)}`,
  ]);
  const names = await namesOf(inst, rows.map((r) => r.uid as string));
  return { people: rows.map((r) => ({ name: names.get(r.uid as string) ?? "A team member", leads: Number(r.leads), inTime: Number(r.in_time) })), noPersonReply: Number(none?.n ?? 0) };
}

// ---------------- quiet and overloaded people (alerts) ----------------

export type AccountPeople = {
  locationId: string; accountName: string; adminId: string | null; muted: boolean;
  people: Array<{ userId: string; name: string; waiting: number; away: boolean; snoozed: boolean; idle: IdleFacts | null }>;
};

/**
 * Everything the hourly check needs, in few queries: per account the people, the leads waiting on each (over WAITING_HOURS), their last recorded human touch in the account, whether
 * they were active there in the last 14 days, and any away or snooze mark. Accounts the agency has quieted for replies are marked `muted`.
 */
export async function alertFacts(inst: string, now: number): Promise<AccountPeople[]> {
  const db = sql();
  const [accts, users, waiting, away, mutes] = await Promise.all([
    db`select l.location_id, l.name, l.timezone, s.speed_business_hours bh, s.speed_open_hour oh, s.speed_close_hour ch from locations l left join settings s on s.installation_id = l.installation_id where l.installation_id = ${inst} and not l.ignored`,
    db`select location_id, user_id, name, role from location_users where installation_id = ${inst}`.catch(() => []),
    db`select location_id, nullif(assigned_to, '') owner, count(*)::int n from cached_conversations where installation_id = ${inst} and last_message_direction = 'inbound'
        and last_message_at > ${new Date(now - WAITING_WINDOW_DAYS * DAY)} and last_message_at <= ${new Date(now - WAITING_HOURS * 3_600_000)} and nullif(assigned_to, '') is not null group by 1, 2`,
    activeAway(inst, null, now),
    db`select location_id from client_alert_mutes where installation_id = ${inst} and released_at is null and until > ${new Date(now)} and kind in ('all', 'replies')`.catch(() => []),
  ]);
  const w = new Map(waiting.map((r) => [`${r.location_id}|${r.owner}`, Number(r.n)]));
  const awayBy = new Map<string, boolean>(); const snoozeBy = new Map<string, boolean>();
  for (const r of away.rows) (r.kind === "away" ? awayBy : snoozeBy).set(r.userId, true);
  const muted = new Set(mutes.map((m) => m.location_id as string));
  // Last human touch only for the (account, person) pairs with enough waiting leads to matter: few pairs, so the lookup stays small.
  const need = users.filter((u) => (w.get(`${u.location_id}|${u.user_id}`) ?? 0) >= 3);
  const last = new Map<string, number | null>();
  if (need.length) {
    const rows = await db`select p.l, p.u, (select max(t.at) from touch_events t where t.installation_id = ${inst} and t.location_id = p.l and t.user_id = p.u and not t.automated and t.direction = 'outbound' and t.at > ${new Date(now - 14 * DAY)}) last_at
      from unnest(${need.map((u) => u.location_id as string)}::text[], ${need.map((u) => u.user_id as string)}::text[]) as p(l, u)`;
    for (const r of rows) last.set(`${r.l}|${r.u}`, ms(r.last_at));
  }
  return accts.map((a): AccountPeople => {
    const mine = users.filter((u) => u.location_id === a.location_id);
    const admin = mine.find((u) => u.role === "account_admin");
    const clock = { businessHours: a.bh === true, openHour: Number(a.oh ?? 9), closeHour: Number(a.ch ?? 17), zone: (a.timezone as string | null) ?? null };
    return {
      locationId: a.location_id as string, accountName: (a.name as string | null) ?? "A client account", adminId: (admin?.user_id as string | undefined) ?? null, muted: muted.has(a.location_id as string),
      people: mine.map((u) => {
        const key = `${u.location_id}|${u.user_id}`; const lastAt = last.get(key) ?? null;
        const n = w.get(key) ?? 0; const name = properCase((u.name as string) || "Team member");
        return {
          userId: u.user_id as string, name, waiting: n, away: awayBy.has(u.user_id as string), snoozed: snoozeBy.has(u.user_id as string),
          idle: n >= 3 ? { userId: u.user_id as string, name, locationId: a.location_id as string, accountName: (a.name as string | null) ?? "A client account", waiting: n, lastTouchAt: lastAt, activeRecently: lastAt !== null, away: awayBy.has(u.user_id as string), snoozed: snoozeBy.has(u.user_id as string), clock } : null,
        };
      }),
    };
  });
}

// ---------------- small helpers for the routes ----------------

/** Whose mark is this? (An id the caller sent; the route then checks the person with userScope.) */
export async function awayById(inst: string, id: string): Promise<{ userId: string } | null> {
  try {
    const [r] = await sql()`select user_id from user_away where installation_id = ${inst} and id = ${id} and released_at is null`;
    return r ? { userId: r.user_id as string } : null;
  } catch (e) { if (isMissing(e)) return null; throw e; }
}

/** Each of these accounts' own reply target in minutes (its own, else the company's default), with the account's name. Accounts are already proved by the route. */
export async function accountTargets(inst: string, locationIds: readonly string[]): Promise<Array<{ locationId: string; name: string; replyMinutes: number }>> {
  if (locationIds.length === 0) return [];
  const rows = await sql()`select l.location_id, l.name, coalesce(l.speed_target_minutes, s.speed_target_minutes, 15) minutes from locations l left join settings s on s.installation_id = l.installation_id
    where l.installation_id = ${inst} and not l.ignored and l.location_id = any(${[...locationIds]}::text[]) order by lower(coalesce(l.name, '')) limit 100`;
  return rows.map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", replyMinutes: Number(r.minutes) }));
}

/** One audit line for a change SubSync itself keeps (a note, a target, an away mark). Ids and a word for the action only: never the words of a note. */
export async function auditPeople(inst: string, actor: string | null, action: string, detail: Record<string, unknown>): Promise<void> {
  try {
    const db = sql();
    await db`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${actor}, ${action}, ${db.json(detail as never)})`;
  } catch { /* an audit line that cannot be written must never turn a finished change into an error */ }
}

/**
 * SubSync's own finished moves of a lead to another owner since a time (contact, new owner, time). The owner history and every activity figure use it to recognise the platform's echo of
 * a change SubSync made, so it is never counted as a person's activity (principle 14). Ids only.
 */
export async function ownReassignSince(inst: string, since: number): Promise<Array<{ locationId: string; contactId: string; owner: string; at: number }>> {
  try {
    const rows = await sql()`select location_id, contact_id, after_owner, created_at from people_write_log where installation_id = ${inst} and result = 'done' and after_owner is not null and created_at >= ${new Date(since)} limit 20000`;
    return rows.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, owner: r.after_owner as string, at: ms(r.created_at) ?? 0 }));
  } catch (e) { if (isMissing(e)) return []; throw e; }
}

/** The leads of one person that wait for a reply now (their last message is from the customer), longest waiting first, for the rebalance estimate. One account, already proved. */
export async function waitingLeadsOf(inst: string, locationId: string, userId: string, now: number, limit = 60): Promise<Array<{ contactId: string; name: string; waitedMinutes: number }>> {
  const rows = await sql()`select c.contact_id, c.last_message_at, coalesce(nullif(btrim(ct.full_name), ''), nullif(btrim(c.contact_name), ''), nullif(btrim(ct.email), ''), 'This person') name
    from cached_conversations c left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    where c.installation_id = ${inst} and c.location_id = ${locationId} and nullif(c.assigned_to, '') = ${userId} and c.contact_id is not null and c.last_message_direction = 'inbound'
      and c.last_message_at > ${new Date(now - WAITING_WINDOW_DAYS * DAY)} order by c.last_message_at asc limit ${Math.min(limit, 200)}`;
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const id = r.contact_id as string;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ contactId: id, name: properCase(r.name as string), waitedMinutes: Math.max(0, Math.round((now - (ms(r.last_message_at) ?? now)) / 60_000)) }];
  });
}
