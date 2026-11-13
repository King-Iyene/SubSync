import { sql } from "../db";
import { boardOf, trendWorthDrawing, type Board } from "../analytics/pipeline-board";
import { forecast } from "../analytics/pipeline-intel";
import { excludedOpenDeals, loadDeals, pipelineTrend } from "../analytics/pipeline-queries";
import { loadStageRules } from "../analytics/stage-rules-sql";
import { pipelineParam } from "../analytics/pipeline-pick";
import { MIN_CLOSED_DEALS } from "../analytics/metrics";
import { json, type AuthContext } from "./auth";

// GET /api/app/pipeline-intel?view=board: the money-first Pipeline screen (stage MOAT). Limited to the accounts the caller may see, nothing taken from the browser but an optional
// account filter that must be one of them. A client's staff get the numbers but never the pipeline controls (the same rule as the older screen).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type BoardHelpers = {
  allowed: () => Promise<string[] | null>;
  staleDays: () => Promise<number>;
  stageControls: (allowed: string[] | null, rules: Awaited<ReturnType<typeof loadStageRules>>) => Promise<unknown>;
};
const ID = /^[A-Za-z0-9_-]{3,64}$/;

export async function handleBoard(ctx: Ctx, h: BoardHelpers): Promise<Response> {
  const location = ctx.url.searchParams.get("location") ?? undefined;
  if (location && !ID.test(location)) return json({ error: "Invalid account" }, 400);
  const pipeline = pipelineParam(ctx.url.searchParams);
  const allowed = await h.allowed();
  if (location && allowed && !allowed.includes(location)) return json({ error: "Not found" }, 404);
  const [deals, rules, excluded, trend, staleDays] = await Promise.all([
    loadDeals(ctx.installationId, allowed, location, pipeline), loadStageRules(ctx.installationId), excludedOpenDeals(ctx.installationId, allowed, location, pipeline), pipelineTrend(ctx.installationId, allowed), h.staleDays(),
  ]);
  const db = sql();
  const rows = await db`
    select o.opportunity_id, o.contact_id,
      exists (select 1 from cached_appointments a where a.installation_id = o.installation_id and a.location_id = o.location_id and a.contact_id = o.contact_id and a.start_at > now() and coalesce(a.status, '') not in ('cancelled', 'noshow', 'invalid')) upcoming
    from cached_opportunities o
    where o.installation_id = ${ctx.installationId} and o.status = 'open' ${location ? db`and o.location_id = ${location}` : db``} ${allowed ? db`and o.location_id = any(${allowed}::text[])` : db``}
    limit 60000`;
  const contacts = new Map(rows.map((r) => [r.opportunity_id as string, { contactId: (r.contact_id as string | null) ?? null, upcoming: r.upcoming === true }]));
  const now = Date.now();
  const board: Board = boardOf({ deals, now, fallbackStaleDays: staleDays, contacts });
  const closed = deals.filter((d) => d.status === "won" || d.status === "lost").length;
  const f = closed >= MIN_CLOSED_DEALS ? forecast(deals, now, ctx.kind === "client" ? [] : rules) : null;
  const stageControls = ctx.kind === "client" ? null : await h.stageControls(allowed, rules);
  return json({
    headline: board.headline, pipelines: board.pipelines.slice(0, 40), byClient: board.byClient.slice(0, 200), stuckQueue: board.stuckQueue.slice(0, 200),
    forecast: f ? { range: f.range, method: f.method } : null, closed, minClosed: MIN_CLOSED_DEALS,
    trend: !pipeline && trendWorthDrawing(trend.points) ? trend.points.map((p) => ({ day: p.day, openValue: p.openValue })) : null, trendNote: trend.points.length < 14 ? "The line appears after two weeks of history." : null,
    excluded: { count: excluded.count, noOwner: excluded.noOwner, noValue: excluded.noValue, closedOut: excluded.closedOut },
    stageControls, multi: !location,
  });
}
