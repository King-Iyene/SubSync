import { ttlCache } from "../ttl-cache";
import { ghlFetch } from "../ghl/http";
import { GHL_API } from "../ghl/client";
import { locationAccessToken } from "../sync/engine";
import { readAllPages, rankTags, type TagOption } from "../people/tag-list";
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
    return { ok: status === "saved" || status === "dry_run", status, message: status === "saved" ? (a.remove ? `Tag \u2018${a.tag}\u2019 removed from this contact in your CRM` : `Tag \u2018${a.tag}\u2019 added to this contact in your CRM`) : saveMessage(status, "note", httpStatus), id, canUndo: status === "saved" };
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
  if (r.outcome === "written") forgetTagList(w.installationId);
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

export type TagList = { tags: TagOption[]; source: "crm" | "contacts"; needsPermission: boolean };
const cache = ttlCache<TagList>(5 * 60_000, 300);
export const forgetTagList = (installationId: string) => cache.clear(installationId);

/**
 * Every tag the account has. The earlier version only knew tags that sit on contacts SubSync has copied, which is why a few tags showed. Now the account's own tag list is read from the
 * CRM (GET /locations/{id}/tags, scope locations/tags.readonly, read in pages and merged, kept 5 minutes per account) and joined with how many contacts use each tag. If the optional
 * permission is not granted (or the CRM refuses), the list falls back to the tags found on contacts and says "needs permission".
 */
export async function accountTagList(w: Pick<Who, "installationId" | "allowed">, locationId: string, canReadTags: boolean): Promise<TagList> {
  const key = `${w.installationId}:${locationId}:${canReadTags ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const db = sql();
  const rows = await db`
    select lower(t.tag) k, count(*)::int n from cached_contacts c, unnest(c.tags) as t(tag)
    where c.installation_id = ${w.installationId} and c.location_id = ${locationId} ${w.allowed ? db`and c.location_id = any(${w.allowed}::text[])` : db``}
    group by 1`;
  const prefix = tagPrefix();
  const used = new Map(rows.map((r) => [r.k as string, r.n as number]).filter(([k]) => !isOurTag(k as string, prefix)) as Array<[string, number]>);
  let crm: string[] = [];
  let source: TagList["source"] = "contacts";
  let needsPermission = !canReadTags;
  if (canReadTags) {
    try {
      const [inst] = await db`select company_id from installations where id = ${w.installationId}`;
      const token = await locationAccessToken(inst.company_id as string, locationId);
      let denied = false;
      crm = await readAllPages(async (skip) => {
        const res = await ghlFetch(`${GHL_API}/locations/${encodeURIComponent(locationId)}/tags?limit=100&skip=${skip}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
        if (res.status === 401 || res.status === 403) { denied = true; return []; }
        if (!res.ok) throw new Error(`tags ${res.status}`);
        const j = (await res.json().catch(() => ({}))) as { tags?: Array<{ name?: unknown }> };
        return (j.tags ?? []).map((t) => (typeof t.name === "string" ? t.name : "")).filter(Boolean);
      });
      if (denied) needsPermission = true; else source = "crm";
    } catch { /* fall back to the contacts' tags */ }
  }
  const out: TagList = { tags: rankTags(crm, used).filter((t) => !isOurTag(t.name, prefix)), source, needsPermission };
  if (source === "crm" || needsPermission) cache.set(key, out);
  return out;
}
