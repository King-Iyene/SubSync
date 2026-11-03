import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFilter, filterToParams, isEmptyFilter, listName, parseSmartFilter, scopeFilterTo } from "../people/filters.ts";
import { dialPlan, dialWarnings, localHour, mustStop, parseDialer, telNumber, DIALER_LINK_KNOWN } from "../people/dial.ts";
import { callResultLabel, errorRef, fillDays, isQueryTimeout, mapCallMessage } from "../people/helpers.ts";
import { diffTagEvents } from "../sync/tag-events.ts";
import { ttlCache } from "../ttl-cache.ts";

// ---------------- the filter builder ----------------

test("an empty filter is everyone; unknown keys are ignored", () => {
  const p = parseSmartFilter({ nonsense: 1 });
  assert.ok(p.ok && isEmptyFilter(p.filter));
  if (p.ok) assert.equal(describeFilter(p.filter), "Everyone.");
});

test("a filter is cleaned: trimmed, de-duplicated, numbers checked", () => {
  const p = parseSmartFilter({ q: "  sam ", tags: "vip, vip ,lead", tagMode: "all", owner: "none", quietDays: "14", deal: "open", lastCall: "never", hasPhone: "1", cold: "working", location: "abc123" });
  assert.ok(p.ok);
  if (p.ok) assert.deepEqual(p.filter, { q: "sam", tags: ["vip", "lead"], tagMode: "all", owner: "none", quietDays: 14, lastCall: "never", deal: "open", hasPhone: true, cold: "working", location: "abc123" });
});

test("bad choices are refused in plain words", () => {
  for (const bad of [
    { tagMode: "some" }, { quietDays: -1 }, { quietDays: "abc" }, { deal: "maybe" }, { lastCall: "5" }, { cold: "warm" }, { location: "bad id!" },
    { owner: "x y" }, { tags: "a,b,c,d,e,f" }, { seenFrom: "31 Oct", tags: "a" }, { seenFrom: "2026-02-31", tags: "a" },
    { seenFrom: "2026-11-02", seenTo: "2026-11-01", tags: "a" }, { seenFrom: "2026-11-01" },
  ]) {
    const p = parseSmartFilter(bad);
    assert.equal(p.ok, false, JSON.stringify(bad));
    if (!p.ok) assert.ok(p.error.length > 5);
  }
});

test("a tag day filter needs a tag, and good dates pass", () => {
  const p = parseSmartFilter({ tags: "vip", seenFrom: "2026-10-01", seenTo: "2026-10-31" });
  assert.ok(p.ok && p.filter.seenFrom === "2026-10-01" && p.filter.seenTo === "2026-10-31");
});

test("a filter survives the trip through the address and back", () => {
  const f = { tags: ["vip", "lead"], tagMode: "any" as const, owner: "u1abc", quietDays: 30, hideDnd: true, source: "Facebook ads" };
  const params = filterToParams(f);
  const back = parseSmartFilter(Object.fromEntries(params.entries()));
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.filter, f);
});

test("the sentence for a filter uses names, not ids", () => {
  const s = describeFilter({ owner: "u1abc", location: "loc1", quietDays: 14, lastCall: "never" }, { owner: () => "Sam Rivera", account: () => "Acme Dental" });
  assert.match(s, /owner Sam Rivera/);
  assert.match(s, /in Acme Dental/);
  assert.match(s, /no activity for 14\+ days/);
  assert.doesNotMatch(s, /u1abc|loc1/);
});

test("a client's own staff are always held to their own account", () => {
  assert.equal(scopeFilterTo({ location: "someone-elses-account" }, "mine123").location, "mine123");
  assert.equal(scopeFilterTo({}, "mine123").location, "mine123");
  assert.equal(scopeFilterTo({ location: "x1y2z3" }, null).location, "x1y2z3");
});

test("a list name is trimmed and capped", () => {
  assert.equal(listName("  Hot  "), "Hot");
  assert.equal(listName("   "), null);
  assert.equal(listName("x".repeat(60))?.length, 40);
  assert.equal(listName(5), null);
});

// ---------------- dialing (KF-3) ----------------

test("the default dialer is the CRM's, never a phone link", () => {
  assert.equal(parseDialer(undefined), "crm");
  assert.equal(parseDialer("anything"), "crm");
  assert.equal(parseDialer("phone"), "phone");
  const p = dialPlan("crm", { phone: "+1 555 010 1234", contactUrl: "https://crm.example.com/v2/location/loc1/contacts/detail/c1" });
  assert.equal(p.href, "https://crm.example.com/v2/location/loc1/contacts/detail/c1");
  assert.ok(!p.href?.startsWith("tel:"));
  assert.equal(p.label, "Call in your CRM");
});

test("with no CRM link that opens the dialer, the plan says so plainly and opens the contact", () => {
  assert.equal(DIALER_LINK_KNOWN, false);
  const p = dialPlan("crm", { phone: "5550101234", contactUrl: "https://x.example.com/c" });
  assert.equal(p.fallsBackToContact, true);
  assert.match(p.note, /Not available from your CRM yet/);
});

test("a tel: link exists only when the person chose their own phone app", () => {
  const p = dialPlan("phone", { phone: "+1 (555) 010-1234", contactUrl: "https://x.example.com/c" });
  assert.equal(p.href, "tel:+15550101234");
  assert.equal(dialPlan("phone", { phone: null, contactUrl: "https://x.example.com/c" }).href, null);
  assert.equal(telNumber("12"), null);
  assert.equal(telNumber("555 0101234"), "5550101234");
});

test("do not disturb is a stop, and quiet hours a caution, before any dial", () => {
  const noon = new Date("2026-11-01T17:00:00Z"); // 12:00 in New York
  const night = new Date("2026-11-01T03:00:00Z"); // 23:00 in New York the evening before
  assert.equal(localHour(noon, "America/New_York"), 12);
  assert.equal(localHour(noon, "Not/AZone"), null);
  const dnd = dialWarnings({ dnd: true, phone: "5550101234", timeZone: "America/New_York", now: noon });
  assert.ok(mustStop(dnd));
  assert.deepEqual(dialWarnings({ dnd: false, phone: "5550101234", timeZone: "America/New_York", now: noon }), []);
  const late = dialWarnings({ dnd: false, phone: "5550101234", timeZone: "America/New_York", now: night });
  assert.equal(late.length, 1);
  assert.equal(late[0].id, "quiet_hours");
  assert.equal(mustStop(late), false);
  assert.equal(dialWarnings({ dnd: false, phone: null, timeZone: null, now: noon }).map((w) => w.id).join(), "no_phone,zone_unknown");
});

// ---------------- tag history ----------------

test("tags seen added or removed are recorded, but not on the first read of an account", () => {
  const incoming = [{ contactId: "a", tags: ["vip", "new"] }, { contactId: "b", tags: ["x"] }, { contactId: "c", tags: [] }];
  const known = new Map<string, string[]>([["a", ["vip", "old"]], ["b", ["x"]]]);
  assert.deepEqual(diffTagEvents(incoming, known, false), []);
  const ev = diffTagEvents(incoming, known, true);
  assert.deepEqual(ev.map((e) => `${e.contactId}:${e.tag}:${e.kind}`).sort(), ["a:new:added", "a:old:removed"]);
});

test("a contact new since SubSync started watching records its tags as added, and a repeat records nothing", () => {
  const first = diffTagEvents([{ contactId: "n", tags: ["promo"] }], new Map(), true);
  assert.deepEqual(first, [{ contactId: "n", tag: "promo", kind: "added" }]);
  assert.deepEqual(diffTagEvents([{ contactId: "n", tags: ["promo"] }], new Map([["n", ["promo"]]]), true), []);
  assert.deepEqual(diffTagEvents([{ contactId: "n", tags: ["Promo ", "promo"] }], new Map([["n", ["promo"]]]), true).map((e) => e.tag), ["Promo"]);
});

test("per-day counts fill the quiet days with zero and never run away", () => {
  const days = fillDays([{ day: "2026-10-30", n: 4 }, { day: "2026-11-01", n: 1 }], "2026-10-29", "2026-11-01");
  assert.deepEqual(days, [{ day: "2026-10-29", n: 0 }, { day: "2026-10-30", n: 4 }, { day: "2026-10-31", n: 0 }, { day: "2026-11-01", n: 1 }]);
  assert.deepEqual(fillDays([], "2026-11-02", "2026-11-01"), []);
  assert.equal(fillDays([], "2020-01-01", "2026-11-01").length, 400);
});

// ---------------- the cache and the timeout ----------------

test("the cache forgets after its time and by prefix", () => {
  let t = 1000;
  const c = ttlCache<number>(100, 3, () => t);
  c.set("inst1|a", 1);
  c.set("inst1|b", 2);
  c.set("inst2|a", 3);
  assert.equal(c.get("inst1|a"), 1);
  t += 101;
  assert.equal(c.get("inst1|a"), undefined);
  c.set("inst1|a", 9);
  assert.equal(c.clear("inst1|"), 2); // inst1|a and the (expired but not yet read) inst1|b; inst2 is untouched
  assert.equal(c.get("inst1|a"), undefined);
});

test("the cache is capped: the oldest entry goes first", () => {
  const c = ttlCache<number>(10_000, 2);
  c.set("a", 1); c.set("b", 2); c.set("c", 3);
  assert.equal(c.get("a"), undefined);
  assert.equal(c.get("c"), 3);
  assert.equal(c.size(), 2);
});

test("only the database's own stop code counts as a timeout; the error reference is short and readable", () => {
  assert.equal(isQueryTimeout({ code: "57014" }), true);
  assert.equal(isQueryTimeout({ code: "23505" }), false);
  assert.equal(isQueryTimeout(new Error("57014")), false);
  assert.match(errorRef(), /^E-[A-Z2-9]{8}$/);
  assert.notEqual(errorRef(), errorRef());
});

// ---------------- calls from the CRM ----------------

test("a call message is read defensively and a text message is not a call", () => {
  assert.equal(mapCallMessage({ messageType: "TYPE_SMS", dateAdded: "2026-11-01T10:00:00Z" }), null);
  assert.equal(mapCallMessage({ messageType: "TYPE_CALL" }), null);
  const c = mapCallMessage({ messageType: "TYPE_CALL", direction: "outbound", dateAdded: "2026-11-01T10:00:00Z", userId: "u1", status: "completed", meta: { call: { duration: 125 } } });
  assert.ok(c);
  assert.deepEqual({ ...c }, { at: Date.parse("2026-11-01T10:00:00Z"), direction: "outbound", status: "completed", durationSeconds: 125, userId: "u1" });
  const bare = mapCallMessage({ type: "TYPE_CALL", dateAdded: 1_762_000_000 });
  assert.ok(bare && bare.status === null && bare.durationSeconds === null && bare.direction === null);
});

test("call results are said in plain words", () => {
  assert.equal(callResultLabel("completed", 125), "Answered, 2 min");
  assert.equal(callResultLabel("completed", 40), "Answered, 40 sec");
  assert.equal(callResultLabel("no-answer", null), "No answer");
  assert.equal(callResultLabel("voicemail", null), "Voicemail");
  assert.equal(callResultLabel(null, null), "Result not recorded");
});

// ---------------- who may call what, and where a phone link may appear ----------------

import { readFileSync } from "node:fs";
import { routeAllowed } from "../access.ts";

test("a client's staff may read People and keep their own lists and dialer choice, and nothing else on it", () => {
  for (const kind of ["client", "business"] as const) {
    assert.equal(routeAllowed(kind, "GET", ["people", "search"]), true, `${kind} reads`);
    assert.equal(routeAllowed(kind, "POST", ["people", "lists"]), true, `${kind} saves a list`);
    assert.equal(routeAllowed(kind, "DELETE", ["people", "lists", "x"]), true, `${kind} removes a list`);
    assert.equal(routeAllowed(kind, "PUT", ["people", "dialer"]), true, `${kind} sets the dialer`);
    assert.equal(routeAllowed(kind, "PUT", ["people", "lists"]), false, `${kind} cannot replace a list`);
    assert.equal(routeAllowed(kind, "POST", ["people", "dialer"]), false);
  }
  assert.equal(routeAllowed("client", "GET", ["call-queue"]), false, "a client's staff have no call lists");
  assert.equal(routeAllowed("business", "GET", ["call-queue"]), true);
});

test("no People or call list screen writes a phone link (KF-3): the only tel: link is built in dial.ts, for the person's own choice", () => {
  const files = ["app/app/views/people-module.tsx", "app/app/views/calls.tsx", "app/app/views/global-search.tsx", "app/app/ds/dial-button.tsx", "app/app/ds/lead-drawer.tsx"];
  for (const f of files) assert.ok(!/tel:/.test(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")), `${f} writes no tel: link`);
  assert.ok(/tel:/.test(readFileSync(new URL("../people/dial.ts", import.meta.url), "utf8")));
});

test("the new screens use no banned words (the CRM is called the CRM)", () => {
  const files = ["app/app/views/people-module.tsx", "app/app/views/calls.tsx", "app/app/views/global-search.tsx", "app/app/ds/dial-button.tsx", "lib/people/dial.ts", "lib/people/filters.ts"];
  for (const f of files) {
    const text = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.ok(!/GoHighLevel|HighLevel|\bGHL\b|sub-account|\bSLA\b/i.test(text), `${f} names the platform or uses a banned word`);
  }
});
