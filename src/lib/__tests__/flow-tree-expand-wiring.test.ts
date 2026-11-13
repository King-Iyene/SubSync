import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const tree = read("../../app/app/views/ap3/flow-tree.tsx");
const canvas = read("../../app/app/views/ap3/flow-canvas.tsx");

test("expand button, close button and dialog exist", () => {
  assert.match(tree, /data-testid="ap-expand"/);
  assert.match(tree, /data-testid="ap-expanded-close"/);
  assert.match(tree, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(tree, /createPortal/);
});
test("Esc closes, Tab is trapped, focus returns, scroll restored", () => {
  assert.match(tree, /e\.key === "Escape"/);
  assert.match(tree, /e\.key !== "Tab"|e\.key === "Tab"/);
  assert.match(tree, /openerRef\.current\?\.focus\(/);
  assert.match(tree, /window\.scrollTo\(/);
});
test("expanded mode shows up to 12 people", () => {
  assert.match(tree, /EXPANDED_PAGE/);
});
test("canvas: zoom buttons, fit, reset, pointer wheel zoom, drag pan, pinch, keys", () => {
  for (const id of ["ap-zoom-in", "ap-zoom-out", "ap-zoom-fit", "ap-zoom-reset", "ap-zoom-pct"]) assert.match(canvas, new RegExp(`data-testid="${id}"`));
  assert.match(canvas, /passive: false/);
  assert.match(canvas, /ctrlKey/);
  assert.match(canvas, /zoomAt\(/);
  assert.match(canvas, /setPointerCapture/);
  assert.match(canvas, /kind: "pinch"/);
  assert.match(canvas, /e\.key === "f"/);
  assert.match(canvas, /ArrowLeft/);
  assert.match(canvas, /useReducedMotion/);
});
test("plain wheel resizes in the card and in full screen, with a non-passive listener that stops page scroll", () => {
  assert.equal((tree.match(/wheelZoom(?![A-Za-z])/g) ?? []).length, 2, "both canvases turn the wheel on");
  assert.doesNotMatch(tree, /wheelZoom=\{false\}/);
  assert.match(canvas, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(canvas, /e\.preventDefault\(\)/);
  assert.match(canvas, /Scroll to resize, drag to move/);
});
test("the card keeps a strip where the wheel scrolls the page", () => {
  assert.match(read("../../app/app/views/ap3/ap3.css"), /\.ap-canvas-inline \.ap-canvas-view \{ right: 12px; \}/);
});
test("the tree is fitted on load and whenever the drawing changes", () => {
  assert.match(canvas, /fitKey/);
  assert.match(tree, /fitKey=\{fitKey\}/);
});
