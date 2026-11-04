import { outward, type Deps } from "../live-flags.ts";
import { GHL_API } from "../ghl/client.ts";
import { ghlFetch } from "../ghl/http.ts";
import { parseCampaignList, parseLastRun, parseSearch, parseStats, type SearchPage } from "./model.ts";

// The ONE place that talks to the CRM's workflow and campaign endpoints (docs/features/WORKFLOWS.md). Reads are always live. Every change goes through
// `outward` (WORKFLOWS_WRITE_LIVE, default off): with the switch off the request is described in the audit table and NOTHING is sent.
// The version header and the exact field names of the answers are CHECK items; the parsers in model.ts accept several spellings.

const VERSION = "2021-07-28";
const seg = encodeURIComponent;

export type Call = { token: string; fetchImpl?: typeof fetch };
const headers = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", ...extra });

export type ReadResult<T> = { ok: true; value: T } | { ok: false; reason: "needs_permission" | "not_found" | "failed"; status: number };
async function read(c: Call, path: string, init: RequestInit = {}): Promise<ReadResult<unknown>> {
  const res = await ghlFetch(`${GHL_API}${path}`, { ...init, headers: headers(c.token, init.body ? { "Content-Type": "application/json" } : {}), cache: "no-store" }, c.fetchImpl ? { fetchImpl: c.fetchImpl } : {});
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission", status: res.status };
  if (res.status === 404) return { ok: false, reason: "not_found", status: 404 };
  if (!res.ok) return { ok: false, reason: "failed", status: res.status };
  return { ok: true, value: await res.json().catch(() => ({})) };
}

/** Every workflow of one client account (workflows.readonly), 100 at a time, up to `max`. */
export async function listWorkflows(c: Call & { locationId: string }, max = 500): Promise<ReadResult<SearchPage["items"]>> {
  const items: SearchPage["items"] = [];
  let after: string[] | null = null;
  for (let page = 0; page < Math.ceil(max / 100); page++) {
    const body: Record<string, unknown> = { limit: 100, sort: [{ field: "updatedAt", direction: "desc" }], ...(after ? { searchAfter: after } : {}) };
    const r = await read(c, "/workflows/search", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return page === 0 ? r : { ok: true, value: items };
    const p = parseSearch(r.value, c.locationId);
    items.push(...p.items);
    if (!p.next || p.items.length === 0) break;
    after = p.next;
  }
  return { ok: true, value: items };
}

const iso = (ms: number) => new Date(ms).toISOString();
/** Counts of the last 30 days grouped by status (workflows.logs). */
export async function workflowStats(c: Call, workflowId: string, now: number) {
  const q = new URLSearchParams({ groupBy: "status", startDate: iso(now - 29.5 * 86_400_000), endDate: iso(now), limit: "100" });
  const r = await read(c, `/workflows/${seg(workflowId)}/logs/aggregate?${q}`);
  return r.ok ? { ok: true as const, value: parseStats(r.value) } : r;
}
export async function workflowLastRun(c: Call, workflowId: string): Promise<number | null> {
  const r = await read(c, `/workflows/${seg(workflowId)}/logs?limit=1`);
  return r.ok ? parseLastRun(r.value) : null;
}
export async function workflowDefinition(c: Call, workflowId: string) {
  return read(c, `/workflows/${seg(workflowId)}/definition`);
}

/** Campaigns from the four lists. Each list is read on its own: one that is refused does not hide the others. */
export async function listCampaigns(c: Call & { locationId: string }): Promise<{ items: SearchPage["items"]; refused: boolean; failed: boolean }> {
  const sources: Array<[string, string]> = [
    ["classic", "/campaigns/"],
    ["email", `/emails/locations/${seg(c.locationId)}/campaigns/emails?limit=100&offset=0`],
    ["bulk", `/emails/locations/${seg(c.locationId)}/campaigns/bulk-actions?limit=100&offset=0`],
    ["workflow", `/emails/locations/${seg(c.locationId)}/campaigns/workflows?limit=100&offset=0`],
  ];
  const items: SearchPage["items"] = [];
  let refused = false, failed = false;
  for (const [source, path] of sources) {
    const r = await read(c, path + (source === "classic" ? `?locationId=${seg(c.locationId)}` : ""));
    if (!r.ok) { if (r.reason === "needs_permission") refused = true; else if (r.reason === "failed") failed = true; continue; }
    items.push(...parseCampaignList(r.value, c.locationId, source));
  }
  return { items, refused, failed };
}

// ---------------------------------------------------------------- changes

export type WriteOutcome =
  | { outcome: "dry_run"; line: string }
  | { outcome: "done"; body: unknown }
  | { outcome: "needs_permission" }
  | { outcome: "conflict"; status: number }
  | { outcome: "failed"; status: number };

type Req = { method: "PUT" | "POST" | "DELETE"; path: string; body?: unknown; what: string };
async function write(c: Call & { installationId: string | null; locationId: string; workflowId: string; idem: string }, req: Req, deps: Deps): Promise<WriteOutcome> {
  const done = await outward(
    { flag: "WORKFLOWS_WRITE_LIVE", verb: req.method === "DELETE" ? "DELETE" : "WRITE", what: req.what, installationId: c.installationId, ids: { locationId: c.locationId, workflowId: c.workflowId } },
    async (): Promise<WriteOutcome> => {
      const res = await ghlFetch(`${GHL_API}${req.path}`, {
        method: req.method, headers: headers(c.token, { "Content-Type": "application/json", "Idempotency-Key": c.idem }),
        body: req.body === undefined ? undefined : JSON.stringify(req.body), cache: "no-store",
      }, c.fetchImpl ? { fetchImpl: c.fetchImpl } : {});
      if (res.status === 401 || res.status === 403) return { outcome: "needs_permission" };
      if (res.status === 409 || res.status === 422) return { outcome: "conflict", status: res.status };
      if (!res.ok) return { outcome: "failed", status: res.status };
      return { outcome: "done", body: await res.json().catch(() => ({})) };
    },
    deps,
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line };
}
type WC = Parameters<typeof write>[0];

export const setStatus = (c: WC, status: "published" | "draft", deps: Deps = {}) =>
  write(c, { method: "PUT", path: `/workflows/${seg(c.workflowId)}/status`, body: { status }, what: `workflow.status.${status}` }, deps);
export const deleteWorkflow = (c: WC, deps: Deps = {}) => write(c, { method: "DELETE", path: `/workflows/${seg(c.workflowId)}`, what: "workflow.delete" }, deps);
export const putDefinition = (c: WC, definition: Record<string, unknown>, deps: Deps = {}) =>
  write(c, { method: "PUT", path: `/workflows/${seg(c.workflowId)}/definition`, body: definition, what: "workflow.definition.update" }, deps);
export const createWorkflow = (c: WC, definition: Record<string, unknown>, deps: Deps = {}) =>
  write(c, { method: "POST", path: "/workflows/", body: definition, what: "workflow.create" }, deps);
export const validateDefinition = (c: WC, definition: Record<string, unknown>, deps: Deps = {}) =>
  write(c, { method: "POST", path: "/workflows/definition/validate", body: definition, what: "workflow.validate" }, deps);

/** A definition with a new name; everything else is sent back exactly as it was read (the platform treats an update as a full overwrite). */
export function renamedDefinition(def: unknown, name: string): Record<string, unknown> | null {
  const root = def && typeof def === "object" ? (def as Record<string, unknown>) : null;
  const d = root && typeof root.definition === "object" && root.definition ? (root.definition as Record<string, unknown>) : root;
  if (!d || !("version" in d)) return null;
  return { ...d, name };
}
