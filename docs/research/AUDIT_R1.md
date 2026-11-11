# Account audit R1 (11 Nov 2026)
Labels as in TODAY_R1.md. Builds on docs/features/AUDIT.md and docs/AUDIT_REVIEW.md (built 5 Nov, awaiting King's checks).

## What exists
audit.tsx and audit-parts.tsx (about 400 lines), src/lib/analytics/audit-*.ts: one sentence ("leaking about $X a month", labelled Estimate), findings with exact rows, top 5 plus "See all N clients" with paging, a share link without names, a progress bar while reading. VERIFIED (read docs and code).
Thin: (1) it cannot be run before install, which is the sales use; (2) no history of past audits, so no "40 problems in March, 12 now"; (3) the share page is a summary, not a branded one-pager for a prospect; (4) no scheduled re-audit; (5) no "baseline at install" for a newly added client account.

## Platform
- Gives: every list the audit uses is readable on the 21 granted scopes (VERIFIED, AUDIT.md Evaluation).
- Lacks: a native "what is wrong in my account" page; native reports are per thing. UNVERIFIED that no marketplace app does this.
- NOT available: first reply for leads older than 14 days (docs/BLOCKED.md), payments collected, ad data, a pre-install read (we have no token before install; a pre-install audit needs the install, so sell the 14-day trial instead).

## Competitors
- Free audit tools look at ads and websites; none found that read the CRM (INFERENCE).
- Consultants sell a manual workflow audit and a monitoring retainer at about $150 to $500 per month (INFERENCE, docs/research/WORKFLOWS_COMPETITORS.md).
- Lead Spine (marketplace) does a one-time automation audit (INFERENCE, same file).

## Customer pain (INFERENCE)
1. Agency owner learns of 30 unanswered messages only when the client complains.
2. Agency salesperson needs a hard number to open a conversation ("your last 90 days leaked $X").
3. Onboarding a client: nobody records the starting state, so no before/after proof.

## Biggest sources of error
- Dollar estimate looking invented: minimum 20 closed deals, a range, "Estimate", formula one tap away (exists).
- One person in several findings: one counting rule (exists, tested).
- Test or ownerless deals inflating money (excluded, exists).
- Comparing an old audit with new rules: store a rules version with each audit run.

## Moat
Store every audit run append-only (count per finding, rules version, date): "baseline at install" and a monthly "then vs now". Nobody else holds a client's day-one state. The dollar estimate is stored as an estimate, never added to counted money.

## What would make an owner pay
The audit is the install-day hook and the agency's sales tool. Pay trigger: a baseline per new client on day one and a "30 days later" receipt to show the client. Extras: one-tap "Audit this account" when a location is added, a printable branded page, a monthly re-audit email.

## Customer's-eye check
Would an owner pay? For the sentence plus the rows, yes; for another dashboard, no. Confusing risk: two money figures (estimate vs counted); keep them on separate lines with different labels.
