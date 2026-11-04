import assert from "node:assert/strict";
import { test } from "node:test";
import { auditSummaryV2, buildAuditV2, claimPeople, healthyLines, personValue, priceRows, shareSourceOf, type AuditAccount, type V2Input } from "../analytics/audit-v2.ts";
import { clientRows, pageClients, progressOf, readingOf } from "../analytics/audit-clients.ts";
import type { TodayItem, WaitingConversation, WaitingLead } from "../analytics/today-queue.ts";

// The rebuilt Account audit (docs/METRICS.md, "Account audit, rebuilt"): the counting rule (a person or deal is counted once across the findings), the money
// (an estimate only where an account has enough closed deals, never added to a counted figure), the ranking, the paging at 150 accounts and the progress lines.

const NOW = Date.parse("2026-11-05T09:00:00Z");
const H = 3_600_000, D = 86_400_000;
const acct = (id: string, over: Partial<AuditAccount> = {}): AuditAccount => ({ id, name: `Client ${id}`, winRate: 0.25, avgDeal: 4000, won: 10, lost: 30, ...over });
const item = (kind: TodayItem["kind"], loc: string, n: number, over: Partial<TodayItem> = {}): TodayItem => ({
  id: `${kind}:${loc}:${n}`, kind, locationId: loc, accountName: `Client ${loc}`, name: `Person ${n}`, detail: "", at: NOW - 40 * D, value: null, contactId: `c${n}`, url: `https://crm.example.com/${loc}/c${n}`, ...over,
});
const deal = (loc: string, n: number, value: number, over: Partial<TodayItem> = {}) => item("stale", loc, n, { value, ...over });
const lead = (loc: string, n: number): WaitingLead => ({ locationId: loc, accountName: `Client ${loc}`, contactId: `c${n}`, name: `Person ${n}`, at: NOW - 5 * H, never: false, url: "", owner: null, source: null, detail: "Waiting" });
const conv = (loc: string, n: number): WaitingConversation => ({ id: `v${n}`, locationId: loc, accountName: `Client ${loc}`, contactId: `c${n}`, name: `Person ${n}`, at: NOW - 6 * H, url: "", detail: "SMS" });

function input(over: Partial<V2Input> = {}): V2Input {
  return {
    now: NOW, staleDays: 30, slaHours: 4, scope: "all", accounts: [acct("a"), acct("b")],
    stale: { items: [], total: 0, totalValue: 0 },
    waiting: { leads: [], leadsTotal: 0, conversations: [], conversationsTotal: 0 },
    noshows: { items: [], total: 0 }, appointments: { items: [], total: 0 }, ...over,
  };
}
const all = (a: ReturnType<typeof buildAuditV2>) => a.findings.flatMap((f) => (f.key === "leftovers" ? [] : f.items));

test("the counting rule: a person is in ONE finding. Deals claim first, then replies, then no-shows, then appointments", () => {
  // Person 1 has a quiet deal AND is waiting AND has a no-show AND an unmarked appointment: only the deal lists them.
  // Person 2 is waiting and has a no-show and an unmarked appointment: only "waiting". Person 3: no-show and unmarked: only the no-show. Person 4: unmarked only.
  const c = claimPeople({
    stale: [deal("a", 1, 5000)],
    replies: [item("replies", "a", 1), item("replies", "a", 2)],
    noshows: [item("noshows", "a", 1), item("noshows", "a", 2), item("noshows", "a", 3)],
    appointments: [item("appointments", "a", 1), item("appointments", "a", 2), item("appointments", "a", 3), item("appointments", "a", 4)],
  });
  assert.deepEqual(c.replies.map((r) => r.contactId), ["c2"]);
  assert.deepEqual(c.noshows.map((r) => r.contactId), ["c3"]);
  assert.deepEqual(c.appointments.map((r) => r.contactId), ["c4"]);
  assert.deepEqual(c.removed, { replies: 1, noshows: 2, appointments: 3 });
  const keys = [...c.stale, ...c.replies, ...c.noshows, ...c.appointments].map((r) => `${r.locationId}|${r.contactId}`);
  assert.equal(new Set(keys).size, keys.length, "nobody appears twice");
});

test("the same contact id in two different client accounts is two different people; a row with no contact is never claimed", () => {
  const c = claimPeople({
    stale: [deal("a", 1, 100), item("stale", "a", 9, { contactId: null, value: 50 })],
    replies: [item("replies", "b", 1), item("replies", "a", 1), item("replies", "a", 9, { contactId: null })], noshows: [], appointments: [],
  });
  assert.deepEqual(c.replies.map((r) => r.id), ["replies:b:1", "replies:a:9"]);
});

test("across the whole audit no person appears in two findings, and the counts equal the rows", () => {
  const a = buildAuditV2(input({
    stale: { items: [deal("a", 1, 9000), deal("a", 2, 3000), deal("b", 3, 1000)], total: 3, totalValue: 13_000 },
    waiting: { leads: [lead("a", 1), lead("a", 5), lead("b", 6)], leadsTotal: 3, conversations: [conv("a", 1), conv("a", 7), conv("b", 3)], conversationsTotal: 3 },
    noshows: { items: [item("noshows", "a", 5), item("noshows", "a", 8)], total: 2 },
    appointments: { items: [item("appointments", "a", 8), item("appointments", "b", 9)], total: 2 },
  }));
  const keys = all(a).map((r) => `${r.locationId}|${r.contactId}`);
  assert.equal(new Set(keys).size, keys.length, "a person or a deal is in one finding only");
  for (const f of a.findings) assert.equal(f.count, f.items.length, `${f.key}: the button's count is the number of rows it opens`);
  const stale = a.findings.find((f) => f.key === "stale")!;
  assert.equal(stale.count, 3);
  // people: a1 (deal), a5, b6, a7 and b3 (deal): waiting are a5, b6, a7 = 3 people; no-shows a5 (waiting) is gone, a8 stays = 1; appointment a8 (no-show) gone, b9 stays = 1.
  assert.deepEqual(a.findings.find((f) => f.key === "replies")!.items.map((r) => r.contactId).sort(), ["c5", "c6", "c7"]);
  assert.equal(a.findings.find((f) => f.key === "noshows")!.count, 1);
  assert.equal(a.findings.find((f) => f.key === "appointments")!.count, 1);
  assert.equal(a.totals.things, 3 + 3 + 1 + 1);
});

test("a new lead who is also an unanswered conversation is one person, and the aside says so without adding", () => {
  const a = buildAuditV2(input({ waiting: { leads: [lead("a", 1), lead("a", 2)], leadsTotal: 2, conversations: [conv("a", 1), conv("a", 2), conv("a", 3)], conversationsTotal: 3 } }));
  const f = a.findings.find((x) => x.key === "replies")!;
  assert.equal(f.count, 3);
  assert.match(f.aside ?? "", /^2 of them are new leads/);
  assert.match(f.title, /^3 people are waiting for a reply/);
});

test("money: the estimate is people x average deal x win rate, only for accounts with a win rate, with a range; the deal figure is counted and separate", () => {
  const a = buildAuditV2(input({
    accounts: [acct("a", { winRate: 0.25, avgDeal: 4000 }), acct("b", { winRate: null, avgDeal: null, won: 2, lost: 3 })],
    stale: { items: [deal("a", 1, 12_000)], total: 1, totalValue: 12_000 },
    waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 2), conv("a", 3), conv("b", 4)], conversationsTotal: 3 },
    noshows: { items: [item("noshows", "a", 5)], total: 1 },
  }));
  assert.equal(personValue({ winRate: 0.25, avgDeal: 4000 }), 1000);
  // a: 2 waiting + 1 no-show = 3 people x $1,000 = $3,000. b cannot be priced: its 1 person is left out, not guessed.
  assert.equal(a.verdict.kind, "leak");
  assert.equal(a.verdict.leak, 3000);
  assert.equal(a.verdict.unpriced, 1);
  assert.equal(a.verdict.sitting, 12_000, "counted deal money is its own figure");
  assert.ok(a.verdict.range && a.verdict.range.low < 3000 && a.verdict.range.high > 3000);
  assert.match(a.verdict.text, /^Your client accounts are leaking about \$3,000 a month\.$/);
  assert.match(a.verdict.sub, /^Estimate from the last 30 days/);
  assert.equal(a.findings.find((f) => f.key === "stale")!.dollarKind, "fact");
  assert.equal(a.findings.find((f) => f.key === "replies")!.dollarKind, "estimate");
  assert.equal(a.findings.find((f) => f.key === "replies")!.dollars! + a.findings.find((f) => f.key === "noshows")!.dollars!, 3000, "the estimate is the sum of its findings, and never includes the deal money");
});

test("no account with enough closed deals: no dollar figure is invented, the sentence counts things instead", () => {
  const a = buildAuditV2(input({
    accounts: [acct("a", { winRate: null, avgDeal: null, won: 3, lost: 4 })], scope: "account",
    waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 1), conv("a", 2)], conversationsTotal: 2 },
  }));
  assert.equal(a.verdict.kind, "count");
  assert.equal(a.verdict.leak, null);
  assert.equal(a.verdict.text, "We found 2 things to fix.");
  assert.match(a.verdict.sub, /under 20 won or lost deals/);
  assert.equal(a.findings[0].dollars, null);
  assert.equal(a.findings[0].dollarKind, "none");
});

test("one account scope says 'Your account'; nothing wrong gives a clear verdict and four clean checks", () => {
  const a = buildAuditV2(input({ scope: "account", accounts: [acct("a")] }));
  assert.equal(a.verdict.kind, "clear");
  assert.equal(a.verdict.text, "Nothing needs fixing in your account.");
  assert.deepEqual(a.grade, { clean: 4, checked: 4, line: "4 of 4 checks are clean. A check is clean when SubSync finds nothing to fix in it." });
  assert.equal(a.startHere, null);
  const money = buildAuditV2(input({ scope: "account", accounts: [acct("a")], waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 1)], conversationsTotal: 1 } }));
  assert.match(money.verdict.text, /^Your account is leaking about \$1,000 a month\.$/);
  assert.equal(money.grade?.clean, 3);
});

test("a calendar that cannot be read is not counted clean: the grade checks only what was read, and the page says so", () => {
  const a = buildAuditV2(input({ scope: "account", accounts: [acct("a")], noshows: null, appointments: null }));
  assert.equal(a.grade?.checked, 2);
  assert.ok(a.notes.some((n) => /calendar permission/.test(n)));
  assert.equal(buildAuditV2(input({ accounts: [acct("a")], scope: "all" })).grade, null, "an agency has no single grade");
});

test("ranking: money first (counted or estimated), then how easy it is, then how many; leftovers never lead", () => {
  const a = buildAuditV2(input({
    stale: { items: [deal("a", 1, 30_000)], total: 1, totalValue: 30_000 },
    waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 2), conv("a", 3)], conversationsTotal: 2 },
    noshows: { items: [item("noshows", "a", 5)], total: 1 },
    appointments: { items: [item("appointments", "a", 6), item("appointments", "a", 7), item("appointments", "a", 8)], total: 3 },
  }));
  assert.deepEqual(a.findings.map((f) => f.key), ["stale", "replies", "noshows", "appointments"]);
  assert.equal(a.startHere, "stale");
  // Without money the easy fixes come first, the bigger count first among equals.
  const b = buildAuditV2(input({ accounts: [acct("a", { winRate: null, avgDeal: null })], noshows: { items: [item("noshows", "a", 5)], total: 1 }, appointments: { items: [item("appointments", "a", 6), item("appointments", "a", 7)], total: 2 } }));
  assert.deepEqual(b.findings.map((f) => f.key), ["appointments", "noshows"]);
});

test("very old and test deals are their own finding, left out of the counted money, and never claim a person", () => {
  const old = deal("a", 1, 500_000, { at: NOW - 200 * D });
  const test_ = deal("a", 2, 800, { name: "Test deal" });
  const real = deal("a", 3, 7000);
  const a = buildAuditV2(input({
    stale: { items: [old, test_, real], total: 3, totalValue: 507_800 },
    waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 1)], conversationsTotal: 1 },
  }));
  assert.equal(a.findings.find((f) => f.key === "stale")!.dollars, 7000);
  assert.equal(a.verdict.sitting, 7000);
  assert.equal(a.findings.find((f) => f.key === "leftovers")!.count, 2);
  assert.equal(a.findings.find((f) => f.key === "replies")!.count, 1, "the person whose deal is a leftover is still waiting for a reply");
  assert.equal(a.totals.deals, 1);
  assert.equal(a.findings[a.findings.length - 1].key, "leftovers");
  assert.notEqual(a.startHere, "leftovers");
});

test("a list that was cut keeps its true total and says so", () => {
  const items = Array.from({ length: 3 }, (_, n) => deal("a", n, 1000));
  const a = buildAuditV2(input({ stale: { items, total: 10, totalValue: 10_000 } }));
  const f = a.findings.find((x) => x.key === "stale")!;
  assert.equal(f.count, 10);
  assert.equal(f.items.length, 3);
  assert.equal(f.partial, true);
  assert.equal(f.dollars, 10_000);
  assert.ok(a.notes.some((n) => /biggest deals/.test(n)));
});

test("priceRows: accounts under the minimum are counted as unpriced", () => {
  const p = priceRows([{ locationId: "a" }, { locationId: "a" }, { locationId: "b" }], [acct("a"), acct("b", { winRate: null, avgDeal: 5000 })]);
  assert.equal(p.dollars, 2000);
  assert.equal(p.priced, 2);
  assert.equal(p.unpriced, 1);
  assert.equal(priceRows([{ locationId: "z" }], [acct("a")]).dollars, null);
});

test("good news: only what is measured on enough cases, at most four lines", () => {
  const lines = healthyLines({
    scope: "account", leadsInTarget: { share: 0.86, judged: 22, minutes: 15 }, showRate: { rate: 0.72, outcomes: 30, target: 0.7 }, openValue: 100_000, staleValue: 10_000,
    clean: { replies: true, stale: false, noshows: true, appointments: true },
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Nobody is waiting for a reply\.$/);
  const few = healthyLines({ scope: "account", leadsInTarget: { share: null, judged: 3, minutes: 15 }, showRate: { rate: null, outcomes: 2, target: 0.7 }, openValue: 0, staleValue: 0, clean: { replies: false, stale: false, noshows: null, appointments: null } });
  assert.deepEqual(few, [], "under the minimum nothing is claimed");
  const weak = healthyLines({ scope: "account", leadsInTarget: { share: 0.5, judged: 40, minutes: 15 }, showRate: { rate: 0.4, outcomes: 40, target: 0.7 }, openValue: 100, staleValue: 90, clean: { replies: false, stale: false, noshows: false, appointments: false } });
  assert.deepEqual(weak, []);
});

// ---------- the client list at scale ----------

function bigFixture(n: number) {
  const accounts = Array.from({ length: n }, (_, i) => acct(`k${i}`, { name: `Client ${String(i).padStart(3, "0")}` }));
  const stale: TodayItem[] = [], conversations: WaitingConversation[] = [];
  accounts.forEach((a, i) => {
    for (let d = 0; d < (i % 4); d++) stale.push(deal(a.id, 1000 + d, 1000 * (i + 1)));
    for (let p = 0; p < (i % 3); p++) conversations.push(conv(a.id, 2000 + p));
  });
  const a = buildAuditV2(input({ accounts, stale: { items: stale, total: stale.length, totalValue: stale.reduce((s, x) => s + (x.value ?? 0), 0) }, waiting: { leads: [], leadsTotal: 0, conversations, conversationsTotal: conversations.length } }));
  return { accounts, a };
}

test("150 accounts: every client's numbers add up to the totals, ranked by money, paged, searchable", () => {
  const { accounts, a } = bigFixture(150);
  const rows = clientRows(a, accounts);
  assert.equal(rows.reduce((s, r) => s + r.stale, 0), a.findings.find((f) => f.key === "stale")!.count);
  assert.equal(rows.reduce((s, r) => s + r.replies, 0), a.findings.find((f) => f.key === "replies")!.count);
  assert.equal(rows.reduce((s, r) => s + r.things, 0), a.totals.things);
  assert.equal(rows.length, a.totals.accountsWithProblems);
  const top = pageClients(rows, { size: 5 });
  assert.equal(top.rows.length, 5);
  assert.equal(top.total, rows.length);
  assert.ok(top.rows[0].rank >= top.rows[1].rank && top.rows[1].rank >= top.rows[4].rank, "most money first");
  const seen = new Set<string>();
  for (let p = 0; p < top.pages; p++) for (const r of pageClients(rows, { size: 25, page: p }).rows) seen.add(r.id);
  assert.equal(seen.size, rows.length, "every client is on exactly one page");
  assert.equal(pageClients(rows, { q: "client 14", size: 50 }).rows.every((r) => /client 14/i.test(r.name)), true);
  assert.equal(pageClients(rows, { page: 999, size: 10 }).page, top.pages === 1 ? 0 : pageClients(rows, { page: 999, size: 10 }).pages - 1, "a page past the end is the last page");
  assert.equal(pageClients(rows, { size: 5000 }).rows.length, 50, "the page size is capped");
  const byName = pageClients(rows, { sort: "name", size: 50 }).rows.map((r) => r.name);
  assert.deepEqual(byName, [...byName].sort((x, y) => x.localeCompare(y)));
});

test("a clean client is not listed, and the number of clean clients is accounts minus listed", () => {
  const { accounts, a } = bigFixture(12);
  const rows = clientRows(a, accounts);
  assert.equal(rows.some((r) => r.things === 0), false);
  assert.equal(accounts.length - rows.length, 12 - a.totals.accountsWithProblems);
});

// ---------- progress and first run ----------

test("progress: deals gone quiet compare the daily check with its oldest reading 7 or more days earlier; under that, 'not enough history'", () => {
  const pts = (a: number, b: number) => [{ day: "2026-10-20", stale: a, ok: true }, { day: "2026-11-05", stale: b, ok: true }];
  const p = progressOf({ series: [{ id: "a", points: pts(10, 6) }, { id: "b", points: pts(5, 3) }], replies: [], targetMinutes: 15, now: NOW });
  assert.equal(p[0].verdict, "better");
  assert.match(p[0].text, /^15 on 20 Oct, 9 now/);
  const short = progressOf({ series: [{ id: "a", points: [{ day: "2026-11-02", stale: 4, ok: true }, { day: "2026-11-05", stale: 4, ok: true }] }], replies: [], targetMinutes: 15, now: NOW });
  assert.equal(short[0].verdict, "not_enough");
  const untrusted = progressOf({ series: [{ id: "a", points: [{ day: "2026-10-20", stale: 4, ok: false }, { day: "2026-11-05", stale: 9, ok: false }] }], replies: [], targetMinutes: 15, now: NOW });
  assert.equal(untrusted[0].verdict, "not_enough", "readings the daily check does not trust are never compared");
});

test("progress: leads answered inside the target, this week against the week before, each needs 5 judged leads", () => {
  const rows = (start: number, n: number, ok: number) => Array.from({ length: n }, (_, i) => ({ leadAt: start - i * H * 5, touchAt: i < ok ? start - i * H * 5 + 5 * 60_000 : null }));
  const thisWeek = rows(NOW - 2 * H, 8, 7), lastWeek = rows(NOW - 8 * D, 8, 3);
  const p = progressOf({ series: [], replies: [...thisWeek, ...lastWeek], targetMinutes: 15, now: NOW });
  const speed = p.find((x) => x.key === "speed")!;
  assert.equal(speed.verdict, "better");
  assert.match(speed.text, /^88% this week \(8 leads\), 38% the week before \(8 leads\)\.$/);
  assert.equal(progressOf({ series: [], replies: thisWeek.slice(0, 3), targetMinutes: 15, now: NOW }).find((x) => x.key === "speed")!.verdict, "not_enough");
});

test("first run: 'Reading your client accounts: 5 of 12 done' while the first read runs, and nothing once every account has finished", () => {
  const accts = (first: number, total: number) => Array.from({ length: total }, (_, i) => ({ state: i < first ? "first" : "ok" }));
  const r = readingOf({ state: "first_sync", accounts: accts(7, 12) });
  assert.equal(r.reading, true);
  assert.equal(r.done, 5);
  assert.match(r.text, /^Reading your client accounts: 5 of 12 done\./);
  assert.equal(readingOf({ state: "fresh", accounts: accts(0, 12) }).reading, false);
  assert.equal(readingOf({ state: "first_sync", accounts: accts(0, 12) }).reading, false);
  assert.match(readingOf({ state: "never", accounts: accts(3, 3) }).text, /has not read your client accounts yet/);
  assert.match(readingOf({ state: "first_sync", accounts: accts(1, 1) }).text, /Reading your account: 0 of 1 done/);
});

test("one deal that is most of the counted money is said out loud, with at least 3 deals; two deals are not called a pattern or an outlier", () => {
  const big = buildAuditV2(input({ stale: { items: [deal("a", 1, 1_000_000), deal("a", 2, 20_000), deal("a", 3, 30_000)], total: 3, totalValue: 1_050_000 } }));
  assert.deepEqual(big.verdict.outlier, { value: 1_000_000, share: 0.95 });
  const two = buildAuditV2(input({ stale: { items: [deal("a", 1, 1_000_000), deal("a", 2, 20_000)], total: 2, totalValue: 1_020_000 } }));
  assert.equal(two.verdict.outlier, null);
  const even = buildAuditV2(input({ stale: { items: [deal("a", 1, 10_000), deal("a", 2, 12_000), deal("a", 3, 11_000)], total: 3, totalValue: 33_000 } }));
  assert.equal(even.verdict.outlier, null);
});

test("people in accounts that cannot be priced are said to be counted but not priced, and a partly read calendar set is named", () => {
  const a = buildAuditV2(input({
    accounts: [acct("a"), acct("b", { winRate: null, avgDeal: null })],
    waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 1), conv("b", 2), conv("b", 3)], conversationsTotal: 3 },
    calendars: { needPermission: 1, total: 2 },
  }));
  assert.match(a.verdict.sub, /2 people are in accounts with under 20 won or lost deals, so they are counted but not priced\.$/);
  assert.ok(a.notes.some((n) => /^1 client account of 2 still needs the calendar permission/.test(n)));
});

test("the share summary and the shared source carry the sentence, the estimate and the formula, never a person or a deal", () => {
  const a = buildAuditV2(input({
    stale: { items: [deal("a", 1, 5000, { name: "Ada Lovelace" })], total: 1, totalValue: 5000 },
    waiting: { leads: [], leadsTotal: 0, conversations: [conv("a", 2)], conversationsTotal: 1 },
  }));
  const src = shareSourceOf(a, ["Nobody is waiting."], 2);
  assert.equal(src.headline, a.verdict.text);
  assert.equal(src.estimatedDollars, 1000);
  assert.equal(src.staleDollars, 5000);
  assert.ok(src.notes?.some((n) => n.key === "estimate" && /not money already lost/.test(n.text)));
  const text = JSON.stringify(src) + auditSummaryV2(a, "Acme", ["Nobody is waiting."]);
  assert.doesNotMatch(text, /Ada Lovelace|Person 2|c1|crm\.example\.com/);
  assert.match(auditSummaryV2(a, "Acme"), /\(estimate: \$1,000\)/);
  assert.match(auditSummaryV2(a, "Acme"), /\(counted: \$5,000\)/);
});
