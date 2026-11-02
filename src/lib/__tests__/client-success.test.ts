import assert from "node:assert/strict";
import { test } from "node:test";
import {
  averageSeries, baselineShare, dealFigures, bandGroups, buildOnboardingItems, cleanSteps, COMPARE_METRICS, compareTable, crmAccountPage, daysBetween, DEFAULT_STUCK_DAYS, driftRows, dueState, endpoints, extraAutoItems, FIX,
  helpLines, HELP, historyLine, industryFromPicker, INDUSTRY_PICKER, isStuck, lastSpokenMs, needsAttention, NOTE_MAX, OTHER_INDUSTRY, parseCompareIds, parseQuarter, parseStuckDays,
  pickerChoice, playbookLine, pointsIn, previousQuarter, proofSummary, qbrFindings, quarterOf, quarterProgress, recentQuarters, reviewText, shiftDays, sharesBaseline, starterFromPlaybook, templateFor,
  USER_ENTERED, validateNote, validateStepPatch, valueCreatedWords, type AccountFacts, type BaseItem, type QuarterFacts,
} from "../analytics/client-success.ts";
import { industryKey } from "../analytics/playbooks.ts";
import type { Setup } from "../analytics/setup-intel.ts";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0); // 1 Nov 2026

// ---------------------------------------------------------------- Details: what only the user can enter (KF-7)

test("every industry in the picker lands in the playbook it names, so a picked industry is never 'other'", () => {
  for (const p of INDUSTRY_PICKER) assert.equal(industryKey(p.value), p.id, p.value);
  assert.equal(new Set(INDUSTRY_PICKER.map((p) => p.id)).size, INDUSTRY_PICKER.length);
});

test("the picker keeps a typed industry as 'Other' and brings it back, and refuses anything that is not a listed value", () => {
  assert.deepEqual(pickerChoice(null), { choice: "", other: "" });
  assert.deepEqual(pickerChoice("  real estate "), { choice: "Real estate", other: "" });
  assert.deepEqual(pickerChoice("Restaurant"), { choice: OTHER_INDUSTRY, other: "Restaurant" });
  assert.equal(industryFromPicker("Real estate", "ignored"), "Real estate");
  assert.equal(industryFromPicker(OTHER_INDUSTRY, "  Bistro  "), "Bistro");
  assert.equal(industryFromPicker(OTHER_INDUSTRY, "   "), null);
  assert.equal(industryFromPicker("Made up", "x"), null);
  assert.equal(industryFromPicker("", ""), null);
  assert.equal(industryFromPicker(OTHER_INDUSTRY, "x".repeat(100))?.length, 60);
});

test("a client's playbook is named in words, or the reason it has none", () => {
  assert.match(playbookLine("Dental"), /Medical, dental and health clinics/);
  assert.match(playbookLine(null), /No industry yet/);
  assert.match(playbookLine("Restaurant"), /No built-in playbook/);
});

test("every column and tile has a two-line explanation, and the ones that depend on what the user types say so", () => {
  for (const [key, h] of Object.entries(HELP)) {
    const [one, two] = helpLines(h);
    assert.ok(one.length > 20 && two.length > 20, key);
    assert.ok(one.length < 160 && two.length < 260, `${key} stays short`);
    if (h.entered) assert.match(two, /You enter this|you type|you typed|type it|Add /i, `${key} says the user enters it`);
  }
  for (const key of ["fee", "renewal", "industry", "lastSpoken", "notSpoken", "renewals", "monthlyRevenue"]) assert.ok(HELP[key].where.includes(USER_ENTERED) || HELP[key].where === USER_ENTERED, key);
  assert.equal(USER_ENTERED, "You enter this; SubSync does not read it from your CRM.");
  for (const k of ["fee", "valueCreated", "health", "setup", "monthlyRevenue", "revenueAtRisk", "notSpoken", "renewals", "renewal", "industry", "lastSpoken", "leaveRisk"]) assert.ok(HELP[k], `help for ${k}`);
});

test("the Value created formula is written in plain words and the worked example comes from the real formula", () => {
  const w = valueCreatedWords();
  assert.match(w, /new deals that started in the last 30 days/);
  assert.match(w, /divided by what the client pays you each month/);
  assert.match(w, /7\.2x/);
  assert.match(w, /monthly fee/);
});

test("a note needs words, a known kind and a real past date, and is capped", () => {
  const ok = validateNote({ kind: "conversation", body: "  Agreed to move the review to Friday  ", occurredOn: "2026-10-30" }, "2026-11-01");
  assert.ok(ok.ok && ok.note.body === "Agreed to move the review to Friday" && ok.note.occurredOn === "2026-10-30");
  assert.ok(validateNote({ body: "x" }, "2026-11-01").ok, "kind defaults to note");
  assert.equal((validateNote({ body: "   " }, "2026-11-01") as { error: string }).error, "Write what was said or decided");
  assert.ok(!validateNote({ kind: "rumour", body: "x" }, "2026-11-01").ok);
  assert.ok(!validateNote({ body: "x".repeat(NOTE_MAX + 1) }, "2026-11-01").ok);
  assert.ok(!validateNote({ body: "x", occurredOn: "2026-11-02" }, "2026-11-01").ok, "not in the future");
  assert.ok(!validateNote({ body: "x", occurredOn: "2026-02-30" }, "2026-11-01").ok, "an impossible date is refused");
  assert.ok(!validateNote({ body: "x", occurredOn: "yesterday" }, "2026-11-01").ok);
});

test("last spoken is the later of the 'I spoke to them today' press and the newest logged conversation", () => {
  const press = Date.UTC(2026, 9, 20, 9);
  assert.equal(lastSpokenMs(null, []), null);
  assert.equal(lastSpokenMs(press, []), press);
  assert.equal(lastSpokenMs(press, ["2026-10-30", "2026-10-25"]), Date.UTC(2026, 9, 30, 12));
  assert.equal(lastSpokenMs(press, ["2026-10-01"]), press);
  assert.equal(lastSpokenMs(null, ["not a date"]), null);
});

// ---------------------------------------------------------------- Health: labels that never contradict each other (N16)

const row = (name: string, o: Partial<{ score: number; band: "thriving" | "healthy" | "watch" | "at_risk"; unanswered: number; dormant: boolean; churn: string; bandNote: string | null }> = {}) =>
  ({ name, score: 70, band: "healthy" as const, unanswered: 0, dormant: false, churn: "low", bandNote: null, ...o });

test("a client in the needs-attention list is never called Healthy or Thriving there, whatever its score band says", () => {
  const rows = [
    row("A", { score: 57, band: "healthy", unanswered: 23, bandNote: "23 customers waiting, so not better than Watch" }),
    row("B", { score: 80, band: "thriving" }),
    row("C", { score: 20, band: "at_risk", churn: "high" }),
    row("D", { score: 60, band: "healthy", churn: "medium" }),
    row("E", { score: 40, band: "watch", dormant: true }),
  ];
  const out = needsAttention(rows);
  assert.deepEqual(out.map((r) => r.name), ["C", "E", "A", "D"], "at risk first, then by score; the thriving client with nothing wrong is not listed");
  for (const r of out) assert.ok(r.label === "Watch" || r.label === "At risk", `${r.name}: ${r.label}`);
  assert.equal(out.find((r) => r.name === "A")?.label, "Watch");
  assert.ok(out.find((r) => r.name === "A")?.reasons.some((x) => /23 customers are waiting for a reply/.test(x)));
  assert.equal(out.find((r) => r.name === "E")?.label, "At risk", "a quiet account is at risk");
  assert.equal(needsAttention(rows, 2).length, 2);
});

test("health bands are grouped worst first with the clients behind each count", () => {
  const rows = [row("A", { band: "healthy" }), row("B", { band: "at_risk" }), row("C", { band: "healthy" }), row("D", { band: "thriving" })];
  const g = bandGroups(rows);
  assert.deepEqual(g.map((x) => [x.band, x.rows.length]), [["at_risk", 1], ["watch", 0], ["healthy", 2], ["thriving", 1]]);
  assert.equal(g.reduce((s, x) => s + x.rows.length, 0), rows.length, "every client is in exactly one group");
});

// ---------------------------------------------------------------- quarters

test("quarters: the quarter of a date, the one before it (across a year), and the list of recent ones", () => {
  const q = quarterOf(NOW);
  assert.deepEqual([q.key, q.from, q.to], ["2026-Q4", "2026-10-01", "2026-12-31"]);
  assert.match(q.label, /Q4 2026 \(Oct to Dec\)/);
  assert.deepEqual([previousQuarter(q).key, previousQuarter(q).from, previousQuarter(q).to], ["2026-Q3", "2026-07-01", "2026-09-30"]);
  const jan = parseQuarter("2026-Q1")!;
  assert.deepEqual([previousQuarter(jan).key, previousQuarter(jan).to], ["2025-Q4", "2025-12-31"]);
  assert.equal(parseQuarter("2026-Q1")!.to, "2026-03-31");
  assert.equal(parseQuarter("2024-Q1")!.to, "2024-03-31");
  assert.deepEqual(recentQuarters(NOW, 3).map((x) => x.key), ["2026-Q4", "2026-Q3", "2026-Q2"]);
  for (const bad of ["2026-Q5", "26-Q1", "2026Q1", "", null, 5, "2026-q1"]) assert.equal(parseQuarter(bad), null, String(bad));
});

test("a quarter still running is said to be running, and a finished one is complete", () => {
  assert.deepEqual(quarterProgress(parseQuarter("2026-Q3")!, NOW), { complete: true, days: 92, total: 92 });
  const p = quarterProgress(parseQuarter("2026-Q4")!, NOW);
  assert.equal(p.complete, false);
  assert.equal(p.days, 32);
  assert.equal(p.total, 92);
});

// ---------------------------------------------------------------- trends

test("a comparison period is shifted onto the current period's dates, and windows pick exactly their days", () => {
  const pts = [{ day: "2026-09-01", v: 1 }, { day: "2026-09-02", v: 2 }];
  assert.deepEqual(shiftDays(pts, 30).map((p) => p.day), ["2026-10-01", "2026-10-02"]);
  assert.equal(daysBetween("2026-09-01", "2026-10-01"), 30);
  assert.deepEqual(pointsIn([{ day: "2026-09-30" }, { day: "2026-10-01" }, { day: "2026-10-31" }, { day: "2026-11-01" }], "2026-10-01", "2026-10-31").map((p) => p.day), ["2026-10-01", "2026-10-31"]);
});

test("the average line only exists where at least two clients have a value, and nulls are left out", () => {
  const a = [{ day: "d1", value: 10 }, { day: "d2", value: 20 }, { day: "d3", value: null }];
  const b = [{ day: "d1", value: 30 }, { day: "d2", value: null }, { day: "d3", value: 5 }];
  assert.deepEqual(averageSeries([a, b]), [{ day: "d1", value: 20 }]);
  assert.deepEqual(averageSeries([]), []);
  assert.deepEqual(endpoints([null, 58, 60, null, 84]), { start: 58, end: 84, n: 3 });
  assert.deepEqual(endpoints([null]), { start: null, end: null, n: 0 });
});

// ---------------------------------------------------------------- Compare

test("compare: best and worst are highlighted only when clients are really apart, and each cell says how it sits against the average", () => {
  const t = compareTable([
    { locationId: "a", name: "Alpha", values: { score: 84, new30d: 44, openValue: 120_000, winRate: 0.5, avgCycleDays: 12, unanswered: 0, completenessPct: 90 } },
    { locationId: "b", name: "Beta", values: { score: 82, new30d: 12, openValue: 40_000, winRate: null, avgCycleDays: 30, unanswered: 9, completenessPct: 88 } },
    { locationId: "c", name: "Gamma", values: { score: 80, new30d: 20, openValue: 60_000, winRate: 0.3, avgCycleDays: null, unanswered: 3, completenessPct: 60 } },
  ]);
  const by = (k: string) => t.rows.find((r) => r.metric.key === k)!;
  assert.equal(by("score").spread, false, "84, 82 and 80 are alike: nothing highlighted");
  assert.ok(by("score").cells.every((c) => c.flag === null));
  assert.equal(by("new30d").cells.find((c) => c.locationId === "a")!.flag, "best");
  assert.equal(by("new30d").cells.find((c) => c.locationId === "b")!.flag, "worst");
  assert.equal(by("unanswered").cells.find((c) => c.locationId === "a")!.flag, "best", "for waiting messages lower is better");
  assert.equal(by("unanswered").cells.find((c) => c.locationId === "b")!.flag, "worst");
  assert.equal(by("avgCycleDays").cells.find((c) => c.locationId === "a")!.flag, "best", "fewer days to win is better");
  assert.equal(by("winRate").cells.find((c) => c.locationId === "b")!.value, null, "a missing figure stays missing");
  assert.equal(by("winRate").cells.find((c) => c.locationId === "b")!.flag, null);
  assert.match(by("new30d").cells.find((c) => c.locationId === "a")!.vsAverage ?? "", /^\+\d+% against the average$/);
  assert.ok(t.notes.some((n) => /New contacts, 30 days: Alpha is best \(44\) and Beta is furthest behind \(12\)/.test(n)), t.notes.join("\n"));
  assert.equal(COMPARE_METRICS.length, t.rows.length);
});

test("compare: one figure has no average, a small base never gets a percentage, and identical clients are said to look alike", () => {
  const one = compareTable([{ locationId: "a", name: "A", values: { score: 70 } }, { locationId: "b", name: "B", values: { score: null } }]);
  assert.equal(one.rows[0].average, null);
  assert.equal(one.rows[0].cells[0].vsAverage, null);
  const small = compareTable([{ locationId: "a", name: "A", values: { unanswered: 6 } }, { locationId: "b", name: "B", values: { unanswered: 2 } }]);
  const cell = small.rows.find((r) => r.metric.key === "unanswered")!.cells[0];
  assert.match(cell.vsAverage ?? "", /^\+2 against the average$/, "an average of 4 is too small a base for a percentage");
  const same = compareTable([{ locationId: "a", name: "A", values: { score: 70 } }, { locationId: "b", name: "B", values: { score: 70 } }]);
  assert.deepEqual(same.notes, ["These clients look alike on every measure SubSync tracks."]);
});

test("the clients to compare are well-formed, distinct, in order, and capped; the old a and b form still works", () => {
  const ok = (s: string) => /^[A-Za-z0-9_-]{3,64}$/.test(s);
  assert.deepEqual(parseCompareIds("abc,def,abc,!!", null, null, ok), ["abc", "def"]);
  assert.deepEqual(parseCompareIds(null, "abc", "def", ok), ["abc", "def"]);
  assert.deepEqual(parseCompareIds(Array.from({ length: 12 }, (_, i) => `id${i}x`).join(","), null, null, ok).length, 6);
  assert.deepEqual(parseCompareIds(null, null, null, ok), []);
});

// ---------------------------------------------------------------- Compare setups: only for accounts that share a baseline (N72)

const setup = (name: string, pipelines: Array<[string, string[]]>, calendars: number | null = 2): Setup => ({ locationId: name, name, calendars, pipelines: pipelines.map(([n, stages]) => ({ name: n, stages })) });
const base = setup("Base", [["Sales", ["New", "Booked", "Won"]], ["Recall", ["Due", "Called"]]]);

test("an account is compared with the baseline only when it started from the same template", () => {
  const sameTemplate = setup("Same", [["Sales", ["New", "Booked", "Won"]], ["Recall", ["Due", "Called"]]]);
  const drifted = setup("Drifted", [["sales", ["New", "Won"]], ["Extra", ["A"]]]);
  const unrelated = setup("Unrelated", [["Orders", ["Paid"]], ["Support", ["Open", "Closed"]]]);
  assert.equal(baselineShare(base, sameTemplate), 1);
  assert.equal(sharesBaseline(base, sameTemplate), true);
  assert.equal(sharesBaseline(base, drifted), true, "one of two pipelines is still there");
  assert.equal(baselineShare(base, unrelated), 0);
  assert.equal(sharesBaseline(base, unrelated), false, "two unrelated clients are not compared");
  assert.equal(baselineShare(setup("Empty", []), sameTemplate), 0);
});

test("the difference from the baseline is a list of rows with a severity and a fix, most serious first", () => {
  const other = setup("Other", [["Sales", ["New", "Won", "Booked", "Lost"]], ["Extra", ["A"]]], 0);
  const rows = driftRows(base, other);
  assert.ok(rows.length >= 4);
  assert.equal(rows[0].severity, "high");
  const kinds = rows.map((r) => r.kind);
  assert.ok(kinds.includes("missing_pipeline") && kinds.includes("extra_pipeline") && kinds.includes("extra_stage") && kinds.includes("calendars"));
  const sev = rows.map((r) => ({ high: 0, medium: 1, low: 2 })[r.severity]);
  assert.deepEqual(sev, [...sev].sort((a, b) => a - b), "ordered by severity");
  for (const r of rows) assert.ok(r.fix.length > 10 && r.what.length > 5);
  assert.deepEqual(driftRows(base, setup("Same", [["Sales", ["New", "Booked", "Won"]], ["Recall", ["Due", "Called"]]])), []);
  const order = driftRows(base, setup("Order", [["Sales", ["Booked", "New", "Won"]], ["Recall", ["Due", "Called"]]]));
  assert.deepEqual(order.map((r) => [r.kind, r.severity]), [["order", "medium"]]);
});

// ---------------------------------------------------------------- Onboarding (N63)

const baseItems: BaseItem[] = [
  { key: "profile", label: "Business profile filled in", status: "todo", auto: true },
  { key: "pipeline", label: "At least one pipeline", status: "done", auto: true },
  { key: "calendar", label: "A calendar is set up", status: "todo", auto: true },
  { key: "email_auth", label: "Sending domain authenticated", status: "unknown", auto: true, detail: "Check the account's domain in Email health" },
  { key: "workflows", label: "Workflows built", status: "unknown", auto: true, detail: "The platform's workflow API is not available to every account" },
  { key: "manual:kickoff", label: "Kickoff call completed", status: "todo", auto: false },
  { key: "manual:phone", label: "Phone number registered", status: "todo", auto: false },
  { key: "custom:Send welcome pack", label: "Send welcome pack", status: "todo", auto: false },
];
const facts: AccountFacts = { website: "https://x.example.com", timezone: null, address: "1 Main St", appointments: 0, appointmentsAccess: "ok" };
const build = (o: Partial<Parameters<typeof buildOnboardingItems>[0]> = {}) => buildOnboardingItems({
  base: baseItems, facts, templateSteps: [], states: [], manualDone: {}, locationId: "loc1", links: { appDomain: null, whitelabelDomain: "crm.acme-marketing.com" }, nowMs: NOW, ...o,
});

test("every unfinished step with a known page has a Fix it link through the white-label domain, and a how-to; a finished one has none", () => {
  const { items } = build();
  const profile = items.find((i) => i.key === "profile")!;
  assert.equal(profile.fix?.label, "Fix it");
  assert.equal(profile.fix?.url, "https://crm.acme-marketing.com/v2/location/loc1/settings/company");
  assert.ok(profile.howto && profile.where);
  assert.equal(items.find((i) => i.key === "pipeline")!.fix, null, "done: nothing to fix");
  assert.equal(items.find((i) => i.key === "email_auth")!.fix?.view, "email", "the email check lives inside SubSync");
  assert.equal(items.find((i) => i.key === "email_auth")!.fix?.url, null);
  for (const i of items.filter((x) => x.status === "todo" && FIX[x.key])) assert.ok(i.fix && i.howto && i.where, i.key);
});

test("without a white-label domain the default address is used, and a damaged domain cannot change the host", () => {
  assert.match(crmAccountPage(null, "loc1", "settings/company"), /^https:\/\/app\.gohighlevel\.com\/v2\/location\/loc1\/settings\/company$/);
  assert.match(crmAccountPage("crm.acme.com", "loc 1/../x", "/settings/company"), /^https:\/\/crm\.acme\.com\/v2\/location\/loc%201%2F\.\.%2Fx\/settings\/company$/);
  assert.match(crmAccountPage("evil.com/x?y", "loc1", "a"), /^https:\/\/app\.gohighlevel\.com\//, "a domain with a path is refused");
});

test("no step text, how-to or reason names the platform or says location or agency", () => {
  const texts = [...Object.values(FIX).flatMap((f) => [f.where, f.howto]), ...build().items.flatMap((i) => [i.label, i.howto ?? "", i.where ?? "", i.detail ?? ""])];
  for (const t of texts) assert.doesNotMatch(t, /gohighlevel|highlevel|\bghl\b|leadconnector|sub-?account|\blocations?\b|\bagenc/i, t);
});

test("more is detected automatically: website, time zone, address and a first appointment, with the reason when it cannot be", () => {
  const { items } = build();
  assert.equal(items.find((i) => i.key === "website")!.status, "done");
  assert.equal(items.find((i) => i.key === "timezone")!.status, "todo");
  assert.equal(items.find((i) => i.key === "address")!.status, "done");
  assert.equal(items.find((i) => i.key === "appointment")!.status, "todo");
  const noPerm = extraAutoItems({ ...facts, appointmentsAccess: "needs_permission" }).find((i) => i.key === "appointment")!;
  assert.equal(noPerm.status, "unknown");
  const items2 = build({ facts: { ...facts, appointments: 3 } }).items;
  assert.equal(items2.find((i) => i.key === "appointment")!.status, "done");
  const perm = buildOnboardingItems({ base: [], facts: { ...facts, appointmentsAccess: "needs_permission" }, templateSteps: [], states: [], manualDone: {}, locationId: "l", links: null, nowMs: NOW }).items.find((i) => i.key === "appointment")!;
  assert.equal(perm.reason, "permission");
});

test("a check that cannot say yes or no says why, in one of three ways", () => {
  const { items } = build();
  assert.equal(items.find((i) => i.key === "email_auth")!.reason, "not_checked");
  assert.equal(items.find((i) => i.key === "workflows")!.reason, "unavailable");
  assert.equal(items.find((i) => i.key === "profile")!.reason, null);
});

test("completion counts only the steps that can be known; unknown ones are left out", () => {
  const all = build();
  const known = all.items.filter((i) => i.status !== "unknown");
  assert.equal(all.completionPct, Math.round((known.filter((i) => i.status === "done").length / known.length) * 100));
  const done = build({ manualDone: { "manual:kickoff": true, "manual:phone": true, "custom:Send welcome pack": true } });
  assert.ok(done.completionPct > all.completionPct);
  assert.equal(done.items.find((i) => i.key === "manual:kickoff")!.status, "done");
  assert.equal(done.items.find((i) => i.key === "manual:kickoff")!.fix, null);
});

test("template steps and steps added to one client carry their own done flag, assignee and due date", () => {
  const { items } = build({
    templateSteps: [{ key: "ab12", label: "Collect brand assets", howto: "Ask for the logo and colours." }, { key: "cd34", label: "Approve the first campaign" }],
    states: [
      { stepKey: "tpl:ab12", isCustom: false, label: null, assignee: "Dana", dueOn: "2026-10-30", doneAt: null, doneBy: null },
      { stepKey: "tpl:cd34", isCustom: false, label: null, assignee: null, dueOn: null, doneAt: "2026-10-28T10:00:00Z", doneBy: "Sam" },
      { stepKey: "step:zz9988", isCustom: true, label: "Order the welcome gift", assignee: "Priya", dueOn: "2026-11-20", doneAt: null, doneBy: null },
      { stepKey: "manual:kickoff", isCustom: false, label: null, assignee: "Jordan", dueOn: "2026-11-02", doneAt: null, doneBy: null },
    ],
  });
  const a = items.find((i) => i.key === "tpl:ab12")!;
  assert.deepEqual([a.kind, a.status, a.assignee, a.due, a.howto], ["template", "todo", "Dana", "overdue", "Ask for the logo and colours."]);
  const b = items.find((i) => i.key === "tpl:cd34")!;
  assert.deepEqual([b.status, b.doneBy, b.due], ["done", "Sam", null]);
  const c = items.find((i) => i.key === "step:zz9988")!;
  assert.deepEqual([c.kind, c.status, c.assignee, c.due], ["custom", "todo", "Priya", "later"]);
  const k = items.find((i) => i.key === "manual:kickoff")!;
  assert.deepEqual([k.assignee, k.due], ["Jordan", "soon"], "a manual step can be given to someone too");
  assert.ok(items.every((i) => i.canTick === (i.kind !== "auto")));
});

test("due dates: overdue, soon (three days) and later; nothing for a missing or damaged date", () => {
  assert.equal(dueState("2026-10-31", NOW), "overdue");
  assert.equal(dueState("2026-11-01", NOW), "soon");
  assert.equal(dueState("2026-11-04", NOW), "soon");
  assert.equal(dueState("2026-11-05", NOW), "later");
  assert.equal(dueState(null, NOW), null);
  assert.equal(dueState("soon", NOW), null);
});

test("a client is stuck when it is not fully onboarded more than N days after it was added", () => {
  assert.equal(isStuck({ daysIn: 20, completionPct: 60 }, 14), true);
  assert.equal(isStuck({ daysIn: 14, completionPct: 60 }, 14), false, "exactly N days is not yet over N");
  assert.equal(isStuck({ daysIn: 90, completionPct: 100 }, 14), false, "finished clients are never stuck");
  assert.equal(isStuck({ daysIn: null, completionPct: 10 }, 14), false, "a client with no start date is not guessed at");
  assert.equal(parseStuckDays("30"), 30);
  assert.equal(parseStuckDays("5"), DEFAULT_STUCK_DAYS);
  assert.equal(parseStuckDays(null), DEFAULT_STUCK_DAYS);
  assert.equal(parseStuckDays("14abc"), DEFAULT_STUCK_DAYS);
});

test("template steps from the browser are checked: count, length, duplicates, and each kept step has a stable key", () => {
  let n = 0;
  const mk = () => `k${String(++n).padStart(3, "0")}`;
  const ok = cleanSteps([{ label: " Collect logo ", howto: " Ask. " }, { key: "abcd1234", label: "Kickoff" }, { label: "   " }, { key: "BAD KEY!", label: "Third" }], mk);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.steps.map((s) => s.label), ["Collect logo", "Kickoff", "Third"]);
    assert.equal(ok.steps[1].key, "abcd1234", "a good key is kept so progress on that step is kept");
    assert.match(ok.steps[0].key, /^k\d{3}$/);
    assert.match(ok.steps[2].key, /^k\d{3}$/, "a damaged key is replaced");
    assert.equal(ok.steps[0].howto, "Ask.");
  }
  assert.ok(!cleanSteps("nope", mk).ok);
  assert.ok(!cleanSteps(Array.from({ length: 21 }, (_, i) => ({ label: `s${i}` })), mk).ok);
  assert.ok(!cleanSteps([{ label: "x".repeat(121) }], mk).ok);
  assert.ok(!cleanSteps([{ label: "A", howto: "x".repeat(301) }], mk).ok);
  const dup = cleanSteps([{ label: "Kickoff" }, { label: "  kickoff " }], mk);
  assert.ok(!dup.ok && /twice/.test(dup.error));
});

test("a client gets the template for its industry, else the one for everyone, else none", () => {
  const t = [{ id: "all", industryKey: null }, { id: "re", industryKey: "real_estate" }, { id: "med", industryKey: "medical" }];
  assert.equal(templateFor(t, "Real estate")?.id, "re");
  assert.equal(templateFor(t, "Dental")?.id, "med");
  assert.equal(templateFor(t, "Restaurant")?.id, "all");
  assert.equal(templateFor(t, null)?.id, "all");
  assert.equal(templateFor(t.slice(1), "Restaurant"), null);
});

test("a template can start from an industry playbook's own checklist", () => {
  let n = 0;
  const s = starterFromPlaybook("real_estate", () => `s${++n}x${n}x${n}`)!;
  assert.equal(s.industryKey, "real_estate");
  assert.equal(s.steps.length, 4);
  assert.equal(starterFromPlaybook("nope", () => "x"), null);
});

test("a change to a step is checked: a real date, a short name, and only the fields sent are changed", () => {
  assert.deepEqual(validateStepPatch({ done: true }), { ok: true, patch: { done: true } });
  assert.deepEqual(validateStepPatch({ assignee: " Dana ", dueOn: "2026-11-15" }), { ok: true, patch: { assignee: "Dana", dueOn: "2026-11-15" } });
  assert.deepEqual(validateStepPatch({ assignee: "", dueOn: null }), { ok: true, patch: { assignee: null, dueOn: null } });
  assert.ok(!validateStepPatch({ dueOn: "2026-02-30" }).ok);
  assert.ok(!validateStepPatch({ dueOn: "soon" }).ok);
  assert.ok(!validateStepPatch({ assignee: "x".repeat(61) }).ok);
  assert.ok(!validateStepPatch({}).ok);
});

test("the history reads as plain sentences with who did it", () => {
  assert.equal(historyLine({ event: "done", stepLabel: "Kickoff", detail: null, actor: "Sam" }), 'Sam finished "Kickoff"');
  assert.equal(historyLine({ event: "assigned", stepLabel: "Kickoff", detail: "Dana", actor: "Sam" }), 'Sam gave "Kickoff" to Dana');
  assert.equal(historyLine({ event: "assigned", stepLabel: "Kickoff", detail: null, actor: null }), 'Someone took the name off "Kickoff"');
  assert.equal(historyLine({ event: "due", stepLabel: "Kickoff", detail: "2026-11-15", actor: "Sam" }), 'Sam set "Kickoff" due 2026-11-15');
  assert.equal(historyLine({ event: "added", stepLabel: null, detail: null, actor: "Sam" }), 'Sam added "a step"');
});

// ---------------------------------------------------------------- Reviews (QBR)

const qf = (o: Partial<QuarterFacts> = {}): QuarterFacts => ({ contactsAdded: 0, healthStart: null, healthEnd: null, healthDays: 0, pipelineCreated: 0, wonCount: 0, wonValue: 0, openValueEnd: null, apptWithOutcome: 0, apptShowed: 0, alertsRaised: 0, alertsResolved: 0, ...o });
const nowFacts = { dormant: false, unanswered: 0, staleOpps: 0, completenessPct: 90, openAlerts: 0, monthlyFee: null, replyHitRate: null, replyLeads: 0 };

test("wins and issues each rest on a real count; small samples are not turned into rates", () => {
  const r = qbrFindings(qf({ contactsAdded: 120, healthStart: 58, healthEnd: 84, healthDays: 80, wonCount: 4, wonValue: 18_000, pipelineCreated: 45_000, apptWithOutcome: 30, apptShowed: 24, alertsResolved: 3 }), qf({ contactsAdded: 80 }), { ...nowFacts, monthlyFee: 2500 });
  const wins = r.wins.map((w) => w.text).join("\n");
  assert.match(wins, /120 new contacts came in \(up 40 from 80 contacts|120 new contacts came in/);
  assert.match(wins, /4 deals won, worth \$18,000/);
  assert.match(wins, /health score rose from 58 to 84/);
  assert.match(wins, /80% of 30 appointments/);
  assert.match(wins, /3 problems SubSync flagged were sorted out/);
  assert.match(wins, /\$45,000 of new deals started, 6x what the client paid for the quarter/);
  assert.equal(r.issues.length, 0);
  const small = qbrFindings(qf({ apptWithOutcome: 6, apptShowed: 1, healthStart: 50, healthEnd: 20, healthDays: 5 }), null, nowFacts);
  assert.ok(!small.issues.some((i) => /appointments/.test(i.text)), "6 appointments is too few to call a rate");
  assert.ok(!small.issues.some((i) => /health score fell/.test(i.text)), "5 days of history is too little to call a fall");
  assert.equal(small.wins[0].text, "No clear wins show up in the numbers SubSync holds for this period yet.");
});

test("issues name what is wrong right now and what fell", () => {
  const r = qbrFindings(qf({ healthStart: 80, healthEnd: 60, healthDays: 60 }), null, { ...nowFacts, dormant: true, unanswered: 1, staleOpps: 3, completenessPct: 40, openAlerts: 2, replyHitRate: 0.3, replyLeads: 20 });
  const t = r.issues.map((i) => i.text).join("\n");
  for (const re of [/health score fell from 80 to 60/, /gone quiet/, /1 customer message is waiting/, /3 open deals have not moved/, /only 40% complete/, /2 alerts are still open/, /30% of the last 20 new leads/]) assert.match(t, re);
});

test("what SubSync caught: alerts in the quarter grouped in plain words, with how many were sorted out; sync problems are not a result for the client", () => {
  const q = { from: "2026-10-01", to: "2026-12-31" };
  const p = proofSummary([
    { kind: "sla", title: "Alpha has 12 messages waiting", createdAt: "2026-10-05T10:00:00Z", resolvedAt: "2026-10-06T10:00:00Z" },
    { kind: "sla", title: "Alpha has 5 messages waiting", createdAt: "2026-10-20T10:00:00Z", resolvedAt: null },
    { kind: "stale", title: "Deals stopped moving", createdAt: "2026-11-01T00:00:00Z", resolvedAt: null },
    { kind: "sync", title: "Sync failed", createdAt: "2026-10-10T10:00:00Z", resolvedAt: null },
    { kind: "sla", title: "Last quarter", createdAt: "2026-09-30T23:00:00Z", resolvedAt: null },
  ], q);
  assert.deepEqual([p.total, p.resolved], [3, 1]);
  assert.deepEqual(p.groups.map((g) => [g.label, g.raised, g.resolved]), [["Customer messages were left waiting", 2, 1], ["Deals stopped moving", 1, 0]]);
  assert.deepEqual(proofSummary([], q), { total: 0, resolved: 0, groups: [] });
});

test("the money figures count only deals with a value and an owner, inside the window, from the same rule as every other screen", () => {
  const day = 86_400_000;
  const from = NOW - 30 * day;
  const d = (o: Partial<{ locationId: string; status: string; value: number; assignedTo: string | null; createdAt: number | null; statusChangedAt: number | null }>) => ({ locationId: "L1", status: "open", value: 1000, assignedTo: "u1", createdAt: NOW - 5 * day, statusChangedAt: null, ...o });
  const f = dealFigures([
    d({}), d({ value: 500 }),
    d({ value: 0 }), d({ assignedTo: null }), // left out: no value, no owner
    d({ createdAt: NOW - 40 * day }), // started before the window
    d({ status: "won", value: 2000, createdAt: NOW - 50 * day, statusChangedAt: NOW - 3 * day }),
    d({ status: "won", value: 9000, createdAt: NOW - 50 * day, statusChangedAt: NOW - 45 * day }), // won before the window
    d({ locationId: "L2", value: 700 }),
  ], from, NOW);
  assert.deepEqual(f.get("L1"), { pipelineCreated: 1500 + 0, wonValue: 2000, wonCount: 1 });
  assert.deepEqual(f.get("L2"), { pipelineCreated: 700, wonValue: 0, wonCount: 0 });
  assert.equal(f.get("L3"), undefined);
});

test("a review ends with next steps that follow from its issues, and always with a goal for the next quarter", () => {
  const none = qbrFindings(qf({ contactsAdded: 10 }), null, nowFacts);
  assert.deepEqual(none.steps.map((x) => x.text), ["Agree one goal for next quarter and book the next review."]);
  const r = qbrFindings(qf(), null, { ...nowFacts, dormant: true, unanswered: 4, staleOpps: 2, completenessPct: 30, openAlerts: 1, replyHitRate: 0.2, replyLeads: 30 });
  const t = r.steps.map((x) => x.text);
  assert.equal(t.length, 7);
  assert.match(t[0], /Reply to the 4 waiting customer messages first/);
  assert.match(t[t.length - 1], /next review/);
});

test("the review can be copied as plain text for an email, with the sender's own name instead of the product's", () => {
  const t = reviewText({ client: "Alpha Dental", quarter: "Q4 2026 (Oct to Dec)", wins: [{ text: "4 deals won, worth $18,000." }], issues: [{ text: "2 customer messages are waiting past the reply target." }], steps: [{ text: "Agree one goal for next quarter and book the next review." }], proof: { total: 3, resolved: 2 }, brand: "Acme Marketing" });
  assert.equal(t.split("\n")[0], "Quarterly review: Alpha Dental, Q4 2026 (Oct to Dec)");
  assert.match(t, /What went well\n- 4 deals won, worth \$18,000\./);
  assert.match(t, /What needs attention\n- 2 customer messages/);
  assert.match(t, /What Acme Marketing caught: 3 problems flagged, 2 sorted out\./);
  assert.match(t, /Next steps\n- Agree one goal/);
  assert.doesNotMatch(t, /SubSync/);
  assert.doesNotMatch(t, /\n{3,}/);
  const bare = reviewText({ client: "A", quarter: "Q1", wins: [{ text: "w" }], issues: [], steps: [{ text: "s" }], proof: { total: 0, resolved: 0 } });
  assert.doesNotMatch(bare, /What needs attention|What SubSync caught/);
});
