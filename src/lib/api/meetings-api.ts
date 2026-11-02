import { installationHasScope } from "../analytics/cleanup-queries";
import { getSettings } from "../analytics/queries";
import { sql } from "../db";
import { alwaysIgnore, confirmAndRelease, daysLeft, dismissMeeting, findContacts, kindOf, linkMeeting, messageFor, noteInputOf, outcomeWords, previewFor } from "../connections/inbox";
import { pgInboxStore, listRecent, saveMySettings } from "../connections/inbox-store";
import { includesOf } from "../connections/ingest";
import { crmWriter } from "../connections/ingest-store";
import { accessibleAccounts, personFromSession, type Person } from "../connections/person";
import { matrixFor } from "../connections/policy";
import { renderNote } from "../connections/note-template";
import { isLive } from "../live-flags";
import { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The person's own Meeting inbox (stage E2a). Who the caller is comes ONLY from the signed session (`personFromSession`); no user id, role, company or
// account is read from the request. A person sees only their own calls: every query names the installation and the person's user id. The contact list a
// person can search, and the accounts a note can go to, are only the accounts they can open (src/lib/connections/person.ts `accessibleAccounts`).

type Ctx = AuthContext & { request: Request; url: URL };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION = /^[A-Za-z0-9_-]{3,64}$/;
const CONTACT = /^[A-Za-z0-9_-]{3,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const personOf = (ctx: Ctx): Person | null => personFromSession(ctx.session, ctx.kind, ctx.limitTo);
const NEED_SIGN_IN = () => json({ error: "Please sign in again" }, 401);
const NOT_FOUND = () => json({ error: "Not found" }, 404);

async function accountNames(installationId: string, ids: string[]): Promise<Array<{ locationId: string; name: string }>> {
  if (ids.length === 0) return [];
  const rows = await sql()`select location_id, name from locations where installation_id = ${installationId} and location_id = any(${ids}::text[]) order by name`;
  return rows.map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" }));
}

export async function meetingInboxView(ctx: Ctx): Promise<Response> {
  const empty = { demo: false, connected: false, canWrite: true, writeLive: false, settings: { masterSwitch: true, unmatchedMode: "inbox", previewConfirmed: true }, preview: null, waiting: [], recent: [], accounts: [] };
  if (ctx.demo) return json({ ...empty, demo: true });
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const store = pgInboxStore();
  const now = Date.now();
  const [settings, waiting, recent, connection, canWrite, installed] = await Promise.all([
    store.settings(ctx.installationId, person.userId), store.listWaiting(ctx.installationId, person.userId), listRecent(ctx.installationId, person.userId),
    store.getConnection(ctx.installationId, person.userId), installationHasScope(ctx.installationId, "contacts.write"), store.installed(ctx.installationId),
  ]);
  const matrix = matrixFor(settings.preset, settings.custom);
  const includes = includesOf(matrix);
  const heldFirst = waiting.find((m) => kindOf(m.reason) === "held") ?? null;
  const accounts = await accountNames(ctx.installationId, accessibleAccounts(person, installed, await store.provenAccess(ctx.installationId, person.userId)));
  return json({
    demo: false, connected: connection !== null, canWrite, writeLive: isLive("WRITE_GHL_LIVE"),
    settings: { masterSwitch: settings.masterSwitch, unmatchedMode: settings.unmatchedMode, previewConfirmed: settings.previewConfirmedAt !== null },
    preview: settings.previewConfirmedAt === null ? { ...previewFor(heldFirst, person, matrix), held: waiting.filter((m) => kindOf(m.reason) === "held").length } : null,
    waiting: waiting.map((m) => ({
      id: m.id, title: m.title, startedAt: m.startedAt, attendees: m.attendeeEmails, reason: m.reason, kind: kindOf(m.reason), message: messageFor(m.reason), daysLeft: daysLeft(m.expiresAt, now),
      summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl, noteText: kindOf(m.reason) === "unmatched" ? renderNote(noteInputOf(m, person.name), includes).text : null,
    })),
    recent: recent.map((r) => ({ id: r.id, title: r.title, startedAt: r.startedAt, receivedAt: new Date(r.createdAt).toISOString(), status: r.status, outcome: outcomeWords(r.status, r.reason, r.notes) })),
    accounts,
  });
}

export async function meetingContactSearch(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!UUID.test(id)) return NOT_FOUND();
  const store = pgInboxStore();
  // The call must be this person's own and still waiting; the search is only inside the accounts they can open.
  const row = await store.getMeeting(ctx.installationId, person.userId, id);
  if (!row || row.status !== "needs_contact") return NOT_FOUND();
  const q = ctx.url.searchParams.get("q") ?? "";
  const account = ctx.url.searchParams.get("account");
  const hits = await findContacts(store, person, ctx.installationId, q, account && LOCATION.test(account) ? account : null);
  const [names, settings] = await Promise.all([accountNames(ctx.installationId, [...new Set(hits.map((h) => h.locationId))]), getSettings(ctx.installationId)]);
  const nameOf = new Map(names.map((n) => [n.locationId, n.name]));
  const links = deepLinks(settings.appDomain);
  return json({ results: hits.map((h) => ({ ...h, accountName: nameOf.get(h.locationId) ?? "Unnamed account", url: links.contact(h.locationId, h.contactId) })) });
}

export async function meetingLink(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!UUID.test(id)) return NOT_FOUND();
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; contactId?: unknown } | null;
  if (!body || typeof body.locationId !== "string" || typeof body.contactId !== "string" || !LOCATION.test(body.locationId) || !CONTACT.test(body.contactId)) return json({ error: "Pick the account and the contact first" }, 400);
  const result = await linkMeeting(pgInboxStore(), person, ctx.installationId, id, { locationId: body.locationId, contactId: body.contactId }, crmWriter(person.companyKey));
  if (result.ok) return json({ ok: true, dryRun: result.dryRun, notes: result.notes });
  return json({ error: result.message, code: result.code }, result.code === "not_found" ? 404 : result.code === "needs_permission" ? 403 : result.code === "write_failed" ? 502 : 409);
}

export async function meetingDismiss(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!UUID.test(id)) return NOT_FOUND();
  return (await dismissMeeting(pgInboxStore(), person, ctx.installationId, id)) ? json({ ok: true }) : NOT_FOUND();
}

export async function meetingIgnore(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!UUID.test(id)) return NOT_FOUND();
  const body = (await ctx.request.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== "string" || !EMAIL.test(body.email.trim())) return json({ error: "Choose which email to ignore" }, 400);
  return (await alwaysIgnore(pgInboxStore(), person, ctx.installationId, id, body.email)) ? json({ ok: true }) : NOT_FOUND();
}

export async function meetingConfirm(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const result = await confirmAndRelease(pgInboxStore(), person, ctx.installationId, crmWriter(person.companyKey));
  return json({ ok: true, ...result, writeLive: isLive("WRITE_GHL_LIVE") });
}

export async function meetingSettingsSave(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const body = (await ctx.request.json().catch(() => null)) as { masterSwitch?: unknown; unmatchedMode?: unknown } | null;
  if (!body) return json({ error: "Nothing to save" }, 400);
  const patch: { masterSwitch?: boolean; unmatchedMode?: "inbox" | "discard" } = {};
  if (typeof body.masterSwitch === "boolean") patch.masterSwitch = body.masterSwitch;
  if (body.unmatchedMode === "inbox" || body.unmatchedMode === "discard") patch.unmatchedMode = body.unmatchedMode;
  if (Object.keys(patch).length === 0) return json({ error: "Nothing to save" }, 400);
  await saveMySettings(ctx.installationId, person, patch);
  return json({ ok: true });
}
