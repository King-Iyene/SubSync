# Data health build: one integrated builder brief (becomes the Health tab of Clean-up)

Rules: docs/features/CLIENTS_BRIEF.md and the briefs it points to apply in full (list in TODAY_BRIEF.md first paragraph). Read: docs/research/DATA_HEALTH_R1.md, docs/features/DATA_HEALTH.md, src/lib/data-health/*, views/data-health*.tsx. Do after Clean-up (CLEANUP_BRIEF.md) so the two share one score.

Goal: one honest health number per account, same-day alert on a bad import, and a client receipt. Reuse the built score, firewall, digest and fixes; do not rebuild.

## Evaluation (principle 1)
(a) Decision: owner or client admin decides what to clean first and which source to fix; next they open the records or ask a person to fill the gaps. Missing: "I find out about a bad import weeks later". (b) Data: contact, deal, conversation and appointment copies we already sync; NOT available: unsubscribed state, active payments, workflow membership per contact; field-level change history from the platform. (c) Competitors do not keep history or alert on imports (DATA_HEALTH_R1.md). (d) Simplest: score + reason + the same-day import alert. (e) Risk: counting a field missing when it lives elsewhere, wrong country in phone fixes, double scores confusing people, test contacts counted.

## Slices
1. **One score:** reconcile with Clients' data-quality signal and Clean-up; one number, one reason, rules versioned (`rules changed on <date>`). Unit-test in docs/METRICS.md.
2. **History recording first:** confirm the daily record holds per-account and per-source counts (ids and counts only, no names); add `dh_source_daily` (account, day, source, new contacts, missing phone, missing email, no owner, duplicates) if missing, idempotent per (account, day, source).
3. **Same-day import alert:** "212 contacts arrived with no phone from source 'Facebook form'" when a source's missing rate exceeds its own normal (minimum 3 weeks and 30 records, else "not enough data"); dedupe, quiet hours, per-account mute.
4. **Fix paths:** open records in the CRM; assign to a person (SubSync queue); safe format fixes only with account country known, preview, cap, undo within 24 h, through the gateway, protected contacts excluded.
5. **Client receipt line:** "your list health went 71 to 84 this month; 212 phone numbers fixed" into Today > Proof and Clients reports.
6. **Nav:** show as tab "Health" inside Clean-up; remove the separate More entry (flag `dh_screen` OFF = legacy entry hidden); keep code.

## Scale, tenancy, deletes
SQL aggregates and the daily rollup; keyset paging; 1M+ contacts; count equals rows; tenant guard on every id; xtest- cross-tenant test; any delete requires typed confirmation naming the item; DND and open-deal contacts are never deleted.

## Customer's-eye check (required)
Owner: "what is dirty, who sent it, what do I do?" in 5 seconds. Words: no jargon; every score explained in one line. Record in docs/features/DATA_HEALTH.md.

## Setup
Worktree C:\Users\KING\wt\DH, branch stage/dh, port 3645. Flags `dh_alerts`, `dh_receipt`, `dh_screen`. Migrations from 20261208090000 (`20261208090000_dh_source_daily.sql`). Tests: score unit tests, alert normal-baseline minimums, country-required fix, tenant cross-read.

## Extras to list
Per-source league across accounts; "this form lost 40% of phone numbers" sentence; CSV of the 212 records.

## Done when
Flags ON, verified in a browser with real roles, why-would-I-pay pass written.
