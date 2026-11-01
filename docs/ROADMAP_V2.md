# SubSync Roadmap V2.1: Compiled Order and Stage Prompts

Save as `docs/ROADMAP_V2.md`. Companion files in the repo:
- `docs/KING_REVIEW_NOTES.md`: the full text of every note, referenced here by ID (N1 to N104).
- `docs/INTEGRATIONS_SPEC.md`: the full design for per-user connections and meeting notes (new in V2.1). It wins over the older E1, E2, and E3 text and over note N77.
- `docs/RUNBOOK.md`: the one-stage-at-a-time routine (spec, tests first, build, verify, King's 5 checks, STOP). Every stage below follows it.
- `CLAUDE.md`: the master brief. Add the block in section 2 of this file to it.

Where this file and an older document disagree, this file wins for order and scope. `CLAUDE.md` still wins on security, tenancy, and scope rules.

**WHAT CHANGED IN V2.1 (Nov 1, after King's review of the Connections screen):**
- New stage **E0** (per-user connections framework). **E2 is split** into **E2a** (Fathom end to end) and **E2b** (save destinations and content options). **E1 (Zoom) and E3 (Google Meet) move to "only when a pilot user asks"**, because Fathom already records Zoom, Meet, and Teams calls. King can overrule.
- The setting "if nobody in a meeting is a known contact, save it in [client account]" is **removed** (privacy, N93). Unmatched meetings go to a private Meeting inbox.
- **Connections are personal:** each user connects their own Fathom, Zoom, and Meet (N94, N95). Slack and the sending domain belong to the account and need an admin. Admins see who connected, never the content.
- Meeting notes can be saved as a **contact note**, a **conversation internal comment**, or kept in SubSync only, and each user chooses what to save: summary, action items, recording link, transcript, or a custom template (N96, N97).
- **Our own writes must never count as replies or activity** (N99). An internal comment is an outbound message.
- **Immediate fixes by King (no code):** the Slack redirect URL and the Zoom scope `user:read:user` (spec section 13.1).
- Notes N91 to N104 added (N103: prove the code really reads and writes the live Supabase project; N104: Fathom data into custom fields, and the admin versus user split). New principles 12 to 14 in section 2.

---

## 0. HOW TO USE (King)

1. Save the notes file as `docs/KING_REVIEW_NOTES.md` and this file as `docs/ROADMAP_V2.md`. Add the block in section 2 to `CLAUDE.md`. Commit and push.
2. **Do not interrupt stage S0.3** (it is running). Wait only until S0.3 passes, not for the rest of the old runbook. When it passes, tell Claude Code: "S0.3 passed. Continue with the order in docs/ROADMAP_V2.md section 3." Paste the kickoff in section 8 once.
3. After that, the loop is unchanged: Claude Code builds one stage, verifies it, prints King's 5 checks, and stops. You reply PASS, FAIL (with what you saw), or NEXT.
4. Each stage prompt below is already in the repo. You only type the stage name: `NEXT. Run stage F1 as written in docs/ROADMAP_V2.md.`

---

## 1. WHERE THINGS STAND

- Original runbook: 20 stages. Claude Code is on S0.3 (the third). **17 original stages remain:** F1, F2, F3, F6, F4, F5, F7, F8, F9, F10, E1, E2, E3, E4, Z1, Z2, Z3.
- The notes add: **S0.2b, S0.4, D0, D1, C1, C2, T1, P1, W1, E5, R1, E0** (12 stages). F7 is absorbed into C1. Slack moved into F9, so E3 is now Google Meet.
- Realistic total: about 29 stages. In V2.1, E2 is split into E2a and E2b. Doing them all in one go would take weeks, so the order below puts the **sellable audit** first, then the **pilot**, then what pilots ask for.

---

## 2. STANDING RULES TO ADD TO CLAUDE.md (operating principles, from N88)

```
OPERATING PRINCIPLES (apply to every stage)
1. Evaluate before building. Before any build, write 5 lines in the stage file: (a) the decision this feature supports and for whom, (b) whether the data is truly available in the live API with our scopes (test it, do not assume), (c) whether the CRM already does it natively or a competitor does it well, (d) the simplest version that proves value, (e) the risk (data, privacy, scope, cost). If the answer to (b) is no, find the best available alternative. If there is still no way, do not build it: record it in docs/BLOCKED.md with what you tried and what would unlock it.
2. Do not build something just because it was asked. If you think a requested feature is a bad idea, say so and propose the better one. King decides.
3. Verify after building: real data, real roles (agency owner, agency staff, client admin, client user), real browser. A feature is not done until it works, not until it compiles.
4. Innovation: for each module, offer one or two differentiated proposals with evidence for why they would matter. Label them PROPOSAL. Never build a proposal without King's approval.
5. Never promise in the UI, in a listing, or in a plan description anything that is not live and verified. If a screen states what the product does or stores, an automated check must prove it.
6. Say exactly why something is unavailable: "Needs permission: reconnect", "Not available from the platform yet", or show the data. Never blur these.
7. Plain words for non-technical users (setters, realtors, small business owners). No internal terms. Explain every score and estimate in one line.
8. Protect people: DND and unsubscribed contacts are never deleted or messaged. Contacts with active payments, workflows, open deals, or upcoming appointments are protected from bulk deletes and merges.
9. Respect trust: SubSync is built in Nigeria and sold abroad, so accuracy and transparency matter more. Be upfront about who we are, what we read, and what we store.
10. Use the frontend-design (or UI/UX) skill for any UI work if it is installed. If it is not, tell King how to install it.
11. King's standing decision on write permissions (stated many times): write scopes MAY be requested whenever a feature needs them, as OPTIONAL scopes, with guardrails (preview, confirm, undo, audit log, role permission, caps, idempotent writes, DND and active-payment protection). Do not ask King again whether write is allowed. Ask only about the specific guardrails or wording.
12. Connections have an owner. A personal tool (Fathom, Zoom, Google Meet) belongs to the person who connected it: one connection per user, tokens never visible to anyone else, no shared or agency-assigned connections. A workspace tool (Slack, the sending domain) belongs to the account and needs an admin (the agency may also have its own agency-level Slack for its own cross-account digest; a client's Slack never receives another client's data). Admins see status and counts, never content.
13. Never place data by guessing. A meeting, note, or message goes to a contact only when it is matched with certainty; otherwise it waits in the person's private inbox. No setting may route one client's data into another client's account.
14. Our own writes must never change our own numbers. Anything SubSync creates (notes, internal comments) is logged and excluded from reply, activity, and engagement metrics, and from webhook echoes.
```

---

## 3. RECOMMENDED ORDER (cash first)

| Phase | Stages | Why |
|---|---|---|
| **0. Running** | S0.3 | In progress. Finish it |
| **1. Sellable audit (M1)** | S0.2b, S0.4, F1, D0, F2, F3, F6 | Safe, trustworthy numbers, a fresh data pipeline, a shared structure, and the Account audit with Share link. After this you can sell a paid audit |
| **2. Pilot-ready (M2)** | F4, F5, F8, F9, F10, C1, E0, E2a, E2b, D1 | The pilot menu works end to end: unanswered messages, Today, Settings and guides, alerts and Slack, People and Call lists, Clients, then personal connections (E0) and Fathom meeting notes written onto contacts (E2a, E2b), then the design polish |
| **2b. Release and pilot** | Z1, Z2, Z3 | Re-review, readiness, version 2.2.0 (read scopes in one batch), first pilot install |
| **3. What pilots ask for** | T1, C1b (tickets), P1, C2, E5, W1, E1, E3 | Setter and closer performance, a small ticket feature, the Pipeline rebuild, Clean-up and guided merge, Email health, safe actions, and Zoom and Google Meet meeting notes only when a pilot user asks (Fathom already covers those calls; King can overrule) |
| **4. Parked until evidence or cash** | R1, E4, industry benchmarks, the AI daily brief, custom report builder, advanced QBR | Need data, trust, or many installs first |

**Version numbers:** the live GHL version is 2.1.0 (a 1.0.0 with no installs also exists), so release A is expected to be **2.2.0** (published as Minor) and release B **2.3.0**. Use whatever number GHL offers. Older files and CLAUDE.md may still say 1.1.0 and 1.2.0: read those as release A and release B.

**Rules for the order:**
- D0 (shared structure and the style guide) sits before F2 so pages are not built twice. Time-box it. King approves the style guide early (about 30 minutes).
- From D0 on, every stage's UI uses the D0 components, so D1 is a polish pass, not a rebuild.
- Scope releases: **2.2.0** (read scopes plus the optional permissions to add notes to contacts and internal comments to conversations, needed for meeting notes, see docs/INTEGRATIONS_SPEC.md section 14, before any pilot installs) and **2.3.0** (the other write scopes, only when W1 starts). Each new scope forces re-approval on every install, and the version count is limited, so batch. Check which write permissions the app already requests (Data cleanup already needs one) before adding more.
- No prospect or pilot install until the gate in `docs/RUNBOOK.md` section 3 is met.

---

## 4. DEFAULTS ASSUMED FOR OPEN ITEMS (King can overrule any)

| # | Item | Default |
|---|---|---|
| 1 | N2 Today for a client account | Client-account Today, opens on the active account, switch to all accounts for allowed users |
| 2 | N4, N79 Slack | Slack sign-in app in F9, pasted web address only as "Advanced", email as fallback |
| 3 | N1 industry | A label typed per client or picked from a list; the filter is hidden until two industries exist |
| 4 | N10 gauge | Redesign all charts (health bar, waiting-time bars, any radial) |
| 5 | N8, N34 filter bar | One role-aware bar, absent on single-account pages |
| 6 | N13 tabs | Last 7 days / Older / Unread with a 3-row peek |
| 7 | **N27 setter and closer** | **Open. T1 does not start until King answers.** Proposed: setter is the user who booked the appointment (else the lead owner at booking time), closer is the appointment's assigned user. Configurable per user in Settings |
| 8 | N20, N35, N53, N55 lists and dialing | Saved lists, a Dial button through the CRM dialer link, Kixie later, no telephony |
| 9 | N28 D0 first | Yes, time-boxed |
| 10 | N40, N51 act layer | Phase 3, staged, separate optional scopes |
| 11 | N41, N57 payments | Parked (R1). Agency-side billing health first when started |
| 12 | N33 sync stage | Yes, S0.4 |
| 13 | N48 cross-client list | Remove |
| 14 | N56 Accounts and Clients | One Clients module |
| 15 | N59 tickets | A deliberately small version in Phase 3 |
| 16 | N52, N85 colour | Existing colour setting extended to the whole app, logo from white-label data |
| 17 | N64 scopes | Optional, grouped by feature, in releases 2.2.0 and 2.3.0 |
| 18 | N70 merge | Guided merge first; a real merge only if a safe API exists |
| 19 | N71 Clean-up | One Clean-up module |
| 20 | N66 resale profit | R1 (parked) |
| 21 | N75 trust items in the pilot | Trust page, honest company details, 24-hour support, deletion promise, verified sender domain |
| 22 | N77 meeting notes written onto contacts | Yes, for Fathom, Zoom, and Google Meet, with the write permission as an optional scope and the guardrails in stages E1 to E3 |

---

## 5. CONFLICTS AND RISKS FLAGGED

1. **D0 delays the sellable milestone** by some hours. Accepted, because rebuilding every page later costs more. Keep D0 minimal.
2. **"Turn all scopes on" versus least privilege.** GHL requires a justification per scope, and a small permission list is our advantage over the 165-scope competitor. Resolution: request only what the roadmap uses, as optional scopes, in two releases.
3. **Merge from SubSync.** The API may not have a safe merge. A deletion-based merge would lose conversation and payment history, and a "30-day backup" could only re-create fields with a new ID. Resolution: guided merge first, and honest wording.
4. **Payments and billing health** need financial scopes, which cost trust. Parked until evidence.
5. **Act layer (W1)** conflicts with "read-only by default". Resolution: Phase 3, staged, separate optional scopes, preview and undo.
6. **Meeting notes, Zoom, Fathom, Google Meet.** Contradictory wording today (N77). King's decision: write the note onto the matched contact, with guarded write permission. Fathom is likely the easiest path, Zoom may need Zoom's own app approval for other accounts, and Google Meet is likely the hardest (Google reviews apps that request sensitive scopes, and the notes feature needs a Workspace plan). Each stage evaluates the best path and uses the best available alternative (for example a notetaker that joins Meet) if there is no direct way.
7. **A daily scheduler cannot honour "Send at 08:00".** S0.4 and F9 must fix the scheduler (N80).
8. **Roadmap promises.** "We build in the order people ask" and the "Coming next" list over-promise (N86). Reword and align.
9. **Help desk space is crowded.** Build only the small version (N59).
10. **Scope of the whole plan.** About 28 stages. Do not start Phase 3 before a pilot agency has used Phase 2.
11. **King's own sending domain** (kdsquares.com) shows an authentication warning (N75). Fix it before audit pitches.
12. **Slack's terms.** Commercial distribution of a Slack integration must go through the Slack Marketplace (see section 9). Slack stays a pilot-level channel until approved; email and in-app are primary.

---

## 6. ADDENDA FOR THE ORIGINAL STAGES

Each addendum is added to that stage's acceptance criteria in `docs/RUNBOOK.md`. Read the note IDs in `docs/KING_REVIEW_NOTES.md` for the full wording. Always apply the operating principles (section 2).

### S0.3: no changes
S0.3 is running. Nothing is added to it. Its leftover items moved to S0.2b step 4.

### S0.2b: Tenancy follow-ups (new, small, before F1)
```
Stage S0.2b. Goal: close the security and trust gaps found in review.
1. N48: remove the "Same person in several client accounts" card and any cross-client matching. If any cross-client matching remains, make it agency-only, off by default, and disclosed, with a test that no client-account user can reach it.
2. N84: write tests that client-account users never receive fees, notes, tickets, settings, or other clients' data, and that switching client access off removes access immediately.
3. N83: generate the "What we store" list from the actual database schema, and add a test that fails if a table holds personal data that is not listed. Test that uninstall and "Delete my data" delete everything stated. Restrict "Delete my data" to the agency owner, with a confirmation and an audit entry.
4. Leftovers from S0.3 (N82): detect the white-label login domain automatically from the user data and install event, and keep the Links field in Settings only as an override. Check that no user-facing text still says "Agency view", "agency", "sub-account", "location", or exposes the platform's name, including Settings, emails, and the Share link, and that the banned-terms test covers them.
5. N93: remove the Meeting notes setting "If nobody in a meeting is a known contact, save it in [client account]" everywhere (screen, API, stored value). Migrate any stored value to "Do not save it (just count it)". Add a test that no code path writes a meeting to a contact that was not matched by email.
6. Hide Zoom (and Google Meet) behind a flag that is OFF by default (King's decision, Nov 1): the Zoom card on Connections, any Zoom text in Settings, Getting started, the Meeting notes page, the Trust page, and emails. Keep the code, the Zoom app registration, and the callback route. Add a test that no user-facing string mentions Zoom or Google Meet while the flag is off. Check that the GHL listing copy does not mention Zoom either. Slack and Fathom are NOT hidden: they stay visible on Connections. Only the Meeting notes page stays behind its own flag until E2a passes. Do not advertise Slack in the listing until its connect flow is proven (section 9).
Acceptance: all tests green. Write docs/features/S0.2b.md, print King's 5 checks, STOP.
```

### S0.4: Sync reliability and scheduler (new, before F1)
```
Stage S0.4. Goal: data is fresh, the app says so truthfully, and scheduled sends can honour the chosen hour. Read N33, N74, N80, N81.
1. Diagnose why refresh is irregular. The Data sync card says "about once a day and as changes arrive" while the product aims for 15 minutes. Check the hosting plan's scheduling limits, the job queue, and whether a job only runs from the manual button.
2. Fix it: real-time updates through webhooks where available (verify event names), plus a scheduled reconcile at least every 15 minutes, and a notification dispatcher that runs hourly or better. Choose the scheduler (higher plan, database scheduled jobs, or a queue service) after evaluating cost and reliability, and record the decision.
3. One freshness source: the last successful sync per account. Show it once, as exact text ("Updated 7 min ago"), changing wording when stale. Remove the vague "Data is under an hour old" badge. Add a test that every page shows the same freshness value.
4. Merge Connection health and Data sync into one "Sync status" panel (last success per account, next run, failures with reasons, a plain meaning for "jobs").
5. An internal alarm (not a user card) if sync is older than 30 minutes.
Acceptance: sync verified over several hours with timestamps, scheduler tests, freshness consistency test. Write docs/features/S0.4.md, print King's 5 checks (compare 3 timestamps with the CRM), STOP.
```

### F1 addendum: Numbers truth plus audits
```
Stage F1 (as written in docs/RUNBOOK.md) plus, in this order:
1. Data point audit (N44): write docs/DATA_POINTS.md for every card and number on every page: the question it answers, who needs it, the decision it supports, keep, merge or cut, definition, source, minimum sample. Stop and show King this list before cutting anything.
2. Capability matrix (N64): write docs/CAPABILITIES.md for every data point we want: endpoint, scope, whether we request it, whether each install granted it, and whether the platform gates it. Give each unavailable item a cause: "needs permission", "platform restricted", or "not exposed".
3. Fix the rules found in review: waiting counts (N15, one definition and window, ancient conversations never "Critical", unread defined separately, the wait chart uses the same set as the list), health labels include reply delay (N16), forecast trust rules (N37: minimum sample, a "How this is calculated" drawer, owner-set stage probabilities, timing from the real sales cycle, ranges), stage and pipeline classification so closed-out or "not in use" stages never count (N38), version metric definitions so a definition change never appears as a trend (N39), separate cold lists from engaged-then-quiet leads (N45), show "not checked" instead of zero when email and phone validity were not computed (N46).
4. Today's "285 unread" versus Inbox "259": find out whether two lists were added together (N15).
Acceptance: consistency test green, METRIC_AUDIT, DATA_POINTS, and CAPABILITIES written. Print King's 5 checks and STOP.
```

### F2 addendum: Speed to lead
```
Stage F2 plus: resolve user IDs to names and photos through the users API (N21); if the permission is missing show "Needs permission: reconnect", never raw IDs or placeholders. Explain progress toward each minimum ("1 of 5 replies so far", N22) and show raw counts first. Replace empty charts with one placeholder (N23). Show automated first touch separately from the human reply (N78). Recognise Meta and Instagram lead-form leads and other sources, and turn "99% Unknown" into an action (N47, N30). Render names in proper case. Show who replied. Explain in the UI that SubSync measures replies and does not send them. Show the reply target and the "count automatic messages as a reply" option on the Speed to lead page itself, with a link to change them in Settings (low priority; today they exist only in Settings).
```

### F3 addendum: Appointments
```
Stage F3 plus (N24, N25, N26): a status breakdown (booked, confirmed, showed, no-show, cancelled, invalid), a date-range selector that states the window, filters (client account, calendar, user or team, source), a detail view per appointment, and every count opens the list behind it. Under every Insights chart add "What this shows", "How to read it", "What to do". Calendar health shows n/a when inputs are missing (no points for missing data). The funnel must not claim "100% lost" on tiny data, and "customer" must be defined. The best-times heatmap appears only above its minimum. Fix the clipped source table, and keep calendars and sources separate. Use names, not IDs.
```

### F6 addendum: Account audit and Share link
```
Stage F6 as written. Add: every number links to its definition, the audit uses only verified metrics, and the print layout carries the agency's name and colour (N85). Tests for the link hardening stay as written.
```

### F4 addendum: Unanswered messages (the old "Inbox & SLA")
```
Stage F4 plus (N11, N12, N13, N14): rename the page ("Unanswered messages"); replace "SLA" wording with "your reply target". Tabs: Last 7 days (count) / Older (count) / Unread (count), each with a 3-row peek, nothing hidden by default. Filters: waiting time chips (over 4 hours, 24 hours, 48 hours, 7 days, older), channel, client account, assigned user; sort by longest wait; saved views. Long lists show 10 rows with "View all" in a paginated table. Move "Active deals with no contact" to Pipeline. Use names, not IDs. Add a back link that keeps context (N7).
```

### F5 addendum: Today
```
Stage F5 plus (N1, N2, N5, N9, N34): lead with leads waiting in plain words; one status line; remove the "When this is sent" and "Not watched yet" cards from Today (move coverage to Settings as a "What SubSync watches" panel with Watching and Not yet columns, N5); the filter bar is role-aware and shows what is hidden and why; client-account version of Today. Alerts and notices use the lightweight alert style, not content cards. Each tile shows no percentage change below a minimum size. Every drill-in has a back link (N7).
```

### F8: Settings, Getting started, roadmap, trust (rebuilt scope)
```
Stage F8. Read N76, N77, N79, N83, N84, N85, N86, N87, N64, N75.
1. Settings sub-sections (Team and access, Notifications, Integrations, Reply targets and thresholds, Brand, Data and privacy, Sync status, Advanced). Settings changes are audited. Roles control who can press "Delete my data".
2. Meeting notes wording fix now (N77): every screen says the same true thing about writing to the CRM. If the write permission is not granted, disable the option with "Needs permission: reconnect".
3. Getting started (N87): step-by-step guide per role, "Do it now" links, self-ticking progress, short animated or video steps.
4. Feedback (N87): a "Give feedback" box on every page and "Report a problem" with an error ID, stored and sent to King's Slack and email.
5. Roadmap page (N86): one vote per user per item, a "Suggest something" box, admin view for King, status labels, notify King (instant for suggestions, daily digest for votes), notify voters when shipped. Reword "We build in the order people ask" to "Votes help us decide what to build next". Align the items with the real roadmap.
6. Trust page (N75): what we read, what we store, for how long, how to delete it, why each permission is asked, which outside services process data, security practices, incident handling, a status link, company details that match everywhere. State only what is true.
7. Scope experience (N64): show per-feature "Needs permission: reconnect" prompts, grouped scope explanations ("Calls", "Team", "Email health"), and a docs/SCOPES.md that justifies each requested scope.
Acceptance: tests, the "What we store" and wording tests, guide verified by a fresh account walkthrough. Write docs/features/F8.md, print King's 5 checks, STOP.
```

### F9: Alerts, Slack, in-app notifications, email (rebuilt scope)
```
Stage F9. Read N4, N42, N79, N80, N9.
1. Slack: create a Slack sign-in app ("Add to Slack"): channel picker, test message, disconnect. Slack belongs to the account and needs an admin (N95); the agency can also connect its own Slack for its cross-account digest, and a client's Slack never receives another client's data. Support several destinations (one authorised channel each, for example one per sales team and one for admins) and route each alert type to a chosen destination (N98). Keep the incoming-webhook method (smallest scope set) unless it blocks this. A connect attempt that does not finish must expire after 2 minutes with a "Try again" button and a plain reason (N92). Slack's API terms say commercial distribution must go through the Slack Marketplace (see section 9), so plan the Marketplace submission and keep email and in-app as the primary channels until it is approved. The pasted web address stays only as an "Advanced" fallback. If the Slack app cannot be distributed yet, document the limit and keep the fallback.
2. Notification preferences matrix: for each type (daily brief, weekly summary, speed-to-lead breach, unmarked appointments, silent failure, sync problem, new ticket, ticket resolved) choose channel (in-app, Slack channel, email), time or frequency, time zone, quiet hours, recipients. Multiple email recipients.
3. Editable message copy per type with variables, a live preview, reset to default, and safe variable handling.
4. In-app notification centre: a bell with unread count, severity, dismiss and snooze, links to the item.
5. Scheduler verified (from S0.4): sends honour the chosen hour and time zone. Dedupe, retries, unsubscribe link.
6. Email: check the sending domain's SPF, DKIM, and DMARC, and send real test emails to King and an outside address. Report deliverability.
Acceptance: real Slack message and real email received, dispatcher tests, copy editor tests. Write docs/features/F9.md, print King's 5 checks, STOP.
```

### F10: People and Call lists (rebuilt scope)
```
Stage F10. Read N20, N35, N49, N50, N51 (read-only parts), N53, N54, N55.
1. Fix the 504 first: profile the query, add pagination, indexes, precomputed lists, caching, and a hard timeout with a friendly message and an error ID. Test on the 50,000-contact account.
2. Merge Contact search, Leads, and Call lists into one People module with sub-tabs: Search and filters, Smart lists, Going cold, Imports and sources. Global search box in the header (Cmd or Ctrl+K).
3. Smart lists: a filter builder (tag, date tagged where known, owner, source, last activity, last call, stage, account, custom fields), saved per user and team, cross-account for agency users, per-account for client users.
4. Lead drawer (shared component from D0): profile, tags with dates where known, custom fields, owner, source, timeline (messages, calls, appointments, deals, notes, tasks), next actions, previous and next arrows. "Open in CRM" as a quiet secondary link.
5. Tags: click a tag to see its leads and per-day counts. If the CRM does not expose when a tag was added, record changes from now and label the history "since SubSync started watching".
6. Dial button: opens the CRM dialer through the white-label link (verify whether a link can open the dialer), a phone link on mobile. DND and quiet-hours warning before dialing. Dialer provider setting (CRM dialer or phone link; Kixie as a later provider after checking its API). No telephony.
7. Call columns (last call, attempts, result) only if call records are available through the API (verify). Otherwise say so.
Acceptance: load time under 2 seconds on the large account (or a documented number), numbers verified, drawer works from every list. Write docs/features/F10.md, print King's 5 checks, STOP.
```

---

### Z2 addendum: Release 2.2.0 (scopes, pricing, versions)
```
Stage Z2 as written in docs/RUNBOOK.md, plus: bundle everything into ONE new version (2.2.0): the optional read scopes, the optional permissions to add notes to contacts and internal comments to conversations (plus read access to custom field definitions if contact fields are built; check what the app already requests; docs/INTEGRATIONS_SPEC.md section 14), the corrected listing copy, the pricing plan change, and release notes. GHL allows a maximum of 5 versions per app, so never create a version for a single change.
Pricing rules from GHL's update guide: pricing changes apply only to NEW installs, and existing installs keep their old price. The guide does not say whether a plan can be added or deleted inside a draft, so give King the portal steps (Versions, Clone as Draft, Build, Pricing, add or delete a plan, save, publish as Minor) and tell him to check after saving whether the change appears on the live version straight away, and whether deleting a plan that has installs is blocked.
Never deprecate a version that has installs: the guide says deprecation uninstalls every install on that version.
```

### Going public: GHL's rules (VERIFIED in GHL's Private App Install Limits policy and pricing help article)
- Path: My Apps, "Start Public (listed) review", Listing configuration, App type = Public, complete listing details, scopes and support info, submit for review.
- Public listing needs: logo or icon, 3 to 6 screenshots (real app, sample data, no GHL branding), a short description of at most 160 characters, a detailed description, categories and tags, plus the readiness items in docs/READINESS_AND_TEST_PLAN.md (Loom demo, 24-hour support).
- Public to Private is allowed any time, but the Private cap of 5 agencies applies immediately (at 6 or more agencies new installs are blocked until a review is passed or the app goes back to Public). The cap counts agencies, not sub-accounts.
- Once public, every update goes through Marketplace review before it goes live, and material changes to scopes, domains, or data flows may require a re-review. Finish features and scopes before submitting.
- Free trial: 1 to 90 days, set at app level for ALL plans; one trial per user per app per 90 days; the subscription starts automatically when the trial ends; the user is notified 24 hours before; the AppInstall webhook and Get Installed Locations API show who is on a trial. GHL documents no way to edit one user's trial and no coupon or promo-code feature for app pricing. The page does not describe cancelling during a trial: test it (install on the Pro plan on a test account, uninstall during the trial, confirm there is no charge).
- For per-user trials, use our own entitlements: put a pilot on the Free plan and unlock Pro features for a chosen number of days in `plan_entitlements`, then ask them to upgrade. Tell King this trades GHL's automatic conversion for control.

## 7. NEW STAGE PROMPTS

### D0: Structure, design tokens, shared components
```
Stage D0. Goal: one structure and one set of building blocks so no page is built twice. Read N7, N8, N9, N10, N14, N28, N29, N34, N36, N50, N52, N76, N89 and the cross-batch themes.
1. Use the frontend-design (or UI/UX) skill if installed. Produce a design direction brief first and show King 2 or 3 directions (colour, type, spacing, elevation, chart style, motion) with a style-guide page at /design. King approves before roll-out. Light and dark themes as tokens. Brand: agency name and accent colour, logo from white-label data.
2. Information architecture: the pilot menu (Today, Speed to lead, Appointments, Unanswered messages, Account audit, Clients, People, Settings, Getting started, What's new). Group names that are plain (no "Tidy up"). Module sub-navigation pattern (tabs or sub-nav, short views, about six blocks per view).
3. Shared components: page template; one role-aware filter bar (client-account selector for agency users, user or team, calendar, pipeline, source, date range for client users; carried in the link); one status line; one alert style distinct from content cards; list and table with 10 rows plus "View all", sticky filters, pagination; the lead drawer; back link with context; empty-state component; definition tooltip; skeleton loaders; error state with an error ID; charts with axes, labels, and tooltips and a placeholder under the minimum sample.
4. Mobile-first layout for client-account users (setters, realtors), large tap targets, an action-first "My day" view.
5. Apply the components to the M1 pages only. Other pages adopt them in their own stages.
Acceptance: style guide approved by King, component tests, e2e at 390, 768, 1440 px, no horizontal scroll. Write docs/features/D0.md, print King's 5 checks, STOP.
```

### D1: Design polish and light and dark
```
Stage D1 (after F10). Goal: a mature, consistent finish. Roll the approved design system across every pilot page. Remove cards inside cards, vary layouts, add restrained motion (number count-up, skeleton loading, hover and focus states), proper chart styling, and fix contrast. Light and dark themes verified on every page. Run the buyer and UX review from docs/BUYER_AND_UX_REVIEW.md in Mode A and fix every S0 and S1. STOP for King's sign-off.
```

### C1: Clients (consolidation and onboarding), with C1b tickets later
```
Stage C1. Read N56, N58, N59 (later), N60, N63, N72.
1. Merge Accounts and Clients into one Clients module with sub-tabs: Health, Onboarding, Details and billing fields, Compare, Reviews (QBR). Trend charts with axes for each client.
2. Onboarding (N63): every unfinished item has a "Fix it" link to the exact settings page (white-label link helper) and a short how-to; more auto-detection where the API allows; checklist templates by client type or industry, custom steps, assignee and due date, status and history, and "clients stuck over N days".
3. Details: inline edit, a log of conversations and notes with who and when, industry as a picker. Industry playbooks and reply targets by industry, with one switch.
4. Compare: two or more clients, trend charts, differences highlighted, versus the average. QBR: quarter selector with the previous quarter, KPI trends with axes, wins, issues, a "what SubSync caught" proof section, branded print and PDF. Compare setups: a structured diff and only when accounts share a baseline.
Acceptance: tests, verified against live data. Write docs/features/C1.md, print King's 5 checks, STOP.
```
```
Stage C1b (Phase 3): a deliberately small ticket feature (N59): submit (subject, category, priority, details), status (open, in progress, resolved), comments both ways, assignment, notifications (Slack and email to the agency; in-app and email to the client on resolution), history on the client's record. Tenant tests: a client sees only its own tickets. No help-desk parity.
```

### T1: Sales team performance (setters and closers) (needs King's definition, N27)
```
Stage T1 (do not start until King answers the setter and closer definition, or approves the default). Read N27, N61, N21.
1. Verify the data: who set the appointment, who is assigned, outcomes, and the opportunity won after it. Write what is and is not available into docs/CAPABILITIES.md.
2. Settings: mark each user as setter, closer, or both, and group users into teams.
3. Views: leaderboards and graphs for bookings, show rate, close rate, revenue by user and team; week-over-week trends and comparison with the team average and targets; "whose rate needs attention". Filters by user, team, calendar, source, date range, custom field. Saved views and CSV export.
4. Trust: every number opens the appointments behind it; written definitions; minimum sample before ranking; the owner chooses who sees whose numbers; no public ranking by default.
5. Team module (N61): directory with name, photo, role, accounts, calendars, assigned leads, calls where available, activity graphs, users added or removed "since SubSync started watching".
Acceptance: numbers verified on live data and by hand, privacy settings tested. Write docs/features/T1.md, print King's 5 checks, STOP.
```

### P1: Pipeline rebuild
```
Stage P1. Read N36, N37, N38, N39. Rebuild Pipeline with sub-tabs (Overview, Forecast, Stages and bottlenecks, Stale deals, Clean-up, Compare). Apply the forecast trust rules, stage and pipeline classification, and versioned definitions. Start recording stage changes in the event store if not already, and use only recorded history for velocity. Charts with axes. Stale deals open in the lead drawer. Acceptance and STOP as usual.
```

### C2: Clean-up (Duplicates plus Data cleanup)
```
Stage C2. Read N67, N68, N69, N70, N71, N73. Do not merge or delete anything in the CRM until step 2 proves it is safe.
1. Merge Duplicates and Data cleanup into one Clean-up module with tabs: Duplicates, Formatting, Tags, Invalid and old leads. Remove the industry bar from this module.
2. Facts first: test whether the CRM API has a real merge that keeps history, whether a link can open the CRM's own merge screen with contacts preselected, and whether deleted contacts can be restored. Write the findings in docs/CAPABILITIES.md.
3. Duplicates: confidence combines name, email, and phone similarity and drops sharply when names differ (a group with several different names is "shared phone or email, probably different people"); a source-of-duplicates view (created when and how, import days, created before blocking was on); filters; plain-language labels and a three-step flow; a short guide.
4. Guided merge first: suggest the master with a stated reason (ongoing subscription or payment, then active workflows, then open deals, then recent activity, then most complete data); show differences; open the CRM merge screen or give exact steps; record the outcome and re-check. A real merge only if step 2 shows a safe API.
5. Safeguards everywhere a merge or delete exists: warn on different details, block on very low similarity, protect contacts with active subscriptions or payments, never delete DND or unsubscribed contacts, protect contacts with open deals or upcoming appointments, a cap per run with a second confirm, typed confirmation for deletes.
6. 30-day safety copy of changed records with a restore that says honestly what can and cannot be restored.
Acceptance: tests on messy data including DND, payments, and low-similarity groups. Write docs/features/C2.md, print King's 5 checks, STOP.
```

### E5: Email health
```
Stage E5. Read N65. Do first the checks we control: SPF, DKIM, and DMARC with the exact record to add and continuous monitoring with change alerts; SSL certificate expiry; domain expiry through public registration lookups; MX and typo checks on contact emails. Then verify what the CRM API gives for sent, delivered, bounced, complaints, and affected contacts, and whether bounce reasons exist and whether purchased domains and their expiry can be listed. Build only what is available; label inferred reasons as inferences. UI: a trend chart with a threshold line, filters, a "leads affected" table that opens the lead drawer, and a "what to do" panel. Acceptance and STOP as usual.
```

### W1: Safe actions (write scopes, release 2.3.0)
```
Stage W1 (after pilot feedback). Read N40, N51. Add separate optional write scopes per action group and build in this order, one at a time, each with preview, confirm, undo window, audit log, role permission, bulk caps, and an entry in the event store: (1) record an appointment outcome, (2) assign an owner to a lead with none, (3) move, close, or abandon a stale deal, (4) create a task or note, (5) add or remove a tag. No messaging. Acceptance: tests, a live sandbox check of each action, and GHL review justification for each scope. STOP after each action group.
```

### E0: Connections framework (per user), V2.1
```
Stage E0. Read docs/INTEGRATIONS_SPEC.md in full, notes N91 to N102, and operating principles 12 to 14. Evaluate first (principle 1) and write the 5 lines.
1. Data model (spec section 11): user_connections, meeting_note_settings, meeting_policies, meetings, crm_writes. One connection per GHL user and provider. Tokens encrypted at rest, never readable by another user, role, or the agency. Follow the tenancy rules in CLAUDE.md.
2. Identify the person from the user context GHL provides (userId, companyId, role, type agency or location, activeLocation, isAgencyOwner), never from a typed name. Key a person by (companyId, userId). Agency users connect once and it works across the accounts they can access (spec section 3.2). Migrate the existing Fathom connection (and any Zoom row) to per-user.
3. Screens (spec section 12): Settings, Integrations with "My connections" (every role: Connected as, status, last meeting, Test, Disconnect) and "Team connections" (admin: Slack, a status table of who has connected, revoke). Remove any shared or agency-assigned connection and any "save into a client account" setting.
4. Pending states expire after 2 minutes with "Try again" (N92). Replace internal wording with the plain messages and codes in spec section 12. Log the real provider error (code only, no secrets).
5. Policy (spec section 6): agency default, account policy, user choice; the most restrictive wins; the admin view shows status and counts, never content.
6. Write log and metric guards (spec section 10): crm_writes; exclude InternalComment messages and SubSync-caused events from reply, activity, and engagement metrics; drop webhook echoes of our own writes.
7. Cleanup: a deactivated user or an uninstall deletes tokens, revokes provider webhook subscriptions, and removes stored meetings. Add the new data to "What we store" (generated from the schema).
8. Run the CHECK tests in spec section 4 for the GHL note and internal comment calls (real length limits, line breaks, required fields, conversation creation, deletion) in a test account, and write the findings to docs/features/E0.md.
9. Supabase proof (spec section 11.1, N103): migrations applied to the LIVE project and compared with the repo; RLS on every new table, tested with real roles; encrypted tokens only readable by server code; no service-role key in the browser bundle or a NEXT_PUBLIC variable; database-level unique constraints with a simultaneous-retry test; a row lock around token refresh with a simultaneous-refresh test; pooled connections. Show live row counts and the names of the environment variables (never the values).
Acceptance: the Supabase proof in item 9 is written down with live evidence; two real users in one account connect separately; a third user cannot read their data; an agency admin connects Fathom once and a meeting with a contact in account B lands in B under B's policy and field mapping; an agency staff member cannot save into an account they cannot access; an admin sees status only and can revoke; a revoked user must reconnect; the pending state expires; Speed to lead ignores a real internal comment; uninstall removes tokens and subscriptions; tests green. Write docs/features/E0.md, print King's 5 checks, STOP.
```

### E2a: Fathom per user, end to end (the proof)
```
Stage E2a. Read docs/INTEGRATIONS_SPEC.md sections 5 to 9 and section 9 of docs/ROADMAP_V2.md (Fathom facts). Depends on E0.
1. Evaluate first (principle 1). Confirm against Fathom's live docs: webhook options (summary, action items, transcript), what an OAuth app can read, rate classes. Record what changed.
2. Per-user Fathom connect (rotating refresh tokens with a locked refresh), a webhook created per user with its own destination URL, the secret stored at creation, signature check on the raw body, dedupe on the webhook id.
3. Matching exactly as spec section 7: no guessing; duplicate contacts and cross-client matches go to the Meeting inbox.
4. Write one note per meeting per matched contact, authored as the connecting user, using the Recommended preset and the default template (spec section 8). Idempotent. A first-save preview with confirm. Daily caps. Audit log. Log every write in crm_writes.
5. Meeting inbox for unmatched and ambiguous meetings (private to the owner, auto-delete after the policy period; Link, Dismiss, Always ignore).
6. Wording: every screen says the same true thing (N77). Keep the page behind the flag until acceptance passes.
Acceptance (King's own account, real meetings): the webhook writes a row to the live Supabase project (show it) and two simultaneous retries of the same webhook produce exactly one note; a real note on a real contact authored as King; a no-match meeting in the inbox; a duplicate-contact case in the inbox; two attendees write two notes; a second unrelated Fathom account works; a forced and a concurrent token refresh both work; the off switch and uninstall deletion work; tests green. Write docs/features/E2a.md, print King's 5 checks, STOP. Recommend KEEP or CUT with evidence.
```

### E2b: Save destinations (note, comment, contact field) and content options
```
Stage E2b. Read docs/INTEGRATIONS_SPEC.md sections 5, 6, and 8. Depends on E2a being KEEP.
1. Add the Conversation comment (internal comment) destination and the Contact field destination (GHL custom fields) next to Contact note, using the real limits recorded in E0 (include the maximum length of a text custom field). Contact fields follow spec section 8.1: admin field mapping, newer-meeting-wins ordering, type rules, the plain warnings, and exclusion of our writes from metrics.
2. The "What to save and where" table, the presets (Recommended, Full record, Summary only, Custom), and templates with a live preview that rejects unknown variables.
3. Split long content into "Part 1 of N" at paragraph boundaries; a transcript beyond the size cap becomes a link.
4. The transcript is off by default and is written to the CRM only if the user turned it on AND the account policy allows it. Request from Fathom only what the user chose to save.
5. Source priority when several tools recorded the same meeting (the rule is needed once Zoom exists; build it now).
6. Admin account setup (spec section 3.1): allowed destinations, the field mapping, the account's default preset, and locks. A locked setting shows the user "Set by your admin". Agency owner defaults sit above the account setup. Users manage only their own connection and the choices the admin left open.
Acceptance: a field is written only when the admin mapped it, an older meeting never overwrites a newer value, a locked setting cannot be changed by a user; a long summary splits correctly into both destinations; a transcript is written only when user and policy both allow it; Speed to lead still ignores our comments; tests green. Write docs/features/E2b.md, print King's 5 checks, STOP.
```

### E1 (Zoom) and E3 (Google Meet): only when a pilot user asks
```
Do not start E1 or E3 until King confirms that a real pilot user asked and E2a is KEEP. Read docs/INTEGRATIONS_SPEC.md sections 4 and 15.
E1 Zoom: evaluate first. Use per-user (user-managed) OAuth with the scopes in spec section 4 (user:read:user is mandatory; pick the summary scope in Zoom's own picker). Decide the app type and approval route for users outside KD Squares (Marketplace review or the Publishable URL process), implement the deauthorization endpoint, use the meeting.summary_completed webhook AND a polling reconcile every 15 minutes (the webhook may not arrive), explain the plan and setting requirements in plain words, and dedupe against Fathom with the source-priority rule. Reuse E0, E2a, and E2b. Acceptance: a real Zoom meeting with AI Companion on produces a note; a missed webhook is recovered by the poll; a free-plan host sees a plain "needs a paid Zoom plan" message.
E3 Google Meet: evaluate first. The likely best route is Fathom joining Meet, which E2 already covers. If nothing better exists, record it in docs/BLOCKED.md and stop.
Write docs/features/<stage>.md, print King's 5 checks, STOP after each.
```

### R1: Revenue (parked)
```
Stage R1 (parked until evidence). Read N41, N57, N66, N58. First research and write what the API exposes for SaaS subscription status, marketplace charges, wallet, transactions, failed payments, and invoices, with the scopes each needs. Report the trust and review cost of each scope. Only then propose a read-only version: client billing health (agency only), failed-payment follow-up lists, upcoming rebills, resale profit per client and per app. Invoice creation, if ever, follows the W1 guardrails. STOP for King's decision after the research.
```

---

## 8. KICKOFF (paste once, after S0.3 passes)

```
Read CLAUDE.md, docs/RUNBOOK.md, docs/ROADMAP_V2.md, docs/INTEGRATIONS_SPEC.md and docs/KING_REVIEW_NOTES.md. Make sure the operating principles in docs/ROADMAP_V2.md section 2 (principles 1 to 14) are in CLAUDE.md exactly once, between the SUBSYNC OPERATING PRINCIPLES markers (replace the block if it exists, never add a second copy). From now on follow the order in docs/ROADMAP_V2.md section 3, one stage at a time, using the routine in docs/RUNBOOK.md and the stage prompts and addenda in docs/ROADMAP_V2.md. Update docs/PROGRESS.md with the new stage list. After each stage write the evidence, print King's 5 checks, and STOP until I type NEXT. Start with S0.2b.
```

---

## 9. PRE-REGISTERED APPS (done by King; Claude Code builds to these values)

King registers the Slack and Fathom apps in their own developer pages (only King can log in there). Claude Code never needs the secret values pasted into chat: they are Vercel environment variables, and Claude Code can pull them locally with `vercel env pull`.

**Callback paths:** the code already uses `/api/integrations/<tool>/callback` (Slack's error message on King's first connect attempt showed `https://subsync.kdsquares.com/api/integrations/slack/callback`). Follow the paths the code actually uses, list the exact Slack, Zoom, and Fathom callback URLs for King, and make King's registered redirect URLs match exactly. Slack allows several redirect URLs. Fathom allows one production URL per app, so King edits the Fathom app if it differs.

**Slack** (used in F9). A NEW app named "SubSync" in the KD Squares workspace. Do not reuse "KD Squares Bot" or "king_N8n", which belong to other automations.
- Redirect URL: `https://subsync.kdsquares.com/api/integrations/slack/callback` (what the code sends; King originally registered `/api/oauth/slack/callback`, so both may be registered until the old one is removed)
- Env vars: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
- Bot scopes registered: required `chat:write` and `incoming-webhook`; OPTIONAL (Slack added optional scopes in March 2026, and the installing admin chooses): `chat:write.customize`, `channels:read`, `commands`, and `channels:history` (kept only for a possible future feature; nothing reads messages today, and no event subscriptions are enabled). The app must store the scopes granted at install, handle `missing_scope` gracefully, and hide features whose scope was not granted. F9 may recommend trimming. CHECK whether the custom sender name and icon (for white-label) works with the chosen posting method.
- Distribution and Slack's terms (VERIFIED, Slack's May 2025 API terms update): Slack says the Marketplace is the only appropriate channel for commercially distributing apps, and that unlisted distributed apps are for development and testing, not commercial distribution. The same applies to giving customers instructions for a templated custom app that connects to our product, so the pasted web address is not a way around it. Plan: build and test on the KD Squares workspace and with pilot agencies ("Activate Public Distribution" needs HTTPS URLs and no hard-coded credentials), then submit to the Slack Marketplace when eligible. VERIFIED in Slack's changelog: as of July 2026 an app needs at least 10 installations on active workspaces (used in the past 28 days, not sandboxes) and must keep 10 or more through the whole review. Slack's own blog and older pages say 5, so trust the changelog and re-check before submitting. Decide the full scope set before submitting: a third-party guide says changes to a published app's scopes need a new review of up to several weeks, and Slack analyses requested scopes against functionality, so unused scopes can cause questions or rejection. Until approved, do not advertise Slack as a feature; email and in-app are the primary channels. Unlisted commercial apps are also limited to 1 request per minute and 15 messages per call on the conversations.history and conversations.replies methods. Some customer workspaces require admin approval to install apps, so the connect screen must explain that. From Slack's own submission page (King's screenshot): apps using Socket Mode cannot be submitted, so keep Socket Mode off and use HTTP request URLs if events or interactivity are ever added; public distribution must be enabled first; the preliminary review takes about 10 days and the functional review about 10 weeks for a new app and 6 weeks for updates to a published app. Slack also counts only real, active, non-sandbox workspaces, so never create fake workspaces to reach the minimum.
- The pasted web address stays only as an "Advanced" fallback.

**Fathom** (used in E2). A self-serve OAuth app registered at fathom.video/marketplace_applications/new.
- Redirect URL registered by King: `https://subsync.kdsquares.com/api/oauth/fathom/callback`. CHECK it against the path the code uses (probably `/api/integrations/fathom/callback`) and tell King to edit the Fathom app if they differ.
- Env vars: `FATHOM_CLIENT_ID`, `FATHOM_CLIENT_SECRET` (the Production pair, set for the Production environment only). Fathom issues a separate Development pair for the development redirect URL, used only for local testing: `FATHOM_DEV_CLIENT_ID`, `FATHOM_DEV_CLIENT_SECRET` (set for the Development environment only). Never mix the pairs.
- Authorize URL (seen on the app page, Production tab): `https://fathom.video/external/v1/oauth2/authorize?client_id=...`. The token endpoint per Fathom's docs is `https://api.fathom.ai/external/v1/oauth2/token`. Use the app page and Fathom's SDK as the source of truth for both.
- The app page also shows an app-level Webhook Secret. If King saved it, it is `FATHOM_WEBHOOK_SECRET` (Production only). CHECK whether webhooks for an OAuth app are signed with this app-level secret or with a per-webhook secret returned at creation, and verify signatures accordingly.
- "Not yet reviewed by Fathom": the app page says users will see a notice asking them to confirm they trust the provider before connecting, and that a formal verification program is in progress. The connect screen must explain this plainly (what we read, what we store, that the notice appears because Fathom's verification is new), and SubSync applies to the program when it opens. Add this to the Trust page.
- Never click "Regenerate Secrets" on the Fathom app page: it invalidates the saved secrets.
- Facts to design around (from Fathom's developer docs, as summarised by a third-party integration guide dated September 2026; CHECK against the live docs):
  - Registration is self-serve and a free Fathom account is enough. The account that registers the app owns it, so use a login the company controls. The client secret is capture-once (Fathom publishes no way to re-read it).
  - One production redirect URI per app (HTTPS required). The only scope is `public_api`.
  - A token sees only what the authorising Fathom user can see: their own calls and calls shared with them or their team. Private unshared calls are never visible. Org-wide coverage needs an Account Admin with view access to all teams' calls to be the connecting user. The meeting-note feature must explain this and may need each rep to connect.
  - OAuth apps cannot use the summary and transcript options on the meetings list. Use the recordings endpoints, which are a "heavy" rate class (30 per minute, sometimes lowered to 5). The general limit is 60 per minute per account. There is no single-meeting lookup, and the list page size is fixed at 10.
  - Access tokens are short-lived and refresh tokens are single-use and rotate: store the new one on every refresh and lock concurrent refreshes (the loser gets a 400).
  - Webhooks are created through the API per user. The response returns an id and a secret exactly once, so store both at creation (without the secret, deliveries cannot be verified). Verify the signature headers on the raw body (HMAC-SHA256, reject timestamps older than about 5 minutes) and dedupe on the webhook id. Use a separate destination URL per connected user, because the payload does not say whose it is. Webhooks fire once when the summary is first ready, never re-fire when content changes, and a call without a summary sends none (test with a roughly 2-minute meeting). Solo (non-team) users subscribe to `my_recordings` only, because two team trigger types are Team-plan only.
  - Retention policies on Enterprise plans can delete old recordings, so history can be truncated.
  - Verify with a second, unrelated Fathom account, including a forced second refresh and a concurrent refresh.
  - Support and launch contact: help@fathom.video.

**Slack, update (Nov 1).** King's connect attempt failed with `redirect_uri did not match any configured URIs` for `https://subsync.kdsquares.com/api/integrations/slack/callback`. The address must be added under OAuth and Permissions, Redirect URLs, and then saved with the separate Save URLs button. The failing request used Client ID `4475622980481.12455703070615` (compare it with Basic Information) and asked for the `incoming-webhook` scope only. Until the fix is confirmed, the Connections card must not stay on "Waiting for you..." (N92).

**Zoom** (used in E1, later). A General app, user-managed, registered by King earlier.
- Callback path, confirmed from King's Nov 1 attempt: `https://subsync.kdsquares.com/api/integrations/zoom/callback`. Zoom allows one primary redirect URL per app and it must match exactly.
- Required scope now: `user:read:user`. Without it Zoom refuses the call that identifies the user, and SubSync shows "Zoom did not say who signed in". Anyone who authorized before a scope was added must reconnect.
- Development and production credentials are separate pairs. Users outside KD Squares' own Zoom account need the production route (review or the Publishable URL process, a deauthorization endpoint, logo, terms, and privacy links).
- Do not add summary or recording scopes until E1 starts. Never paste callback links containing `code=` into chat or tickets: they carry a one-time authorization code.
