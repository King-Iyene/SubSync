// The Clean-up history in plain words (stage CLEANUP). Pure: it turns one line of the audit log into one sentence, says which lines can still be taken back, and filters by
// kind. No database, no network.

export type AuditLine = { id: number; at: string; actor: string | null; action: string; detail: Record<string, unknown> };

export type Kind = "decision" | "merge" | "fix" | "rules" | "write" | "scan";
export const KIND_LABEL: Record<Kind, string> = { decision: "Decisions", merge: "Merges", fix: "Fixes", rules: "Rules", write: "Switches", scan: "Scans" };

export type HistoryRow = {
  id: number; at: string; who: string; kind: Kind; text: string;
  /** The account, when the line is about one. */
  locationId: string | null; locationName: string | null; names: string[];
  /** A decision that is still in force and can be taken back here. */
  undo: { kind: "review" | "snooze"; locationId: string; key: string } | null;
  /** A line that only records what WOULD have been sent while the master switch was off. */
  dryRun: boolean;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The actions this screen lists. Anything else in the audit log (sign-ins, syncs, sharing) is not Clean-up history. */
export const HISTORY_ACTIONS = [
  "duplicates.keep", "duplicates.not_duplicate", "duplicates.merged_in_platform", "duplicates.snooze", "duplicates.unsnooze", "duplicates.undo", "duplicates.merge_requested", "duplicates.bulk_keep", "duplicates.bulk_not_duplicate",
  "cleanup.preview", "cleanup.apply_done", "cleanup.apply_blocked", "cleanup.undo_done", "cleanup.undo_blocked", "cleanup.rules_saved", "cleanup.rules_cleared", "cleanup.write_enabled", "cleanup.write_disabled", "cleanup.scan_alert", "cleanup.import_check",
  "dry_run.would_write",
] as const;

const KIND: Record<string, Kind> = {
  "duplicates.keep": "decision", "duplicates.not_duplicate": "decision", "duplicates.merged_in_platform": "merge", "duplicates.snooze": "decision", "duplicates.unsnooze": "decision", "duplicates.undo": "decision",
  "duplicates.merge_requested": "merge", "duplicates.bulk_keep": "decision", "duplicates.bulk_not_duplicate": "decision",
  "cleanup.preview": "fix", "cleanup.apply_done": "fix", "cleanup.apply_blocked": "fix", "cleanup.undo_done": "fix", "cleanup.undo_blocked": "fix",
  "cleanup.rules_saved": "rules", "cleanup.rules_cleared": "rules", "cleanup.write_enabled": "write", "cleanup.write_disabled": "write", "cleanup.scan_alert": "scan", "cleanup.import_check": "scan",
  "dry_run.would_write": "write",
};

const WHAT: Record<string, string> = {
  "crm.contact.merge": "merge contacts", "crm.contact.merge_workflow": "start a merge in your CRM", "crm.contact.update": "change contact details", "crm.contact.tag": "change tags",
  "crm.note.create": "add a note", "crm.field.update": "change a field",
};

/** One sentence for one line. Names are the contacts' names where SubSync kept them with the decision. */
export function sentence(a: AuditLine, names: readonly string[], account: string | null): string {
  const d = a.detail;
  const who = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ")) : "a group of contacts";
  const at = account ? ` in ${account}` : "";
  switch (a.action) {
    case "duplicates.not_duplicate": return `Marked ${who}${at} as not a duplicate.`;
    case "duplicates.merged_in_platform": return `Said ${who}${at} was merged in the CRM.`;
    case "duplicates.keep": return `Chose which record to keep for ${who}${at}.`;
    case "duplicates.snooze": return `Set ${who}${at} aside for 7 days.`;
    case "duplicates.unsnooze": return `Put ${who}${at} back in the list.`;
    case "duplicates.undo": return `Took back a decision about ${who}${at}.`;
    case "duplicates.merge_requested": return `Sent ${who}${at} to the merge workflow in the CRM.`;
    case "duplicates.bulk_keep": case "duplicates.bulk_not_duplicate": return `Decided ${String(d.groups ?? "several")} groups at once.`;
    case "cleanup.preview": return `Previewed ${String(d.total ?? 0)} change${d.total === 1 ? "" : "s"}${at}. Nothing was changed.`;
    case "cleanup.apply_done": return `Applied ${String(d.applied ?? 0)} change${d.applied === 1 ? "" : "s"}${at}${d.skipped ? `, ${String(d.skipped)} skipped` : ""}${d.failed ? `, ${String(d.failed)} failed` : ""}.`;
    case "cleanup.apply_blocked": return `A clean-up${at} was stopped: SubSync does not have permission to change contacts there.`;
    case "cleanup.undo_done": return `Undid ${String(d.undone ?? 0)} change${d.undone === 1 ? "" : "s"}${at}.`;
    case "cleanup.undo_blocked": return `An undo${at} was stopped: SubSync does not have permission to change contacts there.`;
    case "cleanup.rules_saved": return d.scope === "company" ? `Saved the matching rules for every client (${String(d.preset ?? "custom")}).` : `Saved the matching rules${at} (${String(d.preset ?? "custom")}).`;
    case "cleanup.rules_cleared": return `Went back to the company's matching rules${at}.`;
    case "cleanup.write_enabled": return `Allowed SubSync to change contacts${at}.`;
    case "cleanup.write_disabled": return `Stopped SubSync changing contacts${at}.`;
    case "cleanup.scan_alert": return `Found ${String(d.newGroups ?? "new")} new likely duplicate group${d.newGroups === 1 ? "" : "s"}${at}.`;
    case "cleanup.import_check": return `Checked a file of ${String(d.rows ?? "")} people against${at ? at.replace(" in ", " ") : " an account"} before importing.`;
    case "dry_run.would_write": return `SubSync was about to ${WHAT[String(d.what)] ?? "change something"}${at}, but changing contacts is switched off, so nothing was sent.`;
    default: return "Something was recorded.";
  }
}

export const kindOf = (action: string): Kind => KIND[action] ?? "decision";

export type DecisionState = { reviews: ReadonlySet<string>; snoozes: ReadonlySet<string> };

/** Which lines can still be taken back: a "not a duplicate", "merged" or "keep" decision whose group still carries it, or a "not now" that has not expired. */
export function undoOf(a: AuditLine, state: DecisionState): HistoryRow["undo"] {
  const loc = str(a.detail.locationId);
  const key = str(a.detail.key);
  if (!loc || !key) return null;
  const id = `${loc}:${key}`;
  if ((a.action === "duplicates.not_duplicate" || a.action === "duplicates.merged_in_platform" || a.action === "duplicates.keep") && state.reviews.has(id)) return { kind: "review", locationId: loc, key };
  if (a.action === "duplicates.snooze" && state.snoozes.has(id)) return { kind: "snooze", locationId: loc, key };
  return null;
}

/** Only the newest line about one group can be taken back (an older "not a duplicate" that was already undone and redone is history, not a button). */
export function newestUndo(rows: HistoryRow[]): HistoryRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    if (!r.undo) return r;
    const id = `${r.undo.locationId}:${r.undo.key}`;
    if (seen.has(id)) return { ...r, undo: null };
    seen.add(id);
    return r;
  });
}

export function matchesKind(action: string, kind: Kind | null): boolean { return !kind || kindOf(action) === kind; }
export const parseKind = (v: unknown): Kind | null => (typeof v === "string" && v in KIND_LABEL ? (v as Kind) : null);
