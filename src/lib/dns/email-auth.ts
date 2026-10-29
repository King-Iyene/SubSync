import { promises as dns } from "node:dns";

// Email authentication checks (SPF, DKIM, DMARC, MX) for a sending domain, with plain-English
// findings. Based on the Gmail/Yahoo bulk-sender rules: SPF or DKIM for everyone, and SPF +
// DKIM + DMARC for senders above 5,000 messages a day. Parsing is pure and unit tested; the
// resolver is injected.

export type DnsResolver = {
  txt(name: string): Promise<string[]>;
  mx(name: string): Promise<Array<{ exchange: string; priority: number }>>;
};

export type Severity = "critical" | "warning" | "info" | "good";
export type Finding = { severity: Severity; area: "spf" | "dkim" | "dmarc" | "mx"; message: string; fix?: string };

export type SpfResult = {
  found: boolean;
  record: string | null;
  all: "-all" | "~all" | "?all" | "+all" | null;
  lookups: number;
  issues: string[];
};

export type DmarcResult = {
  found: boolean;
  record: string | null;
  policy: "none" | "quarantine" | "reject" | null;
  pct: number;
  reporting: boolean;
};

export type DomainReport = {
  domain: string;
  status: "ok" | "warning" | "critical";
  spf: SpfResult;
  dkim: { found: boolean; selector: string | null; revoked: boolean };
  dmarc: DmarcResult;
  mx: { found: boolean; hosts: string[] };
  findings: Finding[];
};

export const DEFAULT_DKIM_SELECTORS = [
  "default", "google", "selector1", "selector2", "k1", "k2", "k3", "s1", "s2",
  "mandrill", "mg", "mta", "smtp", "email", "dkim", "mail", "zoho", "cm", "everlytic", "krs",
];

export function extractDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (v.includes("@")) v = v.split("@").pop() ?? "";
  v = v.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v) ? v : null;
}

const spfTerms = (record: string) => record.trim().split(/\s+/).slice(1);

export function parseSpf(records: string[]): SpfResult {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  const issues: string[] = [];
  if (spf.length === 0) return { found: false, record: null, all: null, lookups: 0, issues };
  if (spf.length > 1) issues.push("More than one SPF record is published, which makes SPF fail");
  const record = spf[0].trim();
  let lookups = 0;
  let all: SpfResult["all"] = null;
  for (const raw of spfTerms(record)) {
    const term = raw.toLowerCase();
    const m = term.match(/^([+\-~?]?)all$/);
    if (m) {
      all = ((m[1] || "+") + "all") as SpfResult["all"];
      continue;
    }
    if (/^[+\-~?]?(include:|a(:|\/|$)|mx(:|\/|$)|ptr|exists:)/.test(term) || term.startsWith("redirect=")) lookups++;
  }
  if (lookups > 10) issues.push(`SPF needs ${lookups} DNS lookups; the limit is 10, so it will return a permanent error`);
  return { found: true, record, all, lookups, issues };
}

export function parseDmarc(records: string[]): DmarcResult {
  const rec = records.map((r) => r.trim()).find((r) => /^v=dmarc1\b/i.test(r));
  if (!rec) return { found: false, record: null, policy: null, pct: 100, reporting: false };
  const tags = Object.fromEntries(
    rec.split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
    }),
  );
  const policy = (["none", "quarantine", "reject"] as const).find((p) => p === (tags.p ?? "").toLowerCase()) ?? null;
  const pct = Number.isFinite(Number(tags.pct)) && tags.pct !== undefined ? Number(tags.pct) : 100;
  return { found: true, record: rec, policy, pct, reporting: Boolean(tags.rua) };
}

export function parseDkim(records: string[]): { found: boolean; revoked: boolean } {
  const rec = records.map((r) => r.trim()).find((r) => /(^|;)\s*(v=dkim1|k=|p=)/i.test(r));
  if (!rec) return { found: false, revoked: false };
  const p = rec.match(/(?:^|;)\s*p=([^;]*)/i);
  return { found: true, revoked: p !== null && p[1].trim() === "" };
}

export function buildFindings(r: Omit<DomainReport, "status" | "findings">): Finding[] {
  const f: Finding[] = [];
  // SPF
  if (!r.spf.found) {
    f.push({ severity: "critical", area: "spf", message: "No SPF record", fix: "Publish a TXT record such as v=spf1 include:<your sending service> ~all" });
  } else {
    for (const issue of r.spf.issues) f.push({ severity: "critical", area: "spf", message: issue, fix: "Keep one SPF record under 10 lookups" });
    if (r.spf.all === "+all") f.push({ severity: "critical", area: "spf", message: "SPF ends in +all, which lets anyone send as this domain", fix: "End the record with ~all or -all" });
    else if (r.spf.all === "?all") f.push({ severity: "warning", area: "spf", message: "SPF ends in ?all, which gives no protection", fix: "End the record with ~all or -all" });
    else if (r.spf.all === null) f.push({ severity: "warning", area: "spf", message: "SPF has no all mechanism", fix: "End the record with ~all or -all" });
    else if (r.spf.issues.length === 0) f.push({ severity: "good", area: "spf", message: `SPF is published (${r.spf.all}, ${r.spf.lookups} lookups)` });
  }
  // DKIM
  if (r.dkim.revoked) f.push({ severity: "critical", area: "dkim", message: `DKIM key for selector "${r.dkim.selector}" is revoked (empty)`, fix: "Publish a valid DKIM public key" });
  else if (!r.dkim.found) f.push({ severity: "warning", area: "dkim", message: "No DKIM record found on the common selectors", fix: "Confirm DKIM is set up in your sending service; custom selectors cannot be detected automatically" });
  else f.push({ severity: "good", area: "dkim", message: `DKIM found (selector "${r.dkim.selector}")` });
  // DMARC
  if (!r.dmarc.found) {
    f.push({ severity: "critical", area: "dmarc", message: "No DMARC record", fix: "Publish _dmarc TXT: v=DMARC1; p=none; rua=mailto:you@yourdomain.com. Gmail and Yahoo require DMARC for senders above 5,000 messages a day" });
  } else if (r.dmarc.policy === null) {
    f.push({ severity: "warning", area: "dmarc", message: "DMARC record has no valid p= policy", fix: "Set p=none, p=quarantine or p=reject" });
  } else if (r.dmarc.policy === "none") {
    f.push({ severity: "warning", area: "dmarc", message: "DMARC is in monitoring mode (p=none), so spoofed mail is not blocked", fix: "Move to p=quarantine, then p=reject, once reports look clean" });
  } else if (r.dmarc.pct < 100) {
    f.push({ severity: "info", area: "dmarc", message: `DMARC policy ${r.dmarc.policy} applies to only ${r.dmarc.pct}% of mail` });
  } else {
    f.push({ severity: "good", area: "dmarc", message: `DMARC enforced (p=${r.dmarc.policy})` });
  }
  if (r.dmarc.found && !r.dmarc.reporting) f.push({ severity: "info", area: "dmarc", message: "No DMARC reporting address (rua), so you will not see who sends as this domain" });
  // MX
  if (!r.mx.found) f.push({ severity: "info", area: "mx", message: "No MX records, so replies to this domain cannot be delivered" });
  return f;
}

export function statusOf(findings: Finding[]): DomainReport["status"] {
  if (findings.some((x) => x.severity === "critical")) return "critical";
  if (findings.some((x) => x.severity === "warning")) return "warning";
  return "ok";
}

export async function checkDomain(
  domain: string,
  resolver: DnsResolver = defaultResolver(),
  selectors: string[] = DEFAULT_DKIM_SELECTORS,
): Promise<DomainReport> {
  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };
  const [apex, dmarcTxt, mx, dkimResults] = await Promise.all([
    safe(resolver.txt(domain), [] as string[]),
    safe(resolver.txt(`_dmarc.${domain}`), [] as string[]),
    safe(resolver.mx(domain), [] as Array<{ exchange: string; priority: number }>),
    Promise.all(selectors.map(async (s) => ({ s, txt: await safe(resolver.txt(`${s}._domainkey.${domain}`), [] as string[]) }))),
  ]);

  let dkim = { found: false, selector: null as string | null, revoked: false };
  for (const { s, txt } of dkimResults) {
    const parsed = parseDkim(txt);
    if (parsed.found) {
      dkim = { found: true, selector: s, revoked: parsed.revoked };
      break;
    }
  }
  const base = {
    domain,
    spf: parseSpf(apex),
    dkim,
    dmarc: parseDmarc(dmarcTxt),
    mx: { found: mx.length > 0, hosts: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange) },
  };
  const findings = buildFindings(base);
  return { ...base, status: statusOf(findings), findings };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS lookup timed out")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function defaultResolver(timeoutMs = 4000): DnsResolver {
  return {
    async txt(name) {
      const records = await withTimeout(dns.resolveTxt(name), timeoutMs);
      // A TXT record can be split into several strings; join them as DNS clients do.
      return records.map((chunks) => chunks.join(""));
    },
    async mx(name) {
      return withTimeout(dns.resolveMx(name), timeoutMs);
    },
  };
}
