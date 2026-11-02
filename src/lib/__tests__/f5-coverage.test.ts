import assert from "node:assert/strict";
import { test } from "node:test";
import { CAUSE_LABEL, NOT_YET, notWatchedRows, WATCHING } from "../analytics/coverage.ts";
import { describeHidden, EMPTY_FILTER, scopeOf, type FilterOptions } from "../design/filters.ts";

// Stage F5: the "What SubSync watches" lists (N5) and the filter's plain-words notes about what is hidden (N1).
const INTERNAL = /\b(agenc(y|ies)|sub-?accounts?|locations?|sla|ghl|gohighlevel|highlevel|leadconnector)\b/i;

test("every line says what it is and how; nothing is in both columns", () => {
  assert.ok(WATCHING.length >= 6);
  for (const w of WATCHING) { assert.ok(w.what.length > 5, w.id); assert.ok(w.how.length > 20, w.id); }
  const ids = [...WATCHING.map((w) => w.id), ...NOT_YET.map((n) => n.id)];
  assert.equal(new Set(ids).size, ids.length, "an id appears twice");
  const whats = [...WATCHING.map((w) => w.what), ...NOT_YET.map((n) => n.what)];
  assert.equal(new Set(whats.map((w) => w.toLowerCase())).size, whats.length, "the same thing is listed as watched and not watched");
});

test("every not-yet line names which of the three causes holds, and the reason is in plain words", () => {
  assert.deepEqual(Object.keys(CAUSE_LABEL).sort(), ["not_built", "permission", "platform"]);
  for (const n of NOT_YET) {
    assert.ok(n.cause in CAUSE_LABEL, n.id);
    assert.ok(n.why.length > 20, n.id);
  }
  // The four things the old Today card listed are all still listed, in the same words (they have not shipped).
  assert.deepEqual(NOT_YET.map((n) => n.what), ["Missed calls", "Failing workflows", "Low wallet balance and failed payments", "Phone registration (A2P) status"]);
  assert.equal(notWatchedRows().length, 4, "the daily endpoint keeps its four rows (scripts/check-api.ts)");
});

test("no line uses the platform's name or our internal words", () => {
  for (const t of [...WATCHING.flatMap((w) => [w.what, w.how, w.needs ?? ""]), ...NOT_YET.flatMap((n) => [n.what, n.why]), ...Object.values(CAUSE_LABEL)]) {
    assert.doesNotMatch(t, INTERNAL, t);
  }
});

const options = (): FilterOptions => ({
  accounts: [
    { id: "acc0001", name: "Acme Roofing" },
    { id: "acc0002", name: "KD Squares Test", test: true },
    { id: "acc0003", name: "Demo Clinic", test: true },
    { id: "acc0004", name: "Old Client", ignored: true },
  ],
  testAccounts: 2, industries: [{ key: "clinic", label: "Clinics" }],
});

test("hiding test accounts says WHICH accounts are hidden, by name, and how to show them", () => {
  const notes = describeHidden({ ...EMPTY_FILTER, hideTest: true }, options());
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "2 test accounts are hidden because their name says test: KD Squares Test and Demo Clinic.");
  assert.deepEqual(notes[0].clear, { hideTest: false });
  const one = describeHidden({ ...EMPTY_FILTER, hideTest: true }, { accounts: [{ id: "acc0002", name: "KD Squares Test", test: true }], testAccounts: 1 });
  assert.equal(one[0].text, "1 test account is hidden because its name says test: KD Squares Test.");
  // Nothing hidden when the switch is off, and no names invented when the options carry none.
  assert.deepEqual(describeHidden(EMPTY_FILTER, options()), []);
  assert.equal(describeHidden({ ...EMPTY_FILTER, hideTest: true }, { testAccounts: 3 })[0].text, "3 test accounts are hidden because their name says test.");
});

test("a test account that is also set to ignore is listed once as ignored, never as a hidden test account", () => {
  const o: FilterOptions = { accounts: [{ id: "acc0002", name: "KD Squares Test", test: true, ignored: true }, { id: "acc0001", name: "Acme" }], testAccounts: 0 };
  assert.deepEqual(describeHidden({ ...EMPTY_FILTER, hideTest: true }, o), []);
  assert.equal(scopeOf({ ...EMPTY_FILTER, hideTest: true }, o).left[0].reason, "set to ignore, never counted");
});

test("the account list says which are left out and why", () => {
  const s = scopeOf({ ...EMPTY_FILTER, hideTest: true }, options());
  assert.deepEqual(s.included.map((a) => a.name), ["Acme Roofing"]);
  assert.deepEqual(s.left.map((a) => [a.name, a.reason]), [["KD Squares Test", "test account, hidden"], ["Demo Clinic", "test account, hidden"], ["Old Client", "set to ignore, never counted"]]);
});

test("one client account in scope is the whole filter: the way Today opens on the account SubSync was launched from", () => {
  const s = scopeOf({ ...EMPTY_FILTER, accounts: ["acc0001"] }, options());
  assert.deepEqual(s.included.map((a) => a.name), ["Acme Roofing"]);
  assert.equal(s.left.length, 3);
  assert.ok(s.left.some((a) => a.reason === "not picked"));
});
