import assert from "node:assert/strict";
import { test } from "node:test";
import { channelOf, eventFromWebhook, leadEventFromWebhook, toEvent, type TouchEvent } from "../analytics/touch-events.ts";
import { afterHoursCover, bestTimes, channelMix, leadQuality, missedCalls, raceMoney, raceState, recoveredIn15, routingCheck, speedScore, textBackAudit } from "../analytics/speed-v4.ts";
import { applyFilter, bucketOf, dailyRollup, journey, journeyMembers, lostAtNight, parseFilter, proofByAccount, STEPS } from "../analytics/speed-v4-more.ts";
import type { LoadedRow } from "../analytics/speed-parts.ts";
import type { Outcomes } from "../analytics/speed-v3.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z"); // a Thursday
const min = (n: number) => n * 60_000;
const ids = { locationId: "A", contactId: "c1", conversationId: "v1" };
let n = 0;
function ev(over: Partial<TouchEvent>): TouchEvent { n += 1; return { key: `k${n}`, locationId: "A", contactId: "c1", conversationId: "v1", direction: "outbound", channel: "sms", kind: "message", at: NOW, userId: "u1", automated: false, source: "app", outcome: null, ...over }; }
let m = 0;
function lead(ago: number, after: number | null, over: Partial<LoadedRow> = {}): LoadedRow {
  m += 1;
  return { locationId: "A", contactId: `l${m}`, leadAt: NOW - min(ago), touchAt: after === null ? null : NOW - min(ago) + min(after), userId: after === null ? null : "u1", name: `L${m}`, assignedTo: "o1", source: "Website", tags: [], timeZone: "UTC", ...over };
}

// ---- touch events: metadata only, idempotent ----
test("an event keeps who, which way, which channel and when, never the words", () => {
  const e = toEvent({ id: "m1", at: NOW, direction: "outbound", userId: "u1", source: "app", type: "TYPE_SMS", status: "delivered", body: "my secret words" } as never, ids);
  assert.ok(e);
  assert.equal(e.channel, "sms"); assert.equal(e.automated, false);
  assert.ok(!JSON.stringify(e).includes("secret"), "the text never reaches an event");
  assert.deepEqual(Object.keys(e).sort(), ["automated", "at", "channel", "contactId", "conversationId", "direction", "key", "kind", "locationId", "outcome", "source", "userId"].sort());
});
test("the same message twice has the same key (idempotent), and a message without an id still has a stable key", () => {
  const a = toEvent({ id: "m1", at: NOW, direction: "inbound", userId: null, source: null, type: "TYPE_SMS" }, ids), b = toEvent({ id: "m1", at: NOW, direction: "inbound", userId: null, source: null, type: "TYPE_SMS" }, ids);
  assert.equal(a?.key, b?.key);
  const c = toEvent({ at: NOW, direction: "inbound", userId: null, source: null, type: "TYPE_SMS" }, ids), d = toEvent({ at: NOW, direction: "inbound", userId: null, source: null, type: "TYPE_SMS" }, ids);
  assert.equal(c?.key, d?.key);
});
test("channels, missed calls, failed sends, automation and internal comments", () => {
  assert.equal(channelOf("TYPE_CALL"), "call"); assert.equal(channelOf("TYPE_EMAIL"), "email"); assert.equal(channelOf("TYPE_WHATSAPP"), "whatsapp"); assert.equal(channelOf("TYPE_FB"), "chat"); assert.equal(channelOf(null), "other");
  assert.equal(toEvent({ at: NOW, direction: "inbound", userId: null, source: null, type: "TYPE_CALL", status: "no-answer" }, ids)?.kind, "missed_call");
  assert.equal(toEvent({ at: NOW, direction: "inbound", userId: null, source: null, type: "TYPE_CALL", status: "completed" }, ids)?.kind, "call");
  assert.equal(toEvent({ at: NOW, direction: "outbound", userId: "u1", source: "app", type: "TYPE_SMS", status: "undelivered" }, ids)?.kind, "failed");
  assert.equal(toEvent({ at: NOW, direction: "outbound", userId: null, source: "workflow", type: "TYPE_SMS" }, ids)?.automated, true);
  assert.equal(toEvent({ at: NOW, direction: "outbound", userId: "u1", source: "app", type: "TYPE_INTERNAL_COMMENT" }, ids), null);
  assert.equal(toEvent({ at: NaN, direction: "outbound", userId: null, source: null, type: "TYPE_SMS" }, ids), null);
});
test("a webhook gives an event from ids and fields only, and ignores other event types", () => {
  const body = { type: "InboundMessage", locationId: "L1", contactId: "C1", conversationId: "V1", messageId: "M1", messageType: "SMS", direction: "inbound", dateAdded: "2026-11-05T11:00:00Z", body: "private words" };
  const e = eventFromWebhook(body, "InboundMessage");
  assert.equal(e?.contactId, "C1"); assert.equal(e?.direction, "inbound"); assert.ok(!JSON.stringify(e).includes("private"));
  assert.equal(eventFromWebhook(body, "ContactCreate"), null);
  assert.equal(eventFromWebhook({ type: "InboundMessage" }, "InboundMessage"), null);
  assert.equal(leadEventFromWebhook({ locationId: "L1", id: "C9" }, "ContactCreate")?.kind, "created");
  assert.equal(leadEventFromWebhook({ locationId: "L1" }, "ContactCreate"), null);
});

// ---- the race and the score ----
test("the race: winning, close, losing at the exact target, and answered in time or late", () => {
  const t = (ago: number, touch: number | null) => raceState(NOW - min(ago), touch === null ? null : NOW - min(ago) + min(touch), 15, NOW).race;
  assert.equal(t(2, null), "winning"); assert.equal(t(10, null), "close"); assert.equal(t(15, null), "losing"); assert.equal(t(60, 15), "won"); assert.equal(t(60, 16), "lost");
  assert.equal(raceState(NOW + 1000, null, 15, NOW).msLeft, 15 * 60_000, "a clock skew never shows a negative wait");
});
test("a speed score needs 5 judged leads; ties at the target count as in time", () => {
  assert.equal(speedScore([lead(100, 5), lead(100, 5), lead(100, 5), lead(100, 5)], 15, NOW).score, null);
  const s = speedScore([lead(100, 15), lead(100, 5), lead(100, 30), lead(100, null), lead(100, 1)], 15, NOW);
  assert.equal(s.judged, 5); assert.equal(s.within, 3); assert.equal(s.score, 60); assert.equal(s.medianSeconds, 5 * 60);
});
test("lead quality from a phone, an email and a source; fake values score nothing", () => {
  assert.equal(leadQuality({ phone: "+1 (555) 234-5678", email: "ann@acme.com", source: "Facebook" }).score, 100);
  assert.equal(leadQuality({ phone: "1111111111", email: "test@test.com", source: "unknown" }).score, 0);
  assert.equal(leadQuality({ phone: null, email: null, source: null }).score, 0);
});
test("race money counts deals once and skips people with none", () => {
  const r = raceMoney([{ key: "A:1" }, { key: "A:2" }, { key: "A:3" }], new Map([["A:1", 1000], ["A:2", 0]]));
  assert.deepEqual(r, { dollars: 1000, withDeals: 1 });
});

// ---- coverage: missed calls, text back, best time, channels ----
test("a missed call: recovered inside 15 minutes, followed inside a day, open, or dropped", () => {
  const miss = (id: string, ago: number) => ev({ contactId: id, direction: "inbound", kind: "missed_call", channel: "call", at: NOW - min(ago), userId: null });
  const out = (id: string, at: number, over: Partial<TouchEvent> = {}) => ev({ contactId: id, at, ...over });
  const events = [
    miss("a", 120), out("a", NOW - min(120) + min(10)),                      // recovered in 10 minutes
    miss("b", 300), out("b", NOW - min(300) + min(60)),                      // followed, but late
    miss("c", 30),                                                           // open, still inside the day
    miss("d", 60 * 30),                                                      // dropped: nobody in a day
    miss("e", 120), out("e", NOW - min(120) + 0.5 * 60_000, { automated: true, userId: null, source: "workflow" }), // an automatic text-back within 60 s
  ];
  const calls = missedCalls(events, NOW);
  const by = (id: string) => calls.find((c) => c.contactId === id)!;
  assert.equal(recoveredIn15(by("a")), true); assert.equal(by("a").status, "followed");
  assert.equal(recoveredIn15(by("b")), false); assert.equal(by("b").status, "followed");
  assert.equal(by("c").status, "open"); assert.equal(by("d").status, "dropped");
  assert.equal(recoveredIn15(by("e")), true); assert.equal(by("e").textedBackSeconds, 30); assert.equal(by("e").status, "open", "an automatic text is a text-back but not a person follow-up, so the call stays open for a person");
  assert.equal(recoveredIn15({ firstOutboundSeconds: 900 }), true, "exactly 15 minutes counts"); assert.equal(recoveredIn15({ firstOutboundSeconds: 901 }), false);
});
test("the text-back audit needs 5 missed calls", () => {
  const c = (t: number | null) => ({ locationId: "A", contactId: "x", at: NOW, followedAt: null, textedBackSeconds: t, firstOutboundSeconds: t, status: "dropped" as const });
  assert.equal(textBackAudit([c(10), c(null)]).share, null);
  assert.equal(textBackAudit([c(10), c(null), c(20), c(null), c(5)]).share, 60);
});
test("best time to reach is by the account's own hour and only ranks with enough answers", () => {
  const events: TouchEvent[] = [];
  for (let i = 0; i < 12; i += 1) { // 12 tries at 09:00 in New York (14:00 UTC), 6 answered
    const at = Date.parse("2026-11-03T14:00:00Z") + i * 60_000;
    events.push(ev({ contactId: `b${i}`, at }));
    if (i < 6) events.push(ev({ contactId: `b${i}`, direction: "inbound", at: at + min(30), userId: null }));
  }
  const r = bestTimes(events, () => "America/New_York");
  const nine = r.hours.find((h) => h.hour === 9)!;
  assert.equal(nine.sent, 12); assert.equal(nine.rate, 0.5); assert.equal(r.best[0].hour, 9);
  assert.equal(bestTimes(events.slice(0, 4), () => "UTC").enough, false, "a handful of tries ranks nothing");
});
test("channel mix: a winner only when two channels have 20 sends; failures are counted apart", () => {
  const rows: TouchEvent[] = [];
  for (let i = 0; i < 20; i += 1) { rows.push(ev({ contactId: `s${i}`, channel: "sms" })); if (i < 10) rows.push(ev({ contactId: `s${i}`, direction: "inbound", at: NOW + min(5), userId: null })); }
  for (let i = 0; i < 20; i += 1) { rows.push(ev({ contactId: `e${i}`, channel: "email" })); if (i < 2) rows.push(ev({ contactId: `e${i}`, channel: "email", direction: "inbound", at: NOW + min(5), userId: null })); }
  rows.push(ev({ contactId: "f1", channel: "sms", kind: "failed" }));
  const mix = channelMix(rows);
  assert.equal(mix.find((r) => r.channel === "sms")!.winner, true); assert.equal(mix.find((r) => r.channel === "sms")!.failed, 1);
  assert.equal(channelMix(rows.filter((r) => r.channel === "sms")).some((r) => r.winner), false, "one channel alone has no winner");
  assert.equal(channelMix([ev({ channel: "call" })])[0].rate, null);
});
test("after hours cover and routing sanity respect their minimums", () => {
  const night = lead(60 * 14, null, { leadAt: Date.parse("2026-11-04T23:00:00Z") });
  assert.equal(afterHoursCover([night], [], () => "UTC").share, null);
  assert.equal(routingCheck(new Map([["o1", 5]]), new Set(["u2"])).enough, false);
  const r = routingCheck(new Map([["o1", 18], ["o2", 2]]), new Set(["u3"]));
  assert.deepEqual(r.noLeads, ["u3"]); assert.deepEqual(r.overloaded, ["o1"]);
});

// ---- buckets, filters, journey, rollup, proof ----
test("response buckets split on the exact edge", () => {
  assert.deepEqual([59, 60, 299, 300, 899, 900, 3599, 3600, 14_399, 14_400, null].map(bucketOf), ["<1m", "1-5m", "1-5m", "5-15m", "5-15m", "15-60m", "15-60m", "1-4h", "1-4h", "4h+", "none"]);
});
test("a filter from the address drops anything malformed and is never trusted", () => {
  const f = parseFilter(new URLSearchParams("f_source=Website&f_dow=9&f_hourFrom=x&f_bucket=bogus&f_status=late&f_owner=a%20b&f_channel=sms&f_tag=VIP"));
  assert.deepEqual(f, { source: "Website", status: "late", channel: "sms", tag: "vip" });
});
test("filters narrow by weekday and hour in the account's own zone, including an overnight window", () => {
  const ny = lead(0, 5, { leadAt: Date.parse("2026-11-05T02:30:00Z"), touchAt: Date.parse("2026-11-05T02:35:00Z"), timeZone: "America/New_York" }); // Wed 21:30 local
  const o = { targetMinutes: 15, now: NOW };
  assert.equal(applyFilter([ny], { dow: 3 }, o).length, 1); assert.equal(applyFilter([ny], { dow: 4 }, o).length, 0);
  assert.equal(applyFilter([ny], { hourFrom: 20, hourTo: 6 }, o).length, 1, "an overnight window wraps midnight");
  assert.equal(applyFilter([ny], { hourFrom: 8, hourTo: 18 }, o).length, 0);
  assert.equal(applyFilter([lead(5, 3, { tags: ["VIP"] })], { tag: "vip" }, o).length, 1);
  assert.equal(applyFilter([lead(5, 3)], { bucket: "none" }, o).length, 0);
});
test("the journey only narrows from step to step, and a step's list holds exactly its count", () => {
  const rows = [lead(100, 5), lead(100, 5), lead(100, 5), lead(100, null), lead(100, 5)];
  const oc: Outcomes = new Map([
    [`A:${rows[0].contactId}`, { booked: true, showed: true, won: true }], [`A:${rows[1].contactId}`, { booked: true, showed: false, won: false }],
    [`A:${rows[3].contactId}`, { booked: true, showed: true, won: true }], // never touched by a person: cannot count as booked through us
  ]);
  const replied = new Set([`A:${rows[2].contactId}`]);
  const j = journey(rows, oc, replied);
  assert.deepEqual(j.map((s) => s.count), [5, 4, 3, 2, 1, 1]);
  for (let i = 1; i < j.length; i += 1) assert.ok(j[i].count <= j[i - 1].count);
  for (const s of j) assert.equal(journeyMembers(rows, oc, replied, s.step).length, s.count, `${s.step}: count equals rows`);
  assert.equal(journeyMembers(rows, oc, replied, "booked", true).length, 1, "one replied lead dropped before booking");
  assert.equal(j[1].dropped, 1); assert.equal(STEPS.length, 6);
});
test("the journey with no events stored treats booked leads as replied and never goes backwards", () => {
  const r = lead(100, 5); const oc: Outcomes = new Map([[`A:${r.contactId}`, { booked: true, showed: false, won: false }]]);
  assert.deepEqual(journey([r], oc, null).map((s) => s.count), [1, 1, 1, 1, 0, 0]);
});
test("the daily rollup is idempotent and puts each lead on its own local day and hour", () => {
  const r = lead(0, 3, { leadAt: Date.parse("2026-11-05T03:30:00Z"), touchAt: Date.parse("2026-11-05T03:33:00Z"), timeZone: "America/New_York" }); // Nov 4, 22:30 local
  const a = dailyRollup([r], [], () => "America/New_York", 15, NOW), b = dailyRollup([r], [], () => "America/New_York", 15, NOW);
  assert.deepEqual(a, b);
  assert.equal(a[0].day, "2026-11-04"); assert.equal(a[0].byHour[22], 1); assert.equal(a[0].buckets["1-5m"], 1); assert.equal(a[0].within, 1); assert.equal(a[0].medianSeconds, 180);
  const withEvents = dailyRollup([], [ev({ kind: "failed", at: NOW }), ev({ channel: "email", at: NOW })], () => "UTC", 15, NOW);
  assert.equal(withEvents[0].failedSends, 1); assert.equal(withEvents[0].byChannel.email, 1);
});
test("proof: this month against last month per account, no score on a handful", () => {
  const rows = [...Array.from({ length: 6 }, () => lead(60 * 24 * 5, 5)), ...Array.from({ length: 6 }, () => lead(60 * 24 * 40, 30)), lead(60 * 24 * 3, 5, { locationId: "B" })];
  const p = proofByAccount(rows, () => 15, NOW);
  const a = p.find((x) => x.locationId === "A")!;
  assert.equal(a.now.score, 100); assert.equal(a.before.score, 0); assert.equal(p.find((x) => x.locationId === "B")!.now.score, null);
});
test("lost at night: a reply inside 12 hours does not count, a cell needs 2 leads to be an hour to cover", () => {
  const sat = Date.parse("2026-11-07T02:00:00Z"); // Saturday 02:00 UTC
  const mk = (touchAfter: number | null) => lead(0, null, { leadAt: sat, touchAt: touchAfter === null ? null : sat + min(touchAfter) });
  const rows = [mk(null), mk(null), mk(30), mk(13 * 60)];
  const after = () => true;
  const r = lostAtNight(rows, after, sat + 2 * 86_400_000);
  assert.equal(r.lost.length, 3); assert.equal(r.hoursToCover[0].leads, 3);
  assert.equal(lostAtNight([mk(null)], after, sat + 2 * 86_400_000).hoursToCover.length, 0);
});
