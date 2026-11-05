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
  assert.equal(accountButtonText(0, 13), "All 13 client accounts");
  assert.equal(accountButtonText(3, 13), "3 of 13 client accounts");
  assert.deepEqual(recentFirst([{ id: "a" }, { id: "b" }, { id: "c" }], ["c", "zz", "b"]).map((x) => x.id), ["c", "b", "a"]);
  assert.deepEqual(EMPTY_FILTER.accounts, []);
});
test("menu order is money first", () => {
  const top = NAV.filter((n) => !n.parent).map((n) => n.id);
  assert.deepEqual(top.slice(0, 8), ["today", "speed", "inbox", "appointments", "clients", "people", "audit", "cleanup"]);
});
