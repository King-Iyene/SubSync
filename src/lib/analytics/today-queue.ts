// Today, rebuilt (the outcome-first front door). Pure: no database, no React, so every sentence, every ranking and every chart number on Today can be unit tested.
//
// Nothing here measures anything new. Every figure is one SubSync already shows on its own page, under its existing definition (docs/METRICS.md):
//   leads waiting      Speed to lead (a lead past its reply target with no person's reply)
//   appointments       Appointments (past, no outcome marked) and no-shows not rebooked
//   stale deals        the Account audit (counted open deals, no movement for the stale days, dollars from the deal values)
//   unanswered         the Account audit's waiting conversations
// What this file adds is the order things are listed in, the sentences, the shares behind the charts and the "vs your usual" comparisons.

import { MIN_FOR_MEDIAN } from "./speed-intel.ts";

export const KINDS = ["leads", "appointments", "noshows", "stale", "unanswered"] as const;
export type Kind = (typeof KINDS)[number];

/** Plain names for each kind, as the donut and its legend say them. */
export const KIND_LABEL: Record<Kind, string> = {
  leads: "Leads waiting", appointments: "Appointments to mark", noshows: "No-shows to recover", stale: "Stale deals", unanswered: "Unanswered messages",
};
/** One colour per KIND, the same everywhere on the page (the validated categorical chart tokens, in order). Status colours are never used for a kind. */
export const KIND_CHART: Record<Kind, 1 | 2 | 3 | 4 | 5> = { leads: 1, appointments: 2, noshows: 3, stale: 4, unanswered: 5 };
export const kindColour = (k: Kind) => `var(--chart-${KIND_CHART[k]})`;

export type TodayItem = {
  id: string; kind: Kind; locationId: string; accountName: string;
  /** The lead, deal or contact the row is about. */
  name: string; detail: string;
  /** Epoch ms since when it has been wrong (the lead arrived, the appointment started, the deal last moved). Null when unknown. */
  at: number | null;
  /** Counted dollars (a deal's value). Null for everything that is not a deal. */
  value: number | null;
  contactId: string | null; url: string;
  /** A lead nobody answered in days. */
  never?: boolean;
  /** The contact asked not to be contacted: never offered as a call. */
  dnd?: boolean; hasPhone?: boolean;
};

export type KindTotal = { count: number; dollars: number | null; /** Rows actually sent (a cap); count is the true number. */ shown: number };
export type Totals = Record<Kind, KindTotal>;
export const emptyTotals = (): Totals => Object.fromEntries(KINDS.map((k) => [k, { count: 0, dollars: null, shown: 0 }])) as Totals;

export type Severity = "critical" | "warning" | "info";
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export type AccountFacts = { id: string; name: string; /** The existing slow-follow-up estimate for this account (conversations waiting x average deal x win rate), or null. */ followUpEstimate: number | null; url: string };

export type QueueRow = {
  key: string; kind: Kind; locationId: string; accountName: string;
  /** What is wrong, in six to ten words. */
  text: string;
  count: number;
  /** Counted dollars at stake (stale deal values). Null when the row has none. */
  dollars: number | null;
  /** The existing estimate, labelled as one wherever it is shown. Only the unanswered-messages row has one. */
  estimate: number | null;
  /** Since when it has been wrong. */
  since: number | null; ageMinutes: number;
  severity: Severity;
  /** Where the primary button goes: the oldest item's CRM page, or the account's deals page. */
  url: string;
  /** The rows behind this row. */
  itemIds: string[];
  /** The list behind the row was cut: the count shown is of the rows sent. */
  partial: boolean;
};

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The words for how long, as a person would say it: "12 min", "3 h", "2 days". */
export function ageWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 600) return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

/** Six to ten words about what is wrong with this group. */
export function rowText(kind: Kind, count: number, staleDays: number): string {
  switch (kind) {
    case "leads": return `${plural(count, "lead")} waiting past the reply target`;
    case "appointments": return `${plural(count, "past appointment")} with no outcome marked`;
    case "noshows": return `${plural(count, "no-show")} from the last 14 days not rebooked`;
    case "stale": return `${plural(count, "open deal")} with no movement in ${staleDays}+ days`;
    case "unanswered": return `${plural(count, "conversation")} waiting for your reply past the target`;
  }
}

/** Severity of one group. Thresholds are written in docs/METRICS.md: a lead waiting an hour or never answered is critical; a pile of 5 or more waiting conversations or 10 or more stale deals is critical. */
export function severityOf(kind: Kind, count: number, ageMinutes: number, never: boolean): Severity {
  switch (kind) {
    case "leads": return never || ageMinutes >= 60 ? "critical" : "warning";
    case "unanswered": return count >= 5 ? "critical" : "warning";
    case "stale": return count >= 10 ? "critical" : "warning";
    case "noshows": return "warning";
    case "appointments": return count >= 5 ? "warning" : "info";
  }
}

export type QueueInput = { items: TodayItem[]; totals: Totals; accounts: Map<string, AccountFacts>; staleDays: number; now: number };

/** One row per (client account, kind). The count is the number of rows behind it, so the row and its list cannot disagree. */
export function buildQueue(i: QueueInput): QueueRow[] {
  const groups = new Map<string, TodayItem[]>();
  for (const it of i.items) {
    const k = `${it.locationId}|${it.kind}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const rows: QueueRow[] = [];
  for (const [key, items] of groups) {
    const first = items[0];
    const kind = first.kind;
    const withAt = items.filter((x) => x.at !== null).sort((a, b) => (a.at as number) - (b.at as number));
    const oldest = withAt[0] ?? first;
    const since = oldest.at;
    const ageMinutes = since === null ? 0 : Math.max(0, Math.round((i.now - since) / 60_000));
    const counted = items.filter((x) => x.value !== null && x.value > 0);
    const dollars = kind === "stale" ? counted.reduce((s, x) => s + (x.value as number), 0) : null;
    const acct = i.accounts.get(first.locationId);
    rows.push({
      key, kind, locationId: first.locationId, accountName: first.accountName, text: rowText(kind, items.length, i.staleDays), count: items.length,
      dollars: dollars && dollars > 0 ? dollars : null, estimate: kind === "unanswered" ? acct?.followUpEstimate ?? null : null,
      since, ageMinutes, severity: severityOf(kind, items.length, ageMinutes, items.some((x) => x.never === true)),
      url: kind === "stale" ? acct?.url ?? oldest.url : oldest.url, itemIds: items.map((x) => x.id),
      partial: i.totals[kind].count > i.totals[kind].shown,
    });
  }
  return rankQueue(rows);
}

/** The value at risk used to rank: counted dollars, else the existing estimate, else nothing. */
export const valueAtRisk = (r: Pick<QueueRow, "dollars" | "estimate">): number => r.dollars ?? r.estimate ?? 0;

/**
 * The ranking rule (docs/METRICS.md, "The Fix first queue"): value at risk first (largest first), then how long it has been wrong (longest first), then severity
 * (critical before warning before info), then the account name and the kind so the order never flickers between two reads.
 */
export function rankQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) =>
    valueAtRisk(b) - valueAtRisk(a) || b.ageMinutes - a.ageMinutes || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.accountName.localeCompare(b.accountName) || a.kind.localeCompare(b.kind));
}

// ---------- scoping: the account selector and the clicked kind ----------

export type TodayScope = { accounts: string[]; kind: Kind | null };

/** The rows that fall inside what the person picked. Empty accounts means all of them. */
export function scopeRows<T extends { locationId: string; kind: Kind }>(rows: T[], s: TodayScope): T[] {
  const picked = new Set(s.accounts);
  return rows.filter((r) => (picked.size === 0 || picked.has(r.locationId)) && (s.kind === null || r.kind === s.kind));
}

/** Totals recomputed from the rows that are inside the picked accounts (the count on a slice is the number of rows in its list). */
export function totalsOf(items: TodayItem[], full: Totals, accounts: string[]): Totals {
  const picked = new Set(accounts);
  const out = emptyTotals();
  const narrowed = picked.size > 0;
  for (const k of KINDS) {
    const mine = items.filter((x) => x.kind === k && (!narrowed || picked.has(x.locationId)));
    const dollars = k === "stale" ? mine.reduce((s, x) => s + (x.value ?? 0), 0) : 0;
    // With every account in, the true total (which may exceed the rows sent) is kept; once narrowed, the total is the rows of those accounts.
    out[k] = narrowed ? { count: mine.length, dollars: dollars > 0 ? dollars : null, shown: mine.length } : { ...full[k], shown: mine.length };
  }
  return out;
}

const ID = /^[A-Za-z0-9_-]{3,64}$/;
/** Today's own account choice in the address: `#today?ta=<id>,<id>`. Anything that is not a well-formed id is dropped; the server drops the rest. */
export function parseTodayAccounts(hash: string): string[] {
  const q = hash.indexOf("?");
  if (q === -1) return [];
  const v = new URLSearchParams(hash.slice(q + 1)).get("ta");
  return v ? [...new Set(v.split(",").filter((x) => ID.test(x)))].slice(0, 50) : [];
}
/** The address with Today's account choice set (or removed), keeping every other part. */
export function withTodayAccounts(hash: string, ids: string[]): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  const clean = [...new Set(ids.filter((x) => ID.test(x)))].slice(0, 50);
  if (clean.length) p.set("ta", clean.join(",")); else p.delete("ta");
  const rest = p.toString().replace(/%2C/gi, ",");
  return `${head || "#today"}${rest ? `?${rest}` : ""}`;
}
/** The query the server reads (the same `accounts=` every read already honours). */
export const accountsQuery = (ids: string[]) => (ids.length ? `accounts=${ids.filter((x) => ID.test(x)).join(",")}` : "");

// ---------- the headline ----------

export type HeadlinePart = { t: string; strong?: boolean };
export type Headline = { parts: HeadlinePart[]; text: string; allClear: boolean; /** "14 leads waiting, 6 appointments to mark and 9 stale deals worth $48,200." */ breakdown: string | null; accounts: number; dollars: number };

const COUNT_WORDS: Record<Kind, [string, string]> = {
  leads: ["lead waiting", "leads waiting"], appointments: ["appointment to mark", "appointments to mark"], noshows: ["no-show to recover", "no-shows to recover"],
  stale: ["stale deal", "stale deals"], unanswered: ["unanswered message", "unanswered messages"],
};

export function breakdownOf(t: Totals): string | null {
  const bits = KINDS.filter((k) => t[k].count > 0).map((k) => {
    const w = COUNT_WORDS[k];
    return `${t[k].count.toLocaleString("en-US")} ${t[k].count === 1 ? w[0] : w[1]}${k === "stale" && t.stale.dollars ? ` worth ${money(t.stale.dollars)}` : ""}`;
  });
  if (bits.length === 0) return null;
  return bits.length === 1 ? `${bits[0]}.` : `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}.`;
}

/**
 * The one big sentence. "4 clients need you today. $48,200 is at risk." The count of clients is the number of client accounts with at least one row in the queue,
 * the dollars are the counted value of stale deals (a fact, never an estimate). With nothing to do it says so plainly.
 */
export function headlineOf(i: { scope: "all" | "account"; rows: QueueRow[]; totals: Totals; /** One deal that is most of the stalled money (the audit's outlier guard). */ outlier?: { value: number; share: number } | null }): Headline {
  const accounts = new Set(i.rows.map((r) => r.locationId)).size;
  const things = KINDS.reduce((s, k) => s + i.totals[k].count, 0);
  const dollars = i.totals.stale.dollars ?? 0;
  const breakdown = breakdownOf(i.totals);
  if (things === 0) {
    const text = i.scope === "all" ? "Every client account is on track today." : "You are all caught up today.";
    return { parts: [{ t: text }], text, allClear: true, breakdown: null, accounts: 0, dollars: 0 };
  }
  const parts: HeadlinePart[] = i.scope === "all"
    ? [{ t: String(accounts), strong: true }, { t: ` ${accounts === 1 ? "client needs" : "clients need"} you today.` }]
    : [{ t: things.toLocaleString("en-US"), strong: true }, { t: ` ${things === 1 ? "thing needs" : "things need"} you today.` }];
  if (dollars > 0) parts.push({ t: " " }, { t: money(dollars), strong: true }, { t: " is at risk." });
  // One deal worth at least half of it is said out loud, so the dollar figure is not read as a pattern (the audit's outlier guard).
  if (dollars > 0 && i.outlier) parts.push({ t: ` One deal is ${money(i.outlier.value)} of that.` });
  return { parts, text: parts.map((p) => p.t).join(""), allClear: false, breakdown, accounts, dollars };
}

// ---------- the donut ----------

export type Slice = { kind: Kind; label: string; count: number; share: number; dollars: number | null; /** True when the list behind the slice was cut. */ partial: boolean };

/** The slices of "What needs attention": one per kind with something in it, largest first never (the fixed order keeps a kind in the same place). Shares sum to 100. */
export function slicesOf(t: Totals): Slice[] {
  const present = KINDS.filter((k) => t[k].count > 0);
  const total = present.reduce((s, k) => s + t[k].count, 0);
  if (total === 0) return [];
  // Largest remainder rounding, so the shares printed on the slices add up to 100.
  const raw = present.map((k) => (t[k].count / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((r, idx) => ({ idx, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem);
  for (const o of order) { if (left <= 0) break; floor[o.idx] += 1; left -= 1; }
  return present.map((k, idx) => ({ kind: k, label: KIND_LABEL[k], count: t[k].count, share: floor[idx], dollars: t[k].dollars, partial: t[k].count > t[k].shown }));
}

/** The title of the donut states the finding. */
export function donutTitle(t: Totals): string {
  const s = slicesOf(t);
  if (s.length === 0) return "Nothing needs attention right now";
  const top = [...s].sort((a, b) => b.count - a.count)[0];
  const total = s.reduce((x, y) => x + y.count, 0);
  return `${total.toLocaleString("en-US")} things need attention, most of them ${top.label.toLowerCase()} (${top.count.toLocaleString("en-US")})`;
}

// ---------- the per-account bars ----------

export type AccountBar = { locationId: string; name: string; count: number; dollars: number | null; kinds: Kind[] };

/** "Where it is happening": the accounts with the most things to fix, top `max`. The bar is the number of things; the dollars are in the tooltip. */
export function accountBars(rows: QueueRow[], max = 8): { bars: AccountBar[]; accounts: number } {
  const by = new Map<string, AccountBar>();
  for (const r of rows) {
    const cur = by.get(r.locationId) ?? { locationId: r.locationId, name: r.accountName, count: 0, dollars: null, kinds: [] };
    cur.count += r.count;
    if (r.dollars) cur.dollars = (cur.dollars ?? 0) + r.dollars;
    if (!cur.kinds.includes(r.kind)) cur.kinds.push(r.kind);
    by.set(r.locationId, cur);
  }
  const all = [...by.values()].sort((a, b) => b.count - a.count || (b.dollars ?? 0) - (a.dollars ?? 0) || a.name.localeCompare(b.name));
  return { bars: all.slice(0, max), accounts: all.length };
}

export function barsTitle(b: { bars: AccountBar[]; accounts: number }): string {
  if (b.bars.length === 0) return "No client account has anything to fix";
  const top = b.bars[0];
  return b.accounts === 1 ? `${top.name} has ${plural(top.count, "thing")} to fix` : `${top.name} has the most to fix: ${plural(top.count, "thing")}, out of ${b.accounts} accounts needing you`;
}

/** The tooltip, in words: "Bright Smile Dental: 14 leads waiting, $6,300 at stake". */
export function barTooltip(b: AccountBar, rows: QueueRow[]): string {
  const mine = rows.filter((r) => r.locationId === b.locationId);
  const parts = KINDS.map((k) => mine.filter((r) => r.kind === k)).filter((x) => x.length > 0)
    .map((x) => { const w = COUNT_WORDS[x[0].kind]; const n = x.reduce((s, r) => s + r.count, 0); return `${n.toLocaleString("en-US")} ${n === 1 ? w[0] : w[1]}`; });
  return `${b.name}: ${parts.join(", ")}${b.dollars ? `, ${money(b.dollars)} at stake` : ""}`;
}

// ---------- accounts needing you ----------

export type NeedingYou = { locationId: string; name: string; state: "Needs you now" | "Needs a look" | "Slipping"; reason: string; count: number; dollars: number | null; url: string };

/** One row per account, the worst reason first, ranked by the same rule as the queue. */
export function accountsNeedingYou(rows: QueueRow[], accounts: Map<string, AccountFacts>, limit = 5): { rows: NeedingYou[]; total: number } {
  const seen = new Set<string>();
  const out: NeedingYou[] = [];
  for (const r of rankQueue(rows)) {
    if (seen.has(r.locationId)) continue;
    seen.add(r.locationId);
    const mine = rows.filter((x) => x.locationId === r.locationId);
    const worst = mine.some((x) => x.severity === "critical") ? "critical" : mine.some((x) => x.severity === "warning") ? "warning" : "info";
    const dollars = mine.reduce((s, x) => s + (x.dollars ?? 0), 0);
    out.push({
      locationId: r.locationId, name: r.accountName, state: worst === "critical" ? "Needs you now" : worst === "warning" ? "Needs a look" : "Slipping",
      reason: r.text, count: mine.reduce((s, x) => s + x.count, 0), dollars: dollars > 0 ? dollars : null, url: accounts.get(r.locationId)?.url ?? r.url,
    });
  }
  return { rows: out.slice(0, limit), total: out.length };
}

// ---------- vs your usual ----------

export type Verdict = "better" | "worse" | "same" | "not_enough";
export type Usual = { verdict: Verdict; text: string };

/** Compared with its own earlier period, only when both sides have at least `minN` observations; a difference under `tolerance` is "about the same". */
export function vsUsual(i: { now: number | null; usual: number | null; nNow: number; nUsual: number; minN: number; lowerIsBetter: boolean; tolerance?: number; fmt: (n: number) => string }): Usual {
  if (i.now === null || i.usual === null || i.nNow < i.minN || i.nUsual < i.minN) return { verdict: "not_enough", text: "Not enough history yet to compare with your usual." };
  const tol = i.tolerance ?? 0.15;
  const change = i.usual === 0 ? (i.now === 0 ? 0 : 1) : (i.now - i.usual) / i.usual;
  if (Math.abs(change) < tol) return { verdict: "same", text: `About the same as your usual (${i.fmt(i.usual)}).` };
  const better = i.lowerIsBetter ? change < 0 : change > 0;
  return { verdict: better ? "better" : "worse", text: `${better ? "Better" : "Worse"} than your usual (${i.fmt(i.usual)}).` };
}

export type ReplyRow = { leadAt: number; touchAt: number | null };
export type ReplyPoint = { day: string; value: number; /** "Leads that arrived 8 to 14 Nov". */ window: string };
const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.5 * s.length) - 1))]; };
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayWords = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The typical (median) first reply of the leads that arrived in (to - days, to] and have been answered; null under the minimum for a median (speed-intel MIN_FOR_MEDIAN). */
export function medianReply(rows: ReplyRow[], to: number, days: number): { seconds: number | null; answered: number } {
  const times = rows.filter((r) => r.touchAt !== null && r.leadAt > to - days * DAY && r.leadAt <= to).map((r) => Math.max(0, Math.round(((r.touchAt as number) - r.leadAt) / 1000)));
  return { seconds: times.length >= MIN_FOR_MEDIAN ? median(times) : null, answered: times.length };
}

/**
 * Reply speed against the account's own usual: the typical first reply of the last 7 days against the 7 days before. The line is the 7-day typical reply for
 * each of the last 7 days (a day with fewer than the minimum answered leads is left out, never guessed).
 */
export function replyPulse(rows: ReplyRow[], now: number): { current: { seconds: number | null; answered: number }; usual: { seconds: number | null; answered: number }; points: ReplyPoint[]; verdict: Usual } {
  const current = medianReply(rows, now, 7);
  const usual = medianReply(rows, now - 7 * DAY, 7);
  const points: ReplyPoint[] = [];
  for (let back = 6; back >= 0; back--) {
    const end = now - back * DAY;
    const m = medianReply(rows, end, 7);
    if (m.seconds !== null) points.push({ day: dayKey(end), value: m.seconds, window: `Leads that arrived ${dayWords(end - 7 * DAY)} to ${dayWords(end)}` });
  }
  const verdict = vsUsual({ now: current.seconds, usual: usual.seconds, nNow: current.answered, nUsual: usual.answered, minN: MIN_FOR_MEDIAN, lowerIsBetter: true, fmt: replyWords });
  return { current, usual, points, verdict };
}

/** A reply time in words: "45 sec", "5 min", "2 h 10 min". */
export function replyWords(seconds: number | null): string {
  if (seconds === null) return "not enough replies yet";
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

export type WithinRow = { leadAt: number; touchAt: number | null };
/**
 * Days in a row, counting back from yesterday, on which at least one lead arrived and every lead that arrived was answered inside the target.
 * A day with no leads neither extends nor breaks the run. Only existing data (the lead's own arrival and first reply) is used.
 */
export function answeredStreak(rows: WithinRow[], targetMinutes: number, now: number, days = 14): number {
  const target = targetMinutes * 60_000;
  const byDay = new Map<string, WithinRow[]>();
  for (const r of rows) byDay.set(dayKey(r.leadAt), [...(byDay.get(dayKey(r.leadAt)) ?? []), r]);
  let streak = 0;
  for (let back = 1; back <= days; back++) {
    const list = byDay.get(dayKey(now - back * DAY));
    if (!list || list.length === 0) continue;
    const ok = list.every((r) => r.touchAt !== null && r.touchAt - r.leadAt <= target);
    if (!ok) break;
    streak += 1;
  }
  return streak;
}

/** Share of leads that arrived in (to - days, to] answered inside the target, counting still-waiting ones past the target as misses; null under the minimum. */
export function withinTargetShare(rows: WithinRow[], targetMinutes: number, to: number, days: number): { share: number | null; judged: number } {
  const target = targetMinutes * 60_000;
  const mine = rows.filter((r) => r.leadAt > to - days * DAY && r.leadAt <= to);
  const judged = mine.filter((r) => r.touchAt !== null || to - r.leadAt > target);
  const within = judged.filter((r) => r.touchAt !== null && r.touchAt - r.leadAt <= target).length;
  return { share: judged.length >= MIN_FOR_MEDIAN ? within / judged.length : null, judged: judged.length };
}

// ---------- what SubSync caught ----------

export type AlertFact = { id: string; locationId: string | null; accountName: string; title: string; severity: Severity; createdAt: number; resolvedAt: number | null };
export type ProofDay = { day: string; label: string; raised: AlertFact[]; cleared: AlertFact[] };
export type Proof = { raised: number; cleared: number; open: number; days: ProofDay[] };

/** Alerts over the last 7 days: raised that day, cleared that day (we only know the condition went away, not whether a person fixed it), and how many are still open now. */
export function proofOf(alerts: AlertFact[], now: number): Proof {
  const days: ProofDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const d = now - back * DAY;
    days.push({ day: dayKey(d), label: new Date(d).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), raised: [], cleared: [] });
  }
  const at = new Map(days.map((d) => [d.day, d]));
  for (const a of alerts) {
    at.get(dayKey(a.createdAt))?.raised.push(a);
    if (a.resolvedAt !== null) at.get(dayKey(a.resolvedAt))?.cleared.push(a);
  }
  return { raised: days.reduce((s, d) => s + d.raised.length, 0), cleared: days.reduce((s, d) => s + d.cleared.length, 0), open: alerts.filter((a) => a.resolvedAt === null).length, days };
}

export function proofLine(p: Proof): string {
  return `Last 7 days: ${plural(p.raised, "alert")} raised, ${p.cleared} cleared, ${p.open} still open.`;
}
export const PROOF_NOTE = "Cleared means the problem is gone from your CRM data. SubSync cannot tell whether a person fixed it or it went away on its own.";

// ---------- share ----------

/** Plain text for Slack or email: the headline and the top three things. SubSync sends nothing; the person pastes it. */
export function shareText(i: { who: string; headline: Headline; rows: QueueRow[] }): string {
  const lines = [`${i.who}: Today`, i.headline.text];
  if (i.headline.breakdown) lines.push(i.headline.breakdown);
  const top = i.rows.slice(0, 3);
  if (top.length > 0) {
    lines.push("", "Fix first:");
    top.forEach((r, n) => lines.push(`${n + 1}. ${r.accountName}: ${r.text}${r.dollars ? `, ${money(r.dollars)} at stake` : ""}${r.since !== null ? `, wrong for ${ageWords(r.ageMinutes)}` : ""}`));
  }
  return lines.join("\n");
}
