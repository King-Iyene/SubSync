import { sql } from "../db";
import { resolveUser } from "./people-labels";
import { loadLookups, loadTargets } from "./speed-queries";
import { suggestions, type Scope } from "./speed-sql";
import { dayCountsSql, eventsRecorded, personAgg, type PersonAgg, readySql, reasonsSql, velocitySql, waitingCountSql } from "./speed-sql-cards";
import { rowOut, type LeadRowOut } from "./speed-v2-queries";
import { DAY } from "./speed-v3";
import type { Input } from "./speed-v4-queries";
import { daysWaiting, nextStepNone, REASONS, type PersonLine, type ReasonKey } from "./speed6";

// The reads behind the Speed to lead "pulse" cards (stage SPEED6, rebuilt on SQL aggregates in SPEED7): new leads and first replies by day, the closing velocity, the person table, the ready-to-act list and the
// main reasons leads wait. Read only, bound to the accounts the router allowed. Every count is an aggregate over the lead set (speed-sql.ts), so a client with 100,000 leads is counted exactly and the answer stays
// small: lists are a sample of 40 per group. No message text is read.
export async function speedPulse(i: Input) {
  const db = sql();
  const f = i.filter ?? {};
  const targets = await loadTargets(db, i.installationId);
  const from = i.winFrom ?? i.now - 30 * DAY;
  const to = i.winTo ?? i.now + DAY;
  const dayTo = Math.min(to, i.now + DAY);
  const s: Scope = { installationId: i.installationId, allowed: i.allowed, targetMinutes: i.targetMinutes, now: i.now, fromMs: from, toMs: to, targetsReady: targets.ready };
  const recorded = await eventsRecorded(db, s);
  const [{ lk }, days, vel, reasons, ready, people, waitingTotal] = await Promise.all([
    loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now),
    dayCountsSql(db, { ...s, fromMs: from - 1, toMs: dayTo }, f),
    velocitySql(db, s, f),
    reasonsSql(db, s, f),
    readySql(db, s, f, 12),
    i.seePeople ? personAgg(db, s, f, recorded) : Promise.resolve({ aggs: [] as PersonAgg[], sample: new Map() as Awaited<ReturnType<typeof personAgg>>["sample"] }),
    waitingCountSql(db, s, f),
  ]);
  const locs = new Set<string>([...[...reasons.sample.values()].flat().map((x) => x.row.locationId), ...ready.map((x) => x.row.locationId), ...[...people.sample.values()].flat().map((x) => x.row.locationId)]);
  const sugg = await suggestions(db, s, [...locs]);
  const out = (r: Parameters<typeof rowOut>[0], st: Parameters<typeof rowOut>[1]): LeadRowOut => rowOut(r, st, lk, sugg);

  const readyOut = ready.map((x) => {
    const waited = Math.max(0, Math.round((i.now - x.row.leadAt) / 60_000));
    return { ...out(x.row, x.status), dollars: x.dollars, days: daysWaiting(waited), nextStepNone: nextStepNone({ touched: false, booked: false }) };
  });

  const bars = [...reasons.counts].map(([key, n]) => ({ key: key as ReasonKey | "unclear", label: key === "unclear" ? "No clear reason" : REASONS[key as ReasonKey].label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((b) => ({ ...b, rows: (reasons.sample.get(b.key) ?? []).map((x) => out(x.row, x.status)) }));

  const lines: PersonLine[] = people.aggs.map((a) => ({
    key: a.owner ?? "__none", name: a.owner ? resolveUser(a.owner, lk.team, lk.usersAccess.get(a.loc)).label : "Unassigned", leads: a.leads, replied: a.replied, booked: a.booked, showed: a.showed,
    rate: a.leads >= 5 ? Math.round((a.booked / a.leads) * 100) : null, unassigned: !a.owner,
  })).sort((a, b) => Number(a.unassigned) - Number(b.unassigned) || b.leads - a.leads || a.name.localeCompare(b.name));

  return {
    now: i.now, from, to: dayTo, total: days.total, truncated: false,
    leadsByDay: days.leadsByDay, repliesByDay: days.repliesByDay, velocity: vel,
    people: i.seePeople ? lines.slice(0, 40).map((p, n) => ({ ...p, sample: (n >= 12 ? [] : people.sample.get(p.key) ?? []).map((x) => ({ row: out(x.row, x.status), replied: x.replied, booked: x.booked, showed: x.showed })) })) : [],
    ready: readyOut, reasons: bars as Array<{ key: ReasonKey | "unclear"; label: string; n: number; rows: LeadRowOut[] }>,
    waitingTotal,
  };
}

/** Exact counts by day straight from the database (an aggregate, never a row read): leads that arrived by day, and first replies by day for those leads. Days are UTC days. */
export async function pulseDayCounts(installationId: string, allowed: string[] | null, fromMs: number, toMs: number) {
  const targets = await loadTargets(sql(), installationId);
  return dayCountsSql(sql(), { installationId, allowed, targetMinutes: 15, now: Date.now(), fromMs: fromMs - 1, toMs, targetsReady: targets.ready }, {});
}
