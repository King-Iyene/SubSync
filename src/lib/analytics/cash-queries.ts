import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { accountsCore, accountsIn, type Filters } from "./clients3-queries";
import { loadHideSettings, notHidden } from "./unanswered-actions-queries";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import type { Scope } from "./today3-queries";
import {
  DAY, DEFAULT_LIMIT_DAYS, FORMULA, KIND_WORDS, LOST_DAYS, MIN_DEALS_AT_RISK, MIN_LEADS, MIN_WON, MISSED_CALL_DAYS, money, NOSHOW_DAYS, parseCursor, makeCursor, rankSave, slaSlip, SOON_DAYS,
  UNANSWERED_DAYS, UNANSWERED_MIN_AGE_HOURS, RECOVER_KINDS, type RecoverKind, type SaveInput,
} from "./cash-intel";
import type { CfDealRow, CfDealsList, CfDealsSummary, CfRecoverList, CfRecoverRow, CfRecoverSummary, CfSave, CfSettings } from "./cash-types";

// The database side of the cash features. Read only except the two sweeps (sweepRecover, sweepDeals: SubSync's own tables) and SubSync's own notes (snooze, mute, settings).
// EVERY read starts from `accountsIn`: the accounts of the caller's own installation, inside the caller's `allowed` set (one account may narrow it, never widen it). Ids that arrive in
// a request are checked by the route (ownedLocation) first and never echoed. Every query also filters by installation_id.

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const cashCache = ttlCache<object>(45_000, 100);
export const forgetCash = (inst: string) => cashCache.clear(JSON.stringify([inst]).slice(0, -1));

// ------------------------------------------------------------------ sweeps

const FRESH_MS = 20 * 60_000;
/** Claims a sweep: true for exactly one caller when the last one is older than maxAgeMs. */
async function claim(inst: string, col: "recover_at" | "deals_at", maxAgeMs: number): Promise<boolean> {
  const db = sql();
  const secs = Math.max(1, Math.round(maxAgeMs / 1000));
  const r = col === "recover_at"
    ? await db`insert into cf_state (installation_id, recover_at) values (${inst}, now()) on conflict (installation_id) do update set recover_at = now() where cf_state.recover_at is null or cf_state.recover_at < now() - make_interval(secs => ${secs}) returning 1`
    : await db`insert into cf_state (installation_id, deals_at) values (${inst}, now()) on conflict (installation_id) do update set deals_at = now() where cf_state.deals_at is null or cf_state.deals_at < now() - make_interval(secs => ${secs}) returning 1`;
  return r.length > 0;
}

/** Adds the open missed leads, keeps their estimate, and closes a row when the proof shows it was handled. Idempotent: the same data twice changes nothing. Returns rows now open. */
export async function sweepRecover(inst: string, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force && !(await claim(inst, "recover_at", FRESH_MS))) return -1;
  if (opts.force) await sql()`insert into cf_state (installation_id, recover_at) values (${inst}, now()) on conflict (installation_id) do update set recover_at = now()`;
  const db = sql();
  const hide = await loadHideSettings(inst);
  const [{ t }] = (await db`select now() as t`) as unknown as Array<{ t: Date }>;
  await db`
    with av as (
      select location_id, case when sum(won) >= ${MIN_WON} and sum(new_leads) >= ${MIN_LEADS} and sum(won_value) > 0 then sum(won_value)::float8 / sum(new_leads) end ev
      from client_daily where installation_id = ${inst} and day >= (${t}::timestamptz)::date - 180 group by location_id),
    deal as (
      select o.location_id, o.contact_id, sum(o.monetary_value)::float8 v from cached_opportunities o
      where o.installation_id = ${inst} and o.status = 'open' and o.monetary_value > 0 and o.contact_id is not null group by 1, 2),
    cand as (
      select c.location_id, 'unanswered'::text kind, c.contact_id, c.conversation_id || ':' || floor(extract(epoch from c.last_message_at))::bigint::text ref_id,
        coalesce(nullif(btrim(ct.full_name), ''), nullif(btrim(c.contact_name), ''), 'Unknown contact') name, coalesce(nullif(ct.assigned_to, ''), nullif(c.assigned_to, '')) owner_id, c.last_message_at since_at
      from cached_conversations c
      join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
      left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
      where c.installation_id = ${inst} and c.contact_id is not null and c.last_message_direction = 'inbound'
        and c.last_message_at > ${t}::timestamptz - make_interval(days => ${UNANSWERED_DAYS}) and c.last_message_at < ${t}::timestamptz - make_interval(hours => ${UNANSWERED_MIN_AGE_HOURS})
        ${notHidden(db, hide)}
      union all
      select m.location_id, 'missed_call', m.contact_id, m.event_key, coalesce(nullif(btrim(ct.full_name), ''), 'Unknown contact'), nullif(ct.assigned_to, ''), m.at
      from (select distinct on (t2.location_id, t2.contact_id) t2.location_id, t2.contact_id, t2.event_key, t2.at from touch_events t2
            where t2.installation_id = ${inst} and t2.kind = 'missed_call' and t2.at > ${t}::timestamptz - make_interval(days => ${MISSED_CALL_DAYS}) and t2.at < ${t}::timestamptz - make_interval(hours => ${UNANSWERED_MIN_AGE_HOURS})
            order by t2.location_id, t2.contact_id, t2.at desc) m
      join locations l on l.installation_id = ${inst} and l.location_id = m.location_id and not l.ignored
      left join cached_contacts ct on ct.installation_id = ${inst} and ct.location_id = m.location_id and ct.contact_id = m.contact_id
      where not exists (select 1 from touch_events o where o.installation_id = ${inst} and o.location_id = m.location_id and o.contact_id = m.contact_id and o.direction = 'outbound' and not o.automated and o.kind in ('message', 'call') and o.at > m.at)
      union all
      select a.location_id, 'no_show', a.contact_id, a.appointment_id, coalesce(nullif(btrim(ct.full_name), ''), 'Unknown contact'), coalesce(nullif(ct.assigned_to, ''), a.assigned_to), a.start_at
      from cached_appointments a
      join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
      left join cached_contacts ct on ct.installation_id = a.installation_id and ct.location_id = a.location_id and ct.contact_id = a.contact_id
      where a.installation_id = ${inst} and a.status = 'noshow' and a.contact_id is not null and a.start_at > ${t}::timestamptz - make_interval(days => ${NOSHOW_DAYS}) and a.start_at < ${t}::timestamptz - make_interval(hours => ${UNANSWERED_MIN_AGE_HOURS})
        and not exists (select 1 from cached_appointments b where b.installation_id = a.installation_id and b.location_id = a.location_id and b.contact_id = a.contact_id and b.start_at > a.start_at and b.status not in ('cancelled', 'invalid', 'noshow'))
    )
    insert into cf_recover_items (installation_id, location_id, kind, contact_id, ref_id, contact_name, owner_id, est_value, value_basis, since_at, first_seen_at, last_seen_at)
    select ${inst}::uuid, x.location_id, x.kind, x.contact_id, x.ref_id, x.name, x.owner_id, coalesce(d.v, av.ev), case when d.v is not null then 'deal' when av.ev is not null then 'average' end, x.since_at, ${t}::timestamptz, ${t}::timestamptz
    from cand x left join deal d on d.location_id = x.location_id and d.contact_id = x.contact_id left join av on av.location_id = x.location_id
    on conflict (installation_id, location_id, kind, contact_id, ref_id) do update
      set last_seen_at = ${t}, est_value = excluded.est_value, value_basis = excluded.value_basis, owner_id = excluded.owner_id, contact_name = excluded.contact_name
      where cf_recover_items.recovered_at is null`;
  // Anything not seen this time is closed, and counted as recovered only when the record proves it (an outbound touch by a person, or a later booking). Otherwise it is "dropped" (not counted).
  await db`
    update cf_recover_items i set recovered_at = ${t},
      recovered_how = case
        when i.kind = 'unanswered' and exists (select 1 from touch_events o where o.installation_id = i.installation_id and o.location_id = i.location_id and o.contact_id = i.contact_id and o.direction = 'outbound' and not o.automated and o.kind in ('message', 'call') and o.at > i.since_at) then 'replied'
        when i.kind = 'missed_call' and exists (select 1 from touch_events o where o.installation_id = i.installation_id and o.location_id = i.location_id and o.contact_id = i.contact_id and o.direction = 'outbound' and not o.automated and o.kind in ('message', 'call') and o.at > i.since_at) then 'called_back'
        when i.kind = 'no_show' and exists (select 1 from cached_appointments b where b.installation_id = i.installation_id and b.location_id = i.location_id and b.contact_id = i.contact_id and b.start_at > i.since_at and b.status not in ('cancelled', 'invalid', 'noshow')) then 'rebooked'
        else 'dropped' end
    where i.installation_id = ${inst} and i.recovered_at is null and i.last_seen_at < ${t}`;
  await db`insert into cf_state (installation_id, history_starts) values (${inst}, ${t}::timestamptz::date) on conflict (installation_id) do update set history_starts = coalesce(cf_state.history_starts, excluded.history_starts)`;
  const open = await db`select count(*)::int c from cf_recover_items where installation_id = ${inst} and recovered_at is null`;
  forgetCash(inst);
  return num(open[0]?.c);
}

/** Flags deals going stale for their stage (our own stage history sets each stage's limit), deals about to, and deals lost in the last two weeks. Resolves what moved on. Idempotent. */
export async function sweepDeals(inst: string, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force && !(await claim(inst, "deals_at", FRESH_MS))) return -1;
  if (opts.force) await sql()`insert into cf_state (installation_id, deals_at) values (${inst}, now()) on conflict (installation_id) do update set deals_at = now()`;
  const db = sql();
  const [{ t }] = (await db`select now() as t`) as unknown as Array<{ t: Date }>;
  // Stale and soon. A deal that has just turned stale closes its "soon" row first (escalated, never counted as saved).
  await db`
    with cand as (
      select o.location_id, o.opportunity_id, o.contact_id, coalesce(nullif(btrim(o.contact_name), ''), o.name) contact_name, o.name deal_name, o.stage_id, o.stage_name, o.monetary_value::float8 value, o.assigned_to owner_id,
        extract(epoch from (${t}::timestamptz - coalesce(o.last_stage_change_at, o.created_remote_at))) / 86400 dis,
        coalesce(s.limit_days, ${DEFAULT_LIMIT_DAYS})::float8 lim, coalesce(s.is_estimate, true) est
      from cached_opportunities o ${dealScopeJoins()}
      left join deal_stage_stats s on s.installation_id = o.installation_id and s.location_id = o.location_id and s.stage_id = o.stage_id
      where o.installation_id = ${inst} and o.status = 'open' and ${countedInScope()} and coalesce(o.last_stage_change_at, o.created_remote_at) is not null
        and extract(epoch from (${t}::timestamptz - coalesce(o.last_stage_change_at, o.created_remote_at))) / 86400 + ${SOON_DAYS} > coalesce(s.limit_days, ${DEFAULT_LIMIT_DAYS})
    ), esc as (
      update cf_deal_flags f set resolved_at = ${t}, resolved_how = 'escalated'
      from cand c where f.installation_id = ${inst} and f.location_id = c.location_id and f.opportunity_id = c.opportunity_id and f.kind = 'soon' and f.resolved_at is null and c.dis > c.lim returning 1
    )
    insert into cf_deal_flags (installation_id, location_id, opportunity_id, kind, contact_id, contact_name, deal_name, stage_id, stage_name, value, days_in_stage, limit_days, limit_is_estimate, owner_id, first_flagged_at, last_seen_at)
    select ${inst}::uuid, c.location_id, c.opportunity_id, case when c.dis > c.lim then 'stale' else 'soon' end, c.contact_id, c.contact_name, c.deal_name, c.stage_id, c.stage_name, c.value, c.dis, c.lim, c.est, c.owner_id, ${t}::timestamptz, ${t}::timestamptz
    from cand c
    on conflict (installation_id, location_id, opportunity_id, kind) do update set
      contact_name = excluded.contact_name, deal_name = excluded.deal_name, stage_id = excluded.stage_id, stage_name = excluded.stage_name, value = excluded.value, days_in_stage = excluded.days_in_stage,
      limit_days = excluded.limit_days, limit_is_estimate = excluded.limit_is_estimate, owner_id = excluded.owner_id, last_seen_at = ${t},
      first_flagged_at = case when cf_deal_flags.resolved_at is not null then ${t} else cf_deal_flags.first_flagged_at end,
      resolved_at = null, resolved_how = null`;
  // Lost in the last two weeks. The reason is shown only when the CRM recorded one; we never guess.
  await db`
    insert into cf_deal_flags (installation_id, location_id, opportunity_id, kind, contact_id, contact_name, deal_name, stage_id, stage_name, value, lost_reason, owner_id, first_flagged_at, last_seen_at)
    select ${inst}::uuid, o.location_id, o.opportunity_id, 'lost', o.contact_id, coalesce(nullif(btrim(o.contact_name), ''), o.name), o.name, o.stage_id, o.stage_name, o.monetary_value::float8,
      coalesce(nullif(btrim(f.lost_reason), ''), case when f.lost_reason_id is not null then 'A reason is recorded in your CRM' end), o.assigned_to, coalesce(o.last_status_change_at, ${t}::timestamptz), ${t}::timestamptz
    from cached_opportunities o ${dealScopeJoins()}
    left join deal_facts f on f.installation_id = o.installation_id and f.location_id = o.location_id and f.opportunity_id = o.opportunity_id
    where o.installation_id = ${inst} and o.status = 'lost' and ${countedInScope()} and o.last_status_change_at > ${t}::timestamptz - make_interval(days => ${LOST_DAYS})
    on conflict (installation_id, location_id, opportunity_id, kind) do update set value = excluded.value, lost_reason = excluded.lost_reason, owner_id = excluded.owner_id, last_seen_at = ${t}
      where cf_deal_flags.resolved_at is null`;
  // What moved on: a stale or soon deal no longer in the list. Moved only when its stage really changed after we flagged it.
  await db`
    update cf_deal_flags f set resolved_at = ${t},
      resolved_how = coalesce((select case when o.status = 'won' then 'won' when o.status = 'lost' then 'lost' when o.status = 'open' and o.last_stage_change_at > f.first_flagged_at then 'moved' else 'closed' end
        from cached_opportunities o where o.installation_id = f.installation_id and o.location_id = f.location_id and o.opportunity_id = f.opportunity_id), 'closed')
    where f.installation_id = ${inst} and f.resolved_at is null and f.kind in ('stale', 'soon') and f.last_seen_at < ${t}`;
  await db`update cf_deal_flags set resolved_at = ${t}, resolved_how = 'closed' where installation_id = ${inst} and resolved_at is null and kind = 'lost' and first_flagged_at < ${t}::timestamptz - make_interval(days => ${LOST_DAYS})`;
  await db`insert into cf_state (installation_id, history_starts) values (${inst}, ${t}::timestamptz::date) on conflict (installation_id) do update set history_starts = coalesce(cf_state.history_starts, excluded.history_starts)`;
  const open = await db`select count(*)::int c from cf_deal_flags where installation_id = ${inst} and resolved_at is null`;
  forgetCash(inst);
  return num(open[0]?.c);
}

// ------------------------------------------------------------------ scope

type Ctx = { inst: string; ids: string[]; level: Scope["level"]; selfId: string | null };
async function ctxOf(s: Scope, one: string | null): Promise<Ctx> {
  const accts = await accountsIn({ inst: s.inst, allowed: s.allowed }, { location: one });
  return { inst: s.inst, ids: accts.map((a) => a.id), level: s.level, selfId: s.selfId };
}
async function historyStarts(inst: string): Promise<string | null> {
  try { const r = await sql()`select history_starts::text d from cf_state where installation_id = ${inst}`; return (r[0]?.d as string | null) ?? null; } catch { return null; }
}

// ------------------------------------------------------------------ recover

const ownerWhere = (c: Ctx) => (c.level === "self" ? sql()`and i.owner_id = ${c.selfId ?? "none"}` : sql()``);
const openWhere = (c: Ctx) => sql()`i.installation_id = ${c.inst} and i.location_id = any(${c.ids}::text[]) and i.recovered_at is null ${ownerWhere(c)}`;
const notSnoozed = () => sql()`(i.snoozed_until is null or i.snoozed_until <= now())`;

export async function recoverSummary(s: Scope, one: string | null, now = Date.now(), days = 7): Promise<CfRecoverSummary> {
  const c = await ctxOf(s, one);
  const empty: CfRecoverSummary = { counts: { unanswered: 0, missed_call: 0, no_show: 0 }, total: 0, snoozed: 0, estValue: null, valued: 0, formula: FORMULA, recovered: { count: 0, value: null, days }, historyStarts: null, headline: "Nothing to recover right now." };
  if (!c.ids.length) return empty;
  const db = sql();
  await sweepRecover(s.inst).catch(() => -1);
  const [open, snz, rec, hist] = await Promise.all([
    db`select i.kind, count(*)::int n, count(*) filter (where i.est_value > 0)::int valued, sum(i.est_value)::float8 v from cf_recover_items i where ${openWhere(c)} and ${notSnoozed()} group by i.kind`,
    db`select count(*)::int n from cf_recover_items i where ${openWhere(c)} and i.snoozed_until > now()`,
    db`select count(*)::int n, sum(i.est_value)::float8 v, count(*) filter (where i.est_value > 0)::int valued from cf_recover_items i
       where i.installation_id = ${c.inst} and i.location_id = any(${c.ids}::text[]) ${ownerWhere(c)} and i.recovered_how in ('replied', 'called_back', 'rebooked') and i.recovered_at > ${new Date(now - days * DAY)}`,
    historyStarts(s.inst),
  ]);
  const counts = { ...empty.counts };
  let valued = 0, v = 0;
  for (const r of open) { counts[r.kind as RecoverKind] = num(r.n); valued += num(r.valued); v += num(r.v); }
  const total = counts.unanswered + counts.missed_call + counts.no_show;
  const estValue = valued > 0 ? v : null;
  const recovered = { count: num(rec[0]?.n), value: num(rec[0]?.valued) > 0 ? num(rec[0]?.v) : null, days };
  const headline = total === 0 ? "Nothing to recover right now." : `${total.toLocaleString("en-US")} ${total === 1 ? "person is" : "people are"} waiting to be won back${estValue !== null ? `, worth about ${money(estValue)} (estimate)` : ""}.`;
  return { counts, total, snoozed: num(snz[0]?.n), estValue, valued, formula: FORMULA, recovered, historyStarts: hist, headline };
}

type Links = { account: (loc: string) => string; contact: (loc: string, contact: string) => string };
export async function recoverList(s: Scope, one: string | null, o: { kind: RecoverKind | "all"; cursor: string | null; size: number; snoozed: boolean }, links: Links, now = Date.now()): Promise<CfRecoverList> {
  const c = await ctxOf(s, one);
  const size = Math.min(100, Math.max(5, o.size));
  const empty: CfRecoverList = { rows: [], total: 0, next: null, size, kind: o.kind, snoozedView: o.snoozed };
  if (!c.ids.length) return empty;
  const db = sql();
  await sweepRecover(s.inst).catch(() => -1);
  const kindW = o.kind === "all" ? db`` : db`and i.kind = ${o.kind}`;
  const snoozeW = o.snoozed ? db`and i.snoozed_until > now()` : db`and ${notSnoozed()}`;
  const base = db`from cf_recover_items i where ${openWhere(c)} ${kindW} ${snoozeW}`;
  const cur = parseCursor(o.cursor);
  const rows = await db`
    select * from (
      select i.location_id, i.kind, i.contact_id, i.ref_id, i.contact_name, i.owner_id, i.est_value::float8 est, i.value_basis, i.since_at, i.snoozed_until,
        coalesce(i.est_value, 0)::float8 v, (i.location_id || '~' || i.kind || '~' || i.contact_id || '~' || i.ref_id) k,
        (select l.name from locations l where l.installation_id = i.installation_id and l.location_id = i.location_id) account_name,
        (select tn.name from team_names tn where tn.installation_id = i.installation_id and tn.user_id = i.owner_id limit 1) owner_name
      ${base}
    ) x ${cur ? db`where (x.v, x.k) < (${cur.v}, ${cur.id})` : db``}
    order by x.v desc, x.k desc limit ${size + 1}`;
  const total = num((await db`select count(*)::int n ${base}`)[0]?.n);
  const page = rows.slice(0, size);
  const out: CfRecoverRow[] = page.map((r) => {
    const kind = r.kind as RecoverKind, since = r.since_at as Date;
    const hrs = Math.max(0, Math.round((now - since.getTime()) / 3_600_000));
    const detail = kind === "unanswered" ? `Wrote ${hrs < 48 ? `${hrs} hours` : `${Math.round(hrs / 24)} days`} ago, no reply` : kind === "missed_call" ? `Called ${hrs < 48 ? `${hrs} hours` : `${Math.round(hrs / 24)} days`} ago, not returned` : `Did not come ${hrs < 48 ? `${hrs} hours` : `${Math.round(hrs / 24)} days`} ago, not booked again`;
    return {
      key: r.k as string, locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? "Client account", contactId: r.contact_id as string, name: (r.contact_name as string | null) ?? "Unknown contact", kind, kindLabel: KIND_WORDS[kind].label, detail,
      since: iso(since) as string, waitingHours: hrs, estValue: numOrNull(r.est) && num(r.est) > 0 ? num(r.est) : null, valueBasis: (r.value_basis as "deal" | "average" | null) ?? null, ownerId: (r.owner_id as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null, snoozedUntil: iso(r.snoozed_until), url: links.contact(r.location_id as string, r.contact_id as string),
    };
  });
  const last = page[page.length - 1];
  return { rows: out, total, next: rows.length > size && last ? makeCursor(num(last.v), last.k as string) : null, size, kind: o.kind, snoozedView: o.snoozed };
}

/** The rows the caller named (by key), only those that are open in accounts they may read (and, for a team member, theirs). Anything else is simply not returned. */
export async function recoverRowsByKey(s: Scope, keys: readonly string[]): Promise<Array<{ locationId: string; kind: RecoverKind; contactId: string; refId: string; name: string; ownerId: string | null }>> {
  const parsed = keys.slice(0, 200).map((k) => k.split("~")).filter((p) => p.length >= 4 && p[0] && ID.test(p[0]) && (RECOVER_KINDS as string[]).includes(p[1]) && ID.test(p[2]));
  if (!parsed.length) return [];
  const c = await ctxOf(s, null);
  if (!c.ids.length) return [];
  const want = new Set(parsed.map((p) => `${p[0]}~${p[1]}~${p[2]}~${p.slice(3).join("~")}`));
  const rows = await sql()`
    select i.location_id, i.kind, i.contact_id, i.ref_id, i.contact_name, i.owner_id from cf_recover_items i
    where ${openWhere(c)} and (i.location_id || '~' || i.kind || '~' || i.contact_id || '~' || i.ref_id) = any(${[...want]}::text[])`;
  return rows.map((r) => ({ locationId: r.location_id as string, kind: r.kind as RecoverKind, contactId: r.contact_id as string, refId: r.ref_id as string, name: (r.contact_name as string | null) ?? "This person", ownerId: (r.owner_id as string | null) ?? null }));
}

/** Sets rows aside (until a time) or brings them back. SubSync only. Returns how many rows changed. */
export async function snoozeRows(s: Scope, keys: readonly string[], until: Date | null, by: string | null): Promise<number> {
  const rows = await recoverRowsByKey(s, keys);
  if (!rows.length) return 0;
  const db = sql();
  let n = 0;
  for (const r of rows) {
    const x = await db`update cf_recover_items set snoozed_until = ${until}, snoozed_by = ${until ? by : null}
      where installation_id = ${s.inst} and location_id = ${r.locationId} and kind = ${r.kind} and contact_id = ${r.contactId} and ref_id = ${r.refId} and recovered_at is null returning 1`;
    n += x.length;
  }
  forgetCash(s.inst);
  return n;
}

/** After a real owner change through the gateway, the row's owner follows (SubSync's copy), so the list does not show the old owner. */
export async function setRowOwner(inst: string, locationId: string, contactIds: readonly string[], ownerId: string): Promise<void> {
  if (!contactIds.length) return;
  await sql()`update cf_recover_items set owner_id = ${ownerId} where installation_id = ${inst} and location_id = ${locationId} and contact_id = any(${[...contactIds]}::text[]) and recovered_at is null`;
  forgetCash(inst);
}

// ------------------------------------------------------------------ deals

const DEAL_FORMULA = "A deal is stale when it has sat in its stage longer than that stage's usual time, worked out from this account's own stage history (30 days where there is not enough history yet, marked assumed). A deal is about to go quiet when it will pass that time within 7 days. Only open deals with a value and an owner are counted, so test and junk deals stay out. Dollars are the deals' own values (estimate of money at risk, not of money lost).";

export async function dealsSummary(s: Scope, one: string | null, now = Date.now(), days = 30): Promise<CfDealsSummary> {
  const c = await ctxOf(s, one);
  const none = { count: 0, value: null as number | null, valued: 0 };
  const empty: CfDealsSummary = { stale: none, soon: none, lost: { count: 0, value: null, noReason: 0, days: LOST_DAYS }, moved: { count: 0, value: null, days }, formula: DEAL_FORMULA, historyStarts: null, headline: "No deals are slipping right now." };
  if (!c.ids.length) return empty;
  const db = sql();
  await sweepDeals(s.inst).catch(() => -1);
  const own = c.level === "self" ? db`and f.owner_id = ${c.selfId ?? "none"}` : db``;
  const [rows, mv, hist] = await Promise.all([
    db`select f.kind, count(*)::int n, count(*) filter (where f.value > 0)::int valued, sum(f.value)::float8 v, count(*) filter (where f.kind = 'lost' and f.lost_reason is null)::int no_reason
       from cf_deal_flags f where f.installation_id = ${c.inst} and f.location_id = any(${c.ids}::text[]) and f.resolved_at is null ${own} group by f.kind`,
    db`select count(*)::int n, sum(f.value)::float8 v, count(*) filter (where f.value > 0)::int valued from cf_deal_flags f
       where f.installation_id = ${c.inst} and f.location_id = any(${c.ids}::text[]) ${own} and f.kind in ('stale', 'soon') and f.resolved_how in ('moved', 'won') and f.resolved_at > ${new Date(now - days * DAY)}`,
    historyStarts(s.inst),
  ]);
  const pick = (k: string) => rows.find((r) => r.kind === k);
  const sum = (k: string) => { const r = pick(k); return { count: num(r?.n), value: num(r?.valued) >= MIN_DEALS_AT_RISK ? num(r?.v) : null, valued: num(r?.valued) }; };
  const lostR = pick("lost");
  const stale = sum("stale"), soon = sum("soon");
  const lost = { count: num(lostR?.n), value: num(lostR?.valued) >= MIN_DEALS_AT_RISK ? num(lostR?.v) : null, noReason: num(lostR?.no_reason), days: LOST_DAYS };
  const moved = { count: num(mv[0]?.n), value: num(mv[0]?.valued) >= MIN_DEALS_AT_RISK ? num(mv[0]?.v) : null, days };
  const slipping = stale.count + soon.count;
  const atRisk = stale.value !== null || soon.value !== null ? (stale.value ?? 0) + (soon.value ?? 0) : null;
  const headline = slipping === 0 ? "No deals are slipping right now." : `${slipping} ${slipping === 1 ? "deal is" : "deals are"} slipping${atRisk !== null ? `, about ${money(atRisk)} at risk (estimate)` : ""}.`;
  return { stale, soon, lost, moved, formula: DEAL_FORMULA, historyStarts: hist, headline };
}

export async function dealsList(s: Scope, one: string | null, o: { kind: "slipping" | "stale" | "soon" | "lost"; cursor: string | null; size: number }, links: Links): Promise<CfDealsList> {
  const c = await ctxOf(s, one);
  const size = Math.min(100, Math.max(5, o.size));
  const empty: CfDealsList = { rows: [], total: 0, next: null, size, kind: o.kind };
  if (!c.ids.length) return empty;
  const db = sql();
  await sweepDeals(s.inst).catch(() => -1);
  const kinds = o.kind === "slipping" ? ["stale", "soon"] : [o.kind];
  const own = c.level === "self" ? db`and f.owner_id = ${c.selfId ?? "none"}` : db``;
  const base = db`from cf_deal_flags f where f.installation_id = ${c.inst} and f.location_id = any(${c.ids}::text[]) and f.resolved_at is null and f.kind = any(${kinds}::text[]) ${own}`;
  const cur = parseCursor(o.cursor);
  const rows = await db`
    select * from (
      select f.location_id, f.opportunity_id, f.kind, f.contact_id, f.contact_name, f.deal_name, f.stage_name, f.value::float8 v, f.days_in_stage::float8 dis, f.limit_days::float8 lim, f.limit_is_estimate, f.lost_reason, f.owner_id, f.first_flagged_at,
        (f.location_id || '~' || f.opportunity_id || '~' || f.kind) k,
        (select l.name from locations l where l.installation_id = f.installation_id and l.location_id = f.location_id) account_name
      ${base}
    ) x ${cur ? db`where (x.v, x.k) < (${cur.v}, ${cur.id})` : db``}
    order by x.v desc, x.k desc limit ${size + 1}`;
  const total = num((await db`select count(*)::int n ${base}`)[0]?.n);
  const page = rows.slice(0, size);
  const out: CfDealRow[] = page.map((r) => {
    const kind = r.kind as "stale" | "soon" | "lost", dis = numOrNull(r.dis), lim = numOrNull(r.lim);
    const why = kind === "lost" ? (r.lost_reason ? `Lost. Reason in your CRM: ${r.lost_reason}` : "Lost. No reason is recorded in your CRM.")
      : kind === "stale" ? `In ${r.stage_name ?? "this stage"} ${Math.floor(dis ?? 0)} days, the usual time is ${Math.round(lim ?? 0)}${r.limit_is_estimate ? " (assumed)" : ""}`
      : `In ${r.stage_name ?? "this stage"} ${Math.floor(dis ?? 0)} days, goes past the usual ${Math.round(lim ?? 0)}${r.limit_is_estimate ? " (assumed)" : ""} within a week`;
    return {
      key: r.k as string, locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? "Client account", opportunityId: r.opportunity_id as string, contactId: (r.contact_id as string | null) ?? null,
      name: ((r.contact_name as string | null) ?? "").trim() || "Unnamed contact", dealName: (r.deal_name as string | null) ?? null, kind, stageName: (r.stage_name as string | null) ?? null, value: num(r.v), daysInStage: dis, limitDays: lim,
      limitIsEstimate: r.limit_is_estimate === true, lostReason: (r.lost_reason as string | null) ?? null, ownerId: (r.owner_id as string | null) ?? null, flaggedAt: iso(r.first_flagged_at) as string,
      url: r.contact_id ? links.contact(r.location_id as string, r.contact_id as string) : links.account(r.location_id as string), why,
    };
  });
  const last = page[page.length - 1];
  return { rows: out, total, next: rows.length > size && last ? makeCursor(num(last.v), last.k as string) : null, size, kind: o.kind };
}

// ------------------------------------------------------------------ save this account

const saveCache = cashCache;
function window7(now: number): Filters {
  const to = new Date(Math.floor(now / DAY) * DAY + DAY);
  return { from: new Date(to.getTime() - 7 * DAY), to, location: null, q: null, industry: null, level: null };
}

/** The accounts most at risk today: the Clients numbers, reply speed this week against last, and the dollars behind the recovery and deals lists. Account-level (owner and manager). */
export async function saveBoard(s: Scope, now = Date.now()): Promise<CfSave> {
  const key = JSON.stringify([s.inst, s.allowed, "save", Math.floor(now / 60_000)]);
  const hit = saveCache.get(key) as CfSave | undefined;
  if (hit) return hit;
  const db = sql();
  const cores = await accountsCore({ inst: s.inst, allowed: s.allowed }, window7(now), now);
  const ids = cores.map((x) => x.locationId);
  const empty: CfSave = { accounts: [], more: 0, checked: 0, muted: [], formula: FORMULA, historyStarts: null, headline: "No client accounts yet." };
  if (!ids.length) return empty;
  await Promise.all([sweepRecover(s.inst).catch(() => -1), sweepDeals(s.inst).catch(() => -1)]);
  const wk = new Date(now - 7 * DAY).toISOString().slice(0, 10), wk2 = new Date(now - 14 * DAY).toISOString().slice(0, 10);
  const [speed, rec, deals, mutes, hist] = await Promise.all([
    db`select location_id, coalesce(sum(answered) filter (where day >= ${wk}::date), 0)::int ca, coalesce(sum(within_target) filter (where day >= ${wk}::date), 0)::int cw,
         coalesce(sum(answered) filter (where day < ${wk}::date), 0)::int pa, coalesce(sum(within_target) filter (where day < ${wk}::date), 0)::int pw
       from speed_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${wk2}::date group by location_id`,
    db`select location_id, count(*)::int n, count(*) filter (where est_value > 0)::int valued, sum(est_value)::float8 v from cf_recover_items i
       where i.installation_id = ${s.inst} and i.location_id = any(${ids}::text[]) and i.recovered_at is null and ${notSnoozed()} group by location_id`,
    db`select location_id, count(*)::int n, count(*) filter (where value > 0)::int valued, sum(value)::float8 v from cf_deal_flags
       where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and resolved_at is null and kind in ('stale', 'soon') group by location_id`,
    db`select id, location_id, until_at from cf_mutes where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and released_at is null and until_at > now()`,
    historyStarts(s.inst),
  ]);
  const by = (rows: Array<Record<string, unknown>>) => new Map(rows.map((r) => [r.location_id as string, r]));
  const sp = by(speed), rc = by(rec), dl = by(deals), mt = by(mutes);
  const inputs: SaveInput[] = cores.map((x) => {
    const q = sp.get(x.locationId), r = rc.get(x.locationId), d = dl.get(x.locationId);
    return {
      locationId: x.locationId, name: x.name, waiting: x.waiting, waitingOld: x.waitingOld, unmarked: x.unmarked, noshows: x.noshows, staleDeals: x.staleDealsPct.n, openDeals: x.staleDealsPct.of,
      newLeads: { current: x.newLeads.current, previous: x.newLeads.previous, enough: x.newLeads.enough }, staffMessages: { current: x.staffMessages.current, previous: x.staffMessages.previous, enough: x.staffMessages.enough },
      needsPermission: x.needsPermission.length > 0, syncOld: x.syncOld,
      sla: slaSlip({ answered: num(q?.ca), within: num(q?.cw) }, { answered: num(q?.pa), within: num(q?.pw) }),
      recoverValue: num(r?.valued) > 0 ? num(r?.v) : null, recoverCount: num(r?.n),
      dealsValue: num(d?.valued) >= MIN_DEALS_AT_RISK ? num(d?.v) : null, dealCount: num(d?.n),
      muted: mt.has(x.locationId),
    };
  });
  const ranked = rankSave(inputs);
  const nameOf = new Map(cores.map((x) => [x.locationId, x.name]));
  const muted = mutes.map((m) => ({ id: m.id as string, locationId: m.location_id as string, name: nameOf.get(m.location_id as string) ?? "Client account", until: iso(m.until_at) as string }));
  const k = ranked.accounts.length + ranked.more;
  const out: CfSave = { ...ranked, muted, formula: FORMULA, historyStarts: hist, headline: k === 0 ? "No client account looks at risk this morning." : `${k} client ${k === 1 ? "account looks" : "accounts look"} at risk today.` };
  saveCache.set(key, out);
  return out;
}

export async function muteAccount(inst: string, allowed: string[] | null, locationId: string, days: number, by: string | null): Promise<string | null> {
  const accts = await accountsIn({ inst, allowed }, { location: locationId });
  if (!accts.length) return null;
  const d = Math.min(90, Math.max(1, Math.floor(days) || 7));
  const db = sql();
  await db`update cf_mutes set released_at = now() where installation_id = ${inst} and location_id = ${locationId} and released_at is null`;
  const r = await db`insert into cf_mutes (installation_id, location_id, until_at, created_by) values (${inst}, ${locationId}, now() + make_interval(days => ${d}), ${by}) returning id`;
  forgetCash(inst);
  return r[0]?.id as string;
}
export async function unmuteAccount(inst: string, allowed: string[] | null, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const db = sql();
  const r = await db`update cf_mutes set released_at = now() where installation_id = ${inst} and id = ${id} and released_at is null ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} returning 1`;
  forgetCash(inst);
  return r.length > 0;
}

// ------------------------------------------------------------------ settings

const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,255}\.[^\s@,;]{2,}$/;
export async function getSettings(inst: string, timezone: string, canEdit: boolean, sendingNote: string): Promise<CfSettings> {
  const [p] = await sql()`select save_on, save_hour, quiet_days, quiet_from, quiet_to, recipients from cf_prefs where installation_id = ${inst}`.catch(() => []);
  return { saveOn: p?.save_on === true, saveHour: num(p?.save_hour ?? 7), quietDays: ((p?.quiet_days as number[] | null) ?? []).map(Number), quietFrom: numOrNull(p?.quiet_from), quietTo: numOrNull(p?.quiet_to), recipients: (p?.recipients as string[] | null) ?? [], timezone, canEdit, sendingNote };
}
export async function saveSettings(inst: string, by: string | null, b: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const hour = Number(b.saveHour ?? 7);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: "Choose an hour between 0 and 23." };
  const quiet = Array.isArray(b.quietDays) ? [...new Set(b.quietDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const hr = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const qf = hr(b.quietFrom), qt = hr(b.quietTo);
  for (const v of [qf, qt]) if (v !== null && (!Number.isInteger(v) || v < 0 || v > 23)) return { ok: false, error: "Quiet hours must be between 0 and 23." };
  const list = Array.isArray(b.recipients) ? [...new Set(b.recipients.map((x) => String(x).trim().toLowerCase()).filter(Boolean))] : [];
  if (list.length > 10) return { ok: false, error: "At most 10 addresses." };
  if (list.some((e) => !EMAIL.test(e))) return { ok: false, error: "One of the email addresses does not look right." };
  const on = b.saveOn === true && list.length > 0;
  await sql()`insert into cf_prefs (installation_id, save_on, save_hour, quiet_days, quiet_from, quiet_to, recipients, updated_by, updated_at)
    values (${inst}, ${on}, ${hour}, ${quiet}::int[], ${qf}, ${qt}, ${list}::text[], ${by}, now())
    on conflict (installation_id) do update set save_on = excluded.save_on, save_hour = excluded.save_hour, quiet_days = excluded.quiet_days, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
      recipients = excluded.recipients, updated_by = excluded.updated_by, updated_at = now()`;
  return { ok: true };
}

// ------------------------------------------------------------------ the weekly receipt lines (recovered and moved, per week)

export async function receiptCash(s: Scope, one: string | null, weekStart: Date): Promise<{ recovered: number; recoveredValue: number | null; moved: number; movedValue: number | null; lostNoReason: number }> {
  const c = await ctxOf(s, one);
  const none = { recovered: 0, recoveredValue: null, moved: 0, movedValue: null, lostNoReason: 0 };
  if (!c.ids.length) return none;
  const db = sql();
  const end = new Date(weekStart.getTime() + 7 * DAY);
  const own = c.level === "self" ? db`and f.owner_id = ${c.selfId ?? "none"}` : db``;
  const [r, m, l] = await Promise.all([
    db`select count(*)::int n, sum(i.est_value)::float8 v, count(*) filter (where i.est_value > 0)::int valued from cf_recover_items i
       where i.installation_id = ${c.inst} and i.location_id = any(${c.ids}::text[]) ${ownerWhere(c)} and i.recovered_how in ('replied', 'called_back', 'rebooked') and i.recovered_at >= ${weekStart} and i.recovered_at < ${end}`,
    db`select count(*)::int n, sum(f.value)::float8 v, count(*) filter (where f.value > 0)::int valued from cf_deal_flags f
       where f.installation_id = ${c.inst} and f.location_id = any(${c.ids}::text[]) ${own} and f.kind in ('stale', 'soon') and f.resolved_how in ('moved', 'won') and f.resolved_at >= ${weekStart} and f.resolved_at < ${end}`,
    db`select count(*)::int n from cf_deal_flags f where f.installation_id = ${c.inst} and f.location_id = any(${c.ids}::text[]) ${own} and f.kind = 'lost' and f.lost_reason is null and f.first_flagged_at >= ${weekStart} and f.first_flagged_at < ${end}`,
  ]);
  return { recovered: num(r[0]?.n), recoveredValue: num(r[0]?.valued) > 0 ? num(r[0]?.v) : null, moved: num(m[0]?.n), movedValue: num(m[0]?.valued) >= MIN_DEALS_AT_RISK ? num(m[0]?.v) : null, lostNoReason: num(l[0]?.n) };
}

