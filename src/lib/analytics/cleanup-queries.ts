import { sql } from "../db";
import { safeError } from "../safe-log";
import { planChanges, summarise, type ContactLite, type Params } from "./cleanup-intel";
import type { ChangeRow, Outcome, Writer } from "./cleanup-writer";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

export const PREVIEW_VALID_HOURS = 24;

async function loadContacts(installationId: string, locationId: string): Promise<ContactLite[]> {
  const rows = await sql()`
    select contact_id, first_name, last_name, phone, email, tags, last_activity_at, date_added, source
    from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} limit 40000`;
  return rows.map((r) => ({
    id: r.contact_id as string, firstName: r.first_name as string | null, lastName: r.last_name as string | null, phone: r.phone as string | null,
    email: r.email as string | null, tags: (r.tags as string[]) ?? [], lastActivityAt: ms(r.last_activity_at), dateAdded: ms(r.date_added), source: r.source as string | null,
  }));
}

// A preview plans the changes and saves the plan. Nothing is changed in the client's account.
export async function createPreview(installationId: string, locationId: string, actor: string | null, params: Params) {
  const db = sql();
  const contacts = await loadContacts(installationId, locationId);
  const { changes, truncated } = planChanges(contacts, params);
  const [run] = await db`
    insert into cleanup_runs (installation_id, location_id, params, total, truncated, actor)
    values (${installationId}, ${locationId}, ${db.json(params as never)}, ${changes.length}, ${truncated}, ${actor}) returning id`;
  for (let i = 0; i < changes.length; i += 500) {
    const rows = changes.slice(i, i + 500).map((c) => ({
      run_id: run.id, installation_id: installationId, location_id: locationId, contact_id: c.contactId, rule: c.rule, field: c.field,
      before_value: c.before, after_value: c.after, tag: c.tag ?? null,
    }));
    await db`insert into cleanup_changes ${db(rows as never)}`;
  }
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'cleanup.preview', ${db.json({ runId: run.id, locationId, total: changes.length } as never)})`;
  return { runId: run.id as string, summary: summarise(changes), total: changes.length, truncated, scanned: contacts.length };
}

export type RunRow = {
  id: string; locationId: string; locationName: string | null; status: string; total: number; applied: number; skipped: number; failed: number; undone: number;
  truncated: boolean; note: string | null; createdAt: string | null; appliedAt: string | null; undoneAt: string | null; params: Params;
};

const mapRun = (r: Record<string, unknown>): RunRow => ({
  id: r.id as string, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? null, status: r.status as string, total: r.total as number,
  applied: r.applied as number, skipped: r.skipped as number, failed: r.failed as number, undone: r.undone as number, truncated: r.truncated === true,
  note: r.note as string | null, createdAt: iso(r.created_at), appliedAt: iso(r.applied_at), undoneAt: iso(r.undone_at), params: r.params as Params,
});

export async function listRuns(installationId: string, allowed: string[] | null, limit = 20): Promise<RunRow[]> {
  const db = sql();
  const rows = await db`
    select r.*, l.name location_name from cleanup_runs r left join locations l on l.installation_id = r.installation_id and l.location_id = r.location_id
    where r.installation_id = ${installationId} ${allowed ? db`and r.location_id = any(${allowed}::text[])` : db``} order by r.created_at desc limit ${limit}`;
  return rows.map(mapRun);
}

export async function getRun(installationId: string, allowed: string[] | null, id: string): Promise<RunRow | null> {
  const db = sql();
  const [r] = await db`
    select r.*, l.name location_name from cleanup_runs r left join locations l on l.installation_id = r.installation_id and l.location_id = r.location_id
    where r.id = ${id} and r.installation_id = ${installationId} ${allowed ? db`and r.location_id = any(${allowed}::text[])` : db``}`;
  return r ? mapRun(r) : null;
}

export async function sampleChanges(runId: string, limit = 60) {
  const rows = await sql()`
    select ch.contact_id, ch.rule, ch.field, ch.before_value, ch.after_value, ch.tag, ch.status, ch.error,
      coalesce(nullif(c.full_name, ''), c.email, ch.contact_id) name
    from cleanup_changes ch
    left join cached_contacts c on c.installation_id = ch.installation_id and c.location_id = ch.location_id and c.contact_id = ch.contact_id
    where ch.run_id = ${runId} order by ch.id limit ${limit}`;
  return rows.map((r) => ({
    contactId: r.contact_id as string, name: r.name as string, rule: r.rule as string, field: r.field as string, before: r.before_value as string | null,
    after: r.after_value as string | null, tag: r.tag as string | null, status: r.status as string, error: r.error as string | null,
  }));
}

// Work through the pending changes until the time budget runs out. Call it again to continue: each
// call picks up where the last one stopped, so a long run survives a page reload.
async function work(installationId: string, run: RunRow, mode: "apply" | "undo", writer: Writer, mirror: boolean, budgetMs: number, actor: string | null): Promise<RunRow> {
  const db = sql();
  const from = mode === "apply" ? "pending" : "applied";
  const deadline = Date.now() + budgetMs;
  await db`update cleanup_runs set status = ${mode === "apply" ? "applying" : "undoing"}, applied_at = case when ${mode === "apply"} and applied_at is null then now() else applied_at end where id = ${run.id}`;
  let permissionStop = false;
  let heldBack = false;
  let heldNote: string | null = null;
  while (Date.now() < deadline && !permissionStop && !heldBack) {
    const batch = await db`select id, contact_id, rule, field, before_value, after_value, tag from cleanup_changes where run_id = ${run.id} and status = ${from} order by id limit 20`;
    if (batch.length === 0) break;
    for (const r of batch) {
      if (Date.now() >= deadline) break;
      const change: ChangeRow = { id: Number(r.id), contactId: r.contact_id as string, rule: r.rule as string, field: r.field as string, before: r.before_value as string | null, after: r.after_value as string | null, tag: r.tag as string | null };
      let outcome: Outcome;
      try {
        outcome = mode === "apply" ? await writer.apply(change) : await writer.revert(change);
      } catch (error) {
        outcome = { result: "failed", detail: safeError(error) };
      }
      if (outcome.result === "permission") { permissionStop = true; break; }
      // Nothing was sent (the switch is off, or the account has not allowed changes): the change stays as it was and the run says so.
      if (outcome.result === "dry_run") { heldBack = true; heldNote = outcome.detail ?? "Nothing was sent."; break; }
      const status = outcome.result === "applied" ? (mode === "apply" ? "applied" : "undone") : outcome.result === "skipped" ? "skipped" : "failed";
      await db`update cleanup_changes set status = ${status}, error = ${outcome.detail ?? null} where id = ${change.id}`;
      if (mirror && outcome.result === "applied") await mirrorLocal(installationId, run.locationId, change, mode);
    }
  }
  const [c] = await db`
    select count(*) filter (where status = 'pending')::int pending, count(*) filter (where status = 'applied')::int applied, count(*) filter (where status = 'skipped')::int skipped,
      count(*) filter (where status = 'failed')::int failed, count(*) filter (where status = 'undone')::int undone from cleanup_changes where run_id = ${run.id}`;
  const finished = !heldBack && (mode === "apply" ? c.pending === 0 : c.applied === 0);
  const status = heldBack ? (mode === "apply" ? (c.applied > 0 ? "partial" : "previewed") : "applied")
    : permissionStop ? "needs_permission"
    : mode === "apply" ? (finished ? (c.failed > 0 || c.skipped > 0 ? "partial" : "applied") : "applying")
    : finished ? "undone" : "undoing";
  const note = heldBack ? `${heldNote ?? "Nothing was sent."} Your changes are saved and still waiting; nothing in your CRM was changed.`
    : permissionStop ? "SubSync does not have permission to change contacts in this account yet. Nothing was changed. Approve the write permission, then run this again." : null;
  await db`update cleanup_runs set status = ${status}, applied = ${c.applied}, skipped = ${c.skipped}, failed = ${c.failed}, undone = ${c.undone}, note = ${note},
    undone_at = case when ${status === "undone"} then now() else undone_at end where id = ${run.id}`;
  if (finished || permissionStop) {
    await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, ${"cleanup." + mode + (permissionStop ? "_blocked" : "_done")},
      ${db.json({ runId: run.id, locationId: run.locationId, applied: c.applied, skipped: c.skipped, failed: c.failed, undone: c.undone } as never)})`;
  }
  return (await getRun(installationId, null, run.id)) as RunRow;
}

// After a real change the platform copy has changed, so our cached copy is brought in line at once
// (the next sync would do it anyway). Demo changes already touch the copy.
async function mirrorLocal(installationId: string, locationId: string, c: ChangeRow, mode: "apply" | "undo") {
  const db = sql();
  const [cur] = await db`select tags from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${c.contactId}`;
  if (!cur) return;
  if (c.rule === "tag") {
    const name = c.tag ?? "";
    const wantTag = mode === "apply" ? c.after === "with" : c.before === "with";
    const base = ((cur.tags as string[]) ?? []).filter((t) => t.toLowerCase() !== name.toLowerCase());
    await db`update cached_contacts set tags = ${wantTag ? [...base, name] : base} where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${c.contactId}`;
    return;
  }
  const value = mode === "apply" ? c.after : c.before;
  const col = c.field === "firstName" ? "first_name" : c.field === "lastName" ? "last_name" : c.field === "email" ? "email" : "phone";
  await db`update cached_contacts set ${db(col)} = ${value} where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${c.contactId}`;
}

export async function applyRun(installationId: string, run: RunRow, writer: Writer, mirror: boolean, actor: string | null, budgetMs = 40_000): Promise<RunRow> {
  return work(installationId, run, "apply", writer, mirror, budgetMs, actor);
}

export async function undoRun(installationId: string, run: RunRow, writer: Writer, mirror: boolean, actor: string | null, budgetMs = 40_000): Promise<RunRow> {
  return work(installationId, run, "undo", writer, mirror, budgetMs, actor);
}

export async function installationHasScope(installationId: string, scope: string): Promise<boolean> {
  const [r] = await sql()`select scope from installations where id = ${installationId}`;
  return typeof r?.scope === "string" && r.scope.split(/\s+/).includes(scope);
}
