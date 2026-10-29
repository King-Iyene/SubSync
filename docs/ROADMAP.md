# SubSync build sequence

Simplest first, most complex last. Public wording says "client accounts"; internally GHL calls them sub-accounts or locations.

## Phase 1 - "Quick Win" launch (weeks 1-4)
Ship the features that use the simplest, most reliable APIs.

1. Cross-account contact search
2. Contact data completeness report per client account
3. Stale deal alerts (configurable per pipeline)
4. Client onboarding checklist (has workflows, has pipeline, has calendar; DNS check is listed here in King's roadmap but sits in Phase 4 of the brief, see decision below)

Cross-account search alone is something every agency with 10+ client accounts wants badly.

## Phase 2 - "Retention" (weeks 5-8)
5. Unified inbox (all unread across accounts in one view)
6. Lead response time tracking and SLA monitoring
7. Client engagement scoring (1-100 per account)
8. Churn risk alerts based on engagement decline

## Phase 3 - "Intelligence" (weeks 9-14)
9. Multi-pipeline dashboard (all pipelines across all accounts, key metrics)
10. Cross-account duplicate finder and merge
11. Centralized task queue
12. Data export scheduler (weekly automated CSV/Sheets)
13. Global DND/blacklist management

## Phase 4 - "Advanced Ops" (weeks 15-20)
14. Workflow audit (list all workflows across accounts, flag inactive/broken)
15. Trigger conflict detection (where available via API)
16. Batch settings propagation
17. Workflow template sync engine
18. DNS health checker (external lookup, not the platform API)
19. Team performance metrics across accounts

## Phase 5 - "MCP/AI" (month 6+)
20. Natural language queries across accounts
21. AI-generated weekly client summaries
22. Smart workflow suggestions per account

## Research-driven proposals (not yet decided by King)

See `docs/FEATURE_RESEARCH.md` for evidence and confidence levels.

- Consider pulling a read-only "unread across accounts" view forward from Phase 2 (only item with direct demand evidence).
- Add "setup comparison" (tags, custom fields, custom values across accounts, read-only first) as a Phase 2 candidate.
- Narrow item 10 (duplicate finder and merge) to duplicates within one account, because contacts in different client accounts belong to different businesses.
- Build the engagement flag from data activity, not logins, because login data does not appear to be exposed.
