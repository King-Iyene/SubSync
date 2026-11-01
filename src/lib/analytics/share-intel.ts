// What goes into a shared audit link. Pure, so it is unit tested: the point is that nothing identifying leaves.
export type ShareFinding = { severity: string; title: string; count: number | null; dollars: number | null; kind: string; fix?: string };
export type SharePayload = {
  who: string; headline: string; accountsScanned: number; staleDollars: number; estimatedDollars: number | null;
  findings: ShareFinding[]; createdAt: string;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Remove every account name from a line of text, so a client or prospect never sees another client's name.
export function scrub(text: string, names: string[]): string {
  let out = text;
  for (const n of [...names].filter((x) => x && x.trim().length >= 2).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(n.trim()), "gi"), "an account");
  }
  return out;
}

export function buildSharePayload(
  audit: { headline: string; accountsScanned: number; staleDollars: number; estimatedDollars: number | null; findings: Array<{ severity: string; title: string; count: number | null; dollars: number | null; kind: string; fix?: string }> },
  who: string, accountNames: string[], now = new Date(),
): SharePayload {
  return {
    who: scrub(who, []).slice(0, 80),
    headline: scrub(audit.headline, accountNames),
    accountsScanned: audit.accountsScanned,
    staleDollars: Math.round(audit.staleDollars),
    estimatedDollars: audit.estimatedDollars === null ? null : Math.round(audit.estimatedDollars),
    findings: audit.findings.filter((f) => f.severity !== "info").slice(0, 8).map((f) => ({ severity: f.severity, title: scrub(f.title, accountNames), count: f.count, dollars: f.dollars, kind: f.kind, ...(f.fix ? { fix: scrub(f.fix, accountNames).slice(0, 300) } : {}) })),
    createdAt: now.toISOString(),
  };
}
