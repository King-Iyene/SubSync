import { finish, type Reads, type SetupCheckResult } from "./model.ts";

// The made-up answers shown to the demo company. They go through the same checklist code as a real account, so the demo shows the real words.
// Different accounts show different pictures (a thin pipeline, overdue tasks, no phone number) so the demo is worth clicking through.
export function demoReads(seed: number): Reads {
  const ok = <T,>(value: T) => ({ state: "ok", value }) as const;
  const k = Math.abs(seed) % 3;
  return {
    pipelines: ok({ pipelines: 2, stages: k === 1 ? 6 : 9, thin: k === 1 ? 1 : 0 }),
    objects: ok({ objects: k === 2 ? 0 : 2 }),
    records: k === 2 ? null : ok({ count: 214, capped: false }),
    customValues: ok({ count: 12, capped: false }),
    templates: ok({ count: k === 0 ? 18 : 4, capped: false }),
    tasks: ok({ open: k === 2 ? 0 : 37, overdue: k === 0 ? 0 : 9, capped: false }),
    files: ok({ count: 142, capped: false }),
    emailBuilder: ok({ count: 6, capped: false }),
    emailSchedule: ok({ count: k === 2 ? 0 : 11, capped: false }),
    numbers: k === 2 ? ok({ count: 0, capped: false, last4: [] }) : ok({ count: 2, capped: false, last4: ["4821", "9037"] }),
    pools: ok({ pools: k === 0 ? 1 : 0, numbers: k === 0 ? 3 : 0 }),
    resources: ok({ rooms: 3, equipment: k === 0 ? 2 : 0 }),
    domains: k === 1 ? { total: 2, passing: 1, attention: 1 } : { total: 1, passing: 1, attention: 0 },
  };
}

export const demoSetupCheck = (seed: number, now: number): SetupCheckResult => finish(demoReads(seed), now);
