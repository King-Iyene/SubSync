# Overnight report: SubSync feature encyclopedia

Spec: `docs/FEATURE_ENCYCLOPEDIA.md` (184 features in 14 sections, plus a second app mode and a pricing table). Read in full.

**Short version:** I built what the data we already sync can honestly support: about 55 features done, about 12 partly done. Most of the rest cannot be built until new data is synced (appointments, users, workflows, lead source, custom fields, message history), which needs new permissions on the GHL app that I did not change tonight. Nothing is broken, and everything shipped was checked on the live site and on your real KD Squares Test data inside GHL.

Rules I kept: small commits straight to `main`, build checked after every push, no destructive database changes, no env vars, secrets, billing or payment settings touched.

---

## What I completed

Every commit below built successfully on Vercel and passed `scripts/deploy-check.sh` (11 live probes) right after the push.

| Commit | What shipped | Spec items |
| --- | --- | --- |
| `20a2cba` | Data freshness strip on every page with a stale warning after 6 hours. Connection health card (failed jobs, last sync, token refresh). Per-account sync table with a Resync button. | 7.11, 11.4, 11.5 |
| `6d65273` | **Pipeline** page: forecast (worst, likely, best, 30/60/90 days), pipeline coverage against a saved monthly target, stage table with bottleneck flags and estimated conversion, deal risk score (0 to 100, with reasons), aging buckets, deal sizes, wins and losses by month, abandoned deals worth reopening, dead pipeline list, account comparison, every pipeline in one table, pipeline value trend. | 2.1 to 2.6, 2.8, 2.9, 2.11, 2.15, 2.16, 2.20 to 2.22 |
| `284a36e` | **Leads** page: lead quality score, lifecycle, lead aging, going-quiet buckets, VIP contacts with a "reach out" flag, growth with per-account change, tag usage and duplicate-looking tags, invalid and disposable email and invalid phone detection with examples, large import detection, same person in several client accounts. | 3.4 to 3.6, 3.9 to 3.11, 3.15, 3.18 to 3.20 |
| `eb5f75a` | **Call lists** page: eight preset queues plus a custom builder, priority score, saved lists, call outcome logger with auto-advance, follow-up queue, speed-to-lead alert, power hour timer with session stats, win-back and recent-customer lists. | 8.1 to 8.6, 8.8, 8.9, 8.10 (partly) |
| `64eb5c0` | **Clients** page: monthly fee, value-created multiple, renewal countdown, last-spoken tracker, notes, industry segments, compare two clients with a plain-language summary, printable quarterly review (QBR), "needs a conversation" flag. **Executive summary** on the Overview with period comparison, monthly goals with pace, and unusual-change highlighting (also red dots on the pipeline chart). | 6.5, 6.7 to 6.11, 6.13, 6.14, 7.6 (partly), 7.7, 7.10, 7.12, 14.5, 14.6 |
| `b88c32a` | Reply aging buckets with a 24-hour critical count, deals with no contact for 7+ days, after-hours lead analysis in each account's own time zone, setup score per client, **Today's priorities** card (plain rules, not AI), CSV exports of open deals and clients. | 4.3, 4.9, 4.18, 11.1, 12.1 (rule-based), 7.5 (partly) |
| latest | Lead cohorts by month with conversion. Wording fix. | 7.8 |

Also fixed along the way: a malformed account id on the resync route used to fall through and start a full sync (caught by the new integration check, fixed before it shipped). A regex escape slip in the data-quality SQL flagged a third of demo emails as invalid (caught by looking at the numbers, fixed with a backslash-free pattern).

**Database:** one additive migration, `20261030000000_insights_tables.sql` (account_profiles, goals, call_lists, call_outcomes). No existing data changed or removed.

**Tests:** 125 unit tests and a 13-section HTTP integration check (`node --env-file=.env.local scripts/with-dev-server.mjs`) all pass.

## What I verified live

- After every push: Vercel build `success` and 11 probes on `https://subsync.kdsquares.com` (home, app, legal pages, install redirect, MCP, webhook rejects unsigned requests, cron rejects no secret, API rejects no session).
- Inside GHL, on the real KD Squares Test account (view only, nothing written): Pipeline (189 open deals, 60% win rate, forecast bands), Leads (332 contacts, lifecycle adds up to 332), Call lists (146 on the hot list), Executive summary (correctly says "no earlier data" where history is missing), Clients, Today's priorities (real items: messages waiting 376 hours, valuable contacts to reach, $2M in stale deals), Inbox sections (quiet deals, after-hours 47% of new contacts).
- I did **not** log any calls, set any fees or goals, or change anything on your real data.

## Blocked or skipped, and why

"Blocked" means the data does not exist in SubSync yet. Each needs a new permission (scope) added to the GHL app, and a re-sync, which changes what agencies approve on install. I did not touch app permissions, so these wait for your decision.

| Spec | Items | Reason |
| --- | --- | --- |
| 1. Appointments | all 28 (1.1 to 1.28), plus the no-show preset in 8.1 and 12.3 | No appointment data. Needs the `calendars/events.readonly` scope and a calendar events sync. This is the biggest single unlock. |
| 5. Team performance | all 16, plus 2.10, 4.10, 4.15, 8.7, 11.6, 13.1 to 13.6 | No users, tasks or per-user activity. Needs `users.readonly` and assignment fields synced. |
| 9. Workflows | all 8 | Workflows API is closed beta (403 for most accounts). Not promised. |
| 10. Compliance | 10.2 to 10.8 | Needs A2P registration, email delivery stats, phone data and consent fields we do not sync. 10.1 (DNS checker) was already built. |
| 12. AI | 12.6, 12.8, 12.9, 12.10, 12.3, 12.4 | Needs an AI provider key (secret, so off limits tonight) and in some cases message text, which SubSync deliberately does not store. 12.1, 12.2, 12.5, 12.7 exist as plain rules instead (Today's priorities, risk score, unusual-change flags, per-client activity sentence). |
| Lead source and custom fields | 2.7, 3.7, 3.12, 3.16, 7.9, 2.13 | Source, custom fields and referral data are not synced. |
| Do-not-disturb, birthdays | 3.14, 3.17 | Not synced. |
| Message detail | 4.2, 4.4 to 4.8, 4.11, 4.12, 4.14, 4.16, 4.17, 4.5 | We keep only who wrote, when and through which channel. First-response time, volume trends, sentiment and message search need message history. Reply aging and gaps (4.3, 4.9) were possible and are done. |
| Email delivery | 6.3 (email version), 6.4, 7.2 | Needs an email provider key (secret). The Slack weekly digest already exists. |
| Client-facing | 14.1 to 14.4 | The spec points to `MOAT_FEATURES.md`, which was not attached. A public client link also exposes client data, so it needs your security decision first. 14.4 needs a survey sender. |
| Missing spec file | 12.1 to 12.5, 13.1 to 13.3, 14.1 to 14.3 | All reference `MOAT_FEATURES.md`, which was not attached. |
| Business Mode | the whole second app mode | It is a separate app in the GHL portal (sub-account install). Not started. |
| Pricing table in the spec | revised tiers | Billing settings are off limits tonight. Nothing changed. |

## Not done, but possible next (no new data needed)

2.12 deal movement log (needs recording stage changes from now on), 2.17 seasonal patterns (needs 6+ months), 2.19 proposal-to-close, 3.8 contact timeline, 4.13 communication cadence, 6.6 timeline annotations, 7.1 custom report builder, 7.3 white-label reports, 7.4 report templates, Excel/PDF/Sheets export for 7.5, 11.3 app usage analytics, 8.10 satisfaction signals, configurable lead score weights.

## Partly done, so you know what is missing

- **2.1 funnel and conversion** is estimated from where deals are now, because stage history is not kept.
- **2.4 forecast** uses open value times the win rate (needs 5+ closed deals); there are no per-stage probabilities.
- **2.5 win/loss** has no split by source or user (not synced).
- **6.7** onboarding progress has days since install, first lead and first deal; "first appointment" needs appointment data.
- **6.8 QBR** prints or saves as PDF from the browser; there is no shareable link.
- **6.10** shows fees and fees at risk; churned clients and net retention are not tracked.
- **7.5** exports are CSV only.
- **3.4** lead score uses fixed weights, not configurable per account.

## Decisions for you when you are back

1. **Add permissions to the app?** Calendar events and users would unlock Section 1 (28 features) and most of Section 5. This changes the install approval, so decide before more agencies install.
2. **Attach `MOAT_FEATURES.md`** if you want the AI and gamification items built to that spec.
3. **AI and email keys** (secrets, only you can add them) would unlock the AI items and emailed reports.
4. **Pricing** is untouched. The spec's revised table (Business and Agency modes) conflicts with the $5 per account plan already saved in the portal.
5. The demo data was reseeded at the end, so screenshots and the demo mode are clean.

---

# Round 2: sub-account mode, then the audit and deepening pass

This round has two parts. Part A (done first) added the sub-account side of the app and answered the
permissions and pricing questions. Part B followed the second brief: honest audit, Duplicates, daily
digest, research, engineering quality. Each part is logged below in the order it happened.

## Part A: sub-account mode (commits 89ccbd3, 3644945)

Built and live: a client account can install SubSync for itself and sees only its own account; an
agency can switch on a read-only view for each client's own staff; three plan tiers (free, starter, pro);
the access rules are enforced by a signed session plus a default-deny route list plus per-account
query limits. Lead sources, do-not-disturb, birthdays, team stats, deal movement log and a contact
timeline were added using only the permissions the app already has. Full detail and the pricing
recommendation: `docs/PERMISSIONS_AND_PRICING.md`.

Verified: 158 unit tests and the HTTP integration check (including 40+ assertions that a business or
client view can never reach another account or an agency page). Live: agency sign-in through the real
GHL single sign-on still works after the sign-in rewrite; the new Team menu item is live.

Not verified live (needs a real second account): an actual install by a client account (the token
exchange asks for a Company token first and falls back to a Location token, which follows the docs
but has not been exercised), and a real client-staff sign-in. Both are covered by unit tests of the
decision logic only. `docs/PERMISSIONS_AND_PRICING.md` lists the portal steps King needs for plans.

## Step 1: honest audit of every section (live app, real synced data, 30 Oct 2026)

Real data right now: 3 client accounts in the connected test agency (KD Squares LTD about 9,500
contacts and about 10,000 open deals, KD Squares Test 332 contacts and 194 deals, one empty account).
The very round numbers ($2,400,000 open pipeline, $1,200,000 expected) come from the large block of
imported test deals in the LTD account, not from a bug.

| Section | What it shows | Real and fresh? | Can the user act on it? | Answers "what do I do today?" | Label |
| --- | --- | --- | --- | --- | --- |
| Overview | KPIs, Today's priorities, executive summary, account health, sync status | Real; the last-synced strip is accurate | Open buttons on priorities | Partly: 3 ranked priorities, but no change against the account's own normal | Working, needs the digest (Step 3) |
| Accounts | Table of accounts with score, risk, contacts, stale deals, waiting; filters; CSV | Real | Open an account, export | Partly (sort by risk) | Working |
| Account detail | Score breakdown, trend, stale deals, checklist, email auth, alerts, controls | Real | Tick checklist, set owner, ignore, client view switch | Yes for that account | Working |
| Clients | Fees, value created, renewals, last spoken, QBR | Real but empty until the agency types fees and renewal dates ("n/a", "Never logged") | Edit profile, print QBR | No until filled in | Shallow (depends on manual input) |
| Team | Open and won value, stale deals, win rate per person | Real; names are typed by the user until the users permission exists | Rename people | Partly | Working (new) |
| Contact search | Name, email, phone search across accounts, contact timeline | Real | Open contact, view timeline | n/a (lookup tool) | Working |
| Deals | Stale deals, pipeline roll-up, hygiene | Real | Open in the platform | Lists, no ranking by what to chase first | Shallow |
| Pipeline | Forecast bands, coverage, stage bottlenecks, risk, aging, win/loss, movement log | Real; history charts say "not enough history yet" | Open deal; set a monthly target | Partly | Working |
| Leads | Lifecycle, quality score, quiet leads, VIPs, sources, cohorts, data quality | Real; sources fill in after the next sync of each account | Open contact | Partly | Working |
| Call lists | Preset and custom queues, priority score, outcome logger, power hour | Real | Yes: log outcomes, follow-ups | Yes (who to call next) | Working |
| Inbox & SLA | Conversations waiting past the reply target | Real, but conversation summaries only, no message text; long-dead threads (700+ hours) crowd the top | Open and reply in the platform | Partly | Shallow |
| Onboarding | Per-account setup checklist with percent complete | Real checks plus manual ticks; "workflows built" is always unknown (API closed beta) | Tick manual items | Partly | Shallow |
| Email health | SPF, DKIM, DMARC, MX checks per domain | Real DNS lookups, but the user has to add domains; nothing about bounce rate | Run check | Partly | Shallow |
| Duplicates (before) | Wall of repeated names with "N contacts share a phone ending 9755" | Real | None: no compare, no choose, no dismiss | No | Shallow |
| Alerts | Deduplicated alerts (stale deals, SLA, domain, data) | Real | View and dismiss | Partly: says what, not what to do first | Shallow |
| Settings | Thresholds, Slack, checklist, client access, AI keys, delete data | Real | Yes | n/a | Working |
| Getting started | Static how-to with an "Open" button in each step | Not real state: never changes | Navigation only | No; steps 1 and 2 both say "Open Overview" | Shallow |

Findings that changed the plan: (1) Duplicates was the weakest screen; the real data shows 2,535
exact-match groups (6,914 contacts), almost all in the one account that took a large import, so a
wall of names is useless there. (2) Counts-only screens (Deals, Alerts, Inbox) rank nothing against
the account's own normal. (3) Getting started does not know whether the install is connected,
synced, or whether the user has seen an alert.

## Step 2: Duplicates (commit e8e48fb, live)

2a. What the old screen flagged, on real data (read-only counts):

| Class | KD Squares LTD | KD Squares Test | What it means |
| --- | --- | --- | --- |
| Same email, same account | 2 groups | 15 groups (192 contacts) | Exact duplicates; the account allowed duplicates or the contacts predate the block |
| Same phone, same account | 3,634 groups (8,996 contacts) | 16 groups (188 contacts) | Mostly one large test import repeating the same people and numbers |
| Same phone, different format | 5 groups | 0 | Near matches the old screen could not see as one person |
| Same email in different client accounts | 23 people | | Normal for an agency; now shown as information only, never offered for merging |

2b. What the platform API supports (checked in its documentation): there is a read-only
`GET /contacts/search/duplicate` (finds the existing contact for an email or phone, scope
`contacts.readonly`), update and delete endpoints exist, and there is **no public merge endpoint**
(merging is a screen in the platform; community tools fake it by deleting the loser, with no undo).
Whether the location record exposes the "allow duplicate contact" flag is not documented; the sync
now reads it if present (the live screen shows "Setting not shown by the platform" until a sync
returns it, which is what the first live check showed). I could not probe it from my machine because
production tokens are encrypted with a key I do not hold, which is correct.

2c. Built: normalised matching (phone last 10 digits, email case and gmail dot and plus tricks, name),
a 0 to 100 confidence with the reasons, a recommended record to keep (deals, conversations,
completeness, activity), a field plan for what the kept record should contain, a side-by-side
review queue, recorded decisions with a saved snapshot of the records and an audit log, undo, and
bulk actions that default to a dry run. SubSync never merges or deletes: the platform has no safe
merge call, so the user merges in the platform's own Merge screen and tells us ("I merged these").
2d. Duplicate protection per account: shown when the platform returns it, otherwise a short guide.
Cross-account matches are only counted and explained.

Verified: 9 unit tests for the matching and 20 integration assertions (scoring ranges, unknown
decisions refused, contacts from another account refused, snapshot saved, audit row written, queue
shrinks then restores on undo, dry run records nothing, client view cannot decide, business limited
to its own account). Live on real data: loads in a few seconds with 2,535 groups; shows the three
accounts with their group counts.
