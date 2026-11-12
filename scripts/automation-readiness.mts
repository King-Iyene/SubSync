// READ-ONLY readiness report for testing the automations on ONE of King's own throwaway test accounts (docs/TEST_AUTOMATIONS_GUIDE.md).
// It only reads our own database. It writes nothing, calls nothing in the CRM, sends nothing, and never prints a token, an email address or a contact name.
//   node --env-file=.env.local --import tsx scripts/automation-readiness.mts <account id or part of its name> [--mine]
// Without --mine it refuses an account whose name does not contain "test" (so it cannot be pointed at a client by mistake).
import { closeDb, sql } from "../src/lib/db.ts";
import { LIVE_FLAGS, isLive } from "../src/lib/live-flags.ts";
import { TEMPLATES } from "../src/lib/workflows-setup/templates.ts";

const args = process.argv.slice(2);
const mine = args.includes("--mine");
const want = args.find((a) => !a.startsWith("--"));
const ok = (b: boolean) => (b ? "YES    " : "NO     ");
const line = (good: boolean | null, what: string, fix = "") => console.log(`  ${good === null ? "UNKNOWN" : ok(good)} ${what}${good === false && fix ? `\n          -> ${fix}` : ""}`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safe = async (f: () => PromiseLike<unknown>, fallback: any): Promise<any> => { try { return await f(); } catch { return fallback; } };

if (!want) { console.log("Give the test account's id or part of its name, for example: automation-readiness.mts \"KD Squares Test\""); process.exit(1); }
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.SUPABASE_DB_PASSWORD) {
  console.log("Cannot read the database from this computer: no database login in .env.local. Nothing was checked. Run it where the database login is set.");
  process.exit(0);
}

const REQUIRED: Array<[string, string]> = [
  ["contacts.readonly", "read people (everything)"], ["conversations.readonly", "read conversations (speed, unanswered)"], ["conversations/message.readonly", "read who sent each message (speed)"],
  ["calendars/events.readonly", "read appointments (no-show recovery)"], ["users.readonly", "name the people (leaderboards, call assignment)"],
];
const OPTIONAL: Array<[string, string]> = [
  ["workflows.readonly", "see workflows (folder check, Workflows module)"], ["workflows.write", "create the call workflows"], ["workflows.publish", "publish them"],
  ["contacts.write", "tags, notes and field fixes through the safe gateway"], ["locations/tags.readonly", "read tags"], ["locations/tags.write", "create tags"], ["conversations/message.write", "write internal comments (never a message to a lead)"],
];
const TAGS = ["call-now", ...TEMPLATES.filter((t) => t.key !== "call_queue").map((t) => t.defaultTag)];
const FLAG_KEYS = ["wf_library", "wf_outcomes", "wf_bulk", "wf_today", "cf_save", "cf_email", "inbox_breach_alert", "inbox_digest", "moat_record", "moat_receipt"];

try {
  const db = sql();
  const found = await db`select i.id as inst, i.company_name, i.scope, i.plan, i.uninstalled_at, l.location_id, l.name, l.last_synced_at, l.cleanup_write_enabled as opted_in
    from locations l join installations i on i.id = l.installation_id
    where not coalesce(i.is_demo, false) and (l.location_id = ${want} or l.name ilike ${"%" + want + "%"}) order by l.name limit 5`.catch(async () =>
    db`select i.id as inst, i.company_name, i.scope, i.plan, i.uninstalled_at, l.location_id, l.name, l.last_synced_at, null::boolean as opted_in
    from locations l join installations i on i.id = l.installation_id where (l.location_id = ${want} or l.name ilike ${"%" + want + "%"}) order by l.name limit 5`);
  if (found.length === 0) { console.log(`No account matches "${want}". Nothing was checked.`); process.exit(0); }
  if (found.length > 1) { console.log(`"${want}" matches ${found.length} accounts (${found.map((r) => r.name).join(", ")}). Use the exact id. Nothing was checked.`); process.exit(0); }
  const a = found[0];
  if (!mine && !/test/i.test(String(a.name ?? ""))) {
    console.log(`"${a.name}" does not look like a test account. This report is for King's own test accounts only. If it really is yours, run it again with --mine. Nothing was checked.`);
    process.exit(0);
  }
  const inst = a.inst as string, loc = a.location_id as string;
  const granted = new Set(String(a.scope ?? "").split(/[\s,]+/).filter(Boolean));
  console.log(`\nAutomation readiness for "${a.name}" (read only, nothing was changed or sent)`);
  console.log(`Installed: ${a.uninstalled_at ? "NO, it was uninstalled" : "yes"}   Plan: ${a.plan ?? "?"}   Last sync: ${a.last_synced_at ? new Date(a.last_synced_at as string).toISOString() : "never"}\n`);

  console.log("1. Permissions granted at install (read from our record, no CRM call)");
  for (const [s, why] of REQUIRED) line(granted.has(s), `${s}: ${why}`, "Reconnect the app on this account and approve it.");
  for (const [s, why] of OPTIONAL) line(granted.has(s), `${s} (optional): ${why}`, "Optional. Without it the matching automation shows \"Needs permission: reconnect\".");

  console.log("\n2. Safe switches");
  console.log("  Server switches as THIS computer sees them (.env.local). The live app's values are in Vercel and may differ: check them there.");
  for (const f of LIVE_FLAGS) console.log(`  ${isLive(f) ? "ON     " : "off    "} ${f}${isLive(f) ? "   <- real sends or writes happen when this is on" : ""}`);
  line(a.opted_in === null ? null : a.opted_in === true, "This account allowed SubSync to change contacts (the per-account opt-in in Settings)", "Settings > Data cleanup > allow changes for this account. Without it every write is a rehearsal.");

  console.log("\n3. Feature switches in the database (an empty answer means the built-in default)");
  const flags: Array<{ key: string; enabled: boolean }> = await safe(() => db`select key, enabled from feature_flags where key = any(${FLAG_KEYS}::text[])`, []);
  const fmap = new Map<string, boolean>(flags.map((f) => [f.key, f.enabled]));
  for (const k of FLAG_KEYS) console.log(`  ${fmap.has(k) ? (fmap.get(k) ? "ON     " : "off    ") : "default"} ${k}`);

  console.log("\n4. Call workflows (our own record of what was set up here; the CRM itself is not asked)");
  const wf: Array<Record<string, unknown>> | null = await safe(() => db`select template_key, status, folder_id is not null as has_folder, workflow_id is not null as has_workflow, last_error from workflow_setup where installation_id = ${inst} and location_id = ${loc}`, null);
  if (wf === null) line(null, "The workflow setup table is not in this database yet (migration 20261117090000 not applied)");
  else {
    const by = new Map<string, Record<string, unknown>>(wf.map((r) => [r.template_key as string, r]));
    for (const t of TEMPLATES) {
      const r = by.get(t.key);
      line(!!r && r.status === "active" && r.has_workflow === true, `Workflow "${t.name}" (tag ${t.defaultTag}) set up${r ? `, status ${r.status}${r.has_folder ? ", folder recorded" : ", no folder recorded"}${r.last_error ? `, last problem: ${String(r.last_error).slice(0, 80)}` : ""}` : ""}`, "Call mode > Call queue setup > Set up (rehearses unless the switches are on).");
    }
  }
  const st = await safe(() => db`select folder_name, auto_setup, assign_mode from workflow_setup_settings where installation_id = ${inst} and location_id = ${loc}`, [] as Array<Record<string, unknown>>);
  console.log(`  Folder name: ${st[0]?.folder_name ? String(st[0].folder_name) : "Lead Response Automations (default)"}   Set up automatically on install: ${st[0]?.auto_setup ? "on" : "off"}   Calls go to: ${st[0]?.assign_mode ?? "round_robin"}`);

  console.log("\n5. Trigger tags (counted in our synced copy of this account's people)");
  for (const tag of TAGS) {
    const [c] = await safe(() => db`select count(*)::int n from cached_contacts where installation_id = ${inst} and location_id = ${loc} and ${tag} = any(tags)`, [{ n: -1 }]);
    console.log(`  ${c.n > 0 ? "YES    " : "NO     "} ${c.n < 0 ? "(could not count) " : ""}a person carries the tag "${tag}" (${c.n < 0 ? "?" : c.n}). ${c.n === 0 ? "Fine before the test: you add it yourself in the CRM in the guide." : ""}`);
  }

  console.log("\n6. Email and Slack (dry run means: written to the log as WOULD SEND, nothing leaves)");
  console.log(`  Email sending: ${isLive("SEND_EMAIL_LIVE") ? "LIVE on this computer" : "dry run"}   Slack sending: ${isLive("SEND_SLACK_LIVE") ? "LIVE on this computer" : "dry run"}`);
  line(!!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM, "Email provider key and sending address are set here (values not shown)");
  const prefs = await safe(() => db`select type, enabled from notification_prefs where installation_id = ${inst} order by type`, [] as Array<{ type: string; enabled: boolean }>);
  console.log(`  Message types chosen: ${prefs.length ? prefs.map((p: { type: string; enabled: boolean }) => `${p.type}${p.enabled ? "" : " (off)"}`).join(", ") : "none saved yet (built-in defaults apply)"}`);
  const dest = await safe(() => db`select count(*)::int n, count(*) filter (where status = 'active')::int active from notification_destinations where installation_id = ${inst} and (location_id is null or location_id = '' or location_id = ${loc})`, [{ n: 0, active: 0 }]);
  console.log(`  Slack channels connected for this account or the company: ${dest[0].n} (${dest[0].active} working)`);
  const cf = await safe(() => db`select save_on, save_hour, coalesce(array_length(recipients, 1), 0) as recipients from cf_prefs where installation_id = ${inst}`, [] as Array<Record<string, unknown>>);
  line(cf[0] ? cf[0].save_on === true && Number(cf[0].recipients) > 0 : false, `Morning "save this account" email is on with at least one recipient${cf[0] ? ` (hour ${cf[0].save_hour}, ${cf[0].recipients} recipient(s))` : ""}`, "Cash features > turn the morning email on and add yourself (needs the cf_save and cf_email switches).");
  const sd = await safe(() => db`select count(*)::int n from speed_digest where installation_id = ${inst} and (location_id = '' or location_id = ${loc})`, [{ n: 0 }]);
  console.log(`  Speed summary messages saved: ${sd[0].n}`);

  console.log("\n7. Evidence that things ran (audit log, last 14 days; counts only)");
  const rows = await safe(() => db`select action, count(*)::int n, max(at) last from audit_log where installation_id = ${inst} and at > now() - interval '14 days' and (action like '%WOULD%' or action like 'crm.write%' or action like 'workflow%' or action like 'wf.%' or action like '%would%') group by action order by last desc limit 12`, [] as Array<Record<string, unknown>>);
  if (rows.length === 0) console.log("  Nothing yet (no dry-run lines, no writes, no workflow lines in 14 days).");
  for (const r of rows) console.log(`  ${String(r.action).slice(0, 48).padEnd(48)} x${r.n}   last ${new Date(r.last as string).toISOString()}`);
  const [hook] = await safe(() => db`select max(received_at) last, count(*) filter (where received_at > now() - interval '24 hours')::int d from webhook_events`, [{ last: null, d: 0 }]);
  console.log(`  Last platform webhook seen by SubSync (all accounts, it is not kept per account): ${hook.last ? new Date(hook.last as string).toISOString() : "never"}; in the last 24 hours: ${hook.d}`);

  console.log("\nIf a line says NO, the matching test in docs/TEST_AUTOMATIONS_GUIDE.md will not work yet. This script changed nothing.");
} finally {
  await closeDb();
}
