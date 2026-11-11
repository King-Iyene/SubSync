import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPORT_CAP, MIN_NAMED_LEADS, REASSIGN_CAP, UNDO_MINUTES, acksGiven, acksNeeded, awayActive, csvCell, csvRow, idleAlert, leadProtections, noteDeleteWords, notePreview, noteVisible, oneThing, overloadAlerts, parseAway, parseNote,
  parseTarget, planRebalance, planReassign, proofCsv, proofOf, proofText, suggestAssignee, targetDeleteWords, targetPreview, teamWeekLines, typedMatches, undoable, viewerOf,
  type Candidate, type LeadFacts, type WaitingLead, type ProofFacts, type Viewer,
} from "../analytics/people-actions.ts";
import { REASSIGN_SCOPE, reassignBody, writeOwner } from "../ghl/people-gateway.ts";
import { resetLimits } from "../ghl/workbench.ts";

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const DAY = 86_400_000;
const lead = (o: Partial<LeadFacts> = {}): LeadFacts => ({ contactId: "xtest-c1", name: "Dana Reed", dnd: false, owner: "xtest-u1", openDeals: 0, wonDeals: 0, upcomingAppointments: 0, ...o });
const MEMBERS = [{ id: "xtest-u1", name: "Priya" }, { id: "xtest-u2", name: "Sam" }];
const ctx = (o: { awayUntil?: number | null } = {}) => ({ members: MEMBERS, awayUntil: o.awayUntil ?? null, now: NOW });

test("who may do what: owners and admins manage, staff and a client's people see only themselves, a client admin reads only their own notes", () => {
  assert.equal(viewerOf({ kind: "agency", personRole: "agency_owner" }).role, "manager");
  assert.equal(viewerOf({ kind: "agency", personRole: "agency_admin" }).role, "manager");
  assert.equal(viewerOf({ kind: "agency", personRole: "agency_staff" }).role, "self");
  assert.equal(viewerOf({ kind: "agency", personRole: null, sessionRole: "user" }).role, "self", "an older session gets the least privileged reading");
  assert.equal(viewerOf({ kind: "agency", personRole: null, sessionRole: "admin" }).role, "manager");
  assert.equal(viewerOf({ kind: "client", userId: "xtest-u1" }).role, "self");
  const biz = viewerOf({ kind: "business", personRole: "account_admin", userId: "xtest-a1" });
  assert.equal(biz.role, "manager"); assert.equal(biz.notes, "authored");
  assert.equal(viewerOf({ kind: "business", personRole: "account_user", userId: "xtest-a2" }).role, "self", "an account user (a setter) never manages other people");
  assert.equal(viewerOf({ kind: "business", personRole: null, userId: "xtest-a3" }).role, "self", "no recorded role: least access");
});

test("coaching notes: managers read them, a person reads only what is shared with them, a client admin never reads the agency's private notes", () => {
  const agency: Viewer = { role: "manager", userId: "xtest-boss", notes: "all" };
  const clientAdmin: Viewer = { role: "manager", userId: "xtest-cadmin", notes: "authored" };
  const person: Viewer = { role: "self", userId: "xtest-u1", notes: "all" };
  const priv = { subjectUserId: "xtest-u1", shared: false, authorUserId: "xtest-boss" };
  const shared = { ...priv, shared: true };
  assert.equal(noteVisible(priv, agency), true);
  assert.equal(noteVisible(priv, clientAdmin), false, "an agency note about its own staff is not the client's to read");
  assert.equal(noteVisible({ ...priv, authorUserId: "xtest-cadmin" }, clientAdmin), true);
  assert.equal(noteVisible(priv, person), false);
  assert.equal(noteVisible(shared, person), true);
  assert.equal(noteVisible({ ...shared, subjectUserId: "xtest-u2" }, person), false, "never another person's note");
  assert.equal(noteVisible(shared, { role: "self", userId: null, notes: "all" }), false);
});

test("a note needs a title and words, is trimmed and capped, and shows exactly what changes", () => {
  assert.equal(parseNote({ title: "", body: "x" }).ok, false);
  assert.equal(parseNote({ title: "Replies", body: "   " }).ok, false);
  const r = parseNote({ title: " Replies ", body: "Slower after 5pm".repeat(400), shared: true, junk: 1 });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.note.title, "Replies"); assert.equal(r.note.body.length, 2000); assert.equal(r.note.shared, true); assert.ok(!("junk" in r.note)); }
  const before = { title: "Replies", body: "A", shared: false };
  assert.deepEqual(notePreview(before, { title: "Replies", body: "B", shared: false }).map((c) => c.label), ["Note"]);
  assert.deepEqual(notePreview(before, { ...before, shared: true }).map((c) => c.label), ["Shared with them"]);
  assert.equal(notePreview(before, before).length, 0);
});

test("removing a note needs its title or DELETE typed, ignoring case and spacing, and nothing else", () => {
  const w = noteDeleteWords("Reply speed");
  assert.deepEqual(w, ["DELETE", "Reply speed"]);
  assert.equal(typedMatches("delete", w), true);
  assert.equal(typedMatches("  reply   SPEED ", w), true);
  assert.equal(typedMatches("", w), false);
  assert.equal(typedMatches("yes", w), false);
  assert.equal(typedMatches(undefined, w), false);
  assert.deepEqual(targetDeleteWords("reply_minutes", "Priya"), ["DELETE", "Priya First reply within"]);
});

test("targets: known metric, sane range, an account must be well formed, null clears, nothing else is kept", () => {
  assert.equal(parseTarget({ userId: "xtest-u1", metric: "reply_minutes", value: 10 }).ok, true);
  assert.equal(parseTarget({ userId: "xtest-u1", metric: "reply_minutes", value: 0 }).ok, false);
  assert.equal(parseTarget({ userId: "xtest-u1", metric: "in_time_share", value: 101 }).ok, false);
  assert.equal(parseTarget({ userId: "xtest-u1", metric: "made_up", value: 5 }).ok, false);
  assert.equal(parseTarget({ userId: "../x", metric: "reply_minutes", value: 5 }).ok, false);
  assert.equal(parseTarget({ userId: "xtest-u1", metric: "reply_minutes", value: 5, locationId: "../x" }).ok, false);
  const clear = parseTarget({ userId: "xtest-u1", metric: "show_share", value: null });
  assert.ok(clear.ok && clear.target.value === null && clear.target.locationId === null);
  assert.deepEqual(targetPreview("reply_minutes", 15, 10), [{ label: "First reply within", from: "15 minutes", to: "10 minutes" }]);
  assert.equal(targetPreview("won_value_month", null, 12000)[0].to, "$12,000");
});

test("away: needs a future end inside 90 days; a snooze is one of the listed lengths; marks stop counting after they end or are released", () => {
  assert.equal(parseAway({ userId: "xtest-u1", until: new Date(NOW + 5 * DAY).toISOString() }, NOW).ok, true);
  assert.equal(parseAway({ userId: "xtest-u1", until: new Date(NOW - DAY).toISOString() }, NOW).ok, false);
  assert.equal(parseAway({ userId: "xtest-u1", until: new Date(NOW + 200 * DAY).toISOString() }, NOW).ok, false);
  assert.equal(parseAway({ userId: "xtest-u1", kind: "idle_snooze", hours: 5 }, NOW).ok, false);
  const s = parseAway({ userId: "xtest-u1", kind: "idle_snooze", hours: 24 }, NOW);
  assert.ok(s.ok && s.away.until === NOW + DAY);
  assert.equal(awayActive({ until: NOW + 1000 }, NOW), true);
  assert.equal(awayActive({ until: NOW - 1000 }, NOW), false);
  assert.equal(awayActive({ until: NOW + 1000, releasedAt: NOW - 5 }, NOW), false);
});

test("CSV cells cannot run as formulas, quote what needs quoting, and keep real numbers as numbers", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+1 555"), "'+1 555");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tcmd"), "'\tcmd");
  assert.equal(csvCell("Priya, the closer"), `"Priya, the closer"`);
  assert.equal(csvCell("line\nbreak"), "line break");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(Number.NaN), "");
  assert.equal(csvRow(["a", 1, null]), "a,1,");
});

test("reassign: the person must be on the account's team, leads already theirs are counted, a batch is capped", () => {
  assert.equal(planReassign([lead()], "xtest-u9", ctx()).blockers[0]?.id, "owner");
  const same = planReassign([lead({ owner: "xtest-u2" })], "xtest-u2", ctx());
  assert.equal(same.same, 1); assert.equal(same.change.length, 0);
  const many = Array.from({ length: REASSIGN_CAP + 10 }, (_, i) => lead({ contactId: `xtest-c${i}`, name: `Lead ${i}` }));
  const p = planReassign(many, "xtest-u2", ctx());
  assert.equal(p.change.length, REASSIGN_CAP); assert.equal(p.overCap, 10); assert.equal(p.reversible, true);
  assert.equal(planReassign([lead(), lead()], "xtest-u2", ctx()).change.length, 1, "the same lead twice is one lead");
});

test("reassign protections: in a batch a lead with do-not-disturb, an open deal, a won deal or an appointment is left out and named; one at a time it needs a tick", () => {
  const batch = planReassign([lead({ contactId: "xtest-c1" }), lead({ contactId: "xtest-c2", name: "Dnd Person", dnd: true }), lead({ contactId: "xtest-c3", name: "Deal Person", openDeals: 1 }), lead({ contactId: "xtest-c4", name: "Cust", wonDeals: 1 }), lead({ contactId: "xtest-c5", name: "Appt", upcomingAppointments: 1 })], "xtest-u2", ctx());
  assert.deepEqual(batch.change.map((i) => i.contactId), ["xtest-c1"]);
  assert.deepEqual(batch.protectedItems.map((i) => i.contactId).sort(), ["xtest-c2", "xtest-c3", "xtest-c4", "xtest-c5"]);
  assert.match(batch.protectedItems[0].protectedBy[0].text, /Dnd Person/);
  const one = planReassign([lead({ dnd: true })], "xtest-u2", ctx());
  assert.equal(one.change.length, 1);
  assert.deepEqual(acksNeeded(one), ["ack_dnd"]);
  assert.equal(acksGiven(one, []), false);
  assert.equal(acksGiven(one, ["ack_dnd"]), true);
  assert.equal(acksGiven(planReassign([lead()], "xtest-u2", ctx()), undefined), true, "nothing to tick for an ordinary lead");
  assert.deepEqual(leadProtections(lead()), []);
});

test("reassign: someone away is warned about, a lead with no owner cannot be put back", () => {
  const away = planReassign([lead()], "xtest-u2", ctx({ awayUntil: NOW + DAY }));
  assert.ok(away.warnings.some((w) => w.id === "away" && /Sam/.test(w.text)));
  const noOwner = planReassign([lead({ owner: null })], "xtest-u2", ctx());
  assert.equal(noOwner.reversible, false); assert.equal(noOwner.irreversible, 1);
  assert.ok(noOwner.warnings.some((w) => w.id === "noundo"));
});

test("undo: only done moves with an earlier owner inside the window", () => {
  const rows = [
    { contactId: "a", before: "u1", after: "u2", result: "done", at: NOW - 60_000 },
    { contactId: "b", before: null, after: "u2", result: "done", at: NOW - 60_000 },
    { contactId: "c", before: "u1", after: "u2", result: "dry_run", at: NOW - 60_000 },
    { contactId: "d", before: "u1", after: "u2", result: "done", at: NOW - (UNDO_MINUTES + 1) * 60_000 },
  ];
  assert.deepEqual(undoable(rows, NOW).map((r) => r.contactId), ["a"]);
});

const cand = (o: Partial<Candidate>): Candidate => ({ userId: "u", name: "N", waiting: 0, leads: 40, days: 28, medianReplyMinutes: 8, away: false, ...o });

test("next-lead suggestion: fewest waiting wins, then the fastest reply; it says it is an estimate and gives the sample", () => {
  const r = suggestAssignee([cand({ userId: "a", name: "Priya", waiting: 2, medianReplyMinutes: 4 }), cand({ userId: "b", name: "Sam", waiting: 9, medianReplyMinutes: 12 }), cand({ userId: "c", name: "Lee", waiting: 6, medianReplyMinutes: 9 })]);
  assert.ok(r.suggestion);
  assert.equal(r.suggestion?.name, "Priya"); assert.equal(r.suggestion?.estimate, true);
  assert.match(r.suggestion?.label ?? "", /Estimate/);
  assert.deepEqual(r.suggestion?.sample, { leads: 40, days: 28 });
  assert.ok((r.suggestion?.reasons ?? []).some((x) => /fewest leads waiting/.test(x)));
  assert.equal(r.suggestion?.others.length, 2);
  const tie = suggestAssignee([cand({ userId: "a", name: "Slow", waiting: 3, medianReplyMinutes: 30 }), cand({ userId: "b", name: "Quick", waiting: 3, medianReplyMinutes: 3 })]);
  assert.equal(tie.suggestion?.name, "Quick");
  const src = suggestAssignee([cand({ userId: "a", name: "A", waiting: 3, medianReplyMinutes: 3, sourceLeads: 6, sourceMedianMinutes: 20 }), cand({ userId: "b", name: "B", waiting: 3, medianReplyMinutes: 9, sourceLeads: 9, sourceMedianMinutes: 2 })]);
  assert.equal(src.suggestion?.name, "B", "a person who answers THIS kind of lead faster is preferred");
});

test("next-lead suggestion is hidden under the minimum data and skips people who are away", () => {
  const thin = suggestAssignee([cand({ leads: 19 }), cand({ userId: "b", days: 13 })]);
  assert.equal(thin.suggestion, null); assert.equal(thin.hidden, "not_enough_data"); assert.equal(thin.underMinimum, 2);
  const allAway = suggestAssignee([cand({ away: true })]);
  assert.equal(allAway.hidden, "nobody_available"); assert.equal(allAway.away, 1);
  const skip = suggestAssignee([cand({ userId: "a", name: "Away", waiting: 0, away: true }), cand({ userId: "b", name: "Here", waiting: 5 })]);
  assert.equal(skip.suggestion?.name, "Here");
  assert.equal(suggestAssignee([]).hidden, "nobody_available");
});

test("one thing to work on: the metric that fell most against the person's own previous period; hidden on small samples; says so when nothing fell", () => {
  const before = { leads: 40, answered: 36, inTime: 30, medianReplyMinutes: 6 };
  const worse = oneThing({ leads: 40, answered: 36, inTime: 20, medianReplyMinutes: 7 }, before);
  assert.equal(worse?.metric, "in_time"); assert.equal(worse?.basis, "worse_than_last_month");
  assert.equal(oneThing({ leads: 40, answered: 36, inTime: 31, medianReplyMinutes: 9 }, before)?.metric, "reply_speed");
  const fine = oneThing({ leads: 40, answered: 38, inTime: 32, medianReplyMinutes: 5 }, before);
  assert.equal(fine?.basis, "lowest_number");
  assert.equal(oneThing({ leads: 19, answered: 19, inTime: 19, medianReplyMinutes: 1 }, before), null);
  assert.equal(oneThing(before, { ...before, leads: 5 }), null);
});

const facts = (o: Partial<ProofFacts> = {}): ProofFacts => ({
  accountName: "Acme Roofing", from: NOW - 7 * DAY, to: NOW, targetMinutes: 15,
  team: { leads: 40, answered: 36, inTime: 30, medianReplyMinutes: 6 }, appointments: { held: 10, showed: 7, noShow: 2, unmarked: 1 },
  staff: [{ userId: "a", name: "Priya", leads: 25, answered: 24, inTime: 20, medianReplyMinutes: 5 }, { userId: "b", name: "Sam", leads: 12, answered: 10, inTime: 8, medianReplyMinutes: 9 }, { userId: "c", name: "Tiny", leads: 3, answered: 2, inTime: 1, medianReplyMinutes: 40 }],
  nameStaff: false, ...o,
});

test("client receipt: team level by default (no names), counts and percentages from the facts, and every line is plain", () => {
  const p = proofOf(facts());
  assert.equal(p.named, false); assert.equal(p.table.length, 0);
  assert.match(p.lines[0], /40 new leads came in\. 36 got a first reply from a person, and 30 of them \(75%\) within 15 minutes/);
  assert.match(p.lines.join(" "), /4 leads had no reply from a person yet/);
  assert.match(p.lines.join(" "), /10 appointments were due: 7 showed up, 2 did not, 1 not marked yet \(78% showed\)/);
  const text = proofText(p, "Brand Co");
  assert.ok(!text.includes("Priya") && !text.includes("Sam"));
  assert.match(text, /^Brand Co: Lead handling for Acme Roofing/);
  assert.match(text, /never the words/);
});

test("client receipt: staff are named only when the account chose it, and anyone under 5 leads is grouped as Others", () => {
  const p = proofOf(facts({ nameStaff: true }));
  assert.deepEqual(p.table.map((r) => r.who), ["Priya", "Sam", "Others"]);
  assert.equal(p.table[2].leads, 3); assert.equal(p.table[2].inTimePct, null);
  assert.ok(!proofText(p, null).includes("Tiny"));
  assert.ok(MIN_NAMED_LEADS === 5);
});

test("client receipt: a small sample shows counts without a percentage, and no leads says so", () => {
  const small = proofOf(facts({ team: { leads: 4, answered: 4, inTime: 4, medianReplyMinutes: 3 }, appointments: { held: 3, showed: 2, noShow: 1, unmarked: 0 } }));
  assert.doesNotMatch(small.lines[0], /%/); assert.equal(small.appointments.showedPct, null);
  const none = proofOf(facts({ team: { leads: 0, answered: 0, inTime: 0, medianReplyMinutes: null }, appointments: { held: 0, showed: 0, noShow: 0, unmarked: 0 } }));
  assert.match(none.lines[0], /No new leads arrived in these 7 days/);
});

test("client receipt CSV: formula-safe even when a person's name is hostile, with a header and capped rows", () => {
  const p = proofOf(facts({ nameStaff: true, staff: [{ userId: "a", name: "=cmd|' /C calc'!A0", leads: 25, answered: 24, inTime: 20, medianReplyMinutes: 5 }] }));
  const csv = proofCsv(p, "+Brand");
  assert.ok(csv.includes("'=cmd"), "the hostile name is prefixed");
  assert.ok(csv.includes("'+Brand"));
  assert.ok(!/(^|\r\n|,)=cmd/.test(csv));
  assert.match(csv, /^Receipt,/);
  assert.ok(csv.split("\r\n").length < EXPORT_CAP);
  const many = proofOf(facts({ nameStaff: true, staff: Array.from({ length: 700 }, (_, i) => ({ userId: `u${i}`, name: `P${i}`, leads: 9, answered: 9, inTime: 9, medianReplyMinutes: 5 })) }));
  assert.ok(proofCsv(many, null).split("\r\n").length <= EXPORT_CAP + 8, "never more than the export cap of person rows");
});

test("weekly team lines: two or more people with enough leads, plain, no ranking words, at most three", () => {
  const lines = teamWeekLines([{ name: "Priya", leads: 31, inTime: 29 }, { name: "Sam", leads: 18, inTime: 11 }, { name: "Lee", leads: 4, inTime: 0 }], 3);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Priya answered 94% of new leads in time \(31 leads\) and Sam 61% \(18 leads\)/);
  assert.match(lines[1], /3 new leads had no first reply from a person/);
  assert.ok(!lines.join(" ").match(/worst|best|bottom|top/i));
  assert.deepEqual(teamWeekLines([{ name: "Solo", leads: 30, inTime: 20 }], 0), [], "one person alone is never compared");
});

const quiet = (o: Record<string, unknown> = {}) => ({
  userId: "xtest-u1", name: "Priya", locationId: "xtest-loc", accountName: "Acme Roofing", waiting: 5, lastTouchAt: NOW - 6 * 3_600_000, activeRecently: true, away: false, snoozed: false,
  clock: { businessHours: false, openHour: 9, closeHour: 17, zone: "UTC" }, ...o,
});

test("quiet person alert: waiting leads, a person who works here, no activity for hours; never says not working; skips away, snoozed, new and busy people", () => {
  const a = idleAlert(quiet(), NOW);
  assert.equal(a?.kind, "people_idle");
  assert.match(a?.title ?? "", /Priya has 5 leads waiting and no activity recorded in your CRM for 6 hours/);
  assert.ok(!/not working|idle|lazy/i.test(a?.title ?? ""));
  assert.equal(idleAlert(quiet({ away: true }), NOW), null);
  assert.equal(idleAlert(quiet({ snoozed: true }), NOW), null);
  assert.equal(idleAlert(quiet({ activeRecently: false }), NOW), null, "someone who never works in this account is not flagged");
  assert.equal(idleAlert(quiet({ waiting: 2 }), NOW), null);
  assert.equal(idleAlert(quiet({ lastTouchAt: NOW - 3_600_000 }), NOW), null);
  assert.ok(idleAlert(quiet({ lastTouchAt: NOW - 3_600_000 }), NOW, 1));
});

test("quiet person alert counts working hours only when the account does", () => {
  // Friday 16:00 UTC last touch, now Monday 10:00 UTC: far over 4 wall hours, but only 1 + 1 working hours.
  const fri = Date.UTC(2026, 10, 6, 16, 0, 0), mon = Date.UTC(2026, 10, 9, 10, 0, 0);
  assert.equal(idleAlert(quiet({ lastTouchAt: fri, clock: { businessHours: true, openHour: 9, closeHour: 17, zone: "UTC" } }), mon), null);
  assert.ok(idleAlert(quiet({ lastTouchAt: fri, clock: { businessHours: false, openHour: 9, closeHour: 17, zone: "UTC" } }), mon));
});

test("overload alert: 10 or more waiting and twice the team's usual, with three people to know the usual, and not for someone away", () => {
  const team = [{ userId: "a", name: "Priya", waiting: 24, away: false }, { userId: "b", name: "Sam", waiting: 5, away: false }, { userId: "c", name: "Lee", waiting: 6, away: false }];
  const out = overloadAlerts("Acme Roofing", "xtest-loc", team);
  assert.equal(out.length, 1); assert.equal(out[0].kind, "people_overload"); assert.match(out[0].title, /Priya has 24 leads waiting/);
  assert.equal(overloadAlerts("A", "l", team.slice(0, 2)).length, 0, "two people cannot define a usual");
  assert.equal(overloadAlerts("A", "l", [{ ...team[0], away: true }, team[1], team[2]]).length, 0);
  assert.equal(overloadAlerts("A", "l", [{ ...team[0], waiting: 9 }, team[1], team[2]]).length, 0, "under the minimum");
});

test("gateway: the body holds only the owner; dry run when the switch is off or the account has not opted in; nothing is sent", async () => {
  assert.deepEqual(reassignBody("xtest-u2"), { assignedTo: "xtest-u2" });
  assert.equal(REASSIGN_SCOPE, "contacts.write");
  resetLimits();
  let calls = 0; const fetchImpl = (async () => { calls++; return new Response("{}", { status: 200 }); }) as typeof fetch;
  const base = { installationId: "xtest-inst", locationId: "xtest-loc", actor: "xtest-u1", contactId: "xtest-c1", toUserId: "xtest-u2", token: async () => "xtest-token" };
  const audit = async () => {};
  const a = await writeOwner({ ...base, optedIn: true }, { env: {}, fetchImpl, sleep: async () => {}, audit });
  assert.equal(a.outcome, "dry_run"); assert.equal(a.outcome === "dry_run" && a.reason, "switch");
  const b = await writeOwner({ ...base, optedIn: false }, { env: { WRITE_GHL_LIVE: "true" }, fetchImpl, sleep: async () => {}, audit });
  assert.equal(b.outcome, "dry_run"); assert.equal(b.outcome === "dry_run" && b.reason, "account");
  assert.equal(calls, 0);
});

test("gateway live: one PUT on the contact with only the owner, 403 is needs_permission, 500 is failed", async () => {
  resetLimits();
  const seen: Array<{ url: string; method: string; body: string | null }> = [];
  const mk = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null }); return new Response("{}", { status }); }) as typeof fetch;
  const env = { WRITE_GHL_LIVE: "true" }; const audit = async () => {};
  const base = { installationId: "xtest-inst", locationId: "xtest-loc", actor: "xtest-u1", contactId: "xtest-c1", toUserId: "xtest-u2", token: async () => "xtest-token", optedIn: true };
  assert.equal((await writeOwner(base, { env, fetchImpl: mk(200), sleep: async () => {}, audit })).outcome, "done");
  assert.equal(seen[0].method, "PUT"); assert.ok(seen[0].url.endsWith("/contacts/xtest-c1")); assert.equal(seen[0].body, JSON.stringify({ assignedTo: "xtest-u2" }));
  assert.equal((await writeOwner(base, { env, fetchImpl: mk(403), sleep: async () => {}, audit })).outcome, "needs_permission");
  assert.equal((await writeOwner(base, { env, fetchImpl: mk(500), sleep: async () => {}, audit })).outcome, "failed");
});

const wl = (n: number, o: Partial<WaitingLead> = {}): WaitingLead[] => Array.from({ length: n }, (_, i) => ({ contactId: `xtest-w${i}`, name: `Lead ${i}`, waitedMinutes: 600 - i, protectedBy: [], ...o }));

test("rebalance: the longest-waiting leads go to whoever has the fewest waiting, until the person is within one of them; an estimate with groups", () => {
  const src = cand({ userId: "a", name: "Priya", waiting: 12 });
  const others = [cand({ userId: "b", name: "Sam", waiting: 2 }), cand({ userId: "c", name: "Lee", waiting: 4 })];
  const p = planRebalance(src, wl(12), others);
  assert.equal(p.estimate, true); assert.equal(p.hidden, null);
  assert.ok(p.moved >= 6 && p.moved <= 8);
  assert.equal(p.from.waitingAfter, 12 - p.moved);
  assert.equal(p.groups.reduce((n, g) => n + g.contactIds.length, 0), p.moved);
  assert.ok(p.groups.every((g) => g.waitingAfter <= p.from.waitingAfter + 1), "nobody is pushed above the person");
  assert.equal(p.groups.find((g) => g.userId === "b")?.contactIds[0], "xtest-w0", "the longest-waiting lead is moved first");
  assert.equal(new Set(p.groups.flatMap((g) => g.contactIds)).size, p.moved, "no lead is given twice");
});

test("rebalance: protected leads never move, the cap holds, balanced teams say so, away and thin-history people receive nothing", () => {
  const src = cand({ userId: "a", name: "Priya", waiting: 40 });
  const others = [cand({ userId: "b", name: "Sam", waiting: 0 })];
  const prot = planRebalance(src, wl(10, { protectedBy: [{ id: "dnd", text: "x" }] }), others);
  assert.equal(prot.hidden, "balanced"); assert.equal(prot.protectedLeft, 10);
  const capped = planRebalance(cand({ userId: "a", name: "Priya", waiting: 100 }), wl(60), others);
  assert.equal(capped.moved, REASSIGN_CAP);
  assert.equal(planRebalance(cand({ userId: "a", waiting: 3 }), wl(3), [cand({ userId: "b", waiting: 3 })]).hidden, "balanced");
  assert.equal(planRebalance(src, wl(5), [cand({ userId: "b", away: true })]).hidden, "nobody_available");
  assert.equal(planRebalance(src, wl(5), [cand({ userId: "b", leads: 3 })]).hidden, "not_enough_data");
  assert.equal(planRebalance(src, wl(5), [cand({ userId: "a" })]).hidden, "nobody_available", "the person is never their own receiver");
});
