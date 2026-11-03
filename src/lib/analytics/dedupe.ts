// Duplicate detection inside ONE client account. Pure logic (no database or network imports) so it
// can be unit tested. Different clients' customers are never compared with each other here.
//
// SubSync only reads contacts, so this module finds and explains likely duplicates and recommends
// which record to keep; it never changes anything. The merge itself is done in the platform's
// own merge screen, which keeps the history of both records.

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
  /** Marked do not disturb in the CRM. Never offered for any action. */
  dnd?: boolean;
  /** Appointments that have not happened yet. */
  upcomingAppointments?: number;
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
  | "same email" | "same phone" | "email differs only in case, spaces or gmail dots" | "phone in a different format"
  | "same name" | "similar name" | "different names";

export type Pair = { score: number; reasons: MatchReason[] };

const UNNAMED = new Set(["", "unnamed contact", "no name"]);

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// One word against one word: 1 if equal, 0.9 for an initial, a typo scores by how little changed, anything else 0.
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 0.9;
  const sim = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return sim >= 0.7 ? sim : 0;
}

// How alike two names are, 0 to 1, or null when one of them has no usable name (then names say nothing either way).
// Word order does not matter ("Smith Ann" is "Ann Smith"), a typo costs a little ("Jon", "John"), an initial counts ("J Smith"),
// and a missing second word is a likely match at a lower level ("Ann" and "Ann Smith"). A shared surname alone is not enough:
// "Ann Bell" and "Bob Bell" are about half alike, which is "different".
export function nameSimilarity(a: string, b: string): number | null {
  const na = normName(a);
  const nb = normName(b);
  if (UNNAMED.has(na) || UNNAMED.has(nb)) return null;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const free = [...big];
  let total = 0;
  for (const w of small) {
    let best = -1;
    let bestSim = 0;
    free.forEach((x, i) => { const v = wordSimilarity(w, x); if (v > bestSim) { bestSim = v; best = i; } });
    if (best >= 0) free.splice(best, 1);
    total += bestSim;
  }
  const mean = total / small.length;
  return small.length < big.length ? mean * 0.85 : mean;
}

// How sure we are that two records are the same person (0 to 100) and why. A shared phone or email is only a clue:
// families share a phone and offices share an inbox. So the score depends on the names too, and drops sharply when they differ.
export function scorePair(a: Person, b: Person): Pair {
  const reasons: MatchReason[] = [];
  let score = 0;
  let emailShared = false;
  let phoneShared = false;
  const ea = normEmail(a.email);
  const eb = normEmail(b.email);
  if (ea && eb) {
    if (a.email!.trim() === b.email!.trim()) { reasons.push("same email"); score = Math.max(score, 94); emailShared = true; }
    else if (ea === eb || foldEmail(a.email) === foldEmail(b.email)) { reasons.push("email differs only in case, spaces or gmail dots"); score = Math.max(score, 82); emailShared = true; }
  }
  const pa = normPhone(a.phone);
  const pb = normPhone(b.phone);
  if (pa && pb && pa === pb) {
    phoneShared = true;
    if ((a.phone ?? "").trim() === (b.phone ?? "").trim()) { reasons.push("same phone"); score = Math.max(score, 90); }
    else { reasons.push("phone in a different format"); score = Math.max(score, 80); }
  }
  const ns = nameSimilarity(a.name, b.name);
  if (score > 0) {
    if (ns === null) return { score, reasons };
    if (ns >= 0.8) {
      reasons.push(ns === 1 ? "same name" : "similar name");
      score = Math.min(99, score + 5);
    } else if (ns >= 0.6) {
      score -= 10;
    } else {
      // Different people who share a phone or an inbox. Both shared is a little more likely to be one person, and still low.
      reasons.push("different names");
      score = emailShared && phoneShared ? 45 : 35;
    }
    return { score, reasons };
  }
  // Nothing shared: the same full name alone is only a weak hint.
  const na = normName(a.name);
  if (ns === 1 && na.includes(" ")) { reasons.push("same name"); score = 35; }
  return { score, reasons };
}

// ---------- grouping ----------

export type Group = {
  key: string;
  people: Person[];
  confidence: number;
  reasons: MatchReason[];
  kind: "exact" | "format" | "name" | "shared";
  survivorId: string;
  /** Why the survivor was suggested, in one plain phrase. */
  keepReason: string;
  /** For a "shared" group: the phone or email the records share. */
  sharedKey?: string;
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

// Which record to keep, with ONE stated reason. Order: an ongoing payment or subscription (not in our data yet, so never claimed),
// active workflows (same), open deals, upcoming appointments, recent activity, most complete details, then the oldest record.
export function suggestKeep(people: Person[]): { person: Person; reason: string } {
  const complete = (p: Person) => (p.email ? 1 : 0) + (p.phone ? 1 : 0) + (!UNNAMED.has(normName(p.name)) ? 1 : 0) + (p.tags.length > 0 ? 1 : 0) + (p.hasConversation ? 1 : 0) + (p.wonDeals > 0 ? 1 : 0);
  const recent = (p: Person) => (p.lastActivityAt ? Date.parse(p.lastActivityAt) : 0);
  const tiers: Array<{ reason: string; value: (p: Person) => number; min?: number }> = [
    { reason: "It has an open deal", value: (p) => p.openDeals },
    { reason: "It has an upcoming appointment", value: (p) => p.upcomingAppointments ?? 0 },
    { reason: "It has the most recent activity", value: recent, min: 86_400_000 },
    { reason: "It has the most complete details", value: complete },
  ];
  let pool = people;
  let reason = "";
  for (const t of tiers) {
    const vals = pool.map(t.value);
    const top = Math.max(...vals);
    if (top <= 0 || top === Math.min(...vals)) continue;
    if (t.min && top - Math.min(...vals) < t.min) continue; // activity within a day of each other is a tie
    pool = pool.filter((p) => t.value(p) === top);
    reason = reason || t.reason;
    if (pool.length === 1) break;
  }
  const oldest = [...pool].sort((x, y) => (x.createdAt ?? "9").localeCompare(y.createdAt ?? "9") || x.contactId.localeCompare(y.contactId))[0];
  return { person: oldest, reason: reason || "It is the oldest record" };
}

export function chooseSurvivor(people: Person[]): Person {
  return suggestKeep(people).person;
}

// How many different people the names describe (names that are alike count once). Records without a name are not counted.
export function distinctNames(people: Person[]): number {
  const reps: string[] = [];
  for (const p of people) {
    if (UNNAMED.has(normName(p.name))) continue;
    if (!reps.some((r) => (nameSimilarity(r, p.name) ?? 0) >= 0.6)) reps.push(p.name);
  }
  return reps.length;
}

// Group contacts that are linked by a confident match (union-find). Pairs below `minScore` do not link.
// A shared phone can sit on thousands of records. The group lists at most this many (the screen shows the best three pairs anyway).
const MAX_SHARED = 300;

export function groupDuplicates(people: Person[], minScore = 50, maxGroup = 40): Group[] {
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
    add(foldEmail(p.email) && "e:" + foldEmail(p.email), p);
    add(normPhone(p.phone) && "p:" + normPhone(p.phone), p);
  }
  const best = new Map<string, Pair>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const limited = members.slice(0, maxGroup);
    for (let i = 0; i < limited.length; i++) {
      for (let j = i + 1; j < limited.length; j++) {
        const pair = scorePair(limited[i], limited[j]);
        if (pair.score < minScore || pair.reasons.includes("different names")) continue;
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
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const reasons = [...new Set(members.flatMap((m) => best.get(m.contactId)!.reasons))];
    const confidence = Math.max(...members.map((m) => best.get(m.contactId)!.score));
    const exact = reasons.includes("same email") || reasons.includes("same phone");
    const format = reasons.some((r) => r.startsWith("phone in") || r.startsWith("email differs"));
    const keep = suggestKeep(members);
    // Chained links can join people whose names are unrelated (A shares a phone with B, B shares an email with C).
    const unrelated = distinctNames(members) >= 3;
    groups.push({
      key: groupKey(members.map((m) => m.contactId)),
      people: members,
      confidence: unrelated ? Math.min(confidence, 35) : confidence,
      reasons: unrelated ? [...reasons, "different names" as MatchReason] : reasons,
      kind: unrelated ? "shared" : exact && !format ? "exact" : format ? "format" : "name",
      survivorId: keep.person.contactId,
      keepReason: keep.reason,
    });
  }
  // A phone or an inbox shared by people whose names differ is not a duplicate: a family phone, an office address, a
  // placeholder number. They are listed on their own, labelled as probably different people, and never linked into a
  // group with real duplicates. Every record is kept (not capped) so the count is honest; the screen shows the best pairs.
  const clusterOf = new Map<string, Group>();
  for (const g of groups) for (const m of g.people) clusterOf.set(m.contactId, g);
  const seenShared = new Set<string>();
  for (const [bucket, members] of buckets) {
    if (members.length < 2) continue;
    const rep = new Map<string, Person>();
    for (const m of members) {
      const g = clusterOf.get(m.contactId);
      if (!g) rep.set(m.contactId, m);
      else rep.set("c:" + g.key, g.people.find((x) => x.contactId === g.survivorId) ?? m);
    }
    const reps = [...rep.values()].slice(0, MAX_SHARED);
    if (reps.length < 2 || distinctNames(reps) < 2) continue;
    const key = groupKey(reps.map((m) => m.contactId));
    if (seenShared.has(key)) continue;
    seenShared.add(key);
    const keep = suggestKeep(reps);
    groups.push({
      key, people: reps, confidence: 30, reasons: [bucket.startsWith("p:") ? "same phone" : "same email", "different names"], kind: "shared",
      survivorId: keep.person.contactId, keepReason: keep.reason, sharedKey: bucket.slice(2),
    });
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

export function classify(groups: Group[]): { exact: number; format: number; name: number; shared: number; contacts: number } {
  const count = (k: Group["kind"]) => groups.filter((g) => g.kind === k).length;
  return { exact: count("exact"), format: count("format"), name: count("name"), shared: count("shared"), contacts: groups.reduce((s, g) => s + g.people.length, 0) };
}

// A safe default for a bulk action: groups at or above a confidence level that have not been reviewed.
export function bulkSelect<G extends Group>(groups: G[], reviewed: Set<string>, minConfidence: number, maxConfidence = 100, decision: "keep" | "not_duplicate" = "keep"): G[] {
  // Choosing a record to keep is never bulk for a group of probably different people or one with a do-not-disturb contact.
  // Saying "these are different people" is always allowed: it changes only our own note.
  const keep = decision === "keep";
  return groups.filter((g) => !reviewed.has(g.key) && !(keep && (g.kind === "shared" || g.people.some((p) => p.dnd))) && g.confidence >= minConfidence && g.confidence <= maxConfidence);
}
