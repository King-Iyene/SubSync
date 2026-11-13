import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dealsCell, rowNotes } from "../../app/app/views/pl3/pipe-list.ts";
import type { PipeCard } from "../analytics/pipeline3-types.ts";

// King, 13 Nov 2026: pipelines with real deals showed DEALS 0 because the column counted only the deals inside the money.
const card = (o: Partial<PipeCard>): PipeCard => ({ locationId: "l", pipelineId: "p", accountName: "A", name: "P", openCount: 0, openValue: 0, wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0, staleCount: 0, noOwnerCount: 0, zeroValueCount: 0, outlierCount: 0, outlierValue: 0, empty: false, mini: [], ...o });

test("a pipeline whose deals all have no value shows its real deal count and $0 money", () => {
  const c = card({ openCount: 0, allOpenCount: 24, zeroValueCount: 17, testCount: 7 });
  assert.deepEqual(dealsCell(c), { total: 24, inMoney: 0 });
  assert.equal(c.openValue, 0);
  assert.ok(rowNotes(c).join(" ").includes("17"), "the sub-line says how many have no value");
});

test("an old answer without the new field still shows the counted deals; the total is never below the counted part", () => {
  assert.deepEqual(dealsCell(card({ openCount: 5 })), { total: 5, inMoney: 5 });
  assert.deepEqual(dealsCell(card({ openCount: 9, allOpenCount: 4 })), { total: 9, inMoney: 9 });
});

test("the server counts every open deal of the pipeline (the rows behind the click), in both the live and the stored branch", () => {
  const src = readFileSync(new URL("../analytics/pipeline3-cards.ts", import.meta.url), "utf8");
  assert.match(src, /count\(\*\) filter \(where d\.status = 'open' and not d\.out_of_scope\)::int all_open_n/);
  assert.match(src, /sum\(r\.n\) filter \(where r\.status = 'open' and not r\.oos\), 0\)::int all_open_n/);
  assert.match(src, /allOpenCount: Number\(c\.all_open_n/);
  const ui = readFileSync(new URL("../../app/app/views/pl3/pipes.tsx", import.meta.url), "utf8");
  assert.match(ui, /data-label="Deals"[^>]*>\{n\(allOpen\)\}/);
});
