import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountBars, accountsNeedingYou, barsTitle, countsOf, emptyTotals, headlineOf, INLINE_ROWS, KINDS, mergeReplies, personRow, replyContext, waitingOldestFirst,
  type AccountFacts, type TodayItem, type WaitingConversation, type WaitingLead,
} from "../analytics/today-queue.ts";
import { applyView } from "../analytics/today-state.ts";
import { specAccount, specClients, specKind, specRow, specThings, type SpecEnv } from "../analytics/today-specs.ts";
import { breakdownOf } from "../analytics/today-queue.ts";

// The counting rule of Today (docs/METRICS.md, "Today, third pass"): a person who is waiting for a reply is counted ONCE, whether they are a new lead nobody answered, a
// customer message nobody answered, or both. The live bug: 8 new leads and 24 unanswered conversations were shown as "32", but the 8 leads were among the 24 conversations.
// Everything on the page is read from ONE function (countsOf), so these tests build one fixture and check that every place agrees.

const NOW = Date.parse("2026-11-04T09:00:00Z");
const H = 3_600_000;
const acct = (id: string, name: string): AccountFacts => ({ id, name, followUpEstimate: null, url: `https://crm.example.com/${id}/opportunities` });

const lead = (loc: string, n: number, over: Partial<WaitingLead> = {}): WaitingLead => ({
  locationId: loc, accountName: loc === "kd" ? "KD Squares LTD" : "Other", contactId: `c${n}`, name: `Lead ${n}`, at: NOW - (n + 1) * H, never: false, url: `https://crm.example.com/${loc}/c${n}`, owner: null, source: "Facebook", detail: "Waiting", ...over,
});
const conv = (loc: string, n: number, over: Partial<WaitingConversation> = {}): WaitingConversation => ({
  id: `conv${n}`, locationId: loc, accountName: loc === "kd" ? "KD Squares LTD" : "Other", contactId: `c${n}`, name: `Lead ${n}`, at: NOW - (n + 1) * H, url: `https://crm.example.com/${loc}/c${n}`, detail: "SMS, waiting 3 h", ...over,
});

test("leads that are also unanswered conversations are counted once: 8 leads inside 24 conversations are 24 people, not 32", () => {
  const leads = Array.from({ length: 8 }, (_, n) => lead("kd", n));
  const conversations = Array.from({ length: 24 }, (_, n) => conv("kd", n)); // contacts c0..c23: the 8 leads are c0..c7
  const merged = mergeReplies({ leads, leadsTotal: 8, conversations, conversationsTotal: 24 });
  assert.equal(merged.count, 24, "distinct people");
  assert.equal(merged.items.length, 24);
  assert.equal(merged.newLeads, 8, "new leads are a subset, said as 'of which'");
  assert.equal(merged.items.filter((i) => i.newLead).length, 8);
  assert.equal(merged.partial, false);
});

test("a person in several conversations is one row, with the longest wait; a person with no contact id is still one row per conversation", () => {
  const merged = mergeReplies({
    leads: [], leadsTotal: 0, conversationsTotal: 4,
    conversations: [conv("kd", 1, { id: "a", at: NOW - 2 * H }), conv("kd", 1, { id: "b", at: NOW - 9 * H }), conv("kd", 2, { id: "c", contactId: "" }), conv("kd", 3, { id: "d", contactId: "" })],
  });
  assert.equal(merged.count, 3);
  assert.equal(merged.items.find((i) => i.contactId === "c1")?.at, NOW - 9 * H);
});

test("when a list was cut at its cap the part that was not loaded is added, and the count says it may be high", () => {
  const merged = mergeReplies({ leads: [lead("kd", 1)], leadsTotal: 5, conversations: [conv("kd", 1), conv("kd", 2)], conversationsTotal: 2 });
  assert.equal(merged.items.length, 2);
  assert.equal(merged.count, 2 + 4, "4 leads were not loaded");
  assert.equal(merged.partial, true);
});

// One fixture, every place that shows a number.
function fixture() {
  const accounts = [acct("kd", "KD Squares LTD"), acct("other", "Other")];
  const waiting = mergeReplies({
    leads: Array.from({ length: 8 }, (_, n) => lead("kd", n)), leadsTotal: 8,
    conversations: [...Array.from({ length: 24 }, (_, n) => conv("kd", n)), ...Array.from({ length: 3 }, (_, n) => conv("other", 100 + n))], conversationsTotal: 27,
  });
  const other = (kind: TodayItem["kind"], loc: string, n: number, value: number | null = null): TodayItem => ({
    id: `${kind}:${loc}:${n}`, kind, locationId: loc, accountName: loc === "kd" ? "KD Squares LTD" : "Other", name: `${kind} ${n}`, detail: "", at: NOW - 40 * 24 * H, value, contactId: `x${n}`, url: "u",
  });
  const items = [...waiting.items, other("appointments", "kd", 1), other("appointments", "kd", 2), other("noshows", "kd", 3), other("stale", "kd", 4, 5000), other("stale", "other", 5, 700)];
  const totals = emptyTotals();
  for (const k of KINDS) { const m = items.filter((x) => x.kind === k); totals[k] = { count: m.length, dollars: k === "stale" ? m.reduce((s, x) => s + (x.value ?? 0), 0) : null, shown: m.length }; }
  totals.replies.newLeads = waiting.newLeads;
  const view = applyView({ items, totals, accounts, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  const env: SpecEnv = { now: NOW, view, accounts, staleDays: 30, targetMinutes: 15, ledger: [], scope: "all", excluded: false };
  return { accounts, view, env, items };
}

test("one number per fact: the headline, the tiles, the work list, the bars and every list behind them agree", () => {
  const { accounts, view, env } = fixture();
  const c = countsOf(view.totals, view.queue);
  assert.equal(c.replies, 27, "24 at KD Squares and 3 at the other account, each person once");
  assert.equal(c.newLeads, 8);
  assert.equal(c.things, 27 + 2 + 1 + 2, "no person is added twice");

  // headline (one account) and its breakdown line
  const oneKd = applyView({ items: view.items.filter((i) => i.locationId === "kd"), totals: { ...view.totals, replies: { ...view.totals.replies, count: 24, shown: 24 }, appointments: { ...view.totals.appointments }, stale: { count: 1, dollars: 5000, shown: 1 } }, accounts, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  const h = headlineOf({ scope: "account", rows: oneKd.queue, totals: oneKd.totals });
  assert.match(h.text, /^24 people are waiting for a reply\.$/);
  assert.match(h.breakdown ?? "", /^8 new leads/);

  // headline for every account says clients, and the account list has exactly that many
  const all = headlineOf({ scope: "all", rows: view.queue, totals: view.totals });
  const needing = accountsNeedingYou(view.queue, new Map(accounts.map((a) => [a.id, a])), 100_000);
  assert.match(all.text, /across 2 clients\.$/);
  assert.equal(needing.total, 2);
  assert.equal(specClients(env).count, needing.total);
  assert.equal(specClients(env).rows.length, needing.total);

  // the work list rows, the bars and the lists behind them
  assert.equal(view.queue.filter((r) => r.kind === "replies").reduce((s, r) => s + r.count, 0), c.replies);
  const bars = accountBars(view.queue);
  assert.equal(bars.bars.reduce((s, b) => s + b.count, 0), c.things);
  for (const b of bars.bars) {
    assert.equal(specAccount(b.locationId, env).count, b.count, `${b.name}: the bar total equals the rows it opens`);
    assert.equal(specAccount(b.locationId, env).rows.length, b.count);
    for (const k of KINDS) {
      const n = b.byKind[k] ?? 0;
      if (n === 0) continue;
      const s = specKind(k, env, b.locationId);
      assert.equal(s.count, n, `${b.name} ${k}: the segment count`);
      assert.equal(s.rows.length, n, `${b.name} ${k}: only the rows of that account and kind`);
      assert.ok(s.rows.every((r) => r.lead?.locationId === b.locationId), `${b.name} ${k}: no row of another account`);
      assert.ok(s.rows.every((r) => r.cells.kind === (k === "replies" ? "Needs a reply" : r.cells.kind)), "only rows of the clicked kind");
    }
  }
  for (const k of KINDS) { assert.equal(specKind(k, env).count, view.totals[k].count); assert.equal(specKind(k, env).rows.length, view.totals[k].count); }
  for (const r of view.queue) { assert.equal(specRow(r, env).count, r.count); assert.equal(specRow(r, env).rows.length, r.count); }
  assert.equal(specThings(env).count, c.things);
  assert.equal(specThings(env).rows.length, c.things);
  assert.ok(!/32/.test(breakdownOf(view.totals) ?? "x"), "the old double count never appears");
});

test("a list never says 'all clients' when the page shows one account, and names exactly what was clicked", () => {
  const { accounts, view } = fixture();
  const one = applyView({ items: view.items.filter((i) => i.locationId === "kd"), totals: { ...view.totals, replies: { count: 24, dollars: null, shown: 24, newLeads: 8 } }, accounts: [accounts[0]], staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  const env: SpecEnv = { now: NOW, view: one, accounts: [accounts[0]], staleDays: 30, targetMinutes: 15, ledger: [], scope: "all", excluded: false };
  const s = specKind("replies", env);
  assert.equal(s.title, "KD Squares LTD, needs a reply");
  assert.doesNotMatch(s.title, /all clients/i);
  assert.equal(s.count, 24);
  assert.equal(s.rows.length, 24);
  const everyone = specKind("replies", fixture().env);
  assert.match(everyone.title, /^All clients, needs a reply$/);
  assert.equal(specKind("replies", fixture().env, "kd").title, "KD Squares LTD, needs a reply");
});

test("the Reply now list is the people, longest wait first, each with one row key that names them", () => {
  const { view } = fixture();
  const people = waitingOldestFirst(view.items);
  assert.equal(people.length, 27);
  for (let i = 1; i < people.length; i++) assert.ok((people[i - 1].at ?? Infinity) <= (people[i].at ?? Infinity));
  const r = personRow(people[0], NOW);
  assert.match(r.key, /^[a-z]+\|replies\|.+$/);
  assert.deepEqual(r.itemIds, [people[0].id]);
  assert.equal(r.count, 1);
  assert.match(replyContext(people.find((p) => p.newLead)!), /^New lead from Facebook$/);
  assert.match(replyContext(people.find((p) => !p.newLead)!), /customer wrote last/);
});

test("100 or 1,000 accounts: the totals are right, the inline cut is 5 rows, and the full list opens with the same count as the headline", () => {
  const N = 150;
  const accounts = Array.from({ length: N }, (_, i) => acct(`acc${i}`, `Client ${String(i).padStart(3, "0")}`));
  const items: TodayItem[] = accounts.flatMap((a, i) => Array.from({ length: (i % 4) + 1 }, (_, j): TodayItem => ({
    id: `replies:${a.id}:${j}`, kind: "replies", locationId: a.id, accountName: a.name, name: `Person ${i}-${j}`, detail: "SMS", at: NOW - (j + 1) * H, value: null, contactId: `p${i}${j}`, url: "u", newLead: j === 0,
  })));
  const totals = emptyTotals();
  totals.replies = { count: items.length, dollars: null, shown: items.length, newLeads: accounts.length };
  const view = applyView({ items, totals, accounts, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  const env: SpecEnv = { now: NOW, view, accounts, staleDays: 30, targetMinutes: 15, ledger: [], scope: "all", excluded: false };
  const needing = accountsNeedingYou(view.queue, new Map(accounts.map((a) => [a.id, a])), 100_000);
  const headline = headlineOf({ scope: "all", rows: view.queue, totals: view.totals });
  assert.equal(INLINE_ROWS, 5, "no list shows more than five rows inline");
  assert.equal(needing.total, N);
  assert.match(headline.text, new RegExp(`across ${N} clients\\.$`));
  const full = specClients(env);
  assert.equal(full.count, N, "the full list opens with the headline's count");
  assert.equal(full.rows.length, N);
  assert.ok(full.cols.some((c) => c.facet && c.key === "state"), "it can be narrowed to the urgent ones");
  // the bars: the top 8 and a "+N more"
  const bars = accountBars(view.queue);
  assert.equal(bars.bars.length, 8);
  assert.equal(bars.accounts - bars.bars.length, N - 8);
  assert.match(barsTitle(bars), /has the most to do: \d+\./);
  // the page itself is paged by the panel: 50 rows a page, so 150 accounts are three pages
  assert.equal(Math.ceil(full.rows.length / 50), 3);
});
