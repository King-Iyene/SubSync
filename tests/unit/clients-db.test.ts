import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import {
  accountFacts, addCustomStep, addNote, listPeople, changeStep, deleteNote, deleteTemplate, listHistory, listNotes, listTemplates, lastProgress, loadStates, noteSummaries, quarterFacts,
  removeCustomStep, saveTemplate, weeklyAppointments, locationVisible, MAX_NOTES_PER_CLIENT,
} from "@/lib/analytics/client-success-queries";
import { dealFigures } from "@/lib/analytics/client-success";

// Stage C1, on the real database (WRITTEN, NOT RUN in the stage: the lead runs it after the merge). Two fixture companies with no tokens (the scheduler
// ignores an install with none), both removed afterwards. Proves: a client account that is not the company's own, or not allowed, is treated as not found for
// every read and write; notes, templates, step state and history never cross companies; the done flag of the older checklist stays in step; the log keeps
// who and when; templates have a unique name and a limit; the weekly appointment list is the same rows as its count.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-c1-a";
const CO_B = "xtest-c1-b";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let a = "";
let b = "";
const LA1 = "xtC1LocA1";
const LA2 = "xtC1LocA2";
const LB = "xtC1LocB";

describe.skipIf(!HAS_DB)("clients: notes, onboarding steps, templates, trends", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const [x] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzC1A', 'pro') returning id`;
    const [y] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzC1B', 'pro') returning id`;
    a = x.id as string;
    b = y.id as string;
    await sql()`insert into locations (installation_id, location_id, name, website, timezone, address, installed_at) values
      (${a}, ${LA1}, 'C1 A one', 'https://a.example.com', 'America/New_York', '1 Main St', now() - interval '30 days'), (${a}, ${LA2}, 'C1 A two', null, null, null, now()), (${b}, ${LB}, 'C1 B', null, null, null, now())`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name) values (${a}, ${LA1}, 'k1', 'Ada', 'One'), (${a}, ${LA1}, 'k2', 'Bo', 'Two')`;
    const now = Date.now();
    const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000);
    await sql()`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, status, start_at) values
      (${a}, ${LA1}, 'ap1', 'k1', 'showed', ${at(2)}), (${a}, ${LA1}, 'ap2', 'k2', 'noshow', ${at(3)}), (${a}, ${LA1}, 'ap3', 'k1', 'cancelled', ${at(4)}), (${a}, ${LA1}, 'ap4', 'k2', 'showed', ${at(12)})`;
  });
  afterAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  it("a client account of another company, or outside the allowed list, is not found for reads and writes", async () => {
    expect(await locationVisible(a, null, LA1)).toBe(true);
    expect(await locationVisible(a, null, LB), "another company's account").toBe(false);
    expect(await locationVisible(a, [LA2], LA1), "outside the allowed list").toBe(false);
    expect(await addNote(a, null, LB, "Sam", { kind: "note", body: "x", occurredOn: null })).toBe("not_found");
    expect(await addNote(a, [LA2], LA1, "Sam", { kind: "note", body: "x", occurredOn: null })).toBe("not_found");
    expect(await listNotes(a, null, LB)).toEqual([]);
    expect(await changeStep(a, null, LB, "manual:kickoff", "Kickoff", { done: true }, "Sam")).toBe(false);
    expect(await addCustomStep(a, null, LB, "hacked", "Sam")).toMatchObject({ ok: false, status: 404 });
    expect(await removeCustomStep(a, null, LB, "step:abcd1234", "Sam")).toBe(false);
    expect(await listHistory(a, null, LB)).toEqual([]);
    expect(await weeklyAppointments(a, LB, Date.now())).toSatisfy((w: Array<{ count: number }>) => w.every((x) => x.count === 0));
    const [c] = await sql()`select (select count(*)::int from client_notes where installation_id = ${b}) notes, (select count(*)::int from client_steps where installation_id = ${b}) steps`;
    expect(c).toEqual({ notes: 0, steps: 0 });
  });

  it("the log keeps who wrote what and when, newest first, and notes are removed only inside their own company and client", async () => {
    expect(await addNote(a, null, LA1, "Dana Brooks", { kind: "conversation", body: "Agreed the review for Friday", occurredOn: "2026-10-20" })).toBe("ok");
    expect(await addNote(a, null, LA1, "Marcus Lee", { kind: "decision", body: "Switch to text-back", occurredOn: "2026-10-28" })).toBe("ok");
    const notes = await listNotes(a, null, LA1);
    expect(notes.map((n) => [n.kind, n.author, n.occurredOn])).toEqual([["decision", "Marcus Lee", "2026-10-28"], ["conversation", "Dana Brooks", "2026-10-20"]]);
    const summary = (await noteSummaries(a, null)).get(LA1);
    expect(summary?.count).toBe(2);
    expect(summary?.lastConversationOn).toBe("2026-10-20");
    expect(summary?.lastNote?.body).toBe("Switch to text-back");
    expect(await deleteNote(b, null, LB, notes[0].id), "another company cannot remove it").toBe(false);
    expect(await deleteNote(a, null, LA2, notes[0].id), "the wrong client cannot remove it").toBe(false);
    expect(await deleteNote(a, null, LA1, notes[0].id)).toBe(true);
    expect((await listNotes(a, null, LA1)).length).toBe(1);
  });

  it("a client's log has a limit", async () => {
    await sql()`insert into client_notes (installation_id, location_id, kind, body) select ${a}, ${LA2}, 'note', 'filler ' || g from generate_series(1, ${MAX_NOTES_PER_CLIENT}) g`;
    expect(await addNote(a, null, LA2, "Sam", { kind: "note", body: "one too many", occurredOn: null })).toBe("full");
    await sql()`delete from client_notes where installation_id = ${a} and location_id = ${LA2}`;
  });

  it("a step keeps its assignee, due date and who finished it, writes one history line per change, and keeps the older checklist's done flag in step", async () => {
    expect(await changeStep(a, null, LA1, "manual:kickoff", "Kickoff call completed", { assignee: "Dana", dueOn: "2026-10-30" }, "Sam")).toBe(true);
    expect(await changeStep(a, null, LA1, "manual:kickoff", "Kickoff call completed", { done: true }, "Dana")).toBe(true);
    expect(await changeStep(a, null, LA1, "manual:kickoff", "Kickoff call completed", { done: true }, "Dana"), "the same change again writes nothing new").toBe(true);
    const state = (await loadStates(a, null)).get(LA1)?.find((s) => s.stepKey === "manual:kickoff");
    expect(state).toMatchObject({ assignee: "Dana", dueOn: "2026-10-30", doneBy: "Dana" });
    expect(state?.doneAt).toBeTruthy();
    const [flag] = await sql()`select done from onboarding_tasks where installation_id = ${a} and location_id = ${LA1} and task = 'manual:kickoff'`;
    expect(flag.done).toBe(true);
    const history = await listHistory(a, null, LA1);
    expect(history.map((h) => h.event).sort()).toEqual(["assigned", "done", "due"]);
    expect(history.find((h) => h.event === "assigned")).toMatchObject({ detail: "Dana", actor: "Sam", stepLabel: "Kickoff call completed" });
    expect((await lastProgress(a, null)).get(LA1)).toBeGreaterThan(0);
    expect(await listPeople(a), "names to pick from include anyone already given a step").toContain("Dana");
    expect(await listPeople(b), "and never another company's").not.toContain("Dana");
    // Reopening clears the flag everywhere and says so.
    await changeStep(a, null, LA1, "manual:kickoff", "Kickoff call completed", { done: false }, "Sam");
    const [again] = await sql()`select done from onboarding_tasks where installation_id = ${a} and location_id = ${LA1} and task = 'manual:kickoff'`;
    expect(again.done).toBe(false);
    expect((await listHistory(a, null, LA1)).some((h) => h.event === "reopened")).toBe(true);
    expect((await loadStates(a, null)).get(LA1)?.find((s) => s.stepKey === "manual:kickoff")?.doneAt).toBeNull();
  });

  it("a step added to one client is that client's alone, can be removed, and leaves history; the number of them is limited", async () => {
    const made = await addCustomStep(a, null, LA1, "Order the welcome gift", "Sam");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.key).toMatch(/^step:[0-9a-f]{8}$/);
    expect((await loadStates(a, null)).get(LA1)?.some((s) => s.stepKey === made.key && s.isCustom && s.label === "Order the welcome gift")).toBe(true);
    expect((await loadStates(a, null)).get(LA2)?.some((s) => s.stepKey === made.key) ?? false).toBe(false);
    expect(await removeCustomStep(a, null, LA2, made.key, "Sam"), "another client cannot remove it").toBe(false);
    expect(await removeCustomStep(a, null, LA1, made.key, "Sam")).toBe(true);
    expect((await listHistory(a, null, LA1)).filter((h) => h.stepKey === made.key).map((h) => h.event).sort()).toEqual(["added", "removed"]);
    expect(await addCustomStep(a, null, LA1, "   ", "Sam")).toMatchObject({ ok: false, status: 400 });
    expect(await addCustomStep(a, null, LA1, "x".repeat(121), "Sam")).toMatchObject({ ok: false, status: 400 });
  });

  it("templates are per company, have a unique name, hold cleaned steps and are limited in number", async () => {
    const r = await saveTemplate(a, { name: "Clinic onboarding", industryKey: "medical", steps: [{ label: "Collect logo", howto: "Ask for it" }, { label: "Kickoff" }] });
    expect(r.ok).toBe(true);
    expect(await saveTemplate(a, { name: "Clinic onboarding", industryKey: null, steps: [] })).toMatchObject({ ok: false, status: 409 });
    expect(await saveTemplate(b, { name: "Clinic onboarding", industryKey: null, steps: [] }), "another company may use the same name").toMatchObject({ ok: true });
    expect(await saveTemplate(a, { name: "Bad kind", industryKey: "made_up", steps: [] })).toMatchObject({ ok: false, status: 400 });
    expect(await saveTemplate(a, { name: "Dup steps", industryKey: null, steps: [{ label: "A" }, { label: " a " }] })).toMatchObject({ ok: false, status: 400 });
    const mine = await listTemplates(a);
    expect(mine.map((t) => t.name)).toEqual(["Clinic onboarding"]);
    expect(mine[0].steps.map((s) => s.label)).toEqual(["Collect logo", "Kickoff"]);
    expect(mine[0].steps.every((s) => /^[a-z0-9]{4,12}$/.test(s.key))).toBe(true);
    if (r.ok) {
      expect(await saveTemplate(a, { id: r.id, name: "Clinic onboarding v2", industryKey: "medical", steps: mine[0].steps }), "an edit keeps the step keys").toMatchObject({ ok: true });
      expect((await listTemplates(a))[0].steps.map((s) => s.key)).toEqual(mine[0].steps.map((s) => s.key));
      expect(await deleteTemplate(b, r.id), "another company cannot delete it").toBe(false);
      expect(await deleteTemplate(a, r.id)).toBe(true);
    }
    for (let i = 0; i < 20; i++) expect((await saveTemplate(a, { name: `T${i}`, industryKey: null, steps: [] })).ok).toBe(true);
    expect(await saveTemplate(a, { name: "T20", industryKey: null, steps: [] })).toMatchObject({ ok: false, status: 400 });
    expect((await listTemplates(b)).map((t) => t.name)).toEqual(["Clinic onboarding"]);
  });

  it("the facts the automatic checks use come from the client's own row", async () => {
    const f = await accountFacts(a, null);
    expect(f.get(LA1)).toMatchObject({ website: "https://a.example.com", timezone: "America/New_York", address: "1 Main St", appointments: 4 });
    expect(f.get(LA2)).toMatchObject({ website: null, timezone: null, appointments: 0 });
    expect(f.has(LB)).toBe(false);
    expect((await accountFacts(a, [LA2])).has(LA1), "the allowed list narrows it").toBe(false);
  });

  it("the appointments behind each week's bar are exactly the appointments the bar counts, cancelled ones left out, and only this company's", async () => {
    const weeks = await weeklyAppointments(a, LA1, Date.now(), 14);
    expect(weeks).toHaveLength(14);
    expect(weeks.reduce((s, w) => s + w.count, 0)).toBe(3);
    for (const w of weeks) expect(w.members.length, "under the cap, the list is the count").toBe(w.count);
    expect(weeks.reduce((s, w) => s + w.showed, 0)).toBe(2);
    expect(weeks.reduce((s, w) => s + w.noShow, 0)).toBe(1);
    expect(weeks.flatMap((w) => w.members).map((m) => m.name).sort()).toEqual(["Ada One", "Bo Two", "Bo Two"]); // ap1 Ada (showed), ap2 Bo (no-show), ap4 Bo (showed); ap3 is Ada's and cancelled, so it is left out
  });

  it("a quarter's figures count only what happened inside it, from the same counted deals as every other screen", async () => {
    const now = Date.now();
    const deals = [
      { locationId: LA1, status: "open", value: 1000, assignedTo: "u1", createdAt: now - 5 * 86_400_000, statusChangedAt: null },
      { locationId: LA1, status: "open", value: 0, assignedTo: "u1", createdAt: now - 5 * 86_400_000, statusChangedAt: null },
      { locationId: LA1, status: "won", value: 2000, assignedTo: "u1", createdAt: now - 60 * 86_400_000, statusChangedAt: now - 3 * 86_400_000 },
    ];
    const to = new Date(now + 86_400_000).toISOString().slice(0, 10);
    const from = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
    const q = await quarterFacts(a, LA1, { from, to }, deals as never);
    expect(q.contactsAdded).toBe(0); // the fixture contacts have no date
    expect(q.apptWithOutcome).toBe(3);
    expect(q.apptShowed).toBe(2);
    expect(q.pipelineCreated).toBe(1000);
    expect(q.wonValue).toBe(2000);
    expect(q.wonCount).toBe(1);
    expect(dealFigures(deals as never, now - 30 * 86_400_000, now + 86_400_000).get(LA1)?.pipelineCreated).toBe(1000);
    const old = await quarterFacts(a, LA1, { from: "2020-01-01", to: "2020-03-31" }, deals as never);
    expect([old.apptWithOutcome, old.pipelineCreated, old.wonCount, old.healthDays]).toEqual([0, 0, 0, 0]);
  });
});
