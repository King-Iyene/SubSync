import { cadenceStep, type AttemptState, type Cadence } from "./dial6.ts";

// Where each lead stands in the redial plan, in words and numbers, for the queue rows, the Redial list and the "What this changes" line. Pure.
export type TouchRow = { key: string; touch: number; of: number; state: "fresh" | "due" | "waiting" | "text_fallback" | "done"; nextAt: number | null; label: string };

export function touchRow(key: string, st: AttemptState | undefined, cadence: Cadence, now: number, tz: string | null): TouchRow {
  const s = cadenceStep(cadence, st ?? { attempts: 0, lastAt: null, reached: false }, now, tz);
  return { key, touch: Math.min((st?.attempts ?? 0) + 1, cadence.maxAttempts), of: cadence.maxAttempts, state: s.state, nextAt: s.dueAt, label: s.label };
}

export type CadenceSummary = { waiting: string[]; textNow: string[]; due: string[]; example: TouchRow | null };
/** Counts over the leads in front of the person: who waits for the next try, who is due now, who has used every try and gets a text task. `example` is the soonest waiting lead. */
export function cadenceSummary(rows: readonly TouchRow[]): CadenceSummary {
  const waiting = rows.filter((r) => r.state === "waiting");
  const example = [...waiting].sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))[0] ?? rows.find((r) => r.state === "due") ?? null;
  return { waiting: waiting.map((r) => r.key), textNow: rows.filter((r) => r.state === "text_fallback").map((r) => r.key), due: rows.filter((r) => r.state === "due").map((r) => r.key), example };
}
