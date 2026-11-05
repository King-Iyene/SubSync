import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFlow, leadsOfLink, leadsOfNode, resolveFlowRange, type FlowLead } from "../analytics/lead-flow.ts";

let n = 0;
const lead = (o: Partial<FlowLead>): FlowLead => ({ id: `a:${++n}`, locationId: "a", accountName: "A", name: `P${n}`, at: 1, reply: "replied", booked: false, outcome: null, won: false, url: "", ...o });
const fixture: FlowLead[] = [
  ...Array.from({ length: 4 }, () => lead({ reply: "replied", booked: true, outcome: "showed", won: true })),
  lead({ reply: "replied", booked: true, outcome: "noshow" }),
  lead({ reply: "replied", booked: true, outcome: "waiting" }),
  ...Array.from({ length: 3 }, () => lead({ reply: "replied" })),
  ...Array.from({ length: 2 }, () => lead({ reply: "never" })),
  lead({ reply: "never", booked: true, outcome: "showed" }),
  lead({ reply: "unknown" }),
  lead({ reply: "unknown", booked: true, outcome: "waiting" }),
];

test("steps add up: replied + never + not checked = new, booked + no appointment = new, outcomes = booked", () => {
  const f = buildFlow(fixture);
  const c = (id: string) => f.nodes.find((x) => x.id === id)!.count;
  assert.equal(f.total, 14);
  assert.equal(c("replied") + c("never") + c("unknown"), 14);
  assert.equal(c("booked") + c("nobook"), 14);
  assert.equal(c("showed") + c("noshow") + c("waiting"), c("booked"));
  assert.deepEqual([c("replied"), c("never"), c("unknown"), c("booked"), c("showed"), c("noshow"), c("waiting")], [9, 3, 2, 8, 5, 1, 2]);
  assert.equal(f.won, 4);
});

test("every link count equals the people behind it, and links out of a step add up to the step", () => {
  const f = buildFlow(fixture);
  for (const l of f.links) assert.equal(leadsOfLink(fixture, l.from, l.to).length, l.count);
  for (const node of ["new", "replied", "never", "unknown"] as const) {
    const out = f.links.filter((l) => l.from === node).reduce((s, l) => s + l.count, 0);
    const own = f.nodes.find((x) => x.id === node)!.count;
    assert.equal(out, own, node);
  }
  assert.equal(f.links.filter((l) => l.from === "booked").reduce((s, l) => s + l.count, 0), leadsOfNode(fixture, "booked").length);
});

test("percentages are of the parent step, and absent under the minimum", () => {
  const f = buildFlow(fixture);
  assert.equal(f.nodes.find((x) => x.id === "replied")!.pct, 64);
  assert.equal(f.nodes.find((x) => x.id === "showed")!.pct, 63); // 5 of 8 booked
  const few = buildFlow(fixture.slice(0, 5));
  assert.equal(few.enough, false);
  assert.ok(few.nodes.every((x) => x.pct === null));
  assert.equal(buildFlow([]).total, 0);
});

test("date choices: last 7 and 30 days, this and last month, custom with plain problems", () => {
  assert.deepEqual(resolveFlowRange("7d", "2026-11-05"), { from: "2026-10-30", to: "2026-11-05", label: "Last 7 days", problem: null });
  assert.equal(resolveFlowRange("30d", "2026-11-05").from, "2026-10-07");
  assert.deepEqual([resolveFlowRange("this-month", "2026-11-05").from, resolveFlowRange("this-month", "2026-11-05").to], ["2026-11-01", "2026-11-05"]);
  assert.deepEqual([resolveFlowRange("last-month", "2026-11-05").from, resolveFlowRange("last-month", "2026-11-05").to], ["2026-10-01", "2026-10-31"]);
  assert.deepEqual([resolveFlowRange("last-month", "2026-01-10").from, resolveFlowRange("last-month", "2026-01-10").to], ["2025-12-01", "2025-12-31"]);
  assert.equal(resolveFlowRange("custom", "2026-11-05", "2026-10-01", "2026-10-15").problem, null);
  assert.match(resolveFlowRange("custom", "2026-11-05", "2026-10-15", "2026-10-01").problem ?? "", /before/);
  assert.match(resolveFlowRange("custom", "2026-11-05", "2026-10-15", "2026-12-01").problem ?? "", /future/);
  assert.match(resolveFlowRange("custom", "2026-11-05", undefined, undefined).problem ?? "", /Pick/);
  assert.match(resolveFlowRange("custom", "2026-11-05", "2024-01-01", "2026-11-01").problem ?? "", /at most/);
});
