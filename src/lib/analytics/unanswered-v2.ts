// Unanswered messages, second pass (docs/UNANSWERED_REVIEW.md, docs/METRICS.md "Unanswered messages, second pass"). Pure: no database, no network, no React, so every
// sentence, ranking, list and number on the rebuilt screen is unit tested. Nothing here measures anything new. WHICH conversations are waiting is `waitingState` in
// waiting.ts, the one definition Today, the Account audit and the exports use (the customer wrote last, the reply target has passed, inside the 30 day window). What this
// file adds is the person (a person is counted ONCE, however many conversations they have waiting: the rule of Today, third pass), the wait buckets, ONE selection that the
// number on a bar and the rows behind it both come from (KF-6), the order and the paging of a list, the rankings of clients and of the people who own the customers, the
// sentences, and the agreement with Today (Today's count is this screen's people plus the new leads who have not written yet, by Today's own `mergeReplies`).
import { costEstimate, costFormula, costLine, MAX_PAGE, pageOf, type AccountFacts } from "./speed-v2.ts";
import { mergeReplies, type WaitingConversation, type WaitingLead } from "./today-queue.ts";
import { channelLabel, waitingState } from "./waiting.ts";

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export { MAX_PAGE, pageOf };

// ---------- what is read, and who is waiting ----------

/** One conversation whose last message is the customer's, as the reads hand it over. The rule that makes it "waiting" is `waitingState`, applied below. */
export type WaitConv = {
  conversationId: string; locationId: string; contactId: string | null; name: string | null;
  lastType: string | null; lastAt: number;
  /** The team member the contact is assigned to (the conversation list does not say who a conversation is assigned to; the page says so). */
  assignedTo: string | null;
  unreadCount: number;
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null;
};

export type Person = {
  /** `account:contact`, or `account:conversation-<id>` for a conversation with no contact on file (the same key Today's mergeReplies uses). */
  key: string; locationId: string; contactId: string | null;
  /** The conversation that has waited longest: where Reply goes. */
  conversationId: string;
  name: string; channel: string; call: boolean;
  /** Epoch ms of the customer's message that nobody answered (the oldest of this person's waiting conversations). */
  lastAt: number;
  /** Whole hours since then. */
  hours: number;
  /** How many conversations of this person are waiting (one person, however many). */
  conversations: number;
  unreadMessages: number;
  assignedTo: string | null;
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null;
  /** Also a new lead nobody has answered: a SUBSET of the people waiting, said ("3 are new leads"), never added. */
  newLead: boolean;
};

export const personKey = (locationId: string, contactId: string | null, conversationId: string) => `${locationId}:${contactId || `conversation-${conversationId}`}`;
const isCall = (type: string | null) => channelLabel(type) === "Call";

/** The conversations that are waiting right now, by the one rule. */
export function waitingConversations(rows: readonly WaitConv[], o: { now: number; slaHours: number }): WaitConv[] {
  return rows.filter((r) => waitingState({ direction: "inbound", at: r.lastAt, type: r.lastType }, o.now, o.slaHours) === "waiting");
}

/** People waiting, each ONCE: the oldest waiting conversation names the wait, the channel and where Reply goes. */
export function peopleOf(waiting: readonly WaitConv[], o: { now: number; names?: ReadonlyMap<string, string> }): Person[] {
  const by = new Map<string, WaitConv[]>();
  for (const c of waiting) {
    const k = personKey(c.locationId, c.contactId, c.conversationId);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  const out: Person[] = [];
  for (const [key, cs] of by) {
    const oldest = [...cs].sort((a, b) => a.lastAt - b.lastAt || a.conversationId.localeCompare(b.conversationId))[0];
    const named = (oldest.name && oldest.name.trim() !== "" ? oldest.name : [...cs].sort((a, b) => a.lastAt - b.lastAt || a.conversationId.localeCompare(b.conversationId)).find((c) => c.name && c.name.trim() !== "")?.name) ?? null;
    out.push({
      key, locationId: oldest.locationId, contactId: oldest.contactId, conversationId: oldest.conversationId, name: named?.trim() || "Unnamed contact",
      channel: channelLabel(oldest.lastType), call: isCall(oldest.lastType), lastAt: oldest.lastAt, hours: Math.max(0, Math.floor((o.now - oldest.lastAt) / HOUR)),
      conversations: cs.length, unreadMessages: cs.reduce((sum, c) => sum + c.unreadCount, 0), assignedTo: oldest.assignedTo, phone: oldest.phone, email: oldest.email, dnd: oldest.dnd, timeZone: oldest.timeZone, newLead: false,
    });
  }
  return out;
}

/** Marks the people who are also new leads nobody has answered (Speed to lead's list). */
export function markNewLeads(people: readonly Person[], leadKeys: ReadonlySet<string>): Person[] {
  return people.map((p) => (leadKeys.has(p.key) ? { ...p, newLead: true } : p));
}

// ---------- the wait buckets: the one chart ----------

export type BucketKey = "h1" | "h4" | "h24" | "h48";
export const BUCKET_KEYS: readonly BucketKey[] = ["h1", "h4", "h24", "h48"];
/** Edges are whole hours. Only the buckets at or past the reply target can hold anyone (with the standard 4 hour target the first one is empty and left out). */
export const BUCKETS: ReadonlyArray<{ key: BucketKey; label: string; min: number; max: number }> = [
  { key: "h1", label: "Under 4 hours", min: 0, max: 4 },
  { key: "h4", label: "4 to 24 hours", min: 4, max: 24 },
  { key: "h24", label: "1 to 2 days", min: 24, max: 48 },
  { key: "h48", label: "2 days or more", min: 48, max: Infinity },
];
export const isBucket = (v: unknown): v is BucketKey => typeof v === "string" && (BUCKET_KEYS as readonly string[]).includes(v);

export function bucketOf(hours: number): BucketKey {
  return hours < 4 ? "h1" : hours < 24 ? "h4" : hours < 48 ? "h24" : "h48";
}
/** The buckets that can hold anyone under this reply target (a person waits at least `slaHours` whole hours). */
export const visibleBuckets = (slaHours: number) => BUCKETS.filter((b) => b.max > slaHours);

/** A wait of a week or more is not an alarm: after a week most are no longer waiting for you (N13, N15). */
export const OVER_A_WEEK_HOURS = 7 * 24;

// ---------- one selection: the figure and the list behind it ----------

export type OwnerChoice = string | null | undefined; // "none", "me", a team member id, or no choice
export type PeopleSort = "wait" | "newest" | "name" | "account";
export const SORTS: readonly PeopleSort[] = ["wait", "newest", "name", "account"];
export type PeopleQuery = {
  bucket?: BucketKey | "all" | null; channel?: string | null; account?: string | null; owner?: OwnerChoice; q?: string | null; sort?: PeopleSort | null; newLead?: boolean;
};
export type Names = ReadonlyMap<string, string>;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

function passes(p: Person, q: PeopleQuery, ctx: { me: string | null; accounts: Names }): boolean {
  if (q.bucket && q.bucket !== "all" && bucketOf(p.hours) !== q.bucket) return false;
  if (q.channel && p.channel !== q.channel) return false;
  if (q.account && p.locationId !== q.account) return false;
  if (q.owner === "none" && p.assignedTo !== null) return false;
  if (q.owner === "me" && !(ctx.me !== null && p.assignedTo === ctx.me)) return false;
  if (q.owner && q.owner !== "none" && q.owner !== "me" && p.assignedTo !== q.owner) return false;
  if (q.newLead && !p.newLead) return false;
  if (q.q) {
    const hay = norm(`${p.name} ${ctx.accounts.get(p.locationId) ?? ""} ${p.channel} ${p.email ?? ""} ${p.phone ?? ""}`);
    if (!q.q.split(/\s+/).filter(Boolean).every((w) => hay.includes(norm(w)))) return false;
  }
  return true;
}

/**
 * THE selection. The number on a bar, a chip, a client or a person and the rows in the list behind it both come from this one function, so they cannot disagree (KF-6).
 * "wait" is the longest wait first; "newest" the shortest wait first; "name" and "account" are alphabetical with the wait as the tie-break. Ties always break the same
 * way (by wait, then name, then key) so a page never shuffles.
 */
export function selectPeople(people: readonly Person[], q: PeopleQuery, ctx: { me: string | null; accounts: Names }): Person[] {
  const out = people.filter((p) => passes(p, q, ctx));
  const tie = (a: Person, b: Person) => a.lastAt - b.lastAt || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  const sort = q.sort ?? "wait";
  out.sort((a, b) => {
    if (sort === "newest") return b.lastAt - a.lastAt || tie(a, b);
    if (sort === "name") return a.name.localeCompare(b.name) || tie(a, b);
    if (sort === "account") return (ctx.accounts.get(a.locationId) ?? "").localeCompare(ctx.accounts.get(b.locationId) ?? "") || tie(a, b);
    return tie(a, b);
  });
  return out;
}

export type Choice = { key: string; label: string; count: number };

/** What each chip would leave: every count is the length of the selection with that one choice changed, so a chip's number is its list. */
export function facetsOf(people: readonly Person[], q: PeopleQuery, ctx: { me: string | null; accounts: Names }) {
  const n = (over: Partial<PeopleQuery>) => selectPeople(people, { ...q, ...over }, ctx).length;
  const buckets: Record<BucketKey | "all", number> = { all: n({ bucket: "all" }), h1: n({ bucket: "h1" }), h4: n({ bucket: "h4" }), h24: n({ bucket: "h24" }), h48: n({ bucket: "h48" }) };
  const owner = { all: n({ owner: null }), none: n({ owner: "none" }), mine: ctx.me ? n({ owner: "me" }) : 0 };
  const channels = channelChoices(selectPeople(people, { ...q, channel: null }, ctx));
  return { buckets, owner, channels };
}

export function channelChoices(people: readonly Person[]): Choice[] {
  const by = new Map<string, number>();
  for (const p of people) by.set(p.channel, (by.get(p.channel) ?? 0) + 1);
  return [...by].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ---------- the headline ----------

export type Facts = { people: number; conversations: number; accounts: number; oldestHours: number | null; noOwner: number; newLeads: number; over24: number; breach24: number };

export function factsOf(people: readonly Person[]): Facts {
  const accounts = new Set<string>();
  let oldest: number | null = null, noOwner = 0, newLeads = 0, over24 = 0, breach24 = 0, conversations = 0;
  for (const p of people) {
    accounts.add(p.locationId); conversations += p.conversations;
    if (oldest === null || p.hours > oldest) oldest = p.hours;
    if (p.assignedTo === null) noOwner += 1;
    if (p.newLead) newLeads += 1;
    if (p.hours >= 24) over24 += 1;
    if (p.hours >= 24) breach24 += 1;
  }
  return { people: people.length, conversations, accounts: accounts.size, oldestHours: oldest, noOwner, newLeads, over24, breach24 };
}

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "5 hours", "1 hour", "26 hours", "3 days": how long, as a person would say it. */
export function longWords(hours: number): string {
  const h = Math.max(0, Math.round(hours));
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${Math.floor(h / 24)} days`;
}
/** The short form for a row: "5 h", "26 h", "3 days". */
export function shortWords(hours: number): string {
  const h = Math.max(0, Math.round(hours));
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}

export type HeadlinePart = { t: string; strong?: boolean };
/** One sentence about who is waiting, and one about how long the longest has waited. */
export function headlineOf(f: Facts, multi: boolean): { parts: HeadlinePart[]; text: string; allClear: boolean } {
  if (f.people === 0) return { parts: [{ t: "Nobody is waiting for a reply." }], text: "Nobody is waiting for a reply.", allClear: true };
  const parts: HeadlinePart[] = [{ t: f.people.toLocaleString("en-US"), strong: true }, { t: ` ${f.people === 1 ? "person is" : "people are"} waiting for a reply` }];
  if (multi && f.accounts > 1) parts.push({ t: ` across ${plural(f.accounts, "client")}` });
  parts.push({ t: "." });
  if (f.oldestHours !== null) parts.push({ t: f.people === 1 ? ` They have waited ${longWords(f.oldestHours)}.` : ` The longest has waited ${longWords(f.oldestHours)}.` });
  return { parts, text: parts.map((p) => p.t).join(""), allClear: false };
}

/** Breach line for the 24-hour alert (Item 3): returns a line when people have waited 24+ hours. */
export function breachLine(f: Facts): { parts: HeadlinePart[]; text: string } | null {
  if (f.breach24 === 0) return null;
  return { parts: [{ t: `${f.breach24.toLocaleString("en-US")} ${f.breach24 === 1 ? "person has" : "people have"} waited more than 24 hours.` }], text: `${f.breach24.toLocaleString("en-US")} ${f.breach24 === 1 ? "person has" : "people have"} waited more than 24 hours.` };
}

/** The primary button's words. */
export const primaryLabel = (people: number) => (people > 1 ? `Reply to the oldest of the ${people.toLocaleString("en-US")} people waiting` : "Reply to the person waiting");

// ---------- rankings ----------

export type AccountRank = { id: string; name: string; count: number; oldestHours: number };
/** Clients ranked by people waiting, most first, then the longest wait, then the name (so the order never flickers). */
export function rankAccounts(people: readonly Person[], names: Names): AccountRank[] {
  const by = new Map<string, { count: number; oldest: number }>();
  for (const p of people) {
    const x = by.get(p.locationId) ?? { count: 0, oldest: 0 };
    by.set(p.locationId, { count: x.count + 1, oldest: Math.max(x.oldest, p.hours) });
  }
  return [...by].map(([id, x]) => ({ id, name: names.get(id) ?? "Client account", count: x.count, oldestHours: x.oldest }))
    .sort((a, b) => b.count - a.count || b.oldestHours - a.oldestHours || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type OwnerRank = { key: string; label: string; state: string; count: number; oldestHours: number };
/** The people who own the waiting customers (the contact's owner), most first. "No owner" is a row of its own and is never hidden. */
export function rankOwners(people: readonly Person[], labelOf: (id: string) => { label: string; state: string }): OwnerRank[] {
  const by = new Map<string, { count: number; oldest: number }>();
  for (const p of people) {
    const k = p.assignedTo ?? "none";
    const x = by.get(k) ?? { count: 0, oldest: 0 };
    by.set(k, { count: x.count + 1, oldest: Math.max(x.oldest, p.hours) });
  }
  return [...by].map(([key, x]) => ({ key, ...(key === "none" ? { label: "No owner", state: "none" } : labelOf(key)), count: x.count, oldestHours: x.oldest }))
    .sort((a, b) => b.count - a.count || b.oldestHours - a.oldestHours || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

// ---------- agreement with Today ----------

/**
 * Today counts "waiting for a reply" as people: a customer message nobody answered, or a new lead past its reply target with no person's reply, one person once
 * (`mergeReplies`). This screen lists the people who have a conversation waiting. The two differ by exactly the new leads who have NOT written (nothing to reply to
 * in a conversation yet): `today = people + newLeadsOnly`. Both are taken from Today's own function on the same lists, so with no list cut the identity is exact.
 */
export function todayAgreement(waiting: readonly WaitConv[], leads: readonly WaitingLead[]): { today: number; people: number; newLeadsOnly: number; newLeadsAmongThem: number; partial: boolean } {
  const conv: WaitingConversation[] = waiting.map((c) => ({ id: c.conversationId, locationId: c.locationId, accountName: "", contactId: c.contactId ?? "", name: c.name ?? "", at: c.lastAt, url: "", detail: "" }));
  const merged = mergeReplies({ leads: [...leads], leadsTotal: leads.length, conversations: conv, conversationsTotal: conv.length });
  const people = new Set(waiting.map((c) => personKey(c.locationId, c.contactId, c.conversationId)));
  const newLeadsOnly = merged.items.filter((i) => i.newLead && !people.has(i.id.replace(/^replies:/, ""))).length;
  return { today: merged.count, people: people.size, newLeadsOnly, newLeadsAmongThem: merged.items.filter((i) => i.newLead && people.has(i.id.replace(/^replies:/, ""))).length, partial: merged.partial };
}

/** The lead keys Today would build for these leads: the same `account:contact` key as a person's. */
export const leadKey = (locationId: string, contactId: string) => `${locationId}:${contactId}`;

// ---------- the cost estimate and the next step ----------

/** What the people still waiting may cost, an ESTIMATE: per client, people waiting x the client's average deal x its win rate (the one formula the Account audit and Speed to lead use). */
export function estimateFor(people: readonly Person[], facts: readonly AccountFacts[]) {
  const by = new Map<string, number>();
  for (const p of people) by.set(p.locationId, (by.get(p.locationId) ?? 0) + 1);
  const c = costEstimate(by, facts);
  return { amount: c.amount, line: costLine(c), formula: costFormula(c), leftOutAccounts: c.leftOutAccounts, countedAccounts: c.countedAccounts };
}

export type NextAction = { key: "reply" | "speed" | "appointments"; text: string };
/** The calm all-clear's one next step. */
export function nextBestAction(i: { people: number; newLeadsOnly: number }): NextAction {
  if (i.people > 0) return { key: "reply", text: "Reply to the person who has waited longest." };
  if (i.newLeadsOnly > 0) return { key: "speed", text: `${plural(i.newLeadsOnly, "new lead")} ${i.newLeadsOnly === 1 ? "is" : "are"} still waiting for a first reply from a person. Open Speed to lead.` };
  return { key: "appointments", text: "Nothing to answer. Check Appointments for outcomes still to mark." };
}

/** The line under the headline: what waiting means, in words, with the target and the window. */
export function meaningLine(slaHours: number, windowDays: number): string {
  return `Waiting means the customer wrote last and has had no reply for more than your ${slaHours}-hour reply target, in the last ${windowDays} days.`;
}

/** Plain text to paste into a message or print: the sentence, the proof, the five who have waited longest and the clients with the most waiting. */
export function summaryText(i: { who: string; headline: string; cost: string | null; waiting: Array<{ name: string; account: string | null; waited: string; channel: string; owner: string }>; accounts: Array<{ name: string; count: number }> }): string {
  const lines = [`Unanswered messages: ${i.who}`, i.headline, ...(i.cost ? [i.cost] : [])];
  if (i.waiting.length > 0) lines.push("", "Waiting longest:", ...i.waiting.map((w) => `- ${w.name}${w.account ? `, ${w.account}` : ""}: waiting ${w.waited}, ${w.channel}, ${w.owner}`));
  if (i.accounts.length > 0) lines.push("", "Most people waiting:", ...i.accounts.map((a) => `- ${a.name}: ${plural(a.count, "person", "people")}`));
  return lines.join("\n");
}

// ---------- the first screen: bounded, whatever the number of accounts ----------

export type HomeShape = {
  facts: Facts; headline: ReturnType<typeof headlineOf>;
  rows: Person[]; buckets: Array<{ key: BucketKey; label: string; count: number }>; channels: Choice[];
  accounts: { total: number; rows: AccountRank[] }; owners: { total: number; rows: OwnerRank[] } | null;
};
export const HOME_ROWS = 5;
/** Everything the first screen holds, cut to five rows of each list: its size does not grow with the number of accounts. */
export function homeOf(people: readonly Person[], o: { slaHours: number; accounts: Names; seePeople: boolean; me: string | null; labelOf: (id: string) => { label: string; state: string } }): HomeShape {
  const ctx = { me: o.me, accounts: o.accounts };
  const all = selectPeople(people, { sort: "wait" }, ctx);
  const rankedAccounts = rankAccounts(all, o.accounts);
  const multi = rankedAccounts.length > 1;
  const owners = !multi && o.seePeople ? rankOwners(all, o.labelOf) : null;
  return {
    facts: factsOf(all), headline: headlineOf(factsOf(all), multi), rows: all.slice(0, HOME_ROWS),
    buckets: visibleBuckets(o.slaHours).map((b) => ({ key: b.key, label: b.label, count: selectPeople(all, { bucket: b.key }, ctx).length })),
    channels: channelChoices(all),
    accounts: { total: rankedAccounts.length, rows: rankedAccounts.slice(0, 5) },
    owners: owners ? { total: owners.length, rows: owners.slice(0, 5) } : null,
  };
}
