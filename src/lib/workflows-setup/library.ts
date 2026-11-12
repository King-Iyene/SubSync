// The template library and bulk install: the pure planning. Which of the customer's client accounts would get a template, which already have it, which cannot get it and why, and
// what the preview says. No database and no network here, so every rule has a test. The writes themselves go through the provisioner and the write gateway (never around it).
import { TEMPLATES, type Template } from "./templates.ts";

/** At most this many client accounts in one install, so a mistake is small and the platform's rate limits stay far away. */
export const BULK_CAP = 25;

export type Existing = { status: string | null; workflowId: string | null } | null;
export type PlanInput = {
  locationId: string; name: string;
  /** What SubSync already set up here from this template (our own table), if anything. */
  existing: Existing;
  /** A published workflow with the template's exact name was seen in the account's own list (so we never create a second one). */
  sameNameSeen: boolean;
  /** The permission to create workflows was granted at install. null means not known (demo). */
  canWrite: boolean | null;
  /** The account's own write opt-in (Settings). */
  optedIn: boolean;
};
export type PlanState = "would_create" | "rehearse" | "exists" | "blocked";
export type PlanRow = { locationId: string; name: string; state: PlanState; reason: string };

/** `live` is the global switch for writing to the CRM. Without it, or without the account's opt-in, the row is a rehearsal: recorded, nothing sent. */
export function planRow(t: Template, i: PlanInput, live: boolean): PlanRow {
  const base = { locationId: i.locationId, name: i.name };
  if (i.existing && i.existing.status === "active") return { ...base, state: "exists", reason: `"${t.name}" is already set up here. It is left exactly as it is.` };
  if (i.sameNameSeen) return { ...base, state: "exists", reason: `A workflow named "${t.name}" is already published here. SubSync will not create a second one.` };
  if (i.canWrite === false) return { ...base, state: "blocked", reason: "Needs permission: reconnect so SubSync can create workflows. Missing: workflows.write." };
  if (!live || !i.optedIn) return { ...base, state: "rehearse", reason: !i.optedIn ? "This account has not allowed changes yet, so this is a rehearsal: it is recorded and nothing is sent." : "Changes to your CRM are switched off for now, so this is a rehearsal: it is recorded and nothing is sent." };
  return { ...base, state: "would_create", reason: `Creates "${t.name}" as a draft, checks it, then publishes it.` };
}

export type Preview = { template: { key: string; name: string; summary: string; tag: string }; rows: PlanRow[]; counts: Record<PlanState, number>; capped: boolean };
export function preview(t: Template, inputs: PlanInput[], live: boolean): Preview {
  const rows = inputs.slice(0, BULK_CAP).map((i) => planRow(t, i, live));
  const counts: Record<PlanState, number> = { would_create: 0, rehearse: 0, exists: 0, blocked: 0 };
  for (const r of rows) counts[r.state]++;
  return { template: { key: t.key, name: t.name, summary: t.summary, tag: t.defaultTag }, rows, counts, capped: inputs.length > BULK_CAP };
}

export const libraryTemplate = (key: unknown): Template | null => (typeof key === "string" ? TEMPLATES.find((t) => t.key === key) ?? null : null);

/** What the library lists besides the installable templates: the automations that message customers, with how to get one without SubSync sending anything. */
export const GUIDES: ReadonlyArray<{ standard: "missed_call" | "reminder"; title: string; why: string; steps: string[] }> = [
  { standard: "missed_call", title: "Missed call text back", why: "It texts the caller. That is a message to a customer, so SubSync does not create it for you.",
    steps: ["In your CRM open Automation and choose Create workflow.", "Start it with the trigger Call status, set to missed.", "Add one text message step, written in your own words, from your own number.", "Publish it, then call the number from a phone that is not on file to test it."] },
  { standard: "reminder", title: "Appointment reminders", why: "It messages the person who booked, so SubSync does not create it for you.",
    steps: ["In your CRM open Automation and choose Create workflow.", "Start it with the trigger Appointment status, set to confirmed.", "Add a wait step ending 24 hours before the booking, then a text or email step in your own words.", "Publish it and book a test appointment to check it."] },
];
