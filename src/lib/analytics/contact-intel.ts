// Contact and lead intelligence (spec section 3). The pure parts: scoring, validation and tag
// clean-up. Heavy counting happens in SQL (contact-queries.ts) so large agencies stay fast.

const DAY = 86_400_000;
const days = (ms: number) => Math.max(0, Math.floor(ms / DAY));

// ---------------- data quality (3.15) ----------------

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mintemail.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  return e.length <= 254 && EMAIL_RE.test(e) && !e.includes("..") && !/^\./.test(e.split("@")[0]);
}

export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!isValidEmail(email)) return false;
  return DISPOSABLE.has((email as string).trim().toLowerCase().split("@")[1]);
}

// E.164 allows up to 15 digits; fewer than 7 cannot be a real number.
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  return !/^(\d)\1+$/.test(digits); // 0000000, 1111111...
}

export function emailProblem(email: string | null | undefined): "invalid" | "disposable" | null {
  if (!email) return null;
  if (!isValidEmail(email)) return "invalid";
  return isDisposableEmail(email) ? "disposable" : null;
}

// ---------------- tags (3.11) ----------------

export function normaliseTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Tags that differ only by case, spacing or punctuation ("Hot Lead", "hot-lead", "hot_lead").
export function tagVariants(counts: Array<{ tag: string; count: number }>) {
  const groups = new Map<string, Array<{ tag: string; count: number }>>();
  for (const t of counts) {
    const key = normaliseTag(t.tag);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ variants: g.sort((a, b) => b.count - a.count), total: g.reduce((s, t) => s + t.count, 0) }))
    .sort((a, b) => b.total - a.total);
}

// ---------------- lead quality (3.4) ----------------

export type LeadFacts = {
  email: string | null;
  phone: string | null;
  tags: string[];
  dateAdded: number | null;
  lastActivityAt: number | null;
  hasOpenDeal: boolean;
  openDealValue: number;
  hasWonDeal: boolean;
  hasLostDeal: boolean;
};

export type LeadScore = { score: number; reasons: string[] };

// 0 to 100, from things we can see: can we reach them, are they engaged, is there a deal.
// Customers (a won deal) are not leads, so they score 0 here and show in other views.
export function leadScore(f: LeadFacts, now: number): LeadScore {
  if (f.hasWonDeal) return { score: 0, reasons: ["Already a customer"] };
  const reasons: string[] = [];
  let score = 0;
  if (isValidEmail(f.email)) { score += 15; reasons.push("Has a valid email"); }
  if (isValidPhone(f.phone)) { score += 10; reasons.push("Has a valid phone"); }
  if (f.tags.length > 0) score += 5;
  const idle = f.lastActivityAt === null ? null : days(now - f.lastActivityAt);
  if (idle !== null) {
    if (idle <= 7) { score += 30; reasons.push("Active this week"); }
    else if (idle <= 30) { score += 20; reasons.push("Active this month"); }
    else if (idle <= 90) score += 8;
  }
  if (f.hasOpenDeal) {
    score += 25;
    reasons.push("Has an open deal");
    if (f.openDealValue > 0) score += 10;
  } else if (f.hasLostDeal) score -= 10;
  const age = f.dateAdded === null ? null : days(now - f.dateAdded);
  if (age !== null && age <= 14) { score += 5; reasons.push("New this fortnight"); }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ---------------- lifecycle (3.5) ----------------

export type Lifecycle = "lead" | "opportunity" | "customer" | "lost";

export function lifecycleOf(f: Pick<LeadFacts, "hasOpenDeal" | "hasWonDeal" | "hasLostDeal">): Lifecycle {
  if (f.hasWonDeal) return "customer";
  if (f.hasOpenDeal) return "opportunity";
  if (f.hasLostDeal) return "lost";
  return "lead";
}

// ---------------- VIP (3.18) ----------------

export type VipFacts = { wonValue: number; openValue: number; wonCount: number; lastActivityAt: number | null };

export function vipScore(f: VipFacts): number {
  return f.wonValue * 1 + f.openValue * 0.5 + f.wonCount * 100;
}

export function daysIdle(lastActivityAt: number | null, now: number): number | null {
  return lastActivityAt === null ? null : days(now - lastActivityAt);
}

// ---------------- cold lists (N45) ----------------

/** A tag that looks like a bought, scraped or cold-outreach list: its contacts never asked to hear from you, so they are not working leads. */
const COLD_TAG_RE = /(^|[^a-z])(cold|outreach|scrap(e|ed|ing)|purchased|bought|list ?import|lead ?list|prospecting list)([^a-z]|$)/i;
export const suggestColdTag = (tag: string): boolean => COLD_TAG_RE.test(tag);

export type ColdTag = { tag: string; source: "owner" | "name" };

/** The tags treated as cold lists: the owner's choice when one was made (even an empty one), else the suggestion made from the tag names. */
export function effectiveColdTags(allTags: string[], chosen: string[] | null): ColdTag[] {
  if (chosen !== null) {
    const known = new Set(allTags.map((t) => t.toLowerCase()));
    return chosen.filter((t) => known.has(t.toLowerCase())).map((tag) => ({ tag, source: "owner" as const }));
  }
  return allTags.filter(suggestColdTag).map((tag) => ({ tag, source: "name" as const }));
}

// ---------------- what a contact has done (N45) ----------------

/**
 * Where a contact stands, from signals SubSync can really see: the customer wrote last in a conversation, an appointment, a deal.
 * "never" means none of those was seen, which is not the same as "never replied": only the newest conversations of each account are read.
 */
export type Engagement = "engaged_recently" | "engaged_then_quiet" | "none_seen";
export const QUIET_AFTER_DAYS = 90;
export function engagementOf(lastSignalMs: number | null, now: number): Engagement {
  if (lastSignalMs === null) return "none_seen";
  return now - lastSignalMs > QUIET_AFTER_DAYS * 86_400_000 ? "engaged_then_quiet" : "engaged_recently";
}

// ---------------- where leads come from (N47) ----------------

export type SourceKind = "meta" | "portal" | "form" | "social" | "other" | "none";
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  meta: "Facebook or Instagram lead form", portal: "Property site, call or walk-in", form: "Web form, ads or website chat", social: "A message (DM, Messenger, WhatsApp)",
  other: "Something else you typed", none: "No source recorded",
};

export type SourceInput = { source: string; contacts: number; new30: number; won: number; wonValue: number };

const sourceKind = (source: string): SourceKind => {
  const s = source.trim().toLowerCase();
  if (s === "" || s === "unknown" || s === "none" || s === "n/a") return "none";
  if (/zillow|realtor|trulia|redfin|homes\.com|rightmove|zoopla|portal|open house|call|phone|sign|walk/.test(s)) return "portal";
  if (/\b(dm|dms|messenger|whatsapp|tiktok|linkedin|direct message|social)\b/.test(s)) return "social";
  if (/facebook|instagram|\bfb\b|\big\b|\bmeta\b|lead ad/.test(s)) return "meta";
  if (/form|website|web|landing|funnel|ppc|google|chat|widget|email/.test(s)) return "form";
  return "other";
};

/** The share of contacts with no source, the contacts grouped by the kind of source, and, when most have none, what to do about it. */
export function sourceSummary(rows: SourceInput[]) {
  const total = rows.reduce((s, r) => s + r.contacts, 0);
  const kinds = new Map<SourceKind, { contacts: number; won: number; wonValue: number; new30: number }>();
  for (const r of rows) {
    const k = sourceKind(r.source);
    const cur = kinds.get(k) ?? { contacts: 0, won: 0, wonValue: 0, new30: 0 };
    kinds.set(k, { contacts: cur.contacts + r.contacts, won: cur.won + r.won, wonValue: cur.wonValue + r.wonValue, new30: cur.new30 + r.new30 });
  }
  const none = kinds.get("none")?.contacts ?? 0;
  const nonePct = total > 0 ? Math.round((none / total) * 100) : null;
  const grouped = [...kinds.entries()].map(([kind, v]) => ({ kind, label: SOURCE_KIND_LABEL[kind], ...v })).sort((a, b) => b.contacts - a.contacts);
  return {
    total, noSource: none, noSourcePct: nonePct, kinds: grouped,
    // Only an action when it is the majority and there are enough contacts for that to mean something.
    action: total >= 20 && nonePct !== null && nonePct >= 50
      ? { headline: `${nonePct}% of your contacts have no source recorded, so you cannot tell which marketing brings customers.`, steps: ["Open one recent lead in your CRM and check its Source field. If it is empty, the form, ad or funnel that created it is not setting one.", "Make every lead form, ad and funnel set a source, and give every imported list a Source column.", "Come back in a week: new contacts will be sorted by where they came from here."] }
      : null,
  };
}

// ---------------- data quality: checked, missing, invalid (N46) ----------------

export type QualityFigure = { state: "checked"; value: number; of: number } | { state: "not_checked"; reason: string };

/**
 * A zero is only a zero when the check could run. "Invalid" is judged on the values that exist, so it needs some; "missing" is a different thing
 * (a contact with no email is not a contact with a bad one). Before the contacts have been read, nothing is checked.
 */
export function qualityFigures(q: { total: number; withEmail: number; withPhone: number; badEmail: number; disposable: number; badPhone: number }, contactsRead: boolean) {
  const none = (reason: string): QualityFigure => ({ state: "not_checked", reason });
  const checked = (value: number, of: number): QualityFigure => ({ state: "checked", value, of });
  const unread = !contactsRead || q.total === 0;
  const noEmails = !unread && q.withEmail === 0;
  const noPhones = !unread && q.withPhone === 0;
  return {
    total: q.total,
    invalidEmails: unread ? none("The contacts have not been read yet") : noEmails ? none("No contact has an email address to check") : checked(q.badEmail, q.withEmail),
    disposableEmails: unread ? none("The contacts have not been read yet") : noEmails ? none("No contact has an email address to check") : checked(q.disposable, q.withEmail),
    invalidPhones: unread ? none("The contacts have not been read yet") : noPhones ? none("No contact has a phone number to check") : checked(q.badPhone, q.withPhone),
    missingEmails: unread ? none("The contacts have not been read yet") : checked(q.total - q.withEmail, q.total),
    missingPhones: unread ? none("The contacts have not been read yet") : checked(q.total - q.withPhone, q.total),
    // kept for the older screens that add the three bad-value counts together
    badEmail: q.badEmail, disposable: q.disposable, badPhone: q.badPhone,
  };
}
