import assert from "node:assert/strict";
import { test } from "node:test";
import { contrast, HUES, tagColor } from "../people/tag-colors.ts";
import { filterTags, highlight, rankTags, readAllPages } from "../people/tag-list.ts";

test("a tag always gets the same colour, whatever the capitals or spaces", () => {
  assert.deepEqual(tagColor("Qualified"), tagColor("  qualified "));
  assert.equal(tagColor("hot lead").index, tagColor("hot lead").index);
});

test("the colours are spread over the palette", () => {
  const used = new Set(Array.from({ length: 200 }, (_, i) => tagColor(`tag ${i}`).index));
  assert.ok(used.size >= 8, `only ${used.size} of ${HUES.length} colours used`);
});

test("every colour passes contrast (4.5:1 for the words, 3:1 for the dot) in light and dark", () => {
  for (let i = 0; i < 300; i++) {
    const c = tagColor(`name-${i}`);
    for (const m of ["light", "dark"] as const) {
      assert.ok(contrast(c[m].bg, c[m].fg) >= 4.5, `${m} ${c.index}: ${contrast(c[m].bg, c[m].fg).toFixed(2)}`);
    }
  }
  const card = { light: "hsl(0 0% 100%)", dark: "hsl(218 30% 20%)" };
  for (const h of HUES) void h;
  for (let i = 0; i < HUES.length; i++) {
    const c = tagColor(Array.from({ length: 2000 }, (_, k) => `x${k}`).find((n) => tagColor(n).index === i)!);
    assert.ok(contrast(c.light.dot, card.light) >= 3, `light dot ${i}`);
    assert.ok(contrast(c.dark.dot, card.dark) >= 3, `dark dot ${i}`);
  }
});

test("pagination: reads pages until one adds nothing, merges without repeats, and an endpoint that ignores paging cannot loop", async () => {
  const all = Array.from({ length: 250 }, (_, i) => `t${i}`);
  const calls: number[] = [];
  const paged = await readAllPages(async (skip) => { calls.push(skip); return all.slice(skip, skip + 100); });
  assert.equal(paged.length, 250);
  assert.deepEqual(calls, [0, 100, 200]);
  let n = 0;
  const ignores = await readAllPages(async () => { n++; return all.slice(0, 100); });
  assert.equal(ignores.length, 100);
  assert.ok(n <= 2);
  const dup = await readAllPages(async () => ["Hot", "hot", " HOT "], { pageSize: 3 });
  assert.deepEqual(dup, ["Hot"]);
});

test("ranking, search and create", () => {
  const used = new Map([["hot", 40], ["qualified", 12], ["only on contacts", 3]]);
  const all = rankTags(["Qualified", "Hot", "Zebra", "Alpha"], used);
  assert.deepEqual(all.map((t) => t.name), ["Hot", "Qualified", "only on contacts", "Alpha", "Zebra"]);
  assert.deepEqual(filterTags(all, "", ["Hot"], ["zebra"]).options.map((t) => t.name), ["Zebra", "Qualified", "only on contacts", "Alpha"]);
  assert.deepEqual(filterTags(all, "al", []).options.map((t) => t.name), ["Alpha", "Qualified"]);
  assert.deepEqual(filterTags(all, "ua", []).options.map((t) => t.name), ["Qualified"]);
  assert.equal(filterTags(all, "brand new", []).canCreate, true);
  assert.equal(filterTags(all, "HOT", []).canCreate, false);
  assert.equal(filterTags(all, "hot", ["Hot"]).canCreate, false);
  assert.equal(filterTags(all, "a,b", []).canCreate, false);
  assert.deepEqual(highlight("Qualified", "ual"), [{ text: "Q", hit: false }, { text: "ual", hit: true }, { text: "ified", hit: false }]);
});
