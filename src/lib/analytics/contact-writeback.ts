import { sql } from "../db";
import { buildDeleteOwn, buildNote, buildTags, buildTask, writeToCrm, type CrmRequest, type WriteResult } from "../ghl/crm-writes";
import { recordWrite } from "../ghl/crm-gateway";
import { recordCrmWrite, markUndone } from "../connections/write-log";
import { locationAccessToken } from "../sync/engine";
import { logOutcome } from "./call-queries";
import { changeTag } from "./contact-tags";
import { capReached, CAP_MESSAGE, idemKey, noteBody, outcomeNoteBody, saveMessage, tagFor, tagPrefix, type SaveStatus } from "../people/writeback";
import type { Outcome } from "./call-intel";

// Writes a note, or a call result, to the lead in the customer's CRM. One pipeline for both (docs/features/CONTACT_WRITEBACK.md):
//   claim an idempotency row -> check the cap -> (outcome) keep SubSync's own record -> note (+ tag, + follow-up task) through the one write client -> audit line.
// The one switch is WRITE_GHL_LIVE: off, every request is built and recorded as a dry run and nothing is sent. Notes, tags and tasks never message the person,
// so Do Not Disturb does not stop them (it is shown, not blocked). Every id the CRM gives back is stored so Undo can remove exactly what we made.

export type Who = { installationId: string; allowed: string[] | null; actor: string | null; actorName: string | null; granted: boolean };
export type WriteReply = { ok: boolean; status: SaveStatus | "limit" | "unknown" | "needs_update"; message: string; id?: string; canUndo?: boolean; duplicate?: boolean };

export const missingTable = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");
export const NEEDS_UPDATE: WriteReply = { ok: false, status: "needs_update", message: "Saving to your CRM needs the latest database update. Nothing was saved." };

export async function contactOf(w: Who, locationId: string, contactId: string) {
  const db = sql();
  const [c] = await db`
    select c.tags, i.company_id from cached_contacts c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    join installations i on i.id = c.installation_id
    where c.installation_id = ${w.installationId} and c.location_id = ${locationId} and c.contact_id = ${contactId}
      ${w.allowed ? db`and c.location_id = any(${w.allowed}::text[])` : db``}`;
  return c ? { rawTags: ((c.tags as string[] | null) ?? []), tags: ((c.tags as string[] | null) ?? []).map((t) => t.toLowerCase()), companyId: c.company_id as string } : null;
}

type Claim = { id: string } | { reply: WriteReply };
export async function claim(w: Who, a: { locationId: string; contactId: string; kind: string; outcome: string | null; key: string }): Promise<Claim> {
  const db = sql();
  const [n] = await db`select count(*)::int n from contact_writes where installation_id = ${w.installationId} and created_at > now() - interval '1 hour' and status <> 'failed'`;
  const fresh = await db`
    insert into contact_writes (installation_id, location_id, contact_id, kind, outcome, idem_key, actor, actor_name)
    select ${w.installationId}, ${a.locationId}, ${a.contactId}, ${a.kind}, ${a.outcome}, ${a.key}, ${w.actor}, ${w.actorName}
    where ${!capReached(Number(n?.n ?? 0))}
    on conflict (installation_id, idem_key) do nothing returning id`;
  if (fresh.length === 1) return { id: fresh[0].id as string };
  const [old] = await db`select id, status from contact_writes where installation_id = ${w.installationId} and idem_key = ${a.key}`;
  if (!old) return { reply: { ok: false, status: "limit", message: CAP_MESSAGE() } };
  // A failed or unauthorised try may be tried again; anything else is the same request seen twice.
  if (old.status === "failed" || old.status === "needs_permission") {
    await db`update contact_writes set status = 'pending', detail = null where id = ${old.id}`;
    return { id: old.id as string };
  }
  return { reply: { ok: true, status: old.status === "dry_run" ? "dry_run" : "saved", message: "Already saved a moment ago. Nothing was added twice.", id: old.id as string, canUndo: true, duplicate: true } };
}

export async function send(w: Who, ctx: { locationId: string; contactId: string; companyId: string }, request: CrmRequest, op: string): Promise<WriteResult> {
  const r = await writeToCrm({ installationId: w.installationId, locationId: ctx.locationId, contactId: ctx.contactId, request, token: () => locationAccessToken(ctx.companyId, ctx.locationId) });
  await recordWrite({ installationId: w.installationId, actor: w.actor, locationId: ctx.locationId, contactId: ctx.contactId, op, fields: Object.keys(request.body), result: r.outcome }).catch(() => undefined);
  return r;
}

async function run(w: Who, a: { locationId: string; contactId: string; kind: "note" | "outcome"; outcome: Outcome | null; text: string; followUp: boolean; key: string; tags: string[]; companyId: string }): Promise<WriteReply> {
  const db = sql();
  const claimed = await claim(w, a);
  if ("reply" in claimed) return claimed.reply;
  const id = claimed.id;
  const ctx = { locationId: a.locationId, contactId: a.contactId, companyId: a.companyId };
  const finish = async (status: SaveStatus, extra: Record<string, unknown>, httpStatus?: number): Promise<WriteReply> => {
    await db`update contact_writes set status = ${status}, note_id = ${(extra.note_id as string | null) ?? null}, task_id = ${(extra.task_id as string | null) ?? null}, tag = ${(extra.tag as string | null) ?? null}, tag_added = ${Boolean(extra.tag_added)}, detail = ${(extra.detail as string | null) ?? null} where id = ${id}`;
    return { ok: status === "saved" || status === "dry_run", status, message: saveMessage(status, a.kind, httpStatus), id, canUndo: status === "saved" || status === "dry_run" };
  };
  if (!w.granted) return finish("needs_permission", {});
  const note = await send(w, ctx, buildNote({ contactId: a.contactId, body: a.text }), `${a.kind}.note.create`);
  if (note.outcome === "needs_permission") return finish("needs_permission", {});
  if (note.outcome === "failed") return finish("failed", { detail: `note ${note.status}` }, note.status);
  const out: Record<string, unknown> = { note_id: note.outcome === "written" ? note.id : null };
  if (note.outcome === "written") await recordCrmWrite({ installationId: w.installationId, meetingId: null, locationId: a.locationId, contactId: a.contactId, kind: "note", ghlId: note.id, authoredBy: w.actor }).catch(() => undefined);
  const parts: string[] = [];
  if (a.kind === "outcome" && a.outcome) {
    const tag = tagFor(a.outcome, tagPrefix());
    out.tag = tag;
    out.tag_added = !a.tags.includes(tag);
    const t = await send(w, ctx, buildTags({ contactId: a.contactId, tags: [tag] }), "outcome.tag.add");
    if (t.outcome === "failed" || t.outcome === "needs_permission") { parts.push("tag not added"); out.tag_added = false; }
    if (a.followUp) {
      const k = await send(w, ctx, buildTask({ contactId: a.contactId, title: "Follow up (added in SubSync)", body: `${"[SubSync]"} Follow up after the call`, dueDate: new Date(Date.now() + 3 * 86_400_000) }), "outcome.task.create");
      if (k.outcome === "written") out.task_id = k.id;
      else if (k.outcome !== "dry_run") parts.push("follow-up task not created");
    }
  }
  out.detail = parts.join("; ") || null;
  return finish(note.outcome === "dry_run" ? "dry_run" : "saved", out);
}

export async function saveContactNote(w: Who, v: { locationId: string; contactId: string; text: string }, now = Date.now()): Promise<WriteReply> {
  try {
    const c = await contactOf(w, v.locationId, v.contactId);
    if (!c) return { ok: false, status: "unknown", message: "Contact not found" };
    return await run(w, { ...v, kind: "note", outcome: null, followUp: false, text: noteBody(v.text, { who: w.actorName, now: new Date(now) }), key: idemKey({ contactId: v.contactId, kind: "note", text: v.text, now }), tags: c.tags, companyId: c.companyId });
  } catch (e) { if (missingTable(e)) return NEEDS_UPDATE; throw e; }
}

export async function writeCallOutcome(w: Who, v: { locationId: string; contactId: string; outcome: Outcome; note: string | null; followUpInDays: number | null }, now = Date.now()): Promise<WriteReply> {
  try {
    const c = await contactOf(w, v.locationId, v.contactId);
    if (!c) return { ok: false, status: "unknown", message: "Contact not found" };
    const reply = await run(w, { ...v, kind: "outcome", followUp: v.outcome === "follow_up", text: outcomeNoteBody(v.outcome, { who: w.actorName, now: new Date(now), note: v.note }), key: idemKey({ contactId: v.contactId, kind: "outcome", outcome: v.outcome, now }), tags: c.tags, companyId: c.companyId });
    // SubSync's own record (the person leaves the call lists for 12 hours) is kept once, for a new request only, whatever the CRM said.
    if (!reply.duplicate && reply.status !== "limit") await logOutcome(w.installationId, w.allowed, v);
    return reply;
  } catch (e) { if (missingTable(e)) return NEEDS_UPDATE; throw e; }
}

/** Undo: removes the note, task and tag SubSync made (only ones it made), and the call result. Only the person who saved it, within the hour. */
export async function undoWrite(w: Who, id: string): Promise<WriteReply> {
  try {
    const db = sql();
    const [r] = await db`select * from contact_writes where id = ${id} and installation_id = ${w.installationId} and actor is not distinct from ${w.actor} and status in ('saved', 'dry_run') and created_at > now() - interval '1 hour'`;
    if (!r) return { ok: false, status: "unknown", message: "There is nothing to undo here." };
    const c = await contactOf(w, r.location_id as string, r.contact_id as string);
    if (!c) return { ok: false, status: "unknown", message: "Contact not found" };
    const ctx = { locationId: r.location_id as string, contactId: r.contact_id as string, companyId: c.companyId };
    if (r.kind === "tag_add" || r.kind === "tag_remove") {
      const back = await changeTag(w, { locationId: ctx.locationId, contactId: ctx.contactId, tag: r.tag as string, remove: r.kind === "tag_add", confirm: true });
      if (back.ok) await db`update contact_writes set status = 'undone', undone_at = now() where id = ${id}`;
      return back.ok ? { ok: true, status: "saved", message: r.kind === "tag_add" ? "Undone. The tag was removed again." : "Undone. The tag is back on the contact." } : back;
    }
    if (r.status === "saved" && w.granted) {
      if (r.note_id) await send(w, ctx, buildDeleteOwn({ contactId: ctx.contactId, kind: "notes", id: r.note_id as string }), "undo.note.delete");
      if (r.task_id) await send(w, ctx, buildDeleteOwn({ contactId: ctx.contactId, kind: "tasks", id: r.task_id as string }), "undo.task.delete");
      if (r.tag && r.tag_added) await send(w, ctx, buildTags({ contactId: ctx.contactId, tags: [r.tag as string], remove: true }), "undo.tag.remove");
      if (r.note_id) await markUndone(w.installationId, r.note_id as string).catch(() => undefined);
    }
    await db`update contact_writes set status = 'undone', undone_at = now() where id = ${id}`;
    if (r.kind === "outcome") {
      await db`delete from call_outcomes where id = (select id from call_outcomes where installation_id = ${w.installationId} and location_id = ${ctx.locationId} and contact_id = ${ctx.contactId} and outcome = ${r.outcome as string} order by created_at desc limit 1)`;
    }
    return { ok: true, status: "saved", message: r.status === "saved" ? "Undone. The note, task and tag SubSync added were removed from your CRM." : "Undone." };
  } catch (e) { if (missingTable(e)) return NEEDS_UPDATE; throw e; }
}

/** True when this id is a note or task SubSync made (so its webhook is ignored). */
export async function isOurContactWrite(installationId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  try {
    const r = await sql()`select 1 from contact_writes where installation_id = ${installationId} and (note_id = any(${ids}::text[]) or task_id = any(${ids}::text[])) limit 1`;
    return r.length > 0;
  } catch { return false; }
}
