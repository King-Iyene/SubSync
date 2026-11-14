import assert from "node:assert/strict";
import { test } from "node:test";
import { hasNoActivity, noPeopleReason, noRoleLine, parseRoleSet, roleSetValues, suggestionProgress, todaySentence, NEEDS_PERMISSION_LINE, NO_OWNER_LINE } from "../people/team-empty.ts";
import { matchesRole, MIN_SUGGEST, suggestRole } from "../people/roles.ts";

test("an empty team says why: no permission to read it, or nobody has an owner", () => {
  const perm = noPeopleReason({ usersState: "needs_permission", people: 0 });
  assert.ok(perm);
  assert.equal(perm.title, NEEDS_PERMISSION_LINE);
  assert.match(perm.title, /^Needs permission: reconnect/);
  const none = noPeopleReason({ usersState: "ok", people: 0 });
  assert.ok(none);
  assert.match(none.body, new RegExp(NO_OWNER_LINE.slice(0, 40)));
  const unknown = noPeopleReason({ usersState: "unknown", people: 0 });
  assert.ok(unknown, "an unknown permission state still explains itself");
});

test("a roster with people has no empty reason, with or without the users permission", () => {
  assert.equal(noPeopleReason({ usersState: "ok", people: 25 }), null);
  assert.equal(noPeopleReason({ usersState: "needs_permission", people: 3 }), null, "people derived from activity still show");
});

test("the happy sentence is only said when people were checked", () => {
  const ok = todaySentence({ things: 0, people: 25, accounts: 3, self: false });
  assert.equal(ok.kind, "ok");
  assert.match(ok.text, /^Nothing needs you right now\./);
  assert.match(ok.text, /25 people in 3 accounts/);
  const nobody = todaySentence({ things: 0, people: 0, accounts: 3, self: false });
  assert.equal(nobody.kind, "nobody");
  assert.doesNotMatch(nobody.text, /Nothing needs you/);
  assert.equal(todaySentence({ things: 2, people: 25, accounts: 3, self: false }).text, "2 things need you today.");
  assert.equal(todaySentence({ things: 1, people: 25, accounts: 1, self: true }).text, "One thing needs you.");
  assert.equal(todaySentence({ things: 0, people: 1, accounts: 1, self: true }).text, "Nothing needs you right now.");
  assert.match(todaySentence({ things: 0, people: 1, accounts: 1, self: false }).text, /1 person in 1 account:/);
});

test("a person with no counts is told so in words", () => {
  assert.equal(hasNoActivity({ touches: 0, answered: 0, appts: 0, won: 0, lost: 0, held: 0, noShow: 0 }), true);
  assert.equal(hasNoActivity({ touches: 0, answered: 0, appts: 1, won: 0, lost: 0, held: 0, noShow: 0 }), false);
});

test("the banner counts people with no role and disappears when everyone has one", () => {
  assert.equal(noRoleLine(25), "25 people have no role set.");
  assert.equal(noRoleLine(1), "1 person has no role set.");
  assert.equal(noRoleLine(0), null);
});

test("role chips map to the labels they let through", () => {
  assert.equal(parseRoleSet("all"), null);
  assert.equal(parseRoleSet(""), null);
  assert.equal(parseRoleSet("nonsense"), null, "an unknown value is no filter, never an error");
  assert.equal(parseRoleSet("setters"), "setters");
  assert.deepEqual(roleSetValues("setters").roles, ["setter", "both"]);
  assert.deepEqual(roleSetValues("closers").roles, ["closer", "both"]);
  assert.deepEqual(roleSetValues("manager").roles, ["manager"]);
  assert.deepEqual(roleSetValues("none"), { roles: [], orNone: true });
  assert.equal(matchesRole("both", "setters"), true);
  assert.equal(matchesRole(null, "setters"), false);
});

test("suggestions need the minimum activity and say how far a person is from it", () => {
  assert.equal(MIN_SUGGEST, 8);
  assert.equal(suggestRole({ booked: 3, attended: 0, days: 90 }), null, "3 actions is not enough to label anyone");
  assert.equal(suggestRole({ booked: 4, attended: 3, days: 90 }), null, "7 actions is one short");
  assert.equal(suggestionProgress(3, MIN_SUGGEST), "3 of 8 actions so far");
  const s = suggestRole({ booked: 9, attended: 0, days: 90 });
  assert.equal(s?.role, "setter");
  assert.match(s?.why ?? "", /9 appointments booked/);
  assert.equal(suggestRole({ booked: 0, attended: 9, days: 90 })?.role, "closer");
  assert.equal(suggestRole({ booked: 6, attended: 6, days: 90 })?.role, "both");
});
