// Unanswered messages, round 3, slice B: the pure rules for the actions people take on a waiting conversation (snooze, claim, assign, outcome, hide, clear junk).
// No database and no network here, so every rule is unit tested. Definitions are in docs/METRICS.md ("Unanswered actions").

// ---------------- snooze ("handled" or "later", SubSync only, reversible) ----------------

export const SNOOZE_REASONS = ["waiting_on_customer", "call_back_later", "handled_elsewhere", "not_a_real_lead", "other"] as const;
export type SnoozeReason = (typeof SNOOZE_REASONS)[number];
export const SNOOZE_REASON_WORDS: Record<SnoozeReason, string> = {
  waiting_on_customer: "Waiting on the customer", call_back_later: "Call back later", handled_elsewhere: "Handled somewhere else", not_a_real_lead: "Not a real lead", other: "Other",
};
export const isSnoozeReason = (v: unknown): v is SnoozeReason => typeof v === "string" && (SNOOZE_REASONS as readonly string[]).includes(v);

export const SNOOZE_DURATIONS = ["h1", "h4", "tomorrow", "d3", "d7", "d30"] as const;
export type SnoozeDuration = (typeof SNOOZE_DURATIONS)[number];
export const SNOOZE_DURATION_WORDS: Record<SnoozeDuration, string> = { h1: "1 hour", h4: "4 hours", tomorrow: "Tomorrow morning", d3: "3 days", d7: "1 week", d30: "30 days" };
export const isSnoozeDuration = (v: unknown): v is SnoozeDuration => typeof v === "string" && (SNOOZE_DURATIONS as readonly string[]).includes(v);
/** The longest a conversation may be set aside: a snooze is a pause, never a way to bury a lead. */
export const MAX_SNOOZE_DAYS = 30;
const HOUR = 3_600_000;

/** The hour (0-23) in `zone` at `at`, or null when the zone is unknown. */
function hourIn(at: number, zone: string | null): number | null {
  if (!zone) return null;
  try { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: zone }).format(new Date(at)).replace(/\D/g, "")) % 24; } catch { return null; }
}

/** When a snooze ends. "tomorrow" is the next 9am in the account's time zone (24 hours later when the zone is unknown), found by stepping, so daylight saving cannot shift it by an hour. */
export function snoozeUntil(duration: SnoozeDuration, now: number, zone: string | null = null): number {
  switch (duration) {
    case "h1": return now + HOUR;
    case "h4": return now + 4 * HOUR;
    case "d3": return now + 72 * HOUR;
    case "d7": return now + 168 * HOUR;
    case "d30": return now + MAX_SNOOZE_DAYS * 24 * HOUR;
    case "tomorrow": {
      if (hourIn(now, zone) === null) return now + 24 * HOUR;
      // The first 9:00 that is at least 6 hours away: from 8pm that is next morning, from 6am it is tomorrow, never the same morning.
      let t = now + 6 * HOUR;
      t -= t % (15 * 60_000);
      for (let i = 0; i < 40 * 4; i++, t += 15 * 60_000) {
        const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hour12: false, timeZone: zone as string }).formatToParts(new Date(t));
        const h = Number(parts.find((p) => p.type === "hour")?.value) % 24, m = Number(parts.find((p) => p.type === "minute")?.value);
        if (h === 9 && m === 0) return t;
      }
      return now + 24 * HOUR;
    }
  }
}

/** A snooze is hiding a conversation only while it is not released and has not run out. */
export const snoozeActive = (s: { releasedAt: number | null; until: number }, now: number): boolean => s.releasedAt === null && s.until > now;

// ---------------- hiding (not a lead, your own team, automatic) ----------------

export type HideReason = "snoozed" | "not_a_lead" | "internal" | "automatic";
export const HIDE_REASON_WORDS: Record<HideReason, string> = { snoozed: "Set aside", not_a_lead: "Not a lead", internal: "Your own team or spam", automatic: "Automatic messages" };
export type HideSettings = { notALead: boolean; internal: boolean; automatic: boolean };
export const DEFAULT_HIDE: HideSettings = { notALead: true, internal: true, automatic: true };
/** Tags that mean "this is not a customer" on a contact. Matched whole, ignoring case. */
export const NOISE_TAGS: readonly string[] = ["spam", "bot", "internal", "staff", "team", "employee", "test", "do-not-reply"];

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
const mail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

export type HideFacts = {
  snoozed: boolean; notALead: boolean; tags: readonly string[]; email: string | null; phone: string | null;
  /** The business's own address and number (an account texting itself is not a lead). */
  ownEmail: string | null; ownPhone: string | null;
  /** The newest inbound message was sent by an automation, a system or a form, from the message's own source and direction (never its text). */
  automatedLastInbound: boolean;
};

/**
 * Why a waiting person is hidden by default, or null. One reason each, in this order, so the counts add up: set aside, not a lead, your own team or spam, automatic.
 * The same order is used by the SQL in unanswered-actions-queries.ts; this function is the one the tests hold it to.
 */
export function hideReason(f: HideFacts, s: HideSettings = DEFAULT_HIDE): HideReason | null {
  if (f.snoozed) return "snoozed";
  if (s.notALead && f.notALead) return "not_a_lead";
  if (s.internal) {
    const tagged = f.tags.some((t) => NOISE_TAGS.includes(t.trim().toLowerCase()));
    const own = (!!mail(f.email) && mail(f.email) === mail(f.ownEmail)) || (digits(f.phone).length >= 7 && digits(f.phone) === digits(f.ownPhone));
    if (tagged || own) return "internal";
  }
  if (s.automatic && f.automatedLastInbound) return "automatic";
  return null;
}

// ---------------- batches: assign an owner, clear junk ----------------

/** Most people changed at once. The CRM allows 100 requests per 10 seconds per account and SubSync spaces writes, so a small batch finishes in seconds and a mistake stays small. */
export const BATCH_CAPS = { assign: 20, clear: 10 } as const;

export type Blocker = { id: string; text: string };
export type ProtectFacts = { name: string; dnd: boolean; openDeals: number; wonDeals: number; upcomingAppointments: number };

/**
 * Who must never be cleared away: do not disturb (the platform's own protection), an open deal, a paying customer (a won deal; SubSync cannot read payments, so a won deal
 * is the nearest proof it has) and an upcoming appointment. Plain words, naming the person, so the preview can say exactly why.
 */
export function protectionBlockers(f: ProtectFacts): Blocker[] {
  const out: Blocker[] = [];
  if (f.dnd) out.push({ id: "dnd", text: `${f.name} asked not to be contacted. That choice is kept, so this conversation stays.` });
  if (f.openDeals > 0) out.push({ id: "open_deal", text: `${f.name} has an open deal.` });
  if (f.wonDeals > 0) out.push({ id: "customer", text: `${f.name} is a customer (a won deal).` });
  if (f.upcomingAppointments > 0) out.push({ id: "appointment", text: `${f.name} has an appointment coming up.` });
  return out;
}

export type ClearItem = { conversationId: string; contactId: string | null; name: string; blockers: Blocker[] };
export type ClearPlan = { allowed: ClearItem[]; blocked: ClearItem[]; overCap: number; phrase: string };

/** The typed phrase that confirms a clear-out: the exact count, so a person cannot confirm without reading how many. */
export const clearPhrase = (n: number) => `delete ${n}`;
export const clearConfirmed = (typed: string, n: number) => n > 0 && typed.trim().toLowerCase().replace(/\s+/g, " ") === clearPhrase(n);

/** Splits what the person picked into what may be cleared and what is protected (with why). More than the cap are left out and counted. */
export function planClear(items: readonly ClearItem[]): ClearPlan {
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.conversationId) ? false : (seen.add(i.conversationId), true)));
  const allowed = unique.filter((i) => i.blockers.length === 0);
  const blocked = unique.filter((i) => i.blockers.length > 0);
  const cut = allowed.slice(0, BATCH_CAPS.clear);
  return { allowed: cut, blocked, overCap: allowed.length - cut.length, phrase: clearPhrase(cut.length) };
}

export type AssignItem = { contactId: string; name: string; currentOwner: string | null };
export type AssignPlan = { change: AssignItem[]; same: AssignItem[]; overCap: number; blockers: Blocker[] };

/** An assignment may only name someone who belongs to that one account's team. Contacts that already have that owner are left alone (and counted). */
export function planAssign(items: readonly AssignItem[], ownerId: string, members: ReadonlyArray<{ id: string }>): AssignPlan {
  const blockers: Blocker[] = [];
  if (!ownerId || !members.some((m) => m.id === ownerId)) blockers.push({ id: "owner", text: "Choose someone from this account's team." });
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.contactId) ? false : (seen.add(i.contactId), true)));
  if (unique.length === 0) blockers.push({ id: "none", text: "Choose at least one person." });
  const same = unique.filter((i) => i.currentOwner === ownerId);
  const todo = unique.filter((i) => i.currentOwner !== ownerId);
  const change = todo.slice(0, BATCH_CAPS.assign);
  return { change, same, overCap: todo.length - change.length, blockers };
}

/** Claim: a person takes a lead nobody owns. Only an ownerless lead can be claimed; the person must be on the account's team. */
export function claimBlockers(f: { currentOwner: string | null; me: string | null; members: ReadonlyArray<{ id: string }> }): Blocker[] {
  if (!f.me) return [{ id: "who", text: "Sign in again, then claim." }];
  if (f.currentOwner === f.me) return [{ id: "mine", text: "This lead is already yours." }];
  if (f.currentOwner) return [{ id: "taken", text: "Someone already owns this lead. Ask an administrator to change the owner." }];
  if (!f.members.some((m) => m.id === f.me)) return [{ id: "team", text: "SubSync cannot match your sign-in to this account's team, so it cannot claim for you." }];
  return [];
}

/** Plain words for the line under a changed row. */
export const dryRunWords = (reason: "switch" | "account") => (reason === "account" ? "Not allowed for this account yet, so nothing was sent." : "Changes from SubSync are switched off, so nothing was sent.");
