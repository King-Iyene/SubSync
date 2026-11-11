// Lead journey (river view): pure geometry and particle sampling, no DOM. All river drawing happens in "abstract" coordinates: m runs along the river, c across it
// (cards above or to the right, drop-off labels below or to the left). Horizontal: x = m, y = c. Vertical (phones): x = width - c, y = m. Counts are never changed here.

export type GeoStep = { count: number; dropped: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Branch = { i: number; m0: number; c0: number; m1: number; c1: number; d: number };
export type Geo = {
  vertical: boolean; width: number; height: number; n: number; m: number[]; seg: number; rT: number; T: number; tipC: number;
  thick: number[]; cards: Rect[]; drops: Array<Rect | null>; branches: Array<Branch | null>; riverRect: Rect;
  leaders: Array<{ kind: "card" | "drop"; i: number; x0: number; y0: number; x1: number; y1: number }>;
  pt: (m: number, c: number) => { x: number; y: number }; toAbstract: (x: number, y: number) => { m: number; c: number };
};

export const CARD_H = 64, DROP_H = 44, ROW_GAP = 6;
export const BRANCH_START = 0.25, BRANCH_NARROW_END = 0.85;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export function thicknessAt(t0: number, t1: number, s: number) { return t0 + (t1 - t0) * smooth((s - BRANCH_START) / (BRANCH_NARROW_END - BRANCH_START)); }

export function journeyGeometry(steps: readonly GeoStep[], width: number, vertical = width < 520): Geo {
  const n = steps.length, W = Math.max(240, Math.round(width)), OFF = vertical ? 0 : 10;
  const c0 = Math.max(1, steps[0]?.count ?? 1);
  let seg: number, mStart: number, height: number, rT: number, T: number, tipC: number, CB: number, cardMc: number, cardCc: number, dropC: number, dropCc: number;
  if (vertical) {
    seg = 88; mStart = 40; height = mStart * 2 + (n - 1) * seg;
    CB = Math.round(W * 0.4); rT = CB + 18; T = Math.min(52, Math.round(W * 0.15)); tipC = rT + T + 30;
    cardMc = CARD_H; cardCc = CB; dropC = tipC + 8; dropCc = W - dropC;
  } else {
    const pad = 68; seg = (W - pad * 2) / Math.max(1, n - 1); mStart = pad;
    CB = OFF + CARD_H * 2 + ROW_GAP; rT = CB + 16; T = 96; tipC = rT + T + 56; dropC = tipC + 12;
    cardMc = Math.min(150, seg * 2 - 12); cardCc = CARD_H; dropCc = DROP_H;
    height = dropC + DROP_H * 2 + ROW_GAP + OFF;
  }
  const m = steps.map((_, i) => mStart + i * seg);
  const thick = steps.map((s) => (s.count > 0 ? Math.max(3, (s.count / c0) * T) : 0));
  const pt = (mm: number, cc: number) => (vertical ? { x: W - cc, y: mm } : { x: mm, y: cc });
  const toAbstract = (x: number, y: number) => (vertical ? { m: y, c: W - x } : { m: x, c: y });
  const rect = (m0: number, cc0: number, mc: number, cc: number): Rect => (vertical ? { x: W - cc0 - cc, y: m0, w: cc, h: mc } : { x: m0, y: cc0, w: mc, h: cc });
  const clampM = (v: number, mc: number) => (vertical ? v : Math.min(W - mc / 2 - 8, Math.max(mc / 2 + 8, v)));
  const cards = steps.map((_, i) => {
    const row = vertical ? 0 : i % 2;
    return rect(clampM(m[i], cardMc) - cardMc / 2, OFF + row * (CARD_H + ROW_GAP), cardMc, cardCc);
  });
  const branches: Array<Branch | null> = steps.map((s, i) => {
    if (i === 0 || s.dropped <= 0 || thick[i - 1] <= 0) return null;
    const d = Math.max(2.5, thick[i - 1] - thick[i]);
    return { i, m0: m[i - 1] + BRANCH_START * seg, c0: rT + thick[i - 1] - d / 2, m1: m[i - 1] + 0.85 * seg, c1: tipC, d };
  });
  const dropW = vertical ? 0 : Math.min(150, seg * 2 - 12);
  const drops = branches.map((b, i) => {
    if (!b) return null;
    const row = vertical ? 0 : i % 2;
    const mc = vertical ? DROP_H : dropW;
    const cm = clampM(b.m1, mc);
    return rect(cm - mc / 2, dropC + row * (DROP_H + ROW_GAP), mc, vertical ? dropCc : dropCc);
  });
  const leaders: Geo["leaders"] = [];
  steps.forEach((_, i) => {
    const card = cards[i], a = pt(m[i], rT);
    const cb = vertical ? { x: card.x, y: m[i] } : { x: m[i], y: card.y + card.h };
    leaders.push({ kind: "card", i, x0: cb.x, y0: cb.y, x1: a.x, y1: a.y });
  });
  drops.forEach((r, i) => {
    const b = branches[i]; if (!r || !b) return;
    const tip = pt(b.m1, b.c1);
    leaders.push({ kind: "drop", i, x0: tip.x, y0: tip.y, x1: vertical ? r.x + r.w : tip.x, y1: vertical ? tip.y : r.y });
  });
  const riverRect: Rect = vertical ? { x: W - tipC - 6, y: 0, w: tipC - rT + 12 + 0, h: height } : { x: 0, y: rT - 6, w: W, h: tipC - rT + 12 };
  if (vertical) { riverRect.x = W - (tipC + 6); riverRect.w = tipC + 6 - (rT - 6); }
  return { vertical, width: W, height, n, m, seg, rT, T, tipC, thick, cards, drops, branches, riverRect, leaders, pt, toAbstract };
}

/** Largest font size (px) at which `chars` digits fit `width` px, between min and max. */
export function fitFont(chars: number, width: number, max = 24, min = 11) { return Math.max(min, Math.min(max, Math.floor(width / (Math.max(1, chars) * 0.62)))); }

/** Whether two rects overlap (touching edges do not count). */
export function overlaps(a: Rect, b: Rect) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

export type Particle = { seg: number; lost: boolean; u: number; ph: number; j: number };
/** A sample of at most `cap` particles for the whole river. Each segment gets a share by how many leads enter it, and the lost share matches the drop-off. Counts stay exact elsewhere. */
export function sampleParticles(steps: readonly GeoStep[], cap = 300): Particle[] {
  const segs = steps.length - 1; if (segs < 1) return [];
  const w = Array.from({ length: segs }, (_, i) => Math.max(0, steps[i].count));
  const sum = w.reduce((a, b) => a + b, 0); if (sum <= 0) return [];
  const per = w.map((x) => (x > 0 ? Math.max(2, Math.floor((cap * x) / sum)) : 0));
  while (per.reduce((a, b) => a + b, 0) > cap) { const k = per.indexOf(Math.max(...per)); per[k] -= 1; }
  const out: Particle[] = []; let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  per.forEach((k, i) => {
    const frac = w[i] > 0 ? Math.max(0, steps[i + 1].dropped) / w[i] : 0;
    const lost = steps[i + 1].dropped > 0 ? Math.max(1, Math.round(k * frac)) : 0;
    for (let q = 0; q < k; q++) out.push({ seg: i, lost: q < Math.min(lost, k), u: rnd(), ph: rnd(), j: 0.8 + rnd() * 0.4 });
  });
  return out;
}

/** How long leads wait on a segment (seconds, or null) to a 0..1 warmth: 0 is cool and quick, 1 is warm and slow. */
export function warmth(sec: number | null) { return sec === null ? 0.25 : Math.min(1, Math.max(0, Math.log10(1 + sec / 60) / 3)); }
/** Flow speed multiplier from the same wait: quick replies flow fast. */
export function flowSpeed(sec: number | null) { return sec === null ? 0.7 : 1 / (1 + Math.log10(1 + sec / 60)); }
