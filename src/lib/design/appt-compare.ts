import type { Appt3CompareSide } from "../analytics/appointments3-types.ts";
import { money, pct } from "./appt-coach.ts";

export type CompareRow = { label: string; cells: string[]; counts: Array<{ n: number; outcome?: "showed" | "noshow" } | null>; better: number };

/** The headline rows of the side-by-side table. Pure, so it is unit tested: a new person or booking changes the output with no code change. */
export function compareRows(sides: Appt3CompareSide[]): CompareRow[] {
  const rate = (r: Appt3CompareSide["showRate"]) => (r.value === null ? "n/a" : pct(r.value));
  const better = (vals: Array<number | null>, high: boolean) => (vals.length === 2 && vals[0] !== null && vals[1] !== null && vals[0] !== vals[1] ? (high ? (vals[0] > vals[1] ? 0 : 1) : (vals[0] < vals[1] ? 0 : 1)) : -1);
  return [
    { label: "Booked", cells: sides.map((s) => String(s.booked)), counts: sides.map((s) => ({ n: s.booked })), better: -1 },
    { label: "Showed", cells: sides.map((s) => `${s.showed}${s.showRate.value === null ? "" : ` (${rate(s.showRate)})`}`), counts: sides.map((s) => ({ n: s.showed, outcome: "showed" as const })), better: better(sides.map((s) => s.showRate.value), true) },
    { label: "No-show", cells: sides.map((s) => `${s.noshow}${s.noshowRate.value === null ? "" : ` (${rate(s.noshowRate)})`}`), counts: sides.map((s) => ({ n: s.noshow, outcome: "noshow" as const })), better: better(sides.map((s) => s.noshowRate.value), false) },
    { label: "Deals won", cells: sides.map((s) => `${money(Math.round(s.wonValue * 100))} (${s.won})`), counts: sides.map(() => null), better: better(sides.map((s) => s.wonValue), true) },
  ];
}

