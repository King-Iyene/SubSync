import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDigest, computeAlerts, deriveAccount, isSlackWebhook, onboardingChecklist, toCsv,
  type AccountRow, type AccountSettings,
} from "../analytics/derive.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const settings: AccountSettings = { staleDays: 30, dormantDays: 30, slaHours: 4 };
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function row(over: Partial<AccountRow> = {}): AccountRow {
  return {
    locationId: "L1", name: "Acme Dental", email: "a@acme.com", phone: "555", website: null,
    ignored: false, owner: null, contacts: 200, withEmail: 180, withPhone: 160, withTags: 100,
    new30d: 20, active90d: 150, openOpps: 10, openValue: 10_000, staleOpps: 1, staleValue: 500,
    wonCount: 8, lostCount: 4, wonValue: 16_000, unread: 2, unanswered: 0,
    calendars: 2, pipelines: 1, lastActivityAt: iso(1), syncError: null, contactsSyncedAt: iso(0), ...over,
  };
}

test("a healthy account derives sensible numbers", () => {
  const a = deriveAccount(row(), settings, [], NOW);
  assert.equal(a.emailPct, 90);
  assert.equal(a.phonePct, 80);
  assert.equal(a.tagPct, 50);
  assert.equal(a.completenessPct, 73);
  assert.equal(a.daysInactive, 1);
  assert.equal(a.dormant, false);
  assert.equal(a.band, "thriving");
  assert.equal(a.winRate, 8 / 12);
  assert.equal(a.expectedRevenue, Math.round(10_000 * (8 / 12)));
  assert.equal(a.revenueAtRisk, 500);
  assert.equal(a.followUpRevenueAtRisk, null);
});

test("the score breakdown adds up to the score and explains itself", () => {
  const a = deriveAccount(row(), settings, [], NOW);
  assert.equal(a.breakdown.components.reduce((s, c) => s + c.points, 0), a.score);
  assert.ok(a.breakdown.components.every((c) => c.why.length > 0 && c.points <= c.max));
});

test("an empty account has no division by zero and is dormant", () => {
  const a = deriveAccount(row({ contacts: 0, withEmail: 0, withPhone: 0, withTags: 0, new30d: 0, active90d: 0, openOpps: 0, openValue: 0, staleOpps: 0, wonCount: 0, lostCount: 0, wonValue: 0, lastActivityAt: null }), settings, [], NOW);
  assert.equal(a.completenessPct, 0);
  assert.equal(a.daysInactive, null);
  assert.equal(a.dormant, true);
  assert.equal(a.winRate, null);
  assert.ok(a.score >= 0 && a.score <= 100);
});

test("unanswered conversations estimate follow-up revenue at risk", () => {
  const a = deriveAccount(row({ unanswered: 3 }), settings, [], NOW);
  assert.equal(a.followUpRevenueAtRisk, Math.round(3 * 2000 * (8 / 12)));
});

test("win rate needs at least five closed deals", () => {
  assert.equal(deriveAccount(row({ wonCount: 2, lostCount: 2 }), settings, [], NOW).winRate, null);
});

test("onboarding checklist mixes automatic, manual and unknown items", () => {
  const a = deriveAccount(row({ calendars: 0 }), settings, [], NOW);
  const { items, completionPct } = onboardingChecklist(a, {
    domainStatus: null, manual: { "manual:kickoff": true, "custom:Sign contract": true }, custom: ["Sign contract", "Send gift"],
  });
  const by = (k: string) => items.find((i) => i.key === k);
  assert.equal(by("profile")?.status, "done");
  assert.equal(by("calendar")?.status, "todo");
  assert.equal(by("email_auth")?.status, "unknown");
  assert.equal(by("workflows")?.status, "unknown");
  assert.equal(by("manual:kickoff")?.status, "done");
  assert.equal(by("custom:Sign contract")?.status, "done");
  assert.equal(by("custom:Send gift")?.status, "todo");
  const known = items.filter((i) => i.status !== "unknown");
  assert.equal(completionPct, Math.round((known.filter((i) => i.status === "done").length / known.length) * 100));
});

test("alert rules fire for dormant, SLA, stale and email problems, and skip ignored accounts", () => {
  const dormant = deriveAccount(row({ locationId: "D", name: "Dormant Co", lastActivityAt: iso(75) }), settings, [], NOW);
  const sla = deriveAccount(row({ locationId: "S", name: "Slow Co", unanswered: 6 }), settings, [], NOW);
  const stale = deriveAccount(row({ locationId: "T", name: "Stale Co", staleOpps: 5, openOpps: 10, staleValue: 12_345 }), settings, [], NOW);
  const ignored = deriveAccount(row({ locationId: "I", name: "Test", ignored: true, lastActivityAt: iso(200) }), settings, [], NOW);
  const alerts = computeAlerts([dormant, sla, stale, ignored], [{ locationId: "D", domain: "dormant.com", status: "critical" }, { locationId: null, domain: "fine.com", status: "ok" }], settings);
  const keys = alerts.map((a) => a.dedupeKey).sort();
  assert.deepEqual(keys, ["dormant:D", "email:dormant.com", "sla:S", "stale:T"]);
  assert.equal(alerts.find((a) => a.dedupeKey === "dormant:D")?.severity, "critical");
  assert.equal(alerts.find((a) => a.dedupeKey === "sla:S")?.severity, "critical");
  assert.match(alerts.find((a) => a.dedupeKey === "stale:T")?.title ?? "", /\$12,345/);
});

test("the digest lists at-risk accounts and totals", () => {
  const bad = deriveAccount(row({ name: "Bad Co", lastActivityAt: iso(90), staleValue: 1000, unanswered: 2 }), settings, [], NOW);
  const good = deriveAccount(row({ name: "Good Co" }), settings, [], NOW);
  const text = buildDigest("Test Agency", [bad, good], 3);
  assert.match(text, /Test Agency/);
  assert.match(text, /2 client accounts, 1 dormant, 3 open alerts/);
  assert.match(text, /Bad Co/);
  assert.doesNotMatch(text, /Good Co/);
});

test("only Slack incoming webhooks are accepted", () => {
  assert.equal(isSlackWebhook("https://hooks.slack.com/services/T0/B0/xyz"), true);
  assert.equal(isSlackWebhook("http://hooks.slack.com/services/T0/B0/xyz"), false);
  assert.equal(isSlackWebhook("https://evil.example.com/services/T0/B0/xyz"), false);
  assert.equal(isSlackWebhook("https://hooks.slack.com.evil.com/services/x"), false);
  assert.equal(isSlackWebhook("nonsense"), false);
  assert.equal(isSlackWebhook(null), false);
});

test("CSV escapes quotes, commas, newlines and blocks formula injection", () => {
  const csv = toCsv(
    [{ n: 'He said "hi", ok', f: "=HYPERLINK(\"x\")", v: 5, nul: null, nl: "a\nb" }],
    [
      { label: "Name", value: (r) => r.n }, { label: "Formula", value: (r) => r.f },
      { label: "Value", value: (r) => r.v }, { label: "Null", value: (r) => r.nul }, { label: "NL", value: (r) => r.nl },
    ],
  );
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Name,Formula,Value,Null,NL");
  assert.equal(lines[1], '"He said ""hi"", ok","\'=HYPERLINK(""x"")",5,,"a\nb"');
});
