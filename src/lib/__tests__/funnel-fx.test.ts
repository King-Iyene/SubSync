import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { biggestLeak, closedDeals, pathSteps } from "../design/flow-paths.ts";
import { funnelFlowLayout } from "../design/funnel-flow-layout.ts";
import { bandText, dotOffset, HOW_TO_READ, initials, LEAK_LINE, MAX_PARTICLES, particlePlan } from "../design/funnel-fx.ts";
import { sampleFunnelPaths } from "../design/river-sample.ts";

const read = (f: string) => readFileSync(new URL(`../../app/app/views/pl3/${f}`, import.meta.url), "utf8");

test("flow dots: capped at 60, thicker band gets more dots and moves faster, empty band none", () => {
  const plan = particlePlan([10, 80, 160, 0, 300]);
  assert.ok(plan.reduce((t, f) => t + f.count, 0) <= MAX_PARTICLES);
  assert.equal(plan[3].count, 0);
  assert.ok(plan[4].count >= plan[1].count && plan[1].count >= plan[0].count);
  assert.ok(plan[4].dur < plan[0].dur, "more volume = shorter trip");
  for (const f of plan.filter((x) => x.count > 0)) assert.ok(f.dur > 0 && f.size > 0);
  const many = particlePlan(Array.from({ length: 40 }, (_, i) => 5 + i * 3));
  assert.ok(many.reduce((t, f) => t + f.count, 0) <= MAX_PARTICLES, "never over the cap even with 40 bands");
  assert.ok(particlePlan([0, 0]).every((f) => f.count === 0));
  assert.deepEqual(particlePlan([]), []);
  assert.equal(dotOffset(0, 4), 0); assert.equal(dotOffset(2, 4), 0.5); assert.equal(dotOffset(0, 0), 0);
});

test("sample funnel: band widths add up, nothing overlaps, everything stays inside the picture", () => {
  const p = sampleFunnelPaths();
  for (const measure of ["deals", "money"] as const) for (const [length, thick] of [[900, 260], [390, 340]] as const) {
    const L = funnelFlowLayout(p, measure, { length, thick, nodeW: 34, enough: true });
    assert.equal(L.empty, false);
    L.nodes.forEach((nd, i) => {
      assert.ok(nd.ac >= -1e-6 && nd.ac + nd.h <= thick + 1e-6, "inside the height");
      if (nd.kind === "stage") assert.ok(Math.abs(nd.lostH + nd.flowH + nd.waitH - nd.h) < 1e-6, "parts add up to the bar");
      if (i > 0) assert.ok(L.nodes[i - 1].al + L.nodes[i - 1].w <= nd.al + 1e-6, "steps do not overlap");
      assert.ok(nd.al + nd.w <= length + 1e-6);
    });
    for (const l of L.links) assert.ok(Math.abs(l.th - L.nodes[l.to].h) < 1e-6, "a band is as thick as the bar it feeds");
    const widths = L.links.map((l) => l.th);
    for (let i = 1; i < widths.length; i++) assert.ok(widths[i - 1] + 1e-6 >= widths[i], "never widens");
    // The lost branch of a step starts inside that step's own bar, above the band.
    for (const t of L.tails) { const nd = L.nodes[t.from]; assert.ok(t.ac0 >= nd.ac - 1e-6 && t.ac0 + t.th <= nd.flowAc + 1e-6); }
    const plan = particlePlan(L.links.map((l) => l.th));
    assert.ok(plan.reduce((t, f) => t + f.count, 0) <= MAX_PARTICLES);
  }
});

test("sample funnel is rich, labelled SAMPLE, and its biggest leak is New lead", () => {
  const p = sampleFunnelPaths();
  assert.ok(closedDeals(p) >= p.minDeals);
  assert.equal(biggestLeak(p, true)?.name, "New lead");
  assert.ok(p.stages.every((s) => s.stuck > 0), "every step shows the stuck stripes");
  assert.ok(p.won.byOwner.length >= 3 && p.won.byOwner.every((o) => o.name.includes("(sample)")));
  assert.equal(p.won.byOwner.reduce((t, o) => t + o.n, 0), p.won.n);
  assert.equal(p.won.bySource.reduce((t, o) => t + o.n, 0), p.won.n);
  assert.equal(sampleFunnelPaths(), p, "same object every time (no re-layout)");
  const steps = pathSteps(p, true);
  assert.ok(steps[0].fromN > steps[steps.length - 1].toN);
});

test("plain words: tooltip text, initials and the leak line", () => {
  assert.equal(bandText({ toN: 53, fromN: 57, pct: "93%", moneyText: "$412k" }), "53 of 57 moved on (93%) | $412k");
  assert.equal(bandText({ toN: 0, fromN: 0, pct: null }), "Nobody got here in these dates");
  assert.equal(initials("Ada Obi"), "AO"); assert.equal(initials("Tunde (sample)"), "T"); assert.equal(initials(""), "?");
  assert.ok(LEAK_LINE.startsWith("Biggest leak = the step where the most deals were marked Lost while they sat in it"));
  const jargon = /drop-?off|conversion|\breach\b|\bshare\b|funnel stage|cohort/i;
  assert.ok(!jargon.test(LEAK_LINE));
  for (const h of HOW_TO_READ) assert.ok(!jargon.test(`${h.label} ${h.line}`), h.label);
  assert.deepEqual(HOW_TO_READ.map((h) => h.kind), ["moved", "lost", "won", "stuck", "waiting"]);
});

test("the screen: always-visible legend, leak line, motion safety and no vendor words", () => {
  const v = read("funnel-flow-view.tsx"), css = read("funnel-fx.css");
  assert.ok(v.includes('data-testid="ff-howto"') && !v.includes("<details"), "how to read is never collapsed");
  assert.ok(v.includes("LEAK_LINE") && v.includes('data-testid="ff-leakline"'));
  assert.ok(v.includes("IntersectionObserver") && v.includes("visibilitychange") && v.includes("pauseAnimations"), "pauses off screen and when the tab is hidden");
  assert.ok(v.includes("motion && L.links.map") && v.includes("reduced"), "no flow dots with reduced motion");
  assert.ok(v.includes("tabIndex") || v.includes("press("), "bands are keyboard buttons");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*ff-wipe/);
  assert.ok(css.includes('[data-theme="dark"]') || read("pl3.css").includes('[data-theme="dark"] .ff-wrap'));
  for (const s of [v, css]) assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(s));
  assert.ok(!/Where deals drop out|drop-off/i.test(v), "plain words only");
});
