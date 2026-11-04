import assert from "node:assert/strict";
import { test } from "node:test";
import { scorePair, groupDuplicates, type Person } from "../analytics/dedupe.ts";
import { PRESETS } from "../analytics/cleanup-rules.ts";
import { learnWeights, pairKey, scoreEvidence, tierOf } from "../analytics/match-evidence.ts";

const p = (id: string, name: string, email: string | null, phone: string | null, o: Partial<Person> = {}): Person => ({
  contactId: id, name, email, phone, tags: [], createdAt: "2026-03-01T10:00:00Z", lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});
const later = (days: number) => new Date(Date.parse("2026-03-01T10:00:00Z") + days * 86_400_000).toISOString();

// Labelled hard cases: [a, b, the same person?]. Each is a situation people actually have.
const CASES: Array<[string, Person, Person, boolean]> = [
  ["exact email", p("1", "Ann Lee", "ann@x.com", null), p("2", "Ann Lee", "ann@x.com", "+15550100001"), true],
  ["same phone, new email", p("1", "Ann Lee", "ann@old.com", "+1 (555) 010-2000"), p("2", "Ann Lee", "ann.lee@new.com", "+15550102000", { createdAt: later(200) }), true],
  ["new phone, same email", p("1", "Raj Patel", "raj@x.com", "+15550103000"), p("2", "Raj Patel", "raj@x.com", "+15550109999"), true],
  ["name order swapped, same phone", p("1", "Smith John", null, "+15550105000"), p("2", "John Smith", null, "(555) 010-5000"), true],
  ["typo in the name, same email", p("1", "Jhon Smyth", "js@x.com", null), p("2", "John Smith", "js@x.com", null), true],
  ["business and personal email, same person, close in time", p("1", "Dana Fox", "dana.fox@firm.com", null, { source: "web" }), p("2", "Dana Fox", "danafox@gmail.com", null, { source: "web", createdAt: "2026-03-01T10:04:00Z" }), true],
  ["last seven digits (different area code), same name", p("1", "Maya Ortiz", null, "+1 212 555 0142"), p("2", "Maya Ortiz", null, "+1 646 555 0142"), true],
  ["two digits swapped, same name", p("1", "Eli Cohen", null, "+15550142030"), p("2", "Eli Cohen", null, "+15550142003"), true],
  ["initial and the same email", p("1", "J. Moore", "jm@x.com", null), p("2", "Jane Moore", "jm@x.com", null), true],
  ["gmail dots", p("1", "Li Na", "li.na@gmail.com", null), p("2", "Li Na", "lina@gmail.com", null), true],
  ["married name, same phone and first name", p("1", "Kate Hill", null, "+15550106000"), p("2", "Kate Brown", null, "+15550106000"), true],
  ["same phone, different tags, same name", p("1", "Omar Aziz", null, "+15550107000", { tags: ["lead"] }), p("2", "Omar Aziz", null, "+15550107000", { tags: ["customer"] }), true],
  ["email local part alike and same name", p("1", "Tom Reed", "tom.reed@a.com", null), p("2", "Tom Reed", "treed@b.org", null), true],
  ["spouses sharing a phone", p("1", "Ann Lee", "ann@x.com", "+15550108000"), p("2", "Bob Lee", "bob@x.com", "+15550108000"), false],
  ["shared info@ mailbox", p("1", "Carl Wu", "info@wu.com", null), p("2", "Dana Fox", "info@wu.com", null), false],
  ["same common name, nothing else", p("1", "Maria Garcia", "m1@x.com", "+15550111111"), p("2", "Maria Garcia", "m2@y.com", "+15550222222"), false],
  ["same last name only", p("1", "Ann Lee", "ann@x.com", "+15550112000"), p("2", "Bob Lee", "bob@y.com", "+15550113000"), false],
  ["added together by an import, different people", p("1", "Ivy Chen", "ivy@x.com", null, { source: "import" }), p("2", "Max Dole", "max@y.com", null, { source: "import", createdAt: "2026-03-01T10:01:00Z" }), false],
  ["similar email name, different first names", p("1", "Sam Hart", "sam.hart@x.com", null), p("2", "Sara Hart", "sara.hart@x.com", null), false],
  ["office line shared by colleagues", p("1", "Pam Beesly", "pam@dm.com", "+15550114000"), p("2", "Jim Halpert", "jim@dm.com", "+15550114000"), false],
  ["phone differs by one digit, different people", p("1", "Ned Park", "ned@x.com", "+15550115000"), p("2", "Ola Kim", "ola@y.com", "+15550115001"), false],
  ["same tags only", p("1", "Rae Cole", "rae@x.com", null, { tags: ["a", "b"] }), p("2", "Zed Moss", "zed@y.com", null, { tags: ["a", "b"] }), false],
  ["same first name, same domain, different people", p("1", "Amy Stone", "amy.stone@big.com", null), p("2", "Amy Frost", "amy.frost@big.com", null), false],
];

const stats = (predict: (a: Person, b: Person) => boolean) => {
  let tp = 0, fp = 0, fn = 0;
  for (const [, a, b, same] of CASES) { const y = predict(a, b); if (y && same) tp++; else if (y && !same) fp++; else if (!y && same) fn++; }
  return { precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), tp, fp, fn };
};

test("the evidence engine beats the single-rule scorer on the hard cases (precision and recall reported)", () => {
  const old = stats((a, b) => scorePair(a, b, PRESETS.balanced).score >= 50);
  const deep = stats((a, b) => scoreEvidence(a, b).score >= 60);
  console.log(`hard cases: ${CASES.length}; old rule (Normal): precision ${old.precision.toFixed(2)}, recall ${old.recall.toFixed(2)}; evidence engine: precision ${deep.precision.toFixed(2)}, recall ${deep.recall.toFixed(2)}`);
  assert.ok(deep.recall >= 0.85, `recall ${deep.recall}`);
  assert.ok(deep.precision >= 0.9, `precision ${deep.precision}`);
  assert.ok(deep.recall > old.recall + 0.2, "it finds clearly more of the real duplicates");
  assert.ok(deep.precision >= old.precision - 0.05, "without more false alarms");
});

test("each hard case lands in the right tier", () => {
  for (const [name, a, b, same] of CASES) {
    const e = scoreEvidence(a, b);
    if (same) assert.ok(e.score >= 60, `${name}: should be likely or sure, got ${e.score} (${e.reasons.join("; ")})`);
    else assert.ok(e.score < 60, `${name}: should not be called the same person, got ${e.score} (${e.reasons.join("; ")})`);
  }
  assert.equal(tierOf(88), "sure");
  assert.equal(tierOf(70), "likely");
  assert.equal(tierOf(45), "maybe");
  assert.equal(tierOf(10), "none");
});

test("a pair with only 'added at the same time' never passes maybe, and penalties name their reason", () => {
  const e = scoreEvidence(p("1", "Ivy Chen", null, null, { source: "import" }), p("2", "Max Dole", null, null, { source: "import", createdAt: "2026-03-01T10:01:00Z" }));
  assert.ok(e.score <= 30);
  const h = scoreEvidence(p("1", "Ann Lee", "a@x.com", "+15550108000"), p("2", "Bob Lee", "b@x.com", "+15550108000"));
  assert.ok(h.penalties.some((x) => x.id === "household"));
  assert.ok(h.reasons.includes("different first names"));
});

test("deep grouping builds clusters through the strongest links and keeps strangers out; a rejected pair never returns", () => {
  const people = [
    p("a", "Ann Lee", "ann@old.com", "+15550102000"), p("b", "Ann Lee", "ann.lee@new.com", "+15550102000", { createdAt: later(200) }), p("c", "Ann Lee", "ann.lee@new.com", null, { createdAt: later(300) }),
    p("z", "Zed Moss", "zed@y.com", "+15550999999"),
  ];
  const g = groupDuplicates(people, 30, 40, PRESETS.loose);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].people.map((x) => x.contactId).sort(), ["a", "b", "c"]);
  const rejected = new Set([pairKey("a", "b"), pairKey("b", "a"), pairKey("a", "c"), pairKey("b", "c")]);
  assert.equal(groupDuplicates(people, 30, 40, PRESETS.loose, { rejected }).length, 0, "all three pairs were rejected");
});

test("learning: signals that mislead in this account lose weight, and nothing moves on too few decisions", () => {
  const fam = (i: number): [Person, Person] => [p(`f${i}a`, `Ann Smith${i}`, `a${i}@x.com`, `+155501${String(10000 + i)}`), p(`f${i}b`, `Ann Smith${i}`, `b${i}@y.com`, `+155501${String(10000 + i)}`)];
  const mail = (i: number): [Person, Person] => [p(`m${i}a`, `Bo Jones${i}`, `bo${i}@x.com`, null), p(`m${i}b`, `Bo Jones${i}`, `bo${i}@x.com`, `+155502${String(10000 + i)}`)];
  const few = learnWeights({ accepted: [mail(1)], rejected: [fam(1)] });
  assert.equal(few.enough, false);
  assert.deepEqual(few.weights, {});
  const accepted = [1, 2, 3, 4, 5, 6].map(mail);
  const rejected = [1, 2, 3, 4, 5, 6].map(fam);
  const l = learnWeights({ accepted, rejected });
  assert.equal(l.enough, true);
  assert.ok((l.weights.phone_exact ?? 1) < 1, "a shared phone has misled here");
  assert.ok((l.weights.email_exact ?? 1) > 1, "a shared email has not");
  const base = scoreEvidence(...fam(9)).score;
  const learned = scoreEvidence(...fam(9), l.weights).score;
  assert.ok(learned < base, `the shared-phone pair scores lower once learned (${base} to ${learned})`);
});

import { incomingFrom } from "../analytics/arrival-parse.ts";
import { tagPossibleDuplicate } from "../ghl/crm-gateway.ts";

test("a contact-created webhook body is read, whatever the nesting", () => {
  assert.equal(incomingFrom({}), null);
  const a = incomingFrom({ type: "ContactCreate", locationId: "L", id: "c1", firstName: "Ann", lastName: "Lee", email: "a@x.com", phone: "+1555", tags: ["t", 3] });
  assert.deepEqual([a?.contactId, a?.name, a?.email, a?.tags], ["c1", "Ann Lee", "a@x.com", ["t"]]);
  assert.equal(incomingFrom({ contact: { id: "c2", name: "Bo Ray" } })?.name, "Bo Ray");
});

test("prevention tag: only with the account's opt-in and choice, a dry run while the master switch is off, one tag and one audit line when on", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body as string) }); return Response.json({ ok: true }); }) as unknown as typeof fetch;
  const lines: string[] = [];
  const deps = (live: boolean) => ({ env: live ? { WRITE_GHL_LIVE: "true" } : {}, fetchImpl, sleep: async () => undefined, log: () => undefined, audit: async (r: { action: string }) => { lines.push(r.action); } });
  const a = { installationId: "i", locationId: "L", contactId: "c1", actor: null, token: async () => "tok" };
  assert.equal(await tagPossibleDuplicate({ ...a, optedIn: false, preventTag: true }, deps(true)), "skipped");
  assert.equal(await tagPossibleDuplicate({ ...a, optedIn: true, preventTag: false }, deps(true)), "skipped");
  assert.equal(await tagPossibleDuplicate({ ...a, optedIn: true, preventTag: true }, deps(false)), "switched_off");
  assert.equal(calls.length, 0);
  assert.equal(await tagPossibleDuplicate({ ...a, optedIn: true, preventTag: true }, deps(true)), "tagged");
  assert.deepEqual(calls, [{ path: "/contacts/c1/tags", body: { tags: ["possible-duplicate"] } }]);
  assert.deepEqual(lines, ["dry_run.would_write", "crm.write"]);
});
