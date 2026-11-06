import { sql } from "../db";
import { resolveUser } from "./people-labels";
import { countedDealsOf } from "./waiting-money-queries";
import { sourceLabel } from "./speed-intel";
import { accountFacts, rowOut, suggestionsFor } from "./speed-v2-queries";
import { costEstimate, money } from "./speed-v2";
import { loadLookups, loadRows } from "./speed-queries";
import { applyFilter, type LeadFilter } from "./speed-v4-more";
import { bySourceFunnel, rescueRank, fastVsSlow, gapMap, ownerGaps, pick, setterScorecard, trendVsNormal, DAY, type Outcomes, type Sel } from "./speed-v3";

// The reads behind the Speed to lead extras (stage SPEED3). Read only; every query is bound to the accounts the router allowed. What became of a lead is read from the
// appointments and deals SubSync already holds: booked (an appointment that is not cancelled, starting after the lead arrived), showed (marked showed), won (a won deal).
const HISTORY_DAYS = 56;

export async function outcomesOf(installationId: string, allowed: string[] | null, fromMs: number): Promise<Outcomes> {
  const db = sql();
  const out = new Map<string, { booked: boolean; showed: boolean; won: boolean }>();
  const get = (k: string) => out.get(k) ?? (out.set(k, { booked: false, showed: false, won: false }), out.get(k) as { booked: boolean; showed: boolean; won: boolean });
  try {
    const appts = await db`
      select t.location_id, t.contact_id, bool_or(coalesce(a.status, '') not in ('cancelled', 'canceled', 'invalid')) booked, bool_or(a.status = 'showed') showed
      from lead_touches t join cached_appointments a on a.installation_id = t.installation_id and a.location_id = t.location_id and a.contact_id = t.contact_id and a.start_at >= t.lead_at
      where t.installation_id = ${installationId} and t.excluded is null and t.lead_at > ${new Date(fromMs)} ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``}
      group by 1, 2`;
    for (const r of appts) { const o = get(`${r.location_id}:${r.contact_id}`); o.booked = r.booked === true; o.showed = r.showed === true; }
    const won = await db`
      select distinct t.location_id, t.contact_id
      from lead_touches t join cached_opportunities o on o.installation_id = t.installation_id and o.location_id = t.location_id and o.contact_id = t.contact_id and o.status = 'won'
      where t.installation_id = ${installationId} and t.excluded is null and t.lead_at > ${new Date(fromMs)} ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``}`;
    for (const r of won) get(`${r.location_id}:${r.contact_id}`).won = true;
  } catch { /* a database without these tables: the funnel shows leads only */ }
  return out;
}

export type InsightInput = { installationId: string; allowed: string[] | null; targetMinutes: number; now: number; seePeople: boolean; filter?: LeadFilter; /** The bar's dates in ms (end exclusive). Absent means the last 28 days. */ winFrom?: number; winTo?: number };

export async function speedInsights(i: InsightInput) {
  const db = sql();
  const [{ lk }, loaded] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, i.now - HISTORY_DAYS * DAY, i.now + DAY)]);
  const rows = applyFilter(loaded, i.filter ?? {}, { targetMinutes: i.targetMinutes, now: i.now });
  const oc = await outcomesOf(i.installationId, i.allowed, i.now - HISTORY_DAYS * DAY);
  const o = { targetMinutes: i.targetMinutes, now: i.now };
  const recent = rows.filter((r) => r.leadAt >= (i.winFrom ?? i.now - 28 * DAY) && r.leadAt < (i.winTo ?? i.now + DAY));
  const name = (userId: string, loc: string | undefined) => resolveUser(userId, lk.team, loc ? lk.usersAccess.get(loc) : null).label;
  const locOf = (u: string) => rows.find((r) => r.userId === u || r.assignedTo === u)?.locationId;
  const setters = i.seePeople ? setterScorecard(recent, oc, o) : { rows: [], teamMedianSeconds: null };
  const gaps = ownerGaps(recent, o);
  // Lead rescue: the waiting leads (last 14 days) ranked by the open deals of those people and how long they have cooled.
  const waiting = pick(rows.filter((r) => r.leadAt > i.now - 14 * DAY), { kind: "all" }, o).filter((x) => x.status === "waiting").map((x) => x.row);
  const deals = await countedDealsOf(i.installationId, waiting.map((r) => `${r.locationId}:${r.contactId}`)).catch(() => []);
  const dollars = new Map<string, number>();
  for (const d of deals) dollars.set(`${d.locationId}:${d.contactId}`, (dollars.get(`${d.locationId}:${d.contactId}`) ?? 0) + d.value);
  const rescue = rescueRank(waiting, dollars, o, 8).map((x) => { const r = waiting.find((w) => w.locationId === x.locationId && w.contactId === x.contactId) as typeof waiting[number]; return { ...rowOut(r, "waiting", lk, new Map()), dollars: x.dollars, waitedMinutes: x.waitedMinutes }; });
  // Cost of slow, per source: the leads answered late or not at all, valued with each account's own average deal and win rate (only where it has enough closed deals).
  const facts = await accountFacts(i.installationId, i.allowed);
  const slow = new Map<string, Map<string, number>>();
  for (const { row, status } of pick(recent, { kind: "all" }, o)) if (status !== "within") { const k = sourceLabel(row.source); const m = slow.get(k) ?? new Map<string, number>(); m.set(row.locationId, (m.get(row.locationId) ?? 0) + 1); slow.set(k, m); }
  const costBySource = [...slow].map(([source, m]) => { const c = costEstimate(m, facts ?? []); return { source, missed: c.waiting, dollars: c.amount, line: c.amount === null ? null : money(c.amount) }; }).sort((a, b) => (b.dollars ?? -1) - (a.dollars ?? -1) || b.missed - a.missed).slice(0, 8);
  return {
    now: i.now, days: 28, gap: gapMap(recent, o), fastSlow: fastVsSlow(recent, oc, o), sources: bySourceFunnel(recent, oc, o).slice(0, 12), trend: trendVsNormal(rows, o),
    setters: { teamMedianSeconds: setters.teamMedianSeconds, rows: setters.rows.slice(0, 10).map((s) => ({ ...s, name: name(s.userId, locOf(s.userId)) })) },
    owners: i.seePeople ? { ...gaps, owners: gaps.owners.slice(0, 8).map((x) => ({ ...x, name: name(x.userId, locOf(x.userId)) })) } : { ...gaps, owners: [] },
    rescue, costBySource, seePeople: i.seePeople,
  };
}

/** The exact leads behind one mark, capped at 100 with the true count. The same `pick` the figure was counted with. */
export async function speedInsightList(i: InsightInput & { sel: Sel }) {
  const db = sql();
  const [{ lk }, loaded] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadRows(db, i.installationId, i.allowed, Math.min(i.winFrom ?? i.now - 28 * DAY, i.now - 28 * DAY), i.now + DAY)]);
  const inWin = (t: number) => t >= (i.winFrom ?? i.now - 28 * DAY) && t < (i.winTo ?? i.now + DAY);
  const rows = applyFilter(loaded, i.filter ?? {}, { targetMinutes: i.targetMinutes, now: i.now }).filter((r) => i.sel.kind === "week" || inWin(r.leadAt));
  const picked = pick(rows, i.sel, { targetMinutes: i.targetMinutes, now: i.now });
  const sugg = suggestionsFor(rows, new Set(picked.slice(0, 100).map((x) => x.row.locationId)));
  return { count: picked.length, shown: Math.min(100, picked.length), rows: picked.slice(0, 100).map((x) => rowOut(x.row, x.status, lk, sugg)) };
}
