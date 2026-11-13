import { FINDINGS, type FindingId } from "../../analytics/quality";
import { findingRows } from "../../analytics/quality-queries";
import { certainSafe } from "../../analytics/dq-queries";
import { protectedReason, type ProtectReason } from "../../cleanup/cu-core";
import { sql } from "../../db";
import { runJob, type Deps, type JobResult, type Refusal } from "../gateway";

// Data cleaning proposals (docs/AI_JOBS_SPEC.md 2). Our software already knows each contact's problem and the exact fix (analytics/quality.ts). The model is shown a page of them (names and
// numbers are the data, so this needs the account's names opt-in) and only judges: which are plainly right ("high") and which a person should look at twice ("medium"), with a short reason. It
// cannot invent a contact, an action or a new value: a proposal is kept only when its contact and action are one of the candidates, and the value shown is OUR value, never the model's.
//
// NOTHING is applied here. "Check in Fix data" makes a normal Fix data preview (the existing tool: exact changes, the count typed back to confirm, undo, the account's write switch and the
// gateway's re-check of every contact). The AI never deletes anything, and a contact that is protected (do-not-disturb, open deal, upcoming appointment) is never even suggested as "test".

export type Action = "set_phone" | "set_name" | "set_email" | "flag_test";
export const RULE_FOR: Record<Action, "phone" | "name" | "email" | null> = { set_phone: "phone", set_name: "name", set_email: "email", flag_test: null };
const FINDING_FOR: Record<Action, FindingId> = { set_phone: "phone_format", set_name: "name_case", set_email: "email_typo", flag_test: "test_record" };
export const MAX_CANDIDATES = 40;

export type Candidate = { contactId: string; name: string; action: Action; problem: string; before: string | null; after: string | null; protect: ProtectReason | null };
export type Proposal = Candidate & { reason: string; confidence: "high" | "medium"; /** Fix data can apply this kind (not for "flag_test": a person looks at it in the junk list). */ canApply: boolean };
export type MergeCandidate = { key: string; badge: string; people: string[]; protectedCount: number };
export type CleanFacts = { text: string; fields: string[]; candidates: Candidate[]; merges: MergeCandidate[] };

export function cleanFacts(candidates: readonly Candidate[], merges: readonly MergeCandidate[]): CleanFacts {
  const lines = candidates.map((c) => `- id: ${c.contactId}; action: ${c.action}; problem: ${c.problem}; name: ${c.name}; before: ${c.before ?? "(empty)"}; after: ${c.after ?? "(no fix)"}`);
  return {
    candidates: [...candidates], merges: [...merges],
    text: [`Suggested fixes to check, one per line (${candidates.length}):`, ...lines].join("\n"),
    fields: ["contact id, name, the problem found, the value now and the fix our software worked out (names, phones and emails are the data: sent only with your opt-in)"],
  };
}

/** Pure: keeps proposals that are exactly one of the candidates. The value is ours. A protected contact is never proposed as a test record. */
export function keepProposals(raw: unknown, candidates: readonly Candidate[]): Proposal[] {
  const out: Proposal[] = [];
  if (!Array.isArray(raw)) return out;
  for (const p of raw as Array<Record<string, unknown>>) {
    const c = candidates.find((x) => x.contactId === p?.contactId && x.action === p.action);
    if (!c || typeof p.reason !== "string" || out.some((o) => o.contactId === c.contactId && o.action === c.action)) continue;
    if (c.action === "flag_test" && c.protect) continue;
    out.push({ ...c, reason: p.reason, confidence: p.confidence === "high" ? "high" : "medium", canApply: RULE_FOR[c.action] !== null });
  }
  return out;
}

/** The Fix data rules a batch needs (each proposal kind that Fix data can apply, once). */
export const rulesOf = (ps: readonly Pick<Proposal, "action">[]): Array<"phone" | "name" | "email"> => [...new Set(ps.map((p) => RULE_FOR[p.action]).filter((r): r is "phone" | "name" | "email" => r !== null))];

async function protection(inst: string, loc: string, ids: string[]): Promise<Map<string, ProtectReason | null>> {
  const out = new Map<string, ProtectReason | null>();
  if (ids.length === 0) return out;
  const db = sql();
  const rows = await db`select c.contact_id, c.dnd,
    (select count(*)::int from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open') open_deals,
    exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and a.start_at > now()
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'noshow', 'no_show', 'invalid')) upcoming
    from cached_contacts c where c.installation_id = ${inst} and c.location_id = ${loc} and c.contact_id = any(${ids}::text[])`;
  for (const r of rows) out.set(r.contact_id as string, protectedReason({ dnd: r.dnd === true, openDeals: Number(r.open_deals ?? 0), upcomingAppointments: r.upcoming === true ? 1 : 0 }));
  return out;
}

/** One account's candidates (from our own scan, never from the model) and its safest duplicate groups as merge candidates (advice only). */
export async function loadCleanFacts(inst: string, loc: string): Promise<CleanFacts> {
  const per = Math.ceil(MAX_CANDIDATES / 4);
  const actions: Action[] = ["set_phone", "set_name", "set_email", "flag_test"];
  const got = await Promise.all(actions.map(async (a) => ({ a, r: await findingRows(inst, loc, FINDING_FOR[a], null, per) })));
  const raw: Candidate[] = [];
  for (const { a, r } of got) for (const row of r.rows) {
    const fix = a === "flag_test" ? null : row.fix?.[0] ?? null;
    if (a !== "flag_test" && !fix) continue;
    raw.push({ contactId: row.id, name: row.name || "Unnamed contact", action: a, problem: FINDINGS[FINDING_FOR[a]].label, before: fix ? fix.before : row.email ?? row.phone ?? null, after: fix ? fix.after : null, protect: null });
  }
  const prot = await protection(inst, loc, [...new Set(raw.map((c) => c.contactId))]);
  const candidates = raw.map((c) => ({ ...c, protect: prot.get(c.contactId) ?? null })).slice(0, MAX_CANDIDATES);
  const groups = await certainSafe({ inst, allowed: [loc], location: loc }, 10).catch(() => []);
  return cleanFacts(candidates, groups.map((g) => ({ key: g.key, badge: g.badge, people: g.people.map((p) => p.name).slice(0, 3), protectedCount: g.protectedCount })));
}

export type CleanResult = { ok: true; runId: string; cached: boolean; proposals: Proposal[]; merges: MergeCandidate[]; rules: Array<"phone" | "name" | "email">; costUsd: number } | { ok: false; code: Refusal | "empty" | "unverified"; message: string };

export async function runDataClean(a: { installationId: string; locationId: string; userKey: string | null; deps: Deps; facts: CleanFacts; fresh?: boolean }): Promise<CleanResult> {
  if (a.facts.candidates.length === 0) return { ok: false, code: "empty", message: "Nothing to tidy in this account right now." };
  const r: JobResult = await runJob(a.deps, { installationId: a.installationId, locationId: a.locationId, userKey: a.userKey, job: "data_clean", trigger: "view", fresh: a.fresh, input: { text: a.facts.text, fields: a.facts.fields, includesNames: true } });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  const proposals = keepProposals((r.json as { proposals?: unknown } | null)?.proposals, a.facts.candidates);
  if (!proposals.length) return { ok: false, code: "unverified", message: "The AI did not suggest any fix that passed our checks. Use Fix data directly." };
  return { ok: true, runId: r.runId, cached: r.cached, proposals, merges: a.facts.merges, rules: rulesOf(proposals), costUsd: r.costUsd };
}
