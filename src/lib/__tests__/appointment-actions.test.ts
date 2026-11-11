import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPT_BATCH_CAPS, beforeOf, bulkDeleteConfirmed, bulkDeletePhrase, deleteConfirmed, findConflicts, inversePatch, isoToZonedLocal, parseAction, parseCreate, planAction, planBulk, planCreate, suggestSlots, zonedToIso,
  type ApptFacts, type OtherBooking,
} from "../analytics/appointment-actions.ts";
import { followUpNote, matchMeeting, nextStepOf, suggestOutcome, type Candidate } from "../analytics/appointment-meetings.ts";
import { APPT_WRITE_SCOPE, updateBody, writeAppointment } from "../ghl/appointment-gateway.ts";
import { resetLimits } from "../ghl/workbench.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0); // a Tuesday
const at = (h: number) => new Date(NOW + h * H).toISOString();
const facts = (o: Partial<ApptFacts> = {}): ApptFacts => ({ appointmentId: "xtest-a1", locationId: "xtest-loc", calendarId: "xtest-cal", calendarName: "Sales", contactId: "xtest-c1", contactName: "Dana Cole", title: "Call", status: "new", startAt: at(-3), endAt: at(-2.5), assignedTo: "xtest-u1", ...o });
const other = (o: Partial<OtherBooking> = {}): OtherBooking => ({ appointmentId: "xtest-a2", startAt: at(24), endAt: at(24.5), assignedTo: "xtest-u1", calendarId: "xtest-cal", status: "new", title: null, ...o });
const ctx = (o: Partial<Parameters<typeof planAction>[2]> = {}) => ({ now: NOW, others: [] as OtherBooking[], teamIds: ["xtest-u1", "xtest-u2"], calendarIds: ["xtest-cal"], tz: "UTC", ...o });

test("parseAction keeps only known actions and drops unknown keys", () => {
  assert.equal(parseAction({ kind: "status", status: "showed" }).ok, true);
  assert.equal(parseAction({ kind: "status", status: "paid" }).ok, false);
  assert.equal(parseAction({ kind: "reassign", userId: "../etc" }).ok, false);
  assert.equal(parseAction({ kind: "edit" }).ok, false, "nothing to change");
  const r = parseAction({ kind: "reschedule", startAt: at(24), endAt: at(24.5), junk: 1 });
  assert.ok(r.ok && !("junk" in r.action));
  assert.equal(parseAction({ kind: "reschedule", startAt: "soon", endAt: at(1) }).ok, false);
  assert.equal(parseCreate({ contactId: "xtest-c1", calendarId: "xtest-cal", startAt: at(2), endAt: at(3) }).ok, true);
  assert.equal(parseCreate({ contactId: "x", calendarId: "xtest-cal", startAt: at(2), endAt: at(3) }).ok, false);
});

test("double bookings: same person overlaps, back-to-back does not, cancelled and no-show do not block", () => {
  const o = other({ startAt: at(24), endAt: at(25) });
  assert.equal(findConflicts(at(24.5), at(25.5), [o], { assignedTo: "xtest-u1", calendarId: "xtest-cal" }).length, 1);
  assert.equal(findConflicts(at(25), at(26), [o], { assignedTo: "xtest-u1", calendarId: "xtest-cal" }).length, 0, "end meets start");
  assert.equal(findConflicts(at(24.5), at(25.5), [o], { assignedTo: "xtest-u2", calendarId: "xtest-cal" }).length, 0, "another person is free");
  assert.equal(findConflicts(at(24.5), at(25.5), [{ ...o, status: "cancelled" }], { assignedTo: "xtest-u1", calendarId: "xtest-cal" }).length, 0);
  assert.equal(findConflicts(at(24.5), at(25.5), [{ ...o, status: "noshow" }], { assignedTo: "xtest-u1", calendarId: "xtest-cal" }).length, 0);
  assert.equal(findConflicts(at(24.5), at(25.5), [o], { assignedTo: "xtest-u1", calendarId: "xtest-cal", ignoreId: "xtest-a2" }).length, 0, "an appointment never conflicts with itself");
});

test("reschedule: a double booking blocks unless the person chose to book anyway (then it warns)", () => {
  const busy = [other({ startAt: at(24), endAt: at(25) })];
  const a = parseAction({ kind: "reschedule", startAt: at(24.5), endAt: at(25.5) });
  assert.ok(a.ok);
  const p = planAction(a.action, facts({ startAt: at(48), endAt: at(48.5) }), ctx({ others: busy }));
  assert.ok(p.blockers.some((b) => b.id === "double_booking"));
  const forced = parseAction({ kind: "reschedule", startAt: at(24.5), endAt: at(25.5), allowOverlap: true });
  assert.ok(forced.ok);
  const p2 = planAction(forced.action, facts({ startAt: at(48), endAt: at(48.5) }), ctx({ others: busy }));
  assert.equal(p2.blockers.length, 0);
  assert.ok(p2.warnings.some((w) => w.id === "forced"));
  assert.ok(p2.patch?.startAt);
});

test("status: showed needs the slot to have passed; completed is recorded as showed; marking the same thing again is refused", () => {
  const future = planAction({ kind: "status", status: "showed" }, facts({ startAt: at(5), endAt: at(5.5) }), ctx());
  assert.ok(future.blockers.some((b) => b.id === "future"));
  const done = planAction({ kind: "status", status: "completed" }, facts(), ctx());
  assert.equal(done.blockers.length, 0);
  assert.equal(done.patch?.status, "showed");
  assert.ok(done.warnings.some((w) => w.id === "completed"));
  assert.ok(planAction({ kind: "status", status: "noshow" }, facts({ status: "noshow" }), ctx()).blockers.some((b) => b.id === "same"));
});

test("reassign: only someone on that account's team; an empty team refuses everyone", () => {
  assert.equal(planAction({ kind: "reassign", userId: "xtest-u2" }, facts(), ctx()).blockers.length, 0);
  assert.ok(planAction({ kind: "reassign", userId: "xtest-zz" }, facts(), ctx()).blockers.some((b) => b.id === "owner"));
  assert.ok(planAction({ kind: "reassign", userId: "xtest-u2" }, facts(), ctx({ teamIds: [] })).blockers.some((b) => b.id === "owner"));
});

test("DELETE always needs the typed words: the word DELETE or the person's name, never empty", () => {
  const f = facts();
  assert.ok(planAction({ kind: "delete", typed: "" }, f, ctx()).blockers.some((b) => b.id === "confirm"));
  assert.ok(planAction({ kind: "delete", typed: "yes" }, f, ctx()).blockers.some((b) => b.id === "confirm"));
  assert.equal(planAction({ kind: "delete", typed: "delete" }, f, ctx()).blockers.length, 0);
  assert.equal(planAction({ kind: "delete", typed: " dana  cole " }, f, ctx()).blockers.length, 0);
  assert.equal(deleteConfirmed("", f), false);
  const p = planAction({ kind: "delete", typed: "DELETE" }, f, ctx());
  assert.equal(p.reversible, false);
  assert.match(p.summary, /Dana Cole/);
  assert.match(p.summary, /cannot be undone/);
  assert.equal(deleteConfirmed("Unknown contact", facts({ contactName: "Unknown contact" })), false, "an unknown name is not a confirmation");
});

test("bulk: the typed count is exact, future ones cannot be marked, the caps hold, duplicates collapse", () => {
  assert.equal(bulkDeletePhrase(3), "delete 3");
  assert.equal(bulkDeleteConfirmed("Delete 3", 3), true);
  assert.equal(bulkDeleteConfirmed("delete 2", 3), false);
  assert.equal(bulkDeleteConfirmed("", 0), false);
  const items = [facts({ appointmentId: "xtest-a1" }), facts({ appointmentId: "xtest-a1" }), facts({ appointmentId: "xtest-a3", startAt: at(9), endAt: at(9.5) }), facts({ appointmentId: "xtest-a4", status: "showed" })];
  const p = planBulk("status", items, { now: NOW, status: "showed" });
  assert.deepEqual(p.allowed.map((x) => x.appointmentId), ["xtest-a1"]);
  assert.equal(p.skipped.length, 2);
  const many = Array.from({ length: 40 }, (_, i) => facts({ appointmentId: `xtest-d${i}` }));
  const d = planBulk("delete", many, { now: NOW });
  assert.equal(d.allowed.length, APPT_BATCH_CAPS.delete);
  assert.equal(d.overCap, 15);
  assert.equal(d.phrase, `delete ${APPT_BATCH_CAPS.delete}`);
});

test("create: contact and calendar must be in the account, double booking blocks, do-not-disturb warns", () => {
  const c = parseCreate({ contactId: "xtest-c1", calendarId: "xtest-cal", startAt: at(48), endAt: at(48.5), assignedTo: "xtest-u1" });
  assert.ok(c.ok);
  const base = { now: NOW, others: [] as OtherBooking[], teamIds: ["xtest-u1"], calendarIds: ["xtest-cal"], contactName: "Dana Cole", tz: "UTC" };
  assert.equal(planCreate(c.input, base).blockers.length, 0);
  assert.ok(planCreate(c.input, { ...base, contactName: null }).blockers.some((b) => b.id === "contact"));
  assert.ok(planCreate(c.input, { ...base, calendarIds: ["xtest-other"] }).blockers.some((b) => b.id === "calendar"));
  assert.ok(planCreate(c.input, { ...base, others: [other({ startAt: at(48), endAt: at(48.5) })] }).blockers.some((b) => b.id === "double_booking"));
  assert.ok(planCreate(c.input, { ...base, contactDnd: true }).warnings.some((w) => w.id === "dnd"));
});

test("best slots: free, in working hours, weekdays only, one per day, ranked by show rate only when history is given", () => {
  const busy = [other({ startAt: at(-3 + 24 - 0), endAt: at(-3 + 24 + 1) })]; // tomorrow 09:00-10:00 UTC
  const s = suggestSlots({ from: NOW, durationMin: 30, others: busy, assignedTo: "xtest-u1", calendarId: "xtest-cal" });
  assert.equal(s.length, 3);
  for (const x of s) {
    const d = new Date(x.startAt);
    assert.ok(d.getUTCDay() >= 1 && d.getUTCDay() <= 5, "weekday");
    assert.ok(d.getUTCHours() >= 9 && d.getUTCHours() < 17, "working hours");
    assert.equal(findConflicts(x.startAt, x.endAt, busy, { assignedTo: "xtest-u1", calendarId: "xtest-cal" }).length, 0);
    assert.equal(x.reason, "Free for this person");
  }
  assert.equal(new Set(s.map((x) => x.startAt.slice(0, 10))).size, 3, "one per day");
  const ranked = suggestSlots({ from: NOW, durationMin: 30, others: [], assignedTo: "xtest-u1", calendarId: "xtest-cal", hourShowRates: { 10: 0.9, 15: 0.4 }, count: 2 });
  assert.ok(ranked.every((x) => new Date(x.startAt).getUTCHours() === 10), "the best hour first");
  assert.match(ranked[0].reason, /90%/);
  assert.equal(suggestSlots({ from: NOW, durationMin: 30, others: [], assignedTo: null, calendarId: null, hourShowRates: null })[0].reason, "Free for this person");
});

test("times typed in the account's time zone convert both ways, including daylight saving", () => {
  assert.equal(zonedToIso("2026-07-01T09:00", "America/New_York"), "2026-07-01T13:00:00.000Z");
  assert.equal(zonedToIso("2026-12-01T09:00", "America/New_York"), "2026-12-01T14:00:00.000Z");
  assert.equal(zonedToIso("2026-07-01T09:00", null), "2026-07-01T09:00:00.000Z");
  assert.equal(zonedToIso("nonsense", "UTC"), null);
  assert.equal(isoToZonedLocal("2026-07-01T13:00:00.000Z", "America/New_York"), "2026-07-01T09:00");
});

test("undo: the inverse comes from the stored before; delete and create have none", () => {
  const f = facts({ status: "noshow" });
  const patch = { status: "showed" as const };
  const before = beforeOf(f, patch);
  assert.deepEqual(before, { status: "noshow" });
  assert.deepEqual(inversePatch("status", before), { status: "noshow" });
  assert.equal(inversePatch("delete", {}), null);
  assert.equal(inversePatch("create", { startAt: "x" }), null);
  const mv = beforeOf(f, { startAt: at(48), endAt: at(49) });
  assert.deepEqual(inversePatch("reschedule", mv), { startAt: f.startAt, endAt: f.endAt });
});

// ---------------- the gateway ----------------

const rec = () => { const lines: Array<{ action: string; detail: Record<string, unknown> }> = []; return { lines, audit: async (r: { installationId: string; action: string; detail: Record<string, unknown> }) => { lines.push({ action: r.action, detail: r.detail }); }, log: () => undefined }; };
const stub = (status: number, body = "{}") => { const calls: Array<{ method: string; url: string; body: string | null }> = []; return { calls, fetchImpl: (async (u: string, init: RequestInit) => { calls.push({ method: init.method ?? "GET", url: u, body: (init.body as string | undefined) ?? null }); return new Response(body, { status }); }) as unknown as typeof fetch }; };
const common = { installationId: "xtest-inst", locationId: "xtest-loc", actor: "Dana", contactId: "xtest-c1", optedIn: true, token: async () => "tok" };

test("gateway: off or not opted in is a practice run that sends nothing", async () => {
  resetLimits();
  const r = rec(); const s = stub(200);
  const out = await writeAppointment({ ...common, op: "update", appointmentId: "xtest-a1", patch: { status: "noshow" } }, { env: {}, ...r, fetchImpl: s.fetchImpl, sleep: async () => undefined });
  assert.equal(out.outcome, "dry_run");
  assert.equal(s.calls.length, 0);
  assert.equal(r.lines[0].detail.what, "crm.appointment.update");
  resetLimits();
  const out2 = await writeAppointment({ ...common, optedIn: false, op: "delete", appointmentId: "xtest-a1" }, { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: s.fetchImpl, sleep: async () => undefined });
  assert.equal(out2.outcome === "dry_run" && out2.reason, "account");
  assert.equal(s.calls.length, 0);
});

test("gateway: live sends the right request, never notifies the lead, audits ids only and maps 403 and 404", async () => {
  resetLimits();
  const r = rec(); const s = stub(200);
  assert.equal((await writeAppointment({ ...common, op: "update", appointmentId: "xtest-a1", patch: { status: "showed", assignedUserId: "xtest-u2" } }, { env: { WRITE_GHL_LIVE: "true" }, ...r, fetchImpl: s.fetchImpl, sleep: async () => undefined })).outcome, "done");
  assert.equal(s.calls[0].method, "PUT");
  assert.match(s.calls[0].url, /\/calendars\/events\/appointments\/xtest-a1$/);
  const body = JSON.parse(s.calls[0].body ?? "{}");
  assert.equal(body.appointmentStatus, "showed");
  assert.equal(body.assignedUserId, "xtest-u2");
  assert.equal(body.toNotify, false, "SubSync never makes the CRM notify the lead");
  assert.equal(body.ignoreFreeSlotValidation, undefined, "the platform's own free-slot check stays on");
  const audit = r.lines.find((l) => l.action === "crm.write");
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit), /tok|Dana Cole/);
  resetLimits();
  const d = stub(200);
  await writeAppointment({ ...common, op: "delete", appointmentId: "xtest-a1" }, { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: d.fetchImpl, sleep: async () => undefined });
  assert.equal(d.calls[0].method, "DELETE");
  assert.match(d.calls[0].url, /\/calendars\/events\/xtest-a1$/);
  resetLimits();
  assert.equal((await writeAppointment({ ...common, op: "update", appointmentId: "xtest-a1", patch: { status: "showed" } }, { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: stub(403).fetchImpl, sleep: async () => undefined })).outcome, "needs_permission");
  resetLimits();
  assert.equal((await writeAppointment({ ...common, op: "delete", appointmentId: "xtest-a1" }, { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: stub(404).fetchImpl, sleep: async () => undefined })).outcome, "done");
  resetLimits();
  assert.equal((await writeAppointment({ ...common, op: "update", appointmentId: "xtest-a1", patch: { status: "showed" } }, { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: stub(500).fetchImpl, sleep: async () => undefined })).outcome, "failed");
  assert.equal(APPT_WRITE_SCOPE, "calendars/events.write");
  assert.equal(updateBody({ status: "noshow" }, true).ignoreFreeSlotValidation, true);
});

test("gateway: create returns the new id", async () => {
  resetLimits();
  const s = stub(201, JSON.stringify({ id: "xtest-new" }));
  const out = await writeAppointment({ ...common, op: "create", create: { calendarId: "xtest-cal", startAt: at(48), endAt: at(48.5), assignedTo: "xtest-u1", title: "Call", allowOverlap: false } }, { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: s.fetchImpl, sleep: async () => undefined });
  assert.deepEqual(out, { outcome: "done", id: "xtest-new" });
  assert.equal(s.calls[0].method, "POST");
  assert.equal(JSON.parse(s.calls[0].body ?? "{}").toNotify, false);
});

// ---------------- meetings ----------------

const cand = (o: Partial<Candidate> = {}): Candidate => ({ appointmentId: "xtest-a1", locationId: "xtest-loc", contactEmail: "dana@example.com", startAt: at(-3), endAt: at(-2.5), status: "new", ...o });

test("meeting match is certain only with exactly one fitting appointment (email and time agree)", () => {
  const m = { id: "xtest-m1", startedAt: at(-3), attendeeEmails: ["Dana@Example.com", "rep@agency.com"] };
  assert.deepEqual(matchMeeting(m, [cand()]), { kind: "certain", appointmentId: "xtest-a1", locationId: "xtest-loc" });
  assert.equal(matchMeeting(m, [cand({ contactEmail: "other@example.com" })]).kind, "none", "attendee email must agree");
  assert.equal(matchMeeting(m, [cand({ startAt: at(-30), endAt: at(-29.5) })]).kind, "none", "time window must agree");
  assert.equal(matchMeeting(m, [cand(), cand({ appointmentId: "xtest-a9" })]).kind, "several", "two fits is never guessed");
  assert.equal(matchMeeting({ ...m, startedAt: null }, [cand()]).kind, "none");
  assert.equal(matchMeeting({ ...m, attendeeEmails: [] }, [cand()]).kind, "none");
});

test("suggested outcome: showed when a call took place, a weak no-show only for a connected person and a slot long past, nothing once marked", () => {
  const a = { status: "new", startAt: at(-3), endAt: at(-2.5) };
  assert.equal(suggestOutcome(a, true, true, NOW)?.outcome, "showed");
  const ns = suggestOutcome(a, false, true, NOW);
  assert.equal(ns?.outcome, "noshow");
  assert.equal(ns?.confidence, "low");
  assert.equal(suggestOutcome(a, false, false, NOW), null, "not connected: no opinion");
  assert.equal(suggestOutcome({ ...a, status: "showed" }, true, true, NOW), null);
  assert.equal(suggestOutcome({ status: "new", startAt: at(1), endAt: at(1.5) }, true, true, NOW), null, "still ahead");
  assert.equal(suggestOutcome({ status: "new", startAt: at(-1), endAt: at(-0.5) }, false, true, NOW), null, "too soon to say no-show");
});

test("next step and the follow-up note use only what the person's own call brought, capped", () => {
  assert.equal(nextStepOf([]), null);
  assert.equal(nextStepOf(["  ", " Send the proposal "]), "Send the proposal");
  const note = followUpNote({ title: "Intro", summary: "x".repeat(5000), actionItems: ["A", "B"] });
  assert.ok(note.length <= 4000);
  assert.match(note, /Action items/);
});
