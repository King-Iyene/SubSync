import assert from "node:assert/strict";
import { test } from "node:test";
import { diffHistory, isReschedule, type Snap } from "../analytics/appointments3-record.ts";

const T = Date.parse("2026-11-10T12:00:00Z");
const snap = (o: Partial<Snap> = {}): Snap => ({ status: "confirmed", startAt: T + 86_400_000, ownerId: "c1", calendarId: "cal1", bookerId: null, contactId: "p1", ...o });

test("first sight records created, booker and owner with stable keys", () => {
  const ev = diffHistory("a1", null, snap({ bookerId: "s1" }), { at: T, createdAt: T - 3_600_000 });
  assert.deepEqual(ev.map((e) => e.kind), ["created", "booker", "owner"]);
  assert.deepEqual(ev.map((e) => e.key), ["created|a1", "booker|a1|first", "owner|a1|first"]);
  assert.equal(ev[0].at, T - 3_600_000);
  assert.equal(ev[1].actorKind, "person");
  assert.equal(diffHistory("a2", null, snap(), { at: T })[0].actorKind, "system");
});

test("a status change diffs against the stored row; the same event twice has the same key", () => {
  const a = diffHistory("a1", snap(), snap({ status: "noshow" }), { at: T, actorId: "u1" });
  const b = diffHistory("a1", snap(), snap({ status: "noshow" }), { at: T + 20_000, actorId: "u1" });
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].kind, a[0].from, a[0].to, a[0].actorKind], ["status", "confirmed", "noshow", "person"]);
  assert.equal(a[0].key, b[0].key); // a repeated webhook inside a minute cannot double count
  assert.equal(diffHistory("a1", snap(), snap(), { at: T }).length, 0); // nothing changed, nothing recorded
});

test("our own write is recorded as subsync, not as a person", () => {
  const ev = diffHistory("a1", snap(), snap({ status: "showed" }), { at: T, actorId: "u1", own: [{ kind: "status", to: "showed", at: T - 60_000 }] });
  assert.equal(ev[0].actorKind, "subsync");
  assert.equal(ev[0].actorId, null);
  const late = diffHistory("a1", snap(), snap({ status: "showed" }), { at: T, own: [{ kind: "status", to: "showed", at: T - 3_600_000 }] });
  assert.equal(late[0].actorKind, "unknown"); // an hour apart is not our echo
});

test("time moves are reschedules only past 15 minutes; owner and calendar moves are recorded", () => {
  const ev = diffHistory("a1", snap(), snap({ startAt: T + 3 * 86_400_000, ownerId: "c2", calendarId: "cal2" }), { at: T });
  assert.deepEqual(ev.map((e) => e.kind).sort(), ["calendar", "owner", "time"]);
  assert.equal(isReschedule(ev.find((e) => e.kind === "time")!), true);
  const small = diffHistory("a1", snap(), snap({ startAt: snap().startAt! + 5 * 60_000 }), { at: T });
  assert.equal(isReschedule(small[0]), false);
});

test("a booker seen later is recorded once", () => {
  const ev = diffHistory("a1", snap(), snap({ bookerId: "s1" }), { at: T });
  assert.equal(ev[0].key, "booker|a1|first");
});
