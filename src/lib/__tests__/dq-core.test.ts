import assert from "node:assert/strict";
import { test } from "node:test";
import {
  badgeOf, bestWorst, bestWorstLine, bulkMergePhrase, components, decodeCur, deletePhrase, dialerHours, encodeCur, headlineOf, intakeAlerts, mergePhrase, pairId, previewLine, qualityOf, qualityWhy,
  rate, sourceKey, sourceLabel, zeroFill, MIN_LEADS, ZERO, type DayCount, type SourceRow,
} from "../dq/dq-core.ts";

test("components join contacts that share ANY key, the tier is the strongest link, and the oldest come first", () => {
  const c = components([
    { kind: "email", ids: ["a", "b"] }, { kind: "phone", ids: ["b", "c"] }, { kind: "name", ids: ["x", "y"] }, { kind: "name_phone", ids: ["p", "q"] },
  ]);
  assert.deepEqual(c.map((g) => [g.tier, g.ids.join("")]), [["certain", "abc"], ["likely", "pq"], ["possible", "xy"]]);
  assert.equal(c[0].badge, "Same phone and email");
  assert.equal(c[1].badge, "Same name, close phone");
  assert.equal(c[2].badge, "Similar name");
  assert.equal(badgeOf(["phone"]), "Same phone");
});

test("a group of rejected pairs is dropped, a group with one new member is kept", () => {
  const rejected = new Set([pairId("a", "b")]);
  assert.equal(components([{ kind: "phone", ids: ["a", "b"] }], { rejected }).length, 0);
  assert.equal(components([{ kind: "phone", ids: ["a", "b", "c"] }], { rejected }).length, 1);
});

test("a group over 10 records is trimmed and says so; singletons never become groups", () => {
  const ids = Array.from({ length: 14 }, (_, i) => `c${i}`);
  const [g] = components([{ kind: "email", ids }]);
  assert.equal(g.ids.length, 10); assert.equal(g.trimmed, true);
  assert.equal(components([{ kind: "email", ids: ["only"] }]).length, 0);
});

test("typed phrases name the thing, and the preview line is one short line", () => {
  assert.equal(mergePhrase("  Ann   Lee "), "merge Ann Lee");
  assert.equal(deletePhrase(1, "Ann Lee"), "delete Ann Lee");
  assert.equal(deletePhrase(3), "delete 3 contacts");
  assert.equal(bulkMergePhrase(1), "merge 1 group");
  assert.equal(previewLine({ keep: { tags: ["a"] }, others: [{ tags: ["a", "b"], openDeals: 1, wonDeals: 1, appointments: 1, hasConversation: true }] }), "Keeps 1 record. Moves 1 tag, 2 deals, 1 appointment and 1 conversation.");
  assert.equal(previewLine({ keep: { tags: [] }, others: [{ tags: [], openDeals: 0, wonDeals: 0, hasConversation: false }] }), "Keeps 1 record. Nothing else to move.");
});

test("the headline and the dialer-hours estimate use the written formula", () => {
  assert.equal(dialerHours({ badPhones: 340, dupExtra: 30 }), 12.3);
  assert.equal(headlineOf({ groups: 12, badPhones: 340, dupExtra: 30 }), "12 duplicate groups, 340 bad numbers: fixing them saves about 12.3 dialer hours a month.");
  assert.equal(headlineOf({ groups: 0, badPhones: 0, dupExtra: 0 }), "No duplicates or bad numbers found.");
  assert.match(headlineOf({ groups: 1, badPhones: 0, dupExtra: 1 }), /under an hour/);
});

const Q = { contacts: 1000, dupExtra: 0, junk: 0, badPhone: 0, badEmail: 0, noPhone: 0, noEmail: 0, noOwner: 0, noSource: 0, recent: { leads: 100, dups: 0, junk: 0, noSource: 0 } };
test("quality score: 100 when clean, parts lose weight in proportion, 'not enough data' under 50 contacts, intake left out under 20 leads", () => {
  assert.equal(qualityOf(Q).score, 100);
  const dirty = qualityOf({ ...Q, dupExtra: 100 }); // 10% extra records: the full duplicate weight (30 of 100)
  assert.equal(dirty.score, 70); assert.equal(dirty.parts[0].id, "duplicates");
  assert.equal(qualityOf({ ...Q, contacts: 49 }).score, null);
  const few = qualityOf({ ...Q, dupExtra: 100, recent: { leads: 5, dups: 5, junk: 0, noSource: 0 } });
  assert.ok(few.parts.every((p) => p.id !== "intake")); assert.ok(few.note);
  assert.equal(few.score, 63); // 30 of the remaining 80 weight lost, rescaled: 62.5
  assert.match(qualityWhy(dirty), /duplicates/);
  assert.ok(qualityOf({ ...Q, dupExtra: 1000, junk: 1000, noPhone: 1000, recent: { leads: 50, dups: 50, junk: 0, noSource: 0 } }).score! <= 15);
});

const row = (label: string, o: Partial<SourceRow>): SourceRow => ({ key: label.toLowerCase(), label, ...ZERO, ...o });
test("best and worst source need 10 leads each and two sources; good = the clean share; the line is plain", () => {
  assert.equal(bestWorst([row("A", { leads: 10, quality: 9 })]).best, null);
  const b = bestWorst([row("Facebook ads", { leads: 100, quality: 60, wonValue: 12400, dups: 5 }), row("Quote form", { leads: 50, quality: 10, dups: 22 }), row("Tiny", { leads: 5, quality: 5 })]);
  assert.equal(b.best?.label, "Facebook ads"); assert.equal(b.worst?.label, "Quote form");
  assert.equal(bestWorstLine(b), "Best: Facebook ads (95% good leads, $12,400 won, 5% duplicates). Weakest: Quote form (56% good leads, 44% duplicates).");
  assert.equal(rate(1, MIN_LEADS - 1), null); assert.equal(rate(10, 20), 0.5);
});

const series = (f: (i: number) => number, dups = 0): DayCount[] => Array.from({ length: 31 }, (_, i) => ({ day: `d${i}`, leads: f(i), dups: Math.round(f(i) * dups), junk: 0 }));
test("low-rate: against the source's own normal, needs enough history, ignores a small wobble", () => {
  const steady = series(() => 4);
  assert.equal(intakeAlerts("fb", "Facebook ads", steady).length, 0);
  const drop = series((i) => (i >= 28 ? 1 : 4));
  const a = intakeAlerts("fb", "Facebook ads", drop);
  assert.equal(a[0].kind, "low_rate"); assert.match(a[0].title, /3 days/);
  assert.equal(intakeAlerts("fb", "x", series((i) => (i >= 28 ? 3 : 4))).length, 0, "a small wobble is not an alert");
  assert.equal(intakeAlerts("rare", "x", series((i) => (i === 3 ? 2 : 0))).length, 0, "no history, no baseline, no alert");
  assert.equal(intakeAlerts("fb", "x", series(() => 4).slice(10)).length, 0, "too short a history");
});
test("dead source: silent for far longer than its usual gap; a quiet source is given more time; heavy duplicates are an insight", () => {
  const dead = intakeAlerts("fb", "Quote form", series((i) => (i >= 24 ? 0 : 3)));
  assert.ok(dead.some((x) => x.kind === "dead" && /7 days/.test(x.title)));
  assert.equal(intakeAlerts("slow", "Slow", series((i) => (i % 7 === 0 && i < 28 ? 1 : 0))).filter((x) => x.kind === "dead").length, 0, "a weekly source is not dead after 3 days");
  const heavy = intakeAlerts("fb", "Quote form", series(() => 4, 0.5));
  assert.ok(heavy.some((x) => x.kind === "dup_heavy" && /50%/.test(x.title)));
});

test("zero fill, source keys, cursors", () => {
  const z = zeroFill([{ day: "2026-11-10", leads: 3, dups: 1, junk: 0 }], "2026-11-11", 3);
  assert.deepEqual(z.map((d) => [d.day, d.leads]), [["2026-11-09", 0], ["2026-11-10", 3], ["2026-11-11", 0]]);
  assert.equal(sourceKey("  Facebook   ADS "), "facebook ads"); assert.equal(sourceKey(""), "(none)"); assert.equal(sourceLabel(null), "No source");
  assert.deepEqual(decodeCur(encodeCur([3, "loc1", "abc-2"]), 3), [3, "loc1", "abc-2"]);
  assert.equal(decodeCur("not a cursor", 3), null); assert.equal(decodeCur(encodeCur(["a", "b"]), 3), null);
  assert.equal(decodeCur(Buffer.from(JSON.stringify(["'; drop table x;--"])).toString("base64url"), 1), null);
});
