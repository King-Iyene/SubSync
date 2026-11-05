import { outward } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { recordWrite, SPACING_MS, VERSION, type GatewayDeps } from "./crm-gateway.ts";
import { ghlFetch } from "./http.ts";

// The Lead workbench gateway (stage MOAT). Every action a person takes on a lead from inside SubSync (send a message, note, task, tag, owner, fields, deal, appointment status,
// delete) is planned and run here, and only here. It sits on the same switches as the Clean-up gateway (src/lib/ghl/crm-gateway.ts): WRITE_GHL_LIVE off by default, the per-account
// opt-in, a preview before and a confirm click, guardrails (Do Not Disturb, quiet hours, empty or oversized text, a typed name before a delete), rate limits, one audit line per write
// with ids and field names ONLY (never a message, a note, a name, an email or a phone number) and, where the platform allows it, an inverse action so the change can be undone.
// With the switch off (or the account not allowed) the whole thing is a dry run: the request is built, "WOULD WRITE ..." is recorded and NOTHING is sent.
// Tests use a stubbed fetch only. Request shapes follow the platform's official OpenAPI files (docs/features/MOAT.md) and are NOT VERIFIED LIVE.

export type Channel = "SMS" | "Email" | "WhatsApp";
export type DealStatus = "open" | "won" | "lost" | "abandoned";
export type ApptStatus = "showed" | "noshow" | "cancelled" | "confirmed";
export type CallOutcome = "no_answer" | "spoke" | "booked" | "wrong_number";

export type Action =
  | { kind: "message"; channel: Channel; text: string; subject?: string }
  | { kind: "note"; text: string }
  | { kind: "note_delete"; noteId: string }
  | { kind: "task"; title: string; dueDate: string; body?: string; assignedTo?: string }
  | { kind: "task_delete"; taskId: string }
  | { kind: "tag_add" | "tag_remove"; tag: string }
  | { kind: "owner"; userId: string }
  | { kind: "fields"; fields: Partial<Record<"firstName" | "lastName" | "email" | "phone", string>> }
  | { kind: "deal"; opportunityId: string; pipelineId?: string; stageId?: string; status?: DealStatus; value?: number; ownerId?: string }
  | { kind: "appointment"; appointmentId: string; status: ApptStatus }
  | { kind: "delete"; confirmText: string }
  | { kind: "call_note"; outcome: CallOutcome };

export const CALL_OUTCOME_WORDS: Record<CallOutcome, string> = { no_answer: "no answer", spoke: "spoke with the person", booked: "booked an appointment", wrong_number: "wrong number" };
/** What can only be done by the owner's side (a client's staff may message and note on their own account but never delete). */
export const OWNER_ONLY: ReadonlySet<Action["kind"]> = new Set(["delete"]);

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const MAX = { sms: 1000, email: 10000, note: 5000, tag: 60, title: 200, name: 80 } as const;

/** What the workbench knows about the lead being acted on. Read from SubSync's own copy by the route, never from the browser. */
export type Target = { locationId: string; contactId: string; name: string; dnd: boolean; phone: string | null; email: string | null; timeZone: string | null };

export type Blocker = { id: string; text: string };
export type Req = { method: "POST" | "PUT" | "DELETE"; path: string; version: string; scope: string; body?: Record<string, unknown> };
export type Plan = {
  kind: Action["kind"]; op: string; req: Req | null; fields: string[]; blockers: Blocker[]; warnings: Blocker[];
  /** A short plain sentence for the preview ("Send this text to Dana Cole"). May name the person; it goes to the browser only, never to a log. */
  summary: string; reversible: boolean;
};

const seg = encodeURIComponent;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Parses what the browser sent into an Action, or says what is wrong. Unknown keys are dropped. */
export function parseAction(raw: unknown): { ok: true; action: Action } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const bad = (error: string) => ({ ok: false as const, error });
  switch (o.kind) {
    case "message": {
      const channel = s("channel"); const text = s("text");
      if (channel !== "SMS" && channel !== "Email" && channel !== "WhatsApp") return bad("Choose text, email or WhatsApp");
      if (text === null) return bad("Write a message");
      return { ok: true, action: { kind: "message", channel, text, ...(s("subject") !== null ? { subject: s("subject") as string } : {}) } };
    }
    case "note": return s("text") === null ? bad("Write the note") : { ok: true, action: { kind: "note", text: s("text") as string } };
    case "note_delete": return s("noteId") && ID.test(s("noteId") as string) ? { ok: true, action: { kind: "note_delete", noteId: s("noteId") as string } } : bad("Unknown note");
    case "task": {
      if (s("title") === null || s("dueDate") === null) return bad("Give the task a title and a due date");
      return { ok: true, action: { kind: "task", title: s("title") as string, dueDate: s("dueDate") as string, ...(s("body") ? { body: s("body") as string } : {}), ...(s("assignedTo") && ID.test(s("assignedTo") as string) ? { assignedTo: s("assignedTo") as string } : {}) } };
    }
    case "task_delete": return s("taskId") && ID.test(s("taskId") as string) ? { ok: true, action: { kind: "task_delete", taskId: s("taskId") as string } } : bad("Unknown task");
    case "tag_add": case "tag_remove": return s("tag") === null ? bad("Name the tag") : { ok: true, action: { kind: o.kind, tag: s("tag") as string } };
    case "owner": return s("userId") && ID.test(s("userId") as string) ? { ok: true, action: { kind: "owner", userId: s("userId") as string } } : bad("Choose a team member");
    case "fields": {
      const f = (o.fields && typeof o.fields === "object" ? o.fields : {}) as Record<string, unknown>;
      const out: Partial<Record<"firstName" | "lastName" | "email" | "phone", string>> = {};
      for (const k of ["firstName", "lastName", "email", "phone"] as const) if (typeof f[k] === "string") out[k] = f[k] as string;
      return Object.keys(out).length ? { ok: true, action: { kind: "fields", fields: out } } : bad("Nothing to change");
    }
    case "deal": {
      if (!s("opportunityId") || !ID.test(s("opportunityId") as string)) return bad("Unknown deal");
      const status = s("status");
      if (status !== null && !["open", "won", "lost", "abandoned"].includes(status)) return bad("Unknown deal status");
      const value = typeof o.value === "number" ? o.value : undefined;
      return { ok: true, action: { kind: "deal", opportunityId: s("opportunityId") as string, ...(s("pipelineId") && ID.test(s("pipelineId") as string) ? { pipelineId: s("pipelineId") as string } : {}), ...(s("stageId") && ID.test(s("stageId") as string) ? { stageId: s("stageId") as string } : {}), ...(status ? { status: status as DealStatus } : {}), ...(value !== undefined ? { value } : {}), ...(s("ownerId") && ID.test(s("ownerId") as string) ? { ownerId: s("ownerId") as string } : {}) } };
    }
    case "appointment": {
      const st = s("status");
      if (!s("appointmentId") || !ID.test(s("appointmentId") as string)) return bad("Unknown appointment");
      if (st !== "showed" && st !== "noshow" && st !== "cancelled" && st !== "confirmed") return bad("Unknown appointment status");
      return { ok: true, action: { kind: "appointment", appointmentId: s("appointmentId") as string, status: st } };
    }
    case "delete": return { ok: true, action: { kind: "delete", confirmText: s("confirmText") ?? "" } };
    case "call_note": {
      const oc = s("outcome");
      return oc === "no_answer" || oc === "spoke" || oc === "booked" || oc === "wrong_number" ? { ok: true, action: { kind: "call_note", outcome: oc } } : bad("Unknown call outcome");
    }
    default: return bad("Unknown action");
  }
}

/** True when `now` falls outside 08:00 to 21:00 in the account's time zone (null when the zone is unknown). */
export function outsideCallingHours(timeZone: string | null, now: Date): boolean | null {
  if (!timeZone) return null;
  try {
    const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(now).replace(/\D/g, ""));
    return !(h >= 8 && h < 21) || Number.isNaN(h) ? true : false;
  } catch { return null; }
}

/** Builds the request and every check for one action. Pure: no network, no database. */
export function planAction(a: Action, t: Target, now: Date = new Date()): Plan {
  const blockers: Blocker[] = []; const warnings: Blocker[] = [];
  const c = seg(t.contactId);
  const mk = (op: string, req: Req | null, fields: string[], summary: string, reversible: boolean): Plan => ({ kind: a.kind, op, req, fields, blockers, warnings, summary, reversible });
  switch (a.kind) {
    case "message": {
      const text = a.text.trim();
      if (t.dnd) blockers.push({ id: "dnd", text: `${t.name} asked not to be contacted. SubSync will not send them anything.` });
      if (a.channel === "Email" ? !t.email : !t.phone) blockers.push({ id: "no_destination", text: a.channel === "Email" ? "This person has no email address." : "This person has no phone number." });
      if (!text) blockers.push({ id: "empty", text: "Write the message first." });
      if (text.length > (a.channel === "Email" ? MAX.email : MAX.sms)) blockers.push({ id: "too_long", text: `That is too long for ${a.channel === "Email" ? "an email" : "a text"}.` });
      if (a.channel === "Email" && !(a.subject ?? "").trim()) blockers.push({ id: "no_subject", text: "Add a subject." });
      if (a.channel !== "Email" && outsideCallingHours(t.timeZone, now) === true) warnings.push({ id: "quiet_hours", text: "It is outside 8am to 9pm where this person is. Many places restrict texting at these hours." });
      const body: Record<string, unknown> = { type: a.channel, contactId: t.contactId, message: text };
      if (a.channel === "Email") { body.subject = (a.subject ?? "").trim(); body.html = text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""); }
      return mk("message.send", { method: "POST", path: "/conversations/messages", version: "2021-04-15", scope: "conversations/message.write", body }, a.channel === "Email" ? ["type", "subject", "message"] : ["type", "message"], `Send this ${a.channel === "Email" ? "email" : a.channel === "SMS" ? "text" : "WhatsApp message"} to ${t.name}`, false);
    }
    case "note": {
      const text = a.text.trim();
      if (!text) blockers.push({ id: "empty", text: "Write the note first." });
      if (text.length > MAX.note) blockers.push({ id: "too_long", text: "That note is too long." });
      return mk("note.create", { method: "POST", path: `/contacts/${c}/notes`, version: VERSION, scope: "contacts.write", body: { body: text } }, ["body"], `Add this note to ${t.name}`, true);
    }
    case "note_delete": return mk("note.delete", { method: "DELETE", path: `/contacts/${c}/notes/${seg(a.noteId)}`, version: VERSION, scope: "contacts.write" }, ["noteId"], "Remove the note you just added", false);
    case "task": {
      const title = a.title.trim();
      if (!title) blockers.push({ id: "empty", text: "Give the task a title." });
      if (title.length > MAX.title) blockers.push({ id: "too_long", text: "That title is too long." });
      if (Number.isNaN(Date.parse(a.dueDate))) blockers.push({ id: "date", text: "Choose a due date." });
      const body: Record<string, unknown> = { title, dueDate: Number.isNaN(Date.parse(a.dueDate)) ? a.dueDate : new Date(a.dueDate).toISOString(), completed: false };
      if (a.body?.trim()) body.body = a.body.trim();
      if (a.assignedTo) body.assignedTo = a.assignedTo;
      return mk("task.create", { method: "POST", path: `/contacts/${c}/tasks`, version: VERSION, scope: "contacts.write", body }, ["title", "dueDate", ...(a.assignedTo ? ["assignedTo"] : [])], `Create the task for ${t.name}`, true);
    }
    case "task_delete": return mk("task.delete", { method: "DELETE", path: `/contacts/${c}/tasks/${seg(a.taskId)}`, version: VERSION, scope: "contacts.write" }, ["taskId"], "Remove the task you just created", false);
    case "tag_add": case "tag_remove": {
      const tag = a.tag.trim();
      if (!tag) blockers.push({ id: "empty", text: "Name the tag." });
      if (tag.length > MAX.tag) blockers.push({ id: "too_long", text: "That tag is too long." });
      return mk(a.kind === "tag_add" ? "tag.add" : "tag.remove", { method: a.kind === "tag_add" ? "POST" : "DELETE", path: `/contacts/${c}/tags`, version: VERSION, scope: "contacts.write", body: { tags: [tag] } }, ["tags"], `${a.kind === "tag_add" ? "Add" : "Remove"} the tag "${tag}" ${a.kind === "tag_add" ? "to" : "from"} ${t.name}`, true);
    }
    case "owner": return mk("owner.change", { method: "PUT", path: `/contacts/${c}`, version: VERSION, scope: "contacts.write", body: { assignedTo: a.userId } }, ["assignedTo"], `Change who owns ${t.name}`, true);
    case "fields": {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.fields)) {
        const val = (v ?? "").trim();
        if (k === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) blockers.push({ id: "email", text: "That email address does not look right." });
        if (k === "phone" && val && val.replace(/\D/g, "").length < 7) blockers.push({ id: "phone", text: "That phone number looks too short." });
        if ((k === "firstName" || k === "lastName") && val.length > MAX.name) blockers.push({ id: "too_long", text: "That name is too long." });
        body[k] = val;
      }
      return mk("fields.update", { method: "PUT", path: `/contacts/${c}`, version: VERSION, scope: "contacts.write", body }, Object.keys(body), `Change ${Object.keys(body).length === 1 ? "one detail" : "details"} on ${t.name}`, true);
    }
    case "deal": {
      const body: Record<string, unknown> = {};
      if (a.pipelineId) body.pipelineId = a.pipelineId;
      if (a.stageId) body.pipelineStageId = a.stageId;
      if (a.status) body.status = a.status;
      if (a.value !== undefined) { if (!Number.isFinite(a.value) || a.value < 0) blockers.push({ id: "value", text: "The value must be zero or more." }); body.monetaryValue = a.value; }
      if (a.ownerId) body.assignedTo = a.ownerId;
      if (!Object.keys(body).length) blockers.push({ id: "empty", text: "Nothing to change." });
      return mk("deal.update", { method: "PUT", path: `/opportunities/${seg(a.opportunityId)}`, version: VERSION, scope: "opportunities.write", body }, Object.keys(body), a.status === "won" ? "Mark this deal won" : a.status === "lost" ? "Mark this deal lost" : "Change this deal", true);
    }
    case "appointment": return mk("appointment.status", { method: "PUT", path: `/calendars/events/appointments/${seg(a.appointmentId)}`, version: VERSION, scope: "calendars/events.write", body: { appointmentStatus: a.status } }, ["appointmentStatus"], a.status === "showed" ? "Mark this appointment as showed up" : a.status === "noshow" ? "Mark this appointment as no-show" : a.status === "cancelled" ? "Cancel this appointment" : "Mark this appointment confirmed", true);
    case "delete": {
      if (!a.confirmText.trim() || !same(a.confirmText, t.name)) blockers.push({ id: "confirm", text: `Type the name "${t.name}" exactly to confirm.` });
      return mk("contact.delete", { method: "DELETE", path: `/contacts/${c}`, version: VERSION, scope: "contacts.write" }, ["contact"], `Delete ${t.name} from your CRM. This cannot be undone.`, false);
    }
    case "call_note": return mk("call.note", { method: "POST", path: `/contacts/${c}/notes`, version: VERSION, scope: "contacts.write", body: { body: `Call attempt from SubSync: ${CALL_OUTCOME_WORDS[a.outcome]}.` } }, ["body"], `Write "${CALL_OUTCOME_WORDS[a.outcome]}" in ${t.name}'s notes`, true);
  }
}

/** The values before a change (read from SubSync's copy by the route), used to build the undo. */
export type Before = { tags?: string[]; owner?: string | null; fields?: Partial<Record<"firstName" | "lastName" | "email" | "phone", string>>; deal?: { pipelineId?: string | null; stageId?: string | null; status?: string | null; value?: number | null; ownerId?: string | null }; appointmentStatus?: string | null };

/** The action that puts things back, or null when the platform offers no way (a sent message, a delete). Built on the server; it still passes every check when it is sent back. */
export function inverseOf(a: Action, before: Before, answerId: string | null): Action | null {
  switch (a.kind) {
    case "tag_add": return before.tags?.some((x) => same(x, a.tag)) ? null : { kind: "tag_remove", tag: a.tag };
    case "tag_remove": return before.tags?.some((x) => same(x, a.tag)) ? { kind: "tag_add", tag: a.tag } : null;
    case "owner": return before.owner ? { kind: "owner", userId: before.owner } : null;
    case "fields": { const f: Partial<Record<"firstName" | "lastName" | "email" | "phone", string>> = {}; for (const k of Object.keys(a.fields) as Array<keyof typeof a.fields>) if (before.fields && k in before.fields) f[k] = before.fields[k] ?? ""; return Object.keys(f).length ? { kind: "fields", fields: f } : null; }
    case "deal": {
      const d = before.deal; if (!d) return null;
      const inv: Extract<Action, { kind: "deal" }> = { kind: "deal", opportunityId: a.opportunityId };
      if (a.stageId && d.stageId) { inv.stageId = d.stageId; if (d.pipelineId) inv.pipelineId = d.pipelineId; }
      if (a.status && d.status) inv.status = d.status as DealStatus;
      if (a.value !== undefined && d.value !== null && d.value !== undefined) inv.value = d.value;
      if (a.ownerId && d.ownerId) inv.ownerId = d.ownerId;
      return Object.keys(inv).length > 2 ? inv : null;
    }
    case "appointment": return before.appointmentStatus && ["showed", "noshow", "cancelled", "confirmed"].includes(before.appointmentStatus) ? { kind: "appointment", appointmentId: a.appointmentId, status: before.appointmentStatus as ApptStatus } : null;
    case "note": case "call_note": return answerId ? { kind: "note_delete", noteId: answerId } : null;
    case "task": return answerId ? { kind: "task_delete", taskId: answerId } : null;
    default: return null;
  }
}

// ---------------- limits (best effort, per server instance) ----------------

const hits = new Map<string, number[]>();
/** Returns 0 when the call may go ahead, else how many seconds to wait. Keys are ids or hashes, never text. */
export function takeSlot(key: string, limit: number, windowMs: number, now = Date.now()): number {
  const list = (hits.get(key) ?? []).filter((x) => now - x < windowMs);
  if (list.length >= limit) { hits.set(key, list); return Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000)); }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => now - x >= windowMs)) hits.delete(k);
  return 0;
}
export const resetLimits = () => hits.clear();
export const LIMITS = { perAccountPerMinute: 30, messagesPerContactPerMinute: 3 } as const;

const hashText = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };

export type RunArgs = {
  installationId: string; actor: string | null; target: Target; action: Action;
  /** The person's account has been allowed to change things from SubSync (Settings). */
  optedIn: boolean;
  /** The person clicked the confirm button after the preview. */
  confirmed: boolean;
  /** Warning ids the person ticked ("quiet_hours"). */
  ack: readonly string[];
  token: () => Promise<string>;
  now?: Date;
};

export type RunResult =
  | { outcome: "blocked"; blockers: Blocker[] }
  | { outcome: "needs_ack"; warnings: Blocker[] }
  | { outcome: "needs_confirm" }
  | { outcome: "dry_run"; line: string; reason: "switch" | "account"; summary: string }
  | { outcome: "done"; id: string | null; summary: string }
  | { outcome: "needs_permission" }
  | { outcome: "rate_limited"; retryInSeconds: number }
  | { outcome: "failed"; status: number };

/** The id the CRM gave a new note or task, from the places its answers put it. */
export function answerId(json: unknown): string | null {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const nested = (o.note ?? o.task ?? o.message ?? o.contact) as Record<string, unknown> | undefined;
  for (const v of [nested?.id, o.id, o.messageId, o.noteId, o.taskId]) if (typeof v === "string" && v) return v;
  return null;
}

/** Plans, checks and (only when everything says yes) sends one action. The ONLY door for workbench writes. */
export async function runAction(a: RunArgs, deps: GatewayDeps = {}): Promise<RunResult> {
  const plan = planAction(a.action, a.target, a.now ?? new Date());
  if (plan.blockers.length || !plan.req) return { outcome: "blocked", blockers: plan.blockers };
  const missing = plan.warnings.filter((w) => !a.ack.includes(w.id));
  if (missing.length) return { outcome: "needs_ack", warnings: missing };
  if (!a.confirmed) return { outcome: "needs_confirm" };
  const wait = takeSlot(`acct:${a.installationId}`, LIMITS.perAccountPerMinute, 60_000);
  if (wait) return { outcome: "rate_limited", retryInSeconds: wait };
  if (a.action.kind === "message") {
    const dup = takeSlot(`msg:${a.target.contactId}:${hashText(a.action.text)}`, 1, 60_000);
    if (dup) return { outcome: "blocked", blockers: [{ id: "duplicate", text: "That exact message was just sent to this person." }] };
    const burst = takeSlot(`msgs:${a.target.contactId}`, LIMITS.messagesPerContactPerMinute, 60_000);
    if (burst) return { outcome: "rate_limited", retryInSeconds: burst };
  }
  const req = plan.req;
  // Not allowed for this account: the same dry run as the switch being off (an empty environment can never be live).
  const env = a.optedIn ? deps.env : {};
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: a.action.kind === "message" ? "SEND" : "WRITE", what: `crm.workbench.${plan.op}`, installationId: a.installationId, ids: { locationId: a.target.locationId, contactId: a.target.contactId }, fields: plan.fields },
    async (): Promise<RunResult> => {
      await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(SPACING_MS);
      const res = await ghlFetch(
        `${GHL_API}${req.path}`,
        { method: req.method, headers: { Authorization: `Bearer ${await a.token()}`, Version: req.version, Accept: "application/json", "Content-Type": "application/json" }, ...(req.body ? { body: JSON.stringify(req.body) } : {}), cache: "no-store" },
        { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
      );
      const result: RunResult = res.status === 401 || res.status === 403 ? { outcome: "needs_permission" } : res.ok ? { outcome: "done", id: answerId(await res.json().catch(() => ({}))), summary: plan.summary } : { outcome: "failed", status: res.status };
      await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.target.locationId, contactId: a.target.contactId, op: `workbench.${plan.op}`, fields: plan.fields, result: result.outcome }, deps);
      return result;
    },
    { ...deps, ...(env ? { env } : {}) },
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line, reason: a.optedIn ? "switch" : "account", summary: plan.summary };
}

/** Plain words for a refusal from the platform. */
export function failureText(status: number): string {
  if (status === 429) return "Your CRM asked SubSync to slow down. Wait a minute and try again.";
  if (status === 400 || status === 422) return "Your CRM did not accept that. Check the details and try again.";
  if (status === 404) return "Your CRM could not find it. It may have been removed there.";
  return "Your CRM did not answer. Nothing was changed. Try again in a moment.";
}

// ---------------- reading the conversation (shown, never stored) ----------------

export type ThreadMessage = { id: string; at: string; direction: "in" | "out"; channel: string; text: string; by: string | null; status: string | null };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const channelOf = (raw: string): string => (/email/i.test(raw) ? "Email" : /whats/i.test(raw) ? "WhatsApp" : /call/i.test(raw) ? "Call" : /sms|text/i.test(raw) ? "Text" : /fb|facebook/i.test(raw) ? "Facebook" : /ig|insta/i.test(raw) ? "Instagram" : /chat/i.test(raw) ? "Chat" : /comment/i.test(raw) ? "Internal note" : "Message");

/** Newest 50 messages of one conversation, oldest first. The text is held in memory for this one answer and is never written anywhere. Needs conversations/message.readonly. */
export async function fetchThread(token: string, conversationId: string, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<ThreadMessage[]> {
  const res = await ghlFetch(`${GHL_API}/conversations/${seg(conversationId)}/messages?limit=50`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" }, cache: "no-store" }, { ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("permission"), { status: res.status });
  if (!res.ok) throw Object.assign(new Error("unavailable"), { status: res.status });
  const body = rec(await res.json().catch(() => ({})));
  const inner = rec(body.messages);
  const list = Array.isArray(inner.messages) ? inner.messages : Array.isArray(body.messages) ? body.messages : [];
  const out: ThreadMessage[] = [];
  for (const m of list) {
    const r = rec(m);
    const at = typeof r.dateAdded === "string" ? Date.parse(r.dateAdded) : typeof r.dateAdded === "number" ? r.dateAdded : NaN;
    if (!Number.isFinite(at) || typeof r.id !== "string") continue;
    const text = typeof r.body === "string" ? r.body : "";
    out.push({ id: r.id, at: new Date(at).toISOString(), direction: String(r.direction ?? "").toLowerCase() === "inbound" ? "in" : "out", channel: channelOf(String(r.messageType ?? r.type ?? "")), text: text.length > 2000 ? `${text.slice(0, 2000)}...` : text, by: typeof r.userId === "string" ? r.userId : null, status: typeof r.status === "string" ? r.status : null });
  }
  return out.sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-50);
}

/** Fills {{first_name}}, {{name}}, {{owner}}, {{business}} in a template. Unknown fields are left out so a stray brace never reaches a customer. */
export function fillTemplate(text: string, v: { name: string; owner?: string | null; business?: string | null }): string {
  const first = v.name.trim().split(/\s+/)[0] ?? "";
  return text.replace(/\{\{\s*(first_name|name|owner|business)\s*\}\}/g, (_, k: string) => (k === "first_name" ? first : k === "name" ? v.name : k === "owner" ? v.owner ?? "" : v.business ?? "")).replace(/\{\{[^}]*\}\}/g, "");
}

export const TEMPLATES: ReadonlyArray<{ id: string; label: string; channel: Channel | "any"; subject?: string; text: string }> = [
  { id: "intro", label: "Quick hello", channel: "any", subject: "Quick question, {{first_name}}", text: "Hi {{first_name}}, this is {{owner}} from {{business}}. I saw your enquiry and wanted to check in. When is a good time to talk?" },
  { id: "missed", label: "Missed you", channel: "any", subject: "Sorry we missed you", text: "Hi {{first_name}}, I tried to reach you just now. Reply here when you have a minute, or tell me a good time to call." },
  { id: "reminder", label: "Appointment reminder", channel: "any", subject: "Your appointment", text: "Hi {{first_name}}, a quick reminder about your appointment with {{business}}. Reply to confirm or let me know if you need to change it." },
  { id: "noshow", label: "Sorry we missed you (no-show)", channel: "any", subject: "Let's find a new time", text: "Hi {{first_name}}, we missed you at your appointment. No problem at all. Want me to find you a new time this week?" },
];
