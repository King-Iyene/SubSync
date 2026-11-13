import { sql } from "../db";
import { can, personFromSession } from "../connections/person";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { logSettingsChange } from "../feedback-queries";
import { blocksFor, setBlock } from "../workflow-module/store";
import { json, type AuthContext } from "./auth";

// Settings, Integrations, "Workflow blocks": /api/app/wfm?locationId=... and POST /api/app/wfm/act/set. Flag wf_module (default off). Which accounts a person may change comes ONLY from the signed
// session: a client's administrator manages their own account; a company administrator any account the session may see. Staff and client users never reach it. Nothing is read from a body but the
// account id (checked against the allowed list), the block key (checked against the fixed list) and the on/off and number choices.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type Deps = { allowed: () => Promise<string[] | null> };

export async function handleWfm(ctx: Ctx, deps: Deps): Promise<Response> {
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  if (ent.features["wf_module" as Feature] !== true) return json({ error: "Workflow blocks are not switched on yet." }, 404);
  const person = personFromSession(ctx.session, ctx.kind, ctx.limitTo);
  if (!person || !can(person.role, "connect_workspace") || person.role === "agency_staff") return json({ canManage: false });
  const allowed = await deps.allowed();
  const accounts = person.kind === "client"
    ? (person.homeLocationId ? [person.homeLocationId] : [])
    : (await sql()`select location_id from locations where installation_id = ${ctx.installationId} and not ignored order by name limit 500`).map((r) => r.location_id as string).filter((id) => allowed === null || allowed.includes(id));
  const names = new Map<string, string>();
  if (accounts.length) for (const r of await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and location_id = any(${accounts}::text[])`) names.set(r.location_id as string, (r.name as string | null) ?? "Account");
  const isAct = ctx.segments[1] === "act";
  if (!isAct) {
    const wanted = ctx.url.searchParams.get("locationId");
    const loc = wanted && accounts.includes(wanted) ? wanted : accounts[0] ?? null; // a location id that is not in the person's own list is ignored, never trusted
    if (!loc) return json({ canManage: true, accounts: [], blocks: [] });
    const b = await blocksFor(ctx.installationId, loc);
    return json({ canManage: true, ready: b.ready, locationId: loc, accounts: accounts.map((id) => ({ id, name: names.get(id) ?? "Account" })), blocks: b.blocks,
      cost: "Each time a workflow runs one of these blocks, your CRM bills that run to the client account (its premium workflow actions and triggers). SubSync does not charge for it.",
      writes: "Actions change your CRM only when an administrator has switched on SubSync's write access for the account; until then they only record what they would have done." });
  }
  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const b = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
  const loc = typeof b.locationId === "string" ? b.locationId : "";
  if (!accounts.includes(loc)) return json({ error: "That account is not available." }, 404);
  const key = typeof b.key === "string" ? b.key : "";
  const r = await setBlock(ctx.installationId, loc, key, { enabled: b.enabled, threshold: b.threshold }, ctx.session.userId ?? null);
  if (!r.ok) return json({ error: r.message ?? "Could not save." }, 400);
  await logSettingsChange(ctx.installationId, ctx.session.userId ?? null, ctx.kind, [`wfm.${key}`]).catch(() => undefined);
  return json({ ok: true, ...(await blocksFor(ctx.installationId, loc)) });
}
