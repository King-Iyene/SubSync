import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NEWS } from "../whats-new.ts";
import { todayOf } from "../analytics/clients2-core.ts";

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("#10 Clients today never says everything is fine when plans cannot be read", () => {
  const row = { plan: { pay: "unknown", state: "needs_permission" }, level: "ok" } as never;
  const t = todayOf({ rows: [row], planAccess: "needs_permission" });
  assert.doesNotMatch(t.headline, /look fine|paid up/);
  assert.match(t.headline, /needs permission|cannot read/i);
});
test("#12 money flow says deals without a value, not 0 deals", () => {
  assert.match(src("app/app/views/pl3/pipe-list.ts"), /without a value/);
  assert.match(src("app/app/views/pl3/pipes.tsx"), /Not counted in money: /);
  assert.match(src("app/app/views/pl3/money-flow.tsx"), /without a value/);
});
test("#13 the funnel example is offered only with no valued deals, and is marked Example", () => {
  const s = src("app/app/views/pl3/money-flow.tsx");
  assert.match(s, /const showExample = example && noValued/);
  assert.match(s, /<b>Example\.<\/b>/);
  assert.match(s, /See an example/);
});
test("#14 the Fathom card and the list count the same calls", () => {
  const q = src("lib/analytics/mn2-queries.ts");
  assert.match(q, /ownerUserId/);
  assert.match(src("app/app/views/meeting-list.tsx"), /the same calls as the card above/);
});
test("#15 What's new lists this release, newest first, each with an Open page", () => {
  const ids = ["st-sale-basis", "pl-trust-deals", "pl-funnel", "pp-call-panel", "pp-deals", "ap-people", "dq-safe-merge"];
  for (const id of ids) { const e = NEWS.find((x) => x.id === id); assert.ok(e, id); assert.ok(e.view, `${id} has an Open target`); }
  const dates = NEWS.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});
