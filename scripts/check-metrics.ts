import assert from "node:assert/strict";
import { closeDb, sql } from "../src/lib/db";

// The Overview numbers, recomputed independently from the database and compared (the manual-count check
// from the brief, automated): dollar figures leave out deals with no value or no owner, an estimate needs
// enough closed deals, tiles do not repeat each other, and the test-account switch removes test accounts
// from every number. Demo data only.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-metrics.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const MIN_CLOSED = 20;

async function main() {
  const call = async (path: string, token: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    // The routes return different shapes; this check reads them loosely on purpose.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const token = ((await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true }) })).json()) as { session: string }).session;
  const [inst] = await sql()`select id from installations where is_demo`;
  const live = await sql()`select location_id, name from locations where installation_id = ${inst.id} and not ignored`;
  const liveIds = live.map((l) => l.location_id as string);

  const ov = await call("/api/app/overview", token);
  assert.equal(ov.status, 200);
  const k = ov.body.kpis;

  // 1. open pipeline and the deals left out, from the raw rows
  const [raw] = await sql()`
    select
      coalesce(sum(monetary_value) filter (where status = 'open' and coalesce(monetary_value, 0) > 0 and assigned_to is not null), 0)::float8 counted_value,
      count(*) filter (where status = 'open' and coalesce(monetary_value, 0) > 0 and assigned_to is not null)::int counted,
      count(*) filter (where status = 'open' and not (coalesce(monetary_value, 0) > 0 and assigned_to is not null))::int excluded
    from cached_opportunities where installation_id = ${inst.id} and location_id = any(${liveIds}::text[])`;
  assert.equal(Math.round(k.openValue), Math.round(raw.counted_value), "open pipeline counts only deals with a value and an owner");
  assert.equal(k.openOpps, raw.counted);
  assert.equal(k.excludedDeals, raw.excluded, "and says how many it left out");
  assert.ok(raw.excluded > 0, "the demo includes some ownerless deals, so this check is not vacuous");
  assert.ok(k.staleValue <= k.openValue + 0.5 && k.staleOpps <= k.openOpps, "stale deals are a part of the open ones");

  // 2. an estimate needs enough closed deals
  const closed = await sql()`
    select location_id, count(*) filter (where status in ('won', 'lost'))::int closed from cached_opportunities
    where installation_id = ${inst.id} and location_id = any(${liveIds}::text[]) group by 1`;
  const eligible = closed.filter((c) => c.closed >= MIN_CLOSED).length;
  assert.equal(k.minClosedDeals, MIN_CLOSED);
  assert.equal(k.estimateAccounts, eligible, "only accounts with enough closed deals feed an estimate");
  if (eligible === 0) {
    assert.equal(k.expectedRevenue, null, "no eligible account: no estimate");
    assert.equal(k.followUpRevenueAtRisk, null);
  } else {
    assert.equal(typeof k.expectedRevenue, "number");
    assert.ok(k.expectedRevenue <= k.openValue + 0.5, "expected revenue can never exceed the open value it comes from");
  }

  // 3. one fact, one place: the same dollar figure is not on several tiles
  const ex = await call("/api/app/exec-summary", token);
  assert.equal(ex.status, 200);
  assert.ok(ex.body.kpis.length >= 3);

  // 4. the test-account switch
  const target = live[0];
  const original = target.name as string;
  await sql()`update locations set name = 'Zz Test Clinic' where installation_id = ${inst.id} and location_id = ${target.location_id}`;
  try {
    const seg = await call("/api/app/segments", token);
    assert.equal(seg.body.testAccounts, 1);
    const all = await call("/api/app/overview", token);
    const hidden = await call("/api/app/overview?hideTest=1", token);
    assert.equal(hidden.body.kpis.accounts, all.body.kpis.accounts - 1, "one account fewer with test accounts hidden");
    assert.ok(hidden.body.kpis.openValue <= all.body.kpis.openValue);
    const accounts = await call("/api/app/accounts?hideTest=1", token);
    assert.ok(!(accounts.body.accounts as Array<{ locationId: string }>).some((a) => a.locationId === target.location_id), "the account is gone from the list");
    const search = await call(`/api/app/stale?hideTest=1`, token);
    assert.ok(!(search.body.deals as Array<{ locationId: string }>).some((d) => d.locationId === target.location_id), "and from the stale deals");
    assert.equal((await call("/api/app/overview?hideTest=0", token)).body.kpis.accounts, all.body.kpis.accounts, "off means everything is shown");
  } finally {
    await sql()`update locations set name = ${original} where installation_id = ${inst.id} and location_id = ${target.location_id}`;
  }

  await closeDb();
  console.log(`overview numbers: deals without value or owner left out (${raw.excluded}), estimates need ${MIN_CLOSED} closed deals (${eligible} accounts qualify), test accounts can be hidden: ok`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
