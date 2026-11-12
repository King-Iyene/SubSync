import { installationHasScope } from "../analytics/cleanup-queries";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { connectionStatus, rematchOwn } from "../analytics/appointment-meetings-queries";
import {
  FOLLOWUP_DAYS, LIST_PAGE, MAX_PAGE, MAX_TASKS_PER_DAY, UNDO_MINUTES, decodeCursor, freeItems, isUuid, parseListQuery, planTasks, weeklyLine, type FollowKind,
} from "../analytics/mn2";
import {
  callDetail, claimTask, coachCalls, coachRows, connectedPeople, exactContacts, finishTask, followCounts, followRows, listCalls, markTaskUndone, roleLabels, taskTarget, tasksDoneToday, undoableTasks, weekCounts,
} from "../analytics/mn2-queries";
import { pgIngestStore } from "../connections/ingest-store";
import { accessibleAccounts, personFromSession, statusScope, covers, type Person } from "../connections/person";
import { buildDeleteOwn, buildTask, writeToCrm } from "../ghl/crm-writes";
import { recordWrite } from "../ghl/crm-gateway";
import type { Feature } from "../entitlements";
import { isLive } from "../live-flags";
import { sql } from "../db";
import { locationAccessToken } from "../sync/engine";
import { json, type AuthContext } from "./auth";

// The Meeting notes list, detail panel, follow-up lists, action-item tasks and coaching view, under /api/app/meeting-list/<part>:
//   GET  (nothing)            the person's own calls: search, account, date, matched or waiting, appointment outcome, follow-up; keyset paging, count equals rows   mn_list
//   GET  home                 the connection (status, last call) and the counts of every list                                                                          mn_list
//   GET  <call id>            one call in full: summary, action items, next step, matched contact and appointment, and the exact contacts that could be matched      mn_list
//   GET  follow?kind=         held, then nothing: no follow-up in 2 days / no next step set / deal not moved                                                           mn_followups
//   GET  coach                coaching per setter and closer (counts and averages only; never what was said)                                                           mn_coach
//   POST sync                 ties the person's certain calls to their appointments again                                                                              mn_list
//   POST <call id>/tasks      action items to CRM tasks: step "preview", "create" or "undo"                                                                              mn_tasks
// Who is asking comes ONLY from the signed session; nothing about the person, the company or the account is read from the request. A call is read by its owner alone (rule 12) and a
// contact or account appears only inside the accounts the person may open (rule 13). A call id or account id from another person or company answers "not found" and is never echoed.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type MnHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof import("../links").deepLinks>> };

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const NOT_FOUND = () => json({ error: "Not found" }, 404);
const OFF = () => json({ error: "This is not switched on for your account" }, 404);
const NEED_SIGN_IN = () => json({ error: "Please sign in again" }, 401);
const personOf = (ctx: Ctx): Person | null => personFromSession(ctx.session, ctx.kind, ctx.limitTo);
const NEEDS_PERMISSION = "Needs permission: reconnect SubSync so it may add tasks to contacts. Nothing was made.";

/** The accounts this person may open (the same rule that decides where a call may be written): everything for an owner or administrator, their own account for a business or client. */
async function reachable(person: Person, installationId: string): Promise<string[]> {
  return accessibleAccounts(person, await pgIngestStore().installed(installationId), await pgIngestStore().provenAccess(installationId, person.userId));
}

export async function handleMeetingList(ctx: Ctx, h: MnHelpers): Promise<Response> {
  const part = ctx.segments[1];
  const m = ctx.request.method;
  if (part === "coach") return on(ctx, "mn_coach") ? (m === "GET" ? coach(ctx) : NOT_FOUND()) : OFF();
  if (part === "follow") return on(ctx, "mn_followups") ? (m === "GET" ? follow(ctx, h) : NOT_FOUND()) : OFF();
  if (!on(ctx, "mn_list")) return OFF();
  if (!part && m === "GET") return list(ctx, h);
  if (part === "home" && m === "GET") return home(ctx);
  if (part === "sync" && m === "POST") return sync(ctx, h);
  if (part && isUuid(part)) {
    if (!ctx.segments[2] && m === "GET") return detail(ctx, h, part);
    if (ctx.segments[2] === "tasks" && m === "POST") return on(ctx, "mn_tasks") ? tasks(ctx, part) : OFF();
  }
  return NOT_FOUND();
}

async function list(ctx: Ctx, h: MnHelpers): Promise<Response> {
  if (ctx.demo) return json({ demo: true, rows: [], total: 0, next: null });
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  // The global bar's client choice narrows the list (`allowed` already holds it); without a choice nothing narrows.
  const narrowed = ctx.url.searchParams.has("accounts") ? await h.allowed() : null;
  const q = parseListQuery(ctx.url.searchParams, narrowed ?? []);
  const reach = await reachable(person, ctx.installationId);
  const out = await listCalls(ctx.installationId, person.userId, q, reach);
  const links = await h.links();
  return json({ demo: false, ...out, rows: out.rows.map((r) => ({ ...r, contactUrl: r.locationId && r.contactId ? links.contact(r.locationId, r.contactId) : null })), pageSize: q.limit || LIST_PAGE, maxPage: MAX_PAGE });
}

async function home(ctx: Ctx): Promise<Response> {
  const flags = { followups: on(ctx, "mn_followups"), tasks: on(ctx, "mn_tasks"), coach: on(ctx, "mn_coach"), logged: on(ctx, "mn_logged"), outcomes: on(ctx, "mn_outcomes") };
  if (ctx.demo) return json({ demo: true, flags, connection: null, follow: { no_followup: 0, no_next_step: 0, deal_not_moved: 0 }, waiting: 0, week: null });
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const reach = await reachable(person, ctx.installationId);
  const [connection, follow, waiting, week] = await Promise.all([
    connectionStatus(ctx.installationId, person.userId),
    flags.followups ? followCounts(ctx.installationId, person.userId, reach) : Promise.resolve(null),
    sql()`select count(*)::int n from meetings m where m.installation_id = ${ctx.installationId} and m.owner_ghl_user_id = ${person.userId} and m.status = 'needs_contact' and m.matched_contact_id is null`.then((r) => Number(r[0]?.n ?? 0)).catch(() => 0),
    weekCounts(ctx.installationId, person.kind === "agency" ? null : [person.homeLocationId ?? ""]),
  ]);
  return json({ demo: false, flags, connection, follow, waiting, week: { ...week, line: weeklyLine(week) } });
}

async function detail(ctx: Ctx, h: MnHelpers, id: string): Promise<Response> {
  if (ctx.demo) return NOT_FOUND();
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const reach = await reachable(person, ctx.installationId);
  const d = await callDetail(ctx.installationId, person.userId, id, reach);
  if (!d) return NOT_FOUND();
  const links = await h.links();
  // The contacts that could be this call's: only when none is matched yet, only exact email matches, only inside the accounts the person may open. Several are never guessed between.
  const candidates = d.contactId ? [] : await exactContacts(ctx.installationId, d.attendees, reach);
  return json({
    ...d, contactUrl: d.locationId && d.contactId ? links.contact(d.locationId, d.contactId) : null,
    candidates: candidates.map((c) => ({ ...c, url: links.contact(c.locationId, c.contactId) })),
    canTasks: on(ctx, "mn_tasks"), canOutcome: on(ctx, "appt_actions"),
  });
}

async function follow(ctx: Ctx, h: MnHelpers): Promise<Response> {
  const kind = ctx.url.searchParams.get("kind");
  if (kind !== "no_followup" && kind !== "no_next_step" && kind !== "deal_not_moved") return json({ error: "Choose a list" }, 400);
  if (ctx.demo) return json({ demo: true, rows: [], total: 0, next: null, days: FOLLOWUP_DAYS });
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const lim = Math.min(MAX_PAGE, Math.max(1, Number(ctx.url.searchParams.get("limit")) || LIST_PAGE));
  const reach = await reachable(person, ctx.installationId);
  const r = await followRows(ctx.installationId, person.userId, reach, kind as FollowKind, decodeCursor(ctx.url.searchParams.get("cursor")), lim);
  const links = await h.links();
  return json({ demo: false, days: FOLLOWUP_DAYS, ...r, rows: r.rows.map((x) => ({ ...x, url: x.locationId && x.contactId ? links.contact(x.locationId, x.contactId) : null })) });
}

async function coach(ctx: Ctx): Promise<Response> {
  if (ctx.demo) return json({ demo: true, rows: [], team: null, scope: "mine" });
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const scope = statusScope(person, null);
  const people = await connectedPeople(ctx.installationId);
  const inScope = scope.kind === "none" ? people.filter((p) => p.owner === person.userId) : people.filter((p) => p.owner === person.userId || covers(scope, p.homeLocationId));
  const owners = inScope.map((p) => p.owner);
  const [calls, labels] = await Promise.all([coachCalls(ctx.installationId, owners), roleLabels(ctx.installationId, owners)]);
  const rows = coachRows(calls);
  const name = new Map(inScope.map((p) => [p.owner, p.name]));
  // The team row is every call of the people listed, as one: it is what each person is read against. Ids never leave the server.
  const team = coachRows(calls.map((c) => ({ ...c, owner: "team" })))[0] ?? null;
  return json({
    demo: false, scope: scope.kind === "none" ? "mine" : "team",
    rows: rows.map((r) => ({ name: name.get(r.owner) ?? "Someone", isMe: r.owner === person.userId, role: labels.get(r.owner) ?? null, ...r, owner: undefined })),
    team: team ? { ...team, owner: undefined } : null,
  });
}

async function sync(ctx: Ctx, h: MnHelpers): Promise<Response> {
  if (ctx.demo) return json({ linked: 0, waiting: 0, message: "Not available in the demo." });
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const r = await rematchOwn(ctx.installationId, person.userId, await h.allowed());
  const s = (n: number) => (n === 1 ? "" : "s");
  return json({ ...r, message: r.linked ? `${r.linked} call${s(r.linked)} tied to appointments. ${r.waiting} still need matching.` : r.waiting ? `${r.waiting} call${s(r.waiting)} still need matching. SubSync ties a call only when it is certain.` : "Everything that has arrived is up to date." });
}

// ---------------- action items to tasks ----------------

async function tasks(ctx: Ctx, id: string): Promise<Response> {
  if (ctx.demo) return json({ error: "Not available in the demo." }, 409);
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const body = (await ctx.request.json().catch(() => null)) as { step?: unknown; items?: unknown } | null;
  const step = body?.step;
  if (step !== "preview" && step !== "create" && step !== "undo") return json({ error: "Choose what to do" }, 400);
  const reach = await reachable(person, ctx.installationId);
  const target = await taskTarget(ctx.installationId, person.userId, id, reach);
  if (!target) return json({ error: "Pick the contact for this call first. A task is made only on a contact that is certain." }, 404);
  const master = isLive("WRITE_GHL_LIVE");
  const optedIn = await writeEnabledFor(ctx.installationId, target.locationId);
  const live = master && optedIn;
  const granted = await installationHasScope(ctx.installationId, "contacts.write");
  const token = () => locationAccessToken(target.companyId, target.locationId);

  if (step === "undo") {
    const mine = await undoableTasks(ctx.installationId, person.userId, id);
    let removed = 0;
    for (const t of mine) {
      if (t.status === "saved" && t.ghlId && live && granted) {
        const r = await writeToCrm({ installationId: ctx.installationId, locationId: target.locationId, contactId: target.contactId, request: buildDeleteOwn({ contactId: target.contactId, kind: "tasks", id: t.ghlId }), token }).catch(() => ({ outcome: "failed" as const, status: 0 }));
        if (r.outcome !== "written") continue;
      }
      await markTaskUndone(t.id);
      removed++;
    }
    await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${person.userId}, 'meeting_notes.tasks_undone', ${sql().json({ meetingId: id, count: removed } as never)})`.catch(() => undefined);
    return json({ ok: true, removed, message: removed ? `Undone. ${removed} task${removed === 1 ? "" : "s"} removed.` : `Nothing to undo. A task can be put back within ${UNDO_MINUTES} minutes.` });
  }

  const taken = (await sql()`select item_no from mn_tasks where installation_id = ${ctx.installationId} and meeting_id = ${id} and status in ('pending', 'saved', 'dry_run')`.catch(() => [])).map((r) => r.item_no as number);
  const asked = Array.isArray(body?.items) ? (body?.items as unknown[]).filter((n): n is number => Number.isInteger(n)) : freeItems(target.items.length, taken);
  const { plans, skipped } = planTasks(target.items, asked.filter((n) => !taken.includes(n)), target.startedAt, Date.now());
  const doneToday = await tasksDoneToday(ctx.installationId, person.userId);
  const room = Math.max(0, MAX_TASKS_PER_DAY - doneToday);
  const [c] = await sql()`select coalesce(nullif(btrim(full_name), ''), 'Contact') name from cached_contacts where installation_id = ${ctx.installationId} and location_id = ${target.locationId} and contact_id = ${target.contactId}`;
  const [lo] = await sql()`select name from locations where installation_id = ${ctx.installationId} and location_id = ${target.locationId}`;
  const mode = { live, practice: !live, accountOn: optedIn, masterOn: master };

  if (step === "preview") {
    return json({ plans, skipped, room, contactName: (c?.name as string | undefined) ?? "Contact", accountName: (lo?.name as string | undefined) ?? "Unnamed account", mode, needsPermission: !granted, message: !granted ? NEEDS_PERMISSION : plans.length === 0 ? "Nothing new to make: every item already has a task, or none was chosen." : null });
  }
  if (!granted) return json({ error: NEEDS_PERMISSION, needsPermission: true }, 403);
  if (plans.length === 0) return json({ error: "Nothing new to make: every item already has a task, or none was chosen." }, 400);
  if (plans.length > room) return json({ error: `You can make ${room} more task${room === 1 ? "" : "s"} today. Choose fewer.` }, 409);
  const results: Array<{ itemNo: number; outcome: string }> = [];
  for (const p of plans) {
    const row = await claimTask(ctx.installationId, person.userId, id, p.itemNo, target.locationId, target.contactId);
    if (!row) { results.push({ itemNo: p.itemNo, outcome: "already_made" }); continue; }
    if (!live) { await finishTask(row, "dry_run", null); results.push({ itemNo: p.itemNo, outcome: "dry_run" }); continue; }
    const req = buildTask({ contactId: target.contactId, title: p.title, body: "[SubSync] From your recorded call", dueDate: new Date(p.dueAt) });
    const r = await writeToCrm({ installationId: ctx.installationId, locationId: target.locationId, contactId: target.contactId, meetingId: id, request: req, token }).catch(() => ({ outcome: "failed" as const, status: 0 }));
    await recordWrite({ installationId: ctx.installationId, actor: person.userId, locationId: target.locationId, contactId: target.contactId, op: "mn.task.create", fields: Object.keys(req.body), result: r.outcome }).catch(() => undefined);
    if (r.outcome === "written") { await finishTask(row, "saved", r.id); results.push({ itemNo: p.itemNo, outcome: "saved" }); }
    else if (r.outcome === "needs_permission") { await finishTask(row, "needs_permission", null); results.push({ itemNo: p.itemNo, outcome: "needs_permission" }); }
    else { await finishTask(row, "failed", null); results.push({ itemNo: p.itemNo, outcome: "failed" }); }
  }
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${person.userId}, 'meeting_notes.tasks_made', ${sql().json({ meetingId: id, locationId: target.locationId, contactId: target.contactId, count: results.length, live } as never)})`.catch(() => undefined);
  const saved = results.filter((r) => r.outcome === "saved").length, practice = results.filter((r) => r.outcome === "dry_run").length, failed = results.filter((r) => r.outcome === "failed" || r.outcome === "needs_permission").length;
  const message = failed ? `${saved} task${saved === 1 ? "" : "s"} made, ${failed} did not go through. Your CRM refused ${failed === 1 ? "it" : "them"}; try again in a moment.`
    : practice ? `Practice run: ${practice} task${practice === 1 ? "" : "s"} would be made on ${(c?.name as string | undefined) ?? "the contact"}. Nothing was sent to your CRM.` : `${saved} task${saved === 1 ? "" : "s"} made on ${(c?.name as string | undefined) ?? "the contact"}, due in ${FOLLOWUP_DAYS} days.`;
  return json({ ok: failed === 0, results, message, undoMinutes: UNDO_MINUTES, mode });
}
