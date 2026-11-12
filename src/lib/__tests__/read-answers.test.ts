import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ANSWER_FRESH_MS, ANSWER_STALE_MS, answerStoreKey, judgeAnswer, storable } from "../analytics/read-answers.ts";

test("only the heavy reads are stored; the live race and every change are not", () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.ok(storable("GET", ["today"], q("")));
  assert.ok(storable("GET", ["speed"], q("part=home")));
  assert.ok(storable("GET", ["appointments"], q("part=view&from=2026-10-01")));
  assert.ok(storable("GET", ["clients"], q("")));
  assert.ok(!storable("GET", ["speed"], q("part=race")));
  assert.ok(!storable("GET", ["speed", "race"], q("")));
  assert.ok(!storable("POST", ["today", "action"], q("")));
  assert.ok(!storable("GET", ["settings"], q("")));
  assert.ok(!storable("GET", ["meeting-inbox"], q("")));
});

test("the key holds who asks and the exact window; a retry marker is ignored", () => {
  const a = answerStoreKey("agency::u1", "/api/app/today", new URLSearchParams("b=2&a=1"));
  assert.equal(a, "agency::u1|/api/app/today?a=1&b=2");
  assert.equal(answerStoreKey("agency::u1", "/api/app/today", new URLSearchParams("a=1&b=2&_r=xyz")), a);
  assert.notEqual(answerStoreKey("agency::u2", "/api/app/today", new URLSearchParams("a=1&b=2")), a, "another person");
  assert.notEqual(answerStoreKey("agency::u1", "/api/app/today", new URLSearchParams("a=1&b=3")), a, "another window");
});

test("an answer is used while fresh, shown while a new one is made when a little old, never after a change or when too old", () => {
  assert.equal(judgeAnswer(null), "unusable");
  assert.equal(judgeAnswer({ body: "{}", ageMs: 1000, dirty: false }), "fresh");
  assert.equal(judgeAnswer({ body: "{}", ageMs: ANSWER_FRESH_MS + 1, dirty: false }), "stale");
  assert.equal(judgeAnswer({ body: "{}", ageMs: ANSWER_STALE_MS + 1, dirty: false }), "unusable");
  assert.equal(judgeAnswer({ body: "{}", ageMs: 10, dirty: true }), "unusable");
});

test("the store is scoped to one installation and the migration adds only (no drop, truncate or delete from)", () => {
  const db = readFileSync(new URL("../analytics/read-answers-db.ts", import.meta.url), "utf8");
  for (const stmt of db.match(/(select body|insert into read_answers)[\s\S]*?`/g) ?? []) assert.match(stmt, /installation_id/);
  const sqlText = readFileSync(new URL("../../../supabase/migrations/20261229090000_r6_account_rollup.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sqlText, /\b(drop|truncate)\b|delete\s+from/i);
});
