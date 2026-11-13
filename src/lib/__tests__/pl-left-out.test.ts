import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cardLeftOut, leftOutParts, leftOutSentence, leftOutTotal, ownerlessNote, rowNotes } from "../../app/app/views/pl3/pipe-list.ts";
import { flowOf, queryOf } from "../../app/app/views/pl3/adapters.ts";
import type { PipeCard, Pl3MoneyFlow } from "../analytics/pipeline3-types.ts";
import { routeAllowed } from "../access.ts";

// Pipeline money: every reason an open deal is left out is said, with counts that add up and equal the rows a click opens. "Count deals without an owner" is a company switch (default off).
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const card = (o: Partial<PipeCard> = {}): PipeCard => ({ locationId: "L", pipelineId: "P", accountName: "A", name: "AGL Sales Pipeline", openCount: 0, openValue: 0, wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0, staleCount: 0, noOwnerCount: 0, zeroValueCount: 0, outlierCount: 0, outlierValue: 0, empty: false, mini: [], ...o });
const F = { from: "2026-11-12", to: "2026-11-12", locationId: "", pipeline: "", ownerId: "", q: "" };

test("the AGL case: 17 without a value and 19 without an owner are both named, and the parts add up to the deals left out", () => {
  const c = card({ zeroValueCount: 17, noOwnerCount: 19, testCount: 2, outlierCount: 1, outlierValue: 9000 });
  const notes = rowNotes(c);
  assert.deepEqual(notes.slice(0, 3), ["17 deals without a value", "19 deals without an owner", "2 test-named"]);
  assert.match(notes[3], /^1 big deal apart \(/);
  const x = cardLeftOut(c);
  assert.equal(leftOutTotal(x), 17 + 19 + 2 + 1, "the counts add up to the deals the row does not count");
  assert.deepEqual(leftOutParts(x).map((p) => p.key), ["no_value", "no_owner", "test", "outlier"], "each part opens the bucket of its own name");
  assert.match(leftOutSentence(x) ?? "", /^Left out of the money: 17 deals without a value, 19 deals without an owner, 2 test-named, 1 big deal apart/);
  assert.equal(leftOutSentence({ zeroValue: 0, noOwner: 0, test: 0 }), null);
  assert.deepEqual(rowNotes(card({ noOwnerCount: 1 })), ["1 deal without an owner"]);
});

test("the switches: counted deals are inside the money, so they are not named as left out", () => {
  const c = card({ zeroValueCount: 2, noOwnerCount: 5, testCount: 3 });
  assert.deepEqual(rowNotes(c, { ownerCounted: true }), ["2 deals without a value", "3 test-named"]);
  assert.deepEqual(rowNotes(c, { testsCounted: true }), ["2 deals without a value", "5 deals without an owner"]);
  assert.equal(leftOutTotal(cardLeftOut(c, { ownerCounted: true, testsCounted: true })), 2, "a value-less deal is never money, whatever the switches say");
});

test("row vs header parity: the river header is built from the same counts the pipeline row carries", () => {
  const flow = { stages: [], drain: [], pipelineId: "p", pipelines: [{ id: "p", name: "AGL Sales Pipeline", locationId: "L" }], leftOut: { noValue: 17, noOwner: 19, test: 0, outlier: 0, outlierValue: 0, ownerCounted: false, testsCounted: false } } as unknown as Pl3MoneyFlow;
  const hdr = flowOf(flow, null).excluded, row = cardLeftOut(card({ zeroValueCount: 17, noOwnerCount: 19 }));
  assert.deepEqual(leftOutParts(hdr).map((p) => [p.key, p.count]), leftOutParts(row).map((p) => [p.key, p.count]));
  assert.equal(hdr.noOwner, 19, "no more hard-coded zeros in the header");
  assert.equal(flowOf(null, null).excluded.noOwner, 0);
  const on = flowOf({ ...flow, leftOut: { ...flow.leftOut!, noOwner: 0, ownerCounted: true } } as Pl3MoneyFlow, null).excluded;
  assert.equal(leftOutParts(on).some((p) => p.key === "no_owner"), false);
});

test("a click opens the same rows: the reason words reach the list request as its bucket", () => {
  for (const b of ["no_value", "no_owner", "test", "outlier"]) assert.match(queryOf("list", F, { bucket: b, status: "open" }), new RegExp(`bucket=${b}`));
  assert.match(queryOf("list", F, { status: "open" }), /bucket=open/);
  assert.match(queryOf("list", F, { bucket: "drop table", status: "open" }), /bucket=open/, "an unknown word is ignored");
  const q = read("lib/analytics/pipeline3-queries.ts");
  assert.match(q, /case "test": return db`and d\.is_test and d\.status = 'open' and not d\.out_of_scope`/, "the test list and the test count are the same deals");
  assert.match(q, /count\(\*\) filter \(where \$\{P_NO_OWNER\(db\)\}\)::int no_owner,/, "header counts use the list's own predicates");
  assert.match(q, /count\(\*\) filter \(where \$\{P_NO_VALUE\(db\)\}\)::int no_value/);
});

test("the ownerless switch: counted deals follow settings.count_ownerless_deals in the scan and in the stored totals, default off", () => {
  const q = read("lib/analytics/pipeline3-queries.ts"), roll = read("lib/analytics/pipeline3-rollup.ts"), mig = read("../supabase/migrations/20261231190000_count_ownerless_deals.sql");
  assert.match(q, /\(o\.assigned_to is not null or coalesce\(sc_cfg\.count_ownerless_deals, false\)\) owner_ok/);
  assert.match(q, /select d0\.\*, \(d0\.value > 0 and d0\.owner_ok and not d0\.out_of_scope/);
  assert.match(q, /P_NO_OWNER = .*and not d\.owner_ok`/, "nothing is 'no owner' once ownerless deals count");
  assert.match(roll, /d\.owner_ok has_owner/, "the stored totals follow the switch");
  assert.match(mig, /add column if not exists count_ownerless_deals boolean;/);
  assert.doesNotMatch(mig, /default true|drop |delete /i);
  const set = read("lib/analytics/test-deals-setting.ts");
  assert.match(set, /saveCountOwnerlessDeals[\s\S]*delete from pipeline_rollup_state/, "stored totals rebuild after a change");
  assert.match(set, /saveCountOwnerlessDeals[\s\S]*deal_rules_revision = deal_rules_revision \+ 1/);
});

test("the ownerless switch: same permissions and audit as the test-names switch, with a preview", () => {
  assert.equal(routeAllowed("agency", "PUT", ["deal-rules", "ownerless"]), true);
  assert.equal(routeAllowed("business", "PUT", ["deal-rules", "ownerless"]), true);
  assert.equal(routeAllowed("client", "PUT", ["deal-rules", "ownerless"]), false);
  assert.equal(routeAllowed("client", "GET", ["deal-rules", "ownerless"]), true);
  const route = read("lib/api/test-deals-routes.ts");
  assert.match(route, /handleOwnerlessDeals[\s\S]*ctx\.kind === "client"\) return json\(\{ error: "Not available in this view" \}, 403\)/);
  assert.match(route, /typeof body\.countOwnerless !== "boolean"/);
  assert.match(route, /deal_rules\.count_ownerless_deals_changed/, "the change is audited");
  assert.match(route, /ownerlessPreview\(ctx\.installationId, ctx\.limitTo \? \[ctx\.limitTo\] : null\)/, "the preview is limited to the caller's account");
  const router = read("lib/api/router.ts");
  assert.match(router, /b === "ownerless" && !c && \(method === "GET" \|\| method === "PUT"\)\) return await handleOwnerlessDeals/);
  const ui = read("app/app/views/deal-rules-settings.tsx");
  assert.match(ui, /Count deals without an owner/);
  assert.match(ui, /deal-rules-ownerless-preview/);
  assert.match(ui, /deal-rules-ownerless-readonly/);
});

test("the one-tap note: says why, offers Count them behind a preview, and every state has words", () => {
  assert.equal(ownerlessNote(0, false), null);
  assert.deepEqual(ownerlessNote(19, false), { text: "19 deals without an owner (not counted in money): assign owners in your CRM or tap Count them.", action: "count" });
  assert.equal(ownerlessNote(1, false)?.text.startsWith("1 deal without"), true);
  assert.equal(ownerlessNote(0, true)?.action, "leave");
  const ui = read("app/app/views/pl3/ownerless-note.tsx");
  for (const id of ["-toggle", "-preview", "-confirm", "-saved", "-error", "-readonly"]) assert.ok(ui.includes("`${testId}" + id + "`"), id);
  assert.match(read("app/app/views/pl3/pipes.tsx"), /<OwnerlessNote count=\{t\.noOwnerCount\} counted=\{t\.countsOwnerless === true\} \/>/);
  assert.match(read("app/app/views/pl3/money-flow.tsx"), /<OwnerlessNote count=\{data\.excluded\.noOwner\}/);
  assert.match(read("app/app/views/pl3/money-flow.tsx"), /<LeftOutLine x=\{data\.excluded\}/);
});
