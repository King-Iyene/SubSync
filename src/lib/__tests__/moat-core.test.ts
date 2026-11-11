import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appointmentOutcome, bandOf, benchmarkDecision, buildChannelMix, buildCurve, buildReceipt, canonicalJson, chainHash, estimateDollars, GENESIS_HASH, isVertical, median,
  moatKey, morningProofLine, notEnough, payloadHash, percentile, proofTextProblems, PROOF_METHOD, PROOF_NOTE, rangeText, receiptLine, signHash, verifyPage, waitClock,
  weekTrend, weeklyProofText, type StoredPage,
} from "../analytics/moat-core.ts";

const rates = { leads: 400, booked: 100, won: 20, lost: 20, avgDealValue: 1000 };

test("the dollar estimate is a low-to-high range from the written formula", () => {
  // 10 leads x 25% booked x 50% closed x $1,000 = $1,250; x 0.2 and x 0.3
  const e = estimateDollars(10, rates);
  assert.equal(e.ok, true);
  if (e.ok) { assert.equal(e.low, 250); assert.equal(e.high, 375); assert.equal(e.bookingRate, 0.25); assert.equal(e.closeRate, 0.5); }
  assert.equal(rangeText(e), "$250 to $375");
});

test("no estimate under the minimums, and it says what is missing", () => {
  const few = estimateDollars(5, { ...rates, leads: 60 });
  assert.equal(few.ok, false);
  assert.equal(notEnough(few), "Not enough data yet: 40 more leads needed");
  const deals = estimateDollars(5, { ...rates, won: 5, lost: 5 });
  assert.equal(notEnough(deals), "Not enough data yet: 20 more closed deals needed");
  assert.equal(estimateDollars(5, { ...rates, avgDealValue: null }).ok, false);
  assert.equal(rangeText(few), "Not enough data yet");
});

test("zero waiting leads is zero dollars, never negative", () => {
  const e = estimateDollars(-3, rates);
  assert.equal(e.ok && e.low, 0);
});

test("the receipt counts need no model and the sentence is honest", () => {
  const r = buildReceipt({ alerts: 14, saved: 9, stillWaiting: 5, replyMinutes: [30, 10, 50, 600], bookedAfter: 3, lateLeads: 20 }, rates);
  assert.equal(r.medianReplyMinutes, 40);
  const line = receiptLine(r);
  assert.match(line, /9 of 14 alerted leads got a reply/);
  assert.match(line, /3 booked afterwards/);
  assert.match(line, /estimated \$/);
  assert.equal(receiptLine(buildReceipt({ alerts: 0, saved: 0, stillWaiting: 0, replyMinutes: [], bookedAfter: 0, lateLeads: 0 }, rates)), "No leads needed an alert this period.");
  // without enough data the sentence carries no dollar figure at all
  assert.doesNotMatch(receiptLine(buildReceipt({ alerts: 2, saved: 1, stillWaiting: 1, replyMinutes: [5], bookedAfter: 0, lateLeads: 1 }, { ...rates, leads: 10 })), /\$/);
});

test("percentiles and medians", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([10, 20, 30, 40, 50], 90), 46);
  assert.equal(median([]), null);
});

test("reply speed bands", () => {
  assert.equal(bandOf(0), "m5"); assert.equal(bandOf(4.9), "m5"); assert.equal(bandOf(5), "m60"); assert.equal(bandOf(60), "h24");
  assert.equal(bandOf(1440), "late"); assert.equal(bandOf(null), "never");
});

test("the curve hides a band under 20 leads and the whole claim under 100 leads", () => {
  const thin = buildCurve([{ key: "m5", leads: 10, booked: 9 }, { key: "late", leads: 30, booked: 3 }]);
  assert.equal(thin.ok, false); assert.equal(thin.headline, null); assert.equal(thin.needMore, 60);
  assert.equal(thin.bands[0].bookRate, null);
  const full = buildCurve([{ key: "m5", leads: 40, booked: 20 }, { key: "m60", leads: 30, booked: 9 }, { key: "h24", leads: 20, booked: 3 }, { key: "late", leads: 20, booked: 1 }, { key: "never", leads: 10, booked: 0 }]);
  assert.equal(full.ok, true);
  assert.equal(full.headline, "Answered under 5 minutes: 50% booked. Answered after more than an hour: 10% booked.");
  assert.equal(full.bands.find((b) => b.key === "never")?.bookRate, null); // 10 leads: under the band minimum
});

test("week on week trend needs 5 replies in each week", () => {
  assert.deepEqual(weekTrend({ median: 10, n: 8 }, { median: 20, n: 9 }), { dir: "faster", changePct: -50 });
  assert.deepEqual(weekTrend({ median: 30, n: 8 }, { median: 20, n: 9 }), { dir: "slower", changePct: 50 });
  assert.equal(weekTrend({ median: 21, n: 8 }, { median: 20, n: 9 }).dir, "same");
  assert.equal(weekTrend({ median: 10, n: 4 }, { median: 20, n: 9 }).dir, "new");
});

test("the benchmark is suppressed until 10 accounts from 5 agencies, and when one agency is over 40%", () => {
  assert.equal(benchmarkDecision({ accounts: 9, agencies: 6, topAgencyShare: 0.2 }).show, false);
  assert.equal(benchmarkDecision({ accounts: 12, agencies: 4, topAgencyShare: 0.2 }).show, false);
  const dom = benchmarkDecision({ accounts: 20, agencies: 6, topAgencyShare: 0.41 });
  assert.equal(dom.show, false);
  assert.equal(!dom.show && dom.reason, "one_agency_dominates");
  assert.equal(benchmarkDecision({ accounts: 20, agencies: 6, topAgencyShare: 0.4 }).show, true);
  // the message never reveals which rule failed
  for (const c of [{ accounts: 1, agencies: 1, topAgencyShare: 1 }, { accounts: 20, agencies: 6, topAgencyShare: 0.9 }]) {
    const d = benchmarkDecision(c);
    assert.equal(!d.show && d.message, "Not enough accounts yet");
  }
});

test("two wait clocks: real and working hours, and which one is used", () => {
  const start = Date.parse("2026-11-06T21:00:00Z"); // Friday 4pm New York
  const end = Date.parse("2026-11-09T15:00:00Z"); // Monday 10am New York
  const working = waitClock(start, end, { businessHours: true, openHour: 9, closeHour: 17, zone: "America/New_York" });
  assert.equal(working.realMinutes, 66 * 60);
  assert.equal(working.workingMinutes, 120);
  assert.equal(working.used, "working"); assert.equal(working.usedMinutes, 120);
  const real = waitClock(start, end, { businessHours: false, openHour: 9, closeHour: 17, zone: "America/New_York" });
  assert.equal(real.used, "real"); assert.equal(real.usedMinutes, 66 * 60); assert.equal(real.usedLabel, "Counting every hour");
  const bad = waitClock(start, end, { businessHours: true, openHour: 17, closeHour: 9, zone: "UTC" });
  assert.equal(bad.used, "real"); assert.equal(bad.workingMinutes, null);
});

test("channel mix shares add up and the fastest channel needs 10 replies and two channels", () => {
  const mix = buildChannelMix([
    { channel: "sms", leads: 60, replied: 50, medianMinutes: 10 }, { channel: "email", leads: 30, replied: 20, medianMinutes: 90 },
    { channel: "Facebook", leads: 10, replied: 3, medianMinutes: 5 },
  ]);
  assert.equal(mix.total, 100);
  assert.deepEqual(mix.rows.map((r) => [r.channel, r.sharePct]), [["sms", 60], ["email", 30], ["social", 10]]);
  assert.equal(mix.fastest, "sms");
  assert.equal(buildChannelMix([{ channel: "sms", leads: 20, replied: 15, medianMinutes: 3 }]).fastest, null);
});

test("event keys are stable and hold no odd characters", () => {
  assert.equal(moatKey("lead_created", "loc1", "conv 1/x"), "lead_created|loc1|conv_1_x");
  assert.equal(moatKey("alert_fired", "a", null), "alert_fired|a|-");
});

test("appointment outcomes fold the platform's words", () => {
  assert.equal(appointmentOutcome("showed"), "showed"); assert.equal(appointmentOutcome("No-Show"), "no_show");
  assert.equal(appointmentOutcome("noshow"), "no_show"); assert.equal(appointmentOutcome("confirmed"), null); assert.equal(appointmentOutcome(null), null);
  assert.equal(isVertical("med_spa"), true); assert.equal(isVertical("plumber"), false);
});

test("the page chain: unchanged pages verify, an edited page or a broken link does not", () => {
  const payload = { b: 2, a: 1 };
  assert.equal(canonicalJson(payload), '{"a":1,"b":2}');
  const iso = "2026-11-10T10:00:00.000Z";
  const ph = payloadHash(payload);
  const ch = chainHash(GENESIS_HASH, ph, iso);
  const page: StoredPage = { payload, payloadHash: ph, prevHash: GENESIS_HASH, chainHash: ch, createdAtIso: iso, signature: signHash(ch, "secret") };
  assert.deepEqual(verifyPage(page, null, "secret"), { ok: true, contentUnchanged: true, linkIntact: true, signed: true });
  assert.equal(verifyPage(page, null, "other").signed, false);
  assert.equal(verifyPage({ ...page, payload: { a: 1, b: 3 } }, null, null).ok, false);
  const second: StoredPage = (() => { const p2 = { a: 5 }; const h2 = payloadHash(p2); return { payload: p2, payloadHash: h2, prevHash: ch, chainHash: chainHash(ch, h2, iso), createdAtIso: iso, signature: null }; })();
  assert.equal(verifyPage(second, ch, null).ok, true);
  assert.equal(verifyPage(second, "f".repeat(64), null).linkIntact, false);
  assert.equal(verifyPage(page, ch, null).linkIntact, false);
});

test("the page wording has no vendor word and no promise", () => {
  assert.deepEqual(proofTextProblems(`${PROOF_METHOD} ${PROOF_NOTE}`), []);
  assert.deepEqual(proofTextProblems("Powered by HighLevel"), ["vendor word"]);
  assert.deepEqual(proofTextProblems("We guarantee a 5 minute reply"), ["promise wording"]);
});

test("the weekly proof and the morning line stay short and honest", () => {
  const r = buildReceipt({ alerts: 4, saved: 3, stillWaiting: 1, replyMinutes: [20, 40, 90], bookedAfter: 1, lateLeads: 6 }, rates);
  assert.match(weeklyProofText("Acme Dental", r), /^Acme Dental: 3 of 4 alerted leads got a reply/);
  assert.equal(morningProofLine(r), "Last week: 3 of 4 alerted leads got a reply, typically within 40 min.");
  assert.equal(morningProofLine(buildReceipt({ alerts: 0, saved: 0, stillWaiting: 0, replyMinutes: [], bookedAfter: 0, lateLeads: 0 }, rates)), null);
});
