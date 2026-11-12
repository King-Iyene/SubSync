import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { looksLikeTestDeal, mainSlots, riskFigure, STRIP_MAIN_SLOTS, STRIP_SUB_SLOTS } from "../analytics/today3-strip.ts";
import type { Td3Money, Td3Today } from "../analytics/today3-types.ts";

const css = readFileSync(new URL("../../app/app/views/td3/strip.css", import.meta.url), "utf8");
const src = readFileSync(new URL("../../app/app/views/td3/today-strip.tsx", import.meta.url), "utf8");
const mod = readFileSync(new URL("../../app/app/views/td3/module.tsx", import.meta.url), "utf8");

const money = (dollars: number | null, deals: number, hidden = false) => ({ hidden, atRisk: { dollars, deals } }) as unknown as Td3Money;
const today = (stale: number, moneyAt: number) => ({ items: [{ kind: "stale_deals", count: stale, money: moneyAt }] }) as unknown as Pick<Td3Today, "items">;

test("layout guard: four equal columns from 880px of strip width, two from 520px, one below, equal gaps, no wrapping buttons", () => {
  assert.match(css, /\.td-srow\[data-n="4"\] \{ --cols: 4; \}/);
  assert.match(css, /repeat\(var\(--cols, 1\), minmax\(0, 1fr\)\)/);
  assert.match(css, /@container tdstrip \(min-width: 880px\)/);
  assert.match(css, /@container tdstrip \(min-width: 520px\) and \(max-width: 879px\)[\s\S]*--cols: 2/);
  assert.match(css, /@container tdstrip \(max-width: 519px\)[\s\S]*--cols: 1/);
  assert.match(css, /\.td-slink \{[^}]*white-space: nowrap/);
  assert.match(css, /\.td-swin-go \{[^}]*min-height: 44px/);
});

test("layout guard: colours are tokens only (no hex, rgb or hsl) and reduced motion is honoured", () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
  assert.equal(/\b(rgb|rgba|hsl|hsla)\(/.test(css), false);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.equal(/border-left:\s*\d+px solid var\(--s6-(red|amber|green)/.test(css), false, "no coloured left borders");
});

test("one source of truth: Money at risk comes from the money read; the older figure is used only when the money read is hidden", () => {
  const m = money(1_000_000, 1);
  const a = riskFigure(m, today(0, 0));
  assert.deepEqual([a.dollars, a.deals, a.source], [1_000_000, 1, "money"]);
  // the older item list says "none": it must not contradict the money read
  assert.equal(riskFigure(m, today(5, 99)).dollars, 1_000_000);
  const hidden = riskFigure(money(1, 1, true), today(3, 4200));
  assert.deepEqual([hidden.dollars, hidden.deals, hidden.source], [4200, 3, "items"]);
  assert.equal(riskFigure(null, today(0, 0)).dollars, null);
});

test("one source of truth in the screen: the strip draws exactly one Money at risk card and Today no longer draws the older strip beside it", () => {
  assert.equal((src.match(/<Fig id="risk"/g) ?? []).length, 2, "the money-read card and the hidden-money stand-in only");
  assert.match(mod, /<TodayStrip /);
  assert.equal(/<MoneyHero /.test(mod), false);
  const tab = mod.slice(mod.indexOf("function TodayTab("), mod.indexOf("export function TodayTabBlocks"));
  assert.equal(/<Hero /.test(tab), false);
});

test("skeleton shape: the loading strip draws the same number of figures, in the same grid, as the loaded strip", () => {
  assert.equal(mainSlots(true).length, STRIP_MAIN_SLOTS.length);
  assert.equal(mainSlots(false).length, STRIP_MAIN_SLOTS.length - 1);
  assert.equal(STRIP_SUB_SLOTS.length, 3);
  assert.match(src, /<Skeleton n=\{slots\}/);
  assert.match(src, /className="td-sfig td-sskel"/); // same box class as a loaded figure
  assert.match(css, /\.td-sskel \{[^}]*animation: none/);
  assert.match(src, /className="td-srow" data-n=\{n\}/); // same grid wrapper
});

test("test-deal note: round million-dollar deals and one huge round deal among tiny ones, never a normal deal", () => {
  assert.equal(looksLikeTestDeal(1_000_000, 1), true);
  assert.equal(looksLikeTestDeal(2_000_000, 2), true);
  assert.equal(looksLikeTestDeal(41_000, 11), false);
  assert.equal(looksLikeTestDeal(null, 0), false);
  assert.equal(looksLikeTestDeal(500_000, 1, { dollars: 500_000 + 9 * 2_000, deals: 10 }), true);
  assert.equal(looksLikeTestDeal(5_000, 1, { dollars: 50_000, deals: 10 }), false);
});
