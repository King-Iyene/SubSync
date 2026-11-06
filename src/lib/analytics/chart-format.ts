// Number and axis formatting for Today's cards and charts. Pure, unit tested (src/lib/__tests__/chart-format.test.ts).
// A card shows the full number up to 999,999 and a short one (1.2M) beyond; the full value is always in the tooltip. An axis shows 12k, never 12000.

const trim = (n: number, digits: number) => { const s = n.toFixed(digits); return digits > 0 ? s.replace(/\.0+$/, "") : s; };

/** 1,234 stays whole up to 999,999; beyond that 1.2M, 12.3M, 123M, 1.2B. */
export function fmtStat(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a < 1_000_000) return Math.round(n).toLocaleString("en-US");
  if (a < 1_000_000_000) return `${sign}${trim(a / 1e6, a < 100_000_000 ? 1 : 0)}M`;
  return `${sign}${trim(a / 1e9, a < 10e9 ? 1 : 0)}B`;
}
export const fmtStatMoney = (n: number) => `${n < 0 ? "-" : ""}$${fmtStat(Math.abs(n))}`;
/** The full number, for a tooltip. */
export const fmtFull = (n: number) => Math.round(n).toLocaleString("en-US");

/** An axis label: 0, 250, 1.2k, 12k, 1.5M. */
export function fmtAxis(n: number): string {
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  if (a < 10_000) return `${trim(n / 1e3, 1)}k`;
  if (a < 1_000_000) return `${trim(n / 1e3, 0)}k`;
  if (a < 10_000_000) return `${trim(n / 1e6, 1)}M`;
  return `${trim(n / 1e6, 0)}M`;
}

/** Evenly spaced round ticks from 0 up to at least `max` (about `count` of them): 0, 5, 10, 15, 20 or 0, 4k, 8k, 12k. */
export function niceTicks(max: number, count = 4): number[] {
  const m = Math.max(1, Number.isFinite(max) ? max : 1);
  const raw = m / count, mag = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) as number;
  const s = m <= 4 ? 1 : Math.max(1, nice); // tiny counts: one tick per whole number
  const top = Math.ceil(m / s) * s;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += s) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Which of `n` labels to draw so at most `maxLabels` show, evenly spaced, first and last included and never touching. */
export function thinLabels(n: number, maxLabels: number): number[] {
  if (n <= 0) return [];
  if (maxLabels < 2) return [0];
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (maxLabels - 1));
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  const last = n - 1;
  if (idx[idx.length - 1] !== last) { if (last - idx[idx.length - 1] < step * 0.6) idx[idx.length - 1] = last; else idx.push(last); }
  return idx;
}

/** A short day label that fits the range and always names the month: "Mon 3 Nov" for two weeks or less, "3 Nov" for about four months, "Nov 2026" beyond. */
export function dayLabel(day: string, rangeDays: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (rangeDays <= 120) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The friendly full date for a tooltip: "Fri 30 Oct 2026". Takes "2026-10-30"; anything else comes back unchanged. */
export function fullDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");
}

/** A smooth line through the points that never overshoots them (monotone cubic): a flat stretch stays flat, a peak is never drawn higher than the data. */
export function monotonePath(pts: ReadonlyArray<readonly [number, number]>): string {
  const n = pts.length;
  const f = (v: number) => Math.round(v * 100) / 100;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0][0])},${f(pts[0][1])}`;
  if (n === 2) return `M${f(pts[0][0])},${f(pts[0][1])}L${f(pts[1][0])},${f(pts[1][1])}`;
  const dx: number[] = [], m: number[] = [], t: number[] = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1)); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}
