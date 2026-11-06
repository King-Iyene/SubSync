import { autoVsHumanSql, listPage, noSourceSql, peopleGrouped, summaries, suggestions, topWaiting, waitingDeals, waitingNow, weeklyBars, type ListFilter, type Scope } from "./speed-sql";
import { waitingMoneyLine } from "./waiting-money";
import { sql } from "../db";
import { MIN_CLOSED_DEALS } from "./metrics";
import { EXCLUSION_LABEL, type Exclusion } from "./lead-rules";
import { resolveUser, type PersonLabel } from "./people-labels";
import { leadOut, type LeadOut, type LoadedRow, type Lookups } from "./speed-parts";
import { loadLookups, loadTargets } from "./speed-queries";
import { progressToward, MIN_FOR_MEDIAN, type Summary } from "./speed-intel";
import {
  compareAccountsOf, comparePeopleOf, costEstimate, costFormula, costLine, DAY, headlineOf, judgedCount, MAX_PAGE, nextBestAction, pageOf, parseTarget, pctOf, suggestReplier, typicalLine,
  WAITING_WINDOW_DAYS, type WaitingFacts, type AccountFacts, type LeadSort, type LeadStatusFilter, type Suggestion,
} from "./speed-v2";
import type { Win } from "./speed-window";

// The data behind the rebuilt Speed to lead screen. Every list and figure is chosen by selectLeads / summarise (speed-v2.ts, speed-intel.ts) from the same rows, so a
// number and the list behind it are one thing. Read only, except setAccountTarget (one reply target, typed by the person, on one client account). Nothing here
// reads outside the accounts the router allowed: every query is bound to `allowed`.

const HISTORY_DAYS = 56;
/** The rows that hold the headline's window and the weekly bars: a bit more than 8 weeks, never more than the loader's own cap. */
export const SPEED_HOME_ROWS_CAP = 20_000;

export type LeadRowOut = LeadOut & {
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; /** When the lead arrived (ms); the delay reason uses it. */ leadAt: number;
  /** Only for a lead nobody owns: the person in that account who replies fastest. A display, never an assignment. */
  suggestion: { userId: string; label: string; medianSeconds: number; replies: number } | null;
};

export function rowOut(r: LoadedRow, status: Parameters<typeof leadOut>[1], lk: Lookups, suggestions: ReadonlyMap<string, Suggestion | null>): LeadRowOut {
  const base = leadOut(r, status, lk);
  const sg = r.assignedTo === null ? suggestions.get(r.locationId) ?? null : null;
  return {
    ...base, leadAt: r.leadAt, phone: r.phone ?? null, email: r.email ?? null, dnd: r.dnd === true, timeZone: r.timeZone ?? null,
    suggestion: sg ? { userId: sg.userId, label: resolveUser(sg.userId, lk.team, lk.usersAccess.get(r.locationId)).label, medianSeconds: sg.medianSeconds, replies: sg.replies } : null,
  };
}

export function suggestionsFor(rows: readonly LoadedRow[], accounts: Iterable<string>): Map<string, Suggestion | null> {
  const out = new Map<string, Suggestion | null>();
  for (const a of accounts) out.set(a, suggestReplier(rows, a));
  return out;
}

/** What the won and lost deals of each account say about its average deal and win rate (the same rule as the Account audit: a win rate needs 20 closed deals). */
export async function accountFacts(installationId: string, allowed: string[] | null): Promise<AccountFacts[] | null> {
  try {
    const db = sql();
    const rows = await db`
      select location_id,
        count(*) filter (where status = 'won')::int won, count(*) filter (where status = 'lost')::int lost,
        coalesce(sum(monetary_value) filter (where status = 'won'), 0)::float8 won_value,
        count(*) filter (where status = 'open' and coalesce(monetary_value, 0) > 0 and assigned_to is not null)::int open_n,
        coalesce(sum(monetary_value) filter (where status = 'open' and coalesce(monetary_value, 0) > 0 and assigned_to is not null), 0)::float8 open_value
      from cached_opportunities where installation_id = ${installationId} ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} group by location_id`;
    return rows.map((r) => {
      const closed = (r.won as number) + (r.lost as number);
      return {
        locationId: r.location_id as string, winRate: closed >= MIN_CLOSED_DEALS ? (r.won as number) / closed : null,
        avgDealValue: (r.won as number) > 0 ? (r.won_value as number) / (r.won as number) : (r.open_n as number) > 0 ? (r.open_value as number) / (r.open_n as number) : null,
      };
    });
  } catch {
    return null;
  }
}
const weekRange = (now: number, i: number) => ({ start: now - (i + 1) * 7 * DAY, end: now - i * 7 * DAY });

export type HomeInput = {
  installationId: string; allowed: string[] | null; targetMinutes: number; now: number; win: Win; cmp: Win | null;
  /** A client's staff do not get a ranking of their colleagues. */
  seePeople: boolean; canChangeTarget: boolean;
};

/** Everything the first screen shows, bounded: 5 rows of each list, 8 weekly bars, one line of cost. Every figure is an SQL aggregate (speed-sql.ts), exact at 100,000+ leads per account. The long lists come from speedList and speedCompare. */
export async function speedHome(i: HomeInput) {
  const db = sql();
  const targets = await loadTargets(db, i.installationId);
  const sc = (fromMs: number, toMs: number): Scope => ({ installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs, toMs, targetsReady: targets.ready });
  const winS = sc(i.win.fromMs - 1, Math.min(i.win.toMs, i.now + DAY));
  const waitS = sc(i.now - WAITING_WINDOW_DAYS * DAY, i.now + DAY);
  const [{ locs, lk }, facts, left, sumWin, sumCmp, trend, wn, wd, top, ppl, auto, noSrc] = await Promise.all([
    loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now),
    accountFacts(i.installationId, i.allowed),
    db`select t.excluded, count(*)::int n from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
       where t.installation_id = ${i.installationId} and t.excluded is not null and t.lead_at > ${new Date(i.win.fromMs)} and t.lead_at < ${new Date(i.win.toMs)}
         ${i.allowed ? db`and t.location_id = any(${i.allowed}::text[])` : db``} group by 1 order by 2 desc`.catch(() => []),
    summaries(db, winS),
    i.cmp ? summaries(db, sc(i.cmp.fromMs - 1, Math.min(i.cmp.toMs, i.now + DAY))) : Promise.resolve(null),
    weeklyBars(db, sc(i.now - HISTORY_DAYS * DAY, i.now + DAY)),
    waitingNow(db, waitS),
    waitingDeals(db, waitS).catch(() => null),
    topWaiting(db, waitS, 5),
    i.seePeople ? peopleGrouped(db, winS) : Promise.resolve([]),
    autoVsHumanSql(db, winS),
    noSourceSql(db, winS),
  ]);
  const wf: WaitingFacts = wn.facts;
  const sugg = await suggestions(db, winS, [...new Set(top.map((x) => x.row.locationId))]);
  const waitingRows = top.map((x) => rowOut(x.row, x.status, lk, sugg));
  const cost = costEstimate(wn.byAccount, facts ?? []);
  const money = wd ? { people: wf.waiting, peopleWithDeals: wd.peopleWithDeals, deals: wd.deals, dollars: wd.dollars, byLocation: [] } : null;
  const clients = [...wn.byAccount].map(([locationId, count]) => ({ locationId, name: lk.locationNames.get(locationId) ?? "Client account", count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // ---- the picture over the chosen window ----
  const summary = sumWin.overall;
  const cmpSummary: Summary | null = sumCmp ? sumCmp.overall : null;
  const accountRows = compareAccountsOf(sumWin.byLoc, lk.locationNames);
  const peopleRows = i.seePeople ? comparePeopleOf(ppl) : [];
  const personLoc = new Map(ppl.map((p) => [p.userId, p.locationId]));
  const multi = locs.length > 1;
  const slowest = accountRows.find((a) => a.ranked && a.hitRate !== null) ?? null;
  const un = noSrc;
  const endsToday = i.win.to === new Date(i.now).toISOString().slice(0, 10);
  const windowWords = endsToday ? (i.win.days === 1 ? "last day" : `last ${i.win.days} days`) : "this period";

  const next = nextBestAction({
    waiting: wf.waiting, noOwner: wf.noOwner, slowestAccount: multi && slowest ? { name: slowest.name, hitRate: slowest.hitRate as number } : null,
    unknownSourceShare: un.actionable ? un.share : null, typicalSeconds: summary.medianSeconds, canChangeTarget: i.canChangeTarget,
  });

  const accountsView = accountRows.map((a) => ({ ...a, targetMinutes: targets.map.get(a.id) ?? i.targetMinutes, ownTarget: targets.map.has(a.id) }));
  return {
    now: i.now, targetMinutes: i.targetMinutes, targetsReady: targets.ready, canChangeTarget: i.canChangeTarget,
    access: { ok: locs.filter((l) => l.speed_access === "ok").length, needsPermission: locs.filter((l) => l.speed_access === "needs_permission").slice(0, 100).map((l) => ({ locationId: l.location_id as string, name: lk.locationNames.get(l.location_id as string) as string })), total: locs.length },
    accounts: locs.map((l) => ({ locationId: l.location_id as string, name: lk.locationNames.get(l.location_id as string) as string, targetMinutes: targets.map.get(l.location_id as string) ?? i.targetMinutes, ownTarget: targets.map.has(l.location_id as string) })).slice(0, multi ? 0 : 1),
    waiting: { ...wf, headline: headlineOf(wf, multi), rows: waitingRows, clients: clients.slice(0, 50), clientsTotal: clients.length, money: { line: waitingMoneyLine(money, "Next best step: reply to the lead that has waited longest."), dollars: money?.dollars ?? 0, peopleWithDeals: money?.peopleWithDeals ?? 0, deals: money?.deals ?? 0 }, cost: { line: costLine(cost), formula: costFormula(cost), amount: cost.amount, leftOutAccounts: cost.leftOutAccounts } },
    window: { from: i.win.from, to: i.win.to, days: i.win.days, words: windowWords },
    summary: { ...summary, judged: judgedCount(summary), pct: pctOf(summary.withinTarget, judgedCount(summary)), typical: progressToward(summary.answered, MIN_FOR_MEDIAN, "replies"), typicalLine: typicalLine(summary, windowWords) },
    compare: cmpSummary && i.cmp ? { window: { from: i.cmp.from, to: i.cmp.to }, summary: { ...cmpSummary, judged: judgedCount(cmpSummary) } } : null,
    trend: trend.map((w, k) => ({ ...w, index: trend.length - 1 - k })),
    autoVsHuman: auto,
    noSource: { n: un.n, total: un.total, share: un.share, actionable: un.actionable },
    compareAccounts: { total: accountRows.length, rows: accountsView.slice(0, 5) },
    comparePeople: { total: peopleRows.length, rows: peopleRows.slice(0, 5).map((p) => ({ ...p, ...resolveUser(p.userId, lk.team, lk.usersAccess.get(personLoc.get(p.userId) ?? "")) })) },
    leftOut: left.map((r) => ({ reason: r.excluded as string, label: EXCLUSION_LABEL[r.excluded as Exclusion] ?? (r.excluded as string), n: r.n as number })),
    next,
    truncated: false,
  };
}

// ---------- one list, searched, sorted, filtered and paged on the server ----------

export type ListInput = {
  installationId: string; allowed: string[] | null; targetMinutes: number; now: number; meId: string | null;
  status: LeadStatusFilter; win: Win | null; person: string | null; account: string | null; owner: string | null; noSource: boolean; week: number | null; /** A UTC day (YYYY-MM-DD): leads that arrived that day, or whose first reply came that day. */ day?: string | null; replyDay?: string | null;
  q: string; sort: LeadSort; page: number; size: number;
};

/** The leads behind a number. Waiting leads (and "only an automatic message") are always about right now (the last 14 days); any other status needs its window. Cut in the database: where, order, limit, offset. */
export async function speedList(i: ListInput) {
  const db = sql();
  const [{ lk }, targets] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadTargets(db, i.installationId)]);
  const nowStatus = i.status === "waiting" || i.status === "onlyAuto";
  const fromMs = nowStatus && !i.win ? i.now - WAITING_WINDOW_DAYS * DAY : i.week !== null ? weekRange(i.now, i.week).start : (i.win?.fromMs ?? i.now - 30 * DAY);
  const toMs = i.week !== null ? weekRange(i.now, i.week).end + 1 : i.win?.toMs ?? i.now + DAY;
  const allowed = i.account ? (!i.allowed || i.allowed.includes(i.account) ? [i.account] : []) : i.allowed;
  const s: Scope = { installationId: i.installationId, allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs, toMs: Math.min(toMs, i.now + DAY), targetsReady: targets.ready };
  const size = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number.isFinite(i.size) ? i.size : 25)));
  const f: ListFilter = {
    status: i.status, person: i.person, owner: i.owner === "me" ? (i.meId ?? "__nobody__") : i.owner, meId: i.meId, q: i.q, sort: i.sort, noSource: i.noSource,
    newerThanMs: nowStatus && !i.win ? i.now - WAITING_WINDOW_DAYS * DAY : null, weekRange: i.week !== null ? weekRange(i.now, i.week) : null, day: i.day ?? null, replyDay: i.replyDay ?? null,
  };
  const pg = await listPage(db, s, f, i.page, size);
  const sugg = await suggestions(db, s, [...new Set(pg.rows.map((x) => x.row.locationId))]);
  return {
    total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to,
    // How many the chips would show: all of them, the ones nobody owns, and the ones that belong to the person asking.
    facets: pg.facets,
    rows: pg.rows.map((x) => rowOut(x.row, x.status, lk, sugg)),
    truncated: false,
  };
}

// ---------- the comparison lists (clients, people), searched and paged ----------

export type CompareInput = { installationId: string; allowed: string[] | null; targetMinutes: number; now: number; win: Win; by: "account" | "person"; q: string; page: number; size: number; seePeople: boolean };
export async function speedCompare(i: CompareInput) {
  const db = sql();
  const [{ lk }, targets] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadTargets(db, i.installationId)]);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: i.win.fromMs - 1, toMs: Math.min(i.win.toMs, i.now + DAY), targetsReady: targets.ready };
  const q = i.q.trim().toLowerCase();
  if (i.by === "person") {
    if (!i.seePeople) return { by: "person" as const, total: 0, page: 0, pages: 1, from: 0, to: 0, rows: [] };
    const ppl = await peopleGrouped(db, s);
    const loc = new Map(ppl.map((p) => [p.userId, p.locationId]));
    const named = comparePeopleOf(ppl).map((p) => ({ ...p, ...resolveUser(p.userId, lk.team, lk.usersAccess.get(loc.get(p.userId) ?? "")) })).filter((p) => !q || p.label.toLowerCase().includes(q));
    const pg = pageOf(named, i.page, i.size);
    return { by: "person" as const, total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows };
  }
  const { byLoc } = await summaries(db, s);
  const accs = compareAccountsOf(byLoc, lk.locationNames).filter((a) => !q || a.name.toLowerCase().includes(q)).map((a) => ({ ...a, targetMinutes: targets.map.get(a.id) ?? i.targetMinutes, ownTarget: targets.map.has(a.id) }));
  const pg = pageOf(accs, i.page, i.size);
  return { by: "account" as const, total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows };
}

// ---------- the one write: a reply target typed by a person, on one client account ----------

export async function setAccountTarget(installationId: string, allowed: string[] | null, locationId: string, minutes: unknown): Promise<{ ok: true; minutes: number | null } | { ok: false; status: number; error: string }> {
  const parsed = minutes === null ? ({ ok: true, minutes: null } as const) : parseTarget(minutes);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  if (allowed && !allowed.includes(locationId)) return { ok: false, status: 404, error: "Client account not found." };
  const db = sql();
  // The account must be one of THIS company's before anything is written (another company's account is simply "not found", with or without the database update).
  const mine = await db`select 1 from locations where installation_id = ${installationId} and location_id = ${locationId}`;
  if (mine.length === 0) return { ok: false, status: 404, error: "Client account not found." };
  try {
    const r = await db`update locations set speed_target_minutes = ${parsed.minutes} where installation_id = ${installationId} and location_id = ${locationId} returning location_id`;
    if (r.length === 0) return { ok: false, status: 404, error: "Client account not found." };
  } catch {
    return { ok: false, status: 503, error: "Saving a target for one client needs the latest database update, which has not run yet. The default target in Settings still works." };
  }
  return { ok: true, minutes: parsed.minutes };
}
