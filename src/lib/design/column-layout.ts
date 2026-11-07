// The maths behind the shared column chart (one vertical column per client / account / person). Pure, so it is unit-tested for 1, 8, 100 and 200 items.
// Column width and gap shrink with the count so everything fits the width; past the smallest readable column the chart scrolls sideways instead.

export const MIN_COL = 3;
export const MAX_COL = 64;

export type ColumnLayout = {
  count: number; colWidth: number; gap: number;
  /** Pixel width of all columns together; wider than the container means the chart scrolls (or is brushed). */
  contentWidth: number; scrolls: boolean;
  /** How many columns (from the top of the sorted order) carry a printed label; the rest are labelled on hover or focus. */
  labelled: number;
  /** Rotate the printed labels when a slot is too narrow for horizontal text. */
  rotate: boolean;
};

export function gapFor(colWidth: number): number { return colWidth >= 20 ? 6 : colWidth >= 10 ? 3 : colWidth >= 5 ? 2 : 1; }

export function columnLayout(count: number, width: number, opts: { minCol?: number; maxCol?: number; topLabels?: number } = {}): ColumnLayout {
  const minCol = opts.minCol ?? MIN_COL, maxCol = opts.maxCol ?? MAX_COL, topLabels = opts.topLabels ?? 12;
  const n = Math.max(0, Math.floor(count)), w = Math.max(1, width);
  if (n === 0) return { count: 0, colWidth: 0, gap: 0, contentWidth: 0, scrolls: false, labelled: 0, rotate: false };
  // Largest column such that n columns and n-1 gaps fit; the gap depends on the column, so settle it by trying from wide to narrow.
  let col = Math.min(maxCol, w);
  for (; col > minCol; col -= 0.5) { if (n * col + (n - 1) * gapFor(col) <= w) break; }
  col = Math.max(minCol, col);
  const gap = gapFor(col);
  const contentWidth = Math.ceil(n * col + (n - 1) * gap);
  const slot = col + gap;
  const labelled = slot >= 56 ? n : Math.min(n, topLabels);
  return { count: n, colWidth: col, gap, contentWidth, scrolls: contentWidth > w + 0.5, labelled, rotate: slot < 56 && slot >= 14 ? true : slot < 14 };
}

/** Sort biggest first (ties by label, so the order is stable) and keep the first `limit` (null = all). */
export function topColumns<T extends { label: string; total: number }>(items: T[], limit: number | null): { shown: T[]; hidden: number } {
  const sorted = [...items].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const shown = limit === null ? sorted : sorted.slice(0, limit);
  return { shown, hidden: sorted.length - shown.length };
}

/** For line and area charts with many series: the `keep` biggest series by their total, and one "Other" series that is the sum of the rest, point by point. */
export function topSeriesWithOther<S extends { label: string; points: Array<{ day: string; value: number | null }> }>(series: S[], keep = 5): { shown: S[]; other: { label: string; count: number; points: Array<{ day: string; value: number | null }> } | null } {
  const weight = (s: S) => s.points.reduce((t, p) => t + (p.value ?? 0), 0);
  if (series.length <= keep + 1) return { shown: series, other: null };
  const sorted = [...series].sort((a, b) => weight(b) - weight(a) || a.label.localeCompare(b.label));
  const rest = sorted.slice(keep);
  const byDay = new Map<string, number | null>();
  for (const s of rest) for (const p of s.points) byDay.set(p.day, p.value === null ? (byDay.get(p.day) ?? null) : (byDay.get(p.day) ?? 0) + p.value);
  return { shown: sorted.slice(0, keep), other: { label: `Other (${rest.length})`, count: rest.length, points: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value })) } };
}
