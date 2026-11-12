import assert from "node:assert/strict";
import { test } from "node:test";
import { bandWidthAt, funnelLayout, type FunnelIn } from "../design/funnel-layout.ts";

const st = (i: number, v: number, lost = 0, stale = 0): FunnelIn => ({ id: `s${i}`, name: `Stage ${i}`, valueCents: v, count: 5, staleCount: stale ? 2 : 0, staleValueCents: stale, lostValueCents: lost });

test("band width follows the money and the biggest stage is full width", () => {
  const L = funnelLayout([st(0, 1000), st(1, 500), st(2, 250)], 100);
  assert.equal(L.rows[0].topW, 100); assert.equal(L.rows[1].topW, 50); assert.equal(L.rows[2].topW, 25);
  for (const r of L.rows) assert.ok(r.topW <= 100 && r.bottomW <= 100 && r.bottomW > 0);
});
test("empty or tiny stages keep a visible minimum, zero money stays zero", () => {
  const L = funnelLayout([st(0, 100000), st(1, 1), st(2, 0)], 0);
  assert.ok(L.rows[1].topW >= 10); assert.equal(L.rows[2].topW, 0); assert.equal(L.rows[2].drops, 0); assert.ok(L.rows[0].drops >= 1);
});
test("conversion counts money that reached the next step, and the biggest leak is the biggest loss", () => {
  const L = funnelLayout([st(0, 600, 100), st(1, 300, 400), st(2, 100, 0)], 200);
  // reach: s2 = 100+200 = 300, s1 = 300+300+400 = 1000, s0 = 1000+600+100 = 1700
  assert.equal(L.rows[0].reachCents, 1700); assert.equal(L.rows[1].reachCents, 1000);
  assert.ok(Math.abs((L.rows[0].conv as number) - 1000 / 1700) < 1e-9);
  assert.ok(Math.abs((L.wonConv as number) - 2 / 3) < 1e-9);
  assert.equal(L.leakIndex, 1);
});
test("no money anywhere gives no conversion and no leak, never NaN", () => {
  const L = funnelLayout([st(0, 0), st(1, 0)], 0);
  assert.equal(L.rows[0].conv, null); assert.equal(L.wonConv, null); assert.equal(L.leakIndex, null);
  for (const r of L.rows) assert.ok(Number.isFinite(r.topW) && Number.isFinite(r.bottomW) && Number.isFinite(r.stuckFrac));
});
test("stuck share is clamped and only shown when deals are stuck", () => {
  const L = funnelLayout([st(0, 1000, 0, 5000), st(1, 1000, 0, 0), st(2, 1000, 0, 100)], 0);
  assert.equal(L.rows[0].stuckFrac, 1); assert.equal(L.rows[1].stuckFrac, 0); assert.ok(L.rows[2].stuckFrac >= 0.14);
});
test("width at height interpolates between top and bottom", () => {
  assert.equal(bandWidthAt({ topW: 80, bottomW: 40 }, 0.5), 60);
});

import { readFileSync } from "node:fs";
test("money view keeps every old click target, the Coins toggle and reduced motion", () => {
  const src = readFileSync(new URL("../../app/app/views/pl3/money-flow.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/app/views/pl3/pl3.css", import.meta.url), "utf8");
  for (const id of ["pl-seg-", "pl-stuck-", "pl-vault", "pl-play", "pl-scrub", "pl-person", "pl-leak", "pl-view-coins", "pl-view-funnel"]) assert.ok(src.includes(id), id);
  assert.ok(/prefers-reduced-motion[^}]*\.fn-drop/.test(css));
  assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(src));
});
