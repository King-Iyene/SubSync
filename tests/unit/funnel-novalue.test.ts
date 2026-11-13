import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DotFunnel } from "@/app/app/views/pl3/funnel-dots-view";
import { openDealsDrawn, pathsAllNoValue, type FlowPaths, type PathStage } from "@/lib/design/flow-paths";
import { funnelModel } from "@/lib/design/funnel-dots";

// Deals with no dollar value must still be drawn (by deal counts) and named plainly, never dropped; an empty window with open deals shows where they are now.
// Rendered on the server to markup (no browser, no database). The live check against a real no-value pipeline is in the PR notes.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const noop = () => undefined;

const stage = (i: number, o: Partial<PathStage>): PathStage => ({ id: `s${i}`, name: `Step ${i}`, order: i, open: 0, openCents: 0, noValue: 0, stuck: 0, stuckCents: 0, lost: 0, lostCents: 0, ...o });
const won0 = { n: 0, cents: 0, medianDays: null, byOwner: [], bySource: [] };
const paths = (stages: PathStage[], extra: Partial<FlowPaths> = {}): FlowPaths => ({ pipelineName: "Cold outreach", stages, won: won0, lostElsewhere: 0, minDeals: 15, ...extra });
const render = (p: FlowPaths, measure: "deals" | "money", onNoValue = noop) => renderToStaticMarkup(el(DotFunnel, {
  paths: p, measure, width: 900, reduced: true, windowLabel: "Last 30 days", onReach: noop, onWaiting: noop, onLost: noop, onLostAll: noop, onWon: noop, onWonBy: noop, onNoValue,
}));

const onlyNoValue = paths([stage(0, { noValue: 6000 }), stage(1, { noValue: 2000 }), stage(2, { noValue: 742 })]);

describe("a pipeline whose deals carry no dollar value", () => {
  it("is recognised, and its open deals are counted", () => {
    expect(pathsAllNoValue(onlyNoValue)).toBe(true);
    expect(openDealsDrawn(onlyNoValue)).toBe(8742);
    expect(pathsAllNoValue(paths([stage(0, { noValue: 3, open: 2, openCents: 5000 })]))).toBe(false);
    expect(pathsAllNoValue(paths([stage(0, {})]))).toBe(false);
  });
  it("draws every step with its count, and says in plain words that these are deal counts", () => {
    const m = funnelModel(onlyNoValue, "deals", { enough: false });
    expect(m.empty).toBe(false);
    expect(m.rows.map((r) => r.reach)).toEqual([8742, 2742, 742, 0]);
    const html = render(onlyNoValue, "deals"), t = text(html);
    expect(t).toContain("These deals have no value, so this shows deal counts, not money.");
    for (const n of ["8,742", "2,742", "742"]) expect(t).toContain(n);
    expect(html).toContain('data-testid="fv-row-0"');
    expect(html).toContain('data-testid="fv-row-2"');
    expect(html).toContain('data-testid="fv-hatch-0"'); // hatched outline on every band
    expect(html).toContain('data-testid="fv-dotlegend"'); // legend kept
    expect(t).not.toContain("no funnel to draw");
  });
});

describe("a mixed pipeline", () => {
  const mixed = paths([stage(0, { open: 10, openCents: 100_000, noValue: 40 }), stage(1, { open: 5, openCents: 80_000, noValue: 0 }), stage(2, { open: 2, openCents: 20_000, noValue: 3 })]);
  it("shows a hatched no-value count beside each stage that has some, in Money and in Deals", () => {
    for (const measure of ["money", "deals"] as const) {
      const html = render(mixed, measure), t = text(html);
      expect(html).toContain('data-testid="fv-nv-0"');
      expect(html).toContain('data-testid="fv-nv-2"');
      expect(html).not.toContain('data-testid="fv-nv-1"');
      expect(t).toContain("40 no value");
      expect(t).toContain("3 no value");
      expect(t).not.toContain("These deals have no value, so this shows deal counts");
    }
  });
  it("never counts the no-value deals in the money, only in the deals measure", () => {
    const money = funnelModel(mixed, "money", { enough: false }), deals = funnelModel(mixed, "deals", { enough: false });
    expect(money.rows[0].reach).toBe(200_000);
    expect(deals.rows[0].reach).toBe(60);
    expect(money.rows.map((r) => r.noValue)).toEqual([40, 0, 3, 0]);
  });
  it("the no-value count opens exactly those deals (a button wired to onNoValue)", () => {
    const html = renderToStaticMarkup(el(DotFunnel, { paths: mixed, measure: "money", width: 900, reduced: true, windowLabel: "x", onReach: noop, onWaiting: noop, onLost: noop, onLostAll: noop, onWon: noop, onWonBy: noop, onNoValue: noop }));
    expect(html).toMatch(/<button[^>]*data-testid="fv-nv-0"/);
    expect(html).toContain("not counted in the money");
  });
});

describe("no deal moved in the dates, but the pipeline has open deals", () => {
  const now = paths([stage(0, { noValue: 700 }), stage(1, { open: 20, openCents: 90_000, noValue: 5 })], { nowOnly: true, history: { since: "2026-01-01T00:00:00.000Z", covers: true } });
  it("says where the deals are now instead of 'nothing reached this pipeline'", () => {
    const t = text(render(now, "deals"));
    expect(t).toContain("No deal moved in these dates; this shows where the 725 open deals are now.");
    expect(t).not.toContain("Nothing reached this pipeline");
    expect(t).not.toContain("no funnel to draw");
    expect(t).toContain("700");
    expect(t).toContain("deals here now"); // no claim about flow between steps
    expect(t).not.toContain("moved on");
  });
  it("draws one deal as 'deal is now'", () => {
    expect(text(render(paths([stage(0, { open: 1, openCents: 100 })], { nowOnly: true }), "deals"))).toContain("where the 1 open deal is now");
  });
});

describe("a pipeline with truly no deals", () => {
  it("shows the plain empty state, never the old contradiction", () => {
    const t = text(render(paths([stage(0, {}), stage(1, {})]), "deals"));
    expect(t).toBe("This pipeline has no deals to draw. When deals are added, the funnel appears here.");
  });
});

describe("wiring", () => {
  const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
  it("the screen drops the window on click-through when it shows the open deals now, so counts equal rows", () => {
    const mf = read("src/app/app/views/pl3/money-flow.tsx");
    expect(mf).toContain("fw: !paths.nowOnly");
    expect(mf).not.toContain("fw: true");
    expect(mf).toContain("onNoValue=");
    expect(read("src/lib/analytics/pipeline3-flow-paths.ts")).toContain("nowOnly");
    expect(read("src/lib/analytics/pipeline3-queries.ts")).toMatch(/case "no_value":[^\n]*flowWindow/);
  });
  it("the old wording is gone from every screen", () => {
    for (const f of ["src/app/app/views/pl3/money-flow.tsx", "src/app/app/views/pl3/funnel-dots-view.tsx"]) {
      expect(read(f)).not.toContain("Nothing reached this pipeline");
      expect(read(f)).not.toContain("no dollar value yet. Add a value");
    }
  });
});
