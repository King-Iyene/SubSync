import { sql } from "../db";
import { groupStatus, parseGranted } from "../scope-groups";
import { saveDomainCheck } from "../analytics/queries";
import { validEmail } from "../analytics/weekly-email";
import { demoDomainReport } from "../demo/seed";
import { checkDomain, extractDomain, type DomainReport } from "../dns/email-auth";
import { emailConfigured } from "../email";
import { sendConnectionsTest } from "../notifications/transports";
import { isLive } from "../live-flags";
import { testResultText } from "../connections/tools-status";
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
//   POST email-verify  checks the SPF, DKIM and DMARC records of the saved address's domain (public records, no sign-in) and returns them
//   POST email-test    "Send me a test" to the SAVED address only (never an address from the request); a dry run while SEND_EMAIL_LIVE is off
//   GET  progress     the facts the Getting started checklist ticks from
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
  if (m === "POST" && part === "email-verify") return emailVerify(ctx);
  if (m === "POST" && part === "email-test") return emailTest(ctx);
  if (m === "GET" && part === "progress") return progress(ctx);
  return json({ error: "Unknown action" }, 404);
}

async function home(ctx: Ctx) {
  const { level } = viewerOf(ctx);
  const [inst] = await sql()`select created_at from installations where id = ${ctx.installationId}`;
  return json({ kind: ctx.kind, plan: ctx.plan, canManage: level !== "self", level, enforced: ctx.entitlements.enforced === true, trialEnded: ctx.entitlements.trialEnded === true, since: inst?.created_at ?? null, demo: ctx.demo });
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
  const address = (set?.digest_email as string | null) || null;
  const domain = extractDomain(address);
  const [check] = domain ? await sql()`select status, checked_at, result from domain_checks where installation_id = ${inst} and domain = ${domain} limit 1` : [];
  // Calendars: names only for an administrator (a staff member's list could name accounts they cannot open). The permission is read from what this install approved.
  const [instRow] = await sql()`select scope from installations where id = ${inst}`;
  const granted = ctx.demo || typeof instRow?.scope !== "string" || instRow.scope.trim() === "" ? null : parseGranted(instRow.scope as string);
  const mappedSql = sql()`exists (select 1 from calendar_members m where m.installation_id = c.installation_id and m.location_id = c.location_id and m.calendar_id = c.calendar_id)`;
  const calList = level === "self" ? [] : await (one
    ? sql()`select c.name, c.is_active, ${mappedSql} mapped from cached_calendars c where c.installation_id = ${inst} and c.location_id = ${one} order by lower(coalesce(c.name, '')) limit 8`
    : sql()`select c.name, c.is_active, ${mappedSql} mapped from cached_calendars c where c.installation_id = ${inst} order by lower(coalesce(c.name, '')) limit 8`);
  const [mappedN] = one
    ? await sql()`select count(*)::int n from cached_calendars c where c.installation_id = ${inst} and c.location_id = ${one} and ${mappedSql}`
    : await sql()`select count(*)::int n from cached_calendars c where c.installation_id = ${inst} and ${mappedSql}`;
  // Slack chat: from the recorded links and the events the bot has handled (kept 2 days). A client account sees only a link made for that account.
  const chatOn = ctx.entitlements.features.slack_chat === true && !ctx.entitlements.locked.includes("slack_chat");
  const links = chatOn ? await (one
    ? sql()`select team_id from slack_chat_links where installation_id = ${inst} and status = 'connected' and location_id = ${one}`
    : sql()`select team_id from slack_chat_links where installation_id = ${inst} and status = 'connected'`).catch(() => []) : [];
  const teams = [...new Set(links.map((l) => l.team_id as string))];
  const [ev] = teams.length ? await sql()`select count(*)::int n, max(created_at) last from slack_chat_events where team_id = any(${teams})`.catch(() => [null]) : [null];
  return json({
    slack: { connected: (slack?.n ?? 0) > 0 || webhook?.set === true, label: slack?.label ?? null, canChange: level === "all" },
    slackChat: { on: chatOn, links: links.length, recentEvents: Number(ev?.n ?? 0), lastEventAt: ev?.last ?? null },
    fathom: { status: (mine[0]?.status as string | undefined) ?? "not_connected", lastEventAt: mine[0]?.last_event_at ?? null, saved: mine[0]?.saved_count ?? 0, waiting: mine[0]?.skipped_count ?? 0, team: team ? { people: team.people, working: team.working } : null },
    email: {
      // The address itself goes only to a person who can change it; everyone else learns only whether one is saved.
      address: level === "self" ? null : address, hasAddress: Boolean(address), canManage: level !== "self", sendingLive: isLive("SEND_EMAIL_LIVE"), mailReady: emailConfigured(),
      check: check ? { status: check.status, checkedAt: check.checked_at, domain, findings: (check.result as DomainReport | null)?.findings ?? [] } : null,
    },
    calendars: { count: cal?.n ?? 0, mapped: mappedN?.n ?? 0, permissionMissing: granted !== null && !granted.includes("calendars.readonly"), items: calList.map((r) => ({ name: (r.name as string | null) ?? "Unnamed calendar", active: r.is_active !== false, mapped: r.mapped === true })) },
  });
}

// Email: the address comes from the saved setting only. A request can never name the address, so this cannot be used to send to someone else.
async function emailAddress(ctx: Ctx): Promise<string | null> {
  const [set] = await sql()`select digest_email from settings where installation_id = ${ctx.installationId}`;
  const a = (set?.digest_email as string | null) ?? null;
  return a && validEmail(a) ? a : null;
}

async function emailVerify(ctx: Ctx) {
  if (viewerOf(ctx).level === "self") return json({ error: "Only an administrator can do this." }, 403);
  const address = await emailAddress(ctx);
  const domain = extractDomain(address);
  if (!address || !domain) return json({ error: "Save an email address first." }, 400);
  const report = ctx.demo ? await demoDomainReport(domain) : await checkDomain(domain);
  await saveDomainCheck(ctx.installationId, null, domain, report.status, report);
  return json({ check: { status: report.status, checkedAt: new Date().toISOString(), domain, findings: report.findings } });
}

const testHits = new Map<string, number[]>();
async function emailTest(ctx: Ctx) {
  if (viewerOf(ctx).level === "self") return json({ error: "Only an administrator can do this." }, 403);
  if (ctx.demo) return json({ error: "Sending a test is not available in the demo. It needs a real install." }, 400);
  const address = await emailAddress(ctx);
  if (!address) return json({ error: "Save an email address first." }, 400);
  const now = Date.now(), key = ctx.installationId, list = (testHits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 3) return json({ error: "Too many tests. Wait a minute." }, 429);
  list.push(now); testHits.set(key, list);
  const mail = {
    subject: "[TEST] SubSync email check",
    text: "This is a test from SubSync. If you can read this, alert and summary emails can reach this address. You do not need to do anything.",
    html: "<p>This is a test from SubSync. If you can read this, alert and summary emails can reach this address. You do not need to do anything.</p>",
  };
  // Through the one switch: with SEND_EMAIL_LIVE off nothing leaves the server and only a "WOULD SEND" line is recorded.
  const r = await sendConnectionsTest(ctx.installationId, address, mail);
  if (!r.ok) return json({ ok: false, text: `The test email could not be sent. If it happens again, send us this code: ${r.code}.` }, 502);
  const dryRun = r.dryRun === true;
  return json({ ok: true, dryRun, text: testResultText({ dryRun, to: address }), preview: dryRun ? { to: address, subject: mail.subject, body: mail.text } : null });
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
