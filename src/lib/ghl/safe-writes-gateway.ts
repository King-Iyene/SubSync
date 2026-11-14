import { outward } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { SPACING_MS, VERSION, type GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";
import { LIMITS, takeSlot } from "./workbench.ts";

// The door for four small, account-level changes SubSync can make in a client's CRM, each one behind a preview and a confirm click (branch feat/safe-writes):
//   1. create a tag the call queues look for        POST   /locations/{id}/tags                     scope locations/tags.write        (VERIFIED in the published API description)
//   2. create the standard sales pipeline           POST   /opportunities/pipelines                 scope pipelines.create            (documented page; NOT VERIFIED LIVE)
//   3. store the account's reply target as a value  POST   /locations/{id}/customValues (new) or PUT /locations/{id}/customValues/{valueId} (existing)
//                                                                                                   scope locations/customValues.write (create is documented; update lists no scope; NOT VERIFIED LIVE)
//   4. mark a task done, or delete one SubSync made PUT    /contacts/{contactId}/tasks/{taskId}/completed, DELETE /contacts/{contactId}/tasks/{taskId}
//                                                                                                   scope contacts.write (the published description lists NO endpoint for locations/tasks.write)
// Same rules as every other gateway here: WRITE_GHL_LIVE off unless exactly "true", the account's own opt-in, a preview first (the route), a typed confirmation before a delete (checked
// here too), one audit line per write (ids and field names only: never a tag name, a value, a title), calls spaced under the platform's limit, idempotent (an existing tag, pipeline or
// value is never created twice), and a clear "Needs permission: reconnect" instead of a guess. Off or not allowed: the request is built, "WOULD WRITE ..." is recorded and NOTHING is sent.
// Nothing here messages a lead or changes a deal, so SubSync's own numbers cannot move because of these writes.

export const TAG_WRITE_SCOPE = "locations/tags.write";
export const PIPELINE_CREATE_SCOPE = "pipelines.create";
export const CUSTOM_VALUE_WRITE_SCOPE = "locations/customValues.write";
export const CUSTOM_VALUE_READ_SCOPE = "locations/customValues.readonly";
/** What the platform really asks for when a task is completed or deleted (the published description). */
export const TASK_WRITE_SCOPE = "contacts.write";

export const SLA_VALUE_NAME = "subsync_sla_minutes";
export const STANDARD_PIPELINE = { name: "SubSync Sales", stages: ["New lead", "Contacted", "Booked", "Showed", "Won", "Lost"] as const };

export type SafeWriteResult =
  | { outcome: "dry_run"; line: string; reason: "switch" | "account" }
  | { outcome: "done"; id: string | null }
  | { outcome: "already" }
  | { outcome: "unchanged" }
  | { outcome: "blocked"; text: string }
  | { outcome: "needs_permission" }
  | { outcome: "rate_limited"; retryInSeconds: number }
  | { outcome: "failed"; status: number };

export type Base = { installationId: string; locationId: string; actor: string | null; optedIn: boolean; token: () => Promise<string> };

// ---------------- pure rules (the tests read these) ----------------

export const TAG_NAME_MAX = 60;
/** A tag name is plain: not empty, at most 60 characters, no comma, no control characters or angle brackets. */
export function checkTagName(v: unknown): { ok: true; name: string } | { ok: false; text: string } {
  if (typeof v !== "string") return { ok: false, text: "Type a tag name." };
  const name = v.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, text: "Type a tag name." };
  if (name.length > TAG_NAME_MAX) return { ok: false, text: `Use at most ${TAG_NAME_MAX} characters.` };
  if (name.includes(",") || /[\u0000-\u001f<>]/.test(name)) return { ok: false, text: "Use plain letters, numbers, spaces, dashes or underscores." };
  return { ok: true, name };
}
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const tagBody = (name: string) => ({ name });

/** The request body for the standard pipeline. Stage positions are unique, starting at 0. */
export function pipelineBody(locationId: string): Record<string, unknown> {
  return {
    name: STANDARD_PIPELINE.name, locationId, showInFunnel: true, showInPieChart: true,
    stages: STANDARD_PIPELINE.stages.map((name, position) => ({ name, position })),
  };
}

export const SLA_MIN = 1;
export const SLA_MAX = 1440;
export function checkSlaMinutes(v: unknown): { ok: true; minutes: number } | { ok: false; text: string } {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < SLA_MIN || n > SLA_MAX) return { ok: false, text: `The reply target must be a whole number of minutes from ${SLA_MIN} to ${SLA_MAX}.` };
  return { ok: true, minutes: n };
}
export const customValueBody = (minutes: number) => ({ name: SLA_VALUE_NAME, value: String(minutes) });

/** What to do with the stored value: create it, change it, or leave it (already the same). */
export function planCustomValue(existing: { id: string; value: string } | null, minutes: number): "create" | "update" | "unchanged" {
  if (!existing) return "create";
  return existing.value.trim() === String(minutes) ? "unchanged" : "update";
}

/** Deleting a task needs the task's own title typed back. Pure. */
export const deleteTaskConfirmed = (title: string, typed: string): boolean => title.trim() !== "" && sameName(title, typed);

// ---------------- the gateway ----------------

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Audit = { op: string; fields: string[]; ids: Record<string, string | null>; result: string };
/** The audit line for one write: ids and field names only. */
async function record(a: Base, w: Audit, deps: GatewayDeps): Promise<void> {
  const detail = { what: "crm.account.write", op: w.op, locationId: a.locationId, ids: w.ids, fields: w.fields, result: w.result };
  try {
    if (deps.audit) await deps.audit({ installationId: a.installationId, action: "crm.write", detail });
    else {
      const { sql } = await import("../db");
      const db = sql();
      await db`insert into audit_log (installation_id, actor, action, detail) values (${a.installationId}, ${a.actor}, 'crm.write', ${db.json(detail as never)})`;
    }
  } catch {
    // a missing audit line must never turn a finished write into an error
  }
}

type Req = { method: "POST" | "PUT" | "DELETE"; path: string; body?: Record<string, unknown> };

/** One guarded call: rate limit, opt-in, switch, spacing, the request, the audit line. `before` runs only on the live path (a last idempotency check) and may end the call early. */
export async function run(a: Base, o: { op: string; what: string; verb: "WRITE" | "DELETE"; ids: Record<string, string | null>; fields: string[]; req: () => Req; before?: () => Promise<SafeWriteResult | null>; answerId?: (j: unknown) => string | null; okStatuses?: number[] }, deps: GatewayDeps): Promise<SafeWriteResult> {
  const slot = takeSlot(`acct:${a.installationId}`, LIMITS.perAccountPerMinute, 60_000);
  if (slot) return { outcome: "rate_limited", retryInSeconds: slot };
  const env = a.optedIn ? deps.env : {};
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: o.verb, what: o.what, installationId: a.installationId, ids: { locationId: a.locationId, ...o.ids }, fields: o.fields },
    async (): Promise<SafeWriteResult> => {
      const early = o.before ? await o.before() : null;
      if (early) { await record(a, { op: o.op, fields: o.fields, ids: o.ids, result: early.outcome }, deps); return early; }
      await (deps.sleep ?? wait)(SPACING_MS);
      const r = o.req();
      const res = await ghlFetch(
        `${GHL_API}${r.path}`,
        { method: r.method, headers: { Authorization: `Bearer ${await a.token()}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" }, ...(r.body ? { body: JSON.stringify(r.body) } : {}), cache: "no-store" },
        { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
      );
      let result: SafeWriteResult;
      if (res.status === 401 || res.status === 403) result = { outcome: "needs_permission" };
      else if (res.ok || o.okStatuses?.includes(res.status)) result = { outcome: "done", id: o.answerId ? o.answerId(await res.json().catch(() => ({}))) : null };
      else result = { outcome: "failed", status: res.status };
      await record(a, { op: o.op, fields: o.fields, ids: o.ids, result: result.outcome }, deps);
      return result;
    },
    { ...deps, ...(env ? { env } : {}) },
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line, reason: a.optedIn ? "switch" : "account" };
}

export const pick = (j: unknown, ...keys: string[]): string | null => {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v) return v; if (v && typeof v === "object") { const id = (v as Record<string, unknown>).id; if (typeof id === "string" && id) return id; } }
  return null;
};

// ---- 1. tag ----

export type TagWrite = Base & {
  name: string;
  /** Tags the account has now, read just before (null: could not be read). A tag already there is never created again. */
  existing: readonly string[] | null;
  /** Live path only: read the account's tags again just before the call (closes the gap between preview and confirm). */
  recheck?: () => Promise<readonly string[] | null>;
};
export async function createTag(a: TagWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  const c = checkTagName(a.name);
  if (!c.ok) return { outcome: "blocked", text: c.text };
  if (a.existing?.some((t) => sameName(t, c.name))) return { outcome: "already" };
  return run(a, {
    op: "tag.create", what: "crm.tag.create", verb: "WRITE", ids: {}, fields: ["name"],
    before: async () => { const now = a.recheck ? await a.recheck() : null; return now?.some((t) => sameName(t, c.name)) ? { outcome: "already" } : null; },
    req: () => ({ method: "POST", path: `/locations/${encodeURIComponent(a.locationId)}/tags`, body: tagBody(c.name) }),
    answerId: (j) => pick(j, "tag"),
  }, deps);
}

// ---- 2. pipeline ----

export type PipelineWrite = Base & {
  /** How many pipelines SubSync's copy shows for the account. Only an account with none may get the standard one. */
  existingCount: number;
  /** Live path only: count again from the CRM just before the call (null: could not be read; the write then goes ahead only if SubSync's own count was zero). */
  recheck?: () => Promise<number | null>;
};
export async function createPipeline(a: PipelineWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  if (a.existingCount > 0) return { outcome: "blocked", text: "This account already has a pipeline, so SubSync will not add another." };
  return run(a, {
    op: "pipeline.create", what: "crm.pipeline.create", verb: "WRITE", ids: {}, fields: ["name", "stages"],
    before: async () => { const n = a.recheck ? await a.recheck() : null; return n !== null && n > 0 ? { outcome: "already" } : null; },
    req: () => ({ method: "POST", path: "/opportunities/pipelines", body: pipelineBody(a.locationId) }),
    answerId: (j) => pick(j, "id", "pipeline"),
  }, deps);
}

// ---- 3. custom value ----

export type CustomValueWrite = Base & {
  minutes: number;
  /** The value now in the CRM, found by name (null: there is none). */
  existing: { id: string; value: string } | null;
  /** Live path only: read it again just before the call. `undefined` means the read could not be done; the call is then refused rather than guessed. */
  recheck?: () => Promise<{ id: string; value: string } | null | undefined>;
};
export async function setCustomValue(a: CustomValueWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  const c = checkSlaMinutes(a.minutes);
  if (!c.ok) return { outcome: "blocked", text: c.text };
  const plan = planCustomValue(a.existing, c.minutes);
  if (plan === "unchanged") return { outcome: "unchanged" };
  let target = a.existing;
  return run(a, {
    op: plan === "create" ? "custom_value.create" : "custom_value.update", what: plan === "create" ? "crm.custom_value.create" : "crm.custom_value.update", verb: "WRITE", ids: { valueId: a.existing?.id ?? null }, fields: ["name", "value"],
    before: async () => {
      if (!a.recheck) return null;
      const now = await a.recheck();
      if (now === undefined) return { outcome: "failed", status: 0 };
      target = now;
      return planCustomValue(now, c.minutes) === "unchanged" ? { outcome: "unchanged" } : null;
    },
    req: () => target
      ? { method: "PUT", path: `/locations/${encodeURIComponent(a.locationId)}/customValues/${encodeURIComponent(target.id)}`, body: customValueBody(c.minutes) }
      : { method: "POST", path: `/locations/${encodeURIComponent(a.locationId)}/customValues`, body: customValueBody(c.minutes) },
    answerId: (j) => pick(j, "customValue"),
  }, deps);
}

// ---- 4. tasks ----

export type TaskWrite = Base & { contactId: string; taskId: string };
export async function completeTask(a: TaskWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  if (!ID.test(a.contactId) || !ID.test(a.taskId)) return { outcome: "blocked", text: "That task is not available." };
  return run(a, {
    op: "task.complete", what: "crm.task.complete", verb: "WRITE", ids: { contactId: a.contactId, taskId: a.taskId }, fields: ["completed"],
    req: () => ({ method: "PUT", path: `/contacts/${encodeURIComponent(a.contactId)}/tasks/${encodeURIComponent(a.taskId)}/completed`, body: { completed: true } }),
  }, deps);
}

export type TaskDelete = TaskWrite & {
  title: string; confirmText: string;
  /** SubSync made this task (it is in SubSync's own record of what it created). SubSync never deletes anyone else's task. */
  ours: boolean;
};
export async function deleteTask(a: TaskDelete, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  if (!ID.test(a.contactId) || !ID.test(a.taskId)) return { outcome: "blocked", text: "That task is not available." };
  if (!a.ours) return { outcome: "blocked", text: "SubSync only deletes tasks it created. Delete this one in your CRM." };
  if (!deleteTaskConfirmed(a.title, a.confirmText)) return { outcome: "blocked", text: `Type the task name "${a.title}" exactly to confirm.` };
  return run(a, {
    op: "task.delete", what: "crm.task.delete", verb: "DELETE", ids: { contactId: a.contactId, taskId: a.taskId }, fields: ["task"],
    req: () => ({ method: "DELETE", path: `/contacts/${encodeURIComponent(a.contactId)}/tasks/${encodeURIComponent(a.taskId)}` }),
    okStatuses: [404], // already gone is what a delete wanted
  }, deps);
}

// ---------------- reads the routes use (read only, never stored) ----------------

export const hdr = (token: string) => ({ Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json" });
export type ReadDeps = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };
export const opts = (d: ReadDeps) => ({ ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}), ...(d.sleep ? { sleep: d.sleep } : {}) });

export type ReadResult<T> = { ok: true; value: T } | { ok: false; reason: "needs_permission" | "unavailable" };

export async function listTagNames(a: { locationId: string; token: string }, d: ReadDeps = {}): Promise<ReadResult<string[]>> {
  try {
    const out: string[] = [];
    for (let skip = 0; skip < 2000; skip += 100) {
      const res = await ghlFetch(`${GHL_API}/locations/${encodeURIComponent(a.locationId)}/tags?limit=100&skip=${skip}`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
      if (!res.ok) return { ok: false, reason: "unavailable" };
      const j = (await res.json().catch(() => ({}))) as { tags?: Array<{ name?: unknown }> };
      const page = (j.tags ?? []).map((t) => (typeof t.name === "string" ? t.name : "")).filter(Boolean);
      out.push(...page);
      if (page.length < 100) break;
    }
    return { ok: true, value: out };
  } catch { return { ok: false, reason: "unavailable" }; }
}

export async function countPipelines(a: { locationId: string; token: string }, d: ReadDeps = {}): Promise<ReadResult<number>> {
  try {
    const res = await ghlFetch(`${GHL_API}/opportunities/pipelines?locationId=${encodeURIComponent(a.locationId)}`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const j = (await res.json().catch(() => ({}))) as { pipelines?: unknown };
    return { ok: true, value: Array.isArray(j.pipelines) ? j.pipelines.length : 0 };
  } catch { return { ok: false, reason: "unavailable" }; }
}

/** The stored reply-target value, found by its name. `value: null` means there is none yet. */
export async function findSlaValue(a: { locationId: string; token: string }, d: ReadDeps = {}): Promise<ReadResult<{ id: string; value: string } | null>> {
  try {
    const res = await ghlFetch(`${GHL_API}/locations/${encodeURIComponent(a.locationId)}/customValues`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const j = (await res.json().catch(() => ({}))) as { customValues?: Array<{ id?: unknown; name?: unknown; value?: unknown }> };
    const hit = (j.customValues ?? []).find((v) => typeof v.name === "string" && sameName(v.name, SLA_VALUE_NAME) && typeof v.id === "string" && ID.test(v.id));
    return { ok: true, value: hit ? { id: hit.id as string, value: typeof hit.value === "string" ? hit.value : "" } : null };
  } catch { return { ok: false, reason: "unavailable" }; }
}
