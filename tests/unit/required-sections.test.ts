import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A revamp adds, never removes (docs/SCREEN_CHECKLIST.md). This manifest lists the sections of every screen that existed before a rebuild: a tab label, a card title,
// a test id or a mounted component, each of which must stay in its source file. The test FAILS when a listed string disappears. To remove one on purpose, King must approve it
// and the removal must be listed in docs/REGRESSION_AUDIT.md first; only then may it leave this list.
const V = "src/app/app/views";
type Req = { file: string; has?: string[]; anyOf?: string[] };
const MANIFEST: Record<string, Req[]> = {
  "Today (old front page)": [
    { file: `${V}/today-page.tsx`, has: ['id="where-h"', "MoreDetail", "Forecast", "Proof", "People", "Sources", "Coverage", "Growth", "Lead flow", "Clients coming and going"] },
    // The new Today module must still render the old Today (TodayView or TodayPage), never replace it.
    { file: `${V}/td3/module.tsx`, anyOf: ["<TodayView", "<TodayPage"] },
    { file: `${V}/td3/module.tsx`, has: ["More about today", 'mode="below"', 'mode="dashboard"', "td-below", "DatesBar"] },
    { file: `${V}/today-dash.tsx`, has: ["New leads and growth", "How fast we answer", "Where do my leads go?", "Appointments", "What goes wrong if nothing changes", "<PipelineView", "Where leads come from", "Which hours miss leads", "Where the work sits", "People", "Clients coming and going", "Accounts at a glance", "<OverviewView"] },
  ],
  "Overview (old page, folded into Today > Numbers; its parts must exist and be reachable)": [
    { file: `${V}/overview.tsx`, has: ["Print summary", "Sync now", "Needs attention", "Account health", "Stale deal value", "Waiting past your reply target", "ExecSummary", "excludedDeals"] },
    { file: `${V}/exec-summary.tsx`, has: ["Executive summary", "Today's priorities", "Set goals"] },
  ],
  "Speed to lead": [
    { file: `${V}/speed.tsx`, has: ['label: "Race"', 'label: "Pace"', 'label: "Coverage"', 'label: "Unanswered"', 'label: "Call mode"', 'label: "People"', 'label: "Capture"', 'label: "Rules"', 'label: "Log"', "Copy a summary", '"Print"'] },
    { file: `${V}/speed-coverage.tsx`, has: ["<RoutingCard", "<ProofReport", "<AlertsTab", "Missed calls nobody called back", "Lost at night and at weekends", "Best time to call or reply"] },
    { file: `${V}/speed-insights.tsx`, has: ["When to be told", "The digest, as a preview"] },
  ],
  "Unanswered messages": [
    { file: `${V}/inbox.tsx`, has: ["Download the list (CSV)", "Copy a summary", "WaitList", "WaitedSection", "WhereSection"] },
    { file: `${V}/unanswered-room.tsx`, has: ["export/inbox", "Copy a summary", 'data-testid="tab-us"', 'data-testid="tab-them"'] },
  ],
  Appointments: [
    { file: `${V}/ap3/module.tsx`, has: ['label: "Overview"', 'label: "Needs outcome"', 'label: "No-show recovery"', 'label: "Booking share"', 'label: "Flow tree"', 'label: "Account health"', 'label: "Sources and speed"', 'label: "Calendars and people"', 'label: "Meetings"', 'label: "Proof"', 'label: "Show rate and lists"', 'label: "Insights"', "<AppointmentsView", "<AppointmentInsights"] },
    { file: `${V}/appointments.tsx`, has: ["Copy a summary", "Print this page", "Open the call lists", "True show rate"] },
    { file: `${V}/appointment-insights.tsx`, has: ["Calendar health", "From lead to customer", "Best times to book", "Repeat no-shows", "Show rate by lead source", "How fast leads get booked", "Reminders and confirmations", "Who gets the appointments", "What an appointment is worth", "No follow-up after the appointment", "Double bookings", "Before your next appointments"] },
  ],
  "Pipeline and deals": [
    { file: `${V}/pl3/module.tsx`, has: ['label: "Overview"', 'label: "Money flow"', 'label: "Needs attention"', 'label: "Won and lost"', 'label: "People"', 'label: "Sources"', 'label: "Stage history"', 'label: "Accounts"', 'label: "Proof"', 'label: "Slipping"', 'label: "Forecast and stages"', 'label: "Stale deals and hygiene"', "<PipelineView", "<DealsView", "<DealMoves"] },
    { file: `${V}/pipeline.tsx`, has: ["Pipeline coverage", "Open pipeline over time", "Stages, bottlenecks and conversion", "Deals most at risk", "How old is the pipeline", "Wins and losses by month", "Abandoned deals worth reopening", "Dead pipeline to clean up", "Compare client accounts", "Every pipeline", "Export open deals"] },
    { file: `${V}/deals.tsx`, has: ["Export CSV", "Open deals by stage, all accounts", "export/stale"] },
  ],
  Clients: [
    { file: `${V}/cl3/module.tsx`, has: ['"Overview"', '"Money"', '"Accounts"', '"Needs attention"', '"Trends"', '"Compare accounts"', '"Reports"', '"Setup health"', '"Health and risk"', '"Onboarding"', '"Reviews (QBR)"', '"Industries"', '"Client book"', '"Compare clients"', '"Weekly reports"', "<BookTab", "<CompareTab", "<ReportsTab", "export/clients"] },
    { file: `${V}/clients/index.tsx`, has: ["Reviews (QBR)", "Health and risk", "Export CSV"] },
  ],
  Team: [
    { file: `${V}/pp3/module.tsx`, has: ['"Today"', '"Scorecards"', '"Workload"', '"Leaderboard"', '"Money"', '"Coaching"', '"Access"', '"Proof"', '"Roles"', '"Pipeline owners"', "<TeamView"] },
    { file: `${V}/people.tsx`, has: ["Recent deal movement", "Contact timeline", "Unassigned"] },
  ],
  "Find a lead (People, Contact search, Leads, Call lists)": [
    { file: `${V}/people-module.tsx`, has: ["Find and call", '"Tags"', '"Going cold"', '"Sources"', "More about your leads", 'part="more"'] },
    { file: `${V}/leads.tsx`, has: ["Contact lifecycle", "Working leads: who has engaged", "Lead cohorts", "Best leads to work now", "Your most valuable contacts", "New contacts per week", "Growth by account", "Contact data quality", "Where leads come from", "Do not disturb", "Birthdays in the next 30 days", "Large imports", "Cold lists"] },
    { file: `${V}/people-more.tsx`, has: ['part="cold"', 'part="sources"'] },
  ],
  "Account audit": [
    { file: `${V}/audit.tsx`, has: ["Run the audit again", "Copy a summary", '"Print"', "Your share links", "Clients to look at first", "Share a link with a client"] },
  ],
  "Clean-up (duplicates, data quality)": [
    { file: `${V}/cleanup-hub.tsx`, has: ['duplicates: "Duplicates"', 'fix: "Fix lists"', 'health: "Health"', 'quality: "Data quality"', 'history: "History"', 'rules: "Rules"', "<DuplicatesView", "legacyHealth"] },
  ],
  Settings: [
    { file: `${V}/settings-hub.tsx`, has: ["<SettingsView embedded"] },
    { file: `${V}/settings.tsx`, has: ["Thresholds", "Speed to lead", "Unanswered alert escalation", "Your name on reports", "What we store", "Delete my data", "Onboarding checklist", "Meeting notes privacy"] },
  ],
};

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

describe("required screen sections (a revamp adds, never removes)", () => {
  for (const [module, reqs] of Object.entries(MANIFEST)) {
    describe(module, () => {
      for (const r of reqs) {
        it(`${r.file} keeps its listed sections`, () => {
          const src = read(r.file);
          const missing = (r.has ?? []).filter((s) => !src.includes(s));
          expect(missing, `Removed from ${r.file} (list it in docs/REGRESSION_AUDIT.md with King's approval, or put it back): ${missing.join(" | ")}`).toEqual([]);
          if (r.anyOf) expect(r.anyOf.some((s) => src.includes(s)), `${r.file} must still contain one of: ${r.anyOf.join(" | ")}`).toBe(true);
        });
      }
    });
  }
});
