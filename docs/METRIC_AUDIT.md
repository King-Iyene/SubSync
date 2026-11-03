# Metric audit (F1: first pass 31 Oct 2026, delta 1 Nov 2026)

Every number a screen shows, its definition (in `docs/METRICS.md`), how it was checked, and its status. "Database" means a query against the synced rows (the real installs, 1 Nov 2026 unless a date is given). "CRM" means a count in the platform's own screens; those are King's checks: this machine cannot open the real tokens (see `docs/CAPABILITIES.md`), so no CRM count was read by me in this stage. The earlier CRM counts (332 contacts, 189 open deals for KD Squares Test) were taken by King and the first F1 pass.

Status: **OK** (verified, or follows a tested definition), **FIXED** (was wrong or inconsistent, fixed with a test), **NEW** (added by the F1 delta, with a test), **REPLACED** (the old number could not be measured; replaced by one that can), **KING** (needs King's CRM check), **OPEN** (known gap).

Tests named below: `src/lib/__tests__/f1-rules.test.ts` and `pipeline-intel.test.ts` (pure rules, golden cases), `tests/unit/f1-deal-scope-db.test.ts` (golden deals, history and leads in a real database, 16 tests), `scripts/check-filter.ts` (one filter, same numbers on every page: 5 filters, 37 pages), `scripts/check-stage-rules.ts` (the owner's rules over HTTP), `tests/e2e/f1.spec.ts` and `tests/e2e/consistency.spec.ts` (browser and API on the demo tenant).

## Deal numbers

| Number (screens) | Definition | Check | Status |
| --- | --- | --- | --- |
| Open pipeline value and count (Today, Overview, Accounts, Account audit, Pipeline, Clients, Team, stage cells, exports) | Counted open deals: value above 0, an owner, and in play (not in a closed-out stage or an unused pipeline) | Database: agency install 1 counted deal, $1,000,000; KD Squares Test 189 open of which 1 counted. `check-filter.ts` proves Overview, Accounts, Pipeline, stage cells, Team and exports agree to the dollar under all five filters; golden deals prove each place leaves out the closed-out deals | **FIXED** (Pipeline showed $2.4M over 10,374 deals against Overview's $1.0M; the Team table and stage cells still counted every open deal until this pass) |
| Open deals left out (Overview, Pipeline) | Three reasons that never overlap: closed-out stage or unused pipeline, no value, no owner | Database, agency install: 10,373 left out = 1,033 closed out + 9,189 no value + 151 no owner. `f1-deal-scope-db.test.ts` (4 = 2 + 1 + 1), `consistency.spec.ts` | **NEW** (reason by stage) |
| Stage and pipeline classification | The owner's rule, else the name suggestion; closed-out and ignored stages and unused pipelines never count | Database: 13 of 80 stage pairs closed out by name, 1,033 open deals, none with both a value and an owner. `f1-rules.test.ts`, `f1-deal-scope-db.test.ts`, `check-stage-rules.ts` | **NEW** (N38) |
| Stale deals and stale value (Today, Overview, Audit, list, exports) | Counted open deals not moved for 30 days (settable); the list also shows deals with no value or owner, but never a closed-out one | `f1-deal-scope-db.test.ts` | **FIXED** (stale list and hygiene counted deals in "Disqualified" stages) |
| Dead pipeline to clean up (Pipeline) | Counted open deals with 90+ days idle or two of: no value, no contact, idle | Only deals in play reach it (the loader); 10,292 closed-out deals the review saw there are gone | **FIXED** (N38) |
| Quiet deals, "open deals with no contact for 7+ days" (Inbox) | Counted open deals whose contact has had no activity or message for 7 days | Database: 1 deal, $1,000,000. The total and dollars are counted in the database over every such deal, not over a list capped at 3,000 | **FIXED** (N15: it said 3,000 and $2,400,000, a round query cap including 2,707 $0 deals) |
| Win rate | Won / (won + lost), only with 20 or more closed deals | KD Squares Test 3 won + 2 lost = 5, none shown; all accounts 7 closed. Unit tests (19 against 20), browser test | OK (fixed in the first F1 pass) |
| Forecast (Pipeline) | A range: history (80% interval of the win rate) from 20 closed deals, or the owner's stage probabilities with a 10 point band; timing from each pipeline's won deals (10 needed); never one number | Database: the real accounts have 5 to 7 closed deals and no owner probabilities, so "No forecast yet. It needs 20 closed deals (there are 7, so 13 more)". Range worked by hand in `pipeline-intel.test.ts` (12 of 20 won: 9,145 to 14,553 of 20,000) | **NEW** (N37, rewritten) |
| Likely revenue tile (Pipeline) | The forecast's most likely figure, with its range and "Estimate, not a fact" | follows from the forecast | **NEW** |
| Expected revenue, cost of slow follow-up (Overview, Account audit) | Per account: counted open value (or waiting conversations x average deal) x that account's win rate; needs one account with 20 closed deals | Unchanged definition; never above open pipeline (test). Data points audit recommends cutting the second | OK |
| Open pipeline over time (Pipeline, account trend, executive summary, Today tiles, churn baseline) | Only days counted under today's rules are compared | Database: the real series was 2,400,000 / 10,374 deals (30 Oct, old rule) then 1,000,000 / 1 deal (31 Oct, 1 Nov, counted rule); now no line is drawn until two days exist under the current rules, with the reason on screen. `f1-deal-scope-db.test.ts` (3 earlier days not drawn), `f1-rules.test.ts` | **NEW** (N39) |
| Percentage change tiles (Today, executive summary, Leads growth) | A percentage only when the earlier figure is at least 10 (5,000 dollars); else the plain difference | `f1-rules.test.ts`, `digest-intel.test.ts` (2 stale deals to none is "down 2", not -100%), `f1.spec.ts` | **FIXED** (N6) |
| Outlier note on dollar cards | One counted deal at least 50% of the total, 3 or more deals | Unit tests; demo carries a $1,000,000 deal; the real agency has 1 counted deal, so no note | OK (UX-04: the "Do this first" sentence also states "counted at risk" vs "estimated at risk" in plain words; the single real deal is flagged when 3 or more exist) |
| Currency | Amounts as entered; not converted | The database stores no currency | **OPEN** (labelled everywhere; store each account's currency at sync) |
| Average time to win (Pipeline) | Mean days from created to won, won deals only; also the timing basis for the forecast | 3 won deals in KD Squares Test | OK, thin, shown with its basis |
| A person's open deals and value (Team) | The same counted open deals as the Pipeline | `check-filter.ts` (they add up to the Pipeline under every filter) | **FIXED** (it counted every open deal) |
| Contact in an open deal (Leads lifecycle) | Contacts with an open deal in play, whatever its value; the counted ones are said apart | Database, agency: 9,171 in an open deal, 1 with a counted deal; demo test | **FIXED** (UX-02, one sentence explains the two counts) |

## Contacts and conversations

| Number | Definition | Check | Status |
| --- | --- | --- | --- |
| Contacts, KD Squares Test (Accounts) | Synced contacts | Database 332. CRM 332 (counted earlier by King) | OK |
| New contacts, 30 days | Contacts created in the last 30 days | Database, KD Squares Test: 3 | KING (compare with the CRM's contacts created filter) |
| Unread conversations (Today tile, Overview, Inbox) | Conversations with an unread count above 0: one figure on all three | Database, agency install: 285 = 243 + 39 + 3, of which 24 also waiting. `f1.spec.ts` and `check-filter.ts` (Today = Overview = Inbox under every filter) | **FIXED** (item 4: Today said 285 and the Inbox 259 because the Inbox card subtracted the waiting ones; nothing was added together) |
| Waiting for a reply (Today, Overview, Inbox, Audit, exports) | Last message inbound, past the reply target, in the last 30 days | Database: 24 (21 + 2 + 1); the Inbox, the wait chart and the exports all count the same 24 (`check-filter.ts`, `f1.spec.ts`) | OK |
| How long customers have waited (chart) and "Critical" | The same waiting set; critical = more than 24 hours and less than a week; older than a week is its own bucket and never critical | `comms-intel.test.ts` (a 750-day thread is never critical), `f1.spec.ts` | **FIXED** (N15: the chart counted 255 customers and a red "Critical: 254" built on threads 750 days old, against 26 in the list) |
| Conversation read limit | The newest 500 conversations of each account; screens say when an account is at it | Database: 500, 265, 500 stored, so 2 of 3 accounts are capped | **NEW** (N15) |
| Account health label | Score band held down by the reply delay (5 waiting: at best Watch; 15: At risk); in Needs attention never Healthy | Database: KD Squares LTD scored 57 "Healthy" with 21 waiting, now "At risk" with the reason in one sentence. `f1-rules.test.ts`, `f1.spec.ts` | **FIXED** (N16, N62) |
| Quiet over 90 days, never engaged (Leads) | Replaced by: cold lists (apart), then for working leads seen in 90 days, engaged then quiet, nothing seen | Database, agency: 52,926 contacts = 50,958 on cold lists + 1,968 working (152 seen, 275 engaged then quiet, 1,541 nothing seen). The contact's last activity is not sent (0 of 52,926). Signals come from the newest 500 conversations, appointments and deals; the screen says "nothing seen" is not "never replied" | **REPLACED** (N45) |
| Invalid, disposable and missing emails and phones (Leads) | Invalid = typed and cannot work; missing = nothing typed; each "N of M checked"; "Not checked" when it cannot run | Database, agency: 0 invalid emails of 50,891, 0 invalid phones of 36,746 (real zeros: the SQL and JavaScript rules are proven identical by a database test that found and fixed two differences), 2,035 missing emails, 16,180 missing phones | **FIXED** (N46) |
| Lead sources (Leads) | Source text grouped into kinds; the no-source share becomes an action | Database: 703 of 52,926 contacts have a source, 99% none. `f1-rules.test.ts` | **FIXED** (N47; the Speed to lead side is F2) |
| Duplicates (Duplicates) | Exact and likely matches inside one client account | Not re-verified (deferred page, a Wave 1 non-goal) | OPEN |
| Freshness line | Oldest account's last successful refresh | S0.4 tests; never changed by a filter (`check-filter.ts` leaves it out of the hidden-account search on purpose) | OK |

## The same filter, the same numbers (N1, N8)

`scripts/check-filter.ts` builds a three-account agency with a test account, works out every figure from the fixture constants (not from the app), and reads 37 pages under five filters (none, hide test accounts, one account manager, one kind of business, two together). Each page must show the fixture's figure for the accounts still shown, and nothing about a hidden account may appear anywhere. It found and fixed three pages that ignored the filter: the daily brief preview, the Alerts export and the Industry playbooks list. The pages that manage every account on purpose (Settings, the filter options themselves, the sync status) and the freshness line are listed in the script and are not narrowed.

## Not covered by F1 (later stages)

Speed to lead is F2, appointments F3, the audit's wording F6; their definitions are already in `docs/METRICS.md`. Forecast versus actual each month (N37, item 6) is P1: it needs a month of recorded forecasts and 20 closed deals.

## King's 5 checks for F1 (also in `docs/features/F1.md`)

1. **Contacts and deals:** KD Squares Test shows 332 contacts and, on Pipeline, 1 counted deal worth $1,000,000 with "188 open deals are not counted"; the CRM shows 332 contacts and 189 open deals.
2. **Unread, Today against Inbox:** both say the same number (285 at the time of writing across the three accounts) and the Inbox says how many of them are also waiting (24).
3. **The waiting account:** KD Squares LTD is "At risk" (not "Healthy") with its 21 waiting customers; open it in the CRM's Conversations and count the ones whose last message is the customer's and older than 4 hours.
4. **A closed-out stage:** on Pipeline, "Stages and pipelines" lists "Disqualified" and "Wrong Phone Number" as closed out because of their names; mark one Active and watch the totals change, then press "Use the name instead".
5. **Leads:** the cold list "cold email outreach" (about 49,600 contacts) is apart from the working leads, and the Sources card tells you 99% have no source.
