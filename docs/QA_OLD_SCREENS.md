# QA: old screens behind the sidebar (stage MN, 11 Nov 2026)

Method: dev server on the sample (demo) data with all flags on (`FLAGS_ALL_ON=true`) and with the default flags, every sidebar entry opened by its address, first screen read as text (heading, tabs, loading and empty states), a few screens looked at in a browser at 1280 dark (Speed to lead, Workflows, Clients, Meeting notes at 1280 and 390), plus a read of what `dashboard.tsx` renders for each entry. The browser console and the dev server log were read for errors.

Limits (be honest): the dev link to the database is slow (15 to 60 s for a first screen, other builders share it), so most screens were read as text and not walked tab by tab, light mode and 768 were not walked, and nothing here was checked on real data. Account audit, Settings, Getting started, Team, Pipeline and Payments were opened and read, not clicked through.

## What each sidebar entry shows

| Entry | Renders | New or old | Verdict |
|---|---|---|---|
| Today | `TodayModule` (td3), old `TodayView` only while `td_module` is off | new | fine |
| Speed to lead | `SpeedView` (own tabbed module with a tour) | new | fine |
| Appointments | `AppointmentsModule` (11 tabs), old two-tab screen while `appt_module` is off | new | fine |
| Clients | `ClientsModule` (cl3): 7 new tabs, then four older pages (Health and risk, Onboarding, Reviews (QBR), Industries) | mixed | works; see "Left" |
| Payments | `PaymentsModule` | new | fine |
| Find a lead | `PeopleModule` (Find and call, Tags, Going cold, Sources) | new | fine |
| Account audit | `AuditView` (one page, heading and estimate first) | new | fine |
| Clean-up | `CleanupModule` (6 tabs, older Data health inside "Health") | new | fine |
| Overview | merged into Today, Numbers when `td_module` and `td_numbers` are on; otherwise the old `OverviewView` | old (while not merged) | see "Left" |
| Team | `TeamModule` (pp3, 9 tabs) | new | fine |
| Pipeline and deals | `PipelineModule` (pl3, 9 tabs), old two-tab screen while `pl_module` is off | new | fine |
| Meeting notes | `MeetingsView`: inbox, set-up, older notes | middle-aged (E2a/E2b) | revamped in this stage (new Calls to log tab) |
| Workflows | `WorkflowsView` (one screen, tabs inside) | middle-aged | works; one bug fixed |
| Settings | `SettingsHub` when `st_settings` is on, else the old long `SettingsView` | new | fine |
| Getting started | `GuidesView` when `st_guides` is on, else `HelpView` | new | fine |
| What's new | `NewsView` when `st_news` is on, else `RoadmapView` | new | one bug fixed |

## Fixed in this stage

| Where | Defect | Severity | Fix |
|---|---|---|---|
| Meeting notes | The top bar drew "Last 7 / 30 / 90 days, Custom" but nothing on the page reads it (the legacy meetings list takes no range). Same class of defect as Team and Pipeline in QA round 1. | annoying (a control that does nothing) | `meetings` removed from the range pages in `src/lib/design/global-filter.ts`; the bar now draws nothing there (test added in `shell.test.ts`). Verified in the browser. |
| What's new | Two level-1 headings on one page ("What's new" and "What's new and next"), because the page embeds the roadmap, which draws its own page header | polish (screen readers, outline) | `RoadmapView` takes `embedded`; inside What's new it is a section heading (h2). The stand-alone roadmap (old flag-off path) keeps its h1. The e2e check in `f8.spec.ts` no longer insists on level 1. |
| Workflows | React warned 21 times per load: two list items with the same key (`Fix now: "Cold Lead Reactivation" has failing steps`), because the same workflow name fails in several accounts. Duplicate keys can drop or repeat rows when the list changes. | annoying | next-step and report lists use `index:text` keys (`workflows.tsx`). |

## Left (not fixed here)

| Where | Defect | Severity | Note |
|---|---|---|---|
| Overview (only while `ov_screen` is on or `td_numbers` is off) | On the sample data the two top tiles read "Stale deal value $0" and "Waiting past your reply target 0" while the same page says 70 of 153 open deals have not moved and lists accounts with "6 conversations waiting over 4h" and "8 stale deals worth $54,329". A count that does not match its rows. Not diagnosed: it may be the sample data, or two different calculations on one page. | blocks going live for that page (wrong number under a label); no effect while Overview stays merged into Today | Check `k.staleValue` and `k.unanswered` in the overview query against the per-account rows before ever switching `ov_screen` on. |
| Clients | 11 tabs; the four older pages sit after the seven new ones, so the tab strip scrolls sideways and "Overview" is off screen when an older tab is open | annoying | Rebuild Onboarding, Reviews and Industries into the new pattern, or fold Health and risk into Overview. A product choice, not a one-line fix. |
| All | First screen takes 15 to 60 s on the shared dev database link (the shell fires many calls at once) | blocks going live until measured on production | Same as QA round 1. |
| All | Dark and light, 768 and real-data paths were not walked for Account audit, Settings, Getting started, Team, Pipeline, Payments | unverified | |

## Meeting notes (this stage's revamp)

See `docs/features/MEETINGS_BRIEF.md`. Built here: slice 3 (calls held, not logged, per person and per client account, counts only, tab "Calls to log", flag `mn_logged`) and slice 4 (append-only `mn_outcomes` daily table, recorded by the existing `meeting-expiry` cron, shown from 30 calls and labelled "History starts <date>", flag `mn_outcomes`). Slice 5 (setup health) already existed as Team connections in Settings, Integrations (status, last event, needs reconnect, expired, errors). Not built: slice 1 (needs King's own real Fathom meeting, live), slice 2 (action items to tasks with preview and confirm: needs the task write scope and a gateway call, a separate piece of work), slice 6 stays deferred. The migration `20261219090000_mn_outcomes.sql` is NOT applied; until it is, the Calls to log tab says the history is not switched on and the counts still work.
