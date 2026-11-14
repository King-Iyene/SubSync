import { sql } from "../db";
import { ghlFetch } from "../ghl/http";
import { GHL_API } from "../ghl/client";
import { locationAccessToken } from "../sync/engine";
import { listWorkflows } from "../workflows/ghl";
import { readAllPages } from "../people/tag-list";
import { grantedFor } from "../workflows-setup/run";
import { judgeSetup, type CheckResult } from "./check";
import { getQueueTags, saveCheck } from "./store";

// "Check that it worked", live. Read only, with scopes SubSync already holds (tag names, workflow list). Every account id here has passed ownedLocation in the route.
// A refusal from the CRM is reported as "Needs permission: reconnect", never as a missing item, and the answer is cached (call_queue_checks) so Getting started never calls the CRM.
export async function runCheck(installationId: string, locationId: string): Promise<CheckResult> {
  const [inst] = await sql()`select company_id from installations where id = ${installationId}`;
  const tags = await getQueueTags(installationId, locationId);
  const granted = await grantedFor(installationId);
  const can = (s: string) => granted === null || granted.includes(s);
  let tagsReadable = can("locations/tags.readonly"), workflowsReadable = can("workflows.readonly");
  let tagNames: string[] = [], workflowNames: string[] = [];
  if (inst && (tagsReadable || workflowsReadable)) {
    let token: string | null = null;
    try { token = await locationAccessToken(inst.company_id as string, locationId); } catch { token = null; }
    if (!token) return { state: "unchecked", lines: [], summary: "SubSync could not reach this account just now. Try again in a minute." };
    if (tagsReadable) {
      try {
        tagNames = await readAllPages(async (skip) => {
          const res = await ghlFetch(`${GHL_API}/locations/${encodeURIComponent(locationId)}/tags?limit=100&skip=${skip}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
          if (res.status === 401 || res.status === 403) throw Object.assign(new Error("denied"), { denied: true });
          if (!res.ok) throw new Error(`tags ${res.status}`);
          const j = (await res.json().catch(() => ({}))) as { tags?: Array<{ name?: unknown }> };
          return (j.tags ?? []).map((t) => (typeof t.name === "string" ? t.name : "")).filter(Boolean);
        });
      } catch (e) {
        if ((e as { denied?: boolean }).denied) tagsReadable = false;
        else return { state: "unchecked", lines: [], summary: "SubSync could not read your tags just now. Try again in a minute." };
      }
    }
    if (workflowsReadable) {
      const r = await listWorkflows({ token, locationId });
      if (r.ok) workflowNames = r.value.map((w) => (typeof w.name === "string" ? w.name : "")).filter(Boolean);
      else if (r.reason === "needs_permission") workflowsReadable = false;
      else return { state: "unchecked", lines: [], summary: "SubSync could not read your workflows just now. Try again in a minute." };
    }
  }
  const result = judgeSetup(tags, { tagsReadable, workflowsReadable, tagNames, workflowNames });
  await saveCheck(installationId, locationId, result);
  return result;
}
