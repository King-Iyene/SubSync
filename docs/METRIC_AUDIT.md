# Metric audit (live app, KD Squares Test, 31 Oct 2026)

Every number below was seen on screen. "Source check" says what it was compared with. Trust: **OK** (verified or well founded), **WEAK** (too little data or unclear), **WRONG** (disagrees with another screen or breaks a stated rule), **UNCHECKED**.

| Number (screen) | Shown | Source check | Trust |
| --- | --- | --- | --- |
| Contacts, KD Squares Test (Accounts) | 332 | CRM contact list for the same account: 332 | **OK** |
| Contacts, all accounts (Leads) | 52,926 | Database read earlier: 52,925 (one added since) | OK |
| Open pipeline (Today, Overview, Audit) | $1,000,000 | Counted deals only: open, value above 0, has an owner | OK as defined, but see UX-04 |
| Open pipeline (Pipeline) | $2,400,000, 10,374 open deals | Database: 10,374 open deals worth $2.4M, 1,228 with an owner | **WRONG** against the line above (UX-02) |
| Win rate (Pipeline) | 50%, 3 won 3 lost | Database: 3 won, 3 lost. Rule in `derive.ts` needs 20 closed deals | **WRONG** (UX-01) |
| Likely revenue / forecast (Pipeline) | $1,200,000; $600k to $1.8M | Open value times the 50% above | **WRONG**: an estimate built on a rule it breaks |
| Average time to win (Pipeline) | 1 day | 3 won deals only | WEAK |
| Stale deals (Today) | 1 | One counted deal, $1,000,000 | OK as defined |
| Unread conversations (Today) | 285 | Database count not re-checked | UNCHECKED |
| New contacts, 30 days (Today) | 22 | Not checked against the CRM | UNCHECKED |
| Waiting right now / never answered (Speed to lead) | 1 / 8 | Lead rows read from the database earlier: 10 leads, 1 answered | OK |
| Answered within 15 min (Speed to lead) | 10%, 1 of 10 leads | Same rows | WEAK (10 leads), shown with its count so it is honest |
| Typical first reply (Speed to lead) | "Not enough data" | Needs 5 replies, has 1 | OK, correct behavior |
| Appointments 24 booked in the 30 days before, none in the last 30 | 0 / 24 | Database: 38 appointments, 23 confirmed, 5 showed, 1 no-show | OK |
| Show rate | "n/a", was 60% | 5 showed of 8 with outcomes | OK, shows n/a when under 5 outcomes |
| Quiet over 90 days (Leads) | 52,735, 100% of contacts | Not checked. Looks inconsistent with 22 new contacts in 30 days | **UNCHECKED, suspicious** (a brand-new contact cannot be quiet for 90 days) |
| Duplicates exact matches | 2,535 groups, 6,914 contacts | Not verified against the CRM | UNCHECKED |
| Waiting past 4h (Inbox) | 13 conversations | Alert text elsewhere says 24 for the same account | **UNCHECKED**: different windows (7 days vs all), not labelled |
| Client revenue, revenue at risk (Clients) | n/a | No fees entered | OK (honest n/a) |
| Stale deal value tile (Overview) | $1,000,000 clipped | Display clipping only | S2 |

## Findings

- **MET-01 (S1):** one definition of "open pipeline". Choose counted deals and say so, or show both numbers side by side with a sentence.
- **MET-02 (S1):** one minimum for win rate. Use the shared constant (20) everywhere, including the Pipeline forecast.
- **MET-03 (S2):** "Quiet over 90 days" must be checked before any customer sees it. A contact created 30 days ago cannot be quiet for 90.
- **MET-04 (S2):** waiting conversations show 13 in Inbox and 24 on Today for the same account. The window is different and neither screen says so.
- **MET-05 (S2):** every estimate needs its formula one tap away (brief 13A rule 4). The audit has it; Pipeline, Leads and Clients do not.

## Not done

- No manual count in the CRM for deals, unread conversations or new contacts. Test deals were not created in the CRM yet, so seeded-versus-shown checks have not run.
- `docs/METRICS.md` definitions were not re-read line by line against each screen.
