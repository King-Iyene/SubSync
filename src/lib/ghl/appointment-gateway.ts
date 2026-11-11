import { outward } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { recordWrite, SPACING_MS, type GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";
import { LIMITS, takeSlot } from "./workbench.ts";
import type { HistEvent } from "../analytics/appointments3-diff.ts";
import type { ApptPlan } from "../analytics/appointment-actions.ts";

// The one door for changing appointments from SubSync (Appointments module, slice AB): create, update (status, time, owner, calendar, title) and delete. Same switches as the
// other gateways: WRITE_GHL_LIVE off unless exactly "true", the account's own opt-in, a preview first (the route), a typed confirmation before a delete (the route checks it
// again), one audit line per write with ids and field names only, calls spaced under the platform's limit. Off or not allowed: the request is built, "WOULD WRITE ..." is
// recorded and NOTHING is sent. Needs the optional permission calendars/events.write; without it the answer is needs_permission ("Needs permission: reconnect").
// Request shapes follow the platform's published API description and are NOT VERIFIED LIVE.

export const APPT_WRITE_SCOPE = "calendars/events.write";
const VERSION = "2021-04-15";

export type ApptWriteResult =
  | { outcome: "dry_run"; line: string; reason: "switch" | "account" }
  | { outcome: "done"; id?: string }
  | { outcome: "needs_permission" }
  | { outcome: "rate_limited"; retryInSeconds: number }
  | { outcome: "failed"; status: number };

type Common = { installationId: string; locationId: string; actor: string | null; contactId: string | null; optedIn: boolean; token: () => Promise<string> };
export type ApptWrite =
  | (Common & { op: "update"; appointmentId: string; patch: NonNullable<ApptPlan["patch"]>; allowOverlap?: boolean })
  | (Common & { op: "delete"; appointmentId: string })
  | (Common & { op: "create"; create: { calendarId: string; startAt: string; endAt: string; assignedTo: string | null; title: string; allowOverlap: boolean } });

/** The request body for an update. Pure, so the tests can read it. */
export function updateBody(patch: NonNullable<ApptPlan["patch"]>, allowOverlap = false): Record<string, unknown> {
  const b: Record<string, unknown> = { toNotify: false };
  if (patch.status) b.appointmentStatus = patch.status;
  if (patch.startAt) b.startTime = patch.startAt;
  if (patch.endAt) b.endTime = patch.endAt;
  if (patch.title !== undefined) b.title = patch.title;
  if (patch.calendarId) b.calendarId = patch.calendarId;
  if (patch.assignedUserId) b.assignedUserId = patch.assignedUserId;
  // Only a person who ticked "Book anyway" may skip the platform's own free-slot check.
  if (allowOverlap) b.ignoreFreeSlotValidation = true;
  return b;
}
const fieldsOf = (patch: NonNullable<ApptPlan["patch"]>) => Object.keys(updateBody(patch)).filter((k) => k !== "toNotify" && k !== "ignoreFreeSlotValidation");

/**
 * The marker rows for a finished write of ours, for appointment_history (actor_kind 'subsync'): the platform's echo of the same change, a moment later, matches them by kind and
 * value and is also marked ours, so our own writes never count as the team's activity. Pure, so the tests can read it.
 */
export function ownMarkers(a: ApptWrite, at: number, newId?: string): HistEvent[] {
  const mk = (kind: HistEvent["kind"], to: string | null, id: string, startAt: number | null = null): HistEvent => ({ kind, key: `own|${kind}|${id}|${to ?? ""}|${Math.floor(at / 60_000)}`, from: null, to, at, actorId: null, actorKind: "subsync", startAt });
  if (a.op === "delete") return [mk("deleted", null, a.appointmentId)];
  if (a.op === "create") return newId ? [mk("created", null, newId)] : [];
  const p = a.patch, id = a.appointmentId, out: HistEvent[] = [];
  if (p.status) out.push(mk("status", p.status, id));
  if (p.startAt) out.push(mk("time", new Date(p.startAt).toISOString(), id, Date.parse(p.startAt)));
  if (p.assignedUserId) out.push(mk("owner", p.assignedUserId, id));
  if (p.calendarId) out.push(mk("calendar", p.calendarId, id));
  return out;
}

export async function writeAppointment(a: ApptWrite, deps: GatewayDeps = {}): Promise<ApptWriteResult> {
  const wait = takeSlot(`acct:${a.installationId}`, LIMITS.perAccountPerMinute, 60_000);
  if (wait) return { outcome: "rate_limited", retryInSeconds: wait };
  const env = a.optedIn ? deps.env : {};
  const what = a.op === "update" ? "crm.appointment.update" : a.op === "delete" ? "crm.appointment.delete" : "crm.appointment.create";
  const fields = a.op === "update" ? fieldsOf(a.patch) : a.op === "create" ? ["appointment"] : ["appointment"];
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: a.op === "delete" ? "DELETE" : "WRITE", what, installationId: a.installationId, ids: { locationId: a.locationId, ...(a.op === "create" ? {} : { appointmentId: a.appointmentId }), contactId: a.contactId ?? "" }, fields },
    async (): Promise<ApptWriteResult> => {
      await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(SPACING_MS);
      const headers = { Authorization: `Bearer ${await a.token()}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" };
      const opts = { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) };
      const seg = encodeURIComponent;
      const res = a.op === "delete"
        ? await ghlFetch(`${GHL_API}/calendars/events/${seg(a.appointmentId)}`, { method: "DELETE", headers, cache: "no-store" }, opts)
        : a.op === "update"
          ? await ghlFetch(`${GHL_API}/calendars/events/appointments/${seg(a.appointmentId)}`, { method: "PUT", headers, body: JSON.stringify(updateBody(a.patch, a.allowOverlap)), cache: "no-store" }, opts)
          : await ghlFetch(`${GHL_API}/calendars/events/appointments`, {
            method: "POST", headers, cache: "no-store",
            body: JSON.stringify({ calendarId: a.create.calendarId, locationId: a.locationId, contactId: a.contactId, startTime: a.create.startAt, endTime: a.create.endAt, title: a.create.title, appointmentStatus: "confirmed", ...(a.create.assignedTo ? { assignedUserId: a.create.assignedTo } : {}), toNotify: false, ...(a.create.allowOverlap ? { ignoreFreeSlotValidation: true } : {}) }),
          }, opts);
      let id: string | undefined;
      if (res.ok && a.op === "create") { try { const j = (await res.clone().json()) as { id?: unknown; appointment?: { id?: unknown } }; const v = j.id ?? j.appointment?.id; if (typeof v === "string") id = v; } catch { /* the id is a nicety */ } }
      // An appointment already gone (404) is what a delete wanted.
      const result: ApptWriteResult = res.status === 401 || res.status === 403 ? { outcome: "needs_permission" } : res.ok || (a.op === "delete" && res.status === 404) ? { outcome: "done", ...(id ? { id } : {}) } : { outcome: "failed", status: res.status };
      if (result.outcome === "done" && !deps.audit) {
        // Best effort, before the audit line: a marker that cannot be written must never turn a finished write into an error.
        try {
          const { recordHistory } = await import("../analytics/appointments3-record");
          await recordHistory({ installationId: a.installationId, locationId: a.locationId, appointmentId: a.op === "create" ? (result.id ?? "new") : a.appointmentId, contactId: a.contactId }, ownMarkers(a, Date.now(), result.id));
        } catch { /* the sweep marks the echo as ours by value and time as a second line of defence */ }
      }
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: a.contactId ?? ("appointmentId" in a ? a.appointmentId : "new"), op: `appointment.${a.op}`, fields, result: result.outcome }, deps);
      return result;
    },
    { ...deps, ...(env ? { env } : {}) },
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line, reason: a.optedIn ? "switch" : "account" };
}
