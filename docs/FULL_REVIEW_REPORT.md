# SubSync: full customer review, 31 October 2026

Written as a skeptical buyer and as the engineer who built it. Plain words. Nothing is softened.

**Test setup:** the live app (`subsync.kdsquares.com`) opened inside the CRM, signed in as King (agency owner), on the test account **KD Squares Test**, which sits next to two other accounts (3 in total). Read-only: nothing in the CRM was created, changed or deleted. Numbers were checked against the database and, where marked, against the CRM itself.

---

## 1. The bottom line

**Would I pay for it today? No. Not at $9 a client, not as it stands.** I would book a second call.

**Why that is not the same as "it's bullshit":**
- The core idea is real and most of the engine works: it reads real accounts, refreshes every 15 minutes, finds leads nobody answered, flags leads with no owner, finds appointments nobody marked, and its contact count matches the CRM exactly (332 and 332).
- What stops me paying is **trust and focus, not missing features.** The product contradicts itself on money (two different "open pipeline" numbers), shows a forecast built on 6 deals, opens with a headline about one test deal, and has about 20 menu items when the job is two or three things.
- Every one of those is fixable in days, not months. They are in section 9.

**What it would take for me to pay $9 per client:** the numbers agree everywhere; the first screen says "3 leads are waiting for a reply" in plain words; alerts reach me by email without my asking; and after a month I can see "SubSync caught 14 slow leads". Today it can show the problems but not the proof.

**Verdict: FIX THEN PILOT.** Do not put it in front of a paying agency until the five S1 problems in section 9 are fixed.

---

## 2. What I tested, and what I did not

| Area | How it was checked | Status |
| --- | --- | --- |
| Today | Opened live, read every line | Tested |
| Account audit and Share link | Opened, created a link, opened the public page | Tested end to end, names scrubbed |
| Overview | Opened live | Tested (one tile clipped) |
| Inbox & SLA | Opened live | Tested |
| Speed to lead | Opened live, rows compared with the database | Tested and data-checked |
| Appointments | Opened live, 38 appointments compared with the database | Tested and data-checked (Insights tab not opened) |
| Meeting notes | Opened live, code read | Tested; found a false claim |
| Contact search | Opened | Opened only, no search run |
| Pipeline and deals | Opened live | Tested (Stale deals tab not opened) |
| Leads | Opened live | Tested; one number looks wrong |
| Call lists | Opened, spun more than 5 seconds | **Never saw its content** |
| Accounts | Opened live; contact count compared with the CRM | Tested, matches |
| Clients | Opened live | Tested (mostly empty) |
| Team | Opened live | Tested |
| Setup | Opened live | Tested (checklists per account) |
| Duplicates, Data cleanup | Opened live | Opened; no change was applied |
| Settings | Opened live (client access, brand, email, speed target, connections) | Tested |
| Getting started, What's new and next | Opened live | Tested |
| Phone width | Today at 375 px | Tested (works; one column, tab bar) |
| Home page, both calculators | Opened live, numbers checked | Tested |
| Zoom: Connect Zoom button | Seen live, active | Button tested only |
| **Zoom: call ends, summary lands in SubSync and on the contact in the CRM** | **Not run.** Needs a paid Zoom host. The note-writing code has unit tests but has **never run against a live contact** | **NOT TESTED** |
| Weekly and alert emails | Keys are set; **no email has been sent or received yet** | **NOT TESTED** |
| Account-level views (setter, business owner) | Needs a second, account-only user | **NOT TESTED** |
| White-label with a brand name and a white-label domain | Brand not set in this account | **NOT TESTED** |
| Creating a new lead or appointment in the CRM and watching it arrive | CRM contact page was too slow to load in the test pane | **NOT TESTED** |
| Console errors, tablet width, keyboard and contrast | Not run | **NOT TESTED** |
| Real people (the only proof of demand) | None yet | **NONE** |

---

## 3. My first ten minutes as a customer

I am an agency owner with 20 clients. I have GHL workflows and I look at dashboards between calls.

1. **Seconds 0 to 5.** The first thing I see is a filter bar ("Show only: All industries", "Hide 1 test account"), then "Last synced", then the word Today. I do not learn what this product is for. I would close the tab.
2. **Seconds 5 to 30.** A banner says a sync is still running. Then a big card: "$1,000,000 is sitting in 1 deal that has not moved." One deal. I think: either that is a test deal or your numbers are junk. I stop trusting the page.
3. **Minute 1.** I scroll to "Needs attention today": 3 accounts, with a reason each ("24 conversations waiting past your 4h reply target; the oldest has waited 30 days"). This is the useful part. It tells me which client to call.
4. **Minute 3.** I click Speed to lead. Now I am interested: "1 waiting right now, plus 8 never answered", with names, how long, a "no owner" badge and an Open contact link. This is what I would pay for. It tells me my team is losing leads and where.
5. **Minute 5.** I click Pipeline. It says $2,400,000, and a 50% win rate, and "likely revenue $1,200,000". Today said $1,000,000. I now know I cannot repeat any number from this tool to a client.
6. **Minute 7.** I look at the menu: Today, Account audit, Overview, Inbox, Speed, Appointments, Meeting notes, Contact search, Pipeline, Leads, Call lists, Accounts, Clients, Team, Setup, Duplicates, Data cleanup, Settings, Getting started, What's new. Twenty things. I wanted two. This looks like the dashboard I already have.
7. **Minute 9.** I read the Meeting notes page. It says SubSync does not write into my CRM, but I was told it adds notes to contacts. Which is true?
8. **Minute 10.** Would I pay? Speed to lead alone, yes, maybe. The rest makes me doubt it. No card out yet.

---

## 4. Feature by feature

Format: what I saw, accurate or not, design and clarity, is it a real pain, would I pay for it.

### Today
- **Saw:** filter bar, sync banner, "Do this first" card, four tiles (Open pipeline $1,000,000, Stale deals 1, New contacts 22, Unread conversations 285), then "Needs attention today" with 3 accounts, "Fine today", then notes about when the brief is sent.
- **Accurate:** open pipeline follows the "counted deal" rule (has a value and an owner). The 285 and 22 were not checked against the CRM.
- **Design:** the right idea (one thing to do first), but the headline is driven by a single deal and there are four lines of status text above it.
- **Pain:** yes, if it led with leads. **Pay:** this is the front door, so it decides the purchase.
- **Fix:** lead with unanswered leads when they exist; outlier guard on the dollar card; hide the sync banner except on first sync.

### Account audit (with Share link)
- **Saw:** "Across 3 accounts: $1,000,000 in stale deals, 27 conversations waiting." Two tiles (stale value as a counted fact; cost of slow follow-up as a labelled estimate, "Not enough data"). Findings list with "Fix first", "Counted", an Open button. Buttons: Share link, Print, Copy summary.
- **Accurate:** matches Today. The estimate is kept apart from the fact, which is the right design.
- **Share link:** creates a public page with totals and finding titles only. I opened it: no account names, a clear snapshot date, a "Run your own free audit" button. Good.
- **Pain:** yes, as a sales tool and first-meeting hook. **Pay:** not monthly; it is a one-time asset.

### Overview
- **Saw:** Executive summary (new contacts 22, revenue won $0, open pipeline $1,000,000), tiles, a line saying 10,373 open deals are left out of dollar figures because they have no owner or value. That sentence is honest and good.
- **Problems:** a tile value is clipped ("$1,000,000" cut off). "Still syncing your accounts" banner again.
- **Pay:** duplicate of Today for most buyers. Merge.

### Inbox & SLA
- **Saw:** "Waiting past 4h, last 7 days (13)": name, account, channel (WhatsApp), how long, unread count, a **Reply** link. Export CSV.
- **Accurate:** plausible. Today says 24 waiting for one account; Inbox says 13 because of different windows, and neither says which. Needs one label.
- **Pain:** yes, strong. **Pay:** yes, part of the core.

### Speed to lead
- **Saw:** typical first reply ("Not enough data", needs 5 replies), answered within 15 minutes (10%, 1 of 10), waiting now (1), plus 8 never answered, a list with badges and Open contact links, a note "9 waiting leads have no owner", by-source table and weekly trend (when data exists).
- **Accurate:** rows match the database (10 leads, 1 answered). It refuses to show a median on too little data. Correct.
- **Design:** the best screen in the product. Specific, calm, actionable.
- **Pain:** the strongest one we have. **Pay:** this is the product.
- **Weakness:** only 10 leads in 14 days in these accounts, so the trend and source breakdown could not be seen working.

### Appointments
- **Saw:** "Bookings are down 100% on the 30 days before" (24 before, 0 now), show rate n/a (was 60%), no-shows 0 ("not enough outcomes yet"), coming up 0, "no outcome recorded 0". A To do tab and an Insights tab.
- **Accurate:** matches the database (38 appointments: 23 confirmed, 5 showed, 1 no-show, 6 cancelled, 3 invalid).
- **Problem:** "down 100%" on a quiet test account reads like an emergency. Needs a minimum size before it speaks like that.
- **Pain:** yes (unmarked outcomes lie in reports). **Pay:** yes, second most valuable.
- **Not seen:** the Insights tab.

### Meeting notes
- **Saw:** a "Connect a meeting tool" box with numbered steps for Fathom and Zoom through Zapier or Make, a private address per account, and a line saying SubSync does not write into the CRM.
- **Wrong now:** it does write a note to the matched contact (with a setting to switch it off). And Connect Zoom exists directly.
- **Pay:** nice to have, not a reason to buy. Move into Settings.

### Contact search
- **Saw:** a search box and "Start typing to search". No search was run.
- **Pay:** the CRM already searches. Low value except across accounts.

### Pipeline and deals
- **Saw:** Open pipeline $2,400,000 (10,374 deals), win rate 50% (3 won, 3 lost), average time to win 1 day, likely revenue $1,200,000, a revenue forecast (worst $600,000, likely $1,200,000, best $1,800,000).
- **Wrong:** a win rate and a forecast on 6 closed deals breaks the product's own rule (minimum 20 elsewhere; 5 in this module). $2,400,000 conflicts with $1,000,000 on Today.
- **Pay:** only once it stops guessing. Today it hurts trust.

### Leads
- **Saw:** contacts 52,926, "Quiet over 90 days: 52,735 (100%)", customers 3, bad email or phone 0, a lifecycle table.
- **Suspicious:** 100% of contacts quiet for 90 days, while 22 are brand new this month. Not possible. Do not show until checked.

### Call lists
- **Saw:** a spinner for more than 5 seconds. I never saw the content, so I cannot judge it.

### Accounts
- **Saw:** a table with a health score, risk, last activity and contacts per account, filters (All 3, At risk, Watch, Dormant, Incomplete data, Replies waiting). The contacts column is cut off at this width.
- **Accurate:** 332 contacts for KD Squares Test, equal to the CRM.
- **Jargon:** "engagement score", "churn risk", "dormant". Fine for an agency owner, not for a business owner.

### Clients
- **Saw:** tiles reading n/a, n/a, 3 and 0, and a table with "not set" cells. Compare two, Review (QBR) tabs.
- **Verdict:** nothing to see until fees are typed in. Client reports and QBRs are a crowded space. Cut from the menu.

### Team
- **Saw:** ownership, open and won value, stale counts per person, "Unassigned" shown as a row with 9,146 deals, several people shown as "Team member ZWol" until you click Add name. New columns: last reply, first reply, show rate.
- **Pay:** useful for agencies with setters; unproven.

### Setup, Getting started, What's new and next
- **Setup:** per-account checklists (business profile, sending authentication, kickoff call). Reasonable, mostly CRM housekeeping.
- **Getting started:** "7 of 9 done", ticks itself off, includes the new email and meeting-tool steps. Good idea.
- **What's new and next:** roadmap with votes and change log. Cheap trust-builder. Fine.

### Duplicates and Data cleanup
- **Saw:** Duplicates reports "2,535 exact matches, 6,914 contacts involved" on test data; Data cleanup offers phone tidy, name fix and bulk tags, with preview and undo.
- **Verdict:** the CRM and paid tools already do this; the research marks both as defer. Hide from the menu. The Duplicates page also claims SubSync never changes contacts, while Data cleanup does after a preview. They contradict.

### Settings
- **Saw:** thresholds (stale 30, dormant 30, reply SLA 4h), onboarding checklist, **Client access with an On/Off badge and a switch per account** (works), meeting-notes privacy, speed to lead target and automated-touch option, your name on reports (brand), connections (Slack, Fathom, Zoom; Zoom's button active), weekly email field, daily brief.
- **Design:** long page, many cards. The client access list is the clearest card.

### Emails, connections, home page
- **Weekly and alert emails:** built and unit-tested; keys present; **none sent yet**. They only send once an address is typed.
- **Zoom:** Connect Zoom is live. Real sign-in and a real summary were not tested.
- **Home page:** clear message and two calculators with correct arithmetic ($24,000 a month lost for the sample inputs; $180 / $360 / $180 for 20 accounts at $18). It uses "agency" language and has no live demo yet.

---

## 5. Design and wording, honestly

- **Look:** dark, one teal accent, consistent. Credible. Not distinctive: it resembles most dashboards.
- **Sameness:** almost every page is four rounded tiles then a card. After three pages I stopped reading the tiles.
- **Hierarchy:** the biggest thing on Today is a status banner, then one deal. It should be the number of leads waiting.
- **Too much text:** page subtitles run to about 190 characters and three lines. A busy person reads none of it.
- **Jargon:** SLA, engagement score, churn, dormant, stale, P90, dwell. A local business owner could not use this.
- **Does it sound like an AI wrote it?** Not in the usual way: none of the stock phrases appear. It sounds like documentation: careful, long, explanatory. Shorter and blunter would sell better.
- **Internal terms:** "Agency view" is on every page; "agency" appears in 5 files. The brief says to remove them.
- **Phone:** works, one column and a tab bar.
- **Loading:** Call lists spins; the sync banner nags.

---

## 6. Accuracy

Details in `docs/METRIC_AUDIT.md`. In short: **one number verified against the CRM** (332 contacts); **appointments and lead rows verified against the database**; **three numbers wrong or in conflict** (open pipeline $1,000,000 versus $2,400,000; win rate 50% on 6 deals; forecast built on it); **one number suspicious** (100% quiet contacts); several unchecked (285 unread, 22 new contacts, duplicates).

---

## 7. The moat, tested

| Moat claim | What is true today |
| --- | --- |
| Our own history of deals and appointments | **Empty.** 0 deal events and 0 appointment events recorded. It starts when something changes after we began watching. The moat is real in design but has no content yet |
| Compared with each account's own normal | 6 daily snapshots. Too early to be convincing |
| Reply speed and no-owner detection | Works, with 10 leads. Real, shallow data |
| Cross-account setter ranking | Works as columns on Team; the account set is tiny |
| Benchmarks across agencies | Not built; needs many installs |
| 21 permissions against a competitor's 165 | True and a real trust point |
| Tenant isolation tested every run | True; 384 cross-read attempts pass |

**Honest read:** the strongest defence is time. History and baselines only exist if we record them for months before a competitor starts. That favours getting real agencies connected quickly, not building more screens.

---

## 8. Is it worth the money?

- **At $9 per client account:** an agency with 20 clients pays $180 a month and can resell at $18. The arithmetic is fine. The doubt is the value, not the price.
- **Versus what I use today:** GHL already has speed-to-lead workflows and internal alerts. AgencyAnalytics costs about $12 to $15 a client for reports. SubSync's honest edge is *checking that lead handling actually worked across all accounts*, which none of those do. That edge is real but narrow.
- **What I would pay for now:** Speed to lead with the never-answered and no-owner list, plus the unmarked-appointment list. Maybe $5 a client for that alone.
- **What I would not pay for:** Clients, Duplicates, Data cleanup, Leads, Contact search, Setup, and the forecast.
- **What would raise the price I'd pay to $9 to $15:** email alerts that arrive without opening the app, a monthly "what SubSync caught" proof, and numbers that never disagree.
- **Cheapest way to find out for real:** the brief's own test. Run the Instant Audit on a real agency's data, say nothing, and ask "would you pay $200 for the audit and fix plan this week?" A payment is proof; "interesting" is not.

---

## 9. What to fix, in order

**Blocking (S1), about two to three days of work:**
1. One shared minimum for any win rate or forecast (20 closed deals) on every screen; show "not enough data" on Pipeline.
2. One definition of "open pipeline" everywhere, or show both with one sentence of explanation.
3. Rewrite the Meeting notes page to match what the product does now (writes a note to the matched contact, can be switched off, Connect Zoom exists).
4. Today: outlier guard on the dollar card and lead with unanswered leads in plain words.
5. Land on the account when opened from inside one; rename "Agency view" and remove "agency" wording from end-user screens.

**Next (S2), about a week:**
6. Verify and fix "Quiet over 90 days" on Leads.
7. Show the sync banner only on first sync.
8. Cut the menu to about 11 items (hide Clients, Duplicates, Data cleanup, Leads, Setup, Meeting notes).
9. Shorten every page subtitle to one sentence; replace jargon with plain words and a "what this means" tap.
10. Fix table clipping and the clipped Overview tile; add a loading skeleton to Call lists.
11. Add the monthly "what SubSync caught" proof.

---

## 10. What still needs testing, and from whom

1. **Zoom end to end** (needs a paid Zoom host, or I send a simulated summary to the private address): call, summary, SubSync, the contact in the CRM.
2. **Real emails:** put an address in Settings and wait for an alert or Monday.
3. **A new lead and a new appointment created in the CRM** and watched arriving in SubSync (I can do it once the CRM contact page loads reliably).
4. **Account-level user** (setter and business owner) and **white-label domain with a brand name set**.
5. **Call lists, Insights tab, Stale deals tab, account detail page**, which I did not see working.
6. **Five real people**, with the audit on their data. Nothing else here counts as proof.
