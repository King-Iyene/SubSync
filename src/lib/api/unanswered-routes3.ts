import { sql } from "../db";
import { cleanView, readListParams, LIST_SIZES } from "../analytics/unanswered-params";
import { sqlFind, sqlList, sqlTabCounts, type ListScope } from "../analytics/unanswered-sql";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import type { UnansweredHelpers } from "./unanswered-routes";

// Round 3, slices A and C of the Unanswered screen: the SQL-paged list (GET inbox?part=list2), the one search across accounts (part=find), the saved views of a person
// (part=views, POST inbox/views3, DELETE inbox/views3/:id). Who is asking comes from the verified session; the accounts they may read come from `allowed` (derived by the router,
// never from the request) and an account id in the address only NARROWS inside them. Each part is behind its own flag. Read only, except that a saved view is the person's own
// small note of their filter choices (no customer data in it).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
const VIEW_PAGE = "unanswered3";
export const MAX_VIEWS = 20;
const ID = /^[A-Za-z0-9_-]{3,64}$/;

const on = (ctx: Ctx, f: "inbox_control_room" | "inbox_filters" | "inbox_views" | "inbox_search" | "inbox_quiet" | "inbox_snooze" | "inbox_hide_noise") => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is switched off", off: true }, 404);

/** The white-label links on every person row, built on the server from the verified company (never from the request). */
function withLinks<T extends { rows: Array<{ locationId: string; conversationId: string; contactId: string | null }> }>(out: T, h: ReturnType<typeof deepLinks>): T {
  return { ...out, rows: out.rows.map((r) => ({ ...r, url: h.conversation(r.locationId, r.conversationId), contactUrl: r.contactId ? h.contact(r.locationId, r.contactId) : h.conversation(r.locationId, r.conversationId) })) };
}

function narrow(allowed: string[] | null, id: string | null): string[] | null | "none" {
  if (!id) return allowed;
  if (allowed && !allowed.includes(id)) return "none";
  return [id];
}

export async function handleUnansweredPart3(ctx: Ctx, h: UnansweredHelpers & { owner: () => string }, part: string): Promise<Response | null> {
  if (part !== "list2" && part !== "find" && part !== "views" && part !== "ui") return null;
  const sp = ctx.url.searchParams;
  const seePeople = ctx.kind !== "client";

  if (part === "ui") {
    // Which parts of the screen are on for this caller (every inbox_* flag), so the screen draws only what is live. Nothing is scanned here.
    const flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(ctx.entitlements.features)) if (k.startsWith("inbox_")) flags[k] = v === true && !ctx.entitlements.locked.includes(k as never);
    return json({ flags, seePeople, kind: ctx.kind, me: ctx.session.userId ?? null });
  }

  if (part === "views") {
    if (!on(ctx, "inbox_views")) return off();
    return json({ views: await listViews(ctx.installationId, h.owner(), seePeople), max: MAX_VIEWS });
  }

  const [allowedAll, targets, links] = await Promise.all([h.allowed(), h.targets(), h.links()]);
  const base: Omit<ListScope, "allowed"> = { installationId: ctx.installationId, slaHours: targets.slaHours, targetMinutes: targets.targetMinutes, now: Date.now(), meId: ctx.session.userId ?? null, seePeople, hook: { snooze: on(ctx, "inbox_snooze"), hide: on(ctx, "inbox_hide_noise") } };

  if (part === "find") {
    if (!on(ctx, "inbox_search")) return off();
    const size = Number(sp.get("size")); const page = Math.max(0, Math.min(100_000, Math.floor(Number(sp.get("page")) || 0)));
    const sz = (LIST_SIZES as readonly number[]).includes(size) ? size : 20;
    const out = await sqlFind({ ...base, allowed: allowedAll }, { q: (sp.get("q") ?? "").slice(0, 80), page, size: sz });
    return json(withLinks(out, links));
  }

  // list2
  const tabOn = on(ctx, "inbox_control_room") || on(ctx, "inbox_filters") || on(ctx, "inbox_quiet");
  if (!tabOn) return off();
  const read = readListParams(sp, { seePeople });
  if (!read.ok) return json({ error: read.error }, 400);
  if (read.p.tab === "them" && !on(ctx, "inbox_quiet")) return off();
  const allowed = narrow(allowedAll, read.p.account);
  if (allowed === "none") return json({ error: "That account is not available in your view" }, 404);
  // A client's staff never narrow to a colleague (the parser already refused an id); "mine" and "no owner" stay.
  const scope: ListScope = { ...base, allowed };
  const [out, tabs] = await Promise.all([sqlList(scope, { ...read.p, account: null }), on(ctx, "inbox_quiet") ? sqlTabCounts({ ...base, allowed: allowedAll }, read.p.quiet) : Promise.resolve(null)]);
  return json({ ...withLinks(out, links), tabs });
}

// ---------- saved views: a person's own named filter choices ----------

type View = { id: string; name: string; filters: Record<string, string | number> };

async function listViews(installationId: string, owner: string, seePeople: boolean): Promise<View[]> {
  const rows = await sql()`select id, name, filters from saved_views where installation_id = ${installationId} and owner = ${owner} and page = ${VIEW_PAGE} order by created_at`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, filters: cleanView(r.filters, { seePeople }) as Record<string, string | number> }));
}

export async function handleUnansweredViewSave(ctx: Ctx, h: { owner: () => string }): Promise<Response> {
  if (!on(ctx, "inbox_views")) return off();
  const body = await ctx.request.json().catch(() => null) as { name?: unknown; filters?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  if (name.length < 1) return json({ error: "Give the view a short name" }, 400);
  const seePeople = ctx.kind !== "client";
  const filters = cleanView(body?.filters, { seePeople });
  const db = sql();
  const owner = h.owner();
  const [have] = await db`select count(*)::int n, coalesce(bool_or(name = ${name}), false) same from saved_views where installation_id = ${ctx.installationId} and owner = ${owner} and page = ${VIEW_PAGE}`;
  if (Number(have?.n ?? 0) >= MAX_VIEWS && !have?.same) return json({ error: `You can keep ${MAX_VIEWS} views. Remove one first.` }, 409);
  await db`
    insert into saved_views (installation_id, owner, page, name, filters) values (${ctx.installationId}, ${owner}, ${VIEW_PAGE}, ${name}, ${db.json(filters as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
  return json({ ok: true, views: await listViews(ctx.installationId, owner, seePeople), max: MAX_VIEWS });
}

export async function handleUnansweredViewRemove(ctx: Ctx, h: { owner: () => string }, id: string): Promise<Response> {
  if (!on(ctx, "inbox_views")) return off();
  if (!ID.test(id) && !/^[0-9a-fA-F-]{36}$/.test(id)) return json({ error: "View not found" }, 404);
  const gone = await sql()`delete from saved_views where installation_id = ${ctx.installationId} and owner = ${h.owner()} and page = ${VIEW_PAGE} and id = ${id} returning 1`;
  if (gone.length === 0) return json({ error: "View not found" }, 404);
  return json({ ok: true, views: await listViews(ctx.installationId, h.owner(), ctx.kind !== "client"), max: MAX_VIEWS });
}
