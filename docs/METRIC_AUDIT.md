# Metric audit (F1, 31 Oct 2026)

Every number a screen shows, its definition (in `docs/METRICS.md`), how it was checked, and its status. "Database" means a query against the synced rows on 31 Oct 2026. "CRM" means a count in the platform's own screens; those are King's checks (the embedded browser in this session cannot render the CRM's list pages, so no CRM count was read by me in F1 except the contact count and deal count King and I took earlier).

Status: **OK** (verified, or follows a tested definition), **FIXED** (was wrong or inconsistent, fixed in F1 with a test), **HIDDEN** (not measurable yet, now says so), **KING** (needs King's CRM check), **OPEN** (known gap).

## Deal numbers

| Number (screens) | Definition | Check | Status |
| --- | --- | --- | --- |
| Open pipeline value and count (Today, Overview, Accounts, Account audit, Pipeline, Clients, exports) | Counted open deals: value above 0 and an owner | Database, KD Squares Test: 189 open deals, 1 counted, $1,000,000. All real accounts: 19,430 open, 1 counted, $1,000,000. `consistency.spec.ts` proves Overview, Accounts and Pipeline agree to the dollar on the demo tenant | **FIXED** (Pipeline showed $2.4M over 10,374 deals, Overview $1.0M: two definitions) |
| Open deals left out (Overview, Pipeline) | Open deals with no value or no owner, split by reason | Database: 188 of 189 in KD Squares Test. Overview and Pipeline report the same count (test) | OK |
| Currency | Amounts as entered; not converted | The database stores no currency | **OPEN** (labelled on Overview and Pipeline; store each account's currency at sync) |
| Outlier note on dollar cards | One counted deal at least 50% of the total, 3 or more deals | Unit tests on the golden dataset; the demo tenant carries a $1,000,000 deal, checked on both screens | OK |
| Win rate (Pipeline, account, Clients, Team, deals view) | Won / (won + lost), only with 20 or more closed deals | KD Squares Test: 3 won, 2 lost = 5 closed, so none is shown. All accounts together: 7 closed. Unit tests (19 vs 20), browser test | **FIXED** (Pipeline showed 50% from 3 won and 3 lost; the Team and deals view used 5) |
| Likely revenue / forecast (Pipeline) | Counted open value x win rate; "Not enough data" below 20 closed | Follows from the win rate above. Labelled "Estimate, not a fact" with the formula under it | **FIXED** (was $1,200,000 built on a 50% rate it should not have had) |
| Expected revenue, cost of slow follow-up (Overview, Account audit) | Per account: counted open value (or waiting conversations x average deal) x that account's win rate; needs at least one account with 20 closed deals | Unchanged definition; never above open pipeline (test) | OK |
| Stale deals and stale value (Today, Overview, Audit) | Counted open deals not moved for 30 days (settable) | Database: 1 counted deal, $1,000,000, stale | OK (one threshold for every stage is a known gap, see METRICS.md) |
| Average time to win (Pipeline) | Mean days from created to won, won deals only | 3 won deals in KD Squares Test | OK, thin: shown with its basis, not gated |

## Contacts and conversations

| Number | Definition | Check | Status |
| --- | --- | --- | --- |
| Contacts, KD Squares Test (Accounts) | Synced contacts | Database 332. CRM 332 (counted earlier by King) | OK |
| New contacts, 30 days | Contacts created in the last 30 days | Database, KD Squares Test: 3. (The 22 on an earlier Today screen was the all-accounts figure.) | KING (compare with the CRM's contacts created filter) |
| Unread conversations | Conversations with an unread count above 0 | Database, KD Squares Test: 39 of 265 conversations | KING (compare with the CRM's Unread filter in Conversations) |
| Waiting past SLA (Today, Inbox) | Last message inbound, older than the reply target, newer than 30 days | Same definition on both screens; the Inbox also shows a longer window and says so | OK |
| Quiet over 90 days (Leads) | Last recorded activity (or created date) older than 90 days | Database: none of the 103,404 synced contacts has a recorded activity time, so the card measured age, not silence (52,735 of 52,926, "100%") | **HIDDEN** until contact activity is synced (shows "Not measured") |
| Duplicates (Duplicates) | Exact and likely matches inside one client account | Not re-verified in F1 (hidden page, a Wave 1 non-goal) | OPEN |

## Not covered by F1 (later stages)

Speed to lead and appointments are verified in F2 and F3. The metric definitions for those are already in `docs/METRICS.md`.

## King's 5 checks for F1 (also in `docs/features/F1.md`)

1. **Contacts:** KD Squares Test shows 332 on Accounts. The CRM's Contacts count should match.
2. **Open deals:** the CRM's Opportunities list for KD Squares Test (status Open) should show 189; SubSync's Pipeline for that account counts 1 deal worth $1,000,000 and says 188 are not counted.
3. **One pipeline value:** Overview and Pipeline should show the same open pipeline value ($1,000,000 on the real accounts today).
4. **New contacts, 30 days:** Today's figure for KD Squares Test (3) against the CRM's contacts added in the last 30 days.
5. **Unread conversations:** 39 for KD Squares Test against the CRM's Unread filter in Conversations.
