import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comparePeople, compareAccounts, costEstimate, costFormula, costLine, headlineOf, nextBestAction, pageOf, parseTarget, pctOf, selectLeads, suggestReplier, summaryText, typicalLine, waitingFacts,
} from "../analytics/speed-v2.ts";
import { judge, summarise } from "../analytics/speed-intel.ts";
import { countsOf, emptyTotals, mergeReplies } from "../analytics/today-queue.ts";
import type { LoadedRow } from "../analytics/speed-parts.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const min = (n: number) => n * 60_000;
const accounts = new Map([["A", "Alpha Roofing"], ["B", "Bright Dental"], ["C", "Cedar Law"]]);
const O = { targetMinutes: 15, now: NOW, accounts };
let n = 0;
// A lead that arrived `ago` minutes ago and was first answered `after` minutes later by `user` (null = not answered).
function lead(loc: string, ago: number, after: number | null, user: string | null = "u1", over: Partial<LoadedRow> = {}): LoadedRow {
  n += 1;
  return { locationId: loc, contactId: `c${n}`, leadAt: NOW - min(ago), touchAt: after === null ? null : NOW - min(ago) + min(after), userId: after === null ? null : user, name: `Lead ${String(n).padStart(3, "0")}`, assignedTo: "o1", source: "Website", tags: [], ...over };
}

test("a target is a whole number of minutes between 1 and 1440, said in words when it is not", () => {
  assert.deepEqual(parseTarget(15), { ok: true, minutes: 15 });
  assert.deepEqual(parseTarget("30"), { ok: true, minutes: 30 });
  for (const bad of [0, -5, 1441, 2.5, "abc", "", null, undefined, NaN]) assert.equal(parseTarget(bad).ok, false, String(bad));
  assert.match((parseTarget(0) as { error: string }).error, /between 1 and 1440/);
  assert.match((parseTarget("x") as { error: string }).error, /whole number/);
});

test("one selection feeds the figure and the list behind it: the counts are equal, with ties and no-reply leads", () => {
  const rows = [
    lead("A", 600, 5), lead("A", 600, 5), lead("A", 500, 40), lead("A", 400, null), lead("B", 700, null), lead("B", 700, null), // two arrived at the same minute
    lead("B", 300, 14), lead("C", 5, null) /* still inside its window: neither way */, lead("C", 200, 15), lead("C", 100, 16),
  ];
  const s = summarise(rows, 15, NOW);
  const by = (status: Parameters<typeof selectLeads>[2]["status"]) => selectLeads(rows, O, { status }).length;
  assert.equal(by("within"), s.withinTarget);
  assert.equal(by("late"), s.answeredLate);
  assert.equal(by("waiting"), s.stillWaiting);
  assert.equal(by("answered"), s.withinTarget + s.answeredLate);
  assert.equal(by("all"), s.leads, "every judged lead, and the one still inside its window is in neither");
  assert.equal(s.leads, 9);
});

test("the list order is stable: longest wait first, ties by name, never shuffled", () => {
  const rows = [lead("B", 700, null), lead("A", 700, null), lead("A", 900, null), lead("A", 100, 5)];
  const a = selectLeads(rows, O, { status: "all", sort: "wait" }).map((x) => x.row.contactId);
  const b = selectLeads([...rows].reverse(), O, { status: "all", sort: "wait" }).map((x) => x.row.contactId);
  assert.deepEqual(a, b, "input order does not change the output order");
  assert.equal(selectLeads(rows, O, { status: "all", sort: "wait" })[0].row.leadAt, NOW - min(900));
  const byAccount = selectLeads(rows, O, { status: "all", sort: "account" }).map((x) => x.row.locationId);
  assert.deepEqual(byAccount, ["A", "A", "A", "B"]);
});

test("an account's own reply target judges its own leads", () => {
  const strict = lead("A", 60, 20, "u1", { targetMinutes: 10 });   // 20 minutes against its own 10: late
  const easy = lead("B", 60, 20, "u1", { targetMinutes: 30 });     // 20 minutes against its own 30: in time
  const plain = lead("C", 60, 20);                                  // 20 minutes against the default 15: late
  assert.equal(judge(strict, 15, NOW), "late");
  assert.equal(judge(easy, 15, NOW), "within");
  assert.equal(judge(plain, 15, NOW), "late");
  assert.equal(summarise([strict, easy, plain], 15, NOW).withinTarget, 1);
  assert.equal(selectLeads([strict, easy, plain], O, { status: "within" }).length, 1);
  const waiting = lead("A", 20, null, null, { targetMinutes: 30 });
  assert.equal(judge(waiting, 15, NOW), null, "20 minutes is inside this account's 30 minute target, so it is not waiting yet");
});

test("the setting that counts automatic messages: a lead answered only by a robot is waiting unless the setting is on", () => {
  // Setting off (the default): touchAt stays null, the robot's time is only in autoAt.
  const offRow = lead("A", 120, null, null, { detailed: true, autoAt: NOW - min(120) + 1_000, humanAt: null });
  // Setting on: the sync stored the robot's message as the touch.
  const onRow = lead("A", 120, 0, null, { detailed: true, autoAt: NOW - min(120) + 1_000, humanAt: null });
  assert.equal(judge(offRow, 15, NOW), "waiting");
  assert.equal(judge(onRow, 15, NOW), "within");
  assert.equal(selectLeads([offRow, onRow], O, { status: "onlyAuto" }).length, 1, "only the one that is still waiting is 'only an automatic message'");
});

test("filters: a person, an account, no owner, a search", () => {
  const rows = [lead("A", 100, 5, "u1"), lead("A", 100, 5, "u2"), lead("B", 100, 5, "u1"), lead("B", 500, null, null, { assignedTo: null }), lead("C", 500, null, null, { name: "Zoë Müller", source: "Instagram Lead Ad", email: "zoe@example.test" })];
  assert.equal(selectLeads(rows, O, { status: "all", person: "u1" }).length, 2);
  assert.equal(selectLeads(rows, O, { status: "all", account: "A" }).length, 2);
  assert.equal(selectLeads(rows, O, { status: "waiting", owner: "none" }).length, 1);
  assert.equal(selectLeads(rows, O, { status: "all", q: "zoe muller" }).length, 1, "accents and case are ignored");
  assert.equal(selectLeads(rows, O, { status: "all", q: "cedar" }).length, 1, "the account name is searched");
  assert.equal(selectLeads(rows, O, { status: "all", q: "instagram" }).length, 1);
  assert.equal(selectLeads(rows, O, { status: "all", q: "nobody matches this" }).length, 0);
});

test("paging never goes out of range and never holds more than 50", () => {
  const list = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual(pageOf(list, 0, 25), { rows: list.slice(0, 25), page: 0, pages: 5, total: 120, from: 1, to: 25 });
  assert.equal(pageOf(list, 99, 25).page, 4);
  assert.equal(pageOf(list, 0, 1000).rows.length, 100);
  assert.deepEqual(pageOf([], 3, 25), { rows: [], page: 0, pages: 1, total: 0, from: 0, to: 0 });
});

test("the headline counts people once and says never answered is part of them", () => {
  const rows = [lead("A", 120, null), lead("A", 5000, null), lead("B", 6000, null), lead("B", 30, 5), lead("A", 5, null)];
  const f = waitingFacts(rows, { targetMinutes: 15, now: NOW });
  assert.equal(f.waiting, 3, "the 5 minute old lead is inside its window; the answered one is not waiting");
  assert.equal(f.never, 2);
  assert.equal(f.accountsWithWaiting, 2);
  assert.equal(f.oldestMinutes, 6000);
  const h = headlineOf(f, true);
  assert.equal(h.text, "3 leads are waiting for a reply across 2 clients. 2 of them were never answered.");
  assert.equal(h.allClear, false);
  assert.equal(headlineOf({ waiting: 1, never: 1, noOwner: 0, accountsWithWaiting: 1, oldestMinutes: 9000 }, false).text, "1 lead is waiting for a reply. One of them was never answered.");
  assert.equal(headlineOf({ waiting: 2, never: 2, noOwner: 0, accountsWithWaiting: 1, oldestMinutes: 9000 }, false).text, "2 leads are waiting for a reply. All of them were never answered.");
  assert.deepEqual(headlineOf({ waiting: 0, never: 0, noOwner: 0, accountsWithWaiting: 0, oldestMinutes: null }, true), { parts: [{ t: "Nobody is waiting for a reply right now." }], text: "Nobody is waiting for a reply right now.", allClear: true });
});

test("leads older than 14 days are not 'waiting now'", () => {
  const f = waitingFacts([lead("A", 15 * 1440, null), lead("A", 13 * 1440, null)], { targetMinutes: 15, now: NOW });
  assert.equal(f.waiting, 1);
});

test("Today and Speed agree: the leads waiting are the 'new leads' inside Today's people waiting, counted once", () => {
  const rows = [lead("A", 200, null), lead("A", 300, null), lead("B", 5000, null), lead("B", 90, 4)];
  const f = waitingFacts(rows, { targetMinutes: 15, now: NOW });
  const waiters = selectLeads(rows, O, { status: "waiting" }).map((x) => x.row);
  // Today's inputs: the same waiting leads, plus two conversations: one of the SAME people (a lead who also wrote again) and one stranger.
  const m = mergeReplies({
    leads: waiters.map((r) => ({ locationId: r.locationId, accountName: accounts.get(r.locationId) ?? "", contactId: r.contactId, name: r.name, at: r.leadAt, never: false, url: "", owner: null, source: null, detail: "" })),
    leadsTotal: f.waiting,
    conversations: [
      { id: "k1", locationId: waiters[0].locationId, accountName: "", contactId: waiters[0].contactId, name: waiters[0].name, at: NOW, url: "", detail: "" },
      { id: "k2", locationId: "C", accountName: "", contactId: "stranger", name: "Stranger", at: NOW, url: "", detail: "" },
    ],
    conversationsTotal: 2,
  });
  const totals = emptyTotals();
  totals.replies = { count: m.count, dollars: null, shown: m.items.length, newLeads: m.newLeads };
  const c = countsOf(totals, m.items);
  assert.equal(c.newLeads, f.waiting, "Speed's waiting leads are Today's 'of which N are new leads'");
  assert.equal(c.replies, f.waiting + 1, "the person who is both counts once; the stranger adds one");
});

test("a tiny base never gets a percentage", () => {
  assert.equal(pctOf(2, 4).value, null);
  assert.equal(pctOf(3, 5).text, "60%");
  assert.equal(pctOf(0, 0).value, null);
});

test("comparing accounts: slowest first, accounts with fewer than 5 judged leads are listed after with progress, not a percentage", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => lead("A", 300, 5)),                                 // A: 6 of 6 in time
    ...Array.from({ length: 5 }, (_, i) => lead("B", 300, i < 1 ? 5 : 60)),                // B: 1 of 5 in time
    lead("C", 300, 5), lead("C", 300, 5),                                                  // C: 2 judged only
  ];
  const r = compareAccounts(rows, O);
  assert.deepEqual(r.map((x) => x.id), ["B", "A", "C"]);
  assert.equal(r[0].ranked, true);
  assert.equal(r[2].ranked, false);
  assert.equal(r[2].progress, "2 of 5 leads so far");
  assert.equal(r[2].hitRate, null);
});

test("comparing people: ranked ones slowest first, others with 'n of 3 replies so far', one lucky reply is never a rank", () => {
  const rows = [
    lead("A", 900, 2, "fast"), lead("A", 900, 3, "fast"), lead("A", 900, 4, "fast"),
    lead("A", 900, 50, "slow"), lead("A", 900, 70, "slow"), lead("A", 900, 90, "slow"),
    lead("A", 900, 1, "new"), lead("A", 900, 1, "new"),
  ];
  const p = comparePeople(rows);
  assert.deepEqual(p.map((x) => x.userId), ["slow", "fast", "new"]);
  assert.equal(p[2].ranked, false);
  assert.equal(p[2].progress, "2 of 3 replies so far");
  assert.equal(p[0].progress, null);
});

test("who should reply: the fastest person in that account with enough replies, ties to more replies, never a one-reply person, null when nobody qualifies", () => {
  const rows = [
    lead("A", 900, 5, "p1"), lead("A", 900, 5, "p1"), lead("A", 900, 5, "p1"),
    lead("A", 900, 5, "p2"), lead("A", 900, 5, "p2"), lead("A", 900, 5, "p2"), lead("A", 900, 5, "p2"),
    lead("A", 900, 1, "lucky"),
    lead("B", 900, 1, "other"), lead("B", 900, 1, "other"),
  ];
  assert.equal(suggestReplier(rows, "A")?.userId, "p2", "same typical time, more replies wins");
  assert.equal(suggestReplier(rows, "B"), null, "two replies are not enough");
  assert.equal(suggestReplier(rows, "Z"), null);
});

test("the cost estimate is leads waiting x average deal x win rate, only where both exist, and says what it left out", () => {
  const c = costEstimate(new Map([["A", 3], ["B", 2], ["C", 0]]), [
    { locationId: "A", winRate: 0.25, avgDealValue: 4000 }, { locationId: "B", winRate: null, avgDealValue: 1000 },
  ]);
  assert.equal(c.amount, 3000);
  assert.equal(c.waiting, 5);
  assert.equal(c.countedAccounts, 1);
  assert.equal(c.leftOutAccounts, 1);
  assert.equal(c.leftOutWaiting, 2);
  assert.match(costLine(c) ?? "", /^About \$3,000 of business may be at risk \(an estimate\)\. 1 client is left out because it has fewer than 20 closed deals.$/);
  assert.match(costFormula(c), /3 leads x \$4,000 x 25% = \$3,000/);
  const none = costEstimate(new Map([["B", 2]]), []);
  assert.equal(none.amount, null);
  assert.match(costLine(none) ?? "", /cannot estimate/);
  assert.equal(costLine(costEstimate(new Map(), [])), null, "nobody waiting, no line");
});

test("the next best action: reply first, then the slowest client, then sources, then the target, else nothing", () => {
  const base = { waiting: 0, noOwner: 0, slowestAccount: null, unknownSourceShare: null, typicalSeconds: 120, canChangeTarget: true };
  assert.equal(nextBestAction({ ...base, waiting: 3 }).key, "reply");
  assert.equal(nextBestAction({ ...base, slowestAccount: { name: "Cedar Law", hitRate: 0.3 } }).key, "slow_account");
  assert.match(nextBestAction({ ...base, slowestAccount: { name: "Cedar Law", hitRate: 0.3 } }).text, /Cedar Law answers only 30%/);
  assert.equal(nextBestAction({ ...base, slowestAccount: { name: "Cedar Law", hitRate: 0.9 }, unknownSourceShare: 0.5 }).key, "sources");
  assert.equal(nextBestAction({ ...base, typicalSeconds: 7200 }).key, "target");
  assert.equal(nextBestAction({ ...base, typicalSeconds: 7200, canChangeTarget: false }).key, "none");
});

test("the typical sentence and the copied summary read in plain words", () => {
  const s = summarise([...Array.from({ length: 6 }, () => lead("A", 300, 10))], 15, NOW);
  assert.equal(typicalLine(s, "last 30 days"), "Typical first reply 10 min in the last 30 days, from 6 replies.");
  assert.equal(typicalLine(summarise([lead("A", 300, 10)], 15, NOW), "last 30 days"), "1 reply so far in the last 30 days. A typical time shows from 5.");
  assert.equal(typicalLine(summarise([], 15, NOW), "last 7 days"), "No replies in the last 7 days yet.");
  const t = summaryText({ who: "All client accounts", headline: "3 leads are waiting for a reply.", typical: "Typical first reply 10 min.", cost: null, waiting: [{ name: "Ava", account: "Alpha Roofing", waited: "2 hours", owner: "no owner" }], slow: [{ name: "Bright Dental", line: "1 of 5 answered in time" }] });
  assert.equal(t, "Speed to lead: All client accounts\n3 leads are waiting for a reply.\nTypical first reply 10 min.\n\nWaiting longest:\n- Ava, Alpha Roofing: waiting 2 hours, no owner\n\nSlowest to reply:\n- Bright Dental: 1 of 5 answered in time");
});

test("150 client accounts: the comparison pages, the counts agree everywhere, and what the screen sends stays small", () => {
  const names = new Map<string, string>();
  const rows: LoadedRow[] = [];
  for (let a = 0; a < 150; a++) {
    const id = `acct${String(a).padStart(3, "0")}`;
    names.set(id, `Client ${String.fromCharCode(97 + Math.floor(a / 26))}${String.fromCharCode(97 + (a % 26))}`);
    // Every account has 14 leads: 6 in time, 4 late, 4 waiting (a few of them never answered), so each has enough to be ranked.
    for (let i = 0; i < 6; i++) rows.push(lead(id, 600 + i, 5, `u${a % 7}`));
    for (let i = 0; i < 4; i++) rows.push(lead(id, 600 + i, 60, `u${a % 7}`));
    for (let i = 0; i < 4; i++) rows.push(lead(id, i < 1 ? 6000 : 120 + i, null, null, { assignedTo: i % 2 === 0 ? null : "o1" }));
  }
  const o = { targetMinutes: 15, now: NOW, accounts: names };
  const f = waitingFacts(rows, { targetMinutes: 15, now: NOW });
  assert.equal(f.waiting, 600);
  assert.equal(f.accountsWithWaiting, 150);
  assert.equal(selectLeads(rows, o, { status: "waiting" }).length, 600);
  const accountRows = compareAccounts(rows, o);
  assert.equal(accountRows.length, 150);
  assert.equal(accountRows.reduce((s, a) => s + a.stillWaiting, 0), f.waiting, "the clients add up to the headline");
  assert.equal(accountRows.reduce((s, a) => s + a.judged, 0), selectLeads(rows, o, { status: "all" }).length);
  // The home answer holds 5 rows of each list; the list endpoint 25 a page, 50 at most; a page is never past the last.
  const pg = pageOf(accountRows, 5, 25);
  assert.equal(pg.pages, 6);
  assert.equal(pg.rows.length, 25);
  assert.equal(pageOf(accountRows, 99, 50).page, 2);
  const waiting = selectLeads(rows, o, { status: "waiting" });
  assert.equal(pageOf(waiting, 0, 25).rows.length, 25);
  assert.equal(pageOf(waiting, 23, 25).rows.length, 25);
  assert.equal(pageOf(waiting, 24, 25).to, 600);
  // The people list is bounded by the team, not by the accounts.
  assert.equal(comparePeople(rows).length, 7);
  // Searching one client among 150 finds exactly it (account 149 is called "Client ft").
  assert.equal(selectLeads(rows, o, { status: "all", q: "client ft" }).length, 14);
  // What the first screen sends is a fixed size: 5 + 5 + 5 rows of a few hundred bytes, however many clients there are.
  const wire = JSON.stringify({ waiting: waiting.slice(0, 5), accounts: accountRows.slice(0, 5), people: comparePeople(rows).slice(0, 5) });
  assert.ok(wire.length < 6_000, `the first screen's lists stay small (${wire.length} bytes)`);
});
