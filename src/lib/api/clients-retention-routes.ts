import { sql } from "../db";
import { receiptFacts, setupFacts, historyRows, quietedMap, recordRisk } from "../analytics/clients-actions-queries";
import { setupItems } from "../analytics/clients-actions";
import { agencyHealth, quieted, riskOf, riskRank, RISK_FORMULA, HEALTH_FORMULA, MIN_HISTORY_DAYS } from "../analytics/clients-retention";
import { STANDARD, coverageFor } from "../workflows/health";
import { currentFindings } from "../workflows/sync";
import { accountNames, loadItems } from "../workflows/store";
import { json, type AuthContext } from "./auth";
import type { ClientActionHelpers } from "./clients-actions-routes";

// Slice CB, second half: the churn-risk estimate, the agency health score, the per-client workflow coverage and the new-clients checklist strip. Reads only. The accounts are the ones the
// route already narrowed through the shared guard (`ids`); every query filters by the installation too. Installing a workflow into a client is NOT done here: the screen calls the existing
// Workflows preview and confirm routes (kind "clone"), which already carry the preview, the 15 minute token, the caps, the dry run and the permission checks.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export async function retentionView(ctx: Ctx, h: ClientActionHelpers, ids: string[], withHealth: boolean, now: number): Promise<Response> {
  if (ctx.demo) return json({ risks: [], health: null, formula: RISK_FORMULA, minHistoryDays: MIN_HISTORY_DAYS });
  const names = await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored and location_id = any(${ids}::text[])`;
  const nameOf = new Map(names.map((r) => [r.location_id as string, (r.name as string | null) ?? "Unnamed account"]));
  const [hist, quiet] = await Promise.all([historyRows(ctx.installationId, ids), quietedMap(ctx.installationId, ids, now)]);
  const risks = ids.filter((id) => nameOf.has(id)).map((id) => riskOf(id, nameOf.get(id) as string, hist.get(id) ?? [])).sort(riskRank);
  await recordRisk(ctx.installationId, risks);
  const list = risks.map((r) => ({ ...r, quieted: quieted(quiet, r.locationId, "all") }));
  const base = { risks: list, formula: RISK_FORMULA, minHistoryDays: MIN_HISTORY_DAYS, estimate: true, enough: risks.filter((r) => r.level !== "not_enough_data").length, total: risks.length };
  if (!withHealth) return json(base);
  const [facts, setup] = await Promise.all([receiptFacts(ctx.installationId, ids, await h.defaultTarget(), now), setupFacts(ctx.installationId, ids)]);
  const health = agencyHealth(facts, setup.map((s) => ({ items: setupItems(s, now) })), risks);
  return json({ ...base, health, healthFormula: HEALTH_FORMULA });
}

export async function workflowsView(ctx: Ctx, h: ClientActionHelpers, ids: string[], now: number): Promise<Response> {
  const granted = await h.granted();
  const has = (...s: string[]) => granted === null || s.every((x) => granted.includes(x));
  const dryRun = process.env.WORKFLOWS_WRITE_LIVE !== "true" && !ctx.demo;
  const perm = {
    canRead: has("workflows.readonly"), canInstall: has("workflows.readonly", "workflows.write"), dryRun,
    readText: has("workflows.readonly") ? null : "Needs permission: reconnect to let SubSync read your workflows.",
    installText: has("workflows.readonly", "workflows.write") ? null : "Needs permission: reconnect to let SubSync copy a workflow into a client.",
  };
  const standard = STANDARD.map((s) => ({ id: s.id, label: s.label }));
  if (!perm.canRead) return json({ permission: perm, standard, clients: [], reason: perm.readText });
  const allowed = await h.allowed();
  // Sources may come from any account this session may read; the clients listed are only `ids`.
  const [mine, pool, accts, found] = await Promise.all([loadItems(ctx.installationId, ids), loadItems(ctx.installationId, allowed), accountNames(ctx.installationId, allowed), currentFindings(ctx.installationId, ids, now)]);
  const nameOf = new Map(accts.map((a) => [a.locationId, a.name]));
  const clients = ids.filter((id) => nameOf.has(id)).map((id) => {
    const known = found.known.has(id);
    const c = coverageFor(id, mine.items);
    const issues = found.findings.filter((f) => f.locationId === id && f.kind !== "coverage").length;
    const missing = c.missing.map((m) => {
      const re = STANDARD.find((s) => s.id === m)?.re as RegExp;
      const src = pool.items.find((w) => w.locationId !== id && w.status === "published" && !w.removedSeenAt && re.test(w.name));
      return { id: m, label: STANDARD.find((s) => s.id === m)?.label ?? m, source: src ? { locationId: src.locationId, workflowId: src.workflowId, name: src.name, from: nameOf.get(src.locationId) ?? "Another client" } : null };
    });
    return { locationId: id, name: nameOf.get(id) as string, known, have: c.have, missing: known ? missing : [], issues, status: !known ? "not_read" : missing.length === 0 && issues === 0 ? "healthy" : "attention" };
  });
  return json({ permission: perm, standard, clients, estimate: "Found by workflow names only, so this is an estimate. A workflow with an unusual name will not be recognised.", install: { preview: "workflows/preview", confirm: "workflows/confirm", kind: "clone" } });
}

export async function newClientsView(ctx: Ctx, h: ClientActionHelpers, ids: string[]): Promise<Response> {
  if (ctx.demo) return json({ clients: [], windowDays: 45 });
  const res = await h.onboarding();
  const data = (await res.json().catch(() => null)) as { clients?: Array<Record<string, unknown>> } | null;
  const mine = new Set(ids);
  // The Onboarding tab's own list, narrowed again to the accounts this session may read; new means added in the last 45 days.
  const clients = (data?.clients ?? []).filter((c) => mine.has(String(c.locationId)) && typeof c.daysIn === "number" && (c.daysIn as number) <= 45).map((c) => ({
    locationId: c.locationId, name: c.name, daysIn: c.daysIn, completionPct: c.completionPct, stuck: c.stuck === true,
    next: Array.isArray(c.items) ? (c.items as Array<{ status?: string; label?: string }>).filter((i) => i.status === "todo").slice(0, 3).map((i) => i.label) : [],
  }));
  return json({ clients, windowDays: 45 });
}
