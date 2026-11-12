import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { biggestOf, changeOf, coversPrevious, expectedOf, historyShort, totalAtRisk, usdText, whyNoRisk } from "../analytics/today3-money-core.ts";
import { tileRead, type PmSourceLite } from "../analytics/pm-tile-read.ts";
import { TD3_LIST_ONLY, TD3_PARTS } from "../analytics/today3-types.ts";

const C = (deals: number, dollars: number | null) => ({ deals, dollars });

test("formatting: whole dollars with thousands separators", () => {
  assert.equal(usdText(0), "$0");
  assert.equal(usdText(41000), "$41,000");
  assert.equal(usdText(1234.6), "$1,235");
});

test("money at risk: the causes add up to the total, and each deal is counted once (the count equals the rows the list opens)", () => {
  const by = { stale: C(11, 41000), waiting: C(6, 18400), noshow: C(2, 5200) };
  const t = totalAtRisk(by);
  assert.equal(t.deals, 19);
  assert.equal(t.dollars, 64600);
});

test("money at risk: no priced cause is unknown (null), never a zero that means nothing", () => {
  assert.equal(totalAtRisk({ stale: C(0, null), waiting: C(0, null), noshow: C(0, null) }).dollars, null);
  assert.equal(totalAtRisk({ stale: C(3, null), waiting: C(0, null), noshow: C(0, null) }).dollars, null);
  assert.equal(totalAtRisk({ stale: C(3, 900), waiting: C(0, null), noshow: C(0, null) }).dollars, 900);
});

test("empty state: with no open deal that has a value the reason says what unlocks it", () => {
  assert.match(whyNoRisk(0, 0) ?? "", /Not enough data yet.*deal values/);
  assert.equal(whyNoRisk(3, 3), null);
});

test("biggest action: the cause with the most dollars, one button, opens exactly that cause's rows", () => {
  const b = biggestOf({ stale: C(11, 41000), waiting: C(6, 18400), noshow: C(2, 5200) });
  assert.equal(b?.cause, "stale");
  assert.equal(b?.list, "risk_stale");
  assert.equal(b?.deals, 11);
  assert.equal(b?.dollars, 41000);
  const w = biggestOf({ stale: C(1, 500), waiting: C(6, 18400), noshow: C(0, null) });
  assert.equal(w?.cause, "waiting");
  assert.equal(w?.list, "risk_waiting");
  assert.match(w?.label ?? "", /6 people/);
});

test("biggest action: nothing priced means no action is invented", () => {
  assert.equal(biggestOf({ stale: C(0, null), waiting: C(0, null), noshow: C(0, null) }), null);
  assert.equal(biggestOf({ stale: C(4, null), waiting: C(0, null), noshow: C(0, null) }), null);
});

test("biggest action: singular wording and a tie goes to the larger count", () => {
  assert.match(biggestOf({ stale: C(1, 700), waiting: C(0, null), noshow: C(0, null) })?.label ?? "", /the quiet deal/);
  assert.equal(biggestOf({ stale: C(2, 1000), waiting: C(5, 1000), noshow: C(0, null) })?.cause, "waiting");
});

test("expected pipeline: only accounts with at least 20 won or lost deals are priced, at their own win rate", () => {
  const e = expectedOf([{ loc: "a", dollars: 10000 }, { loc: "b", dollars: 5000 }], [{ loc: "a", won: 10, lost: 10 }, { loc: "b", won: 3, lost: 4 }]);
  assert.equal(e.expected, 5000);
  assert.equal(e.priced, 1);
  assert.equal(e.accounts, 2);
});

test("expected pipeline: with no account over the minimum there is no figure", () => {
  const e = expectedOf([{ loc: "a", dollars: 10000 }], [{ loc: "a", won: 5, lost: 5 }]);
  assert.equal(e.expected, null);
  assert.equal(e.priced, 0);
});

test("change against the period before: only when both periods exist, never against zero", () => {
  assert.deepEqual(changeOf(9800, 7600), { text: "+29%", up: true });
  assert.deepEqual(changeOf(5000, 10000), { text: "-50%", up: false });
  assert.equal(changeOf(9800, null), null);
  assert.equal(changeOf(null, 100), null);
  assert.equal(changeOf(100, 0), null);
});

test("history: a short record says history starts; the earlier period is only compared when the record covers it", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(historyShort(null, now), true);
  assert.equal(historyShort("2026-11-10", now), true);
  assert.equal(historyShort("2026-10-01", now), false);
  assert.equal(coversPrevious("2026-11-01", now), false);
  assert.equal(coversPrevious("2026-09-01", now), true);
  assert.equal(coversPrevious(null, now), false);
});

const src = (key: string, state: PmSourceLite["state"], message: string | null = null): PmSourceLite => ({ key, state, message });

test("client payments tiles: no permission shows a dash and why, never a zero", () => {
  const blind = [src("plans", "needs_permission", "Needs permission: reconnect"), src("transactions", "needs_permission", "Needs permission: reconnect"), src("subscriptions", "needs_permission", "Needs permission: reconnect"), src("invoices", "not_available", "Not available from the platform yet")];
  for (const k of ["failed", "late", "past_due_plans", "refunds"] as const) assert.equal(tileRead(k, blind).readable, false, k);
  assert.equal(tileRead("late", blind).note, "Not available from the platform yet");
  assert.equal(tileRead("failed", blind).note, "Needs permission: reconnect");
});

test("client payments tiles: disputes are entered by the owner so they are always readable; a read source makes its tiles readable", () => {
  const blind = [src("transactions", "needs_permission"), src("invoices", "needs_permission")];
  assert.equal(tileRead("disputes", blind).readable, true);
  const some = [src("transactions", "ok"), src("subscriptions", "needs_permission"), src("invoices", "needs_permission")];
  assert.equal(tileRead("failed", some).readable, true);
  assert.equal(tileRead("refunds", some).readable, true);
  assert.equal(tileRead("late", some).readable, false);
});

test("client payments tiles: with nothing known about the sources yet nothing is hidden", () => {
  assert.equal(tileRead("failed", []).readable, true);
});

test("the money row is wired: the part exists, and every list kind it opens is a known list kind the route accepts", () => {
  assert.ok((TD3_PARTS as readonly string[]).includes("money"));
  for (const k of ["risk_all", "risk_stale", "risk_waiting", "risk_noshow", "recovered_won"]) assert.ok((TD3_LIST_ONLY as readonly string[]).includes(k), k);
  const route = readFileSync(new URL("../api/today3-routes.ts", import.meta.url), "utf8");
  assert.match(route, /case "money": return done\(await moneyHero\(scope, one, now\)\)/);
  assert.match(route, /isMoneyList\(kind\)/);
});

test("the money queries start from the caller's own accounts and never from a request id", () => {
  const q = readFileSync(new URL("../analytics/today3-money.ts", import.meta.url), "utf8");
  assert.match(q, /const \{ cores \} = await board\(s, one, now\)/);
  assert.match(q, /s\.level === "self"\) return/);
  assert.equal((q.match(/installation_id = \$\{(s\.inst|inst)\}/g) ?? []).length >= 5, true);
  assert.doesNotMatch(q, /request|searchParams/);
});
