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
