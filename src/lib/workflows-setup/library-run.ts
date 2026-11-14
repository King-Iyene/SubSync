import { sql } from "../db";
import { isLive } from "../live-flags";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { locationAccessToken } from "../sync/engine";
import { httpClient } from "./client";
import { preview, type PlanInput, type Preview } from "./library";
import { getSetupSettings, grantedFor, storeFor } from "./run";
import { provision, type Result } from "./provisioner";
import type { Template } from "./templates";
import { getQueueTags } from "../call-queue-tags/store";
import type { QueueKey } from "../call-queue-tags/tags";

// The tag each library workflow listens for is the account's own choice (Settings, Call queues), else the template default.
const TEMPLATE_QUEUE: Record<string, QueueKey> = { call_queue: "call_now", speed_breach_task: "first_reply", noshow_task: "no_show" };
async function libraryTag(installationId: string, locationId: string, t: Template): Promise<string> {
  const k = TEMPLATE_QUEUE[t.key];
  return k ? (await getQueueTags(installationId, locationId))[k] : t.defaultTag;
}

// Server glue for the library: reads our own tables for the plan, and installs one account at a time through the provisioner (which is the only thing that writes, and always
// through the write gateway). Every account id given here has already passed ownedLocation in the route.
const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export async function planFor(inst: string, t: Template, accounts: Array<{ locationId: string; name: string }>, granted: string[] | null): Promise<Preview> {
  const ids = accounts.map((a) => a.locationId);
  const setup = await sql()`select location_id, status, workflow_id from workflow_setup where installation_id = ${inst} and template_key = ${t.key} and location_id = any(${ids}::text[])`.catch((e) => { if (missing(e)) return []; throw e; });
  const byLoc = new Map(setup.map((r) => [r.location_id as string, { status: r.status as string, workflowId: (r.workflow_id as string | null) ?? null }]));
  const seen = await sql()`select location_id from workflow_items where installation_id = ${inst} and location_id = any(${ids}::text[]) and name = ${t.name} and status = 'published' and removed_seen_at is null`.catch((e) => { if (missing(e)) return []; throw e; });
  const named = new Set(seen.map((r) => r.location_id as string));
  const can = granted === null ? null : granted.includes("workflows.readonly") && granted.includes("workflows.write");
  const inputs: PlanInput[] = [];
  for (const a of accounts) inputs.push({ locationId: a.locationId, name: a.name, existing: byLoc.get(a.locationId) ?? null, sameNameSeen: named.has(a.locationId), canWrite: can, optedIn: await writeEnabledFor(inst, a.locationId) });
  return preview(t, inputs, isLive("WRITE_GHL_LIVE"));
}

export async function installOne(t: Template, a: { installationId: string; companyId: string; locationId: string }): Promise<Result> {
  const st = await getSetupSettings(a.installationId, a.locationId);
  if (!st.ready) return { state: "unavailable", code: "failed", message: "Setup needs the latest database update, which has not run yet.", lines: [] };
  const token = await locationAccessToken(a.companyId, a.locationId);
  const optedIn = await writeEnabledFor(a.installationId, a.locationId);
  return provision(t, {
    client: httpClient(token, a.locationId), store: storeFor(a.installationId, a.locationId), installationId: a.installationId, locationId: a.locationId, optedIn, manual: true, granted: await grantedFor(a.installationId), autoPublish: st.s.autoPublish,
    settings: { folderName: st.s.folderName, tag: await libraryTag(a.installationId, a.locationId, t), assign: st.s.assignMode === "user" && st.s.assignUserId ? { mode: "user", userId: st.s.assignUserId } : { mode: "round_robin" } },
  });
}
