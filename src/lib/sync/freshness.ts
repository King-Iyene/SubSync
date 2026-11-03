// ONE source of truth for "how fresh is the data". Every screen, the daily brief and the Sync status panel get their words from here, so two
// places can never disagree (N74). Pure: no database, no clock of its own (the caller passes `now`), so it is unit tested with fixtures.
//
// Definition (also in docs/METRICS.md): an account's freshness is the last time its refresh cycle succeeded, which is when its conversations
// were last read (that read happens in every cycle, every 15 minutes). The one number shown is the OLDEST of the accounts, so the screen
// never claims to be fresher than its stalest account. Per-account times are available underneath.

import { LONG_RUNNING_MINUTES, STALE_AFTER_MINUTES } from "./schedule.ts";

export type AccountFreshnessInput = {
  locationId: string;
  name: string | null;
  /** ISO time of this account's last successful refresh, or null when it has never finished one. */
  lastSuccessAt: string | null;
  /** A plain reason when this account's latest attempt failed after its last success, else null. */
  problem: string | null;
};

export type FreshnessInput = {
  now: number;
  demo: boolean;
  accounts: AccountFreshnessInput[];
  /** Jobs queued or running for these accounts, and how long the oldest of them has been waiting (minutes). */
  pendingJobs: number;
  oldestPendingMinutes: number | null;
  /** True when the connection to the CRM itself failed (listing the accounts), not one account. */
  connectionProblem: string | null;
};

export type FreshnessState = "demo" | "first_sync" | "never" | "fresh" | "delayed" | "failing";

export type AccountFreshness = {
  locationId: string;
  name: string | null;
  updatedAt: string | null;
  ageMinutes: number | null;
  text: string;
  state: "ok" | "delayed" | "failing" | "first";
  problem: string | null;
};

export type Freshness = {
  state: FreshnessState;
  /** The oldest account's last success (ISO), or null. */
  updatedAt: string | null;
  ageMinutes: number | null;
  /** The one sentence every screen shows. */
  text: string;
  /** A second plain line when something is wrong, else null. */
  detail: string | null;
  /** The only cases where a "sync is running" note may be shown: a first sync, or one that has been queued or running a long time. */
  syncingNote: string | null;
  accounts: AccountFreshness[];
};

export const DEMO_TEXT = "Sample data. Nothing here is refreshed from a real account.";

/** "just now", "7 min ago", "3 hours ago", "2 days ago". One wording everywhere. */
export function agoText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

const minutesBetween = (now: number, iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 60_000) : null;
};

export function freshnessOf(i: FreshnessInput): Freshness {
  if (i.demo) {
    const sample = i.accounts.map((a): AccountFreshness => ({ locationId: a.locationId, name: a.name, updatedAt: null, ageMinutes: null, text: "Sample data", state: "ok", problem: null }));
    return { state: "demo", updatedAt: null, ageMinutes: null, text: DEMO_TEXT, detail: null, syncingNote: null, accounts: sample };
  }

  const accounts: AccountFreshness[] = i.accounts.map((a) => {
    const age = a.lastSuccessAt ? minutesBetween(i.now, a.lastSuccessAt) : null;
    if (age === null) {
      return { locationId: a.locationId, name: a.name, updatedAt: null, ageMinutes: null, text: a.problem ? "Not read yet" : "Reading for the first time", state: a.problem ? "failing" : "first", problem: a.problem };
    }
    const state = a.problem ? "failing" : age > STALE_AFTER_MINUTES ? "delayed" : "ok";
    return { locationId: a.locationId, name: a.name, updatedAt: a.lastSuccessAt, ageMinutes: Math.floor(age), text: `Updated ${agoText(age)}`, state, problem: a.problem };
  });

  const known = accounts.filter((a) => a.ageMinutes !== null);
  const failing = accounts.filter((a) => a.state === "failing");
  const longRunning = i.pendingJobs > 0 && i.oldestPendingMinutes !== null && i.oldestPendingMinutes >= LONG_RUNNING_MINUTES;

  // Nothing has ever finished. Either the first sync is on its way, or nothing has been started.
  if (known.length === 0) {
    if (i.connectionProblem) {
      return { state: "failing", updatedAt: null, ageMinutes: null, text: "Not synced yet", detail: i.connectionProblem, syncingNote: null, accounts };
    }
    if (i.pendingJobs > 0) {
      return {
        state: "first_sync", updatedAt: null, ageMinutes: null, text: "First sync in progress", detail: null,
        syncingNote: "Your first sync is running. Numbers fill in over the next few minutes.", accounts,
      };
    }
    return { state: "never", updatedAt: null, ageMinutes: null, text: "Not synced yet", detail: failing[0]?.problem ?? "The first sync has not started. Press Sync now, or wait a few minutes.", syncingNote: null, accounts };
  }

  const oldest = known.reduce((a, b) => ((a.ageMinutes as number) >= (b.ageMinutes as number) ? a : b));
  const age = oldest.ageMinutes as number;
  const stale = age > STALE_AFTER_MINUTES;
  const loading = accounts.filter((a) => a.state === "first").length;
  const base = `Updated ${agoText(age)}`;

  let state: FreshnessState = "fresh";
  let text = base;
  let detail: string | null = null;
  if (failing.length > 0 || i.connectionProblem) {
    state = "failing";
    text = stale ? `${base}, refresh is failing` : `${base}, but the latest refresh failed${failing.length > 1 ? ` for ${failing.length} accounts` : failing.length === 1 ? " for 1 account" : ""}`;
    detail = i.connectionProblem ?? failing[0]?.problem ?? null;
  } else if (stale) {
    state = "delayed";
    text = `${base}, refresh is delayed`;
    detail = `SubSync normally refreshes every few minutes. ${oldest.name ? `${oldest.name} is the oldest. ` : ""}It will try again on its own; Sync now forces it.`;
  }
  if (loading > 0 && detail === null) detail = `${loading} ${loading === 1 ? "account is" : "accounts are"} still being read for the first time.`;

  const syncingNote = longRunning ? `A sync has been running for ${Math.round(i.oldestPendingMinutes as number)} minutes. Numbers may change when it finishes.` : null;
  return { state, updatedAt: oldest.updatedAt, ageMinutes: Math.floor(age), text, detail, syncingNote, accounts };
}

/** A plain reason for a failed job, from the (already scrubbed) error text. Never shows a raw message to a user. */
export function plainReason(error: string | null | undefined): string {
  const e = (error ?? "").toLowerCase();
  if (/refresh conflict/.test(e)) return "Two refreshes overlapped. It will try again on its own.";
  if (/\b(401|403)\b|unauthor|forbidden|token|permission/.test(e)) return "SubSync's access to this account was refused. Reconnect it, and approve any new permission when asked.";
  if (/\b429\b|rate limit|too many/.test(e)) return "The CRM asked SubSync to slow down. It will try again on its own.";
  if (/\b5\d\d\b|timeout|timed out|fetch failed|econn|enotfound|network/.test(e)) return "The CRM did not answer in time. It will try again on its own.";
  if (/missing environment/.test(e)) return "SubSync is not fully set up on our side. We have been told.";
  return "Reading this account failed. It will try again on its own.";
}
