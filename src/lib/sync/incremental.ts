// Incremental sync rules, pure (no database, no network), unit tested (incremental.test.ts).
// A normal sync reads only what changed since the last good one: the CRM is asked newest-change-first and paging stops at the first record older than the watermark.
// A full re-read ("reconcile") still runs on a slower schedule and on demand: it is the only pass that notices deletions the real-time events missed.

export const SKEW_MS = 2 * 60_000;            // the watermark is kept this far behind the start of the read, so a clock difference or a slow write never hides a change
export const FULL_EVERY_MS = 24 * 3_600_000;  // a full pass at least this often
export const AUTO_MIN_GAP_MS = 20_000;        // one automatic check per account at most this often (also the per-account lock window)
export const CONVERSATIONS_EVERY_MS = 3 * 60_000; // the heavier kinds are re-read by the automatic check no more often than this; real-time events cover the gap
export const MAX_AUTO_ACCOUNTS = 5;           // accounts one automatic call may touch (the one in view first)

export type Mode = "incremental" | "full";
export type Kind = "contacts" | "opportunities";

/** Which pass a read should be. Full when forced, when there is no watermark yet, or when the last full pass is older than FULL_EVERY_MS. */
export function chooseMode(i: { watermarkMs: number | null; lastFullMs: number | null; nowMs: number; force?: boolean }): Mode {
  if (i.force || i.watermarkMs === null || i.lastFullMs === null) return "full";
  return i.nowMs - i.lastFullMs > FULL_EVERY_MS ? "full" : "incremental";
}

/** The watermark a finished read stores: when it started, minus the skew. Everything changed after it is read again next time. */
export const nextWatermark = (startedMs: number): number => startedMs - SKEW_MS;

/** One page of an updated-newest-first read. `fresh` are the rows changed at or after the watermark; `reachedOld` says paging can stop. A row with no change time is kept (cannot be judged). */
export function takeFresh<T>(rows: T[], updatedMs: (r: T) => number | null, watermarkMs: number): { fresh: T[]; reachedOld: boolean } {
  const fresh: T[] = [];
  for (const r of rows) {
    const u = updatedMs(r);
    if (u !== null && u < watermarkMs) return { fresh, reachedOld: true };
    fresh.push(r);
  }
  return { fresh, reachedOld: false };
}

/** Is the page really newest-change-first? If not (the CRM ignored the sort), an incremental read would silently miss changes, so the caller falls back to a full pass. */
export function isSortedNewestFirst(times: Array<number | null>): boolean {
  let prev = Infinity;
  for (const t of times) { if (t === null) continue; if (t > prev) return false; prev = t; }
  return true;
}

/** The automatic check runs inside the person's own request, so it is kept small: two workers (the pool has eight connections and the screen's own reads need them) and a short budget.
 *  Whatever it does not finish stays queued and is picked up by the next check or by cron, so nothing is lost. */
export const AUTO_SLICE_WORKERS = 2;
export const AUTO_SLICE_MS = 4_000;

/** Accounts for one automatic call: the one in view first, then the ones checked longest ago, at most `max`. `checkedMs` null = never. */
export function orderAccounts(ids: string[], focus: string | null, checkedMs: Map<string, number | null>, max = MAX_AUTO_ACCOUNTS): string[] {
  const rest = ids.filter((id) => id !== focus).sort((a, b) => (checkedMs.get(a) ?? 0) - (checkedMs.get(b) ?? 0));
  const all = focus && ids.includes(focus) ? [focus, ...rest] : rest;
  return all.slice(0, max);
}

/** Which kinds an automatic check queues for one account. Contacts and deals are cheap when nothing changed (one small read). */
export function autoKinds(i: { nowMs: number; conversationsSyncedMs: number | null }): Array<"contacts" | "opportunities" | "conversations" | "appointments" | "speed"> {
  const heavyDue = i.conversationsSyncedMs === null || i.nowMs - i.conversationsSyncedMs >= CONVERSATIONS_EVERY_MS;
  return heavyDue ? ["contacts", "opportunities", "conversations", "appointments", "speed"] : ["contacts", "opportunities"];
}

/** An account may be checked now: not within the gap since its last check, and nothing of it is already queued or running (the per-account lock). */
export function mayCheck(i: { lastCheckedMs: number | null; nowMs: number; busy: boolean }): boolean {
  return !i.busy && (i.lastCheckedMs === null || i.nowMs - i.lastCheckedMs >= AUTO_MIN_GAP_MS);
}

/** Small status word for the header: Live (checked recently), Catching up (work queued), Paused (tab hidden). */
export function liveStatus(i: { hidden: boolean; pending: number; failed: boolean }): "paused" | "catching" | "live" | "trouble" {
  if (i.hidden) return "paused";
  if (i.failed) return "trouble";
  return i.pending > 0 ? "catching" : "live";
}

export const QUIET_REFRESH_GAP_MS = 60_000; // a screen re-reads quietly after a background change no more often than this
export const QUIET_REFRESH_SPREAD_MS = 3_000; // and spread over this long, so ten reads on one screen do not all hit the server in the same instant

/** When a screen should re-read after a background "data changed" signal: null = now (a person pressed sync), otherwise a delay in ms. Never sooner than the gap since its last read, so a busy account whose sync finishes every few minutes does not keep every screen reloading; `spread01` (0..1) staggers the screens. */
export function quietRefreshDelay(i: { force: boolean; nowMs: number; lastReadMs: number; spread01: number }): number | null {
  if (i.force) return null;
  return Math.max(0, i.lastReadMs + QUIET_REFRESH_GAP_MS - i.nowMs) + Math.round(i.spread01 * QUIET_REFRESH_SPREAD_MS);
}

/** "12 seconds ago", "3 minutes ago". */
export function agoWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.round(m / 60)} hours ago`;
}
