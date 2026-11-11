// Clients slice CB: the churn-risk estimate and the agency health score. Pure functions over SubSync's own daily history (account_metrics_daily) and the weekly receipt facts.
// Both are ESTIMATES and say so; the formula is returned with the answer so a screen can show it one tap away. Under the minimum data they return "not enough data", never a guess.
import type { MuteKind } from "./clients-actions";
import type { ReceiptFacts, SetupItem } from "./clients-actions";

export const MIN_HISTORY_DAYS = 28;
export type DayRow = { day: string; newContacts30d: number; openValue: number; engagement: number };
export type RiskLevel = "high" | "watch" | "steady" | "not_enough_data";
export type Risk = { locationId: string; name: string; level: RiskLevel; points: number; drivers: string[]; historyDays: number; since: string | null };

export const RISK_FORMULA = [
  `Compared with 28 days ago, from SubSync's own daily record of each client (needs at least ${MIN_HISTORY_DAYS} days of record, otherwise "not enough data"):`,
  "New leads in the last 30 days fell by 50% or more: 3 points. Fell by 30% to 49%: 2 points (only when there were at least 5 a month before).",
  "No new leads in the last 30 days when there were some 28 days ago: 3 points.",
  "Activity score fell by 20 points or more: 2 points.",
  "Open deal value fell by 40% or more (from at least $1,000): 1 point.",
  "4 or more points is High, 2 or 3 is Watch, fewer is Steady. This is an estimate from counts, not a prediction of who will leave.",
].join(" ");

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n)}%`;

/** `rows` oldest first. The newest row is "now"; the row nearest 28 days earlier is the base. */
export function riskOf(locationId: string, name: string, rows: DayRow[]): Risk {
  const first = rows[0]?.day ?? null;
  const span = rows.length >= 2 ? Math.round((Date.parse(rows[rows.length - 1].day) - Date.parse(rows[0].day)) / 86_400_000) : 0;
  if (rows.length < 2 || span < MIN_HISTORY_DAYS) return { locationId, name, level: "not_enough_data", points: 0, drivers: [], historyDays: Math.max(0, span), since: first };
  const now = rows[rows.length - 1];
  const target = Date.parse(now.day) - 28 * 86_400_000;
  const base = rows.reduce((best, r) => (Math.abs(Date.parse(r.day) - target) < Math.abs(Date.parse(best.day) - target) ? r : best), rows[0]);
  let points = 0;
  const drivers: string[] = [];
  if (base.newContacts30d >= 5) {
    const drop = ((base.newContacts30d - now.newContacts30d) / base.newContacts30d) * 100;
    if (drop >= 50) { points += 3; drivers.push(`New leads fell ${pct(drop)} (${base.newContacts30d} to ${now.newContacts30d} a month).`); }
    else if (drop >= 30) { points += 2; drivers.push(`New leads fell ${pct(drop)} (${base.newContacts30d} to ${now.newContacts30d} a month).`); }
  }
  if (base.newContacts30d > 0 && now.newContacts30d === 0) { points += 3; drivers.push("No new leads in the last 30 days."); }
  if (base.engagement - now.engagement >= 20) { points += 2; drivers.push(`Activity score fell ${base.engagement - now.engagement} points (${base.engagement} to ${now.engagement}).`); }
  if (base.openValue >= 1000) {
    const drop = ((base.openValue - now.openValue) / base.openValue) * 100;
    if (drop >= 40) { points += 1; drivers.push(`Open deal value fell ${pct(drop)} (${money(base.openValue)} to ${money(now.openValue)}).`); }
  }
  return { locationId, name, level: points >= 4 ? "high" : points >= 2 ? "watch" : "steady", points, drivers, historyDays: span, since: first };
}

export const riskRank = (a: Risk, b: Risk) => b.points - a.points || a.name.localeCompare(b.name);

/** A quiet mark hides one kind of attention; "all" hides everything. The list keeps the client and says it is quieted. */
export function quieted(map: Map<string, MuteKind[]>, locationId: string, kind: MuteKind): boolean {
  const k = map.get(locationId);
  return !!k && (k.includes("all") || k.includes(kind));
}

// ---- agency health score ----

export type HealthPart = { id: string; label: string; value: number | null; detail: string; enough: boolean };
export type AgencyHealth = { score: number | null; parts: HealthPart[]; formula: string; message: string };
export const HEALTH_FORMULA = "The average of the parts that have enough data, each worth the same: new leads answered in time (needs 20 or more leads this week across clients), appointments marked showed or no-show (needs 10 or more held), clients that can be fully read (needs 3 or more clients), and clients not at high risk (needs 3 or more clients with 28 days of record). Shown only when at least 2 parts have enough data. This is an estimate.";

export function agencyHealth(facts: ReceiptFacts[], setup: Array<{ items: SetupItem[] }>, risks: Risk[]): AgencyHealth {
  const leads = facts.reduce((n, f) => n + f.leads, 0);
  const inTime = facts.reduce((n, f) => n + f.answeredInTarget, 0);
  const held = facts.reduce((n, f) => n + f.appointments.held, 0);
  const unmarked = facts.reduce((n, f) => n + f.appointments.unmarked, 0);
  const readable = setup.filter((s) => s.items.every((i) => i.fix !== "reconnect")).length;
  const known = risks.filter((r) => r.level !== "not_enough_data");
  const calm = known.filter((r) => r.level !== "high").length;
  const parts: HealthPart[] = [
    { id: "replies", label: "New leads answered in time", enough: leads >= 20, value: leads >= 20 ? (inTime / leads) * 100 : null, detail: leads >= 20 ? `${inTime} of ${leads} new leads this week.` : `Only ${leads} leads this week; needs 20.` },
    { id: "appointments", label: "Appointments marked", enough: held >= 10, value: held >= 10 ? ((held - unmarked) / held) * 100 : null, detail: held >= 10 ? `${held - unmarked} of ${held} appointments have an outcome.` : `Only ${held} appointments this week; needs 10.` },
    { id: "setup", label: "Clients fully readable", enough: setup.length >= 3, value: setup.length >= 3 ? (readable / setup.length) * 100 : null, detail: setup.length >= 3 ? `${readable} of ${setup.length} clients need no reconnect.` : `Only ${setup.length} clients; needs 3.` },
    { id: "retention", label: "Clients not at high risk", enough: known.length >= 3, value: known.length >= 3 ? (calm / known.length) * 100 : null, detail: known.length >= 3 ? `${calm} of ${known.length} clients with enough record.` : `Only ${known.length} clients have 28 days of record; needs 3.` },
  ];
  const ok = parts.filter((p) => p.enough && p.value !== null);
  if (ok.length < 2) return { score: null, parts, formula: HEALTH_FORMULA, message: "Not enough data yet for a score. It appears once at least two of the parts below have enough data." };
  const score = Math.round(ok.reduce((n, p) => n + (p.value as number), 0) / ok.length);
  return { score, parts, formula: HEALTH_FORMULA, message: `Estimate from ${ok.length} of 4 parts. The weakest part is "${[...ok].sort((a, b) => (a.value as number) - (b.value as number))[0].label}".` };
}
