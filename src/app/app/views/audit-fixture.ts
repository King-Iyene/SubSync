import { auditSummaryV2, buildAuditV2, healthyLines, type AuditAccount } from "@/lib/analytics/audit-v2";
import { clientRows, pageClients } from "@/lib/analytics/audit-clients";
import { SAMPLE_HISTORY } from "@/lib/analytics/au-history";
import type { TodayItem } from "@/lib/analytics/today-queue";

// The whole Account audit screen as sample data, used ONLY with ?aufx=1 (the screen labels it "Sample data"). Fictional clients and people, built with the real pure
// rules so the sentence, the findings and the clients add up. The real path never imports this.
export function sampleAudit() {
  const now = Date.now(), D = 86_400_000;
  const acc = (id: string, name: string, over: Partial<AuditAccount> = {}): AuditAccount => ({ id, name, winRate: 0.25, avgDeal: 3500, won: 12, lost: 36, ...over });
  const accounts = [acc("s1", "Sample Dental"), acc("s2", "Sample Roofing"), acc("s3", "Sample Realty", { won: 3, lost: 4 }), acc("s4", "Sample Fitness")];
  const item = (kind: TodayItem["kind"], loc: string, n: number, value: number | null = null): TodayItem => ({
    id: `${kind}:${loc}:${n}`, kind, locationId: loc, accountName: accounts.find((a) => a.id === loc)!.name, name: `Customer ${n}`, detail: kind === "stale" ? `$${value} in Proposal, no change for 41 days` : "Sample row", at: now - 40 * D, value, contactId: `sc${n}`, url: "#",
  });
  const lead = (loc: string, n: number) => ({ locationId: loc, accountName: accounts.find((a) => a.id === loc)!.name, contactId: `sc${n}`, name: `Customer ${n}`, at: now - 9 * 3_600_000, never: n % 2 === 0, url: "#", owner: null, source: null, detail: "Waiting 9 hours" });
  const audit = buildAuditV2({
    now, staleDays: 30, slaHours: 4, scope: "all", accounts,
    stale: { items: [item("stale", "s1", 1, 8200), item("stale", "s2", 2, 5400), item("stale", "s4", 3, 2100)], total: 3, totalValue: 15_700 },
    waiting: { leads: [lead("s1", 11), lead("s1", 12), lead("s2", 13), lead("s3", 14), lead("s4", 15)], leadsTotal: 5, conversations: [], conversationsTotal: 0 },
    noshows: { items: [item("noshows", "s2", 21), item("noshows", "s3", 22)], total: 2 }, appointments: { items: [item("appointments", "s1", 31), item("appointments", "s4", 32)], total: 2 },
  });
  const healthy = healthyLines({ scope: "all", leadsInTarget: { share: 0.82, judged: 40, minutes: 15 }, showRate: { rate: 0.71, outcomes: 28, target: 0.7 }, openValue: 120_000, staleValue: 15_700, clean: { replies: false, stale: false, noshows: false, appointments: false } });
  const rows = clientRows(audit, accounts);
  return {
    verdict: audit.verdict, grade: audit.grade, startHere: audit.startHere, totals: audit.totals, notes: audit.notes, healthy,
    progress: [], reading: { reading: false, done: 4, total: 4, text: "" }, findings: audit.findings,
    clients: { ...pageClients(rows, { q: "", sort: "money", page: 0, size: 5 }), sort: "money", withProblems: rows.length, clean: accounts.length - rows.length, accounts: accounts.length },
    summary: auditSummaryV2(audit, "Sample company", healthy), scope: "all" as const, staleDays: 30, slaHours: 4, targetMinutes: 15, readLimit: null, now,
    brand: { name: null, color: null, logoUrl: null }, generatedAt: new Date(now).toISOString(), hiddenAccounts: 0, focus: null, canShare: false, demo: true, shareDays: 14,
    history: { ...SAMPLE_HISTORY, thenNow: { ...SAMPLE_HISTORY.thenNow!, lines: SAMPLE_HISTORY.thenNow!.lines.map((l) => { const c = audit.findings.find((x) => x.key === l.key)?.count ?? 0; return { ...l, now: c, change: c - (l.then ?? 0), tone: c < (l.then ?? 0) ? ("better" as const) : c > (l.then ?? 0) ? ("worse" as const) : ("same" as const) }; }) } }, au: { history: true, onepager: true, monthly: true },
  };
}
