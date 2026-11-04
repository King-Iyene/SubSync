import { sql } from "../db";
import { MIN_CLOSED_DEALS } from "./metrics";
import { EXCLUSION_LABEL, type Exclusion } from "./lead-rules";
import { resolveUser, type PersonLabel } from "./people-labels";
import { leadOut, type LeadOut, type LoadedRow, type Lookups } from "./speed-parts";
import { loadLookups, loadRows, loadTargets } from "./speed-queries";
import { autoVsHuman, hasNoSource, judge, progressToward, summarise, unknownSource, weeklyTrend, MIN_FOR_MEDIAN, type Summary } from "./speed-intel";
import {
  compareAccounts, comparePeople, costEstimate, costFormula, costLine, DAY, headlineOf, judgedCount, nextBestAction, pageOf, parseTarget, pctOf, selectLeads, suggestReplier, typicalLine,
  waitingFacts, WAITING_WINDOW_DAYS, type AccountFacts, type LeadQuery, type LeadSort, type LeadStatusFilter, type Suggestion,
} from "./speed-v2";
import type { Win } from "./speed-window";

// The data behind the rebuilt Speed to lead screen. Every list and figure is chosen by selectLeads / summarise (speed-v2.ts, speed-intel.ts) from the same rows, so a
// number and the list behind it are one thing. Read only, except setAccountTarget (one reply target, typed by the person, on one client account). Nothing here
// reads outside the accounts the router allowed: every query is bound to `allowed`.

const HISTORY_DAYS = 56;
/** The rows that hold the headline's window and the weekly bars: a bit more than 8 weeks, never more than the loader's own cap. */
export const SPEED_HOME_ROWS_CAP = 20_000;

export type LeadRowOut = LeadOut & {
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null;
  /** Only for a lead nobody owns: the person in that account who replies fastest. A display, never an assignment. */
  suggestion: { label: string; medianSeconds: number; replies: number } | null;
};

function rowOut(r: LoadedRow, status: Parameters<typeof leadOut>[1], lk: Lookups, suggestions: ReadonlyMap<string, Suggestion | null>): LeadRowOut {
  const base = leadOut(r, status, lk);
  const sg = r.assignedTo === null ? suggestions.get(r.locationId) ?? null : null;
  return {
    ...base, phone: r.phone ?? null, email: r.email ?? null, dnd: r.dnd === true, timeZone: r.timeZone ?? null,
    suggestion: sg ? { label: resolveUser(sg.userId, lk.team, lk.usersAccess.get(r.locationId)).label, medianSeconds: sg.medianSeconds, replies: sg.replies } : null,
  };
}

function suggestionsFor(rows: readonly LoadedRow[], accounts: Iterable<string>): Map<string, Suggestion | null> {
  const out = new Map<string, Suggestion | null>();
  for (const a of accounts) out.set(a, suggestReplier(rows, a));
  return out;
}

const personOut = (userId: string, rows: readonly LoadedRow[], lk: Lookups): PersonLabel => {
  const sample = rows.find((r) => r.userId === userId);
  return resolveUser(userId, lk.team, sample ? lk.usersAccess.get(sample.locationId) : null);
};

/** What the won and lost deals of each account say about its average deal and win rate (the same rule as the Account audit: a win rate needs 20 closed deals). */
async function accountFacts(installationId: string, allowed: string[] | null): Promise<AccountFacts[] | null> {
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

const inWindow = (rows: readonly LoadedRow[], w: Pick<Win, "fromMs" | "toMs">) => rows.filter((r) => r.leadAt >= w.fromMs && r.leadAt < w.toMs);
const weekRange = (now: number, i: number) => ({ start: now - (i + 1) * 7 * DAY, end: now - i * 7 * DAY });

export type HomeInput = {
  installationId: string; allowed: string[] | null; targetMinutes: number; now: number; win: Win; cmp: Win | null;
  /** A client's staff do not get a ranking of their colleagues. */
  seePeople: boolean; canChangeTarget: boolean;
};

/** Everything the first screen shows, bounded: 5 rows of each list, 8 weekly bars, one line of cost. The long lists come from speedList and speedCompare. */
export async function speedHome(i: HomeInput) {
  const db = sql();
  const [{ locs, lk }, targets, facts, left] = await Promise.all([
    loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now),
    loadTargets(db, i.installationId),
    accountFacts(i.installationId, i.allowed),
    db`select t.excluded, count(*)::int n from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
       where t.installation_id = ${i.installationId} and t.excluded is not null and t.lead_at > ${new Date(i.win.fromMs)} and t.lead_at < ${new Date(i.win.toMs)}
         ${i.allowed ? db`and t.location_id = any(${i.allowed}::text[])` : db``} group by 1 order by 2 desc`.catch(() => []),
  ]);
  const earliest = Math.min(i.win.fromMs, i.cmp?.fromMs ?? Infinity, i.now - HISTORY_DAYS * DAY, i.now - WAITING_WINDOW_DAYS * DAY);
  const all = await loadRows(db, i.installationId, i.allowed, earliest, i.now + DAY);
  const o = { targetMinutes: i.targetMinutes, now: i.now, accounts: lk.locationNames };

  // ---- right now: the leads waiting (last 14 days), the one counting rule Today uses ----
  const recent = all.filter((r) => r.leadAt > i.now - WAITING_WINDOW_DAYS * DAY);
  const wf = waitingFacts(recent, o);
  const waitingAll = selectLeads(recent, o, { status: "waiting" });
  const sugg = suggestionsFor(inWindow(all, i.win), new Set(waitingAll.slice(0, 5).map((x) => x.row.locationId)));
  const waitingRows = waitingAll.slice(0, 5).map((x) => rowOut(x.row, x.status, lk, sugg));
  const byAccount = new Map<string, number>();
  for (const x of waitingAll) byAccount.set(x.row.locationId, (byAccount.get(x.row.locationId) ?? 0) + 1);
  const cost = costEstimate(byAccount, facts ?? []);

  // ---- the picture over the chosen window ----
  const win = inWindow(all, i.win);
  const summary = summarise(win, i.targetMinutes, i.now);
  const cmpSummary: Summary | null = i.cmp ? summarise(inWindow(all, i.cmp), i.targetMinutes, i.now) : null;
  const trend = weeklyTrend(all, i.targetMinutes, i.now);
  const accountRows = compareAccounts(win, o);
  const peopleRows = i.seePeople ? comparePeople(win) : [];
  const multi = locs.length > 1;
  const slowest = accountRows.find((a) => a.ranked && a.hitRate !== null) ?? null;
  const un = unknownSource(win.filter((r) => judge(r, i.targetMinutes, i.now) !== null));
  const endsToday = i.win.to === new Date(i.now).toISOString().slice(0, 10);
  const windowWords = endsToday ? (i.win.days === 1 ? "last day" : `last ${i.win.days} days`) : "this period";

  const next = nextBestAction({
    waiting: wf.waiting, noOwner: wf.noOwner, slowestAccount: multi && slowest ? { name: slowest.name, hitRate: slowest.hitRate as number } : null,
    unknownSourceShare: un.actionable ? un.share : null, typicalSeconds: summary.medianSeconds, canChangeTarget: i.canChangeTarget,
  });

  const accountsView = accountRows.map((a) => ({ ...a, targetMinutes: targets.map.get(a.id) ?? i.targetMinutes, ownTarget: targets.map.has(a.id) }));
  return {
    now: i.now, targetMinutes: i.targetMinutes, targetsReady: targets.ready, canChangeTarget: i.canChangeTarget,
    access: { ok: locs.filter((l) => l.speed_access === "ok").length, needsPermission: locs.filter((l) => l.speed_access === "needs_permission").map((l) => ({ locationId: l.location_id as string, name: lk.locationNames.get(l.location_id as string) as string })), total: locs.length },
    accounts: locs.map((l) => ({ locationId: l.location_id as string, name: lk.locationNames.get(l.location_id as string) as string, targetMinutes: targets.map.get(l.location_id as string) ?? i.targetMinutes, ownTarget: targets.map.has(l.location_id as string) })).slice(0, multi ? 0 : 1),
    waiting: { ...wf, headline: headlineOf(wf, multi), rows: waitingRows, cost: { line: costLine(cost), formula: costFormula(cost), amount: cost.amount, leftOutAccounts: cost.leftOutAccounts } },
    window: { from: i.win.from, to: i.win.to, days: i.win.days, words: windowWords },
    summary: { ...summary, judged: judgedCount(summary), pct: pctOf(summary.withinTarget, judgedCount(summary)), typical: progressToward(summary.answered, MIN_FOR_MEDIAN, "replies"), typicalLine: typicalLine(summary, windowWords) },
    compare: cmpSummary && i.cmp ? { window: { from: i.cmp.from, to: i.cmp.to }, summary: { ...cmpSummary, judged: judgedCount(cmpSummary) } } : null,
    trend: trend.map((w, k) => ({ ...w, index: trend.length - 1 - k })),
    autoVsHuman: autoVsHuman(win, i.targetMinutes, i.now),
    noSource: { n: un.n, total: un.total, share: un.share, actionable: un.actionable },
    compareAccounts: { total: accountRows.length, rows: accountsView.slice(0, 5) },
    comparePeople: { total: peopleRows.length, rows: peopleRows.slice(0, 5).map((p) => ({ ...p, ...personOut(p.userId, win, lk) })) },
    leftOut: left.map((r) => ({ reason: r.excluded as string, label: EXCLUSION_LABEL[r.excluded as Exclusion] ?? (r.excluded as string), n: r.n as number })),
    next,
    truncated: all.length >= SPEED_HOME_ROWS_CAP,
  };
}

// ---------- one list, searched, sorted, filtered and paged on the server ----------

export type ListInput = {
  installationId: string; allowed: string[] | null; targetMinutes: number; now: number; meId: string | null;
  status: LeadStatusFilter; win: Win | null; person: string | null; account: string | null; owner: string | null; noSource: boolean; week: number | null;
  q: string; sort: LeadSort; page: number; size: number;
};

/** The leads behind a number. Waiting leads (and "only an automatic message") are always about right now (the last 14 days); any other status needs its window. */
export async function speedList(i: ListInput) {
  const db = sql();
  const { lk } = await loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now);
  const nowStatus = i.status === "waiting" || i.status === "onlyAuto";
  const fromMs = nowStatus && !i.win ? i.now - WAITING_WINDOW_DAYS * DAY : i.week !== null ? weekRange(i.now, i.week).start : (i.win?.fromMs ?? i.now - 30 * DAY);
  const toMs = i.week !== null ? weekRange(i.now, i.week).end + 1 : i.win?.toMs ?? i.now + DAY;
  const all = await loadRows(db, i.installationId, i.allowed, fromMs, Math.min(toMs, i.now + DAY));
  const o = { targetMinutes: i.targetMinutes, now: i.now, accounts: lk.locationNames };
  const base: LeadQuery = {
    status: i.status, person: i.person, account: i.account, q: i.q, sort: i.sort,
    extra: (r) => {
      if (nowStatus && !i.win && r.leadAt <= i.now - WAITING_WINDOW_DAYS * DAY) return false;
      if (i.week !== null) { const w = weekRange(i.now, i.week); if (!(r.leadAt > w.start && r.leadAt <= w.end)) return false; }
      return i.noSource ? hasNoSource(r) : true;
    },
  };
  const owner = i.owner === "me" ? (i.meId ?? "__nobody__") : i.owner;
  const everyone = selectLeads(all, o, base);
  const chosen = owner ? selectLeads(all, o, { ...base, owner }) : everyone;
  const pg = pageOf(chosen, i.page, i.size);
  const sugg = suggestionsFor(all, new Set(pg.rows.map((x) => x.row.locationId)));
  return {
    total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to,
    // How many the chips would show: all of them, the ones nobody owns, and the ones that belong to the person asking.
    facets: { all: everyone.length, noOwner: everyone.filter((x) => x.row.assignedTo === null).length, mine: i.meId ? everyone.filter((x) => x.row.assignedTo === i.meId).length : 0, never: everyone.filter((x) => x.status === "waiting" && (i.now - x.row.leadAt) / 60_000 > 3 * 24 * 60).length },
    rows: pg.rows.map((x) => rowOut(x.row, x.status, lk, sugg)),
    truncated: all.length >= SPEED_HOME_ROWS_CAP,
  };
}

// ---------- the comparison lists (clients, people), searched and paged ----------

export type CompareInput = { installationId: string; allowed: string[] | null; targetMinutes: number; now: number; win: Win; by: "account" | "person"; q: string; page: number; size: number; seePeople: boolean };
export async function speedCompare(i: CompareInput) {
  const db = sql();
  const [{ lk }, targets] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadTargets(db, i.installationId)]);
  const rows = inWindow(await loadRows(db, i.installationId, i.allowed, i.win.fromMs, Math.min(i.win.toMs, i.now + DAY)), i.win);
  const q = i.q.trim().toLowerCase();
  if (i.by === "person") {
    if (!i.seePeople) return { by: "person" as const, total: 0, page: 0, pages: 1, from: 0, to: 0, rows: [] };
    const named = comparePeople(rows).map((p) => ({ ...p, ...personOut(p.userId, rows, lk) })).filter((p) => !q || p.label.toLowerCase().includes(q));
    const pg = pageOf(named, i.page, i.size);
    return { by: "person" as const, total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows };
  }
  const o = { targetMinutes: i.targetMinutes, now: i.now, accounts: lk.locationNames };
  const accs = compareAccounts(rows, o).filter((a) => !q || a.name.toLowerCase().includes(q)).map((a) => ({ ...a, targetMinutes: targets.map.get(a.id) ?? i.targetMinutes, ownTarget: targets.map.has(a.id) }));
  const pg = pageOf(accs, i.page, i.size);
  return { by: "account" as const, total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows };
}

// ---------- the one write: a reply target typed by a person, on one client account ----------

export async function setAccountTarget(installationId: string, allowed: string[] | null, locationId: string, minutes: unknown): Promise<{ ok: true; minutes: number | null } | { ok: false; status: number; error: string }> {
  const parsed = minutes === null ? ({ ok: true, minutes: null } as const) : parseTarget(minutes);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  if (allowed && !allowed.includes(locationId)) return { ok: false, status: 404, error: "Client account not found." };
  const db = sql();
  try {
    const r = await db`update locations set speed_target_minutes = ${parsed.minutes} where installation_id = ${installationId} and location_id = ${locationId} returning location_id`;
    if (r.length === 0) return { ok: false, status: 404, error: "Client account not found." };
  } catch {
    return { ok: false, status: 503, error: "Saving a target for one client needs the latest database update, which has not run yet. The default target in Settings still works." };
  }
  return { ok: true, minutes: parsed.minutes };
}
