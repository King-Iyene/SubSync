import { randomUUID } from "node:crypto";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { installationHasScope } from "../analytics/cleanup-queries";
import {
  APPT_BATCH_CAPS, UNDO_MINUTES, beforeOf, bulkDeleteConfirmed, crmStatusOf, inversePatch, isId, parseAction, parseCreate, planAction, planBulk, planCreate, suggestSlots, statusWord,
  type ApptAction, type ApptFacts, type ApptPlan, type OutcomeChoice,
} from "../analytics/appointment-actions";
import {
  applyLocal, batchRows, calendarsOf, dropLocal, hourShowRates, loadFacts, logAppt, othersAround, panelFacts, timeline, zoneOf, type ApptLogRow,
} from "../analytics/appointment-actions-queries";
import { followUpNote, suggestOutcome } from "../analytics/appointment-meetings";
import {
  confirmOutcomeMark, connectionStatus, homeCounts, link as linkMeeting, needsMatching, noFollowUp, ownMeetingFor, rematchOwn,
} from "../analytics/appointment-meetings-queries";
import { contactFacts } from "../analytics/unanswered-actions-queries";
import { dryRunWords } from "../analytics/unanswered-actions";
import { APPT_WRITE_SCOPE, writeAppointment, type ApptWriteResult } from "../ghl/appointment-gateway";
import { failureText, runAction, type Action, type Target } from "../ghl/workbench";
import { isLive } from "../live-flags";
import type { Feature } from "../entitlements";
import { accountMembers } from "./workbench-routes";
import { ownedLocation } from "./tenant-guard";
import { json, type AuthContext } from "./auth";

// The Appointments ACTIONS and MEETINGS endpoints (slice AB), under /api/app/appointments/act/<part> and /api/app/appointments/meetings/<part>:
//   GET  act/panel      one appointment's panel: details, who booked and who owns it, deal, reminders, the full change timeline, this person's call, suggestions   appt_actions
//   GET  act/slots      the best free slots to move it to (no double booking, ranked by the account's own show rate by hour when it has enough history)           appt_actions
//   POST act/apply      one change (outcome, move, reassign, edit, delete): step "preview" then step "do"                                                     appt_actions / appt_delete
//   POST act/create     add an appointment (double-booking check)                                                                                               appt_actions
//   POST act/rebook     one tap: book the same person again at the best free slot (preview, then do)                                                            appt_actions
//   POST act/bulk       mark, reassign or delete several (one account at a time, capped, typed count for delete)                                               appt_bulk / appt_delete
//   POST act/undo       put a recent change back                                                                                                                appt_actions
//   GET  meetings/home | matching | followup, POST meetings/sync | match | followup-note                                                                      appt_meetings
// Who is asking and which accounts they may read come from the verified session (`ctx`, `h.allowed`), never from the request. A location id in the body only has to be one of those
// accounts; every appointment is then re-read from SubSync's copy of THAT account. Every CRM write goes through writeAppointment (appointment-gateway.ts) or runAction: preview first,
// dry run unless WRITE_GHL_LIVE and the account opt-in, one audit line per write. Nothing here sends a message to a lead. A recorded call is private to the person who recorded it.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type ApptActionHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof import("../links").deepLinks>>; locationToken: (locationId: string) => Promise<string> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
const isAdminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
/** A client's staff act only on appointments assigned to them; administrators and the agency act on any in their accounts. */
const mayTouch = (ctx: Ctx, assignedTo: string | null) => isAdminSide(ctx) || assignedTo === ctx.session.userId;

const mode = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};
async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}
async function accountOf(ctx: Ctx, h: ApptActionHelpers, v: unknown): Promise<string | null> {
  if (typeof v !== "string" || !ID.test(v)) return null;
  return ownedLocation(ctx.installationId, await h.allowed(), v);
}
const idList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const out = [...new Set(v.filter(isId))];
  return out.length === v.length ? out : null;
};
const resultWord = (r: ApptWriteResult) => r.outcome;
const permissionText = "Needs permission: reconnect SubSync so it may change appointments. Nothing was changed.";

export async function handleApptActions(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const area = ctx.segments[1];
  const part = ctx.segments[2];
  const m = ctx.request.method;
  if (area === "meetings") {
    if (!on(ctx, "appt_meetings")) return off();
    if (m === "GET" && part === "home") return meetingsHome(ctx, h);
    if (m === "GET" && part === "matching") return meetingsMatching(ctx, h);
    if (m === "GET" && part === "followup") return meetingsFollowUp(ctx, h);
    if (m === "POST" && part === "sync") return meetingsSync(ctx, h);
    if (m === "POST" && part === "match") return meetingsMatch(ctx, h);
    if (m === "POST" && part === "followup-note") return meetingsNote(ctx, h);
    return json({ error: "Unknown action" }, 404);
  }
  if (!on(ctx, "appt_actions")) return off();
  if (m === "GET" && part === "caps") return capsRoute(ctx);
  if (m === "GET" && part === "panel") return panelRoute(ctx, h);
  if (m === "GET" && part === "slots") return slotsRoute(ctx, h);
  if (m === "POST" && part === "apply") return applyRoute(ctx, h);
  if (m === "POST" && part === "create") return createRoute(ctx, h);
  if (m === "POST" && part === "rebook") return rebookRoute(ctx, h);
  if (m === "POST" && part === "bulk") return bulkRoute(ctx, h);
  if (m === "POST" && part === "undo") return undoRoute(ctx, h);
  return json({ error: "Unknown action" }, 404);
}

function capsRoute(ctx: Ctx): Response {
  return json({
    edit: true, reassign: isAdminSide(ctx), create: true, del: on(ctx, "appt_delete") && isAdminSide(ctx), bulk: on(ctx, "appt_bulk"), meetings: on(ctx, "appt_meetings"),
    caps: APPT_BATCH_CAPS, undoMinutes: UNDO_MINUTES, me: ctx.session.userId ?? null,
  });
}

/** Everything the planner needs about one account, read once. */
async function account(ctx: Ctx, locationId: string, around: { from: number; to: number }) {
  const [members, calendars, others, zone] = await Promise.all([accountMembers(ctx, locationId), calendarsOf(ctx.installationId, locationId), othersAround(ctx.installationId, locationId, around.from, around.to), zoneOf(ctx.installationId, locationId)]);
  return { members, calendars, others, zone, teamIds: members.map((x) => x.id), calendarIds: calendars.length ? calendars.map((x) => x.id) : null };
}

// ---------------- the panel ----------------

async function panelRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const locationId = await accountOf(ctx, h, sp.get("locationId"));
  const id = sp.get("id");
  if (!locationId || !isId(id)) return json({ error: "That appointment is not available" }, 404);
  const p = await panelFacts(ctx.installationId, locationId, id);
  if (!p) return json({ error: "That appointment is not available" }, 404);
  const userId = ctx.session.userId ?? null;
  const [feed, ac, md, links, call, conn, hasScope] = await Promise.all([
    timeline(ctx.installationId, locationId, id, UNDO_MINUTES), account(ctx, locationId, { from: Date.now(), to: Date.now() }), mode(ctx, locationId), h.links(),
    on(ctx, "appt_meetings") && userId ? ownMeetingFor(ctx.installationId, userId, locationId, id) : Promise.resolve(null),
    on(ctx, "appt_meetings") && userId ? connectionStatus(ctx.installationId, userId) : Promise.resolve(null),
    ctx.demo ? Promise.resolve(true) : installationHasScope(ctx.installationId, APPT_WRITE_SCOPE),
  ]);
  const name = (uid: string | null) => (uid ? ac.members.find((x) => x.id === uid)?.name ?? "Team member" : "Not assigned");
  const f = p.facts;
  const touch = mayTouch(ctx, f.assignedTo);
  const suggestion = on(ctx, "appt_meetings") ? suggestOutcome({ status: f.status, startAt: f.startAt, endAt: f.endAt }, call !== null, conn?.status === "connected", Date.now()) : null;
  return json({
    appointment: { id: f.appointmentId, locationId, locationName: p.locationName, calendarId: f.calendarId, calendar: f.calendarName, title: f.title, status: f.status, statusWord: statusWord(f.status), startAt: f.startAt, endAt: f.endAt, timeZone: ac.zone.tz },
    contact: f.contactId ? { contactId: f.contactId, name: f.contactName, phone: p.contact?.phone ?? null, email: p.contact?.email ?? null, dnd: p.contact?.dnd ?? false, source: p.contact?.source ?? null, url: links.contact(locationId, f.contactId) } : null,
    owner: { id: f.assignedTo, name: name(f.assignedTo) }, booker: { id: p.bookedBy, name: name(p.bookedBy), channel: p.channel, at: p.createdAt },
    deal: p.deal, reminders: p.reminders, timeline: feed,
    team: ac.members, calendars: ac.calendars, meeting: call, meetingConnected: conn?.status === "connected", suggestion,
    can: { edit: touch, reassign: isAdminSide(ctx), del: on(ctx, "appt_delete") && isAdminSide(ctx), mark: touch },
    mode: md, needsPermission: !hasScope, undoMinutes: UNDO_MINUTES,
  });
}

async function slotsRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const locationId = await accountOf(ctx, h, sp.get("locationId"));
  const id = sp.get("id");
  if (!locationId || !isId(id)) return json({ error: "That appointment is not available" }, 404);
  const [f] = await loadFacts(ctx.installationId, locationId, [id]);
  if (!f || !mayTouch(ctx, f.assignedTo)) return json({ error: "That appointment is not available" }, 404);
  const ac = await account(ctx, locationId, { from: Date.now(), to: Date.now() + 14 * 86_400_000 });
  const rates = await hourShowRates(ctx.installationId, locationId, ac.zone.offsetMinutes).catch(() => null);
  const dur = f.startAt && f.endAt ? Math.round((Date.parse(f.endAt) - Date.parse(f.startAt)) / 60_000) : 30;
  const slots = suggestSlots({ from: Date.now(), durationMin: dur > 0 ? dur : 30, others: ac.others, assignedTo: f.assignedTo, calendarId: f.calendarId, ignoreId: f.appointmentId, offsetMinutes: ac.zone.offsetMinutes, hourShowRates: rates });
  return json({ slots, basedOnHistory: rates !== null, timeZone: ac.zone.tz });
}

// ---------------- apply one change ----------------

async function writeOne(ctx: Ctx, h: ApptActionHelpers, md: Awaited<ReturnType<typeof mode>>, f: ApptFacts, plan: ApptPlan, allowOverlap: boolean) {
  const common = { installationId: ctx.installationId, locationId: f.locationId, actor: actorOf(ctx), contactId: f.contactId, optedIn: md.optedIn, token: () => h.locationToken(f.locationId) };
  const deps = ctx.demo ? { env: {} } : {};
  if (plan.kind === "delete") return writeAppointment({ ...common, op: "delete", appointmentId: f.appointmentId }, deps);
  return writeAppointment({ ...common, op: "update", appointmentId: f.appointmentId, patch: plan.patch as NonNullable<ApptPlan["patch"]>, allowOverlap }, deps);
}
const logKind = (k: ApptAction["kind"]): ApptLogRow["action"] => k;

async function applyRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || !isId(b.appointmentId)) return json({ error: "Choose the appointment" }, 400);
  const parsed = parseAction(b.action);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const a = parsed.action;
  if (a.kind === "delete" && (!on(ctx, "appt_delete") || !isAdminSide(ctx))) return a.kind === "delete" && on(ctx, "appt_delete") ? json({ error: "Ask your administrator to delete appointments." }, 403) : off();
  if (a.kind === "reassign" && !isAdminSide(ctx)) return json({ error: "Ask your administrator to change the owner." }, 403);
  const [f] = await loadFacts(ctx.installationId, locationId, [b.appointmentId]);
  if (!f || !mayTouch(ctx, f.assignedTo)) return json({ error: "That appointment is not available" }, 404);
  const start = f.startAt ? Date.parse(f.startAt) : Date.now();
  const ac = await account(ctx, locationId, { from: Math.min(start, a.kind === "reschedule" ? Date.parse(a.startAt) : start), to: Math.max(start, a.kind === "reschedule" ? Date.parse(a.endAt) : start) });
  const now = Date.now();
  const plan = planAction(a, f, { now, others: ac.others, teamIds: ac.teamIds, calendarIds: ac.calendarIds, tz: ac.zone.tz });
  const md = await mode(ctx, locationId);
  const hasScope = ctx.demo ? true : await installationHasScope(ctx.installationId, APPT_WRITE_SCOPE);
  if (b.step !== "do") return json({ ok: true, mode: md, needsPermission: !hasScope, plan });
  if (plan.blockers.length > 0) return json({ ok: false, blocked: true, blockers: plan.blockers }, 422);
  if (a.kind !== "delete" && !plan.patch) return json({ ok: false, blocked: true, blockers: [{ id: "nochange", text: "Nothing would change." }] }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const r = await writeOne(ctx, h, md, f, plan, a.kind === "reschedule" || a.kind === "edit" ? a.allowOverlap === true : false);
  const batchId = randomUUID();
  const before = a.kind === "delete" ? {} : beforeOf(f, plan.patch as NonNullable<ApptPlan["patch"]>);
  await logAppt(ctx.installationId, [{ locationId, batchId, action: logKind(a.kind), appointmentId: f.appointmentId, contactId: f.contactId, before, after: plan.patch ?? {}, result: resultWord(r), actor: ctx.session.userId ?? null }]);
  if (r.outcome === "done") {
    if (a.kind === "delete") await dropLocal(ctx.installationId, locationId, [f.appointmentId]);
    else await applyLocal(ctx.installationId, locationId, f.appointmentId, plan.patch as NonNullable<ApptPlan["patch"]>);
    if (b.fromMeeting === true && ctx.session.userId && a.kind === "status") await confirmOutcomeMark(ctx.installationId, ctx.session.userId, locationId, f.appointmentId);
  }
  return answer(r, batchId, a.kind === "delete" ? 1 : 1, md.optedIn);
}

function answer(r: ApptWriteResult, batchId: string, n: number, optedIn: boolean): Response {
  switch (r.outcome) {
    case "done": return json({ ok: true, done: true, batchId, undoMinutes: UNDO_MINUTES, message: `${n === 1 ? "Done." : `${n} changed.`}` });
    case "dry_run": return json({ ok: true, dryRun: true, batchId, message: `${dryRunWords(r.reason)} Here is what would have happened.` });
    case "needs_permission": return json({ ok: false, needsPermission: true, message: permissionText }, 403);
    case "rate_limited": return json({ ok: false, message: `Slow down a little: try again in ${r.retryInSeconds} seconds.`, retryInSeconds: r.retryInSeconds }, 429);
    case "failed": return json({ ok: false, message: failureText(r.status), retry: true, optedIn }, 502);
  }
}

// ---------------- create and one-tap rebook ----------------

async function createCommon(ctx: Ctx, h: ApptActionHelpers, locationId: string, input: ReturnType<typeof parseCreate> & { ok: true }, step: unknown, fromId: string | null) {
  const { input: c } = input;
  const facts = await contactFacts(ctx.installationId, locationId, [c.contactId]);
  const fact = facts.get(c.contactId);
  const ac = await account(ctx, locationId, { from: Date.parse(c.startAt), to: Date.parse(c.endAt) });
  const plan = planCreate(c, { now: Date.now(), others: ac.others, teamIds: ac.teamIds, calendarIds: ac.calendarIds, contactName: fact?.name ?? null, contactDnd: fact?.dnd ?? false, tz: ac.zone.tz });
  const md = await mode(ctx, locationId);
  const hasScope = ctx.demo ? true : await installationHasScope(ctx.installationId, APPT_WRITE_SCOPE);
  if (step !== "do") return json({ ok: true, mode: md, needsPermission: !hasScope, plan: { ...plan, input: c, rebookOf: fromId } });
  if (plan.blockers.length) return json({ ok: false, blocked: true, blockers: plan.blockers }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const r = await writeAppointment({
    installationId: ctx.installationId, locationId, actor: actorOf(ctx), contactId: c.contactId, optedIn: md.optedIn, token: () => h.locationToken(locationId), op: "create",
    create: { calendarId: c.calendarId, startAt: c.startAt, endAt: c.endAt, assignedTo: c.assignedTo, title: c.title, allowOverlap: c.allowOverlap },
  }, ctx.demo ? { env: {} } : {});
  const batchId = randomUUID();
  await logAppt(ctx.installationId, [{ locationId, batchId, action: "create", appointmentId: r.outcome === "done" ? r.id ?? null : null, contactId: c.contactId, before: {}, after: { startAt: c.startAt, endAt: c.endAt, calendarId: c.calendarId, assignedTo: c.assignedTo, rebookOf: fromId }, result: resultWord(r), actor: ctx.session.userId ?? null }]);
  return answer(r, batchId, 1, md.optedIn);
}

async function createRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId) return json({ error: "Choose the account" }, 400);
  const parsed = parseCreate(b);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  // A client's staff book only for themselves.
  if (!isAdminSide(ctx) && parsed.input.assignedTo !== ctx.session.userId) return json({ error: "You can book appointments for yourself. Ask your administrator to book for others." }, 403);
  return createCommon(ctx, h, locationId, parsed, b.step, null);
}

async function rebookRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || !isId(b.appointmentId)) return json({ error: "Choose the appointment" }, 400);
  const [f] = await loadFacts(ctx.installationId, locationId, [b.appointmentId]);
  if (!f || !mayTouch(ctx, f.assignedTo) || !f.contactId || !f.calendarId) return json({ error: "That appointment cannot be booked again from here" }, 404);
  const ac = await account(ctx, locationId, { from: Date.now(), to: Date.now() + 14 * 86_400_000 });
  const rates = await hourShowRates(ctx.installationId, locationId, ac.zone.offsetMinutes).catch(() => null);
  const dur = f.startAt && f.endAt ? Math.round((Date.parse(f.endAt) - Date.parse(f.startAt)) / 60_000) : 30;
  // The slot is chosen on the server from free time; the person sees it in the preview and confirms. A chosen slot (startAt/endAt) from the picker is checked the same way.
  const pick = typeof b.startAt === "string" && typeof b.endAt === "string" ? { startAt: b.startAt, endAt: b.endAt } : suggestSlots({ from: Date.now() + 2 * 3_600_000, durationMin: dur > 0 ? dur : 30, others: ac.others, assignedTo: f.assignedTo, calendarId: f.calendarId, offsetMinutes: ac.zone.offsetMinutes, hourShowRates: rates, count: 1 })[0];
  if (!pick) return json({ error: "No free time in the next two weeks. Pick a time yourself." }, 409);
  const parsed = parseCreate({ contactId: f.contactId, calendarId: f.calendarId, startAt: pick.startAt, endAt: pick.endAt, assignedTo: f.assignedTo, title: f.title ?? "Appointment", allowOverlap: false });
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  return createCommon(ctx, h, locationId, parsed, b.step, f.appointmentId);
}

// ---------------- bulk ----------------

async function bulkRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  if (!on(ctx, "appt_bulk")) return off();
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  const kind = b?.kind;
  if (kind !== "status" && kind !== "delete" && kind !== "reassign") return json({ error: "Choose what to do" }, 400);
  const ids = idList(b?.ids, 300);
  if (!b || !locationId || !ids) return json({ error: "Choose the appointments" }, 400);
  if (kind === "delete" && !on(ctx, "appt_delete")) return off();
  if ((kind === "delete" || kind === "reassign") && !isAdminSide(ctx)) return json({ error: "Ask your administrator to do this." }, 403);
  const status = (["showed", "noshow", "cancelled", "invalid", "completed"] as const).find((s) => s === b.status) as OutcomeChoice | undefined;
  if (kind === "status" && !status) return json({ error: "Choose an outcome" }, 400);
  const userId = typeof b.userId === "string" && isId(b.userId) ? b.userId : null;
  if (kind === "reassign" && !userId) return json({ error: "Choose a team member" }, 400);
  const facts = (await loadFacts(ctx.installationId, locationId, ids)).filter((f) => mayTouch(ctx, f.assignedTo));
  if (facts.length === 0) return json({ error: "Those appointments are not available" }, 404);
  const members = kind === "reassign" ? await accountMembers(ctx, locationId) : [];
  const plan = planBulk(kind, facts, { now: Date.now(), ...(status ? { status } : {}), ...(userId ? { userId } : {}) });
  const md = await mode(ctx, locationId);
  const hasScope = ctx.demo ? true : await installationHasScope(ctx.installationId, APPT_WRITE_SCOPE);
  if (kind === "reassign" && !members.some((m) => m.id === userId)) return json({ ok: false, blocked: true, blockers: [{ id: "owner", text: "That person is not on this account's team." }] }, 422);
  if (b.step !== "do") {
    return json({
      ok: true, mode: md, needsPermission: !hasScope,
      plan: { allowed: plan.allowed.map((f) => ({ appointmentId: f.appointmentId, name: f.contactName, startAt: f.startAt, calendar: f.calendarName })), skipped: plan.skipped, overCap: plan.overCap, phrase: plan.phrase, reversible: kind !== "delete", cap: APPT_BATCH_CAPS[kind] },
    });
  }
  if (plan.allowed.length === 0) return json({ ok: false, blocked: true, blockers: [{ id: "none", text: "Nothing here can be changed." }] }, 422);
  if (kind === "delete" && !bulkDeleteConfirmed(typeof b.typed === "string" ? b.typed : "", plan.allowed.length)) return json({ ok: false, blocked: true, blockers: [{ id: "confirm", text: `Type "${plan.phrase}" exactly to confirm.` }] }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const batchId = randomUUID();
  const log: ApptLogRow[] = []; const dropped: string[] = [];
  let done = 0, dry = 0, failed = 0, permission = false;
  for (const f of plan.allowed) {
    const patch: NonNullable<ApptPlan["patch"]> | null = kind === "status" ? { status: crmStatusOf(status as OutcomeChoice) } : kind === "reassign" ? { assignedUserId: userId as string } : null;
    const p = { kind: kind === "delete" ? "delete" : kind === "status" ? "status" : "reassign", patch } as ApptPlan;
    const r = await writeOne(ctx, h, md, f, p, false);
    log.push({ locationId, batchId, action: kind === "delete" ? "delete" : kind === "status" ? "status" : "reassign", appointmentId: f.appointmentId, contactId: f.contactId, before: patch ? beforeOf(f, patch) : {}, after: patch ?? {}, result: resultWord(r), actor: ctx.session.userId ?? null });
    if (r.outcome === "done") { done++; if (kind === "delete") dropped.push(f.appointmentId); else await applyLocal(ctx.installationId, locationId, f.appointmentId, patch as NonNullable<ApptPlan["patch"]>); } else if (r.outcome === "dry_run") dry++; else failed++;
    if (r.outcome === "needs_permission") { permission = true; break; }
    if (r.outcome === "rate_limited") break;
  }
  await logAppt(ctx.installationId, log);
  if (dropped.length) await dropLocal(ctx.installationId, locationId, dropped);
  const message = permission ? permissionText : dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} ${dry} appointment${dry === 1 ? "" : "s"} checked.` : `${done} appointment${done === 1 ? "" : "s"} changed.`;
  return json({ ok: !permission && failed === 0, batchId, done, dryRun: dry, failed, needsPermission: permission, undoable: kind !== "delete" && done > 0, undoMinutes: UNDO_MINUTES, message }, permission ? 403 : 200);
}

// ---------------- undo ----------------

async function undoRoute(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || typeof b.batchId !== "string" || !/^[0-9a-f-]{36}$/.test(b.batchId)) return json({ error: "Choose the change" }, 400);
  const rows = await batchRows(ctx.installationId, locationId, b.batchId);
  const fresh = rows.filter((r) => Date.now() - Date.parse(r.at) < UNDO_MINUTES * 60_000);
  if (fresh.length === 0) return json({ ok: false, message: `This change can be put back for ${UNDO_MINUTES} minutes after it is made. That time has passed, or it was already put back.` }, 410);
  const facts = new Map((await loadFacts(ctx.installationId, locationId, fresh.map((r) => r.appointmentId))).map((f) => [f.appointmentId, f]));
  const md = await mode(ctx, locationId);
  const hasScope = ctx.demo ? true : await installationHasScope(ctx.installationId, APPT_WRITE_SCOPE);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const undoBatch = randomUUID(); const log: ApptLogRow[] = [];
  let done = 0, dry = 0, failed = 0;
  for (const r of fresh) {
    const f = facts.get(r.appointmentId); const patch = inversePatch(r.action, r.before);
    if (!f || !patch || !mayTouch(ctx, f.assignedTo) || (patch.assignedUserId && !isAdminSide(ctx))) { failed++; continue; }
    const res = await writeOne(ctx, h, md, f, { kind: "edit", patch } as ApptPlan, true);
    log.push({ locationId, batchId: undoBatch, action: "undo", appointmentId: f.appointmentId, contactId: f.contactId, before: { batchId: b.batchId }, after: patch, result: resultWord(res), actor: ctx.session.userId ?? null });
    if (res.outcome === "done") { done++; await applyLocal(ctx.installationId, locationId, f.appointmentId, patch); } else if (res.outcome === "dry_run") dry++; else failed++;
  }
  await logAppt(ctx.installationId, log);
  return json({ ok: failed === 0, done, dryRun: dry, failed, message: dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} Nothing was sent.` : `${done} change${done === 1 ? "" : "s"} put back.` });
}

// ---------------- meetings (private to the person) ----------------

const needUser = (ctx: Ctx) => (ctx.session.userId ? null : json({ error: "Sign in again first" }, 401));
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };

async function meetingsHome(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const bad = needUser(ctx); if (bad) return bad;
  const userId = ctx.session.userId as string;
  const allowed = await h.allowed();
  const [connection, counts] = await Promise.all([connectionStatus(ctx.installationId, userId), homeCounts(ctx.installationId, userId, allowed)]);
  // Honest wording: calls arrive when the meeting tool delivers them; "Sync now" re-checks what has arrived and ties the certain ones to appointments.
  return json({ demo: false, connection, counts, note: "Calls arrive from your meeting tool when they finish. Sync now checks what has arrived and ties each call to its appointment when it is certain." });
}
async function meetingsMatching(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const bad = needUser(ctx); if (bad) return bad;
  const sp = ctx.url.searchParams;
  return json(await needsMatching(ctx.installationId, ctx.session.userId as string, await h.allowed(), Math.max(0, int(sp.get("page"), 0)), Math.min(50, Math.max(1, int(sp.get("size"), 20)))));
}
async function meetingsFollowUp(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const bad = needUser(ctx); if (bad) return bad;
  const sp = ctx.url.searchParams;
  const r = await noFollowUp(ctx.installationId, ctx.session.userId as string, await h.allowed(), Math.max(0, int(sp.get("page"), 0)), Math.min(50, Math.max(1, int(sp.get("size"), 20))));
  const links = await h.links();
  return json({ ...r, rows: r.rows.map((x) => ({ ...x, url: x.contactId ? links.contact(x.locationId, x.contactId) : null })) });
}
async function meetingsSync(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const bad = needUser(ctx); if (bad) return bad;
  if (ctx.demo) return json({ linked: 0, waiting: 0, message: "Not available in the demo." });
  const r = await rematchOwn(ctx.installationId, ctx.session.userId as string, await h.allowed());
  return json({ ...r, message: r.linked ? `${r.linked} call${r.linked === 1 ? "" : "s"} tied to appointments. ${r.waiting} still need matching.` : r.waiting ? `${r.waiting} call${r.waiting === 1 ? "" : "s"} still need matching. SubSync ties a call only when it is certain.` : "Everything is up to date." });
}
async function meetingsMatch(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const bad = needUser(ctx); if (bad) return bad;
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || !isId(b.appointmentId) || typeof b.meetingId !== "string" || !/^[0-9a-f-]{36}$/.test(b.meetingId)) return json({ error: "Choose the call and the appointment" }, 400);
  const [f] = await loadFacts(ctx.installationId, locationId, [b.appointmentId]);
  if (!f) return json({ error: "That appointment is not available" }, 404);
  const ok = await linkMeeting(ctx.installationId, ctx.session.userId as string, b.meetingId, locationId, b.appointmentId, "person");
  return ok ? json({ ok: true, message: "Tied to the appointment." }) : json({ error: "That call is not available" }, 404);
}
async function meetingsNote(ctx: Ctx, h: ApptActionHelpers): Promise<Response> {
  const bad = needUser(ctx); if (bad) return bad;
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || !isId(b.appointmentId)) return json({ error: "Choose the appointment" }, 400);
  const [f] = await loadFacts(ctx.installationId, locationId, [b.appointmentId]);
  const call = f ? await ownMeetingFor(ctx.installationId, ctx.session.userId as string, locationId, b.appointmentId) : null;
  if (!f || !f.contactId || !call) return json({ error: "No call of yours is tied to that appointment" }, 404);
  const text = followUpNote({ title: call.title, summary: call.summary, actionItems: call.actionItems });
  const md = await mode(ctx, locationId);
  const target: Target = { locationId, contactId: f.contactId, name: f.contactName, dnd: false, phone: null, email: null, timeZone: null };
  const noteAction: Action = { kind: "note", text };
  const hasScope = ctx.demo ? true : await installationHasScope(ctx.installationId, "contacts.write");
  if (b.step !== "do") return json({ ok: true, mode: md, needsPermission: !hasScope, preview: { text, hasTask: call.nextStep !== null, task: call.nextStep } });
  // The note goes through the same gateway as every other note: runAction records its id in the write log, so it never counts as a reply or activity (principle 14).
  const res = await runAction({ installationId: ctx.installationId, actor: actorOf(ctx), target, action: noteAction, optedIn: md.optedIn, confirmed: true, ack: [], token: () => h.locationToken(locationId) }, ctx.demo ? { env: {} } : {});
  let task: string | null = null;
  if (res.outcome === "done" || res.outcome === "dry_run") {
    if (call.nextStep) {
      const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const t = await runAction({ installationId: ctx.installationId, actor: actorOf(ctx), target, action: { kind: "task", title: call.nextStep.slice(0, 120), dueDate: due, ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}) }, optedIn: md.optedIn, confirmed: true, ack: [], token: () => h.locationToken(locationId) }, ctx.demo ? { env: {} } : {});
      task = t.outcome;
    }
  }
  if (res.outcome === "dry_run") return json({ ok: true, dryRun: true, message: `${dryRunWords(res.reason)} Here is what would have happened.`, task });
  if (res.outcome === "done") return json({ ok: true, done: true, message: "Note added to the contact.", task });
  if (res.outcome === "needs_permission") return json({ ok: false, needsPermission: true, message: "Needs permission: reconnect SubSync so it may add notes. Nothing was changed." }, 403);
  return json({ ok: false, message: res.outcome === "failed" ? failureText(res.status) : "That could not be done.", outcome: res.outcome }, res.outcome === "blocked" ? 422 : 502);
}
