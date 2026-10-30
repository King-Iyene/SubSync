// Smart call queue (spec section 8): preset definitions, priority scoring and input validation.
// Pure, so the rules are unit tested. The database side lives in call-queries.ts.

export const PRESETS = [
  { id: "hot_uncontacted", label: "Hot leads not contacted in 3+ days", help: "Contacts with an open deal and no activity for 3 days or more, biggest deals first." },
  { id: "new_unanswered", label: "New leads with no reply (last 4 hours)", help: "Just came in and nobody has messaged them yet. Call now." },
  { id: "proposal_stale", label: "Proposal stage, quiet for 7+ days", help: "Deals sitting in a proposal, quote or negotiation stage with no activity for a week." },
  { id: "customers_followup", label: "Customers due a check-in", help: "Customers with no activity for 60 days or more." },
  { id: "lead_recency", label: "Newest leads (last 24 hours)", help: "Fresh leads with no deal yet, newest first. Speed to lead wins deals." },
  { id: "win_back", label: "Win-back: customers gone quiet", help: "Won a deal over 180 days ago and have nothing open now, biggest first." },
  { id: "noshow_recovery", label: "No-shows to rebook (last 14 days)", help: "Missed an appointment in the last two weeks and have not been booked again. Call to rebook." },
  { id: "recent_customers", label: "Recent customers (referral requests)", help: "Won a deal in the last 90 days. A good moment to ask for a referral." },
  { id: "follow_ups_due", label: "Follow-ups due", help: "Contacts you marked 'follow up' whose date has arrived." },
  { id: "custom", label: "Build your own", help: "Filter by tag, account, how long since contact, and deal status." },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];
const PRESET_IDS = new Set<string>(PRESETS.map((p) => p.id));

export const OUTCOMES = ["answered", "voicemail", "no_answer", "wrong_number", "booked", "not_interested", "follow_up"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  answered: "Answered", voicemail: "Voicemail", no_answer: "No answer", wrong_number: "Wrong number", booked: "Booked", not_interested: "Not interested", follow_up: "Follow up",
};

export type Filters = {
  preset: PresetId;
  location?: string;
  tag?: string;
  idleDays?: number;
  deal?: "open" | "none" | "any";
};

const LOCATION_ID = /^[A-Za-z0-9_-]{3,64}$/;

// Accepts anything (query string or saved JSON) and returns clean filters, or an error message.
export function parseFilters(input: unknown): { ok: true; filters: Filters } | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const preset = typeof o.preset === "string" ? o.preset : "hot_uncontacted";
  if (!PRESET_IDS.has(preset)) return { ok: false, error: "Unknown list type" };
  const f: Filters = { preset: preset as PresetId };
  if (o.location !== undefined && o.location !== "" && o.location !== null) {
    if (typeof o.location !== "string" || !LOCATION_ID.test(o.location)) return { ok: false, error: "Invalid account" };
    f.location = o.location;
  }
  if (o.tag !== undefined && o.tag !== "" && o.tag !== null) {
    if (typeof o.tag !== "string" || o.tag.length > 60) return { ok: false, error: "Tag is too long" };
    f.tag = o.tag.trim();
  }
  if (o.idleDays !== undefined && o.idleDays !== "" && o.idleDays !== null) {
    const n = Number(o.idleDays);
    if (!Number.isInteger(n) || n < 0 || n > 3650) return { ok: false, error: "Days must be a whole number from 0 to 3650" };
    f.idleDays = n;
  }
  if (o.deal !== undefined && o.deal !== "" && o.deal !== null) {
    if (o.deal !== "open" && o.deal !== "none" && o.deal !== "any") return { ok: false, error: "Deal filter must be open, none or any" };
    f.deal = o.deal;
  }
  return { ok: true, filters: f };
}

export function parseOutcome(input: unknown):
  | { ok: true; value: { locationId: string; contactId: string; outcome: Outcome; note: string | null; followUpInDays: number | null } }
  | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : null) as Record<string, unknown> | null;
  if (!o) return { ok: false, error: "Send a JSON body" };
  if (typeof o.locationId !== "string" || !LOCATION_ID.test(o.locationId)) return { ok: false, error: "Invalid account" };
  if (typeof o.contactId !== "string" || o.contactId.length < 3 || o.contactId.length > 128) return { ok: false, error: "Invalid contact" };
  if (typeof o.outcome !== "string" || !(OUTCOMES as readonly string[]).includes(o.outcome)) return { ok: false, error: "Unknown outcome" };
  let note: string | null = null;
  if (o.note !== undefined && o.note !== null && o.note !== "") {
    if (typeof o.note !== "string" || o.note.length > 500) return { ok: false, error: "Note is too long (500 characters)" };
    note = o.note.trim();
  }
  let followUpInDays: number | null = null;
  if (o.followUpInDays !== undefined && o.followUpInDays !== null && o.followUpInDays !== "") {
    const n = Number(o.followUpInDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) return { ok: false, error: "Follow-up must be 0 to 365 days" };
    followUpInDays = n;
  }
  if (o.outcome === "follow_up" && followUpInDays === null) followUpInDays = 3;
  return { ok: true, value: { locationId: o.locationId, contactId: o.contactId, outcome: o.outcome as Outcome, note, followUpInDays } };
}

// ---------------- priority (8.3) ----------------

export type CallFacts = {
  openValue: number;
  openCount: number;
  wonValue: number;
  idleDays: number | null; // days since last activity, null when never
  dateAddedDays: number | null; // age of the contact
  hasEmail: boolean;
  hasPhone: boolean;
};

// 0 to 100: who is the most important person to call next. Temperature (open deal, fresh lead),
// size (deal value on a log scale), and how long they have waited. Cannot reach them, lower score.
export function callPriority(f: CallFacts): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (f.openCount > 0) { score += 30; reasons.push("Open deal"); }
  const value = Math.max(f.openValue, f.wonValue * 0.5);
  if (value > 0) {
    const v = Math.min(25, Math.round(Math.log10(value + 1) * 6));
    score += v;
    if (f.openValue > 0) reasons.push(`Deal worth $${Math.round(f.openValue).toLocaleString("en-US")}`);
  }
  if (f.dateAddedDays !== null && f.dateAddedDays <= 1) { score += 25; reasons.push("Brand new lead"); }
  else if (f.dateAddedDays !== null && f.dateAddedDays <= 7) score += 12;
  if (f.idleDays !== null && f.idleDays >= 3 && f.idleDays <= 45 && f.openCount > 0) {
    score += Math.min(15, Math.round(f.idleDays / 3));
    reasons.push(`Waiting ${f.idleDays} days`);
  }
  if (!f.hasPhone) { score -= 15; reasons.push("No phone number"); }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ---------------- power hour (8.6) ----------------

export function powerHourStats(outcomes: Array<{ outcome: string }>) {
  const calls = outcomes.length;
  const reached = outcomes.filter((o) => o.outcome === "answered" || o.outcome === "booked" || o.outcome === "not_interested").length;
  const booked = outcomes.filter((o) => o.outcome === "booked").length;
  return { calls, reached, booked, reachRate: calls ? Math.round((reached / calls) * 100) : null };
}
