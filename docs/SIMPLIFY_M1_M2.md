# Simplification pass (Prompt C), updated 8 Nov 2026

The **8 Nov role/feature inventory below is authoritative**; detailed 3 Nov review later in this file is historical evidence. King clarified that launch means testing all modules, then chose to make modules visible on every install. This supersedes the earlier suggestion to hide Team, Clean-up, Duplicates, Compare/Reviews, AI, Meetings, Workflows, and Data health by default. Keep the six-tile Overview cap. Prompt C asks who uses each surface, what they lose without it, and before/after counts.

## 8 Nov execution

### Evaluate before building

1. Decision: agency owners use cross-account health and queues to choose the next client action; setters use their own reply/call queue; client admins use their account's outcomes and setup.
2. Data: VERIFIED in current code. This is navigation and presentation only; it needs no new live data or permission.
3. Native/competitor overlap: INFERENCE. Some modules overlap native CRM or paid tools, but King wants them available to test before deciding what to narrow.
4. Simplest proof: expose all modules in the live app through the existing feature switches; preserve flag-based rollback; keep Overview at its existing six metrics.
5. Risk: unfinished or unverified screens may confuse live users. Write-capable actions still depend on their explicit write/preview/confirm gates. Individual experimental Inbox add-ons and Zoom/Google Meet remain off; they are add-ons/integrations, not whole modules.

### Current screen inventory

Roles: **A** agency owner/admin, **S** setter/client staff, **B** client admin/business owner. The “without it” column describes the practical loss, not an endorsement to build it.

| Screen or sub-screen | Who uses it | What they lose without it | Default status after this pass |
|---|---|---|---|
| Today | A, S, B | The next action and who needs attention | Keep |
| My day | S, B | Their own work queue | Keep |
| Speed to lead | A, S, B | Which new leads have not received a human reply in time | Keep |
| Unanswered messages | A, S, B | The waiting queue and aging picture | Keep |
| Appointments; Insights | A, S, B | Outcomes to record, no-shows to recover, and show-rate evidence | Keep; five lower-priority insight widgets already start hidden by the page’s widget preference |
| Clients / account health | A | Which client account needs a call first | Keep |
| Client onboarding / Setup | A, S, B | Setup steps and sender-health checks | Keep |
| Client details and industries | A | Fees, renewal dates, and the context used for client comparisons | Keep |
| Compare and Reviews (QBR) | A | Side-by-side comparison and a printable quarterly summary | Keep; available for launch testing |
| People: Find and call | A, S, B | Cross-account search and the call queue | Keep |
| People: Tags, Going cold, Sources | A, S, B | Follow-up lists, contact lifecycle, and source context | Keep |
| Account audit and share links | A, S, B; A shares with prospects | A prioritized, shareable account-health check | Keep |
| Overview / My account | A, S, B | A compact account or agency snapshot | Keep; already at six metrics |
| Pipeline and deals | A, S, B | Stage, stale-deal, and pipeline context | Keep |
| Team | A, B | Team-level performance and name maintenance | Keep; available for launch testing |
| Clean-up | A, B | Data-quality and duplicate review | Keep; available for launch testing |
| Duplicates | A, S, B | Candidate duplicate contacts | Keep inside Clean-up; available for launch testing |
| Meeting notes | A, B | Meeting capture and summaries | Keep; available for launch testing |
| Workflows | A, S, B | Workflow-health review | Keep; available for launch testing |
| Data health | A, S, B | Data-quality trends and fix queues | Keep; available for launch testing |
| Alerts and notification preferences | A, S, B | Timely notice and control of delivery | Keep; alerts are also available from the bell |
| Settings | A, B | Reply targets, access, integrations, privacy, and account controls | Keep |
| Integrations | A, B; S sees their own connection entry | Connection status and permission context | Keep |
| Getting started / Setup checklist | A, S, B | Guidance for connecting and using the app | Keep |
| What's new / Roadmap | A, S, B | Changes, planned work, and a way to vote | Keep |
| Email health | A, S, B | Sender authentication checks | Keep inside Setup |

Legacy addresses remain supported, but do not add menu items: **Accounts** opens Clients health; **Setup** opens onboarding; **Contact search**, **Leads**, and **Call lists** open the matching People tab; **Deals** opens Pipeline; **Connections** opens Settings > Integrations (except for S, who has a standalone Integrations entry); **Alerts** opens from the bell or Today. An agency's account-detail page is opened from Clients or the Overview list.

### Overview inventory: six headline metrics, no cuts needed

The current [overview.tsx](../src/app/app/views/overview.tsx) renders three figures inside Executive summary, two stat tiles, and one account-health bar. “Needs attention” is a working list, not a metric tile.

| Tile | Who uses it | What they lose without it |
|---|---|---|
| New contacts | A, B | Recent lead-volume signal |
| Revenue won | A, B | A compact result measure |
| Open pipeline | A, B | Deal value still in progress |
| Stale deal value | A, B | Valuable deals that have gone quiet |
| Waiting past your reply target | A, S, B | Count of people awaiting a reply |
| Account-health bar | A | Distribution of client accounts by health |

Optional goals and unusual-change notes appear only when data or goals exist; neither adds another headline tile. Preserve all six because each represents a distinct decision.

### Settings inventory

All eight Settings sections are for **A and B**; **S has no Settings access**. If a section disappeared, the user would lose the control/disclosure listed below. Controls remain available; deferred screens do not erase stored settings or API support.

| Section | Current controls | Who uses it | Loss if removed |
|---|---|---|---|
| Team and access | Client access by account; leave test accounts out; who can open the app | A | Control client visibility and understand who has access |
| Notifications | Quiet hours; Slack; daily brief; weekly email; send time; time zone | A, B | Route alerts and summaries at the right time |
| Integrations | Team connection status; personal connections; permissions | A, B | Connect tools and understand what data can be read |
| Replies | Stale days; gone-quiet days; reply target; speed-to-lead target; count automated touches; business hours; unread-alert escalation time (when enabled) | A, B | Set the thresholds behind alerts and metrics |
| Brand | Brand name and colour | A | Present reports and links consistently |
| Data | Data stored; meeting-note privacy (when enabled); delete synced data; trust page | A, B | Understand or remove stored data |
| Sync status | What is watched; per-account sync/freshness | A | Diagnose stale or missing data |
| Advanced | CRM link address; custom checklist; AI connector keys; settings history | A | Fix links, customize setup, connect an assistant, or audit changes |

**Settings counts:** 8 sections; 32 registered controls in `CONTROL_HOME`. The unread-alert escalation control appears only when `inbox_breach_alert` is enabled (default off); with that flag and the AI connector on, all 32 controls are visible. The legacy Slack/daily-brief editor remains because it still owns persisted settings; merging it is not safe until the dispatcher and Notifications page are verified against the same fields.

### Before and after counts

Count is for the default feature switches with no database overrides. “Menu items” are the actual `visibleNav` entries; module tabs and Settings sections are counted separately.

| Surface | Before | After | Change |
|---|---:|---:|---:|
| Agency menu items | 14 | 17 | +3 (Meeting notes, Workflows, Data health) |
| Client-admin/business menu items | 14 | 17 | +3 (Meeting notes, Workflows, Data health) |
| Setter/client-staff menu items | 13 | 15 | +2 (Workflows, Data health; Meetings is not authorized for this role) |
| Client-module tabs | 5 | 5 | no change |
| Settings sections | 8 | 8 | 0 |
| Overview headline metrics | 6 | 6 | 0; already meets the cap |
| AI connector cards in Settings | 1 | 1 | no change |

No whole module is now in `DEFAULT_OFF`; default-off entries are the Zoom/Google Meet connector and optional Inbox add-ons. The feature service still supports per-feature database overrides, but its current schema is global rather than per-install. **CHECK:** existing production overrides have not been read or changed; they can still hide a module until reviewed. The demo has previously shown Workflows and Data health, likely due to such overrides.

### Role walkthrough

- **A:** Today and the account queue remain first; uses account health, the audit, speed and appointments; can change settings. Also has Team, Clean-up, comparison/QBR and AI available to test.
- **S:** Keeps My day, own reply/call work, appointments, audit and account-scoped views. Can test the client-scoped module views; has no Settings access.
- **B:** Keeps Today/My account, appointments, setup, audit and account settings. Can test Team, Clean-up, comparison/QBR and AI where authorized.

The extra simplification is keeping all three roles' Wave 1 queues intact and retaining the six-metric Overview; we are not hiding modules while validating launch readiness.

**VERIFIED:** default flags are now on for all whole modules, except Zoom/Google Meet integration; optional Inbox add-ons remain default-off. TypeScript, Node tests, and focused switch tests have been rerun after this reversal. **CHECK:** production is not deployed by this local change, and existing global database overrides may still hide modules. Confirm those before announcing all modules are visible. No database was modified.

**Labels.** VERIFIED means I read it in code and cite `file:line`. INFERENCE means reasoning that could be wrong. **Roles:** A = agency owner, S = setter (a client's staff, access kind `client`), B = client admin (a business that installed for itself, kind `business`). **Switches:** defaults are `meetings` and `zoom_meet` off, everything else on (VERIFIED `src/lib/flags-core.ts:9-16`); a row in `feature_flags` overrides a default either way without a deploy (VERIFIED `flags-core.ts:17-20`, `flags.ts:12-22`, `docs/DECISIONS.md:136`).

**How I counted.** A *stat tile* is a number with a label. A *card or section* is any block with its own heading (list, table, chart, group of tiles). Page chrome (the title, the dismissible "How to use" tip, the freshness line, header buttons) is not counted. Counts are for the default switches and a populated multi-account agency. Tabs of a module are counted as sub-screens.

---

## 1. Counts: before and proposed after

| What | Before | Proposed after | Cut that does it |
| --- | --- | --- | --- |
| Menu items, agency owner (A) | 16 | 13 | 7, 8 |
| Menu items, client admin (B) | 17 | 14 | 7, 8 |
| Menu items, setter (S) | 13 | 12 | 7 |
| Tabs and settings sections inside modules (Appointments 2, Unanswered 3, Clients 5, People 4, Pipeline 2, Settings 8) | 24 | 22 | 9 (Clients 5 to 3) |
| Places to click for A (menu + tabs) | 40 | 35 | |
| Pages with no menu entry (Account detail, Alerts, Email health, Notifications) | 4 | 4 | none |
| Appointments Insights widgets shown by default | 12 | 7 | 6 |
| Stat tiles on the 11 pilot screens (listed below) | 37 | 26 | 1, 9 |
| Cards and sections on the 11 pilot screens | 107 | 79 | 1 to 6, 9 to 12 |
| Stat tiles plus cards and sections, total | 144 | **105** (123 if King keeps Compare and Reviews) | |
| Overview | 8 figures + 2 cards | **6 tiles** (3 headline figures, 2 stat tiles, 1 health bar) + the Needs attention list | 1 |
| Settings: sections / cards / registered controls | 8 / 18 / 31 | 8 / 15 / 23 | 10, 11, 12 |
| Getting started steps for A | 13 | 11 | 14 |

Evidence for the menu counts: `NAV` has 24 entries and `ViewId` has 28 ids (VERIFIED `src/app/app/nav.ts:2,19-44`). The visible menu is `NAV` filtered by `NAV_FOR[kind]`, by switch, and without entries that have a `parent` (VERIFIED `src/app/app/dashboard.tsx:283`, `src/lib/access.ts:141-145`). Counted by hand: A has 16 (this equals the 16 labels asserted in `tests/e2e/menu.spec.ts:9`), B has 17 (the same plus My day and Setup, no Clients), S has 13 (My day, Speed to lead, Appointments, Unanswered messages, Account audit, People, My account, Pipeline and deals, Setup, Duplicates, Connections, Getting started, What's new). Tabs: VERIFIED `dashboard.tsx:311-313,352`, `clients/index.tsx:38-44`, `people-module.tsx:360`, `inbox.tsx:25`, `settings-sections.ts:18-27`. Setup (2 tabs) is shown only to B and S.

Per pilot screen:

| Screen | Stat tiles before to after | Cards and sections before to after |
| --- | --- | --- |
| Today | 4 to 4 | 4 to 3 |
| Speed to lead | 4 to 4 | 6 to 6 (4 with optional cut 13) |
| Appointments (both tabs) | 7 to 7 | 19 to 14 |
| Unanswered messages | 0 to 0 | 6 to 5 |
| Account audit | 2 to 2 | 4 to 4 |
| Clients (5 tabs) | 12 to 4 | 19 to 9 |
| People (4 tabs) | 0 to 0 | 22 to 14 |
| Overview | 8 to 5 | 2 to 2 (the health card becomes the sixth tile) |
| Settings | 0 | 18 to 15 |
| Getting started | 13 steps to 11 | 2 to 2 |
| What's new | 0 | 5 to 5 |
| Pipeline (not a pilot screen, touched by cut 5) | 4 | 14 to 12 |

---

## 2. Screens (menu items and tabs)

Class: **keep**, **merge** (fold into another place), **hide** (behind a feature switch, code kept), **cut** (remove the block, code file kept).

| Screen | Who uses it | What they lose without it | Class | Reason and evidence |
| --- | --- | --- | --- | --- |
| Today | A, B | The one sentence and button that say what to do now | keep | Front door; the wedge in one screen. V `today.tsx:50-104` |
| My day | S, B | The phone-first list of leads to answer and calls to make | keep | The setter's home. B also gets it next to Today, which is two homes (I: revisit after pilot feedback). V `access.ts:143` |
| Speed to lead | A, S | The queue of leads nobody answered, per source, account and person | keep | Core wedge. V `speed.tsx:50-153` |
| Appointments | A, S, B | Unmarked outcomes, no-shows to rebook, true show rate | keep | Core wedge. V `appointments.tsx:50-176` |
| Appointments > Insights tab | A | Twelve analyses of show rate | keep, trim | Only 4 are asserted by tests and 3 have no decision attached; see cut 6. V `appointment-insights.tsx:39-42` |
| Unanswered messages (3 tabs: Last 7 days, Older, Unread) | S, A | The queue of customers waiting past the reply target | keep | Core wedge; King asked for the tabs and peeks (N13). V `inbox.tsx:25,226` |
| Account audit | A, prospects | The sellable "what is wrong and what it costs" page and share link | keep | The onboarding hook (brief section 7 item 5). V `audit.tsx:48-235` |
| Clients (5 tabs) | A | Health, onboarding, fees, comparisons, quarterly reviews | keep Health and Onboarding and Details; hide Compare and Reviews | `docs/ROADMAP_V2.md` stage C1 item 4 asked for Compare and Reviews (King), but brief section 8 defers the QBR generator and `docs/DATA_POINTS.md` says to cut "compare two". King's call (cut 9). V `clients/index.tsx:38-44` |
| People (4 tabs: Search and filters, Smart lists, Going cold, Imports and sources) | S, A | Cross-account search, saved lists, call lists | keep, trim | Search across accounts is what the CRM cannot do. Trim in cut 4. V `people-module.tsx:360-385` |
| Contact search, Leads, Call lists (old addresses) | none | Nothing: they open People tabs | keep as redirects | V `dashboard.tsx:310,333`; `search.tsx` `SearchView` is imported nowhere (V grep) so it is dead code, keep it |
| Overview | A, B | A one-page summary and printable view | keep, cap at 6 tiles | Duplicates Today but King kept it ("do not hide pages", `docs/DECISIONS.md:249,266`); Getting started links to it (V `getting-started.ts:63`) and B and S use the same id as "My account" (V `dashboard.tsx:299,325`). Cut 1 |
| Accounts (tab of Clients) | A | Health table | keep | V `dashboard.tsx:337` |
| Team | A | Per-person deals, win rate, reply and show rate; the only place to type a missing team name | merge into Settings, then hide | Wave 2 (brief section 7); overlaps Speed "Who replies fastest" and Appointments "By person". But it is the only name editor (V `people.tsx:29`, `inbox.tsx:228`). Cut 8 |
| Pipeline and deals (2 tabs) | A, B | Forecast, stale deals, hygiene | keep, trim | Today tiles and Audit buttons link into it (V `today.tsx:43-48`, `audit.tsx:130`), so hiding it leaves dead links. Cut 5 trims two cards |
| Setup (B and S only; a Clients tab for A) | B, S | Their own setup checklist and email sender health | keep | V `nav.ts:34`, `dashboard.tsx:313,341` |
| Duplicates | A | A scored list of duplicate contacts | hide | DEFER in brief 13A and `DATA_POINTS.md`; roadmap stage C2 redoes it. S sees it today (V `access.ts:144`). Cut 7 |
| Data cleanup | A, B | Bulk phone and tag tidy with preview | hide | DEFER (13A); needs a write permission SubSync does not request and "never run on the real account" (V `docs/FEATURE_STATUS.md` row Data cleanup). Cut 7 |
| Meeting notes | none | n/a | already hidden | `meetings` default off. V `flags-core.ts:14` |
| Settings (8 sections) | A, B | Reply targets, notifications, brand, privacy, delete | keep | V `settings-sections.ts:18-27` |
| Connections | A, S, B | Personal Fathom and Slack connections | keep until Fathom is proven | Stages E0 and E2a; Settings Integrations already links to it (V `settings.tsx:222`). Revisit after the pilot |
| Notifications (under Settings) | A, B | Per-message channel, time, quiet hours and wording | keep | Absorbs a legacy Settings card (cut 10). V `notifications.tsx:62,138` |
| Getting started | A, S, B | The tick-off guide | keep | V `help.tsx:39-107` |
| What's new | A, S, B | Roadmap votes, suggestions, change log | keep | Cheap trust builder, brief section 7 item 8. V `roadmap.tsx:53-106` |
| Account detail (no menu entry) | A; S and B as "My account" | Why an account is scored as it is | keep | V `account-detail.tsx:77-165` |
| Alerts (no menu entry) | A | The full alert list and Dismiss | keep | Reached from Today and the bell. V `today.tsx:263`, `alerts.tsx:9` |
| Email health (no menu entry) | A, B | SPF, DKIM, DMARC checks | keep as is | DEFER to stage E5; not in the menu so it costs nothing on screen |

---

## 3. Tiles and cards on the pilot screens

### Today (`src/app/app/views/today.tsx`)

| Tile or card | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Front door: headline sentence, "Do this first" button, appointments line, attention line, next pick (:50-104) | A, S, B | The next action | keep | The product in one block |
| Needs attention today list (:235-264) | A | Which client to open | keep | Ranked, with a reason per account |
| What changed: Open pipeline tile (:43-47, :116-153) | A, B | "Is the money growing?" | keep | Pipeline lane is native-CRM territory (I), but `tests/e2e/today.spec.ts:151` asserts exactly 4 tiles; first to drop if the test is edited |
| What changed: Stale deals tile | A, B | The count of deals that went quiet | keep | Feeds the audit |
| What changed: New contacts, 30 days tile | A | The lead-flow signal | keep | Alert-first |
| What changed: Unread conversations tile | S, A | The unread count | keep | Labelled unread, not waiting |
| Outlier note (:107-112) | A | The warning that one deal is the money figure | keep | Trust rule, brief 13A |
| Fine today list (:268-276) | A | Nothing: it lists accounts with no problem | **cut** | `DATA_POINTS.md` already calls it CUT; one count in the attention line is enough |
| Header buttons: Copy summary, Sync now (:225) | A | Pasting a summary; refresh | keep | Both used |

### Speed to lead (`speed.tsx`, `speed-cards.tsx`)

| Tile or card | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Headline, what to do, "measuring" line (:87-94) | A, S | The plain answer and the target in force | keep | |
| Leads waiting or missed list (:96-102) | S | The queue | keep | |
| Not-counted note, unassigned alert (:104-114) | A | Why a count is smaller; leads with no owner | keep | Trust and setter ops |
| How fast replies come: 4 tiles (typical first reply, answered within target, answered late, not answered) (`speed-cards.tsx:119-178`) | A | The scorecard | keep all 4 | `tests/e2e/speed.spec.ts:147` asserts the "Answered late" button |
| Automatic message or a person? (inside that card) | A | The honest split between workflow texts and people | keep | Differentiator (N78) |
| Are replies getting faster? (`speed.tsx:126-141`) | A | The weekly trend | keep | Shows a placeholder under 5 leads a week |
| Where leads come from (`speed-cards.tsx:186-225`) | A | The slow source | keep | |
| By client account, slowest first (:233-264, agency only) | A | The ranking of accounts | keep | |
| Who replies fastest (:272-306) | A | The ranking of people | keep | Setter ops |
| Five separate date pickers, one per card | A, S | Nothing | merge (optional, cut 13) | I: five pickers on one page is noise; `speed.spec.ts:145` asserts four of them |

### Appointments tab (`appointments.tsx`)

| Tile or card | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Filter bar: calendar, user, source (:116) | A | Narrowing | keep | |
| Headline lines and "What to do" (:118-121) | A, S | The next step | keep | |
| The numbers card: Booked, Show rate, No-shows, Coming up 7 days, plus the target editor (:123-147) | A, B | The state of show rate | keep | `DATA_POINTS.md`: Booked changes no decision alone but gives context |
| Do these first: Record the outcome, No-shows to rebook, Remind today (:149-157) | S | The call lists | keep | Core wedge |
| Appointments by status (:164-169) | A | The status breakdown King asked for (N24) | keep | |
| By calendar, person and client account (:208-238) | A | Where show rate is good or bad | keep | |

### Appointments > Insights (`appointment-insights.tsx`)

| Widget | Who | Class | Reason |
| --- | --- | --- | --- |
| Calendar health | A | keep | Asserted by `appointments.spec.ts:120,140,146,174` |
| Best times to book | A | keep | Asserted `appointments.spec.ts:175`; needs enough outcomes |
| No-show recovery | A | keep | Asserted `appointments.spec.ts:176` |
| Repeat no-shows | A, S | keep | Names people to call |
| Show rate by lead source | A | keep | Wedge: show rate by source |
| Reminders and confirmations | A, S | keep | Links to the Remind today list |
| Double bookings | A | keep | Asserted as the toggle test `appointments.spec.ts:142-149` |
| From lead to customer | A | **default-hide** | `DATA_POINTS.md` LATER: "customer" is undefined |
| How fast leads get booked | A | **default-hide** | LATER |
| Who gets the appointments | A | **default-hide** | `DATA_POINTS.md` recommends CUT: no decision attached |
| What an appointment is worth | A | **default-hide** | Recommended CUT; needs 10 held appointments in 6 months |
| No follow-up after the appointment | A | **default-hide** | LATER |
| Before your next appointments, Dates and filters, Not enough data yet (:303,:105,:312) | A | keep | Chrome around the widgets |

### Unanswered messages (`inbox.tsx`, `inbox-controls.tsx`, `comms-sections.tsx`)

| Tile or card | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Headline and "What to do" (:176-182) | S, A | The count in words | keep | |
| Wait chips, filters (channel, account, assigned to, order) (:156, `inbox-controls.tsx:36-70`) | S | Narrowing | keep | King's F4 addendum |
| Saved views (`inbox-controls.tsx:73`) | S | Reusing a view | keep | King's F4 addendum |
| How long customers have waited chart (:203) | A | The aging picture | keep | Same set as the list |
| Where the waiting is chart (:209, agency only) | A | Which account | keep | |
| Tabbed list with peeks of the other two tabs (:226, :165) | S | The queue | keep | King N13 asked for peeks |
| Leads that arrive after hours card (:233, `comms-sections.tsx:10-31`) | A | An after-hours share and a staffing hint | **cut** (render only) | `DATA_POINTS.md`: merge into Speed to lead; needs 20 leads; no test reads its text |
| "Open deals ... now in Pipeline" pointer (:234) | A | A pointer to a moved card | **cut** | Stale signpost |

### Account audit (`audit.tsx`)

| Tile or card | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| What to fix first (:124-133) | A | The single next step | keep | |
| Deals that stopped moving tile (:137) | A, prospects | The counted dollar figure | keep | |
| Cost of slow follow-up tile (:147) | A | An estimate | keep | It shows "Not enough data" until an account has 20 closed deals (:151), and the real accounts have 6 (I, from `docs/DECISIONS.md` F1 notes); honest, so keep, and revisit after the pilot |
| What needs fixing, up to 7 findings (:165-191) | A | The list | keep | |
| Where to start table (:204-214) | A | The account ranking | keep | |
| Your share links (:219-232) | A | Revoking a link | keep | Owner control |
| Header: Share link, Print, Copy summary (:95-99) | A | Three ways to hand it over | keep | |

### Clients (`views/clients/*`)

| Tab and block | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Health: Who to call first, Clients by health, filter chips and table (`accounts.tsx:83,95,140`) | A | Which client to call | keep | |
| Onboarding: Checklist templates, Clients stuck, Checklists (`onboarding-tab.tsx:193,235,249`) | A | Setup tracking | keep | Also absorbs the Settings checklist (cut 11) |
| Details and billing: 4 tiles (monthly revenue, revenue at risk, not spoken to 14+ days, renewals 90 days) (`details.tsx:174-179`) | A | Retention numbers | keep, but show only once fees are typed | Two of the four already say "Needs fees"; `DATA_POINTS.md` recommends CUT until fees exist (UX-08) |
| Details: Renewals, Your clients, By industry (:183,195,237) | A | Fee and renewal editing; industry feeds benchmarks | keep | Industry typed here feeds the moat (`docs/MOAT.md` section 3) |
| Compare: Pick, What is different, Side by side, Trend (4 sections) (`compare.tsx:47-82`) | A | Side-by-side clients | **hide** (King's call) | `DATA_POINTS.md` recommends cutting "compare two" (N60) |
| Reviews (QBR): 8 stat tiles, 3 charts, 6 sections (`reviews.tsx:90-129`) | A | The printable quarterly report | **hide** (King's call) | Brief section 8 defers the QBR generator; also see section 6 below: its "sorted out" claim counts dismissals |

### People (`people-module.tsx`, `leads.tsx`, `calls.tsx`)

| Tab and block | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Search: Filter builder, Save as list, People list, Tags (:205-228) | S, A | Finding people | keep | |
| Smart lists: Saved lists, Call lists (with Power hour, Choose a list, Call this person now) (:263-270, `calls.tsx:146,163,205`) | S | The call queue | keep | Wedge: smart call queues |
| Going cold: Who is going quiet, bucket list, Contact lifecycle, Working leads, Cold lists (:299-313, `leads.tsx:141,155`) | S, A | Re-engaging people | keep | New in F1; replaces an unmeasurable metric |
| Collapsed "More about your contacts": Lead cohorts, Best leads to work now, Your most valuable contacts, New contacts per week, Growth by account, Do not disturb, Birthdays (:315-318, `leads.tsx:168,182,199,217,221,295,299`) | A | Little | **cut** (7 cards) | `DATA_POINTS.md`: cohorts LATER (small cohorts mislead), best leads merge into Call lists, valuable contacts CUT, birthdays CUT, new contacts per week duplicates Today's tile |
| Imports and sources: Where your contacts come from (`people-module.tsx:328,334-357`) | A | A count-only source chart | **cut** | Duplicates the "Where leads come from" table in the same tab (`leads.tsx:272`) which also shows customers and conversion, and Speed to lead has a third source view |
| Imports and sources: Contact data quality, Where leads come from, Large imports (`leads.tsx:249,272,308`) | A | Data and source checks | keep | |

### Overview (`overview.tsx`, `exec-summary.tsx`)

Before: 8 figures (3 headline, 3 stat, 2 estimate) and 2 cards. This is the "$2.4 million on three tiles" problem from brief 13A, now partly fixed, but it still has more tiles than a person reads.

| Tile | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- |
| Executive summary: New contacts, Revenue won, Open pipeline (`exec-summary.tsx:58-66`) | A | Headline figures | keep (3 tiles) | `tests/e2e/consistency.spec.ts:89-93` needs the open pipeline value on this page |
| Goals, unusual notes, goals editor (:69-107) | A | Optional goals | keep, not a tile | Appear only when set |
| Stale deal value (`overview.tsx:59`) | A | Money sitting quiet | keep (tile 4) | |
| Waiting past your reply target (:61) | A, S | Count of waiting customers | keep (tile 5) | `tests/e2e/f4.spec.ts:245` asserts this text |
| Open alerts (:62) | A | Nothing; the bell is the right place | **cut** | `DATA_POINTS.md` CUT as a tile |
| Estimates card: Expected revenue, Cost of slow follow-up (:78-102) | A | Two estimates | **cut** | Expected revenue stays on Pipeline (the same "Estimate, not a fact" label is there, V `pipeline.tsx:119`, which keeps `consistency.spec.ts:102` green); cost of slow follow-up is stated better, with its formula, in the audit |
| Account health card: bar, Client accounts, Average health score, Accounts gone quiet (:123-135) | A | A health summary | keep the bar (tile 6), cut the two rows | `DATA_POINTS.md` CUT "average health score, gone-quiet count" |
| Needs attention list (:105-120) | A | Which client to open | keep (a list, not a tile) | `tests/e2e/f1.spec.ts:195-203` asserts the heading and no "Healthy" inside |
| Left-out deals sentence, outlier note (:64-76) | A | Why totals are smaller | keep | `f1.spec.ts:199` asserts the sentence |

### Settings (`settings.tsx`, `settings-parts.tsx`, `settings-sections.ts`)

Eight sections (VERIFIED `settings-sections.ts:18-27`), 19 cards of which 18 show by default (Meeting notes privacy is behind the `meetings` switch, VERIFIED `settings.tsx:299`), 31 registered controls (VERIFIED `settings-sections.ts:34-43`; counted per section: team 3, notifications 6, integrations 4, targets 6, brand 2, privacy 4, sync 2, advanced 4). Only A and B open Settings; S never does (V `settings-sections.test.ts:21`).

| Section and card | Controls | Who | What they lose | Class | Reason |
| --- | --- | --- | --- | --- | --- |
| Team and access: Client access (`settings.tsx:137`) | per-account switch, on and off for all | A | Letting a client's staff open SubSync | keep | |
| Team and access: Test and practice accounts (`settings-parts.tsx:56`) | per-account switch | A | Leaving test accounts out of numbers | keep | Trust rule |
| Team and access: Who can open SubSync (`settings-parts.tsx:89`) | read-only | A | Seeing who has access | keep | |
| Notifications: "Notifications" link card (:172) | link | A | The way to the Notifications page | keep | |
| Notifications: Slack alerts and daily brief (:180-215) | quiet hours, Slack address, daily brief, weekly email, send at, time zone | A | A second place to set what the Notifications page already sets per message (V `notifications.tsx:197-233,307-324`: frequency, hour, time zone, quiet hours) | **merge** into the Notifications page (cut 10) | I: the legacy card seeds the defaults; verify before removing |
| Integrations: Connections link card (:222) | link | A | A signpost | keep | The test at `settings-sections.test.ts:51` pins its place |
| Integrations: What SubSync can read (`settings-parts.tsx:19`) | read-only | A, B | Why each permission is asked | keep | Principle 6 |
| Reply targets: Thresholds (:232) | stale days, quiet days, reply target hours | A, B | Defining late | keep | |
| Reply targets: Speed to lead (:252) | minutes, count automatic messages, business hours, open, close | A, B | Defining a fast reply | keep | |
| Brand: Your name on reports (:278) | name, colour | A | White-label | keep | |
| Data and privacy: Meeting notes privacy (:300) | transcripts, add to contact notes | A | n/a while the page is off | already hidden | |
| Data and privacy: What we store (:309) | read-only | A, B | Disclosure | keep | |
| Data and privacy: Delete my data (:316) | typed word | A | Removing everything | keep | |
| Sync status: What SubSync watches (`watching-panel.tsx`) | read-only | A | Knowing the limits | keep | |
| Sync status: Sync status card (`sync-status.tsx:67`) | per-account refresh | A | Freshness detail | keep | |
| Advanced: Links (:337) | login address override | A | Fixing wrong CRM links | keep | White-label fallback |
| Advanced: Onboarding checklist (:354) | one text box | A | Custom steps | **merge** into Clients > Onboarding templates (cut 11) | Same job as `onboarding-tab.tsx:193`: "Checklist templates ... steps are added to the checks SubSync does by itself" |
| Advanced: AI assistant connector (:361) | create and revoke keys | A | Pointing Claude or ChatGPT at the data | **hide** (King's call, cut 9b) | AI is Wave 2 (brief section 7); King switched it on on 31 Oct (`docs/DECISIONS.md:249`) |
| Advanced: History of changes (`settings-parts.tsx:116`) | read-only | A | The audit trail | keep | |

### Getting started (`help.tsx`, `getting-started.ts`)

Steps by role: A has 13, agency staff 6, B 10, S 5 (VERIFIED `getting-started.ts:96-100`). Cards: What the words mean (6 terms), Common questions (7).

| Block | Who | Class | Reason |
| --- | --- | --- | --- |
| Steps connected, synced, today, speed, search, targets, feedback | all | keep | |
| Steps "Get the daily brief in Slack" and "Get alerts and the Monday email" (:75,:77) | A, B | **merge** into one step "Choose where alerts go" | Both open the same Settings section (`section: "notifications"`) |
| Step "Add what each client pays you" (:89) | A | **cut** | Optional; tied to the Clients fee strip |
| Steps tests, share, clients | A | keep | Optional and cheap |
| Missing step | A | add | A's list has no Appointments step; agency staff and B have one (:98-99). I: an oversight |
| What the words mean, Common questions | all | keep | |

### What's new (`roadmap.tsx`, `roadmap.ts`)

Five blocks: a card per status (planned 6, considering 2, shipped 2 items; VERIFIED `roadmap.ts:20-30`), Suggest something (:76), Change log (:106). Keep all: the votes are the cheapest evidence of what pilots want, and `roadmap-truth.test.ts` pins the wording.

---

## 4. Settings controls that duplicate another place

| Control | Where it also lives | Verdict |
| --- | --- | --- |
| Quiet hours, send at, time zone, daily brief, weekly email, Slack address | Notifications page, per message type (`notifications.tsx:62,138,307-324`) | one place: Notifications |
| Custom checklist steps | Clients > Onboarding > Checklist templates | one place: templates |
| Missing team names | Team page (`people.tsx:29`), pointed to by `inbox.tsx:228`; the users permission fills them automatically when granted | move the editor into Settings > Team and access before Team is hidden |

---

## 5. Ordered cut list for the lead

Each item gives the exact place, what it removes, and what a test asserts. "Safe" means I found no test that reads the removed text. Items 1 to 6 are code-only and need no King decision (CLAUDE.md working principle 6). Items 7 to 9 are switches. Items 10 to 14 are merges that need test edits.

| # | Cut | Exact change | Removes | Tests that touch it |
| --- | --- | --- | --- | --- |
| 1 | Overview to 6 tiles | `overview.tsx`: delete the Open alerts stat (:62), the Estimates card (:78-102) and the two rows at :132-133; change the stat grid from 3 columns to 2 | 3 figures | Safe. Keep these, they are asserted: Waiting past your reply target (`f4.spec.ts:245`), the left-out sentence and Needs attention heading (`f1.spec.ts:195-203`), the open pipeline value on #overview (`consistency.spec.ts:89-93`) |
| 2 | Today: drop "Fine today" | `today.tsx:268-276` (the `d.fine` data stays for the Slack brief) | 1 section | Safe. `today.spec.ts:106-109` falls back to that list only if the attention list is empty (the demo has attention) |
| 3 | People: drop the collapsed cards and the duplicate source chart | `people-module.tsx:315-318` (the `<details>` block) and `:328` (`<SourceChart/>`); keep the functions and `LeadsView part="more"` | 8 cards | Safe (no test names them; `scripts/check-api.ts:232,426` reads the API, which is unchanged) |
| 4 | Unanswered: drop the after-hours card and the signpost | `inbox.tsx:233-234` and the import at :13; keep `comms-sections.tsx` | 1 card | Safe. `f4-wording.test.ts:56,61` read `inbox.tsx` and `comms-sections.tsx` as files, so do not delete the file |
| 5 | Pipeline: drop Deal sizes and Recent deal movement | `pipeline.tsx:188-192` (re-balance the two-column row at :183) and `<DealMoves />` at `dashboard.tsx:311`; `deal_events` keeps recording | 2 cards | Safe (no test names them) |
| 6 | Insights: default-hide five widgets | `appointment-insights.tsx:63` and :72: when nothing is remembered, start `hidden` as `funnel, velocity, fair, value, followup`; store `"[]"` rather than null at :83 so "show everything" is remembered | 5 widgets | Safe if Calendar health, Best times, No-show recovery and Double bookings stay on (`appointments.spec.ts:120-176`). I: `appointments.spec.ts:122` needs more than 5 `explain-` blocks, so run that spec |
| 7 | Hide Duplicates and Data cleanup | Easiest: insert `feature_flags` rows `duplicates=false`, `cleanup=false` (no deploy, no test edits, reversible). Or add both to `DEFAULT_OFF` (`flags-core.ts:9-16`) | 2 menu items (and 1 for S) | With rows: none. With `DEFAULT_OFF`: edit `flags-and-events.test.ts:11,13` (it asserts both are on and that `DEFAULT_OFF` equals exactly `meetings, zoom_meet`), `menu.spec.ts:9`, `freshness.spec.ts:12`, `s02b.spec.ts:54` (opens `#duplicates`), and the page lists in `whitelabel.spec.ts:13` and `review-capture.spec.ts:8` |
| 8 | Merge Team into Settings, then hide it | Move the name editor (`people.tsx:16-35`, `PUT team/:id`) into Settings > Team and access; reword `inbox.tsx:228`; then `team=false` | 1 menu item | `menu.spec.ts:9`, `freshness.spec.ts:12`, `f1.spec.ts:138,207` (they call the `team` API and open `#team`, which is a 404 when the switch is off), `flags-and-events.test.ts:11` |
| 9 | **King's call:** hide Compare and Reviews (QBR) | `reports=false`; `clients/index.tsx:42-43` already reads it. 9b: `ai=false` hides the AI connector card (`settings.tsx:360` already reads it) | 2 tabs, 8 tiles, 10 sections; 1 card, 1 control | `c1.spec.ts:30,181,196`, `menu.spec.ts:27`; for `ai`: `flags-and-events.test.ts:8,11`. King asked for Compare and Reviews in stage C1 and switched the AI connector on, so he decides |
| 10 | Merge the legacy Slack and daily-brief card into Notifications | Remove `settings.tsx:180-215`; keep the Slack address as "Advanced" on the Notifications page | 1 card, 6 controls | `settings-sections.test.ts:31,34` (card label and ids `slack, digest-email, digest-hour, digest-zone`), `f9-notifications.spec.ts`, `alert-email-db.test.ts`, `notify-*.test.ts` (they read the stored settings). Check the dispatcher reads the same stored fields first (I) |
| 11 | Merge the Settings checklist into Clients > Onboarding | Remove `settings.tsx:354-358`; keep the `customChecklist` column and API | 1 card, 1 control | `settings-sections.test.ts:31,34` (label and `id="custom"`); `scripts/check-api.ts:102-108` uses the API, unchanged |
| 12 | Show the client-fee strip only when fees exist | `details.tsx:174-179` | 0 to 4 tiles on a new install | `c1.spec.ts:92,125` open this tab; check they do not read the strip |
| 13 | Optional: one tabbed "Break down by" card on Speed to lead | Merge Source, Accounts and People cards (`speed-cards.tsx:181-306`) into one with three tabs and one date picker | 2 cards, 2 pickers | `speed.spec.ts:145` asserts four range groups |
| 14 | Getting started: merge brief and email, drop fees, add Appointments for A | `getting-started.ts:75-77,89,97` | 2 steps | `getting-started.test.ts:71-77` (ids `brief`, `email`, `client_fees`) |

Not cut, and why: Connections (E0 and E2a are the pilot's meeting-notes proof), Pipeline and deals (Today and Audit link into it), Overview as a page (Getting started and My account use the same id), What's new (cheap trust), the Audit page (the sellable asset), the dismissible "How to use" tips (13 of them, one tap to hide, `ds/how-to.tsx:12-18`).

---

## 6. Findings that came up while counting

1. **`overview` is one switch for five pages.** Today, My day, Overview, Getting started and What's new all use the feature `overview` (VERIFIED `nav.ts:19,20,30,42,43`), and the `daily` and `digest` APIs are gated by it (`router.ts:1789`). Switching it off would hide the front door. Hide Overview only by menu or by a new switch, never by this one.
2. **QBR overstates what was fixed.** An alert gets `resolved_at` whenever the next sync no longer raises it (`queries.ts:560-562`) and when a person presses Dismiss (`queries.ts:596-598`). The review counts every resolved row as "sorted out" (`client-success-queries.ts:236`) and prints "N problems SubSync flagged were sorted out" under What went well (`client-success.ts:556`, `reviews.tsx:99,118`). An alert that left the 30-day window, or was dismissed, is counted as a fix. Operating principle 5 forbids a claim not proven. Until the proposal in `docs/INNOVATION_M1_M2.md` is built, reword to "cleared" (tests to update: `client-success.test.ts:403,418,464`).
3. **Dead code that costs nothing on screen:** `SearchView` (`search.tsx`) is imported nowhere, and the standalone branch of `LeadsView` (`leads.tsx:127-136,237`) is unreachable because only `part=` is used. Keep, as CLAUDE.md says.
4. **Where "leads come from" appears:** Speed to lead (by reply speed), People > Imports (a count chart) and People > Imports (a conversion table). Cut 3 removes one.
5. **The setter menu still shows Duplicates and Pipeline and deals** (`access.ts:144`). Cut 7 removes Duplicates for S. I left Pipeline in for S because the Audit page, which S also opens, links to it (`audit.tsx:130`).
6. **Not verified by me:** I did not run the app, the e2e specs or the unit tests, so every "safe" above means "no test reads that text", checked by search, not by a green run. Run `npm run verify` and the named specs after each cut.
