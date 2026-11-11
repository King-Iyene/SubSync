import { randomUUID } from "node:crypto";
import { ownedLocation } from "./tenant-guard";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { installationHasScope } from "../analytics/cleanup-queries";
import {
  AWAY_WORDS, EXPORT_CAP, MIN_DAYS, MIN_LEADS, PROOF_MAX_DAYS, REASSIGN_CAP, TARGET_METRICS, TARGET_WORDS, UNDO_MINUTES, acksGiven, acksNeeded, awayLine, isId, leadProtections, noteDeleteWords, notePreview, noteVisible, oneThing, parseAway,
  parseNote, parseTarget, planRebalance, planReassign, proofCsv, proofOf, proofText, suggestAssignee, targetDeleteWords, targetPreview, typedMatches, undoable, viewerOf, type Viewer,
} from "../analytics/people-actions";
import {
  accountReplyTarget, accountTargets, activeAway, addAway, addNote, alreadyUndone, applyOwnerLocal, auditPeople, awayById, batchOf, candidatesFor, editNote, getTarget, listNotes, listTargets, logWrites, membersOf, namesOf, noteById,
  periodStats, proofFacts, proofPrefs, recentWrites, releaseAway, removeNote, setProofPrefs, setTarget, sourceOf, userScope, waitingLeadsOf, type WriteLogRow,
} from "../analytics/people-actions-queries";
import { contactFacts } from "../analytics/unanswered-actions-queries";
import { dryRunWords } from "../analytics/unanswered-actions";
import { REASSIGN_SCOPE, writeOwner } from "../ghl/people-gateway";
import { isLive } from "../live-flags";
import type { Feature } from "../entitlements";
import { sql } from "../db";
import { forgetPeople } from "../analytics/people3-queries";
import { json, type AuthContext } from "./auth";

// The Team ACTIONS and REPORTS endpoints (slice PB), under /api/app/people3/act/<part>:
//   GET  caps          what this person may do (so a screen shows only those buttons), the limits, and the privacy line                                  any pp_ flag of this slice
//   GET  meta          one account's team, with who is away (for the pickers)                                                                            pp_actions
//   GET  notes         coaching notes about one person (a manager reads them; the person reads only the ones shared with them)                           pp_coaching
//   POST note          add, edit or remove a coaching note: step "preview" then step "do"; a removal needs the title (or DELETE) typed                  pp_coaching
//   GET  targets       a person's targets, with each account's own reply target as the default                                                           pp_coaching
//   POST target        set or clear one target: step "preview" then "do"; clearing needs the target's name typed                                        pp_coaching
//   GET  focus         "one thing to work on" from the person's own last 28 days against their previous 28                                               pp_coaching
//   GET  away          the away marks and idle-reminder snoozes that are on now                                                                          pp_idle
//   POST away | away-end   mark someone away until a date, or snooze their "gone quiet" reminder; end either early                                      pp_idle
//   GET  suggest       who should get the next lead in one account: a labelled estimate, hidden under the minimum data                                   pp_nextlead
//   GET  rebalance     for one overloaded person: which of their waiting leads could go to whom (an estimate; each group is then moved with the ordinary preview)  pp_nextlead
//   POST reassign      move leads to one person of the same account: preview, then do (through the people gateway); undo for 30 minutes                  pp_actions
//   POST undo          put a recent move back                                                                                                            pp_actions
//   GET  log           the recent moves SubSync made                                                                                                     pp_actions
//   GET  proof | proof-csv    the client receipt for one account and one period (up to 90 days), as text, a table and a CSV file                          pp_proof
//   GET|POST proof-prefs      whether the client's receipts name the staff (default: team level only)                                                     pp_proof
// Who is asking and which accounts they may read come from the verified session (`ctx`, `h.allowed`), never from the request. An account id in the address or body only REQUESTS an
// account: it is used only after the shared ownedLocation guard says it is inside those accounts, and it is never echoed back. A person id is used only after userScope has found
// that person in this installation AND in an account the caller may read. A foreign id gets the same answer as an id that does not exist. Every CRM write goes through the people
// gateway (one field, one contact): preview first, a practice run unless WRITE_GHL_LIVE and the account opt-in, one audit line per write. Nothing here sends a message to a lead.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type PeopleActionHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof import("../links").deepLinks>>;
  locationToken: (locationId: string) => Promise<string>;
  brand: () => Promise<string | null>;
};

const DAY = 86_400_000;
const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const gone = () => json({ error: "That is not available" }, 404);
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
const viewerFor = (ctx: Ctx): Viewer => viewerOf({ kind: ctx.kind, personRole: ctx.session.personRole ?? null, sessionRole: ctx.session.role, userId: ctx.session.userId });
const managersOnly = () => json({ error: "Ask your administrator to do this." }, 403);
const demoWrite = () => json({ error: "The sample data cannot be changed." }, 403);
const UUID = /^[0-9a-f-]{36}$/i;
const PRIVACY = "SubSync reads message and call details, never the words.";
const permissionText = "Needs permission: reconnect SubSync so it may change who owns a lead. Nothing was changed.";

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}
/** The one shared guard: well formed, inside the accounts this session may read, and really in this installation. A foreign id is the same answer as nothing there. */
async function accountOf(ctx: Ctx, h: PeopleActionHelpers, v: unknown): Promise<string | null> {
  return ownedLocation(ctx.installationId, await h.allowed(), v);
}
/** A person the caller may ask about: known in this installation, in an account the caller may read, and (for someone who is not a manager) only themself. */
async function personOf(ctx: Ctx, h: PeopleActionHelpers, v: unknown) {
  if (!isId(v)) return null;
  const viewer = viewerFor(ctx);
  if (viewer.role === "self" && v !== viewer.userId) return null;
  return userScope(ctx.installationId, await h.allowed(), v);
}
const mode = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};
const idList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const out = [...new Set(v.filter(isId))];
  return out.length === v.length ? out : null;
};
const noteOut = (n: { id: string; subjectUserId: string; title: string; body: string; shared: boolean; authorName: string | null; createdAt: number; updatedAt: number }, viewer: Viewer) => ({
  id: n.id, title: n.title, body: n.body, shared: n.shared, authorName: viewer.role === "manager" || n.shared ? n.authorName : null, createdAt: n.createdAt, updatedAt: n.updatedAt,
});

/** Any successful write (a note, a target, an away mark, a lead move, a proof choice) drops this company's cached Team answers, so the screens show it at once. */
export async function handlePeopleActions(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const res = await dispatchPeopleAction(ctx, h);
  if (ctx.request.method === "POST" && res.ok) forgetPeople(ctx.installationId);
  return res;
}

async function dispatchPeopleAction(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const part = ctx.segments[2];
  const m = ctx.request.method;
  if (m === "GET") {
    if (part === "caps") return capsRoute(ctx);
    if (part === "meta") return on(ctx, "pp_actions") ? metaRoute(ctx, h) : off();
    if (part === "notes") return on(ctx, "pp_coaching") ? notesRoute(ctx, h) : off();
    if (part === "targets") return on(ctx, "pp_coaching") ? targetsRoute(ctx, h) : off();
    if (part === "focus") return on(ctx, "pp_coaching") ? focusRoute(ctx, h) : off();
    if (part === "away") return on(ctx, "pp_idle") ? awayRoute(ctx, h) : off();
    if (part === "suggest") return on(ctx, "pp_nextlead") ? suggestRoute(ctx, h) : off();
    if (part === "rebalance") return on(ctx, "pp_nextlead") ? rebalanceRoute(ctx, h) : off();
    if (part === "log") return on(ctx, "pp_actions") ? logRoute(ctx, h) : off();
    if (part === "proof" || part === "proof-csv") return on(ctx, "pp_proof") ? proofRoute(ctx, h, part === "proof-csv") : off();
    if (part === "proof-prefs") return on(ctx, "pp_proof") ? proofPrefsGet(ctx, h) : off();
  }
  if (m === "POST") {
    if (part === "note") return on(ctx, "pp_coaching") ? noteRoute(ctx, h) : off();
    if (part === "target") return on(ctx, "pp_coaching") ? targetRoute(ctx, h) : off();
    if (part === "away" || part === "away-end") return on(ctx, "pp_idle") ? awayWrite(ctx, h, part === "away-end") : off();
    if (part === "reassign") return on(ctx, "pp_actions") ? reassignRoute(ctx, h) : off();
    if (part === "undo") return on(ctx, "pp_actions") ? undoRoute(ctx, h) : off();
    if (part === "proof-prefs") return on(ctx, "pp_proof") ? proofPrefsSet(ctx, h) : off();
  }
  return json({ error: "Unknown action" }, 404);
}

// ---------------- what this person may do ----------------

function capsRoute(ctx: Ctx): Response {
  const v = viewerFor(ctx);
  const manager = v.role === "manager";
  const any = (["pp_actions", "pp_coaching", "pp_proof", "pp_nextlead", "pp_idle"] as Feature[]).some((f) => on(ctx, f));
  if (!any) return off();
  return json({
    role: v.role, me: v.userId,
    notes: on(ctx, "pp_coaching"), writeNotes: manager && on(ctx, "pp_coaching"), targets: on(ctx, "pp_coaching"), writeTargets: manager && on(ctx, "pp_coaching"), focus: on(ctx, "pp_coaching"),
    away: manager && on(ctx, "pp_idle"), suggest: manager && on(ctx, "pp_nextlead"), reassign: manager && on(ctx, "pp_actions"), proof: manager && on(ctx, "pp_proof"),
    limits: { reassign: REASSIGN_CAP, export: EXPORT_CAP, undoMinutes: UNDO_MINUTES, proofDays: PROOF_MAX_DAYS, minLeads: MIN_LEADS, minDays: MIN_DAYS },
    targetKinds: TARGET_METRICS.map((id) => ({ id, ...TARGET_WORDS[id] })), privacy: PRIVACY,
  });
}

/** The pickers for one account: its team and who is away. */
async function metaRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  const locationId = await accountOf(ctx, h, ctx.url.searchParams.get("locationId"));
  if (!locationId) return gone();
  const members = await membersOf(ctx.installationId, locationId);
  const away = ctx.demo ? { ready: true, rows: [] } : await activeAway(ctx.installationId, members.map((x) => x.id), Date.now());
  const awayIds = new Set(away.rows.filter((r) => r.kind === "away").map((r) => r.userId));
  return json({ team: members.map((x) => ({ ...x, away: awayIds.has(x.id) })), md: await mode(ctx, locationId) });
}

// ---------------- coaching notes ----------------

async function notesRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const viewer = viewerFor(ctx);
  const who = await personOf(ctx, h, ctx.url.searchParams.get("userId"));
  if (!who) return gone();
  if (ctx.demo) return json({ ready: true, notes: [], canWrite: false });
  const r = await listNotes(ctx.installationId, who.userId, { only: viewer.role === "manager" ? (viewer.notes === "all" ? "all" : "authored") : "shared", userId: viewer.userId });
  const notes = r.rows.filter((n) => noteVisible(n, viewer)).map((n) => noteOut(n, viewer));
  return json({ ready: r.ready, person: { id: who.userId, name: who.name ?? "Team member" }, notes, canWrite: viewer.role === "manager" });
}

async function noteRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const viewer = viewerFor(ctx);
  if (viewer.role !== "manager") return managersOnly();
  if (ctx.demo) return demoWrite();
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send a JSON body." }, 400);
  const op = b.op;
  if (op !== "add" && op !== "edit" && op !== "remove") return json({ error: "Choose add, edit or remove" }, 400);
  const doIt = b.step === "do";
  const allowed = await h.allowed();
  const inst = ctx.installationId;

  if (op === "add") {
    const who = await personOf(ctx, h, b.userId);
    if (!who) return gone();
    const p = parseNote(b);
    if (!p.ok) return json({ error: p.error }, 400);
    const loc = b.locationId === undefined || b.locationId === null || b.locationId === "" ? null : await accountOf(ctx, h, b.locationId);
    if (b.locationId && !loc) return gone();
    if (loc && !who.locations.includes(loc)) return gone();
    if (!doIt) return json({ ok: true, preview: { summary: `Add a private note about ${who.name ?? "this person"}.`, changes: notePreview(null, p.note), note: p.note.shared ? "They will be able to read it." : "Only you and your administrators can read it." } });
    const id = await addNote(inst, who.userId, loc, p.note, { userId: viewer.userId, name: actorOf(ctx) });
    if (!id) return json({ error: "Saving notes needs the latest database update, which has not run yet." }, 503);
    await auditPeople(inst, actorOf(ctx), "people.note.add", { subject: who.userId, noteId: id, shared: p.note.shared });
    return json({ ok: true, id, message: "Note saved. Nothing was changed in your CRM." });
  }

  const id = typeof b.id === "string" && UUID.test(b.id) ? b.id : null;
  const n = id ? await noteById(inst, id) : null;
  const who = n ? await userScope(inst, allowed, n.subjectUserId) : null;
  if (!n || !who || !noteVisible(n, viewer) || (viewer.notes === "authored" && n.authorUserId !== viewer.userId)) return gone();

  if (op === "edit") {
    const p = parseNote({ title: b.title ?? n.title, body: b.body ?? n.body, shared: b.shared ?? n.shared });
    if (!p.ok) return json({ error: p.error }, 400);
    const changes = notePreview(n, p.note);
    if (changes.length === 0) return json({ ok: false, blocked: true, blockers: [{ id: "nochange", text: "Nothing would change." }] }, 422);
    if (!doIt) return json({ ok: true, preview: { summary: `Change a note about ${who.name ?? "this person"}.`, changes } });
    if (!(await editNote(inst, n.id, p.note))) return gone();
    await auditPeople(inst, actorOf(ctx), "people.note.edit", { subject: n.subjectUserId, noteId: n.id });
    return json({ ok: true, message: "Note saved." });
  }

  // remove: the title (or DELETE) must be typed, so nobody removes a note without reading which one it is.
  const words = noteDeleteWords(n.title);
  if (!doIt) return json({ ok: true, preview: { summary: `Remove the note "${n.title}" about ${who.name ?? "this person"}. This cannot be put back.`, changes: [{ label: "Note", from: n.title, to: "removed" }], confirm: { needed: true, words } } });
  if (!typedMatches(b.typed, words)) return json({ ok: false, blocked: true, blockers: [{ id: "confirm", text: `Type DELETE or "${n.title}" exactly to confirm.` }] }, 422);
  if (!(await removeNote(inst, n.id))) return gone();
  await auditPeople(inst, actorOf(ctx), "people.note.remove", { subject: n.subjectUserId, noteId: n.id });
  return json({ ok: true, message: "Note removed." });
}

// ---------------- targets ----------------

async function targetsRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const who = await personOf(ctx, h, ctx.url.searchParams.get("userId"));
  if (!who) return gone();
  if (ctx.demo) return json({ ready: true, targets: [], accounts: [], canWrite: false });
  const [t, accts] = await Promise.all([listTargets(ctx.installationId, who.userId, await h.allowed()), accountTargets(ctx.installationId, who.locations)]);
  const inScope = new Set(who.locations);
  return json({
    ready: t.ready, person: { id: who.userId, name: who.name ?? "Team member" }, canWrite: viewerFor(ctx).role === "manager",
    targets: t.rows.filter((r) => r.locationId === null || inScope.has(r.locationId)).map((r) => ({ ...r, ...TARGET_WORDS[r.metric], label: TARGET_WORDS[r.metric].label })),
    accounts: accts, defaultSource: "An account's own reply target is used until you set one for this person.",
  });
}

async function targetRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  if (ctx.demo) return demoWrite();
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send a JSON body." }, 400);
  const p = parseTarget(b);
  if (!p.ok) return json({ error: p.error }, 400);
  const t = p.target;
  const who = await personOf(ctx, h, t.userId);
  if (!who) return gone();
  const loc = t.locationId ? await accountOf(ctx, h, t.locationId) : null;
  if (t.locationId && (!loc || !who.locations.includes(loc))) return gone();
  const before = await getTarget(ctx.installationId, who.userId, loc, t.metric);
  const name = who.name ?? "Team member";
  if (t.value === null && before === null) return json({ ok: false, blocked: true, blockers: [{ id: "none", text: "There is no target to clear." }] }, 422);
  if (t.value !== null && t.value === before) return json({ ok: false, blocked: true, blockers: [{ id: "same", text: "That is already the target." }] }, 422);
  const words = targetDeleteWords(t.metric, name);
  const dflt = t.metric === "reply_minutes" && loc ? await accountReplyTarget(ctx.installationId, loc) : null;
  if (b.step !== "do") {
    return json({ ok: true, preview: { summary: t.value === null ? `Clear ${name}'s target.` : `Set ${name}'s target.`, changes: targetPreview(t.metric, before ?? dflt, t.value), ...(t.value === null ? { confirm: { needed: true, words } } : {}), ...(before === null && dflt !== null ? { note: "The account's own reply target applies until you set one here." } : {}) } });
  }
  if (t.value === null && !typedMatches(b.typed, words)) return json({ ok: false, blocked: true, blockers: [{ id: "confirm", text: `Type DELETE or "${words[1]}" exactly to confirm.` }] }, 422);
  if (!(await setTarget(ctx.installationId, who.userId, loc, t.metric, t.value, actorOf(ctx)))) return json({ error: "Saving targets needs the latest database update, which has not run yet." }, 503);
  await auditPeople(ctx.installationId, actorOf(ctx), t.value === null ? "people.target.clear" : "people.target.set", { subject: who.userId, metric: t.metric, locationId: loc, before, after: t.value });
  return json({ ok: true, message: t.value === null ? "Target cleared." : "Target saved.", undo: before === null ? null : { part: "target", userId: who.userId, locationId: loc, metric: t.metric, value: before } });
}

// ---------------- one thing to work on ----------------

async function focusRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const who = await personOf(ctx, h, ctx.url.searchParams.get("userId"));
  if (!who) return gone();
  if (ctx.demo) return json({ focus: null, hidden: "not_enough_data" });
  const now = Date.now();
  const [cur, prev] = await Promise.all([periodStats(ctx.installationId, who.userId, who.locations, now - 28 * DAY, now), periodStats(ctx.installationId, who.userId, who.locations, now - 56 * DAY, now - 28 * DAY)]);
  const focus = oneThing(cur, prev);
  return json({
    person: { id: who.userId, name: who.name ?? "Team member" }, focus, hidden: focus ? null : "not_enough_data", minLeads: MIN_LEADS,
    basis: "Your own last 28 days against your own 28 days before. Your leads are the leads that are yours today. This is a suggestion, not a score.", periods: { now: cur, before: prev },
  });
}

// ---------------- away marks and snoozes ----------------

async function awayRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  const viewer = viewerFor(ctx);
  if (viewer.role !== "manager") return managersOnly();
  if (ctx.demo) return json({ ready: true, marks: [] });
  const req = ctx.url.searchParams.get("locationId");
  const loc = req ? await accountOf(ctx, h, req) : null;
  if (req && !loc) return gone();
  const allowed = loc ? [loc] : await h.allowed();
  // Only the marks of people in the accounts this caller may read.
  const db = sql();
  const users = await db`select distinct user_id from location_users where installation_id = ${ctx.installationId} ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} limit 1000`.catch(() => []);
  const ids = users.map((u) => u.user_id as string);
  const r = ids.length ? await activeAway(ctx.installationId, ids, Date.now()) : { ready: true, rows: [] };
  const names = await namesOf(ctx.installationId, r.rows.map((x) => x.userId));
  return json({ ready: r.ready, marks: r.rows.map((x) => ({ id: x.id, userId: x.userId, name: names.get(x.userId) ?? "Team member", kind: x.kind, reason: x.reason, reasonText: x.reason ? AWAY_WORDS[x.reason] : null, until: x.until })) });
}

async function awayWrite(ctx: Ctx, h: PeopleActionHelpers, end: boolean): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  if (ctx.demo) return demoWrite();
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send a JSON body." }, 400);
  const inst = ctx.installationId;
  if (end) {
    const id = typeof b.id === "string" && UUID.test(b.id) ? b.id : null;
    const mark = id ? await awayById(inst, id) : null;
    const who = mark ? await userScope(inst, await h.allowed(), mark.userId) : null;
    if (!id || !mark || !who) return gone();
    if (!(await releaseAway(inst, id, [who.userId]))) return gone();
    await auditPeople(inst, actorOf(ctx), "people.away.end", { subject: who.userId, markId: id });
    return json({ ok: true, message: "Back to normal. Nothing was changed in your CRM." });
  }
  const now = Date.now();
  const p = parseAway(b, now);
  if (!p.ok) return json({ error: p.error }, 400);
  const who = await personOf(ctx, h, p.away.userId);
  if (!who) return gone();
  const line = awayLine(who.name ?? "This person", { kind: p.away.kind, reason: p.away.kind === "away" ? p.away.reason : null, until: p.away.until });
  if (b.step !== "do") return json({ ok: true, preview: { summary: line, changes: [{ label: p.away.kind === "away" ? "Status" : "Quiet reminders", from: "normal", to: p.away.kind === "away" ? AWAY_WORDS[p.away.reason].toLowerCase() : "snoozed" }] } });
  const id = await addAway(inst, p.away, actorOf(ctx));
  if (!id) return json({ error: "Saving this needs the latest database update, which has not run yet." }, 503);
  await auditPeople(inst, actorOf(ctx), p.away.kind === "away" ? "people.away.set" : "people.snooze.set", { subject: who.userId, markId: id, until: new Date(p.away.until).toISOString() });
  return json({ ok: true, id, message: line, undo: { part: "away-end", id } });
}

// ---------------- who should get the next lead ----------------

async function suggestRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  const sp = ctx.url.searchParams;
  const locationId = await accountOf(ctx, h, sp.get("locationId"));
  if (!locationId) return gone();
  if (ctx.demo) return json({ estimate: true, suggestion: null, hidden: "not_enough_data" });
  const contactId = sp.get("contactId");
  let source: string | null = null;
  if (contactId) {
    if (!isId(contactId)) return gone();
    const facts = await contactFacts(ctx.installationId, locationId, [contactId]);
    if (!facts.has(contactId)) return gone();
    source = await sourceOf(ctx.installationId, locationId, contactId);
  }
  const res = suggestAssignee(await candidatesFor(ctx.installationId, locationId, source, Date.now()));
  return json({
    estimate: true, ...res, minimum: { leads: MIN_LEADS, days: MIN_DAYS },
    hiddenText: res.hidden === "not_enough_data" ? `Not enough history yet. A suggestion needs at least ${MIN_LEADS} leads handled over ${MIN_DAYS} days for each person it considers.` : res.hidden === "nobody_available" ? "Everyone on this account is marked away." : null,
    how: "SubSync suggests the person with the fewest leads waiting, then the fastest reply for this kind of lead. It never assigns anything by itself.",
  });
}

// ---------------- spread an overloaded person's waiting leads ----------------

async function rebalanceRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  const sp = ctx.url.searchParams;
  const locationId = await accountOf(ctx, h, sp.get("locationId"));
  const userId = sp.get("userId");
  if (!locationId || !isId(userId)) return gone();
  const inst = ctx.installationId;
  const members = await membersOf(inst, locationId);
  if (!members.some((m) => m.id === userId)) return gone();
  if (ctx.demo) return json({ estimate: true, hidden: "not_enough_data", groups: [] });
  const now = Date.now();
  const cands = await candidatesFor(inst, locationId, null, now);
  const src = cands.find((c) => c.userId === userId);
  if (!src) return gone();
  const waiting = await waitingLeadsOf(inst, locationId, userId, now);
  const facts = await contactFacts(inst, locationId, waiting.map((w) => w.contactId));
  const leads = waiting.flatMap((w) => { const f = facts.get(w.contactId); return f ? [{ ...w, name: f.name, protectedBy: leadProtections(f) }] : []; });
  const plan = planRebalance(src, leads, cands);
  return json({
    ...plan, minimum: { leads: MIN_LEADS, days: MIN_DAYS },
    hiddenText: plan.hidden === "not_enough_data" ? `Not enough history yet. A suggestion needs at least ${MIN_LEADS} leads handled over ${MIN_DAYS} days for each person it would give leads to.` : plan.hidden === "nobody_available" ? "Nobody else on this account is available." : plan.hidden === "balanced" ? "The waiting leads are already spread evenly." : null,
    how: "Each group is moved with the ordinary preview, one person at a time. SubSync changes only the owner and sends nothing to the lead.",
  });
}

// ---------------- move leads to another owner ----------------

const ownerLine = (id: string | null, names: Map<string, string>) => (id ? names.get(id) ?? "Someone else" : "Nobody");

async function reassignRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  if (ctx.demo) return demoWrite();
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send a JSON body." }, 400);
  const locationId = await accountOf(ctx, h, b.locationId);
  const ids = idList(b.contactIds, REASSIGN_CAP * 4);
  if (!locationId || !ids || !isId(b.toUserId)) return json({ error: "Choose the leads and the person" }, 400);
  const inst = ctx.installationId;
  const [facts, members] = await Promise.all([contactFacts(inst, locationId, ids), membersOf(inst, locationId)]);
  // Anything not found in THIS account is counted, never named.
  const items = ids.flatMap((i) => { const f = facts.get(i); return f ? [{ contactId: f.contactId, name: f.name, dnd: f.dnd, owner: f.owner, openDeals: f.openDeals, wonDeals: f.wonDeals, upcomingAppointments: f.upcomingAppointments }] : []; });
  const unknown = ids.length - items.length;
  if (items.length === 0) return gone();
  const now = Date.now();
  const away = await activeAway(inst, [b.toUserId], now);
  const plan = planReassign(items, b.toUserId, { members, awayUntil: away.rows.find((r) => r.kind === "away")?.until ?? null, now });
  const md = await mode(ctx, locationId);
  const hasScope = await installationHasScope(inst, REASSIGN_SCOPE);
  const names = new Map(members.map((x) => [x.id, x.name]));
  const toName = names.get(b.toUserId) ?? null;
  const suggested = b.suggested === true;
  if (b.step !== "do") {
    const links = await h.links();
    return json({
      ok: true, mode: md, needsPermission: !hasScope, owner: toName, suggested,
      plan: {
        change: plan.change.map((i) => ({ contactId: i.contactId, name: i.name, from: ownerLine(i.fromOwner, names), url: links.contact(locationId, i.contactId) })),
        same: plan.same, unknown, protected: plan.protectedItems.map((i) => ({ contactId: i.contactId, name: i.name, reasons: i.protectedBy.map((x) => x.text) })), overCap: plan.overCap, cap: REASSIGN_CAP,
        blockers: plan.blockers, warnings: plan.warnings, needsTick: acksNeeded(plan), reversible: plan.reversible, undoMinutes: UNDO_MINUTES,
        summary: `Move ${plan.change.length} lead${plan.change.length === 1 ? "" : "s"} to ${toName ?? "this person"}. SubSync changes only the owner and sends nothing to the lead.`,
        ...(suggested ? { note: "This person was suggested by an estimate. You decide." } : {}),
      },
    });
  }
  if (plan.blockers.length) return json({ ok: false, blocked: true, blockers: plan.blockers }, 422);
  if (plan.change.length === 0) return json({ ok: false, blocked: true, blockers: [{ id: "none", text: "Nothing here can be moved." }] }, 422);
  if (!acksGiven(plan, b.acks)) return json({ ok: false, blocked: true, blockers: [{ id: "tick", text: "Tick that you checked the notes about this lead first." }] }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const batchId = randomUUID();
  const log: WriteLogRow[] = [];
  let done = 0, dry = 0, failed = 0, permission = false, limited = false;
  let retry = 0; let dryReason: "switch" | "account" = md.optedIn ? "switch" : "account";
  for (const it of plan.change) {
    const r = await writeOwner({ installationId: inst, locationId, actor: actorOf(ctx), contactId: it.contactId, toUserId: b.toUserId, optedIn: md.optedIn, token: () => h.locationToken(locationId) });
    log.push({ locationId, batchId, action: "reassign", contactId: it.contactId, before: it.fromOwner, after: b.toUserId, suggested, result: r.outcome, actor: ctx.session.userId ?? null });
    if (r.outcome === "done") { done++; await applyOwnerLocal(inst, locationId, it.contactId, b.toUserId); }
    else if (r.outcome === "dry_run") { dry++; dryReason = r.reason; }
    else failed++;
    if (r.outcome === "needs_permission") { permission = true; break; }
    if (r.outcome === "rate_limited") { limited = true; retry = r.retryInSeconds; break; }
  }
  await logWrites(inst, log);
  if (permission) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  if (limited) return json({ ok: false, batchId, done, message: `Slow down a little: try again in ${retry || 30} seconds. ${done} lead${done === 1 ? " was" : "s were"} moved.`, retryInSeconds: retry }, 429);
  const message = dry ? `${dryRunWords(dryReason)} ${dry} move${dry === 1 ? "" : "s"} checked.` : failed ? `${done} moved, ${failed} could not be moved. Your CRM did not accept those. Nothing else changed.` : `${done} lead${done === 1 ? "" : "s"} now belong${done === 1 ? "s" : ""} to ${toName ?? "that person"}.`;
  return json({ ok: failed === 0, batchId, done, dryRun: dry, failed, protected: plan.protectedItems.length, message, undoable: plan.reversible && done > 0, undoMinutes: UNDO_MINUTES }, failed ? 502 : 200);
}

async function undoRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  if (ctx.demo) return demoWrite();
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || typeof b.batchId !== "string" || !UUID.test(b.batchId)) return json({ error: "Choose the change" }, 400);
  const inst = ctx.installationId; const now = Date.now();
  const rows = await batchOf(inst, locationId, b.batchId);
  const fresh = undoable(rows, now);
  const already = await alreadyUndone(inst, locationId, fresh.map((r) => r.contactId), now - UNDO_MINUTES * 60_000);
  const todo = fresh.filter((r) => !already.has(r.contactId));
  if (todo.length === 0) return json({ ok: false, message: `A move can be put back for ${UNDO_MINUTES} minutes after it is made. That time has passed, or it was already put back.` }, 410);
  const [facts, members] = await Promise.all([contactFacts(inst, locationId, todo.map((r) => r.contactId)), membersOf(inst, locationId)]);
  const memberIds = new Set(members.map((x) => x.id));
  // Only a lead still with the person it was moved to goes back: if someone changed the owner since, that newer choice is kept.
  const go = todo.filter((r) => facts.get(r.contactId)?.owner === r.after && r.before && memberIds.has(r.before));
  const skipped = todo.length - go.length;
  const md = await mode(ctx, locationId);
  if (b.step !== "do") return json({ ok: true, mode: md, plan: { count: go.length, skipped, summary: `Put ${go.length} lead${go.length === 1 ? "" : "s"} back with the owner ${go.length === 1 ? "it" : "they"} had before.` } });
  if (go.length === 0) return json({ ok: false, message: "Nothing can be put back: the owner was changed again since, or the earlier owner is no longer on the team." }, 410);
  if (md.live && !(await installationHasScope(inst, REASSIGN_SCOPE))) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const log: WriteLogRow[] = [];
  let done = 0, dry = 0, failed = 0; let dryReason: "switch" | "account" = md.optedIn ? "switch" : "account";
  for (const r of go) {
    const res = await writeOwner({ installationId: inst, locationId, actor: actorOf(ctx), contactId: r.contactId, toUserId: r.before as string, optedIn: md.optedIn, token: () => h.locationToken(locationId) });
    log.push({ locationId, batchId: b.batchId, action: "undo", contactId: r.contactId, before: r.after, after: r.before, suggested: false, result: res.outcome, actor: ctx.session.userId ?? null });
    if (res.outcome === "done") { done++; await applyOwnerLocal(inst, locationId, r.contactId, r.before as string); } else if (res.outcome === "dry_run") { dry++; dryReason = res.reason; } else failed++;
    if (res.outcome === "needs_permission" || res.outcome === "rate_limited") break;
  }
  await logWrites(inst, log);
  return json({ ok: failed === 0, done, dryRun: dry, failed, skipped, message: dry ? `${dryRunWords(dryReason)} Nothing was sent.` : `${done} lead${done === 1 ? "" : "s"} put back.` });
}

async function logRoute(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  if (ctx.demo) return json({ rows: [] });
  const req = ctx.url.searchParams.get("locationId");
  const loc = req ? await accountOf(ctx, h, req) : null;
  if (req && !loc) return gone();
  const rows = await recentWrites(ctx.installationId, loc ? [loc] : await h.allowed(), 50);
  const [names, links] = await Promise.all([namesOf(ctx.installationId, rows.flatMap((r) => [r.before, r.after].filter((x): x is string => !!x))), h.links()]);
  return json({ rows: rows.map((r) => ({ at: r.at, action: r.action, from: r.before ? names.get(r.before) ?? "Someone else" : "Nobody", to: r.after ? names.get(r.after) ?? "Someone else" : "Nobody", suggested: r.suggested, result: r.result, url: links.contact(r.locationId, r.contactId) })) });
}

// ---------------- the client receipt ----------------

/** The period: `days` (1 to 90, default 7) ending on `end` (a date, default today), as whole UTC days. */
function periodOf(sp: URLSearchParams, now: number): { from: number; to: number } | null {
  const days = sp.get("days") === null ? 7 : Number(sp.get("days"));
  if (!Number.isInteger(days) || days < 1 || days > PROOF_MAX_DAYS) return null;
  const endRaw = sp.get("end");
  const today = Math.floor(now / DAY) * DAY;
  let endDay = today;
  if (endRaw !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) return null;
    const t = Date.parse(`${endRaw}T00:00:00Z`);
    if (!Number.isFinite(t) || t > today) return null;
    endDay = t;
  }
  const to = endDay + DAY;
  return { from: to - days * DAY, to };
}

async function proofRoute(ctx: Ctx, h: PeopleActionHelpers, csv: boolean): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  const sp = ctx.url.searchParams;
  const locationId = await accountOf(ctx, h, sp.get("locationId"));
  if (!locationId) return gone();
  const win = periodOf(sp, Date.now());
  if (!win) return json({ error: `Choose between 1 and ${PROOF_MAX_DAYS} days, ending today or earlier.` }, 400);
  if (ctx.demo) return json({ proof: null, text: "", ready: true });
  const [prefs, target, brand] = await Promise.all([proofPrefs(ctx.installationId, locationId), accountReplyTarget(ctx.installationId, locationId), h.brand()]);
  const facts = await proofFacts(ctx.installationId, locationId, win.from, win.to, target);
  const proof = proofOf({ ...facts, nameStaff: prefs.nameStaff });
  if (csv) {
    return new Response(proofCsv(proof, brand), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="subsync-team-receipt.csv"`, "Cache-Control": "no-store" } });
  }
  return json({ proof, text: proofText(proof, brand), nameStaff: prefs.nameStaff, canChooseNames: prefs.ready, printable: { title: `Lead handling for ${proof.accountName}`, lines: proof.lines, table: proof.table, notes: proof.notes }, cap: EXPORT_CAP });
}

async function proofPrefsGet(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  const locationId = await accountOf(ctx, h, ctx.url.searchParams.get("locationId"));
  if (!locationId) return gone();
  const p = ctx.demo ? { ready: true, nameStaff: false } : await proofPrefs(ctx.installationId, locationId);
  return json({ ready: p.ready, nameStaff: p.nameStaff });
}

async function proofPrefsSet(ctx: Ctx, h: PeopleActionHelpers): Promise<Response> {
  if (viewerFor(ctx).role !== "manager") return managersOnly();
  if (ctx.demo) return demoWrite();
  const b = await readBody(ctx);
  const locationId = await accountOf(ctx, h, b?.locationId);
  if (!b || !locationId || typeof b.nameStaff !== "boolean") return json({ error: "Choose the account and yes or no" }, 400);
  const before = await proofPrefs(ctx.installationId, locationId);
  if (b.step !== "do") return json({ ok: true, preview: { summary: b.nameStaff ? "Show staff names on this client's receipts." : "Show the team as a whole on this client's receipts.", changes: [{ label: "Names on receipts", from: before.nameStaff ? "yes" : "no", to: b.nameStaff ? "yes" : "no" }], note: "People with fewer than 5 leads are always grouped as Others." } });
  if (!(await setProofPrefs(ctx.installationId, locationId, b.nameStaff, actorOf(ctx)))) return json({ error: "Saving this needs the latest database update, which has not run yet." }, 503);
  await auditPeople(ctx.installationId, actorOf(ctx), "people.proof.names", { locationId, nameStaff: b.nameStaff });
  return json({ ok: true, message: "Saved." });
}
