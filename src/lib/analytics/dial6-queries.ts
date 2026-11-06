import { sql } from "../db";
import { attemptStates, bestHour, conversionByAttempt, leaderboard, type CallRec } from "../dial/dial6";
import { OUTCOMES } from "../dial/dial";

// The reads behind Call mode v2 (stage SPEED6). Read only; every query is bound to the accounts the router allowed. Only metadata is read: who, which lead, when, and the outcome WORD of a call
// SubSync logged itself (source "subsync_call"). Never message text.
const HOUR = 3_600_000;
const REACHED = new Set(OUTCOMES.filter((o) => o.reached).map((o) => o.key as string));

/** The redial list: leads called through Call mode where every try so far was a no answer or a voicemail, so they are worth another go. */
export async function redialRows(installationId: string, allowed: string[] | null) {
  const db = sql();
  const rows = await db`
    select e.location_id, e.contact_id, max(e.at) last_at, count(*)::int attempts,
      nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') name, c.phone, c.dnd, nullif(c.assigned_to, '') owner, l.name location_name, l.timezone,
      coalesce(d.open_value, 0)::float8 open_value
    from touch_events e
    join cached_contacts c on c.installation_id = e.installation_id and c.location_id = e.location_id and c.contact_id = e.contact_id
    join locations l on l.installation_id = e.installation_id and l.location_id = e.location_id and not l.ignored
    left join (select o.location_id, o.contact_id, sum(coalesce(o.monetary_value, 0)) open_value from cached_opportunities o where o.installation_id = ${installationId} and o.status = 'open' group by 1, 2) d
      on d.location_id = e.location_id and d.contact_id = e.contact_id
    where e.installation_id = ${installationId} and e.source = 'subsync_call' and e.at > now() - interval '14 days' ${allowed ? db`and e.location_id = any(${allowed}::text[])` : db``}
    group by e.location_id, e.contact_id, c.first_name, c.last_name, c.phone, c.dnd, c.assigned_to, l.name, l.timezone, d.open_value
    having bool_and(coalesce(e.outcome, '') in ('no_answer', 'voicemail'))
    order by max(e.at) desc limit 400`;
  return rows.map((r) => ({
    contactId: r.contact_id as string, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? null, name: (r.name as string | null) ?? "Unknown", phone: (r.phone as string | null) ?? null,
    dnd: r.dnd === true, timeZone: (r.timezone as string | null) ?? null, openValue: r.open_value as number, ageHours: Math.max(0, (Date.now() - new Date(r.last_at as string).getTime()) / HOUR),
    priority: 55, reasons: [`No answer so far, ${r.attempts as number} ${(r.attempts as number) === 1 ? "try" : "tries"}`], ownerId: (r.owner as string | null) ?? null,
  }));
}

export type DialInsightsIn = { installationId: string; allowed: string[] | null; userId: string | null; /** A client's staff: only their own calls and rank. */ ownOnly: boolean; names: ReadonlyMap<string, string>; now: number };

/** Attempt counts per lead, which attempt books, the best hour, the setter board and (for an agency) every client's dialing activity, from calls logged in the last 60 days. */
export async function dialInsights(i: DialInsightsIn) {
  const db = sql();
  const rows = await db`
    select e.location_id, e.contact_id, e.at, e.user_id, e.outcome, l.name location_name, l.timezone from touch_events e
    join locations l on l.installation_id = e.installation_id and l.location_id = e.location_id
    where e.installation_id = ${i.installationId} and e.source = 'subsync_call' and e.at > now() - interval '60 days' ${i.allowed ? db`and e.location_id = any(${i.allowed}::text[])` : db``}
    order by e.at desc limit 20000`;
  const recs = rows.map((r) => ({ key: `${r.location_id}:${r.contact_id}`, at: new Date(r.at as string).getTime(), userId: (r.user_id as string | null) ?? null, outcome: (r.outcome as string | null) ?? "other", loc: r.location_id as string, locName: r.location_name as string, tz: (r.timezone as string | null) ?? null }));
  const calls: CallRec[] = recs.map((r) => ({ contactId: r.key, at: r.at, outcome: r.outcome }));
  const states = [...attemptStates(calls)].slice(0, 4000);
  const tzs = new Set(recs.map((r) => r.tz ?? "UTC"));
  const tz = tzs.size === 1 ? [...tzs][0] : "UTC";
  const best = bestHour(recs.filter((r) => !i.ownOnly || r.userId === i.userId).map((r) => ({ at: r.at, reached: REACHED.has(r.outcome) })), tz);

  // The board: this week (7 days), by person. A client's staff see only their own line and rank; the rest of the team is not named to them.
  const week = recs.filter((r) => r.at > i.now - 7 * 24 * HOUR);
  const by = new Map<string, { calls: number; reached: number; booked: number }>();
  for (const r of week) { const k = r.userId ?? "unknown"; const b = by.get(k) ?? { calls: 0, reached: 0, booked: 0 }; b.calls++; if (REACHED.has(r.outcome)) b.reached++; if (r.outcome === "booked") b.booked++; by.set(k, b); }
  const board = leaderboard([...by].map(([id, b]) => ({ id, name: id === i.userId ? "You" : i.names.get(id) ?? "A team member", ...b })));
  const mine = board.find((b) => b.id === i.userId) ?? null;
  const shownBoard = i.ownOnly ? (mine ? [mine] : []) : board;

  // Agency view: dialing across client accounts. Not for a client's staff.
  const acts = new Map<string, { name: string; calls: number; reached: number; booked: number; last: number }>();
  if (!i.ownOnly) for (const r of week) { const a = acts.get(r.loc) ?? { name: r.locName, calls: 0, reached: 0, booked: 0, last: 0 }; a.calls++; if (REACHED.has(r.outcome)) a.reached++; if (r.outcome === "booked") a.booked++; a.last = Math.max(a.last, r.at); acts.set(r.loc, a); }
  return {
    now: i.now, states, best, byAttempt: conversionByAttempt(i.ownOnly ? calls.filter((_, n) => recs[n].userId === i.userId) : calls),
    board: shownBoard, ownRank: mine ? { rank: mine.rank, of: board.length } : null, teamVisible: !i.ownOnly,
    activity: [...acts].map(([locationId, a]) => ({ locationId, ...a })).sort((a, b) => b.calls - a.calls).slice(0, 30),
  };
}
