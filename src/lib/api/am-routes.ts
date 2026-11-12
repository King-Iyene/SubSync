import { installationHasScope } from "../analytics/cleanup-queries";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { AUTO_EXPLAIN } from "../connections/auto-note";
import { markUndone } from "../connections/write-log";
import { DEFAULT_PREFS } from "../connections/slack-auto";
import { buildDeleteOwn, writeToCrm } from "../ghl/crm-writes";
import { isLive, outward } from "../live-flags";
import { personFromSession } from "../connections/person";
import type { Feature } from "../entitlements";
import { sql } from "../db";
import { locationAccessToken } from "../sync/engine";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// Automation pass, under /api/app/am/<part>. Who is asking comes ONLY from the signed session; ids from the request are checked with the tenant guard and never echoed.
//   GET  notes           the person's setting, today's added notes and their notices        am_auto_notes
//   POST notes           { accept: true, on: boolean }  turns automatic notes on (after the one line was accepted) or off
//   POST undo            { id }  removes one note SubSync added (only your own, the same day)
//   POST read            marks the person's notices read
//   GET  slack           pause, muted accounts, quiet hours                                  am_slack_auto
//   POST slack           { pauseAll?, muted?: string[] }  administrators only
//   POST slack-test      sends a test (a dry run while the Slack switch is off)

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const NOT_FOUND = () => json({ error: "Not found" }, 404);
const OFF = () => json({ error: "This is not switched on for your account" }, 404);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleAm(ctx: Ctx, h: { allowed: () => Promise<string[] | null> }): Promise<Response> {
  const part = ctx.segments[1];
  const m = ctx.request.method;
  if (ctx.demo) return json({ demo: true });
  const person = personFromSession(ctx.session, ctx.kind, ctx.limitTo);
  if (!person) return json({ error: "Please sign in again" }, 401);
  if (part === "slack" || part === "slack-test") {
    if (!on(ctx, "am_slack_auto")) return OFF();
    if (ctx.kind === "client") return json({ error: "Only an administrator can change Slack." }, 403);
    if (part === "slack" && m === "GET") return slackGet(ctx);
    if (part === "slack" && m === "POST") return slackSet(ctx, h);
    if (part === "slack-test" && m === "POST") return slackTest(ctx, person.userId);
    return NOT_FOUND();
  }
  if (!on(ctx, "am_auto_notes")) return OFF();
  if (part === "notes" && m === "GET") return notesGet(ctx, person.userId);
  if (part === "notes" && m === "POST") return notesSet(ctx, person.userId);
  if (part === "undo" && m === "POST") return undo(ctx, person.userId);
  if (part === "read" && m === "POST") {
    await sql()`update am_notices set read_at = now() where installation_id = ${ctx.installationId} and owner_ghl_user_id = ${person.userId} and read_at is null`;
    return json({ ok: true });
  }
  return NOT_FOUND();
}

async function notesGet(ctx: Ctx, userId: string): Promise<Response> {
  const db = sql();
  const [s] = await db`select auto_add_notes, auto_add_accepted_at from meeting_note_settings where installation_id = ${ctx.installationId} and ghl_user_id = ${userId}`;
  const [fathom] = await db`select 1 x from user_connections where installation_id = ${ctx.installationId} and ghl_user_id = ${userId} and provider = 'fathom' and status = 'connected' limit 1`;
  const added = await db`select a.id, a.status, a.created_at, nullif(btrim(c.full_name), '') name
    from am_auto_adds a left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
    where a.installation_id = ${ctx.installationId} and a.owner_ghl_user_id = ${userId} and a.created_at >= date_trunc('day', now()) and a.status <> 'undone' order by a.created_at desc limit 50`;
  const notices = await db`select id, kind, text, created_at, read_at from am_notices where installation_id = ${ctx.installationId} and owner_ghl_user_id = ${userId} order by created_at desc limit 20`;
  const granted = await installationHasScope(ctx.installationId, "contacts.write");
  return json({
    connected: !!fathom, on: s?.auto_add_notes === true && !!s?.auto_add_accepted_at, accepted: !!s?.auto_add_accepted_at, explain: AUTO_EXPLAIN,
    needsPermission: !granted, permissionText: granted ? null : "Needs permission: reconnect. SubSync cannot add notes to contacts yet.",
    added: added.map((r) => ({ id: r.id, name: r.name ?? "Contact", practice: r.status === "dry_run", at: r.created_at })),
    notices: notices.map((r) => ({ id: r.id, kind: r.kind, text: r.text, at: r.created_at, unread: !r.read_at })),
  });
}

async function notesSet(ctx: Ctx, userId: string): Promise<Response> {
  const b = (await ctx.request.json().catch(() => null)) as { on?: unknown; accept?: unknown } | null;
  if (typeof b?.on !== "boolean") return json({ error: "Say whether this is on or off." }, 400);
  if (b.on && b.accept !== true) return json({ error: "Read the one line and accept it first." }, 400);
  await sql()`insert into meeting_note_settings (installation_id, ghl_user_id, auto_add_notes, auto_add_accepted_at)
    values (${ctx.installationId}, ${userId}, ${b.on}, ${b.on ? new Date() : null})
    on conflict (ghl_user_id) do update set auto_add_notes = ${b.on}, auto_add_accepted_at = case when ${b.on} then coalesce(meeting_note_settings.auto_add_accepted_at, now()) else meeting_note_settings.auto_add_accepted_at end
    where meeting_note_settings.installation_id = ${ctx.installationId}`;
  return json({ ok: true, on: b.on });
}

async function undo(ctx: Ctx, userId: string): Promise<Response> {
  const b = (await ctx.request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof b?.id !== "string" || !UUID.test(b.id)) return NOT_FOUND();
  const [a] = await sql()`select id, meeting_id, location_id, contact_id from am_auto_adds where id = ${b.id} and installation_id = ${ctx.installationId} and owner_ghl_user_id = ${userId} and status <> 'undone' and created_at >= date_trunc('day', now())`;
  if (!a) return NOT_FOUND();
  const [w] = await sql()`select ghl_id from crm_writes where installation_id = ${ctx.installationId} and meeting_id = ${a.meeting_id} and contact_id = ${a.contact_id} and kind = 'note' and ghl_id is not null and undone_at is null order by created_at limit 1`;
  const live = isLive("WRITE_GHL_LIVE") && (await writeEnabledFor(ctx.installationId, a.location_id as string));
  if (w && live) {
    const [inst] = await sql()`select company_key from installations where id = ${ctx.installationId}`;
    const r = await writeToCrm({ installationId: ctx.installationId, locationId: a.location_id as string, contactId: a.contact_id as string, request: buildDeleteOwn({ contactId: a.contact_id as string, kind: "notes", id: w.ghl_id as string }), token: () => locationAccessToken(inst.company_key as string, a.location_id as string) }).catch(() => ({ outcome: "failed" as const, status: 0 }));
    if (r.outcome !== "written") return json({ error: "Could not remove the note. Nothing changed. Try again." }, 502);
    await markUndone(ctx.installationId, w.ghl_id as string);
  }
  await sql()`update am_auto_adds set status = 'undone', undone_at = now() where id = ${a.id} and installation_id = ${ctx.installationId}`;
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${userId}, 'meeting_notes.auto_note_undone', ${sql().json({ meetingId: a.meeting_id, locationId: a.location_id, contactId: a.contact_id } as never)})`.catch(() => undefined);
  return json({ ok: true, message: "Undone. The note was removed from the contact." });
}

async function slackGet(ctx: Ctx): Promise<Response> {
  const [p] = await sql()`select pause_all, muted_locations from am_slack_prefs where installation_id = ${ctx.installationId}`;
  return json({ pauseAll: p?.pause_all === true, muted: (p?.muted_locations as string[] | undefined) ?? [], quiet: { on: DEFAULT_PREFS.quietOn, start: DEFAULT_PREFS.quietStart, end: DEFAULT_PREFS.quietEnd }, live: isLive("SEND_SLACK_LIVE") });
}

async function slackSet(ctx: Ctx, h: { allowed: () => Promise<string[] | null> }): Promise<Response> {
  const b = (await ctx.request.json().catch(() => null)) as { pauseAll?: unknown; muted?: unknown } | null;
  const [cur] = await sql()`select pause_all, muted_locations from am_slack_prefs where installation_id = ${ctx.installationId}`;
  let pause = cur?.pause_all === true;
  let muted = (cur?.muted_locations as string[] | undefined) ?? [];
  if (typeof b?.pauseAll === "boolean") pause = b.pauseAll;
  if (Array.isArray(b?.muted)) {
    const allowed = await h.allowed();
    const ok: string[] = [];
    for (const v of (b.muted as unknown[]).slice(0, 200)) {
      const id = await ownedLocation(ctx.installationId, allowed, v);
      if (id) ok.push(id);
    }
    muted = [...new Set(ok)];
  }
  await sql()`insert into am_slack_prefs (installation_id, pause_all, muted_locations, updated_at) values (${ctx.installationId}, ${pause}, ${muted}::text[], now())
    on conflict (installation_id) do update set pause_all = ${pause}, muted_locations = ${muted}::text[], updated_at = now()`;
  return json({ ok: true, pauseAll: pause, muted });
}

async function slackTest(ctx: Ctx, userId: string): Promise<Response> {
  const out = await outward({ flag: "SEND_SLACK_LIVE", verb: "SEND", what: "slack.test.message", ids: { user: userId }, installationId: ctx.installationId }, async () => true);
  return json({ ok: true, practice: !out.live, message: out.live ? "A test message was sent to your Slack channel." : "Test mode: the message was prepared and logged, but Slack sending is switched off on this server, so nothing was sent." });
}
