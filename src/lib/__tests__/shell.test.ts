import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBrand, brandDisplayName, showProductMark, NO_BRAND } from "../brand-resolve.ts";
import { barMode, pageRangeFromHash, recentFirst, withPageRange, accountButtonText } from "../design/global-filter.ts";
import { buildHash, parseHash } from "../design/route.ts";
import { EMPTY_FILTER } from "../design/filters.ts";
import { NAV } from "../../app/app/nav.ts";

test("logo rule: a company with no brand settings shows SubSync only", () => {
  for (const s of [null, undefined, {}, { brandName: " ", brandLogoUrl: "http://x.com/a.png" }]) {
    const b = resolveBrand(s);
    assert.deepEqual(b, NO_BRAND);
    assert.equal(brandDisplayName(b), "SubSync");
    assert.equal(showProductMark(b), true);
  }
});
test("logo rule: a white-label company shows only its own brand", () => {
  const a = resolveBrand({ brandName: "Acme", brandLogoUrl: "https://acme.example/logo.png", brandColor: "#112233" });
  const b = resolveBrand({ brandName: "Other" });
  assert.equal(brandDisplayName(a), "Acme");
  assert.equal(a.logoUrl, "https://acme.example/logo.png");
  assert.equal(showProductMark(a), false);
  assert.equal(b.logoUrl, null);
  assert.equal(brandDisplayName(b), "Other");
  assert.ok(!JSON.stringify(b).includes("acme"));
});
test("the date range lives in the address and a round trip keeps it; a card's own range is dropped when the bar changes", () => {
  const h = withPageRange("#speed?hideTest=1&r.speed-trend=7d.prev", { preset: "custom", from: "2026-10-01", to: "2026-10-30", compare: "previous" });
  assert.equal(h, "#speed?hideTest=1&r.page=custom:2026-10-01~2026-10-30");
  assert.deepEqual(pageRangeFromHash(h), { preset: "custom", from: "2026-10-01", to: "2026-10-30", compare: "none" });
  const s = parseHash(h, NAV.map((n) => n.id));
  assert.equal(s.view.id, "speed");
  assert.equal(s.filter.hideTest, true);
  assert.equal(buildHash(s.view, s.filter, "r.page=30d").includes("r.page=30d"), true);
  assert.equal(withPageRange(h, null), "#speed?hideTest=1");
});
test("the bar's modes and account helpers", () => {
  assert.equal(barMode("speed"), "range");
  assert.equal(barMode("inbox"), "now");
  assert.equal(barMode("settings"), "none");
  assert.equal(barMode("meetings"), "none", "Meeting notes does not use the bar's dates, so it does not draw a date control that does nothing");
  assert.equal(accountButtonText(0, 13), "All 13 client accounts");
  assert.equal(accountButtonText(3, 13), "3 of 13 client accounts");
  assert.deepEqual(recentFirst([{ id: "a" }, { id: "b" }, { id: "c" }], ["c", "zz", "b"]).map((x) => x.id), ["c", "b", "a"]);
  assert.deepEqual(EMPTY_FILTER.accounts, []);
});
test("menu order is money first", () => {
  const top = NAV.filter((n) => !n.parent).map((n) => n.id);
  assert.ok(!top.includes("inbox"), "Unanswered messages is a tab of Speed to lead, not a menu entry");
  assert.deepEqual(top.slice(0, 13), ["today", "speed", "appointments", "clients", "payments", "people", "audit", "cleanup", "team", "pipeline", "meetings", "workflows", "overview"]);
  assert.equal(top[12], "overview");
});

import { summariseWaitingMoney, waitingMoneyLine, type CountedDeal } from "../analytics/waiting-money.ts";
test("counted money of the waiting people: each deal and person once, equal to the audit's way of summing the same counted deals", () => {
  const deals: CountedDeal[] = [
    { opportunityId: "o1", locationId: "L1", contactId: "c1", value: 1000 },
    { opportunityId: "o1", locationId: "L1", contactId: "c1", value: 1000 }, // the same deal read twice
    { opportunityId: "o2", locationId: "L1", contactId: "c1", value: 500 }, // a second deal of the same person
    { opportunityId: "o3", locationId: "L2", contactId: "c2", value: 250 },
    { opportunityId: "o4", locationId: "L2", contactId: "c9", value: 9999 }, // not waiting
    { opportunityId: "o5", locationId: "L2", contactId: "c2", value: 0 }, // not a counted deal
  ];
  const m = summariseWaitingMoney(["L1:c1", "L2:c2", "L2:c3"], deals);
  const auditWay = new Map(deals.filter((d) => d.value > 0 && ["L1:c1", "L2:c2", "L2:c3"].includes(`${d.locationId}:${d.contactId}`)).map((d) => [`${d.locationId}:${d.opportunityId}`, d.value])).values();
  assert.equal(m.dollars, [...auditWay].reduce((a, b) => a + b, 0));
  assert.equal(m.dollars, 1750);
  assert.equal(m.deals, 3);
  assert.equal(m.peopleWithDeals, 2);
  assert.equal(m.people, 3);
  assert.equal(waitingMoneyLine(m, "next"), "2 of these people have open deals worth $1,750.");
  assert.equal(waitingMoneyLine(summariseWaitingMoney(["L1:zz"], deals), "Next best step: reply first."), "Next best step: reply first.");
});
