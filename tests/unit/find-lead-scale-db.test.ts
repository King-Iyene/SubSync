import { describe, expect, it, vi } from "vitest";

// Timing at scale on a REAL Postgres (the CI service; never the live database). ONE insert from generate_series seeds ROWS people across 40 accounts in a throwaway schema "findscale"
// (copies of the real tables WITH their real indexes), the real search code runs against it, and every read must answer in under LIMIT_MS. The schema is removed afterwards.
// Runs only when FIND_SCALE_DB=1 and the database host is local (127.0.0.1 or localhost).
//   FIND_SCALE_DB=1 FIND_ROWS=1000000 DATABASE_SSL=off DB_POOL_MAX=1 DATABASE_URL=postgresql://postgres:ci@localhost:5432/postgres npx vitest run tests/unit/find-lead-scale-db.test.ts
const RUN = process.env.FIND_SCALE_DB === "1" && /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "");
const ROWS = Number(process.env.FIND_ROWS) || 1_000_000;
const LIMIT_MS = Number(process.env.FIND_LIMIT_MS) || 1000;
vi.setConfig({ testTimeout: 1_800_000, hookTimeout: 1_800_000 });

describe.skipIf(!RUN)("Find a lead at scale", () => it("stays under the limit", async () => {
  const { sql, closeDb } = await import("@/lib/db");
  const { findPeople } = await import("@/lib/analytics/people-find-queries");
  const { decodeCursor } = await import("@/lib/people/find");
  const db = sql();
  const inst = "00000000-0000-4000-8000-0000000f1d01";
  await db.unsafe("drop schema if exists findscale cascade");
  await db.unsafe("create schema findscale");
  // Tables first WITHOUT indexes, the real indexes after the rows are in (a bulk build is many times faster than keeping three trigram indexes up to date row by row).
  for (const t of ["cached_contacts", "locations", "call_outcomes"]) await db.unsafe(`create table findscale.${t} (like public.${t} including defaults including generated)`);
  await db.unsafe("set search_path to findscale, public, extensions");
  await db`insert into locations (installation_id, location_id, name) select ${inst}::uuid, 'xtest-scale-' || g, 'Account ' || g from generate_series(1, 40) g`;
  const t0 = Date.now();
  await db`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, assigned_to, source, date_added, last_activity_at)
    select ${inst}::uuid, 'xtest-scale-' || (1 + g % 40), 'xtest-sc-' || g, (array['Ava','Ben','Chloe','Dan','Eve','Femi','Gus','Hana'])[1 + g % 8], 'Lead' || g, 'lead' || g || '@xtest.example', '555' || lpad((g % 10000000)::text, 7, '0'),
      case when g % 5 = 0 then array['hot'] else '{}'::text[] end, case when g % 7 = 0 then 'u' || (g % 60) else null end, 'src' || (g % 12),
      now() - ((g % 900) || ' days')::interval, case when g % 3 = 0 then null else now() - ((g % 400) || ' hours')::interval end
    from generate_series(1, ${ROWS}) g`;
  const tb = Date.now();
  const defs = await db`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'cached_contacts'`;
  for (const d of defs) {
    if ((d.indexdef as string).includes("UNIQUE")) continue; // keys are not what is being timed
    await db.unsafe((d.indexdef as string).replace(/INDEX (S+) ON (?:ONLY )?(?:public.)?cached_contacts/, "INDEX fs_$1 ON findscale.cached_contacts"));
  }
  console.log(`built ${defs.length} indexes in ${Date.now() - tb} ms`);
  await db.unsafe("analyze cached_contacts");
  const sizes = await db`select pg_size_pretty(pg_total_relation_size('findscale.cached_contacts')) total, pg_size_pretty(pg_indexes_size('findscale.cached_contacts')) indexes`;
  console.log(`seeded ${ROWS} rows in ${Date.now() - t0} ms; table+indexes ${sizes[0].total}, indexes alone ${sizes[0].indexes}`);
  try {
    const slow: string[] = [];
    // Each read runs twice and the second (warm) time counts: the first one pays for loading the index into memory, which a running server has already done.
    const time = async (label: string, f: () => Promise<unknown>) => {
      await f();
      const s = Date.now(); await f(); const ms = Date.now() - s;
      console.log(`TIMING ${label}: ${ms} ms`);
      if (ms > LIMIT_MS) slow.push(`${label} ${ms} ms`);
    };
    const A = inst;
    await time("first page, no filter (count capped)", () => findPeople(A, null, {}, null, []));
    await time("name search 'Lead4242'", () => findPeople(A, null, { q: "Lead4242" }, null, []));
    await time("name search, two letters 'Le'", () => findPeople(A, null, { q: "Le" }, null, []));
    await time("email search (whole address)", () => findPeople(A, null, { q: "lead777777@xtest.example" }, null, []));
    await time("phone digits search", () => findPeople(A, null, { q: "5550012345" }, null, []));
    await time("owner filter", () => findPeople(A, null, { owner: "u7" }, null, []));
    await time("tag filter", () => findPeople(A, null, { tags: ["hot"] }, null, []));
    await time("one account", () => findPeople(A, null, { location: "xtest-scale-3" }, null, []));
    await time("name + account", () => findPeople(A, null, { q: "Lead42", location: "xtest-scale-3" }, null, []));
    let after = null as ReturnType<typeof decodeCursor>;
    for (let i = 0; i < 5; i++) {
      const s = Date.now();
      const p = await findPeople(A, null, {}, after, [], 50);
      const ms = Date.now() - s;
      console.log(`TIMING keyset page ${i + 2} (no filter): ${ms} ms`);
      if (ms > LIMIT_MS) slow.push(`keyset page ${i + 2} ${ms} ms`);
      after = p.next ? decodeCursor(p.next) : null;
    }
    expect(slow, `reads slower than ${LIMIT_MS} ms`).toEqual([]);
  } finally {
    await db.unsafe("drop schema findscale cascade");
    await closeDb();
  }
}));
