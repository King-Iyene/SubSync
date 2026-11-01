# SubSync: King's Review Notes (running ledger)

**Status: complete (9 batches, 104 notes). Compiled into `docs/ROADMAP_V2.md`, which orders the work and holds the stage prompts. This file holds the full text of every note, referenced by ID (N1 to N104).** Save it in the repo as `docs/KING_REVIEW_NOTES.md`.

Labels: **[KING]** = King's own observation. **[MINE]** = something I noticed in the screenshots. **[READING]** = my interpretation of an unclear note (King to confirm).

---

## BATCH 1 (Today screen, Oct 31/Nov 1)

### N1. Today: the filter bar is unclear [KING]
- **Seen:** the first thing on Today is "Show only: All industries (3)" and a checkbox "Hide 1 test account".
- **King's note:** he does not know what "industry" means or does, and does not know how the test filter works. It must be obvious so users can see it.
- **Why it matters:** if the owner cannot tell what it does, a buyer will not either. It also sits above the content, before the user learns what the product is for.
- **To do:** plain labels and one line of help. Say where "industry" comes from (an account setting? the CRM's business type? who sets it?) and what the number in brackets counts. Say what counts as a test account (name contains "test"? a manual switch?). Show what is hidden and why ("1 account hidden: KD Squares Test. Show it"). Let the owner mark or unmark test accounts in Settings. Make sure hidden test accounts are excluded from every number on every screen, not only Today.
- **Runbook stage:** F5 (Today), F1 (exclusion rule applied everywhere), F8 (Settings control). **Severity:** S1 (front-door confusion).

### N2. Today needs a client-account (sub-account) version [KING] [READING]
- **King's note (as written):** "we also need to have subaccount iketerm in the Today module".
- **My reading, to confirm:** Today should work for a client account on its own, not only the all-accounts view. That means (a) a Today screen for a client-account user showing only their account, (b) opening on the active account when launched from inside one, and (c) a way to drill from the all-accounts Today into one account.
- **Runbook stage:** F5, built on S0.2 (roles and tenant isolation). **Severity:** S1.
- **Confirm:** is this reading right, or did you mean something else (for example an account switcher)?

### N3. UI/UX redesign: "it looks somehow not sweet" [KING]
- **King's note:** the UI/UX needs a redesign.
- **What I see in the screenshot [MINE]:**
  - Four thin strips stack above the content (filter bar, last synced, page title row with a freshness pill and Sync button, sync banner). The page does not start until after them.
  - Border-only dark cards on a dark background look flat, like a wireframe.
  - Secondary text is small and dim. The page subtitle is long.
  - The big "Do this first" card has the strongest message but dense wording ("counted at risk").
  - The tiles are cut off at the bottom of the frame and use tiny comparison text.
- **Design brief for the redesign:** one status line instead of four strips; one hero card with large type; bigger numbers; stronger text contrast on dark; surfaces with depth (layers and soft shadows) instead of outlines; more space; a clear accent colour used sparingly; calm empty, partial and loading states; consider a light theme option; consistent spacing and components across pages. Inspiration only, not a copy of any competitor.
- **When:** one dedicated design pass after F5, once the numbers and content are stable, so we do not redesign twice. A short written design brief can be prepared now.
- **Runbook stage:** new stage "D1: design pass" after F5. **Severity:** S2, but important for first impressions and for King's confidence.

### N4. Today: the "When this is sent" card at the bottom [KING]
- **Seen:** "Not scheduled yet. Add a Slack webhook in Settings and switch on the daily brief... Email delivery needs an email service connected to the app. It is not switched on yet." with a "Set it up" button.
- **King's note:** this should not be there. Slack automation will be set up, so this note will go away.
- **Problems [MINE]:** it exposes our own setup status on an end-user screen ("an email service connected to the app" is a developer to-do, not a user task). "Slack webhook" is technical. It sits at the bottom of the front page.
- **To do:** remove the card from Today. Put daily-brief setup in Settings and Getting started. When the brief is on, show nothing on Today (a small "Daily brief: on, 8:00 your time" line in Settings is enough). Developer-facing status goes to an admin diagnostics page, not to users.
- **Delivery channel decision [KING]:** Slack automation for the daily brief and alerts. Keep email as a fallback.
- **Sequencing tension:** the runbook puts Slack in E3 (extras, after M2) and alerts in F9. Suggested resolution: build F9 so the alert channel is pluggable, with Slack incoming-webhook support included in F9 and email as the fallback. A full Slack app (OAuth for many workspaces) stays in E3. King to confirm.
- **Runbook stage:** F9, F5 (card removal), F8 (Settings). **Severity:** S2.

### N5. Today: "Not watched yet" card, ship what is doable [KING]
- **Seen:** "Missed calls: the platform does not give this app call logs yet. Failing workflows: the workflows API is in closed beta. Low wallet balance and failed payments: needs billing access the app does not request. Phone registration (A2P) status: not available through the API this app uses." Footer: "We list these so you never assume something is being watched when it is not."
- **King's note:** work on these and ship everything that is doable.
- **Assessment (all items are CHECK until Claude Code verifies in the live API):**

| Item | Likely doable? | How |
|---|---|---|
| Missed calls | Possibly yes | Call records may appear as call-type messages in conversations. That needs the optional conversation-messages scope, which F2 needs anyway (a first outbound call counts as a first response). CHECK fields and statuses (missed, voicemail, no answer) |
| Failing workflows | Not directly | The Workflows API is limited availability (some accounts get a 403). Instead detect the result: leads with no outbound message, SLA attainment dropping, appointments never marked. That is already the thesis. Relabel the card as "We watch results, not workflow settings" |
| Low wallet balance, failed payments | Unknown | CHECK whether the API exposes per-account wallet or payment data at all. It needs billing or payment scopes, which cost trust. Do not request them until we know it exists and King approves |
| Phone registration (A2P) status | Unknown, probably not | CHECK. If unavailable, offer a manual checklist item with a link instead of a fake watcher |

- **UX decision:** a list of four "not watched" items on the home screen undermines confidence. Keep the honesty, but move it to a "What SubSync watches" panel in Settings with two columns, Watching and Not yet. As items ship, they move across. Today stays clean.
- **Runbook stage:** F2 and F4 (missed calls), F9 (silent-failure alerts), F8 (the coverage panel). Wallet and A2P items wait for the CHECKs. **Severity:** S2 for the layout, S1 for shipping missed calls if it feeds the speed-to-lead numbers.

### N6. Things I noticed in the same screenshots [MINE]
- Three freshness messages at once ("Data is under an hour old", "Last synced 19m ago", "A sync is still running"). They contradict each other. One status line only.
- Tile comparisons like "-58% vs yesterday" and "-100% vs yesterday" on tiny numbers. These break the minimum-sample rule. Show no percentage change below a minimum size.
- The hero card is still driven by a single $1,000,000 deal. That is the S1 outlier problem from the buyer review, not yet fixed (consistent with Claude Code still working through the older list).
- "counted at risk" is unclear wording. Say what it means in plain words.
- **Runbook stage:** F1, F5.

---

## BATCH 2 (Overview, Inbox & SLA, deals list, navigation, design)

### N7. Dead ends: no way back [KING]
- **King's note:** from Account audit, clicking "Open" goes to Pipeline and deals, with no way to go back.
- **To do:** a back link or breadcrumb on every drill-in ("Account audit > Pipeline and deals"). The browser Back button must work. Keep the context when returning (selected account, filters, scroll position). Label every Open or Reply button with where it goes ("Open in Pipeline", "Reply in your CRM").
- **Runbook stage:** F5 and F6, then D1. **Severity:** S1 (dead end).

### N8. A client-account filter wherever data is shown [KING]
- **King's note:** Overview, Account audit, and any page that shows general data needs a sub-account (client account) filter, and the UI for it must be good.
- **To do:** one persistent selector in the page header: "All accounts" by default, multi-select, with search. The choice carries across pages and into the link. It replaces and absorbs the industry and test-account filters from N1. Every number, list, and chart on the page respects it. Role-aware: a client-account user sees only their own account. Add a consistency test that the same filter gives the same numbers on every page.
- **Runbook stage:** F1 (numbers respect the filter), F5, then every page stage and D1 for the look. **Severity:** S1.

### N9. Status text and notifications should not sit in cards [KING]
- **King's note:** "Last synced" does not need to be in a card. Notifications should not be in a card either.
- **To do:** show freshness as quiet header text ("Updated 6 min ago. Sync now"). Use one lighter inline alert style, or a notification area, for messages like the "Critical" strip, "Newest first: these are the ones still worth answering", and sync status. Content cards are for content only.
- **Runbook stage:** D1 and F5. **Severity:** S2.

### N10. Design quality: "not human built", "the gauge looks child built" [KING]
- **King's note:** the app needs restructuring, including the colours and effects. The cards do not look human built. The gauge looks like a child built it, not advanced. He wants Claude Code to call on its best UI/UX design skills.
- **[READING]:** the "gauge" is the segmented Account health bar and the waiting-time bars. King to confirm.
- **What I see [MINE]:** almost everything is the same bordered rounded card. Some cards sit inside cards. The look is flat, with dim secondary text. Charts are plain bars with no scale, no trend, no sparkline.
- **To do:**
  1. Use Claude Code's frontend-design or UI/UX skill if it is installed (if not, tell King how to install it).
  2. Build a design system first: colour tokens (neutral layers, one accent, status colours reserved for status only, contrast checked), type scale, spacing scale, radii, elevation, motion rules, and a shared component library (replace one-off styling).
  3. Build a `/design` style-guide page showing the tokens and components. **King approves the direction before it is rolled out.**
  4. Rework data visualisation: proper distribution charts with labelled scales, sparklines for trends, a gauge only where it adds meaning, one chart library used consistently.
  5. Fewer boxes: use whitespace, dividers, and hierarchy. Avoid cards in cards. Vary layouts so pages do not all look alike. Subtle motion (number count-up, skeleton loading, hover and focus states).
  6. Then roll out page by page.
- **Runbook stage:** D1 (after F5). **Severity:** S2, but important for first impressions.

### N11. "SLA" is jargon [KING]
- **King's note:** what does SLA mean on Inbox and SLA?
- **To do:** rename the page (for example "Unanswered messages" or "Reply speed"). Say it plainly: "Anything waiting longer than your reply target (4 hours) is late." Replace "SLA breach" and "Waiting past SLA" with "Waiting past your 4h reply target". Add tap-to-explain for any term that stays. Run a jargon pass over the whole app (SLA, engagement score, dormant, stale, P90).
- **Runbook stage:** F4, F5, and the copy audit. **Severity:** S2.

### N12. Filter by how long someone has waited, with a better view [KING]
- **King's note:** add a filter by how long customers have waited without a reply.
- **To do:** filter chips (over 4 hours, 24 hours, 48 hours, 7 days, older), sort by longest wait, plus filters for channel, client account, and assigned user. A proper table with sortable columns. Saved views.
- **Runbook stage:** F4. **Severity:** S2.

### N13. Why is "Older than a week (13)" hidden? [KING]
- **King's note:** it is collapsed behind a "Show" link with not even a small preview. Why?
- **Why it happens [MINE]:** the page text treats those as "not urgent", so it hides them. King's point stands: hiding them looks like hiding a problem, and the same 13 are counted in the 26 on Overview.
- **To do:** use tabs or a segmented control: "Last 7 days (13) | Older (13) | Unread (259)". Always show the count, and show a small peek (the top 3 oldest) with an expand. Nothing is hidden by default.
- **Runbook stage:** F4. **Severity:** S2.

### N14. Long lists make the page unusable [KING]
- **King's note:** the Unread list prints every row, so with many unread you scroll the whole list to reach the next sections. A subsection is needed. The same applies to the deals list and others on Inbox and SLA.
- **To do:** every long list shows 10 rows by default with "View all" that opens a paginated or virtualised table (in a drawer or its own page), with sticky filters. Summary charts sit above lists. The "Active deals with no contact" section belongs under Pipeline and deals, not on the Inbox page. Make this a shared component used app-wide.
- **Runbook stage:** F4, with a shared list component built once, then used by every page. **Severity:** S2 (app-wide).

### N15. The Inbox page contradicts itself on numbers [MINE]
- The lists show 13 waiting past 4 hours in the last 7 days plus 13 older, which is 26 and matches Overview.
- The wait-time chart shows 255 customers waiting more than 4 hours, and a red "Critical: 254 customers have waited more than 24 hours". Those include unread conversations that are 750 or more days old. An alarm built on ancient data contradicts the 26 and will cause alarm fatigue.
- The Unread list (259) includes rows like "You replied via sms 12d ago". Unread is not the same as waiting for a reply.
- Today says 285 unread and Inbox says 259. The difference is 26, which equals the waiting count. Possible double counting or a union of two lists. Verify.
- "Active deals with no contact for 7+ days (3,000, $2,400,000)" conflicts with Overview ("1 of 1 open deals have not moved", 10,373 other deals excluded). The 3,000 is a round number and may be a query cap. 2,707 of those deals are $0 cold-outreach deals.
- **To do:** one set of definitions in METRICS.md. Waiting means the last message is inbound with no outbound after it, within a stated window that is always labelled. Unread is defined separately. The wait chart uses the same set as the list. Ancient conversations go in an "Older" or archive bucket and never count as "Critical". If a list is capped, say "showing the first 3,000".
- **Runbook stage:** F1 and F4. **Severity:** S1 (trust).

### N16. Health labels contradict "Needs attention" [MINE]
- On Overview, "Needs attention" lists KD Squares LTD with 23 conversations waiting over 4 hours, but badges it "Healthy" and "Low risk". Niger Delta Innovate is also "Healthy" with 1 waiting. An account with 23 waiting leads should not look healthy.
- **To do:** include reply delay in the health score, and never show "Healthy" inside a "Needs attention" list.
- **Runbook stage:** F7 and F5. **Severity:** S1.

### N17. Progress seen [MINE]
- Overview now shows "Not enough data" for estimates and explains why ("No account has 20 closed deals yet"), and states "10,373 open deals are left out of every dollar figure because they have no value or no owner". The F1 items are landing.
- Still open: the $1,000,000 stale-deal tile is driven by one deal.

### N18. Same conversation appears in three accounts [MINE, low priority]
- "The Real Estate Blueprint" shows in all three accounts with the same age and unread count. Probably one shared Instagram connection across King's own accounts, so it may be test data. CHECK that it is not double counted in totals.

---

## BATCH 3 (Speed to lead, Appointments, Insights, dialing, sales accountability)

### N19. Design still "not mature" on Speed to lead, Appointments and Insights [KING]
- **King's note:** these designs need restructuring, they are not mature.
- **Evidence in the screenshots [MINE]:** bars with no scale, a heatmap that is a grid of 1s, a table clipped on the right, many cards that only say "Needs at least 5...", and pages that are mostly empty explanations. Part of N10 (design system first).
- **Runbook stage:** D0 and D1. **Severity:** S2.

### N20. Smart Lists and dialing [KING]
- **King's note:** why is there no option to create a Smart List, with filters, and save it like in the CRM? People should be able to dial from it. If they can't dial inside SubSync, send them to the CRM's own dialer, or call the CRM's dialer.
- **Plan:**
  1. A filter builder with saved lists (per user and per team), cross-account and outcome-aware: yesterday's no-shows, leads never answered, no owner, appointments with no outcome, stale deals, plus custom filters and custom fields.
  2. A Dial button that opens the contact in the CRM's own dialer or phone view through the white-label link (CHECK whether a URL can open the dialer for a contact), and falls back to a phone link on mobile.
  3. Optional bridge: push a list to the CRM by adding a tag (needs the optional contacts write scope, with preview and confirm) so the CRM's own Smart Lists and power dialer can use it. CHECK whether the API can create Smart Lists or add contacts to the power dialer (probably not).
  4. Show DND and quiet-hours warnings before any dial.
  5. We still do not build telephony.
- **Runbook stage:** F10 (expanded). **Severity:** S2.

### N21. Show names and photos, not IDs [KING]
- **King's note:** the app shows only user IDs, which makes no sense. The CRM shows team members, so use the ID to get the name and profile.
- **To do:** resolve every user ID to a name and photo through the users API (the optional `users.readonly` scope; it must be re-approved on existing installs). Cache it. Show "Former team member" for deleted users. Never show a raw ID or placeholders like "Team member ZWol". If the permission is missing, show one clear prompt. Use consistent wording ("no owner" and "unassigned" mean the same thing, so pick one).
- **Where:** no-owner badges, Team, Appointments by person, Who replies fastest, every leaderboard.
- **Runbook stage:** S0.2 (roles), F8 (permissions), then every page. **Severity:** S1.

### N22. "Not enough data" without a reason [KING]
- **King's note:** Speed to lead says "Not enough data". Why?
- **What is happening [MINE]:** "Typical first reply" needs 5 replies and this account has 1, but the tile next to it shows a percentage (9%, 1 of 11). That is inconsistent and reads as broken.
- **To do:** show progress ("1 of 5 replies so far. Shows once 5 people have been answered"). Show raw counts first ("1 of 11 answered within 15 minutes"). Use "n/a", not "none". Use one minimum per metric, written in METRICS.md and visible in the UI. Offer a demo-data toggle so a small account can still show the full screen.
- **Runbook stage:** F2. **Severity:** S2.

### N23. Empty charts look broken [MINE]
- "Are replies getting faster? Last 8 weeks" shows eight empty bars. "Who replies fastest" is blank. The by-account table says "typical: none".
- **To do:** under the minimum, replace a chart with one placeholder saying what will appear and when.
- **Runbook stage:** F2, D1. **Severity:** S2.

### N24. Appointments "To do" tab is blank and vague [KING]
- **King's note:** the Appointments tab shows blank data and is too vague.
- **What I see [MINE]:** every tile is 0 and the headline still says "Bookings are down 100% on the 30 days before" (the minimum-size rule is not in yet). The Insights tab shows 29 booked over 90 days, so the 30-day window is just empty.
- **To do:** a status breakdown (booked, confirmed, showed, no-show, cancelled, invalid), an upcoming list, a date-range selector with the window stated, filters (client account, calendar, user or team, source), and empty states that say what to do next. Every count opens the list behind it.
- **Runbook stage:** F3. **Severity:** S1.

### N25. Appointment details and statuses [KING]
- **King's note:** show no-shows, cancellations and so on, plus booking details.
- **To do:** a detail view per appointment (contact, calendar, time, assigned user, who booked it, status and status history, source, link to the contact, call action).
- **Runbook stage:** F3. **Severity:** S2.

### N26. Appointment Insights: unexplained graphs, no way to adjust [KING]
- **King's note:** no way to edit. What does the graph show? There is no information. Find a better way to make it easy to understand.
- **To do:** under every chart, "What this shows", "How to read it", "What to do" (short, collapsible). A date range and the same filters. Editable targets (show-rate target and so on). Let users choose which widgets to show.
- **Specific problems [MINE]:**
  - Calendar health 60/100 gives points when there is no data (show rate "not enough outcomes yet" scores 15/40, confirmations "nothing upcoming" scores 10/25). A score built on missing data means nothing. Show n/a when inputs are missing. "0% of past appointments have none" is confusing wording.
  - "From lead to customer" shows Confirmed or showed 28 but Showed 5, which means outcomes were never marked. "Biggest leak: 100% are lost before Became customers" is a misleading claim on tiny data, and "customer" is not defined.
  - "Best times to book" is a grid of 1s with no colour (each cell needs 5 outcomes), so it carries no information.
  - "Show rate by lead source" is clipped on the right and mixes calendar names and forms as "sources".
  - Many cards only say "Needs at least N...".
- **Runbook stage:** F3, D1. **Severity:** S1 for the misleading score and claim, S2 for the rest.

### N27. Sales team accountability: setters and closers [KING] (the big one)
- **King's note:** the sales team will use Appointments a lot. It needs more features, appointment details, comparison, and data that GHL does not have. Which closer or setter is leading, with graphs, filtered by user or team (all are team members). Who is closing more, whose close rate should improve, which setter's appointments close more. Insights, leaderboard graphs, data filters, custom field data, reports.
- **What it needs:**
  - **Views:** leaderboards and graphs for bookings, show rate, close rate, and revenue by user and by team. Week-over-week trends and comparison with the team average and with targets. A "whose rate needs to improve" list.
  - **Attribution (CHECK each field in the live API):** who set the appointment (a "created by" or "booked by" field, versus a contact booking through a link), who is assigned (the closer), the outcome, and the opportunity won after the appointment with its value. "Setter" and "closer" are not CRM concepts, so Settings must let the owner mark each user as setter, closer, or both, and group users into teams.
  - **Definitions (written in METRICS.md and visible):** appointments set, show rate of appointments set, close rate (won deals divided by held appointments), revenue per closer, time from appointment to close, no-show and cancellation rates per setter.
  - **Trust and people safety:** every number opens the appointments behind it. The owner chooses who sees whose numbers (managers only, or the whole team). A minimum sample before anyone is ranked. No public ranking by default.
  - **Reports:** saved views and CSV export first. A full custom report builder is crowded space and comes later. Filters include custom fields.
- **Runbook stage:** new stage T1 after F3 (names from N21 and honest appointment data from F3 come first). This is also the cross-account setter leaderboard the research flagged as open space. **Severity:** S1 in value, large in scope.

### N28. Structure first [KING]
- **King's note:** sub-accounts will use it as well, so let's get the structure working.
- **Recommendation:** finalise the structure before more page-by-page work. Stage D0, right after S0.3 and before the page changes in F2 to F5, builds: sidebar grouping, the global client-account selector (N8), role-based views (agency versus client account), a page template, one shared list and table component with a detail drawer and back navigation (N7, N14), a shared empty-state component, a shared tooltip for definitions, one alert pattern (N9), and one status line. Keep D0 minimal; visual polish stays in D1.
- **Trade-off:** D0 adds hours before the sellable milestone M1. Decide at compile time.
- **Severity:** S1 structural.

### N29. Easy for everyone [KING]
- **King's note:** customers, sales teams, setters, realtors must all find it easy.
- **To do:** add personas P7 (setter or sales rep who needs "my list today" on a phone) and P8 (realtor: mobile-first, no jargon). Client-account users get a simple "My day" view, a mobile-first layout, large tap targets, plain words, and action-first screens.
- **Runbook stage:** D0, D1, F5, and the persona file. **Severity:** S2.

### N30. More observations on Speed to lead [MINE]
- The same lead ("the real estate blueprint") appears in three accounts and counts three times in "never answered". CHECK it is not double counted (likely King's shared test contact).
- Names show in lowercase ("the real estate blueprint", "abbi", "david"). Render in proper case.
- "By where the lead came from": 9 of 10 leads sit in "Other sources", so the table says nothing. This is F2 step 6 (recognise Meta, forms, calls, chat).
- "13 d 0 h" is clearer as "13 days".
- The amber "no owner" banner is another card (see N9).

### N31. Good things worth keeping [MINE]
- The Speed to lead footnote states the clock rule plainly, and the page refuses to rank people on too little data.
- "Record the outcome", "No-shows to rebook", and "Remind today" are the right questions for an Appointments page. They are just empty on this data.

---

## BATCH 4 (Meeting notes, Contact search, Pipeline, sync, act layer, payments)

### N32. Meeting notes: what is it, from what, and what do the switches do? [KING]
- **King's note:** what is on the Meeting notes tab? We need structure. Why do clients have to create a private address, and what is that for? Where do the notes come from? What does "turn off" do? Clients need this to be easy.
- **What the page does [MINE]:** it asks for a technical setup: create a private address (a webhook URL), paste it into Fathom, or build a Zapier or Make step for Zoom. A footnote says SubSync cannot write the note into the contact (no write permission), so each meeting has a "Copy note". Two addresses exist for the same account, one never used. "Turn off" disables an address, but the wording does not say so.
- **To do:** a plain headline ("After a Zoom or Fathom call, get a summary and action items on the lead"), one-click connect (OAuth) wherever the tool allows it, webhook addresses only under "Advanced", a Test connection button, one active address per account with "Regenerate", "Turn off" renamed "Disconnect", and plain words about what is stored (transcripts are not kept).
- **Strategy [MINE]:** this is outside the core thesis, and the Oct 31 review already hides it for the pilot. King's questions show it is not clear enough to ship. Keep it hidden until stages E1 and E2 prove its value and a one-click connect exists. Writing the note into the contact needs a write scope (see N40).
- **Runbook stage:** E1, E2, D0. **Severity:** S2.

### N33. Auto-sync is not running: "Last synced" keeps growing [KING + MINE]
- **King's note:** why does the system not sync on its own? A human has to click Sync.
- **Evidence [MINE]:** across the screenshots taken over roughly 40 minutes, "Last synced" read 19, 29, 31, 36, 44, 49, 55, then 56 minutes, with no refresh in between. The earlier review said data refreshes every 15 minutes. These screens show it did not during this period. A monitoring product that is an hour stale is not monitoring.
- **Likely causes to check:** scheduler limits on the hosting plan (CHECK Vercel cron limits), a stuck job queue, a job that only runs from the manual button, a token problem.
- **To do:** diagnose and fix. Real-time updates through webhooks for contacts, conversations, appointments, and opportunities (CHECK event names), plus a scheduled reconcile at least every 15 minutes. An internal alarm for us (not a user card) if sync is older than 30 minutes. Users see one quiet "Updated 4 min ago". Manual Sync stays as a fallback. A clear status when a sync fails. A test that simulates the scheduler.
- **Runbook stage:** new stage S0.4 "Sync reliability", before F2 (speed to lead needs minutes-level freshness). **Severity:** S1.

### N34. Filters must adapt to who is looking [KING] (extends N8)
- **King's note:** filters are needed in all the necessary places. The app is used by agencies and by sub-accounts, so sub-account users will see filters too.
- **Rule:** one filter-bar component with options chosen by role. Agency users get the client-account selector (multi-select), industry (if defined), test accounts, date range, plus the page's own filters. Client-account users get no account selector (they have one account) but get user or team, calendar, pipeline, source, date range, and custom fields. Filters are remembered per user, carried in the link, and every count opens the filtered list. Add a date range everywhere.
- **Runbook stage:** D0, then every page. **Severity:** S1.

### N35. Contact search is plain: merge it and build paying features around it [KING]
- **King's note:** it just searches. Merge it with Leads as a sub-module. We need features people will pay for. Contacts need filters and a system around them.
- **Recommendation [MINE]:** make search a global search box in the header (Cmd or Ctrl+K), because searching across accounts is the one thing the CRM cannot do. Merge Contact search, Leads, Call lists, and the hidden Duplicates into one module, "People", with sub-tabs: Search and filters, Smart lists (N20), Going cold (quiet leads, never answered, no owner), Duplicates (hidden by default). Paid value: saved smart lists, outcome-aware filters, a contact timeline, risk flags.
- **Runbook stage:** D0, F10. **Severity:** S2.

### N36. Pipeline is one endless page [KING]
- **King's note:** it is nice but everything is on one page and I have to scroll to find other features. The cards are not nice. I want a mature design. Each place needs its own sub-section.
- **To do:** one module sub-navigation pattern used everywhere (tabs or a left sub-nav, short views). Pipeline becomes Overview, Forecast, Stages and bottlenecks, Stale deals, Clean-up, Compare accounts, with about six blocks per view.
- **Runbook stage:** D0 (pattern), P1 (Pipeline rebuild). **Severity:** S2.

### N37. Forecast trust: "why should they trust your forecast? how are you calculating?" [KING] (very important)
- **What the screen shows [MINE]:** a 50% win rate from 3 won and 3 lost deals (the 20-closed-deals minimum is not applied on this screen yet). Likely revenue $1,200,000, which is open value times 50%. Best, likely, and worst of $1.8M, $1.2M and $0.6M. "Expected to close $1,200,000 within 30, 60 and 90 days": the same number for all three horizons, so there is no timing model at all. Open pipeline here is $2.4M, while Today says $1.0M. The "over time" chart is a bare line with no axes.
- **To do (trust rules):**
  1. Show no forecast below the minimum. Say "not enough data" and what unlocks it.
  2. Show the method on screen: a "How this is calculated" drawer with the formula, the inputs, the sample size, and which deals were included or excluded and why.
  3. Use stage probabilities. Until history exists, the owner sets a win probability per stage (editable defaults) and the screen labels them as the owner's assumptions.
  4. Timing comes from the real sales cycle of that pipeline, not a flat repeat.
  5. Show a range with a stated confidence, not a single number.
  6. Once history exists, show forecast versus actual each month. That is what earns trust.
  7. Exclude $0, ownerless, and not-in-use deals.
- **Runbook stage:** F1 (rules), P1. **Severity:** S1.

### N38. Stage awareness: closed-out stages and junk pipelines flagged as dead or risky [MINE]
- "Dead pipeline to clean up (10,292)" lists deals in stages like "Disqualified", "Bad Fit/Not Qualified", "Wrong Phone Number", and "Unreachable". Those are closed-out by design, so they are not dead pipeline. Deals in pipelines literally named "[Not IN USE]" show risk scores of 100 and texts like "Open 749x longer than deals that were won".
- **To do:** let the owner classify each stage (active, closed-out, ignore) and each pipeline (in use, not in use), with auto-suggestions from names ("not in use", "disqualified", "lost", "wrong number"). Excluded stages never count as open pipeline, stale, or dead. Drop absurd ratio texts like "749x longer".
- **Runbook stage:** F1, P1. **Severity:** S1.

### N39. The pipeline-over-time chart shows a definition change as a trend [MINE]
- "$2,400,000 to $1,000,000 over 2 days. Red dots mark unusual days." That is almost certainly the counting rule changing (all open deals versus counted deals), not real movement. Same cause as the earlier "-58% vs yesterday".
- **To do:** version the metric definitions. Re-baseline history when a definition changes, or mark the change on the chart. Never plot a series that mixes definitions. The chart needs axes, labels, and a tooltip. The page also says stage history is not kept, so start recording stage changes in the event store now.
- **Runbook stage:** F1, P1. **Severity:** S1.

### N40. "Clients should live in SubSync": a safe actions layer with write scopes [KING] (strategic decision)
- **King's note:** clients should not want to go back to the CRM. SubSync should make their work easier and help them open and close more deals, update forms and records, with write scopes, used very carefully.
- **My assessment [MINE]:** a bigger step than monitoring. Upside: stickiness and a higher price (workspace tools earn more). Risks: duplicating the CRM, data corruption, consent risk, more scopes to justify to GHL, and a much larger build.
- **Recommended path:** a safe actions layer in stages, each as a separate optional scope the owner grants:
  1. Record an appointment outcome (showed or no-show). This fixes the hygiene problem directly.
  2. Assign an owner to a lead that has none.
  3. Move, close (won or lost), or abandon a stale deal from the stale-deal list.
  4. Create a task or note on a contact.
  5. Add or remove a tag (feeds the CRM's own Smart Lists and workflows).
  6. Later: create a deal, update fields, forms.
  Not messaging, at least at first (compliance, and native workflows do it better).
- **Guardrails:** separate optional scopes per action group, role permissions per user, preview and confirm, an undo window, an audit log, bulk limits with a second confirm, every write recorded in the event store, and nothing outside this list. Data cleanup's preview and undo is the model.
- **Runbook stage:** new stage W1 after M2. **Severity:** S1 in value, large in scope. **Decision:** King to confirm the staged approach.

### N41. Payments module idea [KING] (needs research)
- **King's note:** read payments and transactions so people do not have to filter in the CRM: failed-payment rate and common causes, upcoming rebills and follow-up, money coming in, auto-create invoices, Slack alerts for upcoming rebills, in-app notifications.
- **Notes [MINE]:** this is the "Low wallet balance and failed payments" item on the "Not watched yet" card, which needs billing access the app does not request. Payments data is sensitive, so each scope carries a trust cost and needs a justification in review. CHECK: which payment, transaction, subscription, and invoice endpoints and scopes exist; whether failure reasons are available (they may exist only at the processor); whether upcoming rebills can be listed. Auto-creating an invoice is a write action and follows the N40 guardrails. Clarify whose payments these are: a business's own customers (a gym's members) or the agency's own billing.
- **Recommended placement:** a "Revenue protection" module after the core is trusted and validated by interviews. Read-only first (failed payments, upcoming rebills, a follow-up list), with Slack and in-app alerts. Optional invoice actions later.
- **Runbook stage:** new module R1 after M3. **Severity:** S2 for now.

### N42. In-app notification centre [KING]
- **King's note:** also notify them in the app.
- **To do:** a bell with an unread count, a list of alerts with severity, dismiss and snooze, preferences per user and per channel (in-app, Slack, email), and links to the item behind each alert. This also fixes N9 (alerts not in cards).
- **Runbook stage:** F9. **Severity:** S2.

### N43. More observations on these screens [MINE]
- The menu has 20 items in four groups (DAILY, SELL, CLIENTS, TIDY UP). "Tidy up" is vague, and Today and Overview both exist (the merge in 13C is not done yet).
- Pipeline "Stages, bottlenecks and conversion" shows a stage with 666.6 average days and $0 value: junk data (see N38).
- Honest labels already present and worth keeping: "Conversion is estimated from where deals are now, because stage history is not kept" and "An estimate, not a promise".

---

## BATCH 5 (Leads, tags, lead drawer, Call lists, Accounts, Clients, Team)

### N44. Leads page: too many cards, and what is each data point for? [KING + MINE]
- **King's note:** Leads is another long scroll. Why should anyone trust the data? The data points were added "anyhow". What is each one used for, is it needed, and will users understand it? The structure and cards are silly, with no effects.
- **What I count [MINE]:** 14 blocks on one page (four tiles, lifecycle, going quiet, cohorts, tags, data quality, sources, do not disturb, birthdays, large imports, same person in several accounts).
- **To do:**
  1. Sub-tabs for the Leads module (for example Overview, Lists and filters, Tags, Sources, Data quality, Imports), so no page is a long scroll.
  2. **Data point audit.** Claude Code writes `docs/DATA_POINTS.md` covering every card and number on every page: the question it answers, who needs it, the decision or action it supports, keep, merge or cut, its definition and source, and its minimum sample. Anything that does not support a decision is cut. King reviews the list before any redesign.
- **Runbook stage:** D0, F1, D1. **Severity:** S1 (process), S2 (layout).

### N45. "Quiet over 90 days: 100%" and "never engaged: 52,926" look wrong [MINE]
- 52,735 of 52,926 contacts are called quiet, and "52,926 contacts never engaged at all". That contradicts the Inbox, where WhatsApp contacts have conversations. About 49,622 contacts carry the tags "50k agency owners" and "cold email outreach", so the page is dominated by a cold list.
- **To do:** separate "never engaged (cold lists)" from "engaged, then went quiet", based on real signals (messages, calls, appointments, replies). Let the owner mark tags or lists as cold so the default view shows working leads only. Show each cold list separately.
- **Runbook stage:** F1. **Severity:** S1.

### N46. Zero invalid emails and phones across 52,926 contacts is implausible [MINE]
- "Bad email or phone 0" and "Invalid emails 0, Disposable emails 0, Invalid phones 0", while the Large imports card shows imports missing 84% to 100% of emails or phones.
- **To do:** check the checks actually run. A zero may just mean "not computed". Show "not checked" when that is the case. Show "missing" separately from "invalid".
- **Runbook stage:** F1. **Severity:** S1.

### N47. Source data is 99% "Unknown" [MINE]
- "Where leads come from" lists Unknown at 52,223 of 52,926 contacts, so the table says nothing.
- **To do:** turn it into an action ("99% of your contacts have no source, so you cannot tell what works") with a short how-to for capturing a source. CHECK the CRM's source and attribution fields and how Meta lead forms are recorded (links to the F2 source item).
- **Runbook stage:** F1, F2. **Severity:** S2.

### N48. "Same person in several client accounts (23)" is a privacy problem [MINE]
- The card matches people across different clients' accounts. The Duplicates page promises the opposite: "We only compare within one account, never across clients, because different clients' customers must stay separate." The card contradicts that promise, could reveal that one person is a customer of two different businesses, and is a disclosure risk for GHL review. Here it only lists King's own team emails, but with real clients it would not.
- **To do:** remove it, or make it agency-only, off by default, with an explicit disclosure and consent switch. It must never be visible to client-account users, and a test must prove it.
- **Runbook stage:** S0.2 (tenant rules), F1. **Severity:** S1 (S0 if a client-account user could reach it).

### N49. Tags: what do they mean, and can I see the leads that were tagged? [KING]
- **King's note:** what does the tag list mean? Can they see the tagged leads? They need the day each lead was tagged, the number tagged on each day, so they can backtrack and troubleshoot, like Kit. Filter by tag and by day.
- **Today [MINE]:** a static list of tag names and counts. Nothing opens.
- **To do:** click a tag to see its leads inside SubSync. Show when each lead was tagged and a per-day count. Filter by tag and by date tagged.
- **Caveat:** CHECK whether the CRM exposes when a tag was added. If it does not, SubSync records tag changes from webhook events or snapshot differences from the day it starts watching, and labels the history "since SubSync started watching". We cannot show dates we do not have.
- **Runbook stage:** F10 and the People module. **Severity:** S2.

### N50. Lead side panel, the Kit model [KING]
- **King's note:** when they click a lead, the full data should open in a panel at the side, like Kit (screenshot). They should not have to go to the CRM page and redirect to act. They can see the data and know what they need.
- **What the Kit screenshot shows:** a table with checkboxes (bulk select) and a side drawer. Header arrows move to the previous or next lead. Left card: avatar, name, email, location, a status badge, a star rating. Tags with dates and a plus button. Searchable custom fields. Right side: stats and tabs (Emails, Automations, Forms, Purchases) with a dated timeline.
- **To do:** one shared drawer opened by clicking a lead anywhere in SubSync (Leads, Inbox, Speed to lead, Appointments, Pipeline, Call lists). It shows the profile, tags (with dates where known), custom fields, assigned owner, source, a timeline (messages, calls, appointments, deals, notes, tasks), and next actions. Arrows step through the current list. "Open in CRM" stays as a quiet secondary link.
- **Caveat:** CHECK the scopes needed (conversation messages, calendar events, opportunities, notes, tasks) and which stats exist. Per-contact email open and click rates may not be available from the CRM, so do not promise them.
- **Runbook stage:** D0 (component), F10, W1. **Severity:** S1 (central to "live in SubSync").

### N51. Leads as a working surface [KING]
- **King's note:** can they manage leads from the Leads module? They should live in SubSync, not review and go. Can they filter, and is the data enough to decide?
- **To do:** manage from the drawer and the list: assign an owner, add a tag, add a note or task, move a deal, record a call outcome. These are the staged, optional, confirm-and-undo actions from N40. Filters rich enough to decide on: tag, date tagged, owner, source, last activity, stage, account, custom fields.
- **Runbook stage:** W1 and the People module. **Severity:** S1 in value.

### N52. Light and dark mode, and following the agency's brand [KING]
- **King's note:** both light and dark mode. If possible follow the white-label design of the account, otherwise use the default light and dark.
- **Notes [MINE]:** the white-label data we receive includes the domain and a logo URL but no colours (checked earlier). So brand colours come from Settings (the agency picks an accent colour, with a suggestion taken from the logo). Without that, fall back to the default themes. Respect the user's light or dark choice and system preference. Build the themes as design tokens.
- **Runbook stage:** D1 (tokens in D0). **Severity:** S2.

### N53. Call lists should actually support calling [KING]
- **King's note:** the calling mentioned in Speed to lead should live here. They should be able to call, filter, see tags and data, last call, and so on.
- **To do:** columns for last call (date and result), last contact, owner, tags, source, and attempts. A Dial action through the CRM's dialer link or the provider in N55. Saved lists as in N20. Needs call records (the same dependency as missed calls; CHECK the call message type in conversations).
- **Runbook stage:** F10. **Severity:** S1.

### N54. Call lists fail with a 504 [KING + screenshot]
- **What King saw:** it keeps loading, then "Something went wrong. Request failed (504). Try again."
- **Hypothesis [MINE]:** a heavy query across 52,926 contacts and about 10,000 deals runs past the server's time limit.
- **To do:** precomputed lists, pagination, indexes, background jobs, caching, and a hard query timeout with a friendly message ("This is taking too long. Narrow the filters or try again") plus an error ID for support. A core page that fails is a blocker.
- **Runbook stage:** F10 (raise its priority). **Severity:** S1.

### N55. Third-party dialers, for example Kixie [KING]
- **King's note:** if a client uses a third-party dialer, let that dialer place the call, with small actions.
- **To do:** a per-account setting: Dialer = CRM dialer, Kixie, or phone link. CHECK Kixie's API or click-to-dial options and what they return (outcome logging). One provider after the native path works. We still do not build telephony.
- **Runbook stage:** F10, then an extras stage. **Severity:** S2.

### N56. Accounts versus Clients: same rows, two pages [KING]
- **King's question:** what is the difference? If it is the same sub-accounts, consolidate and add more.
- **Today [MINE]:** Accounts shows engagement score, risk, last activity, contact data completeness, open deals, stale and waiting counts. Clients shows manual fields (fee, renewal, industry, notes, last spoken), value created, Compare two, and the QBR. Both list the same three accounts.
- **Recommendation:** one "Clients" module, one row per client, with sub-tabs: Health (today's Accounts), Billing and renewals, Requests (N59), Compare, Reviews (QBR), Details. Add trend charts with axes per client (lead volume, reply speed, appointments, pipeline, health over time).
- **Runbook stage:** D0 (structure), C1. **Severity:** S2.

### N57. Client billing health: who has paid, who is defaulting [KING]
- **King's note:** who has paid their SaaS, who is defaulting, who has paid their marketplace apps and who is defaulting, who is losing leads, who fails to pay every time. The agency should not be surprised when a client leaves, and should know when to get more client accounts.
- **Notes [MINE]:** this is the agency's own billing of its clients (SaaS-mode subscriptions and marketplace app rebills). It is agency-only and never visible to client-account users. CHECK which APIs and scopes exist for SaaS subscription status, marketplace charges, and failed payment history. Financial scopes carry a trust cost. Combine with lead-loss signals into a churn early warning per client (late payments, falling lead volume, slow replies).
- **Link to N41:** King's payments ideas cover two things: (A) the agency's revenue protection from its clients (this note), and (B) a business's own customers' failed payments (N41). Confirm which comes first.
- **Runbook stage:** R1, after the core is trusted. **Severity:** S2 for now.

### N58. Clients > Details: what is it for? [KING] (and the answer on "industry")
- **Today [MINE]:** manual fields (what they pay per month, contract renewal date, industry, notes for the team), with Save, "I spoke to them today", and Open account. They feed value created, revenue at risk, renewals, and last spoken. King hopes it can populate and be edited.
- **To do:** auto-fill fee and renewal from billing data where the API allows (N57), with manual override. Show the saved values in the table, with inline edit. A log of conversations and notes with who and when. The industry label becomes a picker.
- **Answer to open item 3 (N1):** "industry" is a free-text label typed per client in Clients > Details. All 3 of King's clients show "Not set", so the "All industries (3)" filter at the top of every page currently does nothing. Hide that filter until at least two different industries exist, or replace it with a picker.
- **Runbook stage:** C1, F5. **Severity:** S2.

### N59. Client requests (support tickets) [KING]
- **King's note:** clients can submit a ticket that appears in their record in the Clients module. The agency user or admin sees it, acts, resolves it, and the client is notified when it is resolved. When a client submits one, the agency owner is notified in Slack and by email. A routine.
- **Assessment [MINE]:** support desks are the biggest competitor's strongest area (227 support features), and GHL's own ideas portal shows a helpdesk request with 126 votes. So build a deliberately small version, not helpdesk parity: submit (subject, category, priority, details), status (open, in progress, resolved), comments both ways, assignment, notifications (Slack and email to the agency; in-app and email to the client on resolution), and ticket history on the client's record. It makes SubSync something clients use daily and fits white-label. Needs tenant tests: a client sees only its own tickets.
- **Runbook stage:** new stage C1 after M2. **Severity:** S2.

### N60. Compare two is weak, and what is the QBR for? [KING + MINE]
- **King's note:** the comparison is lame, and what is the Review (QBR) for? It needs more features.
- **Answer:** QBR means Quarterly Business Review, the report an agency shows a client at renewal to prove value.
- **What I see [MINE]:** Compare two shows seven rows and one "What is different" bullet. The QBR says "quarterly" but summarises 30 days, with two tiny line charts without axes and three bullets.
- **To do:** Compare supports two or more clients with trend charts, highlighted differences, and a comparison against the average. QBR gets a quarter selector with the previous quarter, KPI trends with axes, wins, issues, a "what SubSync caught and what was fixed" proof section (the unique part), recommendations and next steps, branded print and PDF, and a share link with the F6 hardening. Built only from verified metrics.
- **Note:** QBR and reporting is a crowded space, so keep it simple and let the proof section carry the value.
- **Runbook stage:** C1 and later. **Severity:** S2.

### N61. Team module: a real directory with activity [KING]
- **King's note:** more data, organised and shown well: who is in the calendar, their role, calls they made, graphs, users deleted and added across accounts and their roles, which client account each user belongs to, what they are assigned to, phone number. Clicking should show what they are assigned to: leads assigned to them (filtered), their calendar, their phone. If a redirect to a filtered list is not possible, use the default booking calendar or phone page.
- **Data (CHECK each in the live API):** the users API (names, photos, email, phone, role, which accounts they belong to), calendars with their team members, lead and deal ownership counts, appointments, calls made (call-type messages), activity graphs. Users added or removed and role changes are not available as history, so record them from the day SubSync starts (snapshot differences or webhooks) and say "since SubSync started watching".
- **Click-through:** assigned leads open a filtered list inside SubSync first. Opening the CRM pre-filtered by assigned user depends on whether the CRM supports it in a link (CHECK). Fallback: the default page.
- **Visibility:** who can see whose numbers is a setting (links to N27).
- **Runbook stage:** T1, with names from N21. **Severity:** S2.

### N62. More observations [MINE]
- Accounts page: KD Squares LTD is "Healthy", score 57, "Low risk" with 23 waiting. Same contradiction as N16, still unfixed.
- Accounts filter pills (At risk, Watch, Dormant, Incomplete data, Replies waiting, Ignored) are a good idea. "Ignored" implies an ignore feature, which should be easy to find.
- The Leads "Large imports" card is a good example of an actionable insight (imports with 84% to 100% missing email or phone). Keep that style.
- "1 contacts asked not to be contacted": fix the singular.
- **N33 update:** these screenshots show "Last synced 1h ago" resetting to 16 minutes about 16 minutes later, so a sync ran roughly once an hour, not every 15 minutes. That is still too slow for speed to lead.

---

## BATCH 6 (Setup, Email health, Compare setups, Industry playbooks, Duplicates, Data cleanup)

### N63. Setup is thin: it needs a real checklist system [KING]
- **King's note:** the Setup module is blank and needs a better checklist, with a redirect to the right place. Some SaaS clients have their own checklists, so those must be considered. Agencies can add their own checklist while the app also auto-detects.
- **What I see [MINE]:** progress bars at 45%, 50% and 60%. Automatic checks (pipeline, contacts, calendar, activity, deals). Manual ticks (kickoff call, custom domain, phone number registered, client walked through the account). "Workflows built" shows a question mark because the API is not available to every account. It sits in the "Tidy up" menu group.
- **To do:**
  1. Every unfinished item gets a "Fix it" link that opens the exact settings page (through the white-label link helper) plus a short how-to.
  2. Auto-detect more items where the API allows (custom domain, phone number registered, business profile, calendar, pipeline) and say exactly why an item cannot be detected (see N64).
  3. Templates: agencies, especially SaaS-mode agencies, have their own onboarding steps. Support templates per client type or industry, custom steps per template or per account, a mix of automatic and manual items, an assignee and due date, a status and history, progress per client, and a roll-up of "clients stuck in onboarding for more than N days".
  4. Rename it "Onboarding" and move it under Clients (N56).
- **Runbook stage:** C1, D0. **Severity:** S2.

### N64. "Why is an API marked unavailable when it is available?" and "turn on all scopes" [KING] (decision with guardrails)
- **King's note:** some things are marked unavailable when they are available. Any scope we do not have access to should be turned on, all of them.
- **What is likely going on [MINE]:** three different causes are shown with the same wording ("the platform does not give this app..."): (1) we never requested the scope, which is fixable; (2) the platform restricts the API (for example the Workflows API is limited availability, verified earlier); (3) the data is not exposed at all.
- **To do:**
  1. Claude Code builds a capability matrix, `docs/CAPABILITIES.md`: every data point we want, its endpoint and scope, whether we request it, whether each install has granted it, and whether the platform gates it.
  2. The UI says which case applies: "Needs permission: reconnect to turn this on" (cause 1), "Not available from the platform yet" (causes 2 and 3), or it simply shows the data.
  3. Request the missing scopes for planned features in one release (2.2.0) as OPTIONAL scopes, grouped by feature (Calls, Team, Payments, Email health, Write actions), each with a plain-language "why we ask".
- **My recommendation on "turn all on":** request everything the roadmap will actually use, in one batch, because re-approval on every later change is costly (the Appointments banner showed that). Do not blanket-request every scope: GHL's review guidelines require least privilege and a justification for each scope (verified), the competitor's 165 scopes are a trust weakness we can use, and financial and write scopes carry real risk. Optional, grouped, explained, and used.
- **Runbook stage:** S0.2, F8, the 2.2.0 release (Z2). **Severity:** S1.

### N65. Email sender health: vague, no data [KING]
- **King's note:** no data points. Show the email numbers, the leads affected, bounces, the reason for bounces, suggestions. Better filters and a better graph, the rate at which emails fail and the cause, monitoring of health, SSL certificate monitoring for the domain, domain renewal (read from the CRM if possible, maybe for CRM-purchased domains).
- **What it shows [MINE]:** a domain box, one row per domain ("Needs attention", Re-check, Details) and "Found on account profiles, not checked yet". A footnote admits DKIM is only detected on common selectors. The button says "Check all 1 new domains".
- **To do (all CHECK against the live API):**
  - **From our own checks (doable):** SPF, DKIM, and DMARC status with a plain explanation and the exact record to add. Continuous monitoring with an alert when a record changes or breaks. SSL certificate expiry. Domain expiry through public registration lookups (RDAP or WHOIS). Optional blacklist checks. MX and typo checks on contact emails (invalid domains, role addresses, disposable domains, typos like "gmial.com").
  - **From the CRM (depends on the API):** emails sent, delivered, bounced (hard and soft), complaints, and unsubscribes per account and over time. The list of contacts affected. Bounce reasons if the platform exposes them (if not, our own classification must be labelled as an inference). Contact-level email validity flags. Whether the CRM lists purchased domains and their expiry.
  - **UI:** a trend chart of bounce and failure rate with a threshold line, filters (account, domain, date range, bounce type), a "leads affected" table that opens the lead drawer, a "what to do" panel per problem, and plural handling fixed.
- **Honest limit:** if the API does not give bounce reasons, we say so rather than guess.
- **Runbook stage:** new stage E5 "Email health", after M2. **Severity:** S2.

### N66. Reselling profit dashboard [KING]
- **King's note:** the agency should see how much they make from reselling apps, per client, and which resold app earns them the most. It may belong in a different module.
- **[READING]:** the agency resells marketplace apps (including SubSync) to its clients with a markup, and wants revenue, cost, and margin per client and per app.
- **Notes [MINE]:** this needs marketplace billing or wallet data at agency level (CHECK what the API exposes). It is agency-only. It belongs with N57 in a Revenue module. For SubSync itself the wholesale price is known and the retail price may be.
- **Runbook stage:** R1. **Severity:** S2.

### N67. Duplicates: no filters, no cause, no source [KING + MINE]
- **King's note:** no filter (what filter?), what is causing the duplicate, why are there duplicates when the "no duplicates" setting is on, and the main source of duplicates must be reported.
- **What I see [MINE]:** KD Squares LTD shows "Blocking duplicates" yet has 2,534 groups and 6,741 contacts. The page says old duplicates from before the setting was switched on, or from imports, stay until merged, but never shows which. Tiles: Exact matches 2,535, Written differently 5, Contacts involved 6,914, Same person other clients 23.
- **To do:**
  1. **Source of duplicates:** show how and when each duplicate record was created (date added, source or form, import day, tag), and a summary ("81% came from the June 22 import", "created before blocking was switched on"). CHECK the source and attribution fields. Link to the Leads "Large imports" days.
  2. **Filters:** account, confidence, match type (email, phone, name), group size, date created, source, has an active subscription or payment, in a workflow, has open deals, has a conversation.
  3. **Reason in plain words** per group ("same phone and same email, different names").
- **Runbook stage:** C2 (Clean-up module, N71). **Severity:** S1.

### N68. Duplicate labels mean nothing to non-technical users [KING]
- **King's note:** "Merge into kept", "I merged these in the platform", "Save this record to keep", "Not duplicates": what do they even mean? GHL users are not tech savvy, so make it as easy as for a baby, with guides and support.
- **What they do today [MINE]:** "Merge into kept" is a radio button on each record. "I merged these in the platform" records that the user merged in the CRM. "Save this record to keep" stores the chosen record. "Not duplicates" marks the group. Bulk actions record a decision, which only changes SubSync's own notes. Nothing changes in the CRM, and the page does not say so clearly.
- **To do:** plain labels ("Keep this one", "Combine these into it", "These are different people"). A three-step flow (see the group, choose what to keep, combine). One sentence on what will happen to each record. A short guide (text plus a short animation or video). An in-app help panel and a support link.
- **Runbook stage:** C2, D1. **Severity:** S1.

### N69. The duplicate score is wrong when names differ [MINE]
- The top group is 88 records labelled "99% sure" and "Exact match: same email, same phone, same name", but the merge preview lists "also seen" names such as marvin morris, goodness favour, ben zoe, and ateke tompolo, plus many different emails and phones. That is one phone number reused across many different people (King's test data), not 88 copies of one person. The confidence ignores name similarity.
- **To do:** confidence combines name similarity, email, and phone, and drops sharply when names differ. A group with several different names is labelled "shared phone or email, probably different people". Bulk "accept the recommended record" must exclude those groups and cap the number of groups per run, with a second confirm.
- **Runbook stage:** C2. **Severity:** S1.

### N70. Merging from SubSync: possible, but only with a clear plan [KING + MINE] (strategic and risky)
- **King's note:** if dedupe can be done from SubSync, redirect or preselect those leads so the user reviews and merges. Suggest the master lead (leads with an ongoing subscription payment first, then leads in workflows, and so on), because merging without knowing the master can break rebills. Warn in the Contacts and other modules when merging leads with different details, when deleting a lead with ongoing payments, and when merging leads with low or no similarity. Do it the way HubSpot and Salesforce apps do, extremely carefully, with a 30-day backup so a mistake can be reverted.
- **What exists today [MINE]:** the page says SubSync cannot merge for you because the platform offers no safe way from outside.
- **Facts to check before promising anything (CHECK):** whether the CRM's API has a real merge endpoint that keeps history; whether a link can open the CRM's own merge screen with the contacts preselected; whether deleted contacts can be restored.
- **Important honesty:** if the only tools are "update the master contact and delete the others", the deleted contacts' conversations, appointments, and payment links are lost. A SubSync "30-day backup" could then only re-create a contact from a saved copy with a new ID, not restore its history. So the backup is partial and must be described that way.
- **Recommended path, in order:**
  1. **Guided merge (no writes):** pick the master with a stated reason, show the differences, and open the CRM's merge screen for those contacts (or give exact steps and the list of contacts to select if no preselect link exists). Record the outcome and re-check later.
  2. **Real merge from SubSync only if a safe merge API exists**, behind the N40 guardrails.
  3. **Master-record rules (suggested order):** ongoing subscription or payment, then active workflows, then open deals, then most recent activity, then most complete data. The reason is shown on screen.
  4. **Warnings and blocks wherever a merge or delete exists** (including Leads and the lead drawer): different names or details; low or no similarity (block below a threshold); a contact with an active subscription or ongoing payment (block deletion, warn on merge); DND or unsubscribed contacts (never deleted); contacts with open deals or upcoming appointments.
  5. **A 30-day safety copy** of every changed record's fields, tags, and notes, with a one-click restore that re-creates what can be re-created and says what cannot.
- **Runbook stage:** C2. **Severity:** S1 in risk, large in scope. **Decision:** King to confirm the staged path.

### N71. Data cleanup: what is it for? Merge Duplicates into it [KING]
- **King's note:** what is Data cleanup used for? Merge Duplicates into it. What is the "industry again" bar at the top used for? If not used, remove it. What does it even do? Be careful removing leads. Be sure about DND. It needs improvement.
- **What it does today [MINE]:** one client account at a time, it can write phone numbers as +digits, fix names typed entirely in capitals or lower case, and add or remove a tag for contacts matching a filter (for example idle for 90 days), always with a preview, a confirm, and undo. It does not delete leads today.
- **To do:**
  1. One "Clean-up" module with tabs: Duplicates, Formatting (phones and names), Tags, Invalid and old leads. Duplicates merges into it.
  2. Remove the "Show only industry and test account" bar from pages where it makes no sense (Data cleanup, Duplicates, anything that already picks one account).
  3. Improve the preview: counts, a before and after table with samples, a per-run log, undo for 30 days, a cap on changes per run with a second confirm, and a re-run option.
  4. **Safeguards for removal or archiving:** never delete contacts marked DND or unsubscribed (they are the opt-out record, and deleting them can lead to messaging them again); never touch DND flags; exclude contacts with active subscriptions or payments, open deals, or upcoming appointments; prefer "archive or tag for review" over delete; require typing a confirmation for any delete.
  5. New safe rules: email typo fixes (gmial.com), a default country code per account, tag contacts with no email or no phone.
- **Runbook stage:** C2 (Clean-up module). **Severity:** S2 with S1 safeguards.

### N72. Compare setups and Industry playbooks [MINE] (King did not comment)
- **Compare setups:** the result is a wall of text (long lists of extra pipelines, missing stages, "48 more calendars than the baseline"). It compares two of King's unrelated accounts, which is not meaningful. It becomes valuable for an agency with many clients built from the same template, where drift matters. To do: a structured table or visual diff, a severity, a "fix this drift" guide, and only offer it when accounts share a baseline.
- **Industry playbooks:** this is where "industry" gets meaning. Each client can have its own reply target by industry (a plumber or an estate agent is late after an hour, a boutique after eight), but the switch is off and the page says "No industries recognised yet" because none of the three clients has an industry set. Six built-in playbooks exist. To do: a picker with known industries (free text is fragile), one switch for reply targets by industry, and an obvious link from the industry filter. This also fits the real-estate wedge (a faster default target for real estate).
- **Runbook stage:** C1, D1. **Severity:** S2.

### N73. Observations on these screens [MINE]
- Setup, Duplicates, and Data cleanup sit in a "Tidy up" menu group. After consolidation that group disappears: Setup moves under Clients, and Duplicates and Data cleanup become one Clean-up module.
- "Check all 1 new domains" needs plural handling, and "Domain check is warning" needs plain wording.
- Duplicates still shows "Same person, other clients: 23, normal for an agency". N48 stays open: matching across clients should be agency-only, off by default, with disclosure.

---

## BATCH 7 (correction on freshness, and trust)

### N74. Freshness: two statements, and only one can be the truth [KING]
- **King's note:** Today says "Last synced 7m ago" but another line says "Data is under an hour old". Be careful. We need the truth.
- **What I see [MINE]:** the two statements have different precision. "7m ago" is exact. "Under an hour old" is a loose bucket that would still say the same at 59 minutes, so it hides the real age. They appear to come from two different pieces of code, which is also how earlier screens showed "Last synced 19m", "A sync is still running" and "Data is under an hour old" at the same time.
- **To do:** one source of truth for freshness: the time of the last successful sync for each account. Show it once, in one place, as exact text ("Updated 7 min ago"). When it is stale (for example over 30 minutes) change the wording ("Updated 45 min ago, refresh is delayed"). Per-account freshness is available on hover or in the drawer, because accounts sync at different times. If a sync failed, say so. Remove the separate vague badge. Add a test that every page shows the same freshness value.
- **Runbook stage:** D0 (shared status line), S0.4 (sync reliability). **Severity:** S1 (trust).

### N75. Trust for a Nigerian-built product selling abroad [KING]
- **King's note:** we are Nigerian, so we must be very careful to build trust.
- **My reading [MINE]:** assume some US and UK buyers will be cautious about any new vendor, and more so about one from outside their market. Do not hide where you are from, because hiding it backfires. Compensate with transparency, proof, and safety. A practical trust pack for compile:
  1. **Truthful numbers:** one definition per number, a visible method, "not enough data" instead of scary estimates, honest freshness (N74).
  2. **A Trust page:** what we read, what we store, for how long, how to delete it, why each permission is requested, which outside services process data (hosting, database, email, any AI provider), security practices (encryption, tenant-isolation tests, OAuth only, no passwords stored), how incidents are handled, and a status page. State only what is true. If compliance (for example Nigeria's data protection law, GDPR) is partial, say "working toward" instead of claiming it.
  3. **Real company identity:** legal entity name, registration details, named founders, a real business address, a working phone or WhatsApp number. Keep these identical everywhere (name, registration number, address), as the KYB pack requires.
  4. **Support people can rely on:** a named contact, a first response within 24 hours (GHL's own requirement), coverage that overlaps US and UK working hours.
  5. **Risk reversal:** the 14-day trial, cancel any time, billing through the platform (customers never send money to us, which is a real trust advantage), read-only by default, preview and undo on every change, deletion of their data on uninstall.
  6. **Proof:** pilot results (with permission, anonymised), a public roadmap and change log, marketplace reviews, partner status once earned. No invented testimonials, no inflated counters, and "live" numbers only if they are real.
  7. **Legal documents:** privacy policy and terms reviewed by a lawyer, and a data processing agreement available on request.
- **Catches in your own setup [MINE]:**
  - The Email health page flags **kdsquares.com** as "Needs attention", and Today says sender authentication is failing for KD Squares Test. Your support address is on kdsquares.com. If this is real, pitch emails and support replies may land in spam, which would hurt trust and the audit outreach. CHECK it (the page itself warns that DKIM is only detected on common selectors, so it may be a false alarm), then fix SPF, DKIM, and DMARC in the sending service before sending pitches.
  - SubSync currently lives on a subdomain of kdsquares.com. Fine for now. A dedicated product domain can come later.
- **Runbook stage:** Z2, Z3, the website, D1 (Trust page). **Severity:** S2, strategic.

---

## BATCH 8 (Settings, Connections, Slack, Meeting notes privacy, Roadmap page, operating principles)

### N76. Settings: one long page, and it needs advanced features [KING + MINE]
- **What I see [MINE]:** a single long column of about eleven cards: Client access, Meeting notes privacy, Speed to lead, Your name on reports, Connections, Slack alerts and daily brief, Links, Connection health, Data sync, What we store, Delete my data.
- **To do:** sub-sections with a left sub-navigation: Team and access, Notifications, Integrations, Reply targets and thresholds, Brand, Data and privacy, Sync status, Advanced. Advanced features: roles and permissions per user, notification preferences per user, type, and channel, thresholds per account and per industry, an audit log of settings changes, "Delete my data" restricted to the agency owner, and export or import of settings.
- **Runbook stage:** F8, D0, D1. **Severity:** S2.

### N77. Meeting notes privacy and how meetings work: what each setting does, and a contradiction [KING + MINE]
- **King's questions:** what does Meeting notes privacy do, how does the meeting flow work, which integrations do we need, is Zoom really working, and is the recording populating a CRM note?
- **Explanation [MINE]:** Settings has two options. "Keep full transcripts" is off by default (only the summary and action items are stored, safer for clinics and private conversations). "Also add each meeting to the matched contact's notes in your CRM" is ticked (written once per meeting, only for a contact matched by email). The flow: a meeting tool (Zoom's AI Companion summary, or Fathom through a private address) sends a summary, SubSync stores the summary and action items, matches the attendee's email to a contact, and optionally writes a note.
- **Contradiction [MINE]:** Settings and the Connections footer say SubSync adds the summary to the contact's CRM notes. The Meeting notes page footnote says SubSync does not write into the CRM because it has no write permission, and offers a "Copy note" button. Both cannot be true. A screen that contradicts the product is a disclosure problem for GHL review.
- **Unverified:** whether Zoom works end to end, and whether notes reach the CRM. The Oct 31 buyer review marked it "not run".
- **To do:** stage E1 verifies it (a real or simulated meeting). If the write permission is not granted, disable the setting with "Needs permission: reconnect". Make every screen say the same true thing. Add this feature's stored data to "What we store". State the privacy position for health-related content. Add more tools (Google Meet, Teams, Fireflies, Otter, tl;dv, Read.ai) only after the first one works end to end and a real user asks. It stays hidden for the pilot.
- **King's decision (after this note):** SubSync may write the meeting note onto the matched contact for **Zoom, Fathom, and Google Meet**, with the write permission turned on as an optional scope and with careful guardrails. Stages E2, E1, and E3 build and verify it, using the best available connection method for each tool.
- **Runbook stage:** E2, E1, E3 (and a quick wording fix in F8). **Severity:** S1 for the contradiction, S2 for the rest.

### N78. Speed to lead settings: who does the replying, and is it working? [KING]
- **King's note:** who does the speed-to-lead, and is it actually working?
- **How it works today [MINE]:** the reply target is 15 minutes, and "Count automatic messages as a reply" is off, so only human replies count. SubSync does not reply to anyone. It measures how long a person took. "Who" is the user who sent the first message (needs names, N21).
- **To do:** say this plainly in the UI ("SubSync does not send replies. It measures how fast your team does"). Show who replied. F2's live-data check (10 leads by hand) proves it works. Offer targets by industry or source (N72). Show automated first touch separately from the human reply ("auto-replied in 10 seconds, a person replied after 3 hours"), because that gap is the real insight.
- **Runbook stage:** F2. **Severity:** S2.

### N79. Slack: do we still need the pasted web address? Notification options and editable copy [KING]
- **King's note:** if Slack is set up with a sign-in like Zoom, do we still need the webhook? Also options for the time of notifications (daily brief, tickets) and the ability to edit the message copy.
- **Answer:** no. With a Slack app installed through "Add to Slack", the user picks a channel and SubSync gets what it needs to post, so nobody pastes a web address. The pasted address stays only as an "Advanced" fallback. CHECK Slack's distribution rules for an app used by other workspaces. Today the Connections card says "This needs the Slack app to be set up for SubSync first", which means the Slack app has not been created yet.
- **To do:** a Slack sign-in app (channel picker, test message, disconnect). A notification preferences matrix: for each type (daily brief, weekly summary, speed-to-lead breach, unmarked appointments, silent failure, sync problem, new ticket, ticket resolved, billing alerts later) choose the channel (in-app, Slack channel, email), the time or frequency, the time zone, quiet hours, and who receives it. Editable message copy per type with variables ("{count} leads waiting at {account}"), a live preview, reset to default, and safe handling of variables.
- **Runbook stage:** F9. **Severity:** S2.

### N80. "Send at" cannot work with a once-a-day refresh [MINE]
- The Data sync card says "Data refreshes automatically about once a day and as changes arrive." That is the app's own statement, and it fits the hosting-plan suspicion in N33 (a daily scheduled job). But Settings offers "Send at 08:00" with a time zone, which needs the scheduler to run at least hourly. A once-a-day job cannot honour a user-chosen hour or per-time-zone briefs.
- **To do:** decide the scheduler (CHECK hosting-plan limits; options include a higher plan, the database's own scheduled jobs, or a queue service with scheduled delivery). Run the reconcile at least every 15 minutes and the notification dispatcher hourly or better. Make the Data sync card say exactly what runs and when.
- **Runbook stage:** S0.4, F9. **Severity:** S1.

### N81. Connection health and Data sync cards [MINE]
- Connection health lists per-account status with Resync, but "Jobs, 24 hours: 538" does not say what a job is. Two cards (Connection health and Data sync) overlap with the freshness line (N74).
- **To do:** one "Sync status" panel: last successful sync per account, next run, failures with reasons, and a plain meaning for "jobs". It replaces the per-page freshness badge.
- **Runbook stage:** S0.4, F8. **Severity:** S2.

### N82. Links: the login address is a manual field [MINE]
- "The address you log in to: app.kdsquares.com" is typed by hand. The white-label domain arrives in the user data and install event, so detect it automatically and keep the field as an override. A wrong value breaks every "Open" link.
- **Runbook stage:** S0.3 (link helper). **Severity:** S1 if the manual field is the only source.

### N83. "What we store" and "Delete my data": good for trust, but check they are true [MINE]
- Strong for trust (N75). But "Conversations: who wrote, when and through which channel; never message text" conflicts with meeting summaries stored inside SubSync, and the card omits appointments, users, scores, alerts, tag dates, and notes. "Everything is deleted when you uninstall" needs a test. "Delete my data" must be limited to the agency owner, with a confirmation and an audit entry.
- **To do:** generate the "What we store" list from the real database schema (an automated test fails if a table holds personal data that is not listed). Test uninstall deletion and Delete my data. Restrict by role.
- **Runbook stage:** S0.2b, F8. **Severity:** S1.

### N84. Client access: the promise must be proven [MINE]
- "They see a read-only view of that one account only: never other clients, your fees, notes or settings." That is a security claim. The tenant-isolation tests must prove it, including that fees, notes, tickets, and settings are never returned to client-account users, and that switching access off removes access immediately.
- **Runbook stage:** S0.2b, F8. **Severity:** S1.

### N85. Brand settings exist [MINE]
- "Your name on reports" and Colour exist and apply only to printed reports and quarterly reviews. Extend them to the whole app theme (N52), add the logo from white-label data, show a preview, and make emails and the Share link use the same brand.
- **Runbook stage:** F8, D1. **Severity:** S2.

### N86. Roadmap page: how does "Coming next" work, does it notify me? [KING + MINE]
- **King's question:** how does it work, does it notify me, how?
- **Honest answer [MINE]:** as built, a vote adds to a counter ("Vote . 0"). Nothing on the screens shows a notification to King, a comment box, or a message to voters when something ships.
- **To do:** when someone votes or suggests something, notify King (instant Slack and email for suggestions, a daily digest for votes). One vote per user per item. A "Suggest something" box (title, details, importance, optional screenshot, page context). An admin view for King (votes, comments, who, which account type). Status labels (Planned, In progress, Shipped). Notify voters when it ships ("You voted for X: it is live"). Link to the change log. Reword "We build in the order people ask" to "Votes help us decide what to build next", because we also sequence by risk and cash and must not over-promise (N75). The "Coming next" items must match the real roadmap (industry benchmarks need many installs, and the AI brief is parked).
- **Runbook stage:** F8. **Severity:** S2.

### N87. Getting started needs a real guide, and a feedback field [KING]
- **King's note:** Getting started needs more guide steps, plus a feedback field (what to add, include, and so on).
- **To do:** a step-by-step guide per role (agency owner, client-account user): connect, first sync, read Today, set your reply target, set up Slack, invite clients, fix your first alert. Short videos or animated screenshots. Each step has a "Do it now" link and ticks itself off. A "Give feedback" box on every page (what to add or change, the page, an optional screenshot, a severity). An in-app help panel and a "Report a problem" button that includes an error ID. Feedback goes to King's Slack and email and is stored.
- **Runbook stage:** F8. **Severity:** S2.

### N88. Operating principles for Claude Code [KING] (applies to every stage)
- **King's note:** don't just build. Make sure it works. If there is no way, find the best possible way that exists, and if there is still none, leave it. Be strategic and innovative. Do not build just because I said so: evaluate. Some things may not be possible, so take note and find the best alternative.
- **Rule set (added to CLAUDE.md in the compiled pack):** evaluate before building (the decision it supports, whether the data is truly available in the live API, whether a native or competitor solution already exists, the simplest proof of value, the risk); build only the simplest version that proves value; verify after building on real data and real roles; if impossible, document it in `docs/BLOCKED.md` with the alternatives tried; offer one or two innovative proposals per module, marked as proposals for King to approve (never auto-built); never promise in the UI what is not live.
- **King's standing decision on write permissions (stated repeatedly):** write scopes may be requested whenever a feature needs them, as optional scopes, with guardrails. Do not ask again whether write is allowed.
- **Runbook stage:** all. **Severity:** S1 (process).

### N89. UI/UX revamp needed on Settings and What's new too [KING]
- The same pattern: a long single column of cards, technical wording ("web address", "keys"), and no sub-sections. Covered by N76, D0, and D1.

### N90. Status of the old work [KING]
- Claude Code is at S0.3 of the original runbook. Remaining original stages after S0.3: F1, F2, F3, F6, F4, F5, F7, F8, F9, F10, E1 to E4, and Z1 to Z3, which is 17 stages. The notes add 10 more stages (S0.4, D0, D1, T1, P1, W1, C1, C2, E5, R1) plus a small S0.2b, so the full plan is about 30. The compiled pack orders them so the sellable audit and the pilot come first.

---

## BATCH 9 (Connections: Zoom and Slack errors, per-user connections, where and what to save, Nov 1)

Full design in `docs/INTEGRATIONS_SPEC.md`. Research was done on Nov 1, 2026 (GHL notes and internal comment calls, Zoom summary and scope rules).

### N91. Zoom connect fails: "Zoom did not say who signed in" [KING + MINE]
- **What I see [MINE]:** after Zoom's own sign-in, the SubSync window says "Zoom was not connected. Zoom did not say who signed in." King's pasted callback address shows Zoom did send a valid one-time code and state, so the sign-in worked and the failure came after it.
- **Likely cause [MINE]:** the Zoom app lacks the scope `user:read:user`, so the call that asks "who is this user" is refused. Zoom's developer forum shows exactly that refusal for user-managed apps. CHECK by reading the real error in the logs.
- **To do:** King adds `user:read:user` to the Zoom app and reconnects. Claude Code logs the real Zoom error (code only) and shows a plain message with a code (Z-IDENT). "Did not say who signed in" is internal wording and must go. Warning: callback links with `code=` must never be pasted into chat or tickets.
- **Runbook stage:** E0 (copy), E1. **Severity:** S2 (Zoom stays hidden for the pilot).

### N92. Slack connect fails again, and Connections is stuck on "Waiting for you..." [KING + MINE]
- **What I see [MINE]:** Slack says `redirect_uri did not match any configured URIs` for `https://subsync.kdsquares.com/api/integrations/slack/callback`. The Connections card for Slack stays on "Waiting for you...".
- **Cause [MINE]:** the address is not saved in the Slack app's Redirect URLs (it must be added and then saved with the separate Save URLs button). The request itself is correct: it asks for `incoming-webhook` only, and the icon shown is the new SubSync icon.
- **To do:** King adds and saves the address and compares the Client ID with the one in the request. Claude Code makes any pending connect expire after 2 minutes with "Try again" and a plain reason.
- **Runbook stage:** E0, F9. **Severity:** S2.

### N93. "If nobody in a meeting is a known contact, save it in [client account]" makes no sense [KING + MINE]
- **King's note:** this option does not make sense. The sub-account user decides, and the agency cannot choose for them.
- **Agree, and stronger [MINE]:** a note must belong to a contact, so "save it in an account" has no real meaning, and it can put one client's customer into another client's CRM (the same risk as N48).
- **To do:** remove the setting (S0.2b). Replace it with a private Meeting inbox: nothing is saved blindly; the person links the meeting to a contact or dismisses it; it auto-deletes after 14 days. Do not build "create a contact" (it can trigger the client's own automations and fill their CRM with junk).
- **Runbook stage:** S0.2b, E0, E2a. **Severity:** S1 (privacy).

### N94. Connections must be personal, not assigned by the agency [KING]
- **King's note:** the integration must be done for each user, not an assigned connection. There are many sales teams, so integrations must live in each person's profile.
- **Agree [MINE]:** Fathom shows only the connecting user's own calls, and a Zoom user-managed app authorizes one user at a time. A shared or agency-assigned connection cannot work and would break the providers' rules.
- **To do:** one connection per user and provider, shown as "Connected as ...". The author of the CRM note is that user. Tokens are invisible to everyone else. An admin can revoke a connection but never connect for someone.
- **Runbook stage:** E0. **Severity:** S1.

### N95. Every role must be able to connect [KING]
- **King's note:** sub-account admins and users should have all these options to connect.
- **To do:** any role connects its own personal tools. Workspace tools (Slack, the sending domain) need an admin. The admin sees who has connected (names, status, counts), never the content.
- **Runbook stage:** E0. **Severity:** S2.

### N96. Where to save: contact note or conversation comment, and note size limits [KING]
- **King's note:** the summary or transcript can be saved as a comment or as an internal note on the contact's conversation, because notes have a limit.
- **Finding [MINE]:** GHL supports both: a contact note, and an internal comment in the conversation (send-message with type InternalComment; visible to the team only, never sent to the contact). The size limits are not stated in the documentation I found, so the claim about notes is unverified. Test it.
- **To do:** a destination per item (contact note, conversation comment, or SubSync only). Split long content into parts. Run the limit tests in E0 and record the real numbers.
- **Runbook stage:** E0, E2b. **Severity:** S2.

### N97. What to save: recording, transcript, summary, both, or custom [KING]
- **King's note:** there should be several options to choose from: recording, transcript, summary, both, customise.
- **To do:** a table of items (summary, action items, recording link, attendees and date, transcript) by destination, with presets (Recommended, Full record, Summary only, Custom) and a template with merge fields and a live preview. The transcript is off by default and is written to the CRM only if both the user and the account policy allow it. Ask the provider only for what the user chose to save.
- **Runbook stage:** E2b. **Severity:** S2.

### N98. Several sales teams [KING]
- **King's note:** multiple sales teams, so multiple integrations per profile.
- **To do:** personal connections as in N94. Slack gets several destinations (for example one per team) and each alert type can be routed to a chosen destination. A SubSync Team list arrives with the Team directory (F10). The admin sees per-user status.
- **Runbook stage:** E0, F9, F10. **Severity:** S2.

### N99. Our own writes can distort our own numbers [MINE]
- **Finding:** a GHL internal comment is an outbound message. If Speed to lead or Unanswered messages count outbound messages, SubSync's own comments could count as replies. A note may update the contact's activity dates and distort "quiet over 90 days" and "never engaged". Our own writes can also come back as webhooks and loop.
- **To do:** a write log; exclude InternalComment messages and SubSync-caused events from reply, activity, and engagement metrics; drop echoes. Test with a real internal comment.
- **Runbook stage:** E0 (with F2 and F4 tests). **Severity:** S1.

### N100. CFO view: scope and order for meeting notes [MINE]
- **Finding:** meeting notes sits outside the thesis (N77 and the Master Brief both say so) and will not sell the first audit, while cash is negative. Fathom's notetaker joins Zoom, Google Meet, and Teams calls (CHECK), so one Fathom integration covers all three. Native Zoom needs a paid host plan, the host's AI summary switched on, and Zoom's approval for users outside KD Squares.
- **Proposed:** build E0 and E2 (Fathom) only, after M1. Build E1 (Zoom) and E3 (Google Meet) only when a real pilot user asks. King decides.
- **Runbook stage:** E0 to E3. **Severity:** strategic.

### N101. Zoom facts to design around [MINE]
- Summaries need a Pro or higher host and the host's "Meeting Summary with AI Companion" on; encrypted meetings have no summary. The summary webhook may not arrive (a September 2026 Zoom forum report for a development-mode app), so poll as well. Users outside KD Squares' Zoom account need Marketplace review or the Publishable URL process, plus a deauthorization endpoint. Scope changes force users to reconnect.
- **Runbook stage:** E1. **Severity:** S3.

### N102. Consent and sensitive content [MINE]
- Transcripts carry other people's voices, and summaries can contain health or financial details. Defaults: transcripts off; account policy can forbid them in the CRM; "What we store" lists every item; the user is responsible for recording consent (one plain line on the connect screen); the Meeting inbox deletes after 14 days; uninstall and "Delete my data" remove everything; never log summaries, transcripts, or tokens.
- **Runbook stage:** E0, E2a, E2b, F8. **Severity:** S1.

### N103. Prove the code really reads and writes the live Supabase database [KING + MINE]
- **King's note:** make sure the code is receiving Supabase (reading and writing the database).
- **Risk [MINE]:** code can pass its tests against a local or mocked database while the live Supabase project is missing the new tables or security rules. Webhook handlers run without a signed-in user, so a wrong key or a blocked write can fail silently and the meeting simply never appears.
- **To do:** migrations applied to the live project and compared with the repo; row level security on every new table, tested with real roles; encrypted tokens only readable by server code; no service-role key in the browser; database-level unique constraints and a simultaneous-retry test; a row lock around token refresh; pooled connections; written proof with live row counts and the names (never the values) of the environment variables.
- **Runbook stage:** E0, E2a. **Severity:** S1.

### N104. Fathom data into custom fields, and who configures what [KING]
- **King's note:** Fathom data should be able to fill a GHL custom field as well as a note. The agency and the sub-account admin manage all of that (what is seen and where it goes); the user manages only their own connection, settings, calendar, and so on. Slack is one per account; Fathom is one per user.
- **Finding [MINE]:** GHL lets an app update a contact's custom fields (the update-contact call with a custom field list; needs contacts.write) and list an account's field definitions (a separate custom-field scope). A field holds one current value, so it suits "last meeting date" and "next steps", while notes keep the history. Two risks: a field's value can be merged into messages sent to the contact, and updating a field can start the client's own automations.
- **To do:** a Contact field destination with an admin-set field mapping, newer-meeting-wins ordering, type checks, plain warnings, and exclusion from our metrics. An admin account setup that sets the menu and can lock settings; users choose only inside what the admin left open. The user's own calendar connection is not built until King says what it must do. Slack and Fathom stay visible; only Zoom and Google Meet are hidden.
- **Runbook stage:** E0, E2b. **Severity:** S2.

## OPEN ITEMS TO CONFIRM (batches 1 to 9)
1. N2: is my reading of "sub-account item in Today" right?
2. N4: Slack incoming webhook inside F9 with email as fallback, and the full Slack app left for E3. OK?
3. ~~N1: how should "industry" be defined?~~ Answered in N58 and N72: a label typed per client that drives industry playbooks and reply targets. The top filter does nothing until there are two industries.
4. N10: which gauge looks "child built"?
5. N8 and N34: one filter bar with role-based options, hidden on single-account pages. OK?
6. N13: tabs ("Last 7 days | Older | Unread") with a 3-row peek OK?
7. **N27: how do King's clients define "setter" and "closer"? (the user who booked the appointment, or the user who owned the lead before booking? Is the closer the appointment's assigned user or the opportunity owner?)** Still open from batch 3.
8. N20, N35, N53, N55: saved lists, a Dial button through the CRM dialer or a chosen provider (Kixie later), no telephony, People module merging Search, Leads, Call lists. OK?
9. N28: build D0 (structure and shared components) before the page changes in F2 to F5, even though it delays M1 by some hours?
10. N40 and N51: a staged actions layer with separate optional write scopes, starting with appointment outcomes and owner assignment. OK?
11. N41 and N57: payments ideas cover (A) the agency's revenue protection from its clients and (B) a business's own customers' failed payments. Which comes first?
12. N33: insert S0.4 "Sync reliability" before F2?
13. N48: remove the cross-client "same person" list, or keep it agency-only, off by default, with consent? (I recommend removing it for now.)
14. N56: consolidate Accounts and Clients into one Clients module with sub-tabs. OK?
15. N59: a deliberately small ticket feature (not helpdesk parity). OK?
16. N52: the agency picks an accent colour in Settings (white-label data has no colours). OK?
17. **N64: request all roadmap scopes as OPTIONAL, grouped by feature, in one 2.2.0 release, instead of enabling every scope the platform offers? (my recommendation)**
18. **N70: the staged duplicate path: guided merge first, a real merge only if a safe API exists, master-record rules, a 30-day safety copy described honestly. OK?**
19. N71: merge Duplicates and Data cleanup into one Clean-up module. OK?
20. N66: the resale profit dashboard goes in the Revenue module with N57. OK?
21. **N75: which trust items go into the pilot? (my suggestion: a Trust page, honest company details, 24-hour support, the data-deletion promise, and a verified sender domain for kdsquares.com)**

22. **N93: remove the "save an unmatched meeting into a client account" option now, for privacy? (I recommend yes.)**
23. **N100: Fathom first (E0, E2), with Zoom and Google Meet only when a pilot user asks? (I recommend yes.)**
24. N96 and N97: who may allow transcripts to be written to the CRM: the sub-account admin only (default), or each user?
25. N95: may a sub-account admin see who has connected (names and status, never content)? (default yes)
26. N98: group users by a SubSync Team list built later with the Team directory, or only by GHL roles? (default: Team list later)
27. N104: what should a user's own "calendar" connection do: connect their Google or Outlook calendar (for example to match meetings to booked appointments), or is it the GHL calendar they already use?

## CROSS-BATCH THEMES
1. **Plain words:** SLA, industry, estimate, "counted at risk", "not enough data", "private address", "merge into kept" all confuse. A jargon pass is needed, plus guides for non-technical users.
2. **One filter bar, role-aware, everywhere it applies (and nowhere it does not).**
3. **One definition per number, versioned:** the same metric has the same value on every screen, tiny samples never produce scary claims, and a definition change never shows up as a trend.
4. **Trust in estimates and scores:** every forecast, score, and confidence shows its method, sample size, and inputs.
5. **Data point audit:** every card must answer a question, serve a user, and support a decision, or be cut.
6. **Layout:** long pages, stacked status strips, cards inside cards, empty cards. A module sub-navigation pattern, a shared list component, a shared lead drawer, and a design system fix most of this.
7. **Navigation:** dead ends and unclear Open buttons.
8. **Design quality:** a design system first, light and dark themes, King approves, then roll out.
9. **People, not IDs:** names and photos everywhere.
10. **Empty states and demo data:** small accounts make the product look empty.
11. **Sales accountability:** setter and closer performance is the biggest feature request.
12. **Freshness:** sync must run by itself and say honestly how fresh the data is.
13. **Stage and pipeline awareness:** owners classify stages and pipelines so junk never counts.
14. **Live in SubSync:** a shared lead drawer plus a safe, staged actions layer so people do not go back to the CRM.
15. **Agency business tools:** client billing health, resale profit, a small ticket feature, QBR and compare, onboarding templates, and a Team directory.
16. **Privacy across clients:** nothing may reveal one client's customers to another client's users.
17. **Capability honesty:** say exactly why something is unavailable (needs permission, platform restriction, or not exposed), and request the scopes the roadmap needs, as optional and explained.
18. **Safe destructive actions:** DND and unsubscribed contacts are never deleted, anything with payments or workflows is protected, merges and deletes come with warnings, previews, caps, and undo, and backups are described honestly.
19. **Trust by design:** a product from a new, non-US vendor earns trust through true numbers, one honest freshness line, a Trust page, real company details, reliable support, risk reversal, and proof. No inflated claims.
20. **Operating principles:** evaluate before building, verify after, find the best possible alternative when something is not possible, and leave it (documented) when there is none. Never promise in the UI what is not live.
21. **Notifications and scheduling:** one preferences matrix (type, channel, time, recipients), editable copy, a scheduler that can honour the hour, and a feedback loop (votes and suggestions notify King).

22. **Ownership of connections:** a personal tool belongs to the person and a workspace tool to the account. Admins see status, never content. Data is never placed by guessing, and our own writes never change our own numbers.

## HOW THIS FILE IS USED
The compiled order, defaults for every open item, the standing rules, and one prompt per stage are in `docs/ROADMAP_V2.md`. Claude Code reads the note IDs referenced there for the full text.
