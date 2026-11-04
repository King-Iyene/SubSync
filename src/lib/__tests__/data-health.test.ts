import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, emailState, fixName, fixPhone, isJunk, phoneState, protectedReason, type DhContact } from "../data-health/rules.ts";
import { benchmarkLine, bucketOf, scoreAccount, sinceInstall } from "../data-health/score.ts";
import { findSpikes } from "../data-health/firewall.ts";
import { checkFixToken, makeFixToken, planFixes } from "../data-health/fix.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const DAY = 86_400_000;
const mk = (i: number, o: Partial<DhContact> = {}): DhContact => ({
  contactId: `c${i}`, locationId: "L1", firstName: "Ann", lastName: `Lee${i}`, email: `a${i}@real.io`, phone: "+15551230000".slice(0, 8) + String(1000 + i), source: "Form",
  dnd: false, assignedTo: "u1", dateAdded: NOW - 5 * DAY, lastActivityAt: NOW - DAY, hasDeal: true, hasOpenDeal: false, hasConversation: true, hasUpcomingAppt: false, touchedBySubSync: false, ...o,
});

test("phone and email states", () => {
  assert.equal(phoneState(""), "missing");
  assert.equal(phoneState("123"), "bad");
  assert.equal(phoneState("5555555555"), "bad");
  assert.equal(phoneState("call me"), "bad");
  assert.equal(phoneState("(415) 555-0134"), "ok");
  assert.equal(emailState("a@gmial.com"), "bad");
  assert.equal(emailState("a@b"), "bad");
  assert.equal(emailState("a@b.co"), "ok");
  assert.equal(emailState(null), "missing");
});
test("junk words", () => {
  assert.equal(isJunk({ firstName: "test", lastName: "", email: null, phone: null }), true);
  assert.equal(isJunk({ firstName: "Asdf", lastName: "x", email: null, phone: null }), true);
  assert.equal(isJunk({ firstName: "Ann", lastName: "Lee", email: "x@example.com", phone: null }), true);
  assert.equal(isJunk({ firstName: "Ann", lastName: "Lee", email: "ann@real.io", phone: null }), false);
  assert.equal(isJunk({ firstName: "Zed", lastName: "", email: null, phone: null }, ["zed"]), true);
});
test("clean account scores high, not enough data is null", () => {
  const clean = Array.from({ length: 60 }, (_, i) => mk(i));
  const r = scoreAccount(clean, new Set(), new Set(), DEFAULTS, NOW);
  assert.equal(r.score, 100);
  assert.match(r.why, /Nothing to fix/);
  const small = scoreAccount(clean.slice(0, 10), new Set(), new Set(), DEFAULTS, NOW);
  assert.equal(small.score, null);
  assert.match(small.why, /Not enough data/);
});
test("dirty account loses points and components equal flags", () => {
  const rows = Array.from({ length: 100 }, (_, i) => mk(i, i < 20 ? { firstName: "test", email: null, assignedTo: null } : {}));
  const r = scoreAccount(rows, new Set(["c50", "c51"]), new Set(), DEFAULTS, NOW);
  assert.ok(r.score! < 85);
  const junk = r.components.find((c) => c.id === "junk")!;
  assert.equal(junk.count, r.flags.filter((f) => f.rule === "junk").length);
  assert.equal(junk.count, 20);
  assert.equal(r.components.find((c) => c.id === "duplicate")!.count, 2);
  assert.equal(r.band, r.score! >= 65 ? "fair" : "poor");
});
test("ignored contacts leave the score", () => {
  const rows = Array.from({ length: 60 }, (_, i) => mk(i, i < 6 ? { firstName: "test" } : {}));
  const a = scoreAccount(rows, new Set(), new Set(), DEFAULTS, NOW);
  const b = scoreAccount(rows, new Set(), new Set(rows.slice(0, 6).map((c) => c.contactId)), DEFAULTS, NOW);
  assert.ok(b.score! > a.score!);
});
test("stale skips contacts our own write touched", () => {
  const old = NOW - 400 * DAY;
  const rows = Array.from({ length: 60 }, (_, i) => mk(i, { lastActivityAt: old, dateAdded: old, touchedBySubSync: i === 0 }));
  const r = scoreAccount(rows, new Set(), new Set(), DEFAULTS, NOW);
  assert.equal(r.components.find((c) => c.id === "stale")!.count, 59);
});
test("benchmark needs 10 accounts and 3 companies", () => {
  const b = { n: 12, companies: 4, p25: 60, median: 72, p75: 85 };
  assert.match(benchmarkLine(90, b, "x")!, /top quarter/);
  assert.equal(benchmarkLine(90, { ...b, n: 9 }, "x"), null);
  assert.equal(benchmarkLine(90, { ...b, companies: 2 }, "x"), null);
  assert.equal(benchmarkLine(null, b, "x"), null);
  assert.equal(bucketOf(300, null), "under 500 contacts");
  assert.equal(bucketOf(3000, "Med Spa!"), "med spa | 2,000 to 10,000 contacts");
});
test("since install", () => {
  const s = sinceInstall([{ day: "2026-10-01", score: 54 }, { day: "2026-11-01", score: 88 }, { day: "2026-10-15", score: null }], 40, 31);
  assert.deepEqual(s, { since: "2026-10-01", first: 54, now: 88, found: 40, fixed: 31 });
  assert.equal(sinceInstall([], 0, 0), null);
});
test("firewall: a source that suddenly makes junk", () => {
  const rows: DhContact[] = [];
  for (let i = 0; i < 12; i++) rows.push(mk(i, { source: "Import", firstName: "test", dateAdded: NOW - 3_600_000 }));
  for (let i = 20; i < 40; i++) rows.push(mk(i, { source: "Form", dateAdded: NOW - 2 * DAY }));
  const sp = findSpikes(rows, new Set(), DEFAULTS, NOW);
  assert.equal(sp.length, 1);
  assert.equal(sp[0].source, "Import");
  assert.equal(sp[0].recent, 12);
  // below the minimum count: nothing
  assert.equal(findSpikes(rows.slice(0, 5), new Set(), DEFAULTS, NOW).length, 0);
  // the account's own normal is high: nothing
  const usual = Array.from({ length: 14 * 8 }, (_, i) => mk(100 + i, { source: "Import", firstName: "test", dateAdded: NOW - (2 + (i % 12)) * DAY }));
  assert.equal(findSpikes([...rows.slice(0, 12), ...usual], new Set(), DEFAULTS, NOW).length, 0);
});
test("fix formats", () => {
  assert.equal(fixPhone("(415) 555-0134"), "+14155550134");
  assert.equal(fixPhone("+14155550134"), null);
  assert.equal(fixPhone("415-555-0134 ext 5"), null);
  assert.equal(fixPhone("12345"), null);
  assert.equal(fixName("JOHN SMITH"), "John Smith");
  assert.equal(fixName("mcdonald"), "McDonald");
  assert.equal(fixName("McDonald"), null);
  assert.equal(fixName("JD"), null);
  assert.equal(fixName("o'neil"), "O'Neil");
});
test("plan skips protected contacts and honours the cap", () => {
  const rows = [mk(1, { phone: "(415) 555-0134" }), mk(2, { phone: "(415) 555-0135", dnd: true }), mk(3, { phone: "(415) 555-0136", hasOpenDeal: true }), mk(4, { phone: "(415) 555-0137", hasUpcomingAppt: true }), mk(5, { phone: "(415) 555-0138" })];
  const p = planFixes(rows, ["phone"], "1", 100);
  assert.deepEqual(p.changes.map((c) => c.contactId), ["c1", "c5"]);
  assert.deepEqual(p.skipped.map((s) => s.reason), ["Do not disturb", "Open deal", "Upcoming appointment"]);
  assert.equal(planFixes(rows, ["phone"], "1", 1).changes.length, 1);
  assert.equal(protectedReason(mk(9)), null);
});
test("token ties to the exact changes", () => {
  const scope = { installationId: "i", actor: "u", locationId: "L1", changes: [1] };
  const t = makeFixToken(scope, NOW);
  assert.equal(checkFixToken(t, scope, NOW + 1000), "ok");
  assert.equal(checkFixToken(t, { ...scope, changes: [2] }, NOW + 1000), "invalid");
  assert.equal(checkFixToken(t, scope, NOW + 16 * 60_000), "expired");
  assert.equal(checkFixToken("x", scope, NOW), "invalid");
});
