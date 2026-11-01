import assert from "node:assert/strict";
import { test } from "node:test";
import { BULK_IMPORT_MINUTE, clockStart, excludeReason, validZone, type LeadContact, type LeadContext } from "../analytics/lead-rules.ts";

const person: LeadContact = { fullName: "Amara Obi", email: "amara@homes.test.ng", tags: ["buyer"], source: "Facebook Lead Form", dnd: false };
const alone: LeadContext = { createdTogether: 1, earlierDuplicate: false };
const reason = (c: Partial<LeadContact>, ctx: Partial<LeadContext> = {}) => excludeReason({ ...person, ...c }, { ...alone, ...ctx });

test("a normal new contact is a lead", () => {
  assert.equal(reason({}), null);
  assert.equal(reason({ source: null, tags: [], fullName: null, email: null }), null, "missing fields are not a reason to leave a lead out");
});

test("bulk imports are not leads: by source, by tag, or by arriving in one minute", () => {
  assert.equal(reason({ source: "CSV upload" }), "import");
  assert.equal(reason({ source: "bulk action" }), "import");
  assert.equal(reason({ tags: ["Imported 2026"] }), "import");
  assert.equal(reason({}, { createdTogether: BULK_IMPORT_MINUTE }), "import");
  assert.equal(reason({}, { createdTogether: BULK_IMPORT_MINUTE - 1 }), null, "19 in a minute is still people");
  assert.equal(reason({ source: "Importance Realty form" }), null, "a word that only starts with 'import' is not an import");
});

test("spam, test contacts, and people who asked not to be contacted are not leads", () => {
  assert.equal(reason({ tags: ["spam"] }), "spam");
  assert.equal(reason({ source: "junk" }), "spam");
  assert.equal(reason({ fullName: "Test Lead" }), "test");
  assert.equal(reason({ tags: ["demo"] }), "test");
  assert.equal(reason({ email: "someone@mailinator.com" }), "test");
  assert.equal(reason({ email: "someone@example.com" }), null, "example.com is the placeholder address in sample data, not a signal on its own");
  assert.equal(reason({ dnd: true }), "dnd");
});

test("a name that only contains 'test' inside a word is a real person", () => {
  assert.equal(reason({ fullName: "Contest Winners Ltd" }), null);
  assert.equal(reason({ fullName: "Attestation Law" }), null);
});

test("a merged or repeated contact is counted once: only the earlier one is a lead", () => {
  assert.equal(reason({}, { earlierDuplicate: true }), "duplicate");
});

test("when several reasons apply the first in the list wins, so the screen explains one", () => {
  assert.equal(reason({ source: "csv", tags: ["spam"], dnd: true }, { earlierDuplicate: true }), "import");
  assert.equal(reason({ tags: ["spam"], fullName: "Test", dnd: true }), "spam");
  assert.equal(reason({ dnd: true }, { earlierDuplicate: true }), "dnd");
});

// ---- business hours. 31 Oct 2026 is a Saturday; the United States moved its clocks back on Sunday 1 Nov 2026.
const at = (iso: string) => Date.parse(iso);
const OFFICE = { open: 9, close: 17 };

test("with business hours off, the clock starts when the lead arrives", () => {
  const t = at("2026-10-31T14:00:00Z");
  assert.equal(clockStart(t, "Africa/Lagos", null), t);
  assert.equal(clockStart(t, "Africa/Lagos", { open: 9, close: 9 }), t, "an empty window is treated as off");
});

test("a lead during opening hours starts at its own time", () => {
  const t = at("2026-11-03T10:00:00Z"); // Tuesday 11:00 in Lagos
  assert.equal(clockStart(t, "Africa/Lagos", OFFICE), t);
});

test("a lead before opening waits for today's opening; after closing, for the next morning", () => {
  assert.equal(clockStart(at("2026-11-02T06:00:00Z"), "Africa/Lagos", OFFICE), at("2026-11-02T08:00:00Z"), "Monday 07:00 Lagos -> Monday 09:00 Lagos");
  assert.equal(clockStart(at("2026-11-03T16:00:00Z"), "Africa/Lagos", OFFICE), at("2026-11-04T08:00:00Z"), "Tuesday 17:00 Lagos (closing) -> Wednesday 09:00");
});

test("a weekend lead starts on Monday morning", () => {
  assert.equal(clockStart(at("2026-10-31T14:00:00Z"), "Africa/Lagos", OFFICE), at("2026-11-02T08:00:00Z"), "Saturday afternoon");
  assert.equal(clockStart(at("2026-11-01T22:00:00Z"), "Africa/Lagos", OFFICE), at("2026-11-02T08:00:00Z"), "Sunday night");
  assert.equal(clockStart(at("2026-10-30T17:30:00Z"), "Africa/Lagos", OFFICE), at("2026-11-02T08:00:00Z"), "Friday 18:30 Lagos");
});

test("time zones, including a daylight-saving change over the weekend", () => {
  // Friday 30 Oct 18:00 in New York (EDT, UTC-4) -> Monday 2 Nov 09:00 (EST, UTC-5) = 14:00 UTC
  assert.equal(clockStart(at("2026-10-30T22:00:00Z"), "America/New_York", OFFICE), at("2026-11-02T14:00:00Z"));
  // Sunday 1 Nov 10:00 EST -> Monday 09:00 EST
  assert.equal(clockStart(at("2026-11-01T15:00:00Z"), "America/New_York", OFFICE), at("2026-11-02T14:00:00Z"));
  // The same instant is inside opening hours in London and outside them in Los Angeles.
  const t = at("2026-11-03T10:30:00Z");
  assert.equal(clockStart(t, "Europe/London", OFFICE), t);
  assert.equal(clockStart(t, "America/Los_Angeles", OFFICE), at("2026-11-03T17:00:00Z"), "02:30 in LA -> 09:00 in LA");
});

test("an unknown or missing time zone is treated as UTC rather than failing", () => {
  assert.equal(validZone("Not/AZone"), "UTC");
  assert.equal(validZone(null), "UTC");
  assert.equal(clockStart(at("2026-11-03T22:00:00Z"), null, OFFICE), at("2026-11-04T09:00:00Z"));
  assert.equal(clockStart(at("2026-11-03T22:00:00Z"), "Not/AZone", OFFICE), at("2026-11-04T09:00:00Z"));
});
