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
