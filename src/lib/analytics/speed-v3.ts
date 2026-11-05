import { judge, responseSeconds, sourceLabel, MIN_FOR_MEDIAN, type Judged } from "./speed-intel.ts";
import type { LoadedRow } from "./speed-parts.ts";

// Speed to lead, third pass (stage SPEED3). Pure: no database, no React. Every figure here is chosen by `pick` from the same leads, so a mark and the list behind it are one
// thing (count equals rows). Small samples never become a percentage or a multiple: each rule names its minimum and says "not enough data" under it. Definitions: docs/METRICS.md.

export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
export const MIN_GROUP = 20;
export const FAST_SECONDS = 300;
export const DEFAULT_HOURS = { start: 8, end: 18 } as const;

/** What happened to a lead after it arrived: set by the query from appointments and deals (never guessed). */
export type Outcome = { booked: boolean; showed: boolean; won: boolean };
export type Outcomes = ReadonlyMap<string, Outcome>;
export const keyOf = (r: Pick<LoadedRow, "locationId" | "contactId">) => `${r.locationId}:${r.contactId}`;
const out = (o: Outcomes, r: LoadedRow): Outcome => o.get(keyOf(r)) ?? { booked: false, showed: false, won: false };

type Opts = { targetMinutes: number; now: number };
const median = (v: number[]): number | null => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.5 * s.length) - 1)]; };

// ---------- when a lead arrives (in the account's own clock) ----------

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_NAMES = DOW;
/** Hour (0-23) and weekday (0 = Sunday) of an instant in a time zone; UTC when the zone is unknown or not valid. */
export function localParts(ms: number, tz: string | null | undefined): { hour: number; dow: number } {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(ms));
    const h = Number(f.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const d = DOW.indexOf(f.find((p) => p.type === "weekday")?.value ?? "Sun");
    return { hour: h, dow: d < 0 ? 0 : d };
  } catch { const d = new Date(ms); return { hour: d.getUTCHours(), dow: d.getUTCDay() }; }
}
export const isAfterHours = (ms: number, tz: string | null | undefined, hrs: { start: number; end: number } = DEFAULT_HOURS): boolean => {
  const p = localParts(ms, tz);
  return p.dow === 0 || p.dow === 6 || p.hour < hrs.start || p.hour >= hrs.end;
};

// ---------- one selection for every mark ----------

export type Sel =
  | { kind: "all" } | { kind: "after" } | { kind: "open" } | { kind: "cell"; dow: number; hour: number } | { kind: "source"; source: string }
  | { kind: "fast" } | { kind: "slow" } | { kind: "week"; index: number } | { kind: "person"; userId: string } | { kind: "noOwner" } | { kind: "owner"; userId: string };

/** The judged leads (answered in time, late, or waiting past the target) that a mark stands for, longest wait first. */
export function pick(rows: readonly LoadedRow[], sel: Sel, o: Opts): Array<{ row: LoadedRow; status: Judged }> {
  const keep = (r: LoadedRow, status: Judged): boolean => {
    switch (sel.kind) {
      case "all": return true;
      case "after": return isAfterHours(r.leadAt, r.timeZone);
      case "open": return !isAfterHours(r.leadAt, r.timeZone);
      case "cell": { const p = localParts(r.leadAt, r.timeZone); return p.dow === sel.dow && p.hour === sel.hour; }
      case "source": return sourceLabel(r.source) === sel.source;
      case "fast": { const s = responseSeconds(r); return s !== null && s <= FAST_SECONDS; }
      case "slow": { const s = responseSeconds(r); return s !== null && s > FAST_SECONDS; }
      case "week": return r.leadAt > o.now - (sel.index + 1) * WEEK && r.leadAt <= o.now - sel.index * WEEK;
      case "person": return r.userId === sel.userId && status !== "waiting";
      case "noOwner": return r.assignedTo === null;
      case "owner": return r.assignedTo === sel.userId;
    }
  };
  const order: Record<Judged, number> = { waiting: 0, late: 1, within: 2 };
  const res: Array<{ row: LoadedRow; status: Judged }> = [];
  for (const r of rows) { const status = judge(r, o.targetMinutes, o.now); if (status && keep(r, status)) res.push({ row: r, status }); }
  return res.sort((a, b) => order[a.status] - order[b.status] || a.row.leadAt - b.row.leadAt);
}

// ---------- after hours gap map ----------

export type Cell = { dow: number; hour: number; leads: number; missed: number };
export type GapMap = {
  judged: number; afterLeads: number; afterMissed: number; openLeads: number; openMissed: number; afterShare: number | null; cells: Cell[]; worst: Array<{ dow: number; hour: number; leads: number; missed: number }>;
  line: string | null;
};
/** Leads by weekday and hour of arrival, and how many of them nobody answered in time. "Missed" is late or still waiting. */
export function gapMap(rows: readonly LoadedRow[], o: Opts): GapMap {
  const cells = new Map<string, Cell>();
  let afterLeads = 0, afterMissed = 0, openLeads = 0, openMissed = 0;
  for (const { row, status } of pick(rows, { kind: "all" }, o)) {
    const p = localParts(row.leadAt, row.timeZone);
    const k = `${p.dow}:${p.hour}`;
    const c = cells.get(k) ?? { dow: p.dow, hour: p.hour, leads: 0, missed: 0 };
    c.leads += 1; if (status !== "within") c.missed += 1;
    cells.set(k, c);
    if (isAfterHours(row.leadAt, row.timeZone)) { afterLeads += 1; if (status !== "within") afterMissed += 1; } else { openLeads += 1; if (status !== "within") openMissed += 1; }
  }
  const judged = afterLeads + openLeads;
  const worst = [...cells.values()].filter((c) => c.leads >= 3 && c.missed / c.leads >= 0.5).sort((a, b) => b.missed - a.missed || a.dow - b.dow || a.hour - b.hour).slice(0, 3);
  const enough = judged >= MIN_FOR_MEDIAN && afterLeads >= MIN_FOR_MEDIAN;
  const line = !enough ? null : afterMissed === 0 ? "Leads that arrive after hours are being answered in time." : `${afterMissed} of ${afterLeads} leads that arrived after hours or at the weekend were not answered in time.`;
  return { judged, afterLeads, afterMissed, openLeads, openMissed, afterShare: judged >= MIN_FOR_MEDIAN ? afterLeads / judged : null, cells: [...cells.values()], worst, line };
}
export const hourWords = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

// ---------- speed by source, and the lead to booked to showed to won funnel ----------

export type SourceRow = {
  source: string; leads: number; answered: number; medianSeconds: number | null; hitRate: number | null; booked: number; showed: number; won: number; ranked: boolean;
};
/** One row per source: reply speed and what became of the leads. A source with fewer than 5 answered leads is listed last with no median and no rate. */
export function bySourceFunnel(rows: readonly LoadedRow[], oc: Outcomes, o: Opts): SourceRow[] {
  const groups = new Map<string, LoadedRow[]>();
  for (const { row } of pick(rows, { kind: "all" }, o)) { const k = sourceLabel(row.source); groups.set(k, [...(groups.get(k) ?? []), row]); }
  const res: SourceRow[] = [];
  for (const [source, rs] of groups) {
    const times = rs.map(responseSeconds).filter((x): x is number => x !== null);
    const within = rs.filter((r) => judge(r, o.targetMinutes, o.now) === "within").length;
    const ranked = times.length >= MIN_FOR_MEDIAN;
    res.push({
      source, leads: rs.length, answered: times.length, medianSeconds: ranked ? median(times) : null, hitRate: rs.length >= MIN_FOR_MEDIAN ? within / rs.length : null,
      booked: rs.filter((r) => out(oc, r).booked).length, showed: rs.filter((r) => out(oc, r).showed).length, won: rs.filter((r) => out(oc, r).won).length, ranked,
    });
  }
  return res.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (b.medianSeconds ?? 0) - (a.medianSeconds ?? 0) || b.leads - a.leads || a.source.localeCompare(b.source));
}

// ---------- does answering fast book more? (the account's own data only) ----------

export type FastSlow = {
  fast: { n: number; booked: number; rate: number | null }; slow: { n: number; booked: number; rate: number | null };
  multiple: number | null; enough: boolean; line: string;
};
export function fastVsSlow(rows: readonly LoadedRow[], oc: Outcomes, o: Opts): FastSlow {
  const f = pick(rows, { kind: "fast" }, o), s = pick(rows, { kind: "slow" }, o);
  const side = (l: typeof f) => { const booked = l.filter((x) => out(oc, x.row).booked).length; return { n: l.length, booked, rate: l.length >= MIN_GROUP ? booked / l.length : null }; };
  const a = side(f), b = side(s);
  const enough = a.n >= MIN_GROUP && b.n >= MIN_GROUP;
  const multiple = enough && a.rate !== null && b.rate !== null && b.rate > 0 ? a.rate / b.rate : null;
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const line = !enough ? `Not enough data yet. This needs ${MIN_GROUP} leads answered within 5 minutes and ${MIN_GROUP} answered later; you have ${a.n} and ${b.n}.`
    : multiple === null ? `Leads answered within 5 minutes booked ${pct(a.rate as number)}; later ones ${pct(b.rate as number)}.`
      : `Leads answered within 5 minutes booked ${Math.round(multiple * 10) / 10} times as often (${pct(a.rate as number)} against ${pct(b.rate as number)}), from ${a.n + b.n} of your own leads.`;
  return { fast: a, slow: b, multiple, enough, line };
}

// ---------- first reply time against the account's own normal ----------

export type WeekPoint = { index: number; start: number; leads: number; answered: number; medianSeconds: number | null };
export type TrendNormal = { weeks: WeekPoint[]; current: WeekPoint | null; normalSeconds: number | null; pct: number | null; verdict: "faster" | "slower" | "steady" | null; note: string };
export const MIN_NORMAL_WEEKS = 3;
/** The last 7 days' typical first reply against the middle of the 7 weeks before it. Needs 5 replies in the week and 3 earlier weeks with 5 replies each. */
export function trendVsNormal(rows: readonly LoadedRow[], o: Opts, weeks = 8): TrendNormal {
  const pts: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = o.now - i * WEEK, start = end - WEEK;
    const w = rows.filter((r) => r.leadAt > start && r.leadAt <= end && judge(r, o.targetMinutes, o.now) !== null);
    const t = w.map(responseSeconds).filter((x): x is number => x !== null);
    pts.push({ index: i, start, leads: w.length, answered: t.length, medianSeconds: t.length >= MIN_FOR_MEDIAN ? median(t) : null });
  }
  const current = pts[pts.length - 1] ?? null;
  const before = pts.slice(0, -1).map((p) => p.medianSeconds).filter((x): x is number => x !== null);
  const normal = before.length >= MIN_NORMAL_WEEKS ? median(before) : null;
  if (!current || current.medianSeconds === null) return { weeks: pts, current, normalSeconds: normal, pct: null, verdict: null, note: "Not enough replies in the last 7 days to compare (needs 5)." };
  if (normal === null) return { weeks: pts, current, normalSeconds: null, pct: null, verdict: null, note: `Not enough history yet: this needs ${MIN_NORMAL_WEEKS} earlier weeks with 5 replies each (${before.length} so far).` };
  const pct = normal === 0 ? null : (current.medianSeconds - normal) / normal;
  const verdict = pct === null ? null : pct <= -0.2 ? "faster" : pct >= 0.2 ? "slower" : "steady";
  return { weeks: pts, current, normalSeconds: normal, pct, verdict, note: "" };
}

// ---------- setters: scorecard and owner gaps ----------

export type SetterRow = { userId: string; replies: number; medianSeconds: number | null; withinShare: number | null; booked: number; bookedRate: number | null; ranked: boolean };
/** Per person who sent a first reply: how many, how fast, how many in time, how many of those leads booked. A person with fewer than 3 replies is listed last, unranked. */
export function setterScorecard(rows: readonly LoadedRow[], oc: Outcomes, o: Opts): { rows: SetterRow[]; teamMedianSeconds: number | null } {
  const by = new Map<string, LoadedRow[]>();
  for (const { row } of pick(rows, { kind: "all" }, o)) if (row.userId && responseSeconds(row) !== null) by.set(row.userId, [...(by.get(row.userId) ?? []), row]);
  const all: number[] = [];
  const res = [...by].map(([userId, rs]) => {
    const t = rs.map(responseSeconds) as number[]; all.push(...t);
    const ranked = rs.length >= 3;
    const within = rs.filter((r) => judge(r, o.targetMinutes, o.now) === "within").length;
    const booked = rs.filter((r) => out(oc, r).booked).length;
    return { userId, replies: rs.length, medianSeconds: ranked ? median(t) : null, withinShare: ranked ? within / rs.length : null, booked, bookedRate: rs.length >= MIN_FOR_MEDIAN ? booked / rs.length : null, ranked };
  }).sort((a, b) => Number(b.ranked) - Number(a.ranked) || (a.medianSeconds ?? 0) - (b.medianSeconds ?? 0) || b.replies - a.replies || a.userId.localeCompare(b.userId));
  return { rows: res, teamMedianSeconds: all.length >= MIN_FOR_MEDIAN ? median(all) : null };
}

export type OwnerGap = { noOwner: number; total: number; owners: Array<{ userId: string; leads: number; overloaded: boolean }>; fairShare: number | null };
/** Leads with nobody to own them, and how the owned ones are spread. Someone is "overloaded" at more than twice the fair share, once there are 10 owned leads and 2 owners. */
export function ownerGaps(rows: readonly LoadedRow[], o: Opts): OwnerGap {
  const l = pick(rows, { kind: "all" }, o).map((x) => x.row);
  const by = new Map<string, number>();
  for (const r of l) if (r.assignedTo) by.set(r.assignedTo, (by.get(r.assignedTo) ?? 0) + 1);
  const owned = [...by.values()].reduce((s, n) => s + n, 0);
  const fair = by.size >= 2 && owned >= 10 ? owned / by.size : null;
  return {
    noOwner: l.filter((r) => r.assignedTo === null).length, total: l.length, fairShare: fair === null ? null : Math.round(fair),
    owners: [...by].map(([userId, leads]) => ({ userId, leads, overloaded: fair !== null && leads > 2 * fair })).sort((a, b) => b.leads - a.leads || a.userId.localeCompare(b.userId)),
  };
}

// ---------- the digest, as text (a preview: nothing is sent) ----------

export function digestPreview(i: { who: string; waiting: number; dollars: number | null; typical: string | null; trend: TrendNormal; gap: GapMap; word: "daily" | "weekly" }): string {
  const lines = [`${i.word === "daily" ? "Daily" : "Weekly"} speed to lead for ${i.who}`];
  lines.push(i.waiting === 0 ? "Nobody is waiting for a reply." : `${i.waiting} ${i.waiting === 1 ? "lead is" : "leads are"} waiting for a reply${i.dollars ? `, with $${Math.round(i.dollars).toLocaleString("en-US")} of open deals` : ""}.`);
  if (i.typical) lines.push(i.typical);
  if (i.trend.verdict && i.trend.pct !== null) lines.push(`First replies are ${i.trend.verdict === "steady" ? "about the same as" : `${Math.round(Math.abs(i.trend.pct) * 100)}% ${i.trend.verdict} than`} your normal.`);
  if (i.gap.line) lines.push(i.gap.line);
  lines.push("This is a preview. Nothing was sent.");
  return lines.join("\n");
}

// ---------- lead rescue: who to reply to first, by money and by how fast the lead is cooling ----------

export type Rescue = { key: string; locationId: string; contactId: string; waitedMinutes: number; dollars: number; score: number };
/** Waiting leads ranked by open-deal dollars weighted by freshness (a lead loses half its weight every 24 hours of waiting). No deal means zero dollars and the longest wait goes first. */
export function rescueRank(rows: readonly LoadedRow[], dollarsByKey: ReadonlyMap<string, number>, o: Opts, limit = 10): Rescue[] {
  return pick(rows, { kind: "all" }, o).filter((x) => x.status === "waiting").map(({ row }) => {
    const waitedMinutes = Math.max(0, Math.round((o.now - row.leadAt) / 60_000));
    const dollars = dollarsByKey.get(keyOf(row)) ?? 0;
    return { key: keyOf(row), locationId: row.locationId, contactId: row.contactId, waitedMinutes, dollars, score: dollars * Math.pow(0.5, waitedMinutes / 1440) };
  }).sort((a, b) => b.score - a.score || b.waitedMinutes - a.waitedMinutes || a.key.localeCompare(b.key)).slice(0, limit);
}
