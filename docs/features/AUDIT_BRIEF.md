# Account audit build: one integrated builder brief

Rules: docs/features/CLIENTS_BRIEF.md and the briefs it points to apply in full (see TODAY_BRIEF.md first paragraph for the list). Read: docs/research/AUDIT_R1.md, docs/features/AUDIT.md, docs/AUDIT_REVIEW.md, src/app/app/views/audit*.tsx, src/lib/analytics/audit-*.ts, docs/METRICS.md "Account audit, rebuilt".

Goal: the install-day hook and the agency's sales asset. It already works (built 5 Nov); this pass makes it sell and keep proof. Do NOT rewrite the counting rules or the estimate.

## Evaluation (principle 1)
(a) Decision: owner or agency salesperson decides what to fix first and what to tell a client; next they press the one button on a finding or send the share page. Missing: "I cannot show the client where we started". (b) Data: all lists readable on granted scopes (VERIFIED); older-than-14-days first reply is NOT available (docs/BLOCKED.md): show "Not checked". (c) No native or competitor equivalent on CRM data (AUDIT_R1.md). (d) Simplest: store each audit run and compare. (e) Risk: dollar estimate trust, share link leaking names or another account, comparing across rule versions.

## Slices (inside one builder)
1. **Audit history (moat first):** append-only `au_runs` (account, run time, rules version, per-finding counts, estimate low/high, sample size) written on every run and by a weekly sweep; idempotent per (account, day). Ship recording first.
2. **Baseline and then-vs-now:** first run per new account is the "Baseline at install"; the page shows "then vs now" per finding with minimum-sample rules and "history starts <date>". New location added -> run automatically (hook into install/new-location lifecycle, not a message to anyone).
3. **Client one-pager:** printable and copyable branded page (agency logo and colours from the white-label settings, no CRM brand words, no lead names), counts only, "Estimate" label and formula link; share link through the existing verified-page pattern, expiring, revocable.
4. **Monthly re-audit email** to the agency owner: what got better, what got worse, one button. Per-account mute.
5. **Filters and scale:** all counts clickable and equal to rows, keyset paging on "See all clients" at 1M+ leads; SQL aggregates and the existing rollup; filters recompute everything.

## NOT available (say it on screen)
Payments collected, ad data, replies for leads older than 14 days, anything before install. Wording: "Needs permission: reconnect" or "Not available from the platform yet".

## Safety
Read-only. No writes, no deletes. Share-link revoke is a SubSync-only delete: typed confirmation naming the link. Tenant guard on every account/location id; a client admin never sees another account; an agency-only filter note is never sent to an account user (existing test stays).

## Customer's-eye check (required)
Owner: reads the sentence, presses one button, gets rows. Salesperson: hands the one-pager to a prospect in 10 s. Confusing risk: estimate vs counted money on separate lines. Write answers in docs/AUDIT_REVIEW.md.

## Setup
Worktree C:\Users\KING\wt\AU, branch stage/au, port 3642. Flags `au_history`, `au_onepager`, `au_monthly`. Migrations from 20261205090000 (`20261205090000_au_runs.sql`, `20261205100000_au_share.sql` only if the share table needs a column). Tests: xtest- tenant cross-read for runs and share, rules-version comparison, share page contains no names, counts equal rows.

## Extras to list in the report
"Audit this account" button on new accounts; PDF-friendly print CSS; "what changed since last audit" sentence at the top.

## Done when
Flags ON in the live app, verified with real roles in a browser, why-would-I-pay pass written, FEATURE_STATUS.md updated.
