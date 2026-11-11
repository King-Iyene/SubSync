import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_OFF } from "../flags-core.ts";
import { FEATURES } from "../entitlements.ts";
import { SYNCED_DELETE } from "../tenant-tables.ts";
import { monthWindow, mondayOf, weeklyDue } from "../analytics/moat-core.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const NEW_FLAGS = ["moat_record", "moat_receipt", "moat_curve", "moat_scorecards", "moat_benchmark", "moat_proof_page", "moat_alert_feedback", "inbox_wait_clock", "inbox_reply_target", "inbox_proof_email"];

test("every new feature has its own flag, default off", () => {
  for (const f of NEW_FLAGS) {
    assert.ok((FEATURES as readonly string[]).includes(f), `${f} is a feature`);
    assert.ok(DEFAULT_OFF.has(f as never), `${f} defaults off`);
  }
});

test("the new tables are in the purge list so an uninstall removes them", () => {
  for (const t of ["moat_events", "reply_proof_pages"]) assert.ok((SYNCED_DELETE as readonly string[]).includes(t), t);
});

test("the migration is additive and the record is append-only", () => {
  const sqlText = read("supabase/migrations/20261121090000_u3d_moat.sql");
  assert.doesNotMatch(sqlText, /drop\s+(table|column)/i);
  assert.match(sqlText, /create table if not exists public\.moat_events/);
  assert.match(sqlText, /moat_events is append-only/);
  assert.match(sqlText, /before update on public\.moat_events/);
  assert.doesNotMatch(sqlText, /(body|message_text|snippet)\s+text/i, "no message text column");
});

test("nothing updates or deletes the raw record from code", () => {
  const dir = join(root, "src", "lib");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "__tests__" ? [] : walk(join(d, e.name))) : [join(d, e.name)]));
  for (const f of walk(dir).filter((p) => p.endsWith(".ts"))) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /update\s+moat_events/i, f);
    if (!f.endsWith("tenant-tables.ts") && !f.endsWith("data-inventory.ts")) assert.doesNotMatch(text, /delete\s+from\s+moat_events/i, f);
  }
});

test("cross-tenant benchmark data goes through one audited function only", () => {
  const dir = join(root, "src");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const users = walk(dir).filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes("__tests__") && /percentile_cont[\s\S]{0,600}benchmark_opt_in|benchmark_opt_in[\s\S]{0,1500}percentile_cont/.test(readFileSync(p, "utf8")));
  assert.deepEqual(users.map((p) => p.replace(/\\/g, "/").split("/src/")[1]), ["lib/analytics/benchmarks-audited.ts"]);
  const text = read("src/lib/analytics/benchmarks-audited.ts");
  assert.match(text, /insert into audit_log/);
  assert.doesNotMatch(text, /select[^`]*\bt\.location_id\b[^`]*from per_account\s*\)?\s*$/m);
});

test("no vendor words in the new screens, page or wording", () => {
  const files = ["src/app/app/views/moat-panel.tsx", "src/app/app/views/moat-curve-chart.tsx", "src/app/reply-proof/[id]/page.tsx", "src/lib/analytics/moat-core.ts", "src/lib/analytics/moat-cron.ts", "src/lib/api/moat-routes.ts", "src/lib/analytics/reply-proof.ts", "src/lib/analytics/benchmarks-audited.ts"];
  for (const f of files) {
    const text = read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    // The word check itself lives in moat-core (a regex), so look only at quoted text elsewhere.
    const strings = text.match(/(["'`])(?:\\.|(?!\1).)*\1/g) ?? [];
    for (const s of strings) {
      if (f.endsWith("moat-core.ts") && /gohighlevel\|/.test(s)) continue;
      assert.doesNotMatch(s, /gohighlevel|go high level|highlevel|\bghl\b|sub-?account|leadconnector/i, `${f}: ${s.slice(0, 60)}`);
    }
  }
});

test("the weekly proof runs once, on Monday morning, with a stable dedupe week", () => {
  const monday = Date.parse("2026-11-09T08:30:00Z");
  assert.equal(weeklyDue(monday), true);
  assert.equal(weeklyDue(Date.parse("2026-11-09T10:00:00Z")), false);
  assert.equal(weeklyDue(Date.parse("2026-11-10T08:30:00Z")), false);
  assert.equal(mondayOf(Date.parse("2026-11-12T15:00:00Z")), "2026-11-09");
  assert.equal(mondayOf(Date.parse("2026-11-15T23:59:00Z")), "2026-11-09");
});

test("the receipt month is validated and never in the future", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  assert.deepEqual(monthWindow("2026-10", now), { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") });
  assert.deepEqual(monthWindow(null, now)?.from, new Date("2026-10-01T00:00:00Z"));
  assert.equal(monthWindow("2027-01", now), null);
  assert.equal(monthWindow("10-2026", now), null);
  assert.equal(monthWindow("2026-13", now), null);
});
