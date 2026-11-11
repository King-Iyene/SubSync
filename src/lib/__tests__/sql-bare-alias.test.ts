import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A column alias with no AS that is a SQL keyword (day, hour, year, ...) is a syntax error in Postgres, but it only shows up when the query
// really runs. The Clients rollup shipped `select location_id, d day, ...` and every Clients screen answered 500 on a real database while the
// tests (which skip without a database) stayed green. This reads the analytics SQL and refuses a bare keyword alias.
const KEYWORDS = "day|hour|minute|second|month|year|week|zone|time|interval|user|order|group|end|check|primary";
const BARE_ALIAS = new RegExp(String.raw`(?:\bselect\s+|,\s*)[\w.]+(?:\([^)]*\))?(?:::\w+)?\s+(?:${KEYWORDS})\s*(?:,|$)`, "i");
const dir = join(process.cwd(), "src", "lib", "analytics");

test("no analytics query uses a bare keyword as a column alias", () => {
  const bad: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    readFileSync(join(dir, file), "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|import\s|export\s+(type\s)?\{)/.test(line)) return;
      if (BARE_ALIAS.test(line)) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [], "write `as day` (an alias that is a SQL keyword needs AS)");
});

test("the guard catches the original bug and accepts the fix", () => {
  assert.ok(BARE_ALIAS.test("    select location_id, d day, sum(new_leads)::int new_leads,"));
  assert.ok(!BARE_ALIAS.test("    select location_id, d as day, sum(new_leads)::int new_leads,"));
});
