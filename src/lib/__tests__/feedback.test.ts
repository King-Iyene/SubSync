import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanErrorId, cleanPage, DAILY_LIMIT, FEEDBACK_MAX, parseFeedback, parseProblem, parseSuggestion, personKey, referenceOf, shippedNoticePlan, SUGGEST_TITLE_MAX, voteDigest, wouldSendDetail,
} from "../feedback.ts";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("feedback needs words, trims them, and falls back to safe defaults for the rest", () => {
  assert.equal(parseFeedback({ message: "   " }).ok, false);
  assert.equal(parseFeedback({}).ok, false);
  assert.equal(parseFeedback(null).ok, false);
  assert.equal(parseFeedback({ message: "x".repeat(FEEDBACK_MAX + 1) }).ok, false);
  const ok = parseFeedback({ message: "  Add team view \r\n please ", page: "speed", severity: "blocking" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { message: "Add team view \n please", page: "speed", severity: "blocking" });
  const odd = parseFeedback({ message: "hi", page: "<script>", severity: "nuclear" });
  assert.ok(odd.ok);
  assert.deepEqual(odd.value, { message: "hi", page: null, severity: "idea" }, "a page that is not a menu id is dropped; an unknown severity is a plain idea");
  assert.ok(parseFeedback({ message: "a\u0000b\u0007c" }).ok);
  assert.equal((parseFeedback({ message: "a\u0000b\u0007c" }) as { ok: true; value: { message: string } }).value.message, "abc", "control characters are removed");
});

test("a problem report carries the error ID only when it looks like one", () => {
  const ok = parseProblem({ message: "The list never loaded", errorId: " E-4F2A9C ", page: "inbox" });
  assert.ok(ok.ok);
  assert.equal(ok.value.errorId, "E-4F2A9C");
  assert.equal(parseProblem({ message: "x", errorId: "'; drop table--" }).ok && (parseProblem({ message: "x", errorId: "'; drop table--" }) as { value: { errorId: string | null } }).value.errorId, null);
  assert.equal(cleanErrorId("E-ABC123"), "E-ABC123");
  assert.equal(cleanErrorId("abc"), null);
  assert.equal(cleanErrorId(42), null);
  assert.equal(parseProblem({ message: "" }).ok, false);
  assert.equal(cleanPage("speed"), "speed");
  assert.equal(cleanPage("Speed"), null);
  assert.equal(cleanPage("a".repeat(40)), null);
});

test("a suggestion needs a short title, optional details, and a known importance", () => {
  assert.equal(parseSuggestion({}).ok, false);
  assert.equal(parseSuggestion({ title: "t".repeat(SUGGEST_TITLE_MAX + 1) }).ok, false);
  const ok = parseSuggestion({ title: "Per-person weekly summary", details: "", importance: "critical", page: "roadmap" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { title: "Per-person weekly summary", details: null, importance: "critical", page: "roadmap" });
  assert.equal((parseSuggestion({ title: "t", importance: "huge" }) as { value: { importance: string } }).value.importance, "nice");
  assert.equal(parseSuggestion({ title: "t", details: "d".repeat(1001) }).ok, false);
});

test("the person key is (kind, account, sign-in id) and is the same shape as the roadmap votes use, so one person is one vote", () => {
  assert.equal(personKey("agency", null, "u1"), "agency:agency:u1");
  assert.equal(personKey("client", "L9", "u2"), "client:L9:u2");
  assert.equal(personKey("business", "L9", null), "business:L9:");
  assert.notEqual(personKey("agency", null, "u1"), personKey("agency", null, "u2"));
  // The router's own vote key has exactly this format, so a person is counted once however they vote or write.
  assert.match(read("src/lib/api/router.ts"), /const voterOf = \(ctx: Ctx\) => `\$\{ctx\.kind\}:\$\{ctx\.limitTo \?\? "agency"\}:\$\{ctx\.session\.userId \?\? ""\}`;/);
});

test("a reference is short, readable, and made from the stored id", () => {
  assert.equal(referenceOf("6f9619ff-8b86-d011-b42d-00c04fc964ff"), "R-6F9619");
  assert.match(referenceOf("abcdef12-0000"), /^R-[A-Z0-9]{6}$/);
  assert.ok(DAILY_LIMIT >= 5 && DAILY_LIMIT <= 50);
});

test("the alert to King is a WOULD SEND line with ids only: no text, no title, no address, no name", () => {
  const d = wouldSendDetail("problem", { ref: "R-4F2A9C", errorId: "E-ABC123", page: "inbox" });
  assert.match(String(d.outward), /^RECORDED for the owner inbox/);
  assert.equal(d.to, "king");
  assert.equal(d.event, "problem");
  assert.equal(d.channel, "instant alert (someone is stuck)");
  assert.equal(wouldSendDetail("vote", { item: "slack-alerts" }).channel, "inbox, and the optional daily summary");
  assert.equal(wouldSendDetail("suggestion", { ref: "R-1" }).channel, "inbox, and the optional daily summary");
  assert.deepEqual(Object.keys(d).sort(), ["channel", "errorId", "event", "outward", "page", "ref", "to"]);
  const long = wouldSendDetail("feedback", { ref: "x".repeat(200) });
  assert.equal(String(long.ref).length, 64, "an id is never an excuse to smuggle text");
});

test("nothing in the feedback code can send a message: no email, Slack or fetch import, and the audit line is the only outward step", () => {
  for (const f of ["src/lib/feedback.ts", "src/lib/feedback-queries.ts", "src/lib/api/f8-routes.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /from "[^"]*\/(email|notify)(\.ts)?"/, `${f} imports a sender`);
    assert.doesNotMatch(src, /\b(sendEmail|postToSlack|fetch)\(/, `${f} calls a sender`);
    assert.doesNotMatch(src, /resend|hooks\.slack\.com/i, `${f} names a delivery service`);
  }
  const q = read("src/lib/feedback-queries.ts");
  assert.match(q, /notify\.king\.would_send/);
  // The audit helpers are handed ids and never the message text.
  for (const m of q.matchAll(/recordWouldSend\([^)]*\)/g)) assert.doesNotMatch(m[0], /input\.message|input\.title|input\.details/, "the dry-run line must not carry what the person wrote");
  for (const m of q.matchAll(/audit\(w\.installationId, w\.actor, "(feedback\.received|problem\.reported|roadmap\.suggested)"[^)]*\)/g)) assert.doesNotMatch(m[0], /input\.message|input\.title|input\.details/);
});

test("votes: one company's voters are counted once, and the digest sums per item without naming anyone", () => {
  const plan = shippedNoticePlan([
    { installationId: "b", voter: "agency:agency:u1" }, { installationId: "a", voter: "agency:agency:u1" }, { installationId: "a", voter: "agency:agency:u1" }, { installationId: "a", voter: "client:L1:u2" },
  ]);
  assert.deepEqual(plan, [{ installationId: "a", voters: 2 }, { installationId: "b", voters: 1 }]);
  const digest = voteDigest([
    { itemKey: "x", installationId: "a", kind: "agency" }, { itemKey: "x", installationId: "a", kind: "client" }, { itemKey: "x", installationId: "b", kind: "agency" }, { itemKey: "y", installationId: "a", kind: "agency" },
  ]);
  assert.deepEqual(digest, [{ itemKey: "x", votes: 3, companies: 2, byKind: { agency: 2, client: 1 } }, { itemKey: "y", votes: 1, companies: 1, byKind: { agency: 1 } }]);
  assert.deepEqual(voteDigest([]), []);
});

test("the router sends each feedback route to its handler, only on POST, and the access rules allow them for every kind of session", () => {
  const router = read("src/lib/api/router.ts");
  assert.match(router, /a === "feedback" && !b\) return await giveFeedback/);
  assert.match(router, /a === "problem" && !b\) return await reportProblem/);
  assert.match(router, /a === "roadmap" && b === "suggest" && !c\) return await suggest/);
  const access = read("src/lib/access.ts");
  assert.equal((access.match(/\["POST", "feedback"\]/g) ?? []).length, 2, "business and client");
  assert.equal((access.match(/\["POST", "problem"\]/g) ?? []).length, 2);
});
