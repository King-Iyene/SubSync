import type { Found } from "./client.ts";
import type { Row } from "./provisioner.ts";

// The daily light check, decided without any network or database so every case has a test. Read only: it never recreates, publishes or deletes anything.
export type Verdict = { kind: "ok" } | { kind: "removed"; message: string } | { kind: "unpublished"; message: string };

export function judgeCheck(row: Pick<Row, "workflowId">, list: readonly Found[], name: string): Verdict {
  // The stored id wins (a person may have renamed it); the exact name is only used when we never stored an id.
  const w = (row.workflowId && list.find((x) => x.id === row.workflowId)) || (!row.workflowId ? list.find((x) => x.name === name) : undefined);
  if (!w) return { kind: "removed", message: `The "${name}" workflow is no longer in your CRM. We left everything as it is. Press Set up to create it again.` };
  return /publish|active/i.test(w.status) ? { kind: "ok" } : { kind: "unpublished", message: `Your "${w.name}" workflow is not published, so tagged contacts are not getting a call task. Publish it in your CRM.` };
}
