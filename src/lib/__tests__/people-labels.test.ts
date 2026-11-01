import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMER_TEAM_MEMBER, initialsOf, NAME_NOT_LOADED, NEEDS_PERMISSION_LABEL, properCase, resolveUser, safePhotoUrl } from "../analytics/people-labels.ts";

test("names typed all lower or upper case are shown in proper case, and mixed case is left as typed (N30)", () => {
  assert.equal(properCase("the real estate blueprint"), "The Real Estate Blueprint");
  assert.equal(properCase("abbi"), "Abbi");
  assert.equal(properCase("david"), "David");
  assert.equal(properCase("oforiokuma kwani"), "Oforiokuma Kwani");
  assert.equal(properCase("JOHN SMITH"), "John Smith");
  assert.equal(properCase("mary-jane o'brien"), "Mary-Jane O'Brien");
  assert.equal(properCase("a12 t-shirt factory sale in guangzhou"), "A12 T-Shirt Factory Sale in Guangzhou");
  assert.equal(properCase("McDonald"), "McDonald", "mixed case was typed on purpose");
  assert.equal(properCase("KD Squares"), "KD Squares");
  assert.equal(properCase("DeShawn Lee"), "DeShawn Lee");
});

test("joining words stay lower case in the middle of a name, and the first word is always capitalised", () => {
  assert.equal(properCase("ludwig van beethoven"), "Ludwig van Beethoven");
  assert.equal(properCase("the house of the sun"), "The House of the Sun");
});

test("phone numbers, emails and blanks have nothing to fix", () => {
  assert.equal(properCase("(919) 771-6040"), "(919) 771-6040");
  assert.equal(properCase("sam@example.com"), "sam@example.com", "an email address stays as it is");
  assert.equal(properCase("   "), "");
  assert.equal(properCase(null), "");
  assert.equal(properCase(undefined), "");
  assert.equal(properCase("  two   spaces  "), "Two Spaces");
});

test("a person is named from the saved team list; a missing name says why in words and is never the id (N21, S3-a)", () => {
  const known = new Map([["u1", { name: "dana brooks", photoUrl: "https://cdn.example.org/d.png" }], ["u2", { name: "Marcus Lee" }]]);
  const dana = resolveUser("u1", known, "ok");
  assert.deepEqual([dana.label, dana.state, dana.photoUrl, dana.initials], ["Dana Brooks", "named", "https://cdn.example.org/d.png", "DB"]);
  assert.equal(resolveUser("u2", known, null).photoUrl, null, "no picture is fine");
  const gone = resolveUser("ZWolABCDEFGH", known, "ok");
  assert.deepEqual([gone.label, gone.state], [FORMER_TEAM_MEMBER, "former"]);
  const blocked = resolveUser("ZWolABCDEFGH", known, "needs_permission");
  assert.deepEqual([blocked.label, blocked.state], [NEEDS_PERMISSION_LABEL, "needs_permission"]);
  assert.equal(NEEDS_PERMISSION_LABEL, "Needs permission: reconnect");
  for (const state of ["error", null, undefined] as const) {
    const r = resolveUser("ZWolABCDEFGH", known, state);
    assert.deepEqual([r.label, r.state], [NAME_NOT_LOADED, "unavailable"]);
  }
  for (const r of [gone, blocked, resolveUser("ZWolABCDEFGH", known, null)]) {
    assert.ok(!r.label.includes("ZWol") && !/team member [a-z0-9]{4}$/i.test(r.label), "never the id or a placeholder made from it");
  }
});

test("a name that is only spaces does not count as a name", () => {
  const r = resolveUser("u9", new Map([["u9", { name: "   " }]]), "ok");
  assert.equal(r.state, "former");
});

test("initials come from the first and last word, and a picture address must be plain https", () => {
  assert.equal(initialsOf("Dana Brooks"), "DB");
  assert.equal(initialsOf("Cher"), "C");
  assert.equal(initialsOf("Mary Jane Watson"), "MW");
  assert.equal(initialsOf(""), "?");
  assert.equal(safePhotoUrl("https://cdn.example.org/a.png"), "https://cdn.example.org/a.png");
  assert.equal(safePhotoUrl("http://cdn.example.org/a.png"), null, "not https");
  assert.equal(safePhotoUrl("javascript:alert(1)"), null);
  assert.equal(safePhotoUrl("data:image/png;base64,AAAA"), null);
  assert.equal(safePhotoUrl("https://user:pw@cdn.example.org/a.png"), null, "no credentials in an address");
  assert.equal(safePhotoUrl("not a url"), null);
  assert.equal(safePhotoUrl(42), null);
  assert.equal(safePhotoUrl("https://" + "a".repeat(600) + ".com"), null);
});
