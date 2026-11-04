import { MIN_CONTACTS, RULES, flagsOf, type DhContact, type RuleId, type Settings } from "./rules.ts";

export type Component = { id: RuleId; label: string; plain: string; count: number; share: number; penalty: number; weight: number };
export type ScoreResult = {
  score: number | null; total: number; components: Component[]; why: string; band: "good" | "fair" | "poor" | null;
  flags: Array<{ contactId: string; rule: RuleId }>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Score = 100 minus, for each rule, its weight times min(1, flagged share / the rule's cap). Fewer than MIN_CONTACTS contacts: no score, in words. */
export function scoreAccount(contacts: DhContact[], dupExtras: Set<string>, ignored: Set<string>, s: Settings, now: number): ScoreResult {
  const live = contacts.filter((c) => !ignored.has(c.contactId));
  const flags: ScoreResult["flags"] = [];
  const counts = new Map<RuleId, number>();
  for (const c of live) for (const r of flagsOf(c, dupExtras.has(c.contactId), s, now)) { flags.push({ contactId: c.contactId, rule: r }); counts.set(r, (counts.get(r) ?? 0) + 1); }
  const total = live.length;
  const components: Component[] = RULES.map((r) => {
    const count = counts.get(r.id) ?? 0, share = total ? count / total : 0;
    return { id: r.id, label: r.label, plain: r.plain, count, share, weight: r.weight, penalty: round1(r.weight * Math.min(1, share / r.cap)) };
  });
  if (total < MIN_CONTACTS) return { score: null, total, components, why: `Not enough data yet: this account has ${total} contacts and a score needs at least ${MIN_CONTACTS}.`, band: null, flags };
  const score = Math.max(0, Math.min(100, Math.round(100 - components.reduce((a, c) => a + c.penalty, 0))));
  return { score, total, components, why: whyOf(score, components), band: score >= 85 ? "good" : score >= 65 ? "fair" : "poor", flags };
}

export function whyOf(score: number, comps: Component[]): string {
  const top = [...comps].filter((c) => c.penalty > 0).sort((a, b) => b.penalty - a.penalty).slice(0, 2);
  if (top.length === 0) return `${score} out of 100. Nothing to fix right now.`;
  const w = (c: Component) => `${c.label.toLowerCase()} (${c.count})`;
  return `${score} out of 100. Most points were lost to ${top.map(w).join(" and ")}.`;
}

/** A coarse group for comparing like with like: size only plus an optional industry word. No identifier ever goes into it. */
export function bucketOf(total: number, industry: string | null): string {
  const size = total < 500 ? "under 500 contacts" : total < 2000 ? "500 to 2,000 contacts" : total < 10000 ? "2,000 to 10,000 contacts" : "over 10,000 contacts";
  const ind = (industry ?? "").trim().toLowerCase().replace(/[^a-z ]/g, "").slice(0, 30);
  return ind ? `${ind} | ${size}` : size;
}
export const BENCH_MIN_ACCOUNTS = 10;
export const BENCH_MIN_COMPANIES = 3;
export function benchmarkLine(mine: number | null, b: { n: number; companies: number; p25: number; median: number; p75: number } | null, bucket: string): string | null {
  if (mine === null || !b || b.n < BENCH_MIN_ACCOUNTS || b.companies < BENCH_MIN_COMPANIES) return null;
  const pos = mine >= b.p75 ? "in the top quarter" : mine >= b.median ? "above the middle" : mine >= b.p25 ? "below the middle" : "in the bottom quarter";
  return `Your score is ${pos} of ${b.n} accounts like yours (${bucket}). The middle score there is ${Math.round(b.median)}.`;
}

/** One line per day: the average score of the accounts that had a score that day. */
export function averageSeries(snaps: Array<{ day: string; score: number | null }>): Array<{ day: string; score: number | null }> {
  const by = new Map<string, { sum: number; n: number }>();
  for (const s of snaps) if (s.score !== null) { const e = by.get(s.day) ?? { sum: 0, n: 0 }; e.sum += s.score; e.n++; by.set(s.day, e); }
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([day, e]) => ({ day, score: Math.round(e.sum / e.n) }));
}

/** "Since you installed": first stored score, latest, problems found and fixed. Pure over the stored rows. */
export function sinceInstall(snaps: Array<{ day: string; score: number | null }>, found: number, fixed: number) {
  const scored = snaps.filter((s) => s.score !== null).sort((a, b) => a.day.localeCompare(b.day));
  if (scored.length === 0) return null;
  return { since: scored[0].day, first: scored[0].score as number, now: scored[scored.length - 1].score as number, found, fixed };
}
