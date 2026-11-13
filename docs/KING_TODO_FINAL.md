# King: everything only you can do, in order (one page)

Updated 13 Nov 2026 (night). Top to bottom. Each step says what to do, what to expect, and what to send me back.
Live version in the portal is **v2.1.0**. The next release is **2.2.0** (not 1.1.0).

## A. Release 2.2.0: permissions  ~15 min
1. Developer portal > My Apps > SubSync > Versions > **Clone as Draft**.
2. Advanced Settings > Auth > Scopes. Clear the old 166. Tick the **40** listed in `docs/RELEASE_1_1_0.md` (7 required, 33 optional): the 7 required are locations.readonly, contacts.readonly, opportunities.readonly, conversations.readonly, calendars.readonly, oauth.readonly, oauth.write. Tick only the ones the picker lists; if `workflows.publish`, `workflows.delete` or `locations/customFields.write` is missing, tell me and I remove it from the code (an unlisted scope can break the install).
3. NEVER tick: `conversations/message.write`, `invoices.write`, `conversations.write` (SubSync never messages leads or deletes conversations).
4. Release notes: paste section 2 of `docs/RELEASE_1_1_0.md`. Choose **Major**. Publish. Do NOT change prices or plans in this release.

## B. Listing (portal > Profile)  ~15 min
- **Logo:** the portal shows a broken image: re-upload `public/brand/subsync-logo.png` (or your approved recolour).
- **Tagline** (type exactly, no typos): `Every lead answered. Every client account on track.`
- **Categories:** Analytics & data, CRM, Sales Enablement (fine). **Business niche (max 3):** Advertising Agency, Consultant, Real Estate.
- **Search keywords (200 characters max, add one by one):** speed to lead, lead response time, missed calls, unanswered leads, no show recovery, lead follow up, stale deals, client health, agency dashboard, duplicate contacts, power dialer, call queue, data cleaning (drop the last ones if the counter says over). Keywords only matter when the app is Public; Private is fine for the 5-agency pilot.
- Descriptions and images: `docs/LISTING_PACK.md`. Screenshots: demo mode, shot list in `docs/DEMO_SCREENSHOTS.md` (when that builder finishes).

## C. Get the new permissions into KD Squares Test  ~5 min
1. Press **Update** on SubSync in the app list of KD Squares Test and allow the new permissions. Keeps your install (it sits on the old Free Plan id, which still works).
2. Only if there is no Update button: uninstall and reinstall. New installs get the **Growth** plan with the 14-day trial (once per 90 days, then it charges the card).
3. SubSync > Settings > Permissions: far fewer "needs permission". Money, Workflows, Clients plan tiles fill in.

## D. Test automatic call-queue workflow  ~5 min
1. `node --env-file=.env.local --import tsx scripts/probe-workflows.ts --location ojRd5O4FHowafUkAMZxn`, then again with `--create` (needs `WRITE_GHL_LIVE=true` in `.env.local`). Paste both outputs to me.
2. If it says the Workflows API is not enabled: send `docs/WORKFLOWS_API_SUPPORT_MESSAGE.md` to HighLevel developer support. Until then every account uses the 2-minute guided setup card. Your hand-built workflow "Call queue (tag)" in KD Squares Test keeps working.
3. SubSync > Speed to lead: press **Mark as set up** for KD Squares Test.

## E. Workflow blocks (custom triggers and actions)  ~10 min, after the builder reports
- Page: Modules > Workflows in the portal (live version v2.1.0). You approved: I create 4 triggers and 2 actions there with the values from `docs/WORKFLOW_MODULE_PORTAL_SHEET.md`. They are off by default per account and billed per run by the CRM to the client account.

## F. Test data in KD Squares Test
- Imported already: 120 leads and 24 deals. The deals import created a second contact per lead (named by email): delete the extras or tell me.
- Deals have no owner so open money shows $0: assign owners in the CRM, or in SubSync Settings > Targets > Deal rules turn on "Count deals without an owner" and "Count deals that look like tests".

## G. AI agent: nothing to buy, decisions only
- Customers connect **their own** AI (OpenRouter one-click, or paste a key for OpenAI, Anthropic, Google). You pay nothing per use. A ChatGPT or Claude subscription cannot be used (no API).
- "Sign in with ChatGPT": apply for OpenAI partner access (checklist in `docs/AI_JOBS_SPEC.md`). Optional.
- Switch on when ready (Vercel flags, KD Squares Test first): `ai_byo`, then `ai_brief`, then each job flag. They are all OFF now. Try one real key and send me the brief it writes.
- Details: `docs/KING_TODO_AI.md`.

## H. Before any outside agency installs (pre-pilot gate)
1. DONE 13 Nov 2026 (draft): Pricing is Paid, ONE plan **Growth**, monthly, $11.50 per client account, 14-day free trial, id `6af521842a5c6a72fd97d767`. No free plan. Old Free Plan and $5 plan are deleted from the draft; your own installs on the old Free Plan id keep full access (mapped as legacy in code).
2. Publish the draft (release 1.1.0) so the Growth plan goes live.
3. Growth is already mapped in code and in migration `20261231290000_growth_plan.sql` (applied through the normal GitHub apply). Then switch `ENTITLEMENTS_MODE` to enforced yourself when ready, and I run the tenant and entitlement tests.
4. One real paid install on the final plan.
5. Bigger database plan (Supabase Pro) before a large agency installs (about 715 MB per 1M contacts; current plan 500 MB).
6. A person reviews the privacy policy and terms.
7. Turn test flags off (`scripts/set-flags.ts off ...`; ask me for the list).

## I. Slack and email (optional, after testing)
- Slack: `docs/KING_SETUP_GUIDE.md` section 1. Live switches `SEND_SLACK_LIVE`, `SEND_EMAIL_LIVE`, `FATHOM_WEBHOOK_LIVE`, `WRITE_GHL_LIVE`, `WORKFLOWS_WRITE_LIVE` are OFF in production: turn on one at a time, KD Squares Test only. Note: tag changes from SubSync already write to the CRM in the test account.

## J. Housekeeping
- Run `scripts/clean-wt.ps1` to delete old worktree folders (I cannot delete them).
- Keep the Claude window in front and the browser pane full size while I test; sign in to the CRM in the pane when asked.
- Website headline still says "before your client does": I change it once you confirm the tagline.
