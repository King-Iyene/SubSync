# Data health R1 (11 Nov 2026)
Labels as in TODAY_R1.md. Builds on docs/features/DATA_HEALTH.md (stage DH1) and docs/research/DATA_QUALITY_COMPETITORS.md.

## What exists
data-health.tsx, data-health-parts.tsx (about 360 lines), src/lib/data-health/{rules,score,store,digest,cron,fix,firewall}.ts: score with a one-line reason, every number opening its records, daily record, league across accounts, alerts, digest, finders and safe format fixes behind preview and undo (writes optional and rehearsal-only unless the live switch is on). VERIFIED (read DATA_HEALTH.md and file list).
Thin: it overlaps Clean-up (duplicates, missing fields) and is in the "More" menu with its own score; two scores for one idea confuse. Needs: one health number shared with Clients' "data quality" signal; a firewall view naming the bad source (form, import, workflow); proof "this month clean-up fixed N".

## Platform
- Gives: contact fields (name, email, phone, source, DND, owner, dates) and our synced copies of deals, conversations, appointments (VERIFIED, DATA_HEALTH.md).
- Lacks: any history of data quality, any alert on a bad import.
- NOT available: unsubscribed state, active payments, active workflow membership per contact (never guessed). Field-level change history is not provided by the platform; we only know changes seen between syncs.

## Competitors
Salesforce-side tools (Cloudingo, DemandTools, DataGroomr, Plauti, Dropcontact-style enrichment) clean but do not keep history or rank accounts (INFERENCE, DATA_QUALITY_COMPETITORS.md). CRM-agnostic "data quality scorecards" in Databox or AgencyAnalytics need a custom data source (INFERENCE). Hot Prospector and AllTheApps: no data-quality measure found.

## Pain (INFERENCE: consultevo.com "9 critical mistakes agencies make in contact management", 4spotconsulting.com)
1. Missing phone numbers mean speed-to-lead and text-back fail silently.
2. A bad import or form changes thousands of records and is found weeks later.
3. Ownerless leads: nobody is responsible so nobody replies.
4. Agencies cannot show a client "your list is clean".

## Biggest sources of error
- Counting a field "missing" when the platform keeps it elsewhere (custom field vs standard).
- Fixing format (phone to E.164) with the wrong country: needs the account's country; otherwise do not fix.
- Treating test contacts as dirty data: exclude test accounts and flagged tests.
- Score drift when rules change: version the rules, show "rules changed on <date>".

## Moat
Daily record per account and per source (ids and counts only, no names) means "the bad import began on 3 Nov from source X" is answerable. League and benchmark need k of 10 accounts and 3 agencies. History starts at install.

## What would make an owner pay
Alert the same day a bad import lands ("212 contacts arrived with no phone from source 'Facebook form'") and a monthly "list health" receipt for the client. Money: every contact without a phone is a lead speed-to-lead cannot reach.

## Customer's-eye check
Would they pay? As a standalone module, weakly; as the Health tab of Clean-up with the same-day import alert, yes. Confusing: two scores. Fix: one score, one tab, same words.
