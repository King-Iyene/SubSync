import assert from "node:assert/strict";
import { test } from "node:test";
import { bucket, changeLine, decideSend, describeAlert, recoveryFor, specificFor, spikeLink, type AlertInput } from "../notifications/alert-text.ts";
import { composeSlack, appLink } from "../notifications/compose.ts";
import { itemFor } from "../notifications/dispatcher.ts";
import { defaultPref } from "../notifications/prefs.ts";

// Golden text for every alert kind, and the rule that stops the same message repeating every hour.

const A = (kind: string, detail: Record<string, unknown>, extra: Partial<AlertInput> = {}): AlertInput => ({ id: "a1", kind, severity: "warning", title: "t", locationId: "loc123", detail, ...extra });
const HOUR = 3_600_000;

test("data health spike names the source, what is bad, the newest age and opens that source's records", () => {
  const d = describeAlert(A("quality", { source: "Unknown source", recent: 19, usual: 0, created: 24, newestMinutes: 12, kinds: { bad_phone: 11, duplicate: 5, bad_email: 3 } }), "KD Squares Test");
  assert.equal(d.title, "KD Squares Test: 19 bad records came in with no source recorded in the last 24 hours (usually 0 a day)");
  assert.deepEqual(d.details, ["What is wrong: 11 invalid phone numbers, 5 duplicates, 3 invalid email addresses.", "19 of the 24 records that have no source created in the last 24 hours.", "The newest arrived 12 min ago."]);
  assert.equal(d.body, "Next: open the list, fix or remove them, and check the form or import that sends them.");
  assert.deepEqual(d.link, spikeLink("loc123", "Unknown source"));
  assert.equal(appLink("https://x.test", d.link), "https://x.test/app#data-health?loc=loc123&mode=source&src=Unknown%20source&since=24h");
});

test("data health spike from a named source", () => {
  const d = describeAlert(A("quality", { source: "Facebook Form", recent: 1, usual: 2.5, kinds: { junk: 1 } }), "Acme");
  assert.equal(d.title, "Acme: 1 bad record came in from Facebook Form in the last 24 hours (usually 2.5 a day)");
  assert.deepEqual(d.details, ["What is wrong: 1 junk or test records."]);
});

test("speed alert shows target, longest wait, sources and opens the account's speed page", () => {
  const d = describeAlert(A("speed", { waiting: 9, targetMinutes: 15, oldestWaitMinutes: 130 }), "Sample Dental", { sources: [{ name: "Website", count: 5 }, { name: "Facebook", count: 3 }] });
  assert.equal(d.title, "Sample Dental: 9 new leads have waited more than 15 minutes with no reply from a person");
  assert.deepEqual(d.details, ["The longest has waited 2 h 10 min.", "Most came from: Website (5), Facebook (3)."]);
  assert.equal(d.body, "Next: open Speed to lead and call the longest-waiting lead first.");
  assert.deepEqual(d.link, { view: "speed", locationId: "loc123", query: "accounts=loc123" });
});

test("appointments, unanswered, dormant, churn, lead flow, stale, sync, email", () => {
  assert.equal(describeAlert(A("appointments", { unmarked: 12 }), "Acme").title, "Acme: 12 past appointments have no outcome recorded, so the show rate is a guess");
  assert.equal(describeAlert(A("sla", { unanswered: 6, slaHours: 4 }), "Acme").title, "Acme: 6 conversations have waited more than 4 hours for a reply");
  assert.equal(describeAlert(A("sla", { unanswered: 6, slaHours: 4 }), "Acme").link.query, "accounts=loc123&tab=unanswered");
  assert.equal(describeAlert(A("dormant", { daysInactive: 21, threshold: 14 }), "Acme").title, "Acme: no activity for 21 days (the alert starts at 14 days)");
  const churn = describeAlert(A("churn", { reasons: ["No logins in 30 days", "Contacts falling"], score: 31 }), "Acme");
  assert.equal(churn.title, "Acme: this account is at high risk of leaving (health score 31)");
  assert.deepEqual(churn.details, ["Why: No logins in 30 days", "Why: Contacts falling"]);
  assert.equal(describeAlert(A("leadflow", { dropPct: 62, newContacts30d: 14 }), "Acme").title, "Acme: new contacts are down 62% on their recent average");
  const stale = describeAlert(A("stale", { staleOpps: 7, openOpps: 20, value: 18500, staleDays: 14 }), "Acme");
  assert.equal(stale.title, "Acme: 7 deals have gone stale ($18,500)");
  assert.deepEqual(stale.details, ["7 of 20 open deals have had no movement for 14 days or more."]);
  assert.equal(describeAlert(A("sync", { error: "token expired" }), "Acme").title, "Acme: the latest data could not be refreshed (token expired)");
  assert.equal(describeAlert(A("email", { domain: "mail.acme.com", status: "critical" }), "Acme").title, "Acme: email sending is broken on mail.acme.com");
});

test("no vendor words and no contact names in any message", () => {
  const all = [A("speed", { waiting: 4 }), A("appointments", { unmarked: 5 }), A("sla", { unanswered: 1 }), A("dormant", { daysInactive: null }), A("churn", {}), A("leadflow", { dropPct: 50 }), A("stale", { staleOpps: 3 }), A("sync", {}), A("email", { domain: "a.com" }), A("quality", { completenessPct: 30 }), A("mystery", {})]
    .map((a) => describeAlert(a, "Acme"));
  for (const d of all) assert.doesNotMatch(JSON.stringify(d), /gohighlevel|highlevel|\bghl\b/i);
});

test("bands: small moves do not count as a change", () => {
  assert.equal(bucket(0), 0);
  assert.equal(bucket(3), 3);
  assert.equal(bucket(6), bucket(9));
  assert.notEqual(bucket(9), bucket(10));
  assert.equal(bucket(120), 100);
});

test("dedupe: new, then silent, then changed only after a band move and 3 hours, then a daily reminder", () => {
  const now = Date.parse("2026-11-13T08:00:00Z");
  const d19 = describeAlert(A("quality", { source: "Unknown source", recent: 19, usual: 0 }), "KD");
  const d12 = describeAlert(A("quality", { source: "Unknown source", recent: 12, usual: 0 }), "KD");
  const d31 = describeAlert(A("quality", { source: "Unknown source", recent: 31, usual: 0 }), "KD");
  assert.deepEqual(decideSend(null, d19, now), { send: true, state: "new" });
  const prev = { fp: d19.fp, count: 19, at: now, state: "new" };
  // The same alert an hour later (what used to repeat every hour): silent.
  assert.equal(decideSend(prev, d19, now + HOUR).send, false);
  assert.equal(decideSend(prev, d19, now + 23 * HOUR).send, false);
  // 19 and 12 are in the same band: silent.
  assert.equal(d19.fp, d12.fp);
  assert.equal(decideSend(prev, d12, now + 5 * HOUR).send, false);
  // 31 is a new band: told after 3 hours, not before.
  assert.equal(decideSend(prev, d31, now + HOUR).send, false);
  assert.deepEqual(decideSend(prev, d31, now + 4 * HOUR), { send: true, state: "changed" });
  // The day after: one reminder.
  assert.deepEqual(decideSend(prev, d19, now + 25 * HOUR), { send: true, state: "reminder" });
  // After it cleared and came back: new again.
  assert.deepEqual(decideSend({ ...prev, state: "recovered" }, d19, now + HOUR), { send: true, state: "new" });
});

test("change line says up or down from the last count, or unchanged", () => {
  const prev = { fp: "x", count: 31, at: 0, state: "new" };
  assert.equal(changeLine(prev, 19, "changed", 5 * HOUR), "Down from 31 (12 fewer) since the last message, 5 h ago.");
  assert.equal(changeLine(prev, 40, "reminder", 25 * HOUR), "Up from 31 (9 more) since the last message, 25 h ago.");
  assert.equal(changeLine(prev, 31, "reminder", 25 * HOUR), "Still open and unchanged since the last message, 25 h ago.");
  assert.equal(changeLine(null, 5, "new", HOUR), "");
});

test("reminder and recovery messages", () => {
  const now = Date.parse("2026-11-13T08:00:00Z");
  const d = describeAlert(A("quality", { source: "Unknown source", recent: 19, usual: 0 }), "KD");
  const s = specificFor(d, "KD", "reminder", { fp: d.fp, count: 31, at: now - 25 * HOUR, state: "new" }, now);
  assert.match(s.title, /^Reminder: KD: 19 bad records/);
  assert.equal(s.details[0], "Down from 31 (12 fewer) since the last message, 25 h ago.");
  const r = recoveryFor({ meta: s.meta, link: s.link, linkLabel: s.linkLabel }, now + 2 * HOUR, now);
  assert.equal(r.title, "KD: back to normal, bad records with no source recorded");
  assert.equal(r.meta.state, "recovered");
  assert.deepEqual(r.details, ["It was 19 when we last told you, 2 h ago."]);
});

test("Slack message is specific, links to the exact list, and the person's own wording wins", () => {
  const d = describeAlert(A("speed", { waiting: 9, targetMinutes: 15, oldestWaitMinutes: 130 }), "Sample Dental");
  const spec = specificFor(d, "Sample Dental", "new", null, 0);
  const legacy = { slackConfigured: true, digestEnabled: true, digestEmail: null, digestHour: null, digestTimezone: null, alertQuietHours: false };
  const pref = defaultPref("speed_breach", legacy, []);
  const intent = { type: "speed_breach" as const, locationId: "loc123", severity: "warning" as const, dedupeKey: "k", values: { account: "Sample Dental" }, specific: spec };
  const item = itemFor(intent, pref);
  const text = composeSlack([item], { company: "Co", appUrl: "https://app.test" });
  assert.match(text, /Sample Dental: 9 new leads have waited more than 15 minutes/);
  assert.match(text, /\|Open the waiting leads in your CRM>$/);
  assert.match(text, /<https:\/\/app\.gohighlevel\.com\/v2\/location\/loc123\/conversations\/conversations\|/);
  assert.doesNotMatch(text, /app\.test/);
  assert.doesNotMatch(text, /Open the linked page/);
  const own = itemFor(intent, { ...pref, copy: { title: "Custom {account}", body: null } });
  assert.match(own.title, /^Custom Sample Dental/);
});
