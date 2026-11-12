// One place that says what is good, what needs a look and what is bad for a rate (stage: Appointments redesign). Pure: no React, no network.
// Colour is never the only signal: every tone has a word and a glyph, and the thresholds are written here so the legend and the info popover quote them, not guess them.

export type Tone = "good" | "caution" | "bad" | "neutral";
export const TONE_WORD: Record<Tone, string> = { good: "Good", caution: "Watch", bad: "Low", neutral: "Not enough data" };
export const TONE_WORD_LOWER_BETTER: Record<Tone, string> = { good: "Good", caution: "Watch", bad: "High", neutral: "Not enough data" };
export const TONE_GLYPH: Record<Tone, string> = { good: "▲", caution: "◆", bad: "▼", neutral: "–" };

/** A scale: for a "higher is better" rate, `good` is the lowest value still good and `caution` the lowest value still only a watch. For "lower is better" they are the highest. */
export type Scale = { id: string; name: string; good: number; caution: number; higherIsBetter: boolean };
export const SCALES = {
  show: { id: "show", name: "Show rate", good: 0.8, caution: 0.6, higherIsBetter: true },
  noShow: { id: "noShow", name: "No-show rate", good: 0.15, caution: 0.3, higherIsBetter: false },
  cancel: { id: "cancel", name: "Cancel rate", good: 0.1, caution: 0.2, higherIsBetter: false },
  reply: { id: "reply", name: "First reply", good: 0.9, caution: 0.7, higherIsBetter: true },
  booked: { id: "booked", name: "Booked", good: 0.35, caution: 0.2, higherIsBetter: true },
  deal: { id: "deal", name: "Deal opened", good: 0.6, caution: 0.4, higherIsBetter: true },
  won: { id: "won", name: "Won", good: 0.4, caution: 0.2, higherIsBetter: true },
} as const satisfies Record<string, Scale>;

/** The tone of a rate (a fraction 0..1). Null or not a number is neutral: "not enough data", never a colour. */
export function toneOf(v: number | null | undefined, s: Scale): Tone {
  if (v === null || v === undefined || !Number.isFinite(v)) return "neutral";
  if (s.higherIsBetter) return v >= s.good ? "good" : v >= s.caution ? "caution" : "bad";
  return v <= s.good ? "good" : v <= s.caution ? "caution" : "bad";
}
export const wordOf = (t: Tone, s: Scale) => (s.higherIsBetter ? TONE_WORD[t] : TONE_WORD_LOWER_BETTER[t]);
const p = (n: number) => `${Math.round(n * 100)}%`;
/** The thresholds in plain words, for the legend and the info popover. */
export function scaleWords(s: Scale): Array<{ tone: Tone; text: string }> {
  return s.higherIsBetter
    ? [{ tone: "good", text: `${p(s.good)} and up` }, { tone: "caution", text: `${p(s.caution)} to ${p(s.good - 0.01)}` }, { tone: "bad", text: `under ${p(s.caution)}` }]
    : [{ tone: "good", text: `${p(s.good)} or less` }, { tone: "caution", text: `over ${p(s.good)} to ${p(s.caution)}` }, { tone: "bad", text: `over ${p(s.caution)}` }];
}

/** A rate compared with the average of everything it is part of (for example one lead source against all sources). 5 points or more above is good, 5 or more below is bad, in between is grey. */
export function relativeTone(v: number | null | undefined, average: number | null | undefined, gap = 0.05): Tone {
  if (v === null || v === undefined || average === null || average === undefined || !Number.isFinite(v) || !Number.isFinite(average)) return "neutral";
  return v - average >= gap ? "good" : average - v >= gap ? "bad" : "neutral";
}

/** A change between two periods (in the rate's own units, 0..1). Whether up is good depends on the rate. A change under half a point is "flat" (neutral). */
export function deltaTone(delta: number | null | undefined, higherIsBetter: boolean): Tone {
  if (delta === null || delta === undefined || !Number.isFinite(delta) || Math.abs(delta) < 0.005) return "neutral";
  return (delta > 0) === higherIsBetter ? "good" : "bad";
}
export function deltaWords(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "no earlier period to compare";
  const pts = Math.round(delta * 100);
  return pts === 0 ? "no change" : `${pts > 0 ? "up" : "down"} ${Math.abs(pts)} point${Math.abs(pts) === 1 ? "" : "s"}`;
}

/** The diverging scale for the heat map: six steps, red through amber to green, centred on the caution band. `strength` is how strongly the cell is tinted (0.25 to 0.85). */
export type HeatLevel = { step: number; tone: Tone; strength: number; label: string };
const HEAT_STEPS: Array<{ below: number; level: HeatLevel }> = [
  { below: 0.4, level: { step: 1, tone: "bad", strength: 0.85, label: "Under 40%" } },
  { below: 0.5, level: { step: 2, tone: "bad", strength: 0.6, label: "40 to 49%" } },
  { below: 0.6, level: { step: 3, tone: "bad", strength: 0.35, label: "50 to 59%" } },
  { below: 0.7, level: { step: 4, tone: "caution", strength: 0.55, label: "60 to 69%" } },
  { below: 0.8, level: { step: 5, tone: "caution", strength: 0.3, label: "70 to 79%" } },
  { below: 0.9, level: { step: 6, tone: "good", strength: 0.45, label: "80 to 89%" } },
];
export const HEAT_TOP: HeatLevel = { step: 7, tone: "good", strength: 0.8, label: "90% and up" };
export const HEAT_LEGEND: HeatLevel[] = [...HEAT_STEPS.map((s) => s.level), HEAT_TOP];
export function heatLevel(rate: number | null | undefined): HeatLevel | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  for (const s of HEAT_STEPS) if (rate < s.below) return s.level;
  return HEAT_TOP;
}

export type HeatCell = { weekday: number; hour: number; held: number; noShow: number };
const PARTS: Array<{ key: string; word: string; test: (h: number) => boolean }> = [
  { key: "morning", word: "Mornings", test: (h) => h < 12 },
  { key: "afternoon", word: "Afternoons", test: (h) => h >= 12 && h < 17 },
  { key: "evening", word: "Evenings", test: (h) => h >= 17 },
];
const DAY_WORDS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
export const MIN_GROUP_OUTCOMES = 20;
export const MIN_GAP_POINTS = 5;

/** Show rate of a group of cells: showed / (showed + no-show). Null under the minimum number of recorded outcomes. */
function groupRate(cells: HeatCell[]): { rate: number; n: number } | null {
  let held = 0, miss = 0;
  for (const c of cells) { held += c.held; miss += c.noShow; }
  const n = held + miss;
  return n >= MIN_GROUP_OUTCOMES ? { rate: held / n, n } : null;
}
/** The one plain sentence for the heat map: the biggest gap, by part of the day or by weekday, with at least 20 recorded outcomes on each side and a gap of 5 points. Null when nothing is clear. */
export function heatSentence(cells: HeatCell[]): { text: string; points: number; best: string; worst: string } | null {
  const groups: Array<{ word: string; rate: number }[]> = [
    PARTS.map((pt) => ({ word: pt.word, g: groupRate(cells.filter((c) => pt.test(c.hour))) })).filter((x): x is { word: string; g: { rate: number; n: number } } => x.g !== null).map((x) => ({ word: x.word, rate: x.g.rate })),
    DAY_WORDS.map((word, wd) => ({ word, g: groupRate(cells.filter((c) => c.weekday === wd)) })).filter((x): x is { word: string; g: { rate: number; n: number } } => x.g !== null).map((x) => ({ word: x.word, rate: x.g.rate })),
  ];
  let pick: { best: { word: string; rate: number }; worst: { word: string; rate: number }; points: number } | null = null;
  for (const g of groups) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => b.rate - a.rate);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const points = Math.round((best.rate - worst.rate) * 100);
    if (points >= MIN_GAP_POINTS && (!pick || points > pick.points)) pick = { best, worst, points };
  }
  if (!pick) return null;
  return { text: `${pick.best.word} show up ${pick.points} points better than ${pick.worst.word.toLowerCase()}.`, points: pick.points, best: pick.best.word, worst: pick.worst.word };
}

/** One plain headline for a rate with its tone word: "Show rate 72%, watch (target 80%)". */
export function rateLine(name: string, v: number | null, s: Scale): string {
  const t = toneOf(v, s);
  return v === null ? `${name}: not enough data yet` : `${name} ${p(v)}: ${wordOf(t, s).toLowerCase()}`;
}
