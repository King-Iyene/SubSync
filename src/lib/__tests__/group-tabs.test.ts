import assert from "node:assert/strict";
import test from "node:test";
import { groupIndexOf, groupTabs } from "../group-tabs.ts";

const G = [
  { label: "Overview", tip: "", keys: ["overview", "compare", "oldcompare"] },
  { label: "Money", tip: "", keys: ["money", "plans"] },
  { label: "Empty", tip: "", keys: ["gone"] },
];

test("groups show only pages that exist, and drop empty groups", () => {
  const g = groupTabs(G, ["overview", "money"]);
  assert.deepEqual(g.map((x) => x.label), ["Overview", "Money"]);
  assert.deepEqual(g[0].keys, ["overview"]);
});
test("a page no group names lands in More, so nothing is hidden", () => {
  const g = groupTabs(G, ["overview", "mystery"]);
  assert.equal(g[g.length - 1].label, "More");
  assert.deepEqual(g[g.length - 1].keys, ["mystery"]);
});
test("a page is in exactly one group, so no page repeats", () => {
  const all = ["overview", "compare", "oldcompare", "money", "plans", "extra"];
  const keys = groupTabs([...G, { label: "Again", tip: "", keys: ["compare"] }], all).flatMap((x) => x.keys);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, all.length);
});
test("the open page finds its group", () => {
  const g = groupTabs(G, ["overview", "money", "plans"]);
  assert.equal(groupIndexOf(g, "plans"), 1);
  assert.equal(groupIndexOf(g, "nope"), 0);
});
