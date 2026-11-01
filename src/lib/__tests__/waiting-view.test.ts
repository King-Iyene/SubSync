import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountChoices, accountGroups, agingGroups, assigneeLabel, channelChoices, chipCounts, DEFAULT_QUEUE, inTab, isDefaultQueue, listFor, NAME_MISSING, NO_OWNER,
  narrows, peekFor, queueFromHash, reconcile, queueIntoHash, RECENT_HOURS, rowText, sanitizeQueue, scoped, sortQueue, tabCounts, tabRows, userChoices, viewName, waitingSet,
  WAIT_CHIPS, type QueueFilter, type QueueRow,
} from "../analytics/waiting-view.ts";
import { replyAging } from "../analytics/comms-intel.ts";

let n = 0;
function row(p: Partial<QueueRow> & { waiting?: number | null; unread?: number }): QueueRow {
  n += 1;
  const waiting = p.waiting === undefined ? null : p.waiting;
  return {
    conversationId: `c${String(n).padStart(3, "0")}`, locationId: "L1", locationName: "Alpha Plumbing", contactId: `k${n}`, contactName: `Customer ${n}`,
    channel: "WhatsApp", lastMessageType: "TYPE_WHATSAPP", lastMessageDirection: waiting === null ? "outbound" : "inbound", lastMessageAt: "2026-11-01T10:00:00Z",
    unreadCount: p.unread ?? 0, overSla: waiting !== null, waitingHours: waiting, ageHours: waiting ?? 2, assignedTo: null, assignee: NO_OWNER, url: "https://crm.example.com/x",
    ...p,
  };
}
const me = "U-ME";
const named = (id: string, label: string) => ({ assignedTo: id, assignee: label });

// A small queue that has every kind of row: waiting under and over a week, unread and waiting, unread only, two accounts, three channels, owners.
function queue(): QueueRow[] {
  return [
    row({ waiting: 5, channel: "Text message", ...named(me, "Maya") }),                       // recent
    row({ waiting: 30, unread: 2, ...named("U-SAM", "Sam") }),                                // recent + unread
    row({ waiting: 60, locationId: "L2", locationName: "Beta Dental", channel: "Email" }),    // recent, no owner
    row({ waiting: 167 }),                                                                    // recent (just under a week)
    row({ waiting: 168, ...named("U-SAM", "Sam") }),                                          // older (exactly a week)
    row({ waiting: 400, locationId: "L2", locationName: "Beta Dental", channel: "Email", ...named("U-X", NAME_MISSING) }), // older
    row({ waiting: null, unread: 1, locationId: "L2", locationName: "Beta Dental" }),         // unread only (we replied last)
    row({ waiting: null, unread: 0 }),                                                        // answered and read: in no tab
    row({ waiting: null, unread: 3, channel: "Call", lastMessageType: "TYPE_CALL" }),         // unread call
  ];
}
const f = (p: Partial<QueueFilter> = {}): QueueFilter => ({ ...DEFAULT_QUEUE, ...p });

test("a row is in a tab by one rule: waiting under a week, waiting a week or more, or unread; a row can be in two", () => {
  assert.equal(RECENT_HOURS, 168);
  const q = queue();
  assert.deepEqual(q.map((r) => [inTab(r, "recent"), inTab(r, "older"), inTab(r, "unread")].map(Number).join("")), ["100", "101", "100", "100", "010", "010", "001", "000", "001"]);
  assert.equal(inTab(row({ waiting: 167 }), "recent"), true);
  assert.equal(inTab(row({ waiting: 168 }), "older"), true, "exactly a week is older, the same edge as the wait chart");
});

test("the count on every tab is the number of rows its list shows, under every combination of choices", () => {
  const q = queue();
  const waits = WAIT_CHIPS.map((c) => c.key);
  for (const wait of waits) for (const channel of ["", "WhatsApp", "Email", "Text message"]) for (const account of ["", "L1", "L2"]) for (const user of ["", "me", "none", "U-SAM", "U-X"]) {
    const filter = f({ wait, channel, account, user });
    const counts = tabCounts(q, filter, me);
    for (const tab of ["recent", "older", "unread"] as const) {
      assert.equal(counts[tab], listFor(q, { ...filter, tab }, me).length, `${tab} under ${JSON.stringify(filter)}`);
      assert.equal(counts[tab], tabRows(q, filter, me, tab).length);
    }
  }
});

test("with no choices the three tabs are the whole picture: waiting is recent plus older, and unread is every unread conversation", () => {
  const q = queue();
  const c = tabCounts(q, DEFAULT_QUEUE, me);
  assert.deepEqual(c, { recent: 4, older: 2, unread: 3 });
  assert.equal(c.recent + c.older, q.filter((r) => r.overSla).length, "the waiting total Today shows");
  assert.equal(c.unread, q.filter((r) => r.unreadCount > 0).length, "the unread total Today shows");
});

test("a wait chip keeps conversations that have waited that long or longer, on the waiting tabs only", () => {
  const q = queue();
  assert.deepEqual(tabCounts(q, f({ wait: "24h" }), me), { recent: 3, older: 2, unread: 3 });
  assert.deepEqual(tabCounts(q, f({ wait: "48h" }), me), { recent: 2, older: 2, unread: 3 });
  assert.deepEqual(tabCounts(q, f({ wait: "7d" }), me), { recent: 0, older: 2, unread: 3 }, "Over 7 days is exactly the Older tab");
  assert.equal(tabRows(q, f({ wait: "7d" }), me, "unread").length, 3, "unread rows have no wait to measure, so the chip leaves them alone");
});

test("chip counts add up with the tabs: the chip you pick leaves exactly recent plus older", () => {
  const q = queue();
  for (const chip of WAIT_CHIPS) {
    const counts = chipCounts(q, f(), me);
    const tabs = tabCounts(q, f({ wait: chip.key }), me);
    assert.equal(counts[chip.key], tabs.recent + tabs.older, chip.label);
  }
  assert.equal(chipCounts(q, f(), me).any, 6);
  assert.equal(chipCounts(q, f({ account: "L2" }), me).any, 2, "other choices narrow the chip counts too");
});

test("channel, client account and person choices narrow every tab", () => {
  const q = queue();
  assert.deepEqual(tabCounts(q, f({ channel: "Email" }), me), { recent: 1, older: 1, unread: 0 });
  assert.deepEqual(tabCounts(q, f({ account: "L2" }), me), { recent: 1, older: 1, unread: 1 });
  assert.deepEqual(tabCounts(q, f({ user: "me" }), me), { recent: 1, older: 0, unread: 0 });
  assert.deepEqual(tabCounts(q, f({ user: "U-SAM" }), me), { recent: 1, older: 1, unread: 1 });
  assert.deepEqual(tabCounts(q, f({ user: "none" }), me), { recent: 2, older: 0, unread: 2 });
  assert.equal(tabCounts(q, f({ user: "me" }), null).recent, 0, "nobody is 'me' when the person is not a team member of the account");
});

test("sorting: longest wait first by default, newest first on request, the same order every time", () => {
  const q = queue();
  const longest = listFor(q, f({ tab: "recent" }), me).map((r) => r.waitingHours);
  assert.deepEqual(longest, [167, 60, 30, 5]);
  const newest = listFor(q, f({ tab: "recent", sort: "newest" }), me).map((r) => r.waitingHours);
  assert.deepEqual(newest, [5, 30, 60, 167]);
  const ties = [row({ waiting: 10 }), row({ waiting: 10 }), row({ waiting: 10 })];
  assert.deepEqual(sortQueue(ties, "longest", "recent").map((r) => r.conversationId), sortQueue([...ties].reverse(), "longest", "recent").map((r) => r.conversationId));
  const unread = listFor(q, f({ tab: "unread" }), me).map((r) => r.ageHours);
  assert.deepEqual(unread, [...unread].sort((a, b) => (b ?? 0) - (a ?? 0)), "the unread tab puts the oldest message first");
});

test("the peek is the three longest waits of a tab, after the choices", () => {
  const q = queue();
  assert.deepEqual(peekFor(q, f(), me, "recent").map((r) => r.waitingHours), [167, 60, 30]);
  assert.deepEqual(peekFor(q, f(), me, "older").map((r) => r.waitingHours), [400, 168]);
  assert.equal(peekFor(q, f({ account: "L2" }), me, "recent").length, 1);
});

test("the wait chart covers exactly the waiting set, and every bar's list is its count (the same rows, not a second calculation)", () => {
  const q = queue();
  const waiting = waitingSet(q, f(), me);
  const groups = agingGroups(waiting);
  assert.equal(groups.reduce((s, g) => s + g.count, 0), waiting.length, "the bars add up to the waiting total");
  for (const g of groups) assert.equal(g.rows.length, g.count, g.label);
  const ids = groups.flatMap((g) => g.rows.map((r) => r.conversationId));
  assert.equal(new Set(ids).size, ids.length, "no conversation is in two bars");
  assert.deepEqual(groups.map((g) => g.count), replyAging(waiting.map((r) => r.waitingHours as number)).buckets.map((b) => b.count), "the same buckets the daily numbers use");
  // The tab and the wait chip do not change the chart; the account, channel and person choices do.
  assert.equal(agingGroups(waitingSet(q, f({ tab: "older", wait: "7d" }), me)).reduce((s, g) => s + g.count, 0), waiting.length);
  assert.equal(agingGroups(waitingSet(q, f({ account: "L2" }), me)).reduce((s, g) => s + g.count, 0), 2);
});

test("the account chart: counts equal lists, most first, and the tail is one 'Other accounts' bar that still adds up", () => {
  const q = queue();
  const waiting = waitingSet(q, f(), me);
  const g = accountGroups(waiting);
  assert.deepEqual(g.map((x) => [x.label, x.count]), [["Alpha Plumbing", 4], ["Beta Dental", 2]]);
  for (const x of g) assert.equal(x.rows.length, x.count);
  const many = Array.from({ length: 12 }, (_, i) => row({ waiting: 5 + i, locationId: `LOC${i}`, locationName: `Account ${i}` }));
  const grouped = accountGroups(many, 8);
  assert.equal(grouped.length, 9);
  assert.equal(grouped[8].label, "Other accounts (4)");
  assert.equal(grouped.reduce((s, x) => s + x.count, 0), 12);
  assert.equal(grouped.reduce((s, x) => s + x.rows.length, 0), 12);
});

test("who it is assigned to is a name, 'No owner', or a plain 'name not available', never an id", () => {
  const names = new Map([["U-SAM", "Sam"], ["U-BLANK", "   "]]);
  assert.equal(assigneeLabel(null, names), NO_OWNER);
  assert.equal(assigneeLabel("", names), NO_OWNER);
  assert.equal(assigneeLabel("U-SAM", names), "Sam");
  assert.equal(assigneeLabel("U-BLANK", names), NAME_MISSING);
  assert.equal(assigneeLabel("U-NOBODY-KNOWS", names), NAME_MISSING);
  assert.ok(!NAME_MISSING.includes("U-"), "no id in the words");
});

test("the people to choose between: me, no owner, named people by count, unnamed ones numbered and last", () => {
  const q = queue();
  q.push(row({ waiting: 6, ...named("U-Y", NAME_MISSING) }));
  const c = userChoices(q, me);
  assert.deepEqual(c.map((x) => [x.key, x.label, x.count]), [
    ["me", "Assigned to me", 1], ["none", NO_OWNER, 4], ["U-SAM", "Sam", 2],
    ["U-X", "Team member 1 (name not available)", 1], ["U-Y", "Team member 2 (name not available)", 1],
  ]);
  assert.ok(!userChoices(q, null).some((x) => x.key === "me"), "no 'Assigned to me' for someone who is nobody's contact owner");
  assert.ok(!userChoices(q, "U-NOT-IN-ROWS").some((x) => x.key === "me"));
  assert.deepEqual(accountChoices(q).map((x) => [x.label, x.count]), [["Alpha Plumbing", 6], ["Beta Dental", 3]]);
  assert.deepEqual(channelChoices(q).map((x) => x.label), ["WhatsApp", "Email", "Call", "Text message"]);
});

test("a row in no tab never counts anywhere or shows in a choice list", () => {
  const q = [row({ waiting: null, unread: 0, locationId: "L9", locationName: "Quiet Co", channel: "Facebook" })];
  assert.deepEqual(tabCounts(q, DEFAULT_QUEUE, me), { recent: 0, older: 0, unread: 0 });
  assert.equal(accountChoices(q).length, 0);
  assert.equal(channelChoices(q).length, 0);
  assert.equal(userChoices(q, me).length, 0);
});

test("a damaged choice falls back to the default, so a broken link or a bad saved view never breaks the page", () => {
  assert.deepEqual(sanitizeQueue(null), DEFAULT_QUEUE);
  assert.deepEqual(sanitizeQueue("nonsense"), DEFAULT_QUEUE);
  assert.deepEqual(sanitizeQueue({ tab: "bogus", wait: "9999", channel: "<script>", account: "x", user: "a b", sort: "random" }), DEFAULT_QUEUE);
  assert.deepEqual(sanitizeQueue({ tab: "older", wait: "24h", channel: "WhatsApp", account: "L1abc", user: "me", sort: "newest" }), { tab: "older", wait: "24h", channel: "WhatsApp", account: "L1abc", user: "me", sort: "newest" });
  assert.equal(isDefaultQueue(DEFAULT_QUEUE), true);
  assert.equal(narrows(DEFAULT_QUEUE), false);
  assert.equal(narrows(f({ tab: "older", sort: "newest" })), false, "the tab and the sort do not narrow");
  assert.equal(narrows(f({ wait: "4h" })), true);
});

test("the address carries the choices next to the rest of the address, and reads them back", () => {
  const choice = f({ tab: "older", wait: "24h", channel: "Text message", account: "L1abc", user: "none", sort: "newest" });
  const hash = queueIntoHash("#inbox?accounts=A1b,B2c&r.speed-trend=30d.prev", choice);
  assert.match(hash, /^#inbox\?/);
  assert.ok(hash.includes("accounts=A1b,B2c") && hash.includes("r.speed-trend=30d.prev"), "the page filter and a card range are kept");
  assert.deepEqual(queueFromHash(hash), choice);
  assert.equal(queueFromHash("#inbox"), null);
  assert.equal(queueFromHash("#inbox?accounts=A1b"), null, "an address with only the page filter has no queue choice: a remembered one may apply");
  assert.equal(queueIntoHash(hash, DEFAULT_QUEUE), "#inbox?accounts=A1b,B2c&r.speed-trend=30d.prev", "the default leaves no trace");
  assert.deepEqual(queueFromHash("#inbox?q.tab=zzz&q.wait=bad"), DEFAULT_QUEUE);
});

test("saved view names are one tidy line of up to 40 characters", () => {
  assert.equal(viewName("  Over   a day\n"), "Over a day");
  assert.equal(viewName(""), null);
  assert.equal(viewName("   "), null);
  assert.equal(viewName("x".repeat(41)), null);
  assert.equal(viewName(42), null);
});

test("the copied line says who, where, how, how long and who owns it", () => {
  const r = row({ waiting: 30, contactName: "Ada Obi", locationName: "Alpha Plumbing", channel: "Email", ...named("U-SAM", "Sam") });
  assert.equal(rowText(r, "1 day"), "Ada Obi, Alpha Plumbing, Email, waiting 1 day, Sam");
  assert.equal(rowText(row({ waiting: null, unread: 2, contactName: null }), ""), "Unknown contact, Alpha Plumbing, WhatsApp, 2 unread, No owner");
});

test("a remembered choice that matches nothing any more is dropped, so it cannot hide the queue without saying so", () => {
  const q = queue();
  const kept = f({ tab: "older", wait: "24h", sort: "newest", channel: "Email", account: "L2", user: "U-X" });
  assert.deepEqual(reconcile(kept, q, me), kept, "choices that still match are kept as they are");
  assert.deepEqual(reconcile(f({ channel: "Telegram", account: "GONE", user: "U-NOBODY" }), q, me), f(), "unknown channel, account and person are cleared");
  assert.equal(reconcile(f({ user: "me" }), q, null).user, "", "'me' means nothing to a person with no contacts of their own");
  assert.equal(reconcile(f({ user: "me" }), q, me).user, "me");
  assert.equal(reconcile(f({ user: "none" }), [row({ waiting: 5, ...named(me, "Maya") })], me).user, "", "nobody is without an owner here");
  assert.equal(reconcile(f({ tab: "unread", wait: "48h" }), q, me).wait, "48h", "the tab and the wait chip are never touched");
});

test("scoped() leaves the input alone", () => {
  const q = queue();
  const before = JSON.stringify(q);
  scoped(q, f({ channel: "Email", user: "none" }), me);
  sortQueue(q, "newest", "recent");
  assert.equal(JSON.stringify(q), before);
});
