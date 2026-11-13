// REPLAY FRAME BUILDER for the Pipeline river. Pure and unit-tested. It turns our own recorded day-by-day stage history into frames the river can draw:
// what each pile held at the end of that day, what was won and lost so far in the window, and which deals moved that day (so cards can slide between piles).
// It never invents movement: a window with no recorded move gives no frames to play (hasMovement is false) and the screen says so.
import type { PlReplayDay, PlStage } from "../analytics/pipeline3-types-interim";

export type ReplayMover = { from: number | null; to: number | "won" | "lost"; n: number };
export type ReplayFrame = {
  index: number; date: string;
  stages: PlStage[];
  wonCount: number; wonCents: number; lostCount: number; lostCents: number;
  /** Deals that moved on this day, for the sliding cards (money view leaves out the ones with no value). */
  movers: ReplayMover[];
  /** How many deals moved, won or were lost this day (0 = a quiet day). */
  activity: number;
};

/** True when at least one day in the window recorded a stage move, a win or a loss. */
export function replayHasMovement(days: PlReplayDay[] | null | undefined): boolean {
  return !!days && days.some((d) => (d.moves?.length ?? 0) > 0 || (d.wonCount ?? 0) > 0 || (d.lostCount ?? 0) > 0);
}

/** Total flying cards allowed on one day, so a big day stays readable. Splits the budget across moves in proportion, at least 1 each, and never exceeds `cap` (extra small moves are dropped). */
export function flyerPlan(moves: ReplayMover[], cap = 14): ReplayMover[] {
  const live = moves.filter((m) => m.n > 0).sort((a, b) => b.n - a.n);
  if (!live.length) return [];
  const total = live.reduce((t, m) => t + m.n, 0);
  if (total <= cap) return live;
  const out: ReplayMover[] = [];
  let left = cap;
  for (const m of live) {
    if (left <= 0) break;
    const n = Math.max(1, Math.min(left, Math.round((m.n / total) * cap)));
    out.push({ ...m, n }); left -= n;
  }
  return out;
}

/**
 * Frames, one per day, oldest first. `base` is the stage list the river already shows (names, order, dwell); each frame overrides the open counts and money.
 * Won and lost add up from the first day of the window. The stuck marks are cleared (we do not record "stuck" day by day).
 */
export function buildReplayFrames(days: PlReplayDay[], base: PlStage[], counts: boolean): ReplayFrame[] {
  let wonN = 0, wonC = 0, lostN = 0, lostC = 0;
  const lostBy = base.map(() => ({ n: 0, c: 0 }));
  return days.map((d, index) => {
    const mv: ReplayMover[] = [];
    for (const m of d.moves ?? []) {
      if (!counts && m.valueCents <= 0) continue;
      if (m.status === "won") { wonN += m.count; wonC += m.valueCents; mv.push({ from: m.from, to: "won", n: m.count }); }
      else if (m.status === "lost") {
        lostN += m.count; lostC += m.valueCents;
        if (m.from !== null && lostBy[m.from]) { lostBy[m.from].n += m.count; lostBy[m.from].c += m.valueCents; }
        mv.push({ from: m.from, to: "lost", n: m.count });
      } else if (m.to !== null) mv.push({ from: m.from, to: m.to, n: m.count });
    }
    // A closed deal whose stage we could not place still counts in the totals (the recorded win/loss columns are the source of truth when no move rows came with them).
    if (!(d.moves ?? []).some((m) => m.status === "won") && (d.wonCount ?? 0) > 0) { wonN += d.wonCount ?? 0; wonC += d.wonCents; }
    if (!(d.moves ?? []).some((m) => m.status === "lost") && (d.lostCount ?? 0) > 0) { lostN += d.lostCount ?? 0; lostC += d.lostCents; }
    const stages = base.map((s, i) => ({
      ...s, count: d.stageCounts[i] ?? 0, valueCents: d.stageValueCents[i] ?? 0, noValueCount: d.stageNoValue?.[i] ?? 0,
      staleCount: 0, staleValueCents: 0, lostCount: lostBy[i].n, lostValueCents: lostBy[i].c,
    }));
    const flyers = flyerPlan(mv);
    return { index, date: d.date, stages, wonCount: wonN, wonCents: wonC, lostCount: lostN, lostCents: lostC, movers: flyers, activity: mv.reduce((t, m) => t + m.n, 0) };
  });
}

/** Milliseconds per day for each speed. */
export const REPLAY_SPEEDS = [{ id: "1", label: "1x", ms: 900 }, { id: "2", label: "2x", ms: 450 }, { id: "4", label: "4x", ms: 225 }] as const;

/** The next frame index when playing: moves forward one day and stops (done = true) on the last. */
export function nextFrame(index: number, length: number): { index: number; done: boolean } {
  if (length <= 0) return { index: 0, done: true };
  const i = Math.min(length - 1, index + 1);
  return { index: i, done: i >= length - 1 };
}
