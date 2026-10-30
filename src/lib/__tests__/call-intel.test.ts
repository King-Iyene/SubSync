import assert from "node:assert/strict";
import { test } from "node:test";
import { callPriority, parseFilters, parseOutcome, powerHourStats, PRESETS } from "../analytics/call-intel.ts";

const base = { openValue: 0, openCount: 0, wonValue: 0, idleDays: null, dateAddedDays: 200, hasEmail: true, hasPhone: true };

test("filters default to the first preset and reject anything unknown", () => {
  const ok = parseFilters({});
  assert.ok(ok.ok && ok.filters.preset === "hot_uncontacted");
  assert.equal(parseFilters({ preset: "drop table" }).ok, false);
  assert.equal(parseFilters({ preset: "custom", location: "bad id!" }).ok, false);
  assert.equal(parseFilters({ preset: "custom", idleDays: -1 }).ok, false);
  assert.equal(parseFilters({ preset: "custom", idleDays: "abc" }).ok, false);
  assert.equal(parseFilters({ preset: "custom", deal: "maybe" }).ok, false);
  assert.equal(parseFilters({ preset: "custom", tag: "x".repeat(61) }).ok, false);
  const good = parseFilters({ preset: "custom", location: "abc123", tag: " vip ", idleDays: "14", deal: "open" });
  assert.ok(good.ok);
  if (good.ok) assert.deepEqual(good.filters, { preset: "custom", location: "abc123", tag: "vip", idleDays: 14, deal: "open" });
});

test("every preset id can be parsed", () => {
  for (const p of PRESETS) assert.equal(parseFilters({ preset: p.id }).ok, true, p.id);
});

test("outcome input is validated and follow-ups default to three days", () => {
  const ok = parseOutcome({ locationId: "loc123", contactId: "contact1", outcome: "follow_up" });
  assert.ok(ok.ok && ok.value.followUpInDays === 3);
  const booked = parseOutcome({ locationId: "loc123", contactId: "contact1", outcome: "booked", note: "  Tuesday 2pm " });
  assert.ok(booked.ok && booked.value.note === "Tuesday 2pm" && booked.value.followUpInDays === null);
  assert.equal(parseOutcome(null).ok, false);
  assert.equal(parseOutcome({ locationId: "x", contactId: "contact1", outcome: "booked" }).ok, false);
  assert.equal(parseOutcome({ locationId: "loc123", contactId: "contact1", outcome: "ghosted" }).ok, false);
  assert.equal(parseOutcome({ locationId: "loc123", contactId: "contact1", outcome: "booked", note: "x".repeat(501) }).ok, false);
  assert.equal(parseOutcome({ locationId: "loc123", contactId: "contact1", outcome: "follow_up", followUpInDays: 400 }).ok, false);
});

test("priority ranks a new lead with a big open deal above a cold contact", () => {
  const cold = callPriority(base).score;
  const warm = callPriority({ ...base, openCount: 1, openValue: 5000, idleDays: 9 }).score;
  const hot = callPriority({ ...base, openCount: 1, openValue: 50000, idleDays: 9, dateAddedDays: 0 }).score;
  assert.ok(cold < warm && warm < hot, `${cold} ${warm} ${hot}`);
  assert.ok(hot <= 100 && cold >= 0);
});

test("no phone number lowers priority and says why", () => {
  const withPhone = callPriority({ ...base, openCount: 1, openValue: 1000 });
  const without = callPriority({ ...base, openCount: 1, openValue: 1000, hasPhone: false });
  assert.equal(withPhone.score - without.score, 15);
  assert.ok(without.reasons.includes("No phone number"));
});

test("power hour counts calls, reached contacts and bookings", () => {
  const s = powerHourStats([{ outcome: "answered" }, { outcome: "voicemail" }, { outcome: "booked" }, { outcome: "no_answer" }]);
  assert.deepEqual(s, { calls: 4, reached: 2, booked: 1, reachRate: 50 });
  assert.equal(powerHourStats([]).reachRate, null);
});
