import { installationHasScope } from "../analytics/cleanup-queries";
import { sql } from "../db";
import { availability } from "../connections/flow";
import { listConnections } from "../connections/queries";
import { isLive } from "../live-flags";
import { disconnectOwn, isPersonalProvider, listMine, listTeam, revokeByAdmin, secretRowOf, type PersonalProvider } from "../connections/personal";
import { START_PROVIDERS, startPersonal, testPersonal } from "../connections/personal-flow";
import { can, covers, personFromSession, statusScope, type Person } from "../connections/person";
import { effectivePolicy, readFlags } from "../connections/policy";
import { json, type AuthContext } from "./auth";

// The screens' endpoints for connections (INTEGRATIONS_SPEC sections 3, 5.1, 6 and 12). Who the caller is comes ONLY from the signed session
// (`personFromSession`); no user id, role, company or account is ever read from the request. Nothing here returns a token, a secret, a webhook
// address or any meeting content: a person sees their own connections, an administrator sees status and counts.

type Ctx = AuthContext & { request: Request; url: URL };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION = /^[A-Za-z0-9_-]{3,64}$/;

const personOf = (ctx: Ctx): Person | null => personFromSession(ctx.session, ctx.kind, ctx.limitTo);
const NEED_SIGN_IN = () => json({ error: "Please sign in again" }, 401);
const zoomOn = (ctx: Ctx) => ctx.entitlements.features.zoom_meet !== false;

/** The tools a person can connect. Zoom and Google Meet are not listed while their switch is off. */
function cards(ctx: Ctx) {
  const on = availability();
  const list: Array<{ provider: PersonalProvider; name: string; available: boolean }> = [{ provider: "fathom", name: "Fathom", available: on.fathom }];
  if (zoomOn(ctx)) list.push({ provider: "zoom", name: "Zoom", available: on.zoom });
  return list;
}

export async function myConnectionsView(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const delivery = isLive("FATHOM_WEBHOOK_LIVE");
  const mine = (await listMine(person, delivery)).filter((c) => c.provider !== "zoom" || zoomOn(ctx));
  // Adding a note to a contact needs the optional permission to edit contacts. Without it the card says "Needs permission: reconnect" and nothing is written.
  const canWrite = ctx.demo ? true : await installationHasScope(ctx.installationId, "contacts.write");
  // The count of this person's own calls that wait in their Meeting inbox (a number, never any content). Shown with a link only while the Meeting notes page is on.
  const [waiting] = ctx.demo ? [{ n: 0 }] : await sql()`select count(*)::int n from meetings where installation_id = ${ctx.installationId} and owner_ghl_user_id = ${person.userId} and status = 'needs_contact'`;
  return json({ cards: cards(ctx), connections: mine, delivery, canAdmin: can(person.role, "see_status"), me: { name: person.name }, canWrite, inbox: { on: ctx.entitlements.features.meetings !== false, waiting: (waiting?.n as number) ?? 0 } });
}

export async function myConnectionStart(ctx: Ctx, provider: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!isPersonalProvider(provider) || !(START_PROVIDERS as readonly string[]).includes(provider) || (provider === "zoom" && !zoomOn(ctx))) return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "Connecting is not available in the demo. It needs a real install." }, 400);
  const link = await startPersonal(person, ctx.installationId, provider as "fathom" | "zoom");
  return link.ok ? json({ url: link.url }) : json({ error: link.error }, 503);
}

export async function myConnectionTest(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  const row = await secretRowOf(person, id);
  if (!row) return json({ error: "Not found" }, 404);
  const result = await testPersonal(row);
  return json(result, result.ok ? 200 : 502);
}

export async function myConnectionRemove(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  return (await disconnectOwn(person, id)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
}

// ---------------- Team connections (administrators) ----------------

async function policyView(ctx: Ctx, person: Person) {
  const rows = await sql()`select scope, location_id, flags from meeting_policies where installation_id = ${ctx.installationId}`;
  let agency: unknown = null;
  const accounts: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.scope === "agency") agency = r.flags;
    else if (typeof r.location_id === "string") accounts[r.location_id] = r.flags;
  }
  const own = ctx.limitTo ?? null;
  return {
    canSetCompany: can(person.role, "set_agency_policy") && ctx.kind === "agency",
    company: readFlags(agency),
    // A client account's administrator sees the rule of their own account; the company's administrators see every account's.
    accounts: Object.fromEntries(Object.entries(accounts).filter(([id]) => (own ? id === own : true)).map(([id, f]) => [id, { set: readFlags(f), effective: effectivePolicy(agency, f) }])),
    effectiveOwn: own ? effectivePolicy(agency, accounts[own]) : null,
  };
}

export async function teamConnectionsView(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const scope = statusScope(person, null);
  if (scope.kind === "none") return json({ error: "This page is for administrators", forbidden: true }, 403);
  const team = await listTeam(ctx.installationId, scope);
  // Slack and anything made before connections became personal belong to the whole installation: only the people who run it (not a client's own administrator) see them.
  const wholeInstall = ctx.kind !== "client";
  const workspace = wholeInstall ? await listConnections(ctx.installationId) : [];
  const names = await accountNames(ctx.installationId, team.map((t) => t.homeLocationId).filter((x): x is string => !!x));
  return json({
    scope: scope.kind,
    slack: workspace.filter((c) => c.provider === "slack"),
    slackAvailable: availability().slack,
    legacy: workspace.filter((c) => c.provider !== "slack" && (c.provider !== "zoom" || zoomOn(ctx))),
    team: team.map((t) => ({ ...t, accountName: t.homeLocationId ? names.get(t.homeLocationId) ?? null : null })),
    summary: {
      people: new Set(team.map((t) => t.person ?? t.id)).size,
      connected: team.filter((t) => t.status === "connected").length,
      needAttention: team.filter((t) => t.status === "needs_reconnect" || t.status === "expired" || t.status === "error").length,
      waiting: team.reduce((n, t) => n + t.waiting, 0),
    },
    policy: await policyView(ctx, person),
    delivery: isLive("FATHOM_WEBHOOK_LIVE"),
  });
}

async function accountNames(installationId: string, ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await sql()`select location_id, name from locations where installation_id = ${installationId} and location_id = any(${ids}::text[])`;
  return new Map(rows.map((r) => [r.location_id as string, (r.name as string | null) ?? null]));
}

export async function teamConnectionRevoke(ctx: Ctx, id: string): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  if (!can(person.role, "revoke")) return json({ error: "This is for administrators", forbidden: true }, 403);
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  const ok = await revokeByAdmin(ctx.installationId, person, statusScope(person, null), id);
  return ok ? json({ ok: true }) : json({ error: "Not found" }, 404);
}

// ---------------- the rules for meeting notes ----------------

type PolicyBody = { scope?: unknown; locationId?: unknown; flags?: unknown };

/**
 * Saves a policy. The company default is for the company owner only. A client account's rule is for that account's administrator, or for the company's
 * owners and administrators (for any of their accounts). The saved value can only ever make the result stricter, because the effective rule is always
 * the most restrictive of the layers; a looser value is stored as typed and has no effect.
 */
export async function policySave(ctx: Ctx): Promise<Response> {
  const person = personOf(ctx);
  if (!person) return NEED_SIGN_IN();
  const body = (await ctx.request.json().catch(() => null)) as PolicyBody | null;
  if (!body || (body.scope !== "agency" && body.scope !== "account")) return json({ error: "Say which rule you are changing" }, 400);
  const flags = readFlags(body.flags);
  const db = sql();
  if (body.scope === "agency") {
    if (!can(person.role, "set_agency_policy") || ctx.kind !== "agency") return json({ error: "Only the company owner can change the company rule", forbidden: true }, 403);
    await db`
      insert into meeting_policies (installation_id, scope, location_id, flags, set_by) values (${ctx.installationId}, 'agency', null, ${db.json(flags as never)}, ${person.userId})
      on conflict (installation_id, scope, coalesce(location_id, '')) do update set flags = excluded.flags, set_by = excluded.set_by, set_at = now()`;
  } else {
    if (!can(person.role, "set_account_policy")) return json({ error: "This is for administrators", forbidden: true }, 403);
    const loc = typeof body.locationId === "string" && LOCATION.test(body.locationId) ? body.locationId : ctx.limitTo;
    if (!loc) return json({ error: "Say which client account" }, 400);
    const scope = statusScope(person, null);
    // An account's administrator can only change their own account; the company's people can change any account of the company.
    if (ctx.limitTo && loc !== ctx.limitTo) return json({ error: "Not found" }, 404);
    if (!covers(scope, loc)) return json({ error: "Not found" }, 404);
    const [known] = await db`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${loc}`;
    if (!known) return json({ error: "Not found" }, 404);
    await db`
      insert into meeting_policies (installation_id, scope, location_id, flags, set_by) values (${ctx.installationId}, 'account', ${loc}, ${db.json(flags as never)}, ${person.userId})
      on conflict (installation_id, scope, coalesce(location_id, '')) do update set flags = excluded.flags, set_by = excluded.set_by, set_at = now()`;
  }
  await db`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${person.userId}, 'meeting_policy.saved', ${db.json({ scope: body.scope } as never)})`;
  return json({ ok: true, policy: await policyView(ctx, person) });
}
