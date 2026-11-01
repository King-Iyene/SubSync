import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionItems, compare, digestText, dueNow, localParts, portfolioHeadlines, rank, type AccountInput, type SeriesPoint } from "../analytics/digest-intel.ts";

const point = (day: number, o: Partial<SeriesPoint> = {}): SeriesPoint => ({
  day: `2026-10-${String(day).padStart(2, "0")}`, contacts: 100, new30: 40, openOpps: 20, openValue: 50_000, stale: 2, unread: 1, completeness: 80, score: 70, ...o,
});
const week = (o: Partial<SeriesPoint> = {}, last: Partial<SeriesPoint> = {}) => [...[1, 2, 3, 4, 5, 6, 7].map((d) => point(d, o)), point(8, { ...o, ...last })];

const base = (o: Partial<AccountInput> = {}): AccountInput => ({
  locationId: "L1", name: "Acme Roofing", series: week(), unanswered: 0, oldestWaitingHours: null, slaHours: 4, staleCount: 2, staleValue: 4000,
  dormant: false, daysInactive: 1, emailStatus: "ok", syncError: null, lastSyncedAt: new Date().toISOString(), pipelines: 2, ...o,
});

test("a change is judged against the account's own recent range, not a fixed number", () => {
  const steady = compare([40, 41, 39, 40, 42, 40, 41], 40);
  assert.equal(steady.unusual, null);
  assert.equal(steady.vsYesterday, -2);
  const dropped = compare([40, 41, 39, 40, 42, 40, 41], 20);
  assert.equal(dropped.unusual, "down");
  // The same drop in a naturally noisy account is not unusual.
  assert.equal(compare([10, 70, 15, 60, 20, 65, 12], 30).unusual, null);
  // Not enough history yet: no verdict.
  assert.equal(compare([40, 40], 5).unusual, null);
  // Tiny numbers are not news.
  assert.equal(compare([1, 1, 1, 1, 1], 3).unusual, null);
});

test("an account within its normal range is fine and says what was checked", () => {
  const { attention, fine } = rank([base()]);
  assert.equal(attention.length, 0);
  assert.equal(fine.length, 1);
  assert.ok(fine[0].checked.includes("reply times"));
  assert.equal(fine[0].learning, false);
});

test("an account with too little history is marked as still learning", () => {
  assert.equal(rank([base({ series: week().slice(-3) })]).fine[0].learning, true);
});

test("unanswered conversations rank by how many and how old", () => {
  const few = attentionItems(base({ unanswered: 1, oldestWaitingHours: 6 })).find((i) => i.kind === "sla")!;
  const many = attentionItems(base({ unanswered: 12, oldestWaitingHours: 300 })).find((i) => i.kind === "sla")!;
  assert.ok(many.weight > few.weight);
  assert.match(many.detail, /13 days/);
  assert.match(few.title, /1 conversation waiting past your 4h/);
});

test("a sudden jump in stale deals and a drop in new leads are caught against the account's own normal", () => {
  const jump = attentionItems(base({ series: week({}, { stale: 15 }), staleCount: 15, staleValue: 90_000 }));
  assert.ok(jump.some((i) => i.kind === "stale_jump"));
  const drop = attentionItems(base({ series: week({}, { new30: 10 }) }));
  assert.ok(drop.some((i) => i.kind === "lead_drop"));
  const quietButNormal = attentionItems(base({ series: week({ new30: 5 }, { new30: 5 }) }));
  assert.ok(!quietButNormal.some((i) => i.kind === "lead_drop"));
});

test("sync trouble outranks business signals because the other numbers cannot be trusted", () => {
  const { attention } = rank([base({ unanswered: 2, oldestWaitingHours: 10 }), base({ locationId: "L2", name: "Broken Co", syncError: "401 Unauthorized" })]);
  assert.equal(attention[0].name, "Broken Co");
  assert.equal(attention[0].severity, "critical");
  assert.equal(rank([base({ lastSyncedAt: new Date(Date.now() - 40 * 3_600_000).toISOString() })]).attention[0].items[0].kind, "sync");
});

test("failing email setup and dormancy are surfaced with severity", () => {
  const { attention } = rank([base({ emailStatus: "critical", dormant: true, daysInactive: 61 })]);
  assert.equal(attention[0].severity, "critical");
  assert.ok(attention[0].items.some((i) => i.kind === "email"));
  assert.ok(attention[0].items.some((i) => i.kind === "dormant"));
});

test("no-shows and unconfirmed appointments become attention items only when they are meaningful", () => {
  assert.ok(attentionItems(base({ noShows3d: 3 })).some((i) => i.kind === "noshow"));
  assert.ok(!attentionItems(base({ noShows3d: 1 })).some((i) => i.kind === "noshow"));
  assert.ok(attentionItems(base({ unconfirmed48: 4 })).some((i) => i.kind === "unconfirmed"));
  assert.ok(!attentionItems(base({ unconfirmed48: 2 })).some((i) => i.kind === "unconfirmed"));
});

test("portfolio headlines add the accounts together day by day", () => {
  const a = week({ openValue: 100 }, { openValue: 200 });
  const b = week({ openValue: 50 }, { openValue: 50 });
  const h = portfolioHeadlines([a, b]).find((x) => x.key === "openValue")!;
  assert.equal(h.change.today, 250);
  assert.equal(h.change.yesterday, 150);
  assert.equal(h.change.vsYesterday, 67);
});

// The old vague "Data is under an hour old" helper was removed in stage S0.4: the one freshness rule is src/lib/sync/freshness.ts, tested in freshness.test.ts.

test("the Slack text names the accounts, what is wrong, and says when all is fine", () => {
  const { attention, fine } = rank([base({ unanswered: 3, oldestWaitingHours: 30 }), base({ locationId: "L2", name: "Calm Co" })]);
  const text = digestText("Acme Agency", { attention, fine: fine.length, headlines: portfolioHeadlines([week()]), freshnessLabel: "Data is 1 hour old" }, "https://x.test");
  assert.match(text, /1 account needs attention/);
  assert.match(text, /Acme Roofing/);
  assert.match(text, /1 account fine/);
  const calm = digestText("Acme Agency", { attention: [], fine: 2, headlines: [], freshnessLabel: "Data is 1 hour old" }, "https://x.test");
  assert.match(calm, /Nothing needs attention today/);
});

test("the digest goes out once a day, at the chosen local hour, in the chosen time zone", () => {
  const utc = new Date("2026-10-30T07:30:00Z"); // 08:30 in Lagos (UTC+1), 03:30 in New York (UTC-4)
  assert.deepEqual(localParts(utc, "Africa/Lagos"), { hour: 8, date: "2026-10-30" });
  assert.equal(dueNow(utc, "Africa/Lagos", 8, null), true);
  assert.equal(dueNow(utc, "America/New_York", 8, null), false);
  assert.equal(dueNow(utc, "Africa/Lagos", 8, "2026-10-30"), false, "already sent today");
  assert.equal(dueNow(utc, "Africa/Lagos", 8, "2026-10-29"), true);
  assert.equal(dueNow(utc, "Not/AZone", 8, null), false, "an invalid zone never sends");
  assert.equal(dueNow(new Date("2026-10-30T09:50:00Z"), "Africa/Lagos", 8, null), true, "a late run still sends the same day");
});
