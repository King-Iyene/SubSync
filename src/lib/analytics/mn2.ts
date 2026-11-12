// Meeting notes, finished (docs/features/MEETINGS_BRIEF.md slices 1, 2 and 6). Pure: no database, no network, no clock of its own.
// A recorded call is PRIVATE to the person whose tool recorded it (rule 12), and it reaches a contact only when the match is certain (rule 13). This file holds the rules the list,
// the follow-up lists, the action-item tasks and the coaching view share, so each is tested without a database.

export const FOLLOWUP_DAYS = 2;
export const DEAL_WINDOW_DAYS = 7;
export const MAX_TASKS_PER_CALL = 10;
export const MAX_TASKS_PER_DAY = 30;
export const UNDO_MINUTES = 60;
/** The least calls behind a rate before it is shown (the same floor as the history). Below it the screen says "not enough calls yet". */
export const MIN_COACH_CALLS = 5;
export const LIST_PAGE = 25;
export const MAX_PAGE = 50;

export type MatchState = "all" | "matched" | "needs";
export type OutcomeFilter = "all" | "to_confirm" | "confirmed" | "none";
export type FollowFilter = "all" | "has" | "none";
export type FollowKind = "no_followup" | "no_next_step" | "deal_not_moved";

export type ListQuery = {
  q: string; accounts: string[]; state: MatchState; outcome: OutcomeFilter; follow: FollowFilter; from: string | null; to: string | null; cursor: Cursor | null; limit: number;
};
/** Where the next page starts: the time the call is sorted by and its id, so a page never repeats or skips a call (keyset paging, no offset). */
export type Cursor = { at: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function encodeCursor(c: Cursor): string { return Buffer.from(`${c.at}|${c.id}`, "utf8").toString("base64url"); }
export function decodeCursor(v: string | null): Cursor | null {
  if (!v || v.length > 120) return null;
  try {
    const [at, id] = Buffer.from(v, "base64url").toString("utf8").split("|");
    return at && Number.isFinite(Date.parse(at)) && isUuid(id) ? { at: new Date(at).toISOString(), id } : null;
  } catch { return null; }
}

const pick = <T extends string>(v: string | null, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback);

/** Reads the list's filters from the address. Nothing here names a person: whose calls are listed comes only from the signed session. Account ids are checked against the person's accounts by the caller. */
export function parseListQuery(sp: URLSearchParams, accounts: string[]): ListQuery {
  const from = sp.get("from"), to = sp.get("to");
  const lim = Number(sp.get("limit"));
  return {
    q: (sp.get("q") ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80),
    accounts,
    state: pick(sp.get("state"), ["all", "matched", "needs"], "all"),
    outcome: pick(sp.get("outcome"), ["all", "to_confirm", "confirmed", "none"], "all"),
    follow: pick(sp.get("follow"), ["all", "has", "none"], "all"),
    from: isDay(from) ? from : null, to: isDay(to) ? to : null,
    cursor: decodeCursor(sp.get("cursor")),
    limit: Number.isInteger(lim) && lim >= 1 ? Math.min(MAX_PAGE, lim) : LIST_PAGE,
  };
}

/** A search term made safe for LIKE: the characters LIKE treats as wildcards are escaped. */
export const likeOf = (q: string): string => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------------- the plain words on a row ----------------

export type CallStatus = "on_contact" | "practice" | "waiting_pick" | "waiting_ok" | "needs_permission" | "refused" | "other";
/** Where a call is, in words a setter understands. `matched` is true when a contact is known with certainty. */
export function callStatus(a: { status: string; reason: string | null; matched: boolean }): { key: CallStatus; label: string } {
  if (a.status === "saved") return { key: "on_contact", label: "On the contact" };
  if (a.status === "dry_run") return { key: "practice", label: "Matched, not saved yet" };
  if (a.status === "failed") return { key: "refused", label: "Your CRM refused the note" };
  if (a.status === "needs_contact") {
    if (a.reason === "needs_permission") return { key: "needs_permission", label: "Needs permission: reconnect" };
    if (a.reason === "preview_needed") return { key: "waiting_ok", label: "Waiting for your OK" };
    if (a.matched) return { key: "waiting_ok", label: "Waiting to be saved" };
    return { key: "waiting_pick", label: "Waiting for you to pick the contact" };
  }
  return { key: "other", label: "Not saved" };
}

export type OutcomeState = "none" | "to_confirm" | "confirmed";
export const outcomeState = (l: { suggested: string | null; confirmedAt: string | null } | null): OutcomeState => (!l ? "none" : l.confirmedAt ? "confirmed" : l.suggested ? "to_confirm" : "none");
export const outcomeWords = (s: OutcomeState, suggested: string | null): string =>
  s === "confirmed" ? "Outcome set" : s === "to_confirm" ? (suggested === "noshow" ? "Looks like a no-show: confirm?" : "Looks like they showed: confirm?") : "No appointment outcome";

/** The one-line next step: the first action item, trimmed. */
export const nextStep = (items: readonly string[]): string | null => { const f = items.map((s) => s.trim()).find(Boolean); return f ? f.slice(0, 200) : null; };

// ---------------- action items to tasks ----------------

export type TaskPlan = { itemNo: number; title: string; dueAt: string };
/** The tasks one call would make, for the preview. Each chosen item becomes one task, due two days after the call (or today when that has passed). Items are numbered from 1 and only existing, non-empty ones count. */
export function planTasks(items: readonly string[], chosen: readonly number[], startedAt: string | null, now: number): { plans: TaskPlan[]; skipped: number } {
  const base = startedAt && Number.isFinite(Date.parse(startedAt)) ? Date.parse(startedAt) : now;
  const due = Math.max(now + 3_600_000, base + FOLLOWUP_DAYS * 86_400_000);
  const seen = new Set<number>();
  const plans: TaskPlan[] = [];
  let skipped = 0;
  for (const n of chosen) {
    const text = items[n - 1]?.replace(/\s+/g, " ").trim();
    if (!Number.isInteger(n) || n < 1 || !text || seen.has(n)) { skipped++; continue; }
    seen.add(n);
    if (plans.length >= MAX_TASKS_PER_CALL) { skipped++; continue; }
    plans.push({ itemNo: n, title: text.slice(0, 200), dueAt: new Date(due).toISOString() });
  }
  return { plans, skipped };
}
/** Items the person may still turn into tasks: those with no task row that is live. */
export const freeItems = (count: number, taken: readonly number[]): number[] => Array.from({ length: count }, (_, i) => i + 1).filter((n) => !taken.includes(n));

// ---------------- coaching (counts and averages, never what was said) ----------------

export type CoachCall = { owner: string; minutes: number | null; talkPct: number | null; hasNextStep: boolean; matched: boolean; showed: boolean; won: boolean };
export type CoachRow = {
  owner: string; calls: number; avgMinutes: number | null; avgTalkPct: number | null; nextStepRate: number | null; showToClose: number | null; closed: number; enough: boolean;
};
const mean = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
/** One row per person. A rate needs MIN_COACH_CALLS calls behind it, else it is null (the screen says "not enough calls yet"), so two calls are never shown as a trend. */
export function coachRows(calls: readonly CoachCall[]): CoachRow[] {
  const by = new Map<string, CoachCall[]>();
  for (const c of calls) by.set(c.owner, [...(by.get(c.owner) ?? []), c]);
  return [...by.entries()].map(([owner, cs]) => {
    const enough = cs.length >= MIN_COACH_CALLS;
    const showed = cs.filter((c) => c.showed);
    const won = showed.filter((c) => c.won).length;
    return {
      owner, calls: cs.length, enough,
      avgMinutes: mean(cs.map((c) => c.minutes).filter((x): x is number => x !== null)),
      avgTalkPct: mean(cs.map((c) => c.talkPct).filter((x): x is number => x !== null)),
      nextStepRate: enough ? Math.round((cs.filter((c) => c.hasNextStep).length / cs.length) * 100) : null,
      showToClose: showed.length >= MIN_COACH_CALLS ? Math.round((won / showed.length) * 100) : null, closed: won,
    };
  }).sort((a, b) => b.calls - a.calls);
}

/** The share of the words spoken by the recorder, from a delivery's transcript turns (counts only; the words are never kept). Null when nothing was said or the recorder cannot be told apart. */
export function talkShare(turns: ReadonlyArray<{ speaker: string | null; email: string | null; words: number }>, me: { name: string | null; email: string | null }): number | null {
  const mine = (t: { speaker: string | null; email: string | null }) => (me.email && t.email?.toLowerCase() === me.email.toLowerCase()) || (me.name && t.speaker && t.speaker.trim().toLowerCase() === me.name.trim().toLowerCase());
  const total = turns.reduce((n, t) => n + t.words, 0);
  if (total < 50 || !turns.some(mine)) return null;
  return Math.round((turns.filter(mine).reduce((n, t) => n + t.words, 0) / total) * 100);
}

// ---------------- the weekly line ----------------

/** The one weekly line for the proof receipt and Today. Counts only; null when no call was held (nothing is said rather than "0 calls"). */
export function weeklyLine(w: { held: number; logged: number; noNextStep: number; waiting: number }): string | null {
  if (w.held <= 0) return null;
  const parts = [`${w.held} recorded ${w.held === 1 ? "call" : "calls"} this week, ${w.logged} on a contact`];
  if (w.noNextStep > 0) parts.push(`${w.noNextStep} with no next step`);
  if (w.waiting > 0) parts.push(`${w.waiting} waiting to be matched`);
  return `${parts.join(", ")}.`;
}
