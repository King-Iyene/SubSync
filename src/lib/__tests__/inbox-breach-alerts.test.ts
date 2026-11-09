import assert from "node:assert/strict";
import { test } from "node:test";
import { breachCandidates, breachDedupeKey, BREACH24_DAILY_CAP, BREACH24_HOURS, type BreachSource } from "../analytics/inbox-breach-rules.ts";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const source = (over: Partial<BreachSource> = {}): BreachSource => ({
  locationId: "L1",
  locationName: "Sample Clinic",
  conversationId: "conv-1",
  contactId: "contact-1",
  personName: "Pat",
  lastAt: NOW - BREACH24_HOURS * 3_600_000,
  assignedUserId: "setter-1",
  assignedUserVerified: true,
  accountAdminUserId: "admin-1",
  ...over,
});

test("24-hour breaches route to the verified assigned owner, then account admin, once per person", () => {
  const rows = [
    source({ conversationId: "oldest", lastAt: NOW - 30 * 3_600_000 }),
    source({ conversationId: "newer", lastAt: NOW - 25 * 3_600_000 }),
    source({ conversationId: "unassigned", contactId: "contact-2", assignedUserId: null, assignedUserVerified: false }),
    source({ conversationId: "unverified", contactId: "contact-3", assignedUserVerified: false }),
    source({ conversationId: "too-new", contactId: "contact-4", lastAt: NOW - (BREACH24_HOURS * 3_600_000) + 1 }),
    source({ conversationId: "too-old", contactId: "contact-5", lastAt: NOW - 31 * 86_400_000 }),
    source({ conversationId: "no-recipient", contactId: "contact-6", assignedUserId: null, assignedUserVerified: false, accountAdminUserId: null }),
  ];

  const candidates = breachCandidates(rows, NOW);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((c) => [c.contactId, c.conversationId, c.recipientUserKey]), [
    ["contact-1", "oldest", "setter-1"],
    ["contact-2", "unassigned", "admin-1"],
    ["contact-3", "unverified", "admin-1"],
  ]);
  assert.equal(candidates[0].dedupeKey, breachDedupeKey("L1", "contact-1", "oldest", "setter-1"));
  assert.equal(BREACH24_DAILY_CAP, 10);
});
