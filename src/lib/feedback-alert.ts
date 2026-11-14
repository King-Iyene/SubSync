// What the platform owner is told about feedback, and when (pure: no database, no sender, so every rule is unit tested).
//
// Defaults (King, 13 Nov 2026): an INSTANT alert only for "I am stuck" (severity blocking, which every problem report is). Ideas, "annoying" notes, suggestions and
// votes send nothing: they appear in the Feedback inbox with a count of new items. An optional daily summary (FEEDBACK_DIGEST=daily, or the owner's switch in the inbox)
// lists counts and the newest five. The owner can widen the instant alerts to "stuck and annoying" or "everything" in the inbox.
// Nothing here sends: src/lib/notifications/feedback-alert-send.ts decides and the gated transports (live switches) deliver.

import { referenceOf, type Severity } from "./feedback.ts";

export const INSTANT_LEVELS = ["stuck", "stuck_annoying", "everything"] as const;
export type InstantLevel = (typeof INSTANT_LEVELS)[number];
export const INSTANT_LABEL: Record<InstantLevel, string> = { stuck: "Only when someone is stuck", stuck_annoying: "Stuck and annoying", everything: "Everything" };

export const TRIAGE_STATUSES = ["new", "seen", "planned", "done", "wontfix"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];
export const isTriageStatus = (v: unknown): v is TriageStatus => (TRIAGE_STATUSES as readonly string[]).includes(v as string);

/** The owner's two choices, from a request body. Anything else is refused. */
export function parseOwnerSettings(body: unknown): { ok: true; value: { digestOn?: boolean; instantLevel?: InstantLevel } } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: { digestOn?: boolean; instantLevel?: InstantLevel } = {};
  if (b.digestOn !== undefined) { if (typeof b.digestOn !== "boolean") return { ok: false, error: "Choose on or off for the daily summary." }; out.digestOn = b.digestOn; }
  if (b.instantLevel !== undefined) { if (!(INSTANT_LEVELS as readonly string[]).includes(b.instantLevel as string)) return { ok: false, error: "Choose which items raise an instant alert." }; out.instantLevel = b.instantLevel as InstantLevel; }
  if (out.digestOn === undefined && out.instantLevel === undefined) return { ok: false, error: "Nothing to change." };
  return { ok: true, value: out };
}

export type AlertEvent = {
  kind: "feedback" | "problem" | "suggestion";
  /** A problem report is always blocking; a suggestion counts as an idea. */
  severity: Severity;
  installationId: string;
  /** The company's name when known (short), otherwise only the short id is shown. */
  company: string | null;
  page: string | null;
  ref: string;
  /** What the person typed. Used for the excerpt only when FEEDBACK_NOTIFY_INCLUDE_TEXT=true. */
  text: string | null;
};

type Env = Record<string, string | undefined>;
export const WINDOW_MS = 10 * 60 * 1000;
export const EXCERPT_MAX = 160;

export const includeText = (env: Env): boolean => env.FEEDBACK_NOTIFY_INCLUDE_TEXT === "true";
export const shortId = (id: string): string => id.slice(0, 8);

/** Instant alerts: does this item raise one at this level? */
export function raisesInstantAlert(level: InstantLevel, ev: Pick<AlertEvent, "kind" | "severity">): boolean {
  if (ev.kind === "problem" || ev.severity === "blocking") return true;
  if (level === "everything") return true;
  return level === "stuck_annoying" && ev.severity === "annoying";
}

/** Is the daily summary on? The owner's switch wins once it has been set; until then FEEDBACK_DIGEST=daily decides. Default off. */
export const digestOn = (env: Env, setting: boolean | null): boolean => (setting === null ? env.FEEDBACK_DIGEST === "daily" : setting);

/** A short, single-line excerpt with anything that looks like an email address or a phone number removed. Never more than 160 characters. */
export function excerptOf(text: string | null): string | null {
  if (!text) return null;
  const clean = text.replace(/[\u0000-\u001f]+/g, " ").replace(/\S+@\S+/g, "[removed]").replace(/\+?\d[\d\s().-]{6,}\d/g, "[removed]").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX - 1)}…` : clean;
}

const cleanName = (n: string | null): string | null => {
  const t = (n ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return t || null;
};

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type Alert = {
  urgent: boolean;
  subject: string;
  text: string;
  html: string;
  /** Exactly what is written to the log in a dry run: kinds and ids, plus the excerpt only when the owner asked for text. */
  record: Record<string, string | number | boolean | null>;
};

/** "New feedback: <kind>, <severity>, from <company>, page <page>" with a link to the inbox. `more` is how many alerts of this severity were held back since the last one. */
export function buildAlert(ev: AlertEvent, o: { env: Env; appUrl: string; more?: number }): Alert {
  const urgent = ev.severity === "blocking";
  const company = cleanName(ev.company) ? `${cleanName(ev.company)} (${shortId(ev.installationId)})` : shortId(ev.installationId);
  const page = ev.page ?? "unknown";
  const excerpt = includeText(o.env) ? excerptOf(ev.text) : null;
  const link = `${o.appUrl.replace(/\/+$/, "")}/app#feedback-owner`;
  const head = `New feedback: ${ev.kind}, ${ev.severity}, from ${company}, page ${page}`;
  const more = o.more && o.more > 0 ? `\n${o.more} more of this kind arrived in the last few minutes; open the inbox to see them.` : "";
  const subject = `${urgent ? "[URGENT] " : ""}${head}`;
  const text = `${urgent ? "URGENT: someone is stuck.\n" : ""}${head}\nReference ${ev.ref}${excerpt ? `\n"${excerpt}"` : ""}${more}\nOpen the Feedback inbox: ${link}`;
  const html = `<p>${urgent ? "<strong>URGENT: someone is stuck.</strong><br>" : ""}${escapeHtml(head)}<br>Reference ${escapeHtml(ev.ref)}${excerpt ? `<br><em>${escapeHtml(excerpt)}</em>` : ""}${more ? `<br>${escapeHtml(more.trim())}` : ""}</p><p><a href="${escapeHtml(link)}">Open the Feedback inbox</a></p>`;
  return { urgent, subject, text, html, record: { kind: ev.kind, severity: ev.severity, company: shortId(ev.installationId), page: ev.page, urgent, ref: ev.ref, excerpt, more: o.more ?? 0 } };
}

export type AlertState = { lastAlertAt: Date | null; suppressed: number; lastRef: string | null };

/** One alert per severity per ten minutes: the first goes at once, the rest are counted and mentioned in the next one. The same item never alerts twice. */
export function rateDecision(state: AlertState, ref: string, now: Date): { send: boolean; reason: "ok" | "duplicate" | "held" } {
  if (state.lastRef === ref) return { send: false, reason: "duplicate" };
  if (state.lastAlertAt && now.getTime() - state.lastAlertAt.getTime() < WINDOW_MS) return { send: false, reason: "held" };
  return { send: true, reason: "ok" };
}

export type DigestRow = { ref: string; kind: string; severity: string; title: string; at: string };

/** The daily summary: counts by kind and severity and the newest five (an excerpt of each only when FEEDBACK_NOTIFY_INCLUDE_TEXT=true, otherwise the reference). */
export function buildDigest(rows: readonly DigestRow[], o: { env: Env; appUrl: string }): { subject: string; text: string; html: string; record: Record<string, unknown>; empty: boolean } {
  const counts: Record<string, number> = {};
  for (const r of rows) { const k = `${r.kind}/${r.severity}`; counts[k] = (counts[k] ?? 0) + 1; }
  const newest = [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const withText = includeText(o.env);
  const line = (r: DigestRow) => `${r.ref} (${r.kind}, ${r.severity})${withText ? `: ${excerptOf(r.title) ?? ""}` : ""}`;
  const countLine = Object.entries(counts).sort().map(([k, n]) => `${k}: ${n}`).join("; ") || "nothing new";
  const link = `${o.appUrl.replace(/\/+$/, "")}/app#feedback-owner`;
  const subject = `Feedback summary: ${rows.length} new in the last day`;
  const text = `${subject}\n${countLine}\n${newest.map(line).join("\n")}\nOpen the Feedback inbox: ${link}`;
  const html = `<p>${escapeHtml(subject)}<br>${escapeHtml(countLine)}</p><ul>${newest.map((r) => `<li>${escapeHtml(line(r))}</li>`).join("")}</ul><p><a href="${escapeHtml(link)}">Open the Feedback inbox</a></p>`;
  return { subject, text, html, record: { total: rows.length, counts, newest: newest.map((r) => (withText ? { ref: r.ref, excerpt: excerptOf(r.title) } : { ref: r.ref })) }, empty: rows.length === 0 };
}

export { referenceOf };

/** Who is the platform owner: an agency session whose company id or sign-in email is on the allowlist (PLATFORM_OWNER_COMPANY_IDS, PLATFORM_OWNER_EMAILS). Anyone else: false. */
export function isPlatformOwner(who: { kind: string; companyId: string | null; email?: string | null }, env: Env): boolean {
  if (who.kind !== "agency") return false;
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ids = list(env.PLATFORM_OWNER_COMPANY_IDS);
  const emails = list(env.PLATFORM_OWNER_EMAILS);
  if (who.companyId && ids.includes(who.companyId.trim().toLowerCase())) return true;
  return Boolean(who.email && emails.includes(who.email.trim().toLowerCase()));
}
