import assert from "node:assert/strict";
import { test } from "node:test";
import { routeAllowed } from "../access.ts";
import { BASIS_PHRASE, cleanSaleSettings, creditSale, DEFAULT_SALE_SETTINGS, rankActive, sectionOf, soldRate, tallySales, type SaleFact, type SaleSettings } from "../analytics/sale-basis-core.ts";

// Fixtures: one account (L1). u-set books, u-clo and u-clo2 close, u-adm is nobody's closer.
const isCloser = (u: string) => u === "u-clo" || u === "u-clo2";
const fact = (o: Partial<SaleFact>): SaleFact => ({ locationId: "L1", owner: "u-clo", booker: "u-set", assignee: null, dealWon: false, dealHasValue: false, paid: false, paidHasValue: false, dealValue: 0, paidAmount: 0, n: 1, ...o });
const S = (basis: SaleSettings["basis"], countWithoutValue = true): SaleSettings => ({ basis, countWithoutValue });

test("settings: unknown or missing values fall back to deals won, counting sales without a dollar value", () => {
  assert.deepEqual(cleanSaleSettings(null), DEFAULT_SALE_SETTINGS);
  assert.deepEqual(cleanSaleSettings({ basis: "nonsense", countWithoutValue: "yes" }), DEFAULT_SALE_SETTINGS);
  assert.deepEqual(cleanSaleSettings({ basis: "payment", countWithoutValue: false }), { basis: "payment", countWithoutValue: false });
});

test("deal won basis: the closer is whoever the meeting was assigned to; a payment alone is not a sale", () => {
  const won = creditSale(fact({ dealWon: true, dealHasValue: true, dealValue: 500 }), S("deal_won"), isCloser, true);
  assert.deepEqual(won, { sold: true, closer: "u-clo", value: 500 });
  assert.equal(creditSale(fact({ paid: true, paidHasValue: true, paidAmount: 90 }), S("deal_won"), isCloser, true).sold, false);
});

test("without a dollar value: counted when the option is on, left out when it is off", () => {
  const f = fact({ dealWon: true, dealHasValue: false, dealValue: 0 });
  assert.equal(creditSale(f, S("deal_won", true), isCloser, true).sold, true);
  assert.equal(creditSale(f, S("deal_won", false), isCloser, true).sold, false);
});

test("payment basis: a deal marked won without a payment is not a sale, and unreadable payments are never guessed", () => {
  const paid = fact({ paid: true, paidHasValue: true, paidAmount: 250 });
  assert.deepEqual(creditSale(paid, S("payment"), isCloser, true), { sold: true, closer: "u-clo", value: 250 });
  assert.equal(creditSale(fact({ dealWon: true, dealHasValue: true, dealValue: 900 }), S("payment"), isCloser, true).sold, false);
  assert.equal(creditSale(paid, S("payment"), isCloser, false).sold, false);
});

test("assigned closer basis: a lead that became a customer while assigned to a closer is done, with no dollar value needed", () => {
  const c = creditSale(fact({ owner: null, assignee: "u-clo2", dealWon: true }), S("assigned_closer"), isCloser, true);
  assert.deepEqual(c, { sold: true, closer: "u-clo2", value: 0 });
  // paid also makes a customer, and the payment amount is the value
  assert.deepEqual(creditSale(fact({ assignee: "u-clo", paid: true, paidHasValue: true, paidAmount: 75 }), S("assigned_closer"), isCloser, true), { sold: true, closer: "u-clo", value: 75 });
  // assigned to someone who is not a closer, or to nobody: not credited
  assert.equal(creditSale(fact({ assignee: "u-adm", dealWon: true }), S("assigned_closer"), isCloser, true).sold, false);
  assert.equal(creditSale(fact({ assignee: null, dealWon: true }), S("assigned_closer"), isCloser, true).sold, false);
  // not yet a customer: not a sale
  assert.equal(creditSale(fact({ assignee: "u-clo" }), S("assigned_closer"), isCloser, true).sold, false);
  // payments unreadable: only the deal-won route to "customer" remains
  assert.equal(creditSale(fact({ assignee: "u-clo", paid: true, paidHasValue: true, paidAmount: 75 }), S("assigned_closer"), isCloser, false).sold, false);
});

const facts: SaleFact[] = [
  fact({ owner: "u-clo", booker: "u-set", assignee: "u-clo2", dealWon: true, dealHasValue: true, dealValue: 1000, n: 2 }),
  fact({ owner: "u-clo2", booker: "u-set", assignee: "u-clo2", paid: true, paidHasValue: true, paidAmount: 300, n: 1 }),
  fact({ owner: "u-clo", booker: null, assignee: "u-adm", dealWon: true, n: 3 }),
];

test("the same appointments give different, internally consistent tallies under each basis", () => {
  const dealWon = tallySales(facts, S("deal_won"), isCloser, true);
  assert.equal(dealWon.total.count, 5);
  assert.equal(dealWon.byCloser.get("u-clo")?.count, 5);
  assert.equal(dealWon.total.value, 2000);

  const pay = tallySales(facts, S("payment"), isCloser, true);
  assert.equal(pay.total.count, 1);
  assert.equal(pay.byCloser.get("u-clo2")?.value, 300);
  assert.equal(pay.byCloser.get("u-clo"), undefined);

  const asg = tallySales(facts, S("assigned_closer"), isCloser, true);
  assert.equal(asg.total.count, 3, "two won with a closer assigned, one paid; the one assigned to a non-closer is out");
  assert.equal(asg.byCloser.get("u-clo2")?.count, 3);
  assert.equal(asg.byCloser.get("u-clo"), undefined);
});

test("role credit: the closer gets the sale, the setter gets 'from their bookings', and the two add up to the same total", () => {
  const t = tallySales(facts, S("deal_won"), isCloser, true);
  assert.equal(t.byBooker.get("u-set")?.count, 2, "booker credit counts only sales on meetings they booked");
  assert.equal(t.byBooker.has("u-clo"), false);
  const closerSum = [...t.byCloser.values()].reduce((a, b) => a + b.count, 0);
  assert.equal(closerSum, t.total.count, "every counted sale has one closer");
});

test("every figure carries its basis in plain words", () => {
  assert.equal(BASIS_PHRASE.deal_won, "counted from deals won");
  assert.match(BASIS_PHRASE.payment, /payments received/);
  assert.match(BASIS_PHRASE.assigned_closer, /assigned closer/);
});

test("grouping: sales or bookings first, then on a calendar, then on none", () => {
  assert.equal(sectionOf({ booked: 3, owned: 0, sold: 0, calendars: 0 }), "active");
  assert.equal(sectionOf({ booked: 0, owned: 0, sold: 1, calendars: 0 }), "active");
  assert.equal(sectionOf({ booked: 0, owned: 0, sold: 0, calendars: 2 }), "oncal");
  assert.equal(sectionOf({ booked: 0, owned: 0, sold: 0, calendars: 0 }), "off");
  const people = [{ booked: 0, owned: 0, sold: 0, calendars: 0 }, { booked: 0, owned: 0, sold: 0, calendars: 4 }, { booked: 5, owned: 0, sold: 0, calendars: 1 }, { booked: 0, owned: 2, sold: 1, calendars: 1 }];
  const by = { active: 0, oncal: 0, off: 0 };
  for (const p of people) by[sectionOf(p)]++;
  assert.deepEqual(by, { active: 2, oncal: 1, off: 1 });
  assert.equal(by.active + by.oncal + by.off, people.length, "count of the groups equals the people");
});

test("ranking: sales, then sales value, then bookings, then name", () => {
  const r = rankActive([
    { name: "Cy", booked: 9, owned: 0, sold: 0, soldValue: 0 }, { name: "Al", booked: 1, owned: 0, sold: 2, soldValue: 100 },
    { name: "Bo", booked: 1, owned: 0, sold: 2, soldValue: 900 }, { name: "Di", booked: 4, owned: 0, sold: 0, soldValue: 0 },
  ]);
  assert.deepEqual(r.map((x) => x.name), ["Bo", "Al", "Cy", "Di"]);
});

test("closed rate needs at least 5 meetings taken", () => {
  assert.equal(soldRate(2, 4), null);
  assert.equal(soldRate(2, 8), 0.25);
  assert.equal(soldRate(9, 5), 1);
});

test("who may change the setting: the company and its administrators; a client's staff can only read", () => {
  assert.equal(routeAllowed("agency", "PUT", ["appointments", "sale-basis"]), true);
  assert.equal(routeAllowed("business", "PUT", ["appointments", "sale-basis"]), true);
  assert.equal(routeAllowed("client", "PUT", ["appointments", "sale-basis"]), false);
  assert.equal(routeAllowed("client", "GET", ["appointments", "sale-basis"]), true);
});
