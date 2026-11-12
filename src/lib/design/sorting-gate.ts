// SORTING GATE layout (pure, no DOM). Leads stream in from their sources (one lane per source, the stream's thickness = how many leads it carries), pass one gate, and are sorted:
// duplicates are pulled up into a merge circle (several copies become one record), junk drops into a bin, clean leads flow on. Text lives in its own zones so labels never touch the streams.
// Deterministic: no random numbers, so the picture and its tests are the same every time. A different structure from the river, the tree and the coin stacks on purpose.

export type Rect = { x: number; y: number; w: number; h: number };
export type GateLaneIn = { key: string; label: string; leads: number; dups: number; junk: number };
export type GateIn = { lanes: GateLaneIn[]; groups: number };
export type GateLane = { key: string; label: string; leads: number; dups: number; junk: number; clean: number; row: Rect; labelBox: Rect; stream: Rect; other: boolean };
export type DotKind = "clean" | "dup" | "junk";
export type GateDot = { lane: string; kind: DotKind; d: string; begin: number; dur: number; r: number };
export type GateLayout = {
  width: number; height: number; vertical: boolean; lanes: GateLane[]; gate: Rect;
  outs: { merge: Rect; clean: Rect; bin: Rect }; mergeCenter: { x: number; y: number; r: number };
  dots: GateDot[]; totals: { leads: number; dups: number; junk: number; clean: number }; maxLanes: number;
};

export const MAX_LANES = 7;
export const MAX_DOTS_PER_LANE = 14;
const PAD = 16, ROW_H = 34, LABEL_W = 150, OUT_W = 176, GATE_W = 12, HEAD = 22;

/** The share of `total` dots each part gets, largest remainder, so the parts always add up to the total. */
export function shareDots(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

/** Keeps the biggest MAX_LANES - 1 sources and adds the rest into one "Other sources" lane, so the picture never grows past MAX_LANES and the counts still add up. */
export function foldLanes(lanes: readonly GateLaneIn[], max = MAX_LANES): Array<GateLaneIn & { other: boolean }> {
  const sorted = [...lanes].filter((l) => l.leads > 0).sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
  if (sorted.length <= max) return sorted.map((l) => ({ ...l, other: false }));
  const head = sorted.slice(0, max - 1), rest = sorted.slice(max - 1);
  return [...head.map((l) => ({ ...l, other: false })), { key: "(other)", label: "Other sources", leads: rest.reduce((s, l) => s + l.leads, 0), dups: rest.reduce((s, l) => s + l.dups, 0), junk: rest.reduce((s, l) => s + l.junk, 0), other: true }];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function layoutGate(input: GateIn, opts: { width: number; compact?: boolean }): GateLayout {
  const width = Math.max(300, Math.floor(opts.width)), vertical = width < 640, compact = opts.compact === true;
  const lanesIn = foldLanes(input.lanes, compact ? 3 : MAX_LANES);
  const rowH = compact ? 24 : ROW_H;
  const maxLeads = Math.max(1, ...lanesIn.map((l) => l.leads));
  const thick = (leads: number) => r1(5 + (rowH - 10) * (leads / maxLeads));
  const totals = lanesIn.reduce((t, l) => ({ leads: t.leads + l.leads, dups: t.dups + l.dups, junk: t.junk + l.junk, clean: t.clean }), { leads: 0, dups: 0, junk: 0, clean: 0 });
  totals.clean = Math.max(0, totals.leads - totals.dups - totals.junk);
  const n = lanesIn.length;

  if (vertical) {
    // Phone: lanes are rows (the label on top, the stream below), then the gate as a bar, then the three outputs side by side. The dots are left out (the static picture says the same).
    const lanes: GateLane[] = []; let y = PAD;
    const rh = 36;
    lanesIn.forEach((l) => {
      const t = Math.min(14, thick(l.leads) * 0.55 + 3);
      const row = { x: PAD, y, w: width - PAD * 2, h: rh };
      lanes.push({ ...l, clean: Math.max(0, l.leads - l.dups - l.junk), row, labelBox: { x: PAD, y, w: width - PAD * 2, h: 16 }, stream: { x: PAD, y: y + 18 + (14 - t) / 2, w: width - PAD * 2, h: r1(t) }, other: l.other });
      y += rh + 6;
    });
    const gate = { x: PAD, y: y + 2, w: width - PAD * 2, h: GATE_W };
    const oy = gate.y + GATE_W + 10, ow = Math.floor((width - PAD * 2 - 16) / 3), oh = 64;
    const outs = { merge: { x: PAD, y: oy, w: ow, h: oh }, clean: { x: PAD + ow + 8, y: oy, w: ow, h: oh }, bin: { x: PAD + (ow + 8) * 2, y: oy, w: ow, h: oh } };
    return { width, height: oy + oh + PAD, vertical, lanes, gate, outs, mergeCenter: { x: outs.merge.x + 22, y: oy + 32, r: 14 }, dots: [], totals, maxLanes: MAX_LANES };
  }

  const top = PAD + HEAD, gateX = Math.round(width - PAD - OUT_W - 70 - GATE_W), streamX0 = PAD + LABEL_W + 8;
  const bodyH = Math.max(n, 1) * rowH, height = top + Math.max(bodyH, compact ? 96 : 190) + PAD;
  const offY = (height - top - PAD - bodyH) / 2 + top;
  const lanes: GateLane[] = lanesIn.map((l, i) => {
    const y = offY + i * rowH, t = thick(l.leads);
    return { ...l, clean: Math.max(0, l.leads - l.dups - l.junk), row: { x: PAD, y, w: gateX - PAD, h: rowH }, labelBox: { x: PAD, y, w: LABEL_W, h: rowH }, stream: { x: streamX0, y: r1(y + (rowH - t) / 2), w: gateX - streamX0, h: t }, other: l.other };
  });
  const gate: Rect = { x: gateX, y: top, w: GATE_W, h: height - top - PAD };
  const ox = width - PAD - OUT_W, third = (gate.h - 16) / 3;
  const outs = { merge: { x: ox, y: top, w: OUT_W, h: r1(third) }, clean: { x: ox, y: r1(top + third + 8), w: OUT_W, h: r1(third) }, bin: { x: ox, y: r1(top + (third + 8) * 2), w: OUT_W, h: r1(third) } };
  const mergeCenter = { x: ox + 26, y: r1(outs.merge.y + outs.merge.h / 2), r: compact ? 11 : 15 };
  const cleanPt = { x: ox + 4, y: outs.clean.y + outs.clean.h / 2 }, binPt = { x: ox + 26, y: outs.bin.y + outs.bin.h / 2 };

  const dots: GateDot[] = [];
  lanes.forEach((l, li) => {
    const cnt = Math.min(MAX_DOTS_PER_LANE, Math.max(3, Math.round(MAX_DOTS_PER_LANE * (l.leads / maxLeads))));
    const [dup, junk, clean] = shareDots(cnt, [l.dups, l.junk, l.clean]);
    // Interleave the kinds (error diffusion) so a lane's dots look mixed, not sorted.
    const want = { dup, junk, clean } as Record<DotKind, number>, got: Record<DotKind, number> = { dup: 0, junk: 0, clean: 0 };
    const y = l.stream.y + l.stream.h / 2;
    for (let i = 0; i < cnt; i++) {
      let kind = "clean" as DotKind, best = -Infinity;
      (["clean", "dup", "junk"] as const).forEach((k) => { const score = want[k] === 0 ? -Infinity : (want[k] * (i + 1)) / cnt - got[k]; if (score > best) { best = score; kind = k; } });
      got[kind]++;
      const x0 = l.stream.x + 2;
      const d = kind === "dup" ? `M${x0},${r1(y)} L${gateX - 4},${r1(y)} C${gateX + 26},${r1(y)} ${mergeCenter.x - 40},${r1(mergeCenter.y)} ${mergeCenter.x - 2},${r1(mergeCenter.y)}`
        : kind === "junk" ? `M${x0},${r1(y)} L${gateX - 4},${r1(y)} C${gateX + 26},${r1(y)} ${binPt.x - 40},${r1(binPt.y - 6)} ${binPt.x},${r1(binPt.y)}`
        : `M${x0},${r1(y)} L${gateX - 4},${r1(y)} C${gateX + 30},${r1(y)} ${cleanPt.x - 36},${r1(cleanPt.y)} ${cleanPt.x},${r1(cleanPt.y)}`;
      dots.push({ lane: l.key, kind, d, begin: r1(((i * 0.62 + li * 0.37) % 5.6)), dur: kind === "clean" ? 4.6 : 4.2, r: compact ? 2.4 : 3.2 });
    }
  });
  return { width, height, vertical, lanes, gate, outs, mergeCenter, dots, totals, maxLanes: MAX_LANES };
}
