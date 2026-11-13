import { sql } from "../db";
import { pgTextArray } from "./queries";
import {
  buildChannelMix, buildCurve, buildReceipt, estimateDollars, median, MIN_REPLIES_SCORECARD, percentile, share, waitClock, weekTrend,
  type BandCount, type BandKey, type ChannelRow, type ClockSetting, type Estimate, type RateFacts, type Receipt, type ReceiptFacts, type Scorecard,
} from "./moat-core";

// Read-only SQL aggregates behind the moat screens (D2 to D4, E1, E4). Every query is bound to `allowed` (the accounts the router derived from the verified session;
// null means every account of the caller's own installation) and to the installation id. Lists are server paged. Never a message text.

type Db = ReturnType<typeof sql>;
const scopeOf = (db: Db, allowed: string[] | null, col = "location_id") => (allowed === null ? db`true` : db`${db.unsafe(col)} = any(${pgTextArray(allowed)}::text[])`);
/** The leads counted: the date bar's window when the screen sent one (whole Lagos days, [from, next midnight)), otherwise the last `days` days. */
export type LeadWin = { fromMs: number; toMs: number } | null;
const leadIn = (db: Db, win: LeadWin | undefined, days: number) => (win ? db`t.lead_at >= ${new Date(win.fromMs).toISOString()}::timestamptz and t.lead_at < ${new Date(win.toMs).toISOString()}::timestamptz` : db`t.lead_at > now() - make_interval(days => ${days})`);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Booking rate, close rate and deal value inputs, per account: leads of the last 90 days, those that booked, deals closed in the last year. */
async function rateFacts(db: Db, installationId: string, allowed: string[] | null): Promise<Map<string, RateFacts>> {
  const leads = await db`
    select t.location_id, count(*)::int leads,
      count(*) filter (where exists (select 1 from cached_appointments a where a.installation_id = t.installation_id and a.location_id = t.location_id
        and a.contact_id = t.contact_id and coalesce(lower(a.status), '') not in ('cancelled', 'canceled', 'invalid') and coalesce(a.created_remote_at, a.start_at) >= t.lead_at))::int booked
    from lead_touches t
    where t.installation_id = ${installationId} and t.excluded is null and t.lead_at > now() - interval '90 days' and ${scopeOf(db, allowed, "t.location_id")}
    group by t.location_id`;
  const deals = await db`
    select o.location_id, count(*) filter (where lower(o.status) = 'won')::int won, count(*) filter (where lower(o.status) = 'lost')::int lost,
      avg(o.monetary_value) filter (where lower(o.status) = 'won' and o.monetary_value > 0) avg_value
    from cached_opportunities o
    where o.installation_id = ${installationId} and lower(o.status) in ('won', 'lost') and coalesce(o.last_status_change_at, o.synced_at) > now() - interval '365 days'
      and ${scopeOf(db, allowed, "o.location_id")}
    group by o.location_id`;
  const out = new Map<string, RateFacts>();
  const get = (id: string) => out.get(id) ?? { leads: 0, booked: 0, won: 0, lost: 0, avgDealValue: null };
  for (const r of leads) out.set(r.location_id as string, { ...get(r.location_id as string), leads: num(r.leads), booked: num(r.booked) });
  for (const r of deals) out.set(r.location_id as string, { ...get(r.location_id as string), won: num(r.won), lost: num(r.lost), avgDealValue: r.avg_value === null ? null : Number(r.avg_value) });
  return out;
}

export type ReceiptRow = { locationId: string; name: string; receipt: Receipt };
export type ReceiptOut = {
  from: string; to: string; rows: ReceiptRow[]; total: { alerts: number; saved: number; stillWaiting: number; bookedAfter: number; lateLeads: number; medianReplyMinutes: number | null };
  /** Sum of the accounts that have enough data; `accountsWithEstimate` of `rows.length` accounts counted. */
  rescued: { low: number; high: number; accountsWithEstimate: number }; atRisk: { low: number; high: number; accountsWithEstimate: number };
};

/** D2. The monthly (or any window) receipt for each account in scope, and the agency total. A month is [from, to). */
export async function rescuedReceipt(i: { installationId: string; allowed: string[] | null; from: Date; to: Date }): Promise<ReceiptOut> {
  const db = sql();
  if (i.allowed && i.allowed.length === 0) return emptyReceipt(i.from, i.to);
  const [accounts, alerts, late, rates] = await Promise.all([
    db`select l.location_id, coalesce(l.name, 'Unnamed account') name from locations l where l.installation_id = ${i.installationId} and not l.ignored and ${scopeOf(db, i.allowed, "l.location_id")}`,
    db`
      select a.location_id, count(*)::int alerts,
        count(*) filter (where a.resolved_at is not null and a.detail->>'recoveryStatus' = 'human_reply_observed')::int saved,
        count(*) filter (where a.resolved_at is null)::int still,
        coalesce(array_agg(round(extract(epoch from ((a.detail->>'replyObservedAt')::timestamptz - a.created_at)) / 60)) filter (where a.detail->>'replyObservedAt' is not null), '{}') minutes,
        count(*) filter (where a.resolved_at is not null and a.detail->>'recoveryStatus' = 'human_reply_observed' and exists (
          select 1 from cached_appointments p where p.installation_id = a.installation_id and p.location_id = a.location_id and p.contact_id = a.detail->>'contactId'
            and coalesce(lower(p.status), '') not in ('cancelled', 'canceled', 'invalid') and coalesce(p.created_remote_at, p.start_at) >= a.created_at))::int booked
      from alerts a
      where a.installation_id = ${i.installationId} and a.kind = 'breach24' and a.created_at >= ${i.from} and a.created_at < ${i.to} and ${scopeOf(db, i.allowed, "a.location_id")}
      group by a.location_id`,
    db`
      select t.location_id, count(*)::int late
      from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id
      join settings s on s.installation_id = t.installation_id
      where t.installation_id = ${i.installationId} and t.excluded is null and t.lead_at >= ${i.from} and t.lead_at < ${i.to} and ${scopeOf(db, i.allowed, "t.location_id")}
        and (t.human_touch_at is null or t.human_touch_at - coalesce(t.clock_start, t.lead_at) > make_interval(mins => coalesce(l.speed_target_minutes, s.speed_target_minutes, 15)))
      group by t.location_id`,
    rateFacts(db, i.installationId, i.allowed),
  ]);
  const aBy = new Map(alerts.map((r) => [r.location_id as string, r]));
  const lBy = new Map(late.map((r) => [r.location_id as string, num(r.late)]));
  const rows: ReceiptRow[] = accounts.map((acc) => {
    const id = acc.location_id as string;
    const a = aBy.get(id);
    const facts: ReceiptFacts = {
      alerts: num(a?.alerts), saved: num(a?.saved), stillWaiting: num(a?.still), bookedAfter: num(a?.booked), lateLeads: lBy.get(id) ?? 0,
      replyMinutes: (Array.isArray(a?.minutes) ? (a?.minutes as unknown[]) : []).map(Number),
    };
    return { locationId: id, name: acc.name as string, receipt: buildReceipt(facts, rates.get(id) ?? { leads: 0, booked: 0, won: 0, lost: 0, avgDealValue: null }) };
  }).sort((x, y) => y.receipt.saved - x.receipt.saved || x.name.localeCompare(y.name));
  return totals(i.from, i.to, rows, alerts);
}

function emptyReceipt(from: Date, to: Date): ReceiptOut {
  return { from: from.toISOString(), to: to.toISOString(), rows: [], total: { alerts: 0, saved: 0, stillWaiting: 0, bookedAfter: 0, lateLeads: 0, medianReplyMinutes: null }, rescued: { low: 0, high: 0, accountsWithEstimate: 0 }, atRisk: { low: 0, high: 0, accountsWithEstimate: 0 } };
}

function totals(from: Date, to: Date, rows: ReceiptRow[], alertRows: Array<Record<string, unknown>>): ReceiptOut {
  const sum = (f: (r: Receipt) => number) => rows.reduce((s, r) => s + f(r.receipt), 0);
  const add = (pick: (r: Receipt) => Estimate) => rows.reduce((s, r) => { const e = pick(r.receipt); return e.ok ? { low: s.low + e.low, high: s.high + e.high, accountsWithEstimate: s.accountsWithEstimate + 1 } : s; }, { low: 0, high: 0, accountsWithEstimate: 0 });
  const mins = alertRows.flatMap((r) => (Array.isArray(r.minutes) ? (r.minutes as unknown[]).map(Number) : [])).filter((n) => n >= 0);
  const m = median(mins);
  return {
    from: from.toISOString(), to: to.toISOString(), rows,
    total: { alerts: sum((r) => r.alerts), saved: sum((r) => r.saved), stillWaiting: sum((r) => r.stillWaiting), bookedAfter: sum((r) => r.bookedAfter), lateLeads: sum((r) => r.lateLeads), medianReplyMinutes: m === null ? null : Math.round(m) },
    rescued: add((r) => r.rescued), atRisk: add((r) => r.atRisk),
  };
}

/** One account's receipt for the weekly email (the same numbers as the screen). */
export async function accountReceipt(installationId: string, locationId: string, from: Date, to: Date): Promise<Receipt | null> {
  const out = await rescuedReceipt({ installationId, allowed: [locationId], from, to });
  return out.rows[0]?.receipt ?? null;
}

// ---------------------------------------------------------------- D3. Speed-to-outcome curve

export async function speedCurve(i: { installationId: string; allowed: string[] | null; days: number; countAutomated: boolean }) {
  const db = sql();
  if (i.allowed && i.allowed.length === 0) return buildCurve([]);
  const days = Math.min(365, Math.max(7, Math.floor(i.days)));
  const reply = i.countAutomated ? db`coalesce(t.human_touch_at, t.touch_at)` : db`t.human_touch_at`;
  const rows = await db`
    select band, count(*)::int leads, count(*) filter (where booked)::int booked from (
      select case when ${reply} is null then 'never'
          when extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) < 300 then 'm5'
          when extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) < 3600 then 'm60'
          when extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) < 86400 then 'h24' else 'late' end band,
        exists (select 1 from cached_appointments a where a.installation_id = t.installation_id and a.location_id = t.location_id and a.contact_id = t.contact_id
          and coalesce(lower(a.status), '') not in ('cancelled', 'canceled', 'invalid') and coalesce(a.created_remote_at, a.start_at) >= t.lead_at) booked
      from lead_touches t
      where t.installation_id = ${i.installationId} and t.excluded is null and t.lead_at > now() - make_interval(days => ${days}) and t.lead_at < now() - interval '1 day'
        and ${scopeOf(db, i.allowed, "t.location_id")}
    ) x group by band`;
  return buildCurve(rows.map((r) => ({ key: r.band as BandKey, leads: num(r.leads), booked: num(r.booked) }) satisfies BandCount));
}

// ---------------------------------------------------------------- D4. Scorecards

export type ScorecardScope = { allowed: string[] | null; onlyUserId: string | null; countAutomated: boolean; openHour: number; closeHour: number };

/** One card per person who replied to leads in the last `days` days. A client's own staff pass `onlyUserId` (themselves). */
export async function scorecards(i: { installationId: string } & ScorecardScope & { days: number; win?: LeadWin; page: number; size: number }) {
  const db = sql();
  if (i.allowed && i.allowed.length === 0) return { rows: [] as Scorecard[], total: 0, page: 0, pages: 1 };
  const days = Math.min(90, Math.max(7, Math.floor(i.days)));
  const size = [20, 50, 100].includes(i.size) ? i.size : 20;
  const mine = i.onlyUserId ? db`t.touch_user_id = ${i.onlyUserId}` : db`true`;
  const reply = i.countAutomated ? db`coalesce(t.human_touch_at, t.touch_at)` : db`t.human_touch_at`;
  const people = await db`
    select t.touch_user_id user_id,
      count(*)::int replies,
      percentile_cont(0.5) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) median_min,
      percentile_cont(0.9) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) p90_min,
      count(*) filter (where ${reply} >= now() - interval '7 days')::int n_this,
      percentile_cont(0.5) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) filter (where ${reply} >= now() - interval '7 days') med_this,
      count(*) filter (where ${reply} < now() - interval '7 days')::int n_last,
      percentile_cont(0.5) within group (order by extract(epoch from (${reply} - coalesce(t.clock_start, t.lead_at))) / 60) filter (where ${reply} < now() - interval '7 days') med_last,
      count(*) filter (where after_hours)::int ah_leads,
      count(*) filter (where after_hours and ${reply} - t.lead_at <= interval '60 minutes')::int ah_covered
    from (
      select t.*, (extract(isodow from t.lead_at at time zone coalesce(nullif(l.timezone, ''), 'UTC')) > 5
        or extract(hour from t.lead_at at time zone coalesce(nullif(l.timezone, ''), 'UTC')) < ${i.openHour}
        or extract(hour from t.lead_at at time zone coalesce(nullif(l.timezone, ''), 'UTC')) >= ${i.closeHour}) after_hours
      from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id
      where t.installation_id = ${i.installationId} and t.excluded is null and ${leadIn(db, i.win, days)} and ${scopeOf(db, i.allowed, "t.location_id")}
    ) t
    where ${reply} is not null and t.touch_user_id is not null and ${mine}
    group by t.touch_user_id`;
  const owned = await db`
    select c.assigned_to user_id, count(*)::int owned, count(*) filter (where t.human_touch_at is null)::int unanswered
    from lead_touches t join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
    where t.installation_id = ${i.installationId} and t.excluded is null and ${leadIn(db, i.win, days)} and c.assigned_to is not null
      and ${scopeOf(db, i.allowed, "t.location_id")} ${i.onlyUserId ? db`and c.assigned_to = ${i.onlyUserId}` : db``}
    group by c.assigned_to`;
  const names = await db`select user_id, max(name) name from location_users where installation_id = ${i.installationId} and ${scopeOf(db, i.allowed, "location_id")} group by user_id`;
  const nameBy = new Map(names.map((r) => [r.user_id as string, r.name as string]));
  const ownBy = new Map(owned.map((r) => [r.user_id as string, r]));
  const all: Scorecard[] = people.map((p) => {
    const id = p.user_id as string;
    const o = ownBy.get(id);
    const enough = num(p.replies) >= MIN_REPLIES_SCORECARD;
    const round = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    return {
      userId: id, name: nameBy.get(id) ?? "Team member", replies: num(p.replies), enough,
      medianMinutes: enough ? round(p.median_min) : null, p90Minutes: enough ? round(p.p90_min) : null,
      owned: num(o?.owned), unanswered: num(o?.unanswered), unansweredShare: share(num(o?.unanswered), num(o?.owned)),
      afterHoursLeads: num(p.ah_leads), afterHoursCovered: num(p.ah_covered), afterHoursCoverage: share(num(p.ah_covered), num(p.ah_leads)),
      trend: weekTrend({ median: round(p.med_this), n: num(p.n_this) }, { median: round(p.med_last), n: num(p.n_last) }),
    };
  }).sort((a, b) => b.replies - a.replies || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(all.length / size));
  const page = Math.min(Math.max(0, i.page), pages - 1);
  return { rows: all.slice(page * size, page * size + size), total: all.length, page, pages };
}

// ---------------------------------------------------------------- E4. Channel mix

export async function channelMix(i: { installationId: string; allowed: string[] | null; days: number; win?: LeadWin }) {
  const db = sql();
  if (i.allowed && i.allowed.length === 0) return buildChannelMix([]);
  const days = Math.min(90, Math.max(7, Math.floor(i.days)));
  const rows = await db`
    select coalesce(ch.channel, 'other') channel, count(*)::int leads, count(t.human_touch_at)::int replied,
      percentile_cont(0.5) within group (order by extract(epoch from (t.human_touch_at - coalesce(t.clock_start, t.lead_at))) / 60) filter (where t.human_touch_at is not null) median_min
    from lead_touches t
    left join lateral (select te.channel from touch_events te where te.installation_id = t.installation_id and te.location_id = t.location_id and te.contact_id = t.contact_id
      and te.conversation_id = t.conversation_id and te.direction = 'inbound' order by te.at asc limit 1) ch on true
    where t.installation_id = ${i.installationId} and t.excluded is null and ${leadIn(db, i.win, days)} and ${scopeOf(db, i.allowed, "t.location_id")}
    group by coalesce(ch.channel, 'other')`;
  return buildChannelMix(rows.map((r) => ({ channel: r.channel as string, leads: num(r.leads), replied: num(r.replied), medianMinutes: r.median_min === null ? null : Math.round(Number(r.median_min)) }) satisfies ChannelRow));
}

// ---------------------------------------------------------------- E1. The two wait clocks

/** Waiting conversations (the customer wrote last), oldest first, each with its real wait and its working-hours wait. Server paged. */
export async function waitClockList(i: { installationId: string; allowed: string[] | null; clock: Omit<ClockSetting, "zone">; page: number; size: number; now: number }) {
  const db = sql();
  if (i.allowed && i.allowed.length === 0) return { rows: [], total: 0, page: 0, pages: 1, used: i.clock.businessHours ? "working" : "real" };
  const size = [20, 50, 100].includes(i.size) ? i.size : 20;
  const where = db`c.installation_id = ${i.installationId} and c.last_message_direction = 'inbound' and c.last_message_at > now() - interval '14 days' and ${scopeOf(db, i.allowed, "c.location_id")}`;
  const [{ n }] = await db`select count(*)::int n from cached_conversations c where ${where}`;
  const total = num(n);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(0, i.page), pages - 1);
  const rows = await db`
    select c.location_id, c.conversation_id, c.contact_id, coalesce(nullif(btrim(c.contact_name), ''), 'Unnamed contact') person, c.last_message_at, l.timezone, coalesce(l.name, 'Unnamed account') account
    from cached_conversations c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where ${where} order by c.last_message_at asc limit ${size} offset ${page * size}`;
  return {
    total, page, pages, used: i.clock.businessHours ? "working" : "real",
    rows: rows.map((r) => ({
      locationId: r.location_id as string, conversationId: r.conversation_id as string, contactId: (r.contact_id as string | null) ?? null, person: r.person as string, account: r.account as string,
      ...waitClock((r.last_message_at as Date).getTime(), i.now, { ...i.clock, zone: (r.timezone as string | null) ?? null }),
    })),
  };
}

export { estimateDollars, percentile };

// ---------------------------------------------------------------- the people behind a receipt count (count equals rows)

export const RECEIPT_KINDS = ["alerts", "saved", "waiting", "booked"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** The alerts counted in one receipt number: the same filter as the count in `rescuedReceipt`, server paged. */
export async function receiptPeople(i: { installationId: string; allowed: string[] | null; from: Date; to: Date; kind: ReceiptKind; page: number; size: number }) {
  const db = sql();
  if (i.allowed && i.allowed.length === 0) return { rows: [], total: 0, page: 0, pages: 1 };
  const size = [20, 50, 100].includes(i.size) ? i.size : 20;
  const saved = db`a.resolved_at is not null and a.detail->>'recoveryStatus' = 'human_reply_observed'`;
  const cond = i.kind === "alerts" ? db`true` : i.kind === "saved" ? saved : i.kind === "waiting" ? db`a.resolved_at is null`
    : db`${saved} and exists (select 1 from cached_appointments p where p.installation_id = a.installation_id and p.location_id = a.location_id and p.contact_id = a.detail->>'contactId'
        and coalesce(lower(p.status), '') not in ('cancelled', 'canceled', 'invalid') and coalesce(p.created_remote_at, p.start_at) >= a.created_at)`;
  const where = db`a.installation_id = ${i.installationId} and a.kind = 'breach24' and a.created_at >= ${i.from} and a.created_at < ${i.to} and ${scopeOf(db, i.allowed, "a.location_id")} and ${cond}`;
  const [{ n }] = await db`select count(*)::int n from alerts a where ${where}`;
  const total = num(n);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(0, i.page), pages - 1);
  const rows = await db`
    select a.location_id, a.detail->>'contactId' contact_id, a.detail->>'conversationId' conversation_id, coalesce(a.detail->>'personName', 'Unnamed contact') person,
      coalesce(l.name, 'Unnamed account') account, a.created_at,
      case when a.detail->>'replyObservedAt' is not null then round(extract(epoch from ((a.detail->>'replyObservedAt')::timestamptz - a.created_at)) / 60)::int end reply_minutes
    from alerts a left join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id
    where ${where} order by a.created_at desc limit ${size} offset ${page * size}`;
  return {
    total, page, pages,
    rows: rows.map((r) => ({
      locationId: r.location_id as string, contactId: (r.contact_id as string | null) ?? null, conversationId: (r.conversation_id as string | null) ?? null,
      person: r.person as string, account: r.account as string, alertAt: (r.created_at as Date).toISOString(), replyMinutes: r.reply_minutes === null ? null : Number(r.reply_minutes),
    })),
  };
}
