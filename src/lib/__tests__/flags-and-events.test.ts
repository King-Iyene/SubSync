import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES } from "../entitlements.ts";
import { DEFAULT_OFF, resolveFeatures } from "../flags-core.ts";
import { NAV, visibleNav } from "../../app/app/nav.ts";
import { NAV_FOR } from "../access.ts";
import { diffAppointmentEvents } from "../sync/appointment-events.ts";

test("pilot modules are on by default and a database row can still override the default", () => {
  const f = resolveFeatures(FEATURES, {});
  assert.equal(f.ai, true);
  assert.equal(resolveFeatures(FEATURES, { ai: false }).ai, false, "a database row still switches it off without a deploy");
  for (const on of ["overview", "search", "inbox", "appointments", "calls", "alerts", "pipelines", "stale", "onboarding", "settings", "health", "connections", "setup_compare", "playbooks", "builder", "clients", "activity", "ai", "cleanup", "duplicates", "reports", "team", "meetings", "workflows", "data_health"] as const) assert.equal(f[on], true, on);
  // Zoom and Google Meet stay hidden everywhere until a pilot asks for them. Optional unanswered-message add-ons also remain individually gated.
  // Unanswered Messages Round 2 (docs/features/UNANSWERED2.md): each behind its own flag, default off.
  assert.deepEqual([...DEFAULT_OFF].sort(), [
    "ap_exec",
    "ap_exec_targets",
    "appt_actions",
    "appt_booking_share",
    "appt_bulk",
    "appt_calendars",
    "appt_delete",
    "appt_flow_tree",
    "appt_health",
    "appt_history",
    "appt_meetings",
    "appt_module",
    "appt_needs_outcome",
    "appt_noshow_recovery",
    "appt_overview",
    "appt_proof",
    "appt_record",
    "appt_reminders",
    "appt_sources",
    "au_history",
    "au_monthly",
    "au_onepager",
    "br_brief",
    "br_email",
    "br_record",
    "cf_deals",
    "cf_email",
    "cf_record",
    "cf_recover",
    "cf_save",
    "cl2_account_page",
    "cl2_accounts",
    "cl2_bulk",
    "cl2_notes",
    "cl2_plans",
    "cl2_team_move",
    "cl3_apps",
    "cl3_history",
    "cl3_money",
    "cl_actions",
    "cl_attention",
    "cl_billing",
    "cl_compare",
    "cl_module",
    "cl_onboarding",
    "cl_overview",
    "cl_people",
    "cl_reports",
    "cl_retention",
    "cl_rollup",
    "cl_setup",
    "cl_trends",
    "cl_workflows",
    "cu_bulk",
    "cu_confirm",
    "cu_fix",
    "cu_health",
    "fl_bulk",
    "fl_find",
    "inbox_assign",
    "inbox_ball_in_court",
    "inbox_breach_alert",
    "inbox_bulk",
    "inbox_channel_mix",
    "inbox_claim",
    "inbox_clear_junk",
    "inbox_control_room",
    "inbox_digest",
    "inbox_filters",
    "inbox_hide_noise",
    "inbox_keys",
    "inbox_note",
    "inbox_open_lead",
    "inbox_outcome_ui",
    "inbox_per_client_sla",
    "inbox_proof_email",
    "inbox_quiet",
    "inbox_reply_target",
    "inbox_search",
    "inbox_snooze",
    "inbox_sql_aggregates",
    "inbox_views",
    "inbox_wait_clock",
    "inbox_working_hours",
    "inbox_workload",
    "lead_journey_pro",
    "moat_alert_feedback",
    "moat_benchmark",
    "moat_curve",
    "moat_proof_page",
    "moat_receipt",
    "moat_record",
    "moat_scorecards",
    "ov_screen",
    "pl_actions",
    "pl_attention",
    "pl_bulk",
    "pl_delete",
    "pl_forecast",
    "pl_health",
    "pl_history",
    "pl_module",
    "pl_money_flow",
    "pl_overview",
    "pl_people",
    "pl_proof",
    "pl_record",
    "pl_sources",
    "pl_stage_history",
    "pl_won_lost",
    "pm_disputes",
    "pm_module",
    "pm_recovery",
    "pm_resend",
    "pm_upcoming",
    "pp_access",
    "pp_actions",
    "pp_coaching",
    "pp_idle",
    "pp_leaderboard",
    "pp_module",
    "pp_money",
    "pp_nextlead",
    "pp_proof",
    "pp_roles",
    "pp_rollup",
    "pp_scorecards",
    "pp_today",
    "pp_workload",
    "st_guides",
    "st_news",
    "st_settings",
    "td_email",
    "td_module",
    "td_numbers",
    "td_proof",
    "td_record",
    "td_today",
    "wf_bulk",
    "wf_library",
    "wf_outcomes",
    "wf_today",
    "wg_alerts",
    "wg_record",
    "wg_wallet",
    "zoom_meet",
  ]);
  assert.equal(f.meetings, true);
  assert.equal(f.workflows, true);
  assert.equal(f.data_health, true);
  assert.equal(f.zoom_meet, false);
  assert.ok([...DEFAULT_OFF].every((x) => (FEATURES as readonly string[]).includes(x)), "every switched-off name is a real feature");
});

test("a database row beats the default in both directions, and FLAGS_ALL_ON only changes defaults", () => {
  const on = resolveFeatures(FEATURES, { meetings: true, inbox: false });
  assert.equal(on.meetings, true, "a row can switch a deferred feature on");
  assert.equal(resolveFeatures(FEATURES, { reports: true }).reports, true, "a row can restore a hidden screen");
  assert.equal(on.zoom_meet, false, "and only that one");
  assert.equal(on.inbox, false, "or a normal one off");
  const all = resolveFeatures(FEATURES, { inbox: false }, true);
  assert.equal(all.cleanup, true, "all-on turns the deferred ones on");
  assert.equal(all.inbox, false, "but a row still wins");
  assert.equal(resolveFeatures(FEATURES, { notAFeature: false }).overview, true, "an unknown key changes nothing");
});

test("the production pilot menu keeps all modules available to every authorized role", () => {
  const after = resolveFeatures(FEATURES, {});
  const count = (kind: keyof typeof NAV_FOR, features: Record<string, boolean>) =>
    visibleNav(NAV_FOR[kind], { limited: kind !== "agency", off: (feature) => features[feature] === false }).length;
  assert.deepEqual(
    { agency: count("agency", after), business: count("business", after), client: count("client", after) },
    { agency: 15, business: 15, client: 15 },
    "Unanswered messages is a tab of Speed to lead now, and Data health is a tab of Clean-up (it stays in a client account user's menu, which has no Clean-up), so each menu is shorter; a client account user also sees Team, limited to their own numbers",
  );
  // Speed to lead off: the Unanswered screen is not lost, its own entry comes back.
  for (const kind of ["agency", "business", "client"] as const) {
    const ids = visibleNav(NAV_FOR[kind], { limited: kind !== "agency", off: (f) => f === "speed" }).map((n) => n.id);
    assert.ok(ids.includes("inbox") && !ids.includes("speed"), `${kind}: Speed is off, so Unanswered keeps its own entry`);
    const on = visibleNav(NAV_FOR[kind], { limited: kind !== "agency", off: () => false }).map((n) => n.id);
    assert.ok(!on.includes("inbox") && on.includes("speed"), `${kind}: with Speed on there is no separate Unanswered entry`);
  }
  assert.equal(NAV.filter((item) => item.id === "team").length, 1, "the Team screen remains in the navigation model");
});

test("appointment history: first sight, status changes and moves are recorded; the first sync records nothing", () => {
  const known = new Map([
    ["a1", { status: "confirmed", startAt: Date.parse("2026-11-02T10:00:00Z") }],
    ["a2", { status: "confirmed", startAt: Date.parse("2026-11-02T11:00:00Z") }],
    ["a3", { status: null, startAt: Date.parse("2026-11-02T12:00:00Z") }],
  ]);
  const incoming = [
    { id: "a1", status: "showed", startAt: Date.parse("2026-11-02T10:00:00Z") },
    { id: "a2", status: "confirmed", startAt: Date.parse("2026-11-03T11:00:00Z") },
    { id: "a3", status: null, startAt: Date.parse("2026-11-02T12:00:20Z") },
    { id: "a4", status: "new", startAt: Date.parse("2026-11-04T09:00:00Z") },
  ];
  const events = diffAppointmentEvents(incoming, known, true);
  assert.deepEqual(events.map((e) => `${e.id}:${e.kind}`), ["a1:status", "a2:time", "a4:created"]);
  assert.deepEqual(events[0], { id: "a1", kind: "status", from: "confirmed", to: "showed", startAt: Date.parse("2026-11-02T10:00:00Z") });
  assert.equal(events[1].from, "2026-11-02T11:00:00.000Z");
  assert.equal(events[1].to, "2026-11-03T11:00:00.000Z");
  assert.deepEqual(diffAppointmentEvents(incoming, new Map(), false), [], "the first read of an account says nothing about when anything was booked");
  assert.deepEqual(diffAppointmentEvents(incoming, known, true), diffAppointmentEvents(incoming, known, true), "same input, same output");
  assert.deepEqual(diffAppointmentEvents(incoming.slice(0, 1).map((a) => ({ ...a, status: "confirmed" })), known, true), [], "no change, no event");
});
