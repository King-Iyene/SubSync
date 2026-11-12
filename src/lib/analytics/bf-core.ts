// Booking funnel (stage BF): the pure rules. Lead came in > First reply > Booked > Showed up > Deal opened > Won. No database here, so the tests can read every definition.
//
// A lead "reaches" a step when it (or anything after it) happened. Reaching is counted down the chain, so a later step can never be bigger than an earlier one and a drop is never
// negative: a lead that has a won deal but no recorded reply still counts as having been replied to. Every estimate carries its formula and says "not enough data" under a minimum.

export const STEPS = [
  { key: "lead", label: "Lead came in", noun: "new leads" },
  { key: "answered", label: "First reply", noun: "leads that got a reply" },
  { key: "booked", label: "Booked", noun: "leads that booked" },
  { key: "showed", label: "Showed up", noun: "leads that showed up" },
  { key: "deal", label: "Deal opened", noun: "leads with a deal" },
  { key: "won", label: "Won", noun: "leads won" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];
export const STEP_KEYS: readonly StepKey[] = STEPS.map((s) => s.key);
export const isStepKey = (v: unknown): v is StepKey => typeof v === "string" && (STEP_KEYS as readonly string[]).includes(v);
export const stepIndex = (k: StepKey) => STEP_KEYS.indexOf(k);

/** Minimums: under these a rate, a ranking or a dollar line says "not enough data" instead of a number. */
export const MIN_LEADS = 10; // 10 leads are enough to show the funnel and say where it leaks; fewer are shown with a plain note
export const MIN_STEP = 10;
export const MIN_WON = 5;
export const DAY_MS = 86_400_000;
export const FORMULA = {
  leak: "Leads lost at this step x how often leads that get past it end up won x your average won deal. An estimate from your own history, not a promise.",
  forecast: "New leads per day over the last 28 days x the share that booked within 30 days x the share of bookings that showed x the share of those that were won x your average won deal. An estimate from your own history.",
} as const;

export type Tot = {
  leads: number; answered: number; booked: number; showed: number; deal: number; won: number; wonValue: number; lost: number;
  tTouchSecs: number; tTouchN: number; tBookSecs: number; tBookN: number; tShowSecs: number; tShowN: number; tWinSecs: number; tWinN: number;
  mature7: number; mature14: number; mature30: number; booked7: number; booked14: number; booked30: number; showed7: number; showed14: number; showed30: number; won7: number; won14: number; won30: number;
};
export const ZERO: Tot = {
  leads: 0, answered: 0, booked: 0, showed: 0, deal: 0, won: 0, wonValue: 0, lost: 0, tTouchSecs: 0, tTouchN: 0, tBookSecs: 0, tBookN: 0, tShowSecs: 0, tShowN: 0, tWinSecs: 0, tWinN: 0,
  mature7: 0, mature14: 0, mature30: 0, booked7: 0, booked14: 0, booked30: 0, showed7: 0, showed14: 0, showed30: 0, won7: 0, won14: 0, won30: 0,
};
export const addTot = (a: Tot, b: Partial<Tot>): Tot => { const o = { ...a }; for (const k of Object.keys(ZERO) as Array<keyof Tot>) o[k] = a[k] + (b[k] ?? 0); return o; };

/** The six counts, made safe: never above the step before it. */
export function reachOf(t: Pick<Tot, "leads" | "answered" | "booked" | "showed" | "deal" | "won">): number[] {
  const raw = [t.leads, t.answered, t.booked, t.showed, t.deal, t.won];
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) out.push(Math.max(0, Math.min(i === 0 ? Infinity : out[i - 1], Math.floor(raw[i] || 0))));
  return out;
}

export type StepRow = { key: StepKey; label: string; count: number; /** Of the step before it. */ passPct: number | null; /** Leads that stopped before this step. */ lost: number; dropPct: number | null; /** True when the step before it is big enough to judge. */ enough: boolean };
export function stepRows(t: Tot): StepRow[] {
  const r = reachOf(t);
  return STEPS.map((s, i) => {
    if (i === 0) return { key: s.key, label: s.label, count: r[0], passPct: null, lost: 0, dropPct: null, enough: r[0] >= MIN_LEADS };
    const prev = r[i - 1], enough = prev >= MIN_STEP, lost = prev - r[i];
    return { key: s.key, label: s.label, count: r[i], passPct: prev > 0 ? Math.round((r[i] / prev) * 100) : null, lost, dropPct: prev > 0 ? Math.round((lost / prev) * 100) : null, enough };
  });
}

/** The dollars a step's leak is worth, as an estimate. null when there is not enough history to say. */
export function leakDollars(t: Tot, stepIdx: number): number | null {
  const r = reachOf(t);
  if (stepIdx < 1 || stepIdx > 5 || t.won < MIN_WON || r[stepIdx - 1] < MIN_STEP || r[stepIdx] < MIN_STEP) return null;
  const lost = r[stepIdx - 1] - r[stepIdx], winRate = r[5] / r[stepIdx], avg = t.wonValue / t.won;
  return Number.isFinite(winRate) && avg > 0 ? Math.round(lost * winRate * avg) : null;
}

export type Leak = { stepIdx: number; key: StepKey; label: string; lost: number; dropPct: number; dollars: number | null };
/** The one step that loses the most: by dollars when we can say, otherwise by how many leads it loses. Steps whose neighbour is too small are skipped. */
export function biggestLeak(t: Tot): Leak | null {
  if (t.leads < MIN_LEADS) return null;
  const rows = stepRows(t);
  let best: Leak | null = null, bestScore = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.enough || row.lost <= 0 || row.dropPct === null) continue;
    const dollars = leakDollars(t, i), score = dollars ?? row.lost / 1000;
    if (score > bestScore) { bestScore = score; best = { stepIdx: i, key: row.key, label: row.label, lost: row.lost, dropPct: row.dropPct, dollars }; }
  }
  return best;
}

const DOW_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const PARTS_OF_DAY = [{ key: "night", word: "at night", plural: "nights", from: 0, to: 5 }, { key: "morning", word: "in the morning", plural: "mornings", from: 5, to: 12 }, { key: "afternoon", word: "in the afternoon", plural: "afternoons", from: 12, to: 17 }, { key: "evening", word: "in the evening", plural: "evenings", from: 17, to: 24 }] as const;
export const partOfHour = (h: number) => PARTS_OF_DAY.find((p) => h >= p.from && h < p.to) ?? PARTS_OF_DAY[0];

export type Cell = { dow: number; hour: number; before: number; after: number };
/** The weekday and part of the day where the chosen step loses the most, when it is clearly worse than the rest (10 points or more, and enough leads). null otherwise. */
export function hotspot(cells: readonly Cell[]): { dow: number | null; part: (typeof PARTS_OF_DAY)[number]["key"] | null; text: string } | null {
  const tb = cells.reduce((a, c) => a + c.before, 0), ta = cells.reduce((a, c) => a + c.after, 0);
  if (tb < MIN_STEP * 4) return null;
  const overall = 1 - ta / tb;
  const worst = <K extends string | number>(key: (c: Cell) => K) => {
    const m = new Map<K, { b: number; a: number }>();
    for (const c of cells) { const e = m.get(key(c)) ?? { b: 0, a: 0 }; e.b += c.before; e.a += c.after; m.set(key(c), e); }
    let pick: K | null = null, drop = overall + 0.1;
    for (const [k, e] of m) if (e.b >= MIN_STEP && 1 - e.a / e.b >= drop) { drop = 1 - e.a / e.b; pick = k; }
    return pick;
  };
  const dow = worst((c) => c.dow), part = worst((c) => partOfHour(c.hour).key);
  if (dow === null && part === null) return null;
  const p = part ? PARTS_OF_DAY.find((x) => x.key === part) : null;
  return { dow, part, text: dow !== null && p ? `leads from ${DOW_NAME[dow]} ${p.plural}` : dow !== null ? `leads from ${DOW_NAME[dow]}s` : `leads that came in ${p?.word ?? ""}` };
}

/** The plain sentence over the funnel. */
export function headlineOf(t: Tot, hot: ReturnType<typeof hotspot> = null): string {
  if (t.leads < MIN_LEADS) return `Only ${t.leads} ${t.leads === 1 ? "lead" : "leads"} in these dates. We need at least ${MIN_LEADS} to say where the funnel leaks, so widen the dates. The steps below show what happened to them.`;
  const leak = biggestLeak(t);
  if (!leak) return "No clear leak in these dates: leads move through every step at a healthy pace.";
  const w: Record<StepKey, string> = {
    lead: "", answered: `${leak.dropPct}% of new leads never get a first reply`, booked: `${leak.dropPct}% of replied leads never book`, showed: `${leak.dropPct}% of booked leads never show up`,
    deal: `${leak.dropPct}% of leads that showed never get a deal opened`, won: `${leak.dropPct}% of deals never close`,
  };
  return `Biggest leak: ${w[leak.key]}${hot ? `, worst for ${hot.text}` : ""}.`;
}

export const median = (v: number[]): number | null => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** "5 min", "3.2 h", "2.1 d" from seconds. */
export function spanText(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return "not enough data";
  const m = secs / 60;
  return m < 1 ? "under a minute" : m < 60 ? `${Math.round(m)} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`;
}

// ---------------------------------------------------------------- cohorts
export type CohortRow = { week: string; leads: number; mature7: number; mature14: number; mature30: number; booked7: number; booked14: number; booked30: number; showed7: number; showed14: number; showed30: number; won7: number; won14: number; won30: number };
/** A rate for one cohort cell: null while no lead in the cohort is old enough yet (so a young week is never drawn as zero). */
export const cohortRate = (num: number, mature: number): number | null => (mature >= MIN_STEP ? Math.round((num / mature) * 1000) / 10 : null);
/** The Monday of the week a day is in (UTC), as YYYY-MM-DD. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`), dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- forecast
export type ForecastIn = { leads28: number; mature30: number; booked30: number; showed30: number; won30: number; wonValue: number; wonN: number; liveDays: number };
export type Forecast = { enough: boolean; why: string | null; bookings: number | null; shows: number | null; won: number | null; revenue: number | null; formula: string; basedOn: string };
/** Next 30 days of bookings and revenue from the funnel's own rates. All estimates; "not enough data" under the minimums. */
export function forecastOf(i: ForecastIn): Forecast {
  const base = { formula: FORMULA.forecast, basedOn: `${i.leads28.toLocaleString("en-US")} leads in the last 28 days` };
  if (i.liveDays < 14 || i.mature30 < MIN_LEADS || i.leads28 < MIN_LEADS) return { enough: false, why: "Not enough history yet: it needs about two weeks of leads that are a month old.", bookings: null, shows: null, won: null, revenue: null, ...base };
  const perDay = i.leads28 / 28, bookRate = i.booked30 / i.mature30;
  const bookings = Math.round(perDay * 30 * bookRate), showRate = i.booked30 > 0 ? Math.min(1, i.showed30 / i.booked30) : 0;
  const shows = Math.round(bookings * showRate), winRate = i.showed30 > 0 ? Math.min(1, i.won30 / i.showed30) : 0;
  const won = Math.round(shows * winRate);
  const revenue = i.wonN >= MIN_WON ? Math.round(won * (i.wonValue / i.wonN)) : null;
  return { enough: true, why: revenue === null ? "Revenue needs at least 5 won deals in your history." : null, bookings, shows, won, revenue, ...base };
}

// ---------------------------------------------------------------- compare and leak finder rows
export type Entity = { id: string; name: string; tot: Tot };
export type EntityLeak = { id: string; name: string; leads: number; leak: Leak | null; overallPct: number | null };
/** For each account (or person) the single biggest leak, worst first (by dollars, then by leads lost). Entities with too few leads are listed last without a leak. */
export function leakFinder(rows: readonly Entity[]): EntityLeak[] {
  const out = rows.map((e) => { const r = reachOf(e.tot); return { id: e.id, name: e.name, leads: e.tot.leads, leak: biggestLeak(e.tot), overallPct: r[0] >= MIN_LEADS ? Math.round((r[5] / r[0]) * 1000) / 10 : null }; });
  return out.sort((a, b) => (a.leak ? 0 : 1) - (b.leak ? 0 : 1) || (b.leak?.dollars ?? -1) - (a.leak?.dollars ?? -1) || (b.leak?.lost ?? 0) - (a.leak?.lost ?? 0) || b.leads - a.leads);
}

export const DIMS = ["account", "source", "form", "calendar", "setter", "closer", "owner", "dow", "hour", "age"] as const;
export type Dim = (typeof DIMS)[number];
export const isDim = (v: unknown): v is Dim => typeof v === "string" && (DIMS as readonly string[]).includes(v);
export const DIM_LABEL: Record<Dim, string> = { account: "Client account", source: "Where leads come from", form: "Form", calendar: "Calendar", setter: "Who booked", closer: "Who takes the meeting", owner: "Lead owner", dow: "Day of the week", hour: "Time of day", age: "How old the lead is" };
export const AGE_BANDS = [{ key: "d0", label: "Under 1 day" }, { key: "d1_7", label: "1 to 7 days" }, { key: "d8_30", label: "8 to 30 days" }, { key: "d31", label: "Over 30 days" }] as const;

export const pctText = (v: number | null, d = 0) => (v === null ? "n/a" : `${v.toFixed(d)}%`);

/** Page size and cap for the lists behind a number. */
export const PAGE = 25;
export const RECOVER_CAP = 200;
export const RECOVER_TAG = "subsync-recover";
export const recoverPhrase = (count: number, name?: string | null) => (count === 1 && name ? `recover ${name.replace(/\s+/g, " ").trim()}` : `recover ${count} ${count === 1 ? "lead" : "leads"}`);
