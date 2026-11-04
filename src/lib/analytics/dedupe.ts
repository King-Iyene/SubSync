// Duplicate detection inside ONE client account. Pure logic (no database or network imports) so it
// can be unit tested. Different clients' customers are never compared with each other here.
//
// SubSync only reads contacts, so this module finds and explains likely duplicates and recommends
// which record to keep; it never changes anything. The merge itself is done in the platform's
// own merge screen, which keeps the history of both records.

import { DEFAULT_RULES, type MatchRules } from "./cleanup-rules.ts";
import { digitBag, digitsSwapped, firstNamesDiffer, isRoleEmail, nameSimilarity, soundex, splitName, canonicalFirst } from "./name-match.ts";

export type Person = {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  createdAt: string | null;
  lastActivityAt: string | null;
  source: string | null;
  openDeals: number;
  wonDeals: number;
  hasConversation: boolean;
  // Added for the guided review. All optional so the older callers and fixtures keep working.
  /** Do Not Disturb: the person asked not to be contacted. */
  dnd?: boolean;
  /** The user id of the team member who owns the contact, and their name where SubSync knows it. */
  ownerId?: string | null;
  ownerName?: string | null;
  /** Total value of the open deals (only filled in for the group on screen). */
  openValue?: number;
  /** Appointments linked to the contact (only filled in for the group on screen). */
  appointments?: number;
  /** The day SubSync first saw each tag on this contact ("since SubSync started watching"). Only filled in for the group on screen. */
  tagDates?: Record<string, string>;
};

// ---------- normalising ----------

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

// An email with case and spaces removed. Gmail dots and "+tags" are also folded, because they
// reach the same inbox.
export function normEmail(email: string | null): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  return e;
}

export function foldEmail(email: string | null): string | null {
  const e = normEmail(email);
  if (!e) return null;
  const at = e.lastIndexOf("@");
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  local = local.split("+")[0];
  if (GMAIL.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

// The last ten digits of a phone number (so +1 555 010 2030, (555) 010-2030 and 15550102030 match).
// Fewer than seven digits is not a usable number.
export function normPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// ---------- scoring ----------

export type MatchReason =
  | "same email" | "same phone" | "email differs only in case, spaces or gmail dots" | "phone in a different format" | "same name"
  | "similar name" | "phone with two digits swapped" | "different first names" | "shared company mailbox";

export type Pair = { score: number; reasons: MatchReason[] };

// How sure we are that two records are the same person (0 to 100) and why. `rules` says which fields count and how strictly (Balanced is the original behaviour).
export function scorePair(a: Person, b: Person, rules: MatchRules = DEFAULT_RULES): Pair {
  const reasons: MatchReason[] = [];
  let score = 0;
  const ea = normEmail(a.email);
  const eb = normEmail(b.email);
  let emailLink = false;
  if (rules.email !== "off" && ea && eb) {
    if (a.email!.trim() === b.email!.trim()) { reasons.push("same email"); score = Math.max(score, 94); emailLink = true; }
    else if (rules.email === "similar" && (ea === eb || foldEmail(a.email) === foldEmail(b.email))) { reasons.push("email differs only in case, spaces or gmail dots"); score = Math.max(score, 82); emailLink = true; }
  }
  const pa = normPhone(a.phone);
  const pb = normPhone(b.phone);
  let phoneLink = false;
  if (rules.phone !== "off" && pa && pb) {
    if (pa === pb) {
      if ((a.phone ?? "").trim() === (b.phone ?? "").trim()) { reasons.push("same phone"); score = Math.max(score, 90); phoneLink = true; }
      else if (rules.phone !== "exact") { reasons.push("phone in a different format"); score = Math.max(score, 80); phoneLink = true; }
    } else if (rules.phone === "typo" && digitsSwapped(pa, pb)) { reasons.push("phone with two digits swapped"); score = Math.max(score, 60); phoneLink = true; }
  }
  const na = normName(a.name);
  const nb = normName(b.name);
  if (rules.name !== "off") {
    if (na && na === nb && na !== "unnamed contact" && na.includes(" ")) {
      reasons.push("same name");
      // The same name alone is weak; with another signal it confirms the match.
      score = score > 0 ? Math.min(99, score + 5) : 35;
    } else if (rules.name === "similar" && na !== "unnamed contact" && nb !== "unnamed contact") {
      const m = nameSimilarity(a.name, b.name);
      if (m.kind !== "none" && m.kind !== "exact") { reasons.push("similar name"); score = score > 0 ? Math.min(99, score + 3) : 32; }
    }
  }
  if (rules.guards && score > 0) {
    const named = na && nb && na !== "unnamed contact" && nb !== "unnamed contact";
    // One phone number for two people with different first names is usually a household or an office line, not one person.
    if (phoneLink && !emailLink && named && firstNamesDiffer(a.name, b.name)) { reasons.push("different first names"); score = Math.min(score, 55); }
    // info@ or sales@ belongs to a business: two different people can share it.
    if (emailLink && !phoneLink && named && isRoleEmail(a.email) && nameSimilarity(a.name, b.name).kind === "none" && na !== nb) { reasons.push("shared company mailbox"); score = Math.min(score, 55); }
  }
  return { score, reasons };
}

// ---------- grouping ----------

export type Group = {
  key: string;
  people: Person[];
  confidence: number;
  reasons: MatchReason[];
  kind: "exact" | "format" | "name";
  survivorId: string;
};

export function groupKey(ids: string[]): string {
  // FNV-1a over the sorted ids: a short, stable key for "this exact set of contacts".
  let h = 0x811c9dc5;
  for (const ch of [...ids].sort().join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + "-" + ids.length;
}

// Which record to keep: the one with the most to lose. Deals matter most, then conversations,
// then how complete and how recently used it is, and finally the oldest as the tiebreak.
export function keepValue(p: Person, now: number = Date.now()): number {
  return p.wonDeals * 1000 + p.openDeals * 400 + (p.hasConversation ? 150 : 0) + (p.email ? 40 : 0) + (p.phone ? 40 : 0) + p.tags.length * 5 +
    (p.lastActivityAt ? Math.max(0, 60 - (now - Date.parse(p.lastActivityAt)) / 86_400_000) : 0);
}

export function chooseSurvivor(people: Person[], now: number = Date.now()): Person {
  return [...people].sort((x, y) => keepValue(y, now) - keepValue(x, now) || (x.createdAt ?? "9").localeCompare(y.createdAt ?? "9") || x.contactId.localeCompare(y.contactId))[0];
}

// Two records that clearly belong to different people: both have an email and they differ, AND both have a phone and they differ. Missing
// values never count (a record with no phone cannot "differ" on phone). Merging such a pair is never offered.
export function clearlyDiffer(a: Person, b: Person): boolean {
  const ea = foldEmail(a.email);
  const eb = foldEmail(b.email);
  const pa = normPhone(a.phone);
  const pb = normPhone(b.phone);
  return !!ea && !!eb && ea !== eb && !!pa && !!pb && pa !== pb;
}

// A chain of matches can tie together records that are not all the same person (A and B share an email, B and C share a phone, but A and C
// share nothing and differ on both). Split such a cluster into groups in which nobody clearly differs from anybody else. The record that
// would be kept seeds each group; others join only when they share an email or phone with the seed and do not clearly differ from anyone
// already in. Leftovers are tried again as a group of their own.
export function splitCompatible(people: Person[], now: number = Date.now()): Person[][] {
  const out: Person[][] = [];
  let rest = [...people];
  while (rest.length >= 2) {
    const seed = chooseSurvivor(rest, now);
    const group = [seed];
    for (const o of rest) {
      if (o === seed) continue;
      const linked = (foldEmail(o.email) && foldEmail(o.email) === foldEmail(seed.email)) || (normPhone(o.phone) && normPhone(o.phone) === normPhone(seed.phone));
      if (linked && group.every((g) => !clearlyDiffer(g, o))) group.push(o);
    }
    if (group.length >= 2) out.push(group);
    const used = new Set(group);
    rest = rest.filter((p) => !used.has(p)); // a seed that matched nobody is dropped; the others are tried again
  }
  return out;
}

// Group contacts that are linked by a confident match (union-find). Pairs below `minScore` do not link.
const NAME_BUCKET_MAX = 8;
export function groupDuplicates(people: Person[], minScore = 50, maxGroup = 40, rules: MatchRules = DEFAULT_RULES): Group[] {
  const parent = new Map(people.map((p) => [p.contactId, p.contactId]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  // Only compare people who share a normalised key, so a big account is not compared pair by pair.
  const buckets = new Map<string, Person[]>();
  const add = (k: string | null, p: Person) => { if (k) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p); };
  for (const p of people) {
    if (rules.email !== "off") add(foldEmail(p.email) && "e:" + foldEmail(p.email), p);
    const ph = normPhone(p.phone);
    if (rules.phone !== "off") add(ph && "p:" + ph, p);
    if (rules.phone === "typo" && ph) add("t:" + digitBag(ph), p);
    if (rules.name !== "off" && rules.nameAlone && p.name !== "Unnamed contact") {
      const { first, last } = splitName(p.name);
      if (first && last) add("n:" + soundex(last) + canonicalFirst(first).charAt(0), p);
    }
  }
  const best = new Map<string, Pair>();
  for (const [bucketKey, members] of buckets) {
    if (members.length < 2) continue;
    // A name shared by many records is a common name, not a duplicate: it is never grouped on the name alone.
    if (bucketKey.startsWith("n:") && members.length > NAME_BUCKET_MAX) continue;
    const limited = members.slice(0, maxGroup);
    for (let i = 0; i < limited.length; i++) {
      for (let j = i + 1; j < limited.length; j++) {
        const pair = scorePair(limited[i], limited[j], rules);
        if (pair.score < minScore) continue;
        const ra = find(limited[i].contactId);
        const rb = find(limited[j].contactId);
        if (ra !== rb) parent.set(ra, rb);
        for (const id of [limited[i].contactId, limited[j].contactId]) {
          const prev = best.get(id);
          if (!prev || pair.score > prev.score) best.set(id, pair);
        }
      }
    }
  }
  const clusters = new Map<string, Person[]>();
  for (const p of people) {
    if (!best.has(p.contactId)) continue;
    const r = find(p.contactId);
    (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(p);
  }
  const groups: Group[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    // A cluster in which two records clearly differ (different email AND different phone) is split, so we never offer to merge two people.
    const parts = cluster.some((a, i) => cluster.slice(i + 1).some((b) => clearlyDiffer(a, b))) ? splitCompatible(cluster) : [cluster];
    for (const members of parts) {
      // Reasons and confidence come from the pairs inside this group only.
      const own = new Map<string, Pair>();
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pair = scorePair(members[i], members[j], rules);
          if (pair.score < minScore) continue;
          for (const id of [members[i].contactId, members[j].contactId]) {
            const prev = own.get(id);
            if (!prev || pair.score > prev.score) own.set(id, pair);
          }
        }
      }
      const linked = members.filter((m) => own.has(m.contactId));
      if (linked.length < 2) continue;
      const reasons = [...new Set(linked.flatMap((m) => own.get(m.contactId)!.reasons))];
      const confidence = Math.max(...linked.map((m) => own.get(m.contactId)!.score));
      const exact = reasons.includes("same email") || reasons.includes("same phone");
      const format = reasons.some((r) => r.startsWith("phone in") || r.startsWith("phone with") || r.startsWith("email differs"));
      groups.push({
        key: groupKey(linked.map((m) => m.contactId)),
        people: linked,
        confidence,
        reasons,
        kind: exact && !format ? "exact" : format ? "format" : "name",
        survivorId: chooseSurvivor(linked).contactId,
      });
    }
  }
  return groups.sort((a, b) => b.confidence - a.confidence || b.people.length - a.people.length);
}

// ---------- the "which fields to keep" plan ----------

export type FieldChoice = { field: "name" | "email" | "phone" | "tags"; keep: string; from: string; others: string[] };

// For each field, keep the survivor's value, or the other record's when the survivor has none.
// The user can still choose differently; this is only the suggestion.
export function planFields(group: Pick<Group, "people" | "survivorId">): FieldChoice[] {
  const survivor = group.people.find((p) => p.contactId === group.survivorId)!;
  const rest = group.people.filter((p) => p.contactId !== group.survivorId);
  const pick = (field: "name" | "email" | "phone"): FieldChoice => {
    const own = survivor[field];
    const fallback = rest.map((p) => p[field]).find((v) => v && v !== "Unnamed contact");
    const keep = own && own !== "Unnamed contact" ? own : fallback ?? "";
    const others = [...new Set(rest.map((p) => p[field]).filter((v): v is string => !!v && v !== keep && v !== "Unnamed contact"))];
    return { field, keep, from: keep === own ? "the record you keep" : "another record", others };
  };
  const tags = [...new Set(group.people.flatMap((p) => p.tags))];
  return [
    pick("name"), pick("email"), pick("phone"),
    { field: "tags", keep: tags.join(", "), from: "all records combined", others: [] },
  ];
}

// ---------- classification for the summary ----------

export function classify(groups: Group[]): { exact: number; format: number; name: number; contacts: number } {
  const count = (k: Group["kind"]) => groups.filter((g) => g.kind === k).length;
  return { exact: count("exact"), format: count("format"), name: count("name"), contacts: groups.reduce((s, g) => s + g.people.length, 0) };
}

// A safe default for a bulk action: groups at or above a confidence level that have not been reviewed.
export function bulkSelect<G extends Group>(groups: G[], reviewed: Set<string>, minConfidence: number, maxConfidence = 100): G[] {
  return groups.filter((g) => !reviewed.has(g.key) && g.confidence >= minConfidence && g.confidence <= maxConfidence);
}
