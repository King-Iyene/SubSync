// The internal alarm: "sync is older than 30 minutes". It is for us (the audit log and the diagnostics address), never a card a customer sees.
// Pure, so the rules are unit tested with fixtures; `watchdog.ts` reads the database and writes the entries.

import { STALE_AFTER_MINUTES } from "./schedule.ts";

export type AlarmInput = {
  installationId: string;
  /** The oldest account's last successful refresh (ISO), or null when no account has ever finished one. */
  oldestSuccessAt: string | null;
  accounts: number;
  pendingJobs: number;
  oldestPendingMinutes: number | null;
  failedJobs24h: number;
};

export type AlarmState = "ok" | "alarm" | "first_sync" | "idle";
export type AlarmVerdict = { installationId: string; state: AlarmState; ageMinutes: number | null; why: string };

/** Is this install's sync older than the limit? `idle` means there is nothing to sync yet (no accounts). */
export function evaluateInstall(i: AlarmInput, now: number, limitMinutes = STALE_AFTER_MINUTES): AlarmVerdict {
  const t = i.oldestSuccessAt ? Date.parse(i.oldestSuccessAt) : NaN;
  if (!Number.isFinite(t)) {
    if (i.accounts === 0) return { installationId: i.installationId, state: "idle", ageMinutes: null, why: "No client accounts to sync yet." };
    // A first sync that has not produced anything after the limit is a problem too.
    if (i.pendingJobs > 0 && (i.oldestPendingMinutes ?? 0) < limitMinutes) return { installationId: i.installationId, state: "first_sync", ageMinutes: null, why: "First sync in progress." };
    return { installationId: i.installationId, state: "alarm", ageMinutes: null, why: "No sync has finished and the first one is not progressing." };
  }
  const age = Math.floor((now - t) / 60_000);
  if (age > limitMinutes) {
    return { installationId: i.installationId, state: "alarm", ageMinutes: age, why: `The oldest account was last refreshed ${age} minutes ago (limit ${limitMinutes}). ${i.pendingJobs} jobs waiting, ${i.failedJobs24h} failed in 24 hours.` };
  }
  return { installationId: i.installationId, state: "ok", ageMinutes: age, why: "Fresh." };
}

export type LastEntry = { action: "sync.alarm" | "sync.recovered" | null; at: number | null };
export type AlarmAction = "raise" | "remind" | "recover" | "none";
/** Remind about a standing alarm at most this often, so a long outage writes a few lines, not hundreds. */
export const REMIND_EVERY_MINUTES = 60;

/** What to write down: one line when an alarm starts, a reminder an hour later if it still stands, one line when it clears. */
export function alarmAction(v: AlarmVerdict, last: LastEntry, now: number): AlarmAction {
  if (v.state === "alarm") {
    if (last.action !== "sync.alarm") return "raise";
    return last.at !== null && now - last.at >= REMIND_EVERY_MINUTES * 60_000 ? "remind" : "none";
  }
  if (v.state === "ok" && last.action === "sync.alarm") return "recover";
  return "none";
}
