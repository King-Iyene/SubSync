import assert from "node:assert/strict";
import { test } from "node:test";
import { BRIEF_MAX, candidates, dayLabel, briefDue, briefEmail, briefSlack, briefText, buildBrief, SECTIONS, sectionsOf, type BriefInputs, type Section } from "../analytics/br-core.ts";

const ALL = new Set<Section>(SECTIONS);
const base = (over: Partial<BriefInputs> = {}): BriefInputs => ({
  accounts: 12,
  attention: [
    { kind: "waiting_old", label: "People waited over a day", why: "No reply for 24 hours.", count: 9, accounts: 3, money: 4000, hash: "#speed", topName: "Acme" },
    { kind: "unmarked", label: "Appointments with no outcome", why: "Show rates are wrong.", count: 14, accounts: 4, money: null, hash: "#appointments", topName: null },
    { kind: "stale_deals", label: "Quiet deals", why: "Deals have gone quiet.", count: 6, accounts: 2, money: 9000, hash: "#pipeline", topName: null },
    { kind: "no_phone", label: "Contacts with no phone", why: "Cannot be called.", count: 40, accounts: 5, money: null, hash: "#data-health", topName: null },
  ],
  save: { accounts: [{ locationId: "L1", name: "Acme Roofing", evidence: ["Setup is failing", "Reply speed slipped"], dollarText: "About $1,000", hash: "#clients" }], more: 0 },
  recover: { total: 12, estValue: 7000 },
  deals: { slipping: 6, value: 9000, lost: 2, lostNoReason: 1 },
  wallet: { empty: 1, low: 2, spike: 0, names: ["Dental One"] },
  payments: { count: 3, amount: 1200 },
  ...over,
});

test("the brief holds at most 5 items, stops-working-today first, then money at risk by dollars", () => {
  const b = buildBrief(base(), ALL, "2026-11-11");
  assert.equal(b.items.length, BRIEF_MAX);
  assert.equal(b.items[0].key, "wallet_empty", "an empty balance is tier 1");
  const money = b.items.filter((i) => i.tier === 2 && i.dollars !== null).map((i) => i.dollars as number);
  assert.deepEqual(money, money.slice().sort((x, y) => y - x), "within the money tier the biggest estimate comes first");
  assert.ok(b.more > 0, "there were more candidates than the five shown");
});

test("one problem never appears twice: today's waiting and stale-deal items are dropped when their own section is on", () => {
  const on = buildBrief(base(), ALL, "d");
  assert.ok(!on.items.some((i) => i.key === "today:waiting_old" || i.key === "today:stale_deals"));
  const off = buildBrief(base(), new Set<Section>(["attention"]), "d");
  assert.ok(off.items.some((i) => i.key === "today:waiting_old"), "with the recover section off, the waiting item comes back");
  assert.ok(off.items.some((i) => i.key === "today:stale_deals"));
});

test("section switches remove their items and the dollar line follows what is on", () => {
  const b = buildBrief(base(), new Set<Section>(["wallet"]), "d");
  assert.ok(b.items.every((i) => i.section === "wallet"));
  assert.equal(b.dollar.amount, null);
  assert.match(b.dollar.text, /No dollar estimate yet|Nothing to estimate/);
  const full = buildBrief(base(), ALL, "d");
  assert.equal(full.dollar.amount, 7000 + 9000 + 1200);
  assert.match(full.dollar.text, /estimate/);
  assert.match(full.formula, /twice/);
});

test("nothing to say is said calmly, and counts by section equal the candidates", () => {
  const empty = buildBrief({ accounts: 3, attention: [], save: null, recover: null, deals: null, wallet: null, payments: null }, ALL, "d");
  assert.equal(empty.items.length, 0);
  assert.match(empty.headline, /Nothing needs you today/);
  assert.equal(buildBrief({ ...base(), accounts: 0 }, ALL, "d").headline, "No client accounts yet.");
  const b = buildBrief(base(), ALL, "d");
  assert.equal(Object.values(b.bySection).reduce((t, x) => t + x, 0), b.items.length + b.more);
});

test("the words: no vendor terms, links go to the exact list, slack and plain versions match, estimates are labelled", () => {
  const b = buildBrief(base(), ALL, "d");
  const text = briefText(b, "https://app.example.com/"), slack = briefSlack(b, "https://app.example.com");
  const mail = briefEmail(b, { appUrl: "https://app.example.com", stopUrl: "https://app.example.com/stop", settingsUrl: "https://app.example.com/app#today?brief=settings" });
  for (const s of [text, slack, mail.text, mail.html, mail.subject]) assert.doesNotMatch(s, /gohighlevel|highlevel|\bghl\b|sub-?account/i);
  assert.match(text, /https:\/\/app\.example\.com\/app#clients\?tab=wallet/);
  assert.match(slack, /<https:\/\/app\.example\.com\/app#clients\?tab=wallet\|Open the list>/);
  assert.match(slack, /^\*/);
  assert.match(mail.html, /Stop these emails/);
  assert.match(mail.text, /Stop these emails: https:\/\/app\.example\.com\/stop/);
  assert.match(text, /\(estimate\)/);
  assert.equal((text.match(/Open the list:/g) ?? []).length, b.items.length);
});

test("when it goes: the chosen hour of the person's own day, once, not on quiet days", () => {
  const tz = "America/New_York";
  const at = (h: number) => Date.parse(`2026-11-11T${String(h).padStart(2, "0")}:05:00-05:00`); // a Wednesday
  assert.equal(briefDue(at(6), tz, 7, [], null).due, false, "before the hour");
  const d = briefDue(at(7), tz, 7, [], null);
  assert.equal(d.due, true);
  assert.equal(briefDue(at(8), tz, 7, [], d.key).due, false, "already sent today");
  assert.equal(briefDue(at(7), tz, 7, [3], null).due, false, "Wednesday is a quiet day");
  assert.equal(briefDue(at(11), tz, 7, [], null).due, false, "more than 2 hours late is skipped, not sent at noon");
});

test("sections from stored text: unknown words dropped, empty means all", () => {
  assert.equal(sectionsOf([]).size, SECTIONS.length);
  assert.deepEqual([...sectionsOf(["wallet", "nonsense"])], ["wallet"]);
  assert.equal(sectionsOf(null).size, SECTIONS.length);
});

test("the day reads as a weekday and date, not a code", () => {
  assert.equal(dayLabel("2026-11-12"), "Thursday 12 Nov");
  assert.equal(buildBrief(base(), ALL, "2026-11-12").dayText, "Thursday 12 Nov");
});

test("each fact appears once: a Save line that repeats another item's number is cut, and an empty Save item is dropped", () => {
  const b = buildBrief(base({ attention: [], save: { accounts: [{ locationId: "L2", name: "Test Co", evidence: ["12 people are waiting", "Setup is failing"], dollarText: "", hash: "#clients" }, { locationId: "L3", name: "Only Repeats", evidence: ["12 people are waiting"], dollarText: "", hash: "#clients" }], more: 0 } }), ALL, "2026-11-12");
  const all = candidates(base({ attention: [], save: { accounts: [{ locationId: "L2", name: "Test Co", evidence: ["12 people are waiting", "Setup is failing"], dollarText: "", hash: "#clients" }, { locationId: "L3", name: "Only Repeats", evidence: ["12 people are waiting"], dollarText: "", hash: "#clients" }], more: 0 } }), ALL); void b;
  const save = all.find((x) => x.key === "save:L2");
  assert.ok(save && !/\b14\b/.test(save.why) && /Setup is failing/.test(save.why), "the repeated number is cut, the new fact stays");
  assert.ok(!all.some((x) => x.key === "save:L3"), "a Save item that only repeats the missed-people count (12) is dropped");
  assert.equal(new Set(all.map((x) => x.key)).size, all.length, "no item appears twice");
});

test("each item's count equals the number of rows its list opens (the input total), and an old wait is labelled with its age", () => {
  const i = base({ attention: [{ kind: "no_phone", label: "Contacts with no phone", why: "Cannot be called.", count: 40, accounts: 5, money: null, hash: "#data-health", topName: null, oldestHours: 72 }] });
  const b = buildBrief(i, ALL, "2026-11-12");
  const by = (k: string) => candidates(i, ALL).find((x) => x.key === k);
  assert.equal(by("recover")?.count, i.recover?.total);
  assert.equal(by("deals")?.count, i.deals?.slipping);
  assert.equal(by("payments")?.count, i.payments?.count);
  assert.equal(by("wallet_empty")?.count, i.wallet?.empty);
  assert.match(by("today:no_phone")?.why ?? "", /oldest has waited 3 days/);
});
