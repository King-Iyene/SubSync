import { access, accountsIn, coaching, options, personPanel, scorecards, today, workload, peopleCache, ownedUser, type Flags, type Level, type Links, type Scope } from "../analytics/people3-queries";
import { exportScorecards, handoff, leaderboard, list, money, nextLead, proof } from "../analytics/people3-queries2";
import { clampSize, DAY, parseWindow } from "../analytics/people3-intel";
import { PP3_FLAGS, PP3_PARTS, PP3_REASONS, PP3_SORTS, type Pp3Part, type Pp3Reason, type Pp3Sort } from "../analytics/people3-types";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// GET /api/app/people3?part=today|scorecards|workload|leaderboard|money|coaching|access|proof|person|handoff|nextlead|list|options|export. Read only. Who is asking comes from the verified
// session: `level` says which people the caller may see (agency owner or admin: everyone; an account administrator: the people of their account; anyone else: only themselves, enforced in SQL),
// and `allowed` (decided by the router from the session) says which accounts. Every account id (location) goes through ownedLocation and every person id (user) through ownedUser; an id that
// is not the caller's is answered like nothing there and never echoed. Free-text parameters only filter inside the caller's own data.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type People3Helpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

/** Any one of these switches the part on. */
const PART_FLAG: Record<Pp3Part, string[]> = {
  today: ["pp_today"], scorecards: ["pp_scorecards"], workload: ["pp_workload"], leaderboard: ["pp_leaderboard"], money: ["pp_money"], coaching: ["pp_coaching"], access: ["pp_access"], proof: ["pp_proof"],
  person: ["pp_scorecards", "pp_workload"], handoff: ["pp_scorecards"], nextlead: ["pp_nextlead"], list: ["pp_today", "pp_workload", "pp_scorecards", "pp_money"], options: ["pp_module"], export: ["pp_scorecards"],
};
const REASONS = new Set<string>(PP3_REASONS), SORTS = new Set<string>(PP3_SORTS);
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;

/** Who this caller is, from the signed session only. Older sessions without a role get the least access. */
export function viewerOf(ctx: Pick<AuthContext, "kind" | "limitTo" | "session">): { level: Level; selfId: string | null } {
  const pr = ctx.session.personRole, uid = ctx.session.userId ?? null;
  if (ctx.kind === "agency" && ctx.limitTo === null && (pr === "agency_owner" || pr === "agency_admin")) return { level: "all", selfId: uid };
  if (ctx.kind === "business" && pr === "account_admin") return { level: "account", selfId: uid };
  return { level: "self", selfId: uid };
}

export async function handlePeople3(ctx: Ctx, h: People3Helpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as Pp3Part | null;
  if (!part || !(PP3_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowed, dl, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(PP3_FLAGS.map((f) => [f, ent.features[f as Feature] === true]));
  if (!PART_FLAG[part].some((f) => flags[f])) return json({ error: "This part of Team is not switched on yet." }, 404);

  const { level, selfId } = viewerOf(ctx);
  const wrap = (body: object, cached = false, problem: string | null = null) => json({ ...body, generatedAt: new Date().toISOString(), cached, canSee: true, level, flags, problem });
  const nothing = (extra: object = {}) => wrap({ rows: [], total: 0, size: 25, next: null, truncated: false, person: null, boards: [], lines: [], accounts: [], ...extra });

  const scope: Scope = { inst: ctx.installationId, allowed, level, selfId };
  const links: Links = { account: (l) => dl.account(l), contact: (l, c) => dl.contact(l, c), opportunities: (l) => dl.opportunities(l) };
  const asked = sp.get("location");
  const one = asked ? await ownedLocation(ctx.installationId, allowed, asked) : null;
  if (asked && !one) return nothing();
  const accts = await accountsIn(scope, one);
  const ids = accts.map((a) => a.id);
  const askedUser = sp.get("user");
  const user = askedUser ? await ownedUser(scope, ids, askedUser) : null;
  if (askedUser && !user) return nothing();

  const proofPart = part === "proof";
  const w = parseWindow(sp.get("from"), sp.get("to"), Date.now());
  const win = proofPart && w.days > 90 ? { from: new Date(w.to.getTime() - 90 * DAY), to: w.to, days: 90, problem: "A receipt covers at most 90 days." } : w;
  const sortRaw = sp.get("sort");
  const sort: Pp3Sort = sortRaw && SORTS.has(sortRaw) ? (sortRaw as Pp3Sort) : "answered";
  const dir = sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : null;
  const size = clampSize(int(sp.get("size"), 25));
  const after = text(sp.get("after"), 400);
  const q = text(sp.get("q"), 60);
  const role = sp.get("role") === "setter" ? "setter" : sp.get("role") === "closer" ? "closer" : null;
  const fl: Flags = { idle: flags.pp_idle === true, actions: flags.pp_actions === true };
  const key = JSON.stringify([ctx.installationId, allowed, level, selfId, part, sp.toString()]);
  const hit = peopleCache.get(key);
  if (hit && part !== "export") return wrap(hit, true, win.problem);
  const done = (body: object) => { peopleCache.set(key, body); return wrap(body, false, win.problem); };
  const range = { from: win.from, to: win.to };

  try {
    switch (part) {
      case "options": return done(await options(scope, level === "all"));
      case "today": return done(await today(scope, { location: one }, fl));
      case "scorecards": return done(await scorecards(scope, { ...range, location: one, q, role }, { sort, dir, after, size }, win.days));
      case "workload": return done(await workload(scope, { location: one, q, user }, { size, after }, fl));
      case "access": return done(await access(scope, { location: one, q }, { size, after }));
      case "leaderboard": return done(await leaderboard(scope, { ...range, location: one, role, all: sp.get("all") === "1", admins: sp.get("admins") === "1" }, { after }, win.days));
      case "money": return done(await money(scope, { ...range, location: one, q }, { size, after, sort: sortRaw === "won" ? "won" : "risk" }, win.days));
      case "handoff": return done(await handoff(scope, { ...range, location: one }, { size, after }, win.days));
      case "coaching": return done(await coaching(scope, user, { ...range, location: one }, win.days));
      case "nextlead": return done(await nextLead(scope, { location: one, source: text(sp.get("source"), 80), admins: sp.get("admins") === "1" }));
      case "proof": {
        const body = await proof(scope, { ...range, location: one }, { named: sp.get("named") === "1" }, win.days);
        return done(level === "self" ? { ...body, leads: 0, answered: 0, lines: [], staff: null, location: null } : body);
      }
      case "person": {
        const target = user ?? (level === "self" ? selfId : null);
        if (!target) return nothing();
        const body = await personPanel(scope, target, { ...range, location: one }, { sort, dir }, links, win.days);
        return body ? done(body) : nothing();
      }
      case "list": {
        const reason = sp.get("reason");
        if (!reason || !REASONS.has(reason)) return json({ error: "Not found" }, 404);
        return done(await list(scope, { reason: reason as Pp3Reason, user, location: one }, { size, after }, links));
      }
      case "export": {
        const out = await exportScorecards(scope, { ...range, location: one, q, role }, win.days);
        return new Response(out.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="team.csv"', "cache-control": "no-store", "x-subsync-truncated": out.truncated ? "1" : "0" } });
      }
    }
  } catch (error) {
    // A table the migrations have not created yet, or a database hiccup, shows as "not ready", never as a server error page.
    console.error("Team part failed", part, error instanceof Error ? error.message.replace(/[A-Za-z0-9_\-+/=]{32,}/g, "…").slice(0, 200) : "error");
    return nothing({ problem: "Team data is not ready yet. It fills in after the next refresh." });
  }
  return json({ error: "Not found" }, 404);
}
