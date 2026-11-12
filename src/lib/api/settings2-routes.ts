import { sql } from "../db";
import { groupStatus } from "../scope-groups";
import { GUIDE_IDS } from "../guides";
import { HIDEABLE_IDS, STATE_KINDS, type StateKind } from "../settings2";
import { NEWS_IDS } from "../whats-new";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";

// Settings, guides and What's new, under /api/app/st/<part>. SubSync's own marks only; nothing here changes the CRM and nothing here changes a setting
// (settings keep their own checked route).
//   GET  home          who is asking, the plan, whether they may change settings, and since when SubSync holds history
//   GET  state         this person's dismissed badges, read guides and hidden pages
//   POST state         { kind, key, on }: set or clear one of those marks; the key must be one of the fixed lists, so no id from the browser is ever used
//   GET  connections   one status line per tool (Slack, Fathom, email, calendars)
//   GET  progress      the facts the Getting started checklist ticks from
// Who is asking comes from the verified session (`ctx`), never from the request. A request that carries a location, user or other id is not read for it.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
const on = (ctx: Ctx, f: "st_settings" | "st_guides" | "st_news") => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const anyOn = (ctx: Ctx) => on(ctx, "st_settings") || on(ctx, "st_guides") || on(ctx, "st_news");

/** The signed-in person: kind, account limit and CRM user id, all from the session. */
export const userKeyOf = (ctx: Pick<Ctx, "kind" | "limitTo" | "session">) => `${ctx.kind}:${ctx.limitTo ?? "agency"}:${ctx.session.userId ?? ""}`.slice(0, 200);

export async function handleSettings2(ctx: Ctx): Promise<Response> {
  if (!anyOn(ctx)) return json({ error: "This is not switched on for your account" }, 404);
  const part = ctx.segments[1], m = ctx.request.method;
  if (m === "GET" && part === "home") return home(ctx);
  if (m === "GET" && part === "state") return state(ctx);
  if (m === "POST" && part === "state") return setState(ctx);
  if (m === "GET" && part === "connections") return connections(ctx);
  if (m === "GET" && part === "progress") return progress(ctx);
  return json({ error: "Unknown action" }, 404);
}

async function home(ctx: Ctx) {
  const { level } = viewerOf(ctx);
  const [inst] = await sql()`select created_at from installations where id = ${ctx.installationId}`;
  return json({ kind: ctx.kind, plan: ctx.plan, canManage: level !== "self", level, enforced: ctx.entitlements.enforced === true, since: inst?.created_at ?? null, demo: ctx.demo });
}

async function state(ctx: Ctx) {
  if (ctx.demo) return json({ news_seen: [], guide_read: [], module_hidden: [] });
  const rows = await sql()`select kind, item_key from st_user_state where installation_id = ${ctx.installationId} and user_key = ${userKeyOf(ctx)} limit 500`;
  const out: Record<StateKind, string[]> = { news_seen: [], guide_read: [], module_hidden: [] };
  for (const r of rows) if ((STATE_KINDS as readonly string[]).includes(r.kind as string)) out[r.kind as StateKind].push(r.item_key as string);
  return json(out);
}

const allowedKey = (kind: StateKind, key: string) => (kind === "news_seen" ? NEWS_IDS.has(key) : kind === "guide_read" ? GUIDE_IDS.has(key) : HIDEABLE_IDS.has(key));

async function setState(ctx: Ctx) {
  const b = (await ctx.request.json().catch(() => null)) as { kind?: unknown; key?: unknown; on?: unknown } | null;
  if (!b || typeof b.kind !== "string" || typeof b.key !== "string" || !(STATE_KINDS as readonly string[]).includes(b.kind)) return json({ error: "That is not available" }, 400);
  const kind = b.kind as StateKind;
  if (!allowedKey(kind, b.key)) return json({ error: "That is not available" }, 400);
  if (ctx.demo) return json({ ok: true });
  const user = userKeyOf(ctx);
  if (b.on === false) await sql()`delete from st_user_state where installation_id = ${ctx.installationId} and user_key = ${user} and kind = ${kind} and item_key = ${b.key}`;
  else await sql()`insert into st_user_state (installation_id, user_key, kind, item_key) values (${ctx.installationId}, ${user}, ${kind}, ${b.key}) on conflict do nothing`;
  return json({ ok: true });
}

async function connections(ctx: Ctx) {
  const inst = ctx.installationId;
  const one = ctx.limitTo;
  const [slack] = await sql()`select count(*)::int n, max(label) label from connections where installation_id = ${inst} and provider = 'slack' and status = 'connected'`;
  const [webhook] = await sql()`select (coalesce(slack_webhook_url, '') <> '') set from settings where installation_id = ${inst}`;
  const mine = ctx.session.userId ? await sql()`select status, last_event_at, saved_count, skipped_count from user_connections where installation_id = ${inst} and ghl_user_id = ${ctx.session.userId} and provider = 'fathom' limit 1` : [];
  const { level } = viewerOf(ctx);
  const [team] = level === "self" ? [null] : await sql()`select count(*)::int people, count(*) filter (where status = 'connected')::int working from user_connections where installation_id = ${inst} and provider = 'fathom'`;
  const [cal] = one
    ? await sql()`select count(*)::int n from cached_calendars where installation_id = ${inst} and location_id = ${one}`
    : await sql()`select count(*)::int n from cached_calendars where installation_id = ${inst}`;
  const [set] = await sql()`select digest_email from settings where installation_id = ${inst}`;
  return json({
    slack: { connected: (slack?.n ?? 0) > 0 || webhook?.set === true, label: slack?.label ?? null, canChange: level === "all" },
    fathom: { status: (mine[0]?.status as string | undefined) ?? "not_connected", lastEventAt: mine[0]?.last_event_at ?? null, saved: mine[0]?.saved_count ?? 0, waiting: mine[0]?.skipped_count ?? 0, team: team ? { people: team.people, working: team.working } : null },
    email: { address: Boolean(set?.digest_email) },
    calendars: { count: cal?.n ?? 0 },
  });
}

async function progress(ctx: Ctx) {
  const inst = ctx.installationId;
  const [i] = await sql()`select scope from installations where id = ${inst}`;
  const granted = ctx.demo || typeof i?.scope !== "string" || i.scope.trim() === "" ? null : (i.scope as string).split(/\s+/);
  const missing = groupStatus(granted).reduce((n, g) => n + g.missing, 0);
  const [roles] = await sql()`select count(distinct user_id)::int n from team_member_roles where installation_id = ${inst}`;
  const [slack] = await sql()`select count(*)::int n from connections where installation_id = ${inst} and provider = 'slack' and status = 'connected'`;
  const [fathom] = ctx.session.userId ? await sql()`select count(*)::int n from user_connections where installation_id = ${inst} and ghl_user_id = ${ctx.session.userId} and provider = 'fathom' and status = 'connected'` : [{ n: 0 }];
  const [audit] = await sql()`select count(*)::int n from usage_events where installation_id = ${inst} and view = 'audit'`;
  const [digest] = await sql()`select count(*)::int n from notification_deliveries where installation_id = ${inst} and type = 'daily_brief' and status = 'sent'`;
  const { level } = viewerOf(ctx);
  return json({ canManage: level !== "self", facts: { permissionsMissing: missing, rolesAssigned: roles?.n ?? 0, slackConnected: (slack?.n ?? 0) > 0, fathomConnected: (fathom?.n ?? 0) > 0, auditOpened: (audit?.n ?? 0) > 0, digestSent: (digest?.n ?? 0) > 0 } });
}
