import type { Person } from "../analytics/dedupe.ts";
import { anyClearlyDiffer } from "../analytics/dedupe-review.ts";
import { outward, type Deps } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { ghlFetch } from "./http.ts";

// The one-click "Merge these contacts" action, built but SWITCHED OFF (stage DUP; docs/features/DUPLICATES.md).
//
// What the platform's public API offers (VERIFIED against its published API description, 4 Nov 2026): NO merge-contacts endpoint. The merge exists only in
// the platform's own screen and as a workflow action. The public contact endpoints can update a contact, add tags and delete a contact, so a merge can only be
// COMPOSED from those steps. A composed merge cannot move conversations, deals or appointments to the kept contact (a deal's update has no contact field), and
// deleting the other contact would destroy them. So this action refuses, before anything is sent, whenever the record to remove has any of those, or a Do Not
// Disturb mark, or a name and details that clearly differ. It also cannot copy notes and tasks (it would have to read and re-create each one), which is said
// in `caveats` and in the docs. The recommendation to King is NOT to switch it on: the guided merge in the CRM's own screen loses nothing.
//
// Every write goes through `outward` (src/lib/live-flags.ts): with WRITE_GHL_LIVE off (the committed default) the whole request list is built, one
// "WOULD WRITE crm.contact.merge" line is recorded (ids and field names only) and NOTHING is sent. Tests use a stubbed fetch.

const VERSION = "2021-07-28";
const seg = (v: string) => encodeURIComponent(v);

export type MergeStep = {
  id: "update_keep" | "add_tags" | "delete_duplicate";
  method: "PUT" | "POST" | "DELETE";
  path: string;
  version: string;
  scope: "contacts.write";
  body?: Record<string, unknown>;
  contactId: string;
};

export type MergeBlocker = { id: "conversation" | "deals" | "appointments" | "dnd" | "different" | "same_contact" | "too_many"; text: string };

/** Why a composed merge must not run. Empty means nothing the API cannot carry would be lost (notes and tasks still are: see `caveats`). */
export function apiMergeBlockers(people: readonly Person[], keepId: string): MergeBlocker[] {
  const out: MergeBlocker[] = [];
  const removed = people.filter((p) => p.contactId !== keepId);
  if (!people.some((p) => p.contactId === keepId) || removed.length === 0) out.push({ id: "same_contact", text: "There must be a record to keep and at least one other." });
  if (removed.length > 1) out.push({ id: "too_many", text: "Only one record is merged at a time from here." });
  if (anyClearlyDiffer(people)) out.push({ id: "different", text: "These look like different people (different email and different phone)." });
  if (removed.some((p) => p.hasConversation)) out.push({ id: "conversation", text: "The other record has a conversation, and the API cannot move it, so deleting the record would lose it." });
  if (removed.some((p) => p.openDeals > 0 || p.wonDeals > 0)) out.push({ id: "deals", text: "The other record has deals, and the API cannot move them to another contact." });
  if (removed.some((p) => (p.appointments ?? 0) > 0)) out.push({ id: "appointments", text: "The other record has appointments, and the API cannot move them." });
  if (people.some((p) => p.dnd)) out.push({ id: "dnd", text: "A Do Not Disturb mark is involved; this is decided by a person in the CRM's own merge screen." });
  return out;
}

/** What a composed merge still cannot do even when nothing is blocked. Shown to the person and in the docs. */
export const MERGE_CAVEATS = ["Notes and tasks on the removed record are not copied.", "Deleting a contact cannot be undone."] as const;

/** The requests, in order: fill gaps on the kept contact (never overwrite), add the other's tags, and only then delete the other record. */
export function buildMergeSteps(people: readonly Person[], keepId: string): MergeStep[] {
  const keep = people.find((p) => p.contactId === keepId);
  if (!keep) return [];
  const removed = people.filter((p) => p.contactId !== keepId);
  const steps: MergeStep[] = [];
  const gap: Record<string, string> = {};
  if (!keep.email) { const e = removed.map((p) => p.email).find(Boolean); if (e) gap.email = e; }
  if (!keep.phone) { const t = removed.map((p) => p.phone).find(Boolean); if (t) gap.phone = t; }
  if (Object.keys(gap).length) steps.push({ id: "update_keep", method: "PUT", path: `/contacts/${seg(keepId)}`, version: VERSION, scope: "contacts.write", body: gap, contactId: keepId });
  const have = new Set(keep.tags.map((t) => t.toLowerCase()));
  const tags = [...new Set(removed.flatMap((p) => p.tags).filter((t) => !have.has(t.toLowerCase())))];
  if (tags.length) steps.push({ id: "add_tags", method: "POST", path: `/contacts/${seg(keepId)}/tags`, version: VERSION, scope: "contacts.write", body: { tags }, contactId: keepId });
  for (const r of removed) steps.push({ id: "delete_duplicate", method: "DELETE", path: `/contacts/${seg(r.contactId)}`, version: VERSION, scope: "contacts.write", contactId: r.contactId });
  return steps;
}

export type MergeResult =
  | { outcome: "switched_off"; line: string; steps: number; caveats: readonly string[] }
  | { outcome: "blocked"; blockers: MergeBlocker[] }
  | { outcome: "merged"; steps: number }
  | { outcome: "needs_permission" }
  | { outcome: "failed"; status: number; step: MergeStep["id"] };

export type MergeArgs = {
  installationId: string | null;
  locationId: string;
  keepId: string;
  people: readonly Person[];
  /** Gets a token for the account. Only called when the switch is on. */
  token: () => Promise<string>;
  /** Replaces fetch (tests). */
  fetchImpl?: typeof fetch;
};

export async function mergeContacts(a: MergeArgs, deps: Deps = {}): Promise<MergeResult> {
  const blockers = apiMergeBlockers(a.people, a.keepId);
  if (blockers.length) return { outcome: "blocked", blockers };
  const steps = buildMergeSteps(a.people, a.keepId);
  const fields = [...new Set(steps.flatMap((s) => (s.body ? Object.keys(s.body) : [])))];
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.contact.merge", installationId: a.installationId, ids: { locationId: a.locationId, keepContactId: a.keepId, removeContactId: steps.find((s) => s.id === "delete_duplicate")?.contactId ?? null }, fields },
    async (): Promise<MergeResult> => {
      const headers = async (version: string) => ({ Authorization: `Bearer ${await a.token()}`, Version: version, Accept: "application/json", "Content-Type": "application/json" });
      for (const s of steps) {
        const res = await ghlFetch(`${GHL_API}${s.path}`, { method: s.method, headers: await headers(s.version), ...(s.body ? { body: JSON.stringify(s.body) } : {}), cache: "no-store" }, a.fetchImpl ? { fetchImpl: a.fetchImpl } : {});
        if (res.status === 401 || res.status === 403) return { outcome: "needs_permission" };
        if (!res.ok) return { outcome: "failed", status: res.status, step: s.id }; // stops here: the delete never runs after a failed step
      }
      return { outcome: "merged", steps: steps.length };
    },
    deps,
  );
  return done.live ? done.result : { outcome: "switched_off", line: done.line, steps: steps.length, caveats: MERGE_CAVEATS };
}
