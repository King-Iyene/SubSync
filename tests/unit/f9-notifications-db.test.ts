import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { listAlerts } from "@/lib/analytics/queries";
import { drainInstallation } from "@/lib/notifications/service";
import { drain, plan, type Context, type Intent } from "@/lib/notifications/dispatcher";
import { defaultPref, type Legacy, type Pref } from "@/lib/notifications/prefs";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications/catalog";
import { addAdvancedDestination, completeDestination, createPendingDestination, dbLedger, insertNotification, listBell, listDestinations, loadPrefRows, markAllRead, removeDestination, removeRecipientByMatch, savePref, setBellState, webhookOf } from "@/lib/notifications/store";
import { raiseInboxBreachForInstallation } from "@/lib/analytics/inbox-breach-alerts";
import { FakeTransports, slackDest } from "../fixtures/notify-fakes";

// Stage F9 and Item 3 against the real database, with a fixture company that has no refresh token (so the production cron never touches it).
// Everything created here is removed again. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-f9-co";
const HOOK = "https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXX";
const NONE: Legacy = { slackConfigured: false, digestEnabled: false, digestEmail: null, digestHour: null, digestTimezone: null, alertQuietHours: true };

let inst = "";

const ctxFor = (over: Partial<Record<NotificationType, Partial<Pref>>> = {}, zone = "Africa/Lagos"): Context => {
  const prefs = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, { ...defaultPref(t, NONE, []), ...(over[t] ?? {}) }])) as Record<NotificationType, Pref>;
  return { installationId: inst, mode: "agency", company: "Fixture Co", appUrl: "https://app.example.test", fallbackZone: zone, pref: (t) => prefs[t], destinations: [slackDest("d1")], stopUrl: () => null };
};
const speed = (id: string, over: Partial<Intent> = {}): Intent => ({ type: "speed_breach", locationId: "L1", severity: "warning", dedupeKey: `alert:${id}`, values: { account: "Fixture", count: 5, target: 15, longest: "" }, ...over });

describe.skipIf(!HAS_DB)("notifications against the real database", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    const [row] = await sql()`insert into installations (company_id, company_name, plan) values (${CO}, 'zzF9', 'pro') returning id`;
    inst = row.id as string;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
  });
  // Rows from one test must never leak into the next: the drain works off every waiting row of the installation.
  afterEach(async () => {
    await sql()`delete from notification_deliveries where installation_id = ${inst}`;
    await sql()`delete from notifications where installation_id = ${inst}`;
    await sql()`delete from alerts where installation_id = ${inst}`;
    await sql()`delete from cached_conversations where installation_id = ${inst}`;
    await sql()`delete from cached_contacts where installation_id = ${inst}`;
    await sql()`delete from location_users where installation_id = ${inst}`;
    await sql()`delete from locations where installation_id = ${inst}`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("the ledger's own unique rule means the same message to the same place is created once, even when two runs race", async () => {
    const ledger = dbLedger();
    const now = Date.now();
    const mk = () => ledger.insert({ installationId: inst, locationId: "L1", type: "speed_breach", channel: "email", target: "a@x.test", dedupeKey: "alert:race", severity: "warning", status: "pending", payload: { title: "t", body: "", details: [], severity: "warning", link: { view: "speed", locationId: null } }, alertId: null }, now);
    const results = await Promise.all([mk(), mk(), mk(), mk()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [n] = await sql()`select count(*)::int n from notification_deliveries where installation_id = ${inst} and dedupe_key = 'alert:race'`;
    expect(n.n).toBe(1);
  });

  it("creates private 24-hour alerts for the assigned owner or account admin, caps each recipient at ten per UTC day, and dedupes refreshes", async () => {
    const loc = "xtest-f9-breach-location";
    const owner = "xtest-f9-breach-owner";
    const admin = "xtest-f9-breach-admin";
    const now = Date.parse("2026-11-02T22:30:00Z");
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${inst}, ${loc}, 'Breach Clinic', 'Africa/Lagos')`;
    await sql()`insert into location_users (installation_id, location_id, user_id, name, role) values
      (${inst}, ${loc}, ${owner}, 'Breach Owner', 'account_user'),
      (${inst}, ${loc}, ${admin}, 'Breach Admin', 'account_admin')`;
    const emailPref = defaultPref("other_alerts", NONE, []);
    await savePref(inst, { ...emailPref, email: true, recipients: ["owner@x.test"] }, "breach-test");
    for (let i = 0; i < 11; i++) {
      const contact = `xtest-f9-breach-contact-${i}`;
      await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, assigned_to)
        values (${inst}, ${loc}, ${contact}, 'Person', ${String(i)}, 'different-user')`;
      await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, assigned_to, last_message_direction, last_message_at)
        values (${inst}, ${loc}, ${`xtest-f9-breach-conv-${i}`}, ${contact}, ${`Person ${i}`}, ${owner}, 'inbound', ${new Date(now - 25 * 60 * 60_000)})`;
    }
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name)
      values (${inst}, ${loc}, 'xtest-f9-breach-unassigned', 'Unassigned', 'Person')`;
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_direction, last_message_at)
      values (${inst}, ${loc}, 'xtest-f9-breach-unassigned-conv', 'xtest-f9-breach-unassigned', 'Unassigned Person', 'inbound', ${new Date(now - 25 * 60 * 60_000)})`;

    const first = await raiseInboxBreachForInstallation(inst, now);
    expect(first).toMatchObject({ created: 11, capped: 1, unroutable: 0 });
    const [counts] = await sql()`select
      count(*) filter (where kind = 'breach24' and recipient_user_key = ${owner})::int owner_alerts,
      count(*) filter (where kind = 'breach24' and recipient_user_key = ${admin})::int admin_alerts
      from alerts where installation_id = ${inst}`;
    expect([counts.owner_alerts, counts.admin_alerts]).toEqual([10, 1]);
    expect(await listAlerts(inst, false, 200, loc)).toHaveLength(0);
    expect(await listAlerts(inst, false, 200, loc, owner)).toHaveLength(10);
    expect(await listAlerts(inst, false, 200, loc, admin)).toHaveLength(1);
    const [held] = await sql()`select count(*)::int n from notification_deliveries
      where installation_id = ${inst} and type = 'other_alerts' and channel = 'email'
        and email_dry_run_only and status = 'held'`;
    expect(held.n).toBe(11);
    const [notCreatedYet] = await sql()`select count(*)::int n from notifications where installation_id = ${inst} and recipient_user_key in (${owner}, ${admin})`;
    expect(notCreatedYet.n).toBe(0);

    await drainInstallation(inst, Date.parse("2026-11-03T06:10:00Z"));
    const [email] = await sql()`select count(*)::int n from notification_deliveries
      where installation_id = ${inst} and type = 'other_alerts' and channel = 'email'
        and email_dry_run_only and status = 'dry_run'`;
    expect(email.n).toBe(11);
    expect((await listBell(inst, { kind: "client", limitTo: loc }, owner, now)).filter((n) => n.type === "other_alerts")).toHaveLength(10);
    expect((await listBell(inst, { kind: "client", limitTo: loc }, admin, now)).filter((n) => n.type === "other_alerts")).toHaveLength(1);
    expect((await listBell(inst, { kind: "client", limitTo: loc }, "not-the-recipient", now)).filter((n) => n.type === "other_alerts")).toHaveLength(0);

    const again = await raiseInboxBreachForInstallation(inst, now + 60_000);
    // The eleventh waiting person is still over the owner's daily cap of ten, so a refresh reports it as capped again but creates nothing.
    expect(again).toMatchObject({ created: 0, capped: 1, unroutable: 0 });
    const [total] = await sql()`select count(*)::int n from notifications
      where installation_id = ${inst} and type = 'other_alerts' and recipient_user_key in (${owner}, ${admin})`;
    expect(total.n).toBe(11);
  }, 180000);

  it("plan and drain with the real ledger: held at night, released in the morning, sent once, and a second plan creates nothing", async () => {
    const ctx = ctxFor({ speed_breach: { email: true, recipients: ["owner@x.test"], inApp: false } });
    const tr = new FakeTransports();
    const night = Date.parse("2026-11-02T22:30:00Z"); // 23:30 in Lagos
    const ledger = dbLedger();
    expect((await plan([speed("night")], ctx, ledger, night)).held).toBe(1);
    expect((await drain(ctx, ledger, tr, night)).stillHeld).toBe(1);
    expect(tr.to("email")).toHaveLength(0);
    const morning = Date.parse("2026-11-03T06:10:00Z");
    expect((await drain(ctx, ledger, tr, morning)).sent).toBe(1);
    expect(tr.to("email")).toHaveLength(1);
    expect((await plan([speed("night")], ctx, ledger, morning)).duplicates).toBe(1);
    expect((await drain(ctx, ledger, tr, morning + 3_600_000)).sent).toBe(0);
    const [r] = await sql()`select status, attempts from notification_deliveries where installation_id = ${inst} and dedupe_key = 'alert:night' and channel = 'email'`;
    expect([r.status, r.attempts]).toEqual(["sent", 1]);
  });

  it("a failed send is stored as pending with a retry time, and the real ledger answers 'due' only after it", async () => {
    const ctx = ctxFor({ speed_breach: { email: true, recipients: ["owner@x.test"], inApp: false } });
    const tr = new FakeTransports();
    tr.script.email = [{ ok: false, permanent: false, code: "http_503" }];
    const ledger = dbLedger();
    const t0 = Date.parse("2026-11-02T12:00:00Z");
    await plan([speed("retry")], ctx, ledger, t0);
    expect((await drain(ctx, ledger, tr, t0)).retried).toBe(1);
    expect((await ledger.due(inst, t0 + 30_000, 50)).filter((r) => r.dedupeKey === "alert:retry")).toHaveLength(0);
    expect((await ledger.due(inst, t0 + 61_000, 50)).filter((r) => r.dedupeKey === "alert:retry")).toHaveLength(1);
    expect((await drain(ctx, ledger, tr, t0 + 61_000)).sent).toBe(1);
  });

  it("the bell: an agency sees every account, a business its own and company-wide items, a client's staff only their own account; marks are per person", async () => {
    const mk = (loc: string | null, key: string) => insertNotification({ installationId: inst, locationId: loc, type: "speed_breach", severity: "warning", item: { title: `item ${key}`, body: "", details: [], severity: "warning", link: { view: "speed", locationId: null } }, alertId: null, dedupeKey: `bell:${key}` });
    await mk("L1", "one"); await mk("L2", "two"); await mk(null, "all");
    await mk("L1", "one"); // the same key again: still one row
    const titles = async (scope: { kind: "agency" | "business" | "client"; limitTo: string | null }, user = "u1") => (await listBell(inst, scope, user)).map((i) => i.title).filter((t) => t.startsWith("item ")).sort();
    expect(await titles({ kind: "agency", limitTo: null })).toEqual(["item all", "item one", "item two"]);
    expect(await titles({ kind: "business", limitTo: "L1" })).toEqual(["item all", "item one"]);
    expect(await titles({ kind: "client", limitTo: "L1" })).toEqual(["item one"]);
    expect(await titles({ kind: "client", limitTo: "L2" })).toEqual(["item two"]);
    const all = await listBell(inst, { kind: "agency", limitTo: null }, "u1");
    const two = all.find((i) => i.title === "item two")!;
    const one = all.find((i) => i.title === "item one")!;
    // A client of L1 cannot touch L2's item, and the answer is the same as for an item that does not exist.
    expect(await setBellState(inst, { kind: "client", limitTo: "L1" }, "c1", two.id, { dismiss: true })).toBe(false);
    expect(await setBellState(inst, { kind: "client", limitTo: "L1" }, "c1", "00000000-0000-0000-0000-000000000000", { dismiss: true })).toBe(false);
    // A person's own marks do not change anyone else's view.
    expect(await setBellState(inst, { kind: "client", limitTo: "L1" }, "c1", one.id, { dismiss: true })).toBe(true);
    expect(await titles({ kind: "client", limitTo: "L1" }, "c1")).toEqual(["item one"]);
    expect((await listBell(inst, { kind: "client", limitTo: "L1" }, "c1")).find((i) => i.id === one.id)!.dismissedAt).not.toBeNull();
    expect((await listBell(inst, { kind: "client", limitTo: "L1" }, "c2")).find((i) => i.id === one.id)!.dismissedAt).toBeNull();
    expect(await markAllRead(inst, { kind: "agency", limitTo: null }, "u9")).toBeGreaterThanOrEqual(3);
  });

  it("a fixed alert leaves the bell by itself", async () => {
    const [a] = await sql()`insert into alerts (installation_id, location_id, kind, severity, title, dedupe_key) values (${inst}, 'L1', 'speed', 'warning', 'x', 'k-f9') returning id`;
    await insertNotification({ installationId: inst, locationId: "L1", type: "speed_breach", severity: "warning", item: { title: "item alert", body: "", details: [], severity: "warning", link: { view: "speed", locationId: null } }, alertId: a.id as string, dedupeKey: "bell:alert" });
    const has = async () => (await listBell(inst, { kind: "agency", limitTo: null }, "u1")).some((i) => i.title === "item alert" && !i.resolved);
    expect(await has()).toBe(true);
    await sql()`update alerts set resolved_at = now() where id = ${a.id}`;
    expect(await has()).toBe(false);
  });

  it("Slack channels: the address is stored encrypted and never listed; a waiting channel completes once; removing one removes its routing", async () => {
    const added = await addAdvancedDestination(inst, { webhookUrl: HOOK, label: "Sales", locationId: null }, "tester");
    expect(added.ok).toBe(true);
    const id = (added as { id: string }).id;
    const [raw] = await sql()`select webhook_url_enc from notification_destinations where id = ${id}`;
    expect(String(raw.webhook_url_enc).startsWith("v1.")).toBe(true);
    expect(String(raw.webhook_url_enc)).not.toContain("hooks.slack.com");
    expect(JSON.stringify(await listDestinations(inst))).not.toMatch(/hooks\.slack\.com|v1\./);
    expect(await webhookOf(inst, id)).toBe(HOOK);
    expect((await addAdvancedDestination(inst, { webhookUrl: "https://evil.example/x", label: "x", locationId: null }, null)).ok).toBe(false);

    const waiting = await createPendingDestination(inst, "L1", "tester");
    expect(await completeDestination(inst, waiting, { webhookUrl: HOOK, label: "Acme · #one" }, "tester")).toBe(true);
    expect(await completeDestination(inst, waiting, { webhookUrl: HOOK, label: "again" }, "tester")).toBe(false);
    // Another installation can neither complete nor read it.
    expect(await completeDestination("00000000-0000-0000-0000-000000000000", waiting, { webhookUrl: HOOK, label: "x" }, null)).toBe(false);
    expect(await webhookOf("00000000-0000-0000-0000-000000000000", waiting)).toBeNull();

    await savePref(inst, { ...defaultPref("speed_breach", NONE, []), slackDestinations: [id, waiting] }, "tester");
    expect(await removeDestination(inst, id, "tester")).toBe(true);
    const prefs = await loadPrefRows(inst);
    expect((prefs.get("speed_breach")!.channels as { slackDestinations: string[] }).slackDestinations).toEqual([waiting]);
    expect(await removeDestination(inst, id, "tester")).toBe(false);
  });

  it("preferences save and read back; an unsubscribe takes the address out of every kind of message", async () => {
    await savePref(inst, { ...defaultPref("daily_brief", NONE, []), email: true, recipients: ["a@x.test", "b@x.test"] }, "tester");
    await savePref(inst, { ...defaultPref("weekly_summary", NONE, []), email: true, recipients: ["a@x.test"] }, "tester");
    const removed = await removeRecipientByMatch(inst, (e) => e === "a@x.test");
    expect(removed).toBe(2);
    const prefs = await loadPrefRows(inst);
    expect(prefs.get("daily_brief")!.recipients).toEqual(["b@x.test"]);
    expect(prefs.get("weekly_summary")!.recipients).toEqual([]);
  });

  it("the public and signed-in database roles can read nothing in any of the five tables", async () => {
    for (const t of ["notification_prefs", "notification_destinations", "notifications", "notification_states", "notification_deliveries"]) {
      for (const role of ["anon", "authenticated"]) {
        let refused = false;
        try { await sql().begin(async (tx) => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(`select 1 from public.${t} limit 1`); }); } catch { refused = true; }
        expect(refused, `${role} on ${t}`).toBe(true);
      }
    }
  });
});
