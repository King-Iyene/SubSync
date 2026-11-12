// Wallet guard, pure rules (no database, no imports, unit tested). Definitions: docs/METRICS.md "Wallet guard".
// The platform gives only the balance NOW. Everything else here (spend, burn rate, days left, spikes, top-ups) is worked out from SubSync's own readings,
// which is why it needs a few days of record before it says anything: under the minimums the answer is "not enough data", never a guess.

export const DAY = 86_400_000;

// ---- minimums and thresholds ----
export const MIN_READINGS = 4; // readings in the window before a burn rate is given
export const MIN_SPAN_DAYS = 3; // days between the first and last reading of the window
export const BURN_WINDOW_DAYS = 7; // the burn rate looks at the last 7 days
export const MAX_GAP_HOURS = 36; // a gap between two readings longer than this is not counted as one day's spend
export const BASELINE_DAYS = 14; // "normal" is the middle value of the 14 days before the latest day
export const MIN_BASELINE_DAYS = 7; // days with a reading needed before "normal" exists
export const SPIKE_TIMES = 3; // a day's spend this many times normal
export const SPIKE_EXTRA = 5; // and at least this many dollars above normal
export const SPIKE_FLOOR = 10; // when normal is zero: at least this many dollars in a day
export const TOPUP_MIN = 1; // a rise of less than this is a rounding change, not a top-up
export const DEFAULT_LOW_AMOUNT = 10;
export const DEFAULT_LOW_DAYS = 3;

export type Reading = { at: number; balance: number };
export type DaySpend = { day: string; spent: number; topups: number; topupAmount: number; readings: number; covered: boolean };

export const FORMULA_BURN =
  "Average spend per day = the drops between our readings of the balance over the last 7 days, divided by the days those readings cover. A rise (a top-up) is not counted as spend. Days left = balance divided by that average. It is an estimate and needs at least 4 readings over 3 days; until then it says not enough data.";
export const FORMULA_SPIKE =
  "A spike is a day whose spend is at least 3 times this account's own normal (the middle value of its previous 14 days, needing 7 of them) and at least $5 more than normal. When normal is zero, at least $10 in the day. It is an estimate from our readings.";

export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Spend and top-ups per day (UTC) from readings in time order. A drop between two readings is spend on the later reading's day; a rise of TOPUP_MIN or more is a top-up. A gap longer than MAX_GAP_HOURS is not spend of one day (the day is marked not covered). Pure. */
export function daily(readings: readonly Reading[]): DaySpend[] {
  const rs = readings.slice().sort((a, b) => a.at - b.at);
  const by = new Map<string, DaySpend>();
  const get = (d: string) => { let x = by.get(d); if (!x) { x = { day: d, spent: 0, topups: 0, topupAmount: 0, readings: 0, covered: true }; by.set(d, x); } return x; };
  for (let i = 0; i < rs.length; i++) {
    const cur = rs[i], d = get(dayKey(cur.at));
    d.readings++;
    if (i === 0) { d.covered = false; continue; }
    const prev = rs[i - 1], delta = prev.balance - cur.balance;
    if (cur.at - prev.at > MAX_GAP_HOURS * 3_600_000) d.covered = false;
    if (delta > 0) d.spent += delta;
    else if (-delta >= TOPUP_MIN) { d.topups++; d.topupAmount += -delta; }
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Every rise of TOPUP_MIN or more between two readings, with the amount. Pure. */
export function topupList(readings: readonly Reading[]): Array<{ at: number; amount: number }> {
  const rs = readings.slice().sort((a, b) => a.at - b.at), out: Array<{ at: number; amount: number }> = [];
  for (let i = 1; i < rs.length; i++) if (rs[i].balance - rs[i - 1].balance >= TOPUP_MIN) out.push({ at: rs[i].at, amount: rs[i].balance - rs[i - 1].balance });
  return out;
}

const median = (v: number[]): number => { const s = v.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export type Burn = { enough: boolean; perDay: number | null; spent: number; spanDays: number; readings: number };

/** The average spend per day over the last 7 days of readings. `enough` is false under 4 readings or 3 days. perDay is 0 when the balance never fell. Pure. */
export function burnRate(readings: readonly Reading[], now: number): Burn {
  const from = now - BURN_WINDOW_DAYS * DAY;
  const rs = readings.filter((r) => r.at >= from && r.at <= now).sort((a, b) => a.at - b.at);
  if (rs.length < 2) return { enough: false, perDay: null, spent: 0, spanDays: 0, readings: rs.length };
  let spent = 0, counted = 0;
  for (let i = 1; i < rs.length; i++) {
    const gap = rs[i].at - rs[i - 1].at;
    if (gap > MAX_GAP_HOURS * 3_600_000) continue; // a long gap hides top-ups: left out of both the spend and the days
    counted += gap;
    const d = rs[i - 1].balance - rs[i].balance;
    if (d > 0) spent += d;
  }
  const spanDays = counted / DAY;
  const enough = rs.length >= MIN_READINGS && spanDays >= MIN_SPAN_DAYS;
  return { enough, perDay: enough ? spent / spanDays : null, spent, spanDays, readings: rs.length };
}

/** Days of balance left at the current burn. Null when there is no honest figure (not enough data, or no spend seen). Zero when the balance is empty. */
export function daysLeft(balance: number | null, burn: Burn): number | null {
  if (balance === null) return null;
  if (balance <= 0) return 0;
  if (!burn.enough || burn.perDay === null || !(burn.perDay > 0)) return null;
  return balance / burn.perDay;
}

export type Spike = { enough: boolean; spike: boolean; day: string | null; spent: number | null; baseline: number | null };

/** The latest day with a covered reading against the account's own normal. Under MIN_BASELINE_DAYS covered days before it: not enough data, never a spike. Pure. */
export function spikeOf(days: readonly DaySpend[]): Spike {
  const cov = days.filter((d) => d.covered).sort((a, b) => a.day.localeCompare(b.day));
  const last = cov[cov.length - 1];
  if (!last) return { enough: false, spike: false, day: null, spent: null, baseline: null };
  const prior = cov.slice(0, -1).slice(-BASELINE_DAYS);
  if (prior.length < MIN_BASELINE_DAYS) return { enough: false, spike: false, day: last.day, spent: last.spent, baseline: null };
  const baseline = median(prior.map((d) => d.spent));
  const spike = baseline > 0 ? last.spent >= SPIKE_TIMES * baseline && last.spent - baseline >= SPIKE_EXTRA : last.spent >= SPIKE_FLOOR;
  return { enough: true, spike, day: last.day, spent: last.spent, baseline };
}

export type Analysis = {
  burn: Burn; daysLeft: number | null; spike: Spike; spent7d: number; topups7d: number; lastTopupAt: number | null; readings: number;
};

/** Everything the sweep stores for one account, from its readings. Pure. */
export function analyze(readings: readonly Reading[], now: number): Analysis {
  const rs = readings.slice().sort((a, b) => a.at - b.at);
  const burn = burnRate(rs, now);
  const days = daily(rs);
  const cut = dayKey(now - BURN_WINDOW_DAYS * DAY);
  const wk = days.filter((d) => d.day >= cut);
  let last: number | null = null;
  for (let i = 1; i < rs.length; i++) if (rs[i].balance - rs[i - 1].balance >= TOPUP_MIN) last = rs[i].at;
  const latest = rs[rs.length - 1];
  return { burn, daysLeft: daysLeft(latest ? latest.balance : null, burn), spike: spikeOf(days), spent7d: wk.reduce((t, d) => t + d.spent, 0), topups7d: wk.reduce((t, d) => t + d.topups, 0), lastTopupAt: last, readings: rs.length };
}

// ---- levels (applied at read time so a changed threshold takes effect at once) ----

export type Rules = { lowAmount: number; lowDays: number };
export type Level = "empty" | "low" | "spike" | "ok" | "unknown";

export function isEmpty(balance: number | null): boolean { return balance !== null && balance <= 0; }
export function isLow(balance: number | null, days: number | null, r: Rules): boolean {
  if (balance === null || balance <= 0) return false;
  return balance <= r.lowAmount || (days !== null && days <= r.lowDays);
}
export function levelOf(a: { balance: number | null; daysLeft: number | null; spike: boolean }, r: Rules): Level {
  if (a.balance === null) return "unknown";
  if (isEmpty(a.balance)) return "empty";
  if (isLow(a.balance, a.daysLeft, r)) return "low";
  return a.spike ? "spike" : "ok";
}

/** The one plain line that says why an account is where it is on the watchlist. */
export function whyLine(a: { balance: number | null; daysLeft: number | null; burnPerDay: number | null; spike: boolean; spikeSpent: number | null; spikeBaseline: number | null; lowAmount: number; state: string }): string {
  if (a.balance === null) return a.state === "needs_permission" ? "Needs permission: reconnect" : a.state === "not_checked" ? "Not checked yet" : "Not available from the platform yet";
  if (a.balance <= 0) return "The balance is empty: texts, calls and emails can stop.";
  const d = a.daysLeft !== null ? `about ${a.daysLeft < 1 ? "less than a day" : `${Math.round(a.daysLeft)} ${Math.round(a.daysLeft) === 1 ? "day" : "days"}`} left at the usual spend (estimate)` : null;
  if (d && (a.daysLeft as number) <= 14) return `${d.charAt(0).toUpperCase()}${d.slice(1)}.`;
  if (a.spike && a.spikeSpent !== null) return `Spent ${usd(a.spikeSpent)} in a day${a.spikeBaseline !== null ? `, against a normal of ${usd(a.spikeBaseline)}` : ""} (estimate).`;
  if (a.balance <= a.lowAmount) return `Under your ${usd(a.lowAmount)} limit.`;
  return d ? `${d.charAt(0).toUpperCase()}${d.slice(1)}.` : "No spending seen yet in our readings.";
}

export const usd = (n: number): string => `$${n >= 100 ? Math.round(n).toLocaleString("en-US") : (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

// ---- alerts ----

export type AlertKind = "wg_empty" | "wg_low" | "wg_spike";
export type AlertPlan = { kind: AlertKind; event: "empty" | "low" | "spike"; episode: string; title: string };

/** Which alerts one account should raise now. One per episode: a low balance alerts once until the account is topped up; a spike once per day. `lastTopup` is the day key of the last top-up ("x" when none). Pure. */
export function planAlerts(a: { name: string; balance: number | null; daysLeft: number | null; spike: Spike; lastTopup: string | null }, r: Rules, day: string): AlertPlan[] {
  if (a.balance === null) return [];
  const ep = a.lastTopup ?? "x", out: AlertPlan[] = [];
  if (isEmpty(a.balance)) out.push({ kind: "wg_empty", event: "empty", episode: ep, title: `${a.name}: the credit balance is empty. Texts, calls and emails can stop until it is topped up.` });
  else if (isLow(a.balance, a.daysLeft, r)) {
    const left = a.daysLeft !== null && a.daysLeft <= r.lowDays ? `, about ${Math.max(1, Math.round(a.daysLeft))} ${Math.round(a.daysLeft) <= 1 ? "day" : "days"} left (estimate)` : "";
    out.push({ kind: "wg_low", event: "low", episode: ep, title: `${a.name}: the credit balance is low (${usd(a.balance)})${left}.` });
  }
  if (a.spike.enough && a.spike.spike && a.spike.spent !== null && a.spike.day === day) out.push({ kind: "wg_spike", event: "spike", episode: day, title: `${a.name}: spent ${usd(a.spike.spent)} today against a normal of ${usd(a.spike.baseline ?? 0)} (estimate).` });
  return out;
}

/** Order of the watchlist: empty first, then the fewest days left, then the lowest balance, then accounts with no estimate, unknown last. Returns a sortable tuple. */
export function rankKey(a: { balance: number | null; daysLeft: number | null }): [number, number, number] {
  if (a.balance === null) return [4, 0, 0];
  if (a.balance <= 0) return [0, 0, 0];
  if (a.daysLeft !== null) return [1, a.daysLeft, a.balance];
  return [2, a.balance, a.balance];
}
