import assert from "node:assert/strict";
import { test } from "node:test";
import { afterHoursSummary, dailyPriorities, replyAging, setupScore, worstDomainStatus, type BriefInput } from "../analytics/comms-intel.ts";

test("reply aging buckets messages by how long they have waited and counts the critical ones", () => {
  const a = replyAging([0.5, 2, 3.9, 5, 13, 25, 30, 60, 100]);
  assert.deepEqual(a.buckets.map((b) => b.count), [1, 2, 1, 1, 2, 2]);
  assert.equal(a.critical, 4);
  assert.equal(a.total, 9);
  assert.deepEqual(replyAging([-1, NaN]).buckets.map((b) => b.count), [0, 0, 0, 0, 0, 0]);
});

test("after hours share and the suggestion only appear when there is enough data", () => {
  const big = afterHoursSummary({ leads: 100, afterHours: 45, weekend: 20, afterHoursWonValue: 9000, afterHoursWonCount: 2 });
  assert.equal(big.afterHoursPct, 45);
  assert.equal(big.weekendPct, 20);
  assert.ok(big.suggestion);
  assert.equal(afterHoursSummary({ leads: 10, afterHours: 8, weekend: 0, afterHoursWonValue: 0, afterHoursWonCount: 0 }).suggestion, null);
  assert.equal(afterHoursSummary({ leads: 0, afterHours: 0, weekend: 0, afterHoursWonValue: 0, afterHoursWonCount: 0 }).afterHoursPct, null);
});

test("setup score lists what is missing", () => {
  const full = setupScore({ pipelines: 2, calendars: 1, contacts: 50, completenessPct: 80, emailAuth: "ok", daysInactive: 3 });
  assert.deepEqual(full, { score: 100, missing: [] });
  const bare = setupScore({ pipelines: 0, calendars: 0, contacts: 0, completenessPct: 0, emailAuth: "critical", daysInactive: null });
  assert.equal(bare.score, 0);
  assert.equal(bare.missing.length, 6);
  const unknown = setupScore({ pipelines: null, calendars: null, contacts: 10, completenessPct: 70, emailAuth: "unchecked", daysInactive: 5 });
  assert.equal(unknown.missing.length, 0);
  assert.ok(unknown.score > 60 && unknown.score < 100);
});

test("worst email status wins", () => {
  assert.equal(worstDomainStatus([]), "unchecked");
  assert.equal(worstDomainStatus(["ok", "warning"]), "warning");
  assert.equal(worstDomainStatus(["ok", "critical", "warning"]), "critical");
  assert.equal(worstDomainStatus(["ok"]), "ok");
});

const quiet: BriefInput = { newLeadsLastHour: 0, overSla: 0, oldestWaitingHours: null, topDeal: null, vipsNeedingContact: 0, atRiskAccounts: 0, dormantAccounts: 0, renewalsWithin30: 0, staleValue: 0, staleDeals: 0 };

test("daily priorities are empty when nothing needs doing, ordered by urgency, and capped", () => {
  assert.deepEqual(dailyPriorities(quiet), []);
  const busy = dailyPriorities({
    newLeadsLastHour: 2, overSla: 3, oldestWaitingHours: 30, topDeal: { name: "Roof job", account: "Acme", value: 12000, score: 90, reason: "No activity for 60 days" },
    vipsNeedingContact: 4, atRiskAccounts: 1, dormantAccounts: 1, renewalsWithin30: 1, staleValue: 5000, staleDeals: 7,
  });
  assert.equal(busy.length, 5);
  assert.deepEqual(busy.map((p) => p.key), ["speed", "sla", "deal", "vip", "renewal"]);
  assert.match(busy[1].detail, /30 hours/);
  assert.match(busy[0].title, /2 new leads/);
  assert.equal(dailyPriorities({ ...quiet, newLeadsLastHour: 1 })[0].title, "1 new lead in the last hour with no reply");
});
