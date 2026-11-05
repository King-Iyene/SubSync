import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFlow, type FlowLead } from "../analytics/lead-flow.ts";
import { specClientsWeek, specFlowLink, specFlowNode } from "../analytics/flow-records.ts";
import { weeksOf } from "../analytics/clients-flow.ts";

let n = 0;
const lead = (o: Partial<FlowLead>): FlowLead => ({ id: `a:${++n}`, locationId: "a", accountName: "A", name: `P${n}`, at: 1, reply: "replied", booked: false, outcome: null, won: false, url: "https://crm/x", ...o });
const leads = [lead({ booked: true, outcome: "showed" }), lead({ booked: true, outcome: "noshow" }), lead({}), lead({ reply: "never" }), lead({ reply: "unknown", booked: true, outcome: "waiting" })];
const input = { flow: buildFlow(leads, 3), leads, sent: 5, partial: false, rangeLabel: "Last 7 days" };

test("the list behind every step and every link has exactly the counted rows", () => {
  for (const node of input.flow.nodes) assert.equal(specFlowNode(input, node.id).rows.length, node.count, node.id);
  for (const l of input.flow.links) { const s = specFlowLink(input, l.from, l.to); assert.equal(s.rows.length, l.count); assert.equal(s.count, l.count); }
});

test("a cut list says so, in words", () => {
  const cut = specFlowNode({ ...input, leads: leads.slice(0, 2) }, "new");
  assert.equal(cut.count, 5);
  assert.match(cut.note ?? "", /2 newest of 5/);
});

test("the clients behind a week's bar are the ones counted", () => {
  const now = Date.UTC(2026, 10, 5);
  const events = [{ locationId: "a", name: "A", kind: "added" as const, at: now }, { locationId: "b", name: "B", kind: "removed" as const, at: now }];
  const bar = weeksOf(events, now)[11];
  assert.equal(specClientsWeek(events, bar, "added").rows.length, bar.added);
  assert.equal(specClientsWeek(events, bar, "removed").rows.length, bar.removed);
});
