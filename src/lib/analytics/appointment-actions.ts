// The rules for changing an appointment from SubSync (Appointments module, slice AB). Pure: no database, no network. The route reads the facts from SubSync's own copy of ONE
// account the caller may see, these functions decide what may happen and what the preview says, and the gateway (src/lib/ghl/appointment-gateway.ts) is the only thing that sends.

export type ApptFacts = {
  appointmentId: string; locationId: string; calendarId: string | null; calendarName: string | null; contactId: string | null; contactName: string;
  title: string | null; status: string | null; startAt: string | null; endAt: string | null; assignedTo: string | null;
};
export type Blocker = { id: string; text: string };
export type OtherBooking = { appointmentId: string; startAt: string; endAt: string; assignedTo: string | null; calendarId: string | null; status: string | null; title: string | null };

/** What the CRM understands. "Completed" is our own word for a meeting that took place: the CRM records it as showed. */
export const CRM_STATUSES = ["new", "showed", "noshow", "cancelled", "invalid", "confirmed"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];
export const OUTCOME_CHOICES = ["showed", "noshow", "cancelled", "invalid", "completed"] as const;
export type OutcomeChoice = (typeof OUTCOME_CHOICES)[number];
export const STATUS_WORDS: Record<string, string> = { showed: "Showed", noshow: "No-show", cancelled: "Cancelled", invalid: "Invalid", confirmed: "Confirmed", completed: "Completed", new: "Booked" };
export const statusWord = (s: string | null | undefined) => STATUS_WORDS[(s ?? "new").toLowerCase().replace(/[\s_-]/g, "")] ?? "Booked";
export const crmStatusOf = (c: OutcomeChoice | CrmStatus): CrmStatus => (c === "completed" ? "showed" : c);

export const APPT_BATCH_CAPS = { status: 100, reassign: 100, delete: 25 } as const;
export const MAX_DURATION_MIN = 12 * 60;
export const MIN_DURATION_MIN = 5;
/** An appointment may be moved or created at most this far out. */
export const MAX_AHEAD_DAYS = 548;
/** The undo note stays open this long (the person can put the change back from the change list). */
export const UNDO_MINUTES = 30;

const ID = /^[A-Za-z0-9_-]{3,128}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const ms = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };

export type ApptAction =
  | { kind: "status"; status: OutcomeChoice }
  | { kind: "reschedule"; startAt: string; endAt: string; allowOverlap: boolean }
  | { kind: "reassign"; userId: string }
  | { kind: "edit"; title?: string; startAt?: string; endAt?: string; calendarId?: string; userId?: string; allowOverlap?: boolean }
  | { kind: "delete"; typed: string };

export type CreateInput = { contactId: string; calendarId: string; startAt: string; endAt: string; assignedTo: string | null; title: string; allowOverlap: boolean };

const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);

export function parseAction(raw: unknown): { ok: true; action: ApptAction } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bad = (error: string) => ({ ok: false as const, error });
  switch (o.kind) {
    case "status":
      return (OUTCOME_CHOICES as readonly unknown[]).includes(o.status) ? { ok: true, action: { kind: "status", status: o.status as OutcomeChoice } } : bad("Choose showed, no-show, cancelled, invalid or completed");
    case "reschedule": {
      const s = iso(o.startAt), e = iso(o.endAt);
      return s && e ? { ok: true, action: { kind: "reschedule", startAt: s, endAt: e, allowOverlap: o.allowOverlap === true } } : bad("Choose a new start and end time");
    }
    case "reassign": return isId(o.userId) ? { ok: true, action: { kind: "reassign", userId: o.userId } } : bad("Choose a team member");
    case "edit": {
      const a: Extract<ApptAction, { kind: "edit" }> = { kind: "edit" };
      if (o.title !== undefined) { if (typeof o.title !== "string") return bad("The title must be text"); a.title = o.title.trim().slice(0, 200); }
      if (o.startAt !== undefined) { const s = iso(o.startAt); if (!s) return bad("That start time is not a date"); a.startAt = s; }
      if (o.endAt !== undefined) { const e = iso(o.endAt); if (!e) return bad("That end time is not a date"); a.endAt = e; }
      if (o.calendarId !== undefined) { if (!isId(o.calendarId)) return bad("Unknown calendar"); a.calendarId = o.calendarId; }
      if (o.userId !== undefined) { if (!isId(o.userId)) return bad("Unknown team member"); a.userId = o.userId; }
      if (o.allowOverlap === true) a.allowOverlap = true;
      return Object.keys(a).length > 1 ? { ok: true, action: a } : bad("Nothing to change");
    }
    case "delete": return { ok: true, action: { kind: "delete", typed: typeof o.typed === "string" ? o.typed.slice(0, 120) : "" } };
    default: return bad("Unknown action");
  }
}

export function parseCreate(raw: unknown): { ok: true; input: CreateInput } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = iso(o.startAt), e = iso(o.endAt);
  if (!isId(o.contactId)) return { ok: false, error: "Choose the contact" };
  if (!isId(o.calendarId)) return { ok: false, error: "Choose the calendar" };
  if (!s || !e) return { ok: false, error: "Choose a start and end time" };
  if (o.assignedTo != null && !isId(o.assignedTo)) return { ok: false, error: "Unknown team member" };
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
  return { ok: true, input: { contactId: o.contactId, calendarId: o.calendarId, startAt: s, endAt: e, assignedTo: (o.assignedTo as string | null | undefined) ?? null, title: title || "Appointment", allowOverlap: o.allowOverlap === true } };
}

// ---------------- double bookings and best slots ----------------

/** Bookings that overlap [start, end) for the same person (a booking with no owner is compared on the calendar). Cancelled, invalid and no-show ones do not block a slot. */
export function findConflicts(start: string, end: string, others: readonly OtherBooking[], o: { assignedTo: string | null; calendarId: string | null; ignoreId?: string }): OtherBooking[] {
  const s = ms(start), e = ms(end);
  if (s === null || e === null) return [];
  return others.filter((x) => {
    if (x.appointmentId === o.ignoreId) return false;
    const st = (x.status ?? "").toLowerCase().replace(/[\s_-]/g, "");
    if (st === "cancelled" || st === "canceled" || st === "invalid" || st === "noshow") return false;
    const xs = ms(x.startAt), xe = ms(x.endAt);
    if (xs === null || xe === null || !(xs < e && s < xe)) return false;
    const samePerson = o.assignedTo !== null && x.assignedTo === o.assignedTo;
    const sameCalendarNoOwner = (o.assignedTo === null || x.assignedTo === null) && o.calendarId !== null && x.calendarId === o.calendarId;
    return samePerson || sameCalendarNoOwner;
  });
}

/**
 * Smart reschedule: the next free slots for this person, with no overlap, inside working hours (default 09:00 to 17:00, weekdays; the hours are given as the account's own local
 * offset in minutes so no time zone database is needed), starting after `from`, on a 30 minute grid. Slots where this person's earlier appointments at the same hour of day
 * showed up more often are ranked first when `hourShowRates` (hour of day to show rate, from the account's own history) is given; otherwise earliest first. Never invents a rate.
 */
export function suggestSlots(o: {
  from: number; durationMin: number; others: readonly OtherBooking[]; assignedTo: string | null; calendarId: string | null; ignoreId?: string;
  offsetMinutes?: number; dayStartHour?: number; dayEndHour?: number; daysAhead?: number; count?: number; hourShowRates?: Readonly<Record<number, number>> | null;
}): Array<{ startAt: string; endAt: string; reason: string }> {
  const off = (o.offsetMinutes ?? 0) * 60_000;
  const d0 = o.dayStartHour ?? 9, d1 = o.dayEndHour ?? 17, dur = Math.max(MIN_DURATION_MIN, Math.min(o.durationMin, MAX_DURATION_MIN)) * 60_000;
  const step = 30 * 60_000;
  const out: Array<{ s: number; rate: number | null }> = [];
  const start = Math.ceil((o.from + step) / step) * step;
  for (let t = start; t < o.from + (o.daysAhead ?? 14) * 86_400_000 && out.length < 200; t += step) {
    const local = new Date(t + off);
    const dow = local.getUTCDay(); const hr = local.getUTCHours() + local.getUTCMinutes() / 60;
    const endHr = hr + dur / 3_600_000;
    if (dow === 0 || dow === 6 || hr < d0 || endHr > d1) continue;
    if (findConflicts(new Date(t).toISOString(), new Date(t + dur).toISOString(), o.others, { assignedTo: o.assignedTo, calendarId: o.calendarId, ...(o.ignoreId ? { ignoreId: o.ignoreId } : {}) }).length) continue;
    const rate = o.hourShowRates ? o.hourShowRates[Math.floor(hr)] ?? null : null;
    out.push({ s: t, rate });
  }
  const ranked = o.hourShowRates ? [...out].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.s - b.s) : out;
  // At most one suggestion per day so the choices are really different.
  const seenDay = new Set<string>(); const picks: typeof out = [];
  for (const x of ranked) { const day = new Date(x.s + off).toISOString().slice(0, 10); if (seenDay.has(day)) continue; seenDay.add(day); picks.push(x); if (picks.length >= (o.count ?? 3)) break; }
  return picks.sort((a, b) => a.s - b.s).map((x) => ({ startAt: new Date(x.s).toISOString(), endAt: new Date(x.s + dur).toISOString(), reason: x.rate !== null ? `${Math.round(x.rate * 100)}% of past appointments at this hour showed up` : "Free for this person" }));
}

export function timeBlockers(start: string, end: string, now: number): Blocker[] {
  const out: Blocker[] = [];
  const s = ms(start), e = ms(end);
  if (s === null || e === null) return [{ id: "time", text: "Choose a start and end time." }];
  if (e <= s) out.push({ id: "order", text: "The end must be after the start." });
  else if ((e - s) / 60_000 < MIN_DURATION_MIN) out.push({ id: "short", text: `An appointment is at least ${MIN_DURATION_MIN} minutes long.` });
  else if ((e - s) / 60_000 > MAX_DURATION_MIN) out.push({ id: "long", text: "An appointment is at most 12 hours long." });
  if (s > now + MAX_AHEAD_DAYS * 86_400_000) out.push({ id: "far", text: "That is more than 18 months away." });
  return out;
}

// ---------------- the preview ----------------

export type Change = { label: string; from: string; to: string };
export type ApptPlan = {
  kind: ApptAction["kind"]; summary: string; changes: Change[]; blockers: Blocker[]; warnings: Blocker[]; conflicts: OtherBooking[];
  reversible: boolean;
  /** What the CRM will be sent; null when nothing can be sent. Times are ISO. */
  patch: { status?: CrmStatus; startAt?: string; endAt?: string; title?: string; calendarId?: string; assignedUserId?: string } | null;
  /** For delete: what must be typed. */
  confirm: { needed: boolean; words: string[] } | null;
};

export function fmt(isoStr: string, tz: string | null): string {
  const d = new Date(isoStr);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false };
  try { return d.toLocaleString("en-GB", tz ? { ...opts, timeZone: tz } : opts); } catch { return d.toLocaleString("en-GB", opts); }
}
export const whoWhenWhere = (f: ApptFacts, tz: string | null = null) => `${f.contactName}, ${f.startAt ? fmt(f.startAt, tz) : "no time"}, ${f.calendarName ?? "calendar"}`;

/** The words that confirm one delete: the person's name or the word DELETE, case-insensitive. */
export const deleteWords = (f: Pick<ApptFacts, "contactName">) => ["DELETE", ...(f.contactName.trim() && f.contactName !== "Unknown contact" ? [f.contactName.trim()] : [])];
export const deleteConfirmed = (typed: string, f: Pick<ApptFacts, "contactName">) => {
  const t = typed.trim().toLowerCase().replace(/\s+/g, " ");
  return t.length > 0 && deleteWords(f).some((w) => w.toLowerCase() === t);
};
/** The phrase for a bulk delete is the exact count, so nobody confirms without reading how many. */
export const bulkDeletePhrase = (n: number) => `delete ${n}`;
export const bulkDeleteConfirmed = (typed: string, n: number) => n > 0 && typed.trim().toLowerCase().replace(/\s+/g, " ") === bulkDeletePhrase(n);

export function planAction(a: ApptAction, f: ApptFacts, ctx: { now: number; others: readonly OtherBooking[]; teamIds: readonly string[] | null; tz?: string | null; calendarIds?: readonly string[] | null }): ApptPlan {
  const tz = ctx.tz ?? null;
  const blockers: Blocker[] = []; const warnings: Blocker[] = []; const changes: Change[] = [];
  const plan = (p: Partial<ApptPlan> & Pick<ApptPlan, "kind" | "summary">): ApptPlan => ({ changes, blockers, warnings, conflicts: [], reversible: true, patch: null, confirm: null, ...p });
  const who = whoWhenWhere(f, tz);
  const past = f.startAt !== null && Date.parse(f.startAt) < ctx.now;
  switch (a.kind) {
    case "status": {
      const crm = crmStatusOf(a.status);
      if ((f.status ?? "").toLowerCase() === crm && a.status !== "completed") blockers.push({ id: "same", text: `This appointment is already marked ${statusWord(crm).toLowerCase()}.` });
      if ((a.status === "showed" || a.status === "noshow" || a.status === "completed") && !past) blockers.push({ id: "future", text: "This appointment has not happened yet." });
      changes.push({ label: "Outcome", from: statusWord(f.status), to: statusWord(a.status) });
      if (a.status === "completed") warnings.push({ id: "completed", text: "Your CRM has no 'completed' status, so it is recorded as showed." });
      return plan({ kind: "status", summary: `Mark ${who} as ${statusWord(a.status).toLowerCase()}.`, patch: { status: crm } });
    }
    case "reschedule": case "edit": {
      const patch: NonNullable<ApptPlan["patch"]> = {};
      const startAt = a.kind === "reschedule" ? a.startAt : a.startAt ?? f.startAt;
      const endAt = a.kind === "reschedule" ? a.endAt : a.endAt ?? f.endAt;
      const timeChanged = a.kind === "reschedule" || a.startAt !== undefined || a.endAt !== undefined;
      if (timeChanged && startAt && endAt) {
        blockers.push(...timeBlockers(startAt, endAt, ctx.now));
        if (startAt !== f.startAt || endAt !== f.endAt) { patch.startAt = startAt; patch.endAt = endAt; changes.push({ label: "When", from: f.startAt ? fmt(f.startAt, tz) : "none", to: fmt(startAt, tz) }); }
      } else if (timeChanged) blockers.push({ id: "time", text: "This appointment has no time in SubSync yet, so choose both a start and an end." });
      if (a.kind === "edit") {
        if (a.title !== undefined && a.title !== (f.title ?? "")) { patch.title = a.title; changes.push({ label: "Title", from: f.title ?? "none", to: a.title || "none" }); }
        if (a.calendarId !== undefined && a.calendarId !== f.calendarId) {
          if (ctx.calendarIds && !ctx.calendarIds.includes(a.calendarId)) blockers.push({ id: "calendar", text: "That calendar is not in this account." });
          else { patch.calendarId = a.calendarId; changes.push({ label: "Calendar", from: f.calendarName ?? "none", to: "another calendar" }); }
        }
        if (a.userId !== undefined && a.userId !== f.assignedTo) {
          if (ctx.teamIds && !ctx.teamIds.includes(a.userId)) blockers.push({ id: "owner", text: "That person is not on this account's team." });
          else { patch.assignedUserId = a.userId; changes.push({ label: "Owner", from: f.assignedTo ? "current owner" : "nobody", to: "new owner" }); }
        }
      }
      if (changes.length === 0 && blockers.length === 0) blockers.push({ id: "nochange", text: "Nothing would change." });
      const owner = patch.assignedUserId ?? f.assignedTo;
      const conflicts = patch.startAt && patch.endAt ? findConflicts(patch.startAt, patch.endAt, ctx.others, { assignedTo: owner, calendarId: patch.calendarId ?? f.calendarId, ignoreId: f.appointmentId }) : [];
      const allow = a.allowOverlap === true;
      if (conflicts.length > 0 && !allow) blockers.push({ id: "double_booking", text: `That is a double booking: ${conflicts.length} other appointment${conflicts.length === 1 ? "" : "s"} overlap${conflicts.length === 1 ? "s" : ""} for the same person. Choose another time, or tick "Book anyway".` });
      else if (conflicts.length > 0) warnings.push({ id: "forced", text: `Booked on top of ${conflicts.length} other appointment${conflicts.length === 1 ? "" : "s"}, because you chose to.` });
      if (patch.startAt && Date.parse(patch.startAt) < ctx.now) warnings.push({ id: "past", text: "The new time is in the past." });
      return plan({ kind: a.kind, summary: a.kind === "reschedule" ? `Move ${who}.` : `Change ${who}.`, patch: Object.keys(patch).length ? patch : null, conflicts });
    }
    case "reassign": {
      if (a.userId === f.assignedTo) blockers.push({ id: "same", text: "That person already owns this appointment." });
      if (ctx.teamIds && !ctx.teamIds.includes(a.userId)) blockers.push({ id: "owner", text: "That person is not on this account's team." });
      changes.push({ label: "Owner", from: f.assignedTo ? "current owner" : "nobody", to: "new owner" });
      const conflicts = f.startAt && f.endAt ? findConflicts(f.startAt, f.endAt, ctx.others, { assignedTo: a.userId, calendarId: f.calendarId, ignoreId: f.appointmentId }) : [];
      if (conflicts.length) warnings.push({ id: "busy", text: `The new owner already has ${conflicts.length} appointment${conflicts.length === 1 ? "" : "s"} at that time.` });
      return plan({ kind: "reassign", summary: `Give ${who} to another team member.`, patch: { assignedUserId: a.userId }, conflicts });
    }
    case "delete": {
      if (past && (f.status ?? "").toLowerCase() === "showed") warnings.push({ id: "history", text: "This appointment was marked as showed. Deleting it removes it from your CRM's reports." });
      const confirm = { needed: true, words: deleteWords(f) };
      if (!deleteConfirmed(a.typed, f)) blockers.push({ id: "confirm", text: `Type DELETE${confirm.words.length > 1 ? ` or "${confirm.words[1]}"` : ""} exactly to confirm.` });
      changes.push({ label: "Appointment", from: who, to: "deleted" });
      return plan({ kind: "delete", summary: `Delete ${who}. This cannot be undone.`, reversible: false, confirm });
    }
  }
}

export type CreatePlan = { summary: string; blockers: Blocker[]; warnings: Blocker[]; conflicts: OtherBooking[] };
export function planCreate(c: CreateInput, ctx: { now: number; others: readonly OtherBooking[]; teamIds: readonly string[] | null; calendarIds: readonly string[] | null; contactName: string | null; contactDnd?: boolean; tz?: string | null }): CreatePlan {
  const blockers = timeBlockers(c.startAt, c.endAt, ctx.now); const warnings: Blocker[] = [];
  if (ctx.contactName === null) blockers.push({ id: "contact", text: "That contact is not in this account." });
  if (ctx.calendarIds && !ctx.calendarIds.includes(c.calendarId)) blockers.push({ id: "calendar", text: "That calendar is not in this account." });
  if (c.assignedTo && ctx.teamIds && !ctx.teamIds.includes(c.assignedTo)) blockers.push({ id: "owner", text: "That person is not on this account's team." });
  if (Date.parse(c.startAt) < ctx.now) warnings.push({ id: "past", text: "This time is in the past." });
  if (ctx.contactDnd) warnings.push({ id: "dnd", text: "This person asked not to be contacted. SubSync will not send them anything; your CRM may still send its own reminders." });
  const conflicts = findConflicts(c.startAt, c.endAt, ctx.others, { assignedTo: c.assignedTo, calendarId: c.calendarId });
  if (conflicts.length && !c.allowOverlap) blockers.push({ id: "double_booking", text: `That is a double booking: ${conflicts.length} other appointment${conflicts.length === 1 ? "" : "s"} overlap${conflicts.length === 1 ? "s" : ""}. Choose another time, or tick "Book anyway".` });
  else if (conflicts.length) warnings.push({ id: "forced", text: "Booked on top of another appointment, because you chose to." });
  return { summary: `Book ${ctx.contactName ?? "this contact"} for ${fmt(c.startAt, ctx.tz ?? null)}.`, blockers, warnings, conflicts };
}

// ---------------- bulk ----------------

export type BulkPlan = { allowed: ApptFacts[]; skipped: Array<{ appointmentId: string; name: string; reason: string }>; overCap: number; phrase: string | null };

/** What a bulk status mark, reassign or delete may touch. Future appointments cannot be marked showed/no-show; already-marked ones are skipped; more than the cap is cut and counted. */
export function planBulk(kind: "status" | "delete" | "reassign", items: readonly ApptFacts[], o: { now: number; status?: OutcomeChoice; userId?: string }): BulkPlan {
  const seen = new Set<string>();
  const skipped: BulkPlan["skipped"] = []; const ok: ApptFacts[] = [];
  for (const f of items) {
    if (seen.has(f.appointmentId)) continue; seen.add(f.appointmentId);
    if (kind === "status") {
      const crm = crmStatusOf(o.status ?? "showed");
      if (f.startAt && Date.parse(f.startAt) > o.now && (crm === "showed" || crm === "noshow")) { skipped.push({ appointmentId: f.appointmentId, name: f.contactName, reason: "has not happened yet" }); continue; }
      if ((f.status ?? "").toLowerCase() === crm) { skipped.push({ appointmentId: f.appointmentId, name: f.contactName, reason: "already marked that way" }); continue; }
    }
    if (kind === "reassign" && f.assignedTo === o.userId) { skipped.push({ appointmentId: f.appointmentId, name: f.contactName, reason: "already theirs" }); continue; }
    ok.push(f);
  }
  const allowed = ok.slice(0, APPT_BATCH_CAPS[kind]);
  return { allowed, skipped, overCap: ok.length - allowed.length, phrase: kind === "delete" && allowed.length ? bulkDeletePhrase(allowed.length) : null };
}

/** The reverse of a change, from the `before` the log kept. Delete and create have none. */
export function inversePatch(kind: string, before: Record<string, unknown>): ApptPlan["patch"] {
  if (kind === "delete" || kind === "create") return null;
  const p: NonNullable<ApptPlan["patch"]> = {};
  if (typeof before.status === "string" && (CRM_STATUSES as readonly string[]).includes(before.status)) p.status = before.status as CrmStatus;
  if (typeof before.startAt === "string" && typeof before.endAt === "string") { p.startAt = before.startAt; p.endAt = before.endAt; }
  if (typeof before.assignedTo === "string") p.assignedUserId = before.assignedTo;
  if (typeof before.title === "string") p.title = before.title;
  if (typeof before.calendarId === "string") p.calendarId = before.calendarId;
  return Object.keys(p).length ? p : null;
}
/** What to remember so the change can be put back. Ids, times and status only. */
export function beforeOf(f: ApptFacts, patch: NonNullable<ApptPlan["patch"]>): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (patch.status !== undefined && ["new", "showed", "noshow", "cancelled", "invalid", "confirmed"].includes((f.status ?? "").toLowerCase())) b.status = (f.status ?? "").toLowerCase();
  if (patch.startAt !== undefined) { b.startAt = f.startAt; b.endAt = f.endAt; }
  if (patch.assignedUserId !== undefined && f.assignedTo) b.assignedTo = f.assignedTo;
  if (patch.title !== undefined) b.title = f.title ?? "";
  if (patch.calendarId !== undefined && f.calendarId) b.calendarId = f.calendarId;
  return b;
}

// ---------------- times in the account's own time zone ----------------

/** "2026-11-20T14:30" typed in an account's time zone to the real instant (ISO). Falls back to UTC when the zone is unknown. */
export function zonedToIso(local: string, tz: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!tz) return new Date(asUtc).toISOString();
  const offsetAt = (t: number) => {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
    } catch { return 0; }
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first)).toISOString();
}
/** The reverse: an instant as "YYYY-MM-DDTHH:mm" on the clock of the account's time zone, for a date/time input. */
export function isoToZonedLocal(isoStr: string, tz: string | null): string {
  const d = new Date(isoStr);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { ...(tz ? { timeZone: tz } : { timeZone: "UTC" }), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch { return d.toISOString().slice(0, 16); }
}
