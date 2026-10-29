import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanConnectionString } from "../db.ts";

test("pooler URLs lose their query parameters but keep credentials, host, port and database", () => {
  const raw = "postgres://postgres.abcd:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x";
  const clean = cleanConnectionString(raw);
  assert.equal(clean, "postgres://postgres.abcd:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:6543/postgres");
  assert.ok(!clean.includes("?"));
});

test("a URL with no query string is unchanged", () => {
  const raw = "postgresql://postgres:secret@db.example.supabase.co:5432/postgres";
  assert.equal(cleanConnectionString(raw), raw);
});
