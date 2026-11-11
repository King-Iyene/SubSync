// Geometry for the Money Flow pipe network (pure, so the labels can be proven never to overlap). Stages are pipe segments joined by valves;
// labels live in their own layer, each in a cell that cannot touch another. Horizontal on wide screens, vertical on phones.
import type { PlStage, PlDrain } from "../analytics/pipeline3-types-interim";

export type Rect = { x: number; y: number; w: number; h: number };
export type Tone = "green" | "amber" | "red" | "grey";
export const PIPE_PARTICLE_CAP = 300;
const M = 12, HEAD = 46, MAXT = 56, MINT = 14, MIN_COL = 76, ROW_V = 88, MAX_DRAINS = 8;

export type PipeLayout = {
  width: number; height: number; vertical: boolean; trunk: { x1: number; y1: number; x2: number; y2: number };
  segs: Array<Rect & { id: string; index: number; thick: number; tone: Tone; ratio: number | null; stalePart: number }>;
  valves: Array<{ x: number; y: number; r: number }>;
  gauges: Array<{ id: string; cx: number; cy: number; r: number; angle: number; tone: Tone }>;
  drips: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; width: number }>;
  trough: Rect; channel: Rect | null; vault: Rect; connector: Rect;
  /** Every label box, one layer: stage name/value, gauge words, drain reasons, vault. No two ever overlap. */
  labels: Array<{ id: string; kind: "stage" | "gauge" | "drain" | "vault"; rect: Rect }>;
  drainOrder: PlDrain[];
};

export const ratioOf = (s: Pick<PlStage, "medianDwellDays" | "normalDwellDays">): number | null => (s.medianDwellDays !== null && s.normalDwellDays && s.normalDwellDays > 0 ? s.medianDwellDays / s.normalDwellDays : null);
export const toneOf = (r: number | null): Tone => (r === null ? "grey" : r <= 1.25 ? "green" : r <= 1.75 ? "amber" : "red");
export const gaugeAngle = (r: number | null): number => -90 + Math.max(0, Math.min(1, (r ?? 0) / 2.5)) * 180;
/** Coins move slower where deals sit longer than normal (clamped so nothing freezes or races). */
export const speedFor = (r: number | null): number => (r === null ? 1 : Math.max(0.25, Math.min(1.6, 1 / Math.max(r, 0.01))));

/** Largest-remainder split of a coin budget by value; a stream with money gets at least one coin while the budget allows, and the total never passes the cap. */
export function allocateParticles(weights: number[], budget = PIPE_PARTICLE_CAP): number[] {
  const w = weights.map((x) => (x > 0 && Number.isFinite(x) ? x : 0)), sum = w.reduce((a, b) => a + b, 0), out = w.map(() => 0);
  if (sum === 0 || budget <= 0) return out;
  const live = w.filter((x) => x > 0).length;
  let left = budget;
  if (live <= budget) w.forEach((x, i) => { if (x > 0) { out[i] = 1; left--; } });
  const raw = w.map((x) => (x / sum) * left), floor = raw.map(Math.floor);
  floor.forEach((f, i) => { out[i] += f; });
  let rest = left - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (rest <= 0) break; if (w[i] > 0) { out[i]++; rest--; } }
  return out;
}

const chipW = (text: string) => Math.max(96, Math.min(210, text.length * 7 + 34));
/** Lay reason chips left to right, wrapping to the next row, so they cannot collide. */
function flowChips(drains: PlDrain[], x0: number, y0: number, maxW: number, h = 24, gap = 6): { rects: Array<Rect & { reason: string }>; bottom: number } {
  let x = x0, y = y0; const rects: Array<Rect & { reason: string }> = [];
  for (const d of drains) {
    const w = Math.min(chipW(`${d.reason} ${d.count}`), maxW);
    if (x > x0 && x + w > x0 + maxW) { x = x0; y += h + gap; }
    rects.push({ x, y, w, h, reason: d.reason }); x += w + gap;
  }
  return { rects, bottom: rects.length ? y + h : y0 };
}

export function layoutPipes(stages: PlStage[], drainsIn: PlDrain[], opts: { width: number; vertical?: boolean }): PipeLayout {
  const width = Math.max(300, Math.round(opts.width)), n = Math.max(1, stages.length);
  const vmax = Math.max(1, ...stages.map((s) => s.valueCents));
  const vaultW = width >= 900 ? 124 : 100, areaW = width - 2 * M - vaultW - 16, colW = Math.floor(areaW / n);
  const vertical = opts.vertical ?? colW < MIN_COL;
  const drains = [...drainsIn].sort((a, b) => b.valueCents - a.valueCents).slice(0, MAX_DRAINS);
  const labels: PipeLayout["labels"] = [], segs: PipeLayout["segs"] = [], valves: PipeLayout["valves"] = [], gauges: PipeLayout["gauges"] = [], drips: PipeLayout["drips"] = [];
  const lostMax = Math.max(1, ...stages.map((s) => s.lostValueCents));
  const thick = (v: number, max: number) => MINT + (MAXT - MINT) * Math.sqrt(Math.max(0, v) / max);
  const mk = (s: PlStage, i: number, r: Rect, t: number) => {
    const ratio = ratioOf(s), stalePart = s.count > 0 ? s.staleCount / s.count : 0;
    segs.push({ ...r, id: s.id, index: i, thick: t, tone: toneOf(ratio), ratio, stalePart });
  };

  if (!vertical) {
    const trunkY = M + HEAD + 10 + MAXT / 2, gaugeTop = M + HEAD + 10 + MAXT + 12;
    stages.forEach((s, i) => {
      const colX = M + i * colW, t = thick(s.valueCents, vmax);
      mk(s, i, { x: colX + 6, y: trunkY - t / 2, w: colW - 12, h: t }, t);
      labels.push({ id: `stage:${s.id}`, kind: "stage", rect: { x: colX + 3, y: M, w: colW - 6, h: HEAD } });
      const cx = colX + colW * 0.36, ratio = ratioOf(s);
      gauges.push({ id: s.id, cx, cy: gaugeTop + 16, r: 14, angle: gaugeAngle(ratio), tone: toneOf(ratio) });
      labels.push({ id: `gauge:${s.id}`, kind: "gauge", rect: { x: colX + 3, y: gaugeTop + 34, w: colW - 6, h: 18 } });
      if (i > 0) valves.push({ x: colX, y: trunkY, r: 9 });
      if (s.lostValueCents > 0) { const dx = colX + colW - 12, w = 2 + 8 * Math.sqrt(s.lostValueCents / lostMax); drips.push({ id: s.id, x1: dx, y1: trunkY + t / 2, x2: dx, y2: gaugeTop + 66, width: w }); }
    });
    const troughY = gaugeTop + 66, trough = { x: M, y: troughY, w: areaW, h: 30 };
    const { rects, bottom } = flowChips(drains, M, troughY + 38, areaW);
    rects.forEach((r) => labels.push({ id: `drain:${r.reason}`, kind: "drain", rect: { x: r.x, y: r.y, w: r.w, h: r.h } }));
    const vault = { x: width - M - vaultW, y: M + HEAD, w: vaultW, h: troughY + 30 - (M + HEAD) };
    const vl = { x: vault.x, y: vault.y + vault.h + 8, w: vaultW, h: 46 };
    labels.push({ id: "vault", kind: "vault", rect: vl });
    const lastEnd = M + n * colW - 6;
    return { width, height: Math.max(bottom, vl.y + vl.h) + M, vertical, trunk: { x1: M, y1: trunkY, x2: vault.x, y2: trunkY }, segs, valves: [...valves, { x: lastEnd + 6, y: trunkY, r: 9 }], gauges, drips, trough, channel: null, vault, connector: { x: lastEnd, y: trunkY - 7, w: vault.x - lastEnd, h: 14 }, labels, drainOrder: drains };
  }

  // Vertical (phone): a pipe column with a drain channel beside it, labels to the right, then the vault, the trough and the reason chips.
  const cx = M + 66, chan = { x: M + 6, y: M, w: 14, h: n * ROW_V }, labX = cx + MAXT / 2 + 12, labW = width - M - labX;
  stages.forEach((s, i) => {
    const rowY = M + i * ROW_V, t = thick(s.valueCents, vmax);
    mk(s, i, { x: cx - t / 2, y: rowY + 6, w: t, h: ROW_V - 12 }, t);
    labels.push({ id: `stage:${s.id}`, kind: "stage", rect: { x: labX, y: rowY + 4, w: labW, h: 44 } });
    const ratio = ratioOf(s);
    gauges.push({ id: s.id, cx: labX + 14, cy: rowY + 66, r: 13, angle: gaugeAngle(ratio), tone: toneOf(ratio) });
    labels.push({ id: `gauge:${s.id}`, kind: "gauge", rect: { x: labX + 34, y: rowY + 56, w: labW - 34, h: 20 } });
    if (i > 0) valves.push({ x: cx, y: rowY, r: 9 });
    if (s.lostValueCents > 0) { const w = 2 + 6 * Math.sqrt(s.lostValueCents / lostMax); drips.push({ id: s.id, x1: cx - t / 2, y1: rowY + ROW_V / 2, x2: chan.x + chan.w / 2, y2: rowY + ROW_V / 2, width: w }); }
  });
  const stagesBottom = M + n * ROW_V, vault = { x: M + 40, y: stagesBottom + 14, w: width - 2 * M - 40, h: 58 };
  const vl = { x: vault.x, y: vault.y + vault.h + 8, w: vault.w, h: 40 };
  labels.push({ id: "vault", kind: "vault", rect: vl });
  const trough = { x: M, y: vl.y + vl.h + 14, w: width - 2 * M, h: 28 };
  const { rects, bottom } = flowChips(drains, M, trough.y + 36, width - 2 * M);
  rects.forEach((r) => labels.push({ id: `drain:${r.reason}`, kind: "drain", rect: { x: r.x, y: r.y, w: r.w, h: r.h } }));
  chan.h = trough.y - M;
  return { width, height: Math.max(bottom, trough.y + trough.h) + M, vertical, trunk: { x1: cx, y1: M, x2: cx, y2: vault.y }, segs, valves, gauges, drips, trough, channel: chan, vault, connector: { x: cx - 7, y: stagesBottom - 6, w: 14, h: vault.y - stagesBottom + 6 }, labels, drainOrder: drains };
}
