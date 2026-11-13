import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// A row of tabs that runs off the right edge hides pages that cannot be reached with the mouse. Every strip must wrap.
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : /\.tsx$/.test(n) ? [p] : []; });

test("no tab strip turns wrapping off", () => {
  const bad = walk("src/app").filter((f) => /<(ModuleTabs|GroupedTabs)[^>]*\bwrap=\{false\}/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});

test("ModuleTabs wraps by default and never forces a sideways scroll while wrapping", () => {
  const src = readFileSync("src/app/app/ds/template.tsx", "utf8");
  assert.match(src, /wrap = true/);
  assert.match(src, /\$\{wrap \? "flex-wrap" : "min-w-max"\}/);
});

test("the request for permissions no longer includes the agency-only plan permission", () => {
  const src = readFileSync("src/lib/ghl/scopes.ts", "utf8");
  assert.ok(!src.includes("saas/company"));
});
