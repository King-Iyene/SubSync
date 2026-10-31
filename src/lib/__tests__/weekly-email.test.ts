import assert from "node:assert/strict";
import { test } from "node:test";
import { validEmail, weeklyDue, weeklyEmail } from "../analytics/weekly-email.ts";

const base = { who: "Acme Agency", appUrl: "https://x.test", fine: 2, headlines: [{ label: "Open pipeline", money: true, today: 12000, vsAvg: -5 }, { label: "Unread", money: false, today: 4, vsAvg: null }] };

test("subject counts accounts, and a quiet week says so", () => {
  assert.match(weeklyEmail({ ...base, attention: [{ name: "A", title: "t" }, { name: "B", title: "u" }] }).subject, /2 accounts need you/);
  assert.match(weeklyEmail({ ...base, attention: [{ name: "A", title: "t" }] }).subject, /1 account needs you/);
  assert.match(weeklyEmail({ ...base, attention: [] }).subject, /quiet week/);
});

test("html is escaped, the list is capped at eight, and the platform is never named", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `<b>${i}</b>`, title: "x & y" }));
  const m = weeklyEmail({ ...base, attention: many });
  assert.ok(!m.html.includes("<b>0</b>") && m.html.includes("&lt;b&gt;0&lt;/b&gt;"));
  assert.match(m.text, /and 2 more in the app/);
  assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(m.text + m.html));
  assert.match(m.text, /\$12,000 \(-5% vs the last 7 days\)/);
});

test("it is due only on Monday, from the chosen hour, once per week", () => {
  const mon = (hour: number) => ({ hour, date: "2026-11-02", weekday: "Mon" });
  assert.equal(weeklyDue(mon(7), 8, null), false);
  assert.equal(weeklyDue(mon(8), 8, null), true);
  assert.equal(weeklyDue(mon(11), 8, "2026-11-02"), false);
  assert.equal(weeklyDue({ hour: 9, date: "2026-11-03", weekday: "Tue" }, 8, null), false);
  assert.equal(weeklyDue(null, 8, null), false);
});

test("address check rejects lists and junk", () => {
  assert.ok(validEmail("a@b.co"));
  for (const bad of ["a@b", "a b@c.com", "a@b.com,c@d.com", "", "x".repeat(130) + "@b.com"]) assert.ok(!validEmail(bad), bad);
});

test("alert email names the count, flags a critical one, escapes titles", async () => {
  const { alertEmail } = await import("../analytics/weekly-email.ts");
  const m = alertEmail("Acme", [{ severity: "critical", title: "<x> 5 leads waiting" }, { severity: "warning", title: "b" }], "https://x.test");
  assert.match(m.subject, /2 new alerts \(one is critical\)/);
  assert.ok(m.html.includes("&lt;x&gt;") && !m.html.includes("<x>"));
  assert.match(m.text, /https:\/\/x.test\/app#alerts/);
});

test("the note written into the CRM is capped so one long summary cannot flood a contact", async () => {
  const { crmNoteBody, CRM_NOTE_MAX } = await import("../analytics/meeting-intel.ts");
  const long = crmNoteBody({ title: "Call", startedAt: null, attendees: [], summary: "x".repeat(20000), actionItems: [], recordingUrl: null });
  assert.ok(long.length <= CRM_NOTE_MAX);
  assert.match(crmNoteBody({ title: "Kickoff", startedAt: null, attendees: [{ name: "Ada", email: "a@b.co" }], summary: "Agreed scope", actionItems: ["Send quote"], recordingUrl: null }), /Kickoff[\s\S]*Ada[\s\S]*Agreed scope[\s\S]*Send quote/);
});

test("the week's facts state only what can be counted, and skip what is zero", async () => {
  const { weekFacts, weeklyEmail } = await import("../analytics/weekly-email.ts");
  const full = weekFacts({ leads: 12, withinTarget: 9, targetMinutes: 15, neverAnswered: 2, noShowsToRecover: 1, unmarked: 3 });
  assert.deepEqual(full, [
    "9 of 12 new leads (last 14 days) were answered by a person inside 15 minutes (75%).",
    "2 leads have never been answered (waiting more than 3 days).",
    "1 no-show is still waiting to be rebooked.",
    "3 past appointments have no outcome marked, so show rate is understated.",
  ]);
  assert.deepEqual(weekFacts({ leads: 3, withinTarget: 3, targetMinutes: 15, neverAnswered: 0, noShowsToRecover: 0, unmarked: null }), ["3 new leads in the last 14 days, too few to give a reply-speed percentage."]);
  assert.deepEqual(weekFacts({ leads: 0, withinTarget: 0, targetMinutes: 15, neverAnswered: 0, noShowsToRecover: null, unmarked: null }), []);
  const m = weeklyEmail({ who: "Acme", appUrl: "https://x.test", fine: 0, headlines: [], attention: [], facts: full });
  assert.match(m.text, /The last 14 days:[\s\S]*9 of 12/);
  assert.match(m.html, /The last 14 days/);
  assert.ok(!/The last 14 days/.test(weeklyEmail({ who: "Acme", appUrl: "https://x.test", fine: 0, headlines: [], attention: [] }).text), "no facts, no section");
});
