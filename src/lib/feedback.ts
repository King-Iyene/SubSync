// "Give feedback", "Report a problem" and "Suggest something" (N86, N87): the rules for what is accepted, kept pure so they are unit tested.
//
// Nothing here is sent anywhere. Each item writes a line to the audit log with ids only (never the message text, never an address). Telling the platform owner is
// decided by src/lib/feedback-alert.ts and delivered through the gated transports (SEND_EMAIL_LIVE, SEND_SLACK_LIVE): see docs/FEEDBACK.md. This file must not
// import anything that sends (a test reads the source to be sure).

export const FEEDBACK_MAX = 2000;
export const SUGGEST_TITLE_MAX = 120;
export const SUGGEST_DETAILS_MAX = 1000;
/** A person may send this many in a day. Enough for real use, small enough that a loop cannot fill the table. */
export const DAILY_LIMIT = 20;

export const SEVERITIES = ["idea", "annoying", "blocking"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { idea: "An idea", annoying: "Something annoying", blocking: "I am stuck" };

export const IMPORTANCE = ["nice", "important", "critical"] as const;
export type Importance = (typeof IMPORTANCE)[number];
export const IMPORTANCE_LABEL: Record<Importance, string> = { nice: "Nice to have", important: "Important to me", critical: "I need this to keep using SubSync" };

/** The same kind of key the roadmap votes and saved views use: who, by kind, account and sign-in id. Made on the server from the signed session. */
export const personKey = (kind: string, limitTo: string | null, userId: string | null | undefined): string => `${kind}:${limitTo ?? "agency"}:${userId ?? ""}`;

/** A page the person was on, as a menu id. Anything else is stored as nothing (never free text from the address bar). */
const PAGE = /^[a-z][a-z-]{1,24}$/;
export const cleanPage = (v: unknown): string | null => (typeof v === "string" && PAGE.test(v) ? v : null);

/** An error ID as shown by the error state ("E-" plus letters and digits) or sent by the server. */
const ERROR_ID = /^[A-Za-z0-9-]{4,24}$/;
export const cleanErrorId = (v: unknown): string | null => (typeof v === "string" && ERROR_ID.test(v.trim()) ? v.trim() : null);

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  return t.length > 0 && t.length <= max ? t : null;
};

export type FeedbackInput = { message: string; page: string | null; severity: Severity };
export type ProblemInput = { message: string; page: string | null; errorId: string | null };
export type SuggestionInput = { title: string; details: string | null; importance: Importance; page: string | null };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseFeedback(body: unknown): Parsed<FeedbackInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const message = text(b.message, FEEDBACK_MAX);
  if (!message) return { ok: false, error: `Write a few words (up to ${FEEDBACK_MAX} characters) about what to add or change.` };
  const severity = (SEVERITIES as readonly string[]).includes(b.severity as string) ? (b.severity as Severity) : "idea";
  return { ok: true, value: { message, page: cleanPage(b.page), severity } };
}

export function parseProblem(body: unknown): Parsed<ProblemInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const message = text(b.message, FEEDBACK_MAX);
  if (!message) return { ok: false, error: `Say what went wrong, in a few words (up to ${FEEDBACK_MAX} characters).` };
  return { ok: true, value: { message, page: cleanPage(b.page), errorId: cleanErrorId(b.errorId) } };
}

export function parseSuggestion(body: unknown): Parsed<SuggestionInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = text(b.title, SUGGEST_TITLE_MAX);
  if (!title) return { ok: false, error: `Give the idea a short title (up to ${SUGGEST_TITLE_MAX} characters).` };
  const details = b.details === undefined || b.details === null || b.details === "" ? null : text(b.details, SUGGEST_DETAILS_MAX);
  if (b.details && !details) return { ok: false, error: `Keep the details to ${SUGGEST_DETAILS_MAX} characters.` };
  const importance = (IMPORTANCE as readonly string[]).includes(b.importance as string) ? (b.importance as Importance) : "nice";
  return { ok: true, value: { title, details, importance, page: cleanPage(b.page) } };
}

/** A short reference a person can quote ("R-4F2A9C"), made from the stored id. Not secret. */
export const referenceOf = (id: string): string => `R-${id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()}`;

export type NotifyEvent = "feedback" | "problem" | "suggestion" | "vote" | "shipped";

/**
 * The detail of the audit line that stands in for the message to King. Ids and kinds only: no message text, no title, no address, no name.
 * "WOULD SEND" is literal: it is what the audit trail and the tests look for. The delivery itself belongs to the dispatcher (stage F9).
 */
export function wouldSendDetail(event: NotifyEvent, ids: Record<string, string | number | null>): Record<string, unknown> {
  const clean: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(ids)) clean[k] = typeof v === "string" ? v.slice(0, 64) : v;
  return {
    outward: "RECORDED for the owner inbox (an alert goes out only by the owner's rules, and only through the live switches)",
    to: "king",
    event,
    channel: event === "problem" ? "instant alert (someone is stuck)" : "inbox, and the optional daily summary",
    ...clean,
  };
}

/** For "notify voters when it ships": one dry-run line per company that voted, counting voters. Never a name. */
export function shippedNoticePlan(votes: ReadonlyArray<{ installationId: string; voter: string }>): Array<{ installationId: string; voters: number }> {
  const by = new Map<string, Set<string>>();
  for (const v of votes) { const s = by.get(v.installationId) ?? new Set<string>(); s.add(v.voter); by.set(v.installationId, s); }
  return [...by.entries()].map(([installationId, s]) => ({ installationId, voters: s.size })).sort((a, b) => a.installationId.localeCompare(b.installationId));
}

export type VoteRow = { itemKey: string; installationId: string; kind: string };
/** The daily digest of votes for King: per item, how many votes and from how many companies, and by kind of account. */
export function voteDigest(rows: readonly VoteRow[]): Array<{ itemKey: string; votes: number; companies: number; byKind: Record<string, number> }> {
  const items = new Map<string, { votes: number; companies: Set<string>; byKind: Record<string, number> }>();
  for (const r of rows) {
    const it = items.get(r.itemKey) ?? { votes: 0, companies: new Set<string>(), byKind: {} };
    it.votes++; it.companies.add(r.installationId); it.byKind[r.kind] = (it.byKind[r.kind] ?? 0) + 1;
    items.set(r.itemKey, it);
  }
  return [...items.entries()].map(([itemKey, v]) => ({ itemKey, votes: v.votes, companies: v.companies.size, byKind: v.byKind })).sort((a, b) => b.votes - a.votes || a.itemKey.localeCompare(b.itemKey));
}
