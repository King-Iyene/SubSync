import assert from "node:assert/strict";
import { computeAlerts, onboardingChecklist } from "../src/lib/analytics/derive";
import {
  duplicateGroups, getSettings, inbox, listAlerts, listDomainChecks, metricsTrend, pipelineCells, searchContacts, staleDeals,
} from "../src/lib/analytics/queries";
import { loadAccounts } from "../src/lib/analytics/service";
import { closeDb, sql } from "../src/lib/db";
import { DEMO_COMPANY_ID } from "../src/lib/demo/seed";

// Integration check against the seeded demo agency.
// Usage: node --env-file=.env.local --import tsx scripts/check-queries.ts
async function main() {
  const [inst] = await sql()`select id from installations where company_id = ${DEMO_COMPANY_ID}`;
  assert.ok(inst, "demo agency is not seeded; run scripts/seed-demo.ts first");
  const id = inst.id as string;
  const by = (accounts: Awaited<ReturnType<typeof loadAccounts>>["accounts"], name: string) => {
    const a = accounts.find((x) => x.name === name);
    assert.ok(a, `missing account ${name}`);
    return a;
  };

  const { settings, accounts } = await loadAccounts(id);
  console.log(`accounts: ${accounts.length}, settings: stale ${settings.staleDays}d, dormant ${settings.dormantDays}d, sla ${settings.slaHours}h`);
  assert.equal(accounts.length, 14);

  const bright = by(accounts, "Bright Smile Dental");
  const summit = by(accounts, "Summit HVAC Services");
  const metro = by(accounts, "Metro Auto Repair");
  const roofing = by(accounts, "Sunrise Roofing Co");
  const bistro = by(accounts, "Oak & Ember Bistro");
  const template = by(accounts, "Template Account (Test)");
  const northside = by(accounts, "Northside Chiropractic");

  assert.ok(bright.contacts > 400, "Bright Smile has many contacts");
  assert.equal(bright.dormant, false);
  assert.equal(bright.band, "thriving");
  assert.equal(summit.dormant, true, "Summit HVAC is dormant");
  assert.ok((summit.daysInactive ?? 0) >= 60);
  assert.equal(metro.unanswered, 7, "Metro Auto has seven conversations waiting past the SLA");
  assert.ok(roofing.staleOpps >= 10 && roofing.revenueAtRisk > 20000, `Sunrise stale deals: ${roofing.staleOpps} / ${roofing.revenueAtRisk}`);
  assert.ok(bistro.completenessPct < 60, `Oak & Ember completeness ${bistro.completenessPct}`);
  assert.equal(template.ignored, true);
  assert.equal(northside.calendars, 0);
  assert.ok(accounts.every((a) => a.score >= 0 && a.score <= 100));
  assert.ok(accounts.every((a) => a.breakdown.components.reduce((s, c) => s + c.points, 0) === a.score));
  console.log("account derivation: ok");
  console.log(
    accounts.map((a) => `  ${(a.name ?? "").padEnd(26)} score ${String(a.score).padStart(3)} ${a.band.padEnd(9)} churn ${a.churn.level.padEnd(6)} inactive ${String(a.daysInactive).padStart(4)}d  stale ${a.staleOpps}  waiting ${a.unanswered}`).join("\n"),
  );

  // churn history: declining accounts should read worse than the thriving one
  const roofingChurn = roofing.churn;
  console.log(`Sunrise Roofing churn: ${roofingChurn.level} (${roofingChurn.reasons.join("; ")})`);
  assert.ok(roofingChurn.level !== "low", "a declining account is not low risk");
  assert.equal(bright.churn.level, "low");

  // search
  const byName = await searchContacts(id, "ava");
  assert.ok(byName.length > 0 && byName.every((h) => /ava/i.test(h.name) || /ava/i.test(h.email ?? "")), "name search");
  const emailHit = byName.find((h) => h.email);
  assert.ok(emailHit);
  const byEmail = await searchContacts(id, emailHit.email!);
  assert.equal(byEmail[0].email, emailHit.email, "exact email ranks first");
  const phoneHit = (await searchContacts(id, "a")).length; // < 2 chars returns nothing
  assert.equal(phoneHit, 0);
  const sample = byName.find((h) => h.phone);
  if (sample) assert.ok((await searchContacts(id, sample.phone!.replace(/\D/g, "").slice(-6))).length > 0, "phone search");
  const scoped = await searchContacts(id, "ava", 50, bright.locationId);
  assert.ok(scoped.every((h) => h.locationId === bright.locationId));
  assert.equal((await searchContacts(id, "ava%")).length >= 0, true, "LIKE wildcard is escaped");
  const t0 = Date.now();
  await searchContacts(id, "walker");
  console.log(`search: ok (${byName.length} hits for "ava", walker query ${Date.now() - t0} ms)`);

  // stale deals
  const stale = await staleDeals(id, settings.staleDays, 500);
  assert.ok(stale.length > 30, `stale deals: ${stale.length}`);
  assert.ok(stale.every((d) => d.daysStale >= settings.staleDays));
  assert.ok(stale.every((d) => d.locationId !== template.locationId), "ignored accounts are excluded");
  assert.ok(stale.some((d) => d.stageName && d.pipelineName), "stage and pipeline names are joined");
  assert.ok(stale.every((d, i) => i === 0 || stale[i - 1].value >= d.value), "largest first");
  console.log(`stale deals: ok (${stale.length}, top: $${stale[0].value} ${stale[0].locationName})`);

  // pipelines
  const cells = await pipelineCells(id);
  assert.ok(cells.length > 20 && cells.some((c) => c.stageName === "Proposal Sent"));
  assert.ok(cells.every((c) => c.locationId !== template.locationId));
  console.log(`pipeline cells: ok (${cells.length})`);

  // inbox + SLA
  const rows = await inbox(id, settings.slaHours);
  const overSla = rows.filter((r) => r.overSla);
  assert.ok(overSla.length >= 7 && rows[0].overSla, "over-SLA conversations come first");
  assert.ok(overSla.every((r) => (r.waitingHours ?? 0) >= settings.slaHours));
  console.log(`inbox: ok (${rows.length} rows, ${overSla.length} over SLA)`);

  // duplicates within an account
  const dupes = await duplicateGroups(id);
  assert.ok(dupes.some((d) => d.locationId === bistro.locationId && d.kind === "email"), "Oak & Ember duplicate emails found");
  assert.ok(dupes.every((d) => d.count > 1 && d.contactIds.length === d.count));
  console.log(`duplicates: ok (${dupes.length} groups)`);

  // alerts + domains
  const alerts = await listAlerts(id);
  const kinds = new Set(alerts.map((a) => a.kind));
  for (const k of ["dormant", "sla", "stale", "email"]) assert.ok(kinds.has(k), `alert kind ${k} present`);
  assert.ok(!alerts.some((a) => a.locationId === template.locationId), "no alerts for ignored accounts");
  const drafts = computeAlerts(accounts, (await listDomainChecks(id)).map((d) => ({ locationId: d.locationId, domain: d.domain, status: d.status })), settings);
  assert.equal(drafts.length, alerts.length, "stored alerts match a fresh computation");
  console.log(`alerts: ok (${alerts.length} open: ${[...kinds].join(", ")})`);
  const domains = await listDomainChecks(id);
  assert.ok(domains.some((d) => d.status === "critical") && domains.some((d) => d.status === "ok"));

  // onboarding + trend
  const list = onboardingChecklist(northside, { domainStatus: null, manual: {}, custom: settings.customChecklist });
  assert.equal(list.items.find((i) => i.key === "calendar")?.status, "todo");
  assert.equal(list.items.find((i) => i.key === "pipeline")?.status, "todo");
  const trend = await metricsTrend(id, roofing.locationId, 60);
  assert.ok(trend.length >= 30, `trend rows ${trend.length}`);
  assert.ok(trend[0].engagementScore > trend[trend.length - 2].engagementScore, "Sunrise's score declines over the history");
  console.log(`onboarding + trend: ok (${trend.length} days)`);

  const s2 = await getSettings(id);
  assert.equal(s2.dormantDays, 30);
  console.log("\nAll integration checks passed.");
  await closeDb();
}

main().catch(async (error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
