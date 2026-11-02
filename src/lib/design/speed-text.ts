// The words on the Speed to lead screen, as pure functions so they are unit tested and never drift between the list, the side panel and the copied text.
// Plain words only: "reply", "client account", "person" (no jargon, no internal names).
import { fmtDuration, type AutoVsHuman } from "../analytics/speed-intel.ts";
import { waitLabel } from "./ui-logic.ts";

export type LeadStatusInput = { status: "within" | "late" | "waiting"; minutes: number; neverAnswered: boolean };
export type StatusTone = "good" | "warn" | "bad";

/** What happened to a lead, in words, with the colour that goes with it. */
export function leadStatus(l: LeadStatusInput): { tone: StatusTone; text: string } {
  if (l.status === "within") return { tone: "good", text: `replied in ${fmtDuration(l.minutes * 60)}` };
  if (l.status === "late") return { tone: "warn", text: `replied after ${fmtDuration(l.minutes * 60)}` };
  return l.neverAnswered ? { tone: "bad", text: `never answered (${waitLabel(l.minutes)})` } : { tone: "bad", text: `waiting ${waitLabel(l.minutes)}` };
}

/** "Automatic text 10 sec after it arrived", or null when none went out (or it was not recorded for this lead). */
export function autoLine(l: { autoSeconds: number | null; detailed: boolean }): string | null {
  if (!l.detailed || l.autoSeconds === null) return null;
  return `Automatic message after ${fmtDuration(l.autoSeconds)}`;
}

export const plainCount = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The one line under the headline: what the numbers are and what they are not (N78). */
export function measuringSentence(m: { targetMinutes: number; countAutomated: boolean; businessHours: boolean }): string {
  return `SubSync measures how fast your team replies. It does not send any replies itself. Your reply target is ${plainCount(m.targetMinutes, "minute")}. Automatic messages ${m.countAutomated ? "count" : "do not count"} as a reply${m.businessHours ? ", and leads that arrive out of hours start their clock at opening time" : ""}.`;
}

/** The automatic first message against the person's reply, as short sentences. An empty list means there is nothing to say yet. */
export function autoVsHumanLines(a: AutoVsHuman): string[] {
  if (a.read === 0) return a.notRead > 0 ? [`Not recorded yet for these ${plainCount(a.notRead, "lead")}. SubSync reads each lead's messages once, so this fills in over the next syncs.`] : [];
  const lines: string[] = [];
  if (a.autoSent === 0) {
    lines.push(`No automatic first message was seen on these ${plainCount(a.read, "lead")}. Every reply counted above came from a person.`);
  } else {
    const typical = a.autoMedianSeconds === null ? "" : `, typically after ${fmtDuration(a.autoMedianSeconds)}`;
    lines.push(`${a.autoSent} of ${a.read} leads got an automatic message first${typical}.`);
    const person = a.personMedianSeconds === null ? "" : ` (a person's typical first reply: ${fmtDuration(a.personMedianSeconds)})`;
    lines.push(`${a.alsoPerson} of them were later answered by a person${person}.${a.onlyAutoPastTarget > 0 ? ` ${a.onlyAutoPastTarget} still have only the automatic message, past your target.` : ""}`);
  }
  if (a.notRead > 0) lines.push(`${plainCount(a.notRead, "older lead")} not recorded yet.`);
  return lines;
}

/** The action that replaces a table that is mostly "Unknown" (N47). */
export function unknownSourceAction(u: { n: number; total: number; share: number | null }): { title: string; body: string } {
  const pct = u.share === null ? "" : ` (${Math.round(u.share * 100)}%)`;
  return {
    title: `${u.n} of ${plainCount(u.total, "new lead")}${pct} have no source recorded.`,
    body: "Without a source SubSync cannot tell which kind of lead gets answered fast, and neither can you. Make sure every form, ad and import sets the contact's Source (in your CRM, the Source field on the contact or the \"set source\" step of a form or workflow). Leads from Facebook and Instagram lead forms are recognised once the source or a lead-form tag is there.",
  };
}

/** The progress sentence for a person with too few replies to be ranked: "2 of 3 replies so far". */
export const personProgressText = (replies: number, need: number) => `${replies} of ${need} replies so far`;

/** One line per row for the copy button (a message or a spreadsheet). */
export function copyLine(l: LeadStatusInput & { name: string; locationName: string; source: string }, showAccount: boolean): string {
  return [l.name, showAccount ? l.locationName : null, l.source, leadStatus(l).text].filter(Boolean).join(", ");
}
