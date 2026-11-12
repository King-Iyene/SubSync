// WHICH COPY IS THE MASTER (the one that is kept). Never "first" and never "oldest" on its own: a transparent ranking, written down in docs/METRICS.md ("Master record").
// Signals in priority order: 1 ongoing payment, 2 deals (won or open), 3 booked appointments, 4 automation enrolment, 5 course or membership, 6 a conversation, 7 completeness, 8 oldest.
// Rules: a signal SubSync cannot read is "unknown", never "none". While any top signal (1, 4, 5) is unreadable for the group, nothing is pre-selected. When two copies both have a top signal
// (tiers 1 to 6), nothing is pre-selected either: the person chooses. Completeness and age only decide when everything above is readable and neither copy has a top signal.

export type MasterPerson = {
  contactId: string; name: string; email: string | null; phone: string | null; ownerName?: string | null; ownerId?: string | null; tags: readonly string[]; createdAt: string | null;
  openDeals: number; wonDeals: number; hasConversation: boolean; appointments?: number; nextAppointmentAt?: string | null;
  /** Only set when SubSync can really read it. undefined or null = unknown, which is NOT the same as false. */
  payments?: boolean | null; workflows?: boolean | null; courses?: boolean | null;
};

export type Unreadable = "payments" | "workflows" | "courses";
export const UNREADABLE_WORDS: Record<Unreadable, string> = { payments: "payments and subscriptions", workflows: "automations", courses: "courses and memberships" };
export const CANNOT_SEE = "We cannot see payments, automations or courses yet: check this person in your CRM before merging.";

export type CopyWhy = { contactId: string; signals: string[]; hints: string[]; unknown: Unreadable[]; line: string };
export type MasterPick = { suggestedId: string | null; mustChoose: boolean; why: string | null; copies: CopyWhy[] };

const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;
const WEAK_TAG = /^(subscriber|subscription|customer|client|member|paying|paid|active)/i;
const first = (p: MasterPerson) => (p.name.trim().split(/\s+/)[0] || "This copy");
const details = (p: MasterPerson) => [p.name.trim() && p.name !== "Unnamed contact", p.email, p.phone, p.ownerName || p.ownerId].filter(Boolean).length;
const dayText = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** What is read directly for one copy. `unknown` lists every signal that cannot be read, so the screen can say so. */
export function signalsOf(p: MasterPerson, unreadable: readonly Unreadable[]): CopyWhy {
  const signals: string[] = [], hints: string[] = [];
  const unknown = (["payments", "workflows", "courses"] as const).filter((k) => unreadable.includes(k) && (p[k] === undefined || p[k] === null));
  if (p.payments === true) signals.push("Has an ongoing payment or subscription");
  if (p.wonDeals > 0) signals.push(`${plural(p.wonDeals, "won deal", "won deals")}`);
  if (p.openDeals > 0) signals.push(`${plural(p.openDeals, "open deal", "open deals")}`);
  if ((p.appointments ?? 0) > 0) signals.push(`${plural(p.appointments ?? 0, "appointment booked", "appointments booked")}${p.nextAppointmentAt ? `, next on ${dayText(p.nextAppointmentAt)}` : ""}`);
  if (p.workflows === true) signals.push("Is in an active automation");
  if (p.courses === true) signals.push("Is in a course or membership");
  if (p.hasConversation) signals.push("Has a conversation on file");
  for (const t of p.tags) if (WEAK_TAG.test(t.trim())) hints.push(`Tagged "${t.trim()}" (a tag, not a payment record)`);
  signals.push(`${details(p)} of 4 details filled in`);
  const line = [...signals, ...hints].join(" · ");
  return { contactId: p.contactId, signals, hints, unknown, line };
}

type Tier = { id: string; label: string; has: (p: MasterPerson) => boolean };
const TIERS: Tier[] = [
  { id: "payments", label: "an ongoing payment or subscription", has: (p) => p.payments === true },
  { id: "deals", label: "a deal", has: (p) => p.wonDeals > 0 || p.openDeals > 0 },
  { id: "appointments", label: "a booked appointment", has: (p) => (p.appointments ?? 0) > 0 },
  { id: "workflows", label: "an active automation", has: (p) => p.workflows === true },
  { id: "courses", label: "a course or membership", has: (p) => p.courses === true },
  { id: "conversation", label: "a conversation", has: (p) => p.hasConversation },
];

/** Today nothing reads payments, automations or courses, so all three are unreadable. A future data source removes an id here and the ranking starts deciding. */
export const DEFAULT_UNREADABLE: readonly Unreadable[] = ["payments", "workflows", "courses"];

export function pickMaster(people: readonly MasterPerson[], unreadable: readonly Unreadable[] = DEFAULT_UNREADABLE): MasterPick {
  const copies = people.map((p) => signalsOf(p, unreadable));
  const stop = (why: string): MasterPick => ({ suggestedId: null, mustChoose: true, why, copies });
  // 1. A known tie in one top tier. Said first because it is the sharper message.
  for (const t of TIERS) {
    const holders = people.filter(t.has);
    if (holders.length >= 2) return stop(holders.length === 2 ? `Both copies have ${t.label}: choose the master yourself.` : `${holders.length} copies have ${t.label}: choose the master yourself.`);
    if (holders.length === 1 && unreadable.length === 0) return { suggestedId: holders[0].contactId, mustChoose: false, why: null, copies };
    if (holders.length === 1) break; // unknown is never "none": the person chooses
  }
  if (unreadable.length > 0) return stop(`${CANNOT_SEE.replace(": check this person in your CRM before merging.", "")}, so SubSync cannot tell which copy is the paying customer. Choose the master yourself.`);
  // 2. Nothing above separates them: completeness, then the oldest. A full tie asks the person.
  const best = Math.max(...people.map(details));
  const fullest = people.filter((p) => details(p) === best);
  if (fullest.length === 1) return { suggestedId: fullest[0].contactId, mustChoose: false, why: null, copies };
  if (fullest.every((p) => p.createdAt)) {
    const dated = [...fullest].sort((a, b) => (a.createdAt as string).localeCompare(b.createdAt as string));
    if (dated[0].createdAt !== dated[1].createdAt) return { suggestedId: dated[0].contactId, mustChoose: false, why: null, copies };
  }
  return stop(`${fullest.map(first).join(" and ")} look equal: choose the master yourself.`);
}
