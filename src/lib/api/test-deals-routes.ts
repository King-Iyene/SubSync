import { sql } from "../db";
import { loadCountTestDeals, saveCountTestDeals } from "../analytics/test-deals-setting";
import { plCache } from "../analytics/pipeline3-queries";
import { forgetFresh } from "../analytics/pipeline3-rollup";
import { json, type AuthContext } from "./auth";

// GET and PUT /api/app/deal-rules/test-names: "Count deals that look like tests". Everyone signed in may read it (so a figure can say whether test-named deals are in it);
// only the company's own people change it, never a client's staff. A change is written to the audit log. Nothing here touches the CRM.
type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export async function handleTestDeals(ctx: Ctx): Promise<Response> {
  if (ctx.request.method === "GET") return json({ countTestDeals: await loadCountTestDeals(ctx.installationId), canChange: ctx.kind !== "client" });
  if (ctx.request.method !== "PUT") return json({ error: "Not found" }, 404);
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { countTestDeals?: unknown } | null;
  if (!body || typeof body.countTestDeals !== "boolean") return json({ error: "Choose on or off" }, 400);
  if (ctx.demo) return json({ error: "This cannot be changed in the demo" }, 400);
  if (!(await saveCountTestDeals(ctx.installationId, body.countTestDeals))) return json({ error: "This setting is not ready yet. Try again later." }, 503);
  plCache.clear(`["${ctx.installationId}"`); forgetFresh();
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'deal_rules.count_test_deals_changed', ${sql().json({ countTestDeals: body.countTestDeals } as never)})`;
  return json({ ok: true, countTestDeals: body.countTestDeals });
}
