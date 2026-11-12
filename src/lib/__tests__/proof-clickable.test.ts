import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { openKindsOf } from "../analytics/today3-proof-core.ts";
const openKinds = (m: Map<Td3Kind, number>) => openKindsOf(m, (k) => `label of ${k}`);
import type { Td3Kind } from "../analytics/today3-types.ts";

const MODULE = readFileSync(new URL("../../app/app/views/td3/module.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../app/app/views/td3/td3.css", import.meta.url), "utf8");
const QUERIES = readFileSync(new URL("../analytics/today3-queries.ts", import.meta.url), "utf8");

test("openKinds: biggest first, zeros dropped, and the counts add up to the still-open total", () => {
  const m = new Map<Td3Kind, number>([["no_owner", 50_000], ["waiting_old", 2], ["staff_quiet", 2], ["unmarked", 0], ["no_phone", 3_316]]);
  const k = openKinds(m);
  assert.deepEqual(k.map((x) => x.kind), ["no_owner", "no_phone", "staff_quiet", "waiting_old"]);
  assert.equal(k.reduce((a, x) => a + x.count, 0), 53_320);
  assert.ok(k.every((x) => x.label.length > 0 && !/^\d/.test(x.label)));
});

test("openKinds: nothing open gives no rows to open", () => {
  assert.deepEqual(openKinds(new Map()), []);
});

test("a per-account split adds up to the whole business (count equals rows for each Proof figure)", () => {
  const a = new Map<Td3Kind, number>([["waiting_old", 4], ["unmarked", 1]]), b = new Map<Td3Kind, number>([["waiting_old", 2], ["no_owner", 7]]);
  const whole = new Map<Td3Kind, number>();
  for (const part of [a, b]) for (const [k, c] of part) whole.set(k, (whole.get(k) ?? 0) + c);
  assert.equal(openKinds(whole).reduce((s, x) => s + x.count, 0), openKinds(a).reduce((s, x) => s + x.count, 0) + openKinds(b).reduce((s, x) => s + x.count, 0));
});

test("source guard: every number styled as a link has a click handler; plain totals never do", () => {
  // Any button that wears a number-link class must carry onClick.
  const tags = MODULE.match(/<button\b[^>]*?className="[^"]*\b(td-hnum|td-cellnum|td-caughtrow)\b[^"]*"[^>]*>/g) ?? [];
  assert.ok(tags.length >= 4, "the Proof buttons exist");
  for (const t of tags) assert.match(t, /onClick=/, `a number link without a handler: ${t.slice(0, 120)}`);
  // The plain-total component must not take a handler or render a button of its own.
  const total = MODULE.match(/function TotalNum[\s\S]*?\r?\n}\r?\n/)?.[0] ?? "";
  assert.ok(total.includes("InfoTip") && !/onClick|href=/.test(total), "TotalNum is text with an info popover only");
  // Plain totals are never underlined or given a pointer.
  const rule = CSS.match(/\.td-total \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /cursor: default/);
  assert.doesNotMatch(rule, /underline/);
  // The old "no list behind them" dead-end is gone.
  assert.doesNotMatch(MODULE, /so there is no list behind them/);
  assert.doesNotMatch(MODULE, /still open are on the Today page/);
});

test("Ledger tokens only: the new Proof styles hold no hard-coded colours", () => {
  const block = CSS.slice(CSS.indexOf("/* Proof: a figure is either"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
});

test("Proof server: still-open per kind comes from the same scoped accounts as the totals", () => {
  assert.match(QUERIES, /openByKind: openKinds\(a\?\.open \?\? new Map\(\)\)/);
  assert.match(QUERIES, /accountsIn\(\{ inst: s\.inst, allowed: s\.allowed \}/);
  assert.match(QUERIES, /isCurrent: week === weeks\[0\]/);
});
