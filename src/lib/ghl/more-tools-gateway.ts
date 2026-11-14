import { GHL_API } from "./client.ts";
import type { GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";
import { hdr, opts, pick, run, type Base, type ReadDeps, type ReadResult, type SafeWriteResult } from "./safe-writes-gateway.ts";

// Extra tools (branch feat/scopes-more-tools). Every CRM change here goes through the same guarded door as the other safe writes (`run` in safe-writes-gateway.ts: the server switch
// WRITE_GHL_LIVE, the account's own opt-in, one audit line with ids and field names only, calls spaced under the platform limit, "Needs permission: reconnect" instead of a guess).
//   repeating follow-up   POST /locations/{id}/recurring-tasks     scope recurring-tasks.write      (published API description: required fields title and rruleOptions)
//   read it back          GET  /locations/{id}/recurring-tasks/{id} scope recurring-tasks.readonly   (the platform has no list, so SubSync can only read one it just made, by its id)
//   estimate draft        POST /invoices/estimate                   scope invoices/estimate.write    (a draft: no sendEstimateDetails is sent, so nobody is emailed)
//   invoice draft         POST /invoices/                           scope invoices.write             (no send call exists here, so the invoice is only saved)
//   invoice template      POST /invoices/template                   scope invoices/template.write
//   email templates       GET  /emails/locations/{id}/templates     scope emails/templates.readonly  (read only)
//   installer details     GET  /marketplace/app/{appId}/installations scope marketplace-installer-details.readonly (read only)
// NOT VERIFIED LIVE: no real account was called (docs/FEATURE_STATUS.md). Nothing here messages a lead or sends an invoice or estimate.

export const RECURRING_WRITE_SCOPE = "recurring-tasks.write";
export const RECURRING_READ_SCOPE = "recurring-tasks.readonly";
export const ESTIMATE_WRITE_SCOPE = "invoices/estimate.write";
export const INVOICE_WRITE_SCOPE = "invoices.write";
export const TEMPLATE_WRITE_SCOPE = "invoices/template.write";
export const EMAIL_TEMPLATES_SCOPE = "emails/templates.readonly";
export const INSTALLER_SCOPE = "marketplace-installer-details.readonly";

// ---------------- pure rules (the tests read these) ----------------

export const FOLLOW_UP_TITLE_MAX = 120;
export const FOLLOW_UP_MAX_REPEATS = 52;
export const INTERVAL_TYPES = ["daily", "weekly", "monthly"] as const;
export type IntervalType = (typeof INTERVAL_TYPES)[number];
export type FollowUp = { title: string; intervalType: IntervalType; interval: number; count: number; startDate: string; dueAfterHours: number };

const plainText = (v: unknown, max: number, what: string): { ok: true; text: string } | { ok: false; text: string } => {
  if (typeof v !== "string") return { ok: false, text: `Type ${what}.` };
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return { ok: false, text: `Type ${what}.` };
  if (t.length > max) return { ok: false, text: `Use at most ${max} characters.` };
  if (/[\u0000-\u001f<>]/.test(t)) return { ok: false, text: "Use plain letters, numbers and punctuation." };
  return { ok: true, text: t };
};

/** Checks what a person typed for a repeating follow-up. `now` is injected so the tests do not depend on the clock. */
export function checkFollowUp(v: unknown, now: Date = new Date()): { ok: true; value: FollowUp } | { ok: false; text: string } {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const title = plainText(o.title, FOLLOW_UP_TITLE_MAX, "what to follow up on");
  if (!title.ok) return title;
  if (!(INTERVAL_TYPES as readonly unknown[]).includes(o.intervalType)) return { ok: false, text: "Choose daily, weekly or monthly." };
  const interval = Number(o.interval), count = Number(o.count), due = Number(o.dueAfterHours ?? 24);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) return { ok: false, text: "Repeat every 1 to 12." };
  if (!Number.isInteger(count) || count < 1 || count > FOLLOW_UP_MAX_REPEATS) return { ok: false, text: `Repeat between 1 and ${FOLLOW_UP_MAX_REPEATS} times, so it always ends.` };
  if (!Number.isInteger(due) || due < 1 || due > 24 * 30) return { ok: false, text: "Due time must be 1 hour to 30 days." };
  const start = typeof o.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.startDate) ? new Date(`${o.startDate}T09:00:00.000Z`) : null;
  if (!start || Number.isNaN(start.getTime())) return { ok: false, text: "Choose a start date." };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (start.getTime() < today.getTime()) return { ok: false, text: "The start date cannot be in the past." };
  if (start.getTime() > today.getTime() + 366 * 86_400_000) return { ok: false, text: "Start within the next year." };
  return { ok: true, value: { title: title.text, intervalType: o.intervalType as IntervalType, interval, count, startDate: o.startDate as string, dueAfterHours: due } };
}

export const followUpBody = (f: FollowUp, contactId: string, ownerIds: string[] = []): Record<string, unknown> => ({
  title: f.title, contactIds: [contactId], ...(ownerIds.length ? { owners: ownerIds } : {}),
  rruleOptions: { intervalType: f.intervalType, interval: f.interval, startDate: `${f.startDate}T09:00:00.000Z`, count: f.count, createTaskIfOverDue: false, dueAfterSeconds: f.dueAfterHours * 3600 },
});

/** Plain words for how often: "every week, 4 times". */
export function followUpWords(f: FollowUp): string {
  const unit = { daily: "day", weekly: "week", monthly: "month" }[f.intervalType];
  return `every ${f.interval === 1 ? unit : `${f.interval} ${unit}s`}, ${f.count} ${f.count === 1 ? "time" : "times"}, starting ${f.startDate}`;
}

// ---- billing drafts ----

export type DraftKind = "estimate" | "invoice" | "template";
export type DraftInput = { name: string; itemName: string; amount: number; qty: number; currency: string };
export const DRAFT_NAME_MAX = 80;
export const AMOUNT_MAX = 1_000_000;

export function checkDraft(v: unknown): { ok: true; value: DraftInput } | { ok: false; text: string } {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const name = plainText(o.name, DRAFT_NAME_MAX, "a name");
  if (!name.ok) return name;
  const itemName = plainText(o.itemName, DRAFT_NAME_MAX, "what it is for");
  if (!itemName.ok) return itemName;
  const amount = typeof o.amount === "string" && o.amount.trim() !== "" ? Number(o.amount) : o.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > AMOUNT_MAX) return { ok: false, text: `The amount must be more than 0 and at most ${AMOUNT_MAX.toLocaleString("en-US")}.` };
  if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return { ok: false, text: "Use at most two decimals." };
  const qtyRaw = o.qty ?? 1;
  const qty = typeof qtyRaw === "string" ? Number(qtyRaw) : qtyRaw;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 1000) return { ok: false, text: "Quantity must be a whole number from 1 to 1000." };
  const currency = typeof o.currency === "string" ? o.currency.trim().toUpperCase() : "USD";
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, text: "Use a three-letter currency code, for example USD." };
  return { ok: true, value: { name: name.text, itemName: itemName.text, amount: Math.round(amount * 100) / 100, qty, currency } };
}

export const draftTotal = (d: DraftInput): number => Math.round(d.amount * d.qty * 100) / 100;

export type DraftContact = { id: string; name: string; email: string | null; phone: string | null };
/** The platform needs a name, a phone and an email to save an estimate or invoice for a contact. Pure. */
export function contactForDraft(c: { id: string; name?: string | null; email?: string | null; phone?: string | null } | null): { ok: true; value: DraftContact & { email: string; phone: string; name: string } } | { ok: false; text: string } {
  if (!c) return { ok: false, text: "That contact is not available." };
  const name = (c.name ?? "").trim(), email = (c.email ?? "").trim(), phone = (c.phone ?? "").trim();
  if (!name || !email || !phone) return { ok: false, text: "This contact needs a name, an email and a phone number in your CRM before a quote or invoice can be saved for them." };
  return { ok: true, value: { id: c.id, name, email, phone } };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const item = (d: DraftInput) => ({ name: d.itemName, currency: d.currency, amount: d.amount, qty: d.qty, type: "one_time", taxInclusive: false });
const business = (businessName: string) => ({ name: businessName });
const noDiscount = { type: "percentage", value: 0 };

export function estimateBody(locationId: string, businessName: string, d: DraftInput, c: DraftContact & { email: string; phone: string }, now: Date = new Date()): Record<string, unknown> {
  return {
    altId: locationId, altType: "location", name: d.name, businessDetails: business(businessName), currency: d.currency, items: [item(d)], discount: noDiscount,
    contactDetails: { id: c.id, name: c.name, phoneNo: c.phone, email: c.email }, frequencySettings: { enabled: false, schedule: {} },
    issueDate: isoDay(now), expiryDate: isoDay(addDays(now, 14)), liveMode: true,
  };
}
export function invoiceBody(locationId: string, businessName: string, d: DraftInput, c: DraftContact & { email: string; phone: string }, now: Date = new Date()): Record<string, unknown> {
  return {
    altId: locationId, altType: "location", name: d.name, businessDetails: business(businessName), currency: d.currency, items: [item(d)], discount: noDiscount,
    contactDetails: { id: c.id, name: c.name, phoneNo: c.phone, email: c.email }, issueDate: isoDay(now), dueDate: isoDay(addDays(now, 14)), sentTo: { email: [c.email] }, liveMode: true,
  };
}
export const templateBody = (locationId: string, businessName: string, d: DraftInput): Record<string, unknown> => ({
  altId: locationId, altType: "location", name: d.name, businessDetails: business(businessName), currency: d.currency, items: [item(d)], discount: noDiscount,
});

// ---------------- writes ----------------

const ID = /^[A-Za-z0-9_-]{3,128}$/;

export type FollowUpWrite = Base & { contactId: string; followUp: FollowUp; ownerIds?: string[] };
export async function createFollowUp(a: FollowUpWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  if (!ID.test(a.contactId)) return { outcome: "blocked", text: "That contact is not available." };
  const c = checkFollowUp(a.followUp);
  if (!c.ok) return { outcome: "blocked", text: c.text };
  return run(a, {
    op: "recurring_task.create", what: "crm.recurring_task.create", verb: "WRITE", ids: { contactId: a.contactId }, fields: ["title", "contactIds", "rruleOptions"],
    req: () => ({ method: "POST", path: `/locations/${encodeURIComponent(a.locationId)}/recurring-tasks`, body: followUpBody(c.value, a.contactId, a.ownerIds) }),
    answerId: (j) => pick(j, "recurringTask", "id", "_id"),
  }, deps);
}

export type DraftWrite = Base & { kind: DraftKind; draft: DraftInput; businessName: string; contact: (DraftContact & { email: string; phone: string }) | null; now?: Date };
const recent = new Map<string, number>();
const RECENT_MS = 60_000;
export async function createDraft(a: DraftWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  const d = checkDraft(a.draft);
  if (!d.ok) return { outcome: "blocked", text: d.text };
  let body: Record<string, unknown>, path: string, op: string;
  if (a.kind === "template") { body = templateBody(a.locationId, a.businessName, d.value); path = "/invoices/template"; op = "invoice_template.create"; }
  else {
    const c = contactForDraft(a.contact);
    if (!c.ok) return { outcome: "blocked", text: c.text };
    if (a.kind === "estimate") { body = estimateBody(a.locationId, a.businessName, d.value, c.value, a.now); path = "/invoices/estimate"; op = "estimate.create"; }
    else { body = invoiceBody(a.locationId, a.businessName, d.value, c.value, a.now); path = "/invoices/"; op = "invoice.create"; }
  }
  // The same draft pressed twice within a minute is saved once (per server instance; the confirm button is also disabled while it works).
  const key = `${a.installationId}|${a.locationId}|${op}|${a.contact?.id ?? ""}|${d.value.name}|${d.value.itemName}|${d.value.amount}|${d.value.qty}`;
  return run(a, {
    op, what: `crm.${op}`, verb: "WRITE", ids: { contactId: a.contact?.id ?? null }, fields: Object.keys(body).filter((k) => k !== "altId" && k !== "altType"),
    before: async () => {
      const at = recent.get(key);
      if (at && Date.now() - at < RECENT_MS) return { outcome: "already" };
      recent.set(key, Date.now());
      if (recent.size > 500) for (const [k, t] of recent) if (Date.now() - t > RECENT_MS) recent.delete(k);
      return null;
    },
    req: () => ({ method: "POST", path, body }),
    answerId: (j) => pick(j, "_id", "id"),
  }, deps);
}
export const forgetRecentDrafts = () => recent.clear();

// ---------------- reads (never stored) ----------------

export type FollowUpRead = { found: boolean; title: string | null; nextRunAt: string | null };
/** Reads back the repeating follow-up just made, by the id the platform returned. */
export async function readFollowUp(a: { locationId: string; token: string; id: string }, d: ReadDeps = {}): Promise<ReadResult<FollowUpRead>> {
  if (!ID.test(a.id)) return { ok: true, value: { found: false, title: null, nextRunAt: null } };
  try {
    const res = await ghlFetch(`${GHL_API}/locations/${encodeURIComponent(a.locationId)}/recurring-tasks/${encodeURIComponent(a.id)}`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
    if (res.status === 404) return { ok: true, value: { found: false, title: null, nextRunAt: null } };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const j = (await res.json().catch(() => ({}))) as { recurringTask?: Record<string, unknown> };
    const t = j.recurringTask ?? {};
    const next = [t.nextRunAt, t.nextExecutionAt, t.nextDueDate].find((x) => typeof x === "string") as string | undefined;
    return { ok: true, value: { found: true, title: typeof t.title === "string" ? t.title.slice(0, 120) : null, nextRunAt: next ?? null } };
  } catch { return { ok: false, reason: "unavailable" }; }
}

export type EmailTemplateRow = { id: string; name: string; type: string; updatedAt: string | null };
export type EmailTemplateInventory = { templates: EmailTemplateRow[]; folders: number; truncated: boolean; plainText: number };
/** The account's email templates, names and dates only (never the content), read live in pages of 20. */
export async function listEmailTemplates(a: { locationId: string; token: string }, d: ReadDeps = {}, maxPages = 10): Promise<ReadResult<EmailTemplateInventory>> {
  try {
    const templates: EmailTemplateRow[] = [];
    let folders = 0, plain = 0, total: number | null = null, truncated = false;
    for (let page = 0; ; page++) {
      if (page >= maxPages) { truncated = true; break; }
      const res = await ghlFetch(`${GHL_API}/emails/locations/${encodeURIComponent(a.locationId)}/templates?limit=20&offset=${page * 20}&include=all&sortBy=updatedAt&sortOrder=desc`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
      if (!res.ok) return { ok: false, reason: "unavailable" };
      const j = (await res.json().catch(() => ({}))) as { items?: Array<Record<string, unknown>>; total?: unknown };
      const items = Array.isArray(j.items) ? j.items : [];
      if (typeof j.total === "number") total = j.total;
      for (const it of items) {
        if (it.type === "folder") { folders++; continue; }
        if (it.isPlainText === true) plain++;
        templates.push({ id: String(it.id ?? ""), name: typeof it.name === "string" ? it.name.slice(0, 120) : "Untitled", type: typeof it.editorType === "string" ? it.editorType : "email", updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : null });
      }
      if (items.length < 20 || (total !== null && (page + 1) * 20 >= total)) break;
    }
    return { ok: true, value: { templates, folders, truncated, plainText: plain } };
  } catch { return { ok: false, reason: "unavailable" }; }
}

export type InstallerInfo = { planId: string | null; isWhitelabel: boolean | null; installedAt: string | null; fields: string[] };
/** The platform's record of who installed SubSync and on which plan, for the key that asks (an agency key). Ids and field names only; no name or email is returned. */
export async function readInstaller(a: { appId: string; token: string }, d: ReadDeps = {}): Promise<ReadResult<InstallerInfo>> {
  try {
    const res = await ghlFetch(`${GHL_API}/marketplace/app/${encodeURIComponent(a.appId)}/installations`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const rec = (Array.isArray(j.installations) ? j.installations[0] : Array.isArray(j.data) ? j.data[0] : j.installation ?? j) as Record<string, unknown> | undefined;
    const r = rec && typeof rec === "object" ? rec : {};
    const plan = [r.planId, (r.plan as Record<string, unknown> | undefined)?.id].find((x) => typeof x === "string" && x) as string | undefined;
    const when = [r.installedAt, r.createdAt].find((x) => typeof x === "string") as string | undefined;
    return { ok: true, value: { planId: plan ?? null, isWhitelabel: typeof r.isWhitelabelCompany === "boolean" ? r.isWhitelabelCompany : null, installedAt: when ?? null, fields: Object.keys(r).sort().slice(0, 30) } };
  } catch { return { ok: false, reason: "unavailable" }; }
}

// ---------------- pipeline stage rename ----------------
// GET /opportunities/pipelines/{id} needs `pipelines.readonly` and PUT /opportunities/pipelines/{id} needs `pipelines.write` (the platform's own description, read 14 Nov 2026 through the
// operation catalogue; NOT VERIFIED LIVE). The update replaces the whole stage list, so SubSync reads the pipeline just before, changes ONE name, and sends every stage back with its id
// and position: no stage is added, removed or moved, so no deal changes stage.
export const PIPELINE_READ_SCOPE = "pipelines.readonly";
export const PIPELINE_WRITE_SCOPE = "pipelines.write";
export const STAGE_NAME_MAX = 60;

export type StageRow = { id: string; name: string; position: number; [k: string]: unknown };
export type PipelineRead = { id: string; name: string; stages: StageRow[] };

export function checkStageName(v: unknown): { ok: true; name: string } | { ok: false; text: string } {
  const c = plainText(v, STAGE_NAME_MAX, "a stage name");
  return c.ok ? { ok: true, name: c.text } : c;
}
/** Plan a rename. Pure. `blocked` says why not; `same` means nothing to do; `change` carries the full stage list to send back. */
export function planStageRename(p: PipelineRead, stageId: string, newName: string): { kind: "blocked"; text: string } | { kind: "same" } | { kind: "change"; from: string; stages: StageRow[] } {
  const target = p.stages.find((s) => s.id === stageId);
  if (!target) return { kind: "blocked", text: "That stage is not in this pipeline any more." };
  if (target.name.trim() === newName) return { kind: "same" };
  if (p.stages.some((s) => s.id !== stageId && s.name.trim().toLowerCase() === newName.toLowerCase())) return { kind: "blocked", text: "Another stage in this pipeline already has that name. Stage names must be different." };
  return { kind: "change", from: target.name, stages: p.stages.map((s) => (s.id === stageId ? { ...s, name: newName } : s)) };
}
export const stageUpdateBody = (stages: StageRow[]): Record<string, unknown> => ({ stages: stages.map((s) => ({ ...s, id: s.id, name: s.name, position: s.position })) });

/** One pipeline with its stages, read live (never stored). */
export async function readPipeline(a: { pipelineId: string; token: string }, d: ReadDeps = {}): Promise<ReadResult<PipelineRead | null>> {
  if (!ID.test(a.pipelineId)) return { ok: true, value: null };
  try {
    const res = await ghlFetch(`${GHL_API}/opportunities/pipelines/${encodeURIComponent(a.pipelineId)}`, { headers: hdr(a.token), cache: "no-store" }, opts(d));
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "needs_permission" };
    if (res.status === 404) return { ok: true, value: null };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const p = (j.pipeline && typeof j.pipeline === "object" ? j.pipeline : j) as Record<string, unknown>;
    const stages = (Array.isArray(p.stages) ? p.stages : []).filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string" && typeof (s as { name?: unknown }).name === "string")
      .map((s, i) => ({ ...s, id: s.id as string, name: s.name as string, position: typeof s.position === "number" ? s.position : i }));
    return { ok: true, value: { id: String(p.id ?? a.pipelineId), name: typeof p.name === "string" ? p.name : "", stages } };
  } catch { return { ok: false, reason: "unavailable" }; }
}

export type StageRenameWrite = Base & { pipelineId: string; stageId: string; newName: string; current: PipelineRead; recheck?: () => Promise<PipelineRead | null | undefined> };
export async function renameStage(a: StageRenameWrite, deps: GatewayDeps = {}): Promise<SafeWriteResult> {
  if (!ID.test(a.pipelineId) || !ID.test(a.stageId)) return { outcome: "blocked", text: "That stage is not available." };
  const n = checkStageName(a.newName);
  if (!n.ok) return { outcome: "blocked", text: n.text };
  const first = planStageRename(a.current, a.stageId, n.name);
  if (first.kind === "blocked") return { outcome: "blocked", text: first.text };
  if (first.kind === "same") return { outcome: "unchanged" };
  let stages = first.stages;
  return run(a, {
    op: "pipeline.stage_rename", what: "crm.pipeline.update", verb: "WRITE", ids: { pipelineId: a.pipelineId, stageId: a.stageId }, fields: ["stages"],
    // Last check on the live path: read the pipeline again, so a stage added or moved since the preview is never overwritten.
    before: async () => {
      if (!a.recheck) return null;
      const now = await a.recheck();
      if (now === undefined) return { outcome: "failed", status: 0 };
      if (!now) return { outcome: "blocked", text: "That pipeline is not in your CRM any more." };
      const p = planStageRename(now, a.stageId, n.name);
      if (p.kind === "blocked") return { outcome: "blocked", text: p.text };
      if (p.kind === "same") return { outcome: "unchanged" };
      stages = p.stages;
      return null;
    },
    req: () => ({ method: "PUT", path: `/opportunities/pipelines/${encodeURIComponent(a.pipelineId)}`, body: stageUpdateBody(stages) }),
  }, deps);
}
