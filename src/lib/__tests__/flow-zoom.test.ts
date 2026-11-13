import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasLayoutWidth, clampZoom, fitView, panBy, stepZoom, wheelFactor, zoomAt, ZOOM_MAX, ZOOM_MIN } from "../design/flow-zoom.ts";

const at = (v: { z: number; x: number; y: number }, px: number, py: number) => ({ x: (px - v.x) / v.z, y: (py - v.y) / v.z });

test("clampZoom keeps 25% to 250% and survives bad input", () => {
  assert.equal(ZOOM_MIN, 0.25); assert.equal(ZOOM_MAX, 2.5);
  assert.equal(clampZoom(0.01), 0.25); assert.equal(clampZoom(9), 2.5); assert.equal(clampZoom(NaN), 1);
});
test("stepZoom moves 10 points without drifting and stops at the ends", () => {
  let z = 1; for (let i = 0; i < 7; i++) z = stepZoom(z, 1);
  assert.equal(z, 1.7);
  for (let i = 0; i < 40; i++) z = stepZoom(z, 1);
  assert.equal(z, ZOOM_MAX);
  for (let i = 0; i < 40; i++) z = stepZoom(z, -1);
  assert.equal(z, ZOOM_MIN);
});
test("fitView: a wide tree fits the width, a tall tree fits the height, both are centred and inside", () => {
  for (const [cw, ch, vw, vh] of [[2000, 600, 800, 600], [1000, 2000, 900, 600], [1400, 1400, 390, 700]] as const) {
    const v = fitView(cw, ch, vw, vh);
    assert.ok(v.z <= 1 && v.z >= ZOOM_MIN);
    assert.ok(v.x >= -0.001 && v.y >= -0.001, "top-left inside");
    assert.ok(v.x + cw * v.z <= vw + 0.001 && v.y + ch * v.z <= vh + 0.001, "bottom-right inside");
    assert.ok(Math.abs(v.x - (vw - cw * v.z - v.x)) < 0.01 && Math.abs(v.y - (vh - ch * v.z - v.y)) < 0.01, "centred");
  }
});
test("fitView never enlarges a small tree and tolerates zero sizes", () => {
  assert.deepEqual(fitView(400, 300, 1200, 800), { z: 1, x: 400, y: 250 });
  assert.deepEqual(fitView(0, 300, 1200, 800), { z: 1, x: 0, y: 0 });
});
test("zoomAt keeps the point under the pointer fixed, in and out", () => {
  let v = { z: 0.6, x: 40, y: -20 };
  const p = at(v, 300, 200);
  for (const z of [0.9, 1.7, 0.4]) { v = zoomAt(v, z, 300, 200); const q = at(v, 300, 200); assert.ok(Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6); }
});
test("zoomAt clamps, and at the clamp the point still holds", () => {
  const v = zoomAt({ z: 2, x: 10, y: 10 }, 99, 100, 100);
  assert.equal(v.z, ZOOM_MAX);
  const o = zoomAt({ z: 0.3, x: 10, y: 10 }, 0.01, 100, 100);
  assert.equal(o.z, ZOOM_MIN);
});
test("panBy and wheelFactor", () => {
  assert.deepEqual(panBy({ z: 1, x: 5, y: 5 }, 10, -3), { z: 1, x: 15, y: 2 });
  assert.ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1 && wheelFactor(0) === 1);
  assert.ok(wheelFactor(-100000) < 1.4);
});
test("canvasLayoutWidth never drops below the tree breakpoint", () => {
  assert.equal(canvasLayoutWidth(390), 1000);
  assert.equal(canvasLayoutWidth(1440), 1408);
});
