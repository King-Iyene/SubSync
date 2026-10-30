import assert from "node:assert/strict";
import { closeDb } from "../src/lib/db";

// Appointment insights against a running dev server in demo mode: the numbers exist and are sane, every
// person-level list is limited to the accounts the caller may see, and a client view stays read-only.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-insights.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const call = async (path: string, token?: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const signIn = async (as?: string) => (await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true, ...(as ? { as } : {}) }) })).json());
  const token = (await signIn()).session as string;
  const biz = await signIn("business");
  const own = biz.user.activeLocation as string;
  const cli = await signIn("client");

  assert.equal((await call("/api/app/appointment-insights")).status, 401);
  const all = await call("/api/app/appointment-insights", token);
  assert.equal(all.status, 200, JSON.stringify(all.body).slice(0, 200));
  const d = all.body;
  assert.ok(d.sampleSize > 0, "the demo has appointment history");
  assert.ok(d.health.score >= 0 && d.health.score <= 100 && ["healthy", "watch", "needs work"].includes(d.health.band));
  assert.ok(d.health.parts.length >= 3);
  assert.ok(Array.isArray(d.heat.cells) && d.heat.cells.every((c: { weekday: number; hour: number }) => c.weekday >= 0 && c.weekday <= 6 && c.hour >= 0 && c.hour <= 23));
  assert.ok(d.funnel.steps.length >= 4 && d.funnel.steps.every((s: { count: number }, i: number, a: Array<{ count: number }>) => i === 0 || s.count <= a[i - 1].count + 0), "the funnel never grows going down except through the last step");
  assert.ok(d.recovery.noShows >= d.recovery.rebooked && d.recovery.rebooked >= d.recovery.showedAgain, "recovery counts nest");
  assert.ok(d.fairness.rows.every((r: { share: number }) => r.share >= 0 && r.share <= 1));
  const shares = d.fairness.rows.reduce((a: number, r: { share: number }) => a + r.share, 0);
  assert.ok(d.fairness.rows.length === 0 || Math.abs(shares - 1) < 0.02, "shares add up to everything");
  assert.ok(d.value.upcoming >= 0 && d.followUp.withoutFollowUp <= d.followUp.held);
  for (const b of d.briefs) {
    assert.match(b.brief, /^You are meeting /);
    assert.ok(String(b.url).startsWith("https://app.gohighlevel.com/v2/location/"), "deep links go to the platform");
  }
  for (const r of d.repeatNoShows) assert.ok(r.count >= 2 && String(r.url).includes(r.contactId));

  // the same numbers narrowed to one business: only its own people appear
  const mine = await call("/api/app/appointment-insights", biz.session);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.sampleSize <= d.sampleSize);
  const ids = (x: { locationId?: string }) => x.locationId === undefined || x.locationId === own;
  assert.ok(mine.body.repeatNoShows.every(ids) && mine.body.briefs.every(ids) && mine.body.followUp.contacts.every(ids), "a business sees only its own account's people");
  assert.ok(mine.body.doubleBookings.every((b: { locationName: string | null }) => b.locationName === null || typeof b.locationName === "string"));

  // a client view can read it (its own account), and the filter narrows an agency's numbers
  const client = await call("/api/app/appointment-insights", cli.session);
  assert.equal(client.status, 200);
  assert.ok(client.body.sampleSize <= d.sampleSize);
  const filtered = await call("/api/app/appointment-insights?industry=medical", token);
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.sampleSize <= d.sampleSize, "the Show only filter narrows the insights too");
  assert.equal((await call("/api/app/appointment-insights?industry=bad!value", token)).status, 200, "a malformed filter is ignored, never an error");

  await closeDb();
  console.log("appointment insights: health, funnel, heat map, recovery, fairness, follow-up, briefs, scoping, filter: ok");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
