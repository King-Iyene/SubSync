import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountBars, AccountList, KindList, ReplyNowList } from "@/app/app/ds";
import { accountBars, accountsNeedingYou, buildQueue, emptyTotals, INLINE_ROWS, type AccountFacts, type TodayItem } from "@/lib/analytics/today-queue";

// Today's lists at scale and in the compact grid (King, KF-8 and KF-9): no list draws more than five rows inline, however many client accounts or people there are; the total
// and the way to the rest are always on the page; the action is one small fixed column. Rendered on the server to markup (no browser); the browser behaviour is in tests/e2e/today3.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const NOW = Date.parse("2026-11-04T09:00:00Z");
const count = (m: string, needle: string) => m.split(needle).length - 1;

function accounts(n: number): { facts: AccountFacts[]; items: TodayItem[] } {
  const facts = Array.from({ length: n }, (_, i): AccountFacts => ({ id: `acc${i}`, name: `Client ${String(i).padStart(3, "0")}`, followUpEstimate: null, url: `https://crm.example.com/acc${i}` }));
  const items = facts.flatMap((a, i) => Array.from({ length: (i % 3) + 1 }, (_, j): TodayItem => ({
    id: `replies:${a.id}:${j}`, kind: "replies", locationId: a.id, accountName: a.name, name: `Person ${i}-${j}`, detail: "SMS, waiting 3 h", at: NOW - (j + 1) * 3_600_000, value: null, contactId: `p${i}${j}`, url: `https://crm.example.com/${a.id}/p${j}`, newLead: j === 0,
  })));
  return { facts, items };
}
function listOf(n: number) {
  const { facts, items } = accounts(n);
  const totals = emptyTotals();
  totals.replies = { count: items.length, dollars: null, shown: items.length, newLeads: n };
  const queue = buildQueue({ items, totals, accounts: new Map(facts.map((a) => [a.id, a])), staleDays: 30, now: NOW });
  return { queue, needing: accountsNeedingYou(queue, new Map(facts.map((a) => [a.id, a])), 100_000), items };
}
const noop = () => undefined;

describe("the work list for an agency", () => {
  it("150 client accounts: five rows inline, the total in words, and one button to the full list", () => {
    const { needing } = listOf(150);
    const m = html(el(AccountList, { rows: needing.rows, total: needing.total, urgent: needing.rows.filter((a) => a.urgent).length, onShow: noop, onOnly: noop, onSeeAll: noop, empty: "x" }));
    expect(INLINE_ROWS).toBe(5);
    expect(count(m, 'data-testid="queue-row"')).toBe(5);
    expect(m).toMatch(/150 clients need you/);
    expect(m).toContain("See all 150 clients");
    // one small action button per row, in its own column, with the external-link icon because it leaves the app
    expect(count(m, 'data-testid="queue-open"')).toBe(5);
    // 44 px for a thumb on a phone, 32 px on a laptop
    expect(m).toMatch(/h-11[^"]*@3xl:h-8/);
    expect(m).not.toMatch(/min-h-12|px-5 py-3/);
  });
  it("six accounts or fewer: every row shown, no 'See all'", () => {
    const { needing } = listOf(4);
    const m = html(el(AccountList, { rows: needing.rows, total: needing.total, urgent: 0, onShow: noop, onOnly: noop, onSeeAll: noop, empty: "x" }));
    expect(count(m, 'data-testid="queue-row"')).toBe(4);
    expect(m).not.toContain("See all");
  });
  it("the columns have headings that use the same fixed tracks as the rows, so they line up", () => {
    const { needing } = listOf(3);
    const m = html(el(AccountList, { rows: needing.rows, total: 3, urgent: 0, onShow: noop, onOnly: noop, onSeeAll: noop, empty: "x" }));
    const tracks = m.match(/@3xl:grid-cols-\[[^\]]+\]/g) ?? [];
    expect(new Set(tracks).size, "one track definition for the heading and every row").toBe(1);
    expect(m).toContain("At stake");
    expect(m).toContain("Urgency");
  });
});

describe("Reply now, for one account", () => {
  const people = (n: number) => listOf(1).items.concat(Array.from({ length: n }, (_, i): TodayItem => ({ id: `replies:acc0:more${i}`, kind: "replies", locationId: "acc0", accountName: "Client 000", name: `More ${i}`, detail: "Call, waiting 3 h", at: NOW - (i + 5) * 3_600_000, value: null, contactId: `m${i}`, url: "https://crm.example.com/m", newLead: false })));
  it("40 people: five rows, the longest wait first, 'See all 40', one Reply button each", () => {
    const items = people(37);
    const m = html(el(ReplyNowList, { items, total: items.length, newLeads: 1, onSeeAll: noop }));
    expect(count(m, 'data-testid="reply-row"')).toBe(5);
    expect(m).toContain(`See all ${items.length}`);
    expect(count(m, 'data-testid="lead-open"')).toBe(5);
    expect(m).toContain("Reply");
  });
  it("shows nothing at all when nobody is waiting (no empty section)", () => {
    expect(html(el(ReplyNowList, { items: [], total: 0, newLeads: 0, onSeeAll: noop }))).toBe("");
  });
  it("the other kinds are one short row each with a count that opens the kind", () => {
    const m = html(el(KindList, { rows: [{ kind: "stale", count: 4, text: "4 open deals have not moved.", onOpen: noop, action: { label: "Open", href: "https://crm.example.com/x", sr: "Deals" } }] }));
    expect(count(m, 'data-testid="kind-row"')).toBe(1);
    expect(m).toContain('data-count="4"');
    expect(html(el(KindList, { rows: [] }))).toBe("");
  });
});

describe("the stacked bars", () => {
  it("one bar per account, the top 8 and a '+N more' that opens the full list; each segment is its own button with its own count", () => {
    const { queue } = listOf(30);
    const bars = accountBars(queue);
    const m = html(el(AccountBars, { title: "t", bars: bars.bars, rows: queue, more: bars.accounts - bars.bars.length, onSegment: noop, onAccount: noop, onMore: noop }));
    expect(count(m, 'data-testid="account-bar"')).toBe(8);
    expect(m).toContain("+22 more clients, see all");
    expect(count(m, 'data-testid="bar-segment"')).toBe(8); // one kind in this fixture
    for (const b of bars.bars) expect(m).toContain(`data-count="${b.count}"`);
  });
});
