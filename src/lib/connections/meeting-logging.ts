// Calls held, not logged (docs/features/MEETINGS_BRIEF.md slice 3) and the meeting-to-outcome history (slice 4). Pure: no database, no content.
// A "call" here is a row of the meetings table that needed a place in the CRM: it was saved (logged), or it is still waiting (a person must pick the contact, OK the
// first note, or give the permission), or the CRM refused the note. Calls that were skipped, recorded twice or run in test mode are not calls to log, so they are not counted.
// Only counts ever leave this file: never a title, a summary, an attendee or a transcript (an owner sees counts and never content, rule 12).

export const LOG_WINDOW_HOURS = 24;
/** The outcome history is shown only from this many logged calls, so a handful of calls is never presented as a trend. */
export const MIN_OUTCOME_MEETINGS = 30;
/** How long after a call a booking or a deal move still counts as following it. */
export const OUTCOME_WINDOW_DAYS = 7;
/** Counts cover the calls received in this many days. */
export const COUNT_WINDOW_DAYS = 30;

export type CallGroup = { owner: string; status: string; reason: string | null; old: boolean; n: number };

export type CallCounts = {
  /** Calls that needed a place in the CRM (logged + not logged). */
  held: number;
  logged: number;
  notLogged: number;
  /** Not logged and more than 24 hours old. */
  overdue: number;
  /** Waiting for the person to pick the contact (the inbox). */
  needsContact: number;
  /** Matched with certainty but waiting for the person's OK on the first note. */
  needsOk: number;
  needsPermission: number;
  failed: number;
};

export const EMPTY_CALLS: CallCounts = { held: 0, logged: 0, notLogged: 0, overdue: 0, needsContact: 0, needsOk: 0, needsPermission: 0, failed: 0 };

/** Adds one group of rows to a tally. Unknown statuses are ignored on purpose (skipped, duplicate and test-mode calls are not calls to log). */
export function addGroup(c: CallCounts, g: Pick<CallGroup, "status" | "reason" | "old" | "n">): CallCounts {
  const n = Math.max(0, Math.floor(g.n));
  if (n === 0) return c;
  if (g.status === "saved") return { ...c, held: c.held + n, logged: c.logged + n };
  if (g.status === "failed") return { ...c, held: c.held + n, notLogged: c.notLogged + n, failed: c.failed + n, overdue: c.overdue + (g.old ? n : 0) };
  if (g.status !== "needs_contact") return c;
  const base = { ...c, held: c.held + n, notLogged: c.notLogged + n, overdue: c.overdue + (g.old ? n : 0) };
  if (g.reason === "preview_needed") return { ...base, needsOk: c.needsOk + n };
  if (g.reason === "needs_permission") return { ...base, needsPermission: c.needsPermission + n };
  return { ...base, needsContact: c.needsContact + n };
}

/** One tally per person (the CRM user id) from the grouped rows. */
export function tallyByOwner(groups: CallGroup[]): Map<string, CallCounts> {
  const out = new Map<string, CallCounts>();
  for (const g of groups) out.set(g.owner, addGroup(out.get(g.owner) ?? EMPTY_CALLS, g));
  return out;
}

export function sumCounts(list: CallCounts[]): CallCounts {
  return list.reduce<CallCounts>((a, c) => ({
    held: a.held + c.held, logged: a.logged + c.logged, notLogged: a.notLogged + c.notLogged, overdue: a.overdue + c.overdue,
    needsContact: a.needsContact + c.needsContact, needsOk: a.needsOk + c.needsOk, needsPermission: a.needsPermission + c.needsPermission, failed: a.failed + c.failed,
  }), EMPTY_CALLS);
}

/** The share of calls that are logged, as a whole percent, or null when there were no calls (never 0 % of nothing). */
export function loggedShare(c: CallCounts): number | null {
  return c.held === 0 ? null : Math.round((c.logged / c.held) * 100);
}

export type PersonInfo = { owner: string; name: string | null; homeLocationId: string | null; connected: boolean };
export type RepRow = CallCounts & { owner: string; name: string; homeLocationId: string | null; share: number | null };
export type AccountRow = CallCounts & { locationId: string | null; share: number | null };

/** Per-person rows, the people with the most overdue calls first, then the most not logged. People with no calls at all are left out. */
export function repRows(tallies: Map<string, CallCounts>, people: PersonInfo[]): RepRow[] {
  const info = new Map(people.map((p) => [p.owner, p]));
  const rows: RepRow[] = [];
  for (const [owner, c] of tallies) {
    if (c.held === 0) continue;
    const p = info.get(owner);
    rows.push({ ...c, owner, name: p?.name ?? "A team member who left", homeLocationId: p?.homeLocationId ?? null, share: loggedShare(c) });
  }
  return rows.sort((a, b) => b.overdue - a.overdue || b.notLogged - a.notLogged || a.name.localeCompare(b.name));
}

/** Per-account rows. A call belongs to the account its person works in; company staff, who work across accounts, are one row with no account. */
export function accountRows(reps: RepRow[]): AccountRow[] {
  const by = new Map<string, RepRow[]>();
  for (const r of reps) { const k = r.homeLocationId ?? ""; by.set(k, [...(by.get(k) ?? []), r]); }
  return [...by.entries()]
    .map(([k, list]) => { const c = sumCounts(list); return { ...c, locationId: k === "" ? null : k, share: loggedShare(c) }; })
    .sort((a, b) => b.overdue - a.overdue || b.notLogged - a.notLogged);
}

// ---------------- the history of what followed a call ----------------

export type OutcomeDay = { day: string; meetingsHeld: number; logged24h: number; nextStepSet: number; movedOrBooked7d: number };
export type OutcomeSummary = {
  /** False below the minimum: the screen then says how many calls are still needed and shows no percentages. */
  enough: boolean;
  total: number;
  needed: number;
  historyStarts: string | null;
  logged24hShare: number | null;
  nextStepShare: number | null;
  movedOrBookedShare: number | null;
  logged24h: number;
  nextStepSet: number;
  movedOrBooked7d: number;
};

const pct = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 100));

/** Sums the stored days. Shares are given only once there are at least MIN_OUTCOME_MEETINGS calls (INFERENCE guard: a few calls prove nothing). */
export function summarizeOutcomes(days: OutcomeDay[]): OutcomeSummary {
  const total = days.reduce((n, d) => n + d.meetingsHeld, 0);
  const logged24h = days.reduce((n, d) => n + d.logged24h, 0);
  const nextStepSet = days.reduce((n, d) => n + d.nextStepSet, 0);
  const movedOrBooked7d = days.reduce((n, d) => n + d.movedOrBooked7d, 0);
  const enough = total >= MIN_OUTCOME_MEETINGS;
  const first = days.map((d) => d.day).sort()[0] ?? null;
  return {
    enough, total, needed: Math.max(0, MIN_OUTCOME_MEETINGS - total), historyStarts: first,
    logged24hShare: enough ? pct(logged24h, total) : null, nextStepShare: enough ? pct(nextStepSet, total) : null, movedOrBookedShare: enough ? pct(movedOrBooked7d, total) : null,
    logged24h, nextStepSet, movedOrBooked7d,
  };
}

/** The day the daily job records: far enough back that the seven days after its calls are complete. A calendar date (UTC), `YYYY-MM-DD`. */
export function dayToRecord(now: number): string {
  return new Date(now - (OUTCOME_WINDOW_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
}
