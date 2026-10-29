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
7. Client engagement scoring (1-100 per account), built from data activity (new contacts, deals, conversations), not logins
8. Churn risk alerts based on engagement decline

## Phase 3 - "Intelligence" (weeks 9-14)
9. Multi-pipeline dashboard (all pipelines across all accounts, key metrics)
10. Duplicate finder and merge, within a single client account only (never across different clients' accounts)
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

## Research decisions (King, 2026-10-29)

See `docs/FEATURE_RESEARCH.md` for evidence and confidence levels.

Decided: **keep the roadmap order as planned.** Applied above:
- Item 7 is built from data activity, not logins, because login data does not appear to be exposed.
- Item 10 is limited to duplicates within one account, because contacts in different client accounts belong to different businesses.

Not adopted for now (can be revisited): pulling the read-only "unread across accounts" view forward from Phase 2, and adding "setup comparison" as a Phase 2 candidate. The deep research found the unified-inbox demand weaker than first thought, which supports leaving it in Phase 2.

## Deep research proposals (not yet decided by King)

Evidence and scoring in `docs/DEEP_RESEARCH.md`. Order is unchanged until King decides.

- **Move the dormant-account flag earlier** (built from data activity). Strongest demand in the research (ideas-board requests of 70, 109 and 191 votes) and cross-tenant reads are hard for GHL. A competitor, GoCSM, sells health scoring, so aim to be faster and cheaper, not broader.
- **Upgrade item 18 (DNS health checker) into a continuous email authentication and deliverability monitor.** Uses the `LCEmailStats` webhook plus external SPF, DKIM, DMARC and blacklist lookups. External data makes it hard for GHL to copy. Strongest new idea.
- **Add a messaging delivery-outcome monitor as a candidate** (failure and opt-out rates, DND changes). A2P registration status is not in the API, so it cannot be a registration monitor.
- **Treat Phase 4 workflow items (14-17) as speculative.** They depend on a closed-beta Workflows API enabled per sub-account.
- **Plan the Public listing earlier**, because private apps are capped at 5 agencies.
- **Revisit pricing** against GoCSM's flat tiers before launch.
