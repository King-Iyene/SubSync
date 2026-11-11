import { featureOn } from "../flags";
import { recordFromWebhook } from "../analytics/appointments3-record";
import { sql } from "../db";
import { safeError } from "../safe-log";
import { mapOpportunity } from "../sync/ghl-data";
import { cacheConversations } from "./live-cache";
import { crmSource } from "./live-read";
import { refreshLead } from "./live-route";

// Webhook events that update SubSync's copy within about a second, without a full re-read of the account. The caller has already verified the signature, dropped duplicates and
// found the installation. Everything is keyed by installation AND location, only for an account that belongs to that installation. Idempotent: the same event twice leaves the same
// rows. `skipResync` tells the caller the full area re-read is not needed (the daily and 15-minute syncs still heal anything missed).

type Body = Record<string, unknown>;
const rec = (v: unknown): Body => (v && typeof v === "object" ? (v as Body) : {});
const text = (...v: unknown[]) => { for (const x of v) if (typeof x === "string" && x) return x; return null; };
const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export const CONTACT_EVENTS = new Set(["ContactCreate", "ContactUpdate", "ContactTagUpdate", "ContactDndUpdate"]);
export const MESSAGE_EVENTS = new Set(["InboundMessage", "OutboundMessage", "ConversationUpdate", "ConversationUnreadWebhook"]);

export type Applied = { skipResync: boolean };

export async function applyLiveWebhook(
  a: { installationId: string; locationId: string; type: string | null; body: unknown },
  deps: { token: (locationId: string) => Promise<string> },
): Promise<Applied> {
  const none: Applied = { skipResync: false };
  const t = a.type;
  if (!t) return none;
  const root = rec(a.body), data = rec(root.data);
  try {
    const db = sql();
    const [own] = await db`select 1 from locations where installation_id = ${a.installationId} and location_id = ${a.locationId} and not ignored`;
    if (!own) return none;

    if (t === "ContactDelete") {
      const id = text(root.id, root.contactId, data.id, data.contactId);
      if (!id) return none;
      await db`delete from cached_contacts where installation_id = ${a.installationId} and location_id = ${a.locationId} and contact_id = ${id}`;
      return { skipResync: true };
    }
    if (CONTACT_EVENTS.has(t)) {
      const id = text(root.id, root.contactId, data.id, data.contactId);
      if (!id) return none;
      const ok = await withTimeout(refreshLead(a.installationId, await deps.token(a.locationId), a.locationId, id), 4000, false);
      return { skipResync: ok };
    }
    if (MESSAGE_EVENTS.has(t)) {
      const id = text(root.contactId, data.contactId);
      if (!id) return none;
      const token = await deps.token(a.locationId);
      const conv = await withTimeout(crmSource(token, a.locationId).conversation(id).catch(() => null), 4000, null);
      if (conv) await cacheConversations(a.installationId, a.locationId, [conv]);
      return none; // the conversation re-read also feeds the speed numbers: it still runs
    }
    if (t === "OpportunityDelete") {
      const id = text(root.id, data.id);
      if (!id) return none;
      await db`delete from cached_opportunities where installation_id = ${a.installationId} and location_id = ${a.locationId} and opportunity_id = ${id}`;
      return { skipResync: true };
    }
    if (t.startsWith("Opportunity")) {
      const o = mapOpportunity(Object.keys(data).length > 1 && data.id ? data : root);
      if (!o) return none;
      await db`
        insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, last_stage_change_at, last_status_change_at, last_action_at, created_remote_at, updated_remote_at, synced_at, assigned_to, source)
        values (${a.installationId}, ${a.locationId}, ${o.opportunityId}, ${o.pipelineId}, ${o.stageId}, ${o.contactId}, ${o.contactName}, ${o.name}, ${o.monetaryValue}, ${o.status}, ${o.lastStageChangeAt}, ${o.lastStatusChangeAt}, ${o.lastActionAt}, ${o.createdAt}, ${o.updatedAt}, now(), ${o.assignedTo}, ${o.source})
        on conflict (installation_id, location_id, opportunity_id) do update set
          pipeline_id = coalesce(excluded.pipeline_id, cached_opportunities.pipeline_id), stage_id = coalesce(excluded.stage_id, cached_opportunities.stage_id),
          contact_id = coalesce(excluded.contact_id, cached_opportunities.contact_id), name = coalesce(excluded.name, cached_opportunities.name),
          monetary_value = excluded.monetary_value, status = excluded.status,
          last_stage_change_at = coalesce(excluded.last_stage_change_at, cached_opportunities.last_stage_change_at),
          last_status_change_at = coalesce(excluded.last_status_change_at, cached_opportunities.last_status_change_at),
          last_action_at = coalesce(excluded.last_action_at, cached_opportunities.last_action_at), updated_remote_at = coalesce(excluded.updated_remote_at, cached_opportunities.updated_remote_at),
          synced_at = now(), assigned_to = excluded.assigned_to`;
      return { skipResync: true };
    }
    if (t === "AppointmentDelete") {
      const id = text(rec(root.appointment).id, root.id);
      if (!id) return none;
      if (await featureOn("appt_record")) await recordFromWebhook({ installationId: a.installationId, locationId: a.locationId, appointmentId: id, type: "AppointmentDelete" });
      await db`delete from cached_appointments where installation_id = ${a.installationId} and location_id = ${a.locationId} and appointment_id = ${id}`;
      return { skipResync: true };
    }
    if (t === "AppointmentUpdate") {
      const ap = rec(root.appointment);
      const id = text(ap.id, root.id);
      const status = text(ap.appointmentStatus, ap.status);
      if (!id || !status) return none;
      const norm = status.toLowerCase().replace(/[\s_-]/g, "");
      const st = norm === "canceled" ? "cancelled" : norm === "noshow" ? "noshow" : norm;
      const start = text(ap.startTime), end = text(ap.endTime);
      // The payload has no previous status: the recorder compares it with the stored row, before the row is updated (flag appt_record).
      if (await featureOn("appt_record")) await recordFromWebhook({ installationId: a.installationId, locationId: a.locationId, appointmentId: id, type: "AppointmentUpdate", next: { status: st, startAt: start ? Date.parse(start) : null, ownerId: text(ap.assignedUserId) || null } });
      const done = await db`
        update cached_appointments set status = ${st}, start_at = coalesce(${start ? new Date(start) : null}, start_at), end_at = coalesce(${end ? new Date(end) : null}, end_at),
          assigned_to = coalesce(${text(ap.assignedUserId)}, assigned_to), synced_at = now()
        where installation_id = ${a.installationId} and location_id = ${a.locationId} and appointment_id = ${id} returning 1`;
      return { skipResync: done.length > 0 }; // an appointment SubSync has not seen yet still needs the re-read
    }
  } catch (e) {
    console.error("live webhook not applied", { type: t, message: safeError(e) });
  }
  return none;
}
