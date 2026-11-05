import { readFileSync, readdirSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card, Loading, Stat, Table } from "@/app/app/ui";
import { countUpParts } from "@/lib/design/count-up";

// Stage D1: the polish pass. The rules it set are kept here so a later page cannot quietly bring back a card inside a card, a spinner, a figure that
// animates its text for a screen reader, or motion for people who asked for none.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const css = readFileSync("src/app/globals.css", "utf8");

describe("a block is a heading over a thin rule, not a box (no card inside a card)", () => {
  it("Card draws no border box, fill or shadow of its own", () => {
    const m = html(el(Card, { title: "How fast replies come" }, el("p", null, "text")));
    expect(m).toContain("How fast replies come");
    expect(m).toContain("border-t");
    expect(m).not.toMatch(/rounded|bg-card|shadow|\bborder\b(?!-)/);
  });

  it("a key figure is a number with a rule on its left, not a tile", () => {
    const m = html(el(Stat, { label: "Booked", value: "84", tone: "warn", sub: "Same as before" }));
    expect(m).toContain("border-l-2");
    expect(m).toContain("84");
    expect(m).not.toMatch(/rounded|bg-card|shadow/);
  });

  it("no page file draws a boxed block with the shared Card around a boxed list", () => {
    // The shared list and chart draw their own edge; a page must not wrap a second one around them.
    const dir = "src/app/app/views";
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      expect(src, `${f} wraps a Card in a bordered, filled box`).not.toMatch(/<Card[^>]*className="[^"]*\bbg-card\b/);
    }
  });
});

describe("loading is a placeholder the shape of the page, not a spinner", () => {
  it("Loading has a status role, the words for a screen reader and grey blocks", () => {
    const m = html(el(Loading, { label: "Reading your conversations..." }));
    expect(m).toContain('role="status"');
    expect(m).toContain('aria-busy="true"');
    expect(m).toContain("Reading your conversations...");
    expect(m).toContain("ds-skeleton");
    expect(m).not.toContain("animate-spin");
  });
});

describe("the count-up", () => {
  it("only plain numbers count up, and the last frame is exactly the real text", () => {
    for (const text of ["1,397,934", "$1,397,934", "61%", "228", "12.5%"]) {
      const c = countUpParts(text)!;
      expect(c, text).not.toBeNull();
      expect(c.at(1)).toBe(text);
      expect(c.at(5)).toBe(text); // past the end is clamped
      expect(c.at(0)).not.toBe(text);
    }
    expect(countUpParts("$2,000")!.at(0.5)).toMatch(/^\$[\d,]+$/);
    expect(countUpParts("61%")!.at(0.5)).toMatch(/^\d+%$/);
  });

  it("words, ranges and small numbers are left alone", () => {
    for (const text of ["24 min", "58 of 298", "n/a", "Not enough data", "7", "3", "9 in 10", "", "$"]) expect(countUpParts(text), text).toBeNull();
  });

  it("the markup always holds the final number (a screen reader, a print and a test never see a half-counted figure)", () => {
    expect(html(el(Stat, { label: "Open pipeline", value: "$2,269,658" }))).toContain("$2,269,658");
    expect(html(el(Stat, { label: "Stale deals", value: 43 }))).toContain(">43<");
  });
});

describe("motion is restrained and stops when a person asks for less", () => {
  it("every animation class is switched off under prefers-reduced-motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const cls of [".ds-enter", ".ds-grow", ".ds-grow-x", ".ds-skeleton"]) expect(block, cls).toContain(cls);
    expect(block).toMatch(/animation-duration:\s*0\.01ms/);
  });

  it("no animation is longer than 700 ms and none loops except the loading placeholder", () => {
    const uses = [...css.matchAll(/animation:\s*([\w-]+)\s+(\d+)ms[^;]*;/g)];
    expect(uses.length).toBeGreaterThanOrEqual(2); // the page fade uses the 200 ms token
    for (const [, name, ms] of uses) expect(Number(ms), name).toBeLessThanOrEqual(700);
    expect(css.match(/infinite/g)?.length).toBe(1);
  });

  it("the count-up checks the reduced-motion setting before it moves anything", () => {
    const src = readFileSync("src/app/app/ds/count-up.tsx", "utf8");
    expect(src).toContain("prefers-reduced-motion: reduce");
    expect(src.indexOf("prefers-reduced-motion")).toBeLessThan(src.indexOf("requestAnimationFrame(tick)"));
  });
});

describe("a table keeps its first column in view when it scrolls sideways", () => {
  it("the first column is sticky and opaque", () => {
    const m = html(el(Table, { head: el("tr", null, el("th", null, "Account")) }, el("tr", null, el("td", null, "Blue Door"))));
    expect(m).toContain("[&amp;_tbody_td:first-child]:sticky");
    expect(m).toContain("[&amp;_thead_th:first-child]:bg-muted");
  });
});

describe("the toolbar", () => {
  it("search and notifications share one row with the filter summary (no stacked blocks above the title)", () => {
    const src = readFileSync("src/app/app/dashboard.tsx", "utf8");
    const i = src.indexOf('data-testid="toolbar"');
    expect(i).toBeGreaterThan(0);
    const row = src.slice(i, src.indexOf("<GlobalFilterBar", i));
    for (const part of ["GlobalSearch", "NotificationBell"]) expect(row, part).toContain(part);
  });
});
