import { sql } from "../db";
import { waitingCte, type MissedScope } from "./missed-calls";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import { eventsInRange } from "./coverage-events-sql";
import { loadLookups } from "./speed-queries";
import { properCase, resolveUser } from "./people-labels";
import { sourceLabel } from "./speed-intel";
import { callerLabel } from "./missed-calls";
import { effectivePref, rankAccounts, type AccountCount, type Reason } from "./ignored-leads-core";

// Clients ignoring leads: per client account, the people it has not answered, in the bar's dates (default the last 30 days). Written once here; the report, the list behind every number
// and the alert all use it, so a number and the rows behind it cannot disagree (docs/METRICS.md, "Clients ignoring leads"). Read only; no message text is read.
//   missed        the callers nobody returned: exactly Coverage's and Call mode's list (missed-calls.ts)
//   never         a contact created in the dates, with a conversation, past the account's wait, that nobody has called or messaged
//   reply_nobody  the customer's latest message is past the wait and nobody has called or messaged after it
//   reply_auto    the same, but only an automatic message followed (a person did not). With "count automatic messages as a reply" on, that is an answer and not listed.
// A person asked not to be contacted is left out of every list. Waits are each account's own choice (Settings, Targets), 24 hours by default.

type Db = ReturnType<typeof sql>;
export type IgnoredScope = { installationId: string; allowed: string[] | null; fromMs: number; toMs: number; now: number };

/** Each account's own choice (the company's, then the account's). Missing table or row = built-in defaults. */
export async function loadIgnoredPrefs(installationId: string): Promise<{ company: unknown; byLoc: Map<string, unknown> }> {
  try {
    const rows = await sql()`select scope, value from speed_prefs where installation_id = ${installationId} and key = 'ignored'`;
    const byLoc = new Map<string, unknown>(); let company: unknown = null;
    for (const r of rows) { if ((r.scope as string) === "") company = r.value; else byLoc.set(r.scope as string, r.value); }
    return { company, byLoc };
  } catch { return { company: null, byLoc: new Map() }; }
}

async function countAutomated(installationId: string): Promise<boolean> {
  try { const [r] = await sql()`select count_automated_touches from settings where installation_id = ${installationId}`; return r?.count_automated_touches === true; } catch { return false; }
}

type Ctx = { s: IgnoredScope; countAuto: boolean; locs: string[]; hours: number[] };
async function context(s: IgnoredScope): Promise<Ctx & { prefs: Awaited<ReturnType<typeof loadIgnoredPrefs>>; names: Map<string, string>; zones: Map<string, string | null> }> {
  const db = sql();
  const [prefs, countAuto, locs] = await Promise.all([
    loadIgnoredPrefs(s.installationId), countAutomated(s.installationId),
    db`select location_id, name, timezone from locations where installation_id = ${s.installationId} and not ignored ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``}`,
  ]);
  const ids = locs.map((l) => l.location_id as string);
  return { s, countAuto, locs: ids, hours: ids.map((id) => effectivePref(prefs.company, prefs.byLoc.get(id)).waitHours), prefs,
    names: new Map(locs.map((l) => [l.location_id as string, (l.name as string | null) || "Client account"])), zones: new Map(locs.map((l) => [l.location_id as string, (l.timezone as string | null) ?? null])) };
}

/** The flagged people, one row per (account, person, reason). Everything below is a filter or a group of this one query. */
function flagged(db: Db, c: Ctx) {
  const { s } = c;
  const ms: MissedScope = { installationId: s.installationId, allowed: s.allowed, fromMs: s.fromMs, toMs: s.toMs };
  const nowDate = new Date(s.now), from = new Date(s.fromMs), to = new Date(s.toMs);
  const inPlace = s.allowed ? db`and e.location_id = any(${s.allowed}::text[])` : db``;
  return db`
    ${waitingCte(db, ms)},
    th as (select t.location_id, t.hrs from unnest(${c.locs}::text[], ${c.hours}::int[]) t(location_id, hrs)),
    li as (
      select distinct on (e.location_id, e.contact_id) e.location_id, e.contact_id, e.at last_in from touch_events e
      where e.installation_id = ${s.installationId} and e.direction = 'inbound' and e.kind = 'message' and e.at >= ${from} and e.at < ${to} ${inPlace}
      order by e.location_id, e.contact_id, e.at desc),
    rep as (
      select li.location_id, li.contact_id, li.last_in,
        exists (select 1 from touch_events o where o.installation_id = ${s.installationId} and o.location_id = li.location_id and o.contact_id = li.contact_id and o.direction = 'outbound' and o.kind <> 'failed' and not o.automated and o.at > li.last_in) human,
        exists (select 1 from touch_events o where o.installation_id = ${s.installationId} and o.location_id = li.location_id and o.contact_id = li.contact_id and o.direction = 'outbound' and o.kind <> 'failed' and o.automated and o.at > li.last_in) auto
      from li join th on th.location_id = li.location_id
      where li.last_in < ${nowDate}::timestamptz - th.hrs * interval '1 hour'),
    nl as (
      select ct.location_id, ct.contact_id, ct.date_added since from cached_contacts ct join th on th.location_id = ct.location_id
      where ct.installation_id = ${s.installationId} and ct.date_added >= ${from} and ct.date_added < ${to} and ct.date_added < ${nowDate}::timestamptz - th.hrs * interval '1 hour'
        and exists (select 1 from cached_conversations cc where cc.installation_id = ${s.installationId} and cc.location_id = ct.location_id and cc.contact_id = ct.contact_id)
        and not exists (select 1 from touch_events o where o.installation_id = ${s.installationId} and o.location_id = ct.location_id and o.contact_id = ct.contact_id and o.direction = 'outbound' and o.kind <> 'failed'
          ${c.countAuto ? db`` : db`and not o.automated`} and o.at >= ct.date_added)
        and not exists (select 1 from call_outcomes co where co.installation_id = ${s.installationId} and co.location_id = ct.location_id and co.contact_id = ct.contact_id and co.created_at >= ct.date_added)),
    flag as (
      select w.location_id, w.contact_id, 'missed'::text reason, w.missed_at since from w join th on th.location_id = w.location_id
      union all select location_id, contact_id, 'never', since from nl
      union all select location_id, contact_id, 'reply_nobody', last_in from rep where not human and not auto
      union all select location_id, contact_id, 'reply_auto', last_in from rep where not human and auto and ${c.countAuto ? db`false` : db`true`}),
    person as (
      select f.location_id, f.contact_id, min(f.since) since, bool_or(f.reason = 'missed') missed, bool_or(f.reason = 'never') never, bool_or(f.reason = 'reply_nobody') reply_nobody, bool_or(f.reason = 'reply_auto') reply_auto
      from flag f left join cached_contacts k on k.installation_id = ${s.installationId} and k.location_id = f.location_id and k.contact_id = f.contact_id
      where coalesce(k.dnd, false) = false group by 1, 2),
    priced as (
      select p.*, coalesce(d.v, 0)::float8 dollars from person p
      left join lateral (select sum(o.monetary_value) v from cached_opportunities o ${dealScopeJoins()}
        where o.installation_id = ${s.installationId} and o.location_id = p.location_id and o.contact_id = p.contact_id and o.status = 'open' and ${countedInScope()}) d on true)`;
}

/** Per account: people not answered, by reason, oldest wait and counted dollars. Accounts with nobody waiting are included with zeros. */
export async function ignoredByAccount(s: IgnoredScope): Promise<AccountCount[]> {
  const db = sql();
  const c = await context(s);
  if (c.locs.length === 0) return [];
  const rows = await db`
    with ${flagged(db, c)}
    select location_id, count(*)::int people, count(*) filter (where missed)::int missed, count(*) filter (where never)::int never, count(*) filter (where reply_nobody)::int reply_nobody,
      count(*) filter (where reply_auto)::int reply_auto, min(since) oldest, coalesce(sum(dollars), 0)::float8 dollars, count(*) filter (where dollars <= 0)::int unpriced
    from priced group by 1`;
  const by = new Map(rows.map((r) => [r.location_id as string, r]));
  return rankAccounts(c.locs.map((id): AccountCount => {
    const r = by.get(id);
    return { locationId: id, name: c.names.get(id) ?? "Client account", people: Number(r?.people ?? 0), missed: Number(r?.missed ?? 0), never: Number(r?.never ?? 0), replyNobody: Number(r?.reply_nobody ?? 0), replyAuto: Number(r?.reply_auto ?? 0),
      oldestAt: r?.oldest ? new Date(r.oldest as string).getTime() : null, dollars: Number(r?.dollars ?? 0), unpriced: Number(r?.unpriced ?? 0) };
  }));
}

/** The report: accounts ranked, totals, and the same measure for the period just before when SubSync has events from then. */
export async function ignoredReport(s: IgnoredScope) {
  const span = s.toMs - s.fromMs > 0 ? Math.min(s.toMs, s.now) - s.fromMs : 0;
  const prevScope: IgnoredScope = { ...s, fromMs: s.fromMs - span, toMs: s.fromMs };
  const days = Math.max(1, Math.round(span / 86_400_000));
  const [accounts, eventsNow, eventsBefore] = await Promise.all([
    ignoredByAccount(s),
    eventsInRange({ installationId: s.installationId, allowed: s.allowed, fromMs: s.fromMs, toMs: s.toMs }),
    eventsInRange({ installationId: s.installationId, allowed: s.allowed, fromMs: prevScope.fromMs, toMs: prevScope.toMs }),
  ]);
  let previous: Map<string, number> | null = null;
  if (eventsBefore > 0 && days <= 90) previous = new Map((await ignoredByAccount(prevScope)).map((a) => [a.locationId, a.people]));
  const rows = accounts.map((a) => ({ ...a, previous: previous ? previous.get(a.locationId) ?? 0 : null }));
  const sum = (f: (a: AccountCount) => number) => rows.reduce((n, a) => n + f(a), 0);
  const people = sum((a) => a.people);
  return {
    now: s.now, days, eventsStored: eventsNow, accounts: rows,
    totals: { people, missed: sum((a) => a.missed), never: sum((a) => a.never), replyNobody: sum((a) => a.replyNobody), replyAuto: sum((a) => a.replyAuto), dollars: sum((a) => a.dollars), unpriced: sum((a) => a.unpriced),
      previous: previous ? sum((a) => a.previous ?? 0) : null, accountsAffected: rows.filter((a) => a.people > 0).length },
  };
}

export type IgnoredPageRow = {
  locationId: string; locationName: string; contactId: string; name: string; phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; source: string | null; owner: ReturnType<typeof resolveUser> | null;
  since: number; dollars: number; reasons: Reason[];
};
/** One page of exactly the people behind a count: one account or all, one reason or all of them. `total` is the database's count of those rows. */
export async function ignoredPage(s: IgnoredScope, o: { reason: Reason | "all"; account: string | null; page: number; size: number }): Promise<{ total: number; page: number; rows: IgnoredPageRow[] }> {
  const db = sql();
  const c = await context(s);
  if (c.locs.length === 0) return { total: 0, page: 0, rows: [] };
  const cond = [o.reason === "all" ? db`true` : o.reason === "missed" ? db`p.missed` : o.reason === "never" ? db`p.never` : o.reason === "reply_nobody" ? db`p.reply_nobody` : db`p.reply_auto`,
    o.account ? db`p.location_id = ${o.account}` : db`true`];
  const rows = await db`
    with ${flagged(db, c)}
    select p.*, k.full_name, k.first_name, k.last_name, k.email, k.phone, k.dnd, nullif(k.source, '') source, nullif(k.assigned_to, '') owner, count(*) over ()::int total
    from priced p left join cached_contacts k on k.installation_id = ${s.installationId} and k.location_id = p.location_id and k.contact_id = p.contact_id
    where ${cond[0]} and ${cond[1]} order by p.since, p.location_id, p.contact_id limit ${o.size} offset ${o.page * o.size}`;
  const { lk } = await loadLookups(db, s.installationId, s.allowed, 0, s.now);
  const out: IgnoredPageRow[] = rows.map((r) => {
    const name = nullable(r.full_name) ?? nullable(`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim());
    const reasons: Reason[] = [];
    if (r.missed) reasons.push("missed"); if (r.never) reasons.push("never"); if (r.reply_nobody) reasons.push("reply_nobody"); if (r.reply_auto) reasons.push("reply_auto");
    const loc = r.location_id as string;
    return {
      locationId: loc, locationName: lk.locationNames.get(loc) ?? c.names.get(loc) ?? "Client account", contactId: r.contact_id as string,
      name: name ? properCase(name) : callerLabel({ name: null, email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null }),
      phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, dnd: r.dnd === true, timeZone: c.zones.get(loc) ?? null, source: r.source ? sourceLabel(r.source as string) : null,
      owner: r.owner ? resolveUser(r.owner as string, lk.team, lk.usersAccess.get(loc)) : null, since: new Date(r.since as string).getTime(), dollars: Number(r.dollars ?? 0), reasons,
    };
  });
  return { total: rows.length ? Number(rows[0].total) : 0, page: o.page, rows: out };
}
const nullable = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
