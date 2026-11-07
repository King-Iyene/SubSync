// CRM call queue: carries out a plan one write at a time through an injected writer (the real one is the one write gateway; tests pass a stub, so no test can ever reach a real CRM).
// Spaced to stay under 30 writes a minute per company. Stops at the first refusal for permission. Off (dry run): nothing is recorded as queued, so a later live run still adds the lead.
import { buildEnrol, buildTags, type CrmRequest, type WriteResult } from "../ghl/crm-writes.ts";
import type { Plan } from "./callqueue.ts";

export type Route = { route: "tag"; tag: string } | { route: "workflow"; workflowId: string };
export type Writer = (request: CrmRequest, contactId: string, op: string) => Promise<WriteResult>;
export type Recorder = (a: { contactId: string; action: "add" | "remove" | "enrol"; status: "saved" | "dry_run" | "failed" }) => Promise<void>;
export type Done = { added: number; removed: number; wouldAdd: number; wouldRemove: number; failed: number; needsPermission: boolean; stoppedEarly: boolean };

export const SPACING_MS = 2_100; // 28 a minute

export async function execute(plan: Plan, r: Route, write: Writer, record: Recorder, o: { sleep?: (ms: number) => Promise<void>; spacingMs?: number } = {}): Promise<Done> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const gap = o.spacingMs ?? SPACING_MS;
  const d: Done = { added: 0, removed: 0, wouldAdd: 0, wouldRemove: 0, failed: 0, needsPermission: false, stoppedEarly: false };
  let live = 0;
  const jobs: Array<{ contactId: string; remove: boolean }> = [
    ...plan.remove.map((k) => ({ contactId: k.slice(k.indexOf(":") + 1), remove: true })),
    ...plan.add.map((c) => ({ contactId: c.contactId, remove: false })),
  ];
  for (const j of jobs) {
    if (j.remove && r.route === "workflow") continue; // a workflow enrolment has nothing to take off
    const req = r.route === "tag" ? buildTags({ contactId: j.contactId, tags: [r.tag], remove: j.remove }) : buildEnrol({ contactId: j.contactId, workflowId: r.workflowId });
    if (live > 0) await sleep(gap);
    const res = await write(req, j.contactId, j.remove ? "callqueue.tag.remove" : r.route === "tag" ? "callqueue.tag.add" : "callqueue.enrol");
    const action = j.remove ? "remove" : r.route === "tag" ? "add" : "enrol";
    if (res.outcome === "dry_run") { if (j.remove) d.wouldRemove++; else d.wouldAdd++; await record({ contactId: j.contactId, action, status: "dry_run" }); continue; }
    live++;
    if (res.outcome === "needs_permission") { d.needsPermission = true; d.stoppedEarly = true; break; }
    if (res.outcome === "failed") { d.failed++; await record({ contactId: j.contactId, action, status: "failed" }); if (res.status === 429) { d.stoppedEarly = true; break; } continue; }
    if (j.remove) d.removed++; else d.added++;
    await record({ contactId: j.contactId, action, status: "saved" });
  }
  return d;
}
