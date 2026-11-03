import { describe, expect, it } from "vitest";
import { MAX_TRANSCRIPT_PARTS, packParagraphs, planTranscript, splitIntoParts, usableChars, withoutPartHeader } from "@/lib/connections/content-split";
import { composeDelivery, includesFor, type DeliveryInput } from "@/lib/connections/delivery";
import {
  cutAtWord, FIELD_DEFAULT_ON, fieldLimit, fieldTypeOf, planFieldWrites, requestedFields, typeProblem, valueFor, type FieldMapping, type FieldSource,
} from "@/lib/connections/contact-fields";
import { checkTemplate, DEFAULT_TEMPLATE, fillTemplate, MAX_TEMPLATE_CHARS, SAMPLE_NOTE_INPUT, TEMPLATE_VARIABLES, unknownVariables } from "@/lib/connections/note-template";
import {
  clipChoices, DEFAULT_CHOICES, DEFAULT_POLICY, effectiveChoices, effectivePolicy, matrixFor, readFlags, stricter, wantedContent, type Matrix, type PersonChoices,
} from "@/lib/connections/policy";
import { cleanPriority, decideSource, isSameMeeting, rankOf, type SeenMeeting } from "@/lib/connections/source-priority";
import { ASSUMED_LIMITS } from "@/lib/ghl/crm-writes";

// Stage E2b, pure logic: splitting, layouts, contact fields, source priority and the account setup over the person's choices. No database, no network.

const para = (n: number, ch = "a") => `${ch.repeat(n)}.`;

describe("long content is split into parts at paragraph boundaries", () => {
  it("content up to 90 percent of the limit stays one item, unchanged", () => {
    const text = "x".repeat(usableChars(2000));
    expect(splitIntoParts(text, 2000)).toEqual([text]);
    expect(usableChars(2000)).toBe(1800);
  });

  it("content just over 90 percent of the limit is split", () => {
    const parts = splitIntoParts(`${para(900)}\n\n${para(901, "b")}`, 2000);
    expect(parts.length).toBe(2);
    expect(parts[0].startsWith("Part 1 of 2\n\n")).toBe(true);
    expect(parts[1].startsWith("Part 2 of 2\n\n")).toBe(true);
  });

  it("splits only between paragraphs when each paragraph fits, and never loses or reorders text", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${"word ".repeat(60)}`.trim());
    const parts = splitIntoParts(paragraphs.join("\n\n"), 1000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(usableChars(1000));
    const joined = parts.map(withoutPartHeader).join("\n\n");
    expect(joined).toBe(paragraphs.join("\n\n"));
    // every part ends where a paragraph ends: it contains whole paragraphs only
    for (const p of parts) for (const piece of withoutPartHeader(p).split("\n\n")) expect(paragraphs).toContain(piece);
  });

  it("numbers every part against the real total", () => {
    const parts = splitIntoParts(Array.from({ length: 30 }, () => "z".repeat(400)).join("\n\n"), 1000);
    parts.forEach((p, i) => expect(p.startsWith(`Part ${i + 1} of ${parts.length}\n\n`)).toBe(true));
    expect(parts.length).toBeGreaterThan(9);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000);
  });

  it("one paragraph that is too long alone is cut at a sentence, then a word, and nothing is dropped", () => {
    const sentence = "This is one sentence of the call. ";
    const text = sentence.repeat(120).trim();
    const parts = splitIntoParts(text, 800);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(usableChars(800));
    expect(parts.map(withoutPartHeader).join(" ")).toBe(text);
    // each part ends at the end of a sentence
    for (const p of parts) expect(withoutPartHeader(p).endsWith("call.")).toBe(true);
  });

  it("a long unbroken string is still cut (never an endless loop) and every part fits", () => {
    const parts = splitIntoParts("q".repeat(5000), 500);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(500);
    expect(parts.map(withoutPartHeader).join("")).toBe("q".repeat(5000));
  });

  it("an empty text is one empty item, and packing an empty text gives nothing", () => {
    expect(splitIntoParts("", 2000)).toEqual([""]);
    expect(packParagraphs("", 100)).toEqual([]);
  });

  it("a transcript that needs more than three parts becomes a link; one that fits is split normally", () => {
    const small = Array.from({ length: 40 }, (_, i) => `Speaker ${i % 2}: ${"talk ".repeat(20)}`.trim()).join("\n");
    const fits = planTranscript(small, 2000);
    expect(fits.kind).toBe("parts");
    const huge = Array.from({ length: 400 }, (_, i) => `Speaker ${i % 2}: ${"talk ".repeat(20)}`.trim()).join("\n");
    const plan = planTranscript(huge, 2000);
    expect(plan.kind).toBe("link");
    if (plan.kind === "link") expect(plan.neededParts).toBeGreaterThan(MAX_TRANSCRIPT_PARTS);
  });
});

describe("layouts: a live preview that rejects unknown variables", () => {
  it("the default layout and every named variable are accepted", () => {
    expect(checkTemplate(DEFAULT_TEMPLATE)).toEqual({ ok: true });
    for (const v of TEMPLATE_VARIABLES) expect(checkTemplate(`x {${v}}`)).toEqual({ ok: true });
  });

  it("an unknown word, a wrong capital letter and a space inside the brackets are all refused, and the sentence names the word", () => {
    for (const bad of ["Hi {name} {summary}", "{Summary}", "{ summary }", "{summary} {frist_name}"]) {
      const r = checkTemplate(bad);
      expect(r.ok, bad).toBe(false);
    }
    const r = checkTemplate("{summary} {nope}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toContain("{nope} is not something SubSync can fill in");
    expect(unknownVariables("{Summary} {summary} {x y}")).toEqual(["Summary", "x y"]);
  });

  it("an empty layout, a layout with no variable, an open bracket and a layout that is too long are refused", () => {
    expect(checkTemplate("   ").ok).toBe(false);
    expect(checkTemplate("just words").ok).toBe(false);
    const open = checkTemplate("{summary} and {title");
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.problems.join(" ")).toMatch(/not closed/);
    expect(checkTemplate("{summary} " + "x".repeat(MAX_TEMPLATE_CHARS)).ok).toBe(false);
  });

  it("filling a layout with an unknown variable throws instead of printing the braces", () => {
    expect(() => fillTemplate("{summary} {Title}", { summary: "a" })).toThrow(/Unknown variable/);
  });

  it("the preview of a layout is the layout filled with the sample call", () => {
    const text = fillTemplate("Call: {title}\n\n{summary}", { title: SAMPLE_NOTE_INPUT.title, summary: SAMPLE_NOTE_INPUT.summary });
    expect(text).toContain("Sample: quote call");
    expect(text).toContain("Alex wants a quote");
  });
});

const CALL: DeliveryInput = {
  title: "Kitchen quote", startedAt: "2026-11-02T09:01:00.000Z", durationMinutes: 30, attendeeNames: ["Lee Client"], rep: "Rep Seller", tool: "Fathom",
  summary: "They want a quote by Friday.\n\nBudget is flexible.", actionItems: ["Send the quote"], recordingUrl: "https://fathom.video/share/abc123",
  transcript: null, transcriptUrl: "https://fathom.video/calls/123",
};
const REC: Matrix = matrixFor("recommended", null);
const long = (n: number, label = "Talk") => Array.from({ length: n }, (_, i) => `${label} ${i}: ${"words ".repeat(18)}`.trim()).join("\n");

describe("one call becomes the right items for the right destinations", () => {
  it("the Recommended table gives one contact note and nothing else", () => {
    const c = composeDelivery({ input: CALL, items: REC });
    expect(c.messages.map((m) => [m.kind, m.partNo])).toEqual([["note", 1]]);
    expect(c.messages[0].text).toContain("Meeting: Kitchen quote");
    expect(c.messages[0].text).toContain("Action items");
    expect(c.fieldItems).toEqual([]);
  });

  it("summary to a comment and the rest to the note gives one of each, with the right content in each", () => {
    const items: Matrix = { ...REC, summary: "comment" };
    const c = composeDelivery({ input: CALL, items });
    const note = c.messages.find((m) => m.kind === "note")!;
    const comment = c.messages.find((m) => m.kind === "comment")!;
    expect(note.text).toContain("Action items");
    expect(note.text).not.toContain("Budget is flexible");
    expect(comment.text).toContain("Budget is flexible");
    expect(comment.text).not.toContain("Action items");
  });

  it("a long summary splits correctly into BOTH destinations, each part within its own limit, nothing lost", () => {
    const summary = Array.from({ length: 20 }, (_, i) => `Point ${i + 1}. ${"detail ".repeat(36)}`.trim()).join("\n\n");
    const input = { ...CALL, summary };
    const asNote = composeDelivery({ input, items: { ...REC, summary: "note" } });
    const asComment = composeDelivery({ input, items: { ...REC, summary: "comment" } });
    const notes = asNote.messages.filter((m) => m.kind === "note");
    const comments = asComment.messages.filter((m) => m.kind === "comment");
    expect(notes.length).toBeGreaterThan(1);
    expect(comments.length).toBeGreaterThan(1);
    for (const n of notes) expect(n.text.length).toBeLessThanOrEqual(usableChars(ASSUMED_LIMITS.noteChars));
    for (const m of comments) expect(m.text.length).toBeLessThanOrEqual(usableChars(ASSUMED_LIMITS.commentChars));
    expect(notes[0].text.startsWith(`Part 1 of ${notes.length}`)).toBe(true);
    expect(comments[0].text.startsWith(`Part 1 of ${comments.length}`)).toBe(true);
    // Every point survives in the parts, in order.
    for (const [list, name] of [[notes, "note"], [comments, "comment"]] as const) {
      const all = list.map((m) => m.text).join("\n");
      for (let i = 1; i <= 20; i++) expect(all, `${name} keeps Point ${i}`).toContain(`Point ${i}.`);
      expect(all.indexOf("Point 1.")).toBeLessThan(all.indexOf("Point 20."));
    }
    // Part numbers are unique and counted from 1, so the write log can hold each one once.
    expect(notes.map((m) => m.partNo)).toEqual(notes.map((_, i) => i + 1));
  });

  it("the Full record table writes the transcript as its own comment, split in parts when long, and keeps the note", () => {
    const items = matrixFor("full_record", null);
    const c = composeDelivery({ input: { ...CALL, transcript: long(40) }, items });
    expect(c.messages.filter((m) => m.kind === "note")).toHaveLength(1);
    const tr = c.messages.filter((m) => m.what === "transcript");
    expect(tr.length).toBeGreaterThanOrEqual(2);
    expect(tr.every((m) => m.kind === "comment")).toBe(true);
    expect(tr[0].text).toContain("Transcript: Kitchen quote");
    expect(c.remarks).toEqual([]);
  });

  it("a transcript beyond the size cap becomes a link, and the item says so", () => {
    const items = matrixFor("full_record", null);
    const c = composeDelivery({ input: { ...CALL, transcript: long(600) }, items });
    const tr = c.messages.filter((m) => m.what === "transcript");
    expect(tr).toHaveLength(1);
    expect(tr[0].text).toContain("too long to save here");
    expect(tr[0].text).toContain("https://fathom.video/calls/123");
    expect(tr[0].text).not.toContain("Talk 3:");
    expect(c.remarks.join(" ")).toMatch(/saved instead/);
  });

  it("a transcript too long and with no link says where it is, without a link", () => {
    const c = composeDelivery({ input: { ...CALL, transcript: long(600), transcriptUrl: null }, items: matrixFor("full_record", null) });
    const tr = c.messages.find((m) => m.what === "transcript")!;
    expect(tr.text).toContain("It is in Fathom.");
    expect(tr.text).not.toContain("http");
  });

  it("a transcript that nobody sent is never invented: the item is simply absent", () => {
    const c = composeDelivery({ input: CALL, items: matrixFor("full_record", null) });
    expect(c.messages.every((m) => m.what === "meeting")).toBe(true);
  });

  it("a layout that uses {transcript} puts the transcript inside the item for the destination the table chose", () => {
    const items: Matrix = { ...REC, transcript: "comment", summary: "comment", action_items: "comment", recording_link: "comment", attendees_and_date: "comment" };
    const c = composeDelivery({ input: { ...CALL, transcript: "Lee: hello\nRep: hi" }, items, template: "{title}\n\n{summary}\n\nTranscript\n{transcript}" });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].text).toContain("Lee: hello");
    expect(c.messages[0].what).toBe("meeting");
  });

  it("an invalid saved layout is ignored (the default is used), never printed with its brackets", () => {
    const c = composeDelivery({ input: CALL, items: REC, template: "{summary} {oops}" });
    expect(c.messages[0].text).toContain("Meeting: Kitchen quote");
    expect(c.messages[0].text).not.toContain("{oops}");
  });

  it("variables are inserted as plain text, never as markup", () => {
    const c = composeDelivery({ input: { ...CALL, summary: "<img src=x onerror=alert(1)>Plain" }, items: REC });
    expect(c.messages[0].text).not.toContain("<img");
    expect(c.messages[0].text).toContain("Plain");
  });

  it("the table sends fields only for the rows set to Contact field", () => {
    const c = composeDelivery({ input: CALL, items: { ...REC, action_items: "field", attendees_and_date: "field" } });
    expect(c.fieldItems).toEqual(["last_meeting_date", "next_steps", "rep"]);
    expect(c.messages[0].text).not.toContain("Action items");
    expect(includesFor({ ...REC, summary: "comment" }, "comment").summary).toBe(true);
  });
});

const MAP = (item: FieldMapping["item"], over: Partial<FieldMapping> = {}): FieldMapping => ({ item, customFieldId: `F_${item}`, fieldName: `Field ${item}`, fieldType: "text", enabled: true, ...over });
const SRC: FieldSource = { startedAt: "2026-11-02T09:01:00.000Z", summary: "They want a quote by Friday.\n\nBudget is flexible.", actionItems: ["Send the quote", "Book a visit"], recordingUrl: "https://fathom.video/share/abc123", rep: "Rep Seller" };
const T = (iso: string) => Date.parse(iso);

describe("contact fields (spec 8.1)", () => {
  it("a field is written only when the admin mapped it", () => {
    const none = planFieldWrites({ requested: ["next_steps", "last_meeting_date"], mappings: [], source: SRC, previous: {} });
    expect(none.writes).toEqual([]);
    expect(none.skipped.map((s) => s.code)).toEqual(["not_mapped", "not_mapped"]);
    const some = planFieldWrites({ requested: ["next_steps", "last_meeting_date"], mappings: [MAP("next_steps")], source: SRC, previous: {} });
    expect(some.writes.map((w) => w.item)).toEqual(["next_steps"]);
    expect(some.skipped.map((s) => s.item)).toEqual(["last_meeting_date"]);
  });

  it("a mapped field the admin switched off is not written, and says why", () => {
    const r = planFieldWrites({ requested: ["next_steps"], mappings: [MAP("next_steps", { enabled: false })], source: SRC, previous: {} });
    expect(r.writes).toEqual([]);
    expect(r.skipped[0].code).toBe("disabled");
    expect(r.skipped[0].message).toContain("your admin turned this field off");
  });

  it("an older meeting never overwrites a newer value, an equal one does not either, a newer one does", () => {
    const m = [MAP("next_steps")];
    const base = { requested: ["next_steps" as const], mappings: m, source: SRC };
    const older = planFieldWrites({ ...base, previous: { next_steps: T("2026-11-03T09:00:00Z") } });
    expect(older.writes).toEqual([]);
    expect(older.skipped[0].code).toBe("older_meeting");
    expect(planFieldWrites({ ...base, previous: { next_steps: T(SRC.startedAt!) } }).writes).toEqual([]);
    const newer = planFieldWrites({ ...base, previous: { next_steps: T("2026-11-01T09:00:00Z") } });
    expect(newer.writes).toHaveLength(1);
  });

  it("a call with no date never overwrites a value that is already there, but can fill an empty field", () => {
    const m = [MAP("next_steps")];
    const undated = { ...SRC, startedAt: null };
    expect(planFieldWrites({ requested: ["next_steps"], mappings: m, source: undated, previous: { next_steps: 1 } }).skipped[0].code).toBe("no_meeting_date");
    expect(planFieldWrites({ requested: ["next_steps"], mappings: m, source: undated, previous: {} }).writes).toHaveLength(1);
  });

  it("each field is decided on its own: a newer date fills one field while an older one leaves another alone", () => {
    const r = planFieldWrites({
      requested: ["last_meeting_date", "next_steps"], mappings: [MAP("last_meeting_date", { fieldType: "date" }), MAP("next_steps")], source: SRC,
      previous: { last_meeting_date: T("2026-10-01T00:00:00Z"), next_steps: T("2026-12-01T00:00:00Z") },
    });
    expect(r.writes.map((w) => w.item)).toEqual(["last_meeting_date"]);
    expect(r.skipped.map((s) => s.item)).toEqual(["next_steps"]);
  });

  it("the right type is written: a date into a date field as a plain date, into a text field as words; text only into a text field", () => {
    expect(valueFor("last_meeting_date", SRC, "date")).toBe("2026-11-02");
    expect(valueFor("last_meeting_date", SRC, "text")).toBe("Nov 2, 2026");
    expect(valueFor("next_steps", SRC, "text")).toBe("Send the quote; Book a visit");
    expect(valueFor("next_steps", SRC, "large_text")).toBe("- Send the quote\n- Book a visit");
    expect(valueFor("last_meeting_summary", SRC, "text")).toBe("They want a quote by Friday. Budget is flexible.");
    expect(typeProblem("last_meeting_date", "other")).toMatch(/not a date or a text field/);
    expect(typeProblem("next_steps", "date")).toMatch(/not a text field/);
    expect(typeProblem("recording_url", "date")).toMatch(/a link/);
    expect(typeProblem("next_steps", "text")).toBeNull();
    expect(typeProblem("last_meeting_date", "date")).toBeNull();
    expect(fieldTypeOf("DATE")).toBe("date");
    expect(fieldTypeOf("text")).toBe("text");
    expect(fieldTypeOf("LARGE_TEXT")).toBe("large_text");
    expect(fieldTypeOf("NUMERICAL")).toBe("other");
  });

  it("a field of the wrong type is skipped with the reason, never half-written", () => {
    const r = planFieldWrites({ requested: ["next_steps"], mappings: [MAP("next_steps", { fieldType: "other" })], source: SRC, previous: {} });
    expect(r.writes).toEqual([]);
    expect(r.skipped[0].code).toBe("type_mismatch");
    expect(r.skipped[0].message).toContain("Field next_steps");
  });

  it("text that is too long is cut at a word and the cut is reported; a link that is too long is skipped", () => {
    const longSummary = Array.from({ length: 200 }, (_, i) => `sentence${i}`).join(" ");
    const r = planFieldWrites({ requested: ["last_meeting_summary"], mappings: [MAP("last_meeting_summary")], source: { ...SRC, summary: longSummary }, previous: {} });
    expect(r.writes).toHaveLength(1);
    const w = r.writes[0];
    expect(w.value.length).toBeLessThanOrEqual(fieldLimit("text"));
    expect(w.value.endsWith("…")).toBe(true);
    expect(w.cut).toEqual({ kept: w.value.length, of: longSummary.length });
    expect(w.value.slice(0, -1)).toMatch(/sentence\d+$/);
    const url = `https://example.com/${"p".repeat(600)}`;
    const u = planFieldWrites({ requested: ["recording_url"], mappings: [MAP("recording_url")], source: { ...SRC, recordingUrl: url }, previous: {} });
    expect(u.writes).toEqual([]);
    expect(u.skipped[0].code).toBe("too_long");
    expect(cutAtWord("short", 50)).toBe("short");
  });

  it("a large text field takes more than a text field", () => {
    expect(fieldLimit("large_text")).toBeGreaterThan(fieldLimit("text"));
  });

  it("a call with nothing for a field leaves the field as it is (nothing is cleared)", () => {
    const r = planFieldWrites({ requested: ["next_steps"], mappings: [MAP("next_steps")], source: { ...SRC, actionItems: [] }, previous: { next_steps: 1 } });
    expect(r.writes).toEqual([]);
    expect(r.skipped[0].code).toBe("empty");
  });

  it("a link must be https, and the defaults when first mapped are date and next steps on, summary and recording link off", () => {
    expect(valueFor("recording_url", { ...SRC, recordingUrl: "http://insecure.test/x" }, "text")).toBeNull();
    expect(FIELD_DEFAULT_ON).toEqual({ last_meeting_date: true, last_meeting_summary: false, next_steps: true, recording_url: false, rep: false });
  });

  it("the table asks for the fields its Contact field rows fill, and never for a transcript", () => {
    expect(requestedFields({ summary: "field", action_items: "note", recording_link: "field", attendees_and_date: "off", transcript: "field" })).toEqual(["last_meeting_summary", "recording_url"]);
  });
});

const seen = (over: Partial<SeenMeeting> & { provider: string }): SeenMeeting => ({ id: `m-${over.provider}`, startedAt: "2026-11-02T09:00:00.000Z", attendeeEmails: ["rep@agency.test", "lee@client.test"], title: "Kitchen quote", status: "needs_contact", ...over });
const incoming = (over: Partial<Omit<SeenMeeting, "id" | "status">> = {}) => ({ provider: "fathom", startedAt: "2026-11-02T09:03:00.000Z", attendeeEmails: ["rep@agency.test", "lee@client.test"], title: "Kitchen quote", ...over });
const PRIORITY = ["fathom", "zoom", "google_meet"];
const OWN = ["rep@agency.test"];

describe("source priority when several tools recorded the same meeting", () => {
  it("the same meeting is recognised by start time and a shared outsider, not by the person's own address", () => {
    expect(isSameMeeting(incoming(), seen({ provider: "zoom" }), OWN)).toBe(true);
    expect(isSameMeeting(incoming(), seen({ provider: "zoom", startedAt: "2026-11-02T09:30:00.000Z" }), OWN)).toBe(false);
    expect(isSameMeeting(incoming({ attendeeEmails: ["rep@agency.test", "other@client.test"] }), seen({ provider: "zoom" }), OWN)).toBe(false);
    expect(isSameMeeting(incoming(), seen({ provider: "fathom" }), OWN)).toBe(false);
    expect(isSameMeeting(incoming({ attendeeEmails: ["rep@agency.test"] }), seen({ provider: "zoom", attendeeEmails: ["rep@agency.test"] }), OWN)).toBe(true);
    expect(isSameMeeting(incoming({ attendeeEmails: ["rep@agency.test"], title: "A" }), seen({ provider: "zoom", attendeeEmails: ["rep@agency.test"], title: "B" }), OWN)).toBe(false);
    expect(isSameMeeting(incoming({ startedAt: null }), seen({ provider: "zoom" }), OWN)).toBe(false);
  });

  it("nothing similar: write", () => {
    expect(decideSource(incoming(), [], PRIORITY, OWN)).toEqual({ action: "write", supersedes: [] });
  });

  it("a note already in the CRM from another tool is never doubled, even by the preferred tool", () => {
    const d = decideSource(incoming(), [seen({ provider: "zoom", status: "saved" })], PRIORITY, OWN);
    expect(d).toEqual({ action: "duplicate", of: "m-zoom", reason: "already_in_crm" });
    expect(decideSource(incoming(), [seen({ provider: "zoom", status: "dry_run" })], PRIORITY, OWN).action).toBe("duplicate");
  });

  it("a lower-priority copy arriving after the preferred one is a duplicate", () => {
    const d = decideSource(incoming({ provider: "zoom" }), [seen({ provider: "fathom" })], PRIORITY, OWN);
    expect(d).toEqual({ action: "duplicate", of: "m-fathom", reason: "preferred_tool_has_it" });
  });

  it("the preferred tool arriving after a waiting lower-priority copy wins and supersedes it", () => {
    const d = decideSource(incoming(), [seen({ provider: "zoom" })], PRIORITY, OWN);
    expect(d).toEqual({ action: "write", supersedes: ["m-zoom"] });
  });

  it("the person's own order changes which tool wins", () => {
    const zoomFirst = ["zoom", "fathom", "google_meet"];
    expect(decideSource(incoming(), [seen({ provider: "zoom" })], zoomFirst, OWN)).toEqual({ action: "duplicate", of: "m-zoom", reason: "preferred_tool_has_it" });
    expect(rankOf("zoom", zoomFirst)).toBe(0);
    expect(rankOf("unknown", zoomFirst)).toBe(3);
  });

  it("copies that were dismissed or already marked duplicate are ignored", () => {
    expect(decideSource(incoming(), [seen({ provider: "zoom", status: "skipped" }), seen({ provider: "google_meet", status: "duplicate", id: "x" })], PRIORITY, OWN)).toEqual({ action: "write", supersedes: [] });
  });

  it("a priority list is cleaned: unknown tools dropped, repeats removed, missing tools added in the default order", () => {
    expect(cleanPriority(["zoom", "zoom", "evil", 5])).toEqual(["zoom", "fathom", "google_meet"]);
    expect(cleanPriority(null)).toEqual(["fathom", "zoom", "google_meet"]);
  });
});

const policy = (over: Record<string, unknown> = {}) => readFlags(over);
const CHOICES = (over: Partial<PersonChoices> = {}): PersonChoices => ({ ...DEFAULT_CHOICES, ...over });

describe("account setup over the person's choices: allowed destinations, defaults, locks, company above account", () => {
  it("a person who never chose gets the account's default layout; one who chose keeps it", () => {
    const p = policy({ defaults: { preset: "summary_only" } });
    expect(effectiveChoices(CHOICES(), p).choices.preset).toBe("summary_only");
    expect(effectiveChoices(CHOICES({ preset: "full_record", presetChosen: true }), p).choices.preset).toBe("full_record");
    expect(effectiveChoices(CHOICES(), DEFAULT_POLICY).choices.preset).toBe("recommended");
  });

  it("a locked layout cannot be changed by the person: their own is ignored and the lock is reported", () => {
    const p = policy({ defaults: { preset: "summary_only" }, locked: ["preset"] });
    const r = effectiveChoices(CHOICES({ preset: "full_record", presetChosen: true }), p);
    expect(r.choices.preset).toBe("summary_only");
    expect(r.locked.preset).toBe(true);
    expect(r.locked.unmatchedMode).toBe(false);
  });

  it("locking destinations removes the Custom table and its layout but keeps the ready-made layouts", () => {
    const p = policy({ locked: ["destinations"], defaults: { preset: "recommended" } });
    const custom = effectiveChoices(CHOICES({ preset: "custom", presetChosen: true, custom: { summary: "field" }, template: "{summary}" }), p);
    expect(custom.choices.preset).toBe("recommended");
    expect(custom.choices.template).toBeNull();
    expect(custom.locked.destinations).toBe(true);
    expect(effectiveChoices(CHOICES({ preset: "full_record", presetChosen: true }), p).choices.preset).toBe("full_record");
  });

  it("a layout of the person's own counts only with the Custom table", () => {
    expect(effectiveChoices(CHOICES({ preset: "recommended", presetChosen: true, template: "{summary}" }), DEFAULT_POLICY).choices.template).toBeNull();
    expect(effectiveChoices(CHOICES({ preset: "custom", presetChosen: true, template: "{summary}" }), DEFAULT_POLICY).choices.template).toBe("{summary}");
  });

  it("locked unmatched-call handling and source order are the admin's values", () => {
    const p = policy({ locked: ["unmatchedMode", "sourcePriority"], defaults: { unmatchedMode: "discard", sourcePriority: ["zoom", "fathom"] } });
    const r = effectiveChoices(CHOICES({ unmatchedMode: "inbox", sourcePriority: ["fathom"] }), p);
    expect(r.choices.unmatchedMode).toBe("discard");
    expect(r.choices.sourcePriority).toEqual(["zoom", "fathom", "google_meet"].slice(0, 2));
    expect(r.locked.unmatchedMode && r.locked.sourcePriority).toBe(true);
  });

  it("the company's default sits above the account's: a company lock beats the account's value, otherwise the account's own default wins", () => {
    const company = { locked: ["preset"], defaults: { preset: "summary_only", unmatchedMode: "inbox" } };
    const account = { defaults: { preset: "full_record", unmatchedMode: "discard" } };
    const eff = effectivePolicy(company, account);
    expect(eff.defaults.preset).toBe("summary_only");
    expect(eff.defaults.unmatchedMode).toBe("discard");
    expect(eff.locked).toContain("preset");
    // the company default fills a gap the account left
    expect(effectivePolicy({ defaults: { preset: "full_record" } }, {}).defaults.preset).toBe("full_record");
    // and an account can never unlock what the company locked
    expect(effectivePolicy({ locked: ["destinations"] }, { locked: [] }).locked).toContain("destinations");
    expect(stricter(readFlags(company), readFlags(account)).defaults.preset).toBe("summary_only");
  });

  it("a stored policy with junk in the new keys falls back to 'not set'", () => {
    const f = readFlags({ defaults: { preset: "custom", unmatchedMode: "elsewhere", sourcePriority: ["nope"] } });
    expect(f.defaults).toEqual({ preset: null, unmatchedMode: null, sourcePriority: null });
    expect(readFlags(null).defaults).toEqual({ preset: null, unmatchedMode: null, sourcePriority: null });
  });

  it("a destination the admin did not allow becomes SubSync only, with the reason", () => {
    const m: Matrix = { ...REC, summary: "comment", action_items: "field" };
    const r = clipChoices(m, policy({ destinations: ["note"] }), true);
    expect(r.items.summary).toBe("subsync_only");
    expect(r.items.action_items).toBe("subsync_only");
    expect(r.clips.map((c) => c.because).join(" ")).toMatch(/conversation comments are not allowed by your admin/);
  });

  it("a Contact field row needs an enabled mapping for that item, and a transcript can never go into a field", () => {
    const allowed = policy({ destinations: ["note", "comment", "field"], allowTranscripts: true });
    const m: Matrix = { ...REC, action_items: "field", summary: "field", transcript: "field" };
    const r = clipChoices(m, allowed, true, { fieldItems: ["action_items"] });
    expect(r.items.action_items).toBe("field");
    expect(r.items.summary).toBe("subsync_only");
    expect(r.items.transcript).toBe("subsync_only");
    expect(r.clips.find((c) => c.item === "summary")!.because).toBe("your admin has not set up a contact field for this");
  });

  it("without the permission to add comments, a comment row becomes SubSync only and says Needs permission", () => {
    const r = clipChoices({ ...REC, summary: "comment" }, policy({ destinations: ["note", "comment"] }), true, { canComment: false });
    expect(r.items.summary).toBe("subsync_only");
    expect(r.clips[0].because).toContain("Needs permission: reconnect");
  });

  it("a transcript is written only when the person turned it on AND the account allows it", () => {
    const on = matrixFor("full_record", null);
    expect(clipChoices(on, policy({ allowTranscripts: false }), true).items.transcript).toBe("subsync_only");
    expect(clipChoices(on, policy({ allowTranscripts: true }), true).items.transcript).toBe("comment");
    // the person did not turn it on: the account allowing it changes nothing
    expect(clipChoices(matrixFor("recommended", null), policy({ allowTranscripts: true }), true).items.transcript).toBe("off");
    // and the company layer wins when it says no
    expect(clipChoices(on, effectivePolicy({ allowTranscripts: false }, { allowTranscripts: true }), true).items.transcript).toBe("subsync_only");
  });

  it("only what the person chose is asked of the meeting tool: no transcript unless it is going into the CRM", () => {
    expect(wantedContent(matrixFor("recommended", null))).toEqual({ summary: true, actionItems: true, transcript: false });
    expect(wantedContent(matrixFor("full_record", null))).toEqual({ summary: true, actionItems: true, transcript: true });
    expect(wantedContent({ ...REC, summary: "off", action_items: "off" })).toEqual({ summary: false, actionItems: false, transcript: false });
    expect(wantedContent({ ...REC, transcript: "subsync_only" }).transcript).toBe(false);
    // clipped by the account: asks for no transcript at all
    expect(wantedContent(clipChoices(matrixFor("full_record", null), policy({ allowTranscripts: false }), true).items).transcript).toBe(false);
  });
});
