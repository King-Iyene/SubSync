import { nameSimilarity, splitName } from "../analytics/name-match.ts";

// HOW SURE IS A DUPLICATE GROUP? Pure rules, no database. A shared email or phone is only "Certain" when the copies are also the same PERSON: the names must match
// (case, spacing, order and nicknames do not matter; a blank name never counts as different). One shared email with jordan smith, steve wonders and mike steven on it is a shared
// mailbox or a household, so it is "Likely" and says so. Used by the nightly scan (what is stored), the list (what is shown) and the bulk merge (what is allowed).

export type SureTier = "certain" | "likely" | "possible";
const BLANK = new Set(["", "unnamed contact", "unknown", "n/a", "na", "none"]);
const squash = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
export const hasName = (n: string | null | undefined): boolean => !BLANK.has(squash(n ?? ""));

/** Do two names plausibly belong to one person? Same words in any order, a nickname, an initial, a small typo, or one name that is only the first word of the other ("Ann" and "Ann Lee"). */
export function namesMatch(a: string, b: string): boolean {
  const x = squash(a), y = squash(b);
  if (x === y) return true;
  if ([...x.split(" ")].sort().join(" ") === [...y.split(" ")].sort().join(" ")) return true;
  if (nameSimilarity(a, b).kind !== "none") return true;
  const fx = splitName(a), fy = splitName(b);
  // A single word is compatible with a full name that starts or ends with it.
  if (!fx.last && fx.first && (fx.first === fy.first || fx.first === fy.last)) return true;
  if (!fy.last && fy.first && (fy.first === fx.first || fy.first === fx.last)) return true;
  return false;
}

/** True when two copies in the group have names that clearly differ. Blank names are ignored. */
export function namesConflict(names: ReadonlyArray<string | null | undefined>): boolean {
  const named = names.filter((n): n is string => hasName(n));
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) if (!namesMatch(named[i], named[j])) return true;
  return false;
}

/** The tier a group really deserves: a "certain" group whose names differ is only "likely". */
export function effectiveTier(tier: SureTier, names: ReadonlyArray<string | null | undefined>): SureTier {
  return tier === "certain" && namesConflict(names) ? "likely" : tier;
}

export const DIFFERENT_NAMES = "different names";
/** "Same email, different names". Added to the badge only when the tier was lowered for this reason. */
export const withNameNote = (badge: string): string => `${badge}, ${DIFFERENT_NAMES}`;
export const DIFFERENT_NAMES_WHY = "The email or phone is shared, but the names are different people's names. This may be a shared mailbox or a household. Check before you merge.";

export type TierTally = Record<SureTier, { groups: number; extra: number }>;
/** The read-time key of a stored group (account + group key). */
export const lowerKey = (loc: string, key: string): string => `${loc}\u0000${key}`;
/** Of the stored-"certain" groups, the ones whose names differ (so they really belong to "likely"). Key -> group size. One rule for the tab counts, each tab's list and the bulk merge. */
export function loweredGroups(certain: ReadonlyArray<{ loc: string; key: string; size: number; names: ReadonlyArray<string | null | undefined> }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of certain) if (effectiveTier("certain", g.names) !== "certain") out.set(lowerKey(g.loc, g.key), g.size);
  return out;
}
/** Moves the lowered groups from the stored "certain" count to "likely", so the tab counts, the headline split and the rows always agree. */
export function applyLowering(stored: TierTally, lowered: ReadonlyMap<string, number>): TierTally {
  const out: TierTally = { certain: { ...stored.certain }, likely: { ...stored.likely }, possible: { ...stored.possible } };
  for (const size of lowered.values()) {
    out.certain.groups--; out.certain.extra -= size - 1;
    out.likely.groups++; out.likely.extra += size - 1;
  }
  return out;
}
