import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attemptStates, bestHour, bookingText, callWindow, cadenceStep, clampCadence, cleanTag, conversionByAttempt, DEFAULT_CADENCE, DEFAULT_DISPOSITIONS, DEFAULT_GOALS, dispositionWrites,
  heatScore, leaderboard, nextLocalHour, noteDraft, powerHour, reorderByHeat, sanitizeDispositions, scriptFor, todaysCallbacks,
} from "../dial/dial6.ts";

const H = 3_600_000;
const NY = "America/New_York";

test("cadence: fresh, waiting, due, then a text fallback after the maximum, and a reached lead is done", () => {
  const c = { maxAttempts: 3, redialAfterHours: 4, nextDay: false };
  const t0 = Date.UTC(2026, 10, 6, 15);
  assert.deepEqual(cadenceStep(c, { attempts: 0, lastAt: null, reached: false }, t0), { state: "fresh", label: "touch 1 of 3", dueAt: null });
  assert.equal(cadenceStep(c, { attempts: 1, lastAt: t0, reached: false }, t0 + 3 * H).state, "waiting");
  const due = cadenceStep(c, { attempts: 2, lastAt: t0, reached: false }, t0 + 4 * H);
  assert.equal(due.state, "due"); assert.equal(due.label, "touch 3 of 3"); assert.equal(due.dueAt, t0 + 4 * H);
  assert.equal(cadenceStep(c, { attempts: 3, lastAt: t0, reached: false }, t0 + 99 * H).state, "text_fallback");
  assert.equal(cadenceStep(c, { attempts: 1, lastAt: t0, reached: true }, t0).state, "done");
});

test("cadence: next-day mode waits for 9:00 the next local day; settings are clamped", () => {
  const c = { maxAttempts: 4, redialAfterHours: 4, nextDay: true };
  const last = Date.UTC(2026, 10, 6, 20); // 15:00 in New York (EST)
  const s = cadenceStep(c, { attempts: 1, lastAt: last, reached: false }, last + H, NY);
  assert.equal(s.state, "waiting");
  assert.equal(s.dueAt, Date.UTC(2026, 10, 7, 14)); // 9:00 EST next day
  assert.deepEqual(clampCadence({ maxAttempts: 99, redialAfterHours: 0 }), { maxAttempts: 10, redialAfterHours: 1, nextDay: false });
  assert.deepEqual(clampCadence({}), DEFAULT_CADENCE);
});

test("call window: inside hours is ok, outside names the next opening in THEIR time, an unknown zone is allowed but marked", () => {
  const inside = callWindow(Date.UTC(2026, 10, 6, 17), NY); // 12:00
  assert.equal(inside.ok, true); assert.equal(inside.label, null);
  const night = callWindow(Date.UTC(2026, 10, 6, 3), NY); // 22:00 the evening before
  assert.equal(night.ok, false); assert.equal(night.label, "call at 9:00 their time"); assert.equal(night.nextAt, Date.UTC(2026, 10, 6, 14));
  const early = callWindow(Date.UTC(2026, 10, 6, 11), NY); // 6:00
  assert.equal(early.ok, false); assert.equal(early.nextAt, Date.UTC(2026, 10, 6, 14));
  const unknown = callWindow(Date.UTC(2026, 10, 6, 3), null);
  assert.deepEqual({ ok: unknown.ok, unknown: unknown.unknown }, { ok: true, unknown: true });
  assert.equal(callWindow(Date.UTC(2026, 10, 6, 19), NY, { start: 9, end: 12 }).ok, false); // 14:00, after a narrower window
  assert.equal(nextLocalHour(Date.UTC(2026, 10, 6, 14), NY, 9, true), Date.UTC(2026, 10, 7, 14));
});

test("best hour: needs 12 tries and 3 in the hour, otherwise nothing is guessed", () => {
  const at = (h: number, n: number, reached: boolean) => Array.from({ length: n }, (_, i) => ({ at: Date.UTC(2026, 10, 1 + i, h), reached }));
  assert.equal(bestHour([...at(10, 4, true)], "UTC"), null);
  const tries = [...at(10, 5, true), ...at(14, 5, false), ...at(16, 2, true), ...at(9, 2, false)];
  assert.deepEqual(bestHour(tries, "UTC"), { hour: 10, rate: 100, tries: 5 });
  assert.equal(bestHour([...at(10, 6, false), ...at(11, 6, false)], "UTC"), null);
});

test("heat: a due callback jumps, failed tries cool, a closed window and a pending redial sink; re-ranking is stable", () => {
  const base = { openValue: 5000, ageHours: 2, priority: 50, attempts: 0, callbackDue: false, windowOk: true, waitingForRedial: false };
  const fresh = heatScore(base);
  assert.ok(heatScore({ ...base, callbackDue: true }).score > fresh.score);
  assert.ok(heatScore({ ...base, attempts: 3 }).score < fresh.score);
  assert.ok(heatScore({ ...base, windowOk: false }).score < fresh.score - 30);
  assert.ok(heatScore({ ...base, waitingForRedial: true }).score < fresh.score - 20);
  assert.ok(heatScore({ ...base, openValue: 0, ageHours: 500, priority: 0, attempts: 5 }).score >= 0);
  const items = [{ key: "b", ...base, windowOk: false }, { key: "a", ...base }, { key: "c", ...base, callbackDue: true }];
  assert.deepEqual(reorderByHeat(items).map((x) => x.key), ["c", "a", "b"]);
});

test("dispositions: booked sets a tag, wrong number and do-not-call mark the lead; custom sets are validated", () => {
  const by = Object.fromEntries(DEFAULT_DISPOSITIONS.map((d) => [d.key, d]));
  assert.deepEqual(dispositionWrites(by.booked), [{ kind: "tag_add", tag: "subsync-booked" }]);
  assert.equal(by.wrong_number.doNotCall, true); assert.deepEqual(dispositionWrites(by.wrong_number), [{ kind: "tag_add", tag: "wrong-number" }]);
  assert.equal(by.no_answer.next, "redial"); assert.equal(by.call_back.next, "callback"); assert.deepEqual(dispositionWrites(by.spoke), []);
  assert.equal(cleanTag("  Hot Lead!! 2 "), "hot-lead-2");
  const custom = sanitizeDispositions([{ key: "k1", label: " Left with spouse ", base: "spoke", next: "callback", tag: "Spouse Home" }, { key: "k1", label: "dup", base: "spoke" }, { key: "x", label: "bad", base: "nope" }]);
  assert.equal(custom.length, 1); assert.equal(custom[0].label, "Left with spouse"); assert.equal(custom[0].tag, "spouse-home");
  assert.equal(sanitizeDispositions("junk"), DEFAULT_DISPOSITIONS);
});

test("templates: booking text, note draft and per-source script fill from context only", () => {
  assert.equal(bookingText("Hi {name}, {me} at {business}: {link}", { name: "Dana Cole", me: "Sam", business: "Acme", link: "https://b.test/x" }), "Hi Dana, Sam at Acme: https://b.test/x");
  assert.equal(noteDraft({ disposition: "No answer", name: "Dana", attempt: 2, max: 4, source: "Website form" }), "Call 2 of 4 to Dana: no answer. Lead source: Website form.");
  assert.match(noteDraft({ disposition: "Call back later", name: "D", attempt: 1, max: 4, callbackAt: "2026-11-07T15:00:00Z" }), /Call back around 2026-11-07 15:00 UTC/);
  assert.equal(scriptFor({ "website form": "web script" }, "Website Form", "default"), "web script");
  assert.equal(scriptFor({}, null, "default"), "default");
});

test("power hour: rings fill to the goal and stop at 100, only calls inside the hour count, the clock runs down", () => {
  const t0 = 1_000_000_000_000;
  const logged = [{ outcome: "spoke" as const, at: t0 + 60_000 }, { outcome: "booked" as const, at: t0 + 120_000 }, { outcome: "no_answer" as const, at: t0 + 61 * 60_000 }, { outcome: "no_answer" as const, at: t0 - 5 }];
  const p = powerHour({ startedAt: t0, now: t0 + 30 * 60_000, minutes: 60, goals: { calls: 4, reached: 1, booked: 4 }, logged });
  assert.deepEqual({ calls: p.calls, reached: p.reached, booked: p.booked }, { calls: 2, reached: 2, booked: 1 });
  assert.deepEqual(p.rings, { calls: 50, reached: 100, booked: 25 }); assert.equal(p.msLeft, 30 * 60_000); assert.equal(p.over, false);
  assert.equal(powerHour({ startedAt: t0, now: t0 + 2 * H, minutes: 60, goals: DEFAULT_GOALS, logged: [] }).over, true);
});

test("leaderboard: booked counts most, tiers are Orbit/Surge/Spark, the fastest answer is marked once", () => {
  const rows = leaderboard([
    { id: "a", name: "Ana", calls: 20, reached: 5, booked: 1, medianAnswerSeconds: 90 },
    { id: "b", name: "Ben", calls: 8, reached: 4, booked: 3, medianAnswerSeconds: 40 },
    { id: "c", name: "Cy", calls: 30, reached: 2, booked: 0, medianAnswerSeconds: 200 },
    { id: "d", name: "Di", calls: 4, reached: 0, booked: 0 },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.tier, r.rank]), [["Ben", "Orbit", 1], ["Ana", "Surge", 2], ["Cy", "Surge", 3], ["Di", "Spark", 4]]);
  assert.deepEqual(rows.filter((r) => r.fastest).map((r) => r.name), ["Ben"]);
});

test("conversion by attempt: which call books, counts equal leads, a rate needs 10 leads", () => {
  const calls = [];
  for (let n = 0; n < 12; n++) { calls.push({ contactId: `c${n}`, at: 1, outcome: "no_answer" }); calls.push({ contactId: `c${n}`, at: 2, outcome: n < 3 ? "booked" : "no_answer" }); }
  calls.push({ contactId: "z", at: 1, outcome: "booked" });
  const r = conversionByAttempt(calls);
  assert.deepEqual(r[0], { attempt: 1, leads: 13, booked: 1, rate: 8 });
  assert.deepEqual(r[1], { attempt: 2, leads: 12, booked: 3, rate: 25 });
  assert.equal(r.length, 2);
  assert.equal(conversionByAttempt([{ contactId: "a", at: 1, outcome: "booked" }])[0].rate, null);
});

test("attempt states and today's callbacks", () => {
  const s = attemptStates([{ contactId: "a", at: 5, outcome: "no_answer" }, { contactId: "a", at: 9, outcome: "no_answer" }, { contactId: "b", at: 3, outcome: "spoke" }]);
  assert.deepEqual(s.get("a"), { attempts: 2, lastAt: 9, reached: false }); assert.equal(s.get("b")?.reached, true);
  const now = Date.UTC(2026, 10, 6, 15);
  const list = [{ key: "2", name: "B", at: Date.UTC(2026, 10, 6, 20) }, { key: "1", name: "A", at: Date.UTC(2026, 10, 6, 16) }, { key: "3", name: "C", at: Date.UTC(2026, 10, 8, 16) }];
  assert.deepEqual(todaysCallbacks(list, now, "UTC").map((c) => c.key), ["1", "2"]);
});
