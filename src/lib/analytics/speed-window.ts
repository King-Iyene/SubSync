import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
import { localDay } from "../design/zone.ts";
// The window a Speed to lead card asks for (KF-4): two calendar dates (UTC days) from the card's own range control, and optionally a second window to
// compare with. Pure, so the rules are unit tested. The server never trusts the browser: a bad date, a backwards range or a range longer than a year is
// refused with a plain reason, and the server never looks further back than it holds data.

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_WINDOW_DAYS = MAX_RANGE_DAYS;

export type Win = { from: string; to: string; fromMs: number; toMs: number; days: number };

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const valid = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && Number.isFinite(dayMs(s)) && new Date(dayMs(s)).toISOString().slice(0, 10) === s;

/** `fromMs` is the start of the first day, `toMs` the start of the day after the last day (so a window never includes a lead twice). */
export function parseWindow(from: unknown, to: unknown, now: number): { ok: true; win: Win } | { ok: false; error: string } {
  if (!valid(from) || !valid(to)) return { ok: false, error: "Pick a start and an end date." };
  if (from > to) return { ok: false, error: "The end date is before the start date." };
  if (to > localDay(now)) return { ok: false, error: "The end date is in the future." };
  const days = Math.round((dayMs(to) - dayMs(from)) / DAY) + 1;
  if (days > MAX_WINDOW_DAYS) return { ok: false, error: `A range can be at most ${MAX_WINDOW_DAYS} days.` };
  return { ok: true, win: { from, to, fromMs: dayMs(from), toMs: dayMs(to) + DAY, days } };
}

export const PARTS = ["summary", "source", "accounts", "people"] as const;
export type Part = (typeof PARTS)[number];
export const isPart = (v: unknown): v is Part => typeof v === "string" && (PARTS as readonly string[]).includes(v);
