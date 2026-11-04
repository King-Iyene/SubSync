import { sql } from "../db";

// Made-up workflows and campaigns for the demo company, so the Workflows page has something real to show without a CRM. Written once (when the demo has none).
const DAY = 86_400_000;
const NAMES: Array<[string, "published" | "draft" | "paused" | "failed" | "done", { runs: number | null; failed: number | null; edited: number; kind?: string }]> = [
  ["Missed Call Text Back", "published", { runs: 140, failed: 2, edited: 12 }],
  ["New Lead Follow Up", "published", { runs: 320, failed: 4, edited: 6 }],
  ["Appointment Reminder 24h", "published", { runs: 210, failed: 90, edited: 3 }],
  ["No Show Recovery", "published", { runs: 0, failed: 0, edited: 40 }],
  ["Review Request", "published", { runs: 55, failed: 0, edited: 20 }],
  ["Old Webinar Funnel", "draft", { runs: null, failed: null, edited: 75 }],
  ["Birthday Offer (copy)", "draft", { runs: null, failed: null, edited: 4 }],
  ["Cold Lead Reactivation", "published", { runs: 18, failed: 11, edited: 9 }],
  ["New lead follow-up", "published", { runs: 12, failed: 0, edited: 15 }],
  ["REVIEW REQUEST REMINDER", "published", { runs: 8, failed: 0, edited: 22 }],
  ["Black Friday Blast", "done", { runs: null, failed: null, edited: 30, kind: "campaign:email" }],
  ["Spring Promo", "published", { runs: null, failed: null, edited: 25, kind: "campaign:bulk" }],
  ["Welcome Sequence", "failed", { runs: null, failed: null, edited: 2, kind: "campaign:workflow" }],
  ["Holiday Draft", "draft", { runs: null, failed: null, edited: 50, kind: "campaign:email" }],
];

export async function ensureWorkflowsDemo(installationId: string): Promise<void> {
  const db = sql();
  const [have] = await db`select 1 as x from workflow_items where installation_id = ${installationId} limit 1`;
  if (have) return;
  const locs = await db`select location_id, name from locations where installation_id = ${installationId} and not ignored order by name limit 20`;
  if (locs.length === 0) return;
  const now = Date.now();
  let n = 0;
  for (const [i, l] of locs.entries()) {
    // Every account gets a different slice, so the bars and the coverage check differ.
    const pick = NAMES.filter((_, k) => (k + i) % 3 !== 2 || k < 2);
    for (const [name, status, o] of pick) {
      n++;
      const campaign = o.kind?.startsWith("campaign");
      const id = `${campaign ? "campaign:" : "wf-"}demo${i}x${n}`;
      const st = status === "done" ? "done" : status;
      await db`insert into workflow_items (installation_id, location_id, workflow_id, name, status, kind, ui_url, remote_created_at, remote_updated_at, runs_30d, enrolled_30d, failed_30d, last_run_at)
        values (${installationId}, ${l.location_id as string}, ${id}, ${name}, ${st}, ${o.kind ?? null}, ${"#crm-demo"}, ${new Date(now - 120 * DAY)}, ${new Date(now - o.edited * DAY)}, ${o.runs}, ${o.runs === null ? null : Math.round(o.runs / 2)}, ${o.failed},
          ${o.runs ? new Date(now - DAY) : null}) on conflict do nothing`;
      if (campaign && status !== "draft") {
        // Made-up delivery totals: one account is healthy, one bounces a lot, one has messages stuck waiting.
        const sent = 400 + n * 37, bad = i % 3 === 1 ? 0.28 : 0.02, delivered = Math.round(sent * (1 - bad - 0.01)), queued = i % 3 === 2 ? 60 : 0;
        const day = new Date(now).toISOString().slice(0, 10);
        await db`insert into campaign_stats (installation_id, location_id, campaign_id, day, sent, delivered, opened, clicked, bounced, failed, unsubscribed, queued)
          values (${installationId}, ${l.location_id as string}, ${id}, ${day}, ${sent}, ${delivered}, ${Math.round(delivered * 0.38)}, ${Math.round(delivered * 0.06)}, ${Math.round(sent * bad)}, ${Math.round(sent * 0.01)}, ${Math.round(delivered * 0.004)}, ${queued}) on conflict do nothing`;
      }
      if (n % 4 === 0) await db`insert into workflow_labels (installation_id, location_id, workflow_id, labels, decision, rating, owner, updated_by) values (${installationId}, ${l.location_id as string}, ${id}, ${["lead handling"]}::text[], ${n % 8 === 0 ? "review" : "keep"}, ${(n % 5) + 1}, 'Dana Brooks', 'Dana Brooks') on conflict do nothing`;
    }
    for (let d = 14; d >= 0; d--) {
      await db`insert into workflow_daily (installation_id, location_id, day, total, failing, runs_30d, errors_30d) values (${installationId}, ${l.location_id as string}, ${new Date(now - d * DAY).toISOString().slice(0, 10)}, ${8}, ${d > 8 ? 1 : d > 3 ? 2 : i % 2 ? 1 : 2}, ${700 + d * 9 + i * 20}, ${60 + (d % 5) * 4})
        on conflict do nothing`;
    }
  }
  const [first] = locs;
  // One workflow somebody turned off in the CRM three days ago, so the "turned off" check has something to show.
  await db`update workflow_items set status = 'draft' where installation_id = ${installationId} and location_id = ${first.location_id as string} and workflow_id = 'wf-demo0x4'`;
  await db`insert into workflow_changes (installation_id, location_id, workflow_id, kind, source, before, after, created_at) values
    (${installationId}, ${first.location_id as string}, 'wf-demo0x4', 'status', 'observed', ${db.json({ status: "published" } as never)}, ${db.json({ status: "draft" } as never)}, ${new Date(now - 3 * DAY)})`;
  await db`insert into workflow_changes (installation_id, location_id, workflow_id, kind, source, before, after, created_at) values
    (${installationId}, ${first.location_id as string}, ${"wf-demo0x2"}, 'renamed', 'observed', ${db.json({ name: "New lead follow-up" } as never)}, ${db.json({ name: "New Lead Follow Up" } as never)}, ${new Date(now - 2 * DAY)}),
    (${installationId}, ${first.location_id as string}, ${"wf-demo0x3"}, 'status', 'observed', ${db.json({ status: "published" } as never)}, ${db.json({ status: "draft" } as never)}, ${new Date(now - 5 * DAY)})`;
}
