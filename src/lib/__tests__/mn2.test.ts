import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  callStatus, coachRows, decodeCursor, encodeCursor, freeItems, isDay, isUuid, likeOf, MAX_PAGE, MAX_TASKS_PER_CALL, MIN_COACH_CALLS, nextStep, outcomeState, outcomeWords, parseListQuery, planTasks, talkShare, weeklyLine,
  type CoachCall,
} from "../analytics/mn2.ts";
import { parseFathomDelivery } from "../connections/fathom.ts";

const ID = "6f1c8f0a-1b2c-4d3e-8f9a-0123456789ab";

test("a list address is read safely: unknown words fall back, dates must be real, the page size is capped, a bad cursor is dropped", () => {
  const q = parseListQuery(new URLSearchParams("q=%20Dana%0A&state=hax&outcome=confirmed&follow=none&from=2026-02-30&to=2026-11-01&limit=9999&cursor=zzz"), ["acct1"]);
  assert.equal(q.q, "Dana");
  assert.equal(q.state, "all");
  assert.equal(q.outcome, "confirmed");
  assert.equal(q.follow, "none");
  assert.equal(q.from, null, "a day that does not exist is dropped");
  assert.equal(q.to, "2026-11-01");
  assert.equal(q.limit, MAX_PAGE);
  assert.equal(q.cursor, null);
  assert.deepEqual(q.accounts, ["acct1"]);
  assert.equal(isDay("2026-11-01"), true);
  assert.equal(isDay("2026-13-01"), false);
  assert.equal(isUuid(ID), true);
  assert.equal(isUuid("../etc"), false);
});

test("a keyset cursor survives a round trip and refuses anything that is not a time and a call id", () => {
  const c = { at: "2026-11-10T09:30:00.000Z", id: ID };
  assert.deepEqual(decodeCursor(encodeCursor(c)), c);
  assert.equal(decodeCursor(Buffer.from("not-a-time|" + ID).toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from("2026-11-10T09:30:00Z|1; drop table meetings").toString("base64url")), null);
  assert.equal(decodeCursor("x".repeat(500)), null);
});

test("LIKE wildcards in a search are escaped", () => {
  assert.equal(likeOf("50%_off\\"), "%50\\%\\_off\\\\%");
});

test("a call says plainly where it is", () => {
  assert.equal(callStatus({ status: "saved", reason: null, matched: true }).label, "On the contact");
  assert.equal(callStatus({ status: "needs_contact", reason: "no_match", matched: false }).label, "Waiting for you to pick the contact");
  assert.equal(callStatus({ status: "needs_contact", reason: "needs_permission", matched: true }).label, "Needs permission: reconnect");
  assert.equal(callStatus({ status: "needs_contact", reason: "preview_needed", matched: true }).key, "waiting_ok");
  assert.equal(callStatus({ status: "failed", reason: "write_failed", matched: true }).key, "refused");
  assert.equal(callStatus({ status: "dry_run", reason: "WOULD WRITE", matched: true }).key, "practice");
});

test("an outcome is only ever a suggestion until the person confirms it", () => {
  assert.equal(outcomeState(null), "none");
  assert.equal(outcomeState({ suggested: "showed", confirmedAt: null }), "to_confirm");
  assert.equal(outcomeState({ suggested: "showed", confirmedAt: "2026-11-10T00:00:00Z" }), "confirmed");
  assert.match(outcomeWords("to_confirm", "noshow"), /no-show: confirm/);
  assert.equal(nextStep(["  ", " Send the quote today ", "x"]), "Send the quote today");
  assert.equal(nextStep([]), null);
});

test("tasks: only chosen, existing, new items are planned; each is due 2 days after the call; the number per call is capped; text is trimmed", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const items = ["Send the quote", "  ", "Book the site visit   today"];
  const { plans, skipped } = planTasks(items, [1, 2, 3, 3, 9, 0], "2026-11-10T09:00:00Z", now);
  assert.deepEqual(plans.map((p) => [p.itemNo, p.title]), [[1, "Send the quote"], [3, "Book the site visit today"]]);
  assert.equal(skipped, 4, "an empty item, a repeat, a missing item and item 0 are skipped");
  assert.equal(plans[0].dueAt, "2026-11-12T09:00:00.000Z");
  // A call long past: the task is due at least an hour from now, never in the past.
  const old = planTasks(["a"], [1], "2026-01-01T00:00:00Z", now);
  assert.ok(Date.parse(old.plans[0].dueAt) >= now + 3_600_000);
  const many = planTasks(Array.from({ length: 30 }, (_, i) => `item ${i}`), Array.from({ length: 30 }, (_, i) => i + 1), null, now);
  assert.equal(many.plans.length, MAX_TASKS_PER_CALL);
  assert.deepEqual(freeItems(4, [2, 3]), [1, 4]);
});

const call = (o: Partial<CoachCall> = {}): CoachCall => ({ owner: "u1", minutes: 30, talkPct: 40, hasNextStep: true, matched: true, showed: true, won: false, ...o });

test("coaching: a rate needs enough calls behind it; averages skip what is unknown", () => {
  const few = coachRows([call(), call()]);
  assert.equal(few[0].enough, false);
  assert.equal(few[0].nextStepRate, null, "two calls are never shown as a rate");
  assert.equal(few[0].avgMinutes, 30);
  const calls = [...Array.from({ length: MIN_COACH_CALLS }, (_, i) => call({ owner: "u2", hasNextStep: i < 3, won: i < 1, minutes: i === 0 ? null : 20, talkPct: null })), call({ owner: "u1" })];
  const [r] = coachRows(calls);
  assert.equal(r.owner, "u2");
  assert.equal(r.nextStepRate, 60);
  assert.equal(r.avgMinutes, 20);
  assert.equal(r.avgTalkPct, null, "no transcript was read, so no talk time is claimed");
  assert.equal(r.showToClose, 20);
  assert.equal(r.closed, 1);
});

test("talk share counts words by the recorder and never returns text; too little talk or an unknown recorder is null", () => {
  const turns = [{ speaker: "Dana Rep", email: null, words: 60 }, { speaker: "Pat", email: "pat@x.test", words: 40 }];
  assert.equal(talkShare(turns, { name: "Dana Rep", email: null }), 60);
  assert.equal(talkShare(turns, { name: null, email: "PAT@x.test" }), 40);
  assert.equal(talkShare(turns, { name: "Someone Else", email: null }), null);
  assert.equal(talkShare([{ speaker: "Dana Rep", email: null, words: 10 }], { name: "Dana Rep", email: null }), null);
});

test("a Fathom delivery gets a talk share only when the transcript was asked for, and the share holds no words", () => {
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  const body = {
    recording_id: 4242, title: "Intro", recorded_by: { name: "Dana Rep", email: "dana@agency.test" }, calendar_invitees: [{ email: "pat@x.test", name: "Pat", is_external: true }],
    transcript: [{ speaker: { display_name: "Dana Rep", matched_calendar_invitee_email: "dana@agency.test" }, text: words(70) }, { speaker: { display_name: "Pat" }, text: words(30) }],
  };
  assert.equal(parseFathomDelivery(body)?.talkPct, null, "the transcript is not even looked at unless asked for");
  const d = parseFathomDelivery(body, { transcript: true });
  assert.equal(d?.talkPct, 70);
});

test("the weekly line is counts only and says nothing when no call was held", () => {
  assert.equal(weeklyLine({ held: 0, logged: 0, noNextStep: 0, waiting: 0 }), null);
  assert.equal(weeklyLine({ held: 1, logged: 1, noNextStep: 0, waiting: 0 }), "1 recorded call this week, 1 on a contact.");
  assert.equal(weeklyLine({ held: 8, logged: 6, noNextStep: 3, waiting: 2 }), "8 recorded calls this week, 6 on a contact, 3 with no next step, 2 waiting to be matched.");
});

test("privacy and tenancy are in the SQL itself: every call read names the installation and the owner, a task needs a certain contact, and no screen text names the vendor", () => {
  const q = readFileSync(new URL("../analytics/mn2-queries.ts", import.meta.url), "utf8");
  for (const fn of ["export async function listCalls", "export async function callDetail", "export async function followRows"]) {
    const body = q.slice(q.indexOf(fn), q.indexOf(fn) + 3000);
    assert.ok(/m\.installation_id = \$\{installationId\} and m\.owner_ghl_user_id = \$\{userId\}/.test(body), `${fn} names the installation and the owner`);
  }
  const coach = q.slice(q.indexOf("export async function coachCalls"), q.indexOf("export async function roleLabels"));
  assert.ok(!/m\.(title|summary|attendee_emails|recording_url|action_items\b(?!\)))/.test(coach.replace(/jsonb_array_length\(m\.action_items\)/g, "")), "the coaching read selects no title, summary, attendee or link");
  const routes = readFileSync(new URL("../api/mn2-routes.ts", import.meta.url), "utf8");
  assert.ok(!/GoHighLevel|HighLevel|\bGHL\b|sub-?account/i.test(routes.replace(/^import .*$/gm, "").replace(/\/\/.*$/gm, "")), "no vendor word in anything a person reads");
  assert.ok(/taskTarget\(ctx\.installationId, person\.userId, id, reach\)/.test(routes), "tasks go only to the call's own certain contact");
  assert.ok(/echo/i.test(readFileSync(new URL("../connections/write-log.ts", import.meta.url), "utf8")) && /mn_tasks/.test(readFileSync(new URL("../connections/write-log.ts", import.meta.url), "utf8")), "our own task echo is dropped");
});
