import { sql } from "../db";
import { describeTodayView, MAX_TODAY_VIEWS, sanitizeTodayView, todayViewName, type TodayView } from "../analytics/today-palette";
import { json, type AuthContext } from "./auth";
import { userKeyOf } from "./today-actions";

// A person's saved views of Today: a name plus which client accounts and whether test and very old deals are left out. Nothing else is kept (no rows, no names of
// leads). They live in the existing `saved_views` table under the page "today" and belong to the person who made them: another person's views are never read, and an
// id that is not theirs finds nothing. A client's staff have no choice of accounts, so they keep none (the screen does not offer it and the server refuses).
// Which accounts a view names is checked again every time it is applied: Today reads only what the signed session may read, so a saved id that is no longer allowed
// changes nothing.

type Ctx = AuthContext & { request: Request };
const PAGE = "today";
export type SavedTodayView = { id: string; name: string; view: TodayView };

async function list(ctx: Ctx): Promise<SavedTodayView[]> {
  const rows = await sql()`select id, name, filters from saved_views where installation_id = ${ctx.installationId} and owner = ${userKeyOf(ctx)} and page = ${PAGE} order by created_at`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, view: sanitizeTodayView(r.filters) }));
}

export async function todayViewsList(ctx: Ctx): Promise<Response> {
  if (ctx.kind === "client") return json({ views: [], max: 0 });
  return json({ views: await list(ctx), max: MAX_TODAY_VIEWS });
}

export async function todayViewSave(ctx: Ctx): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in your view", forbidden: true }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { name?: unknown; accounts?: unknown; excludeJunk?: unknown } | null;
  const name = todayViewName(body?.name);
  if (!name) return json({ error: "Give the view a name of up to 40 characters." }, 400);
  const view = sanitizeTodayView(body);
  // Only this company's own accounts are kept in a view; an id from anywhere else is dropped here and would change nothing when applied anyway.
  if (view.accounts.length > 0) {
    const own = await sql()`select location_id from locations where installation_id = ${ctx.installationId} and location_id = any(${view.accounts}::text[])`;
    const ok = new Set(own.map((r) => r.location_id as string));
    view.accounts = view.accounts.filter((a) => ok.has(a));
  }
  const db = sql();
  const owner = userKeyOf(ctx);
  const [have] = await db`select count(*)::int n, bool_or(name = ${name}) same from saved_views where installation_id = ${ctx.installationId} and owner = ${owner} and page = ${PAGE}`;
  if ((have?.n ?? 0) >= MAX_TODAY_VIEWS && !have?.same) return json({ error: `You can keep ${MAX_TODAY_VIEWS} saved views. Remove one first.` }, 409);
  await db`
    insert into saved_views (installation_id, owner, page, name, filters) values (${ctx.installationId}, ${owner}, ${PAGE}, ${name}, ${db.json(view as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
  return json({ ok: true, views: await list(ctx), max: MAX_TODAY_VIEWS, saved: describeTodayView(view, new Map()) });
}

export async function todayViewRemove(ctx: Ctx, id: string): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in your view", forbidden: true }, 403);
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json({ error: "View not found" }, 404);
  const gone = await sql()`delete from saved_views where installation_id = ${ctx.installationId} and owner = ${userKeyOf(ctx)} and page = ${PAGE} and id = ${id} returning 1`;
  return gone.length > 0 ? json({ ok: true, views: await list(ctx), max: MAX_TODAY_VIEWS }) : json({ error: "View not found" }, 404);
}
