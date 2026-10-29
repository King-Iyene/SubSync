# SubSync build sequence

Simplest first, most complex last. Public wording says "client accounts"; internally GHL calls them sub-accounts or locations.

Last updated 2026-10-29 after the deep research (`docs/DEEP_RESEARCH.md`). "Best plan" changes were adopted on King's instruction to go with the recommended plan; see the change log at the bottom.

## Phase 1 - "Quick Win" launch (weeks 1-4)
Ship the features that use the simplest, most reliable APIs. Run as a **private pilot with up to 5 agencies** (the private-app cap), then submit for a Public listing as soon as Phase 1 is solid.

1. Cross-account contact search
2. Contact data completeness report per client account
3. Stale deal alerts (configurable per pipeline)
4. Client onboarding checklist (has pipeline, has contacts, has calendar; workflow check only where the API allows it; the DNS check is not here, see item 18)
5. **Dormant-account flag**, built from data activity (no new contacts, deals or conversations in N days). Moved up from Phase 2 because it had the strongest demand evidence and uses data we already sync.

Cross-account search alone is something every agency with 10+ client accounts wants badly.

## Public listing milestone (after Phase 1)
Plan and submit the Public listing right after Phase 1, not last: the private cap blocks growth beyond 5 agencies. Needs real screenshots, a demo video, a retention statement for the disconnect flow, reviewed privacy and terms, and the final scope list frozen (scope changes after review can trigger re-review).

## Phase 2 - "Retention" (weeks 5-8)
6. Unified inbox (all unread across accounts in one view). Demand evidence is weak (about 6 votes per request); keep here unless customers ask for it sooner.
7. Lead response time tracking and SLA monitoring
8. Client engagement scoring (1-100 per account), built from data activity, not logins. Test whether the Users API exposes last login before deciding.
9. Churn risk alerts based on engagement decline

## Phase 3 - "Intelligence" (weeks 9-14)
10. Multi-pipeline dashboard (all pipelines across all accounts, key metrics)
11. **Email authentication and deliverability monitor** (continuous). Upgraded from the old DNS-checker item and moved up from Phase 4: uses the `LCEmailStats` webhook (available to location-level apps) plus external SPF, DKIM, DMARC and blacklist lookups. External data is what makes it hard for GHL to copy.
12. Duplicate finder and merge, within a single client account only (never across different clients' accounts)
13. Centralized task queue
14. Data export scheduler (weekly automated CSV/Sheets)
15. Global DND/blacklist management
16. *Candidate:* messaging delivery-outcome monitor (failure and opt-out rates, DND changes). Registration status is not in the API, so this cannot be a registration monitor.

## Phase 4 - "Advanced Ops" (weeks 15-20)
**Speculative.** Items 17-20 depend on a closed-beta Workflows API that GHL enables per sub-account (others get a 403) and on execution logs that are UI-only. Do not promise them publicly.

17. Workflow audit (list all workflows across accounts; flag inactive/broken only where the API allows)
18. Trigger conflict detection (where available via API)
19. Batch settings propagation
20. Workflow template sync engine
21. Team performance metrics across accounts

## Phase 5 - "MCP/AI" (month 6+)
22. Natural language queries across accounts
23. AI-generated weekly client summaries
24. Smart workflow suggestions per account

## Parked ideas (from research, not scheduled)
- Setup comparison across accounts (tags, custom fields, custom values; read-only first). A competitor, ghladmin, covers part of it.
- Ad spend to opportunity attribution across clients (`adPublishing.readonly`); crowded space.
- Opt-in cross-agency benchmarks; strongest long-term moat but needs an install base first and a check of GHL's terms on aggregating data.
- Read-only snapshot drift report.

## Change log
- 2026-10-29: King chose to keep the original order; then, on "go with the best plan", the research proposals were adopted: dormant-account flag moved to Phase 1, DNS checker upgraded to the email monitor and moved to Phase 3, Phase 4 marked speculative, Public listing planned right after Phase 1. Pricing is **not** changed: King still decides whether $5 per client account stands against GoCSM's flat tiers; price is a setting in code, not a constant.
- Earlier: duplicate finder narrowed to within one account; engagement score based on data activity.
