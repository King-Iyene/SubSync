import { sql } from "../db";
import type { DealFacts, DealPatch, PipelineRef } from "./pipeline-actions";

// The data behind changing deals (Pipeline module, slice PB). Every query names the installation (from the verified session) AND one location the router already proved the caller
// may read. Ids sent by the browser only ever pick rows INSIDE that pair. Nothing stored here is a name, a note or a message: the action log keeps ids, a status, a number and a
// reason code.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const DAY = 86_400_000;

export async function loadDeals(installationId: string, locationId: string, ids: readonly string[]): Promise<DealFacts[]> {
  if (ids.length === 0) return [];
  const rows = await sql()`
    select o.opportunity_id, o.pipeline_id, o.pipeline_name, o.stage_id, o.stage_name, o.contact_id, o.name, o.monetary_value, o.status, o.assigned_to, o.last_stage_change_at,
      coalesce(nullif(btrim(ct.full_name), ''), nullif(btrim(o.contact_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), ''), 'Unknown contact') cname,
      coalesce(ct.dnd, false) dnd,
      (select count(*)::int from cached_appointments a where a.installation_id = o.installation_id and a.location_id = o.location_id and a.contact_id = o.contact_id and a.start_at > now() and coalesce(lower(a.status), '') not in ('cancelled', 'canceled', 'invalid')) upcoming
    from cached_opportunities o
    left join cached_contacts ct on ct.installation_id = o.installation_id and ct.location_id = o.location_id and ct.contact_id = o.contact_id
    where o.installation_id = ${installationId} and o.location_id = ${locationId} and o.opportunity_id = any(${[...ids]}::text[])`;
  return rows.map((r) => ({
    opportunityId: r.opportunity_id as string, locationId, pipelineId: (r.pipeline_id as string | null) ?? null, pipelineName: (r.pipeline_name as string | null) ?? null, stageId: (r.stage_id as string | null) ?? null,
    stageName: (r.stage_name as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null, contactName: r.cname as string, name: ((r.name as string | null) ?? "").trim(),
    value: r.monetary_value == null ? null : Number(r.monetary_value), status: (r.status as string | null) ?? null, assignedTo: (r.assigned_to as string | null) ?? null,
    contactDnd: r.dnd === true, upcomingAppointments: Number(r.upcoming), lastStageChangeAt: iso(r.last_stage_change_at),
  }));
}

/** The pipelines of one account with their stages in order (at most 30 pipelines, 60 stages each). */
export async function pipelinesOf(installationId: string, locationId: string): Promise<PipelineRef[]> {
  const rows = await sql()`select pipeline_id, name, stages from pipelines where installation_id = ${installationId} and location_id = ${locationId} order by name limit 30`;
  return rows.map((r) => ({ id: r.pipeline_id as string, name: (r.name as string | null) ?? "Pipeline", stages: ((r.stages as Array<{ id: string; name: string }> | null) ?? []).slice(0, 60).map((s) => ({ id: s.id, name: s.name })) }));
}

/** The account's time zone name (null when unknown). */
export async function zoneOf(installationId: string, locationId: string): Promise<string | null> {
  try { const [r] = await sql()`select timezone from locations where installation_id = ${installationId} and location_id = ${locationId}`; return (r?.timezone as string | null) ?? null; } catch { return null; }
}

// ---------------- the audit log and undo ----------------

export type DealLogRow = {
  locationId: string; batchId: string; action: "stage" | "owner" | "value" | "status" | "rename" | "note" | "task" | "remove" | "undo"; opportunityId: string | null; contactId: string | null;
  before: Record<string, unknown>; after: Record<string, unknown>; lostReason?: string | null; result: string; actor: string | null;
};
export async function logDeal(installationId: string, rows: readonly DealLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = sql();
    await db`insert into pipeline_actions ${db(rows.map((r) => ({ installation_id: installationId, location_id: r.locationId, batch_id: r.batchId, action: r.action, opportunity_id: r.opportunityId, contact_id: r.contactId, before_value: db.json(r.before as never), after_value: db.json(r.after as never), lost_reason: r.lostReason ?? null, result: r.result, actor: r.actor })))}`;
  } catch { /* the table may not be applied yet; the audit_log line from the gateway still exists */ }
}

export type FeedRow = { at: string; source: "subsync" | "crm"; text: string; batchId: string | null; undoable: boolean; actor: string | null };

const WORD: Record<string, string> = {
  stage: "Moved from SubSync", owner: "Owner changed from SubSync", value: "Value changed from SubSync", status: "Status changed from SubSync", rename: "Renamed from SubSync",
  note: "Note added from SubSync", task: "Task created from SubSync", remove: "Removed from SubSync", undo: "Change put back from SubSync",
};

/** One deal's change timeline: what the platform told us (stage and status changes) and everything done from SubSync, oldest first. Undoable only while open and not undone. */
export async function timeline(installationId: string, locationId: string, opportunityId: string, undoMinutes: number): Promise<FeedRow[]> {
  const db = sql();
  const [ev, act, pls] = await Promise.all([
    db`select kind, from_value, to_value, value, at from deal_events where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${opportunityId} order by at limit 80`.catch(() => []),
    db`select action, batch_id, result, actor, created_at, before_value, lost_reason from pipeline_actions where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${opportunityId} order by created_at limit 80`.catch(() => []),
    db`select stages from pipelines where installation_id = ${installationId} and location_id = ${locationId}`.catch(() => []),
  ]);
  const stage = new Map<string, string>();
  for (const p of pls) for (const s of (p.stages as Array<{ id: string; name: string }> | null) ?? []) stage.set(s.id, s.name);
  const sn = (id: string | null) => (id ? stage.get(id) ?? "another stage" : null);
  const undone = new Set(act.filter((r) => r.action === "undo" && r.result === "done").map((r) => (r.before_value as { batchId?: string } | null)?.batchId).filter(Boolean) as string[]);
  const out: FeedRow[] = [];
  for (const e of ev) {
    const k = e.kind as string, from = (e.from_value as string | null) ?? null, to = (e.to_value as string | null) ?? null;
    const text = k === "created"
      ? `Deal created${e.value != null && Number(e.value) > 0 ? `, worth $${Math.round(Number(e.value)).toLocaleString("en-US")}` : ""}`
      : k === "stage" ? `Moved${sn(from) ? ` from ${sn(from)}` : ""}${sn(to) ? ` to ${sn(to)}` : ""}` : `Status${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`;
    out.push({ at: iso(e.at) as string, source: "crm", text, batchId: null, undoable: false, actor: null });
  }
  for (const r of act) {
    const at = iso(r.created_at) as string;
    const dry = r.result === "dry_run";
    const open = r.result === "done" && !undone.has(r.batch_id as string) && !["undo", "remove", "note", "task"].includes(r.action as string) && Date.now() - Date.parse(at) < undoMinutes * 60_000;
    const reason = r.lost_reason ? ` (reason: ${String(r.lost_reason).replace(/_/g, " ")})` : "";
    out.push({ at, source: "subsync", text: `${WORD[r.action as string] ?? "Changed from SubSync"}${reason}${dry ? " (practice run, nothing sent)" : r.result === "done" ? "" : ` (${String(r.result).replace(/_/g, " ")})`}`, batchId: r.batch_id as string, undoable: open, actor: (r.actor as string | null) ?? null });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export async function batchRows(installationId: string, locationId: string, batchId: string) {
  const rows = await sql()`select action, opportunity_id, contact_id, before_value, created_at from pipeline_actions where installation_id = ${installationId} and location_id = ${locationId} and batch_id = ${batchId} and result = 'done' and action in ('stage', 'owner', 'value', 'status', 'rename')`.catch(() => []);
  const undone = await sql()`select 1 from pipeline_actions where installation_id = ${installationId} and action = 'undo' and result = 'done' and before_value->>'batchId' = ${batchId} limit 1`.catch(() => []);
  return undone.length ? [] : rows.map((r) => ({ action: r.action as string, opportunityId: r.opportunity_id as string, contactId: (r.contact_id as string | null) ?? null, before: (r.before_value as Record<string, unknown>) ?? {}, at: iso(r.created_at) as string }));
}

/**
 * Was this change of ours? True when a finished write of SubSync's own touched the deal in the last `windowMs`. The deal history recorder and the metrics call this so the platform's
 * echo of our own change is never counted as the team's activity (rule 14). Read only.
 */
export async function ownWriteSince(installationId: string, locationId: string, opportunityId: string, windowMs = 10 * 60_000): Promise<boolean> {
  try {
    const rows = await sql()`select 1 from pipeline_actions where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${opportunityId} and result = 'done' and action <> 'undo' and created_at > ${new Date(Date.now() - windowMs).toISOString()} limit 1`;
    return rows.length > 0;
  } catch { return false; }
}

/** SubSync's own copy follows a change right away (the next sync would too), so the screen is right at once. Never writes anything to the CRM. */
export async function applyLocal(installationId: string, locationId: string, opportunityId: string, patch: DealPatch, pipelines: readonly PipelineRef[]): Promise<void> {
  const pl = patch.pipelineId ? pipelines.find((p) => p.id === patch.pipelineId) : null;
  const stageIn = patch.stageId ? (pl ?? pipelines.find((p) => p.stages.some((s) => s.id === patch.stageId)))?.stages.find((s) => s.id === patch.stageId) : null;
  const db = sql();
  await db`update cached_opportunities set
      pipeline_id = coalesce(${patch.pipelineId ?? null}::text, pipeline_id), pipeline_name = coalesce(${pl?.name ?? null}::text, pipeline_name),
      stage_id = coalesce(${patch.stageId ?? null}::text, stage_id), stage_name = coalesce(${stageIn?.name ?? null}::text, stage_name),
      status = coalesce(${patch.status ?? null}::text, status), monetary_value = coalesce(${patch.value ?? null}::numeric, monetary_value),
      assigned_to = coalesce(${patch.assignedTo ?? null}::text, assigned_to), name = coalesce(${patch.name ?? null}::text, name),
      last_stage_change_at = case when ${patch.stageId ?? null}::text is not null then now() else last_stage_change_at end,
      last_status_change_at = case when ${patch.status ?? null}::text is not null then now() else last_status_change_at end
    where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${opportunityId}`;
}
export async function dropLocal(installationId: string, locationId: string, opportunityIds: readonly string[]): Promise<void> {
  if (opportunityIds.length === 0) return;
  await sql()`delete from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = any(${[...opportunityIds]}::text[])`;
}

// ---------------- the deal panel ----------------

export type PanelFacts = {
  facts: DealFacts; locationName: string | null; source: string | null; createdAt: string | null; dwellDays: number | null; medianDwellDays: number | null;
  contact: { phone: string | null; email: string | null; dnd: boolean } | null;
  appointments: Array<{ id: string; startAt: string | null; status: string | null; calendar: string | null }>;
  otherDeals: number; lostReason: string | null;
};
/** One deal's panel: only inside an account the caller may read. Median dwell is this stage's own median over this account's open deals (null under 5 deals: nothing is invented). */
export async function panelFacts(installationId: string, locationId: string, opportunityId: string): Promise<PanelFacts | null> {
  const [facts] = await loadDeals(installationId, locationId, [opportunityId]);
  if (!facts) return null;
  const db = sql();
  const [meta] = await db`select o.source, o.created_remote_at, l.name location_name from cached_opportunities o left join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id where o.installation_id = ${installationId} and o.location_id = ${locationId} and o.opportunity_id = ${opportunityId}`.catch(() => []);
  const [ct] = facts.contactId ? await db`select phone, email, coalesce(dnd, false) dnd from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${facts.contactId}` : [];
  const appts = facts.contactId ? await db`select appointment_id, start_at, status, calendar_name from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${facts.contactId} order by start_at desc nulls last limit 6`.catch(() => []) : [];
  const [other] = facts.contactId ? await db`select count(*)::int n from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${facts.contactId} and opportunity_id <> ${opportunityId}`.catch(() => []) : [];
  const [med] = facts.stageId ? await db`select count(*)::int n, percentile_cont(0.5) within group (order by extract(epoch from (now() - last_stage_change_at)) / 86400.0) m from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and stage_id = ${facts.stageId} and coalesce(status, 'open') = 'open' and last_stage_change_at is not null`.catch(() => []) : [];
  const [lost] = await db`select lost_reason from pipeline_actions where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${opportunityId} and result = 'done' and lost_reason is not null order by created_at desc limit 1`.catch(() => []);
  const dwell = facts.lastStageChangeAt ? Math.max(0, (Date.now() - Date.parse(facts.lastStageChangeAt)) / DAY) : null;
  return {
    facts, locationName: (meta?.location_name as string | null) ?? null, source: (meta?.source as string | null) || null, createdAt: iso(meta?.created_remote_at), dwellDays: dwell,
    medianDwellDays: med && Number(med.n) >= 5 && med.m != null ? Number(med.m) : null,
    contact: ct ? { phone: (ct.phone as string | null) ?? null, email: (ct.email as string | null) ?? null, dnd: ct.dnd === true } : null,
    appointments: appts.map((a) => ({ id: a.appointment_id as string, startAt: iso(a.start_at), status: (a.status as string | null) ?? null, calendar: (a.calendar_name as string | null) ?? null })),
    otherDeals: Number(other?.n ?? 0), lostReason: (lost?.lost_reason as string | null) ?? null,
  };
}
