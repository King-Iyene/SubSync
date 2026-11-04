// Advanced duplicate matching (stage CLEANUP, round 2). Pure: no database, no network.
//
// The same person often turns up with DIFFERENT details: a new phone, a second email, Bob for Robert, first and last name swapped, a typo, a business address and a personal one,
// a number written another way. One rule ("same email") misses all of them, and a long list of loose rules floods people with false alarms. So this module weighs EVIDENCE:
//
//   - every signal that two records share or nearly share adds weight (name, email name and domain, phone in three strengths, when and where they were added, shared tags);
//   - weights combine as independent evidence (noisy-or): two weak signals make a stronger one, and no pile of weak signals can pass a strong one;
//   - signals that point the other way subtract (a phone shared by different first names, a shared info@ mailbox, details that conflict everywhere);
//   - the result is a 0 to 100 score and a TIER: sure (85 and up), likely (60 to 84), maybe (40 to 59, shown separately so it never floods the review);
//   - the weights are the account's own: from its yes and no decisions SubSync learns which signals mislead in that account (learnWeights), and a pair the person rejected is never asked again.
//
// "Same conversation thread or deal" is not a signal: a conversation and a deal each belong to exactly one contact, so two records can never share one (a platform fact, not a choice).
// Company name and custom fields are not copied into SubSync, so they cannot be compared either (see docs/CLEANUP_PARITY.md).

import { foldEmail, normEmail, normName, normPhone, type Person } from "./dedupe.ts";
import { digitsSwapped, firstNamesDiffer, isRoleEmail, jaroWinkler, nameSimilarity, splitName } from "./name-match.ts";

export type SignalId =
  | "email_exact" | "email_fold" | "email_local" | "domain_business"
  | "phone_exact" | "phone_format" | "phone_last7" | "phone_swap"
  | "name_exact" | "name_order" | "name_nickname" | "name_spelling" | "name_initial"
  | "time_close" | "time_day" | "source_same" | "tags_one" | "tags_many";

export type Signal = { id: SignalId; weight: number; label: string };
export type Penalty = { id: "household" | "mailbox" | "conflict" | "first_names"; weight: number; label: string };

/** The starting weights, out of 100: how sure this signal alone would make a careful person. */
export const BASE_WEIGHT: Record<SignalId, number> = {
  email_exact: 88, email_fold: 78, email_local: 38, domain_business: 8,
  phone_exact: 80, phone_format: 70, phone_last7: 50, phone_swap: 32,
  name_exact: 32, name_order: 30, name_nickname: 27, name_spelling: 22, name_initial: 14,
  time_close: 12, time_day: 4, source_same: 4, tags_one: 4, tags_many: 7,
};

export const SIGNAL_LABEL: Record<SignalId, string> = {
  email_exact: "same email", email_fold: "email differs only in case, spaces or gmail dots", email_local: "similar email name", domain_business: "same company email domain",
  phone_exact: "same phone", phone_format: "phone in a different format", phone_last7: "same last seven digits", phone_swap: "phone with two digits swapped",
  name_exact: "same name", name_order: "same name, first and last swapped", name_nickname: "similar name", name_spelling: "similar name", name_initial: "similar name",
  time_close: "added at about the same time", time_day: "added within a day of each other", source_same: "came from the same place", tags_one: "shared tag", tags_many: "shared tags",
};

export type Weights = Partial<Record<SignalId, number>>;

const GENERIC = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "msn.com", "live.com", "proton.me", "protonmail.com", "me.com", "ymail.com"]);

const localOf = (e: string) => e.slice(0, e.lastIndexOf("@")).toLowerCase().split("+")[0];
const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1).toLowerCase();
const letters = (s: string) => s.replace(/[^a-z]/g, "");
const last = (p: string, n: number) => p.slice(-n);

export type Evidence = { signals: Signal[]; penalties: Penalty[]; score: number; tier: Tier; reasons: string[] };
export type Tier = "sure" | "likely" | "maybe" | "none";

export const TIER_AT = { sure: 85, likely: 60, maybe: 40 } as const;
export const tierOf = (score: number): Tier => (score >= TIER_AT.sure ? "sure" : score >= TIER_AT.likely ? "likely" : score >= TIER_AT.maybe ? "maybe" : "none");

/** Every signal the pair shows, with its weight (after any learned multiplier), and every penalty. */
export function gather(a: Person, b: Person, w: Weights = {}): { signals: Signal[]; penalties: Penalty[] } {
  const signals: Signal[] = [];
  const penalties: Penalty[] = [];
  const add = (id: SignalId) => signals.push({ id, weight: Math.min(97, BASE_WEIGHT[id] * (w[id] ?? 1)), label: SIGNAL_LABEL[id] });

  // ----- email -----
  const ea = normEmail(a.email);
  const eb = normEmail(b.email);
  let emailLink = false;
  if (ea && eb) {
    if (a.email!.trim() === b.email!.trim()) { add("email_exact"); emailLink = true; }
    else if (ea === eb || foldEmail(a.email) === foldEmail(b.email)) { add("email_fold"); emailLink = true; }
    else {
      const la = localOf(ea);
      const lb = localOf(eb);
      const da = domainOf(ea);
      const db = domainOf(eb);
      // The same person with a business address and a personal one: the name before the @ is alike (ann.lee and ann_lee, alee and a.lee), the domains differ.
      const sa = letters(la);
      const sb = letters(lb);
      if (sa.length >= 4 && sb.length >= 4 && !isRoleEmail(ea) && !isRoleEmail(eb) && (sa === sb || jaroWinkler(sa, sb) >= 0.93)) add("email_local");
      if (da === db && !GENERIC.has(da)) add("domain_business");
    }
  }

  // ----- phone -----
  const pa = normPhone(a.phone);
  const pb = normPhone(b.phone);
  let phoneLink = false;
  if (pa && pb) {
    if (pa === pb) { add((a.phone ?? "").trim() === (b.phone ?? "").trim() ? "phone_exact" : "phone_format"); phoneLink = true; }
    else if (digitsSwapped(pa, pb)) { add("phone_swap"); phoneLink = true; }
    else if (last(pa, 7) === last(pb, 7) && pa.length >= 7) { add("phone_last7"); phoneLink = true; }
  }

  // ----- name -----
  const na = normName(a.name);
  const nb = normName(b.name);
  const real = !!na && !!nb && na !== "unnamed contact" && nb !== "unnamed contact";
  let nameLink = false;
  if (real) {
    if (na === nb && na.includes(" ")) { add("name_exact"); nameLink = true; }
    else {
      const m = nameSimilarity(a.name, b.name);
      if (m.kind === "order") { add("name_order"); nameLink = true; }
      else if (m.kind === "nickname") { add("name_nickname"); nameLink = true; }
      else if (m.kind === "spelling") { add("name_spelling"); nameLink = true; }
      else if (m.kind === "initial") { add("name_initial"); nameLink = true; }
    }
  }

  // ----- when and where they were added, and what they share -----
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    const gap = Math.abs(ta - tb);
    if (gap <= 10 * 60_000) add("time_close");
    else if (gap <= 86_400_000) add("time_day");
  }
  if (a.source && b.source && a.source.trim().toLowerCase() === b.source.trim().toLowerCase()) add("source_same");
  const ta2 = new Set(a.tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const shared = b.tags.map((t) => t.trim().toLowerCase()).filter((t) => ta2.has(t)).length;
  if (shared >= 2) add("tags_many"); else if (shared === 1) add("tags_one");

  // ----- penalties: strong signals that point the other way -----
  const namesKnown = real && na.includes(" ") && nb.includes(" ");
  if (phoneLink && !emailLink && namesKnown && firstNamesDiffer(a.name, b.name)) penalties.push({ id: "household", weight: 32, label: "different first names, so this may be a shared household or office phone" });
  if (emailLink && !phoneLink && namesKnown && isRoleEmail(a.email) && !nameLink) penalties.push({ id: "mailbox", weight: 32, label: "a shared company mailbox such as info@, so this may be different people" });
  // Every contact detail both have disagrees (email, phone, and the name is not alike): two people.
  const bothMail = !!ea && !!eb;
  const bothPhone = !!pa && !!pb;
  if (bothMail && bothPhone && !emailLink && !phoneLink && !nameLink && !signals.some((s) => s.id === "email_local")) penalties.push({ id: "conflict", weight: 38, label: "the email and the phone number are both different" });
  if (!emailLink && !phoneLink && namesKnown && splitName(a.name).last === splitName(b.name).last && firstNamesDiffer(a.name, b.name)) penalties.push({ id: "first_names", weight: 18, label: "the first names are different" });
  return { signals, penalties };
}

/** Independent evidence: 1 minus the chance that every signal is wrong, then the penalties come off. */
export function combine(signals: readonly Signal[], penalties: readonly Penalty[]): number {
  const wrong = signals.reduce((p, s) => p * (1 - s.weight / 100), 1);
  const raw = (1 - wrong) * 100 - penalties.reduce((s, p) => s + p.weight, 0);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * How sure we are that two records are the same person, and why. A pair with no email, phone or name signal (only "added at the same time") never scores above 'maybe', so a
 * burst of imported contacts cannot link strangers.
 */
export function scoreEvidence(a: Person, b: Person, w: Weights = {}): Evidence {
  const { signals, penalties } = gather(a, b, w);
  const identity = signals.some((s) => /^(email_exact|email_fold|email_local|phone_|name_)/.test(s.id));
  let score = combine(signals, penalties);
  if (!identity) score = Math.min(score, 30);
  const reasons = [...new Set([...signals.filter((s) => s.id !== "tags_one" || signals.length > 1).map((s) => s.label), ...penalties.map((p) => p.id === "household" ? "different first names" : p.id === "mailbox" ? "shared company mailbox" : p.id === "conflict" ? "contact details conflict" : "different first names")])];
  return { signals, penalties, score, tier: tierOf(score), reasons };
}

// ---------- learning from the person's own decisions ----------

export type Decided = { accepted: ReadonlyArray<readonly [Person, Person]>; rejected: ReadonlyArray<readonly [Person, Person]> };

export const MIN_DECISIONS = 5;
export const MIN_SIGNAL_SEEN = 3;

export type Learned = { weights: Weights; accepted: number; rejected: number; adjusted: SignalId[]; enough: boolean };

/**
 * Per account. A signal that appears mostly in pairs the person REJECTED is misleading in this account (a family that shares a phone, a firm whose staff share a domain): its weight
 * drops, down to 0.6 of the base. A signal that appears mostly in pairs they ACCEPTED rises, up to 1.25. A signal needs to have been seen 3 times, and there must be 5 decisions
 * of each kind, before anything moves ("not enough decisions yet" is a valid answer). Pure and deterministic.
 */
export function learnWeights(d: Decided): Learned {
  const seen = new Map<SignalId, { acc: number; rej: number }>();
  const tally = (pairs: Decided["accepted"], key: "acc" | "rej") => {
    for (const [a, b] of pairs) for (const s of gather(a, b).signals) { const cur = seen.get(s.id) ?? { acc: 0, rej: 0 }; cur[key]++; seen.set(s.id, cur); }
  };
  tally(d.accepted, "acc");
  tally(d.rejected, "rej");
  const enough = d.accepted.length >= MIN_DECISIONS && d.rejected.length >= MIN_DECISIONS;
  const weights: Weights = {};
  const adjusted: SignalId[] = [];
  if (enough) {
    for (const [id, c] of seen) {
      if (c.acc + c.rej < MIN_SIGNAL_SEEN) continue;
      // Rates among the person's own decisions of each kind, so a person who mostly accepts does not drag every signal up.
      const accRate = c.acc / d.accepted.length;
      const rejRate = c.rej / d.rejected.length;
      if (accRate + rejRate === 0) continue;
      const share = rejRate / (accRate + rejRate); // 0 = only ever accepted, 1 = only ever rejected
      const m = Math.max(0.6, Math.min(1.25, 1.25 - share * 0.65));
      if (Math.abs(m - 1) >= 0.03) { weights[id] = Math.round(m * 100) / 100; adjusted.push(id); }
    }
  }
  return { weights, accepted: d.accepted.length, rejected: d.rejected.length, adjusted, enough };
}

/** A pair the person said is NOT the same person: never linked again, whatever else changes. The key is order-free. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
