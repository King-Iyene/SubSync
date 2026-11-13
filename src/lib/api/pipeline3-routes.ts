import { pipelineCards } from "../analytics/pipeline3-cards";
import { attention, cleanId, dealList, detail, forecast, health, moneyFlow, overview, people, plCache, receipt, replay, sources, stageHistory, wonLost, type Filters, type Scope } from "../analytics/pipeline3-queries";
import { funnel, funnelDeals, historySettings, pipelineNames, saveHistorySettings, stuck } from "../analytics/pipeline3-funnel";
import { clampSize, DAY, parsePlWindow } from "../analytics/pipeline3-intel";
import { PL3_FLAGS, PL3_PARTS, type Pl3Bucket, type Pl3Part } from "../analytics/pipeline3-types";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { ownedAccount } from "./pl-guard";

// GET /api/app/pipeline3?part=overview|money-flow|attention|won-lost|forecast|people|sources|stage-history|health|receipt|list|detail|replay (read only). Who is asking comes from the
// verified session; the accounts that caller may read come from `allowed` (decided by the router from the session, never from the request): an account id in the address only
// NARROWS inside them. A client's staff get no ranking of people or accounts. Every part is behind its own pl_* flag.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Pl3Helpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const PART_FLAG: Record<Pl3Part, string> = {
  overview: "pl_overview", "money-flow": "pl_money_flow", attention: "pl_attention", "won-lost": "pl_won_lost", forecast: "pl_forecast", people: "pl_people", sources: "pl_sources",
  "stage-history": "pl_stage_history", health: "pl_health", receipt: "pl_proof", list: "pl_overview", detail: "pl_history", replay: "pl_money_flow", pipelines: "pl_money_flow",
  funnel: "pl_history_funnel", "funnel-deals": "pl_history_funnel", stuck: "pl_history_funnel", "funnel-settings": "pl_history_funnel",
};
const BUCKETS = new Set(["open", "won", "lost", "abandoned", "stale", "healthy", "outlier", "no_owner", "no_value", "test", "no_reason", "booked_appt", "no_appt"]);
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;
const personParam = (v: string | null) => (v === "none" ? "none" : cleanId(v));

export async function handlePipeline3(ctx: Ctx, h: Pl3Helpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as Pl3Part | null;
  if (!part || !(PL3_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowedAll, links, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(PL3_FLAGS.map((f) => [f, ent.features[f as Feature] === true]));
  if (!flags[PART_FLAG[part]]) return json({ error: "This part of Pipeline is not switched on yet." }, 404);

  const seePeople = ctx.kind !== "client";
  const one = cleanId(sp.get("location"));
  // An account id only narrows inside what the caller may read; one outside it is the same answer as nothing there.
  if (sp.get("location") && (!one || (await ownedAccount(ctx.installationId, allowedAll, one)) === null)) return json(emptyFor(part, flags, ctx.limitTo === null));
  const scope: Scope = { inst: ctx.installationId, allowed: allowedAll };
  const now = Date.now();
  const w = parsePlWindow(sp.get("from"), sp.get("to"), now);
  // Sources and the track record need a longer look by default than the 30 days of the other screens.
  const wide = part === "sources" && !sp.get("from") && !sp.get("to") ? { from: new Date(now + DAY - (now % DAY) - 180 * DAY), to: new Date(now + DAY - (now % DAY)), days: 180, problem: null as string | null } : w;
  const bucketP = sp.get("bucket");
  const f: Filters = {
    from: wide.from, to: wide.to, location: one, pipeline: text(sp.get("pipeline"), 120), stage: cleanId(sp.get("stage")), stageKey: (sp.get("stage") ?? "").includes("|") ? text(sp.get("stage"), 200) : null, owner: seePeople ? personParam(sp.get("owner")) : null,
    source: text(sp.get("source"), 120), q: text(sp.get("q"), 60), bucket: bucketP && BUCKETS.has(bucketP) ? (bucketP as Pl3Bucket) : null, reason: text(sp.get("reason"), 120), includeTest: sp.get("test") === "1",
  };
  const p = Math.max(0, int(sp.get("page"), 0)), size = clampSize(int(sp.get("size"), 20)), dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const link = (loc: string, contact: string) => links.contact(loc, contact);
  const key = JSON.stringify([ctx.installationId, allowedAll, part, sp.toString(), ctx.kind]);
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, canSeeAccounts: ctx.limitTo === null, flags, problem: w.problem });
  const hit = plCache.get(key);
  if (hit && part !== "detail") return wrap(hit as object, true);
  const done = (body: object) => { plCache.set(key, body); return wrap(body); };
  const base = { f, page: p, size, sort: sp.get("sort"), dir, after: sp.get("after"), knownTotal: sp.get("total") !== null ? Math.max(0, int(sp.get("total"), 0)) : null };

  switch (part) {
    case "overview": return done(await overview(scope, f, wide.days));
    case "attention": return done(await attention(scope, base, link));
    case "won-lost": return done(await wonLost(scope, base, link));
    case "list": return done(await dealList(scope, base, link));
    case "forecast": return done(await forecast(scope, f));
    case "people":
      return seePeople ? done(await people(scope, f, p, size, sp.get("sort"))) : wrap({ rows: [], total: 0, page: 0, size, pages: 1, truncated: false, unowned: { value: 0, n: 0 } });
    case "sources": return done(await sources(scope, f));
    case "stage-history": return done(await stageHistory(scope, f, p, size));
    case "health":
      return seePeople && ctx.limitTo === null ? done(await health(scope, f, p, size)) : wrap({ rows: [], total: 0, page: 0, size, pages: 1, truncated: false, overall: null });
    case "money-flow": {
      const m = await moneyFlow(scope, f);
      return done(seePeople ? m : { ...m, people: [] });
    }
    case "funnel": return done(await funnel(scope, f, await historySettings(ctx.installationId)));
    case "funnel-deals": {
      const dr = sp.get("drill") ?? "entered", step = text(sp.get("step"), 120);
      if (!step || !["entered", "advanced", "dropped", "here", "other"].includes(dr)) return json({ error: "Not found" }, 404);
      return done(await funnelDeals(scope, f, await historySettings(ctx.installationId), step.toLowerCase(), dr as "entered", p, size, link));
    }
    case "stuck": return done(await stuck(scope, f, await historySettings(ctx.installationId), p, size, link));
    case "funnel-settings": return wrap({ ...(await historySettings(ctx.installationId)), canEdit: ctx.kind === "agency", pipelines: (await pipelineNames(scope, { from: f.from, to: f.to, location: null })).map((x) => x.name).slice(0, 100) });
    case "pipelines": return done(await pipelineCards(scope, { from: f.from, to: f.to, location: one, q: f.q, showEmpty: sp.get("empty") === "1", after: sp.get("after"), size: int(sp.get("size"), 24), includeTest: f.includeTest, asc: sp.get("dir") === "asc" }));
    case "replay": return done(await replay(scope, f, int(sp.get("days"), 30)));
    case "receipt": {
      const wk = sp.get("week") ?? "";
      const t = now - 7 * DAY;
      const monday = Math.floor(t / DAY) * DAY - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
      return done(await receipt(scope, one, /^\d{4}-\d{2}-\d{2}$/.test(wk) && Number.isFinite(Date.parse(wk)) ? new Date(Date.parse(wk)) : new Date(monday)));
    }
    case "detail": {
      const dl = await ownedAccount(ctx.installationId, allowedAll, sp.get("location"));
      if (!dl) return json({ error: "Deal not found" }, 404);
      const d = await detail(scope, dl, sp.get("id") ?? sp.get("deal") ?? "", link);
      if (!d) return json({ error: "Deal not found" }, 404);
      return wrap(d);
    }
  }
  return json({ error: "Not found" }, 404);
}

// PUT /api/app/pipeline3/history-settings: the person's own choices for the history funnel (fewest deals before a number shows, leave test deals out, which pipeline opens first). Agency owners and staff only.
export async function handlePipelineHistorySettings(ctx: Ctx): Promise<Response> {
  if (ctx.kind !== "agency") return json({ error: "Only the account owner's team can change this." }, 403);
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  if (ent.features["pl_history_funnel" as Feature] !== true) return json({ error: "This part of Pipeline is not switched on yet." }, 404);
  const body = (await ctx.request.json().catch(() => null)) as { minSample?: unknown; excludeTest?: unknown; defaultPipeline?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "Bad request" }, 400);
  return json({ ...(await saveHistorySettings(ctx.installationId, body)), canEdit: true });
}

function emptyFor(part: Pl3Part, flags: Record<string, boolean>, canSee: boolean) {
  const base = { generatedAt: new Date().toISOString(), cached: false, canSeeAccounts: canSee, flags };
  return part === "overview" ? { ...base, headline: "No deals in play yet.", button: null, openCount: 0, cards: [], trend: [] } : { ...base, rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false };
}
