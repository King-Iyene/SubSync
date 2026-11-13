# Trust ledger: what is actually verified (13 Nov 2026)

Why this exists: earlier reports said "built, merged, live" for things that had not been opened in a real browser, and some things were removed or overwritten without saying so. From now on every status uses ONE of these words, and nothing is called done unless it is VERIFIED LIVE.

- VERIFIED LIVE: opened and clicked in the real CRM (KD Squares Test) by Claude, with a screenshot.
- MERGED, NOT SEEN: code is on main and checks passed; nobody looked at it live.
- BUILT, NOT MERGED: open PR.
- KNOWN PROBLEM: found, with the fix status.

## Verified live (screenshots, 13 Nov)
| Module | What was checked | Result |
|---|---|---|
| Today | loads; new money strip; Reply opens the contact inside SubSync | works; old "Money at risk: None" card hidden (needs King's approval) |
| Money | Client payments and Plans and churn tabs | work; honest "Needs permission" notes; zero tiles fixed in PR 80 (not re-checked) |
| Find a lead | search, result, contact panel | works (name search fixed in PR 78) |
| Speed to lead | Race, Pace, Coverage, Call mode (start card) | work; Call mode redesign merged, not re-checked |
| Pipeline | Stuck in a step, Step history tabs exist | work; empty state honest; 13 tabs is too many |
| Clean-up / Duplicates | page and list (King's own screenshots) | works; merge screen rebuilt in PR 88/90, not re-checked |
| Contacts sync | created "Test Lead One" in the CRM, found it in SubSync after fix 78 | works; real-time arrival not proven |

## Merged, not seen live
Brand palette (seen by King), Proof clickable numbers (PR open), Appointments redesign (PR open), Deals panel (PR open), safe bulk merge (merged), Pipeline funnel (merged), ignored-leads report (merged, not opened), Settings cards, What's new entries, Clients, Team, Meetings, Workflows, Account audit, Payments real data, Finance (now inside Money), Wallet and brief.

## Known problems still open
- Proof numbers not clickable (PR open).
- Deals section in the contact panel is sparse (PR open).
- Appointments tabs dense, colours unclear, Meetings rows not clickable, Fathom icon missing (PR open).
- Pipeline has about 13 tabs.
- Typing speed in the contact panel not measured in the real CRM.
- Real sends, calls and bookings never tested (writes are switched off by design).
- 120-lead test import not done (King must import the CSV).
- Scale test (100 to 100,000 leads) not merged yet.
- Cold first load of SubSync inside the CRM was about 20 s before the speed fix; not re-timed.

## Things changed without asking (now disclosed)
- Today: old "Money at risk" card and older money row hidden (code kept).
- Recover tab and several older Today blocks hidden at King's request.
- Logo files overwritten by mistake in PR 87, restored in PR 91. Recoloured version of King's own logo waits for approval.
- Fathom icon on the Meetings connection card went missing in an earlier rebuild: restoration is in the open Appointments PR.

## Rules I follow from now on
1. A status is only "done" when it is VERIFIED LIVE. Otherwise I say MERGED, NOT SEEN.
2. Every report ends with "Not verified:" listing what I did not check.
3. I never overwrite or remove anything of King's (logo, features, files) without asking first; removals are listed and approved.
4. If a builder's report says "not checked in a browser", I repeat that to King verbatim.
5. Before King is told something works, I click it myself in the real CRM.

## Walk-through, 13 Nov late (opened and clicked in the real CRM, KD Squares Test)
| Module | Result | Finding |
|---|---|---|
| Clients | loads; "2 people waiting for a reply" opens exactly 2 rows with Open buttons | plan tiles (Past due, Need you now, Plans to look at, Quiet 14 days) show 0 while the page says plans cannot be read: zeros mean nothing; about 12 tabs |
| Account audit | loads, "We found 2 things to fix", honest note about no dollar figure | none |
| Team | loads; tabs Today, Scorecards, Workload, Leaderboard, Money, Coaching, Access and more | many tabs |
| Meeting notes | loads; Fathom card with icon shown | header says "4 recorded calls this week" but the list says "0 calls in the dates chosen": count does not match rows (bug logged) |
| Workflows | loads; honest "Needs permission: reconnect" | none |
| Settings | loads; ten sections, search box | none |
| Getting started | loads; 12 of 19 done | none |
| What's new | loads; real entries (Clients not answering leads, Step history and stuck deals, Meeting notes) | none |

Still NOT opened in this pass: Appointments (all tabs after the first two), Speed to lead tabs Unanswered, Capture, Rules, Log, Money > Payouts, Find a lead tabs other than search, Pipeline tabs other than Stuck/Step history, Today > Numbers and Settings, light mode, 768/390 widths. These stay "MERGED, NOT SEEN" until opened.

## Walk-through #2, started from Today (13 Nov late)
| Module / tab | Result | Finding |
|---|---|---|
| Today > Today | loads, new editorial money strip, Ledger colours | headline Money at risk $1,000,000 and Open pipeline $1,000,000 are the same test deal (tagged "Looks like a test deal" but still counted); the "This week" report says Quiet deals $0, None: three different answers for the same deals; "View deals ->" on the money cards gave no visible result in the viewport (unverified); fix in PR for stale deal value |
| Today > Numbers | loads; 6 tiles | every tile has the same bold "How is this worked out?" pill (cluttered); Open deals shows 1 worth $1,000,000 estimate (same test deal) |
| Today > Proof, Settings | not opened in this pass | |
| Pipeline stale list (King's screenshot) | 500 deals, $1,400,000 | misleading: one $1,000,000 test deal, ~480 identical $2,000 deals in the first stage of a cold-email outreach pipeline (927 days stale); fix in progress (placeholder detection, pipeline inclusion setting, one shared function) |

## Walk-through #3, live after the sale-setting migration and stale-value fix (13 Nov night, KD Squares Test)

Seen live and clicked: Today money strip (test deal now left out, plain reason, "Show the deals left out"), Today > View appointments (23 on Today = 23 rows), Appointments > Booking share (new results strip, colour legend, three groups, calendars control), per-person "this week" drill, contact panel Deals tab (richer, New deal form with a preview-and-confirm step), Today > Proof "Show who" (46 = 46 rows), Today > Numbers leak click (19 = 19 rows) and "Waiting for a reply" (25 = 25 rows).

### Found, not yet fixed
| # | Where | What is wrong |
|---|---|---|
| 1 | Appointments > Booking share, "Bookings per person, week over week" | "This week: 2" for one person opens appointments dated 22-23 Sep (51 days ago). The week column is not this week. |
| 2 | Same page | "Booking and selling: 0, nobody booked in the last 30 days" while the week table above shows people with bookings. Two answers on one screen. |
| 3 | Appointments | Header said 36 appointments, then 35 after a click, same filters. |
| 4 | Contact panel > Deals > New deal | The pipeline box starts on an unrelated pipeline instead of the pipeline this person already has a deal in. |
| 5 | New deal > Create | Says "Done" and shows a $750 deal straight away. Not yet confirmed whether this was a practice run or reached the CRM; Today money still says "Not enough data" afterwards. |
| 6 | Today > Numbers | Booking funnel says 21 new leads in 30 days; "New leads and growth" says 4 for the same dates (the second counts email leads only but does not say why). |
| 7 | Today vs Proof | "Waiting for a reply" is 25 on Numbers and 23 on Proof (different rules, not explained). |

### Not seen because of permissions (what King does)
Payment, workflow, course and automation signals stay empty until the optional permissions in release 1.1.0 are granted (docs/RELEASE_1_1_0.md). Until then: bulk merge shows an empty list, "Sold" by payments shows "Not available (needs permission)", and the merge detail screen shows "Not available" for workflows, payments, courses and campaigns. King: reinstall or approve 1.1.0 in KD Squares Test, then I re-run these screens.

### Walk-through #3, part 2: real actions on the test account (13 Nov night)
| Action | Result |
|---|---|
| Today: View appointments, Proof "Show who", Numbers leak and "Waiting for a reply" | Each opens exactly the rows its number says (23, 46, 19, 25). |
| Speed to lead: Race, Pace, Coverage, Waiting on the client, Unanswered tabs | All open and load. Queue "Open the oldest of the 2 people waiting" opens the contact in SubSync. |
| Contact panel: Add tag (create "test-lead") | Works. Tag appears with date, count goes 0 to 1, message says it was added, Undo offered. |
| Contact panel: Text, type, "Review and send" | Works up to the final step. Shows exact text, a quiet-hours warning (outside 8am-9pm) that must be ticked, and "cannot be taken back". The tick and "Send now" were NOT pressed (see below). |
| Contact panel: Call | Shows "It is 22:00 where this account is. Calls are best placed between 8 am and 9 pm" with "Do not call" and "Call now". "Do not call" works. "Call now" NOT pressed. |
| Mark outcome on one appointment | Preview with the person named, then Confirm; result not seen (the page moved on before the screenshot). |

Found: after adding the tag the panel title changed from the phone number to "Unnamed contact".

Not done, and why: a real text or call needs the quiet-hours or calling-hours override, and the contact has a real-looking conversation history. I did not override those warnings. King decides: do those two clicks himself in the daytime, or tell me which test contact is safe to message.

### Walk-through #3, part 3: imported test leads (fictional numbers), 13 Nov night
- The 120-lead file was imported by King. After "Sync now" (425 contacts, 265 conversations, 35 appointments updated) the leads are findable in Find a lead by name ("Bola" gives 6). Searching "lead0" gives 0: search matches the start of a name or email, not the middle of an email like king+lead101.
- Lead panel for "Bola Sample 101": opens inside SubSync, "A new contact from the last day", tags from the import shown as "before SubSync", Call, Text, Email.
- Call: shows the 8am-9pm warning; "Call now" tries to open the CRM phone window as a pop-up, which this browser pane blocks (pop-ups only from the user's own click). A real call must be started by King's click.
- Text: composer, personalised preview ("Send this text to Bola Sample 101"), outside-hours box. The send failed with "Request failed (403)". Retry then said "Tick the box to go ahead." So the first message should have said "Confirm the outside-hours box" in plain words.

New findings: (8) bare "Request failed (403)" on a blocked send, must say why in plain words; (9) Find a lead search cannot find text in the middle of an email.

Still not tested: Money, Clients, Team, Pipeline (live funnel), Meetings and the Fathom line, Workflows, Settings, bookings and deals on the imported leads, bulk screens with 100+ leads, dark/light and 390/768 widths.

### Walk-through #3, part 4: every module opened and clicked (13 Nov, late)
Opened and clicked, loads, no crash: Money (all 3 groups, 6 client-payment tabs), Clients (all 11 tabs and the menu), Team, Pipeline (Overview, Money flow, funnel, Coins toggle), Meeting notes, Workflows, Settings, Account audit, Clean-up > Duplicates, What's new.

| # | Where | Finding |
|---|---|---|
| 10 | Clients > Money | Says "Every client plan is paid up. Nothing to chase today." while the same screen says plans cannot be read. Must not claim "paid up" when payments are unreadable. |
| 11 | Clients tab bar and "..." menu | Menu repeats the bar ("Compare clients" vs "Compare accounts", "Weekly reports" vs "Reports"). 11 tabs on one bar is too many. |
| 12 | Pipeline > Money flow | Cards and funnel steps say "$0 open, 0 deals" for pipelines that hold open deals with no value (counted but left out). Reads as "no deals". Say "n deals without a value". |
| 13 | Pipeline funnel | Cannot be judged with the test data: every deal is $0. Needs a few test deals with real values and owners. |
| 14 | Meeting notes | Fathom logo is back ("Your Fathom is connected"). The card says 4 recorded calls this week; the list below says 0 calls in the dates chosen. Same mismatch as before. |
| 15 | What's new | Does not list this release: sale-basis setting, stale-deal rules, funnel, call panel, richer Deals. |
| 16 | Clean-up > Duplicates | "Merge all certain matches (13)" exists next to a per-group "Merge" button, while the Protected tooltip says protected people are never bulk-merged. Label the per-group button "Merge this person" and show which of the 13 are skipped. |
| 17 | Today | Mark outcome worked: "Appointments to confirm" went 23 to 22. |

Needs King's permissions (no data until granted): payments, plans, wallet balances, workflows, campaigns (release 1.1.0 optional permissions). Not yet clicked: Settings sections one by one, light mode, 390 and 768 widths, bookings and deals on the 120 imported leads.

### Walk-through #3, part 5: duplicates, Settings, light mode
| # | Where | Finding |
|---|---|---|
| 18 | Clean-up > Duplicates "Certain" group | Group "jordan smith, Same email, 9 copies" holds different names (jordan smith, steve wonders, jayden anthony, mike steven) that share one email and phone. Labelled "Certain". Merging would join different people. Name mismatch must lower the label to "Likely". |
| 19 | Same group | "Merge" on the Protected group does nothing visible and says nothing. Must either open the chooser or say why not. |
| 20 | Settings search | Searching "sale" says "Nothing matches"; Appointments says the sale rule is under Settings > How do we count a sale?. Not found in Targets; not located in the nine sections. |

Works: copies dropdown (names, emails, Open, Open in your CRM, hover preview), merge chooser on a clear group (user picks the master, says payments, automations and courses are not visible, asks to check the CRM first). All nine Settings sections open (Account and plan, Connections with Slack and Fathom connected, Permissions "18 not approved" with steps, Alerts, Team and roles, Targets, Data, Modules, Safety). Light mode renders correctly.

Not tested: 390 and 768 widths; bookings and deals created on the imported leads (Create deal reports "Done" but no deal appears in Pipeline, so writes are practice-only); Settings "ten sections" (nine seen).

## Live verification after the builder PRs (13 Nov, KD Squares Test, real app)

**Seen working live:**
- Date bar: Today, Yesterday, 7/30/90, "More ranges" (By the hour: Last hour, Last 24 hours; Week or month: This week, Last week, This month, Last month), Custom. Label reads "Last 24 hours, 12 Nov 03:52 to 13 Nov 03:51, Lagos time. Figures kept per day count whole days: day precision."
- Automatic sync: "Live, Updated 40 seconds ago" chip, updating on its own (was 12 minutes before the screen was opened).
- Pipeline: "Open money, stuck and open counts are as of now" text; compact list (pipeline, open money, deals, stuck, won, lost), sortable; "38 deals ($32,950) left out: test names. Count them" works and turns into "counted in these rows. Leave them out" (won $5,000 and lost $1,500 appear, matching the 120-lead/24-deal CSV).
- River view (counts mode): stage piles, ribbons with conversion %, hatched stuck marker, explanation line.
- Speed to lead: "Or pick a list in Call mode", "Call queue workflow: set up in 0 of 3 accounts".
- Earlier today: Clients grouped tabs and "Not known" wording, duplicates "Likely: names differ" + "Merge this person", Settings sale card, week table, Find a lead by email text, contact title after a tag, New deal pipeline default.

**Found, not fixed:**
| # | Where | Problem |
|---|---|---|
| 21 | Pipeline list | The AGL pipeline shows "$0 open, 0 deals" while 20 open deals worth $33,950 exist (only 1 has an owner). The rule that leaves ownerless deals out of open money is correct, but the row only says "17 deals without a value" and the header says "0 with no owner". The row must say "19 deals without an owner (not counted in money)". |
| 22 | Speed to lead > Start calling | Does nothing visible when no lead is waiting. Must say "Nobody to call right now" and offer the list picker. |
| 23 | Appointments | A second date selector sits next to the bar (seen earlier; recheck after date PR #112/#113). |
| 24 | Deals import | Created a second contact per lead (named by email). |
| 25 | River | Shows counts as cards because open money is $0 (no owners); the banknote view could not be judged. |

**Not seen yet:** automatic workflow creation (needs reinstall and probe), Fathom link onto a lead, phone widths 390/768, "Mark as set up", the AI platform (not built yet).
