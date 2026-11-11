import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Why a side panel went blank for real people, and the guards that keep it from coming back. Source-level checks: they need no browser or database.
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("a page's entrance animation never keeps a transform after it ends (it would anchor every fixed side panel inside the page, far off screen)", () => {
  const css = read("app/globals.css");
  const rule = css.match(/^\.ds-enter\s*\{[^}]*\}/m)?.[0] ?? "";
  assert.ok(rule, "the .ds-enter rule exists");
  assert.doesNotMatch(rule, /\b(both|forwards)\b/, ".ds-enter must not fill forwards");
});

test("every request has a time limit and says so in plain words", () => {
  const s = read("app/app/session.tsx");
  assert.match(s, /AbortController/);
  assert.match(s, /REQUEST_TIMEOUT_MS/);
  assert.match(s, /taking too long/);
});

test("the shared panels catch a crash instead of going blank", () => {
  for (const f of ["app/app/ds/lead-drawer.tsx", "app/app/views/ap3/parts.tsx", "app/app/views/pl3/parts.tsx"]) assert.match(read(f), /PanelBoundary/, `${f} wraps its tools in PanelBoundary`);
  assert.match(read("app/app/ds/states.tsx"), /getDerivedStateFromError/);
});

test("lists inside the lead panel are not components made during a render (that reset their open state on every refresh)", () => {
  const s = read("app/app/ds/wb/appointments-tab.tsx");
  assert.doesNotMatch(s, /const Group = \(/);
  assert.match(s, /function ApptItem/);
  assert.match(s, /onToggle=/);
});
