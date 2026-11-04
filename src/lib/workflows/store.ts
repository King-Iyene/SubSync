import { sql } from "../db";
import { diffObserved, type WfItem, type WfStatus } from "./model";

// The only place the Workflows module touches its tables (migration 20261104120000_workflows.sql). If the migration has not been applied (Postgres 42P01, a
// missing table, or 42703, a missing column) every read answers "nothing yet" and every change answers in plain words, never an error page.
export const NEEDS_UPDATE = "Needs the latest database update. Ask the person who manages SubSync to apply it, then try again.";
export class NeedsUpdate extends Error { constructor() { super(NEEDS_UPDATE); } }
export function isMissing(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  const c = e?.code ?? e?.cause?.code;
  return c === "42P01" || c === "42703";
}
async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try { return await run(); } catch (e) { if (isMissing(e)) return fallback; throw e; }
}

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const num = (v: unknown) => (typeof v === "number" ? v : v === null || v === undefined ? null : Number(v));
const idList = (allowed: string[] | null) => allowed ?? [];

import type { LabelRow } from "./store-types";
export type { LabelRow };
export const keyOf = (locationId: string, workflowId: string) => `${locationId}|${workflowId}`;

export async function loadItems(installationId: string, allowed: string[] | null): Promise<{ items: WfItem[]; available: boolean }> {
  try {
    const rows = await sql()`
      select location_id, workflow_id, name, status, kind, folder_id, version, ui_url, remote_created_at, remote_updated_at, updated_by, runs_30d, enrolled_30d, failed_30d, last_run_at, removed_seen_at
      from workflow_items where installation_id = ${installationId} ${allowed === null ? sql`` : sql`and location_id = any(${idList(allowed)}::text[])`}
      order by remote_updated_at desc nulls last limit 5000`;
    return {
      available: true,
      items: rows.map((r) => ({
        workflowId: r.workflow_id as string, locationId: r.location_id as string, name: r.name as string, status: r.status as WfStatus, kind: (r.kind as string | null) ?? null,
        folderId: (r.folder_id as string | null) ?? null, version: (r.version as string | null) ?? null, uiUrl: (r.ui_url as string | null) ?? null,
        createdAt: ms(r.remote_created_at), updatedAt: ms(r.remote_updated_at), updatedBy: (r.updated_by as string | null) ?? null,
        runs30d: num(r.runs_30d), enrolled30d: num(r.enrolled_30d), failed30d: num(r.failed_30d), lastRunAt: ms(r.last_run_at), removedSeenAt: ms(r.removed_seen_at),
      })),
    };
  } catch (e) {
    if (isMissing(e)) return { items: [], available: false };
    throw e;
  }
}

/** Saves one account's fresh list and records what changed since the last sync. Returns how many changes were noticed. */
export async function saveSync(installationId: string, locationId: string, fresh: WfItem[], opts: { complete: boolean; prefix: "workflow" | "campaign" }): Promise<number> {
  const db = sql();
  return safe(async () => {
    const isCampaign = opts.prefix === "campaign";
    const saved = await db`select workflow_id, name, status, remote_updated_at, removed_seen_at from workflow_items where installation_id = ${installationId} and location_id = ${locationId} and (workflow_id like 'campaign:%') = ${isCampaign}`;
    const firstSync = saved.length === 0;
    const savedItems = saved.map((s) => ({ workflowId: s.workflow_id as string, name: s.name as string, status: s.status as WfStatus, updatedAt: ms(s.remote_updated_at), removedSeenAt: ms(s.removed_seen_at) }));
    const seenIds = new Set(fresh.map((f) => f.workflowId));
    // A listing that was cut short must not turn missing rows into "removed".
    const diffs = diffObserved(opts.complete ? savedItems : savedItems.filter((s) => seenIds.has(s.workflowId)), fresh, firstSync);
    await db.begin(async (tx) => {
      if (fresh.length) {
        const rows = fresh.map((f) => ({
          workflow_id: f.workflowId, name: f.name, status: f.status, kind: f.kind, folder_id: f.folderId, version: f.version, ui_url: f.uiUrl,
          remote_created_at: f.createdAt ? new Date(f.createdAt).toISOString() : null, remote_updated_at: f.updatedAt ? new Date(f.updatedAt).toISOString() : null, updated_by: f.updatedBy,
          runs_30d: f.runs30d, enrolled_30d: f.enrolled30d, failed_30d: f.failed30d, last_run_at: f.lastRunAt ? new Date(f.lastRunAt).toISOString() : null,
        }));
        await tx`
          insert into workflow_items (installation_id, location_id, workflow_id, name, status, kind, folder_id, version, ui_url, remote_created_at, remote_updated_at, updated_by, runs_30d, enrolled_30d, failed_30d, last_run_at)
          select ${installationId}::uuid, ${locationId}, r.workflow_id, r.name, r.status, r.kind, r.folder_id, r.version, r.ui_url, r.remote_created_at::timestamptz, r.remote_updated_at::timestamptz, r.updated_by, r.runs_30d, r.enrolled_30d, r.failed_30d, r.last_run_at::timestamptz
          from jsonb_to_recordset(${tx.json(rows as never)}::jsonb) as r(workflow_id text, name text, status text, kind text, folder_id text, version text, ui_url text, remote_created_at text, remote_updated_at text, updated_by text, runs_30d int, enrolled_30d int, failed_30d int, last_run_at text)
          on conflict (installation_id, location_id, workflow_id) do update set
            name = excluded.name, status = excluded.status, kind = excluded.kind, folder_id = excluded.folder_id, version = excluded.version, ui_url = excluded.ui_url,
            remote_created_at = excluded.remote_created_at, remote_updated_at = excluded.remote_updated_at, updated_by = excluded.updated_by,
            runs_30d = coalesce(excluded.runs_30d, workflow_items.runs_30d), enrolled_30d = coalesce(excluded.enrolled_30d, workflow_items.enrolled_30d),
            failed_30d = coalesce(excluded.failed_30d, workflow_items.failed_30d), last_run_at = coalesce(excluded.last_run_at, workflow_items.last_run_at),
            last_seen_at = now(), removed_seen_at = null`;
      }
      const gone = diffs.filter((d) => d.kind === "removed").map((d) => d.workflowId);
      if (gone.length) await tx`update workflow_items set removed_seen_at = now() where installation_id = ${installationId} and location_id = ${locationId} and workflow_id = any(${gone}::text[])`;
      for (const d of diffs) {
        await tx`insert into workflow_changes (installation_id, location_id, workflow_id, kind, source, before, after) values (${installationId}, ${locationId}, ${d.workflowId}, ${d.kind}, 'observed', ${d.before ? tx.json(d.before as never) : null}, ${d.after ? tx.json(d.after as never) : null})`;
      }
    });
    return diffs.length;
  }, 0);
}

export async function loadLabels(installationId: string, allowed: string[] | null): Promise<Map<string, LabelRow>> {
  const rows = await safe(() => sql()`select location_id, workflow_id, labels, group_name, rating, decision, note, owner, updated_by, updated_at from workflow_labels where installation_id = ${installationId} ${allowed === null ? sql`` : sql`and location_id = any(${idList(allowed)}::text[])`}`, []);
  return new Map(rows.map((r) => [keyOf(r.location_id as string, r.workflow_id as string), {
    labels: (r.labels as string[]) ?? [], group: (r.group_name as string | null) ?? null, rating: num(r.rating), decision: (r.decision as LabelRow["decision"]) ?? null,
    note: (r.note as string | null) ?? null, owner: (r.owner as string | null) ?? null, updatedBy: (r.updated_by as string | null) ?? null, updatedAt: ms(r.updated_at),
  }]));
}

export type LabelPatch = Partial<Pick<LabelRow, "labels" | "group" | "rating" | "decision" | "note" | "owner">>;
export async function saveLabel(installationId: string, locationId: string, workflowId: string, patch: LabelPatch, by: string | null): Promise<void> {
  try {
    const [cur] = await sql()`select labels, group_name, rating, decision, note, owner from workflow_labels where installation_id = ${installationId} and location_id = ${locationId} and workflow_id = ${workflowId}`;
    const pick = <K extends keyof LabelPatch>(k: K, old: unknown) => (k in patch ? patch[k] : old);
    const next = {
      labels: pick("labels", cur?.labels ?? []) as string[], group: pick("group", cur?.group_name ?? null) as string | null, rating: pick("rating", cur?.rating ?? null) as number | null,
      decision: pick("decision", cur?.decision ?? null) as string | null, note: pick("note", cur?.note ?? null) as string | null, owner: pick("owner", cur?.owner ?? null) as string | null,
    };
    await sql()`
      insert into workflow_labels (installation_id, location_id, workflow_id, labels, group_name, rating, decision, note, owner, updated_by, updated_at)
      values (${installationId}, ${locationId}, ${workflowId}, ${next.labels}::text[], ${next.group}, ${next.rating}, ${next.decision}, ${next.note}, ${next.owner}, ${by}, now())
      on conflict (installation_id, location_id, workflow_id) do update set labels = excluded.labels, group_name = excluded.group_name, rating = excluded.rating, decision = excluded.decision, note = excluded.note, owner = excluded.owner, updated_by = excluded.updated_by, updated_at = now()`;
    await sql()`insert into workflow_changes (installation_id, location_id, workflow_id, kind, source, actor_name, after) values (${installationId}, ${locationId}, ${workflowId}, 'label', 'subsync', ${by}, ${sql().json({ fields: Object.keys(patch) } as never)})`;
  } catch (e) {
    if (isMissing(e)) throw new NeedsUpdate();
    throw e;
  }
}

export type ChangeRow = { id: number; locationId: string; workflowId: string; kind: string; source: string; actorName: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; outcome: string; undoes: number | null; at: number };
export async function loadChanges(installationId: string, allowed: string[] | null, limit = 300): Promise<ChangeRow[]> {
  const rows = await safe(() => sql()`select id::int, location_id, workflow_id, kind, source, actor_name, before, after, outcome, undoes::int, created_at from workflow_changes where installation_id = ${installationId} ${allowed === null ? sql`` : sql`and location_id = any(${idList(allowed)}::text[])`} order by created_at desc, id desc limit ${limit}`, []);
  return rows.map((r) => ({ id: r.id as number, locationId: r.location_id as string, workflowId: r.workflow_id as string, kind: r.kind as string, source: r.source as string, actorName: (r.actor_name as string | null) ?? null, before: (r.before as Record<string, unknown> | null) ?? null, after: (r.after as Record<string, unknown> | null) ?? null, outcome: r.outcome as string, undoes: (r.undoes as number | null) ?? null, at: ms(r.created_at) ?? 0 }));
}

export type NewChange = { installationId: string; locationId: string; workflowId: string; kind: string; actorKey: string | null; actorName: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; outcome: string; undoes?: number | null; opKey: string | null };
/** Appends one row. Returns null when the same op_key was already recorded (a repeated confirm). */
export async function appendChange(c: NewChange): Promise<number | null> {
  try {
    const [r] = await sql()`
      insert into workflow_changes (installation_id, location_id, workflow_id, kind, source, actor_key, actor_name, before, after, outcome, undoes, op_key)
      values (${c.installationId}, ${c.locationId}, ${c.workflowId}, ${c.kind}, 'subsync', ${c.actorKey}, ${c.actorName}, ${c.before ? sql().json(c.before as never) : null}, ${c.after ? sql().json(c.after as never) : null}, ${c.outcome}, ${c.undoes ?? null}, ${c.opKey})
      on conflict (installation_id, op_key) where op_key is not null do nothing returning id::int`;
    return r ? (r.id as number) : null;
  } catch (e) {
    if (isMissing(e)) throw new NeedsUpdate();
    throw e;
  }
}

export async function todayCounts(installationId: string, now: number): Promise<{ deletesToday: number; writesToday: number }> {
  const [r] = await safe(() => sql()`select count(*) filter (where kind = 'delete')::int d, count(*)::int w from workflow_changes where installation_id = ${installationId} and source = 'subsync' and outcome in ('done', 'dry_run') and kind in ('rename', 'publish', 'unpublish', 'delete', 'clone', 'restore') and created_at > ${new Date(now - 86_400_000)}`, [{ d: 0, w: 0 }]);
  return { deletesToday: (r?.d as number) ?? 0, writesToday: (r?.w as number) ?? 0 };
}

export async function saveSnapshot(installationId: string, locationId: string, workflowId: string, name: string, reason: string, definition: unknown): Promise<void> {
  try {
    await sql()`insert into workflow_snapshots (installation_id, location_id, workflow_id, name, reason, definition) values (${installationId}, ${locationId}, ${workflowId}, ${name}, ${reason}, ${sql().json((definition ?? {}) as never)})`;
  } catch (e) {
    if (isMissing(e)) throw new NeedsUpdate();
    throw e;
  }
}
export async function latestSnapshot(installationId: string, locationId: string, workflowId: string): Promise<{ name: string; definition: Record<string, unknown> } | null> {
  const [r] = await safe(() => sql()`select name, definition from workflow_snapshots where installation_id = ${installationId} and location_id = ${locationId} and workflow_id = ${workflowId} order by created_at desc, id desc limit 1`, []);
  return r ? { name: r.name as string, definition: r.definition as Record<string, unknown> } : null;
}

/** Updates our stored copy after a confirmed change (or in the demo, which has no CRM). */
export async function applyLocal(installationId: string, locationId: string, workflowId: string, patch: { name?: string; status?: WfStatus; remove?: boolean }): Promise<void> {
  await safe(async () => {
    if (patch.remove) await sql()`update workflow_items set removed_seen_at = now() where installation_id = ${installationId} and location_id = ${locationId} and workflow_id = ${workflowId}`;
    else await sql()`update workflow_items set name = coalesce(${patch.name ?? null}, name), status = coalesce(${patch.status ?? null}, status), remote_updated_at = now() where installation_id = ${installationId} and location_id = ${locationId} and workflow_id = ${workflowId}`;
  }, undefined);
}

export async function accountNames(installationId: string, allowed: string[] | null): Promise<Array<{ locationId: string; name: string; ignored: boolean }>> {
  const rows = await sql()`select location_id, coalesce(name, location_id) as name, ignored from locations where installation_id = ${installationId} ${allowed === null ? sql`` : sql`and location_id = any(${idList(allowed)}::text[])`} order by lower(coalesce(name, ''))`;
  return rows.map((r) => ({ locationId: r.location_id as string, name: r.name as string, ignored: Boolean(r.ignored) }));
}

// Our own history: one row per client account per day, so a trend exists that the CRM itself does not keep.
export async function recordDaily(installationId: string, items: WfItem[], failing: Set<string>, day: string): Promise<void> {
  await safe(async () => {
    const by = new Map<string, { total: number; failing: number; runs: number | null; errors: number | null }>();
    for (const w of items) {
      if (w.removedSeenAt) continue;
      const r = by.get(w.locationId) ?? { total: 0, failing: 0, runs: null, errors: null };
      r.total++;
      if (failing.has(`${w.locationId}|${w.workflowId}`)) r.failing++;
      if (w.runs30d !== null) { r.runs = (r.runs ?? 0) + w.runs30d; r.errors = (r.errors ?? 0) + (w.failed30d ?? 0); }
      by.set(w.locationId, r);
    }
    for (const [loc, r] of by) {
      await sql()`insert into workflow_daily (installation_id, location_id, day, total, failing, runs_30d, errors_30d) values (${installationId}, ${loc}, ${day}, ${r.total}, ${r.failing}, ${r.runs}, ${r.errors})
        on conflict (installation_id, location_id, day) do update set total = excluded.total, failing = excluded.failing, runs_30d = excluded.runs_30d, errors_30d = excluded.errors_30d`;
    }
  }, undefined);
}
export async function loadDaily(installationId: string, allowed: string[] | null, days = 90): Promise<Array<{ day: string; total: number; failing: number; runs: number | null; errors: number | null }>> {
  const rows = await safe(() => sql()`select day::text as day, sum(total)::int total, sum(failing)::int failing, sum(runs_30d)::int runs, sum(errors_30d)::int errors from workflow_daily where installation_id = ${installationId} ${allowed === null ? sql`` : sql`and location_id = any(${idList(allowed)}::text[])`} and day > current_date - ${days}::int group by day order by day`, []);
  return rows.map((r) => ({ day: r.day as string, total: r.total as number, failing: r.failing as number, runs: num(r.runs), errors: num(r.errors) }));
}

export async function finishChange(id: number, outcome: string, after: Record<string, unknown> | null): Promise<void> {
  await safe(() => sql()`update workflow_changes set outcome = ${outcome}, after = coalesce(${after ? sql().json(after as never) : null}, after) where id = ${id}`, undefined);
}
export async function findChange(installationId: string, allowed: string[] | null, id: number): Promise<{ change: ChangeRow; undone: boolean } | null> {
  const rows = await loadChanges(installationId, allowed, 1000);
  const c = rows.find((r) => r.id === id);
  return c ? { change: c, undone: rows.some((r) => r.undoes === id && r.outcome !== "failed") } : null;
}
