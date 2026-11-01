# Data point audit (stage F1, item 1, note N44)

Written 1 Nov 2026 by the F1 stage agent. **Nothing in this list has been cut or hidden because of it.** The roadmap says to stop and show King this list before cutting anything, and King is asleep, so every row carries a recommendation and the decision is King's (see `docs/NEEDS_KING.md`, "approve the cut list in DATA_POINTS.md"). The only changes made in F1 are the ones the other items needed (wrong numbers fixed, see `docs/METRIC_AUDIT.md`).

## How to read a row

- **Question** is what a person opening the card is trying to find out. If a card has no real question, it is marked CUT.
- **Who** is the person who needs it: agency owner (A), agency staff who work leads (S), a business owner on their own account (B), a client's own staff (C).
- **Decision** is what that person does differently because of the number. A number that changes no decision is a candidate to cut.
- **Call** is the recommendation: **KEEP**, **MERGE into X** (the number is useful but belongs on another screen or in another card), **CUT** (no decision, or untrustworthy and not fixable now), **MOVE** (right content, wrong screen), **LATER** (belongs to a later stage in `docs/ROADMAP_V2.md`).
- **Definition** points at the section of `docs/METRICS.md`. **Source** is where the number comes from. **Minimum** is the smallest sample the screen needs before it shows a rate or a claim (below it the screen says so).
- Sources: "synced contacts / deals / conversations / appointments" are the copies SubSync keeps of the CRM (`cached_*` tables); "our own record" means something SubSync records itself (`deal_events`, `appointment_events`, `lead_touches`, `account_metrics_daily`, `call_outcomes`).

116 rows, grouped by screen (a few rows cover several small cards of the same kind, for example the appointment insight cards). Recommendation totals are at the end and were counted from the tables by a script, not typed.

## Today (`today.tsx`, plus the status line)

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| "N leads are waiting for a reply" headline | Who do I answer first? | S, A, B | Open Speed to lead and reply | KEEP (the front door) | Speed to lead, "Waiting now" | `lead_touches` (our own record from messages) | none (a count) |
| "N past appointments have no outcome" line | Is my show rate trustworthy? | A, B | Mark outcomes | KEEP | Appointments, "No outcome recorded" | synced appointments | none |
| "N client accounts need attention" line | Which client do I look at? | A | Open the account | KEEP | Attention items (digest) | derived per account | none |
| Do this first (audit finding) | What single thing matters most? | A, B | Fix it | KEEP | Account audit findings | audit | per finding |
| Open pipeline tile (+ vs yesterday) | Is my pipeline growing? | A, B | Chase deals | MERGE into Pipeline; keep one tile on Today | Open pipeline | synced deals + daily numbers | percentage only when yesterday was 5,000 or more, else the plain difference |
| Stale deals tile | How many deals went quiet? | A, B | Follow up | KEEP | Stale deal | synced deals | percentage only when yesterday was 10 or more |
| New contacts, 30 days tile | Is lead flow healthy? | A | Check ads and forms | KEEP | New contacts, 30 days | synced contacts | as above |
| Unread conversations tile | Is the inbox being read? | S, A | Open Inbox | KEEP, but say "unread", not "waiting" | Unread (new in F1) | synced conversations | as above |
| Outlier note | Is the money tile one deal? | A | Check that deal is real | KEEP | Outlier note | synced deals | 3 or more deals |
| Needs attention today (list) | What is wrong where? | A | Open the account | KEEP | Attention items | derived | weight 30 or more |
| Fine today (list) | Which accounts are fine? | A | Nothing | CUT (a list of fine accounts changes no decision; keep one count) | Attention items | derived | none |
| When this is sent (card) | When does the brief arrive? | A | Set up Slack or email | MOVE to Settings (N4) | Send window | settings | none |
| Not watched yet (card) | What does SubSync not watch? | A | Know the limits | MOVE to a Settings panel "What SubSync watches" (N5) | none | fixed text, now checked against `docs/CAPABILITIES.md` | none |
| Sync line "Updated 7 min ago" | How fresh is this? | everyone | Trust or refresh | KEEP | Freshness | sync jobs | none |
| Sync now button | Refresh now | A, B | Refresh | KEEP | none | sync queue | none |

## Overview (to be merged into Today in F5)

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Executive summary: new contacts, revenue won, open pipeline (with goals and unusual notes) | How is the business doing against its goals? | A, B | Adjust effort | KEEP one row of three; goals are an optional extra | Executive summary | synced + daily numbers | percentage only on a base of 10 (5,000 dollars) |
| Stale deal value tile | How much money is sitting quiet? | A, B | Follow up | KEEP (merge with Today's stale tile) | Stale deal | synced deals | none |
| Waiting past SLA tile | How many customers wait? | S, A | Reply | MERGE into the leads-waiting headline | Waiting for a reply | synced conversations | none |
| Open alerts tile | How many open alerts? | A | Open Alerts | CUT as a tile (the bell, F9, is the right place) | Alerts | alerts table | none |
| Left-out deals sentence | Why is my total smaller than the CRM's? | A, B | Fix deal data | KEEP | Counted deal | synced deals | none |
| Estimates: expected revenue | What may close? | A, B | Plan | KEEP only on Pipeline (the forecast), CUT here | Estimates | synced deals | 20 closed deals |
| Estimates: cost of slow follow-up | What do slow replies cost? | A | Convince a client | CUT (a rough product of three estimates; the audit states it better, with the formula) | Estimates | synced deals and conversations | 20 closed deals |
| Needs attention (accounts) | Which accounts need me? | A | Open the account | MERGE into Today | Attention items | derived | none |
| Account health bar | How many accounts are healthy? | A | Prioritise accounts | KEEP (one bar, with the reply-delay hold) | Health score | derived | none |
| Average health score, gone-quiet count | summary of the bar | A | none | CUT (the bar says it) | Health score | derived | none |

## Inbox and unanswered messages (to be renamed in F4)

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Waiting headline | How many customers are waiting? | S, A | Reply | KEEP | Waiting for a reply | synced conversations | none |
| By channel chips | Where do they write? | S | Staff the channel | KEEP | Waiting for a reply | synced conversations | none |
| Waiting, newer than a week (list) | Who do I answer now? | S | Reply | KEEP | Waiting for a reply | synced conversations | none |
| Older than a week (list) | Who is long gone? | A | Close out | KEEP (F4 makes it a tab with a peek) | Waiting for a reply | synced conversations | none |
| Unread (list) | What was never opened? | S | Open it | KEEP, counted apart from waiting | Unread | synced conversations | none |
| How long customers have been waiting (chart, "Critical") | How bad is the delay? | A | Add staff | KEEP, now over the same set as the list | Waiting for a reply | synced conversations | none |
| Open deals with no contact for 7+ days | Which deals are going cold? | A, S | Call them | MOVE to Pipeline (N14, F4) | Quiet deals | synced deals and messages | none |
| Leads that arrive after hours | Do I need an after-hours answer? | A | Add a setter | MERGE into Speed to lead | After hours | synced contacts | 20 leads for the suggestion |

## Speed to lead (F2 owns the redesign)

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Typical first reply | How fast do we answer? | A, S | Coach | KEEP | Speed to lead | `lead_touches` | 5 replies |
| Answered within the target | Do we hit the target? | A | Coach | KEEP | Speed to lead | `lead_touches` | 5 judged leads |
| Waiting right now | Who is waiting? | S | Reply | KEEP | Speed to lead | `lead_touches` | none |
| Answered late | How many missed the target? | A | Coach | MERGE into "within the target" | Speed to lead | `lead_touches` | none |
| Leads waiting or missed (list) | Who exactly? | S | Reply | KEEP | Speed to lead | `lead_touches` | none |
| Weekly trend | Are we getting faster? | A | Coach | KEEP once there are 4 weeks | Speed to lead | `lead_touches` | 4 weeks |
| By lead source | Which sources are slow? | A | Fix a source | KEEP | Speed to lead | `lead_touches` | 5 per source |
| By account | Which clients are slow? | A | Coach | KEEP | Speed to lead | `lead_touches` | 5 per account |
| Who replies fastest | Who is good? | A | Reward | KEEP | Speed to lead | `lead_touches` | 3 replies |

## Appointments and Insights (F3 owns the redesign)

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Booked, 30 days | How many appointments? | A, B | none alone | KEEP | Appointments | synced appointments | none |
| Show rate | Do people show up? | A, B | Fix reminders | KEEP | Appointments | synced appointments | 5 outcomes |
| No-shows | How many missed? | A, B | Rebook | KEEP | Appointments | synced appointments | none |
| Coming up (7 days) | What is booked? | S | Confirm | KEEP | Appointments | synced appointments | none |
| No outcome recorded | How much is a guess? | A, B | Mark outcomes | KEEP | Appointments | synced appointments | none |
| Remind today, No-shows to rebook, Record the outcome (lists) | Who exactly? | S | Act | KEEP | Appointments | synced appointments | none |
| By calendar, by person, by client account | Where is it good or bad? | A | Coach | KEEP (one table with a switch) | Appointments | synced appointments | none |
| Insights: calendar health | Is the setup healthy? | A | Fix setup | LATER (F3) | Appointments | synced appointments | n/a when inputs are missing |
| Insights: lead to customer | Do appointments become customers? | A | Judge lead quality | LATER (F3) | Appointments | synced deals and appointments | needs a defined "customer" |
| Insights: best times to book | When to book? | A | Move slots | LATER (F3) | Appointments | synced appointments | 90 days and enough cells |
| Insights: no-show recovery, repeat no-shows | Do rebooks work? | A | Call them | KEEP | Appointments | synced appointments | 10 |
| Insights: show rate by source, how fast leads get booked, reminders, who gets appointments, what an appointment is worth, no follow-up after, double bookings, before your next appointments | assorted | A | various | LATER (F3 decides one by one; recommend CUT "what an appointment is worth" and "who gets the appointments" until they have a decision attached) | Appointments | synced | varies |

## Pipeline and deals

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open pipeline | How much is in play? | A, B | Chase | KEEP | Open pipeline | synced deals | none |
| Win rate | How often do we win? | A, B | Judge sales | KEEP | Win rate | synced deals | 20 closed deals |
| Average time to win | How long does a sale take? | A, B | Plan | KEEP (it times the forecast) | Pipeline, average | synced deals | 10 won deals with dates for timing |
| Likely revenue tile | What may close? | A, B | Plan | MERGE into the forecast card | Forecast | synced deals | 20 closed deals, or owner probabilities |
| Left-out deals sentence | Why is it smaller than the CRM? | A, B | Fix deals | KEEP | Counted deal | synced deals | none |
| Revenue forecast (range, timing, how it is calculated) | What will we make, and how sure? | A, B | Plan | KEEP | Forecast (rewritten in F1) | synced deals | 20 closed deals, or owner probabilities |
| Pipeline coverage | Do I have enough pipeline? | A, B | Prospect more | KEEP (needs a monthly target) | Coverage | synced deals and goal | a target |
| Open pipeline over time | Is it growing? | A, B | Judge trend | KEEP, but only days counted the same way | Definition versions | `account_metrics_daily` | 2 days of one version |
| Stages and pipelines (owner controls) | Which stages are real? | A, B | Classify | KEEP (new in F1) | Stage rules | owner rules | none |
| Stages, bottlenecks and conversion | Where do deals get stuck? | A, B | Fix a stage | KEEP (estimate, labelled) | Stage table | synced deals | 3 deals per stage for a bottleneck |
| Deals most at risk | Which deals to save? | A, B | Call them | KEEP | Risk | synced deals | none |
| How old is the pipeline | Is it stale? | A | Clean up | MERGE with Deals most at risk | Aging | synced deals | none |
| Deal sizes | What size are deals? | A | none | CUT (no decision) | Distribution | synced deals | none |
| Wins and losses by month | Is selling improving? | A, B | Judge | KEEP once 6 months exist | Win/loss | synced deals | 20 closed deals for a rate |
| Abandoned deals worth reopening | What can be revived? | A, S | Call them | KEEP | Abandoned | synced deals | none |
| Dead pipeline to clean up | What to close out? | A | Clean up | KEEP, now only deals in play | Dead pipeline | synced deals | none |
| Compare client accounts, Every pipeline | Which account sells best? | A | Coach | MERGE (one table) | Account summaries | synced deals | 20 closed deals for a rate |
| Deals view: open deals, no value, no contact, open over 90 days, stale list, totals | Is deal data clean? | A | Fix data | MERGE into Pipeline as a "Clean-up" tab (P1) | Hygiene | synced deals | none |

## Leads

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Contacts (with working leads and cold lists) | How big is my list, and how much is real? | A, B | Prioritise | KEEP | Leads: cold lists | synced contacts | none |
| Customers | How many bought? | A, B | none alone | MERGE into lifecycle | Lifecycle | synced deals | none |
| Engaged, then quiet | Who went quiet after talking to us? | S, A | Re-engage | KEEP (new in F1; replaces the unmeasurable "Quiet over 90 days") | Leads: engagement | conversations, appointments, deals | none; says what it cannot see |
| Invalid email or phone | Will my emails bounce? | A, B | Clean data | MERGE into Data quality | Data quality | synced contacts | "not checked" when it cannot be |
| Contact lifecycle | Where are my contacts? | A, B | Prioritise | KEEP | Lifecycle | synced deals | none |
| Working leads: who has engaged | Who is alive? | S | Work them | KEEP (new in F1) | Leads: engagement | as above | none |
| Cold lists | Which lists are bought or scraped? | A, B | Keep them out of the numbers | KEEP (new in F1) | Cold lists | tags | none |
| Lead cohorts by month | Is lead quality improving? | A | Judge ads | LATER (small cohorts mislead; needs 30 contacts per month) | Cohorts | synced contacts and deals | recommend 30 per month |
| Best leads to work now | Who do I call? | S | Call | MERGE into Call lists (F10) | Lead score | synced contacts | none |
| Your most valuable contacts | Who are my best customers? | A, B | Look after them | CUT (commodity, no action attached) | VIP | synced deals | none |
| New contacts per week | Is flow steady? | A | Check ads | MERGE with growth by account | Growth | synced contacts | 10 for a percentage |
| Growth by account | Which account grows? | A | Coach | KEEP | Growth | synced contacts | percentage needs 10 |
| Tags (top, rare, look-alike) | What do my tags mean? | A | Tidy tags | KEEP top and look-alike tags, CUT "barely used" | Tags | synced contacts | none |
| Contact data quality (invalid, disposable, missing) | Is my data usable? | A, B | Clean data | KEEP | Data quality | synced contacts | "not checked" when unread |
| Where leads come from (with the no-source action) | What brings leads? | A, B | Fix tracking, spend | KEEP | Sources | synced contacts | 10 per source for a rate; action at 20 contacts and half unknown |
| Do not disturb | Who must not be contacted? | A | Protect people | MERGE into Data quality (a note) | DND | synced contacts | none |
| Birthdays in the next 30 days | Who has a birthday? | A | Greet | CUT (no sales-ops decision; DEFER to a later marketing stage) | Birthdays | synced contacts | none |
| Large imports | Was an import incomplete? | A | Fix import | KEEP | Imports | synced contacts | 50 added in a day |

## Call lists, Search, Team

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Nine pre-built lists, ranked | Who do I call next? | S | Call | KEEP (F10) | Call lists | synced + our own call outcomes | none |
| In this list, calls and reached (24h, 7 days), power hour | Am I making progress? | S | Keep going | KEEP, MERGE into one strip | Call outcomes | `call_outcomes` | none |
| Contact search and timeline | Where is this person? | S, A | Open them | KEEP (merge with Leads in F10) | Search | synced contacts | 2 characters |
| Team table: open deals and value, won, win rate, last reply, first reply (30d), show rate (30d), days to win, contacts | How is each person doing? | A | Coach | KEEP once names resolve (F2, T1) | Team | synced + `lead_touches` | 20 closed, 3 replies, 5 outcomes |
| Recent deal movement | What moved? | A | none | CUT or MOVE to Pipeline (no decision) | Deal events | `deal_events` | none |

## Accounts, Clients, Setup, alerts, email

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Accounts table: health, leave risk, last activity, contacts, data, open deals, stale, waiting | Which accounts need me? | A | Prioritise | KEEP (one table; C1 merges Accounts and Clients) | Health score | derived | none |
| Account detail: health score, contacts, completeness, open pipeline, stale deals | Why is this account scored so? | A | Fix the part | KEEP | Health score | derived | none |
| How the score is built | Where do the points come from? | A | Trust it | KEEP | Health score | derived | none |
| Trend, 60 days | Is it improving? | A | Judge | KEEP, only days counted the same way | Definition versions | `account_metrics_daily` | 2 days of one version |
| Onboarding checklist | Is this client set up? | A | Finish setup | LATER (C1) | Setup | derived | none |
| Email authentication | Will email land? | A | Fix DNS | KEEP (E5 later) | Email health | DNS lookups | none |
| Open alerts | What is open? | A | Act | KEEP (F9 notification centre) | Alerts | alerts table | none |
| Account controls (ignore, owner, client view) | Manage the account | A | Configure | KEEP | none | settings | none |
| Clients: monthly revenue, revenue at risk, not spoken to in 14 days, renewals in 90 days | How is my own business? | A | Retain clients | LATER (C1; recommend CUT until fees are entered, UX-08) | Clients | owner-typed fees | needs fees |
| Clients: renewals, by industry, what is different, compare two | assorted | A | various | LATER (C1), recommend CUT "compare two" (N60) | Clients | derived | varies |
| Setup page | Which accounts are not set up? | A | Finish setup | MERGE into Clients (C1) | Setup | derived | none |
| Duplicates (exact, written differently, contacts involved, protection, bulk actions) | Are contacts duplicated? | A | Merge in the CRM | DEFER (C2; overlaps native tools) | Duplicates | synced contacts | none |
| Data cleanup | Fix contacts in bulk | A | Apply a clean-up | DEFER (C2; writes to the CRM) | Cleanup | synced contacts | preview first |
| Email health | Is the sending domain healthy? | A | Fix DNS | DEFER (E5) | Email health | DNS | none |
| Industry playbooks | What target for which industry? | A | Set targets | KEEP as a Settings option | Playbooks | owner-typed industry | none |
| Compare setups | Do accounts match the baseline? | A | Fix setups | DEFER (C1) | Setup compare | synced pipelines | none |

## Audit, Settings, Share page, Getting started

| Data point | Question | Who | Decision | Call | Definition | Source | Minimum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Account audit: headline, findings, dollars (counted vs estimate), where to start | What is wrong, what does it cost? | A, B, prospects | Buy the fix | KEEP (F6; the sellable asset) | Audit | all verified metrics | per finding |
| Share links list | Which links are live? | A | Revoke | KEEP | Share link | `shared_audits` | none |
| Settings: thresholds, speed to lead, checklist, name on reports, links, client access, Slack, API connector, meeting privacy, What we store, Delete my data, Sync status | Configure and trust | A, B | Configure | KEEP (F8 regroups) | Settings | settings | none |
| Share page (public): totals and finding titles | Show a prospect the audit | prospect | Hire | KEEP | Audit | snapshot | none |
| Getting started, What's new and next | How do I start, what is coming? | everyone | Learn, vote | KEEP | none | static + votes | none |

## Totals

Counted from the rows above: 116 rows. KEEP 78, MERGE 15, CUT 8, MOVE 3, LATER 8 (belongs to a later stage, decided there), DEFER 4 (whole pages the roadmap already defers). The 8 CUT rows are: Fine today (list), Open alerts tile, Estimates: cost of slow follow-up, Average health score and gone-quiet count, Deal sizes, Your most valuable contacts, Birthdays in the next 30 days, Recent deal movement. Two more cuts are named inside LATER rows (Compare two clients, N60; What an appointment is worth, F3). Nothing has been removed or hidden: this is a proposal for King.
