// Email lead growth for Today's Growth tab. Pure: no database, no React, so every rule here is unit tested with fixtures (src/lib/__tests__/growth.test.ts).
// Written definitions: docs/METRICS.md, "Email leads (Today, Growth)".
//
// A lead is ONE unique person with a usable email, counted once per client account. People are told apart by a normalised email: lower case, trimmed, the "+tag" part
// removed, and for Gmail the dots in the name removed (googlemail.com counts as gmail.com). Left out of the count, and said so in the breakdown: the extra copies of a person,
// test and junk records (same rules as Data health), the company's own staff domains, and, as a setting, role addresses such as info@ or sales@. A contact with no email is not an
// email lead. Nothing here changes any data; it only counts what SubSync already holds.

import { emailState, isJunk } from "../data-health/rules.ts";
import { sourceLabel, NO_SOURCE } from "./speed-intel.ts";

const DAY = 86_400_000;
export const SERIES_DAYS = 30;
/** The smallest earlier figure a percentage is shown against; below it we say "not enough to compare". */
export const MIN_PREVIOUS = 5;
/** A month younger than this has too little to forecast from. */
export const MIN_FORECAST_DAYS = 7;
/** Signals (alerts, Worth a look) stay quiet unless the account's normal is at least this many leads for the period. */
export const MIN_NORMAL_WEEK = 10;
export const MIN_NORMAL_DAY = 3;
export const DROP_AT = -0.4;
export const SPIKE_AT = 0.6;
/** Role addresses that are a mailbox of a business, not a person. */
export const ROLE_LOCALS = new Set([
  "info", "admin", "administrator", "sales", "support", "contact", "hello", "office", "team", "billing", "noreply", "no-reply", "donotreply", "mail", "enquiries", "inquiries", "enquiry",
  "service", "services", "help", "accounts", "accounting", "hr", "jobs", "careers", "marketing", "webmaster", "postmaster", "reception", "bookings", "booking", "orders", "press", "media",
]);

// ---------- the email ----------

/** The one form of an email that two copies of the same person share, or null when it is empty or not an address. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local ? `${local}@${domain}` : null;
}
export const isRoleAddress = (email: string | null | undefined): boolean => {
  const n = normaliseEmail(email);
  return n !== null && ROLE_LOCALS.has(n.slice(0, n.indexOf("@")).replace(/\./g, ""));
};
const domainOf = (email: string | null | undefined) => (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
/** A domain typed into the settings, cleaned: "@Acme.com " becomes "acme.com". */
export const cleanDomain = (raw: string): string | null => {
  const d = raw.trim().toLowerCase().replace(/^@/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
};

// ---------- who counts ----------

export type GrowthContact = {
  id: string; locationId: string; name: string; email: string | null; source: string | null; at: number | null; firstName?: string | null; lastName?: string | null; phone?: string | null; url?: string;
  /** Marked do not contact, or tagged as unsubscribed: never in a download. */
  dnd?: boolean;
};
export type GrowthRules = { excludeRoleAddresses: boolean; internalDomains: string[]; junkWords?: string[] };
export type Verdict = "counted" | "duplicate" | "junk" | "staff" | "role" | "no_email";
export const VERDICT_WORD: Record<Exclude<Verdict, "counted" | "no_email">, string> = { duplicate: "Extra copy", junk: "Test or junk", staff: "Staff", role: "Shared mailbox" };

/**
 * One verdict per contact. Order: no email, invalid or test record, staff domain, shared mailbox, then the extra copies (the earliest record of a person counts, the later ones are copies).
 * The same person at two different client accounts is two leads, one for each client, because each client is counted on its own.
 */
export function classify(contacts: GrowthContact[], rules: GrowthRules): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const staff = new Set(rules.internalDomains.map((d) => d.toLowerCase()));
  const keep: GrowthContact[] = [];
  for (const c of contacts) {
    const norm = normaliseEmail(c.email);
    if (!c.email?.trim()) { out.set(c.id, "no_email"); continue; }
    if (norm === null || emailState(c.email) !== "ok" || isJunk({ firstName: c.firstName ?? c.name, lastName: c.lastName ?? null, email: c.email, phone: c.phone ?? null }, rules.junkWords ?? [])) { out.set(c.id, "junk"); continue; }
    if (staff.has(domainOf(c.email))) { out.set(c.id, "staff"); continue; }
    if (rules.excludeRoleAddresses && isRoleAddress(c.email)) { out.set(c.id, "role"); continue; }
    keep.push(c);
  }
  // The earliest record of each person (per client account) is the lead; a record with no date goes last so a dated one wins.
  const first = new Map<string, GrowthContact>();
  for (const c of keep) {
    const k = `${c.locationId}|${normaliseEmail(c.email)}`;
    const have = first.get(k);
    if (!have || (c.at ?? Infinity) < (have.at ?? Infinity) || ((c.at ?? Infinity) === (have.at ?? Infinity) && c.id < have.id)) first.set(k, c);
  }
  for (const c of keep) out.set(c.id, first.get(`${c.locationId}|${normaliseEmail(c.email)}`)?.id === c.id ? "counted" : "duplicate");
  return out;
}

// ---------- time, in each client's own time zone ----------

// Building an Intl formatter is slow (about a millisecond), so each zone's two formatters are made once.
const FMT = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: "d" | "t", zone: string): Intl.DateTimeFormat {
  const k = `${kind}|${zone}`;
  let f = FMT.get(k);
  if (!f) {
    f = kind === "d" ? new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      : new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    FMT.set(k, f);
  }
  return f;
}
function parts(ms: number, zone: string): { y: number; m: number; d: number; wd: number } {
  try {
    const f = fmt("d", zone).formatToParts(new Date(ms));
    const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), wd };
  } catch { return parts(ms, "UTC"); }
}
function offsetAt(ms: number, zone: string): number {
  try {
    const f = fmt("t", zone).formatToParts(new Date(ms));
    const g = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
  } catch { return 0; }
}
/** The moment a local calendar day starts in the zone. */
export function localMidnight(y: number, m: number, d: number, zone: string): number {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(guess, zone);
  return guess - offsetAt(first, zone);
}
export const dayKey = (ms: number, zone: string): string => { const p = parts(ms, zone); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };

export type Bounds = {
  todayStart: number; yesterdayStart: number; weekStart: number; lastWeekStart: number; monthStart: number; lastMonthStart: number;
  dayOfMonth: number; daysInMonth: number; hour: number;
};
/** Where today, this week (Monday on), this month and the ones before them start, in the zone. */
export function boundsOf(now: number, zone: string): Bounds {
  const p = parts(now, zone);
  const todayStart = localMidnight(p.y, p.m, p.d, zone);
  const back = (n: number) => { const q = parts(todayStart - n * DAY + DAY / 2, zone); return localMidnight(q.y, q.m, q.d, zone); };
  const sinceMonday = (p.wd + 6) % 7;
  const monthStart = localMidnight(p.y, p.m, 1, zone);
  const prevMonth = p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 };
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "numeric" }).format(new Date(now)));
  return {
    todayStart, yesterdayStart: back(1), weekStart: back(sinceMonday), lastWeekStart: back(sinceMonday + 7), monthStart, lastMonthStart: localMidnight(prevMonth.y, prevMonth.m, 1, zone),
    dayOfMonth: p.d, daysInMonth: new Date(Date.UTC(p.y, p.m, 0)).getUTCDate(), hour,
  };
}

// ---------- the numbers ----------

export type Period = "today" | "week" | "month" | "all";
export type Change = { count: number; previous: number | null; pct: number | null; /** "up", "down" or "same"; null when there is nothing to compare. */ direction: "up" | "down" | "same" | null; note: string | null };

export const pctChange = (now: number, before: number): number | null => (before >= MIN_PREVIOUS ? Math.round(((now - before) / before) * 100) : null);
function changeOf(count: number, previous: number | null): Change {
  if (previous === null) return { count, previous: null, pct: null, direction: null, note: null };
  const pct = pctChange(count, previous);
  if (pct === null) return { count, previous, pct: null, direction: null, note: `Only ${previous} in the period before, too few to compare.` };
  return { count, previous, pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "same", note: null };
}

export type LeadAt = { at: number; zone: string };
const within = (ts: number[], from: number, to: number) => { let n = 0; for (const t of ts) if (t >= from && t < to) n++; return n; };

/** Today, this week and this month so far, each against the same stretch of the period before (yesterday to this time, last week to this day and time, last month to this day). */
export function changesOf(leads: LeadAt[], now: number): Record<Period, Change> {
  const res = { today: [0, 0], week: [0, 0], month: [0, 0], all: [0, 0] } as Record<Period, [number, number]>;
  const byZone = new Map<string, number[]>();
  for (const l of leads) byZone.set(l.zone, [...(byZone.get(l.zone) ?? []), l.at]);
  for (const [zone, ts] of byZone) {
    const b = boundsOf(now, zone);
    res.today[0] += within(ts, b.todayStart, now + 1); res.today[1] += within(ts, b.yesterdayStart, b.yesterdayStart + (now - b.todayStart));
    res.week[0] += within(ts, b.weekStart, now + 1); res.week[1] += within(ts, b.lastWeekStart, b.lastWeekStart + (now - b.weekStart));
    res.month[0] += within(ts, b.monthStart, now + 1); res.month[1] += within(ts, b.lastMonthStart, Math.min(b.monthStart, b.lastMonthStart + (now - b.monthStart)));
    res.all[0] += ts.filter((t) => t <= now).length;
  }
  return { today: changeOf(res.today[0], res.today[1]), week: changeOf(res.week[0], res.week[1]), month: changeOf(res.month[0], res.month[1]), all: changeOf(res.all[0], null) };
}

// ---------- the daily line ----------

export type DayPoint = { day: string; label: string; count: number; partial: boolean; avg7: number | null };
/** New email leads per day for the last SERIES_DAYS days ending today (today is partial and drawn lighter), with the trailing 7 day average over complete days. */
export function dailySeries(leads: LeadAt[], now: number, refZone: string, win?: { from: string; to: string }): DayPoint[] {
  const counts = new Map<string, number>();
  for (const l of leads) { const k = dayKey(l.at, l.zone); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const b = boundsOf(now, refZone);
  const days: string[] = [];
  if (win) { for (let t = Date.parse(`${win.from}T12:00:00Z`); t <= Date.parse(`${win.to}T12:00:00Z`); t += DAY) days.push(new Date(t).toISOString().slice(0, 10)); }
  else for (let i = SERIES_DAYS - 1; i >= 0; i--) days.push(dayKey(b.todayStart - i * DAY + DAY / 2, refZone));
  const todayKey = dayKey(now, refZone);
  const out: DayPoint[] = days.map((day) => ({ day, label: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }), count: counts.get(day) ?? 0, partial: day === todayKey, avg7: null }));
  for (let i = 0; i < out.length; i++) {
    if (i < 6 || out[i].partial) continue;
    const win = out.slice(i - 6, i + 1);
    out[i].avg7 = Math.round((win.reduce((s, p) => s + p.count, 0) / 7) * 10) / 10;
  }
  return out;
}
/** The badge over the chart: the last 7 complete days against the 7 before them. Null when the earlier week is too small. */
export function weekBadge(series: DayPoint[]): { pct: number; direction: "up" | "down" | "same" } | null {
  const done = series.filter((p) => !p.partial);
  if (done.length < 14) return null;
  const a = done.slice(-7).reduce((s, p) => s + p.count, 0), b = done.slice(-14, -7).reduce((s, p) => s + p.count, 0);
  const pct = pctChange(a, b);
  return pct === null ? null : { pct, direction: pct >= 5 ? "up" : pct <= -5 ? "down" : "same" };
}

// ---------- goal and forecast ----------

export type GoalStatus = { goal: number; count: number; share: number; state: "reached" | "on_track" | "behind" | "not_enough"; forecast: number | null; note: string };
/** The month so far against the goal. A forecast needs 7 days of the month; before that it says so. On track means the month-end forecast reaches the goal. */
export function goalStatus(goal: number, count: number, b: Pick<Bounds, "dayOfMonth" | "daysInMonth">, now: number, monthStart: number): GoalStatus {
  const elapsed = Math.max((now - monthStart) / DAY, 0.01);
  const share = Math.min(1, count / goal);
  if (count >= goal) return { goal, count, share: 1, state: "reached", forecast: Math.round(Math.max(count, (count / elapsed) * b.daysInMonth)), note: "Goal reached." };
  if (elapsed < MIN_FORECAST_DAYS) return { goal, count, share, state: "not_enough", forecast: null, note: `Not enough data yet. A forecast needs ${MIN_FORECAST_DAYS} days of the month.` };
  const forecast = Math.round((count / elapsed) * b.daysInMonth);
  return { goal, count, share, state: forecast >= goal ? "on_track" : "behind", forecast, note: `At this pace the month ends near ${forecast.toLocaleString("en-US")}.` };
}

// ---------- sources ----------

export type SourceRow = { source: string; count: number; previous: number; share: number; change: number };
export type SourceMix = { rows: SourceRow[]; total: number; previousTotal: number; best: SourceRow | null; worst: SourceRow | null; line: string };
/** Where the last 30 days of email leads came from, against the 30 days before. Best is the source that grew most, worst the one that fell most, both with at least 5 leads in one of the two periods. */
export function sourceMix(leads: Array<{ at: number; source: string | null }>, now: number, win?: { start: number; end: number }): SourceMix {
  const cur = new Map<string, number>(), prev = new Map<string, number>();
  // The chosen dates against the same number of days right before them (default: the last 30 days against the 30 before).
  const end = Math.min(win?.end ?? now, now), start = win?.start ?? now - 30 * DAY, len = Math.max(DAY, end - start);
  const days = Math.round(len / DAY);
  for (const l of leads) {
    const s = sourceLabel(l.source);
    if (l.at > start && l.at <= end) cur.set(s, (cur.get(s) ?? 0) + 1);
    else if (l.at > start - len && l.at <= start) prev.set(s, (prev.get(s) ?? 0) + 1);
  }
  const total = [...cur.values()].reduce((s, n) => s + n, 0), previousTotal = [...prev.values()].reduce((s, n) => s + n, 0);
  const rows: SourceRow[] = [...new Set([...cur.keys(), ...prev.keys()])].map((source) => {
    const count = cur.get(source) ?? 0, previous = prev.get(source) ?? 0;
    return { source, count, previous, share: total ? count / total : 0, change: count - previous };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  const eligible = rows.filter((r) => r.source !== NO_SOURCE && Math.max(r.count, r.previous) >= 5 && previousTotal >= MIN_PREVIOUS);
  const best = [...eligible].sort((a, b) => b.change - a.change)[0] ?? null;
  const worst = [...eligible].sort((a, b) => a.change - b.change)[0] ?? null;
  const b2 = best && best.change > 0 ? best : null, w2 = worst && worst.change < 0 && worst.source !== b2?.source ? worst : null;
  const line = total < 10 ? `Not enough email leads in these ${days} days to compare sources.`
    : [b2 ? `${b2.source} grew most (+${b2.change})` : null, w2 ? `${w2.source} fell most (${w2.change})` : null].filter(Boolean).join(", ") || `No source moved much against the ${days} days before.`;
  return { rows, total, previousTotal, best: b2, worst: w2, line };
}

// ---------- sudden drop or spike ----------

export type GrowthSignal = { locationId: string; scope: "week" | "day"; direction: "drop" | "spike"; count: number; normal: number; pct: number; text: string };
/**
 * Compares one account's email leads with its OWN normal. This week so far against the average of the 4 weeks before, to the same point of the week: needs the account to have had
 * at least 28 days of history and a normal of 10 or more. Today against the average of the previous 14 days: judged only after 3 pm local time (a day is not "down" at 9 am), and
 * needs a normal of 3 or more a day. A drop is 40% or more under normal, a spike 60% or more over. Quiet (no signal) whenever the account's data is thin.
 */
export function signalsOf(locationId: string, accountName: string, ats: number[], zone: string, now: number): GrowthSignal[] {
  const out: GrowthSignal[] = [];
  const b = boundsOf(now, zone);
  const oldest = ats.length ? Math.min(...ats) : now;
  if (now - oldest >= 28 * DAY) {
    const sofar = now - b.weekStart;
    const mine = within(ats, b.weekStart, now + 1);
    let prior = 0;
    for (let k = 1; k <= 4; k++) { const from = b.weekStart - k * 7 * DAY; prior += within(ats, from, from + sofar); }
    const normal = prior / 4;
    if (normal >= MIN_NORMAL_WEEK && sofar >= 2 * DAY) {
      const ratio = (mine - normal) / normal;
      if (ratio <= DROP_AT) out.push({ locationId, scope: "week", direction: "drop", count: mine, normal: Math.round(normal), pct: Math.round(ratio * 100), text: `${accountName}: ${mine} new email leads this week so far, ${Math.abs(Math.round(ratio * 100))}% under its usual ${Math.round(normal)}.` });
      else if (ratio >= SPIKE_AT) out.push({ locationId, scope: "week", direction: "spike", count: mine, normal: Math.round(normal), pct: Math.round(ratio * 100), text: `${accountName}: ${mine} new email leads this week so far, ${Math.round(ratio * 100)}% over its usual ${Math.round(normal)}.` });
    }
  }
  if (now - oldest >= 14 * DAY && b.hour >= 15) {
    const mine = within(ats, b.todayStart, now + 1);
    const normal = within(ats, b.todayStart - 14 * DAY, b.todayStart) / 14;
    if (normal >= MIN_NORMAL_DAY) {
      const ratio = (mine - normal) / normal;
      if (ratio <= -0.6) out.push({ locationId, scope: "day", direction: "drop", count: mine, normal: Math.round(normal * 10) / 10, pct: Math.round(ratio * 100), text: `${accountName}: ${mine} new email leads today, far under its usual ${Math.round(normal)} a day.` });
      else if (ratio >= 1.5) out.push({ locationId, scope: "day", direction: "spike", count: mine, normal: Math.round(normal * 10) / 10, pct: Math.round(ratio * 100), text: `${accountName}: ${mine} new email leads today, well over its usual ${Math.round(normal)} a day.` });
    }
  }
  return out;
}

// ---------- the whole read ----------

export type GrowthAccount = { id: string; name: string; zone: string; url: string };
export type GrowthRecord = { id: string; locationId: string; accountName: string; name: string; email: string; source: string | null; at: number; day: string; today: boolean; week: boolean; month: boolean; verdict: Verdict; url: string };
export type LeagueRow = { locationId: string; name: string; url: string; week: Change; month: number; goal: number | null; status: GoalStatus | null; signal: GrowthSignal | null };
export type GrowthData = {
  now: number; scope: "agency" | "account"; zone: string; rules: GrowthRules; accounts: number;
  changes: Record<Period, Change>;
  gross: { signUps: number; unique: number; removed: Record<"duplicate" | "junk" | "staff" | "role", number>; windowDays: number };
  /** The dates the chart, the sources and the sign ups cover, the count in them and the count in the same number of days right before. */
  range: { from: string; to: string; days: number; label: string; count: number; previous: number; change: Change; start: number; end: number };
  series: DayPoint[]; badge: ReturnType<typeof weekBadge>;
  goal: { total: number | null; count: number; status: GoalStatus | null; accountsWithGoal: number };
  mix: SourceMix; signals: GrowthSignal[]; league: LeagueRow[];
  /** Counted leads of the last 62 days (the ones a day, a week or a month opens) and removed records of the last 30 days. */
  records: GrowthRecord[]; recentAll: GrowthRecord[]; partial: boolean;
  setup: { goalsReady: boolean; settingsReady: boolean };
};

export type GrowthInput = {
  now: number; accounts: GrowthAccount[]; contacts: GrowthContact[]; rules: GrowthRules; goals: Record<string, number>; scope: "agency" | "account"; partial?: boolean;
  setup?: { goalsReady: boolean; settingsReady: boolean };
  /** Days (YYYY-MM-DD, inclusive) the tab asked for; default is the last 30 days ending today. */
  range?: { from: string; to: string; label?: string };
};
export const RECORD_CAP = 4000;
export const RECENT_ALL_CAP = 2000;

export function buildGrowth(i: GrowthInput): GrowthData {
  const zoneOf = new Map(i.accounts.map((a) => [a.id, a.zone]));
  const acct = new Map(i.accounts.map((a) => [a.id, a]));
  const verdicts = classify(i.contacts, i.rules);
  const dated = i.contacts.filter((c) => c.at !== null && c.at <= i.now && acct.has(c.locationId));
  const counted = dated.filter((c) => verdicts.get(c.id) === "counted");
  const leads = counted.map((c) => ({ at: c.at as number, zone: zoneOf.get(c.locationId) ?? "UTC" }));
  const zones = new Map<string, number>();
  for (const a of i.accounts) zones.set(a.zone, (zones.get(a.zone) ?? 0) + 1);
  const refZone = [...zones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UTC";

  const b0 = boundsOf(i.now, refZone);
  const todayIso = dayKey(i.now, refZone);
  const rf = i.range?.from ?? dayKey(b0.todayStart - 29 * DAY + DAY / 2, refZone), rt = i.range?.to ?? todayIso;
  const [fy, fm, fd] = rf.split("-").map(Number), [ty, tm, td] = rt.split("-").map(Number);
  const rStart = localMidnight(fy, fm, fd, refZone);
  const rEnd = Math.min(localMidnight(ty, tm, td + 1, refZone), i.now + 1);
  const WINDOW = Math.max(1, Math.round((localMidnight(ty, tm, td + 1, refZone) - rStart) / DAY));
  const inRange = (at: number) => at >= rStart && at < rEnd;
  const removed = { duplicate: 0, junk: 0, staff: 0, role: 0 };
  let signUps = 0, unique = 0;
  for (const c of dated) {
    const v = verdicts.get(c.id);
    if (!v || v === "no_email" || !inRange(c.at as number)) continue;
    signUps++;
    if (v === "counted") unique++; else removed[v]++;
  }

  const rec = (c: GrowthContact, v: Verdict): GrowthRecord => {
    const a = acct.get(c.locationId) as GrowthAccount;
    const b = boundsOf(i.now, a.zone);
    const at = c.at as number;
    return { id: c.id, locationId: c.locationId, accountName: a.name, name: c.name, email: c.email ?? "", source: c.source, at, day: dayKey(at, a.zone), today: at >= b.todayStart, week: at >= b.weekStart, month: at >= b.monthStart, verdict: v, url: c.url || a.url };
  };
  const byRecent = (a: GrowthContact, b: GrowthContact) => (b.at as number) - (a.at as number);
  const records = [
    ...counted.filter((c) => ((c.at as number) > i.now - 62 * DAY || inRange(c.at as number))).sort(byRecent).slice(0, RECORD_CAP).map((c) => rec(c, "counted")),
    ...dated.filter((c) => { const v = verdicts.get(c.id); return v && v !== "counted" && v !== "no_email" && inRange(c.at as number); }).sort(byRecent).slice(0, 1000).map((c) => rec(c, verdicts.get(c.id) as Verdict)),
  ];
  const recentAll = counted.sort(byRecent).slice(0, RECENT_ALL_CAP).map((c) => rec(c, "counted"));

  const series = dailySeries(leads, i.now, refZone, { from: rf, to: rt });
  const perAccount = new Map<string, number[]>();
  for (const c of counted) { const l = perAccount.get(c.locationId); if (l) l.push(c.at as number); else perAccount.set(c.locationId, [c.at as number]); }
  const signals: GrowthSignal[] = [];
  const league: LeagueRow[] = i.accounts.map((a) => {
    const ats = perAccount.get(a.id) ?? [];
    const ch = changesOf(ats.map((at) => ({ at, zone: a.zone })), i.now);
    const b = boundsOf(i.now, a.zone);
    const goal = i.goals[a.id] ?? null;
    const sig = signalsOf(a.id, a.name, ats, a.zone, i.now);
    signals.push(...sig);
    return { locationId: a.id, name: a.name, url: a.url, week: ch.week, month: ch.month.count, goal, status: goal ? goalStatus(goal, ch.month.count, b, i.now, b.monthStart) : null, signal: sig.find((s) => s.scope === "week") ?? sig[0] ?? null };
  });
  // Fastest growing first; accounts with nothing to compare go last, then by name.
  league.sort((a, b) => (b.week.pct ?? -Infinity) - (a.week.pct ?? -Infinity) || b.week.count - a.week.count || a.name.localeCompare(b.name));

  const withGoal = league.filter((r) => r.goal !== null);
  const goalTotal = withGoal.reduce((s, r) => s + (r.goal as number), 0);
  const goalCount = withGoal.reduce((s, r) => s + r.month, 0);
  const rCount = leads.filter((l) => inRange(l.at)).length, rLen = rEnd - rStart;
  const rPrev = leads.filter((l) => l.at >= rStart - rLen && l.at < rStart).length;
  return {
    now: i.now, scope: i.scope, zone: refZone, rules: i.rules, accounts: i.accounts.length, changes: changesOf(leads, i.now),
    gross: { signUps, unique, removed, windowDays: WINDOW },
    range: { from: rf, to: rt, days: WINDOW, label: i.range?.label ?? `Last ${WINDOW} days`, count: rCount, previous: rPrev, change: changeOf(rCount, rPrev), start: rStart, end: rEnd }, series, badge: weekBadge(series),
    goal: { total: withGoal.length ? goalTotal : null, count: goalCount, status: withGoal.length ? goalStatus(goalTotal, goalCount, b0, i.now, b0.monthStart) : null, accountsWithGoal: withGoal.length },
    mix: sourceMix(counted.map((c) => ({ at: c.at as number, source: c.source })), i.now), signals: signals.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)), league,
    records, recentAll, partial: !!i.partial, setup: i.setup ?? { goalsReady: true, settingsReady: true },
  };
}
