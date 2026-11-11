import { attention, clientsCache, compare, exportCsv, list, options, overview, people, receipt, setup, trends, type Filters, type Links, type Scope } from "../analytics/clients3-queries";
import { billing } from "../analytics/clients3-billing";
import { clampSize, parseWindow } from "../analytics/clients3-intel";
import { CL2_FLAGS } from "../analytics/clients2-types";
import { CL3_FLAGS, CL3_PARTS, CL3_REASONS, type Cl3Level, type Cl3Part, type Cl3Reason } from "../analytics/clients3-types";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedLocation } from "./tenant-guard";

// GET /api/app/clients3?part=overview|needs-attention|trends|compare|receipt|people|setup|list|options|export. Read only. Who is asking comes from the verified session; the accounts
// that caller may read come from `allowed` (decided by the router from the session). Every account id in the address (location, ids) goes through ownedLocation and only NARROWS
// inside `allowed`; one that does not belong is answered like nothing there and never echoed. Free-text parameters only filter inside the caller's accounts. Only agency staff see
// the Clients module (a client or business session gets an empty answer).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Clients3Helpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const PART_FLAG: Record<Cl3Part, string> = {
  overview: "cl_overview", "needs-attention": "cl_attention", trends: "cl_trends", compare: "cl_compare", receipt: "cl_reports", people: "cl_people", setup: "cl_setup", billing: "cl_billing", list: "cl_attention", options: "cl_overview", export: "cl_reports",
};
const LEVELS = new Set(["ok", "watch", "act", "unknown"]);
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;

export async function handleClients3(ctx: Ctx, h: Clients3Helpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as Cl3Part | null;
  if (!part || !(CL3_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowedAll, dl, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries([...CL3_FLAGS, ...CL2_FLAGS].map((f) => [f, ent.features[f as Feature] === true]));
  if (!flags[PART_FLAG[part]]) return json({ error: "This part of Clients is not switched on yet." }, 404);

  const canSee = ctx.kind === "agency" && ctx.limitTo === null;
  const wrap = (body: object, cached = false, problem: string | null = null) => json({ ...body, generatedAt: new Date().toISOString(), cached, canSeeAccounts: canSee, flags, problem });
  if (!canSee) return wrap({ rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false, accounts: [], industries: [], sides: [], points: [] });

  const links: Links = { account: (l) => dl.account(l), contact: (l, c) => dl.contact(l, c) };
  const asked = sp.get("location");
  const one = asked ? await ownedLocation(ctx.installationId, allowedAll, asked) : null;
  if (asked && !one) return wrap({ rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false, accounts: [], industries: [], sides: [], points: [] });
  const scope: Scope = { inst: ctx.installationId, allowed: allowedAll };
  const w = parseWindow(sp.get("from"), sp.get("to"), Date.now());
  const lv = sp.get("level");
  const f: Filters = { from: w.from, to: w.to, location: one, q: text(sp.get("q"), 60), industry: text(sp.get("industry"), 80), level: lv && LEVELS.has(lv) ? (lv as Cl3Level) : null };
  const p = Math.max(0, int(sp.get("page"), 0)), size = clampSize(int(sp.get("size"), 20));
  const key = JSON.stringify([ctx.installationId, allowedAll, part, sp.toString()]);
  const hit = clientsCache.get(key);
  if (hit && part !== "export") return wrap(hit, true, w.problem);
  const done = (body: object) => { clientsCache.set(key, body); return wrap(body, false, w.problem); };

  switch (part) {
    case "overview": return done(await overview(scope, f, w.days, links));
    case "needs-attention": return done(await attention(scope, f, { page: p, size, sort: text(sp.get("sort"), 20), dir: sp.get("dir") }, links));
    case "trends": return done(await trends(scope, f, sp.get("grain") === "month" ? "month" : "week", { page: p, size }));
    case "compare": {
      const owned: string[] = [];
      for (const raw of (sp.get("ids") ?? "").split(",").slice(0, 2)) { const ok = await ownedLocation(ctx.installationId, allowedAll, raw.trim()); if (ok) owned.push(ok); }
      return done(await compare(scope, f, owned));
    }
    case "receipt": return done((await receipt(scope, f, one, sp.get("week"))) ?? { rows: [], total: 0, weekStart: "" });
    case "billing": return done(await billing(scope, f, { page: p, size }));
    case "people": return done(await people(scope, f, { page: p, size }));
    case "setup": return done(await setup(scope, f, { page: p, size }));
    case "options": return done(await options(scope));
    case "list": {
      const reason = sp.get("reason");
      if (!reason || !(CL3_REASONS as readonly string[]).includes(reason)) return json({ error: "Not found" }, 404);
      return done(await list(scope, f, reason as Cl3Reason, { page: p, size }, links));
    }
    case "export": {
      const csv = await exportCsv(scope, f, links);
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="clients.csv"', "cache-control": "no-store" } });
    }
  }
  return json({ error: "Not found" }, 404);
}
