// Versions of the counting rules behind the deal numbers (N39). Pure: no database.
//
// A chart or a "vs yesterday" figure compares days with each other. If the rule for what counts as an open deal changes between two of those
// days, the difference is the rule, not the business. Every daily snapshot is therefore written with the version of the rules it was counted
// under, and history is only ever compared inside one version. Rows written before the column existed are read by date.

/** The rules in force now. Raise this when the definition of a counted open deal (or of stale, or of the score parts built on them) changes. */
export const DEAL_RULES_VERSION = 3;

export const DEAL_RULE_HISTORY: ReadonlyArray<{ version: number; from: string; label: string }> = [
  { version: 1, from: "2026-10-28", label: "every open deal, whatever its value or owner" },
  { version: 2, from: "2026-10-31", label: "open deals with a value above zero and an owner" },
  { version: 3, from: "2026-11-01", label: "open deals with a value and an owner that are not in a closed-out stage or a pipeline that is not in use" },
];

/** The version a snapshot row counts as: the stored one, or (for a row written before versions were stored) the one in force on its day. */
export function rowVersion(row: { day: string; definitionVersion: number | null | undefined }): number {
  if (typeof row.definitionVersion === "number") return row.definitionVersion;
  // Version 2 started on 31 Oct 2026 (the commit that introduced the counted-deal rule); before that every open deal was counted.
  return row.day >= DEAL_RULE_HISTORY[1].from ? encode(2, 0) : encode(1, 0);
}

/** One number that changes when the code's rules change (DEAL_RULES_VERSION) or when the owner changes a stage rule (the revision). */
export function encode(version: number, rulesRevision: number): number {
  return version * 1000 + Math.min(999, Math.max(0, rulesRevision));
}

export const currentVersion = (rulesRevision: number): number => encode(DEAL_RULES_VERSION, rulesRevision);

export type SnapshotPoint = { day: string; definitionVersion: number | null | undefined };

/** Keep only the days counted under the same rules as the newest day. Returns them oldest first with the note to show about the days left out. */
export function sameDefinition<T extends SnapshotPoint>(points: T[]): { kept: T[]; leftOut: number; since: string | null; note: string | null } {
  if (points.length === 0) return { kept: [], leftOut: 0, since: null, note: null };
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const newest = rowVersion(sorted[sorted.length - 1]);
  const kept = sorted.filter((p) => rowVersion(p) === newest);
  const leftOut = sorted.length - kept.length;
  const since = kept.length ? kept[0].day : null;
  return {
    kept, leftOut, since,
    note: leftOut > 0 && since ? `The way deals are counted changed on ${since}, so the ${leftOut} earlier ${leftOut === 1 ? "day is" : "days are"} not drawn. A line that mixes two ways of counting would show a change that never happened.` : null,
  };
}

/** The deal-based fields of a daily snapshot: only these depend on the counting rules, so only these are held to one version. */
export const DEAL_FIELDS = ["openOpps", "openValue", "stale", "score"] as const;
