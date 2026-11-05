import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GLOSSARY, SECTION_META, TAB_META, tabMeta } from "../analytics/today-tabs.ts";

test("every tab has a name, a one-line subtitle and a To do or Report tag", () => {
  for (const [name, m] of Object.entries(TAB_META)) {
    assert.ok(name.length >= 3 && name.length <= 30, name);
    assert.ok(m.subtitle.length >= 20 && m.subtitle.length <= 130, `${name} subtitle`);
    assert.ok(m.tag === "To do" || m.tag === "Report", name);
    assert.ok(!/ghl|highlevel|sub-account|location/i.test(m.subtitle), `${name} uses an internal word`);
  }
  for (const [name, m] of Object.entries(SECTION_META)) assert.ok(m.subtitle && (m.tag === "To do" || m.tag === "Report"), name);
});

test("reading tabs are Report and the acting tab is To do", () => {
  for (const n of ["Growth", "Lead flow", "Clients coming and going", "Sources", "Coverage"]) assert.equal(tabMeta(n)?.tag, "Report", n);
  assert.equal(tabMeta("Forecast")?.tag, "To do");
});

test("every tab label used on the Today page has meta", () => {
  const src = readFileSync(new URL("../../app/app/views/today-page.tsx", import.meta.url), "utf8");
  const labels = [...src.matchAll(/\{ label: "([^"]+)", node:/g)].map((m) => m[1]);
  assert.ok(labels.length >= 6);
  for (const l of labels) assert.ok(tabMeta(l), `${l} has no name, subtitle and tag`);
});

test("the glossary has one word per idea and none of the banned words in the Today screens", () => {
  assert.ok(GLOSSARY.length >= 6);
  const files = ["today-page.tsx", "today-growth.tsx", "today-flow.tsx", "today-people.tsx"].map((f) => { try { return readFileSync(new URL(`../../app/app/views/${f}`, import.meta.url), "utf8"); } catch { return ""; } }).join("\n");
  const strings = [...files.matchAll(/"([^"\n]{4,})"/g)].map((m) => m[1]).filter((s) => /\s/.test(s) && !/^[a-z-]+$/.test(s) && !/[{}=]|className|\//.test(s));
  for (const s of strings) assert.ok(!/\bunanswered\b|\bpending\b/i.test(s), `Use "waiting for a reply": ${s}`);
});
