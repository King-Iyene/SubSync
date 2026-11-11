import assert from "node:assert/strict";
import { test } from "node:test";
import { leadKey, markNewLeads, peopleOf, segmentCounts, selectPeople, todayAgreement, waitingConversations, type WaitConv } from "../analytics/unanswered-v2.ts";
import { selectLeads, waitingFacts } from "../analytics/speed-v2.ts";
import type { LoadedRow } from "../analytics/speed-parts.ts";
import type { WaitingLead } from "../analytics/today-queue.ts";

// Unanswered inside Speed to lead (docs/METRICS.md "Unanswered inside Speed to lead"): the segment switch Everyone | New leads | Existing customers and Speed's own "no reply yet" count.
// The New leads segment lists the new leads who have a conversation waiting; Speed counts every new lead past its target with no person's reply, written or not. The exact difference
// is `newLeadsOnly` (new leads who have not written), and both are taken from the real functions of each screen on one fixture.

const NOW = Date.parse("2026-11-05T12:00:00Z");
const H = 3_600_000;
const MIN = 60_000;
const accounts = new Map([["A", "Alpha Roofing"], ["B", "Bright Dental"]]);
let n = 0;
/** A lead that arrived `ago` minutes ago with no reply from a person. */
function lead(loc: string, contactId: string, ago: number): LoadedRow {
  return { locationId: loc, contactId, leadAt: NOW - ago * MIN, touchAt: null, userId: null, name: `Lead ${contactId}`, assignedTo: "o1", source: "Website", tags: [] };
}
function conv(loc: string, contactId: string, hours: number): WaitConv {
  n += 1;
  return { conversationId: `conv-${n}`, locationId: loc, contactId, name: `Person ${contactId}`, lastType: "TYPE_SMS", lastAt: NOW - hours * H - 60_000, assignedTo: "u1", unreadCount: 0, phone: "+15550100", email: "p@example.com", dnd: false, timeZone: "America/New_York" };
}

test("the New leads segment plus the new leads who have not written is exactly Speed's no-reply count", () => {
  // Speed: 6 leads past a 15-minute target with no reply from a person (c1..c6), one answered lead (c7) and one lead inside the target (c8).
  const speedRows: LoadedRow[] = [...["c1", "c2", "c3", "c4", "c5", "c6"].map((c, i) => lead("A", c, 300 + i * 30)), { ...lead("B", "c7", 400), touchAt: NOW - 390 * MIN, userId: "u1" }, lead("B", "c8", 5)];
  const speed = waitingFacts(speedRows, { targetMinutes: 15, now: NOW });
  assert.equal(speed.waiting, 6);
  // Unanswered: c1..c3 have written and wait; x1 and x2 are existing customers who wrote; c4..c6 are new leads who have not written.
  const waiting = waitingConversations([conv("A", "c1", 10), conv("A", "c2", 12), conv("A", "c3", 30), conv("A", "x1", 20), conv("B", "x2", 50)], { now: NOW, slaHours: 4 });
  const leads: WaitingLead[] = selectLeads(speedRows, { targetMinutes: 15, now: NOW, accounts }, { status: "waiting" }).map((x) => ({
    locationId: x.row.locationId, accountName: "", contactId: x.row.contactId, name: x.row.name, at: x.row.leadAt, never: false, url: "", owner: null, source: null, detail: "",
  }));
  const marked = markNewLeads(peopleOf(waiting, { now: NOW }), new Set(leads.map((l) => leadKey(l.locationId, l.contactId))));
  const seg = segmentCounts(marked);
  assert.deepEqual(seg, { everyone: 5, newLeads: 3, existing: 2 });
  const agree = todayAgreement(waiting, leads);
  assert.equal(agree.newLeadsAmongThem, seg.newLeads, "the segment is the new leads among the people waiting");
  assert.equal(agree.newLeadsOnly, 3);
  assert.equal(seg.newLeads + agree.newLeadsOnly, speed.waiting, "segment + new leads who have not written = Speed's no-reply count");
  assert.equal(agree.today, seg.everyone + agree.newLeadsOnly, "and Today's number is everyone + the same new leads who have not written");
});

test("each segment's count is the number of rows of its list, and the two segments add up to everyone", () => {
  const waiting = waitingConversations([conv("A", "c1", 10), conv("A", "c2", 12), conv("B", "x1", 20), conv("B", "x2", 50), conv("B", "x3", 70)], { now: NOW, slaHours: 4 });
  const marked = markNewLeads(peopleOf(waiting, { now: NOW }), new Set([leadKey("A", "c1"), leadKey("A", "c2")]));
  const ctx = { me: null, accounts };
  const seg = segmentCounts(marked);
  assert.equal(selectPeople(marked, { newLead: true }, ctx).length, seg.newLeads);
  assert.equal(selectPeople(marked, {}, ctx).length, seg.everyone);
  assert.equal(seg.newLeads + seg.existing, seg.everyone);
  assert.equal(selectPeople(marked, { newLead: true, account: "B" }, ctx).length, 0, "a client with no new leads has an empty New leads segment");
  assert.deepEqual(segmentCounts([]), { everyone: 0, newLeads: 0, existing: 0 });
});

test("Speed and the tab share one 14-day window for a new lead: a lead older than that is in neither count", () => {
  const old = lead("A", "old1", 15 * 24 * 60);
  // Both stop at 14 days (the window Today uses); a Speed date range narrower than 14 days counts fewer leads, which is the date range doing its job.
  assert.equal(waitingFacts([old], { targetMinutes: 15, now: NOW }).waiting, 0);
  assert.equal(waitingFacts([lead("A", "new1", 60 * 24 * 13)], { targetMinutes: 15, now: NOW }).waiting, 1);
});
