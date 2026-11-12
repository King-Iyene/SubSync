import { sql } from "../db";
import { EMPTY_COUNTS, OUTCOME, type GapId, type OutcomeCounts } from "./outcomes";
import { isMissing } from "./store";

// Outcome counts per client account, from data SubSync already holds (lead_touches, touch_events, cached_appointments, cached_opportunities). Aggregates only: no query reads
// a table into the server. Every query filters by installation_id and by the accounts the caller may read, so one company can never see another's numbers.
// Definitions: docs/METRICS.md, "Workflows outcome gaps". A person is counted once per gap; dollars are the open deals of those people.

type Db = ReturnType<typeof sql>;
const GAP_KEYS: GapId[] = ["no_touch", "no_textback", "noshow_open", "no_reminder"];

/** The people behind one gap, as a CTE: (location_id, contact_id, at). The same text is used for the counts and for the "show the people" list, so a number always equals its rows. */
export function gapPeople(db: Db, gap: GapId, inst: string, ids: string[] | null, now: Date) {
  const scope = (col: string) => (ids ? db`and ${db(col)} = any(${ids}::text[])` : db``);
  const D = 86_400_000;
  if (gap === "no_touch") {
    return db`select distinct t.location_id, t.contact_id, t.lead_at at from lead_touches t
      where t.installation_id = ${inst} ${scope("t.location_id")} and t.touch_at is null
        and t.lead_at >= ${new Date(now.getTime() - OUTCOME.leadWindowDays * D)} and t.lead_at < ${new Date(now.getTime() - OUTCOME.graceMinutes * 60_000)}`;
  }
  if (gap === "no_textback") {
    return db`select m.location_id, m.contact_id, m.at from (
        select distinct on (e.location_id, e.contact_id) e.location_id, e.contact_id, e.at from touch_events e
        where e.installation_id = ${inst} ${scope("e.location_id")} and e.kind = 'missed_call' and e.at >= ${new Date(now.getTime() - OUTCOME.callWindowDays * D)}
          and e.at < ${new Date(now.getTime() - OUTCOME.textBackMinutes * 60_000)}
        order by e.location_id, e.contact_id, e.at desc) m
      where not exists (select 1 from touch_events o where o.installation_id = ${inst} and o.location_id = m.location_id and o.contact_id = m.contact_id
        and o.direction = 'outbound' and o.kind <> 'failed' and o.at > m.at and o.at <= m.at + ${db.unsafe(`interval '${OUTCOME.textBackMinutes} minutes'`)})`;
  }
  if (gap === "noshow_open") {
    return db`select a.location_id, a.contact_id, max(a.start_at) at from cached_appointments a
      where a.installation_id = ${inst} ${scope("a.location_id")} and lower(a.status) in ('noshow', 'no_show', 'no-show') and a.contact_id is not null
        and a.start_at >= ${new Date(now.getTime() - OUTCOME.noshowWindowDays * D)} and a.start_at < ${now}
        and not exists (select 1 from touch_events o where o.installation_id = a.installation_id and o.location_id = a.location_id and o.contact_id = a.contact_id and o.direction = 'outbound' and o.kind <> 'failed' and o.at > a.start_at)
        and not exists (select 1 from cached_appointments n where n.installation_id = a.installation_id and n.location_id = a.location_id and n.contact_id = a.contact_id and n.start_at > a.start_at and lower(coalesce(n.status, '')) not in ('cancelled', 'canceled', 'invalid'))
      group by a.location_id, a.contact_id`;
  }
  return db`select a.location_id, a.contact_id, min(a.start_at) at from cached_appointments a
    where a.installation_id = ${inst} ${scope("a.location_id")} and a.contact_id is not null and a.start_at > ${now} and a.start_at <= ${new Date(now.getTime() + OUTCOME.reminderHoursAhead * 3_600_000)}
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'invalid', 'noshow', 'no_show', 'showed', 'completed')
      and a.created_remote_at is not null and a.created_remote_at < ${new Date(now.getTime() - OUTCOME.bookedMinHours * 3_600_000)}
      and not exists (select 1 from touch_events o where o.installation_id = a.installation_id and o.location_id = a.location_id and o.contact_id = a.contact_id and o.direction = 'outbound' and o.kind <> 'failed' and o.at > a.created_remote_at)
    group by a.location_id, a.contact_id`;
}

/** The bases (everyone who could have fallen through) per account, then the per-gap people and open deal value. Four small aggregate queries. */
export async function outcomeCounts(inst: string, ids: string[] | null, now: Date): Promise<Map<string, OutcomeCounts> | null> {
  if (ids !== null && ids.length === 0) return new Map();
  const db = sql();
  const out = new Map<string, OutcomeCounts>();
  const get = (l: string): OutcomeCounts => { let c = out.get(l); if (!c) { c = { ...EMPTY_COUNTS, value: { ...EMPTY_COUNTS.value } }; out.set(l, c); } return c; };
  const D = 86_400_000;
  const scoped = (col: string) => (ids ? db`and ${db(col)} = any(${ids}::text[])` : db``);
  try {
    const [leads, calls, noshows, upcoming] = await Promise.all([
      db`select location_id, count(distinct contact_id)::int n from lead_touches where installation_id = ${inst} ${scoped("location_id")} and lead_at >= ${new Date(now.getTime() - OUTCOME.leadWindowDays * D)} group by 1`,
      db`select location_id, count(distinct contact_id)::int n from touch_events where installation_id = ${inst} ${scoped("location_id")} and kind = 'missed_call' and at >= ${new Date(now.getTime() - OUTCOME.callWindowDays * D)} group by 1`,
      db`select location_id, count(distinct contact_id)::int n from cached_appointments where installation_id = ${inst} ${scoped("location_id")} and lower(status) in ('noshow', 'no_show', 'no-show') and contact_id is not null and start_at >= ${new Date(now.getTime() - OUTCOME.noshowWindowDays * D)} and start_at < ${now} group by 1`,
      db`select location_id, count(distinct contact_id)::int n from cached_appointments where installation_id = ${inst} ${scoped("location_id")} and contact_id is not null and start_at > ${now} and start_at <= ${new Date(now.getTime() + OUTCOME.reminderHoursAhead * 3_600_000)} and lower(coalesce(status, '')) not in ('cancelled', 'canceled', 'invalid', 'noshow', 'no_show', 'showed', 'completed') group by 1`,
    ]);
    for (const r of leads) get(r.location_id as string).newLeads = r.n as number;
    for (const r of calls) get(r.location_id as string).missedCalls = r.n as number;
    for (const r of noshows) get(r.location_id as string).noshows = r.n as number;
    for (const r of upcoming) get(r.location_id as string).upcoming = r.n as number;

    // Per gap: how many people and the open deal value they hold (each opportunity counted once per person).
    const pick = { no_touch: "noTouch", no_textback: "noTextback", noshow_open: "noshowOpen", no_reminder: "noReminder" } as const;
    for (const g of GAP_KEYS) {
      const rows = await db`
        with p as (${gapPeople(db, g, inst, ids, now)}),
        v as (select location_id, contact_id, sum(monetary_value) val from cached_opportunities where installation_id = ${inst} ${scoped("location_id")} and status = 'open' and monetary_value > 0 and contact_id is not null group by 1, 2)
        select p.location_id, count(*)::int n, coalesce(sum(v.val), 0)::float8 dollars from p left join v on v.location_id = p.location_id and v.contact_id = p.contact_id group by 1`;
      for (const r of rows) { const c = get(r.location_id as string); c[pick[g]] = r.n as number; c.value[g] = Math.round(Number(r.dollars)); }
    }
    // The total: every affected person once, however many gaps they are in.
    const tot = await db`
      with p as (${gapPeople(db, "no_touch", inst, ids, now)} union ${gapPeople(db, "no_textback", inst, ids, now)} union ${gapPeople(db, "noshow_open", inst, ids, now)} union ${gapPeople(db, "no_reminder", inst, ids, now)}),
      d as (select distinct location_id, contact_id from p),
      v as (select location_id, contact_id, sum(monetary_value) val from cached_opportunities where installation_id = ${inst} ${scoped("location_id")} and status = 'open' and monetary_value > 0 and contact_id is not null group by 1, 2)
      select d.location_id, coalesce(sum(v.val), 0)::float8 dollars from d left join v on v.location_id = d.location_id and v.contact_id = d.contact_id group by 1`;
    for (const r of tot) get(r.location_id as string).atRiskValue = Math.round(Number(r.dollars));
    return out;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** The people behind one gap of one account, newest first, as one keyset page. The account id must already have passed ownedLocation. */
export async function gapPeoplePage(inst: string, locationId: string, gap: GapId, now: Date, after: { at: number; id: string } | null, size: number): Promise<{ total: number; rows: Array<{ contactId: string; at: number; name: string | null; phone: string | null; email: string | null; dollars: number }> }> {
  const db = sql();
  const ids = [locationId];
  const [t] = await db`with p as (${gapPeople(db, gap, inst, ids, now)}) select count(*)::int n from p`;
  const cur = after ? db`where (p.at, p.contact_id) < (${new Date(after.at)}, ${after.id})` : db``;
  const rows = await db`
    with p as (${gapPeople(db, gap, inst, ids, now)})
    select p.contact_id, p.at, c.full_name, c.phone, c.email,
      coalesce((select sum(o.monetary_value) from cached_opportunities o where o.installation_id = ${inst} and o.location_id = ${locationId} and o.contact_id = p.contact_id and o.status = 'open' and o.monetary_value > 0), 0)::float8 dollars
    from p left join cached_contacts c on c.installation_id = ${inst} and c.location_id = ${locationId} and c.contact_id = p.contact_id
    ${cur} order by p.at desc, p.contact_id desc limit ${size + 1}`;
  return { total: (t?.n as number | undefined) ?? 0, rows: rows.slice(0, size).map((r) => ({ contactId: r.contact_id as string, at: new Date(r.at as string).getTime(), name: (r.full_name as string | null)?.trim() || null, phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, dollars: Math.round(Number(r.dollars)) })) };
}

/** Our own daily record (the moat): one row per account per day, written again in place if the day is counted twice. */
export async function recordOutcomes(inst: string, rows: Array<{ locationId: string; counts: OutcomeCounts }>, day: string): Promise<void> {
  try {
    const db = sql();
    for (const r of rows) {
      const c = r.counts;
      await db`insert into wf_outcome_daily (installation_id, location_id, day, new_leads, no_touch, missed_calls, no_textback, noshows, noshow_open, upcoming, no_reminder, at_risk_value)
        values (${inst}, ${r.locationId}, ${day}, ${c.newLeads}, ${c.noTouch}, ${c.missedCalls}, ${c.noTextback}, ${c.noshows}, ${c.noshowOpen}, ${c.upcoming}, ${c.noReminder}, ${c.atRiskValue})
        on conflict (installation_id, location_id, day) do update set new_leads = excluded.new_leads, no_touch = excluded.no_touch, missed_calls = excluded.missed_calls, no_textback = excluded.no_textback,
          noshows = excluded.noshows, noshow_open = excluded.noshow_open, upcoming = excluded.upcoming, no_reminder = excluded.no_reminder, at_risk_value = excluded.at_risk_value`;
    }
  } catch (e) { if (!isMissing(e)) throw e; }
}

/** The last days of people-in-a-gap for the accounts allowed, summed per day (for the trend line). */
export async function loadOutcomeTrend(inst: string, ids: string[] | null, days = 30): Promise<Array<{ day: string; people: number; value: number }>> {
  if (ids !== null && ids.length === 0) return [];
  try {
    const db = sql();
    const rows = await db`select day::text d, sum(no_touch + no_textback + noshow_open + no_reminder)::int people, sum(at_risk_value)::float8 value from wf_outcome_daily
      where installation_id = ${inst} ${ids ? db`and location_id = any(${ids}::text[])` : db``} and day >= current_date - ${days}::int group by day order by day`;
    return rows.map((r) => ({ day: r.d as string, people: r.people as number, value: Math.round(Number(r.value)) }));
  } catch (e) { if (isMissing(e)) return []; throw e; }
}
