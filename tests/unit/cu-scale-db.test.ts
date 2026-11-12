import { describe, expect, it, vi } from "vitest";

// Timing at scale on a REAL Postgres (the CI service; never the live database). One insert from generate_series seeds ROWS contacts across 40 accounts in a throwaway schema "cuscale" (copies of
// the real tables WITH their real indexes), the real Clean-up queries run against it, and every read must answer in under LIMIT_MS. The schema is removed afterwards.
// Runs only when CU_SCALE_DB=1 and the database host is local.
//   CU_SCALE_DB=1 CU_ROWS=1000000 DATABASE_SSL=off DB_POOL_MAX=1 DATABASE_URL=postgresql://postgres:ci@localhost:5432/postgres npx vitest run tests/unit/cu-scale-db.test.ts
const RUN = process.env.CU_SCALE_DB === "1" && /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "");
const ROWS = Number(process.env.CU_ROWS) || 1_000_000;
const LIMIT_MS = Number(process.env.CU_LIMIT_MS) || 2000;
vi.setConfig({ testTimeout: 1_800_000, hookTimeout: 1_800_000 });

describe.skipIf(!RUN)("Clean-up at scale", () => it("first screen and lists stay under the limit", async () => {
  const { sql, closeDb } = await import("@/lib/db");
  const { cappedCounts, listKind } = await import("@/lib/analytics/cu-queries");
  const { decodeCursor } = await import("@/lib/cleanup/cu-core");
  const db = sql();
  const inst = "00000000-0000-4000-8000-0000000c0d01";
  await db.unsafe("drop schema if exists cuscale cascade");
  await db.unsafe("create schema cuscale");
  for (const t of ["cached_contacts", "cached_opportunities", "cached_appointments", "locations"]) await db.unsafe(`create table cuscale.${t} (like public.${t} including defaults including generated)`);
  await db.unsafe("set search_path to cuscale, public, extensions");
  await db`insert into locations (installation_id, location_id, name) select ${inst}::uuid, 'xtest-cu-' || g, 'Account ' || g from generate_series(1, 40) g`;
  await db`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, assigned_to, source, dnd)
    select ${inst}::uuid, 'xtest-cu-' || (1 + g % 40), 'xtest-c-' || g,
      case when g % 5000 = 0 then 'Test' else 'Ava' end, 'Lead' || g, case when g % 7 = 0 then null else 'lead' || g || '@x.test' end,
      case when g % 11 = 0 then null else '555' || lpad((g % 10000000)::text, 7, '0') end, case when g % 3 = 0 then null else 'u' || (g % 60) end, case when g % 13 = 0 then null else 'src' end, g % 17 = 0
    from generate_series(1, ${ROWS}) g`;
  await db`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, status, monetary_value, assigned_to, last_stage_change_at)
    select ${inst}::uuid, 'xtest-cu-' || (1 + g % 40), 'xtest-o-' || g, 'xtest-c-' || g, 'open', 100, case when g % 4 = 0 then null else 'u1' end, now() - ((g % 90) || ' days')::interval from generate_series(1, ${Math.floor(ROWS / 5)}) g`;
  const defs = await db`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('cached_contacts', 'cached_opportunities')`;
  for (const d of defs) {
    if ((d.indexdef as string).includes("UNIQUE")) continue;
    await db.unsafe((d.indexdef as string).replace(/INDEX ([^ ]+) ON (?:ONLY )?(?:public[.])?(cached_\w+)/, "INDEX cs_$1 ON cuscale.$2"));
  }
  await db.unsafe("analyze cached_contacts; analyze cached_opportunities");
  try {
    const slow: string[] = [];
    const time = async (label: string, f: () => Promise<unknown>) => { await f(); const s = Date.now(); await f(); const ms = Date.now() - s; console.log(`TIMING ${label}: ${ms} ms`); if (ms > LIMIT_MS) slow.push(`${label} ${ms} ms`); };
    const S = { inst, allowed: null, location: null };
    await time("first screen: every capped count", () => cappedCounts(S));
    for (const k of ["junk", "no_phone", "no_owner", "bad_phone", "stale_deals", "ownerless_deals", "orphan_deals"] as const) await time(`first page ${k}`, () => listKind(S, k, null));
    await time("one account no_email", () => listKind({ ...S, location: "xtest-cu-3" }, "no_email", null));
    let after = null as ReturnType<typeof decodeCursor>;
    for (let i = 0; i < 4; i++) { const p = await listKind(S, "no_owner", after); after = p.next ? decodeCursor(p.next) : null; await time(`keyset page ${i + 2}`, () => listKind(S, "no_owner", after)); }
    expect(slow, `reads slower than ${LIMIT_MS} ms`).toEqual([]);
  } finally {
    await db.unsafe("set search_path to public, extensions");
    await db.unsafe("drop schema if exists cuscale cascade");
    await closeDb();
  }
}));
