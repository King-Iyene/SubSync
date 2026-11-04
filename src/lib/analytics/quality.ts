// Data quality for the Clean-up module (stage CLEANUP). Pure: no database, no network, no React, so every rule and the score are unit tested with fixtures.
//
// SubSync reads each client account's contacts and finds what is wrong with them: missing details, emails and phone numbers that cannot work, formatting that
// should be tidied, and junk or test records. Each problem is a FINDING with a plain name, the exact contacts it affects and, where one exists, the exact fix
// (before and after). Nothing here changes a contact. The same list of findings is the source of the score, the counts, the lists and the CSV, so the number on
// a card always equals the rows behind it (one definition, never two).

import { formatName, formatPhone } from "./cleanup-intel.ts";
import { emailFix, EMAIL_SHAPE } from "./email-fix.ts";
import { isPlaceholderPhone, isRoleEmail } from "./name-match.ts";

export { emailFix, EMAIL_SHAPE };

export type QRow = { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; tags: string[]; source?: string | null };

export type FindingGroup = "reach" | "valid" | "format" | "junk";
export type FindingId =
  | "unreachable" | "no_name" | "bad_email" | "disposable_email" | "bad_phone" | "email_typo" | "phone_format" | "name_case" | "role_email" | "test_record" | "placeholder_phone" | "empty_record";

export type FindingInfo = { id: FindingId; group: FindingGroup; label: string; todo: string; fixable: boolean; scored: boolean };

export const FINDINGS: Record<FindingId, FindingInfo> = {
  unreachable: { id: "unreachable", group: "reach", label: "No working email or phone", todo: "Add a way to reach them, or remove the contact if it is not a real lead.", fixable: false, scored: true },
  no_name: { id: "no_name", group: "reach", label: "No name", todo: "Add a name so staff know who they are talking to.", fixable: false, scored: false },
  bad_email: { id: "bad_email", group: "valid", label: "Email that cannot work", todo: "Fix the typo or clear the email so messages are not wasted.", fixable: false, scored: true },
  disposable_email: { id: "disposable_email", group: "valid", label: "Throwaway email address", todo: "These inboxes disappear. Ask for a real address or stop emailing it.", fixable: false, scored: true },
  bad_phone: { id: "bad_phone", group: "valid", label: "Phone number that cannot work", todo: "The number is too short or too long. Fix it or clear it.", fixable: false, scored: true },
  email_typo: { id: "email_typo", group: "format", label: "Email with a typo in the domain", todo: "Change the address to the corrected one shown.", fixable: true, scored: true },
  phone_format: { id: "phone_format", group: "format", label: "Phone not in international format", todo: "Rewrite the number as shown (a plus sign, country code, digits).", fixable: true, scored: true },
  name_case: { id: "name_case", group: "format", label: "Name in capitals, lower case or odd spacing", todo: "Change the name to the tidier spelling shown.", fixable: true, scored: true },
  role_email: { id: "role_email", group: "valid", label: "Shared company mailbox (info@, sales@)", todo: "One mailbox, many readers: replies may not reach the person. Ask for their own address.", fixable: false, scored: false },
  test_record: { id: "test_record", group: "junk", label: "Test or made-up record", todo: "Remove it, so it never gets a real message or skews your numbers.", fixable: false, scored: true },
  placeholder_phone: { id: "placeholder_phone", group: "junk", label: "Placeholder phone number", todo: "The number is made up (0000000000). Clear it.", fixable: false, scored: true },
  empty_record: { id: "empty_record", group: "junk", label: "Empty contact", todo: "No name, email or phone. Remove it.", fixable: false, scored: true },
};

export const FINDING_ORDER: FindingId[] = ["empty_record", "test_record", "unreachable", "bad_email", "disposable_email", "bad_phone", "placeholder_phone", "email_typo", "phone_format", "name_case", "no_name", "role_email"];
export const GROUP_LABEL: Record<FindingGroup, string> = { reach: "Missing details", valid: "Cannot work", format: "Needs tidying", junk: "Junk and tests" };

// ---------- the small lists ----------

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com",
  "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempinbox.com", "spamgourmet.com", "moakt.com", "mailnesia.com", "tempr.email", "discard.email",
]);

const TEST_NAME = /^(test|testing|tester|asdf|asdfgh|qwerty|xxx+|aaa+|zzz+|sample|demo|dummy|fake|n\/a|na|none|null|unknown|no name|noname|delete me|do not use|john doe|jane doe|lorem)(\s|$)/i;
const TEST_DOMAIN = new Set(["example.com", "example.org", "example.net", "test.com", "test.test", "invalid", "localhost", "email.com.test"]);

// ---------- one contact ----------

const clean = (s: string | null | undefined) => (s ?? "").trim();
const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1).toLowerCase();

export type Fix = { field: "phone" | "email" | "firstName" | "lastName"; before: string; after: string };

export type Options = { countryCode?: string | null };

export function phoneDigits(phone: string | null | undefined): number { return clean(phone).replace(/\D/g, "").length; }

/** Which findings apply to one contact. Pure. */
export function findingsOf(r: QRow, o: Options = {}): FindingId[] {
  const out: FindingId[] = [];
  const email = clean(r.email);
  const phone = clean(r.phone);
  const first = clean(r.firstName);
  const last = clean(r.lastName);
  const hasName = !!(first || last);
  const fullName = `${first} ${last}`.trim();
  if (!hasName && !email && !phone) out.push("empty_record");
  else {
    // Nobody can be reached when there is no email and no phone, or the ones there cannot work (a made-up number, an address with no domain, a throwaway inbox).
    const mailOk = !!email && EMAIL_SHAPE.test(email) && !DISPOSABLE.has(domainOf(email));
    const phoneOk = !!phone && phoneDigits(phone) >= 7 && phoneDigits(phone) <= 15 && !isPlaceholderPhone(phone);
    if (!mailOk && !phoneOk) out.push("unreachable");
  }
  if (!hasName && (email || phone)) out.push("no_name");
  if (email) {
    if (!EMAIL_SHAPE.test(email)) out.push("bad_email");
    else {
      if (DISPOSABLE.has(domainOf(email))) out.push("disposable_email");
      if (emailFix(email)) out.push("email_typo");
      if (isRoleEmail(email)) out.push("role_email");
    }
  }
  if (phone) {
    const n = phoneDigits(phone);
    if (n < 7 || n > 15) out.push("bad_phone");
    else {
      if (isPlaceholderPhone(phone)) out.push("placeholder_phone");
      else if (!/^\+[1-9]\d{6,14}$/.test(phone)) out.push("phone_format");
    }
  }
  if ((first && formatName(first)) || (last && formatName(last))) out.push("name_case");
  const emailDomain = email && EMAIL_SHAPE.test(email) ? domainOf(email) : "";
  if (hasName && (TEST_NAME.test(fullName) || (emailDomain && TEST_DOMAIN.has(emailDomain)))) out.push("test_record");
  return out;
}

/** The exact change that fixes a finding, or null when SubSync cannot be sure what the right value is. */
export function fixFor(r: QRow, id: FindingId, o: Options = {}): Fix[] | null {
  if (id === "email_typo") { const a = emailFix(r.email); return a && r.email ? [{ field: "email", before: r.email, after: a }] : null; }
  if (id === "phone_format") { const a = formatPhone(r.phone, o.countryCode ?? null); return a && r.phone ? [{ field: "phone", before: r.phone, after: a }] : null; }
  if (id === "name_case") {
    const out: Fix[] = [];
    const f = formatName(r.firstName);
    const l = formatName(r.lastName);
    if (f && r.firstName && f !== r.firstName) out.push({ field: "firstName", before: r.firstName, after: f });
    if (l && r.lastName && l !== r.lastName) out.push({ field: "lastName", before: r.lastName, after: l });
    return out.length ? out : null;
  }
  return null;
}

// ---------- one account ----------

export const CAP_PER_FINDING = 5000;

export type Scan = {
  total: number;
  counts: Record<FindingId, number>;
  /** Contact ids per finding, in the order they were read, cut at CAP_PER_FINDING (the count is never cut). */
  ids: Record<FindingId, string[]>;
  /** Contacts with at least one problem of that kind (a contact with two is counted once). */
  shares: { unreachable: number; invalid: number; format: number; junk: number };
  /** Contacts with an email, a phone, a name. */
  filled: { email: number; phone: number; name: number };
};

const emptyCounts = () => Object.fromEntries(FINDING_ORDER.map((k) => [k, 0])) as Record<FindingId, number>;

export function scanContacts(rows: Iterable<QRow>, o: Options = {}): Scan {
  const counts = emptyCounts();
  const ids = Object.fromEntries(FINDING_ORDER.map((k) => [k, [] as string[]])) as Record<FindingId, string[]>;
  const shares = { unreachable: 0, invalid: 0, format: 0, junk: 0 };
  const filled = { email: 0, phone: 0, name: 0 };
  let total = 0;
  for (const r of rows) {
    total++;
    if (clean(r.email)) filled.email++;
    if (clean(r.phone)) filled.phone++;
    if (clean(r.firstName) || clean(r.lastName)) filled.name++;
    const f = findingsOf(r, o);
    for (const id of f) { counts[id]++; if (ids[id].length < CAP_PER_FINDING) ids[id].push(r.id); }
    if (f.includes("unreachable")) shares.unreachable++;
    if (f.some((x) => x === "bad_email" || x === "bad_phone" || x === "disposable_email")) shares.invalid++;
    if (f.some((x) => x === "email_typo" || x === "phone_format" || x === "name_case")) shares.format++;
    if (f.some((x) => x === "test_record" || x === "placeholder_phone" || x === "empty_record")) shares.junk++;
  }
  return { total, counts, ids, shares, filled };
}

// ---------- the score ----------

/** Fewer contacts than this and a score would be a guess, so none is given. */
export const MIN_CONTACTS_FOR_SCORE = 50;

/** A share of contacts at which a part scores zero. A tenth of the contacts being junk is already as bad as it gets. */
export const FULLY_BAD = { reach: 0.5, valid: 0.2, format: 0.5, junk: 0.1, unique: 0.1 } as const;
export const WEIGHTS = { reach: 30, valid: 20, format: 10, junk: 25, unique: 15 } as const;
export type PartId = keyof typeof WEIGHTS;
export const PART_LABEL: Record<PartId, string> = { reach: "Can be reached", valid: "Details that work", format: "Tidy formatting", junk: "No junk or tests", unique: "No duplicates" };

export type Score = { score: number; parts: Record<PartId, number>; contacts: number };

/** 100 minus the penalty of each part. A part is 100 when none of the contacts have its problem and 0 when a "fully bad" share do. */
export function scoreOf(scan: Pick<Scan, "total" | "shares">, duplicateExtra: number): Score | null {
  if (scan.total < MIN_CONTACTS_FOR_SCORE) return null;
  const share: Record<PartId, number> = {
    reach: scan.shares.unreachable / scan.total, valid: scan.shares.invalid / scan.total, format: scan.shares.format / scan.total,
    junk: scan.shares.junk / scan.total, unique: Math.max(0, duplicateExtra) / scan.total,
  };
  const parts = {} as Record<PartId, number>;
  let score = 100;
  for (const k of Object.keys(WEIGHTS) as PartId[]) {
    const bad = Math.min(1, share[k] / FULLY_BAD[k]);
    parts[k] = Math.round(100 - 100 * bad);
    score -= WEIGHTS[k] * bad;
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), parts, contacts: scan.total };
}

export function scoreWord(score: number): string {
  return score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 55 ? "Fair" : "Needs work";
}

// ---------- the trend (from stored snapshots only) ----------

export type Snap = { day: string; score: number };
export const MIN_TREND_POINTS = 2;
export const MIN_TREND_DAYS = 3;

export type Trend = { state: "ok"; from: Snap; to: Snap; change: number; points: Snap[] } | { state: "not_enough"; points: Snap[]; reason: string };

/** The change from the oldest to the newest stored snapshot. Two snapshots at least three days apart are needed; otherwise "not enough history yet". */
export function trendOf(snaps: readonly Snap[]): Trend {
  const points = [...snaps].sort((a, b) => a.day.localeCompare(b.day));
  if (points.length < MIN_TREND_POINTS) return { state: "not_enough", points, reason: "Not enough history yet. SubSync keeps one score a day, so a trend appears after a few days." };
  const from = points[0];
  const to = points[points.length - 1];
  const days = (Date.parse(to.day) - Date.parse(from.day)) / 86_400_000;
  if (days < MIN_TREND_DAYS) return { state: "not_enough", points, reason: "Not enough history yet. A trend needs scores from at least 3 days apart." };
  return { state: "ok", from, to, change: to.score - from.score, points };
}

/** The accounts with the lowest score first (the ones to clean up first). Accounts with no score yet go last, named. */
export function worstFirst<T extends { name: string | null; score: number | null; contacts: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0) || (a.score ?? 0) - (b.score ?? 0) || b.contacts - a.contacts || (a.name ?? "").localeCompare(b.name ?? ""));
}
