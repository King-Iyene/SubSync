// Workflows module: the bulk rename plan. Pure. The preview table is built from this and the confirm step re-runs it, so what was shown is what is done.
import type { WfItem } from "./model.ts";

export const MAX_NAME = 500;
export const MAX_PER_REQUEST = 50;

export type RenameRule = {
  /** Find and replace, plain text (never a pattern), case ignored. */
  find?: string; replace?: string;
  prefix?: string; suffix?: string;
  /** Collapse repeated spaces and trim. */
  tidy?: boolean;
  /** "title" capitalises each word. */
  casing?: "none" | "title";
};

export type RenameRow = {
  workflowId: string; locationId: string; from: string; to: string;
  status: "change" | "unchanged" | "blocked";
  /** Why a row is blocked, in plain words. */
  problem: string | null;
  /** Renaming a published workflow sets it to draft for a moment. */
  needsPause: boolean;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const title = (s: string) => s.replace(/\p{L}[\p{L}\p{N}']*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function applyRule(name: string, r: RenameRule): string {
  let out = name;
  if (r.find) out = out.replace(new RegExp(esc(r.find), "gi"), () => r.replace ?? "");
  if (r.casing === "title") out = title(out);
  if (r.tidy !== false) out = out.replace(/\s+/g, " ").trim();
  if (r.prefix && !out.startsWith(r.prefix)) out = r.prefix + out;
  if (r.suffix && !out.endsWith(r.suffix)) out = out + r.suffix;
  return out;
}

export const ruleIsEmpty = (r: RenameRule) => !r.find && !r.prefix && !r.suffix && r.casing !== "title";

/** The preview. Two workflows in one client account may not end up with the same name, and a name may not be empty or longer than the platform allows. */
export function planRename(items: WfItem[], rule: RenameRule, allowPaused: boolean): RenameRow[] {
  const rows: RenameRow[] = items.map((w) => {
    const to = applyRule(w.name, rule);
    const needsPause = w.status === "published";
    let problem: string | null = null;
    if (!to) problem = "The new name would be empty.";
    else if (to.length > MAX_NAME) problem = `The new name is longer than ${MAX_NAME} characters.`;
    else if (w.status === "other") problem = "This workflow is locked or in a state SubSync cannot change.";
    else if (to !== w.name && needsPause && !allowPaused) problem = "Published. Tick \"also pause and republish published workflows\" to include it.";
    return { workflowId: w.workflowId, locationId: w.locationId, from: w.name, to, status: to === w.name ? "unchanged" : problem ? "blocked" : "change", problem, needsPause };
  });
  const seen = new Map<string, number>();
  for (const r of rows) if (r.status !== "unchanged" || true) seen.set(`${r.locationId}|${r.to.toLowerCase()}`, (seen.get(`${r.locationId}|${r.to.toLowerCase()}`) ?? 0) + 1);
  // Workflows that are not part of the request keep their names, so a clash with them counts too.
  return rows.map((r) => (r.status === "change" && (seen.get(`${r.locationId}|${r.to.toLowerCase()}`) ?? 0) > 1 ? { ...r, status: "blocked" as const, problem: "Another workflow in this client account would get the same name." } : r));
}
