import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { outward } from "../live-flags";

// Payments: the changes. Everything here is SubSync's OWN record (notes, snooze, dismiss, the dispute log) except resendInvoice, which messages a customer and is switched off (flag pm_resend) until King
// approves it. Every change leaves an audit line (ids and field names, never a name, email or note text). The caller has already checked the account with ownedLocation.
type Actor = { userId: string | null; name: string | null };
const DISPUTE_STATUS = ["open", "evidence_sent", "won", "lost"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];
export type DisputeInput = { customer: string; amount: number | null; currency: string | null; reason: string | null; openedOn: string; evidenceDueOn: string | null; status: DisputeStatus; processorUrl: string | null; notes: string | null };

async function audit(inst: string, actor: Actor, action: string, detail: Record<string, unknown>): Promise<void> {
  const db = sql();
  try { await db`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${actor.userId}, ${action}, ${db.json(detail as never)})`; } catch { /* the change itself is already recorded in its own table */ }
}

const clean = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Accept only an https link to another site (the processor's page). Never javascript:, never our own pages. */
export function safeUrl(v: unknown): string | null {
  const s = clean(v, 500);
  if (!s) return null;
  try { const u = new URL(s); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

/** Check and tidy the fields of a dispute. Returns the problem in plain words, or the clean values. */
export function readDispute(b: Record<string, unknown>): { error: string } | { value: DisputeInput } {
  const customer = clean(b.customer, 120);
  if (!customer) return { error: "Write who the customer is." };
  const openedOn = clean(b.openedOn, 10);
  if (!openedOn || !DATE.test(openedOn) || Number.isNaN(Date.parse(openedOn))) return { error: "Choose the date the dispute was opened." };
  const due = clean(b.evidenceDueOn, 10);
  if (due && (!DATE.test(due) || Number.isNaN(Date.parse(due)))) return { error: "The evidence due date is not a date." };
  const raw = b.amount === "" || b.amount === null || b.amount === undefined ? null : Number(b.amount);
  if (raw !== null && (!Number.isFinite(raw) || raw < 0 || raw > 1e9)) return { error: "The amount must be a number." };
  const cur = clean(b.currency, 3);
  if (cur && !/^[A-Za-z]{3}$/.test(cur)) return { error: "The currency is three letters, like USD." };
  const status = typeof b.status === "string" && (DISPUTE_STATUS as readonly string[]).includes(b.status) ? (b.status as DisputeStatus) : "open";
  const url = clean(b.processorUrl, 500);
  if (url && !safeUrl(url)) return { error: "The processor link must start with https://" };
  return { value: { customer, amount: raw, currency: cur ? cur.toUpperCase() : null, reason: clean(b.reason, 300), openedOn, evidenceDueOn: due, status, processorUrl: url ? safeUrl(url) : null, notes: clean(b.notes, 2000) } };
}

export async function addNote(inst: string, loc: string, kind: string, id: string, n: { action: "contacted" | "snooze" | "dismiss" | "note"; reason?: string | null; note?: string | null; days?: number }, actor: Actor): Promise<{ ok: boolean; error?: string }> {
  const db = sql();
  const has = await db`select 1 from pm_items where installation_id = ${inst} and location_id = ${loc} and kind = ${kind} and item_id = ${id} limit 1`;
  if (!has.length) return { ok: false, error: "That item is not here any more." };
  if (n.action === "dismiss" && !clean(n.reason, 200)) return { ok: false, error: "Say why you are dismissing it." };
  const days = Math.min(30, Math.max(1, Math.floor(n.days ?? 3)));
  const until = n.action === "snooze" ? new Date(Date.now() + days * 86_400_000) : null;
  await db`insert into pm_notes (installation_id, location_id, kind, item_id, action, reason, note, until_at, by_user, by_name) values (${inst}, ${loc}, ${kind}, ${id}, ${n.action}, ${clean(n.reason, 200)}, ${clean(n.note, 1000)}, ${until}, ${actor.userId}, ${actor.name})`;
  await audit(inst, actor, `payments.${n.action}`, { locationId: loc, kind, itemId: id });
  return { ok: true };
}

export async function createDispute(inst: string, loc: string, v: DisputeInput, actor: Actor): Promise<string> {
  const db = sql();
  const r = await db`insert into pm_disputes (installation_id, location_id, customer, amount, currency, reason, opened_on, evidence_due_on, status, processor_url, notes, created_by, created_by_name)
    values (${inst}, ${loc}, ${v.customer}, ${v.amount}, ${v.currency}, ${v.reason}, ${v.openedOn}, ${v.evidenceDueOn}, ${v.status}, ${v.processorUrl}, ${v.notes}, ${actor.userId}, ${actor.name}) returning id`;
  await audit(inst, actor, "payments.dispute_added", { locationId: loc, disputeId: r[0].id });
  return r[0].id as string;
}

export type DisputeRow = DisputeInput & { id: string; locationId: string };
export async function getDispute(inst: string, allowed: string[] | null, id: string): Promise<DisputeRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await sql()`select * from pm_disputes where installation_id = ${inst} and id = ${id}`;
  const x = r[0];
  if (!x || (allowed && !allowed.includes(x.location_id as string))) return null;
  const d = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  return { id: x.id as string, locationId: x.location_id as string, customer: x.customer as string, amount: x.amount === null ? null : Number(x.amount), currency: (x.currency as string | null) ?? null, reason: (x.reason as string | null) ?? null, openedOn: d(x.opened_on)!, evidenceDueOn: d(x.evidence_due_on), status: x.status as DisputeStatus, processorUrl: (x.processor_url as string | null) ?? null, notes: (x.notes as string | null) ?? null };
}

const FIELD_WORDS: Record<keyof DisputeInput, string> = { customer: "Customer", amount: "Amount", currency: "Currency", reason: "Reason", openedOn: "Opened", evidenceDueOn: "Evidence due", status: "Status", processorUrl: "Link to your processor", notes: "Notes" };
/** The before and after of an edit, one line per changed field (shown as a preview before anything is saved). */
export function diffDispute(a: DisputeInput, b: DisputeInput): Array<{ field: string; before: string; after: string }> {
  return (Object.keys(FIELD_WORDS) as Array<keyof DisputeInput>).filter((k) => (a[k] ?? null) !== (b[k] ?? null)).map((k) => ({ field: FIELD_WORDS[k], before: String(a[k] ?? "none"), after: String(b[k] ?? "none") }));
}

export async function updateDispute(inst: string, id: string, v: DisputeInput, actor: Actor): Promise<void> {
  const db = sql();
  await db`update pm_disputes set customer = ${v.customer}, amount = ${v.amount}, currency = ${v.currency}, reason = ${v.reason}, opened_on = ${v.openedOn}, evidence_due_on = ${v.evidenceDueOn}, status = ${v.status}, processor_url = ${v.processorUrl}, notes = ${v.notes}, updated_at = now() where installation_id = ${inst} and id = ${id}`;
  await audit(inst, actor, "payments.dispute_changed", { disputeId: id });
}

/** Removing a dispute needs the customer's name typed back exactly (the route checks it). */
export async function removeDispute(inst: string, id: string, actor: Actor): Promise<void> {
  await sql()`delete from pm_disputes where installation_id = ${inst} and id = ${id}`;
  await audit(inst, actor, "payments.dispute_removed", { disputeId: id });
}

// ---- Resend an invoice (flag pm_resend, OFF; King has not approved messaging a customer) ----
export const RESEND_CAP_PER_DAY = 20;
export type ResendPlan = { ok: true; recipient: string; invoiceId: string; amount: number | null; currency: string | null; channel: "email" } | { ok: false; error: string };
/** Everything checked BEFORE a preview or a send: the invoice is a flagged one in this account, the person has an email, is not marked do-not-contact, no resend in the last 24 hours, fewer than the daily cap. */
export async function planResend(inst: string, loc: string, invoiceId: string): Promise<ResendPlan> {
  const db = sql();
  const r = await db`select contact_id, contact_name, contact_email, amount, currency from pm_items where installation_id = ${inst} and location_id = ${loc} and kind = 'invoice' and item_id = ${invoiceId} and problem_kind = 'late_invoice' and resolved_at is null`;
  if (!r.length) return { ok: false, error: "That invoice is not late any more." };
  const email = r[0].contact_email as string | null, cid = r[0].contact_id as string | null;
  if (!email || !cid) return { ok: false, error: "There is no email address on this invoice, so nothing can be sent." };
  const c = await db`select dnd from cached_contacts where installation_id = ${inst} and location_id = ${loc} and contact_id = ${cid}`;
  if (c[0]?.dnd === true) return { ok: false, error: "This person asked not to be contacted. Nothing was sent." };
  const recent = await db`select count(*) filter (where detail->>'invoiceId' = ${invoiceId} and at > now() - interval '24 hours')::int same, count(*) filter (where detail->>'locationId' = ${loc} and at > now() - interval '24 hours')::int day
    from audit_log where installation_id = ${inst} and action = 'payments.resend'`.catch(() => [{ same: 0, day: 0 }]);
  if (Number(recent[0]?.same) > 0) return { ok: false, error: "This invoice was already sent again in the last 24 hours." };
  if (Number(recent[0]?.day) >= RESEND_CAP_PER_DAY) return { ok: false, error: `The limit of ${RESEND_CAP_PER_DAY} invoices a day for this client account is reached.` };
  return { ok: true, recipient: email, invoiceId, amount: r[0].amount === null ? null : Number(r[0].amount), currency: (r[0].currency as string | null) ?? null, channel: "email" };
}

export async function resendInvoice(inst: string, loc: string, invoiceId: string, token: string, actor: Actor): Promise<{ ok: boolean; dryRun?: boolean; error?: string }> {
  const plan = await planResend(inst, loc, invoiceId);
  if (!plan.ok) return { ok: false, error: plan.error };
  const out = await outward({ flag: "WRITE_GHL_LIVE", verb: "SEND", what: "invoice.send", ids: { locationId: loc, invoiceId }, installationId: inst }, async () => {
    const res = await ghlFetch(`${GHL_API}/invoices/${encodeURIComponent(invoiceId)}/send`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ altId: loc, altType: "location", action: "email", liveMode: true }), cache: "no-store" });
    return res.status;
  });
  if (!out.live) return { ok: true, dryRun: true };
  if (out.result === 401 || out.result === 403) return { ok: false, error: "Needs permission: reconnect" };
  if (out.result < 200 || out.result >= 300) return { ok: false, error: "The platform did not accept the request. Nothing was sent." };
  await audit(inst, actor, "payments.resend", { locationId: loc, invoiceId });
  return { ok: true };
}
