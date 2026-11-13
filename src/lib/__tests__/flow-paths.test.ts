import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { biggestLeak, breakdown, closedDeals, lostTotal, pathSteps, pctText, reachOf, winTimeText, type FlowPaths, type PathSeg } from "../design/flow-paths.ts";
import { funnelFlowLayout, measuresOf } from "../design/funnel-flow-layout.ts";
import { riverLayout } from "../design/river-layout.ts";
import { sampleFlowPaths, sampleRiver } from "../design/river-sample.ts";

// A tiny in-memory mirror of the SQL rules: what the server counts for a label (pipeline3-flow-paths.ts) and what the list behind the click returns (flowReachCond in pipeline3-queries.ts).
type D = { stage: number; status: "open" | "won" | "lost"; value: number; owner: string | null; source: string | null; inWindow: boolean };
const STAGES = ["Qualified", "Disqualified", "Interviewing", "Onboarded", "No Hire"];
const openCounted = (d: D) => d.status === "open" && d.value > 0 && d.owner !== null;
const openNoValue = (d: D) => d.status === "open" && d.value <= 0;
const flowOpen = (d: D, dealsMode: boolean) => openCounted(d) || (dealsMode && openNoValue(d));
/** Rows the list returns for "got to step `ord` or further" (flowReachCond). */
const reachRows = (ds: D[], ord: number, dealsMode: boolean) => ds.filter((d) => (flowOpen(d, dealsMode) && d.stage >= ord) || (d.status === "lost" && d.inWindow && d.stage >= ord) || (d.status === "won" && d.inWindow));
/** What the server's aggregate counts per step (flowPaths). */
function aggregate(ds: D[]): FlowPaths {
  const won = ds.filter((d) => d.status === "won" && d.inWindow);
  const seg = (k: "owner" | "source"): PathSeg[] => { const m = new Map<string, PathSeg>(); for (const d of won) { const key = d[k] ?? "none"; const c = m.get(key) ?? { key, name: key, n: 0, cents: 0 }; m.set(key, { ...c, n: c.n + 1, cents: c.cents + Math.round(d.value * 100) }); } return [...m.values()]; };
  return {
    pipelineName: "P",
    stages: STAGES.map((name, i) => {
      const here = ds.filter((d) => d.stage === i);
      return { id: name.toLowerCase(), name, order: i + 1, open: here.filter(openCounted).length, openCents: here.filter(openCounted).reduce((t, d) => t + Math.round(d.value * 100), 0), noValue: here.filter(openNoValue).length, stuck: 0, stuckCents: 0,
        lost: here.filter((d) => d.status === "lost" && d.inWindow).length, lostCents: here.filter((d) => d.status === "lost" && d.inWindow).reduce((t, d) => t + Math.round(d.value * 100), 0) };
    }),
    won: { n: won.length, cents: won.reduce((t, d) => t + Math.round(d.value * 100), 0), medianDays: 12, byOwner: seg("owner"), bySource: seg("source") },
    lostElsewhere: 0, minDeals: 15,
  };
}
const mk = (n: number, f: (i: number) => Partial<D>): D[] => Array.from({ length: n }, (_, i) => ({ stage: 0, status: "open", value: 100, owner: "a", source: "ads", inWindow: true, ...f(i) }));
// King's account: 4 deals sitting in Qualified, nobody in Disqualified, 54 in Interviewing, some closed.
const KING: D[] = [
  ...mk(4, () => ({ stage: 0 })), ...mk(54, () => ({ stage: 2 })), ...mk(3, () => ({ stage: 3, status: "won", owner: "b", source: "referral" })),
  ...mk(2, () => ({ stage: 4, status: "lost" })), ...mk(5, (i) => ({ stage: 2, value: 0, owner: i % 2 ? null : "a" })),
];

test("a ribbon label counts exactly the rows the click opens, in money mode and in deal-count mode", () => {
  for (const dealsMode of [false, true]) {
    const p = aggregate(KING), steps = pathSteps(p, dealsMode);
    steps.forEach((s, i) => {
      assert.equal(s.fromN, reachRows(KING, i, dealsMode).length, `reach of ${s.fromName} (deals mode ${dealsMode})`);
      assert.equal(s.toN, s.toId === "won" ? KING.filter((d) => d.status === "won" && d.inWindow).length : reachRows(KING, i + 1, dealsMode).length, `moved on from ${s.fromName}`);
    });
  }
});
test("a high share beside a small pile is real: of everything that got to Qualified, most are past it and 4 are still there", () => {
  const p = aggregate(KING.filter((d) => !(d.value <= 0)));
  const [q, dq, iv] = pathSteps(p, false);
  assert.equal(q.fromN, 63); assert.equal(q.toN, 59); assert.equal(q.stillHere, 4);
  assert.equal(q.label, "59 of 63 moved on (94%)");
  // Disqualified holds nobody open, so everyone who got there moved on: 100% (never a partial share rounded up).
  assert.equal(dq.fromN, dq.toN); assert.equal(dq.pct, "100%"); assert.equal(iv.stillHere, 54);
  assert.equal(pctText(199, 200), "99%"); assert.equal(pctText(3, 4), "75%"); assert.equal(pctText(1, 1000), "1%"); assert.equal(pctText(0, 0), null);
});
test("a label reads in plain words: '3 of 4 moved on (75%)'", () => {
  const p: FlowPaths = { pipelineName: "P", stages: [{ id: "a", name: "A", order: 1, open: 1, openCents: 0, noValue: 0, stuck: 0, stuckCents: 0, lost: 0, lostCents: 0 }], won: { n: 3, cents: 0, medianDays: null, byOwner: [], bySource: [] }, lostElsewhere: 0, minDeals: 15 };
  assert.equal(pathSteps(p, false)[0].label, "3 of 4 moved on (75%)");
  assert.deepEqual(pathSteps(p, false)[0].short, ["3 of 4", "moved on 75%"]);
});
test("a step nobody reached says so, and the reach is never negative", () => {
  const p = aggregate([]);
  assert.equal(pathSteps(p, false)[0].label, "Nobody got here in these dates");
  assert.deepEqual(reachOf({ stages: p.stages, won: { ...p.won, n: -5, cents: -5 } }, false).n.every((x) => x >= 0), true);
});
test("deals without a value count only in deal-count mode", () => {
  const p = aggregate(KING), money = reachOf(p, false).n[0], deals = reachOf(p, true).n[0];
  assert.equal(deals - money, 5);
});

test("the funnel narrows step by step, bands are as thick as the next bar, and every part adds up", () => {
  const p = aggregate(KING);
  for (const measure of ["deals", "money"] as const) {
    const L = funnelFlowLayout(p, measure, { length: 900, thick: 260, nodeW: 30, enough: true }), m = measuresOf(p, measure);
    assert.equal(L.empty, false);
    for (let i = 0; i < L.nodes.length - 1; i++) assert.ok(L.nodes[i].h + 1e-6 >= L.nodes[i + 1].h, "never widens");
    for (const l of L.links) assert.ok(Math.abs(l.th - L.nodes[l.to].h) < 1e-6);
    for (const nd of L.nodes.filter((x) => x.kind === "stage")) assert.ok(Math.abs(nd.lostH + nd.flowH + nd.waitH - nd.h) < 1e-6, "parts fill the bar");
    L.nodes.forEach((nd, i) => assert.equal(nd.reach, m.reach[i]));
    assert.equal(L.tails.reduce((t, x) => t + x.amount, 0), m.lost.reduce((t, x) => t + x, 0), "lost tails add up to the lost");
    for (const nd of L.nodes) for (const v of [nd.al, nd.ac, nd.h, nd.flowH]) assert.ok(Number.isFinite(v));
  }
});
test("the funnel splits at the end into won and what is left", () => {
  const p = aggregate(KING), L = funnelFlowLayout(p, "deals", { length: 900, thick: 260, nodeW: 30, enough: true }), last = L.nodes[L.nodes.length - 2], won = L.nodes[L.nodes.length - 1];
  assert.equal(won.kind, "won"); assert.equal(won.reach, 3);
  assert.ok(Math.abs(last.flowH - won.h) < 1e-6);
});
test("nothing anywhere draws nothing (never NaN)", () => {
  assert.equal(funnelFlowLayout(aggregate([]), "deals", { length: 600, thick: 200, nodeW: 30 }).empty, true);
  assert.equal(funnelFlowLayout({ stages: [], won: { n: 0, cents: 0, medianDays: null, byOwner: [], bySource: [] } }, "money", { length: 600, thick: 200, nodeW: 30 }).empty, true);
});
test("the biggest leak needs enough closed deals; with too few the counts still show", () => {
  const p = aggregate(KING);
  assert.equal(closedDeals(p), 5); assert.equal(lostTotal(p), 2);
  assert.equal(biggestLeak(p, false), null);
  const many = aggregate([...KING, ...mk(12, () => ({ stage: 2, status: "lost" }))]);
  const leak = biggestLeak(many, false);
  assert.equal(leak?.name, "Interviewing"); assert.equal(leak?.lost, 12);
  assert.equal(funnelFlowLayout(p, "deals", { length: 900, thick: 260, nodeW: 30, enough: false }).leakIndex, null);
});

test("who won: the shown people plus the rest add up to the won total, by person and by source", () => {
  const ds = [...mk(30, (i) => ({ stage: 3, status: "won", owner: `p${i % 12}`, source: i % 5 === 0 ? null : `s${i % 3}` }))];
  const p = aggregate(ds);
  for (const segs of [p.won.byOwner, p.won.bySource]) {
    const b = breakdown(segs, 8, { n: p.won.n, cents: p.won.cents });
    assert.equal(b.shown.reduce((t, s) => t + s.n, 0) + (b.rest?.n ?? 0), 30);
    assert.equal(b.shown.reduce((t, s) => t + s.cents, 0) + (b.rest?.cents ?? 0), p.won.cents);
    assert.ok(b.shown.length <= 8);
    for (let i = 1; i < b.shown.length; i++) assert.ok(b.shown[i - 1].n >= b.shown[i].n, "biggest first");
  }
  // A segment opens exactly its won deals (the owner or source filter on the won list).
  const top = breakdown(p.won.byOwner, 8).shown[0];
  assert.equal(ds.filter((d) => d.status === "won" && d.owner === top.key).length, top.n);
  // The server caps the list: what it left out still adds up through the won total.
  assert.equal(breakdown(p.won.byOwner.slice(0, 3), 8, { n: 30, cents: p.won.cents }).rest?.n, 30 - p.won.byOwner.slice(0, 3).reduce((t, s) => t + s.n, 0));
});
test("time to win is said in plain words", () => {
  assert.equal(winTimeText(null), null); assert.equal(winTimeText(0.4), "Under a day"); assert.equal(winTimeText(1), "1 day"); assert.equal(winTimeText(12), "12 days"); assert.equal(winTimeText(12.5), "12.5 days");
});
test("the SAMPLE funnel adds up: every share sums to the won total and the steps feed the layout", () => {
  const f = sampleRiver(), p = sampleFlowPaths(f);
  assert.equal(p.won.byOwner.reduce((t, s) => t + s.n, 0), f.won.count); assert.equal(p.won.bySource.reduce((t, s) => t + s.n, 0), f.won.count);
  assert.equal(p.won.byOwner.reduce((t, s) => t + s.cents, 0), f.won.valueCents);
  assert.ok(p.won.byOwner.every((s) => /sample/i.test(s.name)), "made-up names are marked");
  assert.equal(funnelFlowLayout(p, "money", { length: 900, thick: 260, nodeW: 30, enough: true }).empty, false);
});

test("an empty Won column draws an empty vault, never a card or a ghost shape", () => {
  // Geometry: nothing won means no won ribbon and a zero-height node.
  const L = riverLayout([{ id: "a", name: "A", open: 5, stuck: 0, lost: 1 }], 0, { length: 600, thick: 200, nodeW: 30, enough: true });
  assert.equal(L.links.length, 0); assert.equal(L.nodes[1].h, 0); assert.equal(L.nodes[1].open, 0);
  // Screen: the label, no "None won", the vault glyph, no outlined card and no button.
  const src = readFileSync(new URL("../../app/app/views/pl3/river-view.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("No wins in these dates")); assert.ok(!src.includes("None won"));
  assert.ok(src.includes("emptyVault") && src.includes("rv-vault-door"));
  assert.ok(src.includes('nd.kind === "won" && !nothing && <rect className="rv-vault"'), "the outlined vault card is only drawn when something was won");
  const ff = readFileSync(new URL("../../app/app/views/pl3/funnel-flow-view.tsx", import.meta.url), "utf8");
  assert.ok(ff.includes("wonEmpty") && ff.includes("No wins in these dates"));
});

test("the label and the rows come from one rule: the server counts and lists with the same predicates", () => {
  const q = readFileSync(new URL("../analytics/pipeline3-queries.ts", import.meta.url), "utf8"), f = readFileSync(new URL("../analytics/pipeline3-flow-paths.ts", import.meta.url), "utf8");
  assert.ok(q.includes('case "flow_reach": return f.reachOrd ? flowReachCond(db, f)'));
  assert.ok(q.includes('case "flow_open": return db`and ${flowOpen(db, f.flowDeals === true)}`'));
  for (const piece of ["P_OPEN(db)", "P_NO_VALUE(db)", "P_STALE(db)", "flowWin(db, base)"]) assert.ok(f.includes(piece), piece);
  // Won and lost lists use the same window as the aggregate.
  assert.ok(q.includes('case "won": return db`and d.status = \'won\' and ${win}`') && q.includes("const win = db`d.last_status_change_at >= ${f.from}"));
  assert.ok(q.includes("flowWin = ") && q.includes("d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to} and not d.is_test"));
});
test("a ribbon with no count opens nothing; no vendor words on the new screens", () => {
  const rv = readFileSync(new URL("../../app/app/views/pl3/river-view.tsx", import.meta.url), "utf8");
  assert.ok(rv.includes("canOpen") && rv.includes('data-open={canOpen ? "1" : "0"}'));
  for (const file of ["funnel-flow-view.tsx", "money-flow.tsx", "river-view.tsx"]) {
    const s = readFileSync(new URL(`../../app/app/views/pl3/${file}`, import.meta.url), "utf8");
    assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(s), file);
  }
});
