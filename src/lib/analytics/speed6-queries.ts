import { sql } from "../db";
import { judge } from "./speed-intel";
import { loadLookups, loadRows } from "./speed-queries";
import { rowOut, suggestionsFor, type LeadRowOut } from "./speed-v2-queries";
import { DAY } from "./speed-v3";
import { outcomesOf } from "./speed-v3-queries";
import { applyFilter, journeyReach } from "./speed-v4-more";
import { repliedSet, type Input } from "./speed-v4-queries";
import { dayCounts, daysWaiting, delayReasons, nextStepNone, personTable, readyScore, reasonBars, rowId, velocity, type ReasonKey } from "./speed6";
import { countedDealsOf } from "./waiting-money-queries";

// The reads behind the Speed to lead "pulse" cards (stage SPEED6): new leads and first replies by day, the closing velocity, the person table, the ready-to-act list and the main reasons
// leads wait. Read only, bound to the accounts the router allowed. Every count here is taken from the same rows that are returned, so a number and its list agree. No message text is read.
const SAMPLE = 40;
const MAX_OUT = 1500;

export async function speedPulse(i: Input) {
  const db = sql();
  const o = { targetMinutes: i.targetMinutes, now: i.now };
  const from = i.winFrom ?? i.now - 30 * DAY;
  const to = i.winTo ?? i.now + DAY;
  const [{ lk }, all] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, from, to)]);
  const ev = await repliedSet(i.installationId, i.allowed, all, i.now);
  const rows = applyFilter(all, i.filter ?? {}, o, ev.channels);
  const oc = await outcomesOf(i.installationId, i.allowed, from);
  const appts = rows.length === 0 ? [] : await db`
    select location_id, contact_id, min(coalesce(created_remote_at, start_at)) first_at from cached_appointments
    where installation_id = ${i.installationId} and contact_id is not null and status not in ('cancelled', 'invalid') ${i.allowed ? db`and location_id = any(${i.allowed}::text[])` : db``}
    group by location_id, contact_id`.catch(() => []);
  const bookedAt = new Map(appts.map((a) => [`${a.location_id}:${a.contact_id}`, a.first_at instanceof Date ? a.first_at.getTime() : null]));

  const reach = new Map(rows.map((r) => [rowId(r), journeyReach(r, oc, ev.replied)]));
  const sugg = suggestionsFor(rows.slice(0, 200), new Set(rows.slice(0, 200).map((r) => r.locationId)));
  const out = (r: (typeof rows)[number]): LeadRowOut => rowOut(r, judge(r, i.targetMinutes, i.now) ?? "waiting", lk, sugg);

  // New leads and first replies by day (UTC days; a day is a calendar day, not a rolling 24 hours).
  const dayTo = Math.min(to, i.now + DAY);
  const leadsByDay = dayCounts(rows.map((r) => r.leadAt), from, dayTo);
  const repliesByDay = dayCounts(rows.filter((r) => r.touchAt !== null).map((r) => r.touchAt as number), from, dayTo);
  const vel = velocity(rows.map((r) => ({ leadAt: r.leadAt, bookedAt: bookedAt.get(rowId(r)) ?? null })));

  // The waiting leads (nobody has touched them yet), their reasons, and the ready-to-act list.
  const waiting = rows.filter((r) => r.touchAt === null).slice(0, MAX_OUT);
  const waitingOut = waiting.map(out);
  const reasons = delayReasons(waitingOut);
  const bars = reasonBars(reasons).map((b) => ({ ...b, rows: waitingOut.filter((r) => (reasons.get(rowId(r)) ?? "unclear") === b.key).slice(0, SAMPLE) }));
  const dealKeys = waiting.map(rowId).slice(0, 4000);
  const dollars = new Map<string, number>();
  for (const d of await countedDealsOf(i.installationId, dealKeys).catch(() => [])) { const k = `${d.locationId}:${d.contactId}`; dollars.set(k, (dollars.get(k) ?? 0) + d.value); }
  const ready = waiting
    .filter((r) => !(oc.get(rowId(r))?.booked))
    .map((r, n) => {
      const waited = Math.max(0, Math.round((i.now - r.leadAt) / 60_000));
      const dl = dollars.get(rowId(r)) ?? 0;
      return { r, n, score: readyScore({ dollars: dl, waitedMinutes: waited }), dollars: dl, waited };
    })
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, 12)
    .map((x) => ({ ...waitingOut[waiting.indexOf(x.r)], dollars: x.dollars, days: daysWaiting(x.waited), nextStepNone: nextStepNone({ touched: x.r.touchAt !== null, booked: oc.get(rowId(x.r))?.booked === true }) }));

  // The person table. Labels come from the same lookups as every other list; leads nobody owns are one "Unassigned" row.
  const label = new Map<string, string>();
  for (const r of rows) if (r.assignedTo && !label.has(r.assignedTo)) label.set(r.assignedTo, out(r).owner?.label ?? "A team member");
  const people = personTable(rows.map((r) => { const x = reach.get(rowId(r))!; return { owner: r.assignedTo, ownerLabel: r.assignedTo ? label.get(r.assignedTo) ?? null : null, replied: x.replied, booked: x.booked, showed: x.showed }; }));
  const sample = new Map<string, Array<{ row: LeadRowOut; replied: boolean; booked: boolean; showed: boolean }>>();
  for (const r of rows) {
    const k = r.assignedTo ?? "__none"; const list = sample.get(k) ?? [];
    if (list.length < SAMPLE) { const x = reach.get(rowId(r))!; list.push({ row: out(r), replied: x.replied, booked: x.booked, showed: x.showed }); sample.set(k, list); }
  }
  return {
    now: i.now, from, to: dayTo, total: rows.length, truncated: all.length >= 20_000,
    leadsByDay, repliesByDay, velocity: vel,
    people: i.seePeople ? people.map((p) => ({ ...p, sample: sample.get(p.key) ?? [] })) : [],
    ready, reasons: bars as Array<{ key: ReasonKey | "unclear"; label: string; n: number; rows: LeadRowOut[] }>,
    waitingTotal: waiting.length,
  };
}
