import { describe, expect, it, vi } from "vitest";

// Timing at scale on a REAL Postgres (the CI service; never the live database). One insert from generate_series seeds ROWS contacts across a few accounts in a throwaway schema "dqscale" (copies of the
// real tables WITH their real indexes, including the two blocking-key indexes of migration 20261220090000), the real Clean-up v2 code runs against it, and every read must answer in under LIMIT_MS.
// Duplicate detection is a grouping on blocking keys (exact email, last ten phone digits, name keys), never a pairwise comparison. The size of the two new indexes is printed per 1,000,000 contacts.
// Runs only when DQ_SCALE_DB=1 and the database host is local.
//   DQ_SCALE_DB=1 DQ_ROWS=1000000 DATABASE_SSL=off DB_POOL_MAX=1 DATABASE_URL=postgresql://postgres:ci@localhost:5432/postgres npx vitest run tests/unit/dq-scale-db.test.ts --disableConsoleIntercept
const RUN = process.env.DQ_SCALE_DB === "1" && /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "");
const ROWS = Number(process.env.DQ_ROWS) || 1_000_000;
const ACCOUNTS = Number(process.env.DQ_ACCOUNTS) || 4;
const LIMIT_MS = Number(process.env.DQ_LIMIT_MS) || 2000;
const SCAN_LIMIT_MS = Number(process.env.DQ_SCAN_LIMIT_MS) || 120_000;
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

describe.skipIf(!RUN)("Clean-up v2 at scale", () => it("the scan is a grouping, the first screens and lists stay under the limit, and the new indexes stay modest", async () => {
  const { sql, closeDb } = await import("@/lib/db");
  const q = await import("@/lib/analytics/dq-queries");
  const { decodeCur } = await import("@/lib/dq/dq-core");
  const db = sql();
  const inst = "00000000-0000-4000-8000-0000000d9a01";
  await db.unsafe("drop schema if exists dqscale cascade");
  await db.unsafe("create schema dqscale");
  for (const t of ["cached_contacts", "cached_opportunities", "cached_appointments", "touch_events", "locations", "installations", "duplicate_reviews", "cached_conversations", "dq_groups", "dq_events", "dq_source_daily", "dq_scores", "dq_mutes", "dq_forms", "dq_submissions"]) {
    await db.unsafe(`create table dqscale.${t} (like public.${t} including defaults including generated)`);
  }
  await db.unsafe("set search_path to dqscale, public, extensions");
  await db.unsafe("alter table dq_groups add primary key (installation_id, location_id, group_key); alter table dq_source_daily add primary key (installation_id, location_id, day, src); alter table dq_scores add primary key (installation_id, location_id, day)");
  await db`insert into locations (installation_id, location_id, name) select ${inst}::uuid, 'xtest-dq-' || g, 'Account ' || g from generate_series(1, ${ACCOUNTS}) g`;
  const t0 = Date.now();
  // Every 100th contact is a copy of the one 'ACCOUNTS' rows before it (the same account): the same email and phone, so about 1% of contacts are certain duplicates. Sources are 12 names; a third of contacts are leads of the last 90 days.
  await db`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, assigned_to, source, dnd, date_added)
    select ${inst}::uuid, 'xtest-dq-' || (1 + g % ${ACCOUNTS}), 'xtest-c-' || g, (array['Ava','Ben','Chloe','Dan','Eve','Femi','Gus','Hana'])[1 + (case when g % 100 = 0 then g - ${ACCOUNTS} else g end) % 8], 'Lead' || (case when g % 100 = 0 then g - ${ACCOUNTS} else g end),
      'lead' || (case when g % 100 = 0 then g - ${ACCOUNTS} else g end) || '@x.test', '555' || lpad(((case when g % 100 = 0 then g - ${ACCOUNTS} else g end) % 10000000)::text, 7, '0') || '0',
      case when g % 3 = 0 then null else 'u' || (g % 60) end, 'source ' || (g % 12), g % 17 = 0, now() - ((g % 900) || ' days')::interval
    from generate_series(1, ${ROWS}) g`;
  const tb = Date.now();
  const defs = await db`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'cached_contacts'`;
  for (const d of defs) {
    if ((d.indexdef as string).includes("UNIQUE")) continue;
    await db.unsafe((d.indexdef as string).replace(/INDEX ([^ ]+) ON (?:ONLY )?(?:public[.])?cached_contacts/, "INDEX ds_$1 ON dqscale.cached_contacts"));
  }
  await db.unsafe("analyze cached_contacts");
  console.log(`seeded ${ROWS} contacts in ${tb - t0} ms; ${defs.length} indexes built in ${Date.now() - tb} ms`);
  for (const ix of ["dq_c_email_idx", "dq_c_phone10_idx"]) {
    const [r] = await db`select pg_relation_size(${"dqscale.ds_" + ix}::regclass)::float8 bytes`;
    console.log(`INDEX ${ix}: ${(r.bytes / 1_048_576).toFixed(1)} MB for ${ROWS} contacts = ${((r.bytes / 1_048_576) * (1_000_000 / ROWS)).toFixed(1)} MB per 1,000,000`);
  }
  try {
    const slow: string[] = [];
    // Each read (not a scan) runs twice and the second, warm, time counts: the first pays for loading the table into memory, which a running server has already done (same rule as the other scale tests).
    const time = async (label: string, f: () => Promise<unknown>, limit = LIMIT_MS) => { if (limit === LIMIT_MS) await f(); const s = Date.now(); await f(); const ms = Date.now() - s; console.log(`TIMING ${label}: ${ms} ms`); if (ms > limit) slow.push(`${label} ${ms} ms`); };
    for (let a = 1; a <= ACCOUNTS; a++) await time(`scan duplicate groups, account ${a} (${Math.round(ROWS / ACCOUNTS)} contacts)`, () => q.scanGroups(inst, `xtest-dq-${a}`), SCAN_LIMIT_MS);
    await time("recompute 35 days of intake, account 1", () => q.recomputeSourceDaily(inst, "xtest-dq-1", 35), SCAN_LIMIT_MS);
    const S = { inst, allowed: null, location: null };
    await db.unsafe("analyze dq_groups; analyze dq_source_daily");
    await time("tier counts", () => q.tierCounts(S));
    await time("first page, certain", () => q.listGroups(S, "certain", null, 25));
    await time("first page, one account", () => q.listGroups({ ...S, location: "xtest-dq-2" }, "likely", null, 25));
    let after: Array<string | number> | null = null;
    for (let i = 0; i < 4; i++) { const p = await q.listGroups(S, "certain", after, 25); after = p.next ? decodeCur(p.next, 2) : null; await time(`keyset page ${i + 2}`, () => q.listGroups(S, "certain", after, 25)); if (!after) break; }
    await time("sources rollup, 30 days", () => q.sourcesRollup(S, 30));
    await time("source trend", () => q.sourceDays(S, 35, "source 3"));
    await time("leads behind a number, first page", () => q.listLeads(S, { src: "source 3", flag: "ok", days: 30 }, null, 25));
    await time("leads behind a number, count", () => q.countLeads(S, { src: "source 3", flag: "dup", days: 30 }));
    const [g] = await db`select count(*)::int n from dq_groups where installation_id = ${inst} and tier = 'certain'`;
    console.log(`certain groups found: ${g.n} (expected about ${Math.round(ROWS / 100)})`);
    expect(g.n).toBeGreaterThan(ROWS / 100 * 0.9);
    expect(slow, `reads slower than their limit`).toEqual([]);
  } finally {
    await db.unsafe("set search_path to public, extensions");
    await db.unsafe("drop schema if exists dqscale cascade");
    await closeDb();
  }
}));
