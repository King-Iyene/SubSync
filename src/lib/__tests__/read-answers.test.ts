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

test("every module first-screen read is stored, but exports, live views and a person's own working state are not", () => {
  const q = (s: string) => new URLSearchParams(s);
  for (const seg of ["today3", "exec-summary", "pipeline-intel", "finance", "payments", "cash", "wg", "br", "clients2", "clients3", "people3", "pipeline3", "audit", "dq", "cu", "workflows"]) assert.ok(storable("GET", [seg], q("part=overview")), seg);
  assert.ok(!storable("GET", ["finance"], q("part=export")), "a file download");
  assert.ok(!storable("GET", ["payments"], q("part=export")));
  assert.ok(!storable("GET", ["clients3"], q("part=export")));
  assert.ok(!storable("GET", ["audit", "shares"], q("")), "share links");
  assert.ok(!storable("GET", ["workflows", "history"], q("")));
  for (const seg of ["settings", "people", "call-queue", "dial", "meeting-inbox", "my-connections", "notifications", "freshness", "sync", "roadmap", "st", "api-keys", "start"]) assert.ok(!storable("GET", [seg], q("")), seg);
  assert.ok(!storable("POST", ["pipeline3", "act"], q("")));
});

test("an answer made before the data last changed is shown at once but rebuilt behind it, never called fresh", () => {
  const made = Date.now() - 60_000;
  assert.equal(judgeAnswer({ body: "{}", ageMs: 60_000, dirty: false, computedAtMs: made }, made - 1), "fresh", "data unchanged since it was made");
  assert.equal(judgeAnswer({ body: "{}", ageMs: 60_000, dirty: false, computedAtMs: made }, made + 1), "stale", "rows changed after it was made");
  assert.equal(judgeAnswer({ body: "{}", ageMs: 60_000, dirty: false, computedAtMs: made }), "fresh", "no signal: age rules only");
  assert.equal(judgeAnswer({ body: "{}", ageMs: ANSWER_STALE_MS + 1, dirty: false, computedAtMs: made }, made + 1), "unusable", "too old is still never used");
  assert.equal(judgeAnswer({ body: "{}", ageMs: 1, dirty: true, computedAtMs: made }, made - 1), "unusable");
});

test("the stored answer key never crosses a tenant: it holds who asks, and the lookup and the router key both carry the installation", () => {
  const router = readFileSync(new URL("../api/router.ts", import.meta.url), "utf8");
  assert.ok(router.includes("readAnswer(ctx.installationId, sk)"));
  assert.ok(router.includes("storeAnswer(ctx.installationId, sk,"));
  assert.ok(router.includes("const who = `${ctx.kind}:${ctx.limitTo ?? \"\"}:${ctx.session.userId ?? \"\"}:${ctx.session.personRole ?? \"\"}`"));
  assert.notEqual(answerStoreKey("agency::u1", "/api/app/pipeline3", new URLSearchParams("part=overview")), answerStoreKey("client:locB:u1", "/api/app/pipeline3", new URLSearchParams("part=overview")), "an account-limited person never gets an agency answer");
});
