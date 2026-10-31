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
