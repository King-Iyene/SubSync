import { sql } from "../db";
import { buildTags } from "../ghl/crm-writes";
import { recordCrmWrite } from "../connections/write-log";
import { claim, contactOf, missingTable, NEEDS_UPDATE, send, type Who, type WriteReply } from "./contact-writeback";
import { cleanTag, TAG_MAX, isOurTag, saveMessage, tagPrefix, type SaveStatus } from "../people/writeback";

// Tags a person adds or removes by hand on the contact panel. An add needs no confirmation; a removal changes the CRM, so the server asks for `confirm: true` as well as the
// screen. The tag name in the CRM is exactly what the person typed or picked (no date or marker in it). The date lives in contact_tag_events (exact = true when SubSync applied it).
// SubSync updates its own copy of the contact's tags at once, so the next sync sees no "change" and records nothing twice.

export { cleanTag, TAG_MAX };

type Args = { locationId: string; contactId: string; tag: string; remove: boolean; companyId: string; tags: string[]; kind: "tag_add" | "tag_remove"; key: string };

async function applyTag(w: Who, a: Args): Promise<WriteReply> {
  const db = sql();
  const claimed = await claim(w, { locationId: a.locationId, contactId: a.contactId, kind: a.kind, outcome: null, key: a.key });
  if ("reply" in claimed) return claimed.reply;
  const id = claimed.id;
  const done = async (status: SaveStatus, httpStatus?: number): Promise<WriteReply> => {
    await db`update contact_writes set status = ${status}, tag = ${a.tag}, tag_added = ${!a.remove} where id = ${id}`;
    return { ok: status === "saved" || status === "dry_run", status, message: status === "saved" ? (a.remove ? "Removed from the contact in your CRM" : "Added to the contact in your CRM") : saveMessage(status, "note", httpStatus), id, canUndo: status === "saved" };
  };
  if (!w.granted) return done("needs_permission");
  const r = await send(w, { locationId: a.locationId, contactId: a.contactId, companyId: a.companyId }, buildTags({ contactId: a.contactId, tags: [a.tag], remove: a.remove }), a.remove ? "tag.remove" : "tag.add");
  if (r.outcome === "needs_permission") return done("needs_permission");
  if (r.outcome === "failed") return done("failed", r.status);
  if (r.outcome === "written") {
    const lower = a.tag.toLowerCase();
    const next = a.remove ? a.tags.filter((t) => t.toLowerCase() !== lower) : [...a.tags.filter((t) => t.toLowerCase() !== lower), a.tag];
    await db`update cached_contacts set tags = ${next}::text[] where installation_id = ${w.installationId} and location_id = ${a.locationId} and contact_id = ${a.contactId}`.catch(() => undefined);
    await db`insert into contact_tag_events (installation_id, location_id, contact_id, tag, kind, exact) values (${w.installationId}, ${a.locationId}, ${a.contactId}, ${a.tag}, ${a.remove ? "removed" : "added"}, true)`.catch(() => undefined);
    // Counts as ours for the activity window (principle 14).
    await recordCrmWrite({ installationId: w.installationId, meetingId: null, locationId: a.locationId, contactId: a.contactId, kind: "field", ghlId: null, authoredBy: w.actor }).catch(() => undefined);
  }
  return done(r.outcome === "dry_run" ? "dry_run" : "saved");
}

export async function changeTag(w: Who, v: { locationId: string; contactId: string; tag: string; remove: boolean; confirm?: boolean }, now = Date.now()): Promise<WriteReply> {
  try {
    if (v.remove && v.confirm !== true) return { ok: false, status: "unknown", message: "Removing a tag changes your CRM, so it needs to be confirmed." };
    const c = await contactOf(w, v.locationId, v.contactId);
    if (!c) return { ok: false, status: "unknown", message: "Contact not found" };
    const has = c.tags.includes(v.tag.toLowerCase());
    if (v.remove === !has) return { ok: true, status: "saved", message: v.remove ? "That tag is already gone." : "The contact already has that tag.", duplicate: true };
    const kind = v.remove ? "tag_remove" : "tag_add";
    return await applyTag(w, { ...v, companyId: c.companyId, tags: c.rawTags, kind, key: `${kind}:${v.tag.toLowerCase()}:${v.contactId}:${Math.floor(now / 60_000)}` });
  } catch (e) { if (missingTable(e)) return NEEDS_UPDATE; throw e; }
}

/** The tags already used in one account (most used first), to pick from. SubSync's own call-result tags are left out. */
export async function accountTags(w: Pick<Who, "installationId" | "allowed">, locationId: string): Promise<string[]> {
  const db = sql();
  const rows = await db`
    select t.tag, count(*) n from cached_contacts c, unnest(c.tags) as t(tag)
    where c.installation_id = ${w.installationId} and c.location_id = ${locationId} ${w.allowed ? db`and c.location_id = any(${w.allowed}::text[])` : db``}
    group by t.tag order by n desc, t.tag limit 200`;
  return rows.map((r) => r.tag as string).filter((t) => !isOurTag(t, tagPrefix()));
}
