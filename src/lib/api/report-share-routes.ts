import { choiceDays, freezeReport, isReportKind, validReportId, REPORT_SHARE_CHOICES, REPORT_SHARE_DEFAULT_DAYS } from "../report-share";
import { createSharedReport, listSharedReports, revokeSharedReport } from "../report-share-queries";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";

// GET /api/app/report-share (this company's links), POST /api/app/report-share (freeze what the screen shows and make a link), POST /api/app/report-share/revoke.
// Only an agency owner or administrator, or the administrator of a business account, may share: everyone else gets 403. The company is the signed session's, never the request's. The
// link only ever holds what the screen sent, cut to fixed sizes and with names replaced unless the person chose to include them; it holds no contact, message or other client account.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
const origin = (ctx: Ctx) => (process.env.NEXT_PUBLIC_APP_URL ?? ctx.url.origin).replace(/\/+$/, "");
const actorOf = (ctx: Ctx) => ctx.session.userId ?? ctx.kind;

export async function handleReportShare(ctx: Ctx): Promise<Response> {
  if (ctx.kind === "client" || viewerOf(ctx).level === "self") return json({ error: "Only an owner or an administrator can share a report." }, 403);
  const method = ctx.request.method, op = ctx.segments[1];
  if (method === "GET" && !op) {
    const kind = ctx.url.searchParams.get("kind");
    const rows = ctx.demo ? [] : await listSharedReports(ctx.installationId, kind && isReportKind(kind) ? kind : null);
    return json({ links: rows.map((r) => ({ ...r, url: `${origin(ctx)}/r/${r.id}` })), choices: REPORT_SHARE_CHOICES, defaultDays: REPORT_SHARE_DEFAULT_DAYS });
  }
  if (ctx.demo) return json({ error: "Sharing is not available in the demo." }, 400);
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (method === "POST" && !op) {
    if (!isReportKind(body?.kind)) return json({ error: "Unknown report." }, 400);
    const frozen = freezeReport(body?.doc, body.kind, body?.includeNames === true, new Date());
    if (!frozen.ok) return json({ error: frozen.error }, 400);
    const made = await createSharedReport({ installationId: ctx.installationId, actor: actorOf(ctx), kind: body.kind, report: frozen.report, days: choiceDays(body?.days) });
    return json({ id: made.id, url: `${origin(ctx)}/r/${made.id}`, expiresAt: made.expiresAt.toISOString(), namesIncluded: frozen.report.namesIncluded });
  }
  if (method === "POST" && op === "revoke") {
    if (!validReportId(body?.id)) return json({ error: "Unknown link" }, 400);
    if (!(await revokeSharedReport(ctx.installationId, String(actorOf(ctx)), body.id))) return json({ error: "That link was not found or is already switched off" }, 404);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
