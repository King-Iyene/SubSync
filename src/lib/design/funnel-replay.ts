// FUNNEL REPLAY (time): turns one replay day (river-replay.ts, built from the moves SubSync recorded itself) into the same shape the Funnel draws, so scrubbing or playing the time bar
// re-draws the funnel as it stood at the end of that day. Pure and unit-tested. It never invents: a step the day has no figure for makes the whole day undrawable (null), and a window with
// no recorded movement has no frames at all (the screen then says nothing is replayed and just keeps a gentle idle flow).
import type { FlowPaths } from "./flow-paths.ts";
import type { ReplayFrame } from "./river-replay.ts";

/** The funnel's numbers at the end of `frame`'s day: open deals per step, and what was won and lost so far in the window. Null when a step cannot be matched to the day's figures. */
export function pathsAtFrame(paths: FlowPaths, frame: ReplayFrame): FlowPaths | null {
  const byId = new Map(frame.stages.map((s) => [s.id, s]));
  const stages = [];
  for (const ps of paths.stages) {
    const cs = byId.get(ps.id);
    if (!cs) return null;
    stages.push({ ...ps, open: Math.max(0, cs.count), openCents: Math.max(0, cs.valueCents), noValue: Math.max(0, cs.noValueCount ?? 0), stuck: 0, stuckCents: 0, lost: Math.max(0, cs.lostCount), lostCents: Math.max(0, cs.lostValueCents) });
  }
  return { ...paths, stages, won: { n: Math.max(0, frame.wonCount), cents: Math.max(0, frame.wonCents), medianDays: null, byOwner: [], bySource: [] }, lostElsewhere: 0 };
}
