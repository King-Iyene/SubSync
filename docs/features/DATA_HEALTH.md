# Data health module (stage DH1)

## Step 1: evaluate before building (principle 1)

1. **Decision and user.** The agency owner (and a client admin for their own account) decides which client accounts have dirty data, which source or import is sending bad records, and what to clean first. They next open the records in the CRM, queue them for a person, or run a safe format fix. If it were missing they would say: "I cannot prove to my client that their contact list is clean, and I find out about a bad import weeks later."
2. **Data.** TESTED against the tables we already sync: `cached_contacts` (name, email, phone, source, do not disturb, owner, dates), `cached_opportunities`, `cached_conversations`, `cached_appointments`. Duplicates come from the existing finder (`duplicateGroups`), not a second copy. Not available from the platform yet: unsubscribed state, active payments, active workflows per contact. Those are never guessed; the fix path is conservative because of it.
3. **Native or competitor overlap.** The CRM has a duplicate list and bulk tools per account. Competitors in `docs/research/DATA_QUALITY_COMPETITORS.md` clean data but do not keep a history, rank accounts, alert on a bad import by source or prove the result to a client. Our edge is the history, the cross-account league and the same-day alert.
4. **Simplest version that proves value.** A score with a one line reason, every number opening its records, a daily record, a league table. Then alerts, digest, finders, safe fixes.
5. **Risk.** Writes (optional `contacts.write`, rehearsal unless its live switch is on, preview, signed token, daily cap, protected contacts, 24 hour undo), privacy (history holds ids and counts only, never names), benchmark re-identification (k of 10 accounts and 3 companies, coarse groups, opt out), cost (a few accounts per hourly run).

## What shipped

- Score 0 to 100 per account (`docs/METRICS.md`, "Data health"). Under 50 contacts it says "not enough data". Plain "why" line, components table, every number opens a records panel.
- History: `dh_snapshots` (daily, all components), `dh_flags` (contact id, rule, first seen, fixed at). "Your record since you installed", a time slider and a trend whose points open that day's records.
- Quality firewall (detect only): a source that creates at least N bad records in 24 hours (default 10, per account) and at least 3 times its own 14 day usual raises an alert (kind `quality`, in app and email through the shared dispatcher, deduped by key, resolved when it clears). Imports tab groups bad records by source.
- Proof loop: `dh_outcomes` records when each alert was raised and resolved and how; average hours to fix. "Caught before the client noticed" is NOT claimed: the platform cannot tell us.
- Weekly digest per company and Proof page per account (printable). The digest email is a rehearsal (logged only), because only the notification dispatcher may send and it has no digest type for this yet.
- Finder lists (junk, orphan, stale, duplicates) with SubSync side Ignore, Fixed and queue with an owner. Ignored records leave the score. Never written to the CRM.
- Safe fix: phone to one standard format, names typed all upper or all lower case. Admin only, `data_health_fix`, `contacts.write` (already an optional scope), preview, 15 minute signed token tied to the exact changes, 200 per account per day, skips do not disturb, open deal, upcoming appointment; idempotent; audit row; 24 hour undo from the saved before value; contacts we changed are not judged "stale" for 7 days (our writes never change our numbers). No merge, no delete.
- Benchmarks: anonymous median and quartiles per coarse group (size, plus industry when set), shown only with at least 10 accounts from at least 3 companies; opt out in Rules.
- Plans: feature `data_health` (free, one account: score, trend), `data_health_pro` (all accounts, alerts, digest, finders, rules), `data_health_fix` (fixes). Flag `data_health` is OFF by default. Plan ids come from `plan_entitlements`; `ENTITLEMENTS_MODE` open or enforced is honoured.
- Missing tables (42P01) or columns (42703) answer "nothing yet", never an error page.

## Scopes

None new. Reads use what is already granted. Fixes need the optional `contacts.write`; without it the Fix tab says "Needs permission: reconnect" and names it.

## PROPOSALS (not built, need King's approval)

1. **Pre-import check.** A page where an agency pastes or uploads a CSV before importing it, and SubSync reports how many rows are duplicates of existing contacts, invalid or junk, so the bad import never happens (the API cannot block, but a check before the import can).
2. **Client-facing data health badge.** A shareable, read-only link or PDF per client account with the score history, so the agency can show the client the trend each month (like the Instant Audit share link), with the agency's own branding.
