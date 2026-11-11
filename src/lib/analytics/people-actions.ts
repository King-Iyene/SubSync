import { waitClock, type ClockSetting } from "./moat-core.ts";

// The rules for the Team module's ACTIONS and REPORTS (slice PB). Pure: no database, no network. The routes read the facts from SubSync's own copy of ONE account the caller may see,
// these functions decide what may happen and what the preview or the report says, and the gateway (src/lib/ghl/people-gateway.ts) is the only thing that sends. Definitions are in
// docs/METRICS.md ("Team actions and proof"). Nothing here sends a message to a lead, and no word of any message is read or stored.

export type Blocker = { id: string; text: string };
export type Change = { label: string; from: string; to: string };

/** A short window in which a change of owner can be put back. */
export const UNDO_MINUTES = 30;
/** Most leads moved to another owner in one go. The CRM allows 100 requests per 10 seconds per account and SubSync spaces writes, so a small batch ends in seconds and a mistake stays small. */
export const REASSIGN_CAP = 25;
/** Rows in any export or copy. The message says how to narrow. */
export const EXPORT_CAP = 500;
export const NOTE_MAX = 2000;
export const TITLE_MAX = 60;
/** Ranking and suggestions need this much history first (the Team brief). */
export const MIN_LEADS = 20;
export const MIN_DAYS = 14;
/** A person is named on a client receipt only with at least this many leads; fewer are grouped as "others". */
export const MIN_NAMED_LEADS = 5;
export const AWAY_MAX_DAYS = 90;
export const PROOF_MAX_DAYS = 90;

const ID = /^[A-Za-z0-9_-]{3,128}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const DAY = 86_400_000;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ---------------- who may do what ----------------

/** "manager": the agency owner, an agency administrator or an account administrator. "self": everybody else (a client's staff, an agency staff member): their own row only. */
export type Viewer = {
  role: "manager" | "self"; userId: string | null;
  /** Whose coaching notes a manager reads. The agency's people read all of them; a client account's own administrator reads only the notes they wrote themselves (the agency's private notes about its staff are never theirs to read). */
  notes: "all" | "authored";
};
export function viewerOf(i: { kind: string; personRole?: string | null; sessionRole?: string | null; userId?: string | null }): Viewer {
  const userId = i.userId ?? null;
  // A business account's own administrator is a manager of their own account. A business account user (a setter) and a session with no recorded person role get the least access: their own row.
  if (i.kind === "business") return i.personRole === "account_admin" ? { role: "manager", userId, notes: "authored" } : { role: "self", userId, notes: "all" };
  if (i.kind === "client") return { role: "self", userId, notes: "all" };
  const r = i.personRole ?? null;
  if (r === "agency_owner" || r === "agency_admin") return { role: "manager", userId, notes: "all" };
  if (r === "agency_staff") return { role: "self", userId, notes: "all" };
  // An older session has no person role: the least privileged reading of the raw role.
  return { role: i.sessionRole === "admin" ? "manager" : "self", userId, notes: "all" };
}

// ---------------- coaching notes ----------------

export type NoteInput = { title: string; body: string; shared: boolean };
export function parseNote(raw: unknown): { ok: true; note: NoteInput } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = text(o.title, TITLE_MAX), body = text(o.body, NOTE_MAX);
  if (!title) return { ok: false, error: "Give the note a short title" };
  if (!body) return { ok: false, error: "Write the note" };
  return { ok: true, note: { title, body, shared: o.shared === true } };
}

export type NoteRow = { id: string; subjectUserId: string; title: string; body: string; shared: boolean; authorUserId: string | null; authorName: string | null; createdAt: number; updatedAt: number };
/** An agency manager sees every note about a person they manage; a client account's administrator only the notes they wrote. The person themself sees only the notes marked shared with them. Nobody else sees any. */
export function noteVisible(n: Pick<NoteRow, "subjectUserId" | "shared" | "authorUserId">, v: Viewer): boolean {
  if (v.role === "manager") return v.notes === "all" || (!!v.userId && n.authorUserId === v.userId) || (n.shared && !!v.userId && n.subjectUserId === v.userId);
  return !!v.userId && n.subjectUserId === v.userId && n.shared;
}

/** What must be typed to remove a note: its title (so the person has read which note it is) or the word DELETE. */
export const noteDeleteWords = (title: string) => ["DELETE", ...(title.trim() ? [title.trim()] : [])];
export const typedMatches = (typed: unknown, words: readonly string[]) => typeof typed === "string" && norm(typed).length > 0 && words.some((w) => norm(w) === norm(typed));

export function notePreview(before: Pick<NoteRow, "title" | "body" | "shared"> | null, after: NoteInput): Change[] {
  const c: Change[] = [];
  const cut = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}...` : s);
  if (!before) return [{ label: "Note", from: "none", to: cut(after.title) }, { label: "Shared with them", from: "no", to: after.shared ? "yes" : "no" }];
  if (before.title !== after.title) c.push({ label: "Title", from: cut(before.title), to: cut(after.title) });
  if (before.body !== after.body) c.push({ label: "Note", from: cut(before.body), to: cut(after.body) });
  if (before.shared !== after.shared) c.push({ label: "Shared with them", from: before.shared ? "yes" : "no", to: after.shared ? "yes" : "no" });
  return c;
}

// ---------------- targets ----------------

export const TARGET_METRICS = ["reply_minutes", "in_time_share", "appointments_week", "show_share", "won_value_month"] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const TARGET_WORDS: Record<TargetMetric, { label: string; unit: string; min: number; max: number }> = {
  reply_minutes: { label: "First reply within", unit: "minutes", min: 1, max: 1440 },
  in_time_share: { label: "Leads answered in time", unit: "%", min: 1, max: 100 },
  appointments_week: { label: "Appointments set per week", unit: "appointments", min: 1, max: 1000 },
  show_share: { label: "Appointments that show up", unit: "%", min: 1, max: 100 },
  won_value_month: { label: "Deals won per month", unit: "dollars", min: 1, max: 100_000_000 },
};
export const isTargetMetric = (v: unknown): v is TargetMetric => typeof v === "string" && (TARGET_METRICS as readonly string[]).includes(v);

export type TargetInput = { userId: string; locationId: string | null; metric: TargetMetric; value: number | null };
export function parseTarget(raw: unknown): { ok: true; target: TargetInput } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isId(o.userId)) return { ok: false, error: "Choose the person" };
  if (!isTargetMetric(o.metric)) return { ok: false, error: "Choose what the target is for" };
  const loc = o.locationId === undefined || o.locationId === null || o.locationId === "" ? null : isId(o.locationId) ? o.locationId : undefined;
  if (loc === undefined) return { ok: false, error: "Choose one of the accounts" };
  if (o.value === null) return { ok: true, target: { userId: o.userId, locationId: loc, metric: o.metric, value: null } };
  const v = typeof o.value === "number" ? o.value : typeof o.value === "string" && o.value.trim() !== "" ? Number(o.value) : NaN;
  const w = TARGET_WORDS[o.metric];
  if (!Number.isFinite(v) || v < w.min || v > w.max) return { ok: false, error: `Use a number between ${w.min.toLocaleString("en-US")} and ${w.max.toLocaleString("en-US")}` };
  return { ok: true, target: { userId: o.userId, locationId: loc, metric: o.metric, value: Math.round(v * 100) / 100 } };
}
export const targetShown = (metric: TargetMetric, v: number | null) => (v === null ? "none" : metric === "won_value_month" ? `$${Math.round(v).toLocaleString("en-US")}` : `${v}${TARGET_WORDS[metric].unit === "%" ? "%" : ` ${TARGET_WORDS[metric].unit}`}`);
export const targetPreview = (metric: TargetMetric, before: number | null, after: number | null): Change[] => [{ label: TARGET_WORDS[metric].label, from: targetShown(metric, before), to: targetShown(metric, after) }];
/** What must be typed to clear a target: the target's own name as the preview shows it, or the word DELETE. */
export const targetDeleteWords = (metric: TargetMetric, personName: string) => ["DELETE", `${personName} ${TARGET_WORDS[metric].label}`.trim()];

// ---------------- away and snooze ----------------

export const AWAY_REASONS = ["holiday", "sick", "training", "other"] as const;
export type AwayReason = (typeof AWAY_REASONS)[number];
export const AWAY_WORDS: Record<AwayReason, string> = { holiday: "On holiday", sick: "Off sick", training: "In training", other: "Away" };
export const SNOOZE_HOURS = [4, 24, 72, 168] as const;

export type AwayInput = { kind: "away"; userId: string; reason: AwayReason; until: number } | { kind: "idle_snooze"; userId: string; until: number; hours: number };
export function parseAway(raw: unknown, now: number): { ok: true; away: AwayInput } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isId(o.userId)) return { ok: false, error: "Choose the person" };
  if (o.kind === "idle_snooze") {
    const h = Number(o.hours);
    if (!(SNOOZE_HOURS as readonly number[]).includes(h)) return { ok: false, error: "Choose 4 hours, 24 hours, 3 days or 7 days" };
    return { ok: true, away: { kind: "idle_snooze", userId: o.userId, hours: h, until: now + h * 3_600_000 } };
  }
  const reason = (AWAY_REASONS as readonly unknown[]).includes(o.reason) ? (o.reason as AwayReason) : "other";
  const until = typeof o.until === "string" ? Date.parse(o.until) : typeof o.until === "number" ? o.until : NaN;
  if (!Number.isFinite(until) || until <= now) return { ok: false, error: "Choose an end date in the future" };
  if (until > now + AWAY_MAX_DAYS * DAY) return { ok: false, error: `Away marks end within ${AWAY_MAX_DAYS} days. Set it again then.` };
  return { ok: true, away: { kind: "away", userId: o.userId, reason, until } };
}
export const awayLine = (name: string, a: { kind: "away" | "idle_snooze"; reason?: AwayReason | null; until: number }) => {
  const d = new Date(a.until).toISOString().slice(0, 10);
  return a.kind === "idle_snooze" ? `${name}: no reminders that they have gone quiet until ${d}.` : `${name} is marked ${AWAY_WORDS[a.reason ?? "other"].toLowerCase()} until ${d}. They are left out of reminders about being quiet and of lead suggestions until then.`;
};
export const awayActive = (row: { until: number; releasedAt?: number | null }, now: number) => !row.releasedAt && row.until > now;

// ---------------- one safe CSV ----------------

/**
 * One cell of a CSV file, safe to open in a spreadsheet. A text that starts with = + - @ or a tab or return would be run as a formula by the spreadsheet, so it is prefixed with an
 * apostrophe (a real number is written as a number, never prefixed). Cells with a comma, quote or line break are quoted.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v).replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells: readonly unknown[]) => cells.map(csvCell).join(",");

// ---------------- reassign leads ----------------

export type LeadFacts = { contactId: string; name: string; dnd: boolean; owner: string | null; openDeals: number; wonDeals: number; upcomingAppointments: number };
export type ReassignItem = { contactId: string; name: string; fromOwner: string | null; protectedBy: Blocker[] };
export type ReassignPlan = {
  change: ReassignItem[]; same: number; protectedItems: ReassignItem[]; overCap: number; blockers: Blocker[]; warnings: Blocker[];
  /** True when every moved lead had an owner before, so every one can be put back. */
  reversible: boolean; irreversible: number;
};

/** Why one person's lead should stay with its owner: do not disturb, an open deal, a customer, an appointment coming up. Plain words, naming the person. */
export function leadProtections(f: LeadFacts): Blocker[] {
  const out: Blocker[] = [];
  if (f.dnd) out.push({ id: "dnd", text: `${f.name} asked not to be contacted. A change of owner can start the new owner's workflows, so this one stays.` });
  if (f.openDeals > 0) out.push({ id: "open_deal", text: `${f.name} has an open deal with the current owner.` });
  if (f.wonDeals > 0) out.push({ id: "customer", text: `${f.name} is a customer (a won deal).` });
  if (f.upcomingAppointments > 0) out.push({ id: "appointment", text: `${f.name} has an appointment coming up.` });
  return out;
}

/**
 * What a move of leads to one person may touch. The new owner must belong to THIS account's team. Leads already theirs are skipped and counted. In a batch, a lead that is protected
 * (do not disturb, open deal, customer, appointment coming up) is left out and named, never moved; moved one at a time the person ticks that they checked. More than the cap are cut and
 * counted. Someone marked away is allowed but warned about.
 */
export function planReassign(items: readonly LeadFacts[], toUserId: string, ctx: { members: ReadonlyArray<{ id: string; name?: string }>; awayUntil: number | null; now: number }): ReassignPlan {
  const blockers: Blocker[] = []; const warnings: Blocker[] = [];
  const target = ctx.members.find((m) => m.id === toUserId);
  if (!toUserId || !target) blockers.push({ id: "owner", text: "Choose someone from this account's team." });
  if (ctx.awayUntil && ctx.awayUntil > ctx.now) warnings.push({ id: "away", text: `${target?.name ?? "This person"} is marked away until ${new Date(ctx.awayUntil).toISOString().slice(0, 10)}.` });
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.contactId) ? false : (seen.add(i.contactId), true)));
  const same = unique.filter((i) => i.owner === toUserId).length;
  const todo = unique.filter((i) => i.owner !== toUserId).map((f): ReassignItem => ({ contactId: f.contactId, name: f.name, fromOwner: f.owner, protectedBy: leadProtections(f) }));
  const batch = todo.length > 1;
  const protectedItems = batch ? todo.filter((i) => i.protectedBy.length > 0) : [];
  const ok = batch ? todo.filter((i) => i.protectedBy.length === 0) : todo;
  const change = ok.slice(0, REASSIGN_CAP);
  if (!batch && todo[0]?.protectedBy.length) for (const b of todo[0].protectedBy) warnings.push({ ...b, id: `ack_${b.id}` });
  const irreversible = change.filter((i) => !i.fromOwner).length;
  if (irreversible > 0) warnings.push({ id: "noundo", text: `${irreversible === 1 ? "One lead has" : `${irreversible} leads have`} no owner now, and an owner cannot be taken off again from here, so Undo will not put ${irreversible === 1 ? "it" : "them"} back.` });
  return { change, same, protectedItems, overCap: ok.length - change.length, blockers, warnings, reversible: irreversible === 0 && change.length > 0, irreversible };
}
/** A single protected lead needs the person to tick that they checked. The ack ids the preview offered are `ack_<id>`. */
export const acksNeeded = (p: ReassignPlan) => p.warnings.filter((w) => w.id.startsWith("ack_")).map((w) => w.id);
export const acksGiven = (p: ReassignPlan, given: unknown) => {
  const have = new Set(Array.isArray(given) ? given.filter((x): x is string => typeof x === "string") : []);
  return acksNeeded(p).every((id) => have.has(id));
};

export type LogRow = { contactId: string; before: string | null; after: string | null; result: string; at: number };
/** From a batch's log, the moves that can be put back: they were done, had an owner before, and are inside the undo window. */
export function undoable(rows: readonly LogRow[], now: number): LogRow[] {
  return rows.filter((r) => r.result === "done" && !!r.before && r.before !== r.after && now - r.at < UNDO_MINUTES * 60_000);
}

// ---------------- who should get the next lead (a labelled estimate) ----------------

export type Candidate = {
  userId: string; name: string;
  /** Leads of theirs that wait for a first reply or a follow-up now. */
  waiting: number;
  /** New leads they handled in the last 28 days, and how many days of history exist. */
  leads: number; days: number;
  medianReplyMinutes: number | null;
  /** The same for the lead's own source, when known. */
  sourceLeads?: number; sourceMedianMinutes?: number | null;
  away: boolean;
};
export type Suggestion = {
  estimate: true; label: string; userId: string; name: string; reasons: string[]; sample: { leads: number; days: number };
  others: Array<{ userId: string; name: string; waiting: number }>;
};
export type SuggestResult = { suggestion: Suggestion | null; hidden: "not_enough_data" | "nobody_available" | null; considered: number; away: number; underMinimum: number };

const median = (xs: readonly number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * A suggestion of who should get the next lead, in one account. It is an ESTIMATE and says so: the person with the fewest leads waiting, then the fastest reply for this kind of lead.
 * Only people who are not away and have at least `minLeads` leads over at least `minDays` days are considered (never a ranking on a small sample); if nobody qualifies the
 * suggestion stays hidden and the reason is given. It never assigns anything by itself.
 */
export function suggestAssignee(cands: readonly Candidate[], o: { minLeads?: number; minDays?: number } = {}): SuggestResult {
  const minLeads = o.minLeads ?? MIN_LEADS, minDays = o.minDays ?? MIN_DAYS;
  const away = cands.filter((c) => c.away).length;
  const present = cands.filter((c) => !c.away);
  const eligible = present.filter((c) => c.leads >= minLeads && c.days >= minDays);
  const underMinimum = present.length - eligible.length;
  if (eligible.length === 0) return { suggestion: null, hidden: present.length === 0 ? "nobody_available" : "not_enough_data", considered: 0, away, underMinimum };
  const ranked = [...eligible].sort((a, b) => a.waiting - b.waiting
    || (a.sourceMedianMinutes ?? a.medianReplyMinutes ?? Infinity) - (b.sourceMedianMinutes ?? b.medianReplyMinutes ?? Infinity)
    || a.name.localeCompare(b.name));
  const top = ranked[0];
  const teamWaiting = median(eligible.map((c) => c.waiting));
  const teamReply = median(eligible.flatMap((c) => (c.medianReplyMinutes === null ? [] : [c.medianReplyMinutes])));
  const reasons: string[] = [];
  const fewest = eligible.every((c) => c.userId === top.userId || c.waiting > top.waiting);
  if (fewest && eligible.length > 1) reasons.push(`has the fewest leads waiting (${top.waiting}${teamWaiting !== null ? `, the team's usual is ${Math.round(teamWaiting)}` : ""})`);
  else reasons.push(`has ${top.waiting} lead${top.waiting === 1 ? "" : "s"} waiting`);
  if (top.sourceMedianMinutes != null && (top.sourceLeads ?? 0) >= 5) reasons.push(`answers this kind of lead in a median of ${Math.round(top.sourceMedianMinutes)} minutes (${top.sourceLeads} leads)`);
  else if (top.medianReplyMinutes !== null && teamReply !== null && top.medianReplyMinutes <= teamReply) reasons.push(`replies in a median of ${Math.round(top.medianReplyMinutes)} minutes (the team's is ${Math.round(teamReply)})`);
  return {
    suggestion: {
      estimate: true, label: "Estimate. SubSync suggests, you decide.", userId: top.userId, name: top.name, reasons,
      sample: { leads: top.leads, days: top.days }, others: ranked.slice(1, 4).map((c) => ({ userId: c.userId, name: c.name, waiting: c.waiting })),
    },
    hidden: null, considered: eligible.length, away, underMinimum,
  };
}

// ---------------- one thing to work on ----------------

export type PeriodStats = { leads: number; answered: number; inTime: number; medianReplyMinutes: number | null };
export type Focus = { metric: "in_time" | "answered" | "reply_speed"; line: string; detail: string; basis: "worse_than_last_month" | "lowest_number" };
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

/**
 * The one thing to work on this week, built only from the person's OWN numbers: this period against their own previous period. The metric that fell most is named; if nothing fell,
 * their lowest share is named and said to be the lowest, not a fault. Hidden (null) when either period has fewer than `minLeads` leads.
 */
export function oneThing(now: PeriodStats, before: PeriodStats, minLeads = MIN_LEADS): Focus | null {
  if (now.leads < minLeads || before.leads < minLeads) return null;
  const rows: Array<{ metric: Focus["metric"]; now: number | null; before: number | null; worseIsHigher: boolean; name: string; unit: string }> = [
    { metric: "in_time", now: pct(now.inTime, now.leads), before: pct(before.inTime, before.leads), worseIsHigher: false, name: "Leads answered in time", unit: "%" },
    { metric: "answered", now: pct(now.answered, now.leads), before: pct(before.answered, before.leads), worseIsHigher: false, name: "Leads that got a first reply", unit: "%" },
    { metric: "reply_speed", now: now.medianReplyMinutes, before: before.medianReplyMinutes, worseIsHigher: true, name: "Typical first reply", unit: " min" },
  ];
  let worst: { r: (typeof rows)[number]; rel: number } | null = null;
  for (const r of rows) {
    if (r.now === null || r.before === null || r.before === 0) continue;
    const rel = r.worseIsHigher ? (r.now - r.before) / r.before : (r.before - r.now) / r.before;
    if (rel > 0.05 && (!worst || rel > worst.rel)) worst = { r, rel };
  }
  if (worst) {
    const { r } = worst;
    return { metric: r.metric, basis: "worse_than_last_month", line: `${r.name}: ${r.before}${r.unit} last period, ${r.now}${r.unit} now.`, detail: r.worseIsHigher ? "Replies have slowed against your own previous period. Look at when leads arrive and who is free then." : "This is lower than your own previous period. Check which leads went without a reply." };
  }
  const low = rows.filter((r) => r.unit === "%" && r.now !== null).sort((a, b) => (a.now as number) - (b.now as number))[0];
  return low ? { metric: low.metric, basis: "lowest_number", line: `${low.name}: ${low.now}${low.unit}.`, detail: "Nothing fell against your own previous period. This is your lowest share, so it is the one with most room." } : null;
}

// ---------------- the client receipt (proof of how the team handled their leads) ----------------

export type ProofStaff = { userId: string; name: string; leads: number; answered: number; inTime: number; medianReplyMinutes: number | null };
export type ProofFacts = {
  accountName: string; from: number; to: number; targetMinutes: number;
  team: { leads: number; answered: number; inTime: number; medianReplyMinutes: number | null };
  appointments: { held: number; showed: number; noShow: number; unmarked: number };
  staff: ProofStaff[]; nameStaff: boolean;
};
export type Proof = {
  accountName: string; from: number; to: number; days: number; targetMinutes: number; named: boolean;
  lines: string[];
  team: { leads: number; answered: number; inTime: number; inTimePct: number | null; medianReplyMinutes: number | null };
  table: Array<{ who: string; leads: number; answered: number; inTime: number; inTimePct: number | null; medianReplyMinutes: number | null }>;
  appointments: ProofFacts["appointments"] & { showedPct: number | null };
  notes: string[];
};

export const periodDays = (from: number, to: number) => Math.max(1, Math.round((to - from) / DAY));
const mins = (m: number | null) => (m === null ? "no replies yet" : m < 1 ? "under a minute" : m < 90 ? `${Math.round(m)} minute${Math.round(m) === 1 ? "" : "s"}` : `${(m / 60).toFixed(1)} hours`);

/**
 * The receipt for ONE client account and one period: how the team handled the client's leads. Team level by default; staff are named only when the account's choice says so, and a
 * person with fewer than MIN_NAMED_LEADS leads is grouped under "Others" (never named on a small sample). Percentages need at least MIN_NAMED_LEADS leads, else the count is shown alone.
 */
export function proofOf(f: ProofFacts): Proof {
  const days = periodDays(f.from, f.to);
  const t = f.team;
  const lines: string[] = [];
  const notes: string[] = [];
  if (t.leads === 0) lines.push(`No new leads arrived in these ${days} days.`);
  else {
    const p = t.leads >= MIN_NAMED_LEADS ? pct(t.inTime, t.leads) : null;
    lines.push(`${t.leads} new lead${t.leads === 1 ? "" : "s"} came in. ${t.answered} got a first reply from a person${p !== null ? `, and ${t.inTime} of them (${p}%) within ${f.targetMinutes} minutes` : ""}.`);
    lines.push(`The typical first reply took ${mins(t.medianReplyMinutes)}.`);
    if (t.leads - t.answered > 0) lines.push(`${t.leads - t.answered} lead${t.leads - t.answered === 1 ? "" : "s"} had no reply from a person yet.`);
  }
  const a = f.appointments;
  const decided = a.showed + a.noShow;
  const showedPct = decided >= MIN_NAMED_LEADS ? pct(a.showed, decided) : null;
  if (a.held > 0) lines.push(`${a.held} appointment${a.held === 1 ? "" : "s"} were due: ${a.showed} showed up, ${a.noShow} did not${a.unmarked ? `, ${a.unmarked} not marked yet` : ""}${showedPct !== null ? ` (${showedPct}% showed)` : ""}.`);
  const named = f.nameStaff;
  let table: Proof["table"] = [];
  if (named) {
    const big = f.staff.filter((s) => s.leads >= MIN_NAMED_LEADS).sort((x, y) => y.leads - x.leads || x.name.localeCompare(y.name));
    const small = f.staff.filter((s) => s.leads < MIN_NAMED_LEADS);
    table = big.map((s) => ({ who: s.name, leads: s.leads, answered: s.answered, inTime: s.inTime, inTimePct: pct(s.inTime, s.leads), medianReplyMinutes: s.medianReplyMinutes }));
    if (small.length) table.push({ who: "Others", leads: small.reduce((x, s) => x + s.leads, 0), answered: small.reduce((x, s) => x + s.answered, 0), inTime: small.reduce((x, s) => x + s.inTime, 0), inTimePct: null, medianReplyMinutes: null });
    notes.push("Staff are named because this client's account is set to show names. People with fewer than 5 leads are grouped as Others.");
  } else notes.push("This receipt shows the team as a whole. Names are not shown.");
  notes.push("Counts come from SubSync's own record of messages and calls. SubSync reads message and call details, never the words.");
  return { accountName: f.accountName, from: f.from, to: f.to, days, targetMinutes: f.targetMinutes, named, lines, team: { ...t, inTimePct: t.leads >= MIN_NAMED_LEADS ? pct(t.inTime, t.leads) : null }, table, appointments: { ...a, showedPct }, notes };
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The words to paste to the client. */
export function proofText(p: Proof, brand: string | null): string {
  const head = `${brand ? `${brand}: ` : ""}Lead handling for ${p.accountName}, ${ymd(p.from)} to ${ymd(p.to - 1)}`;
  const rows = p.table.map((r) => `- ${r.who}: ${r.leads} lead${r.leads === 1 ? "" : "s"}, ${r.answered} answered${r.inTimePct !== null ? `, ${r.inTimePct}% in time` : ""}${r.medianReplyMinutes !== null ? `, typical reply ${mins(r.medianReplyMinutes)}` : ""}`);
  return [head, "", ...p.lines, ...(rows.length ? ["", ...rows] : []), "", ...p.notes].join("\n");
}
/** The receipt as a CSV file. Formula-safe; at most EXPORT_CAP rows. */
export function proofCsv(p: Proof, brand: string | null): string {
  const out: string[] = [];
  out.push(csvRow(["Receipt", brand ?? "", p.accountName, ymd(p.from), ymd(p.to - 1)]));
  out.push(csvRow(["Who", "New leads", "Got a first reply", `Answered within ${p.targetMinutes} minutes`, "Percent in time", "Typical first reply (minutes)"]));
  out.push(csvRow(["Whole team", p.team.leads, p.team.answered, p.team.inTime, p.team.inTimePct, p.team.medianReplyMinutes === null ? null : Math.round(p.team.medianReplyMinutes * 10) / 10]));
  for (const r of p.table.slice(0, EXPORT_CAP)) out.push(csvRow([r.who, r.leads, r.answered, r.inTime, r.inTimePct, r.medianReplyMinutes === null ? null : Math.round(r.medianReplyMinutes * 10) / 10]));
  out.push("");
  out.push(csvRow(["Appointments due", "Showed", "Did not show", "Not marked yet", "Percent showed"]));
  out.push(csvRow([p.appointments.held, p.appointments.showed, p.appointments.noShow, p.appointments.unmarked, p.appointments.showedPct]));
  return `${out.join("\r\n")}\r\n`;
}
// ---------------- weekly team lines for the brief email ----------------

export type WeekPerson = { name: string; leads: number; inTime: number };
/**
 * Up to three plain lines about the team for the weekly summary. Only people with at least 10 leads are compared, and only when two or more qualify; one person alone is never ranked.
 * The lines say what the person did, never "worst" or "best", and never use a word of any message.
 */
export function teamWeekLines(people: readonly WeekPerson[], noPersonReply: number): string[] {
  const out: string[] = [];
  const q = people.filter((p) => p.leads >= 10).map((p) => ({ ...p, share: Math.round((p.inTime / p.leads) * 100) })).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
  if (q.length >= 2) {
    const hi = q[0], lo = q[q.length - 1];
    if (hi.share !== lo.share) out.push(`In the last 7 days ${hi.name} answered ${hi.share}% of new leads in time (${hi.leads} leads) and ${lo.name} ${lo.share}% (${lo.leads} leads).`);
    else out.push(`In the last 7 days ${q.length} people each answered about ${hi.share}% of new leads in time.`);
  }
  if (noPersonReply > 0) out.push(`${noPersonReply} new lead${noPersonReply === 1 ? "" : "s"} had no first reply from a person.`);
  return out.slice(0, 3);
}

// ---------------- quiet and overloaded people (alerts) ----------------

export type IdleFacts = {
  userId: string; name: string; locationId: string; accountName: string;
  /** Leads that are theirs and have waited for a reply longer than the waiting threshold. */
  waiting: number;
  /** Their last recorded human touch in this account, and whether they have any in the last 14 days (so SubSync knows they work here). */
  lastTouchAt: number | null; activeRecently: boolean;
  away: boolean; snoozed: boolean;
  clock: ClockSetting;
};
export type PeopleAlert = { kind: "people_idle" | "people_overload"; title: string; detail: Record<string, unknown> };
export const IDLE_HOURS_DEFAULT = 4;
export const IDLE_MIN_WAITING = 3;
export const WAITING_HOURS = 2;
export const OVERLOAD_MIN = 10;

/**
 * A quiet person: they work in this account (a touch in the last 14 days), have at least 3 leads waiting more than 2 hours, and have recorded no human touch here for `idleHours`
 * (working hours only when the account counts them). The title says "no activity recorded in your CRM", never "not working": calls on a personal phone are invisible to SubSync.
 */
export function idleAlert(f: IdleFacts, now: number, idleHours = IDLE_HOURS_DEFAULT): PeopleAlert | null {
  if (f.away || f.snoozed || !f.activeRecently || f.waiting < IDLE_MIN_WAITING) return null;
  const since = f.lastTouchAt ?? now - 14 * DAY;
  const quiet = waitClock(since, now, f.clock).usedMinutes / 60;
  if (quiet < idleHours) return null;
  return {
    kind: "people_idle",
    title: `${f.accountName}: ${f.name} has ${f.waiting} leads waiting and no activity recorded in your CRM for ${Math.floor(quiet)} hours`,
    detail: { userId: f.userId, waiting: f.waiting, quietHours: Math.floor(quiet), note: "No activity recorded in your CRM. Calls on a personal phone are not visible." },
  };
}

/** Overloaded: at least 10 leads waiting and at least twice the team's usual in the same account (needs 3 or more people to know the usual). */
export function overloadAlerts(accountName: string, locationId: string, people: ReadonlyArray<{ userId: string; name: string; waiting: number; away: boolean }>): PeopleAlert[] {
  const present = people.filter((p) => !p.away);
  if (present.length < 3) return [];
  const usual = median(present.map((p) => p.waiting)) ?? 0;
  return present.filter((p) => p.waiting >= OVERLOAD_MIN && p.waiting >= usual * 2).map((p): PeopleAlert => ({
    kind: "people_overload",
    title: `${accountName}: ${p.name} has ${p.waiting} leads waiting, about ${usual > 0 ? `${Math.round(p.waiting / usual)} times` : "far more than"} the team's usual (${Math.round(usual)})`,
    detail: { userId: p.userId, locationId, waiting: p.waiting, teamUsual: Math.round(usual) },
  }));
}

// ---------------- rebalance: take some of one person's waiting leads and spread them (a labelled estimate) ----------------

export type WaitingLead = { contactId: string; name: string; waitedMinutes: number; protectedBy: Blocker[] };
export type RebalanceGroup = { userId: string; name: string; contactIds: string[]; waitingAfter: number };
export type RebalancePlan = {
  estimate: true; label: string;
  from: { userId: string; name: string; waiting: number; waitingAfter: number };
  groups: RebalanceGroup[]; moved: number; protectedLeft: number;
  hidden: "not_enough_data" | "nobody_available" | "balanced" | null;
};

/**
 * For an overloaded person: which of their waiting leads could go to whom so nobody ends up far above the rest. An ESTIMATE the manager confirms group by group through the ordinary
 * move (preview, tick, undo). The longest-waiting leads go first, each to the eligible person (not away, enough history) with the fewest leads waiting at that moment, ties to the
 * faster replier; it stops when the person is within one lead of the person it would give to, or at the cap. Protected leads (do-not-disturb, open deal, customer, appointment) never move.
 */
export function planRebalance(src: Candidate, waiting: readonly WaitingLead[], others: readonly Candidate[], o: { minLeads?: number; minDays?: number; cap?: number } = {}): RebalancePlan {
  const minLeads = o.minLeads ?? MIN_LEADS, minDays = o.minDays ?? MIN_DAYS, cap = Math.min(o.cap ?? REASSIGN_CAP, REASSIGN_CAP);
  const label = "Estimate. SubSync suggests, you decide.";
  const base = { estimate: true as const, label, from: { userId: src.userId, name: src.name, waiting: src.waiting, waitingAfter: src.waiting }, groups: [] as RebalanceGroup[], moved: 0, protectedLeft: waiting.filter((l) => l.protectedBy.length > 0).length };
  const present = others.filter((c) => c.userId !== src.userId && !c.away);
  const recv = present.filter((c) => c.leads >= minLeads && c.days >= minDays);
  if (recv.length === 0) return { ...base, hidden: present.length === 0 ? "nobody_available" : "not_enough_data" };
  const counts = new Map(recv.map((c) => [c.userId, c.waiting]));
  const groups = new Map<string, string[]>();
  let remaining = src.waiting, moved = 0;
  const movable = waiting.filter((l) => l.protectedBy.length === 0).sort((a, b) => b.waitedMinutes - a.waitedMinutes);
  for (const lead of movable) {
    if (moved >= cap) break;
    const to = [...recv].sort((a, b) => (counts.get(a.userId) as number) - (counts.get(b.userId) as number) || (a.medianReplyMinutes ?? Infinity) - (b.medianReplyMinutes ?? Infinity) || a.name.localeCompare(b.name))[0];
    if (remaining <= (counts.get(to.userId) as number) + 1) break;
    groups.set(to.userId, [...(groups.get(to.userId) ?? []), lead.contactId]);
    counts.set(to.userId, (counts.get(to.userId) as number) + 1);
    remaining--; moved++;
  }
  if (moved === 0) return { ...base, hidden: "balanced" };
  return {
    ...base, moved, from: { ...base.from, waitingAfter: remaining }, hidden: null,
    groups: [...groups].map(([userId, contactIds]) => ({ userId, name: recv.find((c) => c.userId === userId)?.name ?? "Team member", contactIds, waitingAfter: counts.get(userId) as number })),
  };
}
