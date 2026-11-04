# Workflows and campaigns: who does what (4 Nov 2026)

Method: two web searches and the live operation catalogue. Vendor sites were not opened (search snippets only), so every vendor claim is INFERENCE unless marked VERIFIED. Zapier, Make and the CRM's own help pages were not read. Not covered: the marketplace UI itself (cannot be browsed from here).

## Who does what

| Player | What it does for workflows and campaigns | Source / status |
|---|---|---|
| CRM native | Per account workflow list, execution logs per workflow, "installed apps" page flags app connection failures but not failed workflow runs | INFERENCE (search snippet) |
| Lead Spine (marketplace app) | Builds workflows from a sentence and audits an account's automations once (drafts, dead triggers, empty fields, unreachable branches). A point-in-time audit, not a continuous monitor | INFERENCE (vendor page snippet) |
| Audit consultants | Sell a review of every active and inactive workflow, and retainers for "workflow monitoring and integration health" at about $150 to $500 per month | INFERENCE (agency service pages) |
| All The Apps | White-label platform: branding, onboarding, support, snapshot management and a snapshot store, dashboards. No workflow health or failed-run alerting was found | INFERENCE (homepage snippet) |
| Snapshots (native) | Copy workflows, pipelines, templates and tags between accounts. They do not tell you which copied workflow later broke, and do not carry contacts or domains | INFERENCE (help article snippets) |
| AgencyAnalytics | Client reporting with a prebuilt HighLevel report and dashboard template (lead, call and form metrics). Not workflow health | INFERENCE |
| Zapier / Make | Monitor their own scenarios (error alerts, run history). Not the CRM's workflows | INFERENCE, not read |
| Catalogue (what the platform allows) | Search, definition, step logs, log counts, create, validate, update, publish, delete for workflows. Campaign lists (classic, email, bulk, workflow) and per campaign totals (`emails/stats.readonly`). No per-person delivery list, no campaign write | VERIFIED (describe_operation) |

## Gaps (what nobody visibly does)

1. Continuous, cross-account "which automation is failing or never ran" with alerts. Consultants do it by hand for money.
2. Campaigns that look sent but did not arrive, with a plain reason.
3. A change history that notices edits made in the CRM between two looks.
4. Safe bulk rename and publish with a preview and an undo.
5. Proof for the client: what was caught, what was fixed, trend.

## What we copy

- The audit checklist idea (drafts, dead triggers, idle workflows) from audit services, as a rule list that runs every day instead of once.
- Snapshot stores: later, as PROPOSAL 1 (template library).
- AgencyAnalytics: a clean client report page, printable. We have the print report and the weekly Proof.

## What we beat them on

- Always on, every account, alert first (in app, email), with quiet hours and per account limits through the existing alert engine.
- Honest numbers: estimates labelled, "Not available from the platform yet" where the platform gives nothing, never a guessed zero.
- Stay in SubSync: detail, errors in plain words, one tap fixes with preview, confirm and undo; the CRM link is the second choice.
- Working queue (done, snooze, owner) and notes, which audit tools do not have.
- Minimal, optional permissions and no message sending.

## Changes this made to the build

- Proof tab (weekly, printable) and a daily health alert: moved to the front of the build.
- Detail panel that reads the definition and recent errors inside SubSync.
- Campaign delivery tab built on totals only, with the contact level drill marked unavailable.
