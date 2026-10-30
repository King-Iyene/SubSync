// Client success and goal tracking (spec sections 6, 7 and 14.5/14.6). Pure rules, unit tested.

const DAY = 86_400_000;

// ---------------- ROI (6.5) ----------------

export type RoiInput = { monthlyFee: number | null; pipelineCreated30d: number; wonValue30d: number };

// "Client pays $2,500 a month. We created $18,000 of pipeline. ROI: 7.2x." Two views: pipeline and won.
export function roi(i: RoiInput) {
  if (!i.monthlyFee || i.monthlyFee <= 0) return null;
  const r = (n: number) => Math.round((n / (i.monthlyFee as number)) * 10) / 10;
  return { pipelineMultiple: r(i.pipelineCreated30d), wonMultiple: r(i.wonValue30d) };
}

// ---------------- renewals (6.13) and contact gaps (6.11) ----------------

export type RenewalBucket = "overdue" | "30" | "60" | "90" | "later";

export function renewalStatus(renewalDate: string | null, now: number): { daysLeft: number; bucket: RenewalBucket } | null {
  if (!renewalDate) return null;
  const t = Date.parse(`${renewalDate}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const daysLeft = Math.ceil((t - now) / DAY);
  const bucket: RenewalBucket = daysLeft < 0 ? "overdue" : daysLeft <= 30 ? "30" : daysLeft <= 60 ? "60" : daysLeft <= 90 ? "90" : "later";
  return { daysLeft, bucket };
}

export const CONTACT_GAP_DAYS = 14;

export function contactGap(lastContactedAt: number | null, now: number): { days: number | null; flagged: boolean } {
  if (lastContactedAt === null) return { days: null, flagged: true };
  const days = Math.floor((now - lastContactedAt) / DAY);
  return { days, flagged: days >= CONTACT_GAP_DAYS };
}

// ---------------- goals (7.7) ----------------

export type GoalStatus = "achieved" | "on_track" | "at_risk" | "behind";

// `now` decides how far through the month we are, so a half-finished month with half the target
// reached is on track, not behind.
export function goalProgress(target: number, actual: number, now: number) {
  const d = new Date(now);
  const day = d.getUTCDate() - 1 + (d.getUTCHours() + d.getUTCMinutes() / 60) / 24;
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(day / daysInMonth, 1 / daysInMonth);
  const projected = actual / elapsed;
  const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
  const status: GoalStatus = actual >= target ? "achieved" : projected >= target * 0.95 ? "on_track" : projected >= target * 0.75 ? "at_risk" : "behind";
  return { target, actual, pct, projected: Math.round(projected), status };
}

// ---------------- period change (7.6, 7.12) ----------------

export function periodChange(current: number, previous: number) {
  const delta = current - previous;
  return { current, previous, delta, pct: previous > 0 ? Math.round((delta / previous) * 100) : null };
}

// ---------------- anomalies (7.10) ----------------

// Is the newest point unusually far from the history before it? (z-score, needs a real history.)
export function zAnomaly(series: number[], opts: { minPoints?: number; z?: number; minRelative?: number } = {}) {
  const minPoints = opts.minPoints ?? 14;
  const threshold = opts.z ?? 2;
  // A tiny wobble on a very steady series is statistically odd but not worth anyone's attention.
  const minRelative = opts.minRelative ?? 0.25;
  if (series.length < minPoints + 1) return null;
  const history = series.slice(0, -1);
  const latest = series[series.length - 1];
  const mean = history.reduce((s, x) => s + x, 0) / history.length;
  const sd = Math.sqrt(history.reduce((s, x) => s + (x - mean) ** 2, 0) / history.length);
  if (mean !== 0 && Math.abs(latest - mean) / Math.abs(mean) < minRelative) return null;
  if (sd === 0) return latest === mean ? null : { z: Infinity, mean, latest, direction: latest > mean ? ("above" as const) : ("below" as const) };
  const z = (latest - mean) / sd;
  return Math.abs(z) >= threshold ? { z: Math.round(z * 10) / 10, mean: Math.round(mean * 10) / 10, latest, direction: z > 0 ? ("above" as const) : ("below" as const) } : null;
}

// Indices of every point that is unusual against the points before it (for marking on a chart).
export function anomalyIndices(series: number[], opts: { minPoints?: number; z?: number; minRelative?: number } = {}): number[] {
  const out: number[] = [];
  for (let i = (opts.minPoints ?? 14); i < series.length; i++) if (zAnomaly(series.slice(0, i + 1), opts)) out.push(i);
  return out;
}

// ---------------- compare accounts (6.9) ----------------

export type CompareFacts = {
  name: string; new30d: number; winRate: number | null; avgCycleDays: number | null; unanswered: number; completenessPct: number; score: number; openValue: number;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 1);

export function compareAccounts(a: CompareFacts, b: CompareFacts): string[] {
  const out: string[] = [];
  const leads = ratio(a.new30d, b.new30d);
  if (leads >= 1.5 && a.new30d >= 5) out.push(`${a.name} brings in ${Number.isFinite(leads) ? `${Math.round(leads * 10) / 10}x` : "far more"} the new contacts of ${b.name} (${a.new30d} vs ${b.new30d} in 30 days).`);
  else if (leads <= 1 / 1.5 && b.new30d >= 5) out.push(`${b.name} brings in ${Number.isFinite(1 / leads) ? `${Math.round((1 / leads) * 10) / 10}x` : "far more"} the new contacts of ${a.name} (${b.new30d} vs ${a.new30d} in 30 days).`);
  if (a.winRate !== null && b.winRate !== null && Math.abs(a.winRate - b.winRate) >= 0.1) {
    const [hi, lo] = a.winRate > b.winRate ? [a, b] : [b, a];
    out.push(`${hi.name} wins more of its deals (${Math.round((hi.winRate as number) * 100)}% vs ${Math.round((lo.winRate as number) * 100)}% at ${lo.name}).`);
  }
  if (a.avgCycleDays !== null && b.avgCycleDays !== null && Math.abs(a.avgCycleDays - b.avgCycleDays) >= 7) {
    const [fast, slow] = a.avgCycleDays < b.avgCycleDays ? [a, b] : [b, a];
    out.push(`${fast.name} closes faster (${fast.avgCycleDays} days vs ${slow.avgCycleDays} at ${slow.name}).`);
  }
  if (Math.abs(a.unanswered - b.unanswered) >= 3) {
    const [more, less] = a.unanswered > b.unanswered ? [a, b] : [b, a];
    out.push(`${more.name} has ${more.unanswered} messages waiting past the reply target, against ${less.unanswered} at ${less.name}. Follow-up speed is the likely gap.`);
  }
  if (Math.abs(a.completenessPct - b.completenessPct) >= 15) {
    const [hi, lo] = a.completenessPct > b.completenessPct ? [a, b] : [b, a];
    out.push(`${lo.name} has weaker contact data (${lo.completenessPct}% complete vs ${hi.completenessPct}% at ${hi.name}).`);
  }
  if (out.length === 0) out.push(`${a.name} and ${b.name} look similar on the measures we track.`);
  return out;
}

// ---------------- segments (6.14) ----------------

export type SegmentRow = { industry: string | null; score: number; winRate: number | null; openValue: number };

export function segmentStats(rows: SegmentRow[]) {
  const by = new Map<string, SegmentRow[]>();
  for (const r of rows) {
    const k = r.industry?.trim() || "Not set";
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].map(([industry, list]) => {
    const rates = list.map((r) => r.winRate).filter((x): x is number => x !== null);
    return {
      industry, accounts: list.length, avgScore: Math.round(list.reduce((s, r) => s + r.score, 0) / list.length),
      avgWinRate: rates.length ? Math.round((rates.reduce((s, x) => s + x, 0) / rates.length) * 100) / 100 : null,
      openValue: list.reduce((s, r) => s + r.openValue, 0),
    };
  }).sort((a, b) => b.accounts - a.accounts);
}

// ---------------- activity summary (14.6) ----------------

export function activitySummary(i: { name: string; newContacts: number; dealsWon: number; wonValue: number; pipelineCreated: number; days: number }): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const parts = [`${i.newContacts} new contact${i.newContacts === 1 ? "" : "s"}`];
  if (i.pipelineCreated > 0) parts.push(`${money(i.pipelineCreated)} of new pipeline`);
  parts.push(i.dealsWon === 0 ? "no deals closed yet" : `${i.dealsWon} deal${i.dealsWon === 1 ? "" : "s"} won worth ${money(i.wonValue)}`);
  return `In the last ${i.days} days for ${i.name}: ${parts.join(", ")}.`;
}
