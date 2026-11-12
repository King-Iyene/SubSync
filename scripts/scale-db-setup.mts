// Prepares a THROWAWAY local Postgres for the scale test: fakes the Supabase roles and extensions, then you run scripts/migrate.ts.
// Refuses any database that is not on localhost. See docs/QA_SCALE.md.
import postgres from "postgres";
import { assertThrowawayDb } from "./scale-guard.ts";

const url = assertThrowawayDb();
const db = postgres(url, { max: 1, ssl: false, onnotice: () => {} });
await db`create schema if not exists extensions`;
await db`create extension if not exists pgcrypto schema extensions`;
await db`create extension if not exists pg_trgm schema extensions`;
for (const r of ["anon", "authenticated"]) {
  if (!(await db`select 1 from pg_roles where rolname = ${r}`).length) await db.unsafe(`create role ${r} nologin`);
}
if (!(await db`select 1 from pg_roles where rolname = 'service_role'`).length) await db.unsafe("create role service_role nologin bypassrls");
console.log("throwaway database ready");
await db.end();
