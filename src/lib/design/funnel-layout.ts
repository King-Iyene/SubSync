// Stage FUNNEL geometry for the Pipeline money view. Pure and unit-tested. Widths are percentages of the funnel (50 = centre line), so the picture scales with no measuring.
// Band width = the money open in that stage. Conversion between two stages = money that reached the next step / money that reached this step (estimate: open + lost + won from here on).

export type FunnelIn = { id: string; name: string; valueCents: number; count: number; staleCount: number; staleValueCents: number; lostValueCents: number };
export type FunnelRow = {
  id: string; name: string; valueCents: number; count: number; staleCount: number;
  topW: number; bottomW: number;       // band width at its top and bottom edge, in % of the funnel
  stuckFrac: number;                   // 0..1, the hatched share of the band height (from the bottom)
  conv: number | null;                 // share that reached the next step (0..1), null when nothing reached this one
  reachCents: number;                  // money that reached this stage
  dropCents: number;                   // money that left between this stage and the next (lost here)
  drops: number;                       // number of falling drops to draw (0 when no money)
};
export type FunnelLayout = { rows: FunnelRow[]; wonW: number; wonConv: number | null; leakIndex: number | null };

const MIN_W = 10, MAX_DROPS = 7;

/** One drop per ~12% of the biggest stage, at least 1 when the stage has money. */
export function funnelLayout(stages: FunnelIn[], wonCents: number): FunnelLayout {
  const max = Math.max(1, wonCents, ...stages.map((s) => s.valueCents));
  const w = (v: number) => (v <= 0 ? 0 : Math.max(MIN_W, Math.round((v / max) * 1000) / 10));
  const n = stages.length;
  const reach: number[] = new Array(n + 1).fill(0); reach[n] = wonCents;
  for (let i = n - 1; i >= 0; i--) reach[i] = reach[i + 1] + stages[i].valueCents + stages[i].lostValueCents;
  let leakIndex: number | null = null, worst = 0;
  const rows = stages.map((s, i): FunnelRow => {
    const next = i + 1 < n ? w(stages[i + 1].valueCents) : w(wonCents);
    const topW = w(s.valueCents);
    const drop = Math.max(0, reach[i] - reach[i + 1] - s.valueCents);
    if (s.lostValueCents > worst) { worst = s.lostValueCents; leakIndex = i; }
    const stuck = s.valueCents > 0 ? Math.min(1, s.staleValueCents / s.valueCents) : 0;
    return { id: s.id, name: s.name, valueCents: s.valueCents, count: s.count, staleCount: s.staleCount, topW, bottomW: next > 0 ? next : Math.max(MIN_W / 2, topW * 0.6), stuckFrac: s.staleCount > 0 ? Math.max(0.14, stuck) : 0, conv: reach[i] > 0 ? reach[i + 1] / reach[i] : null, reachCents: reach[i], dropCents: Math.max(drop, s.lostValueCents), drops: s.valueCents > 0 ? Math.max(1, Math.min(MAX_DROPS, Math.round((s.valueCents / max) * MAX_DROPS))) : 0 };
  });
  return { rows, wonW: w(wonCents), wonConv: n && reach[n - 1] > 0 ? wonCents / reach[n - 1] : null, leakIndex };
}

/** Width of a band at height fraction t (0 top, 1 bottom). */
export const bandWidthAt = (r: Pick<FunnelRow, "topW" | "bottomW">, t: number): number => r.topW + (r.bottomW - r.topW) * t;
