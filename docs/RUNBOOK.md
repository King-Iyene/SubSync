# SubSync Runbook: One Feature at a Time (A to Z)

Save as `docs/RUNBOOK.md` in the repo. It works with `CLAUDE.md` (Master Brief v3), `docs/READINESS_AND_TEST_PLAN.md`, and `docs/BUYER_AND_UX_REVIEW.md`. Where they disagree, `CLAUDE.md` wins.

Written Saturday, Oct 31, 2026. King is working through tonight and Sunday. Cash is tight, so the order below reaches a **sellable audit first**.

---

## 0. HOW THIS WORKS

**The rule: one stage at a time. Build it, test it, verify it against real numbers, show King the evidence, and STOP. Claude Code never starts the next stage until King types NEXT.**

Every stage follows the same eight steps:

1. **Spec:** write `docs/features/<stage>.md` with the goal, definitions, data sources (confirm endpoints in GHL docs), edge cases, and acceptance criteria. Any definition goes into `docs/METRICS.md`.
2. **Tests first:** write failing tests, including messy-data fixtures and the golden dataset (section 2).
3. **Build:** smallest change that makes the tests pass. Behind a feature flag, default off, unless it is a bug fix.
4. **Automated verification:** `npm run verify` (typecheck, lint, build, unit tests) and `npm run e2e` (Playwright on the demo tenant at 390, 768, and 1440 px).
5. **Live-data verification:** compare the stage's key numbers against their source (a database query and the CRM screen). Print "King's 5 checks": five numbers with exact instructions on where to look in the CRM.
6. **Brutal self-review:** use the severity scale (S0 blocker, S1 major, S2 moderate, S3 polish) and the no-flattery rule from `docs/BUYER_AND_UX_REVIEW.md`. Fix all S0 and S1.
7. **Evidence:** update `docs/features/<stage>.md` (results, live numbers, screenshots in `docs/review/`), `docs/FEATURE_STATUS.md`, and `docs/PROGRESS.md`.
8. **STOP.** Print: what changed, tests added and results, King's 5 checks, remaining S2 and S3 items, and the question "PASS, FAIL, or fix first?". Wait for King.

**Git:** commit small. Push to `main` only when `npm run verify` is green. New features stay behind flags that default to off.

**If a test fails:** find the root cause. Never weaken, skip, or delete a test to get green. If three attempts fail, stop and explain what you tried.

**Context limits:** after each stage, update `docs/PROGRESS.md` (current stage, status, next stage, open issues) so a fresh session can resume.

---

## 1. DEFINITION OF DONE (every stage)

- Tests written first, all green, none skipped.
- Numbers match their source: a database query and a manual look at the CRM.
- Same metric shows the same value on every screen (consistency test).
- Role check: agency owner, agency admin, agency staff, client account admin, client account user. A client user sees only their own account.
- White-label check: no "GHL", "HighLevel", "agency", "sub-account", "location", and no GHL hostnames in any user-facing text, link, email, or error.
- States work: loading, partial sync, empty, error, no permission.
- Phone, tablet, and desktop widths: no horizontal scroll, no clipped text.
- No customer data in logs or the browser console.
- Evidence file written. King has typed PASS.

---

## 2. TEST DATA KIT (build this in S0.1, reuse everywhere)

**A. Demo tenant (fake but messy).** Two fake companies, several locations each, plus the roles in section 1. Include: junk and $0 deals, ownerless deals, one $1,000,000 outlier deal, unassigned leads, bulk-imported contacts (must not count as new leads), duplicate contacts, contacts with no phone or email, DND contacts, spam contacts, merged contacts, an empty account, a partially synced account, a very large account (50,000 contacts), accounts in different time zones and different currencies, appointments across midnight and daylight-saving changes, appointments with every status (booked, confirmed, showed, no-show, cancelled, invalid), a past appointment with no outcome, a lead answered by automation only, a lead answered by a human after 3 minutes, 3 hours, and 3 days, a lead never answered, after-hours and weekend leads, conversations where the last message is an internal note, and a deleted record.

**B. Golden dataset.** A small hand-built dataset where every metric's correct answer is known and written in the test. Example: 10 leads, 1 answered within 15 minutes, 8 never answered, 1 waiting. Unit tests assert those exact answers.

**C. Real test accounts.** KD Squares Test and the two other connected accounts, read-only. Never run any test that writes to a real account.

**D. Repeatability tests (apply to every sync-based stage):** sync twice gives the same numbers; webhook delivered twice does not double count; webhook out of order is handled; pagination above 100 items; a 429 rate-limit response is retried; token expiry mid-sync recovers.

---

## 3. MILESTONES

| Milestone | Stages | Meaning |
|---|---|---|
| **M1: Sellable Audit** | S0.1, S0.2, S0.3, F1, F2, F3, F6 | Safe, trustworthy numbers and the Account audit with Share link. You can run a paid audit on a prospect's data |
| **M2: Pilot-ready** | F4, F5, F7, F8, F9, F10 | The full pilot menu works, emails and alerts arrive |
| **M3: Extras** | E1 to E4 | Zoom, Fathom, Slack, and the hidden pages. Not needed to sell audits or run a pilot |
| **M4: Release** | Z1, Z2, Z3 | Full re-review, GHL readiness, version 1.1.0 release, first pilot install |

**Gate before any prospect or pilot install:** S0.2 passed (tenant isolation), uninstall deletes data (tested), F1 passed (numbers consistent), and the Share link is hardened (F6).

**Rough time guess (an estimate, not a promise):** S0.1 1 to 2 hours, S0.2 2 to 3, S0.3 about 1, F1 2 to 3, F2 about 2, F3 about 2, F6 about 2. So M1 is roughly 12 to 15 hours of combined AI work and your checking. Your manual comparisons are the slowest part. Staying up tonight and Sunday makes M1 plausible by Sunday evening. While it builds, line up the prospects.

---

## 4. KICKOFF AND RESUME PROMPTS

**Kickoff (paste once):**
```
Read CLAUDE.md, docs/RUNBOOK.md, docs/READINESS_AND_TEST_PLAN.md and docs/BUYER_AND_UX_REVIEW.md. Operate in one-stage-at-a-time mode exactly as section 0 of the runbook says. Freeze all new features outside the runbook. Create docs/PROGRESS.md. Start at stage S0.1. After each stage, write the evidence, print King's 5 checks, and STOP. Do not start the next stage until I type NEXT.
```

**Resume (paste when a session restarts):**
```
Read CLAUDE.md, docs/RUNBOOK.md and docs/PROGRESS.md. Continue at the stage recorded in PROGRESS.md. Follow the same one-stage-at-a-time rules and wait for my NEXT.
```

**Reply words for King:** `PASS` (stage accepted, then type NEXT), `FAIL: <what you saw>` (fix and re-verify), `NEXT`.

---

## 5. STAGE PROMPTS

Paste one stage prompt at a time, after King types NEXT. Each assumes the kickoff has been given.

### S0.1: Test harness and safety rails
```
Stage S0.1. Goal: a safe base to build and test on.
1. Install Vitest and Playwright. Create npm scripts: verify (typecheck, lint, build, unit tests) and e2e.
2. Build the demo tenant and golden dataset from section 2 of the runbook, as a seed script plus fixtures.
3. Add a dev-only demo login behind a DEMO_MODE env flag. Write tests proving it cannot be enabled when VERCEL_ENV or NODE_ENV is production.
4. Add a feature-flag table and helper (default off), a kill switch APP_MODE=maintenance that stops syncing and shows a maintenance page, and ENTITLEMENTS_MODE (open or enforced).
5. Create docs/PROGRESS.md and docs/FEATURE_STATUS.md.
Acceptance: npm run verify and npm run e2e green, the demo tenant loads, the flag and kill-switch tests pass.
Write docs/features/S0.1.md, print King's 5 checks (here: confirm the demo login shows only fake data and the kill switch shows the maintenance page), and STOP.
```

### S0.2: Identity, roles, and tenant isolation (highest risk, do not skip)
```
Stage S0.2. Goal: no one ever sees data they should not see.
1. Create one server-side identity function that derives companyId, locationId, user type, role and isAgencyOwner from the VERIFIED SSO payload only. Never trust IDs from the browser. Write a test payload generator.
2. Implement the role rules in CLAUDE.md section 4.1. Document every route, server action and database query and its guard in docs/TENANCY.md. No route without a guard.
3. Tests: two companies, several locations, all five role types. For every API route and server action, try cross-company and cross-location reads and writes by changing IDs. All must fail. Include the Share link and webhook endpoints.
4. Test that uninstall stops syncing and deletes that tenant's tokens and cached data on the defined schedule, and that the user is told what happens to their data.
5. Check token encryption at rest, refresh rotation with a lock, and that no tokens or customer data appear in logs or the front-end bundle (search NEXT_PUBLIC variables and the built bundle). Run gitleaks on the full history.
Acceptance: all tests green, docs/TENANCY.md complete, zero unguarded routes.
King's 5 checks: in the GHL sandbox, create one client-account-only user. Log in as the agency owner and as that user and confirm what each sees.
Write docs/features/S0.2.md and STOP.
```

### S0.3: White-label hygiene
```
Stage S0.3. Goal: nothing a white-label customer sees reveals GHL or HighLevel.
1. Create a helper crmUrl(identity, path) that builds links from the white-label domain in the SSO and install data (whitelabelDetails.domain), falling back to the default domain only for non-white-label companies. Replace every hardcoded gohighlevel.com or leadconnectorhq.com link in user-facing places.
2. Rename "Agency view" and remove "agency", "sub-account" and "location" from all end-user screens, emails, error pages, empty states, page titles, metadata, the Share link page, the help and Getting started pages.
3. Add an automated test that scans UI strings, email templates, rendered pages and every href and src for banned words and hostnames. Run the e2e suite with a fake white-label identity.
4. Check the OAuth and install screens we control, and the Reinstall prompts.
Acceptance: the banned-terms test and the white-label e2e run are green.
King's 5 checks: open five different screens through a white-label identity (or the sandbox) and click every Open link.
Write docs/features/S0.3.md and STOP.
```

### F1: Numbers truth (metrics foundation)
```
Stage F1. Goal: every number is defined, correct, and identical everywhere.
1. In docs/METRICS.md, define every number the UI shows: name, formula, source, window, exclusions, minimum sample, currency and time zone handling.
2. Move all calculations into shared functions with unit tests on the golden dataset. Remove inline calculations from the UI.
3. Fix the S1 items: one minimum (20 closed deals) before any win rate or forecast; one definition of open pipeline across Today and Pipeline (or show both with one sentence); outlier guard on dollar cards; exclude $0 and ownerless deals from dollar figures; hide or flag obvious test accounts; never sum across currencies (CHECK how each account's currency is stored); label every estimate as an estimate with the formula one tap away.
4. Add a consistency test that renders every screen for the demo tenant and asserts the same metric has the same value everywhere.
5. Verify the Leads "Quiet over 90 days: 100%" card. Fix it or hide it.
6. Write docs/METRIC_AUDIT.md: every displayed number, its definition, how it was verified, and its status.
Acceptance: consistency test green, METRIC_AUDIT complete.
King's 5 checks: five numbers (contacts, open deals, one pipeline value, new contacts in 30 days, unread conversations) compared with the CRM.
Write docs/features/F1.md and STOP.
```

### F2: Speed to lead
```
Stage F2. Goal: the best screen in the product is correct on messy real data.
1. Define in METRICS.md: what counts as a new lead (exclude bulk imports, spam, test, DND-only, merged duplicates), what counts as first response (first human outbound message or call; automated touches counted only when the account setting says so), after-hours and weekend handling, time zones, and the "never answered" and "no owner" rules. Check the message fields available (direction, source, user) in the live API.
2. Tests on the golden dataset and the demo tenant for every edge case in section 2 of the runbook.
3. Verify the typical-reply, within-15-minutes, waiting-now, never-answered and no-owner figures against database queries.
4. Make sure the page says "not enough data" below the minimum, and uses plain words ("3 leads are waiting for a reply").
5. Verify the by-source table and weekly trend with seeded data, since the real accounts have too few leads.
6. Check how Meta and Instagram lead-form leads are recorded in the CRM (source and attribution fields; CHECK live data) and make the by-source table identify them, with seeded examples. Add a sample audit built on real-estate style data (Meta lead-form leads, showings as appointments) that King can use to pitch real estate teams. Do not build lead capture or lead management.
Acceptance: all edge-case tests green, numbers match the database, screenshots at 3 widths.
King's 5 checks: pick 5 leads in the list and confirm in the CRM when each arrived, whether it was answered, and by whom.
Write docs/features/F2.md and STOP.
```

### F3: Appointments
```
Stage F3. Goal: appointment numbers are honest.
1. Define in METRICS.md: status mapping (booked, confirmed, showed, no-show, cancelled, invalid), what counts as "no outcome recorded" (time has passed and status is not showed, no-show or cancelled), show rate computed only over appointments with an outcome, time zone handling around midnight and daylight-saving, and a minimum baseline size before any "down X%" claim (for example 10).
2. Tests with golden data and the demo tenant (rescheduled, cancelled, invalid, multiple calendars, group events).
3. Verify counts against the database and the CRM. Open and test the Insights tab, which was never seen working.
4. No alarming language on tiny samples ("down 100%" on a quiet account must not appear).
Acceptance: tests green, numbers match, Insights tab verified.
King's 5 checks: five appointments compared with the CRM calendar (status, time, assigned user).
Write docs/features/F3.md and STOP.
```

### F6: Account audit and Share link (the sellable asset)
```
Stage F6. Goal: the audit is correct, sales-ready, and the public link is safe.
1. Audit contents come only from verified metrics (F1 to F3). Show counted facts apart from estimates. Plain words.
2. Harden the Share link: unguessable token (at least 128 bits), default expiry (for example 14 days), revoke button, view count, snapshot date, rate limiting, noindex, no account or client names, no names in link previews. Tests for each. Test that the public page cannot reach any tenant data beyond its snapshot.
3. Print and PDF layout looks professional at A4 and Letter. Copy summary works.
4. Add a "what we found" summary and a one-page fix plan section that an agency could send to its client.
Acceptance: link security tests green, the public page checked while logged out, print layout verified.
King's 5 checks: run the audit on KD Squares Test, open the share link in a private window, and confirm no names, a correct date, and that revoking kills the link.
Write docs/features/F6.md and STOP. This completes Milestone M1.
```

### F4: Inbox & SLA
```
Stage F4. Goal: unanswered conversations are correct and clearly labeled.
1. Define "waiting": last message is inbound and no outbound after it, excluding internal notes, with a setting for auto-replies. Use one window everywhere and label it (Today said 24 and Inbox said 13 because of different windows).
2. Aging buckets (1h, 4h, 24h, 48h plus), channel list, deep links through crmUrl, CSV export.
3. Tests with the demo tenant (internal notes, auto-replies, multi-channel, deleted conversations). Verify against the database and the CRM.
Acceptance: tests green, windows consistent with Today, numbers match.
King's 5 checks: five waiting conversations compared with the CRM inbox.
Write docs/features/F4.md and STOP.
```

### F5: Today (the front door)
```
Stage F5. Goal: the first screen answers "what needs me right now" in 5 seconds.
1. Lead with unanswered leads in plain words ("3 leads are waiting for a reply"), then appointments to fix, then accounts needing attention. Outlier guard on dollar cards. The sync banner appears only during the first sync. Move the filter bar into a drawer. Short one-sentence subtitle.
2. When launched from inside a client account, open on that account, with a switch to the all-accounts view for users allowed to see it.
3. Merge Overview into Today and hide the Overview page.
4. E2E 5-second test: assert the headline is the leads-waiting message when leads are waiting. Check phone width.
Acceptance: tests green, screenshots at 3 widths.
King's 5 checks: open Today from the agency view and from inside a client account.
Write docs/features/F5.md and STOP.
```

### F7: Accounts
```
Stage F7. Goal: the Accounts page and account detail page are correct and readable.
1. Define the health score and risk labels in METRICS.md with tests. Replace jargon (engagement score, churn, dormant) with plain words plus a "what this means" tap.
2. Fix the clipped contacts column and any table overflow. Open and test the account detail page (never seen).
3. Verify counts against the database and the CRM. Filters work.
Acceptance: tests green, no clipping at 3 widths.
King's 5 checks: three accounts compared with the CRM (contacts, last activity).
Write docs/features/F7.md and STOP.
```

### F8: Settings, Getting started, What's new
```
Stage F8. Goal: settings are clear, enforced, and honest.
1. Verify every setting actually changes behavior (stale threshold, reply target, speed target, automated-touch option, brand name). Client access switches per account must be enforced on the server, with tests.
2. Shorten the page, group it, and use plain words. Getting started ticks off honestly. The What's new and next page works (roadmap votes and change log).
3. White-label brand name and logo apply on screens, emails and the Share link (test with a brand name set).
Acceptance: tests green, brand test passes.
King's 5 checks: change three settings and confirm the behavior changes.
Write docs/features/F8.md and STOP.
```

### F9: Alerts and emails
```
Stage F9. Goal: alerts and the weekly brief actually arrive and are worth reading.
1. Confirm which email provider is configured and its sending-domain authentication (SPF, DKIM). Report what is missing.
2. Build and test: weekly brief, alert emails (speed-to-lead breach, unmarked appointments, silent failure), quiet hours, time zones, deduplication, retries, unsubscribe link. Content uses only verified metrics and no banned terms.
3. Check the scheduler against the Vercel plan (cron limits).
4. Send real test emails to King and one outside address. Report deliverability (inbox or spam).
Acceptance: emails arrive in the inbox, content verified, dedupe and retry tests green.
King's 5 checks: receive and read the weekly brief and one alert on a phone.
Write docs/features/F9.md and STOP.
```

### F10: Call lists
```
Stage F10. Goal: Call lists load fast and the queues are correct.
1. Profile why the page spins for more than 5 seconds. Fix with query optimization, pagination and a loading skeleton. Test on the 50,000-contact account.
2. Define each pre-built list in METRICS.md (yesterday's no-shows, new leads with no touch, hot leads untouched for 3 days, stale deals). Tests on the golden dataset. Deep links through crmUrl. No message sending.
Acceptance: loads under 2 seconds on the large account (or a documented, accepted number), numbers match.
King's 5 checks: open each list and compare 5 contacts with the CRM.
Write docs/features/F10.md and STOP. This completes Milestone M2.
```

### E1: Zoom meeting notes (flagged off, after M2)
```
Stage E1. Goal: decide honestly whether the Zoom integration is safe and worth keeping. It stays behind a default-off flag.
1. Report the Zoom OAuth app status and whether outside users can authorize it without Zoom's app review (CHECK Zoom's rules).
2. Test Connect Zoom, webhook signature verification, and end-to-end: a real meeting or a simulated summary to the private address, matching to a contact, writing a note to that contact. Test: no matching contact, duplicate contacts, several attendees, the switch that turns note-writing off.
3. Privacy: what meeting content is stored, retention, deletion on uninstall, disclosure text. Scopes needed.
4. Rewrite the Meeting notes page so it is accurate.
Acceptance: tests green, a real or simulated meeting verified, privacy text written. Recommend keep or cut.
King's 5 checks: run one short meeting (a paid Zoom host with meeting summaries is needed) and check the note on the contact.
Write docs/features/E1.md and STOP.
```

### E2: Fathom (flagged off)
```
Stage E2. Goal: verify the Fathom path or cut it.
1. Check Fathom's current API and webhook options (CHECK docs) and how SubSync receives notes (private address, Zapier or Make, or direct).
2. Test with King's Fathom account: one real meeting, match to a contact, note written, switch off, no match, duplicate contacts.
3. Privacy and retention same as E1.
Acceptance and STOP as E1. Recommend keep or cut.
```

### E3: Slack alerts (flagged off)
```
Stage E3. Goal: verify Slack alerts or cut them.
1. Check Slack OAuth distribution rules for apps used by other workspaces (CHECK).
2. Test connect, post an alert to a channel, rate limits, message content (verified metrics, no banned terms), disconnect, uninstall.
3. Scopes must be minimal. Document them.
Acceptance and STOP as E1. Recommend keep or cut.
```

### E4: Hidden pages
```
Stage E4. Goal: decide what to do with every hidden page. Do not re-enable anything without evidence.
For Pipeline and deals (including the Stale deals tab), Leads, Team, Contact search, Clients, Setup, Duplicates, and Data cleanup: verify numbers against the database, check against F1 definitions, confirm Data cleanup only writes after a preview and confirm, that undo works, and that the pages' text matches what they do. For each page write KEEP, HIDE, or CUT with a reason, and fix S0 and S1 issues only for the KEEP ones.
Write docs/features/E4.md and STOP.
```

### Z1: Full re-review
```
Stage Z1. Run the full Mode A buyer and UX review from docs/BUYER_AND_UX_REVIEW.md on the current build with the demo tenant and the real test accounts (read-only). Write UX_REVIEW.md, BUYER_REVIEW.md, COPY_AUDIT.md and METRIC_AUDIT.md. Also run the readiness review from docs/READINESS_AND_TEST_PLAN.md and write READINESS_REPORT.md. List every remaining S0 and S1. Do not fix yet. STOP.
```
King then runs Mode B (sandbox plus a browser assistant) and Mode C (five real people).

### Z2: Release 1.1.0
```
Stage Z2. Fix the Z1 findings in priority order, one at a time with tests. Then prepare release 1.1.0: list the optional scopes to add, the corrected listing copy, the Getting Started guide, release notes, and the Loom demo script from the readiness doc. Remove the localhost redirect URL. Give King exact portal steps (Clone as Draft, edit, publish) and STOP.
```

### Z3: First pilot install
```
Stage Z3. Prepare the first pilot install: a one-page "what we read, what we store, how it is deleted" note for the agency, the install steps, a data-deletion test on a fresh install, the support inbox check (first response within 24 hours), a rollback plan, the kill switch instructions, and the founding-price message. Write docs/features/Z3.md and STOP.
```

---

## 6. KING'S ROLE PER STAGE (about 10 to 20 minutes each)

1. Read the evidence summary Claude Code prints.
2. Do "King's 5 checks" in the CRM by hand.
3. Open the screen on your phone once.
4. Reply PASS, FAIL with what you saw, or ask a question.
5. Type NEXT when you accept.

If you are tired, stop at a stage boundary, never in the middle. `docs/PROGRESS.md` holds the place.

---

## 7. CASH LINK

- Do not install SubSync on a prospect's account until the gate in section 3 is met. You are holding their customers' data.
- When M1 passes, run the Account audit on a prospect with their permission, read-only, and offer the audit and fix plan for money. Assumed prices to test, not market rates: audit about $200, fixes $500 to $2,000 as a project or $300 to $800 a month as a retainer.
- While Claude Code works on M1, use your waiting time to send the pitch messages and book the five real-people sessions (Mode C).
- If M1 is not done by Monday midday, tell me which stage is stuck. Do not skip a stage to catch up.
