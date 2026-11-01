// Small pure rules the shared components lean on (stage D0). Kept out of the components so each one is a plain, tested function.

export type ThemePref = "dark" | "light" | "system";
export const THEME_PREFS: ThemePref[] = ["dark", "light", "system"];
// The look people got before themes existed was dark, so that stays the default; "system" follows the device (N52).
export const DEFAULT_THEME: ThemePref = "dark";
export const isThemePref = (v: unknown): v is ThemePref => v === "dark" || v === "light" || v === "system";
export const resolveTheme = (pref: ThemePref, systemDark: boolean): "dark" | "light" => (pref === "system" ? (systemDark ? "dark" : "light") : pref);

// An error id a person can read out to support. It is made from the kind of error, the message and the minute it happened, so the same failure
// in the same minute has the same id, and support can match it to the time in the logs. "E-" plus six letters and digits.
export function errorId(status: number | null, message: string, atMs: number): string {
  let h = 0x811c9dc5;
  const text = `${status ?? "x"}|${message}|${Math.floor(atMs / 60_000)}`;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `E-${h.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

// ---- lists: ten rows and a way to see the rest (N14) ----
export const PREVIEW_ROWS = 10;
export const PAGE_SIZE = 25;
export type Paged<T> = { rows: T[]; page: number; pages: number; from: number; to: number; total: number };
export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): Paged<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: p, pages, from: total === 0 ? 0 : start + 1, to: Math.min(total, start + pageSize), total };
}

// ---- charts ----
// A chart under its minimum sample is replaced by one placeholder that says what will appear and when (N10, N23).
export function belowMinimum(n: number, min: number): boolean {
  return !Number.isFinite(n) || n < min;
}

// Round axis steps: 0 to a "nice" top (1, 2, 2.5 or 5 times a power of ten) in about `count` steps, so the scale reads like a person would draw it.
export function niceScale(max: number, count = 4): { top: number; step: number; ticks: number[] } {
  const m = Number.isFinite(max) && max > 0 ? max : 1;
  const rough = m / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
  return { top, step, ticks };
}

// Which numbers a lead's drawer can step through: the previous and next row of the list it was opened from, none past either end.
export function neighbours(index: number, length: number): { prev: number | null; next: number | null } {
  if (!Number.isInteger(index) || index < 0 || index >= length) return { prev: null, next: null };
  return { prev: index > 0 ? index - 1 : null, next: index < length - 1 ? index + 1 : null };
}

// How long someone has waited, in the shortest plain words: "20 min", "3 hours", "2 days". Never "13 d 0 h" (N30).
export function waitLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "unknown";
  const m = Math.round(minutes);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}
