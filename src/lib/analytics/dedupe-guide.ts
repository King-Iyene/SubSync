// The guided-merge rules for the Clean-up module (stage C2). Pure logic, no database. SubSync never merges or deletes:
// it explains a group, suggests which record to keep with one reason, shows the differences, and says when to stop.
import { foldEmail, nameSimilarity, normPhone, scorePair, type Group, type MatchReason, type Person } from "./dedupe.ts";

export type PairView = { a: Person; b: Person; score: number; reasons: MatchReason[] };

// The best candidate pairs in a group, best first. A group of 88 is never shown as 88: the screen shows the top three and "See all N".
export function bestPairs(people: Person[], limit = 3): PairView[] {
  const sample = people.slice(0, 60);
  const out: PairView[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const { score, reasons } = scorePair(sample[i], sample[j]);
      out.push({ a: sample[i], b: sample[j], score, reasons });
    }
  }
  const sim = (p: PairView) => nameSimilarity(p.a.name, p.b.name) ?? 0.5;
  return out.sort((x, y) => y.score - x.score || sim(y) - sim(x) || x.a.contactId.localeCompare(y.a.contactId)).slice(0, limit);
}

export type GroupLabel = { title: string; line: string; tone: "good" | "warn" | "neutral"; showPercent: boolean };

// Plain words for the kind of group. Only a group that is likely one person shows a percentage.
export function groupLabel(g: Pick<Group, "kind" | "reasons" | "confidence">): GroupLabel {
  switch (g.kind) {
    case "shared":
      return { title: "Same phone or email, probably different people", line: "Different names share one phone number or inbox. Do not merge these.", tone: "neutral", showPercent: false };
    case "exact":
      return { title: "Very likely the same person", line: g.reasons.includes("same email") && g.reasons.includes("same phone") ? "Same email, same phone and a matching name." : g.reasons.includes("same email") ? "Same email and a matching name." : "Same phone and a matching name.", tone: "good", showPercent: true };
    case "format":
      return { title: "Likely the same person", line: "The details match once spaces, capitals or country codes are ignored.", tone: "good", showPercent: true };
    default:
      return { title: "Maybe the same person", line: "Only the name matches. Check before you do anything.", tone: "warn", showPercent: true };
  }
}

export type Difference = { field: "Name" | "Email" | "Phone"; values: [string | null, string | null]; differs: boolean };

export function differences(a: Person, b: Person): Difference[] {
  const nameSim = nameSimilarity(a.name, b.name);
  return [
    { field: "Name", values: [a.name, b.name], differs: nameSim !== null && nameSim < 1 },
    { field: "Email", values: [a.email, b.email], differs: !!a.email && !!b.email && foldEmail(a.email) !== foldEmail(b.email) },
    { field: "Phone", values: [a.phone, b.phone], differs: !!a.phone && !!b.phone && normPhone(a.phone) !== normPhone(b.phone) },
  ];
}

export type Guard = { level: "ok" | "warn" | "block"; blocks: string[]; warnings: string[] };

// What to say before two records are combined in the CRM. `keep` is the record that stays.
export function pairGuard(keep: Person, other: Person): Guard {
  const blocks: string[] = [];
  const warnings: string[] = [];
  if (keep.dnd || other.dnd) blocks.push("One of them is marked do not disturb. Leave both as they are.");
  const { score } = scorePair(keep, other);
  if (score < 50) blocks.push("These look too different to merge.");
  const busy = (p: Person) => p.openDeals > 0 || (p.upcomingAppointments ?? 0) > 0;
  if (busy(keep) && busy(other)) blocks.push("Both have an open deal or an upcoming appointment. Check them in your CRM first.");
  else if (busy(other)) blocks.push("The record you would combine away has an open deal or an appointment. Keep that one instead.");
  const diff = differences(keep, other);
  for (const d of diff) if (d.differs) warnings.push(`The ${d.field.toLowerCase()} is different.`);
  const level = blocks.length ? "block" : warnings.length ? "warn" : "ok";
  return { level, blocks, warnings };
}

// The group as a whole: a do not disturb contact, or a group of probably different people, is never offered for a merge.
export function groupGuard(g: Pick<Group, "kind" | "people" | "survivorId">): Guard {
  if (g.people.some((p) => p.dnd)) return { level: "block", blocks: ["This group has a contact marked do not disturb. SubSync leaves it alone."], warnings: [] };
  if (g.kind === "shared") return { level: "block", blocks: ["These are probably different people. Do not merge them."], warnings: [] };
  const keep = g.people.find((p) => p.contactId === g.survivorId) ?? g.people[0];
  const guards = g.people.filter((p) => p !== keep).map((o) => pairGuard(keep, o));
  const blocks = [...new Set(guards.flatMap((x) => x.blocks))];
  const warnings = [...new Set(guards.flatMap((x) => x.warnings))];
  return { level: blocks.length ? "block" : warnings.length ? "warn" : "ok", blocks, warnings };
}

export type SourceSummary = {
  total: number;
  days: Array<{ day: string; count: number; share: number; looksLikeImport: boolean }>;
  sources: Array<{ source: string; count: number }>;
  line: string;
};

const IMPORT_DAY_MIN = 20;

// Where the duplicate records came from: the days they were created and the source each one carries. A day with many records is an
// import day. We cannot tell whether blocking was on at the time, so we do not claim it.
export function sourceOfDuplicates(people: Person[]): SourceSummary {
  const byDay = new Map<string, number>();
  const bySource = new Map<string, number>();
  let dated = 0;
  for (const p of people) {
    if (p.createdAt) { dated++; const d = p.createdAt.slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
    const s = p.source?.trim();
    if (s) bySource.set(s, (bySource.get(s) ?? 0) + 1);
  }
  const days = [...byDay].map(([day, count]) => ({ day, count, share: dated ? Math.round((count / dated) * 100) : 0, looksLikeImport: count >= IMPORT_DAY_MIN }))
    .sort((a, b) => b.count - a.count || b.day.localeCompare(a.day)).slice(0, 5);
  const sources = [...bySource].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const top = days[0];
  const line = !top ? "We do not know when these were added."
    : top.looksLikeImport && top.share >= 30 ? `${top.share}% were added on ${top.day}. That looks like an import.`
    : `The most were added on ${top.day} (${top.count} records).`;
  return { total: people.length, days, sources, line };
}


// "I merged these in my CRM" is a claim we can check later. If the same records are still listed a day after, the group comes back.
export const RECHECK_AFTER_MS = 24 * 3_600_000;
export function needsRecheck(review: { decision: string; decidedAt: string | null }, now: number): boolean {
  return review.decision === "merged_in_platform" && !!review.decidedAt && now - Date.parse(review.decidedAt) > RECHECK_AFTER_MS;
}
