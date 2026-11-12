import { sql } from "../db";
import { BASIS_HELP, BASIS_TITLE, cleanSaleSettings, isSaleBasis, SALE_BASES } from "../analytics/sale-basis-core";
import { loadSaleSettings, saveSaleSettings } from "../analytics/sale-settings";
import { json, type AuthContext } from "./auth";

// GET and PUT /api/app/appointments/sale-basis: how this company counts a sale. Everyone signed in may read it (so each figure can say how it was counted);
// only the company's own people change it, never a client's staff. A change is written to the audit log. Nothing here touches the CRM.
type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export async function handleSaleBasis(ctx: Ctx): Promise<Response> {
  if (ctx.request.method === "GET") {
    const s = await loadSaleSettings(ctx.installationId);
    const ok = await sql()`select 1 from pm_sync_state where installation_id = ${ctx.installationId} and last_ok_at is not null limit 1`.then((r) => r.length > 0).catch(() => false);
    return json({ ...s, canChange: ctx.kind !== "client", paymentsReadable: ok, options: SALE_BASES.map((id) => ({ id, title: BASIS_TITLE[id], help: BASIS_HELP[id], available: id !== "payment" || ok })) });
  }
  if (ctx.request.method !== "PUT") return json({ error: "Not found" }, 404);
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { basis?: unknown; countWithoutValue?: unknown } | null;
  if (!body || !isSaleBasis(body.basis) || typeof body.countWithoutValue !== "boolean") return json({ error: "Choose how a sale is counted" }, 400);
  if (ctx.demo) return json({ error: "This cannot be changed in the demo" }, 400);
  const next = cleanSaleSettings(body);
  if (!(await saveSaleSettings(ctx.installationId, next))) return json({ error: "This setting is not ready yet. Try again later." }, 503);
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'appointments.sale_basis_changed', ${sql().json(next as never)})`;
  return json({ ok: true, ...next });
}
