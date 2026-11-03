import { ASSUMED_LIMITS } from "../ghl/crm-writes.ts";

// The note SubSync writes into a contact (INTEGRATIONS_SPEC section 8). Pure. The default template is the spec's; E2b adds custom templates and
// the live preview on top of `fillTemplate`, which already rejects unknown variables.

export const DEFAULT_TEMPLATE = `Meeting: {title}
Date: {date} ({duration})
With: {attendees}
Recorded by: {rep}, with {tool}

Summary
{summary}

Action items
{action_items}

Recording: {recording_url}

Added by SubSync from {tool}.`;

/** The variables a template may use (spec section 8). Anything else is refused when a template is saved. */
export const TEMPLATE_VARIABLES = ["title", "date", "duration", "rep", "attendees", "summary", "action_items", "recording_url", "transcript_url", "transcript", "tool"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type Vars = Partial<Record<TemplateVariable, string | null | undefined>>;

const VARIABLE = /\{([a-z_]+)\}/g;
/** Anything in curly brackets, so a wrong capital letter, a space or a typo is caught too and never printed as it stands. */
const ANY_BRACKETS = /\{([^{}\n]{1,40})\}/g;

/** The unknown variables a template uses (empty when it is fine). Used to refuse a template and to say which word is wrong. */
export function unknownVariables(template: string): string[] {
  return [...new Set([...template.matchAll(ANY_BRACKETS)].map((m) => m[1]).filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v)))];
}

export const MAX_TEMPLATE_CHARS = 2_000;
/** The most transcript text read from a call (the same cap the meeting parser uses). A longer transcript becomes a link, never a cut-off text. */
export const MAX_TRANSCRIPT_CHARS = 200_000;

export type TemplateCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * Is this layout acceptable? Plain sentences for each problem, so the screen can show them next to the live preview. An unknown word in curly
 * brackets is refused (never printed as it stands), a bracket that is not closed is refused, and a layout with no variable at all is refused.
 */
export function checkTemplate(template: string): TemplateCheck {
  const problems: string[] = [];
  const text = template.trim();
  if (!text) return { ok: false, problems: ["The layout is empty. Add at least {summary}."] };
  if (template.length > MAX_TEMPLATE_CHARS) problems.push(`The layout is too long (${template.length} of ${MAX_TEMPLATE_CHARS} characters).`);
  for (const v of unknownVariables(template)) problems.push(`{${v}} is not something SubSync can fill in. You can use: ${TEMPLATE_VARIABLES.map((n) => `{${n}}`).join(", ")}.`);
  if (/[{}]/.test(template.replace(ANY_BRACKETS, ""))) problems.push("A curly bracket is not closed. Each { needs a } after the word.");
  if (![...template.matchAll(ANY_BRACKETS)].some((m) => (TEMPLATE_VARIABLES as readonly string[]).includes(m[1]))) problems.push("The layout needs at least one word in curly brackets, for example {summary}.");
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** Plain text only: tags are removed, control characters dropped, the result trimmed and capped. A value is never inserted as HTML. */
export function plain(v: string | null | undefined, max: number): string {
  if (!v) return "";
  const s = v.replace(/<[^>]*>/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/**
 * Fills a template. A line whose variables are all empty is dropped, and a paragraph whose variable lines were all dropped goes with its heading, so a
 * call without action items has no empty "Action items" heading. Empty brackets left by a missing duration are removed.
 */
export function fillTemplate(template: string, vars: Vars): string {
  const unknown = unknownVariables(template);
  if (unknown.length) throw new Error(`Unknown variable: ${unknown.join(", ")}`);
  const value = (name: string) => plain(vars[name as TemplateVariable], name === "transcript" ? MAX_TRANSCRIPT_CHARS : name === "summary" ? 6_000 : 600);
  const paragraphs = template.split(/\n{2,}/).map((p) => p.split("\n"));
  const out: string[] = [];
  for (const lines of paragraphs) {
    let variableLines = 0;
    let keptVariableLines = 0;
    const kept: string[] = [];
    for (const line of lines) {
      const names = [...line.matchAll(VARIABLE)].map((m) => m[1]);
      if (names.length === 0) { kept.push(line); continue; }
      variableLines++;
      if (names.every((n) => value(n) === "")) continue;
      keptVariableLines++;
      kept.push(line.replace(VARIABLE, (_m, n: string) => value(n)).replace(/\s*\(\s*\)/g, "").trimEnd());
    }
    // A heading whose lines were all empty goes too ("Action items" with nothing under it).
    if (variableLines > 0 && keptVariableLines === 0) continue;
    if (kept.length) out.push(kept.join("\n"));
  }
  return out.join("\n\n");
}

export type NoteInput = {
  title: string | null;
  startedAt: string | null;
  durationMinutes: number | null;
  attendeeNames: string[];
  rep: string | null;
  tool: string;
  summary: string | null;
  actionItems: string[];
  recordingUrl: string | null;
};

/** Which parts of the note the person's choices (after the account's rules) put in a note. */
export type Includes = { summary: boolean; actionItems: boolean; recordingLink: boolean; attendeesAndDate: boolean };
export const ALL_PARTS: Includes = { summary: true, actionItems: true, recordingLink: true, attendeesAndDate: true };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "date unknown";

export const SHORTENED = "[Shortened here. The full summary is in SubSync.]";

/** What a transcript is written as when it is saved on its own (it never shares an item with the summary). */
export const TRANSCRIPT_TEMPLATE = `Transcript: {title}
Date: {date}

{transcript}

Added by SubSync from {tool}.`;

/** What is written instead when the transcript is too long to save in a few parts. */
export const TRANSCRIPT_LINK_TEMPLATE = `Transcript: {title}
Date: {date}

The full transcript is too long to save here. Open it in {tool}: {transcript_url}

Added by SubSync from {tool}.`;

/** The variables of one call for one destination: only the parts the person's choices (after the account's rules) put there are filled in. */
export function buildVars(i: NoteInput, includes: Includes, extra: { transcript?: string | null; transcriptUrl?: string | null } = {}): Vars {
  return {
    title: i.title ?? "Untitled", rep: i.rep ?? "a team member", tool: i.tool,
    date: includes.attendeesAndDate ? when(i.startedAt) : "", duration: includes.attendeesAndDate && i.durationMinutes ? `${i.durationMinutes} min` : "",
    attendees: includes.attendeesAndDate ? i.attendeeNames.join(", ") : "",
    summary: includes.summary ? i.summary : "", action_items: includes.actionItems ? i.actionItems.map((a) => `- ${plain(a, 300)}`).join("\n") : "",
    recording_url: includes.recordingLink ? i.recordingUrl : "",
    transcript: extra.transcript ?? "", transcript_url: extra.transcriptUrl ?? "",
  };
}

/**
 * The note for one meeting with the default template. Longer than `limit` characters: the summary is cut at a paragraph boundary and says so. The
 * recording link and the footer are never the part that is cut. (Splitting into "Part 1 of N" is stage E2b.)
 */
export function renderNote(i: NoteInput, includes: Includes = ALL_PARTS, limit: number = ASSUMED_LIMITS.noteChars): { text: string; shortened: boolean } {
  const vars = (summary: string | null): Vars => ({ ...buildVars(i, includes), summary: includes.summary ? summary : "" });
  const full = fillTemplate(DEFAULT_TEMPLATE, vars(i.summary));
  if (full.length <= limit || !includes.summary || !i.summary) return { text: full.length <= limit ? full : full.slice(0, limit - 1) + "…", shortened: full.length > limit };
  // Everything except the summary, then as much of the summary as fits, cut between paragraphs.
  const without = fillTemplate(DEFAULT_TEMPLATE, vars(null)).length;
  const room = limit - without - SHORTENED.length - 2;
  const paragraphs = plain(i.summary, 6_000).split(/\n{2,}/);
  let kept = "";
  for (const p of paragraphs) {
    if ((kept ? kept.length + 2 : 0) + p.length > room) break;
    kept = kept ? `${kept}\n\n${p}` : p;
  }
  if (!kept) kept = plain(i.summary, Math.max(room, 0)).slice(0, Math.max(room, 0));
  return { text: fillTemplate(DEFAULT_TEMPLATE, vars(`${kept}\n\n${SHORTENED}`)), shortened: true };
}

/** A made-up call for the preview before the person has had a real one. It is labelled as a sample wherever it is shown. */
export const SAMPLE_NOTE_INPUT: NoteInput = {
  title: "Sample: quote call", startedAt: "2026-11-02T15:00:00.000Z", durationMinutes: 28, attendeeNames: ["Alex Sample"], rep: "You", tool: "Fathom",
  summary: "Alex wants a quote for the kitchen job and can decide by Friday. Budget was discussed and is flexible.",
  actionItems: ["Send the quote by Thursday", "Book a site visit"], recordingUrl: "https://fathom.video/share/sample",
};
