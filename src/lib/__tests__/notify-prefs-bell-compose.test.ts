import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ageText, isSnoozeChoice, snoozeUntil, unreadCount, visibleItems, type BellItem } from "../notifications/bell.ts";
import { CATALOG, NOTIFICATION_TYPES, typeForAlertKind } from "../notifications/catalog.ts";
import { appLink, composeEmail, composeSlack, hashFor, type Item } from "../notifications/compose.ts";
import { applyUpdate, defaultPref, LEGACY_DESTINATION, MAX_RECIPIENTS, parseUpdate, resolvePref, toStored, type Legacy } from "../notifications/prefs.ts";
import { dailyLines, headlineBit, shortDate, weeklyLines } from "../notifications/brief-lines.ts";
import type { Headline } from "../analytics/digest-intel.ts";

const NONE: Legacy = { slackConfigured: false, digestEnabled: false, digestEmail: null, digestHour: null, digestTimezone: null, alertQuietHours: true };

// ---------------- preferences ----------------

test("zero setup: defaults come from what people already set (email, Slack, brief switch and hour, quiet hours)", () => {
  const empty = defaultPref("speed_breach", NONE, []);
  assert.deepEqual([empty.enabled, empty.inApp, empty.email, empty.recipients, empty.slackDestinations], [true, true, false, [], []]);
  assert.equal(empty.timing.hour, 8);
  assert.equal(empty.timing.quietOn, true);
  const legacy: Legacy = { slackConfigured: true, digestEnabled: true, digestEmail: "Owner@Acme.test", digestHour: 6, digestTimezone: "Africa/Lagos", alertQuietHours: false };
  const alert = defaultPref("speed_breach", legacy, []);
  assert.deepEqual([alert.email, alert.recipients, alert.slackDestinations, alert.timing.quietOn], [true, ["owner@acme.test"], [LEGACY_DESTINATION], false]);
  const brief = defaultPref("daily_brief", legacy, []);
  assert.deepEqual([brief.slackDestinations, brief.timing.hour, brief.timing.timezone, brief.email], [[LEGACY_DESTINATION], 6, "Africa/Lagos", false]);
  assert.deepEqual(defaultPref("daily_brief", { ...legacy, digestEnabled: false }, []).slackDestinations, [], "the brief goes to Slack only if it was switched on");
  assert.equal(defaultPref("weekly_summary", legacy, []).email, true);
  // Connected channels win over the older saved one.
  assert.deepEqual(defaultPref("speed_breach", legacy, [{ id: "d1", locationId: null }, { id: "d2", locationId: "L1" }]).slackDestinations, ["d1", "d2"]);
});

test("tickets are listed but inactive: off, and they cannot be changed", () => {
  for (const t of ["new_ticket", "ticket_resolved"] as const) {
    assert.equal(CATALOG[t].active, false);
    assert.equal(defaultPref(t, NONE, []).enabled, false);
    assert.equal(resolvePref(t, { enabled: true }, NONE, []).enabled, false);
    const r = parseUpdate(t, { enabled: true }, new Set());
    assert.equal(r.ok, false);
  }
});

test("a stored choice wins over the default; a damaged or invalid stored piece falls back to the default", () => {
  const p = resolvePref("speed_breach", {
    enabled: false, channels: { inApp: false, email: true, slackDestinations: ["a", "a", "b"] }, recipients: ["X@y.test", "bad", "x@y.test", "z@y.test"],
    timing: { frequency: "daily", hour: 6, weekday: "Fri", timezone: "Asia/Tokyo", quietOn: false, quietStart: 22, quietEnd: 5, criticalBypass: false },
    copy: { title: "{account} now", body: "ok" },
  }, NONE, []);
  assert.deepEqual([p.enabled, p.inApp, p.email, p.recipients, p.slackDestinations], [false, false, true, ["x@y.test", "z@y.test"], ["a", "b"]]);
  assert.deepEqual([p.timing.frequency, p.timing.hour, p.timing.weekday, p.timing.timezone, p.timing.quietOn, p.timing.quietStart, p.timing.criticalBypass], ["daily", 6, "Fri", "Asia/Tokyo", false, 22, false]);
  assert.deepEqual(p.copy, { title: "{account} now", body: "ok" });
  const broken = resolvePref("speed_breach", { channels: "nope", recipients: "nope", timing: { frequency: "hourly", hour: 99, weekday: "Funday", timezone: "Mars/X", quietStart: -1 }, copy: { title: "{nope}", body: "<b>" } }, NONE, []);
  assert.deepEqual(broken, defaultPref("speed_breach", NONE, []));
  // Frequency must be one the kind allows (a sync problem is always immediate; the brief is always daily).
  assert.equal(resolvePref("sync_problem", { timing: { frequency: "daily" } }, NONE, []).timing.frequency, "immediate");
  assert.equal(resolvePref("daily_brief", { timing: { frequency: "weekly" } }, NONE, []).timing.frequency, "daily");
});

test("a change from the screen is checked, with a sentence for each way it can be wrong", () => {
  const known = new Set(["d1", "legacy"]);
  const bad = (body: unknown, re: RegExp, type: Parameters<typeof parseUpdate>[0] = "speed_breach") => {
    const r = parseUpdate(type, body, known);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match((r as { error: string }).error, re);
  };
  bad({ enabled: "yes" }, /on or off/);
  bad({ recipients: ["fine@x.test", "not-an-address"] }, /not-an-address" is not an email address/);
  bad({ recipients: "a@b.test" }, /list of email addresses/);
  bad({ recipients: Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.test`) }, /Up to 10 email addresses/);
  bad({ slackDestinations: ["d1", "unknown"] }, /not connected/);
  bad({ timing: { hour: 24 } }, /0 to 23/);
  bad({ timing: { hour: 7.5 } }, /0 to 23/);
  bad({ timing: { weekday: "Funday" } }, /day of the week/);
  bad({ timing: { timezone: "Mars/Olympus" } }, /not a time zone/);
  bad({ timing: { frequency: "weekly" } }, /can be sent: as it happens or once a day/);
  bad({ timing: { frequency: "daily" } }, /as it happens/, "sync_problem");
  bad({ timing: { quietStart: 30 } }, /whole hour/);
  const ok = parseUpdate("speed_breach", { email: true, recipients: [" A@X.test ", "a@x.test", "b@x.test"], slackDestinations: ["d1", "legacy"], timing: { frequency: "daily", hour: 7, timezone: null, quietOn: true } }, known);
  assert.deepEqual(ok, { ok: true, update: { email: true, recipients: ["a@x.test", "b@x.test"], slackDestinations: ["d1", "legacy"], timing: { frequency: "daily", hour: 7, timezone: null, quietOn: true } } });
  assert.ok(ok.ok);
  const next = applyUpdate(defaultPref("speed_breach", NONE, []), ok.update);
  assert.deepEqual([next.email, next.recipients, next.timing.frequency, next.timing.hour, next.timing.weekday, next.timing.quietStart], [true, ["a@x.test", "b@x.test"], "daily", 7, "Mon", 21]);
  // What is stored reads back the same.
  assert.deepEqual(resolvePref("speed_breach", toStored(next), NONE, [{ id: "d1", locationId: null }]), next);
  // Unknown fields are ignored, never saved.
  assert.deepEqual(parseUpdate("speed_breach", { evil: "<script>", enabled: true }, known), { ok: true, update: { enabled: true } });
});

// ---------------- the bell ----------------

const NOW = Date.parse("2026-11-02T12:00:00Z");
const item = (o: Partial<BellItem>): BellItem => ({ id: "i", type: "speed_breach", severity: "warning", title: "t", body: null, link: { view: "speed", locationId: null }, locationId: "L1", createdAt: NOW - 60_000, readAt: null, dismissedAt: null, snoozedUntil: null, resolved: false, ...o });

test("the bell lists what is not dismissed, snoozed, fixed or old, most severe first; unread counts only those", () => {
  const items = [
    item({ id: "a", severity: "info", createdAt: NOW - 1000 }), item({ id: "b", severity: "critical", createdAt: NOW - 5000, readAt: NOW - 100 }),
    item({ id: "c", severity: "warning", createdAt: NOW - 3000 }), item({ id: "dismissed", dismissedAt: NOW - 10 }),
    item({ id: "snoozed", snoozedUntil: NOW + 3_600_000 }), item({ id: "wokeUp", snoozedUntil: NOW - 1, severity: "warning", createdAt: NOW - 9000 }),
    item({ id: "fixed", resolved: true }), item({ id: "old", createdAt: NOW - 15 * 86_400_000 }),
  ];
  assert.deepEqual(visibleItems(items, NOW).map((i) => i.id), ["b", "c", "wokeUp", "a"]);
  assert.equal(unreadCount(items, NOW), 3, "b is read, so c, wokeUp and a count");
  assert.equal(unreadCount([], NOW), 0);
});

test("snooze: one hour, four hours, and 08:00 tomorrow in the person's own zone (daylight saving included)", () => {
  assert.equal(snoozeUntil("1h", NOW, "UTC"), NOW + 3_600_000);
  assert.equal(snoozeUntil("4h", NOW, "UTC"), NOW + 4 * 3_600_000);
  assert.equal(new Date(snoozeUntil("tomorrow", Date.parse("2026-11-02T15:00:00Z"), "Africa/Lagos")).toISOString(), "2026-11-03T07:00:00.000Z");
  assert.equal(new Date(snoozeUntil("tomorrow", Date.parse("2026-11-02T23:00:00Z"), "Asia/Tokyo")).toISOString(), "2026-11-03T23:00:00.000Z", "08:00 on the 4th in Tokyo");
  // The night the clocks go back in New York: tomorrow 08:00 is EST (13:00 UTC), not EDT.
  assert.equal(new Date(snoozeUntil("tomorrow", Date.parse("2026-10-31T20:00:00Z"), "America/New_York")).toISOString(), "2026-11-01T13:00:00.000Z");
  // A zone that cannot be read counts as UTC.
  assert.equal(new Date(snoozeUntil("tomorrow", Date.parse("2026-11-02T15:00:00Z"), "Nowhere/Land")).toISOString(), "2026-11-03T08:00:00.000Z");
  assert.equal(isSnoozeChoice("1h"), true);
  assert.equal(isSnoozeChoice("forever"), false);
});

test("how old an item is, in words", () => {
  assert.equal(ageText(NOW, NOW), "just now");
  assert.equal(ageText(NOW - 5 * 60_000, NOW), "5 min ago");
  assert.equal(ageText(NOW - 3 * 3_600_000, NOW), "3 h ago");
  assert.equal(ageText(NOW - 86_400_000, NOW), "1 day ago");
  assert.equal(ageText(NOW - 3 * 86_400_000, NOW), "3 days ago");
});

// ---------------- composing ----------------

const alertItem = (title: string, severity: Item["severity"] = "warning"): Item => ({ title, body: "Open Speed to lead.", details: [], severity, link: { view: "speed", locationId: null } });

test("an email for one alert uses its words as the subject; several are one email with a count; a test is marked; the stop link is always there", () => {
  const one = composeEmail([alertItem("Sample Dental: 9 leads waiting")], { company: "Acme", appUrl: "https://app.test/", stopUrl: "https://app.test/stop?t=1" });
  assert.equal(one.subject, "Sample Dental: 9 leads waiting");
  assert.match(one.text, /Open it: https:\/\/app\.test\/app#speed/);
  assert.match(one.text, /Stop these emails: https:\/\/app\.test\/stop\?t=1/);
  assert.match(one.html, /Stop these emails/);
  const many = composeEmail([alertItem("A"), alertItem("B", "critical"), alertItem("C")], { company: "Acme", appUrl: "https://app.test", stopUrl: null });
  assert.equal(many.subject, "Acme: 3 new alerts (1 critical)");
  assert.ok(many.text.indexOf("- B") < many.text.indexOf("- A"), "critical first");
  assert.doesNotMatch(many.text, /Stop these emails/);
  const test = composeEmail([alertItem("A")], { company: "Acme", appUrl: "https://app.test", stopUrl: null, test: true });
  assert.equal(test.subject, "[TEST] A");
  assert.match(test.text, /This is a test\. Nothing is wrong\./);
});

test("markup in a message is escaped in the email and Slack mentions cannot be made", () => {
  const nasty: Item = { title: 'Evil "Clinic" & <b>Co</b>', body: "<script>x</script>", details: ["<!channel> look"], severity: "critical", link: { view: "account", locationId: 'L1"><img src=x>' } };
  const mail = composeEmail([nasty], { company: "A", appUrl: "https://app.test", stopUrl: 'https://s.test/?a="b"' });
  assert.doesNotMatch(mail.html, /<script>|<b>Co|<img(?! src="https:\/\/app\.test\/brand\/)|<!channel>/);
  assert.match(mail.html, /&lt;script&gt;/);
  const slack = composeSlack([nasty], { company: "A", appUrl: "https://app.test" });
  assert.doesNotMatch(slack, /<!channel>|<script>|<b>/);
  assert.match(slack, /&lt;!channel&gt; look/);
  assert.match(slack, /Evil "Clinic" &amp; &lt;b&gt;Co&lt;\/b&gt;/);
});

test("links open the right page in the app; an account opens the account", () => {
  assert.equal(hashFor({ view: null, locationId: null }), "today");
  assert.equal(hashFor({ view: "speed", locationId: null }), "speed");
  assert.equal(hashFor({ view: "account", locationId: "abc123" }), "account=abc123");
  assert.equal(appLink("https://app.test/", { view: "account", locationId: "abc123" }), "https://app.test/app#account=abc123");
});

test("a Slack message for several alerts is one post with a count", () => {
  const s = composeSlack([alertItem("A"), alertItem("B", "critical")], { company: "Acme", appUrl: "https://app.test" });
  assert.match(s, /^\*Acme: 2 new alerts\*/);
  assert.match(s, /:red_circle: B/);
  assert.match(s, /<https:\/\/app\.test\/app#speed\|Open it>/);
});

test("the brief and weekly lines say only what was measured", () => {
  const h = (label: string, today: number, vsYesterday: number | null, vsAvg: number | null, money = false) => ({ key: label, label, money, change: { today, vsYesterday, vsAvg } }) as unknown as Headline;
  assert.equal(headlineBit(h("Open pipeline", 184000, 4, null, true), "yesterday"), "Open pipeline: $184,000 (+4% vs yesterday)");
  assert.equal(headlineBit(h("Stale deals", 3, null, -20), "yesterday"), "Stale deals: 3", "no percentage when it was too small to measure");
  assert.equal(headlineBit(h("Stale deals", 3, null, -20), "average"), "Stale deals: 3 (-20% vs the last 7 days)");
  const lines = dailyLines({ headlines: [h("Stale deals", 3, null, null)], attention: [{ name: "A", items: [{ title: "Slow" }, { title: "Quiet" }] }], fine: 2, freshnessLabel: "Updated 4 min ago" });
  assert.deepEqual(lines, ["Stale deals: 3", "1 account need attention:".replace("need", "needs"), "A: Slow; quiet", "2 accounts fine.", "Updated 4 min ago."]);
  assert.match(dailyLines({ headlines: [], attention: [], fine: 0, freshnessLabel: "x" })[0], /Nothing needs attention today/);
  const weekly = weeklyLines({ headlines: [], attention: [], fine: 5, freshnessLabel: "x", facts: ["9 of 12 new leads answered in time."] });
  assert.deepEqual(weekly, ["The last 14 days:", "9 of 12 new leads answered in time.", "Every account is within its own normal range.", "5 accounts fine."]);
  assert.equal(shortDate(new Date("2026-11-02T12:00:00Z"), "Africa/Lagos"), "2 Nov");
  assert.equal(shortDate(new Date("2026-11-02T12:00:00Z"), "Not/AZone"), "2 Nov");
});

// ---------------- wording rules and sending rules over the source ----------------

test("no message, label or hint uses the names of the CRM, or the word sub-account (white-label rule)", () => {
  const banned = /go\s?high\s?level|high\s?level|\bghl\b|leadconnector|sub-?accounts?/i;
  for (const t of NOTIFICATION_TYPES) {
    const i = CATALOG[t];
    for (const text of [i.label, i.hint, i.defaultTitle, i.defaultBody, ...i.variables.flatMap((v) => [v.label, v.sample])]) assert.doesNotMatch(text, banned, `${t}: ${text}`);
  }
  const files = ["src/lib/notifications/compose.ts", "src/lib/notifications/brief-lines.ts", "src/lib/notifications/test-send.ts", "src/app/app/views/notifications.tsx", "src/app/app/views/notification-bell.tsx"];
  for (const f of files) {
    const text = readFileSync(join(process.cwd(), f), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(text, /"[^"\n]*(go\s?high\s?level|high\s?level|\bghl\b)[^"\n]*"/i, f);
  }
});

test("every kind of alert the app can raise is sent as some kind of message (none is dropped)", () => {
  const derive = readFileSync(join(process.cwd(), "src/lib/analytics/derive.ts"), "utf8");
  const kinds = [...derive.matchAll(/kind: "([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 9, `found ${kinds.length} alert kinds`);
  for (const k of kinds) assert.ok(NOTIFICATION_TYPES.includes(typeForAlertKind(k)), k);
  assert.equal(typeForAlertKind("speed"), "speed_breach");
});

test("nothing outside the dispatcher's transport and the allowlisted test path can send an email or post to Slack", () => {
  const walk = (dir: string): string[] => readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const files = [...walk("src"), ...walk("scripts")].filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.includes("__tests__")).map((f) => f.replace(/\\/g, "/"));
  const importsEmail = files.filter((f) => /\b(sendEmail|sendEmailResult)\b/.test(readFileSync(join(process.cwd(), f), "utf8").replace(/\/\/.*$/gm, "")));
  assert.deepEqual(importsEmail.sort(), ["src/lib/email.ts", "src/lib/notifications/transports.ts"], "only the sender itself and the gated transport name the real send");
  const transports = readFileSync(join(process.cwd(), "src/lib/notifications/transports.ts"), "utf8");
  // In the transport the real calls sit inside outward(...) except the allowlisted live test, which asserts the allowlist first.
  assert.match(transports, /outward\(\{ flag: "SEND_EMAIL_LIVE"[\s\S]*?sendEmailResult\(to, \{ \.\.\.mail/);
  assert.match(transports, /outward\(\{ flag: "SEND_SLACK_LIVE"[\s\S]*?postSlackWebhook\(url, text\)/);
  assert.match(transports, /assertAllowlisted\(to\);\s*\n\s*if \(!emailConfigured\(\)\)/);
  // (scripts/check-api.ts only asserts that a channel address is never returned by an endpoint, so scripts are not part of this list.)
  const hookCalls = files.filter((f) => f.startsWith("src/") && /hooks\.slack\.com|postSlackWebhook/.test(readFileSync(join(process.cwd(), f), "utf8").replace(/\/\/.*$/gm, "")) && !/derive\.ts$/.test(f));
  assert.deepEqual(hookCalls.sort(), ["src/lib/notifications/slack.ts", "src/lib/notifications/transports.ts"].sort());
  const notify = readFileSync(join(process.cwd(), "src/lib/notify.ts"), "utf8");
  assert.match(notify, /outward\(\{ flag: "SEND_SLACK_LIVE"/, "the older Slack helper is gated too");
  const flags = readFileSync(join(process.cwd(), "src/lib/live-flags.ts"), "utf8");
  assert.doesNotMatch(flags, /SEND_(EMAIL|SLACK)_LIVE\s*[:=]\s*["']?true/);
});
