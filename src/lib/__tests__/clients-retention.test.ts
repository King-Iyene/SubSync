import test from "node:test";
import assert from "node:assert/strict";
import { agencyHealth, quieted, riskOf, type DayRow } from "../analytics/clients-retention.ts";
import type { ReceiptFacts } from "../analytics/clients-actions.ts";

const day = (n: number) => new Date(Date.UTC(2026, 10, 10) - n * 86_400_000).toISOString().slice(0, 10);
const series = (then: Partial<DayRow>, now: Partial<DayRow>, span = 30): DayRow[] => [
  { day: day(span), newContacts30d: 40, openValue: 20000, engagement: 70, ...then }, { day: day(0), newContacts30d: 40, openValue: 20000, engagement: 70, ...now },
];
test("risk: not enough data under 28 days of record, never a guess", () => {
  assert.equal(riskOf("a", "A", series({}, {}, 10)).level, "not_enough_data");
  assert.equal(riskOf("a", "A", []).level, "not_enough_data");
});
test("risk: lead drop, no leads, activity and money drops add up and name their reasons", () => {
  const r = riskOf("a", "A", series({}, { newContacts30d: 15, engagement: 40, openValue: 9000 }));
  assert.equal(r.points, 3 + 2 + 1); assert.equal(r.level, "high"); assert.equal(r.drivers.length, 3);
  assert.equal(riskOf("a", "A", series({}, { newContacts30d: 0 })).level, "high");
  assert.equal(riskOf("a", "A", series({}, { newContacts30d: 26 })).level, "watch"); // 35% drop, 2 points
  assert.equal(riskOf("a", "A", series({}, {})).level, "steady");
  assert.equal(riskOf("a", "A", series({ newContacts30d: 3 }, { newContacts30d: 0 })).points, 3, "tiny bases count only the no-leads rule");
});
const f = (o: Partial<ReceiptFacts> = {}): ReceiptFacts => ({ locationId: "x", name: "X", newContacts: 5, leads: 10, answered: 9, answeredInTarget: 8, targetMinutes: 15, appointments: { held: 5, showed: 3, noShow: 1, unmarked: 1 }, deals: { started: 0, startedValue: 0, won: 0, wonValue: 0, lost: 0 }, ...o });
test("agency health: shown only with at least two parts that have enough data", () => {
  assert.equal(agencyHealth([f()], [], []).score, null);
  const ok = { items: [{ id: "s", ok: true, text: "", fix: null }] };
  const h = agencyHealth([f(), f(), f()], [ok, ok, { items: [{ id: "a", ok: false, text: "", fix: "reconnect" as const }] }], []);
  assert.equal(h.parts.find((p) => p.id === "replies")?.enough, true); // 30 leads
  assert.equal(h.parts.find((p) => p.id === "appointments")?.enough, true); // 15 held
  assert.ok(h.score !== null && h.score > 0 && h.score <= 100);
  assert.match(h.message, /Estimate from \d of 4 parts/);
});
test("quieted: all hides everything, a kind hides only itself", () => {
  const m = new Map([["a", ["replies" as const]], ["b", ["all" as const]]]);
  assert.equal(quieted(m, "a", "replies"), true); assert.equal(quieted(m, "a", "noshows"), false);
  assert.equal(quieted(m, "b", "stale"), true); assert.equal(quieted(m, "c", "all"), false);
});
