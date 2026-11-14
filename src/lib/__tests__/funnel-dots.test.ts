import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { FlowPaths, PathStage } from "../design/flow-paths.ts";
import { pctText } from "../design/flow-paths.ts";
import { DOT_CAP, dotLegend, dotsFor, dotUnit, funnelModel, halfWidthAt, MIN_BAND, particleBudget, PARTICLE_CAP, pileGrid, placeDots, splitDots, stageIconKey, wrapLabel } from "../design/funnel-dots.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stage = (i: number, open: number, lost: number, stuck = 0): PathStage => ({ id: `s${i}`, name: `Step ${i}`, order: i, open, openCents: open * 10000, noValue: 0, stuck, stuckCents: stuck * 10000, lost, lostCents: lost * 10000 });
/** A pipeline of 5 steps holding `total` deals in all (open, lost and won in fixed shares). */
function pipeline(total: number): FlowPaths {
  const share = [0.3, 0.2, 0.1, 0.05, 0.05], lostShare = [0.1, 0.05, 0.03, 0.01, 0.01];
  const stages = share.map((s, i) => stage(i, Math.floor(total * s), Math.floor(total * lostShare[i]), Math.floor(total * s * 0.2)));
  const used = stages.reduce((t, s) => t + s.open + s.lost, 0);
  return { pipelineName: "P", stages, won: { n: Math.max(0, total - used), cents: Math.max(0, total - used) * 10000, medianDays: 9, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 };
}
const dotsOf = (m: ReturnType<typeof funnelModel>) => m.rows.reduce((t, r) => t + r.dots.moved + r.dots.waiting + r.dots.stuck + r.dots.lost, 0);

test("dot count stays under the cap for 0, 1, 50, 5,000, 1,000,000 and 50,000,000 deals", () => {
  for (const total of [0, 1, 50, 5_000, 1_000_000, 50_000_000]) for (const measure of ["deals", "money"] as const) {
    const m = funnelModel(pipeline(total), measure, { enough: true });
    if (total === 0) { assert.equal(m.empty, true); assert.equal(m.totalDots, 0); continue; }
    assert.ok(!m.empty, `${total} deals draws`);
    assert.ok(dotsOf(m) <= DOT_CAP, `${total} deals ${measure}: ${dotsOf(m)} dots`);
    assert.equal(dotsOf(m), m.totalDots);
    assert.ok(m.rows.every((r) => r.dots.moved >= 0 && r.dots.waiting >= 0 && r.dots.stuck >= 0 && r.dots.lost >= 0));
  }
  // A single deal is a single dot at the first step, and the cap is a sensible few hundred.
  const one = funnelModel({ pipelineName: "P", stages: [stage(0, 1, 0)], won: { n: 0, cents: 0, medianDays: null, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 }, "deals", { enough: false });
  assert.equal(one.rows[0].dots.waiting, 1); assert.equal(one.unit, 1);
  assert.ok(DOT_CAP >= 300 && DOT_CAP <= 500);
  // Even with many steps (each keeping its one dot) the cap holds.
  const wide: FlowPaths = { ...pipeline(1_000_000), stages: Array.from({ length: 40 }, (_, i) => stage(i, 10 ** (i % 6), 1 + (i % 3))) };
  assert.ok(dotsOf(funnelModel(wide, "deals", { enough: true })) <= DOT_CAP);
});

test("'each dot = N' is said whenever N is more than 1, and the screen always prints it", () => {
  for (const total of [1, 50, 5_000, 1_000_000, 50_000_000]) {
    const m = funnelModel(pipeline(total), "deals", { enough: true }), text = dotLegend(m.unit);
    if (m.unit > 1) assert.match(text, /^each dot = [\d,.]+( million| billion| trillion)? deals$/, `${total}: ${text}`);
    else assert.equal(text, "1 dot = 1 deal");
  }
  assert.ok(funnelModel(pipeline(1_000_000), "deals", { enough: true }).unit > 1);
  assert.equal(dotLegend(2_000_000), "each dot = 2 million deals");
  assert.equal(dotLegend(20), "each dot = 20 deals");
  assert.equal(dotLegend(5, true), "each dot = about $5");
  const view = read("../../app/app/views/pl3/funnel-dots-view.tsx"), river = read("../../app/app/views/pl3/river-view.tsx");
  assert.ok(view.includes("dotLegend(model.unit") && view.includes('data-testid="fv-dotlegend"'), "the funnel legend is always on screen");
  assert.ok(river.includes("dotLegend(cardUnit") && river.includes('data-testid="pl-legend"'), "the river legend is always on screen");
  // The unit only steps up when needed: the smallest step that fits.
  assert.equal(dotUnit([10, 5]), 1); assert.equal(dotUnit([300, 300]), 2); assert.equal(dotUnit([0, 0]), 1);
  assert.equal(dotsFor(0, 10), 0); assert.equal(dotsFor(1, 1000), 1);
});

test("band widths never grow down the funnel, are never NaN, and a zero step is zero wide", () => {
  const holes: FlowPaths = { pipelineName: "P", stages: [stage(0, 50, 10), stage(1, 0, 0), stage(2, 0, 0), stage(3, 3, 0)], won: { n: 0, cents: 0, medianDays: null, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 };
  for (const p of [holes, pipeline(7), pipeline(1_000_000), { ...holes, stages: [stage(0, 0, 0), stage(1, 4, 1)] }]) for (const measure of ["deals", "money"] as const) {
    const m = funnelModel(p, measure, { enough: true });
    let prev = 1;
    for (const r of m.rows) {
      assert.ok(Number.isFinite(r.width) && Number.isFinite(r.frac) && r.width >= 0 && r.width <= 1, `${r.name} width ${r.width}`);
      assert.ok(r.width <= prev + 1e-9, `${r.name} is not wider than the step before`);
      assert.ok(r.reach === 0 ? r.width === 0 : r.width >= MIN_BAND - 1e-9);
      assert.ok(!Number.isNaN(r.dropOff) && r.dropOff >= 0);
      if (r.width > 0) prev = r.width;
    }
  }
  // Nothing at all: no rows, nothing to divide by, no crash.
  const none = funnelModel({ pipelineName: "P", stages: [stage(0, 0, 0), stage(1, 0, 0)], won: { n: 0, cents: 0, medianDays: null, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 }, "deals", { enough: true });
  assert.equal(none.empty, true); assert.deepEqual(none.rows, []);
});

test("conversion and share-of-first percentages are right on a fixture", () => {
  // Step 0: 20 open, 30 lost; step 1: 10 open, 10 lost; step 2: 5 open, 5 lost; 20 won.
  const p: FlowPaths = { pipelineName: "P", stages: [stage(0, 20, 30), stage(1, 10, 10), stage(2, 5, 5)], won: { n: 20, cents: 200000, medianDays: 12, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 };
  const m = funnelModel(p, "deals", { enough: true });
  assert.deepEqual(m.rows.map((r) => r.reach), [100, 50, 30, 20]);
  assert.deepEqual(m.rows.map((r) => r.pctFirst), ["100%", "50%", "30%", "20%"]);
  assert.deepEqual(m.rows.map((r) => r.conv), ["50%", "60%", "67%", null], "moved on = reach of the next step over this one (2 of 3 is 67%)");
  assert.deepEqual(m.rows.map((r) => r.dropOff), [50, 20, 10, 0]);
  assert.deepEqual(m.rows.slice(0, 3).map((r) => [r.waiting, r.lost]), [[20, 30], [10, 10], [5, 5]]);
  assert.equal(m.leakIndex, 0, "the step that lost the most deals");
  assert.equal(funnelModel(p, "deals", { enough: false }).leakIndex, null, "no leak claim without enough closed deals");
  assert.equal(pctText(199, 200), "99%");
  assert.equal(m.rows[3].kind, "won"); assert.equal(m.rows[3].icon, "won");
  // The screen shows conversion, share and drop-off only when there is enough to say it.
  const view = read("../../app/app/views/pl3/funnel-dots-view.tsx");
  assert.ok(view.includes("enough && r.conv") && view.includes("enough && r.pctFirst") && view.includes("Drop-off"));
});

test("7, 30 and 90 days give different stage counts (a deal counts when created or moved step in the dates)", () => {
  const DAY = 86_400_000, now = Date.UTC(2026, 10, 13);
  type D = { stage: number; createdDaysAgo: number; movedDaysAgo: number | null };
  // Mirror of inWindow() in pipeline3-queries.ts.
  const inWin = (d: D, days: number) => d.createdDaysAgo < days || (d.movedDaysAgo !== null && d.movedDaysAgo < days);
  const deals: D[] = [];
  for (let i = 0; i < 219; i++) deals.push({ stage: i % 4, createdDaysAgo: 3 + ((i * 37) % 400), movedDaysAgo: i % 5 === 0 ? null : (i * 11) % 150 });
  const counts = [7, 30, 90].map((days) => [0, 1, 2, 3].map((s) => deals.filter((d) => d.stage === s && inWin(d, days)).length));
  const total = counts.map((c) => c.reduce((a, b) => a + b, 0));
  assert.ok(total[0] < total[1] && total[1] < total[2], `totals ${total}`);
  for (let s = 0; s < 4; s++) assert.ok(counts[0][s] <= counts[1][s] && counts[1][s] <= counts[2][s]);
  assert.notDeepEqual(counts[1], counts[2]); assert.notDeepEqual(counts[0], counts[1]);
  // And the funnel built from those counts differs too.
  const shapes = counts.map((c) => funnelModel({ pipelineName: "P", stages: c.map((n, i) => stage(i, n, 0)), won: { n: 0, cents: 0, medianDays: null, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 }, "deals", { enough: true }).rows.map((r) => r.reach).join(","));
  assert.equal(new Set(shapes).size, 3);
  void now; void DAY;
  // The wiring: the Funnel asks for fw=1, the server reads it, and the same rule narrows the counts and the lists behind them.
  const q = read("../analytics/pipeline3-queries.ts"), fp = read("../analytics/pipeline3-flow-paths.ts"), routes = read("../api/pipeline3-routes.ts"), mf = read("../../app/app/views/pl3/money-flow.tsx");
  assert.match(q, /inWindow = [^\n]*created_at >= [^\n]*last_stage_change_at >= /);
  assert.ok(q.includes("flowOpen(db, f.flowDeals === true, f)") && q.includes("f?.flowWindow"));
  assert.ok(fp.includes("inWindow(db, f)") && fp.includes("history:") && fp.includes("deal_history"));
  assert.ok(routes.includes('sp.get("fw") === "1"'));
  assert.ok(mf.includes('"&fw=1"') && mf.includes("from: bar.from") === false);
});

test("when step history does not reach back, the funnel shows where deals are now with one plain line and no flow claims", () => {
  const view = read("../../app/app/views/pl3/funnel-dots-view.tsx"), mf = read("../../app/app/views/pl3/money-flow.tsx");
  assert.ok(view.includes("paths.history ? paths.history.covers : true"));
  assert.ok(view.includes("Step history only started") && view.includes("fv-window-note"));
  assert.ok(view.includes("flowOk && !enough") && view.includes("{flowOk && <p className=\"ff-leakline\""), "no leak line without history");
  assert.ok(mf.includes("riverClaims") && mf.includes("pl-river-nohistory") && mf.includes("riverClaims && data.leak"));
});

test("tiny helpers: dots fit their band, particles are capped, labels wrap and keep every word, piles fit", () => {
  assert.equal(splitDots(10, [5, 5, 0, 0]).reduce((a, b) => a + b, 0), 10);
  assert.deepEqual(splitDots(3, [100, 1, 1, 0]), [1, 1, 1, 0], "a small group keeps its one dot");
  assert.deepEqual(splitDots(0, [1, 2]), [0, 0]); assert.deepEqual(splitDots(5, [0, 0]), [0, 0]);
  for (const count of [1, 17, 120, 400]) {
    const pts = placeDots(count, { cx: 200, w0: 380, w1: 220, h: 64, pad: 5, spacing: 8, seed: 3 });
    assert.ok(pts.length <= count && pts.length > 0);
    for (const q of pts) { assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y)); assert.ok(q.y >= 3 && q.y <= 61, `y ${q.y}`); assert.ok(Math.abs(q.x - 200) <= halfWidthAt(380, 220, q.y / 64) + 1, "inside the band"); }
  }
  assert.deepEqual(placeDots(0, { cx: 1, w0: 1, w1: 1, h: 1 }), []);
  assert.ok(particleBudget(Array.from({ length: 30 }, () => 5)).reduce((a, b) => a + b, 0) <= PARTICLE_CAP);
  assert.deepEqual(particleBudget([0, 0]), [0, 0]);
  assert.equal(wrapLabel("Audit Call Booked", 12).join(" "), "Audit Call Booked");
  assert.deepEqual(wrapLabel("Audit Call Booked", 12), ["Audit Call", "Booked"]);
  assert.deepEqual(wrapLabel("New lead", 20), ["New lead"]);
  for (const l of wrapLabel("Pending contract signature from the client", 14)) assert.ok(!l.includes("…"));
  assert.equal(wrapLabel("Pending contract signature from the client", 14).join(" "), "Pending contract signature from the client");
  for (const n of [1, 5, 40, 400]) { const g = pileGrid(n, 34, 80); assert.ok(g.cols * g.rows >= n && g.cols >= 1); }
  assert.equal(pileGrid(0, 34, 80).rows, 0);
  assert.equal(stageIconKey("Audit Call Booked"), "book"); assert.equal(stageIconKey("Proposal sent"), "offer"); assert.equal(stageIconKey("New lead"), "new"); assert.equal(stageIconKey("Zzz"), "step");
});

test("the screen: dots not cards, whole names, motion safety, theme tokens and no vendor words", () => {
  const view = read("../../app/app/views/pl3/funnel-dots-view.tsx"), css = read("../../app/app/views/pl3/funnel-dots.css"), river = read("../../app/app/views/pl3/river-view.tsx"), mf = read("../../app/app/views/pl3/money-flow.tsx");
  assert.ok(!river.includes("rv-bill") && !river.includes("pileCards") && river.includes("rv-dot"), "the river draws dots, not one card per deal");
  assert.ok(!view.includes("trunc(") && !river.includes("trunc(") && view.includes("overflow-wrap") === false, "stage names are never cut with ...");
  assert.match(css, /\.fv-name \{[^}]*overflow-wrap: anywhere/);
  assert.ok(view.includes("IntersectionObserver") && view.includes("visibilitychange"), "pauses off screen and when the tab is hidden");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.fv-pt \{ display: none/);
  assert.ok(view.includes("reduced ? model.rows.map(() => 0)"), "no particles with reduced motion");
  assert.ok(css.includes('[data-theme="dark"] .fv-wrap'));
  assert.ok(mf.includes('data-testid="pl-view-funnel">Funnel</button>') && mf.includes('data-testid="pl-view-river">River</button>'));
  assert.ok(mf.indexOf('pl-view-funnel">Funnel') < mf.indexOf('pl-view-river">River'), "Funnel first (default)");
  assert.ok(mf.includes('useState<FlowView>("funnel")'));
  for (const s of [view, css]) assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(s));
  const jargon = /\bcohort\b|funnel stage|conversion rate/i;
  assert.ok(!jargon.test(view));
});

test("time: a replay day redraws the funnel from that day's recorded figures, never inventing", async () => {
  const { pathsAtFrame } = await import("../design/funnel-replay.ts");
  const { buildReplayFrames, replayHasMovement } = await import("../design/river-replay.ts");
  const base = pipeline(100);
  const river = base.stages.map((s, i) => ({ id: s.id, name: s.name, order: i + 1, count: 0, valueCents: 0, staleCount: 0, staleValueCents: 0, medianDwellDays: null, normalDwellDays: null, lostCount: 0, lostValueCents: 0 }));
  const days = [
    { date: "2026-11-10", stageCounts: [10, 8, 6, 4, 2], stageValueCents: [1, 1, 1, 1, 1], moves: [], wonCount: 0, wonCents: 0, lostCount: 0, lostCents: 0 },
    { date: "2026-11-11", stageCounts: [12, 9, 5, 4, 2], stageValueCents: [1, 1, 1, 1, 1], moves: [{ from: 2, to: null, status: "won" as const, count: 2, valueCents: 200 }, { from: 0, to: null, status: "lost" as const, count: 1, valueCents: 100 }], wonCount: 2, wonCents: 200, lostCount: 1, lostCents: 100 },
  ];
  assert.equal(replayHasMovement(days as never), true); assert.equal(replayHasMovement([] as never), false); assert.equal(replayHasMovement(null), false);
  const frames = buildReplayFrames(days as never, river, true);
  const a = pathsAtFrame(base, frames[0])!, b = pathsAtFrame(base, frames[1])!;
  assert.deepEqual(a.stages.map((s) => s.open), [10, 8, 6, 4, 2]); assert.equal(a.won.n, 0);
  assert.equal(b.won.n, 2); assert.equal(b.stages[0].lost, 1); assert.equal(b.stages[2].lost, 0);
  const ma = funnelModel(a, "deals", { enough: true }), mb = funnelModel(b, "deals", { enough: true });
  assert.ok(mb.rows[0].reach !== ma.rows[0].reach, "the picture changes from day to day");
  for (const m of [ma, mb]) { assert.ok(dotsOf(m) <= DOT_CAP); let prev = 1; for (const r of m.rows) { assert.ok(Number.isFinite(r.width) && r.width <= prev + 1e-9); if (r.width > 0) prev = r.width; } }
  // A step the day knows nothing about makes the day undrawable (null), not a guess.
  assert.equal(pathsAtFrame({ ...base, stages: [...base.stages, stage(9, 1, 0)] }, frames[0]), null);
});

test("depth and time on the screen: layered bands, parallax with motion only, a time bar, and an honest idle note", () => {
  const view = read("../../app/app/views/pl3/funnel-dots-view.tsx"), css = read("../../app/app/views/pl3/funnel-dots.css"), mf = read("../../app/app/views/pl3/money-flow.tsx");
  for (const layer of ["fv-layer-floor", "fv-layer-slab", "fv-layer-top", "fv-layer-dots", "fv-sheen", "fv-cyl", "radialGradient"]) assert.ok(view.includes(layer), layer);
  assert.ok(view.includes("e.pointerType === \"touch\"") && view.includes("if (reduced") && view.includes("--fv-tx"), "no tilt for touch or reduced motion");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.fv-svg \{ animation: none !important; transform: none !important/);
  assert.ok(css.includes('[data-motion="1"][data-hover="1"] .fv-svg') && css.includes("@keyframes fv-sway"));
  assert.ok(mf.includes("pathsAtFrame") && mf.includes("replayLabel") && mf.includes("Replay is off: "), "the time bar drives the funnel, and says why when nothing is replayed");
  assert.ok(!mf.includes('{flowView === "river" && <div className="pl-replay"'), "the time bar is on both views");
  assert.ok(!/deals\.map|rows\.map\(\(d\b/.test(view), "aggregates only: the screen never maps over deals");
});
