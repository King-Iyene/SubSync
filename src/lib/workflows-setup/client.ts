import { GHL_API } from "../ghl/client.ts";
import { ghlFetch } from "../ghl/http.ts";
import { parseSearch } from "../workflows/model.ts";
import { parseStepTypes, type StepType } from "./steps.ts";

// The only place that talks to the workflow endpoints for setup. Nothing here decides whether a write may happen: the provisioner wraps create and publish in the write gateway.
// Errors are mapped to four kinds so the screen can stay calm: not_enabled (the API is limited availability), missing_scope, rejected (the definition was refused), failed.
export type Fail = { ok: false; kind: "not_enabled" | "missing_scope" | "rejected" | "failed"; status: number };
export type Res<T> = { ok: true; value: T } | Fail;
export type Found = { id: string; name: string; status: string; folderId: string | null };
export interface WfClient {
  stepTypes(): Promise<Res<StepType[]>>;
  list(): Promise<Res<Found[]>>;
  validate(def: Record<string, unknown>): Promise<Res<null>>;
  create(def: Record<string, unknown>): Promise<Res<{ id: string; folderId: string | null }>>;
  publish(id: string): Promise<Res<null>>;
}

export function mapFailure(status: number, body: unknown): Fail {
  const text = JSON.stringify(body ?? "");
  if (/WORKFLOW_API_NOT_ENABLED/i.test(text)) return { ok: false, kind: "not_enabled", status };
  if (status === 401 || status === 403) return { ok: false, kind: "missing_scope", status };
  if (status === 400 || status === 409 || status === 422) return { ok: false, kind: "rejected", status };
  return { ok: false, kind: "failed", status };
}

export function httpClient(token: string, locationId: string, fetchImpl?: typeof fetch): WfClient {
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const res = await ghlFetch(`${GHL_API}${path}`, {
      method, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, Version: "v3", Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    }, fetchImpl ? { fetchImpl } : {});
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const ok = (s: number) => s >= 200 && s < 300;
  const q = `locationId=${encodeURIComponent(locationId)}`;
  const idOf = (j: unknown): { id: string; folderId: string | null } => {
    const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
    const w = (o.workflow && typeof o.workflow === "object" ? o.workflow : o.data && typeof o.data === "object" ? o.data : o) as Record<string, unknown>;
    return { id: String(w.id ?? w.workflowId ?? ""), folderId: typeof w.parentId === "string" ? w.parentId : typeof w.folderId === "string" ? w.folderId : null };
  };
  return {
    async stepTypes() { const r = await call("GET", `/workflows/step-types?${q}`); return ok(r.status) ? { ok: true, value: parseStepTypes(r.json) } : mapFailure(r.status, r.json); },
    async list() {
      const r = await call("GET", `/workflows/?${q}&limit=100`);
      if (!ok(r.status)) return mapFailure(r.status, r.json);
      return { ok: true, value: parseSearch(r.json, locationId).items.map((w) => ({ id: w.workflowId, name: w.name, status: w.status, folderId: w.folderId })) };
    },
    async validate(def) { const r = await call("POST", `/workflows/definition/validate?${q}`, def); return ok(r.status) ? { ok: true, value: null } : mapFailure(r.status, r.json); },
    async create(def) { const r = await call("POST", `/workflows/?${q}`, def); const got = idOf(r.json); return ok(r.status) && got.id ? { ok: true, value: got } : mapFailure(r.status, r.json); },
    async publish(wid) { const r = await call("PUT", `/workflows/${encodeURIComponent(wid)}/status?${q}`, { status: "published" }); return ok(r.status) ? { ok: true, value: null } : mapFailure(r.status, r.json); },
  };
}
