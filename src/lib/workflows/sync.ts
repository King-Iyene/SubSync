import { sql } from "../db";
import type { AlertRow } from "../analytics/queries";
import { alertDrafts, coverageFindings, findingsFor, type Finding } from "./health";
import { campaignStats, listCampaigns, listWorkflows, workflowLastRun, workflowStats, type Call } from "./ghl";
import { mergeStats, type WfItem } from "./model";
import { accountNames, isMissing, loadItems, saveCampaignStats, saveSync } from "./store";

// Reads each client account's workflows and campaigns, keeps SubSync's copy up to date, notices changes made in the CRM, and keeps the alerts for this
// module in step. Read only. A permission that was not granted is reported per account, never guessed around.

export type AccountSync = { locationId: string; workflows: "ok" | "needs_permission" | "failed" | "skipped"; campaigns: "ok" | "needs_permission" | "failed" | "skipped"; count: number; changes: number };
const has = (granted: string[] | null, s: string) => granted === null || granted.includes(s);
export const STATS_CAP = 40;

export async function syncAccount(a: { installationId: string; locationId: string; granted: string[] | null; now: number; token: () => Promise<string>; fetchImpl?: typeof fetch }): Promise<AccountSync> {
  const out: AccountSync = { locationId: a.locationId, workflows: "skipped", campaigns: "skipped", count: 0, changes: 0 };
  let token: string;
  try { token = await a.token(); } catch { return { ...out, workflows: "failed", campaigns: "failed" }; }
  const call: Call = { token, fetchImpl: a.fetchImpl };

  if (has(a.granted, "workflows.readonly")) {
    const list = await listWorkflows({ ...call, locationId: a.locationId });
    if (!list.ok) out.workflows = list.reason === "needs_permission" ? "needs_permission" : "failed";
    else {
      const logs = has(a.granted, "workflows.logs");
      const ordered = [...list.value].sort((x, y) => Number(y.status === "published") - Number(x.status === "published"));
      const items: WfItem[] = [];
      let used = 0;
      for (const w of ordered) {
        if (logs && w.status === "published" && used < STATS_CAP) {
          used++;
          const s = await workflowStats(call, w.workflowId, a.now);
          const stats = s.ok ? s.value : null;
          const last = stats && stats.runs > 0 ? await workflowLastRun(call, w.workflowId) : null;
          items.push(mergeStats(w, stats, last));
        } else items.push(mergeStats(w, null, null));
      }
      out.changes += await saveSync(a.installationId, a.locationId, items, { complete: list.value.length < 500, prefix: "workflow" });
      out.workflows = "ok";
      out.count += items.length;
    }
  } else out.workflows = "needs_permission";

  if (has(a.granted, "campaigns.readonly") || has(a.granted, "emails/campaigns.readonly")) {
    const c = await listCampaigns({ ...call, locationId: a.locationId });
    if (c.items.length === 0 && (c.refused || c.failed)) out.campaigns = c.refused ? "needs_permission" : "failed";
    else {
      out.changes += await saveSync(a.installationId, a.locationId, c.items.map((w) => mergeStats(w, null, null)), { complete: !c.failed && !c.refused, prefix: "campaign" });
      if (has(a.granted, "emails/stats.readonly")) {
        const day = new Date(a.now).toISOString().slice(0, 10);
        for (const w of c.items.filter((x) => x.status !== "draft").slice(0, STATS_CAP)) {
          const r = await campaignStats({ ...call, locationId: a.locationId }, w.kind, w.workflowId.replace(/^campaign:/, ""));
          if (r && r.ok && r.value) await saveCampaignStats(a.installationId, a.locationId, w.workflowId, r.value, day);
        }
      }
      out.campaigns = "ok";
      out.count += c.items.length;
    }
  } else out.campaigns = "needs_permission";
  return out;
}

/** Findings for a set of accounts from SubSync's saved copy (the same function the screen uses, so an alert and the page can never disagree). */
export async function currentFindings(installationId: string, allowed: string[] | null, now: number): Promise<{ findings: Finding[]; logsKnown: boolean; known: Set<string> }> {
  const [{ items }, accounts] = await Promise.all([loadItems(installationId, allowed), accountNames(installationId, allowed)]);
  const logsKnown = items.some((w) => w.runs30d !== null);
  const known = new Set(items.map((w) => w.locationId));
  const live = accounts.filter((x) => !x.ignored);
  return { findings: [...findingsFor(items, { now, logsKnown }), ...coverageFindings(live, items, known)], logsKnown, known };
}

/** Raises this module's alerts and clears the ones whose condition went away. Only keys that start with wf: are touched, so no other alert is ever resolved. */
export async function raiseAlerts(installationId: string, findings: Finding[]): Promise<AlertRow[]> {
  const drafts = alertDrafts(findings);
  try {
    return await sql().begin(async (tx) => {
      const created: AlertRow[] = [];
      for (const d of drafts) {
        const [r] = await tx`
          insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key) values (${installationId}, ${d.locationId}, ${d.kind}, ${d.severity}, ${d.title}, ${tx.json(d.detail as never)}, ${d.dedupeKey})
          on conflict (installation_id, dedupe_key) where resolved_at is null do update set severity = excluded.severity, title = excluded.title, detail = excluded.detail
          returning id, (xmax = 0) as inserted`;
        if (r?.inserted) created.push({ id: r.id as string, locationId: d.locationId, kind: d.kind, severity: d.severity, title: d.title, detail: d.detail, createdAt: new Date().toISOString(), resolvedAt: null });
      }
      const keys = drafts.map((d) => d.dedupeKey);
      await tx`update alerts set resolved_at = now() where installation_id = ${installationId} and resolved_at is null and dedupe_key like 'wf:%' and not (dedupe_key = any(${keys}::text[]))`;
      return created;
    });
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}
