import { randomUUID } from "node:crypto";
import { accountsIn, forgetPeople, type Scope } from "../analytics/people3-queries";
import { auditPeople } from "../analytics/people-actions-queries";
import { applyRoleChanges, listPeopleRoles, namesFor, ownedPeople, recentRoleChanges, roleCounts, roleMap, storedRoles, undoPlan } from "../analytics/team-roles-queries";
import { BIG_CHANGE, BULK_CAP, isRoleId, planRoleChange, previewLine, ROLE_IDS, ROLE_LABEL, ROLE_SHORT, ROLE_TIP, SETTER_CLOSER_TIP, type RoleFilter, type RoleId } from "../people/roles";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";
import { ownedLocation } from "./tenant-guard";

// Team roles, under /api/app/people3/roles/<part>. SubSync's own labels (Setter, Closer, Both, Support, Manager, Other); the CRM is never written.
//   GET  map     every stored label the caller may see, for the chips other modules draw next to a name                    any person (pp_roles)
//   GET  list    people with their label, searchable, filterable by role, with a suggestion for people with none            managers only
//   GET  log     the recent changes, one line per batch                                                                      managers only
//   POST set     give people a label or clear it: step "preview", then "do" (clearing, or more than 25 people, needs words typed)   managers only
//   POST undo    put one earlier batch back (people changed again since are left alone): preview, then do                    managers only
// Who is asking and which accounts they may read come from the verified session (`ctx`, `h.allowed`), never from the request. A person id is used only after ownedPeople() has found that person
// among the people the caller may see; an account id only after the shared ownedLocation guard. A foreign id is the same answer as one that does not exist and is never echoed.
// Only an agency owner or administrator may set a label for everywhere; an account administrator sets labels for their own account only; everyone else may read, not change.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type TeamRolesHelpers = { allowed: () => Promise<string[] | null> };

const on = (ctx: Ctx) => ctx.entitlements.features.pp_roles === true && !ctx.entitlements.locked.includes("pp_roles");
const off = () => json({ error: "This is not switched on for your account" }, 404);
const gone = () => json({ error: "That is not available" }, 404);
const managersOnly = () => json({ error: "Ask your administrator to do this." }, 403);
const actorOf = (ctx: Ctx) => ({ userId: ctx.session.userId ?? null, name: ctx.session.userName ?? null });
const UUID = /^[0-9a-f-]{36}$/i;
const FILTERS = new Set<string>(["all", "none", "setters", "closers", ...ROLE_IDS]);
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

export async function handleTeamRoles(ctx: Ctx, h: TeamRolesHelpers): Promise<Response> {
  if (!on(ctx)) return off();
  const part = ctx.segments[2], m = ctx.request.method;
  const { level, selfId } = viewerOf(ctx);
  const allowed = await h.allowed();
  const scope: Scope = { inst: ctx.installationId, allowed, level, selfId };
  const manager = level !== "self";
  const res = await dispatch(ctx, h, part, m, scope, manager);
  if (m === "POST" && res.ok) forgetPeople(ctx.installationId);
  return res;
}

async function dispatch(ctx: Ctx, h: TeamRolesHelpers, part: string, m: string, scope: Scope, manager: boolean): Promise<Response> {
  if (m === "GET" && part === "map") return mapRoute(scope, manager);
  if (m === "GET" && part === "list") return manager ? listRoute(ctx, h, scope) : managersOnly();
  if (m === "GET" && part === "log") return manager ? logRoute(scope) : managersOnly();
  if (m === "POST" && part === "set") return manager ? setRoute(ctx, h, scope) : managersOnly();
  if (m === "POST" && part === "undo") return manager ? undoRoute(ctx, scope) : managersOnly();
  return json({ error: "Unknown action" }, 404);
}

async function accountIds(scope: Scope): Promise<string[]> {
  return (await accountsIn(scope, null)).map((a) => a.id);
}

const tipsOut = () => ({ roles: ROLE_IDS.map((id) => ({ id, label: ROLE_LABEL[id], short: ROLE_SHORT[id], tip: ROLE_TIP[id] })), setterCloserTip: SETTER_CLOSER_TIP });

async function mapRoute(scope: Scope, manager: boolean): Promise<Response> {
  const ids = await accountIds(scope);
  const r = await roleMap(scope, ids);
  return json({ ...r, canChange: manager, level: scope.level, ...tipsOut() });
}

async function listRoute(ctx: Ctx, h: TeamRolesHelpers, scope: Scope): Promise<Response> {
  const sp = ctx.url.searchParams;
  const asked = sp.get("location");
  const one = asked ? await ownedLocation(ctx.installationId, await h.allowed(), asked) : null;
  if (asked && !one) return gone();
  const ids = await accountIds(scope);
  const accounts = await accountsIn(scope, null);
  const fRaw = sp.get("role") ?? "all";
  const filter = (FILTERS.has(fRaw) ? fRaw : "all") as RoleFilter;
  const q = (sp.get("q") ?? "").trim().slice(0, 60) || null;
  const size = Math.max(1, Math.min(100, int(sp.get("size"), 25)));
  const [page, counts] = await Promise.all([
    listPeopleRoles(scope, ids, one, { q, filter, after: sp.get("after")?.slice(0, 400) ?? null, size }),
    roleCounts(scope, ids, one),
  ]);
  return json({
    ...page, counts, filter, canChange: true, level: scope.level,
    // an agency owner may set a label for everywhere; an account administrator only for their own account (the screen preselects it)
    scopes: { everywhere: scope.level === "all", accounts: accounts.map((a) => ({ locationId: a.id, name: a.name })) },
    ...tipsOut(),
  });
}

async function logRoute(scope: Scope): Promise<Response> {
  const ids = await accountIds(scope);
  return json({ rows: await recentRoleChanges(scope, scope.allowed ? ids : null) });
}

/** The words that must be typed: clearing roles (a removal) and any change to more than BIG_CHANGE people. */
function confirmWords(count: number, to: RoleId | null, firstName: string | null): string[] | null {
  if (to === null) return count === 1 && firstName ? [firstName.toLowerCase(), "clear role"] : [`clear ${count} roles`];
  if (count > BIG_CHANGE) return [`set ${count} roles`];
  return null;
}
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

async function setRoute(ctx: Ctx, h: TeamRolesHelpers, scope: Scope): Promise<Response> {
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send a JSON body." }, 400);
  const to = b.role === null ? null : isRoleId(b.role) ? b.role : undefined;
  if (to === undefined) return json({ error: "Choose a role: Setter, Closer, Both, Support, Manager or Other." }, 400);
  if (!Array.isArray(b.userIds) || b.userIds.length === 0 || b.userIds.length > BULK_CAP) return json({ error: `Choose between 1 and ${BULK_CAP} people.` }, 400);
  const ids = await accountIds(scope);
  // Which scope the label is for: '' (everywhere, agency owners and administrators only) or one account the caller may read.
  let loc = "";
  if (b.locationId !== undefined && b.locationId !== null && b.locationId !== "") {
    const one = await ownedLocation(ctx.installationId, await h.allowed(), b.locationId);
    if (!one) return gone();
    loc = one;
  } else if (scope.level !== "all") {
    if (ids.length !== 1) return json({ error: "Choose a client account." }, 400);
    loc = ids[0];
  }
  const owned = await ownedPeople(scope, ids, b.userIds);
  if (owned.length !== new Set(b.userIds).size) return gone(); // any person who is not the caller's makes the whole request not found, and says nothing about which
  const current = await storedRoles(ctx.installationId, owned, loc);
  const plan = planRoleChange(current, owned, to, loc);
  const names = await namesFor(ctx.installationId, plan.changes.slice(0, 20).map((c) => c.userId));
  const words = plan.changes.length ? confirmWords(plan.changes.length, to, plan.changes.length === 1 ? names.get(plan.changes[0].userId) ?? null : null) : null;
  if (b.step !== "do") {
    return json({
      ok: true, preview: {
        summary: previewLine(plan.changes, plan.unchanged, to, loc ? "one account" : "everywhere"),
        changes: plan.changes.slice(0, 20).map((c) => ({ label: names.get(c.userId) ?? "Someone", from: c.from ? ROLE_LABEL[c.from] : "No role", to: c.to ? ROLE_LABEL[c.to] : "No role" })),
        more: Math.max(0, plan.changes.length - 20), confirm: { needed: words !== null, words: words ?? [] },
      },
    });
  }
  if (words && !words.includes(norm(b.typed))) return json({ error: "The words you typed do not match. Nothing was changed." }, 400);
  if (!plan.changes.length) return json({ ok: true, changed: 0, batchId: null, message: "Nothing needed changing." });
  const batchId = randomUUID();
  const done = await applyRoleChanges(ctx.installationId, plan.changes, actorOf(ctx), batchId, to === null ? "clear" : plan.changes.length > 1 ? "bulk" : "set");
  if (!done) return json({ error: "Saving roles needs the latest database update, which has not run yet." }, 503);
  await auditPeople(ctx.installationId, ctx.session.userName ?? ctx.session.userId ?? null, "people.roles.set", { count: plan.changes.length, role: to, location: loc || null, batchId });
  return json({ ok: true, changed: plan.changes.length, batchId, message: `Saved. ${plan.changes.length === 1 ? "1 person" : `${plan.changes.length} people`} changed. Nothing was changed in your CRM.` });
}

async function undoRoute(ctx: Ctx, scope: Scope): Promise<Response> {
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const b = await readBody(ctx);
  const id = b && typeof b.batchId === "string" && UUID.test(b.batchId) ? b.batchId : null;
  if (!b || !id) return gone();
  const ids = await accountIds(scope);
  const plan = await undoPlan(scope, ids, id);
  if (!plan) return gone();
  if (b.step !== "do") {
    const names = await namesFor(ctx.installationId, plan.changes.slice(0, 20).map((c) => c.userId));
    return json({
      ok: true, preview: {
        summary: plan.changes.length ? `Put back ${plan.changes.length} ${plan.changes.length === 1 ? "role" : "roles"} as they were.${plan.skipped ? ` ${plan.skipped} changed again since and will be left alone.` : ""} Nothing is changed in your CRM.` : "Nothing can be put back: every person was changed again since.",
        changes: plan.changes.slice(0, 20).map((c) => ({ label: names.get(c.userId) ?? "Someone", from: c.from ? ROLE_LABEL[c.from] : "No role", to: c.to ? ROLE_LABEL[c.to] : "No role" })),
        more: Math.max(0, plan.changes.length - 20), confirm: { needed: false, words: [] },
      },
    });
  }
  if (!plan.changes.length) return json({ ok: true, changed: 0, message: "Nothing to put back." });
  const batchId = randomUUID();
  const done = await applyRoleChanges(ctx.installationId, plan.changes, actorOf(ctx), batchId, "undo");
  if (!done) return json({ error: "Saving roles needs the latest database update, which has not run yet." }, 503);
  await auditPeople(ctx.installationId, ctx.session.userName ?? ctx.session.userId ?? null, "people.roles.undo", { count: plan.changes.length, undone: id });
  return json({ ok: true, changed: plan.changes.length, batchId, message: `Put back ${plan.changes.length} ${plan.changes.length === 1 ? "role" : "roles"}.` });
}
