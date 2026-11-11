// Appointments, Leadership tab: the pure part (no database, no network), unit tested. Definitions: docs/METRICS.md "Appointments leadership".
// Every figure is counted from the account's own appointments. No outside benchmark appears anywhere. An estimate is flagged and carries its formula.
import { rate } from "./appointments3-intel.ts";
import type { Rate } from "./appointments3-types.ts";

export const DAY = 86_400_000;
/** Minimums: under them the screen says "not enough data", never a number. */
export const MIN_RATE = 10, MIN_WINS = 3, MIN_CLOSED = 10, MIN_WEEKS = 4, MIN_SLOT = 8, MIN_PERSON = 10;

/** One sum of daily rows (the rollup or its live twin). Everything the executive screens need comes from these. */
export type Tot = {
  booked: number; confirmed: number; showed: number; noshow: number; cancelled: number; unmarked: number; rescheduled: number;
  won: number; wonValue: number; lost: number; ltbSumMin: number; ltbN: number; b2mSumHours: number; b2mN: number;
};
export const ZERO: Tot = { booked: 0, confirmed: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, rescheduled: 0, won: 0, wonValue: 0, lost: 0, ltbSumMin: 0, ltbN: 0, b2mSumHours: 0, b2mN: 0 };
export const addTot = (a: Tot, b: Tot): Tot => ({
  booked: a.booked + b.booked, confirmed: a.confirmed + b.confirmed, showed: a.showed + b.showed, noshow: a.noshow + b.noshow, cancelled: a.cancelled + b.cancelled,
  unmarked: a.unmarked + b.unmarked, rescheduled: a.rescheduled + b.rescheduled, won: a.won + b.won, wonValue: a.wonValue + b.wonValue, lost: a.lost + b.lost,
  ltbSumMin: a.ltbSumMin + b.ltbSumMin, ltbN: a.ltbN + b.ltbN, b2mSumHours: a.b2mSumHours + b.b2mSumHours, b2mN: a.b2mN + b.b2mN,
});

/** Appointments whose time has already come (everything not still ahead). */
export const due = (t: Tot) => t.showed + t.noshow + t.cancelled + t.unmarked;
/** True show rate: showed / (showed + no-show + past due with no outcome). Cancelled ones are not counted as a no-show. */
export const showRate = (t: Tot): Rate => rate(t.showed, t.showed + t.noshow + t.unmarked, MIN_RATE);
export const noshowRate = (t: Tot): Rate => rate(t.noshow, t.showed + t.noshow + t.unmarked, MIN_RATE);
export const cancelRate = (t: Tot): Rate => rate(t.cancelled, t.booked, MIN_RATE);
export const rescheduleRate = (t: Tot): Rate => rate(t.rescheduled, t.booked, MIN_RATE);
export const closeRate = (t: Tot): Rate => rate(t.won, t.won + t.lost, MIN_CLOSED);
/** Show to close: of the people who showed, how many became a won deal. */
export const showToClose = (t: Tot): Rate => rate(t.won, t.showed, MIN_CLOSED);
export const avgDeal = (t: Tot): number | null => (t.won >= MIN_WINS ? t.wonValue / t.won : null);
export const median = (sum: number, n: number): number | null => (n >= MIN_RATE ? Math.round(sum / n) : null);

export type Delta = { value: number | null; pct: number | null; points: number | null };
/** Change versus another period. Rates change in percentage points, counts in percent. null when either side is not known. */
export function delta(cur: number | null, prev: number | null, kind: "count" | "rate"): Delta {
  if (cur === null || prev === null) return { value: null, pct: null, points: null };
  if (kind === "rate") return { value: cur - prev, pct: null, points: Math.round((cur - prev) * 100) };
  return { value: cur - prev, pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null, points: null };
}

export type Estimate = { value: number | null; estimate: true; enough: boolean; formula: string; minNote: string | null };
/** Revenue lost to no-shows. An estimate from the account's own close rate and own average won deal. Never a forecast. */
export function lostToNoShows(t: Tot): Estimate {
  const formula = "No-shows x the share of people who showed that became a won deal (won / showed) x the average won deal in this period. All three come from your own appointments and deals.";
  const s2c = showToClose(t), avg = avgDeal(t);
  if (t.noshow === 0) return { value: 0, estimate: true, enough: true, formula, minNote: null };
  if (!s2c.enough || s2c.value === null || avg === null) return { value: null, estimate: true, enough: false, formula, minNote: "Not enough shown appointments and won deals in this period to estimate it." };
  return { value: Math.round(t.noshow * s2c.value * avg), estimate: true, enough: true, formula, minNote: null };
}

// ---------- the funnel ----------
export type FunnelStep = { key: "booked" | "confirmed" | "showed" | "won"; label: string; count: number | null; of: number | null; dropPct: number | null; lost: number | null; bucket: string | null };
export type Funnel = { steps: FunnelStep[]; leak: { step: string; sentence: string; bucket: string | null; lost: number } | null; confirmTracked: boolean };

export function funnelOf(t: Tot): Funnel {
  const d = due(t), held = t.showed + t.noshow + t.unmarked;
  const confirmTracked = t.confirmed > 0;
  const steps: FunnelStep[] = [
    { key: "booked", label: "Booked and due", count: d, of: null, dropPct: null, lost: null, bucket: "completed" },
    { key: "confirmed", label: "Confirmed ahead", count: confirmTracked ? t.confirmed : null, of: d, dropPct: confirmTracked && d ? Math.round((1 - t.confirmed / d) * 100) : null, lost: confirmTracked ? Math.max(0, d - t.confirmed) : null, bucket: null },
    { key: "showed", label: "Showed", count: t.showed, of: d, dropPct: d ? Math.round((1 - t.showed / d) * 100) : null, lost: Math.max(0, d - t.showed), bucket: "showed" },
    { key: "won", label: "Closed (won)", count: t.won, of: t.showed, dropPct: t.showed ? Math.round((1 - Math.min(1, t.won / t.showed)) * 100) : null, lost: Math.max(0, t.showed - t.won), bucket: "won" },
  ];
  // The biggest leak counts the people lost between booking and showing (no-show, cancelled, never marked) and between showing and closing. Confirmation is not a leak, it is a lever.
  const parts: Array<{ step: string; lost: number; sentence: string; bucket: string | null }> = [];
  if (held + t.cancelled >= MIN_RATE) {
    if (t.noshow > 0) parts.push({ step: "noshow", lost: t.noshow, bucket: "noshow", sentence: `${t.noshow.toLocaleString("en-US")} people booked and did not turn up` });
    if (t.cancelled > 0) parts.push({ step: "cancelled", lost: t.cancelled, bucket: "cancelled", sentence: `${t.cancelled.toLocaleString("en-US")} bookings were cancelled` });
    if (t.unmarked > 0) parts.push({ step: "unmarked", lost: t.unmarked, bucket: "unmarked", sentence: `${t.unmarked.toLocaleString("en-US")} appointments passed with no outcome recorded, so nobody knows what happened` });
  }
  if (t.showed >= MIN_RATE && t.showed - t.won > 0) parts.push({ step: "closing", lost: t.showed - t.won, bucket: "showed", sentence: `${(t.showed - t.won).toLocaleString("en-US")} people showed but did not become a won deal` });
  parts.sort((a, b) => b.lost - a.lost);
  const top = parts[0];
  return { steps, confirmTracked, leak: top ? { step: top.step, lost: top.lost, bucket: top.bucket, sentence: `The biggest leak: ${top.sentence}.` } : null };
}

// ---------- pacing ----------
export type Pace = {
  enough: boolean; weeksUsed: number; avgPerWeek: number | null; thisWeek: number; weekExpected: number | null; month: number; monthExpected: number | null;
  projectedMonth: number | null; target: number | null; status: "on" | "ahead" | "behind" | "no_target" | "unknown"; sentence: string; formula: string;
  weekly: Array<{ weekStart: string; booked: number }>;
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const weekStartOf = (ms: number) => { const d = Math.floor(ms / DAY) * DAY; return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY; };

/** Bookings this week and this month against the account's own 8-week average. `weekly` = bookings per Monday-start week (booked on that week), oldest first, including the current partial week. */
export function paceOf(weekly: Array<{ weekStart: string; booked: number }>, monthSoFar: number, now: number, target: number | null): Pace {
  const formula = "Average of the last 8 full weeks of bookings (your own numbers). Projected month-end = bookings so far this month + that weekly average / 7 x the days left. An estimate, not a promise.";
  const thisWeekStart = weekStartOf(now), cur = weekly.find((w) => w.weekStart === iso(thisWeekStart));
  const full = weekly.filter((w) => Date.parse(w.weekStart) < thisWeekStart).slice(-8);
  const thisWeek = cur?.booked ?? 0;
  const enough = full.filter((w) => w.booked > 0).length >= MIN_WEEKS;
  const avg = enough ? full.reduce((t, w) => t + w.booked, 0) / full.length : null;
  const dow = ((new Date(now).getUTCDay() + 6) % 7) + (now % DAY) / DAY; // days into the week
  const weekExpected = avg === null ? null : Math.round((avg * dow) / 7);
  const d = new Date(now), dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(), dayOfMonth = d.getUTCDate() - 1 + (now % DAY) / DAY;
  const monthExpected = avg === null ? null : Math.round((avg / 7) * dayOfMonth);
  const projectedMonth = avg === null ? null : Math.round(monthSoFar + (avg / 7) * Math.max(0, dim - dayOfMonth));
  let status: Pace["status"] = "unknown", sentence = "Not enough booking history yet to say whether you are on pace.";
  if (avg !== null && projectedMonth !== null) {
    const basis = target ?? Math.round((avg / 7) * dim);
    const ratio = basis > 0 ? projectedMonth / basis : 1;
    status = target === null ? (ratio >= 1.1 ? "ahead" : ratio <= 0.9 ? "behind" : "on") : ratio >= 1.02 ? "ahead" : ratio >= 0.9 ? "on" : "behind";
    if (target === null && status === "on") status = "no_target";
    const vs = target === null ? `your usual ${Math.round(avg)} a week` : `the target of ${target}`;
    sentence = status === "behind" ? `Behind: on this pace the month ends near ${projectedMonth} bookings against ${vs === `the target of ${target}` ? vs : `${Math.round((avg / 7) * dim)} at ${vs}`}.`
      : status === "ahead" ? `Ahead: on this pace the month ends near ${projectedMonth} bookings, above ${vs}.`
      : `On pace: the month is heading for about ${projectedMonth} bookings.`;
    if (target !== null && status === "on") status = "on";
  }
  return { enough, weeksUsed: full.length, avgPerWeek: avg === null ? null : Math.round(avg * 10) / 10, thisWeek, weekExpected, month: monthSoFar, monthExpected, projectedMonth, target, status, sentence, formula, weekly };
}

// ---------- heatmap ----------
export type Cell = { dow: number; hour: number; booked: number; showed: number; noshow: number; unmarked: number };
export type SlotRate = { dow: number; hour: number; n: number; rate: number };
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
/** Best and worst slots by true show rate among slots with at least MIN_SLOT counted appointments. */
export function slotsOf(cells: Cell[]): { best: SlotRate | null; worst: SlotRate | null; enough: boolean } {
  const rows: SlotRate[] = cells.map((c) => { const n = c.showed + c.noshow + c.unmarked; return { dow: c.dow, hour: c.hour, n, rate: n ? c.showed / n : 0 }; }).filter((r) => r.n >= MIN_SLOT);
  if (rows.length < 2) return { best: null, worst: null, enough: false };
  rows.sort((a, b) => b.rate - a.rate || b.n - a.n);
  const best = rows[0], worst = rows[rows.length - 1];
  return { best, worst, enough: best.rate - worst.rate >= 0.1 };
}
export const LEAD_BANDS = [
  { key: "same_day", label: "Same day", maxHours: 24 }, { key: "d1_2", label: "1 to 2 days", maxHours: 72 }, { key: "d3_7", label: "3 to 7 days", maxHours: 192 }, { key: "d8_plus", label: "8 days or more", maxHours: Infinity },
] as const;
export type LeadBandKey = (typeof LEAD_BANDS)[number]["key"];

// ---------- people and fairness ----------
export type PersonAgg = { id: string | null; source: string; t: Tot };
export type PersonRow = {
  id: string | null; name: string; booked: number; showRate: Rate; closeRate: Rate; showToClose: Rate; wonValue: number; won: number; expectedShow: number | null;
  vsExpectedPoints: number | null; enough: boolean; prevShow: number | null; movePoints: number | null;
};
/** Fair comparison: each person's show rate against the rate we would expect for the SAME mix of sources (everyone's own rate per source, weighted by what this person booked). */
export function peopleOf(aggs: PersonAgg[], prev: PersonAgg[], name: (id: string | null) => string): PersonRow[] {
  const bySource = new Map<string, Tot>();
  for (const a of aggs) bySource.set(a.source, addTot(bySource.get(a.source) ?? ZERO, a.t));
  const group = (xs: PersonAgg[]) => { const m = new Map<string | null, PersonAgg[]>(); for (const a of xs) m.set(a.id, [...(m.get(a.id) ?? []), a]); return m; };
  const prevBy = new Map<string | null, Tot>();
  for (const [id, xs] of group(prev)) prevBy.set(id, xs.reduce((t, x) => addTot(t, x.t), ZERO));
  const out: PersonRow[] = [];
  for (const [id, xs] of group(aggs)) {
    const t = xs.reduce((s, x) => addTot(s, x.t), ZERO);
    const sr = showRate(t);
    let expN = 0, expDen = 0;
    for (const x of xs) {
      const src = bySource.get(x.source) ?? ZERO, den = src.showed + src.noshow + src.unmarked, mine = x.t.showed + x.t.noshow + x.t.unmarked;
      if (den >= MIN_RATE && mine > 0) { expN += (src.showed / den) * mine; expDen += mine; }
    }
    const expected = expDen >= MIN_PERSON ? expN / expDen : null;
    const p = prevBy.get(id), ps = p ? showRate(p) : null;
    out.push({
      id, name: name(id), booked: t.booked, showRate: sr, closeRate: closeRate(t), showToClose: showToClose(t), wonValue: t.wonValue, won: t.won,
      expectedShow: expected, vsExpectedPoints: sr.value !== null && expected !== null ? Math.round((sr.value - expected) * 100) : null, enough: sr.enough,
      prevShow: ps?.value ?? null, movePoints: sr.value !== null && ps?.value != null ? Math.round((sr.value - ps.value) * 100) : null,
    });
  }
  return out;
}
export const topMovers = (rows: PersonRow[], n = 3) => {
  const m = rows.filter((r) => r.movePoints !== null && r.movePoints !== 0);
  return { up: [...m].sort((a, b) => (b.movePoints as number) - (a.movePoints as number)).filter((r) => (r.movePoints as number) > 0).slice(0, n), down: [...m].sort((a, b) => (a.movePoints as number) - (b.movePoints as number)).filter((r) => (r.movePoints as number) < 0).slice(0, n) };
};

// ---------- decisions ----------
export type OpenSpec = { title: string; params: Record<string, string> };
export type Decision = { key: string; headline: string; evidence: string; button: string; open: OpenSpec | null; weight: number };
export type DecisionInput = {
  unmarked: number; showRate: Rate; people: PersonRow[]; slots: ReturnType<typeof slotsOf>; sources: Array<{ source: string; t: Tot }>; accounts: Array<{ id: string; name: string; t: Tot; prev: Tot }>;
  pace: Pace; leak: Funnel["leak"]; calendars: Array<{ id: string; name: string; weeklyNow: number; peak: number }>;
};
const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
/** Three to five plain-language suggestions the numbers support. Each has its evidence and the rows to open. Nothing is shown unless a minimum sample backs it. */
export function decisionsOf(i: DecisionInput): Decision[] {
  const out: Decision[] = [];
  if (i.unmarked >= 5) out.push({ key: "outcomes", weight: 90 + Math.min(i.unmarked, 50) / 10, headline: `Get ${i.unmarked.toLocaleString("en-US")} past appointments marked`, evidence: `Appointments with no recorded outcome hide your real show rate. Until they are marked, nobody knows whether those people came.`, button: "Open the appointments", open: { title: "Past appointments with no outcome", params: { bucket: "unmarked" } } });
  const coach = i.people.filter((p) => p.id && p.vsExpectedPoints !== null && p.vsExpectedPoints <= -10 && p.booked >= MIN_PERSON).sort((a, b) => (a.vsExpectedPoints as number) - (b.vsExpectedPoints as number))[0];
  if (coach) out.push({ key: "coach", weight: 80, headline: `Coach ${coach.name} on getting people to show up`, evidence: `${pct(coach.showRate.value)} of ${coach.name}'s booked people showed, against ${pct(coach.expectedShow)} expected for the same kinds of leads (${coach.showRate.of} appointments).`, button: "Open the appointments", open: { title: `${coach.name}: booked, did not show`, params: { setter: coach.id as string, bucket: "noshow" } } });
  if (i.slots.enough && i.slots.worst && i.slots.best) {
    const w = i.slots.worst, b = i.slots.best;
    out.push({ key: "slot", weight: 70, headline: `Stop booking ${DOW[w.dow]} ${hourLabel(w.hour)} if you can`, evidence: `Only ${pct(w.rate)} show up in that slot (${w.n} appointments), against ${pct(b.rate)} on ${DOW[b.dow]} at ${hourLabel(b.hour)}.`, button: "Open the appointments", open: { title: `${DOW[w.dow]} ${hourLabel(w.hour)}, all appointments`, params: { dow: String(w.dow), hour: String(w.hour), bucket: "completed" } } });
  }
  const srcAll = i.sources.reduce((t, s) => addTot(t, s.t), ZERO), allRate = showRate(srcAll).value;
  const waste = i.sources.filter((s) => s.source && showRate(s.t).enough && allRate !== null && (showRate(s.t).value as number) <= allRate - 0.12).sort((a, b) => (b.t.noshow + b.t.cancelled) - (a.t.noshow + a.t.cancelled))[0];
  if (waste) out.push({ key: "source", weight: 65, headline: `${waste.source} bookings are wasting calendar time`, evidence: `${pct(showRate(waste.t).value)} show rate from "${waste.source}", against ${pct(allRate)} overall. ${waste.t.noshow + waste.t.cancelled} of its bookings were no-shows or cancelled.`, button: "Open the appointments", open: { title: `${waste.source}: no-shows`, params: { source: waste.source, bucket: "noshow" } } });
  const slip = i.accounts.map((a) => ({ a, cur: showRate(a.t), prev: showRate(a.prev) })).filter((x) => x.cur.enough && x.prev.enough && (x.cur.value as number) - (x.prev.value as number) <= -0.08).sort((x, y) => (x.cur.value as number) - (x.prev.value as number) - ((y.cur.value as number) - (y.prev.value as number)))[0];
  if (slip) out.push({ key: "account", weight: 75, headline: `${slip.a.name} is slipping`, evidence: `Show rate fell from ${pct(slip.prev.value)} to ${pct(slip.cur.value)} against the previous period (${slip.cur.of} appointments).`, button: "Open the appointments", open: { title: `${slip.a.name}: no-shows`, params: { location: slip.a.id, bucket: "noshow" } } });
  if (i.pace.status === "behind") out.push({ key: "pace", weight: 85, headline: "Bookings are behind pace", evidence: i.pace.sentence, button: "Open this month's bookings", open: { title: "Booked this month", params: { bucket: "booked", basis: "booked", month: "1" } } });
  const idle = i.calendars.filter((c) => c.peak >= 5 && c.weeklyNow === 0)[0];
  if (idle) out.push({ key: "idle", weight: 55, headline: `${idle.name} has gone quiet`, evidence: `No bookings this week, against a busiest week of ${idle.peak}. Check the calendar is still open and linked.`, button: "Open the appointments", open: { title: `${idle.name}, recent`, params: { calendar: idle.id, bucket: "booked" } } });
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}

/** Plain headline for the top of the screen: the one thing a manager should know. */
export function headlineOf(cur: Tot, prev: Tot | null, f: Funnel): string {
  if (cur.booked === 0) return "No appointments in this period yet.";
  const sr = showRate(cur), ps = prev ? showRate(prev) : null;
  const bits: string[] = [`${cur.booked.toLocaleString("en-US")} booked`];
  if (sr.enough && sr.value !== null) bits.push(`${Math.round(sr.value * 100)}% showed`);
  if (prev && prev.booked >= MIN_RATE) { const d = delta(cur.booked, prev.booked, "count"); if (d.pct !== null) bits.push(`${d.pct >= 0 ? "up" : "down"} ${Math.abs(d.pct)}% on the previous period`); }
  if (sr.enough && ps?.enough && sr.value !== null && ps.value !== null && Math.abs(sr.value - ps.value) >= 0.03) bits.push(`show rate ${sr.value > ps.value ? "improved" : "slipped"} ${Math.abs(Math.round((sr.value - ps.value) * 100))} points`);
  return `${bits.join(", ")}.${f.leak ? ` ${f.leak.sentence}` : ""}`;
}

/** The weekly brief as plain text a manager can paste into an email. No vendor names. */
export function briefText(o: { title: string; period: string; cur: Tot; prev: Tot | null; funnel: Funnel; pace: Pace; decisions: Decision[]; lost: Estimate }): string {
  const sr = showRate(o.cur), lines: string[] = [`${o.title}`, `${o.period}`, ""];
  lines.push(headlineOf(o.cur, o.prev, o.funnel), "");
  lines.push(`Booked: ${o.cur.booked}`, `Showed: ${o.cur.showed}`, `Show rate: ${sr.enough ? pct(sr.value) : "not enough data"}`, `No-shows: ${o.cur.noshow}`, `Won from appointments: ${o.cur.won}${o.cur.wonValue ? ` ($${Math.round(o.cur.wonValue).toLocaleString("en-US")})` : ""}`);
  if (o.lost.enough && o.lost.value) lines.push(`Estimated revenue lost to no-shows: about $${o.lost.value.toLocaleString("en-US")} (estimate: ${o.lost.formula})`);
  lines.push("", `Pace: ${o.pace.sentence}`, "");
  if (o.decisions.length) { lines.push("What to fix this week:"); o.decisions.forEach((d, n) => lines.push(`${n + 1}. ${d.headline}. ${d.evidence}`)); }
  return lines.join("\n");
}
