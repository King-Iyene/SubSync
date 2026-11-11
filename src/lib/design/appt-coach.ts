import type { ApReminderRow, ApStats } from "../analytics/appointments3-types-interim.ts";

// Plain-words helpers for the Appointments screens. Everything is computed from the account's OWN numbers; nothing is compared with an outside benchmark.

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "n/a";
  const d = cents / 100;
  return d >= 1_000_000 ? `$${(d / 1_000_000).toFixed(1)}M` : d >= 10_000 ? `$${Math.round(d / 1000)}k` : d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${Math.round(d)}`;
}

export type Risk = { level: "high" | "watch" | "low"; why: string };
/** No-show risk for an upcoming appointment, from what is known about reminders and confirmation only (a labelled estimate, not a prediction model). */
export function riskOf(r: Pick<ApReminderRow, "reminderState" | "hoursToStart" | "flags" | "status">): Risk {
  const noReminder = r.reminderState === "none" || r.reminderState === "failed";
  const unconfirmed = r.status !== "confirmed" && r.reminderState !== "confirmed";
  if (noReminder && r.hoursToStart <= 48) return { level: "high", why: r.reminderState === "failed" ? "The reminder failed and it is within 2 days." : "No reminder was sent and it is within 2 days." };
  if (unconfirmed && r.hoursToStart <= 24) return { level: "high", why: "Not confirmed with less than a day to go." };
  if (noReminder || unconfirmed || r.flags.includes("unconfirmed")) return { level: "watch", why: noReminder ? "No reminder yet." : "Not confirmed yet." };
  return { level: "low", why: "Confirmed and reminded." };
}

/** A one-paragraph coaching note for one person against the agency's own overall rates. Never invents a benchmark; says "not enough data" under the minimum. */
export function coachingNote(p: ApStats & { name: string }, overall: { showRate: number | null; noShowRate: number | null; closeRate: number | null }, min = 5): { tone: "green" | "amber" | "red" | "grey"; text: string } {
  if (p.bookings < min || p.showRate === null) return { tone: "grey", text: `Not enough data yet: ${p.name} has ${p.bookings} booking${p.bookings === 1 ? "" : "s"}, and ${min} are needed before this says anything.` };
  const parts: string[] = [];
  let tone: "green" | "amber" | "red" = "green";
  if (overall.noShowRate !== null && p.noShowRate !== null && p.noShowRate - overall.noShowRate >= 0.1) { tone = "red"; parts.push(`${Math.round(p.noShowRate * 100)}% of their appointments are no-shows, against ${Math.round(overall.noShowRate * 100)}% for everyone. Try a same-day confirmation call.`); }
  if (overall.closeRate !== null && p.closeRate !== null && overall.closeRate - p.closeRate >= 0.15) { if (tone === "green") tone = "amber"; parts.push(`Of the people who show, ${Math.round(p.closeRate * 100)}% close, against ${Math.round(overall.closeRate * 100)}%. Review a recording with them.`); }
  if (p.burned >= 3 && tone === "green") { tone = "amber"; parts.push(`${p.burned} leads were burned (never shown or never followed up).`); }
  if (!parts.length) parts.push(`${p.name} is at or above your own average on show rate (${pct(p.showRate)}) and close rate (${pct(p.closeRate)}). Hand them more of the hard leads.`);
  return { tone, text: parts.join(" ") };
}
