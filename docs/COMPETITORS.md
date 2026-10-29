# Competitors and adjacent tools

Summary of the overnight research. Vendor claims are marked unverified; check live pricing pages before quoting any number publicly. Fuller notes: `DEEP_RESEARCH.md` and `FEATURE_RESEARCH.md`.

## Who we overlap with

| Tool | What it does | Where SubSync differs |
| --- | --- | --- |
| GoCSM | Health scoring and churn signals for agencies on this platform. Closest competitor. | Flat tiers that work out to roughly $1.60 to $2 per account at 100 accounts (vendor claim, unverified), against our $5. We compete on explainable scores, money-at-risk figures, cross-account search and the AI connector, not on price. |
| ghladmin-style admin tools | Bulk account management and cross-account utilities. | Mostly actions; little analysis. SubSync is read-only and analytical, which also makes it easier to trust and to pass review. |
| AgencyAnalytics and similar reporting suites | Client-facing marketing reports from ad, SEO and social data. | They report marketing channels; SubSync reports what is happening inside the client's CRM account (pipeline, conversations, dormancy). Complementary rather than head to head. |
| The platform's own agency dashboard | Basic account list and snapshots. | No cross-account search, no scoring, no stale-deal or SLA view. This is the gap, and also the risk if the platform builds it. |

## What they cannot do (our angles)

1. **Explain the score.** Competitors show a number; ours shows five components and why each scored as it did.
2. **Put money on it.** Stale deal value, expected revenue by each account's own win rate, and an estimate of what slow follow-up costs.
3. **Search every client's contacts at once.** The platform has no cross-account contact search.
4. **Ask an AI assistant about your portfolio** through a read-only MCP connector with revocable keys.
5. **Email authentication per client** (SPF, DKIM, DMARC) with plain-English fixes, because bad deliverability silently kills client results.
6. **Stay read-only.** No writes means a smaller permission surface and an easy privacy story.

## Pricing implications

- $5 per client account, free up to 5, price kept as a setting.
- GoCSM undercuts on a per-account basis at scale. Options for King to decide: keep $5 and sell the money-at-risk and AI features, add volume tiers (for example lower per-account price above 50 accounts), or a flat tier for large agencies. No change made.
- Private apps cap at 5 agencies, so real revenue needs the Public listing.

## Risks

- The platform could ship a native version of the basics. Defensibility rests on analysis depth, cross-account search and the AI connector rather than on any single screen.
- Workflow-based features are speculative (closed beta API); nothing in the product depends on them.
- Login and last-seen data may not be exposed by the API; engagement is therefore activity-based and says so.
