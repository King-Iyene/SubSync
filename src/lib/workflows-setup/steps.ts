// Resolving the real step type ids from the platform's "Get Step Types" answer. The answer's exact shape is a CHECK item, so every field is read from several spellings.
export type StepType = { id: string; name: string; kind: string };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function parseStepTypes(json: unknown): StepType[] {
  const o = obj(json);
  const list = [o.stepTypes, o.types, o.data, o.steps, json].find((x) => Array.isArray(x)) as unknown[] | undefined;
  return (list ?? []).map((x) => {
    const r = obj(x);
    return { id: str(r.id) || str(r.key) || str(r.type) || str(r.stepType), name: str(r.name) || str(r.label) || str(r.title), kind: str(r.kind) || str(r.category) || str(r.group) };
  }).filter((s) => s.id && s.name);
}

export type Resolved = { ok: true; trigger: StepType; manualCall: StepType; removeTag: StepType } | { ok: false; missing: string[] };
const has = (s: StepType, ...w: RegExp[]) => w.every((r) => r.test(`${s.name} ${s.id}`));
const isTrigger = (s: StepType) => /trigger/i.test(s.kind);

export function resolveSteps(types: readonly StepType[]): Resolved {
  const trigger = types.find((s) => has(s, /tag/i) && (isTrigger(s) || /added|tagged/i.test(s.name)) && !/remov/i.test(s.name));
  const manualCall = types.find((s) => has(s, /manual/i, /call/i) && !isTrigger(s));
  const removeTag = types.find((s) => has(s, /remove/i, /tag/i) && !isTrigger(s));
  const missing = [!trigger && "Contact tagged", !manualCall && "Manual Action: Call", !removeTag && "Remove tag"].filter((x): x is string => !!x);
  return missing.length || !trigger || !manualCall || !removeTag ? { ok: false, missing } : { ok: true, trigger, manualCall, removeTag };
}
