// Account audit history (docs/features/AUDIT_BRIEF.md). Pure: no database, no React, so the counting, the comparison rules and every sentence can be unit tested.
//
// What is stored: for each client account and each day the audit was read, the number of people or deals in each of the four findings, the counted stale deal money
// and the ESTIMATE (a range) with the number of closed deals it rests on. Nothing about a person or a deal is stored, only counts.
//
// THE COMPARISON RULES (docs/METRICS.md, "Account audit history"):
//  1. Only the same rules version is compared with itself. After the counting rules change, older runs are shown as "counted under older rules", never subtracted.
//  2. A run that was cut at the read cap ("partial") is never compared: a cut count against a full count is not a change.
//  3. "Then vs now" needs at least 7 days between the baseline and now; "since the last audit" needs at least 1 day. Before that the screen says when the comparison appears.
//  4. The estimate is compared only for accounts that have at least 20 closed deals on BOTH sides; otherwise "Not enough data". It is never added to counted money.
//  5. An account with no baseline row (its first audit has not been recorded yet) is not part of any comparison; a finding that could not be checked (null) is skipped.

import { MIN_CLOSED_FOR_PRICE, priceRows, type AuditAccount, type AuditV2, type FindingKey } from "./audit-v2.ts";

/** The version of the Account audit's counting rules. Bump it when what a finding counts changes, so history is never compared across rules. */
export const AUDIT_RULES_VERSION = 1;
export const MIN_DAYS_THEN_NOW = 7;
export const MIN_DAYS_SINCE_LAST = 1;

export type CountKey = Exclude<FindingKey, "leftovers">;
export const COUNT_KEYS: CountKey[] = ["replies", "stale", "noshows", "appointments"];
export type RunCounts = Record<CountKey, number | null>;

export const NOUN: Record<CountKey, { one: string; many: string; label: string }> = {
  replies: { one: "person waiting for a reply", many: "people waiting for a reply", label: "People waiting for a reply" },
  stale: { one: "deal gone quiet", many: "deals gone quiet", label: "Deals gone quiet" },
  noshows: { one: "no-show not rebooked", many: "no-shows not rebooked", label: "No-shows not rebooked" },
  appointments: { one: "appointment with no outcome", many: "appointments with no outcome", label: "Appointments with no outcome" },
};

/** One account's counts as they are right now, ready to be stored or compared. */
export type RunInput = {
  locationId: string; counts: RunCounts; staleDollars: number;
  estimate: number | null; estLow: number | null; estHigh: number | null; closedDeals: number; partial: boolean;
};

/** A stored run (what the database returns). */
export type RunRow = RunInput & { runDay: string; rulesVersion: number; baseline: boolean };

/** The runs for today from the audit that is on screen: one per client account, built from the same rows as the findings so the numbers add up to the page. */
export function runsFromAudit(a: AuditV2, accounts: AuditAccount[], calendars: boolean): RunInput[] {
  const per = new Map<string, RunInput>();
  const blank = (id: string): RunInput => ({ locationId: id, counts: { replies: 0, stale: 0, noshows: calendars ? 0 : null, appointments: calendars ? 0 : null }, staleDollars: 0, estimate: null, estLow: null, estHigh: null, closedDeals: 0, partial: false });
  for (const acc of accounts) per.set(acc.id, { ...blank(acc.id), closedDeals: acc.won + acc.lost });
  const people = new Map<string, Array<{ locationId: string }>>();
  for (const f of a.findings) {
    if (f.key === "leftovers") continue;
    const key: CountKey = f.key;
    for (const it of f.items) {
      const r = per.get(it.locationId);
      if (!r) continue;
      if (r.counts[key] !== null) r.counts[key] = (r.counts[key] as number) + 1;
      if (key === "stale") r.staleDollars += it.value ?? 0;
      if (key === "replies" || key === "noshows") people.set(it.locationId, [...(people.get(it.locationId) ?? []), it]);
    }
    if (f.partial) for (const r of per.values()) r.partial = true;
  }
  for (const acc of accounts) {
    const r = per.get(acc.id);
    if (!r) continue;
    const priced = priceRows(people.get(acc.id) ?? [], [acc]);
    r.estimate = priced.dollars; r.estLow = priced.range?.low ?? null; r.estHigh = priced.range?.high ?? null;
    r.staleDollars = Math.round(r.staleDollars);
  }
  return [...per.values()];
}

export const things = (c: RunCounts) => COUNT_KEYS.reduce((s, k) => s + (c[k] ?? 0), 0);

// ---------- comparing ----------

export type Tone = "better" | "worse" | "same" | "unknown";
export type ThenNowLine = { key: CountKey; label: string; noun: string; then: number | null; now: number | null; change: number | null; tone: Tone; accounts: number };
export type Pair = { then: RunRow; now: RunRow };
export type EstimateCompare = { thenLow: number; thenHigh: number; nowLow: number; nowHigh: number; accounts: number };
export type Compare = {
  /** Accounts that could be compared. */
  accounts: number;
  lines: ThenNowLine[];
  /** Counted stale deal money then and now (a fact, shown on its own line, never added to the estimate). */
  staleDollars: { then: number; now: number } | null;
  /** The estimate then and now, or null when no account has enough closed deals on both sides. */
  estimate: EstimateCompare | null;
  thenDay: string | null; nowDay: string | null;
};

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 86_400_000);

/** Which pairs may be compared at all (rules 1, 2 and 3). */
export function comparable(p: Pair, minDays: number): boolean {
  return p.then.rulesVersion === p.now.rulesVersion && !p.then.partial && !p.now.partial && daysBetween(p.then.runDay, p.now.runDay) >= minDays;
}

export function comparePairs(pairs: Pair[], minDays: number): Compare {
  const ok = pairs.filter((p) => comparable(p, minDays));
  const lines: ThenNowLine[] = COUNT_KEYS.map((key) => {
    let then = 0, now = 0, n = 0;
    for (const p of ok) {
      const a = p.then.counts[key], b = p.now.counts[key];
      if (a === null || b === null) continue;
      then += a; now += b; n++;
    }
    const known = n > 0;
    const change = known ? now - then : null;
    return { key, label: NOUN[key].label, noun: NOUN[key].many, then: known ? then : null, now: known ? now : null, change, tone: !known ? "unknown" : change === 0 ? "same" : (change as number) < 0 ? "better" : "worse", accounts: n };
  });
  const est = ok.filter((p) => p.then.closedDeals >= MIN_CLOSED_FOR_PRICE && p.now.closedDeals >= MIN_CLOSED_FOR_PRICE && p.then.estLow !== null && p.then.estHigh !== null && p.now.estLow !== null && p.now.estHigh !== null);
  const estimate: EstimateCompare | null = est.length === 0 ? null : {
    thenLow: Math.round(est.reduce((s, p) => s + (p.then.estLow as number), 0)), thenHigh: Math.round(est.reduce((s, p) => s + (p.then.estHigh as number), 0)),
    nowLow: Math.round(est.reduce((s, p) => s + (p.now.estLow as number), 0)), nowHigh: Math.round(est.reduce((s, p) => s + (p.now.estHigh as number), 0)), accounts: est.length,
  };
  return {
    accounts: ok.length, lines,
    staleDollars: ok.length === 0 ? null : { then: Math.round(ok.reduce((s, p) => s + p.then.staleDollars, 0)), now: Math.round(ok.reduce((s, p) => s + p.now.staleDollars, 0)) },
    estimate, thenDay: ok.length ? ok.map((p) => p.then.runDay).sort()[0] : null, nowDay: ok.length ? ok.map((p) => p.now.runDay).sort().slice(-1)[0] : null,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "12 fewer people waiting for a reply; 4 more deals gone quiet." or null when there is nothing to say. */
export function changeSentence(c: Compare, since: string, wording: "last" | "baseline"): string | null {
  if (c.accounts === 0) return null;
  const known = c.lines.filter((l) => l.change !== null);
  if (known.length === 0) return null;
  const moved = known.filter((l) => l.change !== 0);
  const where = wording === "last" ? `the last audit on ${shortDay(since)}` : `the baseline on ${shortDay(since)}`;
  if (moved.length === 0) return `Nothing has changed since ${where}.`;
  const parts = moved.map((l) => {
    const n = Math.abs(l.change as number);
    const noun = n === 1 ? NOUN[l.key].one : NOUN[l.key].many;
    return `${n.toLocaleString("en-US")} ${(l.change as number) < 0 ? "fewer" : "more"} ${noun}`;
  });
  return `Since ${where}: ${parts.join("; ")}.`;
}

// ---------- what the screen shows ----------

export type HistoryState = "recording" | "baseline_only" | "ready" | "rules_changed";
export type NewAccount = { id: string; name: string; baselineDay: string; things: number | null };
export type History = {
  state: HistoryState;
  /** The first day any audit was recorded for these accounts ("history starts <date>"). */
  startsOn: string | null;
  /** Why there is no comparison yet, in plain words (null when there is one). */
  why: string | null;
  thenNow: Compare | null;
  /** "Since the last audit..." for the top of the page. */
  since: string | null;
  sinceDay: string | null;
  series: Array<{ day: string; things: number; accounts: number }>;
  newAccounts: NewAccount[];
  accounts: number;
  /** Accounts whose first audit is not recorded yet. */
  waiting: number;
};

export type Stored = { runs: Map<string, { first: RunRow | null; before: RunRow | null }>; series: Array<{ day: string; things: number; accounts: number }> };

/** Builds what the screen shows from today's runs and the stored first run and the last run before today for each account. */
export function buildHistory(i: { today: string; now: RunRow[]; stored: Stored; names: Map<string, string>; newWithinDays?: number }): History {
  const nowRows = new Map(i.now.map((r) => [r.locationId, r]));
  const pairsBaseline: Pair[] = [], pairsLast: Pair[] = [];
  let waiting = 0, older = 0, firstDay: string | null = null;
  const newAccounts: NewAccount[] = [];
  for (const [id, now] of nowRows) {
    const s = i.stored.runs.get(id);
    if (!s || !s.first) { waiting++; continue; }
    if (!firstDay || s.first.runDay < firstDay) firstDay = s.first.runDay;
    if (s.first.rulesVersion !== now.rulesVersion) older++;
    pairsBaseline.push({ then: s.first, now });
    if (s.before) pairsLast.push({ then: s.before, now });
    if (s.first.baseline && daysBetween(s.first.runDay, i.today) <= (i.newWithinDays ?? 30)) newAccounts.push({ id, name: i.names.get(id) ?? "Client account", baselineDay: s.first.runDay, things: s.first.partial ? null : things(s.first.counts) });
  }
  newAccounts.sort((a, b) => (a.baselineDay < b.baselineDay ? 1 : -1));
  const thenNow = comparePairs(pairsBaseline, MIN_DAYS_THEN_NOW);
  const last = comparePairs(pairsLast, MIN_DAYS_SINCE_LAST);
  const since = changeSentence(last, last.thenDay ?? i.today, "last");
  let state: HistoryState, why: string | null = null;
  if (pairsBaseline.length === 0) { state = "recording"; why = "History starts with this audit. Come back after the next one to see what changed."; }
  else if (thenNow.accounts === 0) {
    const nearest = pairsBaseline.map((p) => p.then.runDay).sort()[0];
    if (older === pairsBaseline.length) { state = "rules_changed"; why = "The counting rules changed after the baseline, so older audits are not compared with today's."; }
    else { state = "baseline_only"; const wait = Math.max(0, MIN_DAYS_THEN_NOW - daysBetween(nearest, i.today)); why = `Baseline taken ${shortDay(nearest)}. The comparison appears ${wait > 0 ? `in ${plural(wait, "day", "days")}` : "once an audit that is not cut short has been read"}.`; }
  } else state = "ready";
  return {
    state, startsOn: firstDay, why, thenNow: thenNow.accounts > 0 ? thenNow : null, since: last.accounts > 0 ? since : null, sinceDay: last.accounts > 0 ? last.thenDay : null,
    series: i.stored.series, newAccounts: newAccounts.slice(0, 20), accounts: nowRows.size, waiting,
  };
}

// ---------- the monthly email ----------

/** `crmLink`: that account's own page in the CRM (built with deepLinks on the company's CRM domain), so each line opens its own account. */
export type MonthlyAccount = { name: string; then: number; now: number; crmLink?: string };
export type Monthly = { subject: string; text: string; better: number; worse: number } | null;

/** The monthly re-audit message: what got better, what got worse, one button. Accounts need a run at least 14 days before today and counts that are not cut short. */
export function monthlyMessage(i: { who: string; fromDay: string; toDay: string; accounts: MonthlyAccount[]; link: string; estimate?: EstimateCompare | null }): Monthly {
  if (i.accounts.length === 0) return null;
  const moved = i.accounts.filter((a) => a.then !== a.now);
  const better = moved.filter((a) => a.now < a.then).sort((a, b) => (a.now - a.then) - (b.now - b.then));
  const worse = moved.filter((a) => a.now > a.then).sort((a, b) => (b.now - b.then) - (a.now - a.then));
  const total = (k: "then" | "now") => i.accounts.reduce((s, a) => s + a[k], 0);
  const line = (a: MonthlyAccount) => `- ${a.name}: ${a.then.toLocaleString("en-US")} to ${a.now.toLocaleString("en-US")}${a.crmLink ? `\n  Open the account in your CRM: ${a.crmLink}` : ""}`;
  const head = total("now") === total("then")
    ? `Across ${plural(i.accounts.length, "client account", "client accounts")}, the number of things to fix is the same as on ${shortDay(i.fromDay)} (${total("now").toLocaleString("en-US")}).`
    : `Across ${plural(i.accounts.length, "client account", "client accounts")}, things to fix went from ${total("then").toLocaleString("en-US")} on ${shortDay(i.fromDay)} to ${total("now").toLocaleString("en-US")} on ${shortDay(i.toDay)}.`;
  const parts = [`Your monthly audit for ${i.who}`, "", head];
  if (better.length) parts.push("", "Got better:", ...better.slice(0, 5).map(line));
  if (worse.length) parts.push("", "Got worse:", ...worse.slice(0, 5).map(line));
  if (i.estimate) parts.push("", `Estimate (not a fact): the monthly leak was about $${i.estimate.thenLow.toLocaleString("en-US")} to $${i.estimate.thenHigh.toLocaleString("en-US")}, now about $${i.estimate.nowLow.toLocaleString("en-US")} to $${i.estimate.nowHigh.toLocaleString("en-US")}.`);
  parts.push("", `See the rows behind every number: open your CRM, then SubSync > Account audit. ${i.link}`, "", "You can turn this message off, or mute one client account, on the Account audit page.");
  const subject = better.length === 0 && worse.length === 0 ? "Monthly audit: no change" : `Monthly audit: ${plural(better.length, "client got better", "clients got better")}, ${worse.length} got worse`;
  return { subject, text: parts.join("\n"), better: better.length, worse: worse.length };
}

/** The sample shown only with ?aufx (labelled "Sample data" on screen). Fictional counts. */
export const SAMPLE_HISTORY: History = {
  state: "ready", startsOn: "2026-10-12", why: null, since: "Since the last audit on 4 Nov: 6 fewer people waiting for a reply; 2 more deals gone quiet.", sinceDay: "2026-11-04",
  thenNow: {
    accounts: 12, thenDay: "2026-10-12", nowDay: "2026-11-11",
    lines: [
      { key: "replies", label: NOUN.replies.label, noun: NOUN.replies.many, then: 41, now: 14, change: -27, tone: "better", accounts: 12 },
      { key: "stale", label: NOUN.stale.label, noun: NOUN.stale.many, then: 18, now: 21, change: 3, tone: "worse", accounts: 12 },
      { key: "noshows", label: NOUN.noshows.label, noun: NOUN.noshows.many, then: 9, now: 3, change: -6, tone: "better", accounts: 10 },
      { key: "appointments", label: NOUN.appointments.label, noun: NOUN.appointments.many, then: 22, now: 22, change: 0, tone: "same", accounts: 10 },
    ],
    staleDollars: { then: 84_000, now: 96_500 }, estimate: { thenLow: 6_200, thenHigh: 11_800, nowLow: 2_400, nowHigh: 5_100, accounts: 8 },
  },
  series: [
    { day: "2026-10-12", things: 90, accounts: 12 }, { day: "2026-10-19", things: 78, accounts: 12 }, { day: "2026-10-26", things: 66, accounts: 12 },
    { day: "2026-11-02", things: 61, accounts: 12 }, { day: "2026-11-09", things: 58, accounts: 12 },
  ],
  newAccounts: [{ id: "sample-1", name: "Sample Dental", baselineDay: "2026-11-09", things: 7 }],
  accounts: 12, waiting: 0,
};

/** What the one-pager carries: counts then and now (never a name). Null when there is nothing comparable. */
export function shareThenNow(c: Compare | null, accounts: number): { from: string; to: string; accounts: number; lines: Array<{ label: string; then: number; now: number }>; staleDollars?: { then: number; now: number }; estimate?: { thenLow: number; thenHigh: number; nowLow: number; nowHigh: number } } | null {
  if (!c || c.accounts === 0 || !c.thenDay || !c.nowDay) return null;
  const lines = c.lines.filter((l) => l.then !== null && l.now !== null).map((l) => ({ label: l.label, then: l.then as number, now: l.now as number }));
  if (lines.length === 0) return null;
  return {
    from: c.thenDay, to: c.nowDay, accounts: Math.min(accounts, c.accounts), lines,
    ...(c.staleDollars ? { staleDollars: c.staleDollars } : {}),
    ...(c.estimate ? { estimate: { thenLow: c.estimate.thenLow, thenHigh: c.estimate.thenHigh, nowLow: c.estimate.nowLow, nowHigh: c.estimate.nowHigh } } : {}),
  };
}
