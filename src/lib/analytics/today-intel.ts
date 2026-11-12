import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
// Today, the front door (stage F5). Pure: no database, no React, so every sentence and every number on Today can be unit tested.
//
// Today calculates nothing of its own that another page also shows. The leads sentence uses Speed to lead's own counts, the appointments line uses
// Appointments' own total, "the one thing to do first" is the account audit's own pick (fixFirstFinding, stage F6) with one guard added (a single
// outlier deal never leads the screen), and every change over time follows the shared minimum-sample rule (percentChange in metrics.ts). What this file
// adds is wording, the order in which the questions are asked, and the change between two days of the stored daily snapshots.

import { fixFirstFinding, openLabel, type Audit, type Finding } from "./audit-intel.ts";
import { MIN_BASE_FOR_PERCENT, MIN_MONEY_BASE_FOR_PERCENT, percentChange } from "./metrics.ts";
import type { SeriesPoint } from "./digest-intel.ts";

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export type Scope = "all" | "account";

// ---------- the sentences ----------

/** Leads still waiting for a first reply, and leads never answered (Speed to lead's numbers: stillWaiting minus neverAnswered, and neverAnswered). */
export function leadsLine(i: { waiting: number | null; never: number; loading: boolean; /** Replies cannot be timed because a permission has not been approved. */ blocked?: boolean }): string {
  if (i.blocked) return "Leads waiting for a reply cannot be counted yet.";
  if (i.loading && i.waiting === null) return "Checking for leads waiting for a reply...";
  if (i.waiting === null) return "Leads waiting for a reply could not be loaded.";
  if (i.waiting === 0 && i.never === 0) return "No leads are waiting for a reply right now.";
  const waiting = `${plural(i.waiting, "lead is", "leads are")} waiting for a reply`;
  return `${waiting}${i.never > 0 ? `, and ${i.never.toLocaleString("en-US")} ${i.never === 1 ? "was" : "were"} never answered` : ""}.`;
}

export function appointmentsLine(unmarked: number | null, blocked = false): string {
  if (blocked) return "Appointments cannot be checked yet because the calendar permission has not been approved.";
  if (unmarked === null) return "Checking appointments...";
  if (unmarked === 0) return "Every past appointment has an outcome recorded.";
  return `${unmarked.toLocaleString("en-US")} past ${unmarked === 1 ? "appointment has" : "appointments have"} no outcome recorded, so the show rate is a guess.`;
}

/** In the all-accounts view the count is of client accounts; in one account's view it is of things that need doing in that account. */
export function attentionLine(count: number | null, scope: Scope): string {
  if (count === null) return scope === "account" ? "Checking this account..." : "Checking your accounts...";
  if (scope === "account") return count === 0 ? "Nothing else needs this account today." : `${plural(count, "thing needs", "things need")} attention in this account today.`;
  return count === 0 ? "No client account needs you today." : `${plural(count, "client account needs", "client accounts need")} attention today.`;
}

/** The one sentence under the title: what this screen is for, in plain words (the five-second test). At most 120 characters (SUBTITLE_MAX in the page template). */
export function todaySubtitle(scope: Scope, name: string | null): string {
  if (scope === "account") return name ? `${name.length > 30 ? name.slice(0, 29) + "…" : name}: leads waiting, appointments to fix and deals that stopped moving. Start at the top.` : "Your account: leads waiting, appointments to fix and deals that stopped moving. Start at the top.";
  return "Every client account, checked for leads waiting, missed appointments and stalled deals. Start at the top.";
}

// ---------- the one thing to do first ----------

export type FirstKey = Finding["key"] | "leads" | "appointments" | "accounts" | "outlier";
export type First = { key: FirstKey; text: string; button: string; view: Finding["view"] | "speed" | "today"; detail: string | null; note: string | null };

export type FirstInput = {
  waiting: number | null; never: number; unmarked: number | null; attention: number | null; scope: Scope;
  /** The account audit (stage F6). Null while it loads or when it could not be read. */
  audit: Pick<Audit, "findings" | "outlier" | "notes"> | null;
};

/**
 * The account audit's own pick (fixFirstFinding, the same one the Account audit page puts first), worded for Today. One guard: when the pick is a
 * stalled-deals figure and ONE deal is most of it (audit.outlier), the text is "check this deal", never a pattern, and `outlier` is true so the
 * caller can keep it from leading the screen. A finding that is only information (a permission, thin records) is never a pick.
 */
export function auditPick(audit: FirstInput["audit"]): (First & { outlier: boolean }) | null {
  const f = audit ? fixFirstFinding(audit) : null;
  if (!audit || !f) return null;
  const note = audit.notes.find((n) => n.key === f.note)?.text ?? null;
  if (f.key === "stale" && audit.outlier) {
    const o = audit.outlier;
    return { key: "outlier", outlier: true, text: `Check one deal worth ${money(o.value)}. It is ${Math.round(o.share * 100)}% of the money in deals that have not moved.`, button: openLabel(f.view), view: f.view, detail: "If it is a real deal, move it forward or close it out. If it is a test or a mistake, fix it in your CRM so it stops standing out.", note };
  }
  return { key: f.key, outlier: false, text: `${f.title}.`, button: openLabel(f.view), view: f.view, detail: f.fix, note };
}

/**
 * The single thing a person should do first, and the button that does it. Order: leads waiting (they go cold in minutes), then the audit's pick unless
 * one outlier deal drives it, then appointments with no outcome, then client accounts that need attention, and last of all the outlier deal, worded as a
 * check. Null means there is nothing to do first: the calm all-clear.
 */
export function chooseFirst(i: FirstInput): First | null {
  const leads = (i.waiting ?? 0) + i.never;
  if (leads > 0) {
    return { key: "leads", text: i.waiting && i.waiting > 0 ? `Reply to ${plural(i.waiting, "waiting lead")}, the longest wait first.` : `Look at ${plural(i.never, "lead")} that nobody ever answered.`, button: "Open Speed to lead", view: "speed", detail: null, note: null };
  }
  const pick = auditPick(i.audit);
  if (pick && !pick.outlier) return pick;
  if ((i.unmarked ?? 0) > 0) {
    return { key: "appointments", text: `Record what happened at ${plural(i.unmarked ?? 0, "past appointment")}.`, button: openLabel("appointments"), view: "appointments", detail: "Until they are marked showed or no-show, every show rate is a guess.", note: null };
  }
  if (i.scope === "all" && (i.attention ?? 0) > 0) {
    return { key: "accounts", text: `${plural(i.attention ?? 0, "client account needs", "client accounts need")} you today.`, button: "See which", view: "today", detail: null, note: null };
  }
  return pick;
}

// ---------- change over time ----------

export type ChangeKey = "openValue" | "stale" | "new30" | "unread";
const TILES: Array<{ key: ChangeKey; label: string; money: boolean }> = [
  { key: "openValue", label: "Open pipeline", money: true },
  { key: "stale", label: "Stale deals", money: false },
  { key: "new30", label: "New contacts (30 days)", money: false },
  { key: "unread", label: "Unread conversations", money: false },
];
/** For these a rise is bad (more stale deals, more unread); for the others a rise is good. */
export const UP_IS_BAD: ReadonlySet<string> = new Set(["stale", "unread"]);

export type RangeChange = {
  key: ChangeKey; label: string; money: boolean;
  now: number;
  /** The figure on the last day before the window started; the first day SubSync has when its history is shorter than the window. Null with no history. */
  then: number | null; thenDay: string | null;
  /** False when SubSync has not been watching for the whole window, so `then` is the earliest day it has. */
  coversWindow: boolean;
  /** The plain difference, always. A percentage only when the earlier figure was a large enough base (N6). */
  diff: number | null; percent: number | null; smallBase: boolean;
  /** The figure on each day of the window (for the small trend line). */
  points: number[];
};

const DEAL_KEYS = new Set<string>(["openValue", "stale"]);

/**
 * How each headline figure changed between the day before `fromDay` and the last day stored on or before `toDay`, summed over the accounts handed in.
 * Days counted under older deal rules (dealsOk false) are not compared for deal figures, the same rule as the daily headlines (digest-intel.ts).
 */
export function portfolioRangeChanges(perAccount: SeriesPoint[][], fromDay: string, toDay = "9999-12-31"): RangeChange[] {
  if (perAccount.every((s) => s.length === 0)) return [];
  return TILES.map((t) => {
    const lists = perAccount.map((s) => s.filter((p) => p.day <= toDay && (!DEAL_KEYS.has(t.key) || p.dealsOk !== false)));
    const days = [...new Set(lists.flatMap((s) => s.map((p) => p.day)))].sort();
    const values = days.map((d) => lists.reduce((sum, series) => sum + ((series.find((p) => p.day === d)?.[t.key] as number | undefined) ?? 0), 0));
    if (days.length === 0) return { key: t.key, label: t.label, money: t.money, now: 0, then: null, thenDay: null, coversWindow: false, diff: null, percent: null, smallBase: false, points: [] };
    const now = values[values.length - 1];
    let idx = -1;
    for (let k = 0; k < days.length; k++) if (days[k] < fromDay) idx = k;
    const covers = idx >= 0;
    const at = covers ? idx : 0;
    // The day to compare with has to be an earlier day than the last one; with one day of history there is nothing to compare with.
    const then = at < days.length - 1 ? values[at] : null;
    const minBase = t.money ? MIN_MONEY_BASE_FOR_PERCENT : MIN_BASE_FOR_PERCENT;
    return {
      key: t.key, label: t.label, money: t.money, now, then, thenDay: then === null ? null : days[at], coversWindow: covers && then !== null,
      diff: then === null ? null : Math.round((now - then) * 10) / 10, percent: then === null ? null : percentChange(now, then, minBase), smallBase: then !== null && then < minBase,
      points: values.filter((_, k) => days[k] >= fromDay || k === at),
    };
  });
}

/** The change as one plain sentence. A percentage never appears below the minimum base; below it the plain difference does, and says so. */
export function describeRangeChange(c: RangeChange, fmt: (n: number) => string = (n) => String(Math.round(n))): string {
  if (c.then === null || c.diff === null) return "No earlier day to compare with yet";
  if (c.diff === 0) return `No change from ${fmt(c.then)}`;
  const word = c.diff > 0 ? "Up" : "Down";
  if (c.percent !== null) return `${word} ${Math.abs(c.percent)}% from ${fmt(c.then)}`;
  return `${word} ${fmt(Math.abs(c.diff))} from ${fmt(c.then)} (too small a base for a percentage)`;
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(dayMs(d)) && new Date(dayMs(d)).toISOString().slice(0, 10) === d;

/** The server-side check on the start day a caller asks for: a real date, before today, and not more than the longest range back. */
export function validFromDay(from: unknown, today: string): string | null {
  if (!isDay(from)) return null;
  if (dayMs(from) >= dayMs(today) || dayMs(today) - dayMs(from) > MAX_RANGE_DAYS * 86_400_000) return null;
  return from;
}

/** The end day: a real date, not before the start, not after today. Missing means today. */
export function validToDay(to: unknown, from: string, today: string): string | null {
  if (to === null || to === undefined || to === "") return today;
  if (!isDay(to) || dayMs(to) < dayMs(from) || dayMs(to) > dayMs(today)) return null;
  return to;
}

// ---------- the copy-able summary ----------

/** The front door as plain lines to paste into a message (a morning check-in, a handover). */
export function summaryText(i: { who: string; leads: string; appointments: string; attention: string; first: First | null }): string {
  const lines = [`${i.who}: today`, i.leads, i.appointments, i.attention];
  if (i.first) lines.push("", `Do this first: ${i.first.text}`);
  return lines.join("\n");
}
