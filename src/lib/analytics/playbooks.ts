// Industry playbooks: what matters for each kind of client, and sensible defaults. Pure (no database
// or network imports) so it can be unit tested.
//
// An agency types a free-text industry on each client ("Dental", "Boutique", "Roofing"). A playbook
// groups those into a handful of kinds so the filter, the reply targets and the checklists can fit the
// business: a clinic cares about no-shows and recall, an estate agent about the first five minutes,
// a boutique about repeat customers and birthdays.

export type PlaybookId = "medical" | "real_estate" | "retail_fashion" | "legal_finance" | "home_services" | "fitness_beauty";

export type Playbook = {
  id: PlaybookId;
  label: string;
  match: RegExp;
  /** A reply target that fits how fast this kind of customer moves, in hours. */
  replyHours: number;
  replyWhy: string;
  staleDays: number;
  dormantDays: number;
  /** What to watch, in the order it matters. */
  watch: string[];
  /** Call lists in the app that suit this kind of client. */
  callLists: Array<{ id: string; why: string }>;
  checklist: string[];
  privacy?: string;
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "medical", label: "Medical, dental and health clinics",
    match: /medic|dental|dentist|clinic|health|doctor|physio|chiro|therap|optic|derm|pharm|\bvet|orthodon|hospital|care\b/i,
    replyHours: 2, replyWhy: "People choosing a clinic book with the first one that answers.", staleDays: 14, dormantDays: 30,
    watch: ["Show rate and no-shows", "Patients due a recall (not seen in 6 months or more)", "Unconfirmed appointments in the next 2 days", "Reply time on new enquiries"],
    callLists: [{ id: "noshow_recovery", why: "Rebook missed appointments while it is fresh." }, { id: "customers_followup", why: "Recall patients who have not been in for a while." }, { id: "new_unanswered", why: "Answer new enquiries first." }],
    checklist: ["Reminder workflow confirms every appointment", "Recall message set for 6 months", "Consent and opt-out wording checked", "Booking calendar linked on the website"],
    privacy: "SubSync stores who wrote and when, never the message text, which suits clinics. It is not a compliance certification: check your own rules.",
  },
  {
    id: "real_estate", label: "Real estate and property",
    match: /real ?estate|realt|property|properties|broker|letting|estate agen|mortgage|conveyanc|developer/i,
    replyHours: 1, replyWhy: "The agent who replies in the first minutes usually wins the viewing.", staleDays: 14, dormantDays: 21,
    watch: ["Speed to first reply on new enquiries", "Viewing show rate", "Enquiries that went cold", "Past clients due a check-in"],
    callLists: [{ id: "new_unanswered", why: "New enquiries with no reply." }, { id: "lead_recency", why: "Today's fresh leads, newest first." }, { id: "hot_uncontacted", why: "Warm deals nobody has touched for 3 days." }],
    checklist: ["Instant text on every new enquiry", "Viewing reminder 24 hours and 2 hours before", "Past-client nurture (birthdays, anniversaries)", "Lead source recorded on every enquiry"],
  },
  {
    id: "retail_fashion", label: "Fashion, retail and e-commerce",
    match: /fashion|boutique|apparel|cloth|retail|\bshops?\b|\bstores?\b|jewel|e-?commerce|merch|\bwear\b|\bgifts?\b/i,
    replyHours: 8, replyWhy: "Shoppers are less urgent but expect an answer the same day.", staleDays: 45, dormantDays: 45,
    watch: ["Repeat customers and VIPs", "Customers gone quiet (win-back)", "Birthdays coming up", "Lead source that actually buys"],
    callLists: [{ id: "win_back", why: "Customers who stopped buying." }, { id: "recent_customers", why: "Recent buyers: ask for a referral or review." }, { id: "customers_followup", why: "Regulars due a check-in." }],
    checklist: ["Birthday offer set up", "VIP tag defined", "Win-back message at 90 days quiet", "Abandoned enquiry follow-up"],
  },
  {
    id: "legal_finance", label: "Legal, accounting and finance",
    match: /\blaw|legal|attorney|solicitor|accountan|accounting|\btax\b|financ|insur|wealth|advis|bookkeep/i,
    replyHours: 4, replyWhy: "Clients expect a prompt reply but not an instant one.", staleDays: 21, dormantDays: 45,
    watch: ["Proposals going quiet", "Enquiries not yet contacted", "Client check-ins due"],
    callLists: [{ id: "proposal_stale", why: "Proposals and quotes with no reply for a week." }, { id: "hot_uncontacted", why: "Warm matters nobody has touched." }, { id: "new_unanswered", why: "New enquiries first." }],
    checklist: ["Intake form captures the matter type", "Conflict check before the first call", "Engagement letter stage in the pipeline"],
  },
  {
    id: "home_services", label: "Home services and trades",
    match: /roof|hvac|plumb|electric|landscap|clean|pest|contractor|construction|solar|garage|remodel|paint|handyman|fencing|window/i,
    replyHours: 1, replyWhy: "Someone with a leak or a broken boiler calls the next number if you do not pick up.", staleDays: 14, dormantDays: 30,
    watch: ["Speed to first reply", "Estimates going quiet", "Missed enquiries", "Past customers due a seasonal visit"],
    callLists: [{ id: "new_unanswered", why: "New enquiries with no reply." }, { id: "proposal_stale", why: "Estimates with no answer." }, { id: "win_back", why: "Past customers for a seasonal visit." }],
    checklist: ["Missed-call text back", "Estimate follow-up at 2, 5 and 10 days", "Review request after every job", "Seasonal reactivation message"],
  },
  {
    id: "fitness_beauty", label: "Fitness, beauty and wellness",
    match: /\bgym|fitness|yoga|pilates|studio|\bspa\b|wellness|salon|barber|massage|beauty|\bnails?\b|\blash|personal train/i,
    replyHours: 4, replyWhy: "Trial bookings are impulse decisions that fade within a day.", staleDays: 21, dormantDays: 21,
    watch: ["Trial bookings that showed", "No-shows to rebook", "Members drifting away", "Referrals"],
    callLists: [{ id: "noshow_recovery", why: "Rebook missed sessions." }, { id: "win_back", why: "Lapsed members." }, { id: "new_unanswered", why: "New enquiries first." }],
    checklist: ["Trial class follow-up", "No-show text within an hour", "Save offer before a membership is cancelled", "Referral ask after 30 days"],
  },
];

export function playbookFor(industry: string | null | undefined): Playbook | null {
  const text = (industry ?? "").trim();
  if (!text) return null;
  return PLAYBOOKS.find((p) => p.match.test(text)) ?? null;
}

// The key the filter uses: a playbook id, "other" (typed but unrecognised) or "unset".
export function industryKey(industry: string | null | undefined): PlaybookId | "other" | "unset" {
  const text = (industry ?? "").trim();
  if (!text) return "unset";
  return playbookFor(text)?.id ?? "other";
}

export const INDUSTRY_KEY_LABEL: Record<string, string> = {
  ...Object.fromEntries(PLAYBOOKS.map((p) => [p.id, p.label])),
  other: "Other industries",
  unset: "Industry not set",
};

// Options for the filter: the kinds actually present among the accounts, with counts, most common first.
export function industryOptions(industries: Array<string | null>): Array<{ key: string; label: string; accounts: number }> {
  const counts = new Map<string, number>();
  for (const i of industries) counts.set(industryKey(i), (counts.get(industryKey(i)) ?? 0) + 1);
  return [...counts.entries()].map(([key, accounts]) => ({ key, label: INDUSTRY_KEY_LABEL[key], accounts })).sort((a, b) => b.accounts - a.accounts || a.label.localeCompare(b.label));
}

// Keep only the accounts that match the chosen filter (either or both may be empty).
export function matchesSegment(acct: { industry: string | null; owner: string | null }, filter: { industry?: string | null; owner?: string | null }): boolean {
  if (filter.industry && industryKey(acct.industry) !== filter.industry) return false;
  if (filter.owner && (acct.owner ?? "").trim().toLowerCase() !== filter.owner.trim().toLowerCase()) return false;
  return true;
}

// A reply target for one account: its playbook's when the agency has switched industry targets on.
export function replyHoursFor(industry: string | null | undefined, global: number, useIndustry: boolean): number {
  if (!useIndustry) return global;
  return playbookFor(industry)?.replyHours ?? global;
}
