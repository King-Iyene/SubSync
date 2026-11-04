import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUCKETS, bucketOf, facetsOf, factsOf, headlineOf, homeOf, leadKey, longWords, markNewLeads, meaningLine, nextBestAction, pageOf, peopleOf, personKey, primaryLabel, rankAccounts,
  rankOwners, selectPeople, shortWords, summaryText, todayAgreement, visibleBuckets, waitingConversations, estimateFor, type Person, type WaitConv,
} from "../analytics/unanswered-v2.ts";
import { countsOf, emptyTotals, mergeReplies, type WaitingLead } from "../analytics/today-queue.ts";
import { waitingState } from "../analytics/waiting.ts";

// Unanswered messages, second pass (docs/METRICS.md "Unanswered messages, second pass"). One fixture is built for each question and the figure, the bar, the list behind
// it, the ranking and Today are compared on it: a number on this screen is always the number of rows when it is pressed (KF-6).

const NOW = Date.parse("2026-11-05T12:00:00Z");
const H = 3_600_000;
const names = new Map([["A", "Alpha Roofing"], ["B", "Bright Dental"], ["C", "Cedar Law"]]);
const CTX = { me: "u-me" as string | null, accounts: names };
let n = 0;
/** A conversation whose last message is the customer's, `h` hours ago (the default type is a text message). */
function conv(loc: string, h: number, over: Partial<WaitConv> = {}): WaitConv {
  n += 1;
  return { conversationId: `conv-${n}`, locationId: loc, contactId: `c${n}`, name: `Person ${String(n).padStart(3, "0")}`, lastType: "TYPE_SMS", lastAt: NOW - h * H - 60_000, assignedTo: "u1", phone: "+15550100", email: "p@example.com", dnd: false, timeZone: "America/New_York", ...over };
}
const people = (rows: WaitConv[], sla = 4) => peopleOf(waitingConversations(rows, { now: NOW, slaHours: sla }), { now: NOW });

test("who is waiting is the one rule: past the target, inside 30 days, the customer wrote last, an internal note is not the customer", () => {
  const rows = [
    conv("A", 3), conv("A", 5), conv("A", 30 * 24 - 1), conv("A", 30 * 24 + 1), // inside the target, waiting, waiting (just inside the window), dead
    conv("A", 6, { lastType: "TYPE_INTERNAL_COMMENT" }),
  ];
  const waiting = waitingConversations(rows, { now: NOW, slaHours: 4 });
  assert.equal(waiting.length, 2);
  for (const c of rows) {
    const inList = waiting.includes(c);
    assert.equal(inList, waitingState({ direction: "inbound", at: c.lastAt, type: c.lastType }, NOW, 4) === "waiting", "the same answer as waiting.ts for every row");
  }
  // A different reply target changes who is waiting, and nothing else.
  assert.equal(waitingConversations(rows, { now: NOW, slaHours: 2 }).length, 3);
});

test("a person is counted once, however many conversations are waiting; the longest wait names the row and where Reply goes", () => {
  const a = conv("A", 10, { contactId: "same", conversationId: "newer", lastType: "TYPE_EMAIL" });
  const b = conv("A", 50, { contactId: "same", conversationId: "older", lastType: "TYPE_WHATSAPP", name: "Dana Cole" });
  const c = conv("A", 5, { contactId: null, conversationId: "nocontact-1" });
  const d = conv("A", 6, { contactId: null, conversationId: "nocontact-2" });
  const ps = people([a, b, c, d]);
  assert.equal(ps.length, 3, "one person with two conversations, and two conversations with no contact on file");
  const same = ps.find((p) => p.contactId === "same")!;
  assert.equal(same.conversations, 2);
  assert.equal(same.conversationId, "older");
  assert.equal(same.channel, "WhatsApp");
  assert.equal(same.hours, 50);
  assert.equal(same.name, "Dana Cole");
  assert.equal(factsOf(ps).conversations, 4, "conversations are said separately from people");
  assert.equal(factsOf(ps).people, 3);
  assert.equal(ps.find((p) => p.conversationId === "nocontact-1")!.key, personKey("A", null, "nocontact-1"));
});

test("a bar and the list behind it are one selection: every bucket's count is its rows, and the buckets add up to the headline", () => {
  const rows = [conv("A", 5), conv("A", 9), conv("A", 23), conv("A", 24), conv("A", 47), conv("B", 48), conv("B", 100), conv("B", 200), conv("C", 29 * 24)];
  const ps = people(rows);
  const home = homeOf(ps, { slaHours: 4, accounts: names, seePeople: true, me: null, labelOf: () => ({ label: "x", state: "named" }) });
  assert.deepEqual(home.buckets.map((b) => b.key), ["h4", "h24", "h48"], "with a 4 hour target nobody waits under 4 hours, so that bar is left out");
  for (const b of home.buckets) assert.equal(selectPeople(ps, { bucket: b.key }, CTX).length, b.count, b.label);
  assert.equal(home.buckets.reduce((s, b) => s + b.count, 0), home.facts.people, "the bars add up to the headline");
  assert.deepEqual(home.buckets.map((b) => b.count), [3, 2, 4]);
  // Edges are whole hours: exactly 24 waits is "1 to 2 days", 23 is not.
  assert.equal(bucketOf(23), "h4"); assert.equal(bucketOf(24), "h24"); assert.equal(bucketOf(47), "h24"); assert.equal(bucketOf(48), "h48");
  // With a 1 hour target the first bar exists and holds the people who waited 1 to 4 hours.
  assert.deepEqual(visibleBuckets(1).map((b) => b.key), ["h1", "h4", "h24", "h48"]);
  assert.deepEqual(visibleBuckets(4).map((b) => b.key), ["h4", "h24", "h48"]);
  assert.deepEqual(visibleBuckets(24).map((b) => b.key), ["h24", "h48"]);
  assert.equal(BUCKETS.length, 4);
});

test("chips count what they would show, after the other choices: a chip's number is the length of its list", () => {
  const rows = [
    conv("A", 5, { assignedTo: null }), conv("A", 30, { assignedTo: "u-me", lastType: "TYPE_EMAIL" }), conv("B", 60, { assignedTo: "u2", lastType: "TYPE_EMAIL" }),
    conv("B", 80, { assignedTo: null, lastType: "TYPE_CALL" }), conv("C", 100, { assignedTo: "u-me" }),
  ];
  const ps = people(rows);
  const f = facetsOf(ps, {}, CTX);
  assert.equal(f.owner.all, 5); assert.equal(f.owner.none, 2); assert.equal(f.owner.mine, 2);
  assert.equal(selectPeople(ps, { owner: "none" }, CTX).length, f.owner.none);
  assert.equal(selectPeople(ps, { owner: "me" }, CTX).length, f.owner.mine);
  assert.deepEqual(f.channels.map((c) => [c.key, c.count]), [["Email", 2], ["Text message", 2], ["Call", 1]]);
  // Narrowed by a client, the chips follow.
  const f2 = facetsOf(ps, { account: "B" }, CTX);
  assert.equal(f2.buckets.all, 2);
  assert.equal(f2.owner.none, 1);
  assert.equal(f2.owner.mine, 0);
  // "Mine" is nobody's list for a person who owns none of them: the filter finds nothing, never everything.
  assert.equal(selectPeople(ps, { owner: "me" }, { ...CTX, me: null }).length, 0);
  assert.equal(selectPeople(ps, { owner: "u2" }, CTX).length, 1);
});

test("search finds a name, a client, a channel, an email and a phone; accents and case do not matter", () => {
  const ps = people([conv("A", 9, { name: "Zoë Álvarez" }), conv("B", 9, { name: "Sam Lee", email: "sam@lee.test", phone: "+15551234567" }), conv("C", 9, { lastType: "TYPE_WHATSAPP" })]);
  assert.equal(selectPeople(ps, { q: "zoe alvarez" }, CTX).length, 1);
  assert.equal(selectPeople(ps, { q: "bright" }, CTX).length, 1, "a client name");
  assert.equal(selectPeople(ps, { q: "whatsapp" }, CTX).length, 1, "a channel");
  assert.equal(selectPeople(ps, { q: "sam@lee" }, CTX).length, 1);
  assert.equal(selectPeople(ps, { q: "1234567" }, CTX).length, 1);
  assert.equal(selectPeople(ps, { q: "alpha lee" }, CTX).length, 0, "every word must match the same person");
});

test("the order is stable and says what it is: longest wait first, ties by name, the input order does not matter", () => {
  const rows = [conv("B", 20, { name: "Bea" }), conv("A", 20, { name: "Abe" }), conv("A", 90, { name: "Zed" }), conv("C", 5, { name: "Cy" })];
  const a = selectPeople(people(rows), { sort: "wait" }, CTX).map((p) => p.name);
  const b = selectPeople(people([...rows].reverse()), { sort: "wait" }, CTX).map((p) => p.name);
  assert.deepEqual(a, ["Zed", "Abe", "Bea", "Cy"]);
  assert.deepEqual(a, b);
  assert.deepEqual(selectPeople(people(rows), { sort: "newest" }, CTX).map((p) => p.name), ["Cy", "Abe", "Bea", "Zed"]);
  assert.deepEqual(selectPeople(people(rows), { sort: "name" }, CTX).map((p) => p.name), ["Abe", "Bea", "Cy", "Zed"]);
  assert.deepEqual(selectPeople(people(rows), { sort: "account" }, CTX).map((p) => p.locationId), ["A", "A", "B", "C"]);
});

test("paging: a page is at most 50, the last page is short, a page past the end is the last, the range reads from 1", () => {
  const ps = people(Array.from({ length: 53 }, (_, i) => conv("A", 5 + i)));
  const all = selectPeople(ps, {}, CTX);
  assert.deepEqual(pageOf(all, 0, 25), { rows: all.slice(0, 25), page: 0, pages: 3, total: 53, from: 1, to: 25 });
  assert.equal(pageOf(all, 2, 25).rows.length, 3);
  assert.equal(pageOf(all, 99, 25).page, 2);
  assert.equal(pageOf(all, 0, 500).rows.length, 50, "never more than 50 a page");
  assert.deepEqual(pageOf([], 0, 25), { rows: [], page: 0, pages: 1, total: 0, from: 0, to: 0 });
});

test("the headline: one sentence about people, the longest wait, 'across N clients' only for an agency with more than one; all clear says so", () => {
  const f = factsOf(people([conv("A", 5), conv("B", 30), conv("B", 100)]));
  assert.equal(headlineOf(f, true).text, "3 people are waiting for a reply across 2 clients. The longest has waited 4 days.");
  assert.equal(headlineOf(f, false).text, "3 people are waiting for a reply. The longest has waited 4 days.");
  assert.equal(headlineOf(factsOf(people([conv("A", 30)])), false).text, "1 person is waiting for a reply. They have waited 30 hours.");
  assert.equal(headlineOf(factsOf(people([conv("A", 30), conv("A", 31)])), true).text, "2 people are waiting for a reply. The longest has waited 31 hours.", "one client: no 'across'");
  const clear = headlineOf(factsOf([]), true);
  assert.deepEqual([clear.allClear, clear.text], [true, "Nobody is waiting for a reply."]);
  assert.equal(primaryLabel(14), "Reply to the oldest of the 14 people waiting");
  assert.equal(primaryLabel(1), "Reply to the person waiting");
  assert.equal(longWords(1), "1 hour"); assert.equal(longWords(47), "47 hours"); assert.equal(longWords(48), "2 days"); assert.equal(shortWords(5), "5 h"); assert.equal(shortWords(100), "4 days");
  assert.match(meaningLine(4, 30), /more than your 4-hour reply target, in the last 30 days/);
});

test("clients are ranked by people waiting, then the longest wait, then the name; owners include 'No owner', never hidden", () => {
  const ps = people([conv("A", 10), conv("A", 12), conv("B", 100), conv("B", 11), conv("C", 11, { assignedTo: null }), conv("C", 90, { assignedTo: "u2" })]);
  const rank = rankAccounts(ps, names);
  assert.deepEqual(rank.map((r) => [r.id, r.count, r.oldestHours]), [["B", 2, 100], ["C", 2, 90], ["A", 2, 12]]);
  for (const r of rank) assert.equal(selectPeople(ps, { account: r.id }, CTX).length, r.count, "a client's number is its list");
  const owners = rankOwners(ps, (id) => ({ label: id === "u1" ? "Una One" : "Tu Two", state: "named" }));
  assert.equal(owners.find((o) => o.key === "none")!.label, "No owner");
  assert.equal(owners.reduce((s, o) => s + o.count, 0), ps.length, "the owners add up to the people");
  for (const o of owners) assert.equal(selectPeople(ps, { owner: o.key }, CTX).length, o.count, `${o.label}'s number is their list`);
  assert.equal(owners[0].key, "u1", "the most waiting first");
});

test("Today agrees: its count is the people here plus the new leads nobody has replied to, by Today's own function; the leads among them are a subset", () => {
  const rows = Array.from({ length: 24 }, (_, i) => conv("A", 6 + i, { contactId: `k${i}`, conversationId: `v${i}` }));
  rows.push(conv("A", 40, { contactId: "k0", conversationId: "v-extra" })); // a second conversation of the first person
  const waiting = waitingConversations(rows, { now: NOW, slaHours: 4 });
  const lead = (contactId: string): WaitingLead => ({ locationId: "A", accountName: "Alpha Roofing", contactId, name: contactId, at: NOW - 5 * H, never: false, url: "", owner: null, source: null, detail: "" });
  // 8 leads are among the people waiting (k0..k7); 3 more are not (no conversation waiting).
  const leads = [...Array.from({ length: 8 }, (_, i) => lead(`k${i}`)), lead("f1"), lead("f2"), lead("f3")];
  const a = todayAgreement(waiting, leads);
  assert.equal(a.people, 24, "25 conversations, 24 people");
  assert.equal(a.newLeadsAmongThem, 8);
  assert.equal(a.newLeadsOnly, 3);
  assert.equal(a.today, a.people + a.newLeadsOnly, "Today = the people here + the new leads who have no waiting conversation");
  assert.equal(a.partial, false);
  // The same through Today's own counting function: the headline number it would show.
  const merged = mergeReplies({ leads, leadsTotal: leads.length, conversations: waiting.map((c) => ({ id: c.conversationId, locationId: c.locationId, accountName: "", contactId: c.contactId ?? "", name: "", at: c.lastAt, url: "", detail: "" })), conversationsTotal: waiting.length });
  const totals = emptyTotals();
  totals.replies = { count: merged.count, dollars: null, shown: merged.items.length, newLeads: merged.newLeads };
  assert.equal(countsOf(totals, merged.items).replies, a.today);
  assert.equal(countsOf(totals, merged.items).newLeads, 11);
  // With no leads at all the two numbers are the same number.
  assert.equal(todayAgreement(waiting, []).today, todayAgreement(waiting, []).people);
  // The people marked as new leads carry the same keys Today builds.
  const marked = markNewLeads(peopleOf(waiting, { now: NOW }), new Set(leads.map((l) => leadKey(l.locationId, l.contactId))));
  assert.equal(marked.filter((p: Person) => p.newLead).length, 8);
  assert.equal(factsOf(marked).newLeads, 8);
});

test("the estimate is labelled, counts people (not conversations), and leaves out a client without a win rate", () => {
  const ps = people([conv("A", 10), conv("A", 11), conv("B", 12)]);
  const e = estimateFor(ps, [{ locationId: "A", winRate: 0.5, avgDealValue: 1000 }, { locationId: "B", winRate: null, avgDealValue: 800 }]);
  assert.equal(e.amount, 1000, "2 people x $1,000 x 50%");
  assert.match(e.line ?? "", /\(an estimate\)/);
  assert.equal(e.leftOutAccounts, 1);
  assert.match(e.line ?? "", /1 client is left out/);
  assert.equal(estimateFor(ps, []).amount, null);
});

test("the next best step: reply when anyone waits, then the new leads, then appointments", () => {
  assert.equal(nextBestAction({ people: 3, newLeadsOnly: 9 }).key, "reply");
  assert.equal(nextBestAction({ people: 0, newLeadsOnly: 2 }).key, "speed");
  assert.match(nextBestAction({ people: 0, newLeadsOnly: 1 }).text, /1 new lead is still waiting/);
  assert.equal(nextBestAction({ people: 0, newLeadsOnly: 0 }).key, "appointments");
});

test("the summary is plain text: the sentence, the proof, who has waited longest, the clients with the most waiting", () => {
  const text = summaryText({
    who: "All client accounts", headline: "3 people are waiting for a reply across 2 clients. The longest has waited 4 days.", cost: "About $1,000 of business may be at risk (an estimate).",
    waiting: [{ name: "Zed", account: "Alpha Roofing", waited: "4 days", channel: "text message", owner: "no owner" }], accounts: [{ name: "Alpha Roofing", count: 2 }],
  });
  assert.equal(text.split("\n")[0], "Unanswered messages: All client accounts");
  assert.match(text, /- Zed, Alpha Roofing: waiting 4 days, text message, no owner/);
  assert.match(text, /- Alpha Roofing: 2 people/);
});

test("150 client accounts: the first screen holds five rows of each list and its size does not grow with the accounts", () => {
  const accounts = new Map<string, string>();
  const rows: WaitConv[] = [];
  for (let a = 0; a < 150; a++) {
    accounts.set(`acc${a}`, `Client ${String(a).padStart(3, "0")}`);
    for (let k = 0; k < 40; k++) rows.push(conv(`acc${a}`, 5 + ((a * 7 + k * 13) % 600), { assignedTo: k % 5 === 0 ? null : `u${k % 7}` }));
  }
  const ps = people(rows);
  assert.equal(ps.length, 6000);
  const home = homeOf(ps, { slaHours: 4, accounts, seePeople: true, me: null, labelOf: (id) => ({ label: `Owner ${id}`, state: "named" }) });
  assert.equal(home.rows.length, 5);
  assert.equal(home.accounts.rows.length, 5);
  assert.equal(home.accounts.total, 150);
  assert.equal(home.owners, null, "owners are ranked inside one account, clients across several");
  assert.equal(home.facts.people, 6000);
  assert.equal(home.buckets.reduce((s, b) => s + b.count, 0), 6000);
  const bytes = JSON.stringify(home).length;
  assert.ok(bytes < 12_000, `the first screen stays small at 150 clients (${bytes} bytes)`);
  // The list of everyone is paged: 25 rows come back, the total is the truth, and a client's number is its list.
  const all = selectPeople(ps, {}, { me: null, accounts });
  assert.equal(pageOf(all, 0, 25).rows.length, 25);
  assert.equal(pageOf(all, 0, 25).total, 6000);
  for (const r of rankAccounts(ps, accounts).slice(0, 8)) assert.equal(selectPeople(ps, { account: r.id }, { me: null, accounts }).length, r.count);
  // One account, an owner ranking instead: the same bound.
  const one = homeOf(ps.filter((p) => p.locationId === "acc3"), { slaHours: 4, accounts, seePeople: true, me: null, labelOf: (id) => ({ label: `Owner ${id}`, state: "named" }) });
  assert.ok(one.owners && one.owners.rows.length <= 5);
  assert.equal(one.owners!.rows.reduce((s, o) => s + o.count, 0) <= 40, true);
  // A client's staff get no ranking of colleagues.
  assert.equal(homeOf(ps.filter((p) => p.locationId === "acc3"), { slaHours: 4, accounts, seePeople: false, me: null, labelOf: () => ({ label: "x", state: "named" }) }).owners, null);
});

test("no GoHighLevel words anywhere in what a person reads", () => {
  const ps = people([conv("A", 30)]);
  const home = homeOf(ps, { slaHours: 4, accounts: names, seePeople: true, me: null, labelOf: () => ({ label: "x", state: "named" }) });
  const text = [home.headline.text, meaningLine(4, 30), nextBestAction({ people: 0, newLeadsOnly: 0 }).text, ...home.buckets.map((b) => b.label)].join(" ");
  assert.doesNotMatch(text, /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?account|\bSLA\b/i);
});
