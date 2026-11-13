import { randomUUID } from "node:crypto";
import { sql } from "../db";
import { resolveEntitlements } from "../flags";
import { writeToCrm, buildTags } from "../ghl/crm-writes";
import { recordWrite } from "../ghl/crm-gateway";
import { writeAppointment } from "../ghl/appointment-gateway";
import { applyLocal, loadFacts, logAppt } from "../analytics/appointment-actions-queries";
import { locationAccessToken } from "../sync/engine";
import { getSettings, modeFor } from "../dial/callqueue-run";
import { handleAction, type ActionDeps, type WriteOutcome } from "./actions";
import { runTriggers, type FireDeps, type FireReport } from "./fire";
import { candidates, claimCall, alreadySent, finishCall, isEnabled, recentCalls, recordFired, sentCounts, targets, tenantOf, type Target } from "./store";

// Real wiring for the workflow module: SubSync's own database, the one write gateway, the platform's account tokens. Nothing in tests reaches this file with a real network.

export async function wfModuleOn(installationId: string): Promise<boolean> {
  return (await resolveEntitlements("pro", installationId)).features.wf_module === true;
}

const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export const realActionDeps: ActionDeps = {
  tenantOf,
  flagOn: wfModuleOn,
  enabled: isEnabled,
  recentCalls: (i, l) => recentCalls(i, l, 60),
  claim: claimCall,
  finish: finishCall,
  contact: async (i, l, c) => {
    const [r] = await sql()`select dnd, tags from cached_contacts where installation_id = ${i} and location_id = ${l} and contact_id = ${c}`;
    return r ? { exists: true, dnd: r.dnd === true, tags: (r.tags as string[] | null) ?? [] } : { exists: false, dnd: false, tags: [] };
  },
  queueTag: async (i, l) => (await getSettings(i, l)).s.tag,
  addTag: async (a): Promise<WriteOutcome> => {
    const mode = await modeFor(a.installationId, a.locationId);
    const r = await writeToCrm({ installationId: a.installationId, locationId: a.locationId, contactId: a.contactId, request: buildTags({ contactId: a.contactId, tags: [a.tag] }), token: () => locationAccessToken(a.companyId, a.locationId) }, mode.optedIn ? {} : { env: {} });
    await recordWrite({ installationId: a.installationId, actor: "workflow", locationId: a.locationId, contactId: a.contactId, op: "workflow.add_to_call_queue", fields: ["tags"], result: r.outcome }).catch(() => undefined);
    if (r.outcome === "written") {
      const db = sql();
      await db`insert into call_queue_log (installation_id, location_id, contact_id, action, source, status) values (${a.installationId}, ${a.locationId}, ${a.contactId}, 'add', 'workflow', 'saved')`.catch(() => undefined);
      await db`update cached_contacts set tags = array_append(tags, ${a.tag}) where installation_id = ${a.installationId} and location_id = ${a.locationId} and contact_id = ${a.contactId} and not (${a.tag} = any(coalesce(tags, '{}')))`.catch(() => undefined);
      return "done";
    }
    return r.outcome === "dry_run" ? "dry_run" : r.outcome === "needs_permission" ? "needs_permission" : "failed";
  },
  appointment: async (i, l, id) => {
    const [f] = await loadFacts(i, l, [id]);
    return f ? { appointmentId: f.appointmentId, contactId: f.contactId, status: f.status, startAt: f.startAt, contactName: f.contactName } : null;
  },
  latestPastAppointment: async (i, l, c, now) => {
    const [r] = await sql()`select appointment_id from cached_appointments where installation_id = ${i} and location_id = ${l} and contact_id = ${c} and start_at < ${new Date(now)} and start_at > ${new Date(now - 7 * 86_400_000)} order by start_at desc limit 1`;
    return (r?.appointment_id as string | undefined) ?? null;
  },
  setOutcome: async (a): Promise<WriteOutcome> => {
    const mode = await modeFor(a.installationId, a.locationId);
    const r = await writeAppointment({ installationId: a.installationId, locationId: a.locationId, actor: "workflow", contactId: a.contactId, optedIn: mode.optedIn, token: () => locationAccessToken(a.companyId, a.locationId), op: "update", appointmentId: a.appointmentId, patch: { status: a.status } });
    if (r.outcome === "done") {
      await applyLocal(a.installationId, a.locationId, a.appointmentId, { status: a.status }).catch(() => undefined);
      await logAppt(a.installationId, [{ locationId: a.locationId, batchId: randomUUID(), action: "status", appointmentId: a.appointmentId, contactId: a.contactId, before: {}, after: { status: a.status }, result: "done", actor: "workflow" }]);
      return "done";
    }
    return r.outcome === "dry_run" ? "dry_run" : r.outcome === "needs_permission" ? "needs_permission" : "failed";
  },
};

export const runAction = (raw: unknown) => handleAction(raw, realActionDeps);

export const realFireDeps: FireDeps = {
  candidates, counts: (t, k) => sentCounts(t.installationId, t.locationId, k), alreadySent, record: recordFired,
  token: (t: Target) => companyOf(t.installationId).then((c) => locationAccessToken(c, t.locationId)),
};
async function companyOf(installationId: string): Promise<string> {
  const [r] = await sql()`select company_id from installations where id = ${installationId}`;
  return r!.company_id as string;
}

/** The hourly-ish job: only companies with the flag on, only accounts with a trigger switched on and a subscription. */
export async function runWorkflowTriggers(now = Date.now()): Promise<FireReport> {
  let all: Target[];
  try { all = await targets(); } catch (e) { if (missing(e)) return { accounts: 0, sent: 0, wouldSend: 0, held: 0, skipped: 0, failed: 0 }; throw e; }
  const on = new Map<string, boolean>();
  const live: Target[] = [];
  for (const t of all) { if (!on.has(t.installationId)) on.set(t.installationId, await wfModuleOn(t.installationId)); if (on.get(t.installationId)) live.push(t); }
  return runTriggers(now, realFireDeps, live);
}
