import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseSurvivor, clearlyDiffer, groupDuplicates, splitCompatible, type Person } from "../analytics/dedupe.ts";
import {
  anyClearlyDiffer, byAccount, crmSteps, diffFields, explainSurvivor, guardrails, health, isObvious, likelihood, mergePlan, pageOf, rankValue, reasonCounts, reasonOf,
  selectGroups, sortGroups, summaryText, type QueueItem,
} from "../analytics/dedupe-review.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const p = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ada Lovelace", email: null, phone: null, tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null,
  source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});
const item = (loc: string, people: Person[], o: Partial<QueueItem> = {}): QueueItem => {
  const g = groupDuplicates(people)[0];
  return { ...g, locationId: loc, locationName: `Account ${loc}`, ...o };
};

// ---------- the kind of match, in words ----------

test("a group says in plain words why it is a group", () => {
  assert.deepEqual(reasonOf({ reasons: ["same email", "same phone"] }), { key: "both", label: "Same email and phone number" });
  assert.deepEqual(reasonOf({ reasons: ["same email"] }), { key: "email", label: "Same email" });
  assert.deepEqual(reasonOf({ reasons: ["same phone"] }), { key: "phone", label: "Same phone number" });
  assert.equal(reasonOf({ reasons: ["phone in a different format"] }).label, "Same phone number, written differently");
  assert.equal(reasonOf({ reasons: ["email differs only in case, spaces or gmail dots", "phone in a different format"] }).key, "both");
  assert.equal(reasonOf({ reasons: ["same name"] }).key, "name");
  assert.equal(likelihood(94).key, "certain");
  assert.equal(likelihood(80).key, "likely");
  assert.equal(likelihood(35).key, "possible");
});

// ---------- people who clearly differ are never offered ----------

test("different phone AND different email is two people; a missing value never makes them differ", () => {
  assert.equal(clearlyDiffer(p("a", { email: "a@x.com", phone: "5550101111" }), p("b", { email: "b@x.com", phone: "5550102222" })), true);
  assert.equal(clearlyDiffer(p("a", { email: "a@x.com", phone: "5550101111" }), p("b", { email: "b@x.com", phone: "5550101111" })), false, "same phone");
  assert.equal(clearlyDiffer(p("a", { email: "a@x.com", phone: "5550101111" }), p("b", { email: "a@x.com", phone: "5550102222" })), false, "same email");
  assert.equal(clearlyDiffer(p("a", { email: "a@x.com" }), p("b", { email: "b@x.com", phone: "5550102222" })), false, "no phone on one side: cannot differ on phone");
  assert.equal(clearlyDiffer(p("a", { email: "A.D.A@gmail.com", phone: "(555) 010-1111" }), p("b", { email: "ada@gmail.com", phone: "+1 555 010 2222" })), false, "same inbox written differently");
});

test("a chain that ties two different people together is split, not offered as one group", () => {
  // A and B share an email; B and C share a phone; A and C share nothing and differ on both.
  const a = p("a", { email: "x@y.com", phone: "5550101111", lastActivityAt: daysAgo(1) });
  const b = p("b", { email: "x@y.com", phone: "5550102222" });
  const c = p("c", { email: "z@y.com", phone: "5550102222" });
  assert.equal(anyClearlyDiffer([a, c]), true);
  const parts = splitCompatible([a, b, c], NOW);
  assert.equal(parts.length, 1, "one safe pair is left");
  for (const part of parts) assert.equal(anyClearlyDiffer(part), false);
  const groups = groupDuplicates([a, b, c]);
  assert.ok(groups.length >= 1);
  for (const g of groups) assert.equal(anyClearlyDiffer(g.people), false, "no offered group contains two clearly different people");
  assert.ok(!groups.some((g) => g.people.length === 3));
});

// ---------- the best record, with the reason ----------

test("ties go to the oldest record, and the reason says so", () => {
  const old = p("old", { email: "a@x.com", phone: "5550101111", createdAt: "2025-01-01T00:00:00Z" });
  const nu = p("new", { email: "a@x.com", phone: "5550101111", createdAt: "2026-06-01T00:00:00Z" });
  assert.equal(chooseSurvivor([nu, old], NOW).contactId, "old");
  assert.equal(explainSurvivor([nu, old], "old"), "The oldest record");
});

test("the reason names what the kept record has that the others lack, at most three things", () => {
  const best = p("best", { email: "a@x.com", phone: "5550101111", lastActivityAt: daysAgo(2), openDeals: 2, hasConversation: true });
  const other = p("other", { email: "a@x.com", lastActivityAt: daysAgo(40) });
  assert.equal(explainSurvivor([other, best], "best"), "Most recent activity, has a phone and an email, 2 open deals");
  // A missing phone on the kept record: the reason does not claim one.
  const noPhone = p("n", { email: "a@x.com", openDeals: 1 });
  assert.equal(explainSurvivor([noPhone, p("m", { email: "a@x.com" })], "n"), "1 open deal");
  // A customer.
  assert.match(explainSurvivor([p("w", { wonDeals: 2, email: "a@x.com" }), p("v", { email: "a@x.com" })], "w"), /customer/);
});

test("the pre-picked record is the one with deals and a conversation even when it is newer", () => {
  const rich = p("rich", { wonDeals: 1, openDeals: 1, hasConversation: true, email: "a@x.com", phone: "5550101111", createdAt: "2026-05-01T00:00:00Z" });
  const bare = p("bare", { email: "a@x.com", createdAt: "2024-01-01T00:00:00Z" });
  assert.equal(chooseSurvivor([bare, rich], NOW).contactId, "rich");
});

// ---------- the warnings ----------

test("Do Not Disturb, a customer, open deals on the removed record and different owners each earn a warning; a clean pair earns none", () => {
  const clean = [p("a", { email: "a@x.com", phone: "5550101111" }), p("b", { email: "a@x.com", phone: "5550101111" })];
  assert.deepEqual(guardrails(clean, "a"), []);
  const dnd = guardrails([p("a"), p("b", { name: "Bea B", dnd: true })], "a");
  assert.deepEqual(dnd.map((g) => g.id), ["dnd"]);
  assert.match(dnd[0].text, /Bea B asked not to be contacted/);
  const cust = guardrails([p("a"), p("b", { wonDeals: 2 })], "a");
  assert.deepEqual(cust.map((g) => g.id), ["customer"]);
  assert.match(cust[0].text, /cannot see payments/);
  const deals = guardrails([p("a"), p("b", { openDeals: 2, openValue: 4500 })], "a");
  assert.deepEqual(deals.map((g) => g.id), ["open_deals"]);
  assert.match(deals[0].text, /2 open deals \(\$4,500\) that will move/);
  assert.deepEqual(guardrails([p("a", { openDeals: 3 }), p("b")], "a"), [], "deals on the KEPT record are not at risk");
  const owners = guardrails([p("a", { ownerId: "u1", ownerName: "Sam" }), p("b", { ownerId: "u2", ownerName: "Priya" })], "a");
  assert.deepEqual(owners.map((g) => g.id), ["owner"]);
  assert.match(owners[0].text, /Sam and Priya/);
  assert.deepEqual(guardrails([p("a", { ownerId: "u1" }), p("b", { ownerId: "u1" })], "a"), []);
  assert.equal(guardrails([p("a", { dnd: true, ownerId: "u1" }), p("b", { wonDeals: 1, openDeals: 1, ownerId: "u2" })], "a").length, 4);
});

// ---------- only what differs ----------

test("the side-by-side view returns only the differing rows; identical fields are collapsed, empty ones left out", () => {
  const a = p("a", { name: "Ada Lovelace", email: "Ada@x.com", phone: "+1 (555) 010-1111", source: "Facebook", tags: ["vip"], openDeals: 1 });
  const b = p("b", { name: "ada  lovelace", email: "ada@x.com", phone: "5550101111", source: "Website", tags: ["lead", "vip"], dnd: true });
  const d = diffFields([a, b]);
  assert.deepEqual(d.differ.map((r) => r.id), ["source", "tags", "deals", "dnd"]);
  assert.deepEqual(d.same.map((r) => r.id), ["name", "email", "phone"], "same after tidying case, spaces and formats");
  assert.equal(d.differ.find((r) => r.id === "deals")!.values[1].empty, true);
  // A field empty everywhere is not shown at all.
  assert.ok(![...d.differ, ...d.same].some((r) => r.id === "owner" || r.id === "conversation"));
});

// ---------- the merge plan ----------

test("the plan says what is kept, added, moved and removed, and what to pick in the merge screen", () => {
  const keep = p("k", { name: "Ada Lovelace", email: "ada@x.com", tags: ["vip"], openDeals: 1 });
  const gone = p("g", { name: "A. Lovelace", email: "ada@work.com", phone: "5550101111", tags: ["vip", "lead"], openDeals: 2, hasConversation: true });
  const plan = mergePlan([keep, gone], "k");
  assert.deepEqual(plan.removeIds, ["g"]);
  assert.deepEqual(plan.tagsAdded, ["lead"]);
  assert.deepEqual(plan.dealsMoved, { open: 2, won: 0 });
  assert.match(plan.lines.join(" "), /Conversations, notes and tasks .* combined/);
  assert.match(plan.lines.join(" "), /cannot be undone/);
  assert.ok(plan.picks.some((x) => /no phone/.test(x) && x.includes("5550101111")));
  assert.ok(plan.picks.some((x) => /Different emails/.test(x)));
  assert.ok(plan.picks.some((x) => /names differ/.test(x)));
  assert.equal(plan.warnings.map((w) => w.id).join(), "open_deals");
  assert.throws(() => mergePlan([keep, gone], "zzz"));
  const text = summaryText({ accountName: "Harbor Law", plan, people: [keep, gone], why: "Most recent activity", crmSteps: crmSteps("Ada Lovelace") });
  assert.match(text, /^Merge 2 contacts in Harbor Law/);
  assert.match(text, /Keep: Ada Lovelace, ada@x.com \(most recent activity\)/);
  assert.match(text, /3\. Choose Ada Lovelace as the contact to keep/);
});

// ---------- the obvious ones ----------

test("only same email AND same phone, two or three records and no warning, count as obvious", () => {
  const both = [p("a", { email: "a@x.com", phone: "+15550101111" }), p("b", { email: "A@x.com", phone: "(555) 010-1111" })];
  assert.equal(isObvious({ people: both, survivorId: "a" }), true);
  assert.equal(isObvious({ people: [p("a", { email: "a@x.com" }), p("b", { email: "a@x.com" })], survivorId: "a" }), false, "no phone");
  assert.equal(isObvious({ people: [p("a", { email: "a@x.com", phone: "5550101111" }), p("b", { email: "a@x.com", phone: "5550102222" })], survivorId: "a" }), false);
  assert.equal(isObvious({ people: [...both, p("c", { email: "a@x.com", phone: "5550101111" }), p("d", { email: "a@x.com", phone: "5550101111" })], survivorId: "a" }), false, "four is too many to glance at");
  assert.equal(isObvious({ people: [both[0], { ...both[1], dnd: true }], survivorId: "a" }), false, "a warning means it must be looked at one by one");
  assert.equal(isObvious({ people: [both[0], { ...both[1], openDeals: 1 }], survivorId: "a" }), false);
});

// ---------- ranking ----------

test("groups with open deals come first, then customers, then Do Not Disturb, then recent activity", () => {
  const mk = (id: string, o: Partial<Person>) => item(id, [p(id + "1", { email: `${id}@x.com`, ...o }), p(id + "2", { email: `${id}@x.com` })]);
  const deals = mk("d", { openDeals: 1 });
  const won = mk("w", { wonDeals: 1 });
  const dnd = mk("n", { dnd: true });
  const recent = mk("r", { lastActivityAt: daysAgo(1) });
  const old = mk("o", { lastActivityAt: daysAgo(150) });
  const none = mk("z", {});
  const sorted = sortGroups([none, old, recent, dnd, won, deals], "important", NOW).map((g) => g.locationId);
  assert.deepEqual(sorted, ["d", "w", "n", "r", "o", "z"]);
  assert.ok(rankValue(deals, NOW) > rankValue(won, NOW));
});

test("sorting by size, newest and certainty", () => {
  const two = item("a", [p("a1", { email: "a@x.com" }), p("a2", { email: "a@x.com" })]);
  const three = item("b", [p("b1", { email: "b@x.com" }), p("b2", { email: "b@x.com" }), p("b3", { email: "b@x.com" })]);
  assert.equal(sortGroups([two, three], "size", NOW)[0].locationId, "b");
  const fresh = item("c", [p("c1", { email: "c@x.com", createdAt: daysAgo(1) }), p("c2", { email: "c@x.com", createdAt: daysAgo(3) })]);
  assert.equal(sortGroups([two, fresh], "newest", NOW)[0].locationId, "c");
  const weak = item("w", [p("w1", { phone: "(555) 010-3333" }), p("w2", { phone: "5550103333" })]);
  assert.equal(sortGroups([weak, two], "sure", NOW)[0].locationId, "a");
});

// ---------- the queue ----------

test("the queue hides what was decided or set aside, and filters by account, kind and a search", () => {
  const g1 = item("L1", [p("1", { name: "Ann One", email: "ann@x.com", phone: "5550101111" }), p("2", { name: "Ann One", email: "ann@x.com", phone: "5550101111" })]);
  const g2 = item("L2", [p("3", { name: "Bob Two", phone: "5550102222" }), p("4", { name: "Bob Two", phone: "5550102222" })]);
  const g3 = item("L2", [p("5", { name: "Cy Three", email: "cy@x.com" }), p("6", { name: "Cy Three", email: "cy@x.com" })]);
  const all = [g1, g2, g3];
  const base = { decided: new Set<string>(), later: new Set<string>(), now: NOW };
  assert.equal(selectGroups(all, { ...base, status: "open" }).length, 3);
  assert.equal(selectGroups(all, { ...base, status: "open", decided: new Set([`L1:${g1.key}`]) }).length, 2);
  assert.equal(selectGroups(all, { ...base, status: "decided", decided: new Set([`L1:${g1.key}`]) }).length, 1);
  assert.equal(selectGroups(all, { ...base, status: "later", later: new Set([`L2:${g2.key}`]) })[0].key, g2.key);
  assert.equal(selectGroups(all, { ...base, status: "open", later: new Set([`L2:${g2.key}`]) }).length, 2, "set aside is not open");
  assert.equal(selectGroups(all, { ...base, status: "open", location: "L2" }).length, 2);
  assert.equal(selectGroups(all, { ...base, status: "open", reason: "phone" }).length, 1);
  assert.equal(selectGroups(all, { ...base, status: "open", q: "cy@" }).length, 1);
  assert.equal(selectGroups(all, { ...base, status: "open", q: "555-010-2222" }).length, 1, "a phone search ignores punctuation");
  assert.equal(selectGroups(all, { ...base, status: "open", q: "account l1" }).length, 1, "the account name is searchable");
  assert.equal(selectGroups(all, { ...base, status: "open", q: "nobody" }).length, 0);
  assert.deepEqual(reasonCounts(all), { both: 1, email: 1, phone: 1, name: 0 });
});

test("a screen of groups at 150 accounts and 5,000 groups: the server sends one page, ranked, and the numbers add up", () => {
  const groups: QueueItem[] = [];
  for (let a = 0; a < 150; a++) {
    const per = a < 50 ? 50 : 25; // 50*50 + 100*25 = 5000
    for (let i = 0; i < per; i++) {
      const email = `p${a}-${i}@x.com`;
      groups.push({
        key: `k${a}-${i}`, locationId: `L${a}`, locationName: `Client ${String(a).padStart(3, "0")}`, confidence: 94, reasons: ["same email"], kind: "exact", survivorId: `c${a}-${i}-1`,
        people: [p(`c${a}-${i}-1`, { email, openDeals: i % 7 === 0 ? 1 : 0 }), p(`c${a}-${i}-2`, { email })],
      });
    }
  }
  assert.equal(groups.length, 5000);
  const t0 = Date.now();
  const open = selectGroups(groups, { status: "open", decided: new Set(), later: new Set(), now: NOW });
  const page = pageOf(open, 0, 25);
  assert.ok(Date.now() - t0 < 3000, "selecting and sorting 5,000 groups is fast");
  assert.equal(page.rows.length, 25);
  assert.equal(page.total, 5000);
  assert.equal(page.pages, 200);
  assert.ok(page.rows.every((g) => g.people.some((x) => x.openDeals > 0)), "the first page is the groups with open deals");
  assert.deepEqual(pageOf(open, 9999, 25).page, 199, "a page past the end is clamped");
  assert.equal(pageOf(open, 0, 100000).rows.length, 50, "never more than 50 rows in one page");
  assert.equal(pageOf([], 3, 25).from, 0);
  const h = health(open, 90_000);
  assert.equal(h.groups, 5000);
  assert.equal(h.contacts, 10_000);
  assert.equal(h.extra, 5000);
  assert.equal(h.shareLabel, "about 6% of your list");
  const accounts = byAccount(open, NOW);
  assert.equal(accounts.length, 150);
  assert.equal(accounts.reduce((s, a) => s + a.groups, 0), 5000);
  assert.equal(accounts.reduce((s, a) => s + a.extra, 0), h.extra, "per-account counts add up to the header");
  assert.ok(accounts[0].weight >= accounts[149].weight);
  const filtered = selectGroups(groups, { status: "open", decided: new Set(), later: new Set(), now: NOW, location: "L7" });
  assert.equal(filtered.length, 50);
});

test("the health line: groups, extra contacts and the share of the list, with no claim when there is nothing", () => {
  assert.deepEqual(health([], 1000), { groups: 0, contacts: 0, extra: 0, listSize: 1000, shareLabel: "" });
  const g = [{ people: [1, 2] }, { people: [1, 2, 3] }];
  assert.equal(health(g, 100_000).shareLabel, "under 1% of your list");
  assert.equal(health(g, 200).shareLabel, "about 2% of your list");
  assert.equal(health(g, 0).shareLabel, "");
});

test("a team member whose name is not known is told apart by the end of their id, never by the whole id", () => {
  const d = diffFields([p("a", { ownerId: "user-e5f0" }), p("b", { ownerId: "user-9b2e", ownerName: "Marcus Lee" })]);
  const owner = d.differ.find((r) => r.id === "owner")!;
  assert.deepEqual(owner.values.map((v) => v.text), ["Team member e5f0", "Marcus Lee"]);
  const w = guardrails([p("a", { ownerId: "user-e5f0" }), p("b", { ownerId: "user-9b2e" })], "a");
  assert.match(w[0].text, /Team member e5f0 and Team member 9b2e/);
});
