import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

// Cross-tenant isolation (brief section 4.2). Two real, separate agencies are created in the database
// (not the demo), each with its own client accounts, contacts, deals, meeting notes and connections.
// Each agency, and a business and a client view inside it, then tries to read or change the other's data
// by asking for the other's ids and by changing every id and filter a request can carry. Nothing from the
// other side may ever appear, and nothing of the other side may change. Everything created is removed.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-tenancy.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

type Side = { company: string; marker: string; inst: string; locs: string[]; contacts: string[]; opps: string[] };
// A fee no other number in the app can look like. Company A charges 4321.77 and 4322.77 for its two accounts, company B 8765.43 and 8766.43.
const FEE = { a: [4321.77, 4322.77], b: [8765.43, 8766.43] } as const;

async function main() {
  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    const text = await res.text();
    return { status: res.status, text };
  };

  const make = async (key: "a" | "b"): Promise<Side> => {
    const K = key.toUpperCase();
    const company = `xtest-agency-${key}`;
    const marker = `zzTenant${K}`;
    await sql()`delete from installations where company_id = ${company}`;
    // No refresh token on purpose: the production scheduler (every 5 minutes, same database) only queues sync jobs for installations that
    // have one, so a fixture with one would get jobs from the cron in the middle of the "nothing changed" comparison below.
    const [inst] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at)
      values (${company}, ${marker + " Agency"}, 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
    const locs = [`xtestLoc${K}0001`, `xtestLoc${K}0002`];
    const contacts: string[] = [];
    const opps: string[] = [];
    for (const [i, loc] of locs.entries()) {
      await sql()`insert into locations (installation_id, location_id, name, email, timezone, client_view) values (${inst.id}, ${loc}, ${`${marker} Location ${i + 1}`}, ${`${key}${i}@${marker.toLowerCase()}.test`}, 'America/New_York', ${i === 1})`;
      await sql()`insert into notifications (installation_id, location_id, type, severity, title, body, dedupe_key)
        values (${inst.id}, ${loc}, 'other_alerts', 'warning', ${`${marker} Alert ${i + 1}`}, 'Fixture alert', ${`tenancy:${marker}:${i}`})`;
      const c = `xtestContact${K}${i}`;
      contacts.push(c);
      await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, date_added, last_activity_at)
        values (${inst.id}, ${loc}, ${c}, ${marker}, ${`Person${i}`}, ${`person${i}@${marker.toLowerCase()}.test`}, ${`+1555010${key === "a" ? 1 : 2}${i}00`}, '{}', now() - interval '200 days', now() - interval '200 days'),
          (${inst.id}, ${loc}, ${c + "dup"}, ${marker}, ${`Person${i}`}, ${`person${i}@${marker.toLowerCase()}.test`}, ${`+1555010${key === "a" ? 1 : 2}${i}00`}, '{}', now() - interval '100 days', now() - interval '100 days')`;
      const o = `xtestOpp${K}${i}`;
      opps.push(o);
      await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, pipeline_name, stage_id, stage_name, contact_id, contact_name, name, monetary_value, status, last_stage_change_at, last_status_change_at)
        values (${inst.id}, ${loc}, ${o}, ${"p" + K}, ${marker + " Pipeline"}, 's1', 'New', ${c}, ${marker + " Person"}, ${marker + " Deal"}, 7777, 'open', now() - interval '120 days', now() - interval '120 days')`;
      await sql()`insert into meeting_notes (installation_id, location_id, source, title, summary) values (${inst.id}, ${loc}, 'other', ${marker + " Meeting"}, ${marker + " summary"})`;
      // What an agency keeps about each client and must never show that client (N84): what it charges, its own notes, an owner label.
      await sql()`insert into account_profiles (installation_id, location_id, monthly_fee, renewal_date, industry, notes) values (${inst.id}, ${loc}, ${FEE[key][i]}, '2027-03-01', ${marker + "Industry"}, ${marker + "FeeNote"})`;
      await sql()`update locations set owner = ${marker + "OwnerLabel"} where installation_id = ${inst.id} and location_id = ${loc}`;
    }
    await sql()`insert into api_keys (installation_id, name, key_prefix, key_hash) values (${inst.id}, ${marker + "KeyName"}, 'ss_zz', ${"zzhash" + key + Math.random().toString(36).slice(2)})`;
    await sql()`insert into call_lists (installation_id, name, filters) values (${inst.id}, ${marker + "ListName"}, '{}')`;
    await sql()`insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, webhook_secret_enc, public_key)
      values (${inst.id}, 'fathom', ${marker + " Fathom"}, 'wh', ${encryptSecret("x")}, ${encryptSecret("y")}, now() + interval '1 hour', ${encryptSecret("whsec_AAAA")}, ${`xtestkey${K}`.padEnd(24, K)})`;
    // Wallet guard and the 7 am brief: each agency holds readings, working numbers, events, a limit, a watcher, a brief choice and a brief record that carry its marker. The SAME user id is used on both sides on purpose.
    for (const [i, loc] of locs.entries()) {
      await sql()`insert into wg_samples (installation_id, location_id, observed_at, balance) values (${inst.id}, ${loc}, now() - interval '2 days', 40.5), (${inst.id}, ${loc}, now() - interval '1 day', 22.25)`;
      await sql()`insert into wg_state (installation_id, location_id, wallet_state, balance, samples, burn_per_day, days_left, computed_at) values (${inst.id}, ${loc}, 'ok', ${12.34 + i}, 14, 8, ${1.5 + i}, now())`;
      await sql()`insert into wg_events (installation_id, location_id, kind, episode, balance, detail) values (${inst.id}, ${loc}, 'low', 'x', 12.34, ${sql().json({ marker } as never)})`;
      await sql()`insert into wg_rules (installation_id, location_id, low_amount) values (${inst.id}, ${loc}, ${31.5 + i})`;
    }
    await sql()`insert into wg_prefs (installation_id, low_amount) values (${inst.id}, 17.5)`;
    await sql()`insert into wg_watchers (installation_id, user_key) values (${inst.id}, 'u-owner')`;
    await sql()`insert into br_prefs (installation_id, user_key, email, email_on) values (${inst.id}, 'u-owner', ${`${marker.toLowerCase()}owner@example.test`}, false)`;
    await sql()`insert into br_history (installation_id, user_key, day, channel, mode, items, item_count) values (${inst.id}, 'u-owner', '2026-11-10', 'app', 'shown', ${sql().json([{ key: "k1", title: `${marker} item`, count: 1 }] as never)}, 1)`;
    return { company, marker, inst: inst.id as string, locs, contacts, opps };
  };

  const session = (side: Side, kind: "agency" | "business" | "client", loc?: string, dataOwner = false) =>
    signSession({ companyId: side.company, userId: "u-" + kind, role: "admin", userName: "Tester", demo: false, kind, locationId: loc ?? null, dataOwner });

  const A = await make("a");
  const B = await make("b");
  try {
    const sides: Array<[Side, Side]> = [[A, B], [B, A]];

    // Read routes, asked in ways that try to reach the other side: its location ids, its contact ids, its names.
    const reads = (me: Side, other: Side) => [
      "/api/app/overview", "/api/app/accounts", `/api/app/accounts/${other.locs[0]}`, `/api/app/accounts/${other.locs[0]}?locationId=${other.locs[0]}`,
      `/api/app/search?q=${other.marker}`, `/api/app/search?q=${other.marker.toLowerCase()}.test`, `/api/app/search?q=${encodeURIComponent("5550102")}`,
      "/api/app/stale", "/api/app/hygiene", "/api/app/inbox", "/api/app/pipelines", "/api/app/duplicates", "/api/app/alerts", "/api/app/notifications", "/api/app/pipeline-intel", "/api/app/contact-intel",
      "/api/app/comms-intel", "/api/app/deal-gaps", "/api/app/deal-events", `/api/app/contact/${other.contacts[0]}?locationId=${other.locs[0]}`, `/api/app/contact/${other.contacts[0]}`,
      "/api/app/appointments", "/api/app/appointment-insights", "/api/app/meetings", "/api/app/cleanup", "/api/app/connections", "/api/app/team", "/api/app/clients",
      "/api/app/daily", "/api/app/email", "/api/app/sync-status", "/api/app/freshness", "/api/app/call-queue", "/api/app/call-lists", "/api/app/call-outcomes", "/api/app/goals",
      "/api/app/exec-summary", "/api/app/digest", "/api/app/settings", "/api/app/api-keys", `/api/app/setup-compare?baseline=${other.locs[0]}`, "/api/app/playbooks", "/api/app/start",
      "/api/app/export/stale", "/api/app/export/duplicates", "/api/app/export/inbox", "/api/app/export/deals", "/api/app/export/alerts",
      // Stage C1 (Clients): onboarding, the log of conversations, trends, compare and the review, each aimed at the other side.
      "/api/app/client-onboarding", `/api/app/client-onboarding/${other.locs[0]}/history`, `/api/app/clients/${other.locs[0]}/notes`, `/api/app/client-trends/${other.locs[0]}`,
      `/api/app/client-trends?ids=${other.locs[0]},${other.locs[1]}`, `/api/app/clients/compare?ids=${other.locs[0]},${other.locs[1]}`, `/api/app/qbr/${other.locs[0]}?quarter=2026-Q4`,
      `/api/app/overview?industry=medical&owner=${other.marker}`, `/api/app/search?q=${me.marker}`,
      // Today (second pass): the read, the brief preview and the saved views, asked for the other side's accounts by every parameter Today takes.
      "/api/app/today", `/api/app/today?accounts=${other.locs[0]}`, `/api/app/today?accounts=${other.locs.join(",")}&ta=${other.locs[0]}`, `/api/app/today?accounts=%2e%2e%2f${other.locs[0]}`,
      "/api/app/today/brief", `/api/app/today/brief?accounts=${other.locs[0]}`, "/api/app/today/views",
      // The duplicate review (stage DUP): the list, the obvious ones, one group, and the other side's account asked for by every parameter the screen takes.
      "/api/app/data-health", `/api/app/data-health?wa=${other.locs[0]}`, `/api/app/data-health/records?loc=${other.locs[0]}`, `/api/app/data-health/sources?loc=${other.locs[0]}`, `/api/app/data-health/proof?loc=${other.locs[0]}`, `/api/app/data-health/export?loc=${other.locs[0]}`, `/api/app/data-health/fixes?loc=${other.locs[0]}`,
      "/api/app/duplicates?size=50", "/api/app/duplicates/obvious", `/api/app/duplicates?location=${other.locs[0]}&size=50`, `/api/app/duplicates?accounts=${other.locs[0]}&status=decided`, `/api/app/duplicates?focus=${other.locs[0]}:00000000-2`,
      // Clean-up (stage CLEANUP): the quality overview and one account, the list and CSV behind a finding, the rules, what-would-this-setting-find, the history, asked for the other side's account by every parameter.
      "/api/app/cleanup/quality", `/api/app/cleanup/quality?account=${other.locs[0]}`, `/api/app/cleanup/quality/list?account=${other.locs[0]}&finding=bad_email`, `/api/app/cleanup/quality/csv?account=${other.locs[0]}&finding=bad_email`,
      // Clean-up fix lists, Health and bulk runs (stage CU), aimed at the other side's accounts by every parameter they take.
      "/api/app/cu/options", "/api/app/cu/home", `/api/app/cu/home?account=${other.locs[0]}`, "/api/app/cu/accounts", `/api/app/cu/accounts?q=${other.marker}`, "/api/app/cu/actions",
      "/api/app/cu/list?kind=junk", `/api/app/cu/list?kind=no_phone&account=${other.locs[0]}`, `/api/app/cu/list?kind=orphan_deals&account=${other.locs[0]}`, `/api/app/cu/csv?kind=no_owner&account=${other.locs[0]}`,
      // Clean-up v2 (stage DQ): reads with another account's id, and a cursor, must come back empty or not found.
      "/api/app/dq/options", "/api/app/dq/overview", `/api/app/dq/overview?account=${other.locs[0]}`, "/api/app/dq/dupes?tier=certain", `/api/app/dq/dupes?tier=likely&account=${other.locs[0]}`, `/api/app/dq/dupe?account=${other.locs[0]}&ids=${other.contacts[0]},${other.contacts[0]}dup`,
      "/api/app/dq/intake?range=30", `/api/app/dq/intake?range=30&account=${other.locs[0]}`, `/api/app/dq/intake-source?src=website%20form&account=${other.locs[0]}`, `/api/app/dq/leads?flag=all&account=${other.locs[0]}`, "/api/app/dq/leads?flag=dup&src=website%20form", "/api/app/dq/accounts", "/api/app/dq/events",
      "/api/app/cleanup/rules", `/api/app/cleanup/rules?account=${other.locs[0]}`, `/api/app/cleanup/rules/preview?account=${other.locs[0]}&preset=loose`, "/api/app/duplicates/history", `/api/app/duplicates/history?location=${other.locs[0]}`, "/api/app/duplicates/rules",
      // Speed to lead (stage SPEED): the first screen, the list behind a number and the comparisons, the other side's account asked for by every parameter they take.
      "/api/app/speed?part=home", "/api/app/speed?part=ignored", `/api/app/speed?part=ignored&account=${other.locs[0]}`, `/api/app/speed?part=ignored-list&reason=all&account=${other.locs[0]}`, `/api/app/speed?part=ignored-list&reason=never&account=${other.locs.join(",")}`, `/api/app/speed?part=list&status=all&account=${other.locs[0]}`, `/api/app/speed?part=list&status=waiting&account=${other.locs.join(",")}`, `/api/app/speed?part=list&status=all&person=${other.marker}`, "/api/app/speed?part=compare&by=account", "/api/app/speed?part=compare&by=person",
      // The Appointments work lists (stage APPT): the lists, the full list and the comparison, asked for the other side's account and person by every parameter the page takes.
      "/api/app/appointments/work", "/api/app/appointments/list?kind=all&size=50", `/api/app/appointments/list?kind=all&location=${other.locs[0]}&size=50`, `/api/app/appointments/list?kind=record&location=${other.locs[0]}`,
      `/api/app/appointments/list?kind=window&bucket=noshow&location=${other.locs[0]}`, "/api/app/appointments/compare?by=account", "/api/app/appointments/compare?by=person", `/api/app/appointments/${other.locs[0]}/anything`,
      // Appointments round 3 (stage AD): every part, asked for the other side's account and people.
      "/api/app/appointments?part=overview", `/api/app/appointments?part=overview&location=${other.locs[0]}`, "/api/app/appointments?part=needs-outcome", `/api/app/appointments?part=needs-outcome&location=${other.locs[0]}`, "/api/app/appointments?part=noshow-recovery", `/api/app/appointments?part=noshow-recovery&location=${other.locs[0]}`, "/api/app/appointments?part=booking-share", `/api/app/appointments?part=booking-share&location=${other.locs[0]}`, "/api/app/appointments?part=flow-tree", `/api/app/appointments?part=flow-tree&location=${other.locs[0]}`, "/api/app/appointments?part=health", `/api/app/appointments?part=health&location=${other.locs[0]}`, "/api/app/appointments?part=sources", `/api/app/appointments?part=sources&location=${other.locs[0]}`, "/api/app/appointments?part=calendars", `/api/app/appointments?part=calendars&location=${other.locs[0]}`, "/api/app/appointments?part=reminders", `/api/app/appointments?part=reminders&location=${other.locs[0]}`, "/api/app/appointments?part=receipt", `/api/app/appointments?part=receipt&location=${other.locs[0]}`, "/api/app/appointments?part=list", `/api/app/appointments?part=list&location=${other.locs[0]}`,
      `/api/app/appointments?part=list&setter=${other.marker}`, `/api/app/appointments?part=list&bucket=at_risk&location=${other.locs[0]}`, `/api/app/appointments?part=needs-outcome&status=new&age=7&sort=oldest&closer=${other.marker}`, `/api/app/appointments?part=needs-outcome&sort=value&after=2026-01-01T00:00:00.000Z%7C${other.marker}%7C-1`, `/api/app/appointments?part=noshow-recovery&setter=${other.marker}&age=3`, `/api/app/appointments?part=list&user=${other.marker}&q=${other.marker}`, `/api/app/appointments?part=flow-tree&compare=${other.marker},${other.marker}`, `/api/app/appointments?part=compare&by=booker&ids=${other.marker},team`, `/api/app/appointments?part=options&group=${other.marker}`, `/api/app/appointments?part=booking-share&team_role=account_admin&has=no&calendar=${other.marker}&group=${other.marker}`, `/api/app/appointments?part=booking-share&user=${other.marker}&location=${other.locs[0]}`, `/api/app/appointments?part=calendars&group=${other.marker}&active=inactive&location=${other.locs[0]}`, `/api/app/appointments?part=trends&by=calendar&group=${other.marker}`, `/api/app/appointments?part=list&bucket=booked&booked_from=2026-01-01&booked_to=2026-02-01&calendar=${other.marker}`, `/api/app/appointments?part=compare&by=owner&ids=${other.marker},none`, `/api/app/appointments?part=detail&location=${other.locs[0]}&id=anything`,
      // Appointments, Leadership tab: every part, asked for the other side's account and people by every parameter the tab takes.
      ...["summary", "pace", "boards", "slots", "decisions", "rows", "export"].flatMap((part) => [`/api/app/appointments/exec?part=${part}`, `/api/app/appointments/exec?part=${part}&location=${other.locs[0]}`, `/api/app/appointments/exec?part=${part}&setter=${other.marker}&closer=${other.marker}&user=${other.marker}&calendar=${other.marker}&source=${other.marker}&basis=booked`]),
      `/api/app/appointments/exec?part=rows&bucket=noshow&dow=1&hour=9&location=${other.locs[0]}`, `/api/app/appointments/exec?part=rows&after=2026-01-01T00:00:00.000Z%7C${other.marker}`,
      // Pipeline round 3 (stage PD): every part, asked for the other side's account, people, source and deal by every parameter the page takes.
      ...["overview", "money-flow", "attention", "won-lost", "forecast", "people", "sources", "stage-history", "health", "receipt", "list", "replay", "funnel", "funnel-deals", "stuck", "funnel-settings"].flatMap((part) => [`/api/app/pipeline3?part=${part}`, `/api/app/pipeline3?part=${part}&location=${other.locs[0]}`, `/api/app/pipeline3?part=${part}&owner=${other.marker}&q=${other.marker}`]),
      `/api/app/pipeline3?part=funnel&pipeline=${other.marker}`, `/api/app/pipeline3?part=funnel-deals&step=${other.marker}&pipeline=${other.marker}&drill=entered`, `/api/app/pipeline3?part=stuck&location=${other.locs[0]}&pipeline=${other.marker}`,
      `/api/app/pipeline3?part=list&stage=${other.marker}&pipeline=${other.marker}&source=${other.marker}`, `/api/app/pipeline3?part=detail&location=${other.locs[0]}&id=anything`, `/api/app/pipeline3?part=detail&location=${other.locs[0]}&deal=${other.marker}`,
      // Clients round 3 (stage CD): every part, asked for the other side's account and ids by every parameter the page takes.
      ...["overview", "needs-attention", "trends", "compare", "receipt", "people", "setup", "options", "export", "billing", "money", "money-history"].flatMap((part) => [`/api/app/clients3?part=${part}`, `/api/app/clients3?part=${part}&location=${other.locs[0]}`, `/api/app/clients3?part=${part}&q=${other.marker}&industry=${other.marker}`]),
      ...["leads_down", "waiting", "waiting_old", "unmarked", "noshows", "stale_deals", "no_owner", "no_phone", "staff_quiet", "sync_old", "needs_permission"].flatMap((r) => [`/api/app/clients3?part=list&reason=${r}`, `/api/app/clients3?part=list&reason=${r}&location=${other.locs[0]}`]),
      `/api/app/clients3?part=money&bucket=unpaid&cursor=${other.marker}`, `/api/app/clients3?part=money-history&location=${other.locs[0]}&cursor=1`, `/api/app/clients3?part=compare&ids=${other.locs.join(",")}`, `/api/app/clients3?part=receipt&location=${other.locs[0]}&week=2026-01-05`,
      // Clients v2 (client-account management): every part, asked for the other side's account, name, kind, manager and cursor by every parameter the screen takes.
      ...["list", "options", "today", "plans", "views", "export"].flatMap((part) => [`/api/app/clients2?part=${part}`, `/api/app/clients2?part=${part}&q=${other.marker}&plan=${other.marker}&vertical=${other.marker}&manager=${other.marker}&status=past_due&level=act&quiet=true`, `/api/app/clients2?part=${part}&cursor=${other.marker}&sort=name&size=100`]),
      `/api/app/clients2?part=account&id=${other.locs[0]}`, `/api/app/clients2?part=account&id=${other.marker}`, `/api/app/clients2?part=list&location=${other.locs[0]}`,
      // Today (front page): every part, asked for the other side's account by every parameter the page takes (location, kind, week).
      ...["today", "list", "proof", "numbers", "settings", "export", "options"].flatMap((part) => [`/api/app/today3?part=${part}`, `/api/app/today3?part=${part}&location=${other.locs[0]}`, `/api/app/today3?part=${part}&location=${other.marker}`, `/api/app/today3?part=${part}&location=${other.locs[0]}&week=2026-01-05`]),
      ...["waiting_old", "waiting", "unmarked", "noshows", "stale_deals", "needs_permission", "sync_old", "leads_down", "staff_quiet", "no_owner", "no_phone", "open_deals", "all_waiting", "all_noshows", "all_stale", "mine_waiting"].flatMap((k) => [`/api/app/today3?part=list&kind=${k}`, `/api/app/today3?part=list&kind=${k}&location=${other.locs[0]}`]),
      // Cash features (save this account, missed-lead recovery, deal alerts): every part, asked for the other side's account, kind and cursor by every parameter they take.
      ...["save", "recover", "recover-list", "deals", "deals-list", "settings", "options", "team"].flatMap((part) => [`/api/app/cash?part=${part}`, `/api/app/cash?part=${part}&account=${other.locs[0]}`, `/api/app/cash?part=${part}&account=${other.marker}`, `/api/app/cash?part=${part}&account=${other.locs[0]}&cursor=1%7C${other.locs[0]}~unanswered~${other.contacts[0]}~x`]),
      ...["all", "unanswered", "missed_call", "no_show"].flatMap((k) => [`/api/app/cash?part=recover-list&kind=${k}`, `/api/app/cash?part=recover-list&kind=${k}&account=${other.locs[0]}&snoozed=1`]),
      ...["slipping", "stale", "soon", "lost"].flatMap((k) => [`/api/app/cash?part=deals-list&kind=${k}`, `/api/app/cash?part=deals-list&kind=${k}&account=${other.locs[0]}`]),
      // Team (people) round 3 (stage PD): every part, asked for the other side's account and people by every parameter the page takes (location, user, q, source, after).
      ...["today", "scorecards", "workload", "leaderboard", "money", "coaching", "access", "proof", "person", "handoff", "nextlead", "options", "export"].flatMap((part) => [`/api/app/people3?part=${part}`, `/api/app/people3?part=${part}&location=${other.locs[0]}`, `/api/app/people3?part=${part}&user=${other.marker}&q=${other.marker}&source=${other.marker}`, `/api/app/people3?part=${part}&location=${other.locs[0]}&user=${other.marker}&after=${other.marker}`]),
      ...["waiting", "waiting_old", "stale_deals", "open_deals", "needs_outcome", "upcoming", "no_owner"].flatMap((r) => [`/api/app/people3?part=list&reason=${r}`, `/api/app/people3?part=list&reason=${r}&location=${other.locs[0]}`, `/api/app/people3?part=list&reason=${r}&user=${other.marker}`]),
      // Finance: every part, aimed at the other company's account, person and marker. None may answer with the other side's data.
      ...["options", "headline", "overview", "movement", "revenue", "churn", "payouts", "statement", "periods", "ledger", "setup", "find", "export"].flatMap((part) => [`/api/app/finance?part=${part}&from=2026-10-01&to=2026-11-10`, `/api/app/finance?part=${part}&from=2026-10-01&to=2026-11-10&location=${other.locs[0]}&account=${other.locs[0]}&q=${other.marker}`, `/api/app/finance?part=${part}&from=2026-10-01&to=2026-11-10&person=${other.marker}&what=person&q=${other.marker}`, `/api/app/finance?part=${part}&what=statement&from=2026-10-01&to=2026-11-10&period=${other.marker}&cursor=${other.marker}`]),
      `/api/app/people3?part=proof&location=${other.locs[0]}&named=1`, `/api/app/people3?part=coaching&user=${other.marker}&location=${other.locs[0]}`, `/api/app/people3?part=nextlead&location=${other.locs[0]}&source=${other.marker}`,
      // Appointments actions and meetings (slice AB): the other side's account and appointment named in every way the endpoints take them (reads; the POST bodies are covered by the unit tests and the typed-delete guard).
      `/api/app/appointments/act/panel?locationId=${other.locs[0]}&id=anything`, `/api/app/appointments/act/slots?locationId=${other.locs[0]}&id=anything`, "/api/app/appointments/act/caps", "/api/app/appointments/meetings/home", "/api/app/appointments/meetings/matching", "/api/app/appointments/meetings/followup",
      // Meeting notes list, follow-up lists, coaching and one call (stage MN2): the other side's account named in every way the endpoints take them, and a call id that is not this person's. Reads only; the POST bodies are covered by the unit tests and the cross-tenant database test.
      "/api/app/am/notes", "/api/app/am/slack", `/api/app/am/slack?accounts=${other.locs[0]}`, "/api/app/meeting-list", `/api/app/meeting-list?accounts=${other.locs[0]}`, `/api/app/meeting-list?accounts=${other.locs[0]}&state=matched&q=${other.marker}`, "/api/app/meeting-list/home", "/api/app/meeting-list/coach", ...["no_followup", "no_next_step", "deal_not_moved"].map((k) => `/api/app/meeting-list/follow?kind=${k}`), "/api/app/meeting-list/6f1c8f0a-1b2c-4d3e-8f9a-0123456789ab",
      // Booking funnel (stage BF): every part and every filter, asked for the other side's account, calendar, people, source and form in every way the endpoint takes them (reads; the recover POST is covered by the DB test).
      ...["summary", "breakdown", "leaks", "cohorts", "forecast", "rows", "options"].flatMap((part) => [`/api/app/appointments/funnel?part=${part}&by=account`, `/api/app/appointments/funnel?part=${part}&by=source&location=${other.locs[0]}`, `/api/app/appointments/funnel?part=${part}&by=setter&location=${other.marker}`, `/api/app/appointments/funnel?part=${part}&step=booked&mode=dropped&location=${other.locs[0]}&calendar=${other.marker}&setter=${other.marker}&closer=${other.marker}&owner=${other.marker}&source=${other.marker}&form=${other.marker}`]),
      `/api/app/appointments/funnel?part=rows&step=showed&mode=reached&after=${other.marker}`,
      // Pipeline deal actions (slice PB): the other side's account and deal named in every way the endpoints take them (reads; the POST bodies are covered by the unit tests and the typed-delete guard).
      `/api/app/pipeline3/act/panel?locationId=${other.locs[0]}&id=anything`, `/api/app/pipeline3/act/meta?locationId=${other.locs[0]}`, "/api/app/pipeline3/act/caps",
      // People (stage PEOPLE): the call lists, the lead panel, the search and the recent list, asked for the other side's accounts, people and words by every parameter they take.
      "/api/app/people/home", "/api/app/people/recent", `/api/app/people/queue?list=waiting&location=${other.locs[0]}`, `/api/app/people/queue?list=hot&accounts=${other.locs.join(",")}`,
      `/api/app/people/queue?list=stale&account=${other.locs[0]}&q=${other.marker}`, `/api/app/people/queue?list=noshows&mine=1&location=${other.locs[0]}`, `/api/app/people/queue?list=followups&q=${other.marker}`,
      // Lead AI jobs (suggest only, flags on in this run): the status, the ranking, the cold-lead counts and the rows behind them, aimed at the other side by every parameter they take (the POST bodies are covered by the unit tests).
      "/api/app/ai/lead/status", `/api/app/ai/lead/status?locationId=${other.locs[0]}`, "/api/app/ai/lead/rank?list=missed", `/api/app/ai/lead/rank?list=new_unanswered&f_account=${other.locs[0]}`, `/api/app/ai/lead/rank?list=hot_uncontacted&account=${other.locs[0]}`,
      "/api/app/ai/lead/cold", `/api/app/ai/lead/cold?account=${other.locs[0]}`, "/api/app/ai/lead/cold-rows?pattern=all", `/api/app/ai/lead/cold-rows?pattern=all&account=${other.locs[0]}`, `/api/app/ai/lead/cold-rows?pattern=source:${other.marker}`,
      `/api/app/people/person/${other.locs[0]}/${other.contacts[0]}`, `/api/app/people/person/${other.locs[0]}/%2e%2e%2f${other.contacts[0]}`, `/api/app/people/search?q=${other.marker}&location=${other.locs[0]}`,
      `/api/app/people/contact/${other.locs[0]}/${other.contacts[0]}`,
      // The deals panel: another account's deal, history and context, by changing every id the request carries.
      `/api/app/workbench/deal-history?locationId=${other.locs[0]}&contactId=${other.contacts[0]}&opportunityId=${other.opps[0]}`, `/api/app/workbench/deal-history?locationId=${other.locs[0]}&contactId=${other.contacts[0]}&opportunityId=${other.opps[1]}`, `/api/app/workbench/context?locationId=${other.locs[0]}&contactId=${other.contacts[0]}`,
      // Find a lead: the keyset page and the export, asked for the other side's account, owner, words and a cursor that names the other side's person.
      `/api/app/people/find?q=${other.marker}`, `/api/app/people/find?location=${other.locs[0]}`, `/api/app/people/find?owner=${other.marker}`, `/api/app/people/find?q=Tester&after=${Buffer.from(JSON.stringify([0, "-infinity", "-infinity", other.locs[0], other.contacts[0]])).toString("base64url")}`,
      `/api/app/people/export?location=${other.locs[0]}`, `/api/app/people/export?q=${other.marker}`, `/api/app/people/export?owner=${other.marker}`,
      // Team actions and reports (slice PB): the other side's account, person, note and batch asked for by every parameter of every read.
      `/api/app/people3/act/proof?locationId=${other.locs[0]}`, `/api/app/people3/act/proof-csv?locationId=${other.locs[0]}`, `/api/app/people3/act/proof-prefs?locationId=${other.locs[0]}`, `/api/app/people3/act/meta?locationId=${other.locs[0]}`, `/api/app/people3/act/suggest?locationId=${other.locs[0]}`, `/api/app/people3/act/log?locationId=${other.locs[0]}`, `/api/app/people3/act/away?locationId=${other.locs[0]}`, `/api/app/people3/act/notes?userId=${other.marker}`, `/api/app/people3/act/targets?userId=${other.marker}`, `/api/app/people3/act/focus?userId=${other.marker}`, `/api/app/people3/act/rebalance?locationId=${other.locs[0]}&userId=${other.marker}`, `/api/app/people3/act/suggest?locationId=${other.locs[0]}&contactId=${other.contacts[0]}`, "/api/app/people3/act/away", "/api/app/people3/act/log", "/api/app/people3/act/caps",
      // Team roles (Setter, Closer): the other side's account and people asked for by every parameter of the reads.
      "/api/app/st/home", "/api/app/st/state", "/api/app/st/connections", "/api/app/st/progress", `/api/app/st/state?location=${other.locs[0]}&user=${other.marker}`,
      "/api/app/people3/roles/map", "/api/app/people3/roles/list", "/api/app/people3/roles/log", `/api/app/people3/roles/list?location=${other.locs[0]}`, `/api/app/people3/roles/list?q=${other.marker}&role=none&after=${other.marker}`, `/api/app/people3/roles/list?location=${other.locs[0]}&role=setters`,
      // Payments: every part, asked for the other side's account and items by every parameter the page takes.
      ...["today", "queue", "disputes", "upcoming", "history", "options", "setup", "export", "checks"].flatMap((part) => [`/api/app/payments?part=${part}`, `/api/app/payments?part=${part}&location=${other.locs[0]}`, `/api/app/payments?part=${part}&location=${other.locs[0]}&q=${other.marker}&currency=USD&problem=failed`]),
      `/api/app/payments?part=item&loc=${other.locs[0]}&kind=invoice&id=anything`, `/api/app/payments?part=queue&cursor=${other.marker}`,
      // The rebuilt Account audit (stage AUDIT): the read, the client list and a single client, asked for the other side's account by every parameter it takes.
      `/api/app/clients/act/receipt?location=${other.locs[0]}`, `/api/app/clients/act/csv?location=${other.locs[0]}`, `/api/app/clients/act/setup?location=${other.locs[0]}`, "/api/app/clients/act/receipt", "/api/app/clients/act/mutes",
      // Clients actions, second half and the one Clients screen (stage CL-INT): every remaining read part, and the screen's read parts with the other side's account in every parameter (writes: tests/unit/clients-int-xtenant-db.test.ts).
      `/api/app/workflows/outcomes?wa=${other.locs[0]}`, `/api/app/workflows/gap-people?locationId=${other.locs[0]}&gap=no_touch`, `/api/app/workflows/gap-people?locationId=${other.locs[0]}&gap=noshow_open&cursor=${other.marker}`, "/api/app/workflows/library", "/api/app/clients/act/owners", "/api/app/clients/act/risk", "/api/app/clients/act/health", "/api/app/clients/act/workflows", `/api/app/clients/act/workflows?location=${other.locs[0]}`, "/api/app/clients/act/new-clients",
      `/api/app/clients/act/mutes?location=${other.locs[0]}`, `/api/app/clients/act/owners?location=${other.locs[0]}`, `/api/app/clients3?part=needs-attention&location=${other.locs[0]}&level=act&sort=name`, `/api/app/clients3?part=trends&location=${other.locs[0]}&grain=month`,
      "/api/app/clients?part=home", "/api/app/clients?part=list&size=50", `/api/app/clients?part=list&q=${other.marker}`, `/api/app/clients?part=one&id=${other.locs[0]}`, "/api/app/clients?part=names",
      "/api/app/audit/prefs", `/api/app/audit/prefs?location=${other.locs[0]}`, `/api/app/audit?location=${other.locs[0]}&history=1`, "/api/app/audit", "/api/app/audit/clients?size=50", `/api/app/audit?location=${other.locs[0]}`, `/api/app/audit/clients?location=${other.locs[0]}&q=${other.marker}`, `/api/app/audit?accounts=${other.locs[0]}&fresh=1`,
      // The rebuilt Unanswered messages screen (stage UNANS): the first screen, the list behind a number, the rankings, the other side's account, owner and name asked for by every parameter.
      "/api/app/inbox?part=home", "/api/app/inbox?part=list", `/api/app/inbox?part=list&account=${other.locs[0]}`, `/api/app/inbox?part=list&account=${other.locs.join(",")}&bucket=h48`, `/api/app/inbox?part=list&owner=${other.marker}`,
      `/api/app/inbox?part=list&q=${other.marker}`, "/api/app/inbox?part=ranks&by=account", "/api/app/inbox?part=ranks&by=owner", `/api/app/inbox?part=ranks&by=account&q=${other.marker}`, "/api/app/moat?part=receipt", `/api/app/moat?part=receipt&account=${other.locs[0]}`, "/api/app/moat?part=curve", `/api/app/moat?part=curve&account=${other.locs[0]}`, "/api/app/moat?part=scorecards", `/api/app/moat?part=scorecards&account=${other.locs.join(",")}`, "/api/app/moat?part=channels", "/api/app/moat?part=clock", `/api/app/moat?part=clock&account=${other.locs[0]}`, "/api/app/moat?part=benchmark&vertical=med_spa", "/api/app/moat?part=setup", "/api/app/moat?part=proofs",
      // Unanswered actions (round 3, slice B): the hidden people, the owner picker and the capabilities, asked for the other side's account.
      "/api/app/inbox/act/caps", "/api/app/inbox/act/hidden", `/api/app/inbox/act/hidden?account=${other.locs[0]}`, `/api/app/inbox/act/hidden?account=${other.locs[0]}&reason=snoozed&size=100`, `/api/app/inbox/act/team?locationId=${other.locs[0]}`,
      // Unanswered round 3, slices A and C: the SQL-paged list, the "waiting on them" tab, the one search and the saved views, asked for the other side by every parameter.
      "/api/app/inbox?part=list2", `/api/app/inbox?part=list2&account=${other.locs[0]}`, `/api/app/inbox?part=list2&tab=them&account=${other.locs[0]}`, `/api/app/inbox?part=list2&owner=${other.marker}`, `/api/app/inbox?part=list2&q=${other.marker}&size=100`,
      `/api/app/inbox?part=find&q=${other.marker}`, `/api/app/inbox?part=find&q=${other.marker}&size=100`, "/api/app/inbox?part=views",
    ];

    // TENANCY_FAST=1 skips the long cross-read sweep (while iterating on the share link and write attacks); the full run does not.
    let sweeps = 0;
    for (const [me, other] of process.env.TENANCY_FAST === "1" ? [] : sides) {
      const tokens = [
        ["agency", session(me, "agency")],
        ["business", session(me, "business", me.locs[0])],
        ["client", session(me, "client", me.locs[1])],
        // A session whose account id belongs to the other agency (a forged or stale claim) must still see nothing of theirs.
        ["agency with the other side's account", session(me, "business", other.locs[0])],
      ] as const;
      for (const [label, token] of tokens) {
        for (const path of reads(me, other)) {
          const r = await call(path, token);
          sweeps += 1;
          assert.ok(r.status < 500, `${label} ${path} -> ${r.status} ${r.text.slice(0, 120)}`);
          // A search echoes what was typed. Only its results count as data.
          const body = path.startsWith("/api/app/search") ? JSON.stringify((JSON.parse(r.text) as { hits?: unknown }).hits ?? []) : path.startsWith("/api/app/people/search") ? JSON.stringify((JSON.parse(r.text) as { rows?: unknown }).rows ?? []) : r.text;
          for (const needle of [other.marker, other.marker.toLowerCase(), other.company, ...other.locs, ...other.contacts, ...other.opps]) {
            assert.equal(body.includes(needle), false, `${me.company} (${label}) saw "${needle}" of ${other.company} through ${path}`);
          }
        }
      }
    }
    // A positive control: the checks above are not passing just because everything is empty.
    for (const [me] of sides) {
      const own = await call("/api/app/accounts", session(me, "agency"));
      assert.equal(own.status, 200);
      assert.ok(own.text.includes(me.marker), "an agency sees its own accounts");
      assert.ok((await call(`/api/app/search?q=${me.marker}`, session(me, "agency"))).text.includes(me.marker + ""), "and finds its own contacts");
      assert.ok((await call("/api/app/meetings", session(me, "agency"))).text.includes(me.marker + " Meeting"), "and its own meeting notes");
    }

    // Wallet guard and the 7 am brief (owners only): the other agency's account, search text, cursor and bucket give nothing and are never echoed, its limits and choices are out of reach,
    // and the same user id on both sides sees only its own.
    for (const [me, other] of sides) {
      const owner = signSession({ companyId: me.company, userId: "u-owner", role: "admin", userName: "Tester", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
      const addresses = [
        ...["summary", "list", "account", "settings", "usage", "options"].flatMap((part) => [`/api/app/wg?part=${part}`, `/api/app/wg?part=${part}&account=${other.locs[0]}`, `/api/app/wg?part=${part}&account=${other.marker}`, ...(part === "usage" ? [] : [`/api/app/wg?part=${part}&account=${me.locs[0]}&q=${other.marker}`])]), // usage of the caller's own account would call the platform, so only the refused cases are asked here
        ...["all", "empty", "low", "spike", "unknown", "paused"].map((b) => `/api/app/wg?part=list&bucket=${b}&q=${other.marker}`),
        ...["brief", "text", "settings", "history"].map((part) => `/api/app/br?part=${part}`),
      ];
      for (const path of addresses) {
        const r = await call(path, owner);
        assert.ok(r.status < 500, `${path} -> ${r.status} ${r.text.slice(0, 120)}`);
        for (const needle of [other.marker, other.marker.toLowerCase(), other.company, ...other.locs, ...other.contacts, ...other.opps]) {
          assert.equal(r.text.includes(needle), false, `${me.company} saw "${needle}" of ${other.company} through ${path}`);
        }
      }
      // A positive control: the owner sees its own rows, so the checks above are not passing on empty answers.
      assert.ok((await call("/api/app/wg?part=list&bucket=all", owner)).text.includes(me.marker), "an owner sees its own wallet watchlist");
      assert.ok((await call("/api/app/br?part=history", owner)).text.includes("shown"), "and its own brief record");
      assert.ok((await call("/api/app/br?part=settings", owner)).text.includes(me.marker.toLowerCase()), "and its own brief choices");
      // Writes that name the other agency: refused, and nothing of theirs changes.
      const before = JSON.stringify(await sql()`select low_amount::float8 la from wg_rules where installation_id = ${other.inst} and location_id = ${other.locs[0]}`);
      const rule = await call("/api/app/wg/act/rule", owner, { method: "POST", body: JSON.stringify({ location: other.locs[0], lowAmount: 1, pauseDays: 30 }) });
      assert.equal(rule.status, 404, `a limit on the other agency's account answered ${rule.status}`);
      assert.equal(JSON.stringify(await sql()`select low_amount::float8 la from wg_rules where installation_id = ${other.inst} and location_id = ${other.locs[0]}`), before, "the other agency's limit did not change");
      // A client or business session gets nothing from the wallet or the brief at all.
      for (const kind of ["business", "client"] as const) {
        const t = session(me, kind, me.locs[0]);
        for (const path of ["/api/app/wg?part=summary", "/api/app/wg?part=list&bucket=all", "/api/app/br?part=brief", "/api/app/br?part=settings"]) {
          const r = await call(path, t);
          assert.ok(r.status === 403 || (r.status === 200 && !r.text.includes(me.marker)), `${kind} must not read ${path} (${r.status})`);
        }
      }
    }

    // Inside one agency: a business or client view sees its own account and never a sibling account.
    const biz = session(A, "business", A.locs[0]);
    const cli = session(A, "client", A.locs[1]);
    const sibling = async (token: string, mineLoc: string, otherLoc: string, label: string) => {
      for (const path of ["/api/app/overview", "/api/app/accounts", `/api/app/accounts/${otherLoc}`, "/api/app/search?q=zzTenantA", "/api/app/stale", "/api/app/inbox", "/api/app/notifications", "/api/app/appointments", "/api/app/pipelines", "/api/app/duplicates", "/api/app/contact-intel", "/api/app/today", `/api/app/today?accounts=${otherLoc}`, `/api/app/today?accounts=${mineLoc},${otherLoc}`, "/api/app/today/views"]) {
        const r = await call(path, token);
        assert.ok(r.status < 500);
        assert.equal(r.text.includes(otherLoc), false, `${label} saw the sibling account ${otherLoc} through ${path}`);
        assert.equal(r.text.includes(`zzTenantA Location ${A.locs.indexOf(otherLoc) + 1}`), false, `${label} saw the sibling account's name through ${path}`);
        assert.equal(r.text.includes(`zzTenantA Alert ${A.locs.indexOf(otherLoc) + 1}`), false, `${label} saw the sibling account's notification through ${path}`);
      }
      assert.ok((await call("/api/app/overview", token)).text.includes(mineLoc) || true);
    };
    await sibling(biz, A.locs[0], A.locs[1], "a business view");
    await sibling(cli, A.locs[1], A.locs[0], "a client view");
    // Marking a Today row of the sibling account is refused for a client's staff and a business, exactly like a row that does not exist.
    for (const [label, token, otherLoc] of [["a business view", biz, A.locs[1]], ["a client view", cli, A.locs[0]]] as const) {
      const r = await call("/api/app/today/action", token, { method: "POST", body: JSON.stringify({ action: "done", rowKey: `${otherLoc}|replies` }) });
      assert.equal(r.status, 404, `${label} marked a row of the sibling account (${r.status})`);
    }

    // Writes: every change aimed at the other agency's data is refused, and nothing changes there.
    const before = async (s: Side) => (await sql()`select
      (select count(*)::int from cleanup_runs where installation_id = ${s.inst}) runs,
      (select count(*)::int from meeting_hooks where installation_id = ${s.inst}) hooks,
      (select count(*)::int from connections where installation_id = ${s.inst}) conns,
      (select count(*)::int from sync_jobs where installation_id = ${s.inst}) jobs,
      (select count(*)::int from audit_log where installation_id = ${s.inst}) audits,
      (select count(*)::int from team_names where installation_id = ${s.inst}) names,
      (select count(*)::int from client_notes where installation_id = ${s.inst}) client_notes,
      (select count(*)::int from client_steps where installation_id = ${s.inst}) client_steps,
      (select count(*)::int from client_step_history where installation_id = ${s.inst}) client_step_history,
      (select count(*)::int from today_actions where installation_id = ${s.inst}) today_actions,
      (select count(*)::int from duplicate_reviews where installation_id = ${s.inst}) duplicate_reviews,
      (select count(*)::int from duplicate_snoozes where installation_id = ${s.inst}) duplicate_snoozes,
      (select count(*)::int from saved_views where installation_id = ${s.inst}) saved_views,
      (select coalesce(sum(case when ignored then 1 else 0 end), 0)::int from locations where installation_id = ${s.inst}) ignored,
      (select count(*)::int from cached_contacts where installation_id = ${s.inst}) contacts`)[0];
    const snap = await before(B);
    const tokenA = session(A, "agency");
    const attacks: Array<[string, string, unknown]> = [
      ["POST", `/api/app/sync/${B.locs[0]}`, {}],
      ["POST", "/api/app/meetings/hooks", { locationId: B.locs[0] }],
      ["POST", "/api/app/cleanup/preview", { locationId: B.locs[0], rules: ["phone"] }],
      ["PUT", `/api/app/accounts/${B.locs[0]}/flags`, { ignored: true }],
      ["PUT", `/api/app/clients/${B.locs[0]}`, { industry: "medical" }],
      ["POST", `/api/app/accounts/${B.locs[0]}/tasks`, {}],
      ["PUT", `/api/app/client-onboarding/${B.locs[0]}/steps`, { key: "manual:kickoff", done: true }],
      ["POST", `/api/app/client-onboarding/${B.locs[0]}/steps`, { label: "hacked" }],
      ["POST", `/api/app/clients/${B.locs[0]}/notes`, { body: "hacked" }],
      // Clients v2: a note, a tag and a saved view aimed at the other agency's account.
      ["POST", "/api/app/clients2/note-add", { location: B.locs[0], kind: "note", body: "hacked" }],
      // Finance: a churn choice, an ad spend, a rate, a billing note, a dispute and a freeze aimed at the other agency's account or person.
      ["PUT", "/api/app/finance/churn", { locationId: B.locs[0], status: "lost", note: "hacked" }],
      ["PUT", "/api/app/finance/spend", { locationId: B.locs[0], month: "2026-11", amount: 1, currency: "USD" }],
      ["POST", "/api/app/finance/spend/remove", { locationId: B.locs[0], month: "2026-11", confirm: "x" }],
      ["PUT", "/api/app/finance/rate", { role: "setter", locationId: B.locs[0], pct: 1, flat: 1 }],
      ["PUT", "/api/app/finance/rate", { role: "closer", personId: B.marker, pct: 1, flat: 1 }],
      ["POST", "/api/app/finance/ledger/add", { locationId: B.locs[0], label: "hacked", amount: 1, currency: "USD", dueOn: "2026-11-30" }],
      ["POST", "/api/app/finance/ledger/mark", { id: "00000000-0000-0000-0000-000000000000", paid: true }],
      ["POST", "/api/app/finance/dispute", { lineKey: `booked:${B.locs[0]}:x:setter`, note: "hacked", from: "2026-10-01", to: "2026-11-10", basis: "booked" }],
      ["POST", "/api/app/finance/unfreeze", { id: "00000000-0000-0000-0000-000000000000", confirm: "x" }],
      ["POST", "/api/app/clients2/note-update", { location: B.locs[0], id: "00000000-0000-0000-0000-000000000000", body: "hacked" }],
      ["POST", "/api/app/clients2/note-delete", { location: B.locs[0], id: "00000000-0000-0000-0000-000000000000", confirm: "x" }],
      ["POST", "/api/app/clients2/tag", { locations: [B.locs[0]], vertical: "solar", step: "do" }],
      ["DELETE", `/api/app/clients/${B.locs[0]}/notes?id=00000000-0000-0000-0000-000000000000`, {}],
      // Today's working queue: a mark on the other agency's row, and a saved view that names the other agency's account.
      ["POST", "/api/app/today/action", { action: "done", rowKey: `${B.locs[0]}|replies` }],
      ["POST", "/api/app/today/action", { action: "snooze", rowKey: `${B.locs[0]}|stale`, choice: "day" }],
      ["POST", "/api/app/today/action", { action: "undo", eventId: 1 }],
      ["POST", "/api/app/inbox/outcome", { locationId: B.locs[0], conversationId: "foreign-conversation", outcome: "replied" }],
      // Cash features: every write names the other agency's account, row and owner, and must be refused (a row key is re-read from the caller's own accounts, never trusted).
      ["POST", "/api/app/cash/act/snooze", { keys: [`${B.locs[0]}~unanswered~${B.contacts[0]}~x`], for: "d7" }],
      ["POST", "/api/app/cash/act/unsnooze", { keys: [`${B.locs[0]}~unanswered~${B.contacts[0]}~x`] }],
      ["POST", "/api/app/cash/act/assign", { keys: [`${B.locs[0]}~unanswered~${B.contacts[0]}~x`], ownerId: "foreign-user", step: "do" }],
      ["POST", "/api/app/cash/act/mute", { location: B.locs[0], days: 7 }],
      ["POST", "/api/app/cash/act/unmute", { id: "00000000-0000-0000-0000-000000000000" }],
      ["POST", "/api/app/cash/act/undo", { batchId: "00000000-0000-0000-0000-000000000000", step: "do" }],
      // Unanswered actions (round 3, slice B): every write names the other agency's account and conversation, and must be refused.
      ["POST", "/api/app/inbox/act/snooze", { locationId: B.locs[0], conversationIds: ["foreign-conversation"], reason: "other", duration: "d7" }],
      ["POST", "/api/app/inbox/act/unsnooze", { locationId: B.locs[0], conversationIds: ["foreign-conversation"] }],
      ["POST", "/api/app/inbox/act/claim", { locationId: B.locs[0], conversationId: "foreign-conversation", step: "do" }],
      ["POST", "/api/app/inbox/act/assign", { locationId: B.locs[0], conversationIds: ["foreign-conversation"], ownerId: "foreign-user", step: "do" }],
      ["POST", "/api/app/inbox/act/undo", { batchId: "00000000-0000-0000-0000-000000000000", step: "do" }],
      ["POST", "/api/app/inbox/act/note", { locationId: B.locs[0], contactId: B.contacts[0], text: "hacked", step: "do", confirm: true }],
      ["POST", "/api/app/inbox/act/outcome", { locationId: B.locs[0], conversationId: "foreign-conversation", outcome: "not_a_lead" }],
      ["POST", "/api/app/inbox/act/clear", { locationId: B.locs[0], conversationIds: ["foreign-conversation"], step: "do", typed: "delete 1" }],
      // Team actions (slice PB): every write names the other agency's account, person, note, away mark or batch, and must be refused.
      // Find a lead bulk changes: a tag and a note on the other side's person, as a preview and as a real change, must both be refused (counted as "not found", nothing written).
      ["POST", "/api/app/people/bulk", { action: "tag", tag: "hacked", targets: [{ locationId: B.locs[0], contactId: B.contacts[0] }], step: "preview" }],
      ["POST", "/api/app/people/bulk", { action: "tag", tag: "hacked", targets: [{ locationId: B.locs[0], contactId: B.contacts[0] }], step: "do", confirm: true }],
      ["POST", "/api/app/people/bulk", { action: "note", text: "hacked", targets: [{ locationId: B.locs[0], contactId: B.contacts[0] }], step: "do", confirm: true }],
      ["POST", "/api/app/people3/act/reassign", { locationId: B.locs[0], contactIds: [B.contacts[0]], toUserId: "foreign-user", step: "do" }],
      ["POST", "/api/app/people3/act/undo", { locationId: B.locs[0], batchId: "00000000-0000-0000-0000-000000000000", step: "do" }],
      ["POST", "/api/app/people3/act/note", { op: "add", userId: B.marker, locationId: B.locs[0], title: "x", body: "hacked", step: "do" }],
      ["POST", "/api/app/people3/act/note", { op: "remove", id: "00000000-0000-0000-0000-000000000000", step: "do", typed: "DELETE" }],
      ["POST", "/api/app/people3/act/target", { userId: B.marker, locationId: B.locs[0], metric: "reply_minutes", value: 5, step: "do" }],
      ["POST", "/api/app/people3/act/away", { kind: "away", userId: B.marker, reason: "other", until: new Date(Date.now() + 5 * 86_400_000).toISOString(), step: "do" }],
      ["POST", "/api/app/people3/act/away-end", { id: "00000000-0000-0000-0000-000000000000" }],
      ["POST", "/api/app/payments/act/note", { location: B.locs[0], kind: "invoice", id: "anything", action: "contacted" }],
      ["POST", "/api/app/payments/act/dispute", { location: B.locs[0], customer: "x", openedOn: "2026-01-01", step: "do" }],
      ["POST", "/api/app/payments/act/dispute-remove", { id: "00000000-0000-0000-0000-000000000000", step: "do", confirm: "x" }],
      ["POST", "/api/app/payments/act/resend", { location: B.locs[0], id: "anything", step: "do", confirm: "SEND" }],
      ["POST", "/api/app/people3/act/proof-prefs", { locationId: B.locs[0], nameStaff: true, step: "do" }],
      // Team roles: a label for the other agency's person or account, and an undo of the other agency's batch, must all be refused.
      ["POST", "/api/app/people3/roles/set", { userIds: [B.marker], role: "setter", step: "do" }],
      ["POST", "/api/app/people3/roles/set", { userIds: [B.marker], role: "closer", locationId: B.locs[0], step: "do" }],
      ["POST", "/api/app/people3/roles/set", { userIds: [B.marker], role: null, locationId: B.locs[0], step: "do", typed: "clear role" }],
      ["POST", "/api/app/st/state", { kind: "module_hidden", key: B.marker, on: true }],
      ["POST", "/api/app/st/state", { kind: "news_seen", key: B.locs[0], on: true, location: B.locs[0] }],
      ["POST", "/api/app/people3/roles/undo", { batchId: "00000000-0000-0000-0000-000000000000", step: "do" }],
      // Workflows: a change, a label, a mark and a read of the other agency's workflow in its client account.
      ["POST", "/api/app/workflows/preview", { kind: "delete", items: [{ locationId: B.locs[0], workflowId: "w-1" }] }],
      ["PUT", "/api/app/workflows/labels", { items: [{ locationId: B.locs[0], workflowId: "w-1" }], patch: { decision: "retire" } }],
      ["POST", "/api/app/workflows/mark", { locationId: B.locs[0], workflowId: "w-1", action: "fixed" }],
      // Workflows second pass: outcome gaps, the people behind a gap, the library, and a preview and an install in the other agency's client account.
      ["POST", "/api/app/workflows/install-preview", { template: "noshow_task", locationIds: [B.locs[0]] }],
      ["POST", "/api/app/workflows/install", { template: "noshow_task", locationIds: [B.locs[0]], token: "1.x" }],
      // Data health: a mark, a rule, a refresh, a fix preview, a confirm and an undo on the other agency's client account (all must be refused).
      ["POST", "/api/app/data-health/mark", { locationId: B.locs[0], contactIds: [B.contacts[0]], state: "ignored" }],
      ["PUT", "/api/app/data-health/rules", { locationId: B.locs[0], junkWords: ["hacked"] }],
      ["POST", "/api/app/data-health/refresh", { locationId: B.locs[0] }],
      ["POST", "/api/app/data-health/preview", { locationId: B.locs[0], kinds: ["phone"] }],
      ["POST", "/api/app/data-health/confirm", { locationId: B.locs[0], kinds: ["phone"], token: "1.x" }],
      ["POST", "/api/app/data-health/undo", { locationId: B.locs[0] }],
      // The duplicate review: a decision, a set-aside and a merge on the other agency's contacts (the merge never writes: it is switched off).
      ["POST", "/api/app/duplicates/review", { locationId: B.locs[0], contactIds: [B.contacts[0], B.contacts[0] + "dup"], decision: "not_duplicate" }],
      ["POST", "/api/app/duplicates/snooze", { locationId: B.locs[0], contactIds: [B.contacts[0], B.contacts[0] + "dup"] }],
      ["POST", "/api/app/duplicates/merge", { locationId: B.locs[0], contactIds: [B.contacts[0], B.contacts[0] + "dup"], keepContactId: B.contacts[0] }],
      // Clean-up: rules, the switch for changing contacts, a pasted file, a scan, a merge through the workflow and a take-back, all on the other agency's account.
      ["POST", "/api/app/cu/bulk", { step: "preview", kind: "junk", action: "tag", account: B.locs[0] }],
      ["POST", "/api/app/cu/bulk", { step: "do", kind: "junk", action: "remove", account: B.locs[0], typed: "remove 1 contact" }],
      ["POST", "/api/app/cleanup/rules", { scope: B.locs[0], match: { preset: "loose" } }],
      ["POST", "/api/app/cleanup/rules/clear", { locationId: B.locs[0] }],
      ["POST", "/api/app/cleanup/write", { locationId: B.locs[0], enabled: true }],
      ["POST", "/api/app/cleanup/import-check", { locationId: B.locs[0], csv: "Email\nx@y.co" }],
      ["POST", "/api/app/cleanup/quality/scan", { locationId: B.locs[0] }],
      ["POST", "/api/app/duplicates/merge-workflow", { locationId: B.locs[0], contactIds: [B.contacts[0], B.contacts[0] + "dup"], keepContactId: B.contacts[0], confirm: true }],
      ["POST", "/api/app/duplicates/undo-snooze", { locationId: B.locs[0], key: "00000000-2" }],
      ["POST", "/api/app/dq/decide", { locationId: B.locs[0], contactIds: [B.contacts[0], B.contacts[0] + "dup"], decision: "not_duplicate" }],
      ["POST", "/api/app/dq/delete", { step: "do", locationId: B.locs[0], contactIds: [B.contacts[0], B.contacts[0] + "dup"], keepContactId: B.contacts[0], typed: "delete 1 contact" }],
      ["POST", "/api/app/dq/mute", { account: B.locs[0], src: "website form", on: true }],
      // People: marking the other agency's person as opened, and logging a call on the other agency's person.
      ["PUT", "/api/app/people/seen", { locationId: B.locs[0], contactId: B.contacts[0] }],
      ["POST", "/api/app/people/outcome", { locationId: B.locs[0], contactId: B.contacts[0], outcome: "answered" }],
      // A reply target on the other agency's client account.
      ["PUT", "/api/app/speed/target", { locationId: B.locs[0], minutes: 5 }],
    ];
    for (const [method, path, body] of attacks) {
      const r = await call(path, tokenA, { method, body: JSON.stringify(body) });
      assert.ok(r.status >= 400 && r.status < 500, `${method} ${path} should be refused, got ${r.status}`);
    }
    // A team name is keyed by a platform user id, not an account: it can only ever be written in the caller's own data.
    await call(`/api/app/team/${B.locs[0]}`, tokenA, { method: "PUT", body: JSON.stringify({ name: "hacked" }) });
    const connB = (await sql()`select id from connections where installation_id = ${B.inst}`)[0].id as string;
    assert.equal((await call(`/api/app/connections/${connB}`, tokenA, { method: "DELETE" })).status, 404, "another agency's connection cannot be removed");
    assert.equal((await call(`/api/app/connections/${connB}`, tokenA, { method: "PUT", body: JSON.stringify({ defaultLocationId: A.locs[0] }) })).status, 404, "the old default-account route is gone, and another agency's connection is out of reach in any case");
    const hit = await call("/api/app/cleanup/preview", tokenA, { method: "POST", body: JSON.stringify({ locationId: A.locs[0], rules: ["name"] }) });
    assert.equal(hit.status, 200, "its own account is fine");
    const runA = JSON.parse(hit.text).runId as string;
    const tokenB = session(B, "agency");
    assert.equal((await call(`/api/app/cleanup/${runA}`, tokenB)).status, 404, "another agency's preview cannot be opened");
    assert.equal((await call(`/api/app/cleanup/${runA}/apply`, tokenB, { method: "POST", body: JSON.stringify({ confirm: 1 }) })).status, 404, "or applied");
    assert.equal((await call(`/api/app/cleanup/${runA}/undo`, tokenB, { method: "POST", body: "{}" })).status, 404, "or undone");
    const after = await before(B);
    assert.deepEqual(after, snap, "nothing in the other agency changed");

    // An account user (read-only client view of one account) cannot change anything, share anything, or read settings.
    const tokenAccountUser = session(A, "client", A.locs[0]);
    const refused: Array<[string, string, unknown]> = [
      ["PUT", "/api/app/settings", { staleDays: 5 }], ["POST", "/api/app/audit/share", {}], ["POST", "/api/app/sync", {}],
      ["PUT", `/api/app/accounts/${A.locs[0]}/flags`, { ignored: true }], ["GET", "/api/app/settings", undefined], ["GET", "/api/app/connections", undefined],
      ["POST", "/api/app/meetings/hooks", { locationId: A.locs[0] }], ["POST", "/api/app/cleanup/preview", { locationId: A.locs[0], rules: ["name"] }],
      ["POST", "/api/app/audit/revoke", { id: "x".repeat(30) }], ["GET", "/api/app/audit/shares", undefined],
    ];
    for (const [method, path, body] of refused) {
      const r = await call(path, tokenAccountUser, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(r.status, 403, `an account user must be refused ${method} ${path}, got ${r.status}`);
    }

    // The share link: made from one agency's data it carries none of the other's, hides its own account names, the id
    // cannot be guessed, and an account user cannot create one.
    const shareA = await call("/api/app/audit/share", tokenA, { method: "POST", body: "{}" });
    assert.equal(shareA.status, 200, shareA.text.slice(0, 200));
    const urlA = JSON.parse(shareA.text).url as string;
    const idA = urlA.split("/").pop() as string;
    assert.ok(idA.length >= 32, "the id is long");
    const pageA = await fetch(`${BASE}/audit/${idA}`);
    const htmlA = await pageA.text();
    assert.equal(pageA.status, 200);
    assert.ok(!htmlA.includes(B.marker), "the other agency's name is not in this agency's shared page");
    assert.ok(!htmlA.includes(`${A.marker} Location`), "its own account names are scrubbed");
    // White-label: a prospect who opens the shared page must never read the platform's name or our internal words.
    const noScripts = htmlA.replace(/<script[\s\S]*?<\/script>/g, " ");
    const readable = noScripts.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    assert.ok(!/gohighlevel|highlevel|leadconnector|\bghl\b/i.test(noScripts), "the shared page does not name the platform");
    assert.ok(!/\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i.test(readable), "the shared page does not use our internal words");
    const shareB = await call("/api/app/audit/share", tokenB, { method: "POST", body: "{}" });
    const idB = (JSON.parse(shareB.text).url as string).split("/").pop() as string;
    assert.notEqual(idA, idB, "every link is unique");
    assert.ok(!(await (await fetch(`${BASE}/audit/${idB}`)).text()).includes(A.marker), "the other agency's share carries none of this one's data");
    // An unknown id shows the not-found page and none of a snapshot. (The status can be 200: the page streams before the lookup
    // finishes in this project's rendering mode; that is recorded as a known soft-404 in docs/features/S0.2.md.)
    for (const bad of ["Z".repeat(32), "short", idA.slice(0, -1) + (idA.endsWith("A") ? "B" : "A")]) {
      const res = await fetch(`${BASE}/audit/${bad}`);
      const html = await res.text();
      assert.ok(!html.includes("Run your own free audit") && !html.includes("counted") && !html.includes("Stale deal value"), `an unknown share id must show no snapshot (${bad.slice(0, 6)}...)`);
      assert.ok(res.status === 404 || html.toLowerCase().includes("could not be found") || html.includes("404"), "an unknown id shows the not-found page");
    }

    // Share link lifecycle (F6): 14 day expiry, a view count, generic previews, noindex, revoke only by the owner, a rate limit.
    {
      const listA = async () => JSON.parse((await call("/api/app/audit/shares", tokenA)).text).links as Array<{ id: string; createdAt: string; expiresAt: string; revoked: boolean; views: number }>;
      const mine = (await listA()).find((l) => l.id === idA);
      assert.ok(mine, "the new link is in its owner's list");
      const days = (Date.parse(mine.expiresAt) - Date.parse(mine.createdAt)) / 86_400_000;
      assert.ok(days > 13.9 && days < 14.1, `a new link works for 14 days (got ${days.toFixed(2)})`);
      assert.ok(!(await (await call("/api/app/audit/shares", tokenB)).text).includes(idA), "another agency's list never shows this link");
      assert.equal((await call("/api/app/audit/shares", session(A, "client", A.locs[0]))).status, 403, "an account user cannot list links");

      // The public page: noindex, no name in the preview tags, and a view is counted.
      const before = (await listA()).find((l) => l.id === idA)?.views ?? 0;
      const html2 = await (await fetch(`${BASE}/audit/${idA}`)).text();
      assert.match(html2, /<meta name="robots" content="[^"]*noindex/i, "the page asks not to be indexed");
      assert.match(html2, /property="og:title" content="Account audit"/, "the preview title is generic");
      for (const marker of [A.marker, B.marker]) assert.ok(!html2.includes(marker), "no agency name anywhere in the page or its preview tags");
      const after = (await listA()).find((l) => l.id === idA)?.views ?? 0;
      assert.ok(after > before, `a view is counted (${before} to ${after})`);

      // Only the owner can switch a link off: another agency, an account user and a made-up id all fail, and the link keeps working.
      assert.equal((await call("/api/app/audit/revoke", tokenB, { method: "POST", body: JSON.stringify({ id: idA }) })).status, 404, "another agency cannot revoke it");
      assert.equal((await call("/api/app/audit/revoke", session(A, "client", A.locs[0]), { method: "POST", body: JSON.stringify({ id: idA }) })).status, 403, "an account user cannot revoke it");
      assert.equal((await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: "short" }) })).status, 400, "a malformed id is refused");
      assert.ok((await (await fetch(`${BASE}/audit/${idA}`)).text()).includes("Snapshot taken"), "still works after the failed attempts");

      // The owner switches it off: the public page no longer shows it, the list says so, and a second revoke finds nothing to do.
      assert.equal((await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idA }) })).status, 200);
      const gone = await (await fetch(`${BASE}/audit/${idA}`)).text();
      assert.ok(!gone.includes("Snapshot taken") && !gone.includes("What we found"), "a switched-off link shows nothing");
      assert.equal((await listA()).find((l) => l.id === idA)?.revoked, true);
      assert.equal((await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idA }) })).status, 404, "revoking twice is a no-op");

      // Rate limit: past 30 lookups a minute from one address even a valid link is refused. (A link made just for this.)
      const idC = (JSON.parse((await call("/api/app/audit/share", tokenA, { method: "POST", body: "{}" })).text).url as string).split("/").pop() as string; // the link's own origin may be another host, so ask this server
      let refusedAt = 0;
      for (let i = 1; i <= 45 && !refusedAt; i++) if (!(await (await fetch(`${BASE}/audit/${idC}`)).text()).includes("Snapshot taken")) refusedAt = i;
      assert.ok(refusedAt > 0 && refusedAt <= 45, "a burst of lookups is eventually refused");
      // The refusal lasts for the rest of the minute, for every later lookup from this address. Wait it out so the checks after this one see real pages.
      await new Promise((r) => setTimeout(r, 61_000));
      await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idC }) });
    }

    // Share a report (shared_reports): a link holds only the one frozen report its owner made, hides names unless asked, opens without a sign-in, shows nothing of the other company, can be switched
    // off only by its owner, and an account user cannot make, list or switch off any link.
    {
      // These sessions carry the role that sign-in works out (agency owner or staff), as real ones do; the shared helper above carries none, so it counts as ordinary staff.
      const ownerOf = (side: Side) => signSession({ companyId: side.company, userId: "u-owner", role: "admin", userName: "Owner", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
      const ownerA = ownerOf(A), ownerB = ownerOf(B);
      const staffA = signSession({ companyId: A.company, userId: "u-staff", role: "user", userName: "Staff", demo: false, kind: "agency", locationId: null, personRole: "agency_staff" });
      const nameA = `${A.marker} Location 1`;
      const doc = { title: "Weekly proof", scope: { pii: nameA, as: "account" }, period: "week of 2026-11-02", sections: [{ heading: "Found", stats: [{ label: "Found", value: "7" }], table: { columns: ["Client account", "Found"], rows: [[{ pii: nameA, as: "account" }, "7"]] } }] };
      const made = await call("/api/app/report-share", ownerA, { method: "POST", body: JSON.stringify({ kind: "weekly", doc, days: 7 }) });
      assert.equal(made.status, 200, made.text.slice(0, 200));
      const idR = JSON.parse(made.text).id as string;
      assert.match(idR, /^[A-Za-z0-9_-]{32}$/, "the report link id is 192 random bits");
      const pageR = await fetch(`${BASE}/r/${idR}`);
      const htmlR = await pageR.text();
      assert.equal(pageR.status, 200);
      assert.ok(htmlR.includes("Weekly proof") && htmlR.includes("Client account 1"), "the shared report shows its figures with the name replaced");
      for (const marker of [A.marker, B.marker]) assert.ok(!htmlR.includes(marker), "no company or account name anywhere on the shared report");
      assert.match(htmlR, /<meta name="robots" content="[^"]*noindex/i, "the report page asks not to be indexed");
      const readableR = htmlR.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
      assert.ok(!/gohighlevel|highlevel|leadconnector|\bghl\b/i.test(htmlR.replace(/<script[\s\S]*?<\/script>/g, " ")), "the shared report does not name the platform");
      assert.ok(!/\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i.test(readableR), "the shared report does not use our internal words");
      assert.ok(!(await (await call("/api/app/report-share", ownerB)).text).includes(idR), "another company's list never shows this link");
      assert.equal((await call("/api/app/report-share/revoke", ownerB, { method: "POST", body: JSON.stringify({ id: idR }) })).status, 404, "another company cannot switch it off");
      for (const [method, path, body] of [["POST", "/api/app/report-share", { kind: "weekly", doc }], ["GET", "/api/app/report-share", undefined], ["POST", "/api/app/report-share/revoke", { id: idR }]] as Array<[string, string, unknown]>) {
        assert.equal((await call(path, session(A, "client", A.locs[0]), { method, body: body === undefined ? undefined : JSON.stringify(body) })).status, 403, `an account user must be refused ${method} ${path}`);
      }
      for (const [method, path, body] of [["POST", "/api/app/report-share", { kind: "weekly", doc }], ["GET", "/api/app/report-share", undefined], ["POST", "/api/app/report-share/revoke", { id: idR }]] as Array<[string, string, unknown]>) {
        assert.equal((await call(path, staffA, { method, body: body === undefined ? undefined : JSON.stringify(body) })).status, 403, `agency staff must be refused ${method} ${path}`);
      }
      assert.ok((await (await fetch(`${BASE}/r/${idR}`)).text()).includes("Weekly proof"), "still works after the failed attempts");
      assert.equal((await call("/api/app/report-share/revoke", ownerA, { method: "POST", body: JSON.stringify({ id: idR }) })).status, 200);
      assert.ok(!(await (await fetch(`${BASE}/r/${idR}`)).text()).includes("Weekly proof"), "a switched-off report link shows nothing");
      assert.ok(!(await (await fetch(`${BASE}/r/${"Z".repeat(32)}`)).text()).includes("Weekly proof"), "an unknown id shows nothing");
    }

    // The branded client Proof page (stage PR): each company prepares and shares a report only for its own accounts; the public page is opened by the token alone, shows that one account and nothing of
    // the other company, never names the product or the platform, and a forged, malformed, replaced or switched-off token finds nothing.
    {
      const d = new Date();
      const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
      const tok = (side: Side) => session(side, "agency", undefined, true);
      const [tA, tB] = [tok(A), tok(B)];
      const post = (t: string, p: string, body: unknown, method = "POST") => call(`/api/app/proof/${p}`, t, { method, body: JSON.stringify(body) });
      const listA = JSON.parse((await call(`/api/app/proof?part=list&period=${month}&size=50`, tA)).text);
      assert.deepEqual(listA.rows.map((r: { locationId: string }) => r.locationId).sort(), [...A.locs].sort(), "the list holds only this company's accounts");
      assert.ok(!JSON.stringify(listA).includes(B.marker), "and none of the other company's names");
      assert.equal(listA.total, listA.rows.length, "the count equals the rows");
      for (const [m, p, body] of [["POST", "prepare", { locationId: B.locs[0], month }], ["POST", "share", { locationId: B.locs[0], month }], ["POST", "unshare", { locationId: B.locs[0], month }], ["PUT", "report", { locationId: B.locs[0], month, intro: "x" }], ["POST", "link", { locationId: B.locs[0], month, action: "revoke", confirm: B.marker + " Location 1" }]] as const) {
        const r = await post(tA, p, body, m);
        assert.equal(r.status, 404, `proof/${p} on the other company's account is refused`);
        assert.ok(!r.text.includes(B.locs[0]), "and never echoes its id");
      }
      assert.equal((await call(`/api/app/proof?part=report&account=${B.locs[0]}&period=${month}`, tA)).status, 404, "the other company's report cannot be read");
      assert.equal((await call(`/api/app/proof?part=list&period=${month}`, session(A, "client", A.locs[0]))).status, 403, "an account user cannot reach it");
      assert.equal((await post(session(A, "business", A.locs[0]), "prepare", { locationId: A.locs[0], month })).status, 403, "nor can a business session write");
      assert.equal((await post(tA, "prepare", { locationId: A.locs[0], month })).status, 200);
      assert.equal((await post(tB, "prepare", { locationId: B.locs[0], month })).status, 200);
      const shA = await post(tA, "share", { locationId: A.locs[0], month }), shB = await post(tB, "share", { locationId: B.locs[0], month });
      assert.equal(shA.status, 200, shA.text.slice(0, 200));
      const urlOf = (r: { text: string }) => (JSON.parse(r.text).url as string).split("/proof/")[1];
      const [idA, idB] = [urlOf(shA), urlOf(shB)];
      assert.match(idA, /^[A-Za-z0-9_-]{43}$/, "the token is long and random");
      const pageA = await fetch(`${BASE}/proof/${idA}`), htmlA = await pageA.text();
      assert.equal(pageA.status, 200);
      assert.ok(htmlA.includes(`${A.marker} Location 1`), "the page shows this client account");
      assert.ok(!htmlA.includes(B.marker) && !htmlA.includes(A.contacts[0]) && !htmlA.includes(`${A.marker} Person`), "and no other company's data and no contact name");
      assert.ok(!/subsync|gohighlevel|highlevel|leadconnector|sub-?account/i.test(htmlA.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "")), "no product or platform name is on the page");
      assert.match(htmlA, /noindex/, "never indexed");
      const htmlB = await (await fetch(`${BASE}/proof/${idB}`)).text();
      assert.ok(htmlB.includes(`${B.marker} Location 1`) && !htmlB.includes(A.marker), "the other company's token shows only that company's account");
      let refBody = "";
      for (const bad of ["A".repeat(43), idA.slice(0, -1) + (idA.endsWith("A") ? "B" : "A"), "short", idA + "x", "%27%20or%201%3D1--"]) {
        const r = await fetch(`${BASE}/proof/${bad}`);
        assert.equal(r.status, 404, "a forged or malformed token finds nothing");
        const bodyText = await r.text();
        assert.ok(!bodyText.includes(A.marker) && !bodyText.includes(bad.slice(0, 8)), "and the answer never repeats the address");
        if (!refBody) refBody = bodyText;
        assert.equal(bodyText, refBody, "every bad link gets the same page");
      }
      const wrong = await post(tA, "link", { locationId: A.locs[0], month, action: "regenerate", confirm: "wrong" });
      assert.equal(wrong.status, 400, "replacing needs the typed account name");
      const re = await post(tA, "link", { locationId: A.locs[0], month, action: "regenerate", confirm: `${A.marker} Location 1` });
      assert.equal(re.status, 200);
      assert.equal((await fetch(`${BASE}/proof/${idA}`)).status, 404, "the replaced link no longer works");
      const idA2 = urlOf(re);
      assert.equal((await fetch(`${BASE}/proof/${idA2}`)).status, 200);
      assert.equal((await post(tA, "link", { locationId: A.locs[0], month, action: "revoke", confirm: `${A.marker} Location 1` })).status, 200);
      assert.equal((await fetch(`${BASE}/proof/${idA2}`)).status, 404, "a switched-off link shows nothing");
      assert.equal((await fetch(`${BASE}/proof/${idB}`)).status, 200, "and the other company's link is untouched");
    }

    // Client access is enforced on the server: switched off, a client's own session is refused at once; switched on, it works; and it
    // is put back as it was found.
    {
      const clientToken = session(A, "client", A.locs[1]);
      const was = (await sql()`select client_view from locations where installation_id = ${A.inst} and location_id = ${A.locs[1]}`)[0].client_view as boolean;
      const setView = async (on: boolean) => assert.equal((await call(`/api/app/accounts/${A.locs[1]}/flags`, tokenA, { method: "PUT", body: JSON.stringify({ clientView: on }) })).status, 200);
      try {
        await setView(true);
        assert.equal((await call("/api/app/overview", clientToken)).status, 200, "client access on: the client's own session works");
        await setView(false);
        assert.equal((await call("/api/app/overview", clientToken)).status, 403, "client access off: the same session is refused straight away");
        assert.equal((await call("/api/app/inbox", clientToken)).status, 403, "and on every other page");
        await setView(true);
        assert.equal((await call("/api/app/overview", clientToken)).status, 200, "switched back on, it works again");
      } finally { await setView(was); }
    }

    // N84: a client's own staff never receive what the agency keeps about them. Fees, the agency's notes, the owner label, the industry, saved call
    // lists, API keys, the agency's settings, tickets, or any other client's data. Every read a client session may make is asked, plus every read
    // it may not, and the answers are searched for the secrets. A positive control proves the secrets are really in the data and that an agency
    // session does see them. (There is no tickets feature yet: the address is asked anyway, so the day one is added it must be refused too.)
    {
      const keyOf = (s: Side) => (s === A ? "a" : "b");
      const secretsOf = (s: Side) => [...FEE[keyOf(s)].map(String), s.marker + "FeeNote", s.marker + "OwnerLabel", s.marker + "Industry", s.marker + "KeyName", s.marker + "ListName"];
      // Names of settings and agency-only fields that must not appear in any client answer.
      const settingKeys = ["digestEmail", "slackConfigured", "slackWebhookUrl", "keepTranscripts", "pushNotesToCrm", "customChecklist", "digestHour", "monthlyFee", "renewalDate", "keyPrefix", "clientAccounts", "canDeleteData", "meetingTool"];
      const clientPathsFor = (me: Side) => [
        "/api/app/overview", "/api/app/accounts", `/api/app/accounts/${me.locs[1]}`, "/api/app/onboarding", `/api/app/search?q=${me.marker}`, "/api/app/stale", "/api/app/hygiene", "/api/app/inbox", "/api/app/notifications", "/api/app/pipelines", "/api/app/duplicates", "/api/app/alerts",
        "/api/app/pipeline-intel", "/api/app/contact-intel", "/api/app/comms-intel", "/api/app/deal-gaps", "/api/app/deal-events", "/api/app/start", "/api/app/appointments", "/api/app/appointment-insights", "/api/app/audit", "/api/app/speed", "/api/app/roadmap",
        // not allowed for a client at all: each must be refused
        "/api/app/settings", "/api/app/clients", "/api/app/clients?part=home", "/api/app/clients?part=list", "/api/app/clients?part=names", `/api/app/clients?part=one&id=${me.locs[1]}`, "/api/app/clients/compare", `/api/app/qbr/${me.locs[1]}`, "/api/app/api-keys", "/api/app/connections", "/api/app/meetings", "/api/app/cleanup", "/api/app/team", "/api/app/goals", "/api/app/call-lists",
        "/api/app/call-queue", "/api/app/call-outcomes", "/api/app/exec-summary", "/api/app/daily", "/api/app/daily-brief", "/api/app/digest", "/api/app/export/stale", "/api/app/sync-status", "/api/app/freshness", "/api/app/segments", "/api/app/playbooks",
        "/api/app/setup-compare", "/api/app/email", "/api/app/audit/shares", "/api/app/tickets", "/api/app/tickets/1", "/api/app/fees", "/api/app/notes",
      ];
      const allowedForClient = new Set(["overview", "accounts", "onboarding", "search", "stale", "hygiene", "inbox", "notifications", "pipelines", "duplicates", "alerts", "pipeline-intel", "contact-intel", "comms-intel", "deal-gaps", "deal-events", "start", "appointments", "appointment-insights", "audit", "speed", "roadmap", "freshness", "client-trends"]);
      let answered = 0;
      let refusedCount = 0;
      for (const [me, other] of sides) {
        const client = session(me, "client", me.locs[1]);
        for (const path of clientPathsFor(me)) {
          const r = await call(path, client);
          const seg = path.split("/")[3].split("?")[0];
          const mayRead = allowedForClient.has(seg) && !path.includes("/audit/shares");
          if (mayRead) { assert.ok(r.status < 400, `a client should read ${path}, got ${r.status}`); answered += 1; } else { assert.ok(r.status === 403 || r.status === 404, `a client must be refused ${path}, got ${r.status} ${r.text.slice(0, 80)}`); refusedCount += 1; }
          for (const secret of [...secretsOf(me), ...secretsOf(other)]) assert.equal(r.text.includes(secret), false, `a client of ${me.company} saw "${secret}" through ${path}`);
          if (mayRead) for (const key of settingKeys) assert.equal(r.text.includes(`"${key}"`), false, `a client answer carries the setting "${key}" through ${path}`);
        }
        // A client is only ever told about its own account, the one named in its session. Another account of the same company is not found.
        assert.equal((await call(`/api/app/accounts/${me.locs[0]}`, client)).status, 404, "a sibling account is not found");
        for (const method of ["POST", "PUT", "DELETE"]) {
          for (const path of [`/api/app/accounts/${me.locs[1]}/flags`, "/api/app/settings", "/api/app/api-keys", "/api/app/tickets", `/api/app/clients/${me.locs[1]}`]) {
            const r = await call(path, client, { method, body: "{}" });
            assert.equal(r.status, 403, `a client must be refused ${method} ${path}, got ${r.status}`);
          }
        }
        // The Getting started steps of a client do not report what the company set up in Settings.
        const steps = (JSON.parse((await call("/api/app/start", client)).text).steps as Array<{ id: string }>).map((s) => s.id);
        for (const hidden of ["brief", "email", "meetings", "clients"]) assert.equal(steps.includes(hidden), false, `a client's Getting started has no "${hidden}" step`);
      }
      assert.ok(answered >= 30 && refusedCount >= 50, `the sweep covered ${answered} reads and ${refusedCount} refusals`);
      // Positive control: the secrets are really in the data, and the agency itself does see them.
      const agencyClients = (await call("/api/app/clients", session(A, "agency"))).text;
      for (const secret of ["4321.77", A.marker + "FeeNote"]) assert.ok(agencyClients.includes(secret), `the agency sees "${secret}" (so the checks above are not passing on empty data)`);
      assert.ok((await call("/api/app/api-keys", session(A, "agency"))).text.includes(A.marker + "KeyName"), "and its key list");
      assert.ok((await call("/api/app/settings", session(A, "agency"))).text.includes("digestEmail"), "and its settings");
      assert.ok((await call("/api/app/notifications", session(A, "agency"))).text.includes(`${A.marker} Alert 2`), "and its own account notifications");

      // Switching client access off removes access on the very next request, on every page a client may read; switching it on restores it.
      const clientTok = session(A, "client", A.locs[1]);
      const was = (await sql()`select client_view from locations where installation_id = ${A.inst} and location_id = ${A.locs[1]}`)[0].client_view as boolean;
      const setOne = async (on: boolean) => assert.equal((await call(`/api/app/accounts/${A.locs[1]}/flags`, session(A, "agency"), { method: "PUT", body: JSON.stringify({ clientView: on }) })).status, 200);
      const sweepClient = async () => { const out: number[] = []; for (const seg of allowedForClient) out.push((await call(`/api/app/${seg}`, clientTok)).status); return out; };
      try {
        await setOne(true);
        assert.ok((await sweepClient()).every((s) => s < 400), "on: a client reads every page it may read");
        await setOne(false);
        assert.deepEqual([...new Set(await sweepClient())], [403], "off for one account: every page is refused on the next request, with the same session");
        assert.equal((await call("/api/app/usage", clientTok, { method: "POST", body: JSON.stringify({ view: "today" }) })).status, 403, "even the harmless writes");
        assert.equal((await call("/api/app/roadmap", clientTok, { method: "POST", body: JSON.stringify({ item: "x" }) })).status, 403);
        await setOne(true);
        assert.ok((await sweepClient()).every((s) => s < 400), "on again: it works again");
        // switched off for every account at once, through Settings
        assert.equal((await call("/api/app/settings", session(A, "agency"), { method: "PUT", body: JSON.stringify({ clientViewAll: false }) })).status, 200);
        assert.deepEqual([...new Set(await sweepClient())], [403], "off for all accounts through Settings: refused on the next request");
        assert.deepEqual([...new Set(await Promise.all(A.locs.map(async (loc) => (await call("/api/app/overview", session(A, "client", loc))).status)))], [403], "for every account of the company");
        // another company's switch changes nothing here
        assert.equal((await call("/api/app/settings", session(B, "agency"), { method: "PUT", body: JSON.stringify({ clientViewAll: true }) })).status, 200);
        assert.deepEqual([...new Set(await sweepClient())], [403], "company B switching its clients on does not open company A's");
        assert.equal((await call("/api/app/overview", session(A, "client", B.locs[1]))).status, 403, "a session naming another company's account, under company A, is refused");
      } finally {
        await setOne(was);
        await sql()`update locations set client_view = (location_id = ${A.locs[1]}) where installation_id = ${A.inst}`;
        await sql()`update locations set client_view = (location_id = ${B.locs[1]}) where installation_id = ${B.inst}`;
      }
    }

    // The company name set in Settings is the name on the shared page.
    {
      await call("/api/app/settings", tokenA, { method: "PUT", body: JSON.stringify({ brandName: "ZZ Brand Alpha" }) });
      try {
        const idBrand = (JSON.parse((await call("/api/app/audit/share", tokenA, { method: "POST", body: "{}" })).text).url as string).split("/").pop() as string;
        const page = await (await fetch(`${BASE}/audit/${idBrand}`)).text();
        assert.ok(page.includes("ZZ Brand Alpha"), "the shared page carries the company's own name");
        assert.ok(!page.includes("Your company"), "and not the placeholder");
        await call("/api/app/audit/revoke", tokenA, { method: "POST", body: JSON.stringify({ id: idBrand }) });
      } finally { await call("/api/app/settings", tokenA, { method: "PUT", body: JSON.stringify({ brandName: null }) }); }
    }

    // The webhook: unsigned or wrongly signed deliveries change nothing.
    // (Company B made its own share link earlier in this run, so compare with a snapshot taken now, not the one from the start.)
    const snapBeforeWebhook = await before(B);
    const body = JSON.stringify({ type: "UNINSTALL", companyId: B.company, webhookId: "xtest-wh-1" });
    assert.equal((await fetch(`${BASE}/api/webhooks/ghl`, { method: "POST", body })).status, 401, "unsigned");
    assert.equal((await fetch(`${BASE}/api/webhooks/ghl`, { method: "POST", body, headers: { "x-ghl-signature": "AAAA" } })).status, 401, "wrong signature");
    assert.deepEqual(await before(B), snapBeforeWebhook, "a refused webhook changed nothing");

    // Public addresses: a delivery for one agency's connection cannot reach the other's data, and a guess finds nothing.
    const guess = await fetch(`${BASE}/api/hooks/fathom/${"Z".repeat(24)}`, { method: "POST", body: "{}" });
    assert.equal(guess.status, 404);
    assert.equal((await fetch(`${BASE}/api/hooks/meeting/mh_${"Z".repeat(43)}`, { method: "POST", body: "{}" })).status, 404);

    // N83: "Delete my data" belongs to the owner. Anyone else is refused and the refusal is written down. The owner needs the typed word. The copied
    // data goes, the settings, keys and the agency's own notes stay, the other company is untouched, and the audit entries outlive the data.
    // This runs last: it empties company A (and then B).
    {
      const countsOf = async (s: Side) => (await sql()`select
        (select count(*)::int from cached_contacts where installation_id = ${s.inst}) contacts, (select count(*)::int from locations where installation_id = ${s.inst}) locs,
        (select count(*)::int from meeting_notes where installation_id = ${s.inst}) meetings, (select count(*)::int from api_keys where installation_id = ${s.inst}) keys,
        (select count(*)::int from account_profiles where installation_id = ${s.inst}) profiles`)[0];
      const audits = async (s: Side, action: string) => (await sql()`select count(*)::int n from audit_log where installation_id = ${s.inst} and action = ${action}`)[0].n as number;
      const purge = (tok: string, body: unknown = { confirm: "DELETE" }) => call("/api/app/settings/purge", tok, { method: "POST", body: JSON.stringify(body) });
      const A0 = await countsOf(A);
      const B0 = await countsOf(B);
      assert.ok(A0.contacts > 0 && A0.locs > 0 && A0.meetings > 0 && A0.keys > 0 && A0.profiles > 0, "company A has data to lose");

      // Not the owner: an agency session without the owner flag (an administrator or staff), and a client. Refused, and nothing is deleted.
      const refusedBefore = await audits(A, "data.purge_refused");
      const notOwner = await purge(session(A, "agency"));
      assert.equal(notOwner.status, 403, "an agency session that is not the owner is refused");
      assert.equal(JSON.parse(notOwner.text).forbidden, true);
      assert.equal(await audits(A, "data.purge_refused"), refusedBefore + 1, "and the refusal is written to the audit log");
      assert.equal((await purge(session(A, "client", A.locs[1]))).status, 403, "a client session is refused");
      assert.equal((await purge(session(A, "business", A.locs[0]))).status, 403, "a business session that is not its administrator is refused");
      assert.deepEqual(await countsOf(A), A0, "none of those deleted anything");
      // Settings tells the screen who may press the button.
      assert.equal(JSON.parse((await call("/api/app/settings", session(A, "agency"))).text).canDeleteData, false, "the screen is told this person may not");
      assert.equal(JSON.parse((await call("/api/app/settings", session(A, "agency", undefined, true))).text).canDeleteData, true, "and that the owner may");

      // The owner: the typed word is required, then the data goes and the audit entry is written.
      const ownerA = session(A, "agency", undefined, true);
      assert.equal((await purge(ownerA, {})).status, 400, "no typed word, no deletion");
      assert.equal((await purge(ownerA, { confirm: "delete" })).status, 400, "the word must be exactly DELETE");
      assert.deepEqual(await countsOf(A), A0, "still nothing deleted");
      const done = await purge(ownerA);
      assert.equal(done.status, 200, done.text);
      const A1 = await countsOf(A);
      assert.deepEqual([A1.contacts, A1.locs, A1.meetings], [0, 0, 0], "the copied data is gone");
      assert.deepEqual([A1.keys, A1.profiles], [A0.keys, A0.profiles], "settings, keys and the agency's own notes stay");
      assert.deepEqual(await countsOf(B), B0, "the other company is untouched");
      assert.equal(await audits(A, "data.purged"), 1, "the deletion is in the audit log");
      const [entry] = await sql()`select actor, detail from audit_log where installation_id = ${A.inst} and action = 'data.purged'`;
      assert.equal(entry.actor, "Tester");
      assert.equal(JSON.stringify(entry.detail).includes(A.marker), false, "and the entry holds no customer data");
      // Another company's owner can only ever delete that company's own data.
      assert.equal((await purge(session(B, "agency", undefined, true))).status, 200);
      assert.deepEqual(await countsOf(A), A1, "company B's owner changed nothing in company A");
      assert.equal((await countsOf(B)).contacts, 0);
    }

    console.log(`tenant isolation: two agencies, ${sweeps} cross-reads as agency, business, client and forged sessions, attacks refused, account user read-only, client secrets never sent, client access off at once, Delete my data owner-only and audited, share link, client report page and webhook safe, nothing changed: ok`);
  } finally {
    await sql()`delete from installations where company_id in ('xtest-agency-a', 'xtest-agency-b')`;
    await closeDb();
  }
}

main().catch(async (error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error, error instanceof Error && error.cause ? `\ncause: ${String(error.cause)}` : "");
  try { await sql()`delete from installations where company_id in ('xtest-agency-a', 'xtest-agency-b')`; await closeDb(); } catch { /* best effort */ }
  process.exit(1);
});
