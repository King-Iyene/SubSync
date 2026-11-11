import { assigneeLabel } from "../analytics/waiting-view";
import { teamNames } from "../analytics/inbox-queries";
import { changeTag, cleanTag } from "../analytics/contact-tags";
import { saveContactNote } from "../analytics/contact-writeback";
import { coldTagsFor } from "../analytics/people-list-queries";
import { findPeople } from "../analytics/people-find-queries";
import { sql } from "../db";
import { parseGranted } from "../scope-groups";
import { NOTE_MAX } from "../people/writeback";
import { parseSmartFilter, scopeFilterTo, type SmartFilter } from "../people/filters";
import { personKey } from "../people/queue";
import { BULK_MAX, EXPORT_MAX, EXPORT_PAGE, FIND_PAGE, bulkLine, decodeCursor, exportCsv, parseBulk, type BulkPlan, type ExportRow } from "../people/find";
import type { Feature } from "../entitlements";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// Find a lead: the keyset page behind "Load more", the export, and the bulk tag / note (docs/features/FINDLEAD_BRIEF.md). Under /api/app/people/... (the one catch-all route, already
// guarded). Who is asking, and which accounts they may see, come from the verified session only. An account id from the request goes through ownedLocation, an owner id must be one of the
// owners in the caller's own contacts, a cursor is a strict shape. A bulk change goes through the SAME safe write path as one tag or note on the lead panel (the gateway: caps, dry run,
// permission check, audit row, our own writes excluded from the numbers); nothing here talks to the CRM directly, and nothing messages anybody. No delete exists here.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type FindHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>>; voter: string };

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const adminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";

/** The filter from the address, with the account and the owner checked against what the caller may see. A bad one is a plain 400, never a guess. */
async function filterOf(ctx: Ctx, allowed: string[] | null): Promise<{ ok: true; filter: SmartFilter } | { ok: false; res: Response }> {
  const parsed = parseSmartFilter(Object.fromEntries(ctx.url.searchParams.entries()));
  if (!parsed.ok) return { ok: false, res: json({ error: parsed.error }, 400) };
  const filter = scopeFilterTo(parsed.filter, ctx.limitTo);
  if (filter.location && (await ownedLocation(ctx.installationId, allowed, filter.location)) === null) return { ok: false, res: json({ error: "That client account is not available" }, 404) };
  if (filter.owner && filter.owner !== "none") {
    const hit = await sql()`select 1 from cached_contacts c where c.installation_id = ${ctx.installationId} and c.assigned_to = ${filter.owner} ${allowed ? sql()`and c.location_id = any(${allowed}::text[])` : sql()``} limit 1`;
    // An owner none of the caller's own contacts has is answered exactly like one that does not exist: no hint whether the id is real elsewhere.
    if (hit.length === 0) return { ok: false, res: json({ error: "That owner is not available" }, 404) };
  }
  return { ok: true, filter };
}

export async function handlePeopleFind(ctx: Ctx, h: FindHelpers & { coldChoice: () => Promise<string[] | null> }): Promise<Response | null> {
  const [, b] = ctx.segments;
  const m = ctx.request.method;
  if (!((m === "GET" && (b === "find" || b === "export")) || (m === "POST" && b === "bulk"))) return null;

  if (m === "GET" && b === "find") {
    if (!on(ctx, "fl_find")) return off();
    const allowed = await h.allowed();
    const f = await filterOf(ctx, allowed);
    if (!f.ok) return f.res;
    const rawAfter = ctx.url.searchParams.get("after");
    const after = rawAfter ? decodeCursor(rawAfter) : null;
    if (rawAfter && !after) return json({ error: "That page address is not valid. Start the search again." }, 400);
    const [cold, links, names] = await Promise.all([f.filter.cold ? coldTagsFor(ctx.installationId, allowed, await h.coldChoice()) : Promise.resolve([] as string[]), h.links(), teamNames(ctx.installationId)]);
    const res = await findPeople(ctx.installationId, allowed, f.filter, after, cold, FIND_PAGE);
    return json({
      total: res.total, capped: res.capped, next: res.next,
      rows: res.rows.map((r) => ({ ...r, rowId: personKey(r.locationId, r.contactId), why: "", at: null, value: null, ownerName: assigneeLabel(r.owner, names), url: links.contact(r.locationId, r.contactId) })),
    });
  }

  if (m === "GET" && b === "export") {
    if (!on(ctx, "fl_bulk")) return off();
    if (!adminSide(ctx)) return json({ error: "Ask your administrator to export people." }, 403);
    const allowed = await h.allowed();
    const f = await filterOf(ctx, allowed);
    if (!f.ok) return f.res;
    const [cold, names] = await Promise.all([f.filter.cold ? coldTagsFor(ctx.installationId, allowed, await h.coldChoice()) : Promise.resolve([] as string[]), teamNames(ctx.installationId)]);
    const out: ExportRow[] = [];
    let after = null as ReturnType<typeof decodeCursor>;
    while (out.length < EXPORT_MAX) {
      const page = await findPeople(ctx.installationId, allowed, f.filter, after, cold, Math.min(EXPORT_PAGE, EXPORT_MAX - out.length));
      for (const r of page.rows) out.push({ name: r.name, email: r.email, phone: r.phone, accountName: r.locationName, ownerName: r.owner ? assigneeLabel(r.owner, names) : null, source: r.source, tags: r.tags, dnd: r.dnd, dateAdded: r.dateAdded, lastActivityAt: r.lastActivityAt });
      after = page.next ? decodeCursor(page.next) : null;
      if (!after) break;
    }
    return new Response(exportCsv(out), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="people.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }

  // ---- bulk: step "preview" changes nothing; step "do" needs confirm: true ----
  if (!on(ctx, "fl_bulk")) return off();
  if (!adminSide(ctx)) return json({ error: "Ask your administrator to change several people at once." }, 403);
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseBulk(body, { tag: cleanTag, noteMax: NOTE_MAX });
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const input = parsed.input;
  const allowed = await h.allowed();
  // Every account is checked once, then every person is read with the installation and the caller's accounts in the query itself. Whatever is not found is counted, never named.
  const okLoc = new Map<string, boolean>();
  for (const t of input.targets) if (!okLoc.has(t.locationId)) okLoc.set(t.locationId, (await ownedLocation(ctx.installationId, allowed, t.locationId)) !== null);
  const valid = input.targets.filter((t) => okLoc.get(t.locationId));
  const found = valid.length === 0 ? [] : await sql()`select c.location_id, c.contact_id, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.tags, c.dnd
      from cached_contacts c join unnest(${valid.map((t) => t.locationId)}::text[], ${valid.map((t) => t.contactId)}::text[]) as w(l, i) on w.l = c.location_id and w.i = c.contact_id
      where c.installation_id = ${ctx.installationId} ${allowed ? sql()`and c.location_id = any(${allowed}::text[])` : sql()``}`;
  // Nobody of the ones named is the caller's to see: refused the same way whatever the reason, and never named.
  if (found.length === 0) return json({ error: "Those people were not found" }, 404);
  const lower = input.action === "tag" ? input.tag.toLowerCase() : "";
  const plan: BulkPlan & { go: Array<{ locationId: string; contactId: string }> } = { will: 0, already: 0, notFound: input.targets.length - found.length, dnd: 0, names: [], go: [] };
  for (const r of found) {
    const has = input.action === "tag" && ((r.tags as string[] | null) ?? []).some((t) => t.toLowerCase() === lower);
    if (has) { plan.already++; continue; }
    plan.will++;
    if (r.dnd === true) plan.dnd++;
    if (plan.names.length < 8) plan.names.push(r.name as string);
    plan.go.push({ locationId: r.location_id as string, contactId: r.contact_id as string });
  }
  const line = bulkLine(input.action, plan, input.action === "tag" ? input.tag : undefined);
  if (body?.step !== "do") return json({ step: "preview", line, will: plan.will, already: plan.already, notFound: plan.notFound, dnd: plan.dnd, names: plan.names, max: BULK_MAX });
  if (body.confirm !== true) return json({ error: "Confirm the change first." }, 400);

  const [inst] = ctx.demo ? [null] : await sql()`select scope from installations where id = ${ctx.installationId}`;
  const g = typeof inst?.scope !== "string" || inst.scope.trim() === "" ? null : parseGranted(inst.scope as string);
  const who = { installationId: ctx.installationId, allowed, actor: ctx.session.userId ?? null, actorName: ctx.session.userName ?? null, granted: g === null || g.includes("contacts.write") };
  let done = 0, held = 0, failed = 0, permission = false, limited = false;
  for (const t of plan.go) {
    const r = input.action === "tag"
      ? await changeTag(who, { locationId: t.locationId, contactId: t.contactId, tag: input.tag, remove: false })
      : await saveContactNote(who, { locationId: t.locationId, contactId: t.contactId, text: input.text });
    if (r.status === "limit") { limited = true; break; }
    if (r.status === "needs_permission") { permission = true; break; }
    if (r.status === "saved") done++; else if (r.status === "dry_run") held++; else failed++;
  }
  const message = permission ? "Needs permission: reconnect SubSync to let it save to your CRM. Nothing was changed."
    : limited ? `Stopped at the hourly limit after ${done}. The rest were not changed; try again later.`
    : held > 0 ? `Checked ${held} ${held === 1 ? "person" : "people"}: your CRM is in a safe test mode, so nothing was saved yet.`
    : `Done: ${done} ${done === 1 ? "person" : "people"} updated${failed > 0 ? `, ${failed} could not be saved` : ""}.`;
  return json({ step: "done", done, held, failed, permission, limited, message });
}
