import { clearlyDiffer, type Person } from "../analytics/dedupe.ts";
import { firstNamesDiffer, isRoleEmail, nameSimilarity } from "../analytics/name-match.ts";
import { namesConflict } from "./dupe-tier.ts";
import { DEFAULT_UNREADABLE, UNREADABLE_WORDS, pickMaster, type Unreadable } from "./master-rank.ts";

// SAFE BULK MERGE. Pure rules, no database: the server route and the tests read the same function. The bulk path is stricter than the one-by-one screen because nobody looks at each pair.
// It merges a pair ONLY when every check below says yes. Any doubt skips the pair and says why in plain words. The keeper is chosen by the SAME function as the screen (pickMaster, master-rank.ts):
// there is no second ranking. The merge workflow keeps the OLDER record, so a pair is also skipped when the ranked master is not the older one.

export type BulkVerdict =
  | { ok: true; keepId: string; goneId: string; keepName: string; goneName: string; why: string }
  | { ok: false; code: BulkSkip; why: string };

export type BulkSkip = "size" | "protected" | "different_people" | "unreadable" | "tie" | "no_master" | "not_older" | "no_dates";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const isNamed = (n: string) => !!norm(n) && norm(n) !== "unnamed contact";
const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

/** Anybody in the group who must never be merged in bulk: Do Not Disturb, an open deal, a coming appointment, a known payment. Each reason in plain words. */
export function protectedWhy(people: readonly Person[]): string | null {
  for (const p of people) {
    if (p.dnd === true) return `${p.name} is on Do Not Disturb`;
    if (p.openDeals > 0) return `${p.name} has an open deal`;
    if (p.nextAppointmentAt) return `${p.name} has a coming appointment`;
    if ((p as { payments?: boolean | null }).payments === true) return `${p.name} has an ongoing payment`;
  }
  return null;
}

/** "Do these look like two different people?" Different phone and email, names that do not match, or a shared company mailbox with different names. Missing values never count as different. */
export function lookDifferent(a: Person, b: Person): string | null {
  if (clearlyDiffer(a, b)) return "a different email and a different phone number";
  const named = isNamed(a.name) && isNamed(b.name);
  if (named) {
    const sim = nameSimilarity(a.name, b.name);
    if (sim.kind === "none") return "names that do not match";
    if (sim.kind !== "exact" && sim.kind !== "order" && firstNamesDiffer(a.name, b.name)) return "different first names";
    if (isRoleEmail(a.email) && norm(a.name) !== norm(b.name)) return "a shared company mailbox with different names";
  }
  // Two different emails and two different names: a shared phone line (a household or an office), not proof of one person.
  if (named && norm(a.email) && norm(b.email) && norm(a.email) !== norm(b.email) && norm(a.name) !== norm(b.name)) return "different emails and different names";
  return null;
}

/** Why the kept copy was chosen, in one line, from the signals SubSync really read. Never mentions anything it cannot see. */
function keptBecause(keep: Person, gone: Person): string {
  const bits: string[] = [];
  if (keep.wonDeals > gone.wonDeals || (keep.wonDeals > 0 && gone.wonDeals === 0)) bits.push("has a won deal");
  else if (keep.openDeals > 0 && gone.openDeals === 0) bits.push("has an open deal");
  if ((keep.appointments ?? 0) > 0 && (gone.appointments ?? 0) === 0) bits.push("has booked appointments");
  if (keep.hasConversation && !gone.hasConversation) bits.push("has a conversation on file");
  if (bits.length === 0) bits.push("is the fuller record, and the older one");
  return `${keep.name} ${bits.join(" and ")}`;
}

export type BulkOpts = { unreadable?: readonly Unreadable[]; workflowSurvivorId?: string | null };

/**
 * One group, one verdict. Order of the checks is the order the reason is worded in:
 * 1 only pairs; 2 nobody protected; 3 not different people; 4 the master ranking decides cleanly (nothing unreadable at the top, no tie, a master exists);
 * 5 the merge workflow keeps the older record and that must be the master.
 */
export function judgeBulkPair(people: readonly Person[], o: BulkOpts = {}): BulkVerdict {
  const unreadable = o.unreadable ?? DEFAULT_UNREADABLE;
  // Different names on one email or phone: never bulk, whatever the size. Said first because it is the most important reason.
  if (namesConflict(people.map((p) => p.name))) return { ok: false, code: "different_people", why: "Same email or phone, but different names. These may be different people." };
  if (people.length !== 2) return { ok: false, code: "size", why: "Only pairs are merged in bulk. Groups of three or more need you to look." };
  const prot = protectedWhy(people);
  if (prot) return { ok: false, code: "protected", why: `${prot}. Protected people are never merged in bulk.` };
  const [a, b] = people;
  const diff = lookDifferent(a, b);
  if (diff) return { ok: false, code: "different_people", why: `These may be different people: ${diff}.` };
  const pick = pickMaster(people, unreadable);
  const unseen = pick.copies.flatMap((c) => c.unknown);
  if (unseen.length > 0) {
    const words = [...new Set(unseen)].map((u) => UNREADABLE_WORDS[u]).join(", ");
    return { ok: false, code: "unreadable", why: `SubSync cannot read ${words} for these people, so it cannot tell which one to keep. Check them in your CRM.` };
  }
  if (!pick.suggestedId) {
    const tie = /Both copies|copies have|look equal/.test(pick.why ?? "");
    return { ok: false, code: tie ? "tie" : "no_master", why: pick.why ?? "SubSync could not tell which copy to keep." };
  }
  const keep = people.find((p) => p.contactId === pick.suggestedId)!;
  const gone = people.find((p) => p.contactId !== pick.suggestedId)!;
  if (!Number.isFinite(ms(a.createdAt)) || !Number.isFinite(ms(b.createdAt))) return { ok: false, code: "no_dates", why: "SubSync does not know which record is older, and the merge keeps the older one." };
  const older = ms(a.createdAt) <= ms(b.createdAt) ? a : b;
  const survivor = o.workflowSurvivorId ?? older.contactId;
  if (survivor !== keep.contactId) return { ok: false, code: "not_older", why: `${keep.name} should be kept, but the merge keeps the older record (${older.name}). Merge this one in your CRM and choose the primary yourself.` };
  return { ok: true, keepId: keep.contactId, goneId: gone.contactId, keepName: keep.name, goneName: gone.name, why: keptBecause(keep, gone) };
}

export type BulkItem = { key: string; locationId: string; locationName: string | null; people: readonly Person[] };
export type BulkLine = { key: string; locationId: string; account: string | null; names: string[]; keepName?: string; goneName?: string; why: string; code?: BulkSkip | "limit" };
export type BulkPlan = { will: BulkLine[]; skipped: BulkLine[]; willItems: Array<BulkItem & { keepId: string; goneId: string; why: string }> };

/** Every group, judged. `limit` is how many may be merged in one run; the rest wait ("run it again"). */
export function planBulk(items: readonly BulkItem[], limit: number, o: BulkOpts = {}): BulkPlan {
  const plan: BulkPlan = { will: [], skipped: [], willItems: [] };
  for (const it of items) {
    const names = it.people.map((p) => p.name);
    const v = judgeBulkPair(it.people, o);
    if (!v.ok) { plan.skipped.push({ key: it.key, locationId: it.locationId, account: it.locationName, names, why: v.why, code: v.code }); continue; }
    if (plan.will.length >= limit) { plan.skipped.push({ key: it.key, locationId: it.locationId, account: it.locationName, names, why: `Over the limit of ${limit} at a time. Run it again after this batch.`, code: "limit" }); continue; }
    plan.will.push({ key: it.key, locationId: it.locationId, account: it.locationName, names, keepName: v.keepName, goneName: v.goneName, why: v.why });
    plan.willItems.push({ ...it, keepId: v.keepId, goneId: v.goneId, why: v.why });
  }
  return plan;
}

/** The plain-words dry-run text, one line per group. Used by the screen and the tests, so the words cannot drift. */
export const willLine = (l: Pick<BulkLine, "keepName" | "goneName" | "why">) => `${l.keepName} (kept) <- ${l.goneName} (removed): ${l.why}`;
export const skipLine = (l: Pick<BulkLine, "names" | "why">) => `${l.names.join(" and ")}: ${l.why}`;
export const WILL_TITLE = (n: number) => `These ${n} ${n === 1 ? "group" : "groups"} will be merged`;
export const SKIP_TITLE = (n: number) => `These ${n} ${n === 1 ? "group was" : "groups were"} skipped and why`;
export type SkipBucket = "protected" | "different names" | "unclear master" | "other";
const bucketOf = (l: { code?: string; why: string }): SkipBucket => {
  if (l.code === "protected" || /do not disturb|open deal|coming appointment|ongoing payment|protected/i.test(l.why)) return "protected";
  if (l.code === "different_people" || /different (people|names|first names|emails)|names that do not match/i.test(l.why)) return "different names";
  if (l.code === "tie" || l.code === "no_master" || l.code === "not_older" || l.code === "unreadable" || l.code === "no_dates") return "unclear master";
  return "other";
};
/** "9 will be skipped: 4 protected, 3 different names, ...". Shown before anything runs. Empty when nothing is skipped. */
export function skipSummary(skipped: ReadonlyArray<{ code?: string; why: string }>): string {
  if (skipped.length === 0) return "";
  const n: Record<SkipBucket, number> = { protected: 0, "different names": 0, "unclear master": 0, other: 0 };
  for (const l of skipped) n[bucketOf(l)]++;
  const bits = (Object.keys(n) as SkipBucket[]).filter((k) => n[k] > 0).map((k) => `${n[k]} ${k === "other" ? "other reasons (not a pair, too many copies, changed)" : k}`);
  return `${skipped.length} will be skipped: ${bits.join(", ")}.`;
}
export const BULK_BUTTON = (n: number) => `Merge all certain matches (${n})`;
export const ONE_BUTTON = "Merge this person";
export const BULK_NOTE = "Only certain matches (same phone or email, and the same name) in pairs. SubSync skips a pair whenever it is not completely sure: Do Not Disturb, an open deal, a coming appointment, a payment, names that do not match, a tie between the copies, or anything it cannot read (payments, automations, courses). A merge cannot be undone in your CRM; each one is written to the history with the details of the removed contact.";

/** What is written to the history for each merge: who is kept, who is removed, why, and the removed contact's details so it can be recreated by hand. */
export function undoRecord(item: { people: readonly Person[]; keepId: string; goneId: string; why: string }) {
  const gone = item.people.find((p) => p.contactId === item.goneId)!;
  return {
    keepContactId: item.keepId, removedContactId: item.goneId, reason: item.why,
    removed: { name: gone.name, email: gone.email, phone: gone.phone, tags: gone.tags, createdAt: gone.createdAt, source: gone.source, ownerId: gone.ownerId ?? null, wonDeals: gone.wonDeals, hasConversation: gone.hasConversation },
    undo: "A merge cannot be reversed in the CRM. Recreate the removed contact from these details, or restore it from the CRM's own merge history.",
  };
}
