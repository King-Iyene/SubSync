import test from "node:test";
import assert from "node:assert/strict";
import { csvOf, parseMute, parseTargetMinutes, receiptCsv, receiptOf, receiptText, setupItems, type ReceiptFacts } from "../analytics/clients-actions.ts";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const facts = (o: Partial<ReceiptFacts> = {}): ReceiptFacts => ({
  locationId: "xtest-a", name: "Summit HVAC", newContacts: 12, leads: 10, answered: 9, answeredInTarget: 7, targetMinutes: 15,
  appointments: { held: 5, showed: 3, noShow: 1, unmarked: 1 }, deals: { started: 4, startedValue: 8000, won: 2, wonValue: 5000, lost: 1 }, ...o,
});

test("receipt: real counts, a share only with enough leads", () => {
  const r = receiptOf(facts(), NOW);
  assert.equal(r.lines.find((l) => l.id === "replies")?.value, "70%");
  assert.equal(receiptOf(facts({ leads: 3, answeredInTarget: 3 }), NOW).lines.find((l) => l.id === "replies")?.value, "Not enough yet");
  assert.equal(r.empty, false);
  assert.equal(r.to, "2026-11-10"); assert.equal(r.from, "2026-11-03");
});

test("receipt: an empty week says so and never a made-up number", () => {
  const e = receiptOf(facts({ newContacts: 0, leads: 0, answered: 0, answeredInTarget: 0, appointments: { held: 0, showed: 0, noShow: 0, unmarked: 0 }, deals: { started: 0, startedValue: 0, won: 0, wonValue: 0, lost: 0 } }), NOW);
  assert.equal(e.empty, true);
  assert.match(receiptText(e, null), /No activity was recorded/);
});

test("copy-for-client text has no fee, no product name; the agency brand only", () => {
  const t = receiptText(receiptOf(facts(), NOW), "Acme Agency");
  assert.match(t, /Prepared by Acme Agency/);
  assert.doesNotMatch(t, /SubSync|GoHighLevel|HighLevel|fee/i);
  assert.doesNotMatch(receiptText(receiptOf(facts(), NOW), null), /Prepared by/);
});

test("csv blocks formula injection and quotes commas", () => {
  assert.equal(csvOf([["=cmd|' /C calc'!A0", "a,b", null]]), `'=cmd|' /C calc'!A0,"a,b",\r\n`);
  const csv = receiptCsv([receiptOf(facts({ name: "=HYPERLINK(1)" }), NOW)]);
  assert.ok(csv.split("\r\n")[1].startsWith("'=HYPERLINK(1),"));
});

test("mute and target input", () => {
  assert.equal(parseMute({ kind: "replies", days: 14 }).ok, true);
  assert.equal(parseMute({ kind: "everything", days: 14 }).ok, false);
  assert.equal(parseMute({ kind: "all", days: 3 }).ok, false);
  assert.equal(parseTargetMinutes(30).ok, true);
  assert.equal(parseTargetMinutes("45").ok, true);
  assert.deepEqual(parseTargetMinutes(null), { ok: true, minutes: null });
  for (const bad of [0, 1441, 1.5, "abc", undefined, {}, "12; drop"]) assert.equal(parseTargetMinutes(bad).ok, false);
});

test("setup health uses the exact words and never blurs unavailable", () => {
  const items = setupItems({ appointmentsAccess: "needs_permission", usersAccess: "ok", contactsSyncedAt: NOW - 3 * 86_400_000, appointmentsSyncedAt: null }, NOW);
  assert.equal(items.find((i) => i.id === "appointments")?.fix, "reconnect");
  assert.match(items.find((i) => i.id === "appointments")?.text ?? "", /^Needs permission: reconnect/);
  assert.match(items.find((i) => i.id === "sync")?.text ?? "", /3 days ago/);
  assert.equal(setupItems({ appointmentsAccess: "ok", usersAccess: "ok", contactsSyncedAt: NOW - 3600_000, appointmentsSyncedAt: NOW }, NOW).every((i) => i.ok), true);
  assert.equal(setupItems({ appointmentsAccess: null, usersAccess: null, contactsSyncedAt: null, appointmentsSyncedAt: null }, NOW)[0].fix, "wait");
});

import { BULK_CAP, bulkPreviewLine, parseBulk, parseOwner } from "../analytics/clients-actions.ts";
test("bulk: preview first, capped, validated", () => {
  const ids = ["a1x", "b2x"];
  assert.equal(parseBulk({ what: "mute", muteKind: "replies", locations: ids, days: 7 }).ok, true);
  assert.equal(parseBulk({ what: "mute", locations: ids, days: 7 }).ok, false);
  const t = parseBulk({ what: "target", locations: ids, minutes: 20 });
  assert.ok(t.ok && t.step === "preview");
  assert.equal(parseBulk({ what: "target", locations: Array.from({ length: BULK_CAP + 1 }, (_, i) => `id${i}x`), minutes: 20 }).ok, false);
  assert.equal(parseBulk({ what: "target", locations: [], minutes: 20 }).ok, false);
  assert.equal(parseBulk({ what: "owner", locations: ids, name: "<b>x" }).ok, false);
  assert.equal(parseOwner("  Sam   Lee ").ok && (parseOwner("  Sam   Lee ") as { name: string }).name, "Sam Lee");
  assert.match(bulkPreviewLine({ kind: "target", minutes: 20 }, 2), /20 minutes on 2 clients/);
});
