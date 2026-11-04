// Workflows module: what every chart and number shows, and the rows behind each mark. Pure. A mark and its records come from the same function, so the
// number on a slice always equals the rows in the panel it opens (tested). The panel is the shared RecordsPanel of Today.
import type { Col, Rec, RecordsSpec } from "../analytics/today-records.ts";
import { entityOf, type WfItem } from "./model.ts";
import type { Finding } from "./health.ts";
import type { LabelRow } from "./store-types.ts";

export type Bucket = "running" | "failing" | "never_run" | "draft" | "stopped";
export const BUCKET_LABEL: Record<Bucket, string> = { running: "Running", failing: "Failing", never_run: "Never ran (30 days)", draft: "Draft", stopped: "Paused or finished" };
export const BUCKET_ORDER: Bucket[] = ["failing", "never_run", "running", "draft", "stopped"];

export type Account = { locationId: string; name: string };
export const failingIds = (f: Finding[]) => new Set(f.filter((x) => (x.kind === "failing" || x.kind === "campaign_failed") && x.workflowId).map((x) => `${x.locationId}|${x.workflowId}`));
const keyOf = (w: Pick<WfItem, "locationId" | "workflowId">) => `${w.locationId}|${w.workflowId}`;

export function bucketOf(w: WfItem, failing: Set<string>): Bucket {
  if (failing.has(keyOf(w))) return "failing";
  if (w.status === "draft") return "draft";
  if (w.status === "published") return w.runs30d === 0 && entityOf(w.workflowId) === "workflow" ? "never_run" : "running";
  return "stopped";
}

export type Slice = { bucket: Bucket; label: string; count: number };
export function statusSlices(items: WfItem[], failing: Set<string>): Slice[] {
  const n = new Map<Bucket, number>();
  for (const w of items) if (!w.removedSeenAt) n.set(bucketOf(w, failing), (n.get(bucketOf(w, failing)) ?? 0) + 1);
  return BUCKET_ORDER.map((b) => ({ bucket: b, label: BUCKET_LABEL[b], count: n.get(b) ?? 0 })).filter((s) => s.count > 0);
}

export type AccountBar = { locationId: string; name: string; total: number; attention: number };
export function accountBars(items: WfItem[], accounts: Account[], failing: Set<string>, limit = 12): AccountBar[] {
  const by = new Map<string, AccountBar>();
  for (const a of accounts) by.set(a.locationId, { locationId: a.locationId, name: a.name, total: 0, attention: 0 });
  for (const w of items) {
    if (w.removedSeenAt) continue;
    const b = by.get(w.locationId);
    if (!b) continue;
    b.total++;
    const k = bucketOf(w, failing);
    if (k === "failing" || k === "never_run") b.attention++;
  }
  return [...by.values()].filter((b) => b.total > 0).sort((x, y) => y.attention - x.attention || y.total - x.total || x.name.localeCompare(y.name)).slice(0, limit);
}

export type Failing = { w: WfItem; share: number };
export function topFailing(items: WfItem[], limit = 8): Failing[] {
  return items.filter((w) => !w.removedSeenAt && (w.failed30d ?? 0) > 0).map((w) => ({ w, share: w.runs30d ? (w.failed30d ?? 0) / w.runs30d : 0 })).sort((a, b) => (b.w.failed30d ?? 0) - (a.w.failed30d ?? 0)).slice(0, limit);
}

export type Decision = "keep" | "review" | "retire" | "unsorted";
export const decisionOf = (l: LabelRow | undefined): Decision => l?.decision ?? "unsorted";
export function decisionSlices(items: WfItem[], labels: Map<string, LabelRow>) {
  const n: Record<Decision, number> = { keep: 0, review: 0, retire: 0, unsorted: 0 };
  for (const w of items) if (!w.removedSeenAt) n[decisionOf(labels.get(keyOf(w)))]++;
  return (["keep", "review", "retire", "unsorted"] as Decision[]).map((d) => ({ decision: d, count: n[d] })).filter((x) => x.count > 0);
}
export function ratingBars(items: WfItem[], labels: Map<string, LabelRow>) {
  const n = [0, 0, 0, 0, 0, 0];
  for (const w of items) if (!w.removedSeenAt) n[labels.get(keyOf(w))?.rating ?? 0]++;
  return [1, 2, 3, 4, 5, 0].map((r) => ({ rating: r, label: r === 0 ? "Not rated" : `${r} star${r === 1 ? "" : "s"}`, count: n[r] }));
}

export type Daily = { day: string; total: number; failing: number; runs: number | null; errors: number | null };
/** One thin series for a trend. A day with no value stays a gap. */
export const dailySeries = (d: Daily[], pick: (x: Daily) => number | null) => d.map((x) => ({ day: x.day, value: pick(x) }));

// ---------------------------------------------------------------- the rows behind a mark

export const COLS: Col[] = [
  { key: "name", header: "Name", type: "text", primary: true, w: 22 },
  { key: "account", header: "Client account", type: "text", facet: true, w: 14 },
  { key: "type", header: "Type", type: "kind", facet: true, w: 9 },
  { key: "state", header: "State", type: "kind", facet: true, w: 12 },
  { key: "updated", header: "Last edited", type: "date", w: 12 },
  { key: "lastRun", header: "Last run", type: "date", w: 12 },
  { key: "runs", header: "Runs (30 days)", type: "number", w: 9 },
  { key: "errors", header: "Errors (30 days)", type: "number", w: 9 },
  { key: "decision", header: "Decision", type: "kind", facet: true, w: 9 },
  { key: "rating", header: "Rating", type: "number", w: 7 },
  { key: "labels", header: "Labels", type: "text", w: 12 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];
export const DECISION_LABEL: Record<Decision, string> = { keep: "Keep", review: "Review", retire: "Retire", unsorted: "Not sorted" };
const TYPE_LABEL = (w: WfItem) => (entityOf(w.workflowId) === "campaign" ? "Campaign" : "Workflow");

export function recOf(w: WfItem, account: string, failing: Set<string>, label: LabelRow | undefined): Rec {
  return {
    id: keyOf(w), url: w.uiUrl, lead: null,
    cells: {
      name: w.name, account, type: TYPE_LABEL(w), state: BUCKET_LABEL[bucketOf(w, failing)], updated: w.updatedAt, lastRun: w.lastRunAt, runs: w.runs30d, errors: w.failed30d,
      decision: DECISION_LABEL[decisionOf(label)], rating: label?.rating ?? null, labels: label?.labels.join(", ") ?? "", crm: w.uiUrl ? "Open" : null,
    },
  };
}

export type SpecIn = { key: string; title: string; subtitle: string; items: WfItem[]; accounts: Account[]; failing: Set<string>; labels: Map<string, LabelRow>; note?: string | null; exportName?: string };
export function itemsSpec(i: SpecIn): RecordsSpec {
  const name = new Map(i.accounts.map((a) => [a.locationId, a.name]));
  const rows = i.items.map((w) => recOf(w, name.get(w.locationId) ?? "Client account", i.failing, i.labels.get(keyOf(w))));
  const known = rows.some((r) => r.cells.runs !== null);
  const cols = COLS.filter((c) => (known || (c.key !== "runs" && c.key !== "errors" && c.key !== "lastRun")) && (c.key !== "crm" || rows.some((r) => r.url)));
  return { key: i.key, title: i.title, subtitle: i.subtitle, noun: "items", count: rows.length, cols, rows, note: i.note ?? null, dateKey: "updated", preset: {}, exportName: i.exportName ?? i.key };
}

/** Which items sit behind each kind of mark. The caller passes the same items it counted. */
export const inBucket = (items: WfItem[], failing: Set<string>, b: Bucket) => items.filter((w) => !w.removedSeenAt && bucketOf(w, failing) === b);
export const inAccount = (items: WfItem[], locationId: string) => items.filter((w) => !w.removedSeenAt && w.locationId === locationId);
export const inDecision = (items: WfItem[], labels: Map<string, LabelRow>, d: Decision) => items.filter((w) => !w.removedSeenAt && decisionOf(labels.get(keyOf(w))) === d);
export const inRating = (items: WfItem[], labels: Map<string, LabelRow>, r: number) => items.filter((w) => !w.removedSeenAt && (labels.get(keyOf(w))?.rating ?? 0) === r);

/** The words of the printable report: no chart is needed to read it. */
export function reportLines(slices: Slice[], findings: Finding[], accounts: number): string[] {
  const total = slices.reduce((s, x) => s + x.count, 0);
  const out = [`${total} workflows and campaigns across ${accounts} client account${accounts === 1 ? "" : "s"}.`, ...slices.map((s) => `${s.label}: ${s.count}`)];
  for (const f of findings.slice(0, 8)) out.push(`${f.severity === "critical" ? "Fix now" : "Check"}: ${f.title}${f.estimate ? " (estimate)" : ""}`);
  return out;
}
