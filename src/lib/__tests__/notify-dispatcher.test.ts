import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, NOTIFICATION_TYPES, typeForAlertKind } from "../notifications/catalog.ts";
import { drain, intentFromAlert, MAX_ATTEMPTS, plan, RETRY_MINUTES, targetsFor, type Intent } from "../notifications/dispatcher.ts";
import { FakeLedger, FakeTransports, makeContext, slackDest, T } from "../../../tests/fixtures/notify-fakes.ts";

// The dispatcher with a fake ledger and fake transports: dedupe, retries, quiet hours, time zones and daylight saving, routing, and who may receive what.

const IN = "inst-1";
const speed = (over: Partial<Intent> = {}): Intent => ({
  type: "speed_breach", locationId: "L1", severity: "warning", dedupeKey: "alert:a1", alertId: "a1",
  values: { account: "Sample Dental", count: 9, target: 15, longest: "40 min" }, ...over,
});

async function run(o: { ctx?: Parameters<typeof makeContext>[0]; intents: Intent[]; at: string; ledger?: FakeLedger; transports?: FakeTransports }) {
  const ctx = makeContext(o.ctx);
  const ledger = o.ledger ?? new FakeLedger();
  const transports = o.transports ?? new FakeTransports();
  const now = T(o.at);
  const planned = await plan(o.intents, ctx, ledger, now);
  const drained = await drain(ctx, ledger, transports, now);
  return { ctx, ledger, transports, planned, drained };
}

const emailCtx = (extra: Parameters<typeof makeContext>[0] = {}) => ({ legacy: { digestEmail: "owner@acme.test" }, ...extra });

test("zero setup: a warning goes to the bell, and to the email address and Slack channel that were already set up", async () => {
  const dest = slackDest("legacy");
  const r = await run({ ctx: emailCtx({ destinations: [dest], legacy: { digestEmail: "owner@acme.test", slackConfigured: true } }), intents: [speed()], at: "2026-11-02T12:00:00Z" });
  assert.equal(r.planned.planned, 3);
  assert.equal(r.transports.to("in_app").length, 1);
  assert.equal(r.transports.to("email", "owner@acme.test").length, 1);
  assert.equal(r.transports.to("slack", "legacy").length, 1);
  assert.match(r.transports.to("email")[0].subject ?? "", /Sample Dental: 9 new leads have waited more than 15 minutes for a reply/);
  assert.deepEqual(r.ledger.byStatus("sent").length, 3);
});

test("with nothing set up at all, the bell still gets the alert (an alert is never lost for want of a channel)", async () => {
  const r = await run({ intents: [speed()], at: "2026-11-02T12:00:00Z" });
  assert.equal(r.planned.planned, 1);
  assert.equal(r.transports.sent.length, 1);
  assert.equal(r.transports.sent[0].channel, "in_app");
});

test("dedupe: the same alert is never sent twice to the same place, however often it is planned", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const a = await run({ ctx: emailCtx(), intents: [speed()], at: "2026-11-02T12:00:00Z", ledger, transports });
  assert.equal(a.planned.planned, 2);
  for (const minute of ["12:05", "12:20", "13:00"]) {
    const again = await run({ ctx: emailCtx(), intents: [speed()], at: `2026-11-02T${minute}:00Z`, ledger, transports });
    assert.equal(again.planned.planned, 0);
    assert.equal(again.planned.duplicates, 2);
  }
  assert.equal(transports.sent.length, 2, "one bell item and one email, in total");
  // A different alert is a different message.
  const other = await run({ ctx: emailCtx(), intents: [speed({ dedupeKey: "alert:a2", alertId: "a2" })], at: "2026-11-02T13:30:00Z", ledger, transports });
  assert.equal(other.planned.planned, 2);
});

test("each email recipient gets their own message with their own stop link", async () => {
  const r = await run({ ctx: { overrides: { speed_breach: { email: true, recipients: ["a@x.test", "b@x.test", "c@x.test"] } } }, intents: [speed()], at: "2026-11-02T12:00:00Z" });
  const mails = r.transports.to("email");
  assert.deepEqual(mails.map((m) => m.target).sort(), ["a@x.test", "b@x.test", "c@x.test"]);
  for (const m of mails) assert.match(m.text ?? "", new RegExp(`Stop these emails: https://app\\.example\\.test/api/email/unsubscribe\\?t=tok-${m.target.replace(".", "\\.")}`));
});

test("quiet hours: a warning at 23:30 waits for 07:00, a critical alert goes at once", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const ctx = emailCtx({ zone: "Africa/Lagos" });
  const night = await run({ ctx, ledger, transports, at: "2026-11-02T22:30:00Z", intents: [speed(), speed({ dedupeKey: "alert:c1", alertId: "c1", severity: "critical", values: { account: "Big Clinic", count: 12, target: 15, longest: "2 h" } })] });
  // The bell is immediate for both; the email goes at once only for the critical one.
  assert.equal(night.transports.to("in_app").length, 2);
  assert.deepEqual(night.transports.to("email").map((m) => m.subject), ["Big Clinic: 12 new leads have waited more than 15 minutes for a reply"]);
  assert.equal(night.ledger.byStatus("held").length, 1);
  assert.equal(night.ledger.byStatus("held")[0].reason, "quiet_hours");
  // Still night at 06:30: nothing more.
  const early = await drain(night.ctx, ledger, transports, T("2026-11-03T05:30:00Z"));
  assert.equal(early.stillHeld, 1);
  assert.equal(transports.to("email").length, 1);
  // 07:05 local: the warning goes out.
  const morning = await drain(night.ctx, ledger, transports, T("2026-11-03T06:05:00Z"));
  assert.equal(morning.sent, 1);
  assert.deepEqual(transports.to("email").map((m) => m.subject), ["Big Clinic: 12 new leads have waited more than 15 minutes for a reply", "Sample Dental: 9 new leads have waited more than 15 minutes for a reply"]);
});

test("everything held overnight leaves as ONE email in the morning", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const ctx = emailCtx({ zone: "Africa/Lagos" });
  const intents = ["a", "b", "c"].map((k) => speed({ dedupeKey: `alert:${k}`, alertId: k, values: { account: `Clinic ${k.toUpperCase()}`, count: 5, target: 15, longest: "" } }));
  const night = await run({ ctx, ledger, transports, at: "2026-11-02T23:00:00Z", intents });
  assert.equal(night.ledger.byStatus("held").length, 3);
  assert.equal(transports.to("email").length, 0);
  await drain(night.ctx, ledger, transports, T("2026-11-03T06:10:00Z"));
  const mails = transports.to("email");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "Acme Agency: 3 new alerts");
  assert.equal(mails[0].rows.length, 3);
  for (const k of ["A", "B", "C"]) assert.match(mails[0].text ?? "", new RegExp(`Clinic ${k}`));
  assert.equal(ledger.byStatus("sent").filter((r) => r.channel === "email").length, 3);
});

test("an alert that was fixed while it waited is not sent", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const ctx = emailCtx({ zone: "Africa/Lagos" });
  const night = await run({ ctx, ledger, transports, at: "2026-11-02T22:30:00Z", intents: [speed()] });
  ledger.openAlerts.delete("a1"); // the problem was fixed before morning
  const morning = await drain(night.ctx, ledger, transports, T("2026-11-03T06:10:00Z"));
  assert.equal(morning.skipped, 1);
  assert.equal(transports.to("email").length, 0);
  assert.equal(ledger.rows.find((r) => r.channel === "email")!.reason, "resolved");
});

test("an address that unsubscribed while a message waited is never emailed", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const night = await run({ ctx: emailCtx({ zone: "Africa/Lagos" }), ledger, transports, at: "2026-11-02T22:30:00Z", intents: [speed()] });
  // The recipient clicked "stop these emails": the next context no longer lists them.
  const later = makeContext({ zone: "Africa/Lagos", overrides: { speed_breach: { email: true, recipients: [] } } });
  const r = await drain(later, ledger, transports, T("2026-11-03T06:10:00Z"));
  assert.equal(r.skipped, 1);
  assert.equal(transports.to("email").length, 0);
  assert.equal(night.ledger.rows.find((x) => x.channel === "email")!.reason, "unsubscribed");
});

test("retries: a temporary failure is tried again after 1, then 5 minutes, and then succeeds; nothing is sent twice", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  transports.script.email = [{ ok: false, permanent: false, code: "http_503" }, { ok: false, permanent: false, code: "http_429" }];
  const ctx = makeContext(emailCtx());
  await plan([speed()], ctx, ledger, T("2026-11-02T12:00:00Z"));
  const row = () => ledger.rows.find((r) => r.channel === "email")!;
  const t0 = T("2026-11-02T12:00:00Z");
  let rep = await drain(ctx, ledger, transports, t0);
  assert.equal(rep.retried, 1);
  assert.equal(row().status, "pending");
  assert.equal(row().attempts, 1);
  assert.equal(row().nextAttemptAt, t0 + RETRY_MINUTES[0] * 60_000);
  // Too early: it is not even tried.
  const calls = transports.calls;
  rep = await drain(ctx, ledger, transports, t0 + 30_000);
  assert.equal(transports.calls, calls);
  assert.equal(rep.sent, 0);
  // After one minute: second try, which fails again, and the wait grows to 5 minutes.
  rep = await drain(ctx, ledger, transports, t0 + 61_000);
  assert.equal(rep.retried, 1);
  assert.equal(row().attempts, 2);
  assert.equal(row().nextAttemptAt, t0 + 61_000 + RETRY_MINUTES[1] * 60_000);
  // After five more minutes: third try works.
  rep = await drain(ctx, ledger, transports, t0 + 61_000 + 5 * 60_000 + 1);
  assert.equal(rep.sent, 1);
  assert.equal(row().status, "sent");
  assert.equal(row().attempts, 3);
  assert.equal(transports.to("email").length, 1, "delivered exactly once");
  // A later drain finds nothing to do.
  rep = await drain(ctx, ledger, transports, t0 + 3_600_000);
  assert.deepEqual(rep, { sent: 0, dryRun: 0, retried: 0, failed: 0, skipped: 0, stillHeld: 0 });
});

test(`retries stop after ${MAX_ATTEMPTS} tries: the message is marked failed and is not tried again`, async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  transports.script.email = Array.from({ length: 20 }, () => ({ ok: false as const, permanent: false, code: "http_500" }));
  const ctx = makeContext(emailCtx());
  await plan([speed()], ctx, ledger, T("2026-11-02T12:00:00Z"));
  let now = T("2026-11-02T12:00:00Z");
  for (let i = 0; i < 10; i++) { await drain(ctx, ledger, transports, now); now += 2 * 3_600_000; }
  const row = ledger.rows.find((r) => r.channel === "email")!;
  assert.equal(row.status, "failed");
  assert.equal(row.reason, "gave_up");
  assert.equal(row.attempts, MAX_ATTEMPTS);
  assert.equal(transports.to("email").length, 0);
});

test("a refusal that trying again cannot fix (a bad address) fails at once and is not retried", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  transports.script.email = [{ ok: false, permanent: true, code: "http_422" }];
  const ctx = makeContext(emailCtx());
  await plan([speed()], ctx, ledger, T("2026-11-02T12:00:00Z"));
  const rep = await drain(ctx, ledger, transports, T("2026-11-02T12:00:00Z"));
  assert.equal(rep.failed, 1);
  const row = ledger.rows.find((r) => r.channel === "email")!;
  assert.equal(row.status, "failed");
  assert.equal(row.reason, "refused");
  const again = await drain(ctx, ledger, transports, T("2026-11-02T20:00:00Z"));
  assert.equal(again.failed + again.retried + again.sent, 0);
});

test("one place failing does not stop the others (the bell still shows it when Slack is down)", async () => {
  const transports = new FakeTransports();
  transports.script.slack = [{ ok: false, permanent: false, code: "http_503" }];
  const r = await run({ ctx: emailCtx({ destinations: [slackDest("sales")], overrides: { speed_breach: { slackDestinations: ["sales"] } } }), intents: [speed()], at: "2026-11-02T12:00:00Z", transports });
  assert.equal(r.transports.to("in_app").length, 1);
  assert.equal(r.transports.to("email").length, 1);
  assert.equal(r.drained.retried, 1);
  assert.equal(r.ledger.rows.find((x) => x.channel === "slack")!.status, "pending");
});

test("a dry run (the live switch is off) is recorded as done and never retried or resent", async () => {
  const transports = new FakeTransports();
  transports.script.email = [{ ok: true, dryRun: true }];
  const r = await run({ ctx: emailCtx(), intents: [speed()], at: "2026-11-02T12:00:00Z", transports });
  assert.equal(r.drained.dryRun, 1);
  assert.equal(r.ledger.rows.find((x) => x.channel === "email")!.status, "dry_run");
  assert.equal(transports.to("email").length, 0, "nothing real was sent");
  const again = await drain(r.ctx, r.ledger, transports, T("2026-11-02T18:00:00Z"));
  assert.equal(again.dryRun + again.sent + again.retried, 0);
});


test("once a day, outside the window: held until the hour, then one email, and the next alert that day waits for tomorrow", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const ctx = emailCtx({ zone: "America/New_York", overrides: { speed_breach: { timing: { frequency: "daily", hour: 8, timezone: "America/New_York" } } } });
  // 17:00 EST on 3 Nov (22:00 UTC): outside the window, so two alerts are held.
  const eve = await run({ ctx, ledger, transports, at: "2026-11-03T22:00:00Z", intents: [speed(), speed({ dedupeKey: "alert:b", alertId: "b", values: { account: "Second Clinic", count: 4, target: 15, longest: "" } })] });
  assert.equal(eve.ledger.byStatus("held").length, 2);
  assert.equal(transports.to("email").length, 0);
  // 08:05 EST on 4 Nov (13:05 UTC): one email with both.
  await drain(eve.ctx, ledger, transports, T("2026-11-04T13:05:00Z"));
  assert.equal(transports.to("email").length, 1);
  assert.equal(transports.to("email")[0].rows.length, 2);
  // A new alert at 09:30 EST the same day: the day's batch has gone, so it waits for 5 Nov.
  const late = await run({ ctx, ledger, transports, at: "2026-11-04T14:30:00Z", intents: [speed({ dedupeKey: "alert:c", alertId: "c" })] });
  assert.equal(late.ledger.byStatus("held").filter((r) => r.channel === "email").length, 1);
  assert.equal(transports.to("email").length, 1);
  await drain(late.ctx, ledger, transports, T("2026-11-05T13:10:00Z"));
  assert.equal(transports.to("email").length, 2);
});

test("a critical alert is never held by a once-a-day setting", async () => {
  const ctx = emailCtx({ zone: "America/New_York", overrides: { speed_breach: { timing: { frequency: "daily", hour: 8, timezone: "America/New_York" } } } });
  const r = await run({ ctx, intents: [speed({ severity: "critical" })], at: "2026-11-03T22:00:00Z" });
  assert.equal(r.transports.to("email").length, 1);
});

test("time zones: the same 08:00 daily setting sends at different UTC moments, and daylight saving moves them", async () => {
  const sendTimes = async (zone: string, fromIso: string, hours: number) => {
    const ledger = new FakeLedger();
    const transports = new FakeTransports();
    const ctx = makeContext(emailCtx({ zone, overrides: { speed_breach: { timing: { frequency: "daily", hour: 8, timezone: zone } } } }));
    // The alert is raised the evening before and waits.
    await plan([speed()], ctx, ledger, T(fromIso));
    const out: string[] = [];
    for (let t = T(fromIso); t < T(fromIso) + hours * 3_600_000; t += 3_600_000) {
      const before = transports.to("email").length;
      await drain(ctx, ledger, transports, t);
      if (transports.to("email").length > before) out.push(new Date(t).toISOString());
    }
    return out;
  };
  assert.deepEqual(await sendTimes("Africa/Lagos", "2026-11-02T18:00:00Z", 24), ["2026-11-03T07:00:00.000Z"]);
  assert.deepEqual(await sendTimes("Asia/Tokyo", "2026-11-02T10:00:00Z", 24), ["2026-11-02T23:00:00.000Z"]);
  // New York, an ordinary winter day: 08:00 EST is 13:00 UTC.
  assert.deepEqual(await sendTimes("America/New_York", "2026-12-09T22:00:00Z", 24), ["2026-12-10T13:00:00.000Z"]);
  // The day the clocks go back (1 Nov): the evening before is still summer time, the 08:00 that follows is winter time, 13:00 UTC.
  assert.deepEqual(await sendTimes("America/New_York", "2026-10-31T22:00:00Z", 24), ["2026-11-01T13:00:00.000Z"]);
  // The day the clocks go forward (8 Mar): 08:00 EDT is 12:00 UTC, an hour earlier in UTC than the day before.
  assert.deepEqual(await sendTimes("America/New_York", "2026-03-07T22:00:00Z", 24), ["2026-03-08T12:00:00.000Z"]);
  // A half-hour zone: 08:30 local in Kolkata (UTC+5:30) is 03:00 UTC, inside the 08:00 hour.
  assert.deepEqual(await sendTimes("Asia/Kolkata", "2026-11-02T15:00:00Z", 24), ["2026-11-03T03:00:00.000Z"]);
});

test("routing: a Slack channel receives only the kinds of message it was chosen for", async () => {
  const dests = [slackDest("sales"), slackDest("admins")];
  const ctx = {
    destinations: dests,
    overrides: { speed_breach: { slackDestinations: ["sales"] }, sync_problem: { slackDestinations: ["admins"] } },
  };
  const a = await run({ ctx, intents: [speed(), { type: "sync_problem", locationId: null, severity: "warning", dedupeKey: "sync:1", values: { account: "Acme Agency", problem: "data is 45 minutes old", minutes: 45 } }], at: "2026-11-02T12:00:00Z" });
  assert.deepEqual(a.transports.to("slack").map((s) => [s.target, s.rows[0].type]).sort(), [["admins", "sync_problem"], ["sales", "speed_breach"]]);
});

test("a client's Slack channel never receives another client's data, nor a message about all accounts", async () => {
  const dests = [slackDest("agency-wide", null), slackDest("client-one", "L1"), slackDest("client-two", "L2")];
  const all = ["client-one", "client-two", "agency-wide"];
  const ctx = {
    destinations: dests,
    overrides: { speed_breach: { slackDestinations: all }, daily_brief: { slackDestinations: all } },
  };
  const a = await run({ ctx, at: "2026-11-02T12:00:00Z", intents: [
    speed({ locationId: "L1", dedupeKey: "alert:one", alertId: "one", values: { account: "Client One", count: 5, target: 15, longest: "" } }),
    speed({ locationId: "L2", dedupeKey: "alert:two", alertId: "two", values: { account: "Client Two", count: 6, target: 15, longest: "" } }),
    { type: "daily_brief", locationId: null, severity: "info", dedupeKey: "daily_brief:2026-11-02", values: { company: "Acme Agency", attention_count: 2, fine_count: 8, date: "2 Nov" }, details: ["Client One: 5 leads waiting", "Client Two: 6 leads waiting"] },
  ] });
  const to = (id: string) => a.transports.to("slack", id).flatMap((s) => s.rows.map((r) => `${r.type}:${r.locationId ?? "all"}`)).sort();
  assert.deepEqual(to("client-one"), ["speed_breach:L1"], "client one's channel gets only client one's alert");
  assert.deepEqual(to("client-two"), ["speed_breach:L2"]);
  assert.deepEqual(to("agency-wide"), ["daily_brief:all", "speed_breach:L1", "speed_breach:L2"], "the agency's own channel gets everything the agency sees");
  for (const s of a.transports.to("slack", "client-one")) assert.doesNotMatch(s.text ?? "", /Client Two/);
});

test("a single-business install is one account, so its channels are not limited", () => {
  const ctx = makeContext({ mode: "business", destinations: [slackDest("sales", "L1")], overrides: { daily_brief: { slackDestinations: ["sales"] } } });
  const t = targetsFor({ type: "daily_brief", locationId: null, severity: "info", dedupeKey: "x", values: {} }, ctx.pref("daily_brief"), ctx);
  assert.deepEqual(t.filter((x) => x.channel === "slack"), [{ channel: "slack", target: "sales" }]);
});

test("a channel that is not connected (waiting, needs permission) is never used", async () => {
  const dests = [slackDest("ok"), slackDest("waiting", null, "pending"), slackDest("broken", null, "needs_reconnect")];
  const r = await run({ ctx: { destinations: dests, overrides: { speed_breach: { slackDestinations: ["ok", "waiting", "broken"] } } }, intents: [speed()], at: "2026-11-02T12:00:00Z" });
  assert.deepEqual(r.transports.to("slack").map((s) => s.target), ["ok"]);
});

test("a channel that was removed or whose routing changed after a message was planned is skipped", async () => {
  const ledger = new FakeLedger();
  const transports = new FakeTransports();
  const night = await run({ ctx: { zone: "Africa/Lagos", destinations: [slackDest("sales")], overrides: { speed_breach: { slackDestinations: ["sales"] } } }, ledger, transports, at: "2026-11-02T22:30:00Z", intents: [speed()] });
  assert.equal(night.ledger.byStatus("held").filter((r) => r.channel === "slack").length, 1);
  const later = makeContext({ zone: "Africa/Lagos", destinations: [], overrides: { speed_breach: { slackDestinations: [] } } });
  const rep = await drain(later, ledger, transports, T("2026-11-03T06:10:00Z"));
  assert.equal(rep.skipped, 1);
  assert.equal(transports.to("slack").length, 0);
});

test("Slack refusing for good (a missing permission) tells the owner to reconnect and stops retrying", async () => {
  const failures: Array<[string, string]> = [];
  const transports = new FakeTransports();
  transports.script.slack = [{ ok: false, permanent: true, code: "missing_scope", needsReconnect: true }];
  const r = await run({ ctx: { destinations: [slackDest("sales")], overrides: { speed_breach: { slackDestinations: ["sales"] } }, onFail: (id, code) => failures.push([id, code]) }, intents: [speed()], at: "2026-11-02T12:00:00Z", transports });
  assert.deepEqual(failures, [["sales", "missing_scope"]]);
  assert.equal(r.ledger.rows.find((x) => x.channel === "slack")!.status, "failed");
  assert.equal(r.drained.retried, 0);
});

test("switched off, or a kind that is not built (tickets): nothing is planned or sent anywhere", async () => {
  const off = await run({ ctx: emailCtx({ overrides: { speed_breach: { enabled: false } } }), intents: [speed()], at: "2026-11-02T12:00:00Z" });
  assert.equal(off.ledger.rows.length, 0);
  assert.equal(off.planned.skipped, 1);
  for (const type of ["new_ticket", "ticket_resolved"] as const) {
    assert.equal(CATALOG[type].active, false);
    const r = await run({ ctx: emailCtx({ overrides: { [type]: { enabled: true, inApp: true, email: true, recipients: ["a@x.test"] } } }), intents: [{ type, locationId: null, severity: "info", dedupeKey: `t:${type}`, values: { client: "C", subject: "S" } }], at: "2026-11-02T12:00:00Z" });
    assert.equal(r.ledger.rows.length, 0, type);
    assert.equal(r.transports.sent.length, 0, type);
  }
});

test("a scheduled brief is never held back by quiet hours: it goes at the time that was chosen", async () => {
  const ctx = emailCtx({ zone: "Africa/Lagos", overrides: { daily_brief: { email: true, recipients: ["owner@acme.test"], timing: { frequency: "daily", hour: 6, timezone: "Africa/Lagos" } } } });
  const r = await run({ ctx, at: "2026-11-02T05:30:00Z", intents: [{ type: "daily_brief", locationId: null, severity: "info", dedupeKey: "daily_brief:2026-11-02", values: { company: "Acme Agency", attention_count: 1, fine_count: 2, date: "2 Nov" }, details: ["x"] }] });
  assert.equal(r.transports.to("email").length, 1, "06:30 local is inside quiet hours, and still goes");
});

test("a brief is not merged into an alert email, and its wording and lines are used", async () => {
  const ctx = emailCtx({ overrides: { daily_brief: { email: true, recipients: ["owner@acme.test"], copy: { title: "Morning, {company}", body: "{attention_count} need you." } } } });
  const r = await run({ ctx, at: "2026-11-02T12:00:00Z", intents: [
    { type: "daily_brief", locationId: null, severity: "info", dedupeKey: "daily_brief:2026-11-02", values: { company: "Acme Agency", attention_count: 3, fine_count: 9, date: "2 Nov" }, details: ["Open pipeline: $1,000"] },
    speed(),
  ] });
  const mails = r.transports.to("email");
  assert.equal(mails.length, 2);
  const brief = mails.find((m) => m.rows[0].type === "daily_brief")!;
  assert.equal(brief.subject, "Morning, Acme Agency");
  assert.match(brief.text ?? "", /3 need you\./);
  assert.match(brief.text ?? "", /Open pipeline: \$1,000/);
});

test("the person's own wording is used for an alert, with real values cleaned", async () => {
  const ctx = emailCtx({ overrides: { speed_breach: { copy: { title: "CALL {account} NOW ({count})", body: null } } } });
  const r = await run({ ctx, intents: [speed({ values: { account: "Evil <b>Clinic</b>", count: 9, target: 15, longest: "" } })], at: "2026-11-02T12:00:00Z" });
  assert.equal(r.transports.to("email")[0].subject, "CALL Evil bClinic/b NOW (9)");
});

test("alerts become the right kind of message, and no alert kind is left without one", () => {
  const kinds = ["dormant", "churn", "sla", "speed", "appointments", "leadflow", "stale", "quality", "sync", "email", "a-kind-from-the-future"];
  const got = Object.fromEntries(kinds.map((k) => [k, typeForAlertKind(k)]));
  assert.deepEqual(got, { dormant: "silent_failure", churn: "other_alerts", sla: "other_alerts", speed: "speed_breach", appointments: "unmarked_appointments", leadflow: "silent_failure", stale: "other_alerts", quality: "other_alerts", sync: "sync_problem", email: "silent_failure", "a-kind-from-the-future": "other_alerts" });
  const i = intentFromAlert({ id: "a9", kind: "speed", severity: "critical", title: "Sample Dental: 9 new leads have waited more than 15 minutes for a reply (longest 40m)", locationId: "L1", detail: { waiting: 9, targetMinutes: 15, oldestWaitMinutes: 130 } }, "Sample Dental");
  assert.equal(i.type, "speed_breach");
  assert.equal(i.dedupeKey, "alert:a9");
  assert.equal(i.alertId, "a9");
  assert.equal(i.values.count, 9);
  assert.equal(i.values.target, 15);
  assert.equal(i.values.longest, "2 h 10 min");
  const d = intentFromAlert({ id: "a8", kind: "dormant", severity: "warning", title: "Sample Dental looks dormant", locationId: "L1", detail: { daysInactive: 40 } }, "Sample Dental");
  assert.equal(d.values.problem, "looks dormant");
  assert.equal(intentFromAlert({ id: "a7", kind: "sla", severity: "warning", title: "X has 3 conversations waiting over 4h", locationId: null, detail: {} }, null).values.account, "A client account");
});

test("every kind of message is known to the dispatcher and each type's defaults are consistent", () => {
  for (const t of NOTIFICATION_TYPES) {
    const info = CATALOG[t];
    assert.ok(info.frequencies.includes(info.defaultFrequency), t);
    if (info.kind === "scheduled") assert.equal(info.frequencies.length, 1, `${t}: a scheduled kind has one frequency`);
  }
});
