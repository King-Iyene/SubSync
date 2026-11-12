# SubSync pain-point research, modules 7 to 13 (12 Nov 2026)

## Method and honesty notes
- Search tool could NOT access reddit.com (blocked). No Reddit threads, Facebook groups or Discord were read. No YouTube comments read. So "frequency" below is judged from GHL's own ideas board (vote counts), vendor/agency blogs, G2/Capterra summaries and workaround templates. Treat all frequency as thin.
- Ideas-board vote counts are the strongest primary evidence found (VERIFIED by fetching the pages). Blogs from firms selling cleanup/fix services are biased (labelled).
- Pricing evidence for "would they pay" is INFERENCE from what agencies already pay for workarounds (Fiverr fixers, Kixie, AgencyAnalytics at about $12-15 per client). No direct willingness-to-pay quotes found.
- Labels: VERIFIED = page read. INFERENCE = my reasoning. CHECK = confirm before building.
- Cross-cutting: Reddit/FB/Discord interviews by King (5 agency owners per brief section 1A) are still needed; this report cannot replace them.

---

## 7. ACCOUNT AUDIT (instant audit, install-day pack)
**Pain level: MED. Will pay: MAYBE (as a hook, not as a standalone paid feature).**

Top pain points
1. Cloned templates leak the wrong settings into a new client account (phone numbers, calendars, business hours, shared sending domain). Source: agency onboarding guides, e.g. https://supplygem.com/gohighlevel-client-onboarding-checklist/ and https://hmx-zone.vercel.app/blog/gohighlevel-sub-accounts-manage-13-clients (INFERENCE on frequency; practitioner blogs).
2. Onboarding is long and manual; guides quote 30-45 minutes per client plus a final "is everything captured and working" pass, nothing automates the check. https://oneexpand.com/gohighlevel-client-onboarding-checklist/ (VERIFIED existence of checklists; no tool found that verifies them).
3. Per-account problems stay invisible until the client complains: errors are per sub-account, no agency-wide view (see section 12 evidence). https://ideas.gohighlevel.com/automations/p/api-access-to-workflow-execution-logs-audit-logs-and-error-events-james-hurst
4. Reviewers say GHL is "wide not deep", steep learning curve (140 learning-curve mentions on G2 per a third-party count; unverified count). https://www.g2.com/products/HighLevel/reviews
5. No "dollars at risk" view: native stale-deal trigger only measures days since last update, so no money summary (https://growthable.io/gohighlevel-tutorials/triggers/how-the-duration-in-days-filter-works-for-gohighlevel/).

Frequency: onboarding checklists are everywhere (VERIFIED many results); audit-specific demand is INFERENCE.
What they do today: manual checklists, snapshots, a paid fixer (Fiverr "debug workflows" gigs https://fiverr.com/matteo_673/debug-and-fix-broken-gohighlevel-workflows).
Would pay: as a lead magnet agencies would run on prospects/new clients. Directly paying: INFERENCE only, small.
Competitors: All The Apps (onboarding portal, snapshots), AgencyAnalytics (reporting, not audit). Fail: none audit outcomes (unanswered leads, dollars at risk) per brief research. CHECK marketplace before claiming.
SubSync features that map: Instant Audit (problems + dollars at risk), unanswered leads count, unmarked appointments, shareable summary.
No evidence of pain (demote): a generic "setup score" of settings (agencies already have checklists); PDF-style audit report polish.
3 missing features that would sell
1. Prospect audit: agency runs audit on a prospect's connected account and gets a branded "you are losing $X" one-pager (sales tool, money first).
2. Install-day audit pack that auto-flags template leaks (shared number/calendar/hours duplicated across accounts), one list per agency.
3. "Before vs after" audit re-run monthly showing fixed vs new problems (feeds Receipts).

---

## 8. CLEAN-UP (duplicates, bad data, owner, phone, intake)
**Pain level: MED. Will pay: NO as a standalone (native tool exists); MAYBE bundled.**

Top pain points
1. Duplicate contacts double-send emails and texts, raising cost. Idea "Duplicates" (bulk detection): https://ideas.gohighlevel.com/bulk-actions/p/duplicates (VERIFIED existence).
2. Cross-channel duplicates (Instagram DM contact vs email contact) not detected. https://ideas.gohighlevel.com/contacts/p/auto-merge-or-duplicate-detection-for-contacts-across-channels-eg-instagram-emai (apparently unresolved).
3. Native merge is capped (about 2-10 per merge) and can overwrite data; merge safety articles from cleanup consultancies (biased): https://4spotconsulting.com/?p=35528 and https://consultevo.com/gohighlevel-manage-duplicate-contacts/
4. Duplicates come from intake: Zapier, Facebook forms, native forms, inconsistent phone/name format. https://socinova.com/discussions/duplicated-leads-gohighlevel-pipeline/ (also duplicate opportunities in pipeline).
5. Manual cleanup "becomes a full-time job" as DB grows (consultancy claim, biased).

Frequency: duplicates are the most-written-about topic in this module (many results), but GHL now ships a Find Duplicates / Manage Duplicates tool and a "Potential Duplicate" bulk filter plus an auto-merge workflow action (https://ideas.gohighlevel.com/changelog/duplicate-management-merge-tool, help article Feb 2026). VERIFIED shipped. This weakens the paid case.
What they do today: native merge, workflow auto-merge action, paid cleanup services.
Would pay: unlikely alone; INFERENCE. Cross-account scoreboard might be sellable.
Competitors: GHL native (covers per-account), CRM cleanup agencies. Fail: no cross-account view, no safe preview with protection of DND/payments/open deals.
SubSync mapping: duplicate grouping, merge preview with protections, no-owner/no-phone counts, data quality score.
Demote candidates (no evidence of pain beyond what native does): standalone data quality score, bulk delete. Keep DEFER per brief section 8.
3 missing features
1. Intake leak finder: shows which source (form, Zapier, FB) creates the duplicates in each account so the cause is fixed (agencies fix cause, not symptom).
2. Cross-channel duplicate matcher (IG handle + email + phone) with safe merge preview (the unresolved ask above).
3. Agency-wide "dirty accounts" ranking (duplicates %, no phone %, no owner %) usable as a paid cleanup upsell for agencies.

---

## 9. TEAM (setters, closers, who has gone quiet, payouts)
**Pain level: HIGH for appointment-driven agencies (INFERENCE), evidence MED. Will pay: YES/MAYBE.**

Top pain points
1. No per-rep call report side by side (connected calls, conversations, talk time). Idea board "Team Call Report Comparison": https://ideas.gohighlevel.com/reporting/p/team-call-report-comparison-in-crm-agent-reporting (VERIFIED exists; votes not fetched).
2. No dashboard of live sales/calls per rep: https://ideas.gohighlevel.com/reporting/p/dashboard-stats-for-each-team-member
3. No chronological agent/user activity log: https://ideas.gohighlevel.com/reporting/p/agent-user-activity-log-reports
4. Response/resolution time per agent missing in conversation reporting: https://ideas.gohighlevel.com/conversations/p/native-conversation-reporting-across-all-channels-sms-email-live-chat
5. Native reporting is attribution-shaped, user management "flat" (Kixie vendor claim, biased): https://www.kixie.com/sales-blog/how-to-get-advanced-sales-reports-in-gohighlevel/ ; agent reporting limited to a higher plan per a third-party summary.

Frequency: four separate ideas-board requests = clear, repeated (VERIFIED); counts not fetched.
What they do today: Kixie / dialer outcomes ($ unknown), AgencyAnalytics, spreadsheets, required call-outcome dropdown.
Would pay: INFERENCE yes for setter-team agencies; Kixie-type tools exist so we must stay read-only and cross-account.
Competitors: Kixie, Aloware, AgencyAnalytics. Fail: dialer-bound (only calls they make), single account, not outcome based.
SubSync mapping: setter/closer leaderboard, idle/gone-quiet detection, response time per user.
Demote: payouts/commission calculation (no evidence found in this pass; CHECK before building), badges/TV mode (already DEFER).
3 missing features
1. "Gone quiet" alert: a user with leads assigned but zero touches today (manager push alert), cross-account.
2. Per-setter speed-to-lead and outcome rate from CRM data regardless of dialer (no dialer needed).
3. Weekly setter scorecard email to the agency owner and to each client admin, shareable as proof.

---

## 10. PIPELINE AND DEALS (stale, quiet, dwell time, forecast)
**Pain level: HIGH. Will pay: YES (strongest evidence of unmet need).**

Top pain points
1. No historical stage reporting; dashboard only shows opportunities currently in a stage. Idea "Add Historical Stage Reporting" merged into a 13-vote post, with 2026 comments pushing for priority: https://ideas.gohighlevel.com/dashboard/p/add-historical-stage-reporting (VERIFIED). Requester says funnel metrics miscount deals that skip stages.
2. No time-in-stage or deal health score; only manual tracking via automation timestamps. https://ideas.gohighlevel.com/opportunities/p/opportunity-health-score (10 votes, VERIFIED).
3. Native stale trigger measures days since last update, not time in stage, so an edited deal looks fresh. https://growthable.io/gohighlevel-tutorials/triggers/how-the-duration-in-days-filter-works-for-gohighlevel/
4. People build their own stuck-deal alerts with n8n templates: https://n8n.io/workflows/9143-analyze-pipeline-velocity-and-alert-stuck-deals-with-gohighlevel-gmail-and-slack/
5. Pipelines full of junk deals ($0, no owner), monthly cleanup workflows: https://consultevo.com/gohighlevel-pipeline-cleanup-system/ (biased).

Frequency: repeated across ideas board + templates. VERIFIED.
What they do today: workflows with timestamps, spreadsheets, n8n.
Would pay: INFERENCE yes; ties directly to our event store (history cannot be rebuilt, GHL does not provide it). Best moat fit.
Competitors: HubSpot/Dynamics do dwell time natively; GHL doesn't; third-party GHL reporting tools show current state.
SubSync mapping: stage dwell time, deal velocity (event store), stale per stage, deals gone quiet.
Demote: forecast (no pain evidence found; sample-size honesty rules apply; keep Wave 3).
3 missing features
1. "Stuck in stage" list with money, using our recorded stage history (start recording now).
2. Historical stage funnel (everyone who ever entered stage X in month Y), the exact ask above.
3. Owner/supervisor nudge when a deal has had no real touch (conversation, not field edit) for N days.

---

## 11. MEETING NOTES (Fathom/Zoom/Meet to contact note by email)
**Pain level: MED-HIGH (strong votes). Will pay: MAYBE (small add-on); crowded by Zapier/Fireflies.**

Top pain points
1. Fathom not integrated: 48 votes, a GHL staff reply said they would add it natively. https://ideas.gohighlevel.com/ad-reporting-and-attribution/p/please-fully-integrate-fathomvideo-to-ghl (VERIFIED). A third-party dev sells a custom build.
2. Zoom AI summaries not synced to the participant's contact: 14 votes, still open. https://ideas.gohighlevel.com/integrations/p/sync-zoom-docs-meeting-summaries-to-contact-notes (VERIFIED).
3. Wanted: summary emailed to attendees, notes attached to attending contacts (same post comments).
4. Email/phone matching breaks silently when contact details differ; guide warns of this (INFERENCE-level, third-party guide).
5. Existing workarounds are Zapier templates (Fathom to contact notes) and Fireflies native GHL sync: https://zapier.com/templates/details/3ce4ee3d35c5f4f3cca1162d29f219ea08a9818c41848f62bb226d2f18fa3010 and https://fireflies.ai/integrations/crm/gohighlevel

Frequency: 62 combined votes, MED. Risk: GHL says it will build Fathom natively (platform risk); Fireflies already does it.
What they do today: Zapier (cost per task), Fireflies, copy/paste.
Would pay: INFERENCE low-to-moderate ($ small); value is in correct matching + not placing wrongly.
Competitors: Fireflies, Zapier templates. Fail: mismatches create new contacts or drop; no per-user ownership; no unmatched inbox.
SubSync mapping: email-match note, notify the person, private unmatched inbox (principle 13 already).
Demote: nothing in this module lacks evidence, but long-term moat is weak; keep light.
3 missing features
1. Unmatched-meetings inbox with one-tap "attach to contact" (the matching-failure fix).
2. Action items from the meeting become internal tasks, preview and confirm.
3. "Meeting happened but no follow-up/stage change" alert (links meetings to pipeline hygiene).

---

## 12. WORKFLOWS (health, failed/paused, inventory, silent failures)
**Pain level: HIGH. Will pay: YES/MAYBE, but API access is the blocker (CHECK).**

Top pain points
1. No API for workflow execution logs, audit logs or error events; agencies cannot monitor many sub-accounts; one user built an external poller; ask for a `workflow.action.failed` webhook. https://ideas.gohighlevel.com/automations/p/api-access-to-workflow-execution-logs-audit-logs-and-error-events-james-hurst (6 votes, VERIFIED). Audit log retention 60 days in UI.
2. Native error notifications cover only action-level failures, in-app only; a workflow that never enrolls or stops early gives no alert. https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000003065-error-notifications-in-workflows and https://consultevo.com/gohighlevel-workflow-error-alerts/
3. Silent failures outside GHL: Zapier/custom field renamed, disconnected integration, webhook 200 but nothing happens. https://www.freelancer.mx/community/articles/why-your-gohighlevel-automations-break-when-connected-with-zapier-and-how-to-fix-them
4. Draft status and enrollment rules silently block contacts. https://www.ghlscaleup.com/blog/gohighlevel-workflow-triggered-not-working
5. People pay freelancers to debug broken workflows (Fiverr gigs) https://fiverr.com/mibel_l/fix-gohighlevel-workflow-automation-not-working-errors

Frequency: high in blogs/gigs; per-account Overview/Workflow Maps shipped (LABS) but per account only: https://ideas.gohighlevel.com/changelog/workflow-maps-find-and-troubleshoot-workflow-errors
What they do today: check execution history per account, Fiverr fixes, n8n pollers.
Would pay: INFERENCE yes; this is the same "smoke detector" value. But our brief says the Workflows API has limited availability, so outcome-based detection (leads got no message) is the honest route.
Competitors: none found cross-account. GHL covers per account only.
SubSync mapping: outcome-based "silent failure" alerts (new leads with no outbound), inventory if API allows (CHECK).
Demote: workflow inventory / template sync (already DEFER, no pain evidence beyond the ask above).
3 missing features
1. "Automation probably broken" alert inferred from outcomes: appointments booked but no reminder sent; form submit with no reply (no Workflows API needed).
2. Cross-account paused/draft workflow list if scope allows (CHECK).
3. Integration-disconnected detector (Zapier/webhook silence: leads stopped arriving versus normal volume, anomaly vs own history).

---

## 13. SETTINGS, GETTING STARTED, WHAT'S NEW (onboarding, Slack/email, scopes, daily brief)
**Pain level: MED. Will pay: NO directly; it is delivery, not product. Daily brief is the pull mechanism.**

Top pain points
1. No native daily cross-account digest; people build n8n/Zapier daily briefs per account. https://n8n.io/workflows/21040-send-daily-executive-briefings-from-mondaycom-gohighlevel-pandadoc-with-gemini/ and https://n8n.io/workflows/9463-generate-ai-powered-end-of-day-reports-from-clickup-and-gohighlevel-to-multi-channel/ (VERIFIED templates exist; they work on one account).
2. Native summaries are narrow (task summaries via SMS/email requested: https://ideas.gohighlevel.com/crm/p/task-notifications-and-daily-summary-reminders); Slack exists only as a workflow action, not digest.
3. Permission transparency: OAuth consent screen now shows every requested scope, sensitive scopes flagged. https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000005002-api-security-oauth-consent-for-marketplace-apps (VERIFIED). Few scopes helps trust. Scope changes forcing reinstall: no agency complaints found (CHECK).
4. Apps break into "Action required / Reconnect" after security changes. https://consultevo.com/gohighlevel-reconnect-broken-marketplace-apps/ (third-party).
5. Onboarding complaints about GHL itself: wants step-by-step guides; learning curve is top complaint on G2. https://www.g2.com/products/HighLevel/reviews

Frequency: LOW-MED; thin evidence on notification pain specifically. I did not find stated complaints about notification volume.
What they do today: n8n/Zapier digests, email per workflow.
Would pay: not for itself; the brief makes it the delivery channel for alerts. INFERENCE.
Competitors: AgencyAnalytics scheduled reports (client reporting, metric-change alerts), Kixie real-time dashboards.
SubSync mapping: daily brief email/Slack, quiet hours, scope honesty, getting started.
Demote: What's New/roadmap voting as a feature (no pain evidence; cheap, keep minimal), elaborate settings screens.
3 missing features
1. Morning brief per agency: 5 lines, "3 clients at risk, 14 leads unanswered, $X stale" with deep links (the pull habit).
2. Per-person brief for setters (their own queue only) by email/WhatsApp.
3. "Reconnect needed" auto-notice that names exactly what stopped syncing and why (principle 6).

---

## Summary table
| Module | Pain | Pay |
|---|---|---|
| 7 Audit | med | maybe (hook) |
| 8 Clean-up | med | no alone |
| 9 Team | high (inferred) | yes/maybe |
| 10 Pipeline and deals | high | yes |
| 11 Meeting notes | med-high | maybe |
| 12 Workflows | high | yes/maybe (API-limited) |
| 13 Settings/brief | med | no directly, delivery |

## Top build recommendations (money first)
1. Pipeline history and stuck-deal money list from our event store (strongest verified gap, only we can record it; 13 and 10 vote asks).
2. Outcome-based "automation probably broken" alerts across accounts, with the daily brief as delivery (workflow API gap verified, no cross-account competitor found).
3. Cross-account setter/closer scorecard and "gone quiet" alerts independent of dialer (four separate idea-board requests), with the prospect audit one-pager as the sales hook.

Demote overall: standalone clean-up and meeting-notes (GHL native duplicate tool shipped; GHL said it will build Fathom natively), forecast, payouts, workflow inventory.

---

# What SubSync already has vs the evidence
Source: docs/FEATURE_STATUS.md, docs/REGRESSION_AUDIT.md notes, SCREEN_CHECKLIST.md rows, file names in src/app/app/views, and keyword counts in src (dwell 21 files, stage history 12, leaderboard 15, gone quiet 61, merge 76, unmatched 11, Fathom 65). Presence is read from docs and code names, NOT re-tested in a browser. COVERED = evidence + we have it. GAP = evidence, we lack it or it is unverified/off. SURPLUS = we have it, no evidence found.

## 7 Account audit
| Existing feature | Verdict |
|---|---|
| Instant Audit page, copy summary, money from same numbers | COVERED (but not yet run on real agency; appointment findings need calendar permission) |
| Public share link, 14-day expiry, sample real-estate audit, fix plan | COVERED (sales hook; matches prospect-audit idea) |
| Setup checklist and email sender health | COVERED (template-leak pain) |
| Run automatically at install | GAP (listed "still to do") |
| Prospect audit one-pager on a not-yet-installed account | GAP |
| Template-leak detector (shared number/calendar/hours across accounts) | GAP |
| Audit history / re-run before vs after (audit-history.tsx exists) | COVERED if live; verify |
| Industry playbooks, compare setups | SURPLUS (no evidence found, already Defer) |

## 8 Clean-up
| Existing feature | Verdict |
|---|---|
| Duplicates (grouped, paginated) | COVERED for pain, but native GHL now ships Find/Manage Duplicates, so weak moat |
| Data health: score, history, league table, quality firewall by source, imports view, safe phone fixes | COVERED (intake-source pain) and partly beyond native; best part is the source firewall |
| Data cleanup with typed confirmation | SURPLUS-ish: no evidence beyond native; never run live, needs write scope |
| Cross-channel duplicate matcher (IG + email + phone) | GAP (unresolved ask) |
| Cross-account "dirty accounts" ranking | COVERED if the league table is cross-account (verify) |
| Standalone quality score | SURPLUS (no pain evidence alone) |

## 9 Team
| Existing feature | Verdict |
|---|---|
| People/Team screens, setter queues, speed-to-lead per user | COVERED in code; Team was flagged off, now on for testing; names need users permission (not approved on real agency) |
| Leaderboard (15 files mention) | COVERED for evidence (4 idea requests) but unverified live |
| Gone-quiet / idle detection | COVERED in code (many files); verify it alerts managers |
| Dialer-independent per-setter response and outcome rate | GAP or partial (needs messages permission) |
| Weekly setter scorecard email | GAP (digest email not built, no email key when notes were written; later notes say keys present) |
| Payouts/commissions (16 files mention) | SURPLUS (no evidence) |
| Badges/TV mode | SURPLUS (Defer) |

## 10 Pipeline and deals
| Existing feature | Verdict |
|---|---|
| Stale deals, per-stage stale rules, owner stage classification | COVERED (native only counts days since last update) |
| Stage history / dwell time from event store (12 and 21 files) | COVERED in code, moat; real history only accrues from recording start, so depth is thin |
| Historical stage funnel (everyone who ever entered stage X in month Y) | GAP (exact ask, 13+10 votes) |
| Forecast as a range with 20-closed-deal minimum | SURPLUS for now (no pain evidence; no real account qualifies) |
| Deal health / quiet-deal nudge to owner and supervisor | GAP |
| Stuck-in-stage money list | COVERED if pipeline-board exposes it; verify |

## 11 Meeting notes
| Existing feature | Verdict |
|---|---|
| Fathom connection (own, per user), note on email match, Added today with Undo, unmatched private inbox, destinations (note/comment/field) | COVERED (62 combined votes) but not verified live: Fathom, Zoom provider apps not created, real send never observed |
| Zoom and Google Meet | COVERED in demand (Zoom ask 14 votes), UNVERIFIED live; Meet has no evidence found = SURPLUS |
| Notify the person | COVERED (design); verify |
| Action items to tasks (preview and confirm) | GAP |
| "Meeting happened, no follow-up" alert | GAP |
| Risk: GHL staff said native Fathom is coming | platform risk |

## 12 Workflows
| Existing feature | Verdict |
|---|---|
| Workflows list across accounts, health checks and alerts, tidy-up, turned-off prompts | COVERED (verified gap: no cross-account view) but depends on Workflows API access; real-data status unknown (CHECK) |
| Proof page and weekly Proof email | COVERED for agency-proof need (INFERENCE) |
| Outcome-based "automation probably broken" alerts without Workflows API | GAP or partial (silent/probably-broken keywords in 20 files; verify rules exist) |
| Integration-disconnected / lead-volume drop detector | GAP |
| Command palette, saved views | SURPLUS (no evidence) |
| Workflow template sync / inventory | SURPLUS (Defer) |

## 13 Settings, Getting started, What's new, brief
| Existing feature | Verdict |
|---|---|
| Daily brief to Slack, quiet hours, alert emails with stop link | COVERED (n8n DIY evidence) |
| Weekly and per-person email brief | GAP/partial (first real send not observed) |
| Scope honesty, "needs permission: reconnect" wording | COVERED |
| Sync status, freshness line, reconnect notices | COVERED (supports trust; reconnect pain is thin evidence) |
| Getting started guide, What's new, roadmap with voting | SURPLUS-ish (no pain evidence; cheap trust items) |
| Settings with eight sections | SURPLUS risk: complexity is the top GHL complaint, simplify |

## Net read
We already build most of what the evidence asks for. The real gaps are not code but verification on live data (calendar, messages, users permissions; Fathom/Zoom apps; first real emails), plus three specific missing pieces: historical stage funnel, cross-account outcome-based "probably broken" alerts, and prospect audit at install/pre-install.
