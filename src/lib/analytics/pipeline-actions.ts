// The rules for changing a deal from SubSync (Pipeline module, slice PB). Pure: no database, no network. The route reads the facts from SubSync's own copy of ONE account the
// caller may see, these functions decide what may happen and what the preview says, and the gateway (src/lib/ghl/pipeline-gateway.ts) is the only thing that sends.
// Definitions are in docs/METRICS.md ("Pipeline actions"). Nothing here sends a message to a lead.

export type DealFacts = {
  opportunityId: string; locationId: string; pipelineId: string | null; pipelineName: string | null; stageId: string | null; stageName: string | null;
  contactId: string | null; contactName: string; name: string; value: number | null; status: string | null; assignedTo: string | null;
  /** Facts about the person, for the protections. */
  contactDnd?: boolean; upcomingAppointments?: number; lastStageChangeAt?: string | null;
};
export type Blocker = { id: string; text: string };
export type StageRef = { id: string; name: string };
export type PipelineRef = { id: string; name: string; stages: StageRef[] };

export const LOST_REASONS = ["price", "no_response", "competitor", "not_ready", "not_a_fit", "bad_lead", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_WORDS: Record<LostReason, string> = {
  price: "Price too high", no_response: "Stopped responding", competitor: "Chose a competitor", not_ready: "Not ready to buy", not_a_fit: "Not a fit", bad_lead: "Bad or fake lead", other: "Other",
};
export const isLostReason = (v: unknown): v is LostReason => typeof v === "string" && (LOST_REASONS as readonly string[]).includes(v);

export const DEAL_STATUSES = ["open", "won", "lost", "abandoned"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const STATUS_WORDS: Record<string, string> = { open: "Open", won: "Won", lost: "Lost", abandoned: "Abandoned" };
export const statusWord = (s: string | null | undefined) => STATUS_WORDS[(s ?? "open").toLowerCase()] ?? "Open";

export const DEAL_BATCH_CAPS = { stage: 100, owner: 100, status: 100, task: 100, delete: 25 } as const;
export const MAX_VALUE = 100_000_000;
/** The undo note stays open this long. */
export const UNDO_MINUTES = 30;

const ID = /^[A-Za-z0-9_-]{3,128}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
export const money = (n: number | null | undefined) => `$${Math.round(n ?? 0).toLocaleString("en-US")}`;

export type DealAction =
  | { kind: "stage"; pipelineId: string; stageId: string }
  | { kind: "owner"; userId: string }
  | { kind: "value"; value: number }
  | { kind: "status"; status: DealStatus; reason?: LostReason; reasonNote?: string }
  | { kind: "rename"; name: string }
  | { kind: "note"; text: string }
  | { kind: "task"; title: string; dueDate: string }
  | { kind: "delete"; typed: string };

export function parseAction(raw: unknown): { ok: true; action: DealAction } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bad = (error: string) => ({ ok: false as const, error });
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  switch (o.kind) {
    case "stage": return isId(o.pipelineId) && isId(o.stageId) ? { ok: true, action: { kind: "stage", pipelineId: o.pipelineId, stageId: o.stageId } } : bad("Choose the stage");
    case "owner": return isId(o.userId) ? { ok: true, action: { kind: "owner", userId: o.userId } } : bad("Choose a team member");
    case "value": {
      const v = typeof o.value === "number" ? o.value : typeof o.value === "string" && o.value.trim() !== "" ? Number(o.value) : NaN;
      return Number.isFinite(v) && v >= 0 && v <= MAX_VALUE ? { ok: true, action: { kind: "value", value: Math.round(v * 100) / 100 } } : bad("The value must be a number between 0 and 100,000,000");
    }
    case "status": {
      if (!(DEAL_STATUSES as readonly unknown[]).includes(o.status)) return bad("Choose open, won, lost or abandoned");
      const a: Extract<DealAction, { kind: "status" }> = { kind: "status", status: o.status as DealStatus };
      if (o.reason !== undefined) { if (!isLostReason(o.reason)) return bad("Choose one of the listed reasons"); a.reason = o.reason; }
      const n = text(o.reasonNote, 200); if (n) a.reasonNote = n;
      return { ok: true, action: a };
    }
    case "rename": { const n = text(o.name, 120); return n ? { ok: true, action: { kind: "rename", name: n } } : bad("Give the deal a name"); }
    case "note": { const t = text(o.text, 5000); return t ? { ok: true, action: { kind: "note", text: t } } : bad("Write the note"); }
    case "task": {
      const t = text(o.title, 200), d = typeof o.dueDate === "string" && Number.isFinite(Date.parse(o.dueDate)) ? new Date(Date.parse(o.dueDate)).toISOString() : null;
      return t && d ? { ok: true, action: { kind: "task", title: t, dueDate: d } } : bad("Give the task a title and a due date");
    }
    case "delete": return { ok: true, action: { kind: "delete", typed: typeof o.typed === "string" ? o.typed.slice(0, 160) : "" } };
    default: return bad("Unknown action");
  }
}

// ---------------- delete confirmation ----------------

/** The words that confirm one delete: the deal's name or the word DELETE, case-insensitive. */
export const deleteWords = (f: Pick<DealFacts, "name">) => ["DELETE", ...(f.name.trim() && f.name.trim().length <= 120 ? [f.name.trim()] : [])];
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const deleteConfirmed = (typed: string, f: Pick<DealFacts, "name">) => norm(typed).length > 0 && deleteWords(f).some((w) => norm(w) === norm(typed));
/** The phrase for a bulk delete is the exact count, so nobody confirms without reading how many. */
export const bulkDeletePhrase = (n: number) => `delete ${n}`;
export const bulkDeleteConfirmed = (typed: string, n: number) => n > 0 && norm(typed) === bulkDeletePhrase(n);

// ---------------- the preview ----------------

export type Change = { label: string; from: string; to: string };
export type DealPatch = { pipelineId?: string; stageId?: string; status?: DealStatus; value?: number; assignedTo?: string; name?: string };
export type DealPlan = {
  kind: DealAction["kind"]; summary: string; changes: Change[]; blockers: Blocker[]; warnings: Blocker[]; reversible: boolean;
  /** What the CRM will be sent for an update; null for a note, a task or a delete. */
  patch: DealPatch | null;
  /** For delete: what must be typed. */
  confirm: { needed: boolean; words: string[] } | null;
  /** For a lost mark: the reason kept in SubSync's own history. */
  reason: LostReason | null;
};

export type PlanCtx = { now: number; pipelines: readonly PipelineRef[]; teamIds: readonly string[] | null };
const DAY = 86_400_000;

export function planAction(a: DealAction, f: DealFacts, ctx: PlanCtx): DealPlan {
  const blockers: Blocker[] = []; const warnings: Blocker[] = []; const changes: Change[] = [];
  const plan = (p: Partial<DealPlan> & Pick<DealPlan, "kind" | "summary">): DealPlan => ({ changes, blockers, warnings, reversible: true, patch: null, confirm: null, reason: null, ...p });
  const who = `${f.name || "this deal"}${f.contactName && f.contactName !== f.name ? ` (${f.contactName})` : ""}`;
  const status = (f.status ?? "open").toLowerCase();
  switch (a.kind) {
    case "stage": {
      const pl = ctx.pipelines.find((p) => p.id === a.pipelineId);
      const st = pl?.stages.find((s) => s.id === a.stageId);
      if (!pl || !st) blockers.push({ id: "stage", text: "That pipeline or stage is not in this account." });
      else if (a.pipelineId === f.pipelineId && a.stageId === f.stageId) blockers.push({ id: "same", text: "The deal is already in that stage." });
      if (status !== "open") warnings.push({ id: "closed", text: `This deal is ${statusWord(status).toLowerCase()}. Moving it does not reopen it; reopen it first if you want it back in play.` });
      if (pl && f.pipelineId && a.pipelineId !== f.pipelineId) warnings.push({ id: "pipeline", text: "This moves the deal to a different pipeline." });
      changes.push({ label: "Stage", from: f.stageName ?? "none", to: st?.name ?? "unknown" });
      return plan({ kind: "stage", summary: `Move ${who} to ${st?.name ?? "another stage"}.`, patch: { ...(a.pipelineId !== f.pipelineId ? { pipelineId: a.pipelineId } : {}), stageId: a.stageId } });
    }
    case "owner": {
      if (a.userId === f.assignedTo) blockers.push({ id: "same", text: "That person already owns this deal." });
      if (ctx.teamIds && !ctx.teamIds.includes(a.userId)) blockers.push({ id: "owner", text: "That person is not on this account's team." });
      changes.push({ label: "Owner", from: f.assignedTo ? "current owner" : "nobody", to: "new owner" });
      // The CRM cannot be told "nobody", so a deal that had no owner cannot be put back to that.
      if (!f.assignedTo) warnings.push({ id: "noundo", text: "This deal has no owner now, and an owner cannot be taken off again from here, so Undo will not offer this one." });
      return plan({ kind: "owner", summary: `Give ${who} to another team member.`, patch: { assignedTo: a.userId }, reversible: !!f.assignedTo });
    }
    case "value": {
      if (a.value === (f.value ?? 0)) blockers.push({ id: "same", text: "That is already the value." });
      if ((f.value ?? 0) > 0 && a.value === 0) warnings.push({ id: "zero", text: "A deal worth $0 is left out of every money total." });
      if ((f.value ?? 0) > 0 && a.value > (f.value ?? 0) * 10) warnings.push({ id: "big", text: "This is more than ten times the old value. Check the number." });
      changes.push({ label: "Value", from: money(f.value), to: money(a.value) });
      return plan({ kind: "value", summary: `Change the value of ${who}.`, patch: { value: a.value } });
    }
    case "status": {
      if (a.status === status) blockers.push({ id: "same", text: `This deal is already ${statusWord(status).toLowerCase()}.` });
      let reason: LostReason | null = null;
      if (a.status === "lost" || a.status === "abandoned") {
        if (!a.reason) blockers.push({ id: "reason", text: "Choose why it was lost. Your reasons are what show where the money leaks." });
        else reason = a.reason;
      }
      if (a.status === "won" && !(f.value && f.value > 0)) warnings.push({ id: "novalue", text: "This deal has no value, so winning it adds $0 to your revenue. Set the value first if you know it." });
      if (a.status === "won" && f.upcomingAppointments) warnings.push({ id: "appt", text: `${f.name || "This person"} still has ${f.upcomingAppointments} upcoming appointment${f.upcomingAppointments === 1 ? "" : "s"}.` });
      if (status !== "open" && a.status !== status) warnings.push({ id: "reopen", text: `This deal was ${statusWord(status).toLowerCase()}. Changing it changes your win and loss counts.` });
      changes.push({ label: "Status", from: statusWord(status), to: statusWord(a.status) });
      if (reason) changes.push({ label: "Reason", from: "none", to: LOST_REASON_WORDS[reason] });
      return plan({ kind: "status", summary: `Mark ${who} ${statusWord(a.status).toLowerCase()}.`, patch: { status: a.status }, reason });
    }
    case "rename": {
      if (a.name === f.name) blockers.push({ id: "same", text: "That is already the name." });
      changes.push({ label: "Name", from: f.name || "none", to: a.name });
      return plan({ kind: "rename", summary: `Rename ${who}.`, patch: { name: a.name } });
    }
    case "note": {
      if (!f.contactId) blockers.push({ id: "contact", text: "This deal has no contact to put the note on." });
      changes.push({ label: "Internal note", from: "none", to: a.text.length > 80 ? `${a.text.slice(0, 80)}...` : a.text });
      warnings.push({ id: "internal", text: "An internal note on the contact. A note like this is internal: the lead never sees it." });
      return plan({ kind: "note", summary: `Add a note to ${f.contactName || "the contact"} about ${f.name || "this deal"}.`, reversible: false });
    }
    case "task": {
      if (!f.contactId) blockers.push({ id: "contact", text: "This deal has no contact to put the task on." });
      const due = Date.parse(a.dueDate);
      if (due < ctx.now - DAY) blockers.push({ id: "past", text: "Choose a due date that is not in the past." });
      if (due > ctx.now + 365 * DAY) blockers.push({ id: "far", text: "That is more than a year away." });
      changes.push({ label: "Task", from: "none", to: a.title });
      return plan({ kind: "task", summary: `Create a task for ${f.contactName || "the contact"}: ${a.title}.`, reversible: false });
    }
    case "delete": {
      if (status === "won") warnings.push({ id: "won", text: "This is a WON deal. Deleting it removes its revenue from your CRM's reports." });
      if (f.upcomingAppointments) warnings.push({ id: "appt", text: `This person has ${f.upcomingAppointments} upcoming appointment${f.upcomingAppointments === 1 ? "" : "s"}.` });
      if (status === "open" && (f.value ?? 0) > 0) warnings.push({ id: "open", text: `This is an open deal worth ${money(f.value)}. Mark it lost with a reason instead if you want to keep your loss records.` });
      const confirm = { needed: true, words: deleteWords(f) };
      if (!deleteConfirmed(a.typed, f)) blockers.push({ id: "confirm", text: `Type DELETE${confirm.words.length > 1 ? ` or "${confirm.words[1]}"` : ""} exactly to confirm.` });
      changes.push({ label: "Deal", from: `${who}, ${money(f.value)}`, to: "deleted" });
      return plan({ kind: "delete", summary: `Delete ${who}. This cannot be undone.`, reversible: false, confirm });
    }
  }
}

// ---------------- bulk ----------------

export type BulkKind = "stage" | "owner" | "status" | "task" | "delete";
export type BulkPlan = { allowed: DealFacts[]; skipped: Array<{ opportunityId: string; name: string; reason: string }>; overCap: number; phrase: string | null; totalValue: number };

/**
 * What a bulk change may touch. Deals already in the asked state are skipped. A bulk delete never touches a won deal, a deal whose person has an upcoming appointment, or an open
 * deal worth money (people finish those one at a time). More than the cap is cut and counted. One account at a time: the route reads every deal from the one account it was given.
 */
export function planBulk(kind: BulkKind, items: readonly DealFacts[], o: { stageId?: string; pipelineId?: string; userId?: string; status?: DealStatus }): BulkPlan {
  const seen = new Set<string>();
  const skipped: BulkPlan["skipped"] = []; const ok: DealFacts[] = [];
  const skip = (f: DealFacts, reason: string) => skipped.push({ opportunityId: f.opportunityId, name: f.name || f.contactName, reason });
  for (const f of items) {
    if (seen.has(f.opportunityId)) continue; seen.add(f.opportunityId);
    const status = (f.status ?? "open").toLowerCase();
    if (kind === "stage" && f.stageId === o.stageId && f.pipelineId === o.pipelineId) { skip(f, "already in that stage"); continue; }
    if (kind === "owner" && f.assignedTo === o.userId) { skip(f, "already theirs"); continue; }
    if (kind === "status" && status === o.status) { skip(f, "already that status"); continue; }
    if ((kind === "task") && !f.contactId) { skip(f, "no contact"); continue; }
    if (kind === "delete") {
      if (status === "won") { skip(f, "won deals are not deleted in bulk"); continue; }
      if (f.upcomingAppointments) { skip(f, "has an upcoming appointment"); continue; }
      if (status === "open" && (f.value ?? 0) > 0) { skip(f, "open deal with money in it"); continue; }
    }
    ok.push(f);
  }
  const allowed = ok.slice(0, DEAL_BATCH_CAPS[kind]);
  return { allowed, skipped, overCap: ok.length - allowed.length, phrase: kind === "delete" && allowed.length ? bulkDeletePhrase(allowed.length) : null, totalValue: allowed.reduce((s, f) => s + (f.value ?? 0), 0) };
}

// ---------------- unclog: one-tap suggestions for a stale deal ----------------

export type Unclog = { id: string; label: string; why: string; action: DealAction };
/**
 * The small fixes offered on a stale deal. Each one is an ordinary action and goes through the same preview and confirmation. Never a message to the lead. `nextStage` is the
 * stage after the current one in the same pipeline (null at the end). A deal with no owner is offered an owner first, because an ownerless deal is nobody's job.
 */
export function unclogSuggestions(f: DealFacts, o: { now: number; me: string | null; nextStage: StageRef | null; pipelineId: string | null; staleDays?: number | null }): Unclog[] {
  const out: Unclog[] = [];
  if ((f.status ?? "open").toLowerCase() !== "open") return out;
  const tomorrow = new Date(o.now + DAY); tomorrow.setUTCHours(9, 0, 0, 0);
  if (!f.assignedTo && o.me) out.push({ id: "claim", label: "Take this deal", why: "Nobody owns it, so nobody is chasing it.", action: { kind: "owner", userId: o.me } });
  if (f.contactId) out.push({ id: "task", label: "Follow up tomorrow", why: o.staleDays ? `Stuck ${Math.round(o.staleDays)} days in this stage. A task makes it somebody's job tomorrow.` : "A task makes it somebody's job tomorrow.", action: { kind: "task", title: `Follow up: ${f.name || f.contactName}`.slice(0, 200), dueDate: tomorrow.toISOString() } });
  if (o.nextStage && o.pipelineId) out.push({ id: "advance", label: `Move to ${o.nextStage.name}`, why: "If the work in this stage is done, move it on so the stage count is true.", action: { kind: "stage", pipelineId: o.pipelineId, stageId: o.nextStage.id } });
  out.push({ id: "lost", label: "Close as lost", why: "If it is dead, close it with a reason so your numbers stop counting it.", action: { kind: "status", status: "lost", reason: "no_response" } });
  return out;
}

export const nextStageOf = (ps: readonly PipelineRef[], pipelineId: string | null, stageId: string | null): StageRef | null => {
  const p = ps.find((x) => x.id === pipelineId); if (!p) return null;
  const i = p.stages.findIndex((s) => s.id === stageId);
  return i >= 0 && i + 1 < p.stages.length ? p.stages[i + 1] : null;
};

// ---------------- undo ----------------

/** The reverse of a change, from the `before` the log kept. Delete, note and task have none. */
export function inversePatch(kind: string, before: Record<string, unknown>): DealPatch | null {
  if (kind === "delete" || kind === "note" || kind === "task") return null;
  const p: DealPatch = {};
  if (typeof before.status === "string" && (DEAL_STATUSES as readonly string[]).includes(before.status)) p.status = before.status as DealStatus;
  if (typeof before.stageId === "string") { p.stageId = before.stageId; if (typeof before.pipelineId === "string") p.pipelineId = before.pipelineId; }
  if (typeof before.value === "number") p.value = before.value;
  if (typeof before.assignedTo === "string") p.assignedTo = before.assignedTo;
  if (typeof before.name === "string" && before.name) p.name = before.name;
  return Object.keys(p).length ? p : null;
}
/** What to remember so the change can be put back. Ids, a number and a status only. */
export function beforeOf(f: DealFacts, patch: DealPatch): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (patch.stageId !== undefined && f.stageId) { b.stageId = f.stageId; if (f.pipelineId) b.pipelineId = f.pipelineId; }
  if (patch.status !== undefined) b.status = (f.status ?? "open").toLowerCase();
  if (patch.value !== undefined) b.value = f.value ?? 0;
  if (patch.assignedTo !== undefined && f.assignedTo) b.assignedTo = f.assignedTo;
  if (patch.name !== undefined && f.name) b.name = f.name;
  return b;
}
