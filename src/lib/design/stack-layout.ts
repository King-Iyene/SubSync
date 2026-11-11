// COIN STACKS layout (pure, no DOM). One column per stage in the account's own order, then Won, then Lost. Each column is a stack of flat coins; one coin = one value step.
// The step is chosen (1-2-5 sequence) so the tallest stack never passes STACK_COIN_CAP coins, even for 100k deals. Text lives in its own zone, so labels never touch coins.
export const STACK_COIN_CAP = 40;
export type Rect = { x: number; y: number; w: number; h: number };
export type StackIn = { id: string; name: string; valueCents: number; count: number; staleCount: number; staleValueCents: number };
export type DrainIn = { reason: string; count: number; valueCents: number };
export type Coin = { x: number; y: number; w: number; h: number; kind: "open" | "stuck" | "won" | "lost"; seg: number };
export type StackCol = { id: string; kind: "stage" | "won" | "lost"; name: string; valueCents: number; count: number; stuckCount: number; stuckCoins: number; coins: Coin[]; stack: Rect; label: Rect; stuckRect: Rect | null; openRect: Rect | null; segs: Array<{ reason: string; rect: Rect }> };
export type StackLayout = { width: number; height: number; vertical: boolean; step: number; cols: StackCol[]; coinMax: number };

export function coinStep(maxCents: number, cap = STACK_COIN_CAP): number {
  const need = Math.max(1, maxCents / cap); // cents per coin, at least
  const e = Math.pow(10, Math.floor(Math.log10(need)));
  for (const m of [1, 2, 5, 10]) if (m * e >= need) return Math.max(100, m * e);
  return 10 * e;
}
export const coinsFor = (cents: number, step: number): number => (cents > 0 ? Math.max(1, Math.round(cents / step)) : 0);
/** Share `total` coins across weights, largest remainder, so the parts always add up to the total. */
export function shareCoins(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0); if (!sum || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

const PITCH = 7, COIN_H = 5.5, LABEL_H = 78;
export function layoutStacks(stages: StackIn[], wonCents: number, wonCount: number, drains: DrainIn[], opts: { width: number }): StackLayout {
  const lostCents = drains.reduce((a, d) => a + d.valueCents, 0), lostCount = drains.reduce((a, d) => a + d.count, 0);
  const max = Math.max(1, ...stages.map((s) => s.valueCents), wonCents, lostCents), step = coinStep(max);
  const items: Array<{ id: string; kind: StackCol["kind"]; name: string; cents: number; count: number; stuck: number; stuckCents: number }> = [
    ...stages.map((s) => ({ id: s.id, kind: "stage" as const, name: s.name, cents: s.valueCents, count: s.count, stuck: s.staleCount, stuckCents: s.staleValueCents })),
    { id: "won", kind: "won", name: "Won", cents: wonCents, count: wonCount, stuck: 0, stuckCents: 0 },
    { id: "lost", kind: "lost", name: "Lost", cents: lostCents, count: lostCount, stuck: 0, stuckCents: 0 },
  ];
  const width = Math.max(300, Math.floor(opts.width)), vertical = width < 640, coinMax = Math.max(...items.map((i) => coinsFor(i.cents, step)));
  const cols: StackCol[] = [];
  const build = (it: (typeof items)[number], stack: Rect, label: Rect): StackCol => {
    const n = coinsFor(it.cents, step), stuckN = it.kind === "stage" && n > 0 && it.stuck > 0 ? Math.min(n, Math.max(1, Math.round(it.stuckCents / step))) : 0;
    const wts = it.kind === "lost" ? shareCoins(n, drains.map((d) => d.valueCents)) : [];
    const segOf: number[] = []; wts.forEach((k, si) => { for (let j = 0; j < k; j++) segOf.push(si); });
    const cw = vertical ? PITCH : Math.min(stack.w, 64);
    const coins: Coin[] = [];
    for (let i = 0; i < n; i++) {
      const kind: Coin["kind"] = it.kind === "won" ? "won" : it.kind === "lost" ? "lost" : i >= n - stuckN ? "stuck" : "open";
      coins.push(vertical ? { x: stack.x + i * PITCH, y: stack.y, w: COIN_H, h: stack.h, kind, seg: segOf[i] ?? -1 } : { x: stack.x + (stack.w - cw) / 2, y: stack.y + stack.h - (i + 1) * PITCH + (PITCH - COIN_H), w: cw, h: COIN_H, kind, seg: segOf[i] ?? -1 });
    }
    const span = (a: number, b: number): Rect | null => (b <= a ? null : vertical ? { x: stack.x + a * PITCH, y: stack.y, w: (b - a) * PITCH, h: stack.h } : { x: stack.x, y: stack.y + stack.h - b * PITCH, w: stack.w, h: (b - a) * PITCH });
    const segs: StackCol["segs"] = []; let at = 0;
    wts.forEach((k, si) => { const r = span(at, at + k); if (r && drains[si]) segs.push({ reason: drains[si].reason, rect: r }); at += k; });
    return { id: it.id, kind: it.kind, name: it.name, valueCents: it.cents, count: it.count, stuckCount: it.stuck, stuckCoins: stuckN, coins, stack, label, stuckRect: span(n - stuckN, n), openRect: span(0, n - stuckN), segs };
  };
  if (vertical) {
    // phone: a vertical list. Each row = its text on top, its coins in a line below. Rows never overlap.
    const rowH = 30 + 18 + 10, pad = 12; let y = pad;
    items.forEach((it) => { cols.push(build(it, { x: pad, y: y + 34, w: width - pad * 2, h: 14 }, { x: pad, y, w: width - pad * 2, h: 32 })); y += rowH; });
    return { width, height: y + pad - 10, vertical, step, cols, coinMax };
  }
  const pad = 16, gap = 10, n = items.length, extra = 18, colW = Math.floor((width - pad * 2 - gap * (n - 1) - extra) / n), stackH = Math.max(120, STACK_COIN_CAP * PITCH + 6);
  let x = pad;
  items.forEach((it, i) => { if (it.kind === "lost" && i > 0) x += extra; cols.push(build(it, { x, y: 8, w: colW, h: stackH }, { x, y: 8 + stackH + 8, w: colW, h: LABEL_H })); x += colW + gap; });
  return { width, height: 8 + stackH + 8 + LABEL_H + 4, vertical, step, cols, coinMax };
}
