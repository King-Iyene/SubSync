import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { UNSEEN, confirmReady, consequence, consequenceText, copyImpacts, diffRows, fieldRows, type DetailPerson } from "../dq/dupe-impact.ts";
import { pickMaster, type MasterPerson } from "../dq/master-rank.ts";

const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const P = (id: string, o: Partial<MasterPerson & DetailPerson> = {}): MasterPerson & DetailPerson => ({ contactId: id, name: `Name ${id}`, email: `${id}@x.org`, phone: "+1555", tags: [], createdAt: `2026-01-0${id.length}T00:00:00Z`, openDeals: 0, wonDeals: 0, hasConversation: false, ...o });
const ALL_READ: [] = [];

test("master: unreadable payments/automations/courses means NO pre-selection, ever", () => {
  const r = pickMaster([P("a", { wonDeals: 2 }), P("b")]);
  assert.equal(r.suggestedId, null);
  assert.equal(r.mustChoose, true);
  assert.match(r.why ?? "", /cannot see payments, automations or courses/);
});

test("master: when everything is readable the highest tier wins, in the written order", () => {
  assert.equal(pickMaster([P("a", { payments: true }), P("b", { wonDeals: 3, hasConversation: true })].map((p) => ({ ...p, payments: p.payments ?? false })), ALL_READ).suggestedId, "a");
  assert.equal(pickMaster([P("a", { hasConversation: true }), P("b", { openDeals: 1 })], ALL_READ).suggestedId, "b");
  assert.equal(pickMaster([P("a", { appointments: 2 }), P("b", { hasConversation: true })], ALL_READ).suggestedId, "a");
});

test("master: two copies in the same top tier is a tie, nobody is pre-selected", () => {
  const r = pickMaster([P("a", { payments: true }), P("b", { payments: true })], ALL_READ);
  assert.equal(r.suggestedId, null);
  assert.equal(r.why, "Both copies have an ongoing payment or subscription: choose the master yourself.");
  assert.match(pickMaster([P("a", { openDeals: 1 }), P("b", { wonDeals: 1 })], ALL_READ).why ?? "", /Both copies have a deal/);
});

test("master: completeness then oldest decide only when no top signal; a full tie asks the person", () => {
  assert.equal(pickMaster([P("a", { phone: null }), P("bb")], ALL_READ).suggestedId, "bb");
  assert.equal(pickMaster([P("a", { createdAt: "2026-02-01T00:00:00Z" }), P("bb", { createdAt: "2026-01-01T00:00:00Z" })], ALL_READ).suggestedId, "bb");
  const tie = pickMaster([P("a", { createdAt: "2026-01-01T00:00:00Z" }), P("b", { createdAt: "2026-01-01T00:00:00Z" })], ALL_READ);
  assert.equal(tie.suggestedId, null);
  assert.equal(pickMaster([P("a", { createdAt: null }), P("b", { createdAt: null })], ALL_READ).suggestedId, null);
});

test("master: never random, never first: input order does not change the answer", () => {
  const xs = [P("a", { hasConversation: true }), P("bb", { openDeals: 1 }), P("ccc")];
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0]]) assert.equal(pickMaster(order.map((i) => xs[i]), ALL_READ).suggestedId, "bb");
  assert.equal(pickMaster([...xs].reverse()).suggestedId, null);
});

test("master: tags are a labelled weak hint and never decide", () => {
  const r = pickMaster([P("a", { tags: ["Subscriber"], createdAt: "2026-05-01T00:00:00Z" }), P("bb")], ALL_READ);
  assert.ok(r.copies[0].hints[0].includes("a tag, not a payment record"));
  assert.equal(r.suggestedId, "bb"); // completeness/age decided, not the tag
  assert.ok(r.copies[0].line.length > 0);
});

test("rows: every fact is a row, unreadable ones are null (never blank, never zero), names exact", () => {
  const rows = fieldRows(P("a", { name: "McDONALD, jo" }));
  assert.equal(rows.find((r) => r.id === "name")?.value, "McDONALD, jo");
  const unseen = rows.filter((r) => r.value === null).map((r) => r.id);
  for (const id of ["pay", "inv", "wf", "camp", "course", "notes", "oppowner", "cf"]) assert.ok(unseen.includes(id), id);
  for (const id of ["name", "phone", "email", "owner", "source", "tags", "created", "last", "conv", "open", "won", "next", "appts", "dnd"]) assert.ok(rows.some((r) => r.id === id && r.value !== null), id);
  assert.match(UNSEEN, /needs permission/);
});

test("diff shows only readable facts that differ", () => {
  const d = diffRows([P("a", { phone: "1" }), P("b", { phone: "2" })]);
  assert.ok(d.some((r) => r.id === "phone"));
  assert.ok(!d.some((r) => r.id === "pay"));
  assert.ok(!d.some((r) => r.id === "won"));
});

test("consequence names the primary, counts moves, lists what cannot move, flags risks", () => {
  const c = consequence([P("a", { tags: ["x"] }), P("bb", { tags: ["x", "y"], openDeals: 1, openValue: 900, hasConversation: true, appointments: 1, nextAppointmentAt: "2026-12-24T10:00:00Z", dnd: true })], "a")!;
  const t = consequenceText(c);
  assert.match(t, /keep Name a;/);
  assert.match(t, /1 tag, 1 deal, 1 conversation, 1 appointment/);
  assert.match(t, /remove Name bb\./);
  assert.match(t, /workflow enrolments, payments and subscriptions, course access/);
  assert.equal(c.risks.length, 3);
  assert.equal(consequence([P("a")], "zzz"), null);
});

test("confirm gating: needs a primary, the tick AND the typed words", () => {
  const ok = { typedOk: true, ticked: true, primaryId: "a", busy: false };
  assert.equal(confirmReady(ok), true);
  assert.equal(confirmReady({ ...ok, ticked: false }), false);
  assert.equal(confirmReady({ ...ok, typedOk: false }), false);
  assert.equal(confirmReady({ ...ok, primaryId: null }), false);
  assert.equal(confirmReady({ ...ok, busy: true }), false);
});

test("delete impact: protected copies say exactly why, and nothing is deletable when all are protected", () => {
  const imp = copyImpacts([P("a"), P("bb", { dnd: true }), P("ccc", { openDeals: 1, openValue: 500 })], "a");
  assert.match(imp[1].cannotDelete[0], /^Do Not Disturb: we never delete this person so consent is not lost/);
  assert.match(imp[2].cannotDelete[0], /^Has an open deal \$500/);
  assert.ok(imp.filter((i) => i.role === "merge").every((i) => !i.canDelete));
  assert.equal(copyImpacts([P("a"), P("bb")], null).every((i) => !i.canDelete), true);
});

test("source guard: CRM words, no old labels, tick gates confirm, no first-copy default", () => {
  const ui = src("src/app/app/views/dq/dq-merge.tsx") + src("src/app/app/views/dq/dq-merge-view.tsx") + src("src/lib/dq/dupe-impact.ts");
  assert.match(ui, /Primary contact \(kept\)/);
  assert.match(ui, /Secondary contact \(will be merged into the primary and removed\)/);
  assert.match(ui, /Make this the primary contact/);
  assert.doesNotMatch(ui, /"Merge in"|Keep this one/);
  assert.match(ui, /confirmReady\(\{ typedOk, ticked, primaryId, busy \}\)/);
  assert.match(ui, /I checked the secondary contacts' payments, bookings and automations/);
  assert.doesNotMatch(src("src/app/app/views/dq/dq-merge.tsx"), /useState\(ids\[0\]\)|keepId: ids\[0\]/);
  assert.match(src("src/app/app/views/dq/dq-merge.tsx"), /testid="dq-merge-confirm"|data-testid="dq-merge-confirm"/);
  assert.doesNotMatch(ui, /toLowerCase\(\)\}<|\.name\.toLowerCase/);
});
