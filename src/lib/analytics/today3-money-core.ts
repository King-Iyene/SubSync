// The pure side of the money row on Today (no database, safe for the browser). Definitions: docs/METRICS.md "Today: the money row".
// Rule of this file: a figure that cannot be known is null with a plain reason, never 0 and never a guess.
import type { Td3Money, Td3RiskCause } from "./today3-types";

export const MIN_CLOSED_FOR_EXPECTED = 20; // won plus lost deals an account needs before its win rate prices anything (the same minimum as the audit and the forecast)
export const SHORT_HISTORY_DAYS = 7; // under this many days of our own record, a "recovered" figure says "history starts <date>"
export const RECOVERED_DAYS = 30;

export const usdText = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

export type CauseMoney = Td3Money["atRisk"]["byCause"];

/** Dollars at risk: the sum of the causes that have a priced deal. Null when no deal has a value, so "$0" never means "unknown". */
export function totalAtRisk(by: CauseMoney): { deals: number; dollars: number | null } {
  const deals = by.stale.deals + by.waiting.deals + by.noshow.deals;
  const priced = [by.stale, by.waiting, by.noshow].filter((c) => c.dollars !== null);
  return { deals, dollars: priced.length ? Math.round(priced.reduce((s, c) => s + (c.dollars ?? 0), 0)) : null };
}

const CAUSE_WORDS: Record<Td3RiskCause, { label: (n: number) => string; why: string }> = {
  stale: { label: (n) => `Open ${n === 1 ? "the quiet deal" : `${n.toLocaleString("en-US")} quiet deals`}`, why: "Open deals nobody has touched for 30 days." },
  waiting: { label: (n) => `Reply to ${n === 1 ? "the person" : `${n.toLocaleString("en-US")} people`} with a deal waiting over a day`, why: "Their last message is from the customer and nobody has answered." },
  noshow: { label: (n) => `Rebook ${n === 1 ? "the no-show" : `${n.toLocaleString("en-US")} no-shows`} who ${n === 1 ? "has" : "have"} a deal`, why: "Missed in the last 7 days and not booked again." },
};

/** The one action worth the most: the cause with the most dollars (ties go to the larger count, then quiet, waiting, no-show). Null when nothing is priced. */
export function biggestOf(by: CauseMoney): Td3Money["biggest"] {
  const order: Td3RiskCause[] = ["stale", "waiting", "noshow"];
  const best = order.filter((c) => by[c].deals > 0 && (by[c].dollars ?? 0) > 0).sort((a, b) => (by[b].dollars ?? 0) - (by[a].dollars ?? 0) || by[b].deals - by[a].deals || order.indexOf(a) - order.indexOf(b))[0];
  if (!best) return null;
  return { cause: best, deals: by[best].deals, dollars: Math.round(by[best].dollars ?? 0), label: CAUSE_WORDS[best].label(by[best].deals), why: CAUSE_WORDS[best].why, list: `risk_${best}` };
}

/** Expected value of the open pipeline: for each account with at least `min` won or lost deals, open dollars times its own win rate. Accounts under the minimum are not priced. */
export function expectedOf(open: ReadonlyArray<{ loc: string; dollars: number }>, closed: ReadonlyArray<{ loc: string; won: number; lost: number }>, min = MIN_CLOSED_FOR_EXPECTED): { expected: number | null; priced: number; accounts: number } {
  const rate = new Map(closed.filter((c) => c.won + c.lost >= min).map((c) => [c.loc, c.won / (c.won + c.lost)]));
  let sum = 0, priced = 0;
  for (const o of open) { const r = rate.get(o.loc); if (r === undefined) continue; sum += o.dollars * r; priced++; }
  return { expected: priced > 0 ? Math.round(sum) : null, priced, accounts: open.length };
}

/** "+12%" or "-8%" against the period before; null when there is nothing honest to compare (no earlier figure, or an earlier figure of zero). */
export function changeOf(cur: number | null, prev: number | null): { text: string; up: boolean } | null {
  if (cur === null || prev === null || prev <= 0) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return { text: `${p >= 0 ? "+" : ""}${p}%`, up: p >= 0 };
}

/** True while our own record is too young to say much: no start day, or fewer than `days` days since it. */
export function historyShort(startsOn: string | null, now: number, days = SHORT_HISTORY_DAYS): boolean {
  if (!startsOn) return true;
  const t = Date.parse(`${startsOn}T00:00:00Z`);
  return !Number.isFinite(t) || now - t < days * 86_400_000;
}

/** True when our record starts on or before the first day of the earlier period, so a change against it is honest. */
export function coversPrevious(startsOn: string | null, now: number, days = RECOVERED_DAYS): boolean {
  if (!startsOn) return false;
  const t = Date.parse(`${startsOn}T00:00:00Z`);
  return Number.isFinite(t) && t <= now - 2 * days * 86_400_000;
}

export const AT_RISK_FORMULA = "Open deals with a value and an owner that are in danger: untouched for 30 days, or the customer wrote over a day ago and nobody answered, or a no-show in the last 7 days who was not booked again. Each deal counts once, at its own dollar value. It is the size of the problem, not money already lost. People with no deal on file have no value, so they are not priced.";
export const RECOVERED_FORMULA = "Deals marked won in our CRM after SubSync saw the person get an answer, a call back or a new booking. Only from our own record, which starts the day SubSync first saw your accounts. Each deal counts once, at its own value.";
export const PIPELINE_FORMULA = "Open deals with a value and an owner, at their own dollar value. Expected = each account's open dollars times its own win rate, only for accounts with at least 20 won or lost deals. It is an estimate, not a promise.";

export function whyNoRisk(deals: number, anyDeals: number): string | null {
  if (deals > 0) return null;
  return anyDeals === 0 ? "Not enough data yet: no open deal has a dollar value and an owner. Add deal values in your CRM to see this." : null;
}

/** Plain note for a tile when a read needs more than SubSync has: never "0". */
export function unavailableNote(kind: "permission" | "platform" | "unchecked"): string {
  return kind === "permission" ? "Needs permission: reconnect" : kind === "platform" ? "Not available from the platform yet" : "Not checked yet";
}
