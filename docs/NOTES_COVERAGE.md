# Notes coverage ledger

One row for every review note (N1 to N104) and every buyer-review finding. Maintained with `node scripts/notes-coverage.mjs`. Statuses: DONE-TONIGHT (with evidence in the last column), PLANNED-LATER (the stage is named), NEEDS-KING (the item is in docs/NEEDS_KING.md), PARKED (the reason is given), NOT-A-CODE-ITEM (a decision, a question or an observation).

ORPHANS (notes with no stage in docs/ROADMAP_V2.md): none found.

<!-- TABLE -->
| ID | Title | Stage | Status | Evidence or reason |
| --- | --- | --- | --- | --- |
| N1 | Today: the filter bar is unclear | F5, F1, F8 | PLANNED-LATER | F1 part DONE: a hidden test account (or any filtered-out account) is excluded from every number on every page, proven by scripts/check-filter.ts (5 filters, 37 pages, three pages that ignored the filter fixed). Still F5 and F8: show what is hidden and why, plain filter help, the owner marking test accounts in Settings |
| N2 | Today needs a client-account (sub-account) version | F5 | PLANNED-LATER |  |
| N3 | UI/UX redesign: "it looks somehow not sweet" | D0, D1 | PLANNED-LATER | D0 part DONE: approved direction, light and dark tokens, plain status words and notices, quiet status line, one page template (docs/features/D0.md). D1 rolls the polish over every page and verifies both themes |
| N4 | Today: the "When this is sent" card at the bottom | F9, F5, F8 | PLANNED-LATER |  |
| N5 | Today: "Not watched yet" card, ship what is doable | F2, F4, F9, F8 | PLANNED-LATER | F4 part BLOCKED: stored conversations show 34 real conversations ending in a call but keep no call result, so missed calls cannot be built or verified; the page says 'result not known'. Needs one live read of a call message's fields (see NEEDS_KING) |
| N6 | Things I noticed in the same screenshots | F1, F5 | DONE-TONIGHT | F1: no percentage change below a base of 10 (5,000 dollars) on Today, the executive summary and Leads growth (f1-rules.test.ts, digest-intel.test.ts, tests/e2e/f1.spec.ts); the single-deal headline now says when one deal is most of the figure (audit-intel.test.ts, UX-04); 'counted at risk' is now plain words; the freshness part was S0.4 |
| N7 | Dead ends: no way back | F5, F6, D1 | DONE-TONIGHT | F6: every audit Open button says where it goes (openLabel, tested against the menu), the shell's Back link returns to the audit; d0.spec updated, share-print.spec added (not run) |
| N8 | A client-account filter wherever data is shown | F1, F5, D0 | DONE-TONIGHT | F6: the audit, its lists and its share link respect the page filter (session.tsx sends it on audit/share); check-audit.ts filter checks written, not run |
| N9 | Status text and notifications should not sit in cards | D1, F5 | PLANNED-LATER | D0 part DONE: freshness is quiet text, notices are one plain row with a rule (InlineAlert), content stays in cards; the old tinted boxes on the M1 pages are replaced. Other pages adopt it in their stages and D1 |
| N10 | Design quality: "not human built", "the gauge looks child built" | D0, D1 | PLANNED-LATER | D0 part DONE: design tokens with measured contrast, /design style guide, one HTML chart approach with labelled scales, tooltips, placeholders, sparkline, ranked rows (no gauge: documented why), fewer boxes. D1 rolls it over every page |
| N11 | "SLA" is jargon | F4, F5 | DONE-TONIGHT | F4: page named Unanswered messages; 'SLA' removed from screens, alerts, digest, score notes, export header and errors and kept out by src/lib/__tests__/f4-wording.test.ts; plain headline with a tap-to-explain on 'your reply target'. Whole-app jargon pass (engagement score, dormant, stale, P90) is the copy audit |
| N12 | Filter by how long someone has waited, with a better view | F4 | DONE-TONIGHT | F4: wait chips with counts, channel, client account and assigned-to choices, longest-wait-first or newest-first, per-person saved views (table saved_views); rules in src/lib/analytics/waiting-view.ts with 19 tests; browser test tests/e2e/f4.spec.ts written, not run |
| N13 | Why is "Older than a week (13)" hidden? | F4 | DONE-TONIGHT | F4: tabs Last 7 days / Older / Unread with counts equal to their rows (tested for every combination of choices) and the first three rows of the other tabs always shown |
| N14 | Long lists make the page unusable | F4, D0 | DONE-TONIGHT | F4: every list on Unanswered messages and the moved deals list is the shared DataList (10 rows, View all, pages of 25); summary charts above the lists; 'Open deals with no contact' now a Pipeline tab (No recent contact) with 7, 14 and 30 day choices |
| N15 | The Inbox page contradicts itself on numbers | F1, F4 | DONE-TONIGHT | F1 rules kept; F4: Unread tab = every unread conversation (Today's number), wait chart built from the same rows as the list (waiting-view.test.ts), moved deals keep the F1 counted-deal query |
| N16 | Health labels contradict "Needs attention" | F1 (item 3), F5 | DONE-TONIGHT | F1: the health label is held down by waiting customers (5 waiting: at best Watch, 15: At risk) and nothing in a Needs attention list is Healthy or Thriving; real: KD Squares LTD 21 waiting was Healthy, now At risk (f1-rules.test.ts, tests/e2e/f1.spec.ts) |
| N17 | Progress seen | none (progress note) | NOT-A-CODE-ITEM | an observation that earlier fixes landed; the item it left open (the stale-deal tile driven by one deal) is now handled by the single-deal guard, see N6 and UX-04 |
| N18 | Same conversation appears in three accounts | F2 | PLANNED-LATER |  |
| N19 | Design still "not mature" on Speed to lead, Appointments and Insights | D0, D1 | PLANNED-LATER | D0 part DONE for Speed to lead and Appointments: shared list and notices, trend chart with scale, tooltip and placeholder, plain badges; the Appointments Insights tab and the heatmap are F3 and D1 |
| N20 | Smart Lists and dialing | F10 | PLANNED-LATER |  |
| N21 | Show names and photos, not IDs | F2, F8 | PLANNED-LATER | F4 part DONE: Unanswered messages shows team member names (never ids), 'No owner', and a note when names are missing; 'Former team member' skipped (no record of removed users). F2/F8 remain (appointments, people, leaderboards, users permission prompt) |
| N22 | "Not enough data" without a reason | F2 | PLANNED-LATER |  |
| N23 | Empty charts look broken | F2, D1 | PLANNED-LATER |  |
| N24 | Appointments "To do" tab is blank and vague | F3 | PLANNED-LATER |  |
| N25 | Appointment details and statuses | F3 | PLANNED-LATER |  |
| N26 | Appointment Insights: unexplained graphs, no way to adjust | F3 | PLANNED-LATER |  |
| N27 | Sales team accountability: setters and closers | T1 (never tonight) | NEEDS-KING | King must define setter and closer before T1 starts |
| N28 | Structure first | D0 | DONE-TONIGHT | D0: the structure exists and is tested: pilot menu in plain groups, one page template, module tabs, one filter bar, one list, one lead drawer, one alert style, one status line, one empty/error/skeleton set (src/app/app/ds, nav.ts; tests/unit/ds-components.test.ts, tests/e2e/d0.spec.ts, menu.spec.ts) |
| N29 | Easy for everyone | D0, D1, F5 | PLANNED-LATER | D0 part DONE: My day (phone-first, 48 px tap targets, one column, plain words) for a client's staff, tested at 390, 768 and 1440 px (tests/e2e/d0.spec.ts). F5 and D1 continue |
| N30 | More observations on Speed to lead | F2 | PLANNED-LATER |  |
| N31 | Good things worth keeping | none (keep list) | NOT-A-CODE-ITEM | things to keep, no change |
| N32 | Meeting notes: what is it, from what, and what do the switches do? | E2a (E1 later), D0 | PLANNED-LATER |  |
| N33 | Auto-sync is not running: "Last synced" keeps growing | S0.4 | DONE-TONIGHT | S0.4: diagnosed from the live job table (bursts of 82 to 489 min before 06:25 UTC on 31 Oct: the 5 minute cron could not run on the Hobby plan; then a steady 20 min, not 15, from a finish-based due rule): due rule fixed, simulated-scheduler tests, one freshness line, internal alarm and diagnostics. The 15 minute cadence is NOT VERIFIED LIVE until the merge (docs/features/S0.4.md, docs/NEEDS_KING.md section 15) |
| N34 | Filters must adapt to who is looking | D0 | DONE-TONIGHT | D0: one filter bar whose controls follow the person (agency: client accounts, kind of business, owner, test accounts; client staff: person, calendar, pipeline, source, time; none on a single-account page), remembered, carried in the address, said in words incl. which accounts are in and left out (src/lib/design/filters.ts, ScopeFilterBar; ui-logic.test.ts, ds-drill-range.test.ts, e2e d0 'WHICH client accounts'). The server applies industry, owner, test and the new accounts= picks (scripts/check-filter.ts extended, NOT RUN); wiring user, calendar, pipeline, source and range to numbers is each page stage |
| N35 | Contact search is plain: merge it and build paying features around it | F10, D0 | PLANNED-LATER |  |
| N36 | Pipeline is one endless page | P1 (never tonight), D0 pattern | PLANNED-LATER | D0 pattern DONE: ModuleTabs, one sub-navigation pattern (used for People, Pipeline, Setup, Appointments). The Pipeline rebuild is P1 |
| N37 | Forecast trust: "why should they trust your forecast? how are you calculating?" | F1, P1 | PLANNED-LATER | F1 part DONE: minimum sample, a How this is calculated drawer, owner-set stage probabilities (labelled as assumptions), timing from each pipeline's real sales cycle, a range with a stated confidence, deals out of play excluded (pipeline-intel.test.ts, check-stage-rules.ts, tests/e2e/f1.spec.ts). NOT built: forecast versus actual each month (needs a month of recorded forecasts and 20 closed deals: P1) |
| N38 | Stage awareness: closed-out stages and junk pipelines flagged as dead or risky | F1, P1 | DONE-TONIGHT | F1: the owner classifies stages (active, closed out, ignore) and pipelines (in use, not in use), starting from name suggestions the screen states; excluded stages never count as open pipeline, stale, dead or forecast; absurd ratio texts dropped. Real: 13 of 80 stage pairs closed out by name, 1,033 open deals (f1-rules.test.ts, tests/unit/f1-deal-scope-db.test.ts, scripts/check-stage-rules.ts) |
| N39 | The pipeline-over-time chart shows a definition change as a trend | F1, P1 | PLANNED-LATER | F1 part DONE: snapshots carry a definition version and history is only compared inside one version; the chart says what it left out (tests/unit/f1-deal-scope-db.test.ts, f1-rules.test.ts). Axes, labels and a tooltip on the chart are P1 and D1 |
| N40 | "Clients should live in SubSync": a safe actions layer with write scopes | W1 (never tonight) | PLANNED-LATER |  |
| N41 | Payments module idea | R1 | PARKED | waits for evidence and King's decision |
| N42 | In-app notification centre | F9 | PLANNED-LATER |  |
| N43 | More observations on these screens | none (observations; menu in D0, junk data in F1) | NOT-A-CODE-ITEM | observations folded into D0 and F1 |
| N44 | Leads page: too many cards, and what is each data point for? | F1, D0, D1 | NEEDS-KING | docs/DATA_POINTS.md written: 116 rows with a recommendation each; nothing was cut. King approves the cut list (docs/NEEDS_KING.md section 16); sub-tabs for Leads are D0 and D1 |
| N45 | "Quiet over 90 days: 100%" and "never engaged: 52,926" look wrong | F1 | DONE-TONIGHT | F1: cold lists (tags the owner marked, or named like cold outreach) are counted apart; working leads are split into seen in 90 days, engaged then quiet, nothing seen, from conversations, appointments and deals, with the limit stated. Real: 50,958 of 52,926 contacts on cold lists, 275 working leads engaged then quiet (tests/unit/f1-deal-scope-db.test.ts, f1.spec.ts) |
| N46 | Zero invalid emails and phones across 52,926 contacts is implausible | F1 | DONE-TONIGHT | F1: invalid, disposable and missing are counted apart as N of M checked, with Not checked and the reason when a check could not run; the SQL and JavaScript validity rules are proven identical by a database test (it fixed two differences). Real: 0 invalid emails of 50,891 checked, 2,035 missing |
| N47 | Source data is 99% "Unknown" | F1, F2 | PLANNED-LATER | F1 part DONE: sources grouped by kind and 99% no source opens with an action and three steps (f1-rules.test.ts). The Speed to lead side and the Meta lead-form recognition on live data are F2 |
| N48 | "Same person in several client accounts (23)" is a privacy problem | S0.2b, F1 | DONE-TONIGHT | S0.2b: card, query, tile and count removed, nothing compares people across clients; meeting matching never picks between clients (docs/features/S0.2b.md items 1, 19, 20) |
| N49 | Tags: what do they mean, and can I see the leads that were tagged? | F10 | PLANNED-LATER |  |
| N50 | Lead side panel, the Kit model | D0, F10 | PLANNED-LATER | D0 part DONE: LeadDrawer (profile, tags, source, owner where known, deals, timeline, previous and next arrows through the list it was opened from, quiet Open in your CRM through the white-label link), used from Speed to lead, drilled chart lists and My day. Other lists, notes, tasks and calls slots: F10 and W1 |
| N51 | Leads as a working surface | F10 (read-only part), W1 (never tonight) | PLANNED-LATER |  |
| N52 | Light and dark mode, and following the agency's brand | D0, D1 | PLANNED-LATER | D0 tokens part DONE: light and dark themes as tokens with a one-tap choice, the company's colour applied on top and made readable (accentTokens, tested). D1 verifies every page in both themes |
| N53 | Call lists should actually support calling | F10 | PLANNED-LATER |  |
| N54 | Call lists fail with a 504 | F10 | PLANNED-LATER |  |
| N55 | Third-party dialers, for example Kixie | F10 | PLANNED-LATER |  |
| N56 | Accounts versus Clients: same rows, two pages | C1 | PLANNED-LATER |  |
| N57 | Client billing health: who has paid, who is defaulting | R1 | PARKED | needs financial scopes and evidence first |
| N58 | Clients > Details: what is it for? | C1, F5 | PLANNED-LATER |  |
| N59 | Client requests (support tickets) | C1b (never tonight) | PLANNED-LATER |  |
| N60 | Compare two is weak, and what is the QBR for? | C1 | PLANNED-LATER |  |
| N61 | Team module: a real directory with activity | T1 (never tonight) | PLANNED-LATER |  |
| N62 | More observations | F1, C1 (observations) | PLANNED-LATER | F1 part DONE: the Accounts health label contradiction (same as N16) and the singular fix (1 contact asked, no page says 1 contacts: tests/e2e/f1.spec.ts); the N33 update was S0.4. The Ignored filter being easy to find stays C1 |
| N63 | Setup is thin: it needs a real checklist system | C1, D0 | PLANNED-LATER | D0 structure part DONE: the page template and tabs a checklist module needs; the checklist system is C1 |
| N64 | "Why is an API marked unavailable when it is available?" and "turn on all scopes" | F1 (capability matrix), F8 (scope experience); release in Z2 (King) | PLANNED-LATER | F1 part DONE: docs/CAPABILITIES.md (three causes, every data point, permissions asked and granted per install, stored evidence), classifyProbe, and /api/admin/capabilities for the live column (NOT VERIFIED LIVE until one call after the merge). The UI scope experience is F8, the release is Z2 |
| N65 | Email sender health: vague, no data | E5 (never tonight) | PLANNED-LATER |  |
| N66 | Reselling profit dashboard | R1 | PARKED | waits for evidence |
| N67 | Duplicates: no filters, no cause, no source | C2 (never tonight) | PLANNED-LATER |  |
| N68 | Duplicate labels mean nothing to non-technical users | C2 | PLANNED-LATER |  |
| N69 | The duplicate score is wrong when names differ | C2 | PLANNED-LATER |  |
| N70 | Merging from SubSync: possible, but only with a clear plan | C2 | PLANNED-LATER |  |
| N71 | Data cleanup: what is it for? Merge Duplicates into it | C2 | PLANNED-LATER |  |
| N72 | Compare setups and Industry playbooks (King did not comment) | C1, D1 | PLANNED-LATER |  |
| N73 | Observations on these screens | S0.2b (N48), C1, C2 | PLANNED-LATER |  |
| N74 | Freshness: two statements, and only one can be the truth | S0.4, D0 | DONE-TONIGHT | S0.4 made the one freshness line; D0 restyled it as quiet text and exposes it as the shared StatusLine, drawn once by the shell (tests/unit/freshness-one-source.test.ts updated and passing, 7 tests) |
| N75 | Trust for a Nigerian-built product selling abroad | F8 (Trust page); Z2, Z3 (King) | PLANNED-LATER |  |
| N76 | Settings: one long page, and it needs advanced features | F8, D0, D1 | PLANNED-LATER | D0 part DONE: the sub-navigation pattern and plain groups exist; Settings itself is F8 and D1 |
| N77 | Meeting notes privacy and how meetings work: what each setting does, and a contradiction | F8 (wording), E2a | PLANNED-LATER |  |
| N78 | Speed to lead settings: who does the replying, and is it working? | F2 | PLANNED-LATER |  |
| N79 | Slack: do we still need the pasted web address? Notification options and editable copy | F9 | PLANNED-LATER |  |
| N80 | "Send at" cannot work with a once-a-day refresh | S0.4, F9 | PLANNED-LATER | S0.4 part DONE: hourly dispatchers, Send at honoured in the chosen time zone with a 3 hour catch-up and one send per local date (src/lib/__tests__/dispatch-time.test.ts: Lagos, New York clock changes, Tokyo, Kolkata, Sydney); the Sync status panel says exactly what runs and when. Preferences matrix and per-type scheduling remain F9 |
| N81 | Connection health and Data sync cards | S0.4, F8 | PLANNED-LATER | S0.4 part DONE: one Sync status panel (last refresh per account, next refresh, failures with plain reasons, what a check is, what runs when) replaces Connection health and Data sync. F8 reorganises Settings and may re-word it |
| N82 | Links: the login address is a manual field | S0.2b (item 4) | DONE-TONIGHT | S0.2b: domain found at sign-in and in the install event, stored per company, Settings field is only an override (and a save no longer freezes it); wording scan widened. NOT VERIFIED LIVE: a real signed install event (docs/NEEDS_KING.md section 13) |
| N83 | "What we store" and "Delete my data": good for trust, but check they are true | S0.2b, F8 | DONE-TONIGHT | S0.2b: src/lib/data-inventory.ts checked against the live schema, Settings card, privacy page and help text produced from it, uninstall and Delete my data tested against real rows, Delete my data owner-only with typed word and audit entry. The Trust page wording stays with F8 |
| N84 | Client access: the promise must be proven | S0.2b, F8 | DONE-TONIGHT | S0.2b: tests/unit/client-access.test.ts and the N84 block of scripts/check-tenancy.ts (two real companies, secrets searched in every client answer, access off is immediate); found and fixed two leaks. F8 only re-words the promise |
| N85 | Brand settings exist | F8, F6, D1 | DONE-TONIGHT | F6: print layout and shared page carry the sender's name and colour (print.ts, report.tsx; check-audit-print.ts real print engine A4 and Letter). Logo SKIPPED: none stored (F8/D1) |
| N86 | Roadmap page: how does "Coming next" work, does it notify me? | F8 | PLANNED-LATER |  |
| N87 | Getting started needs a real guide, and a feedback field | F8 | PLANNED-LATER |  |
| N88 | Operating principles for Claude Code (applies to every stage) | CLAUDE.md principles | NOT-A-CODE-ITEM | operating principles, saved in CLAUDE.md |
| N89 | UI/UX revamp needed on Settings and What's new too | F8, D1 | PLANNED-LATER | D0 part DONE: the shared page, tabs and notices are ready for Settings and What's new; the revamp is F8 and D1 |
| N90 | Status of the old work | none (status note) | NOT-A-CODE-ITEM | a status note |
| N91 | Zoom connect fails: "Zoom did not say who signed in" | E0 (copy), E1 later | PLANNED-LATER |  |
| N92 | Slack connect fails again, and Connections is stuck on "Waiting for you..." | E0, F9 | PLANNED-LATER |  |
| N93 | "If nobody in a meeting is a known contact, save it in [client account]" makes no sense | S0.2b, E0, E2a | PLANNED-LATER | S0.2b part DONE: setting removed everywhere, stored value migrated (backup and counts in docs/features/S0.2b.md), tested that no path writes a meeting to a contact not matched by exact email. The private Meeting inbox is E0 and E2a |
| N94 | Connections must be personal, not assigned by the agency | E0 | PLANNED-LATER |  |
| N95 | Every role must be able to connect | E0 | PLANNED-LATER |  |
| N96 | Where to save: contact note or conversation comment, and note size limits | E0, E2b | PLANNED-LATER |  |
| N97 | What to save: recording, transcript, summary, both, or custom | E2b | PLANNED-LATER |  |
| N98 | Several sales teams | E0, F9, F10 | PLANNED-LATER |  |
| N99 | Our own writes can distort our own numbers | E0 (with F2 and F4 tests) | PLANNED-LATER |  |
| N100 | CFO view: scope and order for meeting notes | none (CFO view) | NOT-A-CODE-ITEM | scope advice, already applied in the roadmap order |
| N101 | Zoom facts to design around | E1 (never tonight) | PLANNED-LATER |  |
| N102 | Consent and sensitive content | E0, E2a, E2b, F8 | PLANNED-LATER |  |
| N103 | Prove the code really reads and writes the live Supabase database | E0, E2a | PLANNED-LATER |  |
| N104 | Fathom data into custom fields, and who configures what | E0, E2b | PLANNED-LATER |  |
| UX-01 | [S1] Win rate and forecast built on 6 closed deals | F1 | DONE-TONIGHT | One 20-deal minimum on every screen; the forecast is a range from 20 closed deals or the owner's own probabilities (consistency.spec.ts, pipeline-intel.test.ts); real accounts say No forecast yet (6 closed deals) |
| UX-02 | [S1] Two different open pipeline numbers | F1 | DONE-TONIGHT | One counted-deal definition on every screen (scripts/check-filter.ts); the Leads lifecycle says in one sentence how many contacts in an open deal have a counted deal (9,171 against 1 on the real agency); tests/e2e/f1.spec.ts |
| UX-03 | [S1] Meeting notes page states something no longer true | F8 | PLANNED-LATER |  |
| UX-04 | [S1] First screen headline is one test deal | F1, F5 | DONE-TONIGHT | The audit's stale-deal headline says when one deal is most of the figure (audit-intel.test.ts) and the front door leads with leads waiting (tests/e2e/today.spec.ts) |
| UX-05 | [S1] Agency user opened inside a client account lands on the agency view | F5 | PLANNED-LATER |  |
| UX-06 | [S2] Sync-running banner on almost every load | S0.4 | DONE-TONIGHT | S0.4: the note shows only for a first sync or one queued or running 10 min or longer (freshness.test.ts, sync-reliability-db.test.ts, check-sync.ts, tests/e2e/freshness.spec.ts asserts none on any page) |
| UX-07 | [S2] Clipping at narrow widths | D0, D1 | PLANNED-LATER | D0 part DONE: no sideways scroll on Today, Speed to lead, Appointments, Account audit and Overview at 390, 768 and 1440 px (tests/e2e/d0.spec.ts; found and fixed a 1050 px page at 768); lists wrap on a phone with container queries. Other pages: D1 |
| UX-08 | [S2] Clients page mostly n/a | C1 | PLANNED-LATER |  |
| UX-09 | [S2] Visual sameness | D0, D1 | PLANNED-LATER | D0 part DONE: fewer boxes on the M1 pages (rules and spacing instead of nested cards), plain status words, varied blocks; D1 finishes every page |
| UX-10 | [S2] Too much text before the content | D0, D1 | PLANNED-LATER | D0 part DONE: Page clamps the subtitle to two lines and a test keeps the M1 subtitles at 120 characters or fewer; other pages: D1 |
| UX-11 | [S2] Navigation has 20 items | D0 | DONE-TONIGHT | D0: the menu is the pilot menu (Today, My day for clients, Speed to lead, Appointments, Unanswered messages, Account audit, Clients, People, Settings, Getting started, What's new) with Overview, Accounts, Team, Pipeline and deals, Setup, Duplicates, Data cleanup under More; nothing removed (tests/unit/ds-components.test.ts 'the menu structure', tests/e2e/menu.spec.ts) |
| UX-12 | [S2] Call lists spins for more than 5 seconds | F10 | PLANNED-LATER |  |
| UX-13 | [S2] Persistent filter bar pushes content down | F5, D0 | PLANNED-LATER | D0 part DONE: the filter drawer is drawn only when there is something to choose (and says what is hidden even when closed); F5 finishes Today |
| S3-a | [S3] Team shows unresolved names (Team member ZWol) | F2 (N21) | PLANNED-LATER |  |
| S3-b | [S3] Duplicates tile shows a scary exact-match number from test data | C2 (never tonight) | PLANNED-LATER |  |
| S3-c | [S3] Meeting notes explainer uses numbered steps for tools most users lack | F8, E2a | PLANNED-LATER |  |
| S0-none | [S0] No S0 blocker confirmed in the review (nothing to fix) | none | NOT-A-CODE-ITEM | the review found no S0 |
| KF-4 | Per-card date range and comparison controls | D0, F2, F3, F6, F4, F5, F10, C1 | PLANNED-LATER | King's live feedback |
| KF-1 | Pills and banners look AI (plain status text, plain banners) | D0, all stages | PLANNED-LATER | King's live feedback |
| KF-2 | Filter must list which client accounts are included | D0, F5 | PLANNED-LATER | King's live feedback |
| KF-3 | Dial through the CRM's own dialer, not the native phone app | F10, F2, F3 | PLANNED-LATER | King's live feedback |
| KF-5 | Think like the customer and make things easier (guides, defaults, next steps) | every stage | PLANNED-LATER | King's live feedback |
| KF-6 | Clickable charts: click a bar or slice to see the leads, click a lead for details | D0, all chart stages | PLANNED-LATER | King's live feedback |
| KF-7 | Clients module: fees and renewals unexplained, demo shows none | C1 (demo seed too) | PLANNED-LATER | King's live feedback |
