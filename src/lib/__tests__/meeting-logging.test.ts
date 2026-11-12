import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  accountRows, addGroup, dayToRecord, EMPTY_CALLS, loggedShare, MIN_OUTCOME_MEETINGS, repRows, summarizeOutcomes, sumCounts, tallyByOwner,
  type CallGroup, type OutcomeDay, type PersonInfo,
} from "../connections/meeting-logging.ts";
import { covers, statusScope, type Person } from "../connections/person.ts";

const g = (o: Partial<CallGroup> = {}): CallGroup => ({ owner: "xtest-u1", status: "saved", reason: null, old: false, n: 1, ...o });

test("saved calls are logged; waiting calls split by what they wait for; refused calls count as not logged", () => {
  const t = tallyByOwner([
    g({ n: 5 }),
    g({ status: "needs_contact", reason: "no_match", n: 2 }),
    g({ status: "needs_contact", reason: "preview_needed", n: 1 }),
    g({ status: "needs_contact", reason: "needs_permission", n: 3, old: true }),
    g({ status: "failed", reason: null, n: 1, old: true }),
  ]).get("xtest-u1");
  assert.ok(t);
  assert.equal(t.held, 12);
  assert.equal(t.logged, 5);
  assert.equal(t.notLogged, 7);
  assert.equal(t.needsContact, 2);
  assert.equal(t.needsOk, 1);
  assert.equal(t.needsPermission, 3);
  assert.equal(t.failed, 1);
  assert.equal(t.overdue, 4, "only not-logged calls older than 24 hours are overdue");
  assert.equal(t.held, t.logged + t.notLogged, "every call is either logged or not");
});

test("skipped, duplicate and test-mode calls are not calls to log", () => {
  let c = EMPTY_CALLS;
  for (const status of ["skipped", "duplicate", "dry_run", "whatever"]) c = addGroup(c, { status, reason: null, old: true, n: 4 });
  assert.deepEqual(c, EMPTY_CALLS);
  assert.deepEqual(addGroup(EMPTY_CALLS, { status: "saved", reason: null, old: false, n: -3 }), EMPTY_CALLS, "a negative count is ignored");
});

test("the logged share is a whole percent and is null, never 0 percent, when there were no calls", () => {
  assert.equal(loggedShare(EMPTY_CALLS), null);
  assert.equal(loggedShare({ ...EMPTY_CALLS, held: 3, logged: 1 }), 33);
  assert.equal(loggedShare({ ...EMPTY_CALLS, held: 3, logged: 3 }), 100);
});

const people: PersonInfo[] = [
  { owner: "xtest-u1", name: "Ada", homeLocationId: "xtest-locA", connected: true },
  { owner: "xtest-u2", name: "Ben", homeLocationId: "xtest-locA", connected: true },
  { owner: "xtest-u3", name: "Cy", homeLocationId: null, connected: true },
];

test("rows: most overdue first, people with no calls left out, a person who left is named plainly", () => {
  const t = tallyByOwner([
    g({ owner: "xtest-u1", n: 4 }),
    g({ owner: "xtest-u2", status: "needs_contact", reason: "no_match", n: 2, old: true }),
    g({ owner: "xtest-u3", status: "needs_contact", reason: "no_match", n: 1 }),
    g({ owner: "xtest-gone", status: "needs_contact", reason: "no_match", n: 1 }),
  ]);
  const reps = repRows(t, people);
  assert.deepEqual(reps.map((r) => r.name), ["Ben", "A team member who left", "Cy", "Ada"]);
  const accounts = accountRows(reps);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].locationId, "xtest-locA", "account A holds the overdue calls");
  assert.equal(accounts[0].held, 6);
  assert.equal(accounts[1].locationId, null, "company staff and people who left are one row with no account");
  assert.equal(sumCounts(reps).held, 8, "the account rows add up to the person rows");
  assert.equal(accounts.reduce((n, a) => n + a.held, 0), sumCounts(reps).held);
});

test("status scope: counts are limited to the people an administrator covers (no cross-account leak)", () => {
  const person = (o: Partial<Person>): Person => ({ companyKey: "xtest-co", userId: "xtest-admin", name: "Admin", role: "agency_staff", kind: "agency", homeLocationId: null, ...o });
  assert.equal(statusScope(person({ role: "agency_owner" })).kind, "all");
  assert.equal(statusScope(person({ role: "agency_staff" }), null).kind, "none", "staff with no proven access see nothing of others");
  assert.equal(statusScope(person({ role: "account_user", kind: "client", homeLocationId: "xtest-locA" })).kind, "none", "a client's ordinary user sees only their own row");
  const own = statusScope(person({ role: "account_admin", kind: "client", homeLocationId: "xtest-locA" }));
  assert.equal(own.kind, "account");
  assert.equal(covers(own, "xtest-locA"), true);
  assert.equal(covers(own, "xtest-locB"), false, "another account's person is never covered");
  assert.equal(covers(own, null), false, "company staff are not covered by one account's administrator");
});

const day = (d: string, held: number, over: Partial<OutcomeDay> = {}): OutcomeDay => ({ day: d, meetingsHeld: held, logged24h: 0, nextStepSet: 0, movedOrBooked7d: 0, ...over });

test("outcome history: no shares below the minimum, honest 'history starts', shares above it", () => {
  const few = summarizeOutcomes([day("2026-11-02", 10, { logged24h: 10 }), day("2026-11-01", 5)]);
  assert.equal(few.enough, false);
  assert.equal(few.needed, MIN_OUTCOME_MEETINGS - 15);
  assert.equal(few.logged24hShare, null, "no percentage from a handful of calls");
  assert.equal(few.historyStarts, "2026-11-01");
  const enough = summarizeOutcomes([day("2026-11-01", 20, { logged24h: 15, nextStepSet: 10, movedOrBooked7d: 5 }), day("2026-11-02", 20, { logged24h: 15, nextStepSet: 10, movedOrBooked7d: 5 })]);
  assert.equal(enough.enough, true);
  assert.equal(enough.total, 40);
  assert.equal(enough.logged24hShare, 75);
  assert.equal(enough.nextStepShare, 50);
  assert.equal(enough.movedOrBookedShare, 25);
  assert.equal(summarizeOutcomes([]).historyStarts, null);
});

test("the day recorded is the one whose seven following days are complete", () => {
  assert.equal(dayToRecord(Date.UTC(2026, 10, 11, 3, 20)), "2026-11-03");
});

test("privacy: the call counts read no column that holds what was said, and the answer carries no person id", () => {
  const store = readFileSync(new URL("../connections/meeting-logging-store.ts", import.meta.url), "utf8");
  const start = store.indexOf("export async function callGroups");
  const end = store.indexOf("/** Names and home accounts");
  const counts = store.slice(start, end);
  assert.ok(counts.length > 100);
  for (const word of ["title", "summary", "attendee", "transcript", "recording_url", "action_items"]) assert.ok(!counts.includes(word), `callGroups must not read ${word}`);
  assert.ok(counts.includes("installation_id = ${installationId}"), "the query names the installation");
  const api = readFileSync(new URL("../api/meeting-logged-api.ts", import.meta.url), "utf8");
  assert.ok(api.includes("owner: undefined"), "the person id is dropped from the rows sent to the browser");
  assert.ok(!/searchParams|request\.json/.test(api), "the route reads nothing from the request: no id, account or role to forge");
});

test("the outcome record is idempotent and reads no text", () => {
  const store = readFileSync(new URL("../connections/meeting-logging-store.ts", import.meta.url), "utf8");
  assert.ok(store.includes("on conflict (installation_id, location_id, day) do update"));
  assert.ok(!/m\.(title|summary|attendee_emails|transcript_ref|recording_url)/.test(store));
  const migration = readFileSync(new URL("../../../supabase/migrations/20261219090000_mn_outcomes.sql", import.meta.url), "utf8");
  assert.ok(migration.includes("enable row level security"));
  assert.ok(!/\b(drop|truncate)\b/i.test(migration.replace(/--.*$/gm, "")), "additive only");
  assert.ok(!/\bdelete\b/i.test(migration.replace(/--.*$/gm, "").replace(/on delete cascade/gi, "")));
});
