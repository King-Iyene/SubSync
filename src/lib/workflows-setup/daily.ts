import { sql } from "../db";
import { locationAccessToken } from "../sync/engine";
import { judgeCheck } from "./check";
import { httpClient } from "./client";
import { missingSetupScopes } from "./provisioner";
import { grantedFor, storeFor } from "./run";
import { CALL_QUEUE } from "./templates";

// The daily light check of the call queue workflow (docs/features/WORKFLOW_SETUP.md). Runs from the hourly workflows cron, a few accounts per run, each at most once a day.
// Read only against the CRM: it never recreates, publishes or deletes. A removed or unpublished workflow raises ONE quiet in-app alert (no email, no Slack), cleared when it is back.
// The alert key starts with "cqwf:" on purpose: the Workflows module resolves only keys that start with "wf:".
export const PER_RUN = 10;
const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export async function runCallQueueDailyCheck(limit = PER_RUN): Promise<{ checked: number; raised: number }> {
  const out = { checked: 0, raised: 0 };
  let rows;
  try {
    rows = await sql()`select w.installation_id, w.location_id, w.workflow_id, i.company_id
      from workflow_setup w join installations i on i.id = w.installation_id
      where w.template_key = ${CALL_QUEUE.key} and w.status in ('active', 'created_draft') and w.workflow_id is not null
        and i.uninstalled_at is null and not i.is_demo and (w.checked_at is null or w.checked_at < now() - interval '20 hours')
      order by w.checked_at nulls first limit ${limit}`;
  } catch (e) { if (missing(e)) return out; throw e; }
  for (const r of rows) {
    const inst = r.installation_id as string, loc = r.location_id as string;
    try {
      const mark = () => sql()`update workflow_setup set checked_at = now() where installation_id = ${inst} and location_id = ${loc} and template_key = ${CALL_QUEUE.key}`;
      if (missingSetupScopes(await grantedFor(inst))) { await mark(); continue; }
      const client = httpClient(await locationAccessToken(r.company_id as string, loc), loc);
      const list = await client.list();
      await mark();
      if (!list.ok) continue; // cannot read: say nothing rather than guess
      out.checked++;
      const key = `cqwf:${loc}`;
      const v = judgeCheck({ workflowId: r.workflow_id as string }, list.value, CALL_QUEUE.name);
      if (v.kind === "ok") { await sql()`update alerts set resolved_at = now() where installation_id = ${inst} and dedupe_key = ${key} and resolved_at is null`; continue; }
      if (v.kind === "removed") await storeFor(inst, loc).get(CALL_QUEUE.key).then((row) => row && storeFor(inst, loc).save({ ...row, status: "inactive", lastError: "missing" }));
      const [ins] = await sql()`insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key)
        values (${inst}, ${loc}, 'workflow_setup', 'info', ${v.kind === "removed" ? "Call queue workflow was removed" : "Call queue workflow is not published"}, ${sql().json({ message: v.message } as never)}, ${key})
        on conflict (installation_id, dedupe_key) where resolved_at is null do update set detail = excluded.detail returning (xmax = 0) as inserted`;
      if (ins?.inserted) out.raised++;
    } catch (e) { console.error("call queue daily check failed", e instanceof Error ? e.message : "error"); }
  }
  return out;
}
