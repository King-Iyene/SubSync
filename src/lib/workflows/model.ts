// Workflows module: the shapes and the tolerant parsers. Pure (no database, no network), so node --test can run it.
// The platform's search and log answers are VERIFIED in shape only (docs/features/WORKFLOWS.md), so every field is read from several spellings and a field that
// is missing becomes null ("not known"), never zero.

export type WfStatus = "published" | "draft" | "paused" | "done" | "failed" | "other";
export type Entity = "workflow" | "campaign";
/** Campaigns share the table with workflows: their id is stored as campaign:<id> and their kind starts with campaign. */
export const CAMPAIGN_PREFIX = "campaign:";
export const entityOf = (workflowId: string): Entity => (workflowId.startsWith(CAMPAIGN_PREFIX) ? "campaign" : "workflow");

export type WfItem = {
  workflowId: string;
  locationId: string;
  name: string;
  status: WfStatus;
  kind: string | null;
  folderId: string | null;
  version: string | null;
  uiUrl: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  updatedBy: string | null;
  /** Log counts of the last 30 days. null means the logs permission was not available, so it is not known. */
  runs30d: number | null;
  enrolled30d: number | null;
  failed30d: number | null;
  lastRunAt: number | null;
  removedSeenAt: number | null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (...v: unknown[]): string | null => {
  for (const x of v) if (typeof x === "string" && x.trim()) return x.trim();
  for (const x of v) if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return null;
};
export const toMs = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

export function statusOf(v: unknown): WfStatus {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "published" || s === "active" || s === "live") return "published";
  if (s === "draft" || s === "inactive") return "draft";
  if (s === "paused" || s === "stopped" || s === "on_hold") return "paused";
  if (s === "completed" || s === "complete" || s === "done" || s === "finished" || s === "sent") return "done";
  if (s === "failed" || s === "error" || s === "errored") return "failed";
  if (s === "scheduled" || s === "running" || s === "sending" || s === "processing" || s === "in_progress") return "published";
  return "other";
}

/** One workflow from a search answer. Folders are not workflows and are left out. */
export function parseWorkflow(raw: unknown, locationId: string): Omit<WfItem, "runs30d" | "enrolled30d" | "failed30d" | "lastRunAt" | "removedSeenAt"> | null {
  const o = obj(raw);
  const id = str(o.id, o._id, o.workflowId);
  const name = str(o.name, o.title);
  if (!id || !name) return null;
  const type = str(o.type, o.kind);
  if (type && /folder|directory/i.test(type)) return null;
  const by = o.updatedBy;
  return {
    workflowId: id, locationId, name: name.slice(0, 500), status: statusOf(o.status), kind: type, folderId: str(o.folderId, o.parentId),
    version: str(o.version), uiUrl: str(o.uiUrl, o.url), createdAt: toMs(o.createdAt ?? o.dateAdded), updatedAt: toMs(o.updatedAt ?? o.dateUpdated),
    updatedBy: typeof by === "string" ? by : str(obj(by).name, obj(by).id),
  };
}

export type SearchPage = { items: Array<NonNullable<ReturnType<typeof parseWorkflow>>>; total: number | null; next: string[] | null };
export function parseSearch(json: unknown, locationId: string): SearchPage {
  const o = obj(json);
  const list = Array.isArray(o.workflows) ? o.workflows : Array.isArray(o.data) ? o.data : [];
  const items = list.map((w) => parseWorkflow(w, locationId)).filter((w): w is NonNullable<typeof w> => w !== null);
  const after = Array.isArray(o.searchAfter) && o.searchAfter.every((x) => typeof x === "string") ? (o.searchAfter as string[]) : null;
  return { items, total: typeof o.total === "number" ? o.total : null, next: after && after.length > 0 ? after : null };
}

const FAILED = new Set(["error", "failed", "failed_retry_limit_reached"]);
/** Counts from the log statistics answer grouped by status. Rows may sit under rows, data, results or the top level. */
export function parseStats(json: unknown): { runs: number; enrolled: number; failed: number } | null {
  const o = obj(json);
  const rows = [o.rows, o.data, o.results, o.stats, json].find((x) => Array.isArray(x)) as unknown[] | undefined;
  if (!rows) return null;
  let runs = 0, enrolled = 0, failed = 0;
  for (const r of rows) {
    const row = obj(r);
    const n = typeof row.count === "number" ? row.count : Number(row.count);
    if (!Number.isFinite(n)) continue;
    const s = typeof row.status === "string" ? row.status : "";
    runs += n;
    if (s === "added_to_workflow") enrolled += n;
    if (FAILED.has(s)) failed += n;
  }
  return { runs, enrolled, failed };
}

/** The time of the newest log record. */
export function parseLastRun(json: unknown): number | null {
  const o = obj(json);
  const first = obj(Array.isArray(o.logs) ? o.logs[0] : Array.isArray(o.data) ? o.data[0] : null);
  return toMs(first.createdAt ?? first.timestamp ?? first.executedAt ?? first.date ?? first.time);
}

export function mergeStats(base: ReturnType<typeof parseWorkflow> & object, stats: { runs: number; enrolled: number; failed: number } | null, lastRunAt: number | null): WfItem {
  return { ...base, runs30d: stats ? stats.runs : null, enrolled30d: stats ? stats.enrolled : null, failed30d: stats ? stats.failed : null, lastRunAt, removedSeenAt: null };
}

/** Changes noticed between two syncs. Pure: compares the saved rows with the fresh list. */
export type Observed = { workflowId: string; kind: "new" | "renamed" | "status" | "removed" | "edited"; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export function diffObserved(saved: Array<Pick<WfItem, "workflowId" | "name" | "status" | "updatedAt" | "removedSeenAt">>, fresh: Array<Pick<WfItem, "workflowId" | "name" | "status" | "updatedAt">>, firstSync: boolean): Observed[] {
  const out: Observed[] = [];
  const old = new Map(saved.map((s) => [s.workflowId, s]));
  const seen = new Set<string>();
  for (const f of fresh) {
    seen.add(f.workflowId);
    const s = old.get(f.workflowId);
    if (!s) { if (!firstSync) out.push({ workflowId: f.workflowId, kind: "new", before: null, after: { name: f.name, status: f.status } }); continue; }
    if (s.name !== f.name) out.push({ workflowId: f.workflowId, kind: "renamed", before: { name: s.name }, after: { name: f.name } });
    if (s.status !== f.status) out.push({ workflowId: f.workflowId, kind: "status", before: { status: s.status }, after: { status: f.status } });
    else if (s.name === f.name && s.updatedAt && f.updatedAt && f.updatedAt > s.updatedAt) out.push({ workflowId: f.workflowId, kind: "edited", before: { updatedAt: s.updatedAt }, after: { updatedAt: f.updatedAt } });
  }
  for (const s of saved) if (!seen.has(s.workflowId) && !s.removedSeenAt) out.push({ workflowId: s.workflowId, kind: "removed", before: { name: s.name, status: s.status }, after: null });
  return out;
}

/** Words for a change in the history. */
export function changeWords(kind: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  const b = (k: string) => (typeof before?.[k] === "string" ? (before[k] as string) : "");
  const a = (k: string) => (typeof after?.[k] === "string" ? (after[k] as string) : "");
  switch (kind) {
    case "new": return `New workflow "${a("name")}" (${a("status")})`;
    case "renamed": case "rename": return `Renamed "${b("name")}" to "${a("name")}"`;
    case "status": return `Changed from ${b("status")} to ${a("status")}`;
    case "publish": return "Published";
    case "unpublish": return "Set back to draft";
    case "removed": return `"${b("name")}" is no longer there`;
    case "delete": return `Deleted "${b("name")}"`;
    case "clone": return `Copied "${a("name")}" into another client account`;
    case "install": return `Set up "${a("name")}" from the library`;
    case "restore": return `Recreated "${a("name")}" as a draft`;
    case "edited": return "Edited in the CRM";
    case "label": return "Organised in SubSync";
    default: return kind;
  }
}

/** One campaign from any of the four campaign lists. `source` says which list it came from (classic, email, bulk, workflow). */
export function parseCampaign(raw: unknown, locationId: string, source: string): NonNullable<ReturnType<typeof parseWorkflow>> | null {
  const o = obj(raw);
  const id = str(o.id, o._id, o.campaignId);
  const name = str(o.name, o.title, o.campaignName);
  if (!id || !name) return null;
  return {
    workflowId: CAMPAIGN_PREFIX + id, locationId, name: name.slice(0, 500), status: statusOf(o.status ?? o.state), kind: `campaign:${source}`, folderId: null, version: null,
    uiUrl: str(o.uiUrl, o.url), createdAt: toMs(o.createdAt ?? o.dateAdded ?? o.scheduledAt), updatedAt: toMs(o.updatedAt ?? o.dateUpdated ?? o.lastUpdated ?? o.createdAt), updatedBy: null,
  };
}
export function parseCampaignList(json: unknown, locationId: string, source: string): Array<NonNullable<ReturnType<typeof parseWorkflow>>> {
  const o = obj(json);
  const list = [o.campaigns, o.data, o.schedules, o.items, json].find((x) => Array.isArray(x)) as unknown[] | undefined;
  return (list ?? []).map((c) => parseCampaign(c, locationId, source)).filter((c): c is NonNullable<typeof c> => c !== null);
}
