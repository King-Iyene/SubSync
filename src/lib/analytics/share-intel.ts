import { validLogoUrl } from "../brand-logo.ts";
// What goes into a shared audit link. Pure, so it is unit tested: the point is that nothing identifying leaves.
//
// The snapshot holds totals, finding titles, fix steps, the definition of each number, and the sender's own business name and colour. It never holds
// a client account name, a contact, a deal or a conversation: the lists behind the numbers stay in the app. Every field added in stage F6 is optional,
// so a link made before it (and the sample audit) still opens and reads correctly.
export type ShareFinding = { severity: string; title: string; count: number | null; dollars: number | null; kind: string; fix?: string; note?: string; window?: string; /** What is wrong, in a sentence (the rebuilt audit). */ what?: string };
export type ShareNote = { key: string; title: string; text: string };
export type SharePayload = {
  who: string; headline: string; accountsScanned: number; staleDollars: number; estimatedDollars: number | null;
  findings: ShareFinding[]; createdAt: string;
  /** True when the sender has set their own business name, so the page carries only their brand. */
  branded?: boolean;
  /** The sender's colour (#rrggbb), checked before it was stored. */
  brandColor?: string | null;
  /** The sender's logo web address (https, checked). The browser loads it; the page falls back to the name. */
  brandLogoUrl?: string | null;
  /** What to do first, in one sentence. */
  fixFirst?: string | null;
  estimateRange?: { low: number; high: number } | null;
  /** One stalled deal that is at least half of the stalled money. The value only, never the deal. */
  outlier?: { value: number; share: number } | null;
  /** Open deals left out of the dollar figures. */
  leftOut?: number;
  /** The definition of every number on the page, in order; findings point at them by key. */
  notes?: ShareNote[];
  /** The counting rules this snapshot was made under (DEAL_RULES_VERSION), so an old link can be read against the rules of its day. */
  rulesVersion?: number;
  /** The rebuilt audit: why the headline says what it says, the good news, and the one-line grade. All optional, so an older link still opens. */
  verdictSub?: string;
  healthy?: string[];
  grade?: string | null;
};

/** The id of the public sample audit (fictional data, made by scripts/make-sample-audit.ts) that the demo points to. */
export const SAMPLE_AUDIT_ID = "sample-real-estate-team-audit";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Remove every account name from a line of text, so a client or prospect never sees another client's name.
export function scrub(text: string, names: string[]): string {
  let out = text;
  for (const n of [...names].filter((x) => x && x.trim().length >= 2).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(n.trim()), "gi"), "an account");
  }
  return out;
}

export type ShareSource = {
  headline: string; accountsScanned: number; staleDollars: number; estimatedDollars: number | null;
  findings: Array<{ severity: string; title: string; count: number | null; dollars: number | null; kind: string; fix?: string; note?: string; window?: string; what?: string }>;
  fixFirst?: string | null; estimateRange?: { low: number; high: number } | null; outlier?: { value: number; share: number } | null; leftOut?: number;
  notes?: ShareNote[];
  verdictSub?: string; healthy?: string[]; grade?: string | null;
};
export type ShareExtra = { branded?: boolean; brandColor?: string | null; logoUrl?: string | null; rulesVersion?: number };

const HEX = /^#[0-9a-f]{6}$/i;

export function buildSharePayload(audit: ShareSource, who: string, accountNames: string[], now = new Date(), extra: ShareExtra = {}): SharePayload {
  const shared = audit.findings.filter((f) => f.severity !== "info").slice(0, 8);
  const usedNotes = new Set<string>(shared.flatMap((f) => (f.note ? [f.note] : [])));
  // The two headline figures always have a definition; the others only when a finding on the page uses them.
  const notes = (audit.notes ?? []).filter((n) => n.key === "stale" || n.key === "estimate" || n.key === "left_out" || usedNotes.has(n.key));
  return {
    who: scrub(who, []).slice(0, 80),
    headline: scrub(audit.headline, accountNames),
    accountsScanned: audit.accountsScanned,
    staleDollars: Math.round(audit.staleDollars),
    estimatedDollars: audit.estimatedDollars === null ? null : Math.round(audit.estimatedDollars),
    findings: shared.map((f) => ({
      severity: f.severity, title: scrub(f.title, accountNames), count: f.count, dollars: f.dollars, kind: f.kind,
      ...(f.fix ? { fix: scrub(f.fix, accountNames).slice(0, 300) } : {}),
      ...(f.note ? { note: f.note } : {}),
      ...(f.window ? { window: scrub(f.window, accountNames).slice(0, 160) } : {}),
      ...(f.what ? { what: scrub(f.what, accountNames).slice(0, 300) } : {}),
    })),
    createdAt: now.toISOString(),
    ...(extra.branded !== undefined ? { branded: extra.branded } : {}),
    ...(extra.brandColor && HEX.test(extra.brandColor) ? { brandColor: extra.brandColor.toLowerCase() } : {}),
    ...(validLogoUrl(extra.logoUrl) ? { brandLogoUrl: validLogoUrl(extra.logoUrl) } : {}),
    ...(audit.fixFirst ? { fixFirst: scrub(audit.fixFirst, accountNames).slice(0, 400) } : {}),
    ...(audit.estimateRange ? { estimateRange: { low: Math.round(audit.estimateRange.low), high: Math.round(audit.estimateRange.high) } } : {}),
    ...(audit.outlier ? { outlier: { value: Math.round(audit.outlier.value), share: audit.outlier.share } } : {}),
    ...(audit.leftOut ? { leftOut: audit.leftOut } : {}),
    ...(notes.length ? { notes: notes.map((n) => ({ key: n.key, title: n.title, text: scrub(n.text, accountNames).slice(0, 700) })) } : {}),
    ...(audit.verdictSub ? { verdictSub: scrub(audit.verdictSub, accountNames).slice(0, 500) } : {}),
    ...(audit.healthy?.length ? { healthy: audit.healthy.slice(0, 4).map((h) => scrub(h, accountNames).slice(0, 200)) } : {}),
    ...(audit.grade ? { grade: scrub(audit.grade, accountNames).slice(0, 200) } : {}),
    ...(extra.rulesVersion !== undefined ? { rulesVersion: extra.rulesVersion } : {}),
  };
}
