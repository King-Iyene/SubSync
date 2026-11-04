// The guided duplicate review (stage DUP). Pure logic on top of dedupe.ts: no database, no network, so every rule here is unit tested.
//
//   what kind of match a group is, in plain words        reasonOf, likelihood
//   what matters most (which groups come first)            rankValue, sortGroups
//   the warnings shown BEFORE a merge                      guardrails
//   the records side by side, only what differs            diffFields
//   why one record is pre-picked                           explainSurvivor
//   what a merge keeps, moves and removes                  mergePlan, summaryText
//   the "obvious ones" (same email AND same phone)         isObvious
//   the queue: filter, sort, page, health numbers          selectGroups, pageOf, health, byAccount
//
// SubSync only reads contacts. Nothing here changes a contact: the plan describes what the platform's own merge does (see docs/features/DUPLICATES.md).

import { clearlyDiffer, foldEmail, normName, normPhone, type Group, type Person } from "./dedupe.ts";

// ---------- what kind of match, in words ----------

export type ReasonKey = "both" | "email" | "phone" | "name";

export function reasonOf(g: { reasons: readonly string[] }): { key: ReasonKey; label: string } {
  const email = g.reasons.some((r) => r === "same email" || r.startsWith("email differs") || r === "similar email name");
  const phone = g.reasons.some((r) => r === "same phone" || r.startsWith("phone in") || r.startsWith("phone with") || r === "same last seven digits");
  const loose = g.reasons.some((r) => r.startsWith("email differs") || r.startsWith("phone in") || r.startsWith("phone with") || r === "similar email name" || r === "same last seven digits");
  if (email && phone) return { key: "both", label: loose ? "Same email and phone number, written differently" : "Same email and phone number" };
  if (email) return { key: "email", label: g.reasons.includes("same email") ? "Same email" : "Same email, written differently" };
  if (phone) return { key: "phone", label: g.reasons.includes("same phone") ? "Same phone number" : g.reasons.includes("phone with two digits swapped") ? "Phone numbers that differ by two swapped digits" : "Same phone number, written differently" };
  return { key: "name", label: g.reasons.includes("similar name") && !g.reasons.includes("same name") ? "Similar name" : "Same name" };
}

export const REASON_LABELS: Record<ReasonKey, string> = { both: "Same email and phone", email: "Same email", phone: "Same phone number", name: "Same name" };

export function likelihood(confidence: number): { key: "certain" | "likely" | "possible"; label: string } {
  if (confidence >= 90) return { key: "certain", label: "Almost certainly the same person" };
  if (confidence >= 75) return { key: "likely", label: "Very likely the same person" };
  return { key: "possible", label: "Could be the same person" };
}

// ---------- the first record's own words ----------

const who = (p: Person) => (p.name && p.name !== "Unnamed contact" ? p.name : "A contact with no name");
const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
// A team member whose name SubSync does not know is shown by the last four characters of their id, so two different owners never look the same.
const ownerOf = (p: Person) => p.ownerName ?? (p.ownerId ? `Team member ${p.ownerId.slice(-4)}` : null);

// ---------- warnings before a merge ----------

export type Guardrail = { id: "dnd" | "customer" | "open_deals" | "owner"; text: string };

/**
 * What a person must see, and deliberately confirm, before merging. Each is a plain sentence. Four things earn a warning: a contact who asked not to
 * be contacted, a contact who looks like a paying customer (SubSync reads deals, not payments, so a won deal is the closest sign), open deals on a
 * record that will be removed, and records that belong to different team members.
 */
export function guardrails(people: readonly Person[], keepId: string): Guardrail[] {
  const out: Guardrail[] = [];
  const removed = people.filter((p) => p.contactId !== keepId);
  const dnd = people.filter((p) => p.dnd);
  if (dnd.length) {
    out.push({ id: "dnd", text: `${joinNames(dnd.map(who))} asked not to be contacted (Do Not Disturb). After the merge, check the kept contact is still on Do Not Disturb.` });
  }
  const customers = removed.filter((p) => p.wonDeals > 0);
  if (customers.length) {
    out.push({ id: "customer", text: `${joinNames(customers.map(who))} ${customers.length === 1 ? "has" : "have"} won deals, so ${customers.length === 1 ? "is" : "are"} probably a paying customer. SubSync cannot see payments, so check these really are the same person.` });
  }
  const withDeals = removed.filter((p) => p.openDeals > 0);
  if (withDeals.length) {
    const n = withDeals.reduce((s, p) => s + p.openDeals, 0);
    const value = withDeals.reduce((s, p) => s + (p.openValue ?? 0), 0);
    out.push({ id: "open_deals", text: `${joinNames(withDeals.map(who))} ${withDeals.length === 1 ? "has" : "have"} ${plural(n, "open deal", "open deals")}${value > 0 ? ` (${money(value)})` : ""} that will move to the kept contact.` });
  }
  const owners = [...new Set(people.map((p) => (p.ownerId ?? p.ownerName ?? "").trim()).filter(Boolean))];
  if (owners.length >= 2) {
    const names = [...new Set(people.map((p) => ownerOf(p)).filter((x): x is string => !!x))];
    out.push({ id: "owner", text: `These records belong to different team members (${joinNames(names)}). Choose who should own the kept contact in the merge screen.` });
  }
  return out;
}

// ---------- the obvious ones ----------

/** Two or three records with the SAME email AND the SAME phone number, and nothing to warn about. These are safe to look at as one batch. */
export function isObvious(g: { people: Person[]; survivorId: string }): boolean {
  const ps = g.people;
  if (ps.length < 2 || ps.length > 3) return false;
  const e = foldEmail(ps[0].email);
  const t = normPhone(ps[0].phone);
  if (!e || !t) return false;
  if (!ps.every((p) => foldEmail(p.email) === e && normPhone(p.phone) === t)) return false;
  return guardrails(ps, g.survivorId).length === 0;
}

// ---------- which groups matter most ----------

type Rankable = { people: Person[]; confidence: number };

/** Open deals first, then paying customers, then a Do Not Disturb contact (a mistake costs most), then recent activity, then how sure we are. */
export function rankValue(g: Rankable, now: number = Date.now()): number {
  const open = g.people.reduce((s, p) => s + p.openDeals, 0);
  const won = g.people.reduce((s, p) => s + p.wonDeals, 0);
  const dnd = g.people.some((p) => p.dnd) ? 250 : 0;
  const latest = Math.max(0, ...g.people.map((p) => (p.lastActivityAt ? Date.parse(p.lastActivityAt) : 0)));
  const recency = latest > 0 ? Math.max(0, 200 - (now - latest) / 86_400_000) : 0;
  return Math.min(open, 20) * 1000 + Math.min(won, 20) * 600 + dnd + recency + g.confidence / 10;
}

export type SortKey = "important" | "size" | "newest" | "sure";
export const SORT_LABELS: Record<SortKey, string> = { important: "Most important", size: "Most contacts", newest: "Newest", sure: "Most certain" };
export const parseSort = (v: unknown): SortKey => (v === "size" || v === "newest" || v === "sure" ? v : "important");

export type QueueItem = Group & { locationId: string; locationName: string | null; rank?: number };

const newestOf = (g: { people: Person[] }) => Math.max(0, ...g.people.map((p) => (p.createdAt ? Date.parse(p.createdAt) : 0)));

export function sortGroups<T extends QueueItem>(list: readonly T[], sort: SortKey, now: number = Date.now()): T[] {
  const rank = new Map(list.map((g) => [g, g.rank ?? rankValue(g, now)] as const));
  const tie = (a: T, b: T) => (a.locationName ?? "").localeCompare(b.locationName ?? "") || a.key.localeCompare(b.key);
  const by: Record<SortKey, (a: T, b: T) => number> = {
    important: (a, b) => rank.get(b)! - rank.get(a)!,
    size: (a, b) => b.people.length - a.people.length || rank.get(b)! - rank.get(a)!,
    newest: (a, b) => newestOf(b) - newestOf(a),
    sure: (a, b) => b.confidence - a.confidence || rank.get(b)! - rank.get(a)!,
  };
  return [...list].sort((a, b) => by[sort](a, b) || tie(a, b));
}

// ---------- the queue: filter, sort, page ----------

export type Status = "open" | "decided" | "later";
export const parseStatus = (v: unknown): Status => (v === "decided" || v === "later" ? v : "open");

export type Select = {
  status: Status;
  /** `${locationId}:${key}` of groups the person decided about (not a duplicate, merged in the CRM, ...). */
  decided: ReadonlySet<string>;
  /** `${locationId}:${key}` of groups set aside with Not now, which have not come back yet. */
  later: ReadonlySet<string>;
  q?: string;
  reason?: ReasonKey | null;
  location?: string | null;
  sort?: SortKey;
  now?: number;
};

const idOf = (g: { locationId: string; key: string }) => `${g.locationId}:${g.key}`;

export function selectGroups<T extends QueueItem>(all: readonly T[], o: Select): T[] {
  const needle = (o.q ?? "").trim().toLowerCase().slice(0, 80);
  const digits = needle.replace(/[^0-9]/g, "");
  const matches = (g: T) => {
    if (!needle) return true;
    if ((g.locationName ?? "").toLowerCase().includes(needle)) return true;
    return g.people.some((p) =>
      p.name.toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle) || (digits.length >= 4 && (p.phone ?? "").replace(/[^0-9]/g, "").includes(digits)));
  };
  const keep = all.filter((g) => {
    const id = idOf(g);
    const done = o.decided.has(id);
    const later = !done && o.later.has(id);
    if (o.status === "open" ? done || later : o.status === "decided" ? !done : !later) return false;
    if (o.location && g.locationId !== o.location) return false;
    if (o.reason && reasonOf(g).key !== o.reason) return false;
    return matches(g);
  });
  return sortGroups(keep, o.sort ?? "important", o.now);
}

export const MAX_PAGE_SIZE = 50;

export function pageOf<T>(list: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number; total: number; from: number; to: number } {
  const n = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number.isFinite(size) ? size : 25)));
  const pages = Math.max(1, Math.ceil(list.length / n));
  const at = Math.min(Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)), pages - 1);
  const rows = list.slice(at * n, at * n + n);
  return { rows, page: at, pages, total: list.length, from: list.length === 0 ? 0 : at * n + 1, to: at * n + rows.length };
}

// ---------- the health numbers ----------

export type Health = { groups: number; contacts: number; extra: number; listSize: number; shareLabel: string };

/** groups = open groups; contacts = records inside them; extra = records that would go after merging (each group keeps one); the share is extra over the whole list. */
export function health(open: ReadonlyArray<{ people: readonly unknown[] }>, listSize: number): Health {
  const contacts = open.reduce((s, g) => s + g.people.length, 0);
  const extra = contacts - open.length;
  let shareLabel = "";
  if (listSize > 0 && extra > 0) {
    const pct = (extra / listSize) * 100;
    shareLabel = pct < 1 ? "under 1% of your list" : `about ${Math.round(pct)}% of your list`;
  }
  return { groups: open.length, contacts, extra, listSize, shareLabel };
}

export type AccountRow = { locationId: string; name: string | null; groups: number; contacts: number; extra: number; openDeals: number; weight: number };

/** One row per client account that has open groups, the accounts with the most at stake first. */
export function byAccount(open: readonly QueueItem[], now: number = Date.now()): AccountRow[] {
  const m = new Map<string, AccountRow>();
  for (const g of open) {
    const row = m.get(g.locationId) ?? { locationId: g.locationId, name: g.locationName, groups: 0, contacts: 0, extra: 0, openDeals: 0, weight: 0 };
    row.groups += 1;
    row.contacts += g.people.length;
    row.extra += g.people.length - 1;
    row.openDeals += g.people.reduce((s, p) => s + p.openDeals, 0);
    row.weight += g.rank ?? rankValue(g, now);
    m.set(g.locationId, row);
  }
  return [...m.values()].sort((a, b) => b.weight - a.weight || b.groups - a.groups || (a.name ?? "").localeCompare(b.name ?? ""));
}

export function reasonCounts(open: readonly QueueItem[]): Record<ReasonKey, number> {
  const out: Record<ReasonKey, number> = { both: 0, email: 0, phone: 0, name: 0 };
  for (const g of open) out[reasonOf(g).key] += 1;
  return out;
}

// ---------- the records side by side ----------

export type DiffId = "name" | "email" | "phone" | "owner" | "source" | "tags" | "deals" | "conversation" | "dnd";
export type DiffRow = { id: DiffId; label: string; values: Array<{ text: string; empty: boolean }>; differs: boolean };

const sortedTags = (p: Person) => [...p.tags].map((t) => t.trim().toLowerCase()).filter(Boolean).sort().join("|");

const FIELDS: Array<{ id: DiffId; label: string; text: (p: Person) => string; key: (p: Person) => string }> = [
  { id: "name", label: "Name", text: (p) => (p.name === "Unnamed contact" ? "" : p.name), key: (p) => normName(p.name === "Unnamed contact" ? "" : p.name) },
  { id: "email", label: "Email", text: (p) => p.email?.trim() ?? "", key: (p) => foldEmail(p.email) ?? "" },
  { id: "phone", label: "Phone", text: (p) => p.phone?.trim() ?? "", key: (p) => normPhone(p.phone) ?? "" },
  { id: "owner", label: "Belongs to", text: (p) => ownerOf(p) ?? "", key: (p) => p.ownerId ?? p.ownerName ?? "" },
  { id: "source", label: "Came from", text: (p) => p.source?.trim() ?? "", key: (p) => (p.source ?? "").trim().toLowerCase() },
  { id: "tags", label: "Tags", text: (p) => p.tags.join(", "), key: sortedTags },
  { id: "deals", label: "Deals", text: (p) => (p.openDeals || p.wonDeals ? `${p.openDeals} open, ${p.wonDeals} won` : ""), key: (p) => `${p.openDeals}/${p.wonDeals}` },
  { id: "conversation", label: "Conversation", text: (p) => (p.hasConversation ? "Yes" : ""), key: (p) => (p.hasConversation ? "1" : "0") },
  { id: "dnd", label: "Do Not Disturb", text: (p) => (p.dnd ? "Yes" : ""), key: (p) => (p.dnd ? "1" : "0") },
];

/** Only what differs is returned in `differ`; what is identical (and not empty everywhere) is in `same`, to be shown as one collapsed line. */
export function diffFields(people: readonly Person[]): { differ: DiffRow[]; same: DiffRow[] } {
  const differ: DiffRow[] = [];
  const same: DiffRow[] = [];
  for (const f of FIELDS) {
    const values = people.map((p) => { const text = f.text(p); return { text, empty: text === "" }; });
    if (values.every((v) => v.empty)) continue;
    const differs = new Set(people.map(f.key)).size > 1;
    (differs ? differ : same).push({ id: f.id, label: f.label, values, differs });
  }
  return { differ, same };
}

// ---------- why this record is kept ----------

/** A short plain sentence: why the pre-picked record is the best one to keep. At most three reasons. */
export function explainSurvivor(people: readonly Person[], survivorId: string): string {
  const s = people.find((p) => p.contactId === survivorId);
  const others = people.filter((p) => p.contactId !== survivorId);
  if (!s || others.length === 0) return "";
  const reasons: string[] = [];
  const latest = (p: Person) => (p.lastActivityAt ? Date.parse(p.lastActivityAt) : 0);
  if (latest(s) > 0 && others.every((o) => latest(s) > latest(o))) reasons.push("most recent activity");
  const hasBoth = (p: Person) => !!p.phone && !!p.email;
  if (hasBoth(s) && others.some((o) => !hasBoth(o))) reasons.push("has a phone and an email");
  else if (s.phone && others.some((o) => !o.phone)) reasons.push("has a phone number");
  else if (s.email && others.some((o) => !o.email)) reasons.push("has an email");
  if (s.openDeals > 0 && others.every((o) => s.openDeals > o.openDeals)) reasons.push(plural(s.openDeals, "open deal", "open deals"));
  if (s.wonDeals > 0 && others.every((o) => s.wonDeals > o.wonDeals)) reasons.push("is a customer (won deals)");
  if (s.hasConversation && others.every((o) => !o.hasConversation)) reasons.push("has the conversation history");
  if (reasons.length === 0) {
    const first = (p: Person) => (p.createdAt ? Date.parse(p.createdAt) : Infinity);
    reasons.push(others.every((o) => first(s) < first(o)) ? "the oldest record" : "the best match overall");
  }
  const text = reasons.slice(0, 3).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------- what a merge keeps, moves and removes ----------

export type MergePlan = {
  keepId: string;
  removeIds: string[];
  keep: { name: string; email: string | null; phone: string | null };
  /** Plain sentences, in the order a person reads them. */
  lines: string[];
  /** What to pick in the CRM's merge screen when records disagree or the kept one has a gap. */
  picks: string[];
  tagsAdded: string[];
  dealsMoved: { open: number; won: number };
  warnings: Guardrail[];
};

export function mergePlan(people: readonly Person[], keepId: string): MergePlan {
  const keep = people.find((p) => p.contactId === keepId);
  if (!keep) throw new Error("The record to keep is not in the group");
  const removed = people.filter((p) => p.contactId !== keepId);
  const have = new Set(keep.tags.map((t) => t.trim().toLowerCase()));
  const tagsAdded = [...new Set(removed.flatMap((p) => p.tags).filter((t) => !have.has(t.trim().toLowerCase())))];
  const dealsMoved = { open: removed.reduce((s, p) => s + p.openDeals, 0), won: removed.reduce((s, p) => s + p.wonDeals, 0) };
  const lines: string[] = [`Keeps ${who(keep)}${keep.email ? `, ${keep.email}` : ""}${keep.phone ? `, ${keep.phone}` : ""}.`];
  if (tagsAdded.length) lines.push(`Tags added to the kept contact: ${tagsAdded.join(", ")}.`);
  if (dealsMoved.open + dealsMoved.won > 0) {
    const parts = [dealsMoved.open ? plural(dealsMoved.open, "open deal", "open deals") : "", dealsMoved.won ? plural(dealsMoved.won, "won deal", "won deals") : ""].filter(Boolean);
    lines.push(`${parts.join(" and ")} move to the kept contact.`);
  }
  if (removed.some((p) => p.hasConversation)) lines.push("Conversations, notes and tasks of the other record are combined into the kept one.");
  else lines.push("Notes and tasks of the other record are combined into the kept one.");
  lines.push("Appointments, payments and invoices keep the kept contact's values, so note anything important on the other record first.");
  lines.push(`${joinNames(removed.map(who))} ${removed.length === 1 ? "is" : "are"} removed. A merge cannot be undone.`);

  const picks: string[] = [];
  for (const [label, get] of [["email", (p: Person) => p.email], ["phone", (p: Person) => p.phone]] as const) {
    const mine = get(keep);
    const theirs = [...new Set(removed.map((p) => get(p)).filter((v): v is string => !!v))];
    if (!mine && theirs.length) picks.push(`The kept contact has no ${label}. Pick ${theirs[0]} in the merge screen.`);
    else if (mine) {
      const key = label === "email" ? (v: string) => foldEmail(v) : (v: string) => normPhone(v);
      const other = theirs.filter((v) => key(v) !== key(mine));
      if (other.length) picks.push(`Different ${label}s: ${other.join(", ")} also on file. Keep ${mine}, or pick the one that is right.`);
    }
  }
  const names = new Set(people.map((p) => normName(p.name === "Unnamed contact" ? "" : p.name)).filter(Boolean));
  if (names.size > 1) picks.push(`The names differ (${[...new Set(people.map((p) => p.name))].join(" / ")}). Keep the one that is spelled right.`);

  return {
    keepId, removeIds: removed.map((p) => p.contactId),
    keep: { name: who(keep), email: keep.email, phone: keep.phone },
    lines, picks, tagsAdded, dealsMoved, warnings: guardrails(people, keepId),
  };
}

/** The text copied with "Copy the summary": enough for someone else (or you, later) to finish the merge without this screen. */
export function summaryText(args: { accountName: string | null; plan: MergePlan; people: readonly Person[]; why: string; crmSteps: string[] }): string {
  const { plan, people } = args;
  const nameOf = (id: string) => who(people.find((p) => p.contactId === id) ?? people[0]);
  const lines = [
    `Merge ${people.length} contacts${args.accountName ? ` in ${args.accountName}` : ""}`,
    `Keep: ${nameOf(plan.keepId)}${plan.keep.email ? `, ${plan.keep.email}` : ""}${plan.keep.phone ? `, ${plan.keep.phone}` : ""}${args.why ? ` (${args.why.toLowerCase()})` : ""}`,
    `Merge in and remove: ${plan.removeIds.map((id) => { const p = people.find((x) => x.contactId === id)!; return `${nameOf(id)}${p.email ? `, ${p.email}` : ""}${p.phone ? `, ${p.phone}` : ""}`; }).join("; ")}`,
    "",
    "What the merge does:",
    ...plan.lines.map((l) => `- ${l}`),
  ];
  if (plan.picks.length) lines.push("", "Pick in the merge screen:", ...plan.picks.map((l) => `- ${l}`));
  if (plan.warnings.length) lines.push("", "Check first:", ...plan.warnings.map((w) => `- ${w.text}`));
  lines.push("", "How:", ...args.crmSteps.map((l, i) => `${i + 1}. ${l}`));
  return lines.join("\n");
}

/** Never offer a merge of records that clearly differ. Used again on the server before any merge request. */
export function anyClearlyDiffer(people: readonly Person[]): boolean {
  return people.some((a, i) => people.slice(i + 1).some((b) => clearlyDiffer(a, b)));
}

/** How to finish the merge in the CRM's own screen (its help pages: select the contacts in the Contacts list, More, Merge; only an administrator can merge). */
export const crmSteps = (keepName: string): string[] => [
  "Open both contacts in your CRM (the buttons above do it), or tick them in the Contacts list.",
  "Press More, then Merge. (Merging needs an administrator in your CRM.)",
  `Choose ${keepName} as the contact to keep, check the fields, and confirm.`,
];

/** The email button. The CRM publishes no link that opens its email composer for a contact, so the button opens the contact and says so (KF-3). Never mailto:. */
export const EMAIL_LINK_KNOWN = false;
export function emailPlan(v: { email: string | null | undefined; contactUrl: string | null | undefined }): { href: string | null; label: string; note: string } {
  if (!v.email) return { href: null, label: "Email", note: "There is no email address." };
  return { href: v.contactUrl ?? null, label: "Email in your CRM", note: EMAIL_LINK_KNOWN ? "Opens your CRM email box." : "Not available from your CRM yet: this opens the contact in your CRM, where its own email box sends the message." };
}

// ---------- why two records match, in words ----------

export const REASON_WORDS: Record<string, string> = {
  "same email": "Same email address",
  "same phone": "Same phone number",
  "email differs only in case, spaces or gmail dots": "Same email address, written differently",
  "phone in a different format": "Same phone number, written differently",
  "same name": "Same name",
  "similar name": "A similar name (a nickname, an initial or a small spelling difference)",
  "phone with two digits swapped": "Phone numbers that differ by two swapped digits",
  "different first names": "Different first names, so this may be a shared household or office phone",
  "shared company mailbox": "A shared company mailbox such as info@, so this may be different people",
  "same name, first and last swapped": "The same name with first and last swapped",
  "similar email name": "The name before the @ is alike (a business and a personal address)",
  "same company email domain": "The same company email domain",
  "same last seven digits": "The same last seven digits of the phone number",
  "added at about the same time": "Added within minutes of each other",
  "added within a day of each other": "Added within a day of each other",
  "came from the same place": "Came from the same source",
  "shared tag": "A shared tag",
  "shared tags": "Shared tags",
  "contact details conflict": "The email and the phone number are both different",
};

/** Every pair inside a small group, with its score and the reasons in words. Groups of more than six records are summarised by the group's own score instead. */
export function pairScores(people: readonly Person[], score: (a: Person, b: Person) => { score: number; reasons: string[] }): Array<{ a: string; b: string; score: number; reasons: string[] }> {
  if (people.length > 6) return [];
  const out: Array<{ a: string; b: string; score: number; reasons: string[] }> = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const s = score(people[i], people[j]);
    out.push({ a: people[i].contactId, b: people[j].contactId, score: s.score, reasons: s.reasons.map((r) => REASON_WORDS[r] ?? r) });
  }
  return out;
}
