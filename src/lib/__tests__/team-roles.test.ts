import assert from "node:assert/strict";
import { test } from "node:test";
import { bookedByLabel, hasSetterCloser, indexRoles, isRoleId, matchesRole, MIN_SUGGEST, planRoleChange, previewLine, resolveRole, ROLE_IDS, ROLE_LABEL, SETTER_CLOSER_TIP, suggestRole, takenByLabel } from "../people/roles.ts";

const idx = indexRoles([
  { userId: "xtest-u1", locationId: "", role: "setter" },
  { userId: "xtest-u1", locationId: "xtestLoc1", role: "closer" },
  { userId: "xtest-u2", locationId: "", role: "both" },
  { userId: "xtest-u3", locationId: "xtestLoc1", role: "manager" },
]);

test("a role resolves to the account's own label first, then the everywhere label, otherwise none", () => {
  assert.equal(resolveRole(idx, "xtest-u1"), "setter");
  assert.equal(resolveRole(idx, "xtest-u1", "xtestLoc2"), "setter", "an account with no label of its own falls back to the default");
  assert.equal(resolveRole(idx, "xtest-u1", "xtestLoc1"), "closer", "the account's own label wins");
  assert.equal(resolveRole(idx, "xtest-u3"), null, "a label for one account is not a default");
  assert.equal(resolveRole(idx, "xtest-u3", "xtestLoc1"), "manager");
  assert.equal(resolveRole(idx, "xtest-nobody", "xtestLoc1"), null);
  assert.equal(resolveRole(idx, null), null);
});

test("filters: setters include people who are both, closers likewise, none is people with no label", () => {
  assert.equal(matchesRole("both", "setters"), true);
  assert.equal(matchesRole("both", "closers"), true);
  assert.equal(matchesRole("setter", "closers"), false);
  assert.equal(matchesRole(null, "none"), true);
  assert.equal(matchesRole("support", "none"), false);
  assert.equal(matchesRole("support", "support"), true);
  assert.equal(matchesRole(null, "all"), true);
});

test("a stored value that is not one of the six roles is ignored", () => {
  assert.equal(isRoleId("admin"), false);
  assert.equal(isRoleId("setter"), true);
  assert.equal(ROLE_IDS.length, 6);
  const bad = indexRoles([{ userId: "xtest-u9", locationId: "", role: "boss" as never }]);
  assert.equal(resolveRole(bad, "xtest-u9"), null);
});

test("the suggestion is an estimate with its evidence, never from too little data", () => {
  assert.equal(suggestRole({ booked: 3, attended: 2, days: 90 }), null, `under ${MIN_SUGGEST} appointments says nothing`);
  const setter = suggestRole({ booked: 30, attended: 2, days: 90 });
  assert.equal(setter?.role, "setter");
  assert.equal(setter?.estimate, true);
  assert.match(setter?.why ?? "", /30 appointments booked/);
  assert.equal(suggestRole({ booked: 1, attended: 25, days: 90 })?.role, "closer");
  assert.equal(suggestRole({ booked: 12, attended: 14, days: 90 })?.role, "both");
  assert.equal(suggestRole({ booked: 4, attended: 5, days: 90 }), null, "mixed and small: no guess");
});

test("a bulk change skips people who already have the role and never touches anyone not asked for", () => {
  const cur = new Map<string, "setter" | "closer" | null>([["xtest-u1", "setter"], ["xtest-u2", null]]);
  const p = planRoleChange(cur, ["xtest-u1", "xtest-u2", "xtest-u2", "xtest-u3"], "setter", "");
  assert.deepEqual(p.changes.map((c) => [c.userId, c.from, c.to]), [["xtest-u2", null, "setter"], ["xtest-u3", null, "setter"]]);
  assert.equal(p.unchanged, 1);
  const clear = planRoleChange(cur, ["xtest-u1"], null, "xtestLoc1");
  assert.equal(clear.changes[0].locationId, "xtestLoc1");
  assert.equal(clear.changes[0].to, null);
});

test("the preview says in plain words what happens and that the CRM is untouched", () => {
  const p = planRoleChange(new Map(), ["xtest-u1", "xtest-u2"], "closer", "");
  const line = previewLine(p.changes, p.unchanged, "closer", "everywhere");
  assert.match(line, /2 people/);
  assert.match(line, /Closer/);
  assert.match(line, /Nothing is changed in your CRM/);
  assert.match(previewLine([], 0, "closer", "everywhere"), /Nobody selected/);
});

test("Appointments say 'Booked by' until someone is a setter or closer, then 'Setter' and 'Closer'", () => {
  assert.equal(hasSetterCloser([null, "support", "manager"]), false);
  assert.equal(hasSetterCloser([null, "both"]), true);
  assert.equal(bookedByLabel(false), "Booked by");
  assert.equal(bookedByLabel(true), "Setter");
  assert.equal(takenByLabel(false), "Assigned to");
  assert.equal(takenByLabel(true), "Closer");
  assert.match(SETTER_CLOSER_TIP, /Setter: books the appointment/);
});

test("no vendor words in any role text", () => {
  const all = [...Object.values(ROLE_LABEL), SETTER_CLOSER_TIP].join(" ");
  assert.doesNotMatch(all, /highlevel|gohighlevel|\bghl\b|sub-account/i);
});
