# Regression audit: what the rebuilt screens lost, and where it is now (11 Nov 2026)

Rule going forward: a revamp adds, never removes (see `docs/SCREEN_CHECKLIST.md`). A guard test, `tests/unit/required-sections.test.ts`, fails when a listed section leaves its source file.
Status words: **restored** (was missing, now back in the new module), **still present** (checked, nothing lost), **needs King approval** (cannot be restored cheaply or was removed on purpose).
Checked with all flags on. Only reading and code review so far; the restored tabs are not yet checked in a browser (CHECK).

## Gaps found and restored

| Module | Feature | Was where | Now where | Status |
|---|---|---|---|---|
| Pipeline | Forecast, pipeline coverage, open pipeline over time, stages and bottlenecks, deals most at risk, aging, wins and losses by month, abandoned and dead pipeline, compare accounts, every pipeline, Export open deals CSV | `pipeline.tsx` (tab "Forecast and stages") | `pl3/module.tsx` tab "Forecast and stages" renders `PipelineView` | restored |
| Pipeline | Recent deal movement (stage moves, wins, losses) | `people.tsx` DealMoves, shown under "Forecast and stages" until the Nov 3 simplify cut | `pl3/module.tsx` tab "Forecast and stages", below the cards | restored |
| Pipeline | Stale deals by threshold, open deals by stage, Export stale CSV | `deals.tsx` (tab "Stale deals and hygiene") | `pl3/module.tsx` tab "Stale deals and hygiene" renders `DealsView` | restored |
| Appointments | True show rate card, outcome chart, target range, Copy a summary, Print this page, Open the call lists, How-to | `appointments.tsx` (tab "Appointments") | `ap3/module.tsx` tab "Show rate and lists" renders `AppointmentsView` | restored |
| Appointments | Insights: calendar health, lead to customer funnel, best times to book (heat map), repeat no-shows, show rate by source, booking speed, reminders and confirmations, who gets the appointments, appointment worth, follow-up gaps, double bookings, briefs for next appointments | `appointment-insights.tsx` (tab "Insights") | `ap3/module.tsx` tab "Insights" renders `AppointmentInsights` | restored |
| Clients | Client book: who may leave, renewals coming, fees, health per client, open a client page | `clients/book.tsx` (tab "Clients") | `cl3/module.tsx` tab "Client book" renders `BookTab` (opens the account page) | restored |
| Clients | Old Compare (scores, setups, trend) | `clients/compare.tsx` | `cl3/module.tsx` tab "Compare clients" | restored |
| Clients | Old weekly client reports | `clients/reports-tab.tsx` | `cl3/module.tsx` tab "Weekly reports" | restored |
| Clients | Export fees and renewals (CSV, `export/clients`) | Clients header | `cl3/module.tsx` header button "Export fees and renewals" (next to the new Export CSV) | restored |
| Team | Owner table: open deals and value, won value, stale deals, win rate, reply pace, show rate, rename a person | `people.tsx` TeamView | `pp3/module.tsx` tab "Pipeline owners" renders `TeamView` (not shown to a person viewing only their own numbers) | restored |
| Find a lead | Cohorts by month, Best leads to work now, Your most valuable contacts, New contacts per week, Growth by account, Do not disturb, Birthdays in the next 30 days (the `LeadsView part="more"` piece was never mounted after the People rebuild) | `leads.tsx` | `people-module.tsx` tab "More about your leads" | restored |
| Speed to lead | "When to be told" link to who is told and when (Alerts), and the printable digest preview with Copy and Print for a client | `speed-insights.tsx` AlertsTab, old Rules tab | `speed-coverage.tsx` RulesTab, under the Rules tab "More" (with the routing check and proof report) | restored |

## Checked, nothing lost (still present)

| Module | Feature | Where it is now | Status |
|---|---|---|---|
| Speed to lead | Race, Pace (old Journey, Booking, Pace cards kept as `old`), Coverage, Unanswered tab, Call mode, People or Owners (old kept), Capture, Rules (target, ladder, digest, routing, proof report), Log, Copy, Print, change target, how-to | `speed.tsx`, `speed6-*.tsx` | still present |
| Unanswered messages | Copy summary, Print, CSV download, change reply target, how-to, cost formula, who is waiting, where it waits. The control room (`inbox_control_room`) replaces the old screen; the old screen stays in `inbox.tsx` | `unanswered-room.tsx`, `inbox.tsx` | still present. Two small notes of the old screen (reading-limit note, unread note) are now both in the control room (`unanswered-room.tsx`: the reading limit was already there; the unread note was added, test id `wait-unread-note`): restored |
| Find a lead | Contact search, five call lists, tags with the day, going cold, sources, imports, data quality | `people-find.tsx`, `people-more.tsx` | still present |
| Find a lead | Old Call lists page: log a call and "Call this person now" (`calls.tsx`) | no longer mounted | restored: `people-module.tsx` tab "Call lists" renders `CallsView` (King: nothing old is removed) |
| Find a lead | Old Contact search page with timeline (`search.tsx`) | the Find tab and the lead panel carry the timeline | still present (functionally) |
| Account audit | Where to start, share links, copy summary, print, run again, clients to look at first | `audit.tsx` | still present |
| Clean-up | Duplicates, Fix lists, Health (old data health kept under "More data health tools"), Data quality, History, Rules | `cleanup-hub.tsx` | still present |
| Settings | Every older section (team, notifications, targets, brand, privacy, sync, advanced) is drawn inside the hub; Integrations became Connections | `settings-hub.tsx` | still present |
| Pipeline (new) | Overview, Money flow, Needs attention, Won and lost, People, Sources, Stage history, Accounts, Proof, Slipping | `pl3/` | still present |

## Overview (old page, folded into Today > Numbers). Parts to relocate (Today owner)

`overview.tsx` and `exec-summary.tsx` still exist in the tree; the menu entry is hidden when Overview is merged. Everything below must be reachable from Today > Numbers:
1. Executive summary card with goals ("Set goals", Save goals; deals won, new contacts, revenue won per month) and "Today's priorities" with Open buttons (`exec-summary.tsx`).
2. Stale deal value tile and "Waiting past your reply target" tile, and the other overview metric tiles (`data-testid="overview-metric"`).
3. Note about open deals left out of every dollar figure (excluded deals: closed-out stage, pipeline not in use, no value or no owner).
4. "Needs attention" list (with the empty state "Nothing needs attention").
5. "Account health" bar: Thriving, Healthy, Watch, At risk (counts open the accounts) and the "All accounts" button.
6. "Print summary" button.
7. "Sync now" (or "Refresh insights" in demo) button.
8. The reading-limit note (`data-testid="read-limit"`).

## Needs King approval (summary)

1. (done) Call lists page with call logging: back as the tab "Call lists" in Find a lead.
2. (done) Unanswered control room: the unread note is added; the reading limit was already there.

## Not done in this pass

- No browser check of the restored tabs (code and type check only). Each restored tab embeds the earlier component, whose own page heading is hidden visually (screen-reader only) so there is one heading.
- The earlier page-level filters of the new modules are hidden on the restored tabs (Pipeline, Appointments) because the earlier views bring their own dates.


## Today and Overview (fix for PR #33, 11 Nov 2026)

PR #33 put the older Today charts behind a small "More numbers" link on a tab. That hid them. Now nothing is behind a link: the older Today is back in full under the new top of the Today tab, and Numbers is the full dashboard.

| Module | Feature | Was where | Now where | Status |
|---|---|---|---|---|
| Today | Do this first queue (reply list, or one row per client), "Where the work sits" bars, "This week" reply-time line and figures, "Since you were last here", insights, held items, My day (calls, appointments) | old Today page (`today-page.tsx`) | Today tab, section "More about today" (`td3/module.tsx` renders `TodayView mode="below"`) | restored |
| Today | Break it down tabs: Forecast, Proof, People, Sources, Coverage, Growth, Lead flow, Clients coming and going | old Today, "Break it down" | still in "More about today" (`MoreDetail`), and each is also a card on Numbers | restored |
| Today | More menu (Daily email preview, Print report, Share Today, Sync now, Saved views, Commands) and the command palette | old Today header | same, in "More about today" (title row only hides the duplicate "Today" word) | restored |
| Today | Old one-sentence headline and its primary button | old Today | replaced by the new What to do today block (same job, ranked) | kept as "The older one-sentence summary" under the new block, in "More about today" | restored |
| Overview | Executive summary, Stale deal value and Waiting tiles, excluded-deals note, Needs attention list, Account health bar, Print summary, Sync now | `overview.tsx` | Numbers, card "Accounts at a glance" (`<OverviewView>`, agency) | restored |
| Numbers | Growth, lead flow (Where do my leads go?), sources, forecast, coverage, people, clients coming and going, pipeline, where the work sits | old Today tabs, Pipeline | Numbers dashboard cards (`today-dash.tsx`), one dates bar for all, accounts from the bar at the top | restored |


## Speed to lead and the sweep (12 Nov 2026)

King said the extra breakdown in Speed to lead was gone. The cards were in the code, but the "Fold" that wraps Pace, People, Coverage, Capture, Rules, Call mode and Log showed only the first 3 cards and hid the rest behind a "More" button (and hid any card that said "no data yet"). That looked like removed breakdowns.

| Module | Feature | Was where | Now where | Status |
|---|---|---|---|---|
| Speed to lead | Every card on Pace, People, Coverage, Capture, Rules, Call mode, Log (histograms, reasons, velocity, ready-to-act, who was slow, person table, sources, routing, proof report) | all cards shown before the 6 Nov "keep calm" Fold | all cards open by default; "Fewer" and "More" stay as the user's choice | restored |
| Speed to lead | Cards that only said "needs more data" | hidden with a note | the note now has a "See them" button | restored |
| Speed to lead | Lead journey step table and drop-offs under the river view | animated flow, steps and drop-off buckets | "See breakdown" table under the river view (flag lead_journey_pro), each count opens the people | restored |
| Speed to lead | Required-sections guard | none for the new cards | `tests/unit/required-sections.test.ts` lists Fold, Pace cards, journey breakdown and the Log sections | added |

Other modules (Clients, Pipeline, Appointments, Payments, Team, Meetings, Find a lead, Calls): checked their module tabs and sections against the manifest in `tests/unit/required-sections.test.ts`; none uses a card-hiding wrapper like Speed's Fold. Today is handled in a separate change.

Booking funnel and animations (12 Nov 2026, same PR): the funnel's step bars and drop-off basins already had click handlers, but the list they opened was drawn at the very bottom of the page, so a click looked dead. It now opens in the side panel on top. Basins and bars have a pointer cursor, hover underline and keyboard (Enter, Space); the picture is clipped to its box so nothing runs off the right edge. The "not enough leads" rule now starts at 10 leads (was 30) and names the real count. The lead journey river now finds the ribbon under the finger on the tap itself, so touch works without a hover first, and the cursor is a pointer over a ribbon. Race counts are real buttons already.

## Money, Today fixes (round 5, 12 Nov 2026)

Money: Payments and Finance are ONE menu item "Money" (entry id `payments`; `finance` is its other address and keeps its own entry only while Payments is off). Nothing was removed; only the duplicate menu entry is hidden. Where each part went:

| From | Part | Now in |
|---|---|---|
| Finance | Overview (plans a month, what moved, at risk), Client revenue, Churn watch, headline strip "Money today" | Money > Plans and churn |
| Payments | Upcoming > "From your clients (estimate)" (what the plans bring a month) | Money > Plans and churn (shown once; hidden from Upcoming when inside Money) |
| Payments | Today, Recovery queue, Disputes, Upcoming (rest), History, Setup, Export CSV | Money > Client payments |
| Finance | Payouts (and "My payouts" for non-managers), Billing notes, Setup | Money > Payouts |

Old addresses: #payments opens Client payments, #finance opens Plans and churn; links inside Money switch the top tab when the target tab lives in the other group. Guard: `tests/unit/required-sections.test.ts` (new Money block).

Not deduplicated beyond the plans card: Finance Overview still shows its own "plans a month" figure (a different calculation from Finance data); both stay until King confirms which to keep.

Today: Try again now sends a new request (never joins a stuck one), shows progress and stops after 3 presses; the Reply / Open buttons on Today open the person inside SubSync (lead panel with a smaller "Open in your CRM"); Today > Settings shows an at-a-glance strip and a clear Saved state.
