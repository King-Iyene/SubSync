import { sql } from "../db";
import {
  boardView, decodeCursor, encodeCursor, fairRank, MAX_ROWS, MIN_DAYS, WAIT_HOURS, MIN_LEADS, normaliseSource, proofLines, rate, suggestNextLead, DAY, median, REASON_TEXT, type RankInput, type NextCandidate,
} from "./people3-intel";
import { dailyFrom, NO_OWNER, openDealsFrom, ownerAt, staleDeal, waitingFrom, waitingOwner, needsOutcomeFrom, upcomingFrom, oldWait, workItems, type Frag } from "./people3-rollup";
import { inRoleSet, roleIndexFor } from "./people3-roleset";
import type { RoleFilter } from "../people/roles";
import { accountsIn, awayMap, dayStr, iso, like, loadPeople, n, pageOf, refOf, scorecards, type Acct, type Links, type Scope, type CardFilters } from "./people3-queries";
import type {
  Pp3Board, Pp3Handoff, Pp3HandoffRow, Pp3Leaderboard, Pp3List, Pp3ListRow, Pp3Money, Pp3MoneyRow, Pp3NextLead, Pp3Person, Pp3Proof, Pp3Ranked, Pp3Reason,
} from "./people3-types";

// The rest of the reads behind /api/app/people3: fair leaderboards, money, handoffs, the next-lead estimate, the client receipt, and the lists behind every count.
// Same rules as people3-queries.ts: the accounts come from the signed session; ids from a request only narrow; every query filters by installation_id; nothing here echoes an id.

type Window = { from: Date; to: Date };
const win = (f: Window, days: number) => ({ from: f.from.toISOString(), to: f.to.toISOString(), days });

// ---- leaderboard ----

/** Setters: leads whose first reply came from a person, and whether it was inside the account's target, by lead source. Closers: counted deals closed, and whether they were won, by deal source. */
async function boardData(s: Scope, ids: string[], f: Window, kind: "setters" | "closers"): Promise<Map<string, Map<string, { bySource: Record<string, { n: number; hit: number }>; first: Date | null }>>> {
  const db = sql();
  const out = new Map<string, Map<string, { bySource: Record<string, { n: number; hit: number }>; first: Date | null }>>();
  const rows = kind === "setters"
    ? await db`
        select z.location_id, z.user_id, z.src, count(*)::int n, (count(*) filter (where z.secs <= z.target * 60))::int hit, min(z.at) first_at
        from (select lt.location_id, lt.touch_user_id user_id, lt.lead_at at, tg.m target, lower(coalesce(nullif(btrim(c.source), ''), 'unknown')) src,
                greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at)))) secs
              from lead_touches lt
              join (select l.location_id, coalesce(l.speed_target_minutes, st.speed_target_minutes, 15) m from locations l left join settings st on st.installation_id = l.installation_id
                    where l.installation_id = ${s.inst} and l.location_id = any(${ids}::text[])) tg on tg.location_id = lt.location_id
              left join cached_contacts c on c.installation_id = lt.installation_id and c.location_id = lt.location_id and c.contact_id = lt.contact_id
              where lt.installation_id = ${s.inst} and lt.location_id = any(${ids}::text[]) and lt.excluded is null and lt.touch_at is not null and lt.touch_user_id is not null
                and lt.lead_at >= ${f.from} and lt.lead_at < ${f.to}) z
        group by 1, 2, 3`
    : await db`
        select z.location_id, z.ou user_id, z.src, count(*)::int n, (count(*) filter (where z.status = 'won'))::int hit, min(z.at) first_at
        from (select o.location_id, o.status, o.last_status_change_at at, lower(coalesce(nullif(btrim(o.source), ''), 'unknown')) src, ${ownerAt(db, "deal", "o", "last_status_change_at")} ou
              from cached_opportunities o where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status in ('won', 'lost') and coalesce(o.monetary_value, 0) > 0
                and o.last_status_change_at >= ${f.from} and o.last_status_change_at < ${f.to}) z
        where z.ou is not null and z.ou not like '~%' group by 1, 2, 3`;
  for (const r of rows) {
    const loc = out.get(r.location_id as string) ?? new Map();
    out.set(r.location_id as string, loc);
    const p = loc.get(r.user_id as string) ?? { bySource: {}, first: null as Date | null };
    loc.set(r.user_id as string, p);
    p.bySource[normaliseSource(r.src as string)] = { n: n(r.n), hit: n(r.hit) };
    const fa = r.first_at as Date | null;
    if (fa && (!p.first || fa < p.first)) p.first = fa;
  }
  return out;
}

export async function leaderboard(
  s: Scope, f: Window & { location?: string | null; role?: "setter" | "closer" | null; /** Only people the agency labelled this way. */ roleset?: RoleFilter | null; all?: boolean; admins?: boolean }, o: { after?: string | null; accounts?: number }, days: number, now = Date.now(),
): Promise<Pp3Leaderboard> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const empty: Pp3Leaderboard = { period: win(f, days), boards: [], page: { total: 0, next: null }, minLeads: MIN_LEADS, minDays: MIN_DAYS, historyStarts: null };
  if (!ids.length) return empty;
  // Only accounts where at least two people have something to compare.
  const daily = await dailyFrom(s.inst, ids, f.from, now);
  const live = await db`select d.location_id from (${daily.f}) d where d.day >= ${dayStr(f.from)}::date and d.day < ${dayStr(f.to)}::date and d.user_id not like '~%'
      and d.first_replies + d.held + d.no_show + d.deals_won + d.deals_lost > 0 group by 1 having count(distinct d.user_id) >= 2`;
  const eligible = new Set(live.map((r) => r.location_id as string));
  const list = accts.filter((a) => eligible.has(a.id));
  const cur = decodeCursor(o.after);
  const start = cur ? Math.max(0, list.findIndex((a) => a.id === cur.id) + 1) : 0;
  const size = o.accounts ?? 5;
  const pageAccts = list.slice(start, start + size);
  const kinds: Array<"setters" | "closers"> = f.role === "setter" ? ["setters"] : f.role === "closer" ? ["closers"] : ["setters", "closers"];
  const boards: Pp3Board[] = [];
  const pageIds = pageAccts.map((a) => a.id);
  if (pageIds.length) {
    const roleRows = await db`select m.user_id, m.role from team_members m where m.installation_id = ${s.inst}`.catch(() => []);
    const roleBy = new Map(roleRows.map((r) => [r.user_id as string, (r.role as string) ?? "unknown"]));
    const data = new Map(await Promise.all(kinds.map(async (k) => [k, await boardData(s, pageIds, f, k)] as const)));
    // Identities of the people who can be shown to this caller (a person asking about themselves gets only their own).
    const everyone = new Set<string>();
    for (const m of data.values()) for (const loc of m.values()) for (const u of loc.keys()) everyone.add(u);
    const people = await loadPeople(s, accts, [...everyone].slice(0, 200), now);
    // "Only Setters" and the like: ranked among the people the agency gave that label, in that account (its own label, else the default).
    const labels = f.roleset ? await roleIndexFor(s.inst, [...everyone].slice(0, 200)) : null;
    for (const a of pageAccts) for (const kind of kinds) {
      const per = data.get(kind)?.get(a.id);
      if (!per || per.size < 2) continue;
      const inputs: RankInput[] = [...per].filter(([userId]) => !labels || inRoleSet(labels, userId, a.id, f.roleset ?? null)).map(([userId, v]) => ({
        userId, name: people.get(userId)?.name ?? "", isAdmin: roleBy.get(userId) === "agency_admin" || roleBy.get(userId) === "account_admin",
        daysOfHistory: v.first ? Math.floor((f.to.getTime() - v.first.getTime()) / DAY) : 0, bySource: v.bySource,
      }));
      const ranks = fairRank(inputs, { kind, includeAdmins: f.admins === true });
      const rows: Array<Pp3Ranked & { userId: string }> = ranks.flatMap((r) => {
        const person = people.get(r.userId);
        if (!person) return s.level === "self" ? [{ userId: r.userId, rank: r.rank, person: null as unknown as Pp3Person, n: r.n, enough: r.enough, value: rate(r.hit, r.n, MIN_LEADS), expected: r.expected, vsMix: r.vsMix, why: r.why }] : [];
        if (person.isAdmin && f.admins !== true) return [];
        return [{ userId: r.userId, rank: r.rank, person, n: r.n, enough: r.enough, value: rate(r.hit, r.n, MIN_LEADS), expected: r.expected === null ? null : Math.round(r.expected * 1000) / 1000, vsMix: r.vsMix, why: r.why }];
      });
      const view = boardView(rows, { all: f.all === true && s.level === "all", viewerId: s.selfId, selfOnly: s.level === "self" });
      const ranked = rows.filter((r) => r.rank !== null).length;
      const you = view.you ? { ...view.you, why: rows.find((r) => r.userId === s.selfId)?.why ?? "" } : null;
      boards.push({
        location: refOf(a), kind, visibility: view.visibility, ranked, shown: view.shown.map(({ userId: _u, ...r }) => { void _u; return r; }), hidden: view.hidden, you,
        minLeads: MIN_LEADS, minDays: MIN_DAYS, enough: ranked >= 2, note: ranked < 2 ? "Needs at least two people with enough data in this account before anyone is ranked." : null,
      });
    }
  }
  const last = pageAccts[pageAccts.length - 1];
  const hist = await db`select min(day)::text d from user_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.then((r) => (r[0]?.d as string | null) ?? null).catch(() => null);
  return { period: win(f, days), boards, page: { total: list.length, next: last && start + size < list.length ? encodeCursor({ v: null, id: last.id }) : null }, minLeads: MIN_LEADS, minDays: MIN_DAYS, historyStarts: hist };
}

// ---- money ----

const WAITING_DEAL = (db: ReturnType<typeof sql>) => db`exists (select 1 from cached_conversations cv where cv.installation_id = o.installation_id and cv.location_id = o.location_id and cv.contact_id = o.contact_id
  and cv.last_message_direction = 'inbound' and cv.last_message_at > now() - interval '30 days' and cv.last_message_at < now() - ${`${WAIT_HOURS} hours`}::interval)`;

export async function money(s: Scope, f: Window & { location?: string | null; q?: string | null }, o: { size: number; after?: string | null; sort?: "won" | "risk" }, days: number, now = Date.now()): Promise<Pp3Money> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const formula = "Open value: open deals with a value and an owner, in play (the Pipeline rule). Quiet: no stage change for 30 days. Waiting: the lead wrote last and nobody has answered for 2 hours. At risk: quiet or waiting, each deal counted once. An estimate, not a forecast. Won: deals won in the period, credited to who owned the deal when it was won.";
  const empty: Pp3Money = { ...pageOf<Pp3MoneyRow>([], 0, o.size, null), period: win(f, days), totals: { wonValue: 0, openValue: 0, atRiskValue: 0 }, formula, isEstimate: true, historyStarts: null };
  if (!ids.length) return empty;
  const daily = await dailyFrom(s.inst, ids, f.from, now);
  const q = (f.q ?? "").trim().slice(0, 60);
  const key = o.sort === "won" ? db`p.won_value` : db`p.at_risk`;
  const base = db`
    with won as (select d.location_id, d.user_id, sum(d.deals_won)::int wc, sum(d.won_value)::float8 wv, sum(d.lost_value)::float8 lv
        from (${daily.f}) d where d.day >= ${dayStr(f.from)}::date and d.day < ${dayStr(f.to)}::date and d.user_id not like '~%' group by 1, 2),
    opn as (select o.location_id, o.assigned_to user_id, coalesce(sum(o.monetary_value), 0)::float8 ov,
        coalesce(sum(o.monetary_value) filter (where ${staleDeal()}), 0)::float8 sv, coalesce(sum(o.monetary_value) filter (where ${WAITING_DEAL(db)}), 0)::float8 wtv,
        coalesce(sum(o.monetary_value) filter (where ${staleDeal()} or ${WAITING_DEAL(db)}), 0)::float8 risk
        ${openDealsFrom(s.inst, ids)} group by 1, 2),
    p as (select coalesce(w.location_id, o.location_id) location_id, coalesce(w.user_id, o.user_id) user_id, coalesce(w.wc, 0) won_count, coalesce(w.wv, 0) won_value, coalesce(w.lv, 0) lost_value,
        coalesce(o.ov, 0) open_value, coalesce(o.sv, 0) stale_value, coalesce(o.wtv, 0) waiting_value, coalesce(o.risk, 0) at_risk
        from won w full join opn o on o.location_id = w.location_id and o.user_id = w.user_id)
    select p.*, ${key} sortv, p.user_id || '|' || p.location_id k, coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') nm
    from p left join team_members m on m.installation_id = ${s.inst} and m.user_id = p.user_id left join team_names tn on tn.installation_id = ${s.inst} and tn.user_id = p.user_id
    where p.user_id is not null and p.user_id not like '~%' and (m.deleted is not true or p.won_value > 0)
      ${s.level === "self" ? (s.selfId ? db`and p.user_id = ${s.selfId}` : db`and false`) : db``}
      ${q ? db`and coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') ilike ${like(q)}` : db``}
      and p.won_value + p.open_value > 0`;
  const cur = decodeCursor(o.after);
  const [rows, tot] = await Promise.all([
    db`select * from (${base}) b where ${cur ? db`(b.sortv, b.k) < (${Number(cur.v ?? 0)}::float8, ${cur.id}::text)` : db`true`} order by b.sortv desc, b.k desc limit ${o.size + 1}`,
    db`select count(*)::int c, coalesce(sum(b.won_value), 0)::float8 won, coalesce(sum(b.open_value), 0)::float8 open_v, coalesce(sum(b.at_risk), 0)::float8 risk from (${base}) b`,
  ]);
  const page = rows.slice(0, o.size);
  const people = await loadPeople(s, accts, [...new Set(page.map((r) => r.user_id as string))], now);
  const byAcct = new Map(accts.map((a) => [a.id, a]));
  const out: Pp3MoneyRow[] = page.flatMap((r) => {
    const person = people.get(r.user_id as string), a = byAcct.get(r.location_id as string);
    if (!person || !a) return [];
    return [{
      person, location: refOf(a), wonCount: n(r.won_count), wonValue: n(r.won_value), lostValue: n(r.lost_value), openValue: n(r.open_value), staleValue: n(r.stale_value),
      waitingValue: n(r.waiting_value), atRiskValue: n(r.at_risk), enough: n(r.open_value) + n(r.won_value) > 0,
    }];
  });
  const last = page[page.length - 1];
  const hist = await db`select min(day)::text d from user_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.then((r) => (r[0]?.d as string | null) ?? null).catch(() => null);
  return {
    ...pageOf(out, n(tot[0]?.c), o.size, rows.length > o.size && last ? encodeCursor({ v: Number(last.sortv ?? 0), id: last.k as string }) : null),
    period: win(f, days), totals: { wonValue: n(tot[0]?.won), openValue: n(tot[0]?.open_v), atRiskValue: n(tot[0]?.risk) }, formula, isEstimate: true, historyStarts: hist,
  };
}

// ---- handoff (who set it, who closed it) ----

export async function handoff(s: Scope, f: Window & { location?: string | null }, o: { size: number; after?: string | null }, days: number): Promise<Pp3Handoff> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const note = "A deal counts when the lead had an appointment before it was won and the win came within the window. The setter is the person the CRM records as creating the appointment; the closer is whoever owned the deal when it was won.";
  const empty: Pp3Handoff = { ...pageOf<Pp3HandoffRow>([], 0, o.size, null), period: win(f, days), windowDays: 30, note };
  if (!ids.length || s.level === "self") return empty;
  const set = await db`select appointment_deal_window_days d from settings where installation_id = ${s.inst}`.catch(() => []);
  const wd = Number(set[0]?.d), windowDays = Number.isInteger(wd) && wd >= 7 && wd <= 180 ? wd : 30;
  const byLoc = !!f.location;
  const base = db`
    select g.setter, g.closer, ${byLoc ? db`g.location_id` : db`null::text`} location_id, count(*)::int deals, coalesce(sum(g.v), 0)::float8 won_value,
      (percentile_cont(0.5) within group (order by extract(epoch from (g.won_at - g.booked_at)) / 86400))::float8 med_days,
      coalesce(g.setter, '') || '|' || coalesce(g.closer, '') || '|' || ${byLoc ? db`g.location_id` : db`''`} k
    from (
      select w.location_id, w.v, w.won_at, w.closer, a.booked_by_user setter, a.created_remote_at booked_at
      from (select o.location_id, o.contact_id, o.monetary_value::float8 v, o.last_status_change_at won_at, ${ownerAt(db, "deal", "o", "last_status_change_at")} closer
            from cached_opportunities o where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'won' and coalesce(o.monetary_value, 0) > 0
              and o.last_status_change_at >= ${f.from} and o.last_status_change_at < ${f.to} and o.contact_id is not null) w
      join lateral (select a.booked_by_user, a.created_remote_at from cached_appointments a where a.installation_id = ${s.inst} and a.location_id = w.location_id and a.contact_id = w.contact_id
        and a.created_remote_at <= w.won_at and a.start_at >= w.won_at - ${`${windowDays} days`}::interval and a.status is distinct from 'invalid' order by a.start_at desc limit 1) a on true
    ) g group by g.setter, g.closer ${byLoc ? db`, g.location_id` : db``}`;
  const cur = decodeCursor(o.after);
  const [rows, tot] = await Promise.all([
    db`select * from (${base}) b where ${cur ? db`(b.won_value, b.k) < (${Number(cur.v ?? 0)}::float8, ${cur.id}::text)` : db`true`} order by b.won_value desc, b.k desc limit ${o.size + 1}`,
    db`select count(*)::int c from (${base}) b`,
  ]);
  const page = rows.slice(0, o.size);
  const users = [...new Set(page.flatMap((r) => [r.setter as string | null, r.closer as string | null]).filter((x): x is string => !!x && !x.startsWith("~")))];
  const people = await loadPeople(s, accts, users);
  const byAcct = new Map(accts.map((a) => [a.id, a]));
  const who = (id: string | null) => ({ userId: id && !id.startsWith("~") ? id : null, name: id && !id.startsWith("~") ? people.get(id)?.name ?? "A team member" : id === null ? "Not recorded" : "Nobody" });
  const out: Pp3HandoffRow[] = page.map((r) => ({
    setter: who((r.setter as string | null) ?? null), closer: who((r.closer as string | null) ?? null), deals: n(r.deals), wonValue: n(r.won_value),
    medianDays: r.med_days === null ? null : Math.round(Number(r.med_days) * 10) / 10, location: r.location_id ? refOf(byAcct.get(r.location_id as string) as Acct) : null,
  }));
  const last = page[page.length - 1];
  return { ...pageOf(out, n(tot[0]?.c), o.size, rows.length > o.size && last ? encodeCursor({ v: Number(last.won_value ?? 0), id: last.k as string }) : null), period: win(f, days), windowDays, note };
}

// ---- who should get the next lead (an estimate; never assigns) ----

export async function nextLead(s: Scope, f: { location?: string | null; source?: string | null; admins?: boolean }, now = Date.now()): Promise<Pp3NextLead> {
  const db = sql();
  const none = (hidden: Pp3NextLead["hidden"], location: Pp3NextLead["location"] = null, source: string | null = null): Pp3NextLead => ({ location, source, isEstimate: true, suggestion: null, hidden, considered: [] });
  if (s.level === "self" || !f.location) return none("no_account");
  const accts = await accountsIn(s, f.location);
  if (accts.length !== 1) return none("no_account");
  const a = accts[0], ids = [a.id];
  const source = f.source ? normaliseSource(f.source).slice(0, 80) : null;
  const access = await db`select x.user_id from team_member_access x join team_members m on m.installation_id = x.installation_id and m.user_id = x.user_id
    where x.installation_id = ${s.inst} and x.location_id = ${a.id} and not m.deleted`.catch(() => []);
  const users = access.map((r) => r.user_id as string);
  if (!users.length) return none("nobody_available", refOf(a), source);
  const [people, work, away, stats] = await Promise.all([
    loadPeople(s, accts, users, now), workItems(s.inst, ids, users.map((u) => [a.id, u] as [string, string])), awayMap(s.inst),
    db`
      select z.user_id, count(*)::int n, (percentile_cont(0.5) within group (order by z.secs))::float8 med,
        (count(*) filter (where ${source ? db`z.src = ${source}` : db`false`}))::int sn, (percentile_cont(0.5) within group (order by z.secs) filter (where ${source ? db`z.src = ${source}` : db`false`}))::float8 smed
      from (select lt.touch_user_id user_id, lower(coalesce(nullif(btrim(c.source), ''), 'unknown')) src, greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at)))) secs
            from lead_touches lt left join cached_contacts c on c.installation_id = lt.installation_id and c.location_id = lt.location_id and c.contact_id = lt.contact_id
            where lt.installation_id = ${s.inst} and lt.location_id = ${a.id} and lt.touch_user_id = any(${users}::text[]) and lt.excluded is null and lt.touch_at is not null and lt.lead_at > now() - interval '90 days') z
      group by 1`,
  ]);
  const st = new Map(stats.map((r) => [r.user_id as string, r]));
  const cands: NextCandidate[] = users.flatMap((u) => {
    const p = people.get(u);
    if (!p) return [];
    const x = st.get(u);
    return [{ userId: u, name: p.name, waiting: work.get(`${a.id}|${u}`)?.waiting ?? 0, sourceN: n(x?.sn), sourceMedianSec: x?.smed === null || x?.smed === undefined ? null : Number(x.smed),
      overallN: n(x?.n), overallMedianSec: x?.med === null || x?.med === undefined ? null : Number(x.med), away: away.has(u) && (away.get(u) as number) > now, deleted: p.deleted, isAdmin: p.isAdmin }];
  });
  const res = suggestNextLead(cands, { source, includeAdmins: f.admins === true });
  return {
    location: refOf(a), source, isEstimate: true,
    suggestion: res.pick ? { userId: res.pick.userId, name: res.pick.name, reasons: res.reasons, sample: source && res.pick.sourceN >= 10 ? res.pick.sourceN : res.pick.overallN } : null,
    hidden: res.hidden,
    considered: cands.filter((c) => f.admins === true || !c.isAdmin).map((c) => ({ userId: c.userId, name: c.name, waiting: c.waiting, answersSourceMinutes: (source && c.sourceN >= 10 ? c.sourceMedianSec : c.overallMedianSec) === null ? null : Math.round((((source && c.sourceN >= 10 ? c.sourceMedianSec : c.overallMedianSec) as number) / 60) * 10) / 10, sample: source && c.sourceN >= 10 ? c.sourceN : c.overallN, away: c.away })),
  };
}

// ---- proof (the client-facing receipt of how the team handled one account's leads) ----

export async function proof(s: Scope, f: Window & { location?: string | null }, _o: { named: boolean }, days: number, now = Date.now()): Promise<Pp3Proof> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const a = f.location && accts.length === 1 ? accts[0] : null;
  const blank: Pp3Proof = {
    location: a ? refOf(a) : null, period: win(f, days), leads: 0, answered: 0, answeredPct: rate(0, 0, 10), typicalReplyMinutes: null, targetMinutes: a?.targetMinutes ?? null, inTime: rate(0, 0, 10),
    appointments: 0, showed: 0, noShow: 0, showedPct: rate(0, 0, 10), staff: null, naming: "team", lines: [], historyStarts: null, generatedAt: new Date(now).toISOString(),
  };
  if (!a) return blank;
  const [lt, ap, hist] = await Promise.all([
    db`select count(*)::int leads, (count(*) filter (where lt.touch_at is not null))::int answered,
        (count(*) filter (where lt.touch_at is not null and greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at)))) <= ${a.targetMinutes} * 60))::int in_time,
        (percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at))))) filter (where lt.touch_at is not null))::float8 med
       from lead_touches lt where lt.installation_id = ${s.inst} and lt.location_id = ${a.id} and lt.excluded is null and lt.lead_at >= ${f.from} and lt.lead_at < ${f.to}`,
    db`select (count(*) filter (where created_remote_at >= ${f.from} and created_remote_at < ${f.to} and status is distinct from 'invalid'))::int booked,
        (count(*) filter (where start_at >= ${f.from} and start_at < ${f.to} and start_at < now() and status = 'showed'))::int showed,
        (count(*) filter (where start_at >= ${f.from} and start_at < ${f.to} and start_at < now() and status = 'noshow'))::int noshow
       from cached_appointments where installation_id = ${s.inst} and location_id = ${a.id}`,
    db`select min(lead_at)::date::text d from lead_touches where installation_id = ${s.inst} and location_id = ${a.id}`,
  ]);
  const leads = n(lt[0]?.leads), answered = n(lt[0]?.answered), inTime = n(lt[0]?.in_time);
  const med = lt[0]?.med === null || lt[0]?.med === undefined ? null : Math.round((Number(lt[0].med) / 60) * 10) / 10;
  const showed = n(ap[0]?.showed), noShow = n(ap[0]?.noshow), booked = n(ap[0]?.booked);
  let staff: Pp3Proof["staff"] = null;
  // Naming staff on a client receipt is the agency's choice for THAT client (PB table people_proof_prefs, default no). The address cannot override it; only the owner and administrators ever see names.
  const pref = s.level === "all" ? await db`select name_staff from people_proof_prefs where installation_id = ${s.inst} and location_id = ${a.id}`.catch(() => []) : [];
  const named = s.level === "all" && pref[0]?.name_staff === true;
  if (named) {
    const rows = await db`select lt.touch_user_id user_id, count(*)::int answered,
        (percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at))))))::float8 med
      from lead_touches lt where lt.installation_id = ${s.inst} and lt.location_id = ${a.id} and lt.excluded is null and lt.touch_at is not null and lt.touch_user_id is not null and lt.lead_at >= ${f.from} and lt.lead_at < ${f.to}
      group by 1 order by 2 desc limit 20`;
    const people = await loadPeople(s, accts, rows.map((r) => r.user_id as string), now);
    staff = rows.map((r) => ({ name: people.get(r.user_id as string)?.name ?? "A team member", answered: n(r.answered), typicalReplyMinutes: r.med === null ? null : Math.round((Number(r.med) / 60) * 10) / 10 }));
  }
  return {
    location: refOf(a), period: win(f, days), leads, answered, answeredPct: rate(answered, leads, 10), typicalReplyMinutes: med, targetMinutes: a.targetMinutes, inTime: rate(inTime, answered, 10),
    appointments: booked, showed, noShow, showedPct: rate(showed, showed + noShow, 10), staff, naming: named ? "named" : "team",
    lines: proofLines({ leads, answered, typicalReplyMinutes: med, targetMinutes: a.targetMinutes, inTime, showed, noShow, appointments: booked, days }),
    historyStarts: (hist[0]?.d as string | null) ?? null, generatedAt: new Date(now).toISOString(),
  };
}

// ---- the rows behind every count ----

/** The exact rows behind a reason. The predicates are the same fragments workItems counts with (people3-rollup), so a count equals its rows. Keyset paging. */
export async function list(s: Scope, f: { reason: Pp3Reason; user?: string | null; location?: string | null }, o: { size: number; after?: string | null }, links: Links, now = Date.now()): Promise<Pp3List> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const names = new Map(accts.map((a) => [a.id, a.name]));
  const reason = f.reason;
  const text = REASON_TEXT[reason];
  const empty: Pp3List = { ...pageOf<Pp3ListRow>([], 0, o.size, null), reason, label: text.label };
  if (!ids.length) return empty;
  // A person without full access can only ever ask about themselves.
  const who = s.level === "self" ? s.selfId : f.user ?? null;
  if (s.level === "self" && !who) return empty;
  if (reason === "no_owner" && s.level === "self") return empty;
  const cur = decodeCursor(o.after);
  const cap = Math.min(o.size, MAX_ROWS);
  const row = (r: Record<string, unknown>, kind: Pp3ListRow["kind"], title: string, at: unknown, value: number | null, age: number | null): Pp3ListRow => ({
    id: r.id as string, contactId: (r.contact_id as string | null) ?? null, kind, title, locationId: r.location_id as string, locationName: names.get(r.location_id as string) ?? "Client account", ageHours: age, value, at: at ? iso(at) : null,
    url: r.contact_id ? links.contact(r.location_id as string, r.contact_id as string) : kind === "deal" ? links.opportunities(r.location_id as string) : links.account(r.location_id as string),
  });
  if (reason === "waiting" || reason === "waiting_old" || reason === "no_owner") {
    const own = reason === "no_owner" ? db`and ${waitingOwner()} is null` : who === NO_OWNER ? db`and ${waitingOwner()} is null` : who ? db`and ${waitingOwner()} = ${who}` : db``;
    const old = reason === "waiting_old" ? db`and ${oldWait()}` : db``;
    const base = db`${waitingFrom(s.inst, ids)} ${own} ${old}`;
    const [rows, tot] = await Promise.all([
      db`select c.location_id, c.contact_id, c.contact_name, c.conversation_id id, c.last_message_at at, (extract(epoch from c.last_message_at) * 1000)::float8 sortv ${base}
         ${cur ? db`and (extract(epoch from c.last_message_at) * 1000, c.conversation_id) > (${Number(cur.v ?? 0)}::float8, ${cur.id}::text)` : db``} order by c.last_message_at asc, c.conversation_id asc limit ${cap + 1}`,
      db`select count(*)::int c ${base}`,
    ]);
    const page = rows.slice(0, cap), last = page[page.length - 1];
    return { ...pageOf(page.map((r) => row(r, "lead", ((r.contact_name as string | null) ?? "").trim() || "Unknown contact", r.at, null, Math.max(0, Math.round((now - new Date(r.at as Date).getTime()) / 3_600_000)))), n(tot[0]?.c), cap, rows.length > cap && last ? encodeCursor({ v: Number(last.sortv), id: last.id as string }) : null), reason, label: text.label };
  }
  if (reason === "stale_deals" || reason === "open_deals") {
    const own = who ? db`and o.assigned_to = ${who}` : db``;
    const stale = reason === "stale_deals" ? db`and ${staleDeal()}` : db``;
    const base = db`${openDealsFrom(s.inst, ids)} ${own} ${stale}`;
    const [rows, tot] = await Promise.all([
      db`select o.location_id, o.contact_id, coalesce(nullif(o.contact_name, ''), o.name) contact_name, o.opportunity_id id, o.stage_name, o.monetary_value::float8 v, coalesce(o.last_stage_change_at, o.created_remote_at) at ${base}
         ${cur ? db`and (o.monetary_value::float8, o.opportunity_id) < (${Number(cur.v ?? 0)}::float8, ${cur.id}::text)` : db``} order by o.monetary_value desc, o.opportunity_id desc limit ${cap + 1}`,
      db`select count(*)::int c ${base}`,
    ]);
    const page = rows.slice(0, cap), last = page[page.length - 1];
    return { ...pageOf(page.map((r) => row(r, "deal", ((r.contact_name as string | null) ?? "").trim() || "Unnamed deal", r.at, n(r.v), null)), n(tot[0]?.c), cap, rows.length > cap && last ? encodeCursor({ v: Number(last.v), id: last.id as string }) : null), reason, label: text.label };
  }
  // needs_outcome, upcoming
  const own = who ? db`and a.assigned_to = ${who}` : db``;
  const from = reason === "upcoming" ? upcomingFrom(s.inst, ids) : needsOutcomeFrom(s.inst, ids);
  const base = db`${from} ${own}`;
  const [rows, tot] = await Promise.all([
    db`select a.location_id, a.contact_id, coalesce(nullif(a.title, ''), 'Appointment') contact_name, a.appointment_id id, a.start_at at, (extract(epoch from a.start_at) * 1000)::float8 sortv ${base}
       ${cur ? db`and (extract(epoch from a.start_at) * 1000, a.appointment_id) > (${Number(cur.v ?? 0)}::float8, ${cur.id}::text)` : db``} order by a.start_at asc, a.appointment_id asc limit ${cap + 1}`,
    db`select count(*)::int c ${base}`,
  ]);
  const page = rows.slice(0, cap), last = page[page.length - 1];
  return { ...pageOf(page.map((r) => row(r, "appointment", r.contact_name as string, r.at, null, null)), n(tot[0]?.c), cap, rows.length > cap && last ? encodeCursor({ v: Number(last.sortv), id: last.id as string }) : null), reason, label: text.label };
}

// ---- export (scorecards, at most 500 rows) ----

const esc = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export async function exportScorecards(s: Scope, f: CardFilters, days: number, now = Date.now()): Promise<{ csv: string; truncated: boolean }> {
  const head = ["Person", "Accounts", "Leads answered first", "Typical first reply (minutes)", "Answered in time (%)", "Appointments set", "Showed (%)", "Deals won", "Won value", "Waiting for a reply now"];
  const lines = [head.join(",")];
  let after: string | null = null, count = 0, truncated = false;
  for (let i = 0; i < 6; i++) {
    const r = await scorecards(s, f, { sort: "answered", after, size: 100 }, days, now);
    for (const c of r.rows) {
      if (count >= MAX_ROWS) { truncated = true; break; }
      count++;
      lines.push([
        c.person.name, c.accounts, c.answeredFirst.current, c.typicalReplySeconds === null ? "" : Math.round((c.typicalReplySeconds / 60) * 10) / 10, c.inTime.value === null ? "" : Math.round(c.inTime.value * 100),
        c.apptsSet.current, c.showed.value === null ? "" : Math.round(c.showed.value * 100), c.wonCount, Math.round(c.wonValue.current), c.waiting,
      ].map(esc).join(","));
    }
    after = r.next;
    if (!after || truncated) { truncated = truncated || false; break; }
    if (count >= MAX_ROWS) { truncated = !!after; break; }
  }
  return { csv: lines.join("\n"), truncated };
}

export { median };
export type { Frag, Pp3Person };
