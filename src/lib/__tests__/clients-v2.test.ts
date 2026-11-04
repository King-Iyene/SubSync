import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assess, byAttention, clientSummaryText, dateWords, dealsLine, facetsOf, FILTERS, headlineOf, nextStep, parseFilter, parseSort, primaryOf, reminderDays, renewalOf, renewalWords, rowOf, selectClients,
  summarize, supportLine, talkingPoints, valueFormula, valueOf, whatChanged, NEW_CLIENT_DAYS, SORTS,
  type BookRow, type DayPoint, type Signals,
} from "../analytics/clients-v2.ts";
import { pageOf } from "../analytics/speed-v2.ts";

// The Clients book (docs/METRICS.md, "Clients, rebuilt"): the health label and its reason, who needs a check-in first, renewals, fee against value created, what changed,
// what to say. Every figure on the first screen is counted by the same function that picks the list behind it, tested here on small and very small samples and on 150 clients.

const NOW = Date.parse("2026-11-05T09:00:00Z");
const D = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * D).toISOString().slice(0, 10);
const sig = (over: Partial<Signals> = {}): Signals => ({
  id: "L1", name: "Alpha Dental", read: true, score: 70, churn: "low", churnReasons: [], dormant: false, daysInactive: 2, waiting: 0, noShows: 0, quietDeals: 0, quietDealValue: 0,
  replyShare: null, replyJudged: 0, targetMinutes: 15, leadDropPct: null, daysSinceAdded: 200, fee: null, renewalDate: null, industry: null, lastSpokenDays: null, ...over,
});
const row = (over: Partial<Signals> = {}) => rowOf(sig(over), NOW);

test("a client with nothing wrong is Healthy, and a row says so in words", () => {
  const a = assess(sig({ replyShare: 0.92, replyJudged: 14 }), NOW);
  assert.equal(a.level, "healthy");
  assert.equal(a.label, "Healthy");
  assert.match(a.line, /Nothing needs attention\. 92% of the last 14 new leads got a reply in time\./);
  assert.equal(a.needs, null);
  assert.equal(assess(sig(), NOW).line, "Nothing needs attention.");
});

test("at risk: gone quiet, a very low score, a big fall, 15 or more people waiting; each says why with the number", () => {
  const quiet = assess(sig({ dormant: true, daysInactive: 45 }), NOW);
  assert.equal(quiet.level, "at_risk");
  assert.match(quiet.line, /Nothing has happened in the account for 45 days\./);
  const low = assess(sig({ score: 22, churn: "high" }), NOW);
  assert.equal(low.level, "at_risk");
  assert.match(low.line, /Health score is 22 out of 100\./);
  const fell = assess(sig({ score: 60, churn: "high", churnReasons: ["Score fell 31 points from its recent average"] }), NOW);
  assert.equal(fell.level, "at_risk");
  assert.match(fell.line, /Health score fell 31 points/);
  const waiting = assess(sig({ waiting: 15 }), NOW);
  assert.equal(waiting.level, "at_risk");
  assert.match(waiting.line, /15 people are waiting for a reply\./);
  assert.equal(assess(sig({ dormant: true, daysInactive: null }), NOW).line, "SubSync has not seen any activity in this account.");
});

test("watch: a middling score, 5 to 14 people waiting, replies too slow, new contacts down, 3 or more no-shows", () => {
  assert.equal(assess(sig({ score: 48 }), NOW).level, "watch");
  assert.equal(assess(sig({ waiting: 5 }), NOW).level, "watch");
  assert.equal(assess(sig({ waiting: 14 }), NOW).level, "watch");
  assert.equal(assess(sig({ replyShare: 0.4, replyJudged: 12 }), NOW).level, "watch");
  assert.match(assess(sig({ replyShare: 0.4, replyJudged: 12 }), NOW).line, /Only 40% of the last 12 new leads got a reply in time\./);
  assert.match(assess(sig({ replyShare: 0, replyJudged: 24 }), NOW).line, /^None of the last 24 new leads got a reply in time.$/);
  assert.equal(assess(sig({ leadDropPct: 58 }), NOW).level, "watch");
  assert.match(assess(sig({ leadDropPct: 58 }), NOW).line, /New contacts are down 58% against this client's own normal\./);
  assert.equal(assess(sig({ noShows: 3 }), NOW).level, "watch");
});

test("small numbers are mentioned but never change the label", () => {
  // 4 people waiting, 2 no-shows and 5 quiet deals are shown as a line and nothing more.
  const a = assess(sig({ waiting: 4, noShows: 2, quietDeals: 5, quietDealValue: 12_500 }), NOW);
  assert.equal(a.level, "healthy");
  assert.deepEqual(a.reasons.map((r) => r.key), ["waiting", "no_shows", "quiet_deals"]);
  assert.ok(a.reasons.every((r) => r.weight === "info"));
  assert.equal(a.line, "4 people are waiting for a reply.");
  assert.equal(assess(sig({ waiting: 1 }), NOW).line, "1 person is waiting for a reply.");
  assert.match(a.reasons[2].text, /5 deals worth \$12,500 have gone quiet\./);
});

test("a reply speed on a tiny sample is not used: under 5 judged leads there is no claim", () => {
  // The server sends null for the share under the minimum; even if a share arrived with too few leads, the rule refuses it.
  const few = assess(sig({ replyShare: 0.0, replyJudged: 3 }), NOW);
  assert.equal(few.level, "healthy");
  assert.equal(few.reasons.length, 0);
  assert.equal(assess(sig({ replyShare: null, replyJudged: 4 }), NOW).level, "healthy");
  assert.equal(assess(sig({ replyShare: 0.49, replyJudged: 5 }), NOW).level, "watch");
  assert.equal(assess(sig({ replyShare: 0.5, replyJudged: 5 }), NOW).level, "healthy");
});

test("a new client is not judged on score, activity or a drop; waiting customers still count", () => {
  const n = assess(sig({ daysSinceAdded: 6, score: 12, churn: "high", dormant: true, daysInactive: null, leadDropPct: 90 }), NOW);
  assert.equal(n.level, "new");
  assert.match(n.line, /Added 6 days ago\. Too early to judge its health\./);
  assert.equal(assess(sig({ daysSinceAdded: 0, score: 12, dormant: true }), NOW).line, "Added today. Too early to judge its health.");
  assert.equal(assess(sig({ daysSinceAdded: NEW_CLIENT_DAYS - 1 }), NOW).level, "new");
  assert.notEqual(assess(sig({ daysSinceAdded: NEW_CLIENT_DAYS, score: 12, churn: "high" }), NOW).level, "new");
  const busy = assess(sig({ daysSinceAdded: 3, waiting: 20 }), NOW);
  assert.equal(busy.level, "at_risk");
  assert.match(busy.line, /20 people are waiting for a reply\./);
});

test("an account SubSync has not finished reading is 'Not read yet', never judged", () => {
  const a = assess(sig({ read: false, score: 0, dormant: true, waiting: 0 }), NOW);
  assert.equal(a.level, "not_read");
  assert.equal(a.label, "Not read yet");
  assert.match(a.line, /has not finished reading/);
  assert.equal(a.needs, null);
});

test("every client labelled At risk or Watch has a reason that is not just a small note, and none is called Healthy in the needs list", () => {
  const fixtures: Partial<Signals>[] = [{ score: 20 }, { score: 40 }, { churn: "high" }, { churn: "medium" }, { waiting: 9 }, { dormant: true }, { noShows: 6 }, { churn: "medium", score: 80 }, { churn: "high", score: 90 }];
  for (const f of fixtures) {
    const r = row(f);
    if (r.level === "at_risk" || r.level === "watch") {
      assert.ok(r.reasons.some((x) => x.weight !== "info"), JSON.stringify(f));
      assert.ok(r.line.length > 5);
    }
  }
  const healthyDue = row({ renewalDate: iso(9), fee: 2000 });
  assert.equal(healthyDue.level, "healthy");
  assert.ok(healthyDue.needs);
  assert.equal(healthyDue.needs?.label, "Renewal due");
  assert.notEqual(healthyDue.needs?.label, "Healthy");
});

test("renewal words and the day a renewal is due", () => {
  assert.equal(renewalWords(12), "Renews in 12 days");
  assert.equal(renewalWords(1), "Renews tomorrow");
  assert.equal(renewalWords(0), "Renews today");
  assert.equal(renewalWords(-6), "Renewal was 6 days ago");
  assert.equal(renewalWords(-1), "Renewal was 1 day ago");
  assert.equal(renewalWords(150), "Renews in 5 months");
  assert.equal(renewalOf(null, NOW), null);
  assert.equal(renewalOf("not a date", NOW), null);
  const r = renewalOf(iso(12), NOW);
  assert.equal(r?.due, true);
  assert.equal(r?.bucket, "30");
  assert.equal(renewalOf(iso(40), NOW)?.due, false);
  assert.equal(row({ renewalDate: iso(-6) }).needs?.label, "Renewal overdue");
  assert.equal(row({ renewalDate: iso(40) }).needs, null);
  assert.equal(dateWords("2026-12-12", NOW), "12 Dec");
  assert.equal(dateWords("2027-03-31", NOW), "31 Mar 2027");
});

test("who needs you first: at risk, then watch, then a renewal due, then the rest; renewal soonest, then the bigger fee, then the lower score", () => {
  const rows = [
    row({ id: "h", name: "Healthy Co", fee: 9000 }),
    row({ id: "r", name: "Renewal Co", fee: 500, renewalDate: iso(5) }),
    row({ id: "w", name: "Watch Co", score: 45, fee: 800 }),
    row({ id: "a1", name: "Risk Small", score: 20, fee: 1000 }),
    row({ id: "a2", name: "Risk Big", score: 30, fee: 4000 }),
    row({ id: "a3", name: "Risk Renews", score: 25, fee: 1000, renewalDate: iso(10) }),
    row({ id: "n", name: "Newbie", daysSinceAdded: 2 }),
    row({ id: "u", name: "Unread", read: false }),
  ];
  const order = [...rows].sort(byAttention).map((x) => x.id);
  assert.deepEqual(order, ["a3", "a2", "a1", "w", "r", "u", "n", "h"]);
  // Stable: the same input in another order gives the same order.
  assert.deepEqual([...rows].reverse().sort(byAttention).map((x) => x.id), order);
});

test("the counts are the lists: every figure of the first screen equals the clients it opens", () => {
  const rows = [
    row({ id: "a1", dormant: true, daysInactive: 50, fee: 2000, renewalDate: iso(20) }), row({ id: "a2", score: 20, fee: 1500 }), row({ id: "a3", score: 10 }),
    row({ id: "w1", score: 45, fee: 900 }), row({ id: "w2", waiting: 7, renewalDate: iso(-3), fee: 1200 }),
    row({ id: "h1", renewalDate: iso(45), fee: 3000 }), row({ id: "h2" }), row({ id: "h3", renewalDate: iso(90) }),
    row({ id: "n1", daysSinceAdded: 1 }), row({ id: "u1", read: false }),
  ];
  const s = summarize(rows);
  assert.equal(s.total, 10);
  assert.equal(s.atRisk, selectClients(rows, { filter: "at_risk" }).length);
  assert.equal(s.atRisk, 3);
  assert.equal(s.watch, 2);
  assert.equal(s.healthy, 3);
  assert.equal(s.newClients, 1);
  assert.equal(s.notRead, 1);
  assert.equal(s.atRisk + s.watch + s.healthy + s.newClients + s.notRead, s.total);
  assert.equal(s.renewalsDue, 2); // a1 in 20 days, w2 overdue; h1 in 45 days is not due within 30
  assert.equal(s.renewalsOverdue, 1);
  assert.equal(s.renewals60, 3); // a1, w2 and h1 (45 days)
  assert.equal(s.renewals60Fee, 2000 + 1200 + 3000);
  assert.equal(s.atRiskFee, 3500);
  assert.equal(s.atRiskFeeKnown, 2);
  assert.equal(s.feeCount, 5);
  assert.equal(s.feeTotal, 2000 + 1500 + 900 + 1200 + 3000);
  const f = facetsOf(rows);
  for (const k of FILTERS) assert.equal(f[k], selectClients(rows, { filter: k }).length, k);
  assert.equal(f.needs, s.needYou);
  assert.equal(f.all, 10);
  assert.equal(f.no_fee, 5);
});

test("search and sort: by name or industry, biggest fee, renewal soonest (no date last), lowest health", () => {
  const rows = [
    row({ id: "1", name: "Zed Plumbing", fee: 500, industry: "Home services", renewalDate: iso(50), score: 80 }),
    row({ id: "2", name: "Alpha Dental", fee: 3000, industry: "Medical and dental", renewalDate: iso(10), score: 60 }),
    row({ id: "3", name: "Mid Realty", fee: null, industry: "Real estate", score: 90 }),
  ];
  assert.deepEqual(selectClients(rows, { q: "dental" }).map((r) => r.id), ["2"]);
  assert.deepEqual(selectClients(rows, { q: "real estate" }).map((r) => r.id), ["3"]);
  assert.deepEqual(selectClients(rows, { sort: "name" }).map((r) => r.id), ["2", "3", "1"]);
  assert.deepEqual(selectClients(rows, { sort: "fee" }).map((r) => r.id), ["2", "1", "3"]);
  assert.deepEqual(selectClients(rows, { sort: "renewal" }).map((r) => r.id), ["2", "1", "3"]);
  assert.deepEqual(selectClients(rows, { sort: "score" }).map((r) => r.id), ["2", "1", "3"]);
  assert.equal(parseFilter("bogus"), "all");
  assert.equal(parseFilter("needs"), "needs");
  assert.equal(parseSort("bogus"), "attention");
  assert.ok(SORTS.every((k) => parseSort(k) === k));
});

test("the sentence and the one button", () => {
  const risky = summarize([row({ id: "a", dormant: true, daysInactive: 40, fee: 2000, renewalDate: iso(10) }), row({ id: "b", score: 20, fee: 2200 }), row({ id: "c", score: 15, renewalDate: iso(25) }), row({ id: "d" })]);
  const h = headlineOf(risky);
  assert.equal(h.text, "3 clients look at risk, 2 renewals due within 30 days, $4,200 a month at stake.");
  assert.equal(h.allClear, false);
  assert.deepEqual(h.parts.filter((p) => p.strong).map((p) => p.t), ["3", "2", "$4,200"]);
  assert.equal(supportLine(risky), "The money is the monthly fees you typed. 2 of the 3 clients at risk have one.");
  assert.deepEqual(primaryOf(risky, { name: "x" }), { label: "Check in with the 3 clients at risk", kind: "queue", filter: "at_risk" });

  const one = summarize([row({ id: "a", name: "Solo Co", score: 10, fee: 1000 }), row({ id: "b" })]);
  assert.equal(headlineOf(one).text, "1 client looks at risk, $1,000 a month at stake.");
  assert.equal(primaryOf(one, { name: "Solo Co" })?.label, "Check in with Solo Co");

  const watching = summarize([row({ id: "a", score: 45 }), row({ id: "b", score: 40 }), row({ id: "c" })]);
  assert.equal(headlineOf(watching).text, "No client looks at risk, 2 are worth watching.");
  assert.equal(primaryOf(watching, null)?.label, "Look at the 2 clients to watch");

  const renewal = summarize([row({ id: "a", fee: 1000, renewalDate: iso(7) }), row({ id: "b" })]);
  assert.equal(headlineOf(renewal).text, "No client looks at risk, 1 renewal due within 30 days.");
  assert.equal(primaryOf(renewal, null)?.label, "Prepare the renewal");
});

test("with nothing wrong the page is calm and says what to do next; on first use the one button adds a fee", () => {
  const calm = summarize([row({ id: "a", fee: 1500, renewalDate: iso(100), industry: "Real estate" }), row({ id: "b", fee: 1000, renewalDate: iso(200), industry: "Real estate" })]);
  const h = headlineOf(calm);
  assert.equal(h.allClear, true);
  assert.equal(h.text, "2 clients look healthy. Nobody needs a check-in.");
  assert.equal(primaryOf(calm, null), null);
  assert.match(nextStep(calm) ?? "", /Nothing to do right now/);
  assert.match(supportLine(calm), /2 clients have a fee you typed, \$2,500 a month in all\./);

  const first = summarize([row({ id: "a" }), row({ id: "b" })]);
  assert.equal(first.noFees, true);
  assert.deepEqual(primaryOf(first, null), { label: "Add your first client fee", kind: "fee", filter: null });
  assert.match(supportLine(first), /does not know what your clients pay you/);
  assert.match(nextStep(first) ?? "", /Add what each client pays you/);
  assert.match(nextStep(summarize([row({ id: "a", fee: 1000 }), row({ id: "b" })])) ?? "", /renewal date/);
  assert.equal(headlineOf(summarize([])).text, "No client accounts yet.");
});

test("value created: needs the fee, needs 3 new deals for a multiple, says what it counts", () => {
  assert.equal(valueOf({ fee: null, pipeline30: 18_000, dealsStarted30: 6, won30: 0, wonCount30: 0 }).kind, "needs_fee");
  const none = valueOf({ fee: 2500, pipeline30: 0, dealsStarted30: 0, won30: 0, wonCount30: 0 });
  assert.equal(none.kind === "ok" && none.multiple, null);
  assert.match(none.sentence, /No new deals started in the last 30 days\. They pay you \$2,500 a month\./);
  const few = valueOf({ fee: 2500, pipeline30: 4000, dealsStarted30: 2, won30: 0, wonCount30: 0 });
  assert.equal(few.kind === "ok" && few.multiple, null);
  assert.match(few.sentence, /2 new deals worth \$4,000 started in the last 30 days\. That is too few to compare with the \$2,500 fee\./);
  const ok = valueOf({ fee: 2500, pipeline30: 18_000, dealsStarted30: 6, won30: 7000, wonCount30: 2 });
  assert.equal(ok.kind === "ok" && ok.multiple, 7.2);
  assert.match(ok.sentence, /6 new deals worth \$18,000 started in the last 30 days: about 7\.2x the \$2,500 they pay you each month\. 2 deals were won, worth \$7,000\./);
  assert.match(valueFormula(), /\$18,000 of new deals shows 7\.2x/);
  assert.match(valueFormula(), /value above zero and an owner/);
  assert.equal(dealsLine({ pipeline30: 0, dealsStarted30: 0, won30: 0, wonCount30: 0 }), null);
  assert.equal(dealsLine({ pipeline30: 18_000, dealsStarted30: 6, won30: 0, wonCount30: 0 }), "6 new deals worth $18,000 started in the last 30 days.");
  assert.doesNotMatch(dealsLine({ pipeline30: 18_000, dealsStarted30: 6, won30: 7000, wonCount30: 1 }) ?? "", /fee|pay/);
});

const dayList = (n: number, f: (i: number) => Partial<DayPoint>): DayPoint[] => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse("2026-09-01T00:00:00Z") + i * D).toISOString().slice(0, 10), healthScore: null, openValue: null, newContacts30d: null, ...f(i) }));

test("what changed: says so when the record is short, never compares across a gap, claims only real moves", () => {
  assert.match(whatChanged([]).note ?? "", /no daily record/);
  const short = whatChanged(dayList(10, () => ({ healthScore: 50 })));
  assert.equal(short.enough, false);
  assert.match(short.note ?? "", /watched this client for 10 days\. Changes show once there are 28 days of record\./);
  const fell = whatChanged(dayList(60, (i) => ({ healthScore: i < 30 ? 70 : 52, newContacts30d: i < 30 ? 40 : 18, openValue: i < 30 ? 50_000 : 30_000 })));
  assert.equal(fell.enough, true);
  assert.ok(fell.lines.some((l) => /Health score fell from 70 to 52\./.test(l)));
  assert.ok(fell.lines.some((l) => /New contacts: down 55% from 40/.test(l)));
  assert.ok(fell.lines.some((l) => /Open pipeline went from \$50,000 to \$30,000\./.test(l)));
  const steady = whatChanged(dayList(60, () => ({ healthScore: 60, newContacts30d: 30, openValue: 10_000 })));
  assert.deepEqual(steady.lines, []);
  assert.equal(steady.note, "Nothing moved much in the last month.");
  // A tiny base never gets a percentage: 4 down to 1 is "down 3 from 4 (too few for a percentage)", and only said when the move is at least 3.
  const tiny = whatChanged(dayList(60, (i) => ({ newContacts30d: i < 30 ? 4 : 1 })));
  assert.ok(tiny.lines.some((l) => /Down 3 from 4|down 3 from 4/.test(l) && /too few for a percentage/.test(l)), tiny.lines.join("|"));
  assert.ok(tiny.lines.every((l) => !/%/.test(l)));
});

test("what to say: a line for each real reason, a renewal line that leads with what was delivered, no fee and no product name", () => {
  const r = rowOf(sig({ waiting: 12, dormant: false, score: 30, replyShare: 0.3, replyJudged: 10, renewalDate: iso(9), fee: 2500 }), NOW);
  const dl = dealsLine({ pipeline30: 18_000, dealsStarted30: 6, won30: 0, wonCount30: 0 });
  const pts = talkingPoints(r.reasons, r.renewal, { name: r.name, dealsLine: dl, nowMs: NOW });
  const keys = pts.map((p) => p.key);
  assert.ok(keys.includes("waiting") && keys.includes("reply_speed") && keys.includes("score_low") && keys.includes("renewal"));
  const renewal = pts.find((p) => p.key === "renewal");
  assert.match(renewal?.say ?? "", /agreement renews on 14 Nov/);
  assert.match(renewal?.say ?? "", /6 new deals worth \$18,000 started in the last 30 days/);
  for (const p of pts) { assert.doesNotMatch(p.say, /2,?500|fee|SubSync|HighLevel|GoHighLevel/i); assert.ok(p.say.length > 20); }
  // Text only: nothing in a talking point is an action.
  assert.ok(pts.every((p) => typeof p.say === "string"));
  assert.deepEqual(talkingPoints([], null, { name: "x", dealsLine: null, nowMs: NOW }), []);
});

test("renewal reminder days are a display: 60, 30 and 14 days before, only those still ahead", () => {
  const all = reminderDays(iso(90), NOW);
  assert.deepEqual(all.map((x) => x.before), [60, 30, 14]);
  assert.equal(all[0].date, iso(30));
  assert.deepEqual(reminderDays(iso(20), NOW).map((x) => x.before), [14]);
  assert.deepEqual(reminderDays(iso(5), NOW), []);
  assert.deepEqual(reminderDays(null, NOW), []);
  assert.deepEqual(reminderDays("nonsense", NOW), []);
});

test("the client summary leaves out the fee and the private notes, names no product, and uses the sender's own name", () => {
  const r = rowOf(sig({ waiting: 12, score: 30 }), NOW);
  const dl = dealsLine({ pipeline30: 18_000, dealsStarted30: 6, won30: 0, wonCount30: 0 });
  const changed = whatChanged(dayList(60, (i) => ({ healthScore: i < 30 ? 70 : 52 })));
  const text = clientSummaryText({ name: "Alpha Dental", brand: "Acme Marketing", label: r.label, reasons: r.reasons, changed, valueLine: dl, renewalLine: "Renews on 14 Nov.", on: "5 Nov 2026" });
  assert.match(text, /^Acme Marketing: Account check-in, Alpha Dental, 5 Nov 2026/);
  assert.match(text, /Where things stand: At risk\./);
  assert.match(text, /12 people are waiting for a reply\./);
  assert.match(text, /Health score fell from 70 to 52\./);
  assert.match(text, /6 new deals worth \$18,000/);
  assert.match(text, /Suggested next steps/);
  assert.doesNotMatch(text, /pay you|monthly fee|fee|SubSync|GoHighLevel|HighLevel|\bGHL\b/i);
  const plain = clientSummaryText({ name: "Alpha Dental", brand: null, label: "Healthy", reasons: [], changed: { lines: [], historyDays: 5, enough: false, note: "x" }, valueLine: null, renewalLine: null, on: "5 Nov 2026" });
  assert.match(plain, /^Account check-in, Alpha Dental, 5 Nov 2026\n\nWhere things stand: Healthy\.$/);
});

test("nothing the module writes names the platform or uses old words", () => {
  const rows = [row({ dormant: true, daysInactive: 40, renewalDate: iso(3), fee: 100 }), row({ waiting: 9 }), row({ read: false }), row({ daysSinceAdded: 1 }), row({})];
  const all = rows.flatMap((r) => [r.line, ...r.reasons.map((x) => x.text), ...r.context, r.renewal?.words ?? "", r.needs?.label ?? ""]);
  all.push(headlineOf(summarize(rows)).text, supportLine(summarize(rows)), nextStep(summarize(rows)) ?? "", valueFormula());
  for (const t of all) assert.doesNotMatch(t, /gohighlevel|highlevel|\bghl\b|leadconnector|sub-?account|\blocation\b/i, t);
});

test("150 clients: ranking is stable, every count equals its list, and a page is 25 rows", () => {
  const rows: BookRow[] = Array.from({ length: 150 }, (_, i) => row({
    id: `L${i}`, name: `Client ${String(i).padStart(3, "0")}`, score: 10 + (i * 7) % 90, waiting: i % 17 === 0 ? 16 : i % 11 === 0 ? 6 : 0, dormant: i % 29 === 0, daysInactive: i % 29 === 0 ? 60 : 3,
    fee: i % 4 === 0 ? null : 500 + (i % 9) * 250, renewalDate: i % 5 === 0 ? iso((i % 80) - 10) : null, read: i % 41 !== 0, daysSinceAdded: i % 23 === 0 ? 4 : 120,
  }));
  const s = summarize(rows);
  assert.equal(s.total, 150);
  assert.equal(s.atRisk + s.watch + s.healthy + s.newClients + s.notRead, 150);
  const needs = selectClients(rows, { filter: "needs" });
  assert.equal(needs.length, s.needYou);
  const page = pageOf(needs, 0, 25);
  assert.equal(page.rows.length, Math.min(25, needs.length));
  assert.equal(page.total, needs.length);
  // Walking every page of every filter gives each client exactly once, in the order of the whole list.
  for (const f of FILTERS) {
    const list = selectClients(rows, { filter: f });
    const walked: string[] = [];
    for (let p = 0; p < pageOf(list, 0, 25).pages; p++) walked.push(...pageOf(list, p, 25).rows.map((x) => x.id));
    assert.deepEqual(walked, list.map((x) => x.id), f);
    assert.equal(new Set(walked).size, walked.length, f);
  }
  assert.deepEqual(selectClients([...rows].reverse(), { filter: "needs" }).map((r) => r.id), needs.map((r) => r.id));
  // The first five of "Who needs you" are the five worst by the rule, and none is called Healthy.
  const top = needs.slice(0, 5);
  assert.ok(top.every((r) => r.level !== "healthy"));
  assert.ok(top.every((r) => r.needs !== null));
});
