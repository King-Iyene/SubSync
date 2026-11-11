import { describe, expect, it, vi } from "vitest";

// Timing at scale, on an IN-MEMORY Postgres only (never the live database, which is small): ONE insert from generate_series makes ROWS people across 40 accounts, then the search and
// the keyset paging are timed. Runs only when FIND_SCALE_DB=1 and the database host is 127.0.0.1. Prints the numbers.
//   FIND_SCALE_DB=1 FIND_ROWS=1000000 DATABASE_SSL=off DATABASE_URL=postgresql://postgres@127.0.0.1:5646/postgres npx vitest run tests/unit/find-lead-scale-db.test.ts
const RUN = process.env.FIND_SCALE_DB === "1" && /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "");
const ROWS = Number(process.env.FIND_ROWS) || 1_000_000;
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

describe.skipIf(!RUN)("Find a lead at scale", () => it("stays quick", async () => {
  const { sql, closeDb } = await import("@/lib/db");
  const { findPeople } = await import("@/lib/analytics/people-find-queries");
  const { decodeCursor } = await import("@/lib/people/find");
  const db = sql();
  const CO = "xtest-scale-co";
  await db`delete from installations where company_id = ${CO}`;
  const [inst] = await db`insert into installations (company_id) values (${CO}) returning id`;
  await db`insert into locations (installation_id, location_id, name) select ${inst.id}, 'xtest-scale-' || g, 'Account ' || g from generate_series(1, 40) g`;
  const t0 = Date.now();
  await db`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, assigned_to, source, date_added, last_activity_at)
    select ${inst.id}, 'xtest-scale-' || (1 + g % 40), 'xtest-sc-' || g, (array['Ava','Ben','Chloe','Dan','Eve','Femi','Gus','Hana'])[1 + g % 8], 'Lead' || g, 'lead' || g || '@xtest.example', '555' || lpad((g % 10000000)::text, 7, '0'),
      case when g % 5 = 0 then array['hot'] else '{}'::text[] end, case when g % 7 = 0 then 'u' || (g % 60) else null end, 'src' || (g % 12),
      now() - (g % 900 || ' days')::interval, case when g % 3 = 0 then null else now() - (g % 400 || ' hours')::interval end
    from generate_series(1, ${ROWS}) g`;
  await db`analyze cached_contacts`;
  console.log(`seeded ${ROWS} rows in ${Date.now() - t0} ms`);
  const time = async (label: string, f: () => Promise<unknown>) => { const s = Date.now(); await f(); const ms = Date.now() - s; console.log(`TIMING ${label}: ${ms} ms`); return ms; };
  try {
    const out: Record<string, number> = {};
    out.browse = await time("first page, no filter (count capped)", () => findPeople(inst.id as string, null, {}, null, []));
    out.name = await time("name search 'Lead4242'", () => findPeople(inst.id as string, null, { q: "Lead4242" }, null, []));
    out.email = await time("email search", () => findPeople(inst.id as string, null, { q: "lead777777@xtest.example" }, null, []));
    out.phone = await time("phone digits search", () => findPeople(inst.id as string, null, { q: "5550012345" }, null, []));
    out.owner = await time("owner filter", () => findPeople(inst.id as string, null, { owner: "u7" }, null, []));
    out.tag = await time("tag filter", () => findPeople(inst.id as string, null, { tags: ["hot"] }, null, []));
    out.account = await time("one account", () => findPeople(inst.id as string, null, { location: "xtest-scale-3" }, null, []));
" + r.map((x) => x["QUERY PLAN"]).join("
")); } }
    let after = null as ReturnType<typeof decodeCursor>;
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      const s = Date.now();
      const p = await findPeople(inst.id as string, null, { location: "xtest-scale-3" }, after, [], 50);
      worst = Math.max(worst, Date.now() - s);
      after = p.next ? decodeCursor(p.next) : null;
    }
    console.log(`TIMING worst of 6 keyset pages (one account): ${worst} ms`);
    out.pages = worst;
    expect(Object.values(out).every((n) => n < 5000)).toBe(true);
  } finally {
    await db`delete from installations where company_id = ${CO}`;
    await closeDb();
  }
}));
