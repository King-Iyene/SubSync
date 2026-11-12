// Clean-up (stage CU): the pure rules. No database, no network. Every definition is written once here and in docs/METRICS.md ("Clean-up: fix lists, health score and bulk runs").
//
// What lives here: the kinds of problem, the SQL predicates for each (the migration's partial indexes use exactly these), which contacts are PROTECTED from bulk deletes and merges and why,
// the typed confirmation, the caps, the health score with its evidence, and the weekly "what to clean" list with an hours-saved estimate (an estimate, labelled as one).

export const RULES_VERSION = "cu-health-1";
export const RULES_DATE = "11 Nov 2026";

export type ContactKind = "junk" | "no_owner" | "no_phone" | "no_email" | "no_source" | "bad_phone" | "bad_email";
export type DealKind = "stale_deals" | "ownerless_deals" | "orphan_deals";
export type Kind = ContactKind | DealKind;

export const CONTACT_KINDS: readonly ContactKind[] = ["junk", "bad_phone", "bad_email", "no_phone", "no_email", "no_owner", "no_source"];
export const DEAL_KINDS: readonly DealKind[] = ["stale_deals", "ownerless_deals", "orphan_deals"];
export const KINDS: readonly Kind[] = [...CONTACT_KINDS, ...DEAL_KINDS];
export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const isDealKind = (k: Kind): k is DealKind => (DEAL_KINDS as readonly string[]).includes(k);

export const STALE_DAYS = 30;

export type KindInfo = { id: Kind; label: string; plain: string; todo: string; minutes: number; weight: number; group: "junk" | "invalid" | "missing" | "deals" };
export const KIND_INFO: Record<Kind, KindInfo> = {
  junk: { id: "junk", label: "Junk and test contacts", plain: "Names or emails like test, asdf, fake or example.com. They are almost never real people.", todo: "Review them, then remove the ones that are junk.", minutes: 0.5, weight: 40, group: "junk" },
  bad_phone: { id: "bad_phone", label: "Phone numbers that cannot work", plain: "Too short or too long to be a real phone number.", todo: "Fix the number or ask the person for it again.", minutes: 1, weight: 25, group: "invalid" },
  bad_email: { id: "bad_email", label: "Emails that cannot work", plain: "Not shaped like an email address, so messages will bounce.", todo: "Fix the address or ask the person for it again.", minutes: 1, weight: 25, group: "invalid" },
  no_phone: { id: "no_phone", label: "No phone number", plain: "You cannot call or text these people.", todo: "Ask for a number the next time you speak, or find it in the form.", minutes: 1, weight: 15, group: "missing" },
  no_email: { id: "no_email", label: "No email address", plain: "You cannot email these people.", todo: "Ask for an address the next time you speak.", minutes: 1, weight: 10, group: "missing" },
  no_owner: { id: "no_owner", label: "No owner", plain: "Nobody is responsible for these people, so nobody follows up.", todo: "Give each one an owner in your CRM.", minutes: 0.5, weight: 10, group: "missing" },
  no_source: { id: "no_source", label: "No source", plain: "You cannot tell where these people came from.", todo: "Fix the form or import that did not record a source.", minutes: 0.5, weight: 5, group: "missing" },
  stale_deals: { id: "stale_deals", label: "Stale open deals", plain: `Open deals that have not moved for ${STALE_DAYS} days.`, todo: "Move them on, or close them as lost.", minutes: 1, weight: 15, group: "deals" },
  ownerless_deals: { id: "ownerless_deals", label: "Open deals with no owner", plain: "Money on the table that nobody is working.", todo: "Give each deal an owner.", minutes: 0.5, weight: 10, group: "deals" },
  orphan_deals: { id: "orphan_deals", label: "Deals with no contact", plain: "The person on the deal is not in this account any more.", todo: "Attach the right person or close the deal.", minutes: 1, weight: 20, group: "deals" },
};
export const GROUP_LABEL: Record<KindInfo["group"], string> = { junk: "Junk and tests", invalid: "Cannot work", missing: "Missing details", deals: "Deals" };

// ---------------------------------------------------------------- SQL predicates (identical to the partial indexes in the migration)
const JUNK_NAME = "^(test|testing|asdf|asdfgh|qwerty|xxx+|zzz+|demo|sample|fake|dummy|do not use)( .*)?$";
const JUNK_EMAIL = "(^(test|asdf|fake|demo|dummy)[0-9._+-]*@)|(@(example|mailinator|yopmail|tempmail|guerrillamail)[.])";
const EMAIL_SHAPE = "^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]{2,}$";

/** The WHERE fragment for a contact kind (table alias `c`). Constants only: nothing a person typed ever reaches it. */
export const CONTACT_PREDICATE: Record<ContactKind, string> = {
  junk: `(lower(coalesce(c.full_name, '')) ~ '${JUNK_NAME}' or lower(coalesce(c.email, '')) ~ '${JUNK_EMAIL}')`,
  no_owner: "coalesce(c.assigned_to, '') = ''",
  no_phone: "c.phone_digits = ''",
  no_email: "coalesce(c.email, '') = ''",
  no_source: "coalesce(c.source, '') = ''",
  bad_phone: "(c.phone_digits <> '' and (length(c.phone_digits) < 7 or length(c.phone_digits) > 15))",
  bad_email: `(coalesce(c.email, '') <> '' and c.email !~ '${EMAIL_SHAPE}')`,
};

/** The same rules in code, for tests and for the sample screens. */
export function contactKinds(c: { name?: string | null; email?: string | null; phone?: string | null; owner?: string | null; source?: string | null }): ContactKind[] {
  const out: ContactKind[] = [];
  const name = (c.name ?? "").toLowerCase(), email = (c.email ?? "").toLowerCase(), digits = (c.phone ?? "").replace(/\D/g, "");
  if (new RegExp(JUNK_NAME).test(name) || new RegExp(JUNK_EMAIL).test(email)) out.push("junk");
  if (digits !== "" && (digits.length < 7 || digits.length > 15)) out.push("bad_phone");
  if (email !== "" && !new RegExp("^[^@\\s]+@[^@\\s]+[.][^@\\s]{2,}$").test(c.email ?? "")) out.push("bad_email");
  if (digits === "") out.push("no_phone");
  if (email === "") out.push("no_email");
  if ((c.owner ?? "") === "") out.push("no_owner");
  if ((c.source ?? "") === "") out.push("no_source");
  return out;
}

// ---------------------------------------------------------------- protected contacts
export type ProtectInput = { dnd?: boolean | null; openDeals?: number | null; upcomingAppointments?: number | null };
export type ProtectReason = "dnd" | "open_deal" | "appointment";
export const PROTECT_WORDS: Record<ProtectReason, string> = {
  dnd: "Asked not to be contacted. Never removed or merged.",
  open_deal: "Has an open deal. Never removed or merged in bulk.",
  appointment: "Has an appointment coming up. Never removed or merged in bulk.",
};
/**
 * Why a contact is protected from a bulk delete or merge, or null when it is not. What the platform does not tell us (unsubscribed state, active payments, active workflows) is NOT
 * guessed: the screen says so in one line. The order is the order the reason is shown in.
 */
export function protectedReason(p: ProtectInput): ProtectReason | null {
  if (p.dnd === true) return "dnd";
  if ((p.openDeals ?? 0) > 0) return "open_deal";
  if ((p.upcomingAppointments ?? 0) > 0) return "appointment";
  return null;
}
export const NOT_KNOWN_LINE = "Not available from the platform yet: unsubscribed state, active payments and active workflows. Anything you remove, check those in your CRM first.";

// ---------------------------------------------------------------- bulk runs: caps, dry run, typed confirmation
export type BulkAction = "tag" | "remove";
export const CAPS: Record<BulkAction, number> = { tag: 200, remove: 25 };
export const REVIEW_TAG = "cleanup-review";

/** What the person must type, naming the item or the count. */
export function confirmPhrase(action: BulkAction, count: number, firstName?: string | null): string {
  const verb = action === "remove" ? "remove" : "tag";
  if (count === 1 && firstName) return `${verb} ${firstName.replace(/\s+/g, " ").trim()}`;
  return `${verb} ${count} ${count === 1 ? "contact" : "contacts"}`;
}
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
/** Exact match after trimming and lower-casing. A typo, a different number or a pasted number from earlier is refused. */
export function typedMatches(typed: unknown, phrase: string): boolean {
  return typeof typed === "string" && typed.length <= 200 && norm(typed) === norm(phrase);
}
export function removeNote(): string { return "This cannot be undone. SubSync cannot bring a removed contact back."; }

export type Mode = "dry_run" | "live";
/** A run is live only when the server switch AND the account's own opt-in are both on. Anything else is a dry run: the whole plan is shown and nothing is sent. */
export function runMode(o: { switchOn: boolean; optedIn: boolean }): Mode { return o.switchOn && o.optedIn ? "live" : "dry_run"; }
export function modeWords(m: Mode, o: { switchOn: boolean; optedIn: boolean }): string {
  if (m === "live") return "Live: this will change your CRM.";
  if (!o.switchOn) return "Not switched on yet: SubSync shows what it would do and changes nothing.";
  return "Not allowed for this account yet: switch on changing contacts in Settings. Until then nothing is changed.";
}

// ---------------------------------------------------------------- the health score
export type Counts = {
  contacts: number; dealsOpen: number; dupExtra: number;
  junk: number; no_owner: number; no_phone: number; no_email: number; no_source: number; bad_phone: number; bad_email: number;
  stale_deals: number; ownerless_deals: number; orphan_deals: number;
};
export const EMPTY_COUNTS: Counts = { contacts: 0, dealsOpen: 0, dupExtra: 0, junk: 0, no_owner: 0, no_phone: 0, no_email: 0, no_source: 0, bad_phone: 0, bad_email: 0, stale_deals: 0, ownerless_deals: 0, orphan_deals: 0 };
export const MIN_CONTACTS = 50;
/** A quarter of the records affected is a part's full penalty. */
export const FULL_AT = 0.25;
const DUP_WEIGHT = 30;

export type Evidence = { id: Kind | "dups"; label: string; count: number; share: number; lost: number };
export type Health = { score: number | null; word: string | null; evidence: Evidence[]; note: string | null; version: string };

export function wordFor(score: number): string { return score >= 85 ? "Healthy" : score >= 70 ? "Fair" : score >= 50 ? "Needs work" : "Poor"; }

/**
 * ONE score per account, 0 to 100. Each problem is a share of the records it can affect (contacts, or open deals for the deal problems). A part loses its weight in proportion to that
 * share, reaching its full loss at a quarter of the records. Under 50 contacts it says "not enough data" instead of a number. `evidence` is every part that lost points, biggest first,
 * so the score always comes with its reason.
 */
export function healthOf(c: Counts): Health {
  if (c.contacts < MIN_CONTACTS) return { score: null, word: null, evidence: [], note: `Not enough data yet: a score needs at least ${MIN_CONTACTS} contacts.`, version: RULES_VERSION };
  const parts: Array<{ id: Kind | "dups"; label: string; count: number; denom: number; weight: number }> = [
    ...CONTACT_KINDS.map((k) => ({ id: k, label: KIND_INFO[k].label, count: c[k], denom: c.contacts, weight: KIND_INFO[k].weight })),
    { id: "dups" as const, label: "Duplicate contacts", count: c.dupExtra, denom: c.contacts, weight: DUP_WEIGHT },
    ...DEAL_KINDS.map((k) => ({ id: k, label: KIND_INFO[k].label, count: c[k], denom: Math.max(1, c.dealsOpen), weight: KIND_INFO[k].weight })),
  ];
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const evidence: Evidence[] = [];
  let lost = 0;
  for (const p of parts) {
    const share = p.denom > 0 ? Math.min(1, p.count / p.denom) : 0;
    const l = (100 * p.weight * Math.min(1, share / FULL_AT)) / total;
    lost += l;
    if (p.count > 0) evidence.push({ id: p.id, label: p.label, count: p.count, share, lost: Math.round(l * 10) / 10 });
  }
  evidence.sort((a, b) => b.lost - a.lost || b.count - a.count);
  const score = Math.max(0, Math.min(100, Math.round(100 - lost)));
  return { score, word: wordFor(score), evidence, note: null, version: RULES_VERSION };
}

/** One plain line that says why the score is what it is. */
export function whyLine(h: Health): string {
  if (h.score === null) return h.note ?? "Not enough data yet.";
  const top = h.evidence.slice(0, 2);
  if (top.length === 0) return "No problems found in the records SubSync can see.";
  return `Mostly because of ${top.map((e) => `${e.label.toLowerCase()} (${e.count.toLocaleString("en-US")})`).join(" and ")}.`;
}

// ---------------------------------------------------------------- the weekly "what to clean" list
export const HOURLY_DOLLARS = 25;
export type CleanItem = { id: Kind | "dups"; label: string; count: number; minutes: number; hours: number; dollars: number; todo: string };
/**
 * The few things worth doing first, biggest saving first, with an hours-saved line. It is an ESTIMATE: minutes per record are fixed guesses (shown in the formula) and the hourly figure is
 * an assumption. Never presented as a measured result.
 */
export function weeklyList(c: Counts, hourly = HOURLY_DOLLARS, top = 5): CleanItem[] {
  const rows: CleanItem[] = [];
  if (c.dupExtra > 0) rows.push(mk("dups", "Merge duplicate contacts", c.dupExtra, 2, "Open the Duplicates tab and merge the obvious ones.", hourly));
  for (const k of KINDS) if (c[k] > 0) rows.push(mk(k, KIND_INFO[k].label, c[k], KIND_INFO[k].minutes, KIND_INFO[k].todo, hourly));
  return rows.sort((a, b) => b.hours - a.hours || b.count - a.count).slice(0, top);
}
function mk(id: Kind | "dups", label: string, count: number, minutesEach: number, todo: string, hourly: number): CleanItem {
  const minutes = Math.round(count * minutesEach);
  const hours = Math.round((minutes / 60) * 10) / 10;
  return { id, label, count, minutes, hours, dollars: Math.round(hours * hourly), todo };
}
export const FORMULA = "Estimate: records x minutes each (2 for a duplicate, 1 for a fix, half a minute for a quick review) divided by 60, times an assumed $25 an hour. It is a guess, not a measurement.";

// ---------------------------------------------------------------- keyset cursors
export type Cursor = { loc: string; id: string };
const SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
export function encodeCursor(c: Cursor): string { return Buffer.from(JSON.stringify([c.loc, c.id])).toString("base64url"); }
/** A strict shape: anything else is null and the caller answers 400. */
export function decodeCursor(v: unknown): Cursor | null {
  if (typeof v !== "string" || v.length === 0 || v.length > 400) return null;
  try {
    const a = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(a) || a.length !== 2 || typeof a[0] !== "string" || typeof a[1] !== "string" || !SHAPE.test(a[0]) || !SHAPE.test(a[1])) return null;
    return { loc: a[0], id: a[1] };
  } catch { return null; }
}
export const PAGE = 50;
export const COUNT_CAP = 10_000;
export function cappedWords(n: number, capped: boolean): string { return capped ? `${n.toLocaleString("en-US")}+` : n.toLocaleString("en-US"); }
