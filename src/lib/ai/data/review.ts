import { FINDINGS, scoreWord, type FindingId } from "../../analytics/quality";
import { runJob, type Deps, type JobResult, type Refusal } from "../gateway";
import type { Tenant } from "../tools";
import { addressOf, citationHolds, datasetFor, windowOf } from "./ask-tools";

// Data review (docs/AI_JOBS_SPEC.md 1): an AI-written audit of a client account's data quality, built ONLY from the numbers our own data-quality functions already produce. The model gets one
// line per problem (its id, the plain label, the count and the address of the exact rows) and writes the findings around them. A finding is kept only when its id, its count and its rows address
// are exactly one of those lines, and the count still equals the rows when the address is opened. The model never sees a contact: aggregates only, so no opt-in is needed.

export type ReviewLine = { id: string; label: string; count: number; address: string };
export type ReviewFacts = { text: string; fields: string[]; lines: ReviewLine[]; score: number | null };
export type ReviewFinding = { id: string; severity: "high" | "medium" | "low"; title: string; explanation: string; count: number; rowsHash: string; evidence: string[] };
export type ReviewResult = { ok: true; runId: string; cached: boolean; summary: string; findings: ReviewFinding[]; scope: "account" | "all"; costUsd: number } | { ok: false; code: Refusal | "unverified"; message: string };

/** The lines the review is built from. Pure given the datasets. */
export function reviewFacts(parts: { quality: Record<string, unknown>; qualityWindow: { from: string; to: string }; noOwner: { count: number; address: string }; unassigned: { count: number; address: string }; dups: { certain: { groups: number; address: string }; likely: { groups: number; address: string }; possible: { groups: number; address: string } } }): ReviewFacts {
  const w = parts.qualityWindow;
  const lines: ReviewLine[] = [];
  const found = (parts.quality.problemsFound ?? {}) as Record<string, number>;
  const byLabel = new Map((Object.keys(FINDINGS) as FindingId[]).map((id) => [FINDINGS[id].label, id]));
  for (const [label, count] of Object.entries(found)) {
    const id = byLabel.get(label);
    if (id && count > 0) lines.push({ id, label, count, address: addressOf("data_quality", { check: id }, w) });
  }
  if (parts.noOwner.count > 0) lines.push({ id: "no_owner", label: "Contacts with no team member assigned", count: parts.noOwner.count, address: parts.noOwner.address });
  if (parts.unassigned.count > 0) lines.push({ id: "unassigned_deals", label: "Open deals with no owner", count: parts.unassigned.count, address: parts.unassigned.address });
  for (const t of ["certain", "likely", "possible"] as const) if (parts.dups[t].groups > 0) lines.push({ id: `duplicates_${t}`, label: `Duplicate groups, ${t} tier (sets of contacts that look like one person)`, count: parts.dups[t].groups, address: parts.dups[t].address });
  const score = typeof parts.quality.averageScore === "number" ? parts.quality.averageScore : null;
  const text = [
    `Data health score: ${score !== null ? `${score} out of 100 (${scoreWord(score)})` : "not enough data yet"}`,
    `Accounts covered: ${String(parts.quality.accounts ?? 1)}`,
    ...(lines.length ? ["Problems found, one per line:"] : ["No problems found."]),
    ...lines.map((l) => `- id: ${l.id}; what: ${l.label}; count: ${l.count}; rowsHash: ${l.address}`),
    "Not available from the platform yet: tags nobody uses any more.",
  ].join("\n");
  return { text, lines, score, fields: ["the data health score", "how many contacts have each problem", "an address for the rows behind each count (no contact names, emails or phones)"] };
}

/** Keeps only findings that are exactly one of the given lines. Pure. */
export function keepReviewFindings(raw: unknown, lines: readonly ReviewLine[]): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  if (!Array.isArray(raw)) return out;
  for (const f of raw as Array<Record<string, unknown>>) {
    const line = lines.find((l) => l.id === f?.id);
    if (!line || f.count !== line.count || f.rowsHash !== line.address || typeof f.title !== "string" || typeof f.explanation !== "string") continue;
    if (out.some((o) => o.id === line.id)) continue;
    out.push({ id: line.id, severity: f.severity === "high" || f.severity === "medium" ? f.severity : "low", title: f.title, explanation: f.explanation, count: line.count, rowsHash: line.address, evidence: [] });
  }
  return out;
}

export async function loadReviewFacts(tenant: Tenant): Promise<ReviewFacts> {
  const [q, no, ua, c, l, p] = await Promise.all([
    datasetFor(tenant, "data_quality", { check: "accounts" }), datasetFor(tenant, "contacts_no_owner"), datasetFor(tenant, "unassigned_deals"),
    datasetFor(tenant, "duplicates_counts", { tier: "certain" }), datasetFor(tenant, "duplicates_counts", { tier: "likely" }), datasetFor(tenant, "duplicates_counts", { tier: "possible" }),
  ]);
  const w = windowOf(tenant);
  const tc = (c?.summary ?? {}) as Record<string, { groups: number }>;
  return reviewFacts({
    quality: q?.summary ?? {}, qualityWindow: w, noOwner: { count: no?.total ?? 0, address: no?.address ?? "" }, unassigned: { count: ua?.total ?? 0, address: ua?.address ?? "" },
    dups: { certain: { groups: tc.certain?.groups ?? 0, address: c?.address ?? "" }, likely: { groups: tc.likely?.groups ?? 0, address: l?.address ?? "" }, possible: { groups: tc.possible?.groups ?? 0, address: p?.address ?? "" } },
  });
}

export async function runDataReview(a: { tenant: Tenant; userKey: string | null; deps: Deps; facts?: ReviewFacts; fresh?: boolean; verify?: (t: Tenant, address: string, count: number) => Promise<boolean> }): Promise<ReviewResult> {
  const facts = a.facts ?? (await loadReviewFacts(a.tenant));
  const r: JobResult = await runJob(a.deps, { installationId: a.tenant.installationId, locationId: a.tenant.locationId ?? "", userKey: a.userKey, job: "data_review", trigger: "view", fresh: a.fresh, input: { text: facts.text, fields: facts.fields, includesNames: false } });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  const j = r.json as { summary?: unknown; findings?: unknown } | null;
  if (!j || typeof j.summary !== "string") return { ok: false, code: "unverified", message: "The review was not in a form we could check, so it was not shown." };
  const verify = a.verify ?? citationHolds;
  const kept: ReviewFinding[] = [];
  for (const f of keepReviewFindings(j.findings, facts.lines)) if (await verify(a.tenant, f.rowsHash, f.count).catch(() => false)) kept.push(f);
  return { ok: true, runId: r.runId, cached: r.cached, summary: j.summary, findings: kept, scope: a.tenant.locationId ? "account" : "all", costUsd: r.costUsd };
}
