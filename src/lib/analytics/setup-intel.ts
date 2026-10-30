// Compare one client account's setup with a baseline account (the one an agency treats as "the
// right way"). Pure, so it can be unit tested. Only what the platform's API exposes is compared:
// pipelines, their stages, and how many calendars exist.

export type Setup = {
  locationId: string;
  name: string;
  calendars: number | null;
  pipelines: Array<{ name: string; stages: string[] }>;
};

export type StageDiff = { pipeline: string; missing: string[]; extra: string[]; orderDiffers: boolean };

export type Diff = {
  matches: boolean;
  missingPipelines: string[];
  extraPipelines: string[];
  stageDiffs: StageDiff[];
  calendarDelta: number | null;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function compareSetup(base: Setup, other: Setup): Diff {
  const baseBy = new Map(base.pipelines.map((p) => [norm(p.name), p]));
  const otherBy = new Map(other.pipelines.map((p) => [norm(p.name), p]));
  const missingPipelines = [...baseBy.entries()].filter(([k]) => !otherBy.has(k)).map(([, p]) => p.name);
  const extraPipelines = [...otherBy.entries()].filter(([k]) => !baseBy.has(k)).map(([, p]) => p.name);
  const stageDiffs: StageDiff[] = [];
  for (const [key, bp] of baseBy) {
    const op = otherBy.get(key);
    if (!op) continue;
    const bs = bp.stages.map(norm);
    const os = op.stages.map(norm);
    const missing = bp.stages.filter((s) => !os.includes(norm(s)));
    const extra = op.stages.filter((s) => !bs.includes(norm(s)));
    const common = bs.filter((s) => os.includes(s));
    const sameOrder = common.join("|") === os.filter((s) => bs.includes(s)).join("|");
    if (missing.length || extra.length || !sameOrder) stageDiffs.push({ pipeline: bp.name, missing, extra, orderDiffers: !sameOrder });
  }
  const calendarDelta = base.calendars === null || other.calendars === null ? null : other.calendars - base.calendars;
  return { matches: missingPipelines.length === 0 && extraPipelines.length === 0 && stageDiffs.length === 0, missingPipelines, extraPipelines, stageDiffs, calendarDelta };
}

// One line a person can read.
export function describe(d: Diff): string[] {
  const out: string[] = [];
  if (d.missingPipelines.length) out.push(`Missing pipeline${d.missingPipelines.length === 1 ? "" : "s"}: ${d.missingPipelines.join(", ")}`);
  if (d.extraPipelines.length) out.push(`Extra pipeline${d.extraPipelines.length === 1 ? "" : "s"}: ${d.extraPipelines.join(", ")}`);
  for (const s of d.stageDiffs) {
    const parts = [s.missing.length ? `missing stage ${s.missing.join(", ")}` : "", s.extra.length ? `extra stage ${s.extra.join(", ")}` : "", s.orderDiffers && !s.missing.length && !s.extra.length ? "stages in a different order" : ""].filter(Boolean);
    out.push(`${s.pipeline}: ${parts.join("; ")}`);
  }
  if (d.calendarDelta !== null && d.calendarDelta !== 0) out.push(`${Math.abs(d.calendarDelta)} ${d.calendarDelta > 0 ? "more" : "fewer"} calendar${Math.abs(d.calendarDelta) === 1 ? "" : "s"} than the baseline`);
  return out;
}
