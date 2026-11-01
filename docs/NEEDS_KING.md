# Needs King (things I skipped on purpose; everything else is done or logged)

Each item: (a) what it is, (b) why it was skipped, (c) the exact click or command, (d) the risk if it is not done. Maintained during the overnight run (branch `overnight/2026-11-01`). Nothing here has been done.

## 1. Slack: fix the redirect address so a live Slack connect can work
- (a) The Slack app "SubSync" refuses the return address the code uses.
- (b) It is a change to the Slack app registration, which only King may touch.
- (c) api.slack.com/apps, SubSync, **OAuth & Permissions**, **Redirect URLs**: add exactly `https://subsync.kdsquares.com/api/integrations/slack/callback`, press **Add**, then press the separate **Save URLs** button. In Basic Information check the Client ID is `4475622980481.12455703070615`.
- (d) Without it "Connect Slack" fails with "redirect_uri did not match" (S-REDIRECT) and F9's Slack flow cannot be tested live.

## 2. Zoom (optional, Zoom stays hidden): add the scope that identifies the user
- (a) Zoom scope `user:read:user`.
- (b) Zoom app registration is King's.
- (c) marketplace.zoom.us, the SubSync app, **Scopes**, add **View a user** (`user:read:user`), save. Anyone who connected before must reconnect.
- (d) Only matters when Zoom is turned on (stage E1, not tonight).

## 3. Fathom: keep unmatched meetings from being saved anywhere
- (a) In the existing Fathom connection, leave "If nobody in a meeting is a known contact" on "Do not save it".
- (b) It is King's own connection settings.
- (c) Do nothing new if it already says that; tonight's S0.2b removes the option from the app.
- (d) Low: the option is removed in code.

## 4. Pre-pilot pricing gate (before ANY outside agency installs)
- (a) Add the $9 Pro plan, delete the $5 plan, map the new plan id in `plan_entitlements`, switch `ENTITLEMENTS_MODE` to `enforced`.
- (b) Plans, prices and the marketplace are critical and King's.
- (c) See `docs/RUNBOOK.md` section 3 and `CLAUDE.md` section 6. Tell me the new plan id and I will map it and run the entitlement and tenancy tests.
- (d) Outside installs would land on the temporary $5 plan.

## 5. Release 2.2.0 (marketplace version): scopes and listing
- (a) One new version bundling the optional read scopes, the optional permissions to add notes to contacts and internal comments to conversations (and custom field definitions), corrected listing copy and the pricing change. The exact scope list tonight's stages need is collected in section 12 below.
- (b) Marketplace version, scope and listing changes are critical. The portal limits an app to 5 versions.
- (c) Portal: My Apps, SubSync, Versions, **Clone as Draft** on 2.1.0, Scopes, Pricing, Publish as Minor (steps in `docs/features/Z2.md` and `docs/ROADMAP_V2.md` section 6).
- (d) Until done, features that need the new permissions show "Needs permission: reconnect".

## 6. Real-world checks that need King (not done tonight)
- Run `scripts/check-email-setup.ts` (read only) and, only with King's say-so, `scripts/send-test-emails.ts` to an address King owns.
- Data-deletion test for real on the KD Squares Test account (install, sync, Delete my data, sync, uninstall).
- Data cleanup real write and undo on the KD Squares Test account (ZZ-TEST contacts).
- Support inbox test: send a message from another address to code@kdsquares.com and note the reply time.
- Reason skipped: they send mail, write to a real account or need King's inbox.

## 7. Human review of the privacy page and terms
- (a) `/privacy` and `/terms` are honest drafts, not legal advice.
- (b) Needs a person.
- (c) Send both pages to a reviewer before going Public.
- (d) The app stores other businesses' customer data.

## 8. Setter and closer definition (decision, stage T1 never starts tonight)
- (a) Who counts as a setter and who as a closer (N27). Proposed default: setter = the user who booked the appointment (else the lead owner at booking), closer = the appointment's assigned user.
- (b) King decides.
- (c) Reply "use the default" or give the rule.
- (d) T1 cannot start.

## 9. Style approval (D0)
- (a) The /design style guide tokens and directions (KD Squares palette) are built and marked "style awaiting King's approval".
- (b) Needs King's eyes.
- (c) Open `/design` in the app after the merge and say "approved" or what to change.
- (d) D1 polish builds on it.

## 10. Merge of the overnight branch and any held migrations
- (a) All work is on branch `overnight/2026-11-01`. Nothing is on `main`.
- (b) I never merge or push to main.
- (c) Type: "Merge stages up to <ID> into main" (the list of stage tags is in the morning report). I run the merge, the full tests and the push.
- (d) Production keeps running the previous code until then.

## 11. Held migrations (written, NOT applied)
Filled in as they are created (none yet).

## 12. Scopes the overnight stages need for release 2.2.0
Filled in as stages are built (none yet).
