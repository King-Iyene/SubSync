import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Person } from "../analytics/dedupe.ts";
import { ONE_BUTTON, BULK_BUTTON, judgeBulkPair, planBulk, skipSummary } from "../dq/bulk-merge.ts";
import { PROTECTED_EXPLAINER } from "../dq/dupe-copies.ts";
import { effectiveTier, namesConflict, namesMatch, withNameNote } from "../dq/dupe-tier.ts";

const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const P = (id: string, name: string, o: Partial<Person> = {}): Person => ({ contactId: id, name, email: "shared@x.org", phone: "+15550100", tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o });
const JORDAN = ["jordan smith", "steve wonders", "jayden anthony", "mike steven"];

test("same email but clearly different names is NOT certain: it is likely, with the reason", () => {
  assert.equal(namesConflict(JORDAN), true);
  assert.equal(effectiveTier("certain", JORDAN), "likely");
  assert.equal(withNameNote("Same email"), "Same email, different names");
});

test("same person written differently stays certain (case, spacing, order, nickname, one blank name)", () => {
  for (const names of [["Ann Lee", "ann  lee"], ["Lee, Ann", "Ann Lee"], ["Bob Smith", "Robert Smith"], ["Ann Lee", ""], ["Ann Lee", "Unnamed contact"], ["Ann", "Ann Lee"], ["Ann Lee", "Ann Lee", null]]) {
    assert.equal(namesConflict(names), false, names.join(" | "));
    assert.equal(effectiveTier("certain", names), "certain");
  }
  assert.equal(namesMatch("jordan smith", "steve wonders"), false);
  assert.equal(effectiveTier("likely", JORDAN), "likely"); // only certain is ever lowered
});

test("bulk merge never takes a group with different names, pairs or not", () => {
  const group = JORDAN.map((n, i) => P(`c${i}`, n));
  const v = judgeBulkPair(group, { unreadable: [] });
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.code, "different_people");
  const pair = judgeBulkPair([P("a", "jordan smith"), P("b", "steve wonders")], { unreadable: [] });
  assert.equal(pair.ok, false);
  assert.match(!pair.ok ? pair.why : "", /different names/);
  const plan = planBulk([{ key: "k", locationId: "l", locationName: null, people: group }], 50, { unreadable: [] });
  assert.equal(plan.will.length, 0);
  assert.equal(skipSummary(plan.skipped), "1 will be skipped: 1 different names.");
});

test("the skip summary counts protected, different names and unclear master before anything runs", () => {
  const s = skipSummary([{ code: "protected", why: "x" }, { code: "protected", why: "y" }, { code: "different_people", why: "z" }, { code: "tie", why: "t" }, { why: "Over the limit" }]);
  assert.match(s, /^5 will be skipped: 2 protected, 1 different names, 1 unclear master, 1 other/);
  assert.equal(skipSummary([]), "");
});

test("buttons and tooltip agree: one-by-one is allowed, bulk skips protected people", () => {
  assert.equal(ONE_BUTTON, "Merge this person");
  assert.equal(BULK_BUTTON(13), "Merge all certain matches (13)");
  assert.match(PROTECTED_EXPLAINER, /Merge all certain matches/);
  assert.match(PROTECTED_EXPLAINER, /skips protected people/);
  assert.match(PROTECTED_EXPLAINER, /one at a time/);
});

test("source guard: Merge on a protected group opens the chooser with a visible banner, never a silent nothing", () => {
  const m = src("src/app/app/views/dq/dq-merge.tsx"), d = src("src/app/app/views/dq/dq-dupes.tsx"), q = src("src/lib/analytics/dq-queries.ts");
  assert.match(m, /data-testid="dq-merge-protected"/);
  assert.match(m, /data-testid="dq-merge-unavailable"/);
  assert.doesNotMatch(m, /if \(!det\) return null;/);
  assert.match(d, /\{ONE_BUTTON\}/);
  assert.match(d, /BULK_BUTTON\(counts\.certain\.groups\)/);
  assert.match(d, /skipSummary\(pv\.skipped\)/);
  assert.match(q, /effectiveTier\("certain"/); // the nightly scan lowers the tier
  assert.match(q, /r\.tier === "certain"/); // and the bulk list only takes real certain groups
});
