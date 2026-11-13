import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { answerStoreKey, STORED_READS } from "../analytics/read-answers.ts";

// Filter audit (13 Nov 2026, King: "the 90 days filter is still not working", "check the filter for all other modules"): a finished answer is kept by its address, so the
// address must hold EVERY filter. These tests fail when a stored answer, or a cache in a route, could hand a 30-day answer to a 90-day request (or one account's, pipeline's,
// source's, tag's answer to another).

const FILTERS: Array<[string, string, string]> = [
  ["from", "2026-10-15", "2026-08-16"], ["to", "2026-11-13", "2026-11-12"], ["fromTime", "09:00", "10:00"], ["toTime", "17:30", "18:00"],
  ["cmpFrom", "2026-09-15", "2026-07-17"], ["cmpTo", "2026-10-14", "2026-08-15"], ["wfrom", "2026-10-15", "2026-08-16"], ["wto", "2026-11-13", "2026-11-12"],
  ["location", "locA", "locB"], ["account", "locA", "locB"], ["client", "locA", "locB"], ["pipeline", "Sales", "Support"], ["stage", "s1", "s2"], ["owner", "u1", "u2"],
  ["user", "u1", "u2"], ["source", "Facebook", "Google"], ["tag", "vip", "cold"], ["status", "open", "won"], ["channel", "sms", "email"], ["calendar", "c1", "c2"],
  ["q", "ann", "bob"], ["page", "0", "1"], ["size", "20", "50"], ["sort", "a", "b"], ["part", "overview", "health"], ["basis", "appt", "booked"], ["role", "setter", "closer"],
  ["bucket", "all", "stale"], ["level", "a", "b"], ["period", "2026-10", "2026-09"], ["range", "30", "90"], ["days", "30", "90"], ["test", "0", "1"], ["x_outcome", "showed", "noshow"],
];

test("every stored read: any filter that changes makes another key (30 days never answers 90 days)", () => {
  for (const read of STORED_READS) {
    const base = new URLSearchParams("part=home&from=2026-10-15&to=2026-11-13");
    for (const [k, a, b] of FILTERS) {
      const x = new URLSearchParams(base); x.set(k, a);
      const y = new URLSearchParams(base); y.set(k, b);
      const path = `/api/app/${read}`;
      assert.notEqual(answerStoreKey("w", path, x), answerStoreKey("w", path, y), `${read}: ${k} must be part of the stored answer key`);
    }
  }
});

test("the router's in-memory answer key is the installation, the person and the whole address", () => {
  const src = readFileSync(new URL("../api/router.ts", import.meta.url), "utf8");
  assert.match(src, /answerKey\(ctx\.installationId, who, `\$\{ctx\.url\.pathname\}\?\$\{ctx\.url\.searchParams\.toString\(\)\}`\)/);
});

test("the key ignores only the Try again marker and the order of the parameters", () => {
  const a = answerStoreKey("w", "/api/app/speed", new URLSearchParams("from=2026-10-15&to=2026-11-13&location=x"));
  assert.equal(answerStoreKey("w", "/api/app/speed", new URLSearchParams("location=x&to=2026-11-13&from=2026-10-15&_r=abc")), a);
  assert.notEqual(answerStoreKey("w", "/api/app/speed", new URLSearchParams("from=2026-10-15&to=2026-11-13")), a, "no account is not the account");
  assert.notEqual(answerStoreKey("w", "/api/app/speed", new URLSearchParams("from=2026-08-16&to=2026-11-13&location=x")), a, "90 days is not 30 days");
  assert.notEqual(answerStoreKey("w", "/api/app/speed", new URLSearchParams("from=2026-10-15&to=2026-11-13&location=x&pipeline=Sales")), a, "a pipeline is not all pipelines");
});

// The in-process caches of the route files (ttlCache): their key must be the whole address (`sp.toString()`), never a hand-picked list of filters that can fall behind.
test("every route cache key holds the whole address", () => {
  const dir = new URL("../api/", import.meta.url);
  const bad: string[] = [];
  let seen = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ts$/.test(n))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(/const key = JSON\.stringify\(\[([^\n]*)\]\);/g)) {
      seen++;
      if (!/sp\.toString\(\)|url\.search|searchParams\.toString\(\)/.test(m[1])) bad.push(`${f}: ${m[0].slice(0, 120)}`);
    }
  }
  assert.ok(seen >= 10, `expected the route cache keys to be found, saw ${seen}`);
  assert.deepEqual(bad, [], "a route cache key that leaves out the address can serve one filter's answer to another");
});

// The shared caches of the query files that take a date window or a pick must hold it.
test("query caches that depend on a window or a pick hold it in the key", () => {
  const read = (p: string) => readFileSync(new URL(`../analytics/${p}`, import.meta.url), "utf8");
  assert.match(read("finance-queries.ts"), /JSON\.stringify\(\[s\.inst, "rev", s\.allowed, r\]\)/, "revenue per client: the range");
  assert.match(read("finance-pay.ts"), /"paysum",[^\n]*, r, basis/, "payouts: the range and the basis");
  assert.match(read("call-queries.ts"), /JSON\.stringify\(f\)/, "call queue: every filter");
  assert.match(read("pipeline3-queries.ts"), /f\.location \?\? null, f\.pipeline \?\? null, f\.owner \?\? null, f\.source \?\? null, f\.q \?\? null/, "pipeline basis: location, pipeline, owner, source, search");
  assert.match(read("br-queries.ts"), /JSON\.stringify\(\[inst, Object\.values\(f\)/, "brief: every input");
  const growth = readFileSync(new URL("../api/growth-api.ts", import.meta.url), "utf8");
  assert.match(growth, /asked\.from \?\? "", asked\.to \?\? ""/, "growth: the dates");
});

// Readers that used to count a fixed 30 days under a bar that said 90 (found by the filter audit, 13 Nov 2026).
test("Pipeline overview won and lost, and the reply-speed cards, count the bar's window, not a fixed 30 days", () => {
  const pl = readFileSync(new URL("../analytics/pipeline3-queries.ts", import.meta.url), "utf8");
  const ov = pl.slice(pl.indexOf("export async function overview("), pl.indexOf("// ---------- attention"));
  assert.doesNotMatch(ov, /Date\.now\(\) - 30 \* DAY/, "overview must not build its own 30-day window");
  assert.match(ov, /d30 = f\.from, dTo = f\.to/);
  assert.match(ov, /last_status_change_at < \$\{dTo\}/);
  assert.match(ov, /won in \$\{windowDays/);
  const roll = readFileSync(new URL("../analytics/pipeline3-rollup.ts", import.meta.url), "utf8");
  assert.match(roll, /closedIn\(db, "won", f\.d30, f\.to \?\? null\)/);
  const moat = readFileSync(new URL("../api/moat-routes.ts", import.meta.url), "utf8");
  assert.equal((moat.match(/win: barWindow\(sp\)/g) ?? []).length, 2, "scorecards and channels read the bar");
  const ui = readFileSync(new URL("../../app/app/views/moat-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /part=scorecards&days=30|part=channels&days=30/);
});
