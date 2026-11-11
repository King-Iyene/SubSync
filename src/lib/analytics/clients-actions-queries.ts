import { sql } from "../db";
import { loadTargets, replyRows } from "./speed-queries";
import { weekWindow, type MuteKind, type ReceiptFacts, type SetupFacts } from "./clients-actions";

// Clients slice CB reads and SubSync-only writes. Every query filters by installation_id and by the account ids the ROUTE already narrowed (from the signed session, then the
// shared ownedLocation guard); an id never comes from here. Nothing is written to the CRM. The mute and action tables need the slice CB migration; until it is applied the
// callers get `ready: false` and say so instead of failing.

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const isMissing = (e: unknown) => /relation .* does not exist|42P01/i.test(String((e as Error)?.message ?? e));

/** Name, and the account's own reply target (or the company default), for the accounts given. */
async function namesAndTargets(inst: string, ids: string[], fallback: number) {
  const db = sql();
  const rows = await db`select location_id, name from locations where installation_id = ${inst} and not ignored and location_id = any(${ids}::text[])`;
  const t = await loadTargets(db, inst);
  return rows.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", target: t.map.get(r.location_id as string) ?? fallback }));
}

/** The last 7 days for each account: counts only, from the synced copy. `ids` must already be the caller's own accounts. */
export async function receiptFacts(inst: string, ids: string[], defaultTarget: number, now: number): Promise<ReceiptFacts[]> {
  if (ids.length === 0) return [];
  const db = sql();
  const w = weekWindow(now);
  const from = new Date(w.from), to = new Date(w.to);
  const [accts, contacts, appts, deals, replies] = await Promise.all([
    namesAndTargets(inst, ids, defaultTarget),
    db`select location_id, count(*)::int n from cached_contacts where installation_id = ${inst} and location_id = any(${ids}::text[]) and date_added >= ${from} and date_added < ${to} group by location_id`,
    db`select location_id,
        count(*) filter (where start_at >= ${from} and start_at < ${to} and coalesce(status, 'new') not in ('cancelled', 'invalid'))::int held,
        count(*) filter (where start_at >= ${from} and start_at < ${to} and status = 'showed')::int showed,
        count(*) filter (where start_at >= ${from} and start_at < ${to} and status = 'noshow')::int noshow,
        count(*) filter (where start_at >= ${from} and start_at < ${to} and coalesce(status, 'new') not in ('cancelled', 'invalid', 'showed', 'noshow'))::int unmarked
      from cached_appointments where installation_id = ${inst} and location_id = any(${ids}::text[]) and start_at >= ${from} and start_at < ${to} group by location_id`,
    db`select location_id,
        count(*) filter (where created_remote_at >= ${from} and created_remote_at < ${to})::int started,
        coalesce(sum(monetary_value) filter (where created_remote_at >= ${from} and created_remote_at < ${to}), 0)::float8 started_value,
        count(*) filter (where status = 'won' and last_status_change_at >= ${from} and last_status_change_at < ${to})::int won,
        coalesce(sum(monetary_value) filter (where status = 'won' and last_status_change_at >= ${from} and last_status_change_at < ${to}), 0)::float8 won_value,
        count(*) filter (where status = 'lost' and last_status_change_at >= ${from} and last_status_change_at < ${to})::int lost
      from cached_opportunities where installation_id = ${inst} and location_id = any(${ids}::text[]) group by location_id`,
    replyRows(inst, ids, now),
  ]);
  const by = (rows: ArrayLike<Record<string, unknown>>) => new Map(Array.from(rows, (r) => [r.location_id as string, r] as const));
  const c = by(contacts), a = by(appts), d = by(deals);
  return accts.map((x) => {
    const mine = replies.filter((r) => r.locationId === x.id && r.leadAt >= w.from && r.leadAt < w.to);
    const answered = mine.filter((r) => r.touchAt !== null);
    return {
      locationId: x.id, name: x.name, newContacts: (c.get(x.id)?.n as number | undefined) ?? 0,
      leads: mine.length, answered: answered.length, answeredInTarget: answered.filter((r) => (r.touchAt as number) - r.leadAt <= x.target * 60_000).length, targetMinutes: x.target,
      appointments: { held: (a.get(x.id)?.held as number | undefined) ?? 0, showed: (a.get(x.id)?.showed as number | undefined) ?? 0, noShow: (a.get(x.id)?.noshow as number | undefined) ?? 0, unmarked: (a.get(x.id)?.unmarked as number | undefined) ?? 0 },
      deals: {
        started: (d.get(x.id)?.started as number | undefined) ?? 0, startedValue: (d.get(x.id)?.started_value as number | undefined) ?? 0,
        won: (d.get(x.id)?.won as number | undefined) ?? 0, wonValue: (d.get(x.id)?.won_value as number | undefined) ?? 0, lost: (d.get(x.id)?.lost as number | undefined) ?? 0,
      },
    };
  });
}

/** Access and freshness for each account, for the Setup health rows. */
export async function setupFacts(inst: string, ids: string[]): Promise<Array<{ locationId: string; name: string } & SetupFacts>> {
  if (ids.length === 0) return [];
  const rows = await sql()`select location_id, name, appointments_access, users_access, contacts_synced_at, appointments_synced_at from locations
    where installation_id = ${inst} and not ignored and location_id = any(${ids}::text[]) order by name`;
  return rows.map((r) => ({
    locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", appointmentsAccess: (r.appointments_access as string | null) ?? null,
    usersAccess: (r.users_access as string | null) ?? null, contactsSyncedAt: ms(r.contacts_synced_at), appointmentsSyncedAt: ms(r.appointments_synced_at),
  }));
}

// ---- mutes ----

export type MuteRow = { id: string; locationId: string; kind: MuteKind; until: number; createdBy: string | null };
export async function activeMutes(inst: string, ids: string[], now: number): Promise<{ ready: boolean; rows: MuteRow[] }> {
  if (ids.length === 0) return { ready: true, rows: [] };
  try {
    const rows = await sql()`select id, location_id, kind, until, created_by from client_alert_mutes
      where installation_id = ${inst} and location_id = any(${ids}::text[]) and released_at is null and until > ${new Date(now)} order by until`;
    return { ready: true, rows: rows.map((r) => ({ id: r.id as string, locationId: r.location_id as string, kind: r.kind as MuteKind, until: ms(r.until) ?? 0, createdBy: (r.created_by as string | null) ?? null })) };
  } catch (e) {
    if (isMissing(e)) return { ready: false, rows: [] };
    throw e;
  }
}

/** One mute per account and kind at a time: a new one replaces the old (the old is released, so the log stays). */
export async function addMute(inst: string, locationId: string, kind: MuteKind, until: Date, actor: string | null): Promise<{ ok: true; id: string } | { ok: false }> {
  try {
    const db = sql();
    await db`update client_alert_mutes set released_at = now() where installation_id = ${inst} and location_id = ${locationId} and kind = ${kind} and released_at is null`;
    const [r] = await db`insert into client_alert_mutes (installation_id, location_id, kind, until, created_by) values (${inst}, ${locationId}, ${kind}, ${until}, ${actor}) returning id`;
    await db`insert into client_actions (installation_id, location_id, action, after_value, actor) values (${inst}, ${locationId}, 'mute', ${db.json({ kind, until: until.toISOString() })}, ${actor})`;
    return { ok: true, id: r.id as string };
  } catch (e) {
    if (isMissing(e)) return { ok: false };
    throw e;
  }
}

export async function releaseMute(inst: string, ids: string[], muteId: string, actor: string | null): Promise<boolean> {
  try {
    const db = sql();
    const r = await db`update client_alert_mutes set released_at = now() where installation_id = ${inst} and id = ${muteId} and location_id = any(${ids}::text[]) and released_at is null returning location_id, kind`;
    if (r.length === 0) return false;
    await db`insert into client_actions (installation_id, location_id, action, before_value, actor) values (${inst}, ${r[0].location_id as string}, 'unmute', ${db.json({ kind: r[0].kind as string })}, ${actor})`;
    return true;
  } catch (e) {
    if (isMissing(e)) return false;
    throw e;
  }
}

// ---- reply target log (the write itself is setAccountTarget in speed-v2-queries) ----

export async function currentTarget(inst: string, locationId: string): Promise<number | null> {
  const t = await loadTargets(sql(), inst);
  return t.map.get(locationId) ?? null;
}
export async function logTarget(inst: string, locationId: string, before: number | null, after: number | null, actor: string | null): Promise<void> {
  try {
    const db = sql();
    await db`insert into client_actions (installation_id, location_id, action, before_value, after_value, actor) values (${inst}, ${locationId}, 'target', ${db.json({ minutes: before })}, ${db.json({ minutes: after })}, ${actor})`;
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
}
/** The last target change of an account, to put back. */
export async function lastTargetChange(inst: string, locationId: string): Promise<{ before: number | null } | null> {
  try {
    const [r] = await sql()`select before_value from client_actions where installation_id = ${inst} and location_id = ${locationId} and action = 'target' order by created_at desc limit 1`;
    if (!r) return null;
    const m = (r.before_value as { minutes?: unknown }).minutes;
    return { before: typeof m === "number" ? m : null };
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

// ---- owner (who at the agency looks after a client) ----

export async function ownersOf(inst: string, ids: string[]): Promise<{ ready: boolean; owners: Record<string, string> }> {
  if (ids.length === 0) return { ready: true, owners: {} };
  try {
    const rows = await sql()`select location_id, owner_name from client_owners where installation_id = ${inst} and location_id = any(${ids}::text[])`;
    return { ready: true, owners: Object.fromEntries(rows.map((r) => [r.location_id as string, r.owner_name as string])) };
  } catch (e) {
    if (isMissing(e)) return { ready: false, owners: {} };
    throw e;
  }
}
/** name null clears the owner. Returns false when the table is not there yet. */
export async function setOwner(inst: string, locationId: string, name: string | null, actor: string | null): Promise<boolean> {
  try {
    const db = sql();
    if (name === null) await db`delete from client_owners where installation_id = ${inst} and location_id = ${locationId}`;
    else await db`insert into client_owners (installation_id, location_id, owner_name, set_by) values (${inst}, ${locationId}, ${name}, ${actor})
      on conflict (installation_id, location_id) do update set owner_name = excluded.owner_name, set_by = excluded.set_by, updated_at = now()`;
    return true;
  } catch (e) {
    if (isMissing(e)) return false;
    throw e;
  }
}

// ---- retention: the daily history of many accounts in one read, the quiet marks as a map, and the daily risk record ----
import type { DayRow, Risk } from "./clients-retention";


export async function historyRows(inst: string, ids: string[], days = 60): Promise<Map<string, DayRow[]>> {
  const out = new Map<string, DayRow[]>();
  if (ids.length === 0) return out;
  const rows = await sql()`select location_id, day, new_contacts_30d, open_value::float8 open_value, engagement_score from account_metrics_daily
    where installation_id = ${inst} and location_id = any(${ids}::text[]) and day >= current_date - ${days}::int order by location_id, day`;
  for (const r of rows) {
    const id = r.location_id as string;
    const list = out.get(id) ?? [];
    list.push({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), newContacts30d: Number(r.new_contacts_30d), openValue: Number(r.open_value), engagement: Number(r.engagement_score) });
    out.set(id, list);
  }
  return out;
}

/** What other screens (the needs-attention ranking) call to hide quieted marks: location id to the kinds quieted right now. */
export async function quietedMap(inst: string, ids: string[], now: number): Promise<Map<string, MuteKind[]>> {
  const m = new Map<string, MuteKind[]>();
  for (const r of (await activeMutes(inst, ids, now)).rows) m.set(r.locationId, [...(m.get(r.locationId) ?? []), r.kind]);
  return m;
}

/** One row per client per day; the second call on the same day changes nothing. A missing table is not an error. */
export async function recordRisk(inst: string, risks: Risk[]): Promise<void> {
  if (risks.length === 0) return;
  try {
    const db = sql();
    await db`insert into client_risk_history ${db(risks.map((r) => ({ installation_id: inst, location_id: r.locationId, day: new Date().toISOString().slice(0, 10), level: r.level, points: r.points, history_days: r.historyDays })))} on conflict do nothing`;
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
}
