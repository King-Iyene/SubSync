import { availability, startLink } from "../connections/flow";
import { can, personFromSession } from "../connections/person";
import { isLive } from "../live-flags";
import { emailConfigured } from "../email";
import { sql } from "../db";
import { visibleItems, unreadCount, isSnoozeChoice, snoozeUntil, SNOOZE_CHOICES } from "../notifications/bell";
import { CATALOG, NOTIFICATION_TYPES, isNotificationType, type NotificationType } from "../notifications/catalog";
import { checkTemplate, previewCopy } from "../notifications/copy";
import { applyUpdate, LEGACY_DESTINATION, MAX_DESTINATIONS, parseUpdate, type Pref } from "../notifications/prefs";
import { sampleSlack, loadContext, sendEmailTest, sampleItem } from "../notifications/service";
import { shownDestination } from "../notifications/slack";
import { addAdvancedDestination, createPendingDestination, insertNotification, listBell, listDestinations, markAllRead, recentProblems, removeDestination, savePref, setBellState, type BellScope } from "../notifications/store";
import { testSlackDestination } from "../notifications/transports";
import { quietText, whenText, zoneOf, CATCHUP_TEXT } from "../notifications/timing";
import { testOutcomeText } from "../notifications/test-send";
import { json, type AuthContext } from "./auth";

// The endpoints behind the bell and the Notifications page (stage F9). Who the caller is comes ONLY from the signed session; no installation id, user id,
// role or account id from the request is trusted. The bell is open to every kind of person (a client's staff see only their own account's items, and only
// their own read, dismiss and snooze marks). Preferences, Slack channels and tests are for administrators. Nothing here returns a Slack channel address.

type Ctx = AuthContext & { request: Request; url: URL };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION = /^[A-Za-z0-9_-]{3,64}$/;

const personOf = (ctx: Ctx) => personFromSession(ctx.session, ctx.kind, ctx.limitTo);
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
const userKey = (ctx: Ctx) => ctx.session.userId ?? `co:${ctx.session.companyId}`;
const scopeOf = (ctx: Ctx): BellScope => ({ kind: ctx.kind, limitTo: ctx.limitTo });

/** Administrators (the company's owner and administrators, a business's administrator). The demo is open so the screens can be shown. */
function isAdmin(ctx: Ctx): boolean {
  if (ctx.demo) return ctx.kind !== "client";
  const p = personOf(ctx);
  return Boolean(p && can(p.role, "connect_workspace") && ctx.kind !== "client");
}
const FORBIDDEN = () => json({ error: "This is for administrators", forbidden: true }, 403);

// ---------------- the bell ----------------

export async function bellView(ctx: Ctx): Promise<Response> {
  const now = Date.now();
  const all = await listBell(ctx.installationId, scopeOf(ctx), userKey(ctx), now);
  const items = visibleItems(all, now);
  return json({
    now,
    unread: unreadCount(all, now),
    canManage: isAdmin(ctx),
    snooze: SNOOZE_CHOICES,
    items: items.map((i) => ({ id: i.id, type: i.type, severity: i.severity, title: i.title, body: i.body, link: i.link, createdAt: new Date(i.createdAt).toISOString(), read: i.readAt !== null })),
  });
}

export async function bellAction(ctx: Ctx, id: string, action: string): Promise<Response> {
  const scope = scopeOf(ctx);
  const key = userKey(ctx);
  if (id === "read-all" && !action) return json({ ok: true, count: await markAllRead(ctx.installationId, scope, key) });
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  let ok = false;
  if (action === "read") ok = await setBellState(ctx.installationId, scope, key, id, { read: true });
  else if (action === "dismiss") ok = await setBellState(ctx.installationId, scope, key, id, { dismiss: true });
  else if (action === "snooze") {
    const body = (await ctx.request.json().catch(() => null)) as { choice?: unknown } | null;
    if (!isSnoozeChoice(body?.choice)) return json({ error: "Pick how long to snooze it" }, 400);
    const l = await loadContext(ctx.installationId);
    const zone = zoneOf(l.prefs.daily_brief.timing, l.fallbackZone);
    ok = await setBellState(ctx.installationId, scope, key, id, { snoozeUntil: snoozeUntil(body.choice, Date.now(), zone) });
  } else return json({ error: "Not found" }, 404);
  // The same answer whether the item is missing or belongs to someone else: a person learns nothing about items outside their own view.
  return ok ? json({ ok: true }) : json({ error: "Not found" }, 404);
}

// ---------------- the preferences matrix ----------------

type TypeView = {
  id: NotificationType; label: string; hint: string; kind: string; active: boolean; frequencies: string[];
  variables: Array<{ name: string; label: string; sample: string }>;
  defaults: { title: string; body: string };
  pref: Pref & { whenText: string; quietText: string; zone: string };
  customCopy: boolean;
  preview: { title: string; body: string };
};

function typeView(t: NotificationType, pref: Pref, fallbackZone: string | null): TypeView {
  const info = CATALOG[t];
  const sample = sampleItem(t, pref);
  return {
    id: t, label: info.label, hint: info.hint, kind: info.kind, active: info.active, frequencies: info.frequencies, variables: info.variables,
    defaults: { title: info.defaultTitle, body: info.defaultBody },
    pref: { ...pref, whenText: whenText(pref.timing), quietText: quietText(pref.timing), zone: zoneOf(pref.timing, fallbackZone) },
    customCopy: pref.copy.title !== null || pref.copy.body !== null,
    preview: { title: sample.title, body: sample.body },
  };
}

async function destinationsPayload(ctx: Ctx) {
  const list = await listDestinations(ctx.installationId);
  const names = new Map<string, string>();
  const ids = [...new Set(list.map((d) => d.locationId).filter((x): x is string => !!x))];
  if (ids.length) for (const r of await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and location_id = any(${ids}::text[])`) names.set(r.location_id as string, (r.name as string | null) ?? "Unnamed account");
  const now = Date.now();
  return list.map((d) => ({
    id: d.id, label: d.label, locationId: d.locationId, accountName: d.locationId ? names.get(d.locationId) ?? null : null,
    status: shownDestination({ status: d.status, pendingSince: d.pendingSince }, now), legacy: d.legacy, lastErrorCode: d.lastErrorCode,
  }));
}

export async function prefsView(ctx: Ctx): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const l = await loadContext(ctx.installationId);
  const accounts = ctx.kind === "agency" ? (await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored order by name limit 300`).map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account" })) : [];
  return json({
    mode: l.mode,
    types: NOTIFICATION_TYPES.map((t) => typeView(t, l.prefs[t], l.fallbackZone)),
    destinations: await destinationsPayload(ctx),
    accounts,
    flags: { emailLive: isLive("SEND_EMAIL_LIVE"), slackLive: isLive("SEND_SLACK_LIVE"), emailReady: emailConfigured(), slackAvailable: availability().slack },
    zone: l.fallbackZone,
    catchup: CATCHUP_TEXT,
    problems: await recentProblems(ctx.installationId),
    maxDestinations: MAX_DESTINATIONS,
  });
}

function typeOf(raw: string): NotificationType | null {
  return isNotificationType(raw) ? raw : null;
}

export async function prefSave(ctx: Ctx, rawType: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const type = typeOf(rawType);
  if (!type) return json({ error: "Not found" }, 404);
  const body = await ctx.request.json().catch(() => null);
  const l = await loadContext(ctx.installationId);
  const parsed = parseUpdate(type, body, new Set(l.destinations.map((d) => d.id)));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const next = applyUpdate(l.prefs[type], parsed.update);
  await savePref(ctx.installationId, next, actorOf(ctx));
  return json({ ok: true, type: typeView(type, next, l.fallbackZone) });
}

export async function copyPreview(ctx: Ctx, rawType: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const type = typeOf(rawType);
  if (!type) return json({ error: "Not found" }, 404);
  const body = (await ctx.request.json().catch(() => null)) as { title?: unknown; body?: unknown } | null;
  return json(previewCopy(type, { title: body?.title, body: body?.body ?? "" }));
}

export async function copySave(ctx: Ctx, rawType: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const type = typeOf(rawType);
  if (!type) return json({ error: "Not found" }, 404);
  const body = (await ctx.request.json().catch(() => null)) as { title?: unknown; body?: unknown } | null;
  const title = checkTemplate(type, "title", body?.title);
  const text = checkTemplate(type, "body", body?.body ?? "");
  if (!title.ok || !text.ok) return json({ error: (!title.ok ? title.error : (text as { error: string }).error), errors: { ...(title.ok ? {} : { title: title.error }), ...(text.ok ? {} : { body: (text as { error: string }).error }) } }, 400);
  const info = CATALOG[type];
  const l = await loadContext(ctx.installationId);
  // Wording that equals the default is stored as "no custom wording", so a later change of the default reaches this person too.
  const t = (body!.title as string) === info.defaultTitle ? null : (body!.title as string);
  const b = ((body!.body as string) ?? "") === info.defaultBody ? null : ((body!.body as string) ?? "");
  const next: Pref = { ...l.prefs[type], copy: { title: t, body: b } };
  await savePref(ctx.installationId, next, actorOf(ctx));
  return json({ ok: true, type: typeView(type, next, l.fallbackZone) });
}

export async function copyReset(ctx: Ctx, rawType: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const type = typeOf(rawType);
  if (!type) return json({ error: "Not found" }, 404);
  const l = await loadContext(ctx.installationId);
  const next: Pref = { ...l.prefs[type], copy: { title: null, body: null } };
  await savePref(ctx.installationId, next, actorOf(ctx));
  return json({ ok: true, type: typeView(type, next, l.fallbackZone) });
}

/** "Send me a test": one email to one of the saved recipients, one test message to one channel, or one item in the bell. A dry run unless the address is the allowlisted one. */
export async function prefTest(ctx: Ctx, rawType: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const type = typeOf(rawType);
  if (!type) return json({ error: "Not found" }, 404);
  const body = (await ctx.request.json().catch(() => null)) as { channel?: unknown; to?: unknown; destinationId?: unknown } | null;
  const l = await loadContext(ctx.installationId);
  if (body?.channel === "in_app") {
    const item = sampleItem(type, l.prefs[type]);
    await insertNotification({ installationId: ctx.installationId, locationId: null, type, severity: "info", item: { ...item, title: `Test: ${item.title}` }, alertId: null, dedupeKey: `test:${type}:${Date.now()}` });
    return json({ ok: true, text: "A test item was added to your bell." });
  }
  if (ctx.demo) return json({ ok: false, text: "Sending a test is not available in the demo. It needs a real install." }, 400);
  if (body?.channel === "email") {
    if (typeof body.to !== "string") return json({ ok: false, text: "Pick an address to send the test to." }, 400);
    const out = await sendEmailTest(ctx.installationId, l, type, body.to.trim());
    const t = testOutcomeText(out, body.to.trim());
    return json({ ok: t.ok, text: t.text, status: out.status }, t.ok ? 200 : 400);
  }
  if (body?.channel === "slack") {
    const dest = typeof body.destinationId === "string" ? l.ctx.destinations.find((d) => d.id === body.destinationId) : undefined;
    if (!dest) return json({ ok: false, text: "That Slack channel is not connected." }, 404);
    const r = await testSlackDestination(ctx.installationId, dest, sampleSlack(l, type));
    if (!r.ok) return json({ ok: false, text: r.message, code: r.code }, 502);
    return json({ ok: true, text: r.dryRun ? "Test mode: the Slack message was prepared and logged, but sending is switched off on this server, so nothing was posted." : "A test message was posted to Slack." });
  }
  return json({ error: "Say where to send the test" }, 400);
}

// ---------------- Slack channels ----------------

export async function destinationsView(ctx: Ctx): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  return json({ destinations: await destinationsPayload(ctx), slackAvailable: availability().slack });
}

async function scopeFor(ctx: Ctx, raw: unknown): Promise<{ ok: true; locationId: string | null } | { ok: false; res: Response }> {
  // A business's account is the whole install, so its channels are not limited. A company may limit a channel to one client account: that channel then only ever
  // receives that account's messages. The id is checked against the company's own accounts, never trusted.
  if (ctx.kind !== "agency" || raw === undefined || raw === null || raw === "") return { ok: true, locationId: null };
  if (typeof raw !== "string" || !LOCATION.test(raw)) return { ok: false, res: json({ error: "Pick a client account from the list" }, 400) };
  const [known] = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${raw}`;
  return known ? { ok: true, locationId: raw } : { ok: false, res: json({ error: "Pick a client account from the list" }, 400) };
}

async function room(ctx: Ctx): Promise<boolean> {
  const [r] = await sql()`select count(*)::int n from notification_destinations where installation_id = ${ctx.installationId}`;
  return ((r?.n as number) ?? 0) < MAX_DESTINATIONS;
}

export async function destinationStart(ctx: Ctx): Promise<Response> {
  if (!isAdmin(ctx)) return json({ error: "Only an administrator can connect Slack", forbidden: true }, 403);
  if (ctx.demo) return json({ error: "Connecting is not available in the demo. It needs a real install." }, 400);
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown } | null;
  const scope = await scopeFor(ctx, body?.locationId);
  if (!scope.ok) return scope.res;
  if (!(await room(ctx))) return json({ error: `Up to ${MAX_DESTINATIONS} Slack channels. Remove one first.` }, 400);
  const id = await createPendingDestination(ctx.installationId, scope.locationId, actorOf(ctx));
  const link = startLink("slack", { provider: "slack", installationId: ctx.installationId, onlyLocationId: scope.locationId, actor: actorOf(ctx), destinationId: id });
  if (!link.ok) {
    await sql()`delete from notification_destinations where id = ${id} and installation_id = ${ctx.installationId}`;
    return json({ error: link.error }, 503);
  }
  return json({ url: link.url, id });
}

export async function destinationAdvanced(ctx: Ctx): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  const body = (await ctx.request.json().catch(() => null)) as { url?: unknown; label?: unknown; locationId?: unknown } | null;
  if (typeof body?.url !== "string") return json({ error: "Paste the Slack channel address" }, 400);
  const scope = await scopeFor(ctx, body.locationId);
  if (!scope.ok) return scope.res;
  if (!(await room(ctx))) return json({ error: `Up to ${MAX_DESTINATIONS} Slack channels. Remove one first.` }, 400);
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "Slack channel";
  const r = await addAdvancedDestination(ctx.installationId, { webhookUrl: body.url.trim(), label, locationId: scope.locationId }, actorOf(ctx));
  return r.ok ? json({ ok: true, id: r.id }) : json({ error: r.error }, 400);
}

export async function destinationTest(ctx: Ctx, id: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  if (id !== LEGACY_DESTINATION && !UUID.test(id)) return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ ok: false, text: "Sending a test is not available in the demo. It needs a real install." }, 400);
  const l = await loadContext(ctx.installationId);
  const dest = l.ctx.destinations.find((d) => d.id === id);
  if (!dest) return json({ error: "Not found" }, 404);
  const r = await testSlackDestination(ctx.installationId, dest, ":white_check_mark: This is a test from SubSync. Nothing is wrong.");
  if (!r.ok) return json({ ok: false, text: r.message, code: r.code, needsReconnect: r.needsReconnect }, 502);
  return json({ ok: true, text: r.dryRun ? "Test mode: the message was prepared and logged, but sending is switched off on this server, so nothing was posted." : "A test message was posted to Slack." });
}

export async function destinationRemove(ctx: Ctx, id: string): Promise<Response> {
  if (!isAdmin(ctx)) return FORBIDDEN();
  if (id !== LEGACY_DESTINATION && !UUID.test(id)) return json({ error: "Not found" }, 404);
  return (await removeDestination(ctx.installationId, id, actorOf(ctx))) ? json({ ok: true }) : json({ error: "Not found" }, 404);
}
