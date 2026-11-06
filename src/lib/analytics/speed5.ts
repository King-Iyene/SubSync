// Speed to lead, fifth pass (stage SPEED5). Pure rules: no database, no network. Every number here has a test in src/lib/__tests__/speed5.test.ts.
//
// 1. Booking rate by first-reply time (the money chart), with minimum samples so a handful of leads never makes a claim.
// 2. The escalation ladder: past the account's own target, then the next person, then a manager.
// 3. Round-robin suggestion: who should get an unowned lead next.
// 4. Money at risk: the booking-rate gap times the account's own average deal, only when the data is enough.
// 5. Lead validity at capture (quietly lowers the quality score) and the duplicate guard / repeat enquirer built on the Clean-up match engine.

import type { Person } from "./dedupe.ts";
import { scoreEvidence, type Tier } from "./match-evidence.ts";

/** The account's own reply target when it set one, else the default. The ONE place this choice is made for alerts and for Today's ledger. */
export const targetOf = (r: { targetMinutes?: number | null }, defaultMinutes: number): number =>
  typeof r.targetMinutes === "number" && r.targetMinutes > 0 ? r.targetMinutes : defaultMinutes;

// ---------------------------------------------------------------- 1. booking rate by first-reply time

export const BOOKING_BUCKETS = [
  { key: "m5", label: "Within 5 min", from: 0, to: 300 },
  { key: "m15", label: "5 to 15 min", from: 300, to: 900 },
  { key: "h1", label: "15 min to 1 h", from: 900, to: 3600 },
  { key: "h4", label: "1 to 4 h", from: 3600, to: 14_400 },
  { key: "late", label: "Over 4 h", from: 14_400, to: Infinity },
  { key: "none", label: "No reply", from: -1, to: -1 },
] as const;
export type BookingKey = (typeof BOOKING_BUCKETS)[number]["key"];

/** A bucket needs this many leads before its rate is shown; the whole chart needs MIN_BOOKING_TOTAL. */
export const MIN_BOOKING_BUCKET = 10;
export const MIN_BOOKING_TOTAL = 30;

export type BookingLead = { replySeconds: number | null; booked: boolean };
export type BookingBucket = { key: BookingKey; label: string; leads: number; booked: number; rate: number | null; enough: boolean };

/** Which bucket one lead falls in. A reply of exactly 300 seconds belongs to "within 5 min" (the boundary is inclusive on the faster side). */
export function bucketOf(replySeconds: number | null): BookingKey {
  if (replySeconds === null) return "none";
  const s = Math.max(0, replySeconds);
  for (const b of BOOKING_BUCKETS) if (b.key !== "none" && (s <= b.to) && s >= b.from) return b.key;
  return "late";
}

export function bookingByReplyTime(leads: readonly BookingLead[]) {
  const counts = new Map<BookingKey, { leads: number; booked: number }>();
  for (const l of leads) { const k = bucketOf(l.replySeconds); const c = counts.get(k) ?? { leads: 0, booked: 0 }; c.leads += 1; if (l.booked) c.booked += 1; counts.set(k, c); }
  return bookingFromCounts(counts);
}
/** The same chart from counts per bucket already worked out in the database (so 100,000 leads are never read one by one). */
export function bookingFromCounts(counts: ReadonlyMap<BookingKey, { leads: number; booked: number }>) {
  const buckets: BookingBucket[] = BOOKING_BUCKETS.map((b) => ({ key: b.key, label: b.label, leads: counts.get(b.key)?.leads ?? 0, booked: counts.get(b.key)?.booked ?? 0, rate: null, enough: false }));
  const leads = { length: buckets.reduce((n, b) => n + b.leads, 0) };
  for (const b of buckets) { b.enough = b.leads >= MIN_BOOKING_BUCKET; b.rate = b.enough ? Math.round((b.booked / b.leads) * 1000) / 10 : null; }
  const total = leads.length;
  const enough = total >= MIN_BOOKING_TOTAL;
  // The headline compares the fast group (within 15 minutes) with the slow group (replied after more than an hour), each pooled and each needing its own minimum.
  const pool = (keys: BookingKey[]) => { const m = buckets.filter((b) => keys.includes(b.key)); return { leads: m.reduce((s, b) => s + b.leads, 0), booked: m.reduce((s, b) => s + b.booked, 0) }; };
  const fast = pool(["m5", "m15"]), slow = pool(["h4", "late"]);
  const ok = enough && fast.leads >= MIN_BOOKING_BUCKET && slow.leads >= MIN_BOOKING_BUCKET;
  const fastRate = ok ? fast.booked / fast.leads : null, slowRate = ok ? slow.booked / slow.leads : null;
  const multiple = fastRate !== null && slowRate !== null && slowRate > 0 ? Math.round((fastRate / slowRate) * 10) / 10 : null;
  return { total, enough, buckets, fastRate, slowRate, multiple, fastLeads: fast.leads, slowLeads: slow.leads };
}

// ---------------------------------------------------------------- 4. money at risk

export type RiskInput = { waiting: number; fastRate: number | null; slowRate: number | null; avgDeal: number | null; openDealDollars: number };
/**
 * The meter on Race. `counted` is a fact (open deals of the people waiting past target). `estimate` exists only when the booking gap is measured (enough leads in both groups) AND the
 * account knows its own average deal: waiting leads x the booking-rate drop from slow replies x the average deal. Never negative; no estimate when slow replies book as well as fast ones.
 */
export function moneyAtRisk(i: RiskInput): { counted: number; estimate: number | null } {
  const counted = Math.max(0, Math.round(i.openDealDollars));
  if (i.fastRate === null || i.slowRate === null || i.avgDeal === null || i.avgDeal <= 0 || i.waiting <= 0) return { counted, estimate: null };
  const drop = i.fastRate - i.slowRate;
  if (drop <= 0) return { counted, estimate: null };
  return { counted, estimate: Math.round(i.waiting * drop * i.avgDeal) };
}

// ---------------------------------------------------------------- 2. the escalation ladder

export type Ladder = { enabled: boolean; nextAfterMin: number; managerAfterMin: number };
export const DEFAULT_LADDER: Ladder = { enabled: true, nextAfterMin: 15, managerAfterMin: 45 };
const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };

/** Reads a saved ladder (anything stored is untrusted). Minutes are whole numbers 1 to 1440; the manager step is always later than the next-person step. */
export function normLadder(raw: unknown): Ladder {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next = clampInt(o.nextAfterMin, 1, 1440, DEFAULT_LADDER.nextAfterMin);
  let mgr = clampInt(o.managerAfterMin, 1, 1440, DEFAULT_LADDER.managerAfterMin);
  if (mgr <= next) mgr = Math.min(1440, next + 1);
  return { enabled: o.enabled === undefined ? DEFAULT_LADDER.enabled : o.enabled === true, nextAfterMin: next, managerAfterMin: mgr };
}

export type Step = 0 | 1 | 2 | 3;
export const STEP_WORDS: Record<Step, string> = { 0: "inside the target", 1: "the owner is told", 2: "the next person is told", 3: "the manager is told" };

/**
 * Where an unanswered lead stands. `waitedMin` is minutes on the lead's own clock (business hours already applied when that setting is on). 0 = still inside the account's target;
 * 1 = past the target (owner); 2 = `nextAfterMin` minutes past it (next person); 3 = `managerAfterMin` past it (manager). With the ladder off, past the target is step 1 and stays there.
 */
export function ladderStep(waitedMin: number, targetMin: number, ladder: Ladder): Step {
  if (!(waitedMin > targetMin)) return 0;
  if (!ladder.enabled) return 1;
  const over = waitedMin - targetMin;
  if (over >= ladder.managerAfterMin) return 3;
  if (over >= ladder.nextAfterMin) return 2;
  return 1;
}

/** Minutes until a waiting lead reaches its next step (null at the top or inside the target's own clock rounding). Used for the preview "in 12 min". */
export function minutesToNextStep(waitedMin: number, targetMin: number, ladder: Ladder): number | null {
  const step = ladderStep(waitedMin, targetMin, ladder);
  const at = step === 0 ? targetMin : step === 1 ? (ladder.enabled ? targetMin + ladder.nextAfterMin : null) : step === 2 ? targetMin + ladder.managerAfterMin : null;
  return at === null ? null : Math.max(0, Math.ceil(at - waitedMin));
}

export type WaitingLead = { locationId: string; contactId: string; waitedMin: number; targetMin: number; ownerId: string | null };
/** The current step of each waiting lead and the highest step per account (what the alert says). */
export function escalate(leads: readonly WaitingLead[], ladder: Ladder) {
  const out = leads.map((l) => ({ ...l, step: ladderStep(l.waitedMin, l.targetMin, ladder) })).filter((l) => l.step > 0);
  const top = new Map<string, Step>();
  for (const l of out) if ((top.get(l.locationId) ?? 0) < l.step) top.set(l.locationId, l.step);
  return { leads: out, topByAccount: top };
}

// ---------------------------------------------------------------- 3. round-robin

export type Candidate = { userId: string; open: number; recent: number };
/** Fewest open (waiting) leads first, then fewest leads in the last 30 days, then the smaller id so the answer never flips between reads. `skip` leaves out the current owner. */
export function roundRobinPick(c: readonly Candidate[], skip: ReadonlySet<string> = new Set()): string | null {
  const pool = c.filter((x) => !skip.has(x.userId));
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => a.open - b.open || a.recent - b.recent || (a.userId < b.userId ? -1 : 1))[0].userId;
}

// ---------------------------------------------------------------- 5a. lead validity at capture

const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "throwawaymail.com", "dispostable.com", "maildrop.cc", "fakeinbox.com"]);
const ROLE = new Set(["info", "admin", "sales", "support", "contact", "office", "hello", "noreply", "no-reply", "webmaster", "postmaster", "billing", "help", "team", "service", "enquiries", "inquiries"]);

export type Flag = "email_format" | "email_disposable" | "email_role" | "phone_short" | "phone_fake";
export const FLAG_WORDS: Record<Flag, string> = {
  email_format: "email does not look valid", email_disposable: "throwaway email address", email_role: "shared mailbox, not a person", phone_short: "phone number too short", phone_fake: "phone number looks made up",
};

/** Checks only what the lead typed. Nothing is looked up and nothing is sent. Empty fields raise no flag (a missing field is not an invalid one). */
export function leadFlags(l: { email?: string | null; phone?: string | null }): Flag[] {
  const out: Flag[] = [];
  const e = (l.email ?? "").trim().toLowerCase();
  if (e) {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) out.push("email_format");
    else {
      const at = e.lastIndexOf("@");
      if (DISPOSABLE.has(e.slice(at + 1))) out.push("email_disposable");
      if (ROLE.has(e.slice(0, at).split("+")[0])) out.push("email_role");
    }
  }
  const raw = (l.phone ?? "").trim();
  if (raw) {
    const d = raw.replace(/\D/g, "");
    const national = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
    if (d.length < 7) out.push("phone_short");
    else if (/^(\d)\1+$/.test(national) || /^(0123456789|1234567890|9876543210)$/.test(national) || /^\d{3}555\d{4}$/.test(national)) out.push("phone_fake");
  }
  return out;
}

/** Points taken off the quality score for each flag (the score is a guess about who to call first; a flag only lowers it, it never hides a lead). */
export const FLAG_PENALTY: Record<Flag, number> = { email_format: 0, email_disposable: 20, email_role: 10, phone_short: 0, phone_fake: 15 };
export const flagPenalty = (f: readonly Flag[]): number => f.reduce((s, x) => s + FLAG_PENALTY[x], 0);

// ---------------------------------------------------------------- 5b. duplicate guard and repeat enquirer

const BY_AGE = (a: Person, b: Person) => (Date.parse(a.createdAt ?? "") || Infinity) - (Date.parse(b.createdAt ?? "") || Infinity);

export type DupHit = { contactId: string; name: string; score: number; tier: Tier; reasons: string[]; olderThanLead: boolean };
/**
 * Is this new lead probably someone already in the account? Uses the Clean-up match engine (scoreEvidence) and nothing else; only "sure" or "likely" counts, so a maybe never
 * raises a flag. The record to reply to is the OLDER one (it holds the history). A candidate created AFTER the lead is never offered as the original. Read only.
 */
export function duplicateOf(lead: Person, candidates: readonly Person[]): DupHit | null {
  const leadAt = Date.parse(lead.createdAt ?? "");
  let best: { p: Person; e: ReturnType<typeof scoreEvidence> } | null = null;
  for (const p of candidates) {
    if (p.contactId === lead.contactId) continue;
    const created = Date.parse(p.createdAt ?? "");
    if (Number.isFinite(leadAt) && Number.isFinite(created) && created >= leadAt) continue;
    const e = scoreEvidence(lead, p);
    if (e.tier !== "sure" && e.tier !== "likely") continue;
    if (!best || e.score > best.e.score || (e.score === best.e.score && BY_AGE(p, best.p) < 0)) best = { p, e };
  }
  return best ? { contactId: best.p.contactId, name: best.p.name, score: best.e.score, tier: best.e.tier, reasons: best.e.reasons.slice(0, 3), olderThanLead: true } : null;
}

/** A repeat enquirer: the same person sent another enquiry. They are warm, so the lead rises in the ranking. A sure match counts for more than a likely one. */
export const REPEAT_BOOST: Record<Tier, number> = { sure: 30, likely: 15, maybe: 0, none: 0 };
export const repeatBoost = (hit: Pick<DupHit, "tier"> | null): number => (hit ? REPEAT_BOOST[hit.tier] : 0);
