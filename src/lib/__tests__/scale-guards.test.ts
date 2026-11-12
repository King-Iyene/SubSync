import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { assertThrowawayDb } from "../../../scripts/scale-guard.ts";

// Guards for the scale test (docs/QA_SCALE.md): the seeder only ever runs on a throwaway local database, and the fixes it found stay in.

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_SSL: process.env.DATABASE_SSL };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test("the scale seeder refuses a database that is not local", () => {
  withEnv({ DATABASE_URL: "postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres", DATABASE_SSL: "off" }, () => assert.throws(() => assertThrowawayDb(), /not local/));
  withEnv({ DATABASE_URL: "postgresql://postgres:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres", DATABASE_SSL: "off" }, () => assert.throws(() => assertThrowawayDb(), /not local/));
  withEnv({ DATABASE_URL: undefined, DATABASE_SSL: "off" }, () => assert.throws(() => assertThrowawayDb(), /DATABASE_URL/));
  withEnv({ DATABASE_URL: "not a url", DATABASE_SSL: "off" }, () => assert.throws(() => assertThrowawayDb(), /not a valid URL/));
});

test("the scale seeder needs the no-TLS switch too, and accepts localhost", () => {
  withEnv({ DATABASE_URL: "postgresql://postgres:ci@localhost:5433/postgres", DATABASE_SSL: undefined }, () => assert.throws(() => assertThrowawayDb(), /DATABASE_SSL=off/));
  withEnv({ DATABASE_URL: "postgresql://postgres:ci@localhost:5433/postgres", DATABASE_SSL: "off" }, () => assert.equal(assertThrowawayDb(), "postgresql://postgres:ci@localhost:5433/postgres"));
  withEnv({ DATABASE_URL: "postgresql://postgres:ci@127.0.0.1:5432/postgres", DATABASE_SSL: "off" }, () => assert.doesNotThrow(() => assertThrowawayDb()));
});

test("the scale index migration is additive and numbered after the previous last one", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const name = files.find((f) => f.endsWith("_scale_indexes.sql"));
  assert.ok(name, "the migration exists");
  assert.ok(name > "20261230090000_sync_webhook_outcome.sql", "it sorts after the migration that was last when it was written");
  const text = readFileSync(`supabase/migrations/${name}`, "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(text, /\b(drop|truncate|delete)\b/i);
  assert.match(text, /create index if not exists lead_touches_contact_idx/i);
  assert.match(text, /create index if not exists cached_appointments_owner_loc_start_idx/i);
});

test("the pipeline deal set computes the per-account open total once (the planner re-ran it per deal: 92 s at 55,000 deals)", () => {
  const src = readFileSync("src/lib/analytics/pipeline3-queries.ts", "utf8");
  assert.match(src, /lo as materialized \(select/);
});

test("double bookings: the figure and the Calendars list share ONE definition, in two indexed passes, never one join on 'calendar OR person'", () => {
  const src = readFileSync("src/lib/analytics/appointments3-queries.ts", "utf8");
  assert.doesNotMatch(src, /b\.calendar_id = a\.calendar_id or \(a\.assigned_to is not null/);
  assert.match(src, /export function clashKeys/);
  assert.match(src, /from \(\$\{clashKeys\(s, f\)\}\) p/, "the figure");
  assert.match(src, /clashKeys\(s, f, calF as never, rowCols as never\)/, "the list rows");
  assert.match(src, /from \(\$\{clashKeys\(s, f, calF as never\)\}\) k/, "the list count");
});
