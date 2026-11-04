import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES, DEFAULT_SURVIVORSHIP, describeRules, parseRules, parseSurvivorship, pickFields, presetOf, PRESETS } from "../analytics/cleanup-rules.ts";
import { groupDuplicates, scorePair, type Person } from "../analytics/dedupe.ts";
import { checkImport, cleanCsv, parseCsv } from "../analytics/import-check.ts";
import { canonicalFirst, digitsSwapped, firstNamesDiffer, isPlaceholderPhone, isRoleEmail, jaroWinkler, nameSimilarity, soundex, splitName } from "../analytics/name-match.ts";
import { emailFix, findingsOf, fixFor, scanContacts, scoreOf, scoreWord, trendOf, worstFirst, MIN_CONTACTS_FOR_SCORE, type QRow } from "../analytics/quality.ts";

const p = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ada Lovelace", email: null, phone: null, tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null,
  source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});
const q = (id: string, o: Partial<QRow> = {}): QRow => ({ id, firstName: "Ada", lastName: "Lovelace", email: "ada@example-co.com", phone: "+15550102030", tags: [], ...o });

// ---------- names ----------

test("nicknames, initials, spelling and order are recognised, strangers are not", () => {
  assert.equal(canonicalFirst("Bob"), "robert");
  assert.equal(nameSimilarity("Bob Smith", "Robert Smith").kind, "nickname");
  assert.equal(nameSimilarity("J. Smith", "John Smith").kind, "initial");
  assert.equal(nameSimilarity("Jhon Smyth", "John Smith").kind, "spelling");
  assert.equal(nameSimilarity("Smith, John", "John Smith").kind, "exact");
  assert.equal(nameSimilarity("Smith John", "John Smith").kind, "order");
  assert.equal(nameSimilarity("Bob Smith", "Bob Jones").kind, "none");
  assert.equal(nameSimilarity("Madonna", "Madonna").kind, "none", "one word is never enough");
  assert.equal(soundex("Robert"), "R163");
  assert.equal(soundex("Rupert"), "R163");
  assert.ok(jaroWinkler("martha", "marhta") > 0.95);
  assert.deepEqual(splitName("Dr. Ann Marie Lee Jr"), { first: "ann", last: "lee" });
  assert.equal(firstNamesDiffer("Ann Lee", "Bob Lee"), true);
  assert.equal(firstNamesDiffer("Bob Lee", "Robert Lee"), false);
  assert.equal(firstNamesDiffer("A. Lee", "Ann Lee"), false);
});

test("transposed digits, role mailboxes and placeholder numbers", () => {
  assert.equal(digitsSwapped("5550102030", "5550102003"), true);
  assert.equal(digitsSwapped("5550102030", "5550102031"), false);
  assert.equal(digitsSwapped("5550102030", "5550102030"), false);
  assert.equal(isRoleEmail("Info@acme.com"), true);
  assert.equal(isRoleEmail("sales+x@acme.com"), true);
  assert.equal(isRoleEmail("ada@acme.com"), false);
  assert.equal(isPlaceholderPhone("0000000000"), true);
  assert.equal(isPlaceholderPhone("1234567890"), true);
  assert.equal(isPlaceholderPhone("+1 555 010 2030"), false);
});

// ---------- rules and presets ----------

test("balanced is the original behaviour; presets differ in what they link", () => {
  assert.equal(parseRules(undefined), DEFAULT_RULES);
  assert.equal(parseRules({ preset: "nonsense" }).preset, "balanced");
  assert.equal(presetOf(PRESETS.strict), "strict");
  assert.equal(presetOf(parseRules({ preset: "custom", email: "similar", phone: "similar", name: "exact", nameAlone: false, guards: true, threshold: 50 })), "balanced");
  assert.equal(parseRules({ preset: "custom", threshold: 5 }).threshold, 25);
  assert.equal(parseRules({ preset: "custom", threshold: 500 }).threshold, 90);
  const a = p("a", { name: "Ann Lee", phone: "+15550102030" });
  const b = p("b", { name: "Ann Lee", phone: "(555) 010-2030" });
  assert.ok(scorePair(a, b, PRESETS.balanced).score >= 80);
  assert.equal(groupDuplicates([a, b], PRESETS.strict.threshold, 40, PRESETS.strict).length, 0, "strict ignores a number written differently");
  assert.equal(groupDuplicates([a, b], PRESETS.balanced.threshold, 40, PRESETS.balanced).length, 1);
  assert.match(describeRules(PRESETS.loose), /similar name/);
});

test("loose finds a nickname pair and swapped digits that balanced does not", () => {
  const nick = [p("1", { name: "Bob Smith", phone: "+15550101111" }), p("2", { name: "Robert Smith" })];
  assert.equal(groupDuplicates(nick, PRESETS.balanced.threshold, 40, PRESETS.balanced).length, 0);
  const loose = groupDuplicates(nick, PRESETS.loose.threshold, 40, PRESETS.loose);
  assert.equal(loose.length, 1);
  assert.ok(loose[0].reasons.includes("similar name"));
  assert.ok(loose[0].confidence < 50, "a name on its own is only a hint");
  const swap = [p("1", { name: "Ann Lee", phone: "+15550102030" }), p("2", { name: "Ann Lee", phone: "+15550102003" })];
  assert.equal(groupDuplicates(swap, PRESETS.balanced.threshold, 40, PRESETS.balanced).length, 0, "balanced does not look for swapped digits");
  assert.equal(groupDuplicates(swap, PRESETS.loose.threshold, 40, PRESETS.loose).length, 1, "loose does, and the same name confirms it");
  const swapOnly = [p("1", { name: "Ann Lee", phone: "+15550102030" }), p("2", { name: "Annie Leigh", phone: "+15550102003" })];
  assert.equal(groupDuplicates(swapOnly, PRESETS.balanced.threshold, 40, PRESETS.balanced).length, 0);
  assert.equal(groupDuplicates(swapOnly, PRESETS.loose.threshold, 40, PRESETS.loose).length, 1);
  assert.deepEqual(scorePair(swapOnly[0], swapOnly[1], PRESETS.loose).reasons, ["phone with two digits swapped"]);
});

test("a common name is not grouped on the name alone", () => {
  const crowd = Array.from({ length: 12 }, (_, i) => p("c" + i, { name: "Maria Garcia" }));
  assert.equal(groupDuplicates(crowd, PRESETS.loose.threshold, 40, PRESETS.loose).length, 0);
});

test("a shared household phone and a shared company mailbox are not 'almost certainly the same person'", () => {
  const house = scorePair(p("a", { name: "Ann Lee", phone: "+15550102030" }), p("b", { name: "Bob Lee", phone: "+15550102030" }));
  assert.ok(house.score <= 55);
  assert.ok(house.reasons.includes("different first names"));
  assert.ok(house.reasons.includes("same phone"));
  const office = scorePair(p("a", { name: "Ann Lee", email: "info@acme.com" }), p("b", { name: "Carl Wu", email: "info@acme.com" }));
  assert.ok(office.score <= 55);
  assert.ok(office.reasons.includes("shared company mailbox"));
  const same = scorePair(p("a", { name: "Ann Lee", phone: "+15550102030" }), p("b", { name: "Ann Lee", phone: "+15550102030" }));
  assert.ok(same.score >= 90);
  const noGuards = scorePair(p("a", { name: "Ann Lee", phone: "+15550102030" }), p("b", { name: "Bob Lee", phone: "+15550102030" }), { ...PRESETS.balanced, guards: false });
  assert.equal(noGuards.score, 90);
});

// ---------- which value wins ----------

test("survivorship picks the winning value per field and says why", () => {
  const people = [
    { contactId: "a", name: "J Smith", email: "j@x.com", phone: "5550102030", source: "web", createdAt: "2026-01-01T00:00:00Z", lastActivityAt: "2026-02-01T00:00:00Z" },
    { contactId: "b", name: "Jonathan Smith", email: "j@x.com", phone: null, source: "import", createdAt: "2026-03-01T00:00:00Z", lastActivityAt: "2026-04-01T00:00:00Z" },
  ];
  const picks = pickFields(people, "a", DEFAULT_SURVIVORSHIP);
  const by = (f: string) => picks.find((x) => x.field === f)!;
  assert.equal(by("name").value, "Jonathan Smith");
  assert.equal(by("name").from, "b");
  assert.equal(by("name").conflict, true);
  assert.equal(by("email").conflict, false);
  assert.equal(by("phone").value, "5550102030");
  assert.equal(by("source").value, "web", "oldest wins for source");
  const recent = pickFields(people, "a", parseSurvivorship({ name: "recent", source: "recent" }));
  assert.equal(recent.find((x) => x.field === "source")!.value, "import");
  assert.equal(pickFields(people, "a", parseSurvivorship({ name: "kept" })).find((x) => x.field === "name")!.value, "J Smith");
  assert.equal(pickFields(people, "zzz", DEFAULT_SURVIVORSHIP).length, 0);
});

// ---------- data quality ----------

test("every finding is found on its own fixture, and only there", () => {
  const ids = (r: QRow) => findingsOf(r, { countryCode: "+1" });
  assert.deepEqual(ids(q("1")), []);
  assert.deepEqual(ids(q("2", { email: null, phone: null })), ["unreachable"]);
  assert.deepEqual(ids(q("3", { firstName: null, lastName: null, email: null, phone: null })), ["empty_record"]);
  assert.ok(ids(q("4", { firstName: null, lastName: null })).includes("no_name"));
  assert.deepEqual(ids(q("5", { email: "not an email" })), ["bad_email"]);
  assert.deepEqual(ids(q("6", { email: "ada@mailinator.com" })), ["disposable_email"]);
  assert.deepEqual(ids(q("7", { email: "ada@gmial.com" })), ["email_typo"]);
  assert.deepEqual(ids(q("8", { email: "info@acme.com" })), ["role_email"]);
  assert.deepEqual(ids(q("9", { phone: "12345" })), ["bad_phone"]);
  assert.deepEqual(ids(q("10", { phone: "(555) 010-2030" })), ["phone_format"]);
  assert.deepEqual(ids(q("11", { phone: "0000000000" })), ["placeholder_phone"]);
  assert.deepEqual(ids(q("12", { firstName: "ADA", lastName: "LOVELACE" })), ["name_case"]);
  assert.deepEqual(ids(q("13", { firstName: "McDonald", lastName: "O'Neil" })), [], "mixed case was typed on purpose");
  assert.ok(ids(q("14", { firstName: "test", lastName: "user" })).includes("test_record"));
  assert.ok(ids(q("15", { email: "test@example.com" })).includes("test_record"));
  assert.ok(!ids(q("16", { email: "ada@example.com" })).includes("test_record"), "a real-looking name at a reserved domain is not called junk");
  assert.ok(ids(q("17", { email: "x@nowhere.invalid" })).includes("test_record"));
});

test("exact suggested fixes", () => {
  assert.equal(emailFix("ada@gmail.con"), "ada@gmail.com");
  assert.equal(emailFix("ada@acme.cmo"), "ada@acme.com");
  assert.equal(emailFix("ada@gmail.com"), null);
  assert.deepEqual(fixFor(q("1", { email: "ada@gmial.com" }), "email_typo"), [{ field: "email", before: "ada@gmial.com", after: "ada@gmail.com" }]);
  assert.deepEqual(fixFor(q("2", { phone: "(555) 010-2030" }), "phone_format", { countryCode: "+1" }), [{ field: "phone", before: "(555) 010-2030", after: "+15550102030" }]);
  assert.equal(fixFor(q("2", { phone: "(555) 010-2030" }), "phone_format"), null, "no country code, no guess");
  assert.deepEqual(fixFor(q("3", { firstName: "ADA", lastName: "Lovelace" }), "name_case"), [{ field: "firstName", before: "ADA", after: "Ada" }]);
  assert.equal(fixFor(q("4"), "bad_email"), null);
});

test("scan counts equal the rows behind them and the score follows the written formula", () => {
  const rows: QRow[] = [];
  for (let i = 0; i < 100; i++) rows.push(q("g" + i, { email: `p${i}@acme-${i}.com`, phone: "+1555010" + String(1000 + i) }));
  rows.push(q("u1", { email: null, phone: null }), q("u2", { email: null, phone: null }));
  rows.push(q("t1", { phone: "(555) 010-2030" }));
  const scan = scanContacts(rows, { countryCode: "+1" });
  assert.equal(scan.total, 103);
  assert.equal(scan.counts.unreachable, 2);
  assert.equal(scan.ids.unreachable.length, 2, "count equals the rows");
  assert.equal(scan.counts.phone_format, 1);
  const s = scoreOf(scan, 0)!;
  assert.ok(s.score > 90 && s.score < 100);
  assert.equal(s.parts.valid, 100);
  assert.ok(s.parts.reach < 100);
  const worse = scoreOf(scan, 20)!;
  assert.ok(worse.score < s.score, "duplicates lower the score");
  assert.equal(scoreWord(95), "Excellent");
  assert.equal(scoreWord(40), "Needs work");
});

test("a tiny sample gets no score, and an all-junk account scores low", () => {
  assert.equal(scoreOf(scanContacts([q("1"), q("2")]), 0), null);
  assert.equal(MIN_CONTACTS_FOR_SCORE, 50);
  const junk = Array.from({ length: 60 }, (_, i) => q("j" + i, { firstName: "test", lastName: "x", email: null, phone: "0000000000" }));
  const s = scoreOf(scanContacts(junk), 0)!;
  assert.ok(s.score < 60);
});

test("the trend needs history, and is built only from stored snapshots", () => {
  assert.equal(trendOf([]).state, "not_enough");
  assert.equal(trendOf([{ day: "2026-11-01", score: 70 }]).state, "not_enough");
  assert.equal(trendOf([{ day: "2026-11-01", score: 70 }, { day: "2026-11-02", score: 80 }]).state, "not_enough");
  const t = trendOf([{ day: "2026-11-05", score: 82 }, { day: "2026-11-01", score: 70 }]);
  assert.equal(t.state, "ok");
  if (t.state === "ok") assert.equal(t.change, 12);
});

test("the worst client comes first; accounts with no score go last", () => {
  const r = worstFirst([{ name: "B", score: 90, contacts: 10 }, { name: "N", score: null, contacts: 5 }, { name: "A", score: 40, contacts: 10 }]);
  assert.deepEqual(r.map((x) => x.name), ["A", "B", "N"]);
});

// ---------- import check ----------

test("a CSV is compared with the account's contacts", () => {
  const existing = [
    { id: "c1", name: "Ada Lovelace", email: "ada@x.com", phone: "+1 555 010 2030" },
    { id: "c2", name: "Robert Smith", email: null, phone: null },
  ];
  const csv = [
    "First Name,Last Name,E-mail,Mobile",
    "Ada,Lovelace,ADA@x.com,", "Grace,Hopper,grace@x.com,(555) 777-8888", "Grace,Hopper,grace@x.com,", "Bob,Smith,,", "Bad,Email,not-an-email,", "Phil,Phone,,(555) 010-2030",
  ].join("\r\n");
  const c = checkImport(csv, existing);
  assert.equal(c.problem, null);
  assert.deepEqual(c.rows.map((r) => r.verdict), ["exists", "new", "again", "maybe", "invalid", "exists"]);
  assert.equal(c.counts.exists, 2);
  assert.equal(c.rows[3].match?.name, "Robert Smith");
  assert.equal(c.rows[0].match?.id, "c1");
  assert.equal(cleanCsv(c).split("\n").length, 2, "header plus the one new person");
});

test("a CSV with quotes, a missing header or too big is handled in words", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""'), [["a", "b"], ["x, y", 'he said "hi"']]);
  assert.match(checkImport("just one line", []).problem ?? "", /header row/);
  assert.match(checkImport("foo,bar\n1,2", []).problem ?? "", /Name, Email or Phone/);
  assert.match(checkImport("a".repeat(2_000_000), []).problem ?? "", /too big/);
  const many = "Email\n" + Array.from({ length: 5200 }, (_, i) => `u${i}@x.com`).join("\n");
  const c = checkImport(many, []);
  assert.equal(c.total, 5000);
  assert.match(c.problem ?? "", /first 5,000/);
});
