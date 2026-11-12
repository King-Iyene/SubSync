import type { Person } from "../analytics/dedupe.ts";
import { anyClearlyDiffer, guardrails, type Guardrail } from "../analytics/dedupe-review.ts";
import type { ChangeRow, Outcome, Writer } from "../analytics/cleanup-platform.ts";
import { isLive, outward, type Deps } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { ghlFetch } from "./http.ts";

// The ONE gateway every change to a client's contacts goes through (stage CLEANUP; King: "SubSync must write where needed", with every safety).
//
//   1. The server's master switch WRITE_GHL_LIVE (off unless exactly "true"). Off: the whole request is built, one "WOULD WRITE" line is recorded (ids and field names only) and
//      NOTHING is sent. Nothing live happens until King flips it.
//   2. The per-account opt-in (a person switches it on in Settings; off by default). The caller checks it before it builds a plan; this file refuses without it.
//   3. A preview before anything (the caller shows before and after for every field) and a deliberate confirm (a typed count for field fixes, a ticked box for a merge).
//   4. Guardrails: Do Not Disturb, deals, a paying customer, two owners, people who clearly differ. Never across two accounts (every item must name the same account).
//   5. Rate limits and batching: calls are spaced (about 7 a second, under the platform's 100 per 10 seconds) and the caller works in small batches.
//   6. A before-value stored for every field fix (the clean-up tables) so a run can be undone; a merge cannot be undone and says so.
//   7. One audit line per write: who, when, the ids and the field NAMES (never a value, a name, an email or a phone number).
//   8. Failures are named and retryable: a failed item stays pending or failed with its reason; running it again retries only what is left.
// Tests use a stubbed fetch only. This file never reads an environment variable except through `isLive`.

export const SPACING_MS = 150;
export const VERSION = "2021-07-28";

export type GatewayDeps = Deps & { sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type WriteAudit = { installationId: string; actor: string | null; locationId: string; contactId: string; op: string; fields: string[]; result: string; runId?: string | null };

/** The audit line for one write. Ids and field names only. */
export async function recordWrite(w: WriteAudit, deps: GatewayDeps = {}): Promise<void> {
  const detail = { what: "crm.contact.write", op: w.op, locationId: w.locationId, contactId: w.contactId, fields: w.fields.slice(0, 20), result: w.result, runId: w.runId ?? null };
  try {
    if (deps.audit) await deps.audit({ installationId: w.installationId, action: "crm.write", detail });
    else {
      const { sql } = await import("../db");
      const db = sql();
      await db`insert into audit_log (installation_id, actor, action, detail) values (${w.installationId}, ${w.actor}, 'crm.write', ${db.json(detail as never)})`;
    }
  } catch {
    // an audit line that cannot be written must never turn a finished write into an error; the clean-up tables still hold the change
  }
}

export type GateCtx = { installationId: string; locationId: string; actor: string | null; runId?: string | null; optedIn: boolean };

/**
 * Wraps a field writer. Off (switch or opt-in): every call answers "dry_run" and the first one records the WOULD WRITE line for the account; the change stays pending, so it
 * can be applied later when the switch is on. On: the call is spaced, sent through the inner writer (which re-reads the contact and skips anything changed since the
 * preview) and audited.
 */
export function gatedWriter(inner: Writer, ctx: GateCtx, deps: GatewayDeps = {}): Writer & { announced: () => boolean } {
  let announced = false;
  const live = () => ctx.optedIn && isLive("WRITE_GHL_LIVE", deps.env ?? process.env);
  const run = async (c: ChangeRow, op: "apply" | "undo"): Promise<Outcome> => {
    if (!live()) {
      if (!announced) {
        announced = true;
        await outward({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.contact.update", installationId: ctx.installationId, ids: { locationId: ctx.locationId, runId: ctx.runId ?? null }, fields: [c.rule === "tag" ? "tags" : c.field] }, async () => 0, deps);
      }
      return { result: "dry_run", detail: ctx.optedIn ? "Switched off on the server: nothing was sent" : "Not allowed for this account yet: nothing was sent" };
    }
    await (deps.sleep ?? wait)(SPACING_MS);
    const out = await (op === "apply" ? inner.apply(c) : inner.revert(c));
    await recordWrite({ installationId: ctx.installationId, actor: ctx.actor, locationId: ctx.locationId, contactId: c.contactId, op: `${op}.${c.rule}`, fields: [c.rule === "tag" ? "tags" : c.field], result: out.result, runId: ctx.runId }, deps);
    return out;
  };
  return { apply: (c) => run(c, "apply"), revert: (c) => run(c, "undo"), announced: () => announced };
}

// ---------------- merging through the customer's own merge workflow ----------------
//
// VERIFIED (the platform's help pages and API description, read 5 Nov 2026): there is no merge endpoint. The workflow action "Merge Contact" takes no second contact: it
// looks at the contact that is in the workflow, finds another contact in the SAME account with the same email, the same phone number or both (the customer chooses
// which), and merges them. The OLDER record is kept. An API call can add a contact to a workflow (POST /contacts/{id}/workflow/{workflowId}, scope contacts.write), but an
// app cannot create the workflow: the customer builds it once and gives SubSync its id. So this route is honest about what it can promise:
//   - it only works for two records that share an exact email or phone, and no third record shares it (the action merges ANY contact that matches);
//   - the record that survives is the older one, whatever SubSync picked;
//   - a merge cannot be reversed, so Do Not Disturb stops it (what the merge does with that mark is not written down anywhere).

export type WorkflowBlocker = { id: "dnd" | "different" | "size" | "not_exact" | "no_workflow" | "no_dates" | "other_match"; text: string };

export type WorkflowPlan = {
  /** The record the workflow will keep: the older one. */
  survivorId: string;
  /** The record to put in the workflow (the newer one). */
  enrolId: string;
  matchBy: "email" | "phone" | "both";
  blockers: WorkflowBlocker[];
  /** Warnings that need a deliberate tick before the merge (won deals, open deals, different owners). */
  warnings: Guardrail[];
  /** True when the older record is not the one SubSync would have kept. */
  survivorDiffers: boolean;
};

const foldMail = (e: string | null) => (e ? e.trim().toLowerCase() : null);
const lastTen = (p: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-10) : null; };
const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

/**
 * What the workflow route can and cannot do for one group. `others` is how many OTHER contacts in the account share the same email or phone as the pair (the workflow would
 * merge those too); the caller counts them from SubSync's copy.
 */
export function planWorkflowMerge(people: readonly Person[], pickedKeepId: string, o: { workflowId: string | null; others: number }): WorkflowPlan {
  const blockers: WorkflowBlocker[] = [];
  if (!o.workflowId) blockers.push({ id: "no_workflow", text: "This account has no merge workflow set up yet. Add its id in Rules, Merge workflow." });
  if (people.length !== 2) blockers.push({ id: "size", text: "Only two records are sent at a time, so the merge cannot catch a third by accident." });
  if (anyClearlyDiffer(people)) blockers.push({ id: "different", text: "These look like different people (a different email and a different phone number)." });
  if (people.some((p) => p.dnd)) blockers.push({ id: "dnd", text: "Someone here is on Do Not Disturb. A merge cannot be undone and what it does to that mark is not documented, so finish this one in your CRM's own merge screen." });
  if (o.others > 0) blockers.push({ id: "other_match", text: `${o.others} other contact${o.others === 1 ? "" : "s"} in this account share the same email or phone number, and the merge would take ${o.others === 1 ? "it" : "them"} too.` });
  const [a, b] = people;
  const sameMail = !!a && !!b && !!foldMail(a.email) && foldMail(a.email) === foldMail(b.email);
  const samePhone = !!a && !!b && !!lastTen(a.phone) && lastTen(a.phone) === lastTen(b.phone);
  if (people.length === 2 && !sameMail && !samePhone) blockers.push({ id: "not_exact", text: "The merge workflow only joins records with the same email or the same phone number." });
  const dated = people.length === 2 && Number.isFinite(ms(a.createdAt)) && Number.isFinite(ms(b.createdAt));
  if (people.length === 2 && !dated) blockers.push({ id: "no_dates", text: "SubSync does not know which record is older, and the merge keeps the older one." });
  const older = a && b ? (dated && ms(a.createdAt) <= ms(b.createdAt) ? a : b) : a;
  const newer = older === a ? b : a;
  const survivor = older;
  return {
    survivorId: survivor?.contactId ?? "", enrolId: newer?.contactId ?? "",
    matchBy: sameMail && samePhone ? "both" : sameMail ? "email" : "phone",
    blockers, warnings: survivor ? guardrails(people, survivor.contactId).filter((g) => g.id !== "dnd") : [],
    survivorDiffers: !!survivor && survivor.contactId !== pickedKeepId,
  };
}

export type WorkflowResult =
  | { outcome: "blocked"; blockers: WorkflowBlocker[] }
  | { outcome: "opted_out" }
  | { outcome: "switched_off"; line: string; survivorId: string }
  | { outcome: "requested"; survivorId: string }
  | { outcome: "needs_permission" }
  | { outcome: "failed"; status: number };

export type WorkflowArgs = {
  installationId: string; locationId: string; actor: string | null; optedIn: boolean; workflowId: string | null;
  people: readonly Person[]; pickedKeepId: string; others: number;
  /** The caller has shown the preview and the person ticked "I have checked this". */
  confirmed: boolean;
  /** Gets a token for the account. Only called when everything else has said yes. */
  token: () => Promise<string>;
  /** Merge Contact is a workflow action; the account's workflow must be on (published). Checked by the caller when it can read workflows; null when it cannot. */
  workflowPublished: boolean | null;
};

/**
 * Adds the newer record to the customer's merge workflow, which merges it into the older one. Nothing is sent unless the opt-in is on, the person confirmed, no blocker applies and
 * the master switch is on; with the switch off one "WOULD WRITE crm.contact.merge_workflow" line is recorded.
 */
export async function mergeViaWorkflow(a: WorkflowArgs, deps: GatewayDeps = {}): Promise<WorkflowResult> {
  const plan = planWorkflowMerge(a.people, a.pickedKeepId, { workflowId: a.workflowId, others: a.others });
  if (a.workflowPublished === false) plan.blockers.push({ id: "no_workflow", text: "The merge workflow in your CRM is not switched on (published). Turn it on there, then try again." });
  if (plan.blockers.length) return { outcome: "blocked", blockers: plan.blockers };
  if (!a.optedIn) return { outcome: "opted_out" };
  if (!a.confirmed) return { outcome: "blocked", blockers: [{ id: "size", text: "Tick the box to confirm. A merge cannot be undone." }] };
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.contact.merge_workflow", installationId: a.installationId, ids: { locationId: a.locationId, keepContactId: plan.survivorId, enrolContactId: plan.enrolId, workflowId: a.workflowId }, fields: ["workflow"] },
    async (): Promise<WorkflowResult> => {
      await (deps.sleep ?? wait)(SPACING_MS);
      const res = await ghlFetch(
        `${GHL_API}/contacts/${encodeURIComponent(plan.enrolId)}/workflow/${encodeURIComponent(a.workflowId!)}`,
        { method: "POST", headers: { Authorization: `Bearer ${await a.token()}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ eventStartTime: new Date().toISOString() }), cache: "no-store" },
        { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
      );
      const result: WorkflowResult = res.status === 401 || res.status === 403 ? { outcome: "needs_permission" } : res.ok ? { outcome: "requested", survivorId: plan.survivorId } : { outcome: "failed", status: res.status };
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: plan.enrolId, op: "merge_workflow", fields: ["workflow"], result: result.outcome }, deps);
      return result;
    },
    deps,
  );
  return done.live ? done.result : { outcome: "switched_off", line: done.line, survivorId: plan.survivorId };
}

// ---------------- prevention: tag a new contact that looks like an existing one ----------------

export const POSSIBLE_DUPLICATE_TAG = "possible-duplicate";

export type TagArgs = { installationId: string; locationId: string; contactId: string; actor: string | null; optedIn: boolean; preventTag: boolean; token: () => Promise<string> };

/**
 * The optional prevention action: add one tag to a contact that just arrived and looks like an existing one, so the customer's own workflows and lists can act on it. Needs the
 * account's opt-in AND its prevention choice AND the master switch; otherwise nothing is sent (a dry run line is recorded when only the switch is off). Adds a tag, removes nothing,
 * changes no other field.
 */
export async function tagPossibleDuplicate(a: TagArgs, deps: GatewayDeps = {}): Promise<"skipped" | "switched_off" | "tagged" | "needs_permission" | "failed"> {
  if (!a.optedIn || !a.preventTag) return "skipped";
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "crm.contact.tag", installationId: a.installationId, ids: { locationId: a.locationId, contactId: a.contactId }, fields: ["tags"] },
    async () => {
      await (deps.sleep ?? wait)(SPACING_MS);
      const res = await ghlFetch(
        `${GHL_API}/contacts/${encodeURIComponent(a.contactId)}/tags`,
        { method: "POST", headers: { Authorization: `Bearer ${await a.token()}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ tags: [POSSIBLE_DUPLICATE_TAG] }), cache: "no-store" },
        { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
      );
      const r = res.status === 401 || res.status === 403 ? "needs_permission" : res.ok ? "tagged" : "failed";
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: a.contactId, op: "tag.possible_duplicate", fields: ["tags"], result: r }, deps);
      return r as "tagged" | "needs_permission" | "failed";
    },
    deps,
  );
  return done.live ? done.result : "switched_off";
}

// ---------------- bulk clean-up: tag or remove contacts (stage CU) ----------------
//
// The same gate as every other write here: the master switch AND the account's opt-in, spaced calls, one audit line per contact (ids and the operation only), a stop at the first refused
// permission. The caller has ALREADY re-read every contact, left out the protected ones, applied the cap and checked the typed confirmation; this function never decides who is safe, it only
// refuses to send when either switch is off. A removal cannot be undone on this platform; a tag can be removed by hand.

export type BulkAction = "tag" | "remove";
export type BulkArgs = {
  installationId: string; locationId: string; actor: string | null; optedIn: boolean; action: BulkAction; tag?: string;
  contactIds: readonly string[]; token: () => Promise<string>;
};
export type BulkResult = { mode: "dry_run" | "live"; done: number; failed: number; needsPermission: boolean; line: string | null };

export async function bulkViaGateway(a: BulkArgs, deps: GatewayDeps = {}): Promise<BulkResult> {
  if (!a.optedIn || a.contactIds.length === 0) return { mode: "dry_run", done: 0, failed: 0, needsPermission: false, line: null };
  const op = a.action === "remove" ? "remove" : "tag";
  const out = await outward<BulkResult>(
    { flag: "WRITE_GHL_LIVE", verb: a.action === "remove" ? "DELETE" : "WRITE", what: a.action === "remove" ? "crm.contact.remove" : "crm.contact.tag", installationId: a.installationId, ids: { locationId: a.locationId, contacts: a.contactIds.length }, fields: [a.action === "remove" ? "contact" : "tags"] },
    async (): Promise<BulkResult> => {
      let done = 0, failed = 0, needsPermission = false;
      const token = await a.token();
      for (const id of a.contactIds) {
        await (deps.sleep ?? wait)(SPACING_MS);
        const url = a.action === "remove" ? `${GHL_API}/contacts/${encodeURIComponent(id)}` : `${GHL_API}/contacts/${encodeURIComponent(id)}/tags`;
        const res = await ghlFetch(
          url,
          { method: a.action === "remove" ? "DELETE" : "POST", headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", "Content-Type": "application/json" }, ...(a.action === "tag" ? { body: JSON.stringify({ tags: [a.tag ?? "cleanup-review"] }) } : {}), cache: "no-store" },
          { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
        );
        const result = res.status === 401 || res.status === 403 ? "needs_permission" : res.ok || (a.action === "remove" && res.status === 404) ? "done" : "failed";
        await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId: id, op, fields: [a.action === "remove" ? "contact" : "tags"], result }, deps);
        if (result === "needs_permission") { needsPermission = true; break; }
        if (result === "done") done++; else failed++;
      }
      return { mode: "live", done, failed, needsPermission, line: null };
    },
    deps,
  );
  return out.live ? out.result : { mode: "dry_run", done: 0, failed: 0, needsPermission: false, line: out.line };
}
