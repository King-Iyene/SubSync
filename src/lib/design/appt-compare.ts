import type { Appt3CompareSide } from "../analytics/appointments3-types.ts";
import { money, pct } from "./appt-coach.ts";

export type CompareOutcome = "showed" | "noshow" | "unmarked" | "won";
export type CompareCell = { text: string; sub?: string; n: number; outcome?: CompareOutcome; win: boolean };
export type CompareRow = { label: string; hint: string; cells: CompareCell[] };

const NONE = "none yet";
const TOO_FEW = "not enough bookings yet (needs 5)";

/** The headline rows of the side-by-side. Pure, so it is unit tested. Only a real, clear difference is marked better, and never a rate built on a tiny sample. */
export function compareRows(sides: Appt3CompareSide[]): CompareRow[] {
  const two = sides.length === 2;
  const best = (vals: Array<number | null>, high: boolean) => (!two || vals[0] === null || vals[1] === null || vals[0] === vals[1] ? -1 : (high ? vals[0] > vals[1] : vals[0] < vals[1]) ? 0 : 1);
  const rated = (s: Appt3CompareSide, count: number, r: Appt3CompareSide["showRate"]): Pick<CompareCell, "text" | "sub"> => (count === 0 && r.of === 0 ? { text: NONE } : { text: String(count), sub: r.value === null ? TOO_FEW : `${pct(r.value)} of marked or past` });
  const showBest = best(sides.map((s) => (s.showRate.enough ? s.showRate.value : null)), true);
  const noBest = best(sides.map((s) => (s.noshowRate.enough ? s.noshowRate.value : null)), false);
  const bookBest = best(sides.map((s) => s.booked), true);
  const wonBest = best(sides.map((s) => s.wonValue), true);
  const cell = (i: number, win: number, c: Omit<CompareCell, "win">): CompareCell => ({ ...c, win: win === i });
  return [
    { label: "Booked", hint: "Appointments booked in these dates, not counting invalid ones.", cells: sides.map((s, i) => cell(i, bookBest, s.booked === 0 ? { text: NONE, n: 0 } : { text: String(s.booked), n: s.booked })) },
    { label: "Showed up", hint: "Marked as showed. The percentage counts showed out of everything marked, plus past appointments nobody marked.", cells: sides.map((s, i) => cell(i, showBest, { ...rated(s, s.showed, s.showRate), n: s.showed, outcome: "showed" })) },
    { label: "No-show", hint: "Marked as no-show. The percentage counts no-shows out of everything marked, plus past appointments nobody marked.", cells: sides.map((s, i) => cell(i, noBest, { ...rated(s, s.noshow, s.noshowRate), n: s.noshow, outcome: "noshow" })) },
    { label: "No outcome yet", hint: "Past appointments nobody has marked as showed or no-show.", cells: sides.map((s, i) => cell(i, -1, s.unmarked === 0 ? { text: NONE, n: 0 } : { text: String(s.unmarked), n: s.unmarked, outcome: "unmarked" })) },
    { label: "Closed / won", hint: "Deals won, matched through the contact on each appointment.", cells: sides.map((s, i) => cell(i, wonBest, s.won === 0 ? { text: NONE, n: 0 } : { text: money(Math.round(s.wonValue * 100)), sub: `${s.won} deal${s.won === 1 ? "" : "s"}`, n: s.won, outcome: "won" })) },
  ];
}

const first = (n: string) => (/^(Unknown|Whole|Booker|Owner)/.test(n) ? n : n.split(" ")[0] || n);

/** ONE plain sentence that says what the two columns mean. Never a verdict on a small sample. */
export function compareSentence(sides: Appt3CompareSide[]): string {
  if (sides.length < 2) return "";
  const [a, b] = sides, an = first(a.name), bn = first(b.name);
  if (a.booked === 0 && b.booked === 0) return "Neither has appointments in these dates.";
  if (a.booked === 0 || b.booked === 0) return `${first((a.booked === 0 ? a : b).name)} has no appointments in these dates.`;
  const hi = a.booked === b.booked ? null : a.booked > b.booked ? a : b;
  const lead = hi ? `${first(hi.name)} books more (${hi.booked} against ${(hi === a ? b : a).booked})` : `${an} and ${bn} booked the same number (${a.booked})`;
  const marked = (s: Appt3CompareSide) => s.showed + s.noshow;
  const blank = [a, b].filter((s) => marked(s) === 0);
  if (blank.length === 2) return `${lead}, but neither has outcomes marked yet.`;
  if (blank.length === 1) return `${lead}, but ${first(blank[0].name)} has no outcomes marked yet.`;
  if (a.showRate.enough && b.showRate.enough && a.showRate.value !== null && b.showRate.value !== null && Math.abs(a.showRate.value - b.showRate.value) >= 0.1) {
    const w = a.showRate.value > b.showRate.value ? a : b;
    return `${lead}, and ${first(w.name)} shows up more often (${pct(w.showRate.value)} against ${pct((w === a ? b : a).showRate.value)}).`;
  }
  return `${lead}. Too early to say who gets more people to show up.`;
}
