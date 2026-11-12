// Workflows second pass: health from OUTCOMES, not from workflow internals. Pure (no database, no network), so node --test can run it.
// A workflow is the cause; a lead nobody touched is the proof. Each gap below pairs one outcome we hold ourselves (docs/METRICS.md, "Workflows outcome gaps")
// with the standard automation that normally prevents it. Wording is plain: an owner of 20 accounts reads this, not an engineer.
import { standardLabel } from "./health.ts";

export type GapId = "no_touch" | "no_textback" | "noshow_open" | "no_reminder";
export type StandardId = "new_lead" | "missed_call" | "no_show" | "reminder";

/** Counts for one client account, measured from the conversations, calls and appointments SubSync already holds. */
export type OutcomeCounts = {
  /** Leads that arrived in the window (the base for the first-touch share). */
  newLeads: number; noTouch: number;
  /** Callers whose latest call was missed in the window, and how many got no message back within the text-back time. */
  missedCalls: number; noTextback: number;
  /** No-shows of the last 7 days, and how many had no follow up and no new booking. */
  noshows: number; noshowOpen: number;
  /** Bookings in the next 2 days, and how many had no message at all since the person booked. */
  upcoming: number; noReminder: number;
  /** Open deal value (value above zero) of the people counted above, each person once. */
  atRiskValue: number;
  /** Open deal value of the people in each gap (a person in two gaps counts in both here, once in atRiskValue). */
  value: Record<GapId, number>;
};

export const EMPTY_COUNTS: OutcomeCounts = { newLeads: 0, noTouch: 0, missedCalls: 0, noTextback: 0, noshows: 0, noshowOpen: 0, upcoming: 0, noReminder: 0, atRiskValue: 0, value: { no_touch: 0, no_textback: 0, noshow_open: 0, no_reminder: 0 } };

/** Windows and thresholds, all written in docs/METRICS.md. */
export const OUTCOME = {
  leadWindowDays: 14, graceMinutes: 60,
  callWindowDays: 14, textBackMinutes: 5,
  noshowWindowDays: 7,
  reminderHoursAhead: 48, bookedMinHours: 2,
  /** A gap is open from this many people on (one stray lead is noise, three is a pattern). */
  openMin: 3,
} as const;

export type GapDef = {
  id: GapId; standard: StandardId; short: string; outcome: (n: number) => string; automation: string; /** The library template that fixes it, or null when only a guide or a copy from a client exists. */
  template: string | null; count: (c: OutcomeCounts) => number; base: (c: OutcomeCounts) => number; baseWord: string;
};
const people = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const GAPS: readonly GapDef[] = [
  { id: "no_touch", standard: "new_lead", short: "New leads nobody answered", outcome: (n) => `${people(n, "new lead has", "new leads have")} had no first reply after an hour`, automation: standardLabel("new_lead"), template: "speed_breach_task", count: (c) => c.noTouch, base: (c) => c.newLeads, baseWord: "new leads" },
  { id: "no_textback", standard: "missed_call", short: "Missed calls with no text back", outcome: (n) => `${people(n, "missed call got", "missed calls got")} no message back within 5 minutes`, automation: standardLabel("missed_call"), template: null, count: (c) => c.noTextback, base: (c) => c.missedCalls, baseWord: "missed calls" },
  { id: "noshow_open", standard: "no_show", short: "No-shows nobody followed up", outcome: (n) => `${people(n, "no-show has", "no-shows have")} no follow up and no new booking`, automation: standardLabel("no_show"), template: "noshow_task", count: (c) => c.noshowOpen, base: (c) => c.noshows, baseWord: "no-shows" },
  { id: "no_reminder", standard: "reminder", short: "Bookings with no message", outcome: (n) => `${people(n, "booking in the next 2 days has", "bookings in the next 2 days have")} had no message since the person booked`, automation: standardLabel("reminder"), template: null, count: (c) => c.noReminder, base: (c) => c.upcoming, baseWord: "bookings" },
];
export const gapDef = (id: string) => GAPS.find((g) => g.id === id);

/** has: the automation looks present (by name, published). known: the account's workflow list was read. */
export type WfState = "present" | "missing" | "unknown";
export type GapState = "ok" | "watching" | "open_missing" | "open_present" | "open_unknown";
export type AccountGap = { id: GapId; count: number; base: number; value: number; wf: WfState; state: GapState; line: string; why: string; next: string };

export function gapsFor(c: OutcomeCounts, cov: { known: boolean; have: string[] }): AccountGap[] {
  return GAPS.map((g): AccountGap => {
    const count = g.count(c), base = g.base(c);
    const wf: WfState = !cov.known ? "unknown" : cov.have.includes(g.standard) ? "present" : "missing";
    const open = count >= OUTCOME.openMin;
    const state: GapState = count === 0 ? "ok" : !open ? "watching" : wf === "missing" ? "open_missing" : wf === "present" ? "open_present" : "open_unknown";
    const line = count === 0 ? `None of ${g.baseWord} fell through.` : `${g.outcome(count)}.`;
    const why = state === "open_missing" ? `No published "${g.automation}" automation was found by name, so nothing catches these.`
      : state === "open_present" ? `A "${g.automation}" automation looks present, yet people still slipped through. It may have stopped, or it may not cover them.`
      : state === "open_unknown" ? "SubSync cannot read this account's automations yet (permission or first update), so only the people counted are shown."
      : state === "watching" ? "Fewer than three people, so this is watched but not raised as a problem."
      : "";
    const next = state === "open_missing" ? `Add a "${g.automation}" automation${g.template ? " from the Library tab" : ", or copy one from another client"}.`
      : state === "open_present" ? `Open the "${g.automation}" automation in your CRM and check it ran for these people.` : state === "open_unknown" ? "Reconnect to allow reading workflows, then this shows which automation is missing." : "";
    return { id: g.id, count, base, value: c.value[g.id] ?? 0, wf, state, line, why, next };
  });
}

/** Severity of one account for ranking and the alert: a missing automation with people hurt is critical, a present one that still leaks is a warning. */
export type Level = "critical" | "warning" | "info" | "ok";
export function levelOf(gaps: AccountGap[]): Level {
  if (gaps.some((g) => g.state === "open_missing")) return "critical";
  if (gaps.some((g) => g.state === "open_present" || g.state === "open_unknown")) return "warning";
  if (gaps.some((g) => g.state === "watching")) return "info";
  return "ok";
}
const LEVEL_RANK: Record<Level, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
export const levelRank = (l: Level) => LEVEL_RANK[l];

export type AccountRow = { locationId: string; name: string; counts: OutcomeCounts; gaps: AccountGap[]; level: Level; known: boolean; people: number; value: number };
export function accountRow(a: { locationId: string; name: string }, counts: OutcomeCounts, cov: { known: boolean; have: string[] }): AccountRow {
  const gaps = gapsFor(counts, cov);
  return { locationId: a.locationId, name: a.name, counts, gaps, level: levelOf(gaps), known: cov.known, people: gaps.reduce((s, g) => s + g.count, 0), value: Math.round(counts.atRiskValue) };
}

/** Ranked list: the worst level first, then the most open deal value, then the name; the id breaks ties so a page boundary is stable. */
export function rankRows(rows: AccountRow[]): AccountRow[] {
  return [...rows].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.value - a.value || a.name.localeCompare(b.name) || a.locationId.localeCompare(b.locationId));
}
/** Keyset cursor: the sort key of the last row shown. The next page starts strictly after it, whatever changed in between. */
export type Cursor = { l: number; v: number; n: string; i: string };
export const cursorOf = (r: AccountRow): string => Buffer.from(JSON.stringify({ l: LEVEL_RANK[r.level], v: r.value, n: r.name, i: r.locationId } satisfies Cursor)).toString("base64url");
export function parseCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    return typeof o.l === "number" && typeof o.v === "number" && typeof o.n === "string" && typeof o.i === "string" ? { l: o.l, v: o.v, n: o.n, i: o.i } : null;
  } catch { return null; }
}
const after = (r: AccountRow, c: Cursor): boolean => {
  const lv = LEVEL_RANK[r.level];
  if (lv !== c.l) return lv > c.l;
  if (r.value !== c.v) return r.value < c.v;
  const byName = r.name.localeCompare(c.n);
  if (byName !== 0) return byName > 0;
  return r.locationId.localeCompare(c.i) > 0;
};
export function pageOf(ranked: AccountRow[], cursor: Cursor | null, size: number): { rows: AccountRow[]; next: string | null } {
  const rest = cursor ? ranked.filter((r) => after(r, cursor)) : ranked;
  const rows = rest.slice(0, size);
  return { rows, next: rest.length > rows.length && rows.length > 0 ? cursorOf(rows[rows.length - 1]) : null };
}

export type Filter = { q: string; level: "all" | "attention" | "ok"; gap: GapId | "all" };
export function filterRows(rows: AccountRow[], f: Filter): AccountRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (!q || r.name.toLowerCase().includes(q))
    && (f.level === "all" || (f.level === "ok" ? r.level === "ok" || r.level === "info" : r.level === "critical" || r.level === "warning"))
    && (f.gap === "all" || r.gaps.some((g) => g.id === f.gap && g.count > 0)));
}

export type Totals = { accounts: number; attention: number; people: number; value: number; byGap: Array<{ id: GapId; people: number; accounts: number; value: number }>; missingAutomation: number };
/** Totals over exactly the rows given (so the number on a tile always equals the rows behind it). The money is the largest honest figure we can state: each person once. */
export function totalsOf(rows: AccountRow[]): Totals {
  const attention = rows.filter((r) => r.level === "critical" || r.level === "warning");
  return {
    accounts: rows.length, attention: attention.length, people: rows.reduce((s, r) => s + r.people, 0), value: rows.reduce((s, r) => s + r.value, 0),
    byGap: GAPS.map((g) => { const hit = rows.filter((r) => (r.gaps.find((x) => x.id === g.id)?.count ?? 0) > 0); return { id: g.id, people: hit.reduce((s, r) => s + (r.gaps.find((x) => x.id === g.id)?.count ?? 0), 0), accounts: hit.length, value: hit.reduce((s, r) => s + (r.gaps.find((x) => x.id === g.id)?.value ?? 0), 0) }; }),
    missingAutomation: rows.reduce((s, r) => s + r.gaps.filter((g) => g.state === "open_missing").length, 0),
  };
}

export const money = (v: number): string => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}m` : v >= 10_000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v).toLocaleString("en-US")}`);

/** The dollar line. Said as what it is: open deal value attached to the people who fell through. Not a forecast, not money lost. */
export function dollarLine(value: number): string | null {
  return value > 0 ? `${money(value)} of open deals belong to these people. This is deal value on file, not money already lost.` : null;
}
export const FORMULA = "For each client account SubSync counts people from its own record: new leads with no first reply an hour after they arrived (last 14 days); callers whose latest call was missed and got no message within 5 minutes (last 14 days); no-shows of the last 7 days with no later message and no new booking; bookings in the next 2 days with no message since the person booked (booked at least 2 hours ago). The dollars are the open deals (value above zero) of those people, each person counted once. An automation counts as present when a published workflow with a matching name exists, so a workflow with an unusual name is not recognised.";

/** The one line for Today, or null when nothing needs doing (so the line never nags). */
export function todayLine(t: Totals): { line: string; count: number } | null {
  const hot = t.byGap.filter((g) => g.people > 0).sort((a, b) => b.people - a.people)[0];
  if (t.attention === 0 || !hot) return null;
  const g = gapDef(hot.id) as GapDef;
  const money_ = t.value > 0 ? ` (${money(t.value)} of open deals)` : "";
  return { count: t.attention, line: `${t.attention} client account${t.attention === 1 ? "" : "s"} ${t.attention === 1 ? "has" : "have"} a lead-handling gap. Most common: ${g.short.toLowerCase()}, ${hot.people} ${hot.people === 1 ? "person" : "people"}${money_}.` };
}

/** The alert for one account: only a critical or warning level pages anyone, one alert per account and gap so a fixed gap clears by itself. */
export function gapAlertDrafts(rows: AccountRow[]): Array<{ locationId: string; kind: "workflow_gap"; severity: "warning" | "critical"; title: string; detail: Record<string, unknown>; dedupeKey: string }> {
  const out: ReturnType<typeof gapAlertDrafts> = [];
  for (const r of rows) for (const g of r.gaps) {
    if (g.state !== "open_missing" && g.state !== "open_present") continue;
    const d = gapDef(g.id) as GapDef;
    out.push({ locationId: r.locationId, kind: "workflow_gap", severity: g.state === "open_missing" ? "critical" : "warning", title: `${r.name}: ${d.outcome(g.count)}`,
      detail: { why: g.why, next: g.next, people: g.count, value: Math.round(g.value), estimate: true, gap: g.id }, dedupeKey: `wf:gap:${r.locationId}:${g.id}` });
  }
  return out;
}
