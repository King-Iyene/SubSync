import { outward } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { recordWrite, SPACING_MS, type GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";
import { LIMITS, takeSlot } from "./workbench.ts";
import type { DealPatch } from "../analytics/pipeline-actions.ts";

// The one door for changing deals from SubSync (Pipeline module, slice PB): update (stage, status, value, owner, name) and delete. Notes and tasks on the deal's contact go through
// the existing workbench gateway (runAction), not through here. Same switches as the other gateways: WRITE_GHL_LIVE off unless exactly "true", the account's own opt-in, a preview
// first (the route), a typed confirmation before a delete (the route checks it again), one audit line per write with ids and field names only, calls spaced under the platform's
// limit. Off or not allowed: the request is built, "WOULD WRITE ..." is recorded and NOTHING is sent. Needs the optional permission opportunities.write; without it the answer is
// needs_permission ("Needs permission: reconnect"). Request shapes follow the platform's published API description and are NOT VERIFIED LIVE.

export const DEAL_WRITE_SCOPE = "opportunities.write";
const VERSION = "2021-07-28";

export type DealWriteResult =
  | { outcome: "dry_run"; line: string; reason: "switch" | "account" }
  | { outcome: "done" }
  | { outcome: "needs_permission" }
  | { outcome: "rate_limited"; retryInSeconds: number }
  | { outcome: "failed"; status: number };

type Common = { installationId: string; locationId: string; actor: string | null; contactId: string | null; opportunityId: string; optedIn: boolean; token: () => Promise<string> };
export type DealWrite = (Common & { op: "update"; patch: DealPatch }) | (Common & { op: "delete" });

/** The request body for an update. Pure, so the tests can read it. */
export function updateBody(patch: DealPatch): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (patch.pipelineId) b.pipelineId = patch.pipelineId;
  if (patch.stageId) b.pipelineStageId = patch.stageId;
  if (patch.status) b.status = patch.status;
  if (patch.value !== undefined) b.monetaryValue = patch.value;
  if (patch.assignedTo) b.assignedTo = patch.assignedTo;
  if (patch.name !== undefined) b.name = patch.name;
  return b;
}

export async function writeDeal(a: DealWrite, deps: GatewayDeps = {}): Promise<DealWriteResult> {
  const wait = takeSlot(`acct:${a.installationId}`, LIMITS.perAccountPerMinute, 60_000);
  if (wait) return { outcome: "rate_limited", retryInSeconds: wait };
  const env = a.optedIn ? deps.env : {};
  const fields = a.op === "update" ? Object.keys(updateBody(a.patch)) : ["opportunity"];
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: a.op === "delete" ? "DELETE" : "WRITE", what: a.op === "update" ? "crm.deal.update" : "crm.deal.delete", installationId: a.installationId, ids: { locationId: a.locationId, opportunityId: a.opportunityId, contactId: a.contactId ?? "" }, fields },
    async (): Promise<DealWriteResult> => {
      await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(SPACING_MS);
      const headers = { Authorization: `Bearer ${await a.token()}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" };
      const opts = { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) };
      const url = `${GHL_API}/opportunities/${encodeURIComponent(a.opportunityId)}`;
      const res = a.op === "delete"
        ? await ghlFetch(url, { method: "DELETE", headers, cache: "no-store" }, opts)
        : await ghlFetch(url, { method: "PUT", headers, body: JSON.stringify(updateBody(a.patch)), cache: "no-store" }, opts);
      // A deal already gone (404) is what a delete wanted.
      const result: DealWriteResult = res.status === 401 || res.status === 403 ? { outcome: "needs_permission" } : res.ok || (a.op === "delete" && res.status === 404) ? { outcome: "done" } : { outcome: "failed", status: res.status };
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: a.contactId ?? a.opportunityId, op: `deal.${a.op}`, fields, result: result.outcome }, deps);
      return result;
    },
    { ...deps, ...(env ? { env } : {}) },
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line, reason: a.optedIn ? "switch" : "account" };
}
