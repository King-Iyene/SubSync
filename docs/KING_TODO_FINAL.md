# King: everything only you can do, in order (one page)

Written 13 Nov 2026. Do the steps top to bottom. Each says what to do, what to expect, and what to send me back. Nothing here is optional unless it says so.

## A. Release 1.1.0 (new permissions, workflow creation)  ~15 min
1. Developer portal > My Apps > SubSync > Versions > **Clone as Draft**.
2. Advanced Settings > Auth > Scopes. Clear the old 166 permissions. Tick the 39 listed in `docs/RELEASE_1_1_0.md` (7 required, the rest Optional). Tick only the workflow scopes the picker actually shows (`workflows.readonly`, `workflows.write`, and `workflows.publish`, `workflows.delete` if listed). If `publish` or `delete` is missing, tell me: I remove it from the code (an unlisted scope can break the install).
3. Release notes: paste the text in `docs/RELEASE_1_1_0.md` section 2. Choose **Major** (new permissions). Publish. A private app goes live at once.
4. Do NOT change prices or plans in this release.

## B. Get the new permissions into KD Squares Test  ~5 min
1. Open KD Squares Test > the app list. Press **Update** on SubSync and allow the new permissions. This keeps your install and your **Free Plan**.
2. Only if there is no Update button: uninstall and reinstall, and on the plan screen choose the **Free Plan** (not Pro, not the trial: the trial can be used once per 90 days and then charges the card).
3. In SubSync: Settings > Permissions should now show far fewer "needs permission". Money, Workflows and Clients plan tiles fill with data.

## C. Test automatic workflow creation  ~5 min
1. Run (replace the id with KD Squares Test's location id, `ojRd5O4FHowafUkAMZxn`):
   `node --env-file=.env.local --import tsx scripts/probe-workflows.ts --location ojRd5O4FHowafUkAMZxn`
2. Then again with `--create` (needs `WRITE_GHL_LIVE=true` in `.env.local`; it only makes and deletes a draft called "SubSync probe").
3. Paste both outputs to me.
4. If it says the Workflows API is not enabled: send `docs/WORKFLOWS_API_SUPPORT_MESSAGE.md` to HighLevel developer support (fill in the app id and location id). Until they enable it, every account uses the 2-minute guided setup card. Your hand-built "Call queue (tag)" workflow in KD Squares Test keeps working either way.
5. In SubSync > Speed to lead, press "Mark as set up" for KD Squares Test (it already has the workflow).

## D. Test data in KD Squares Test  ~5 min
- Already imported: 120 leads and 24 deals. Known: the deals import made a second contact per lead (named by email). Delete those extra contacts in the CRM when you tidy up, or tell me and I list them.
- In SubSync > Settings > Targets > Deal rules, turn on **Count deals that look like tests** so the $40,700 shows.

## E. Before any outside agency installs (the pre-pilot gate)
1. Pricing tab > Add Plan: **Pro, monthly, $11.50 per client account, 14-day free trial**, honest feature lines (see `docs/RELEASE_1_1_0.md` section 6). Free Plan feature lines: Instant Audit, overview, search.
2. Delete the $5 plan ONLY when no install sits on it (your tests use the Free Plan).
3. Send me the new plan id. I run `scripts/set-plan.ts` and switch entitlements to enforced, then run the tenant and entitlement tests.
4. Do one real paid install on the final plan.
5. Move to a bigger database plan (Supabase Pro) before a large agency installs (about 715 MB per 1M contacts; the current plan is 500 MB).
6. Have a person review the privacy policy and terms.
7. Turn test flags off (`scripts/set-flags.ts off ...`; ask me for the list).

## F. Slack and email (optional, after testing)
- Slack: bot app and redirect are in `docs/KING_SETUP_GUIDE.md` section 1.
- The live switches `SEND_SLACK_LIVE`, `SEND_EMAIL_LIVE`, `FATHOM_WEBHOOK_LIVE`, `WRITE_GHL_LIVE` are OFF in production. Turn them on one at a time, KD Squares Test only, Slack to your own channel first. Tag writes from SubSync already change the CRM for real in the test account; keep that in mind.

## G. AI features and API keys (decision, not needed to go live)
- Nothing in SubSync calls an AI model today. Every number, match and route is plain tested code.
- A Claude subscription cannot power the product. For AI features you need an **Anthropic API key**: console.anthropic.com > API Keys > Create key; set a monthly spend limit first; paste it in Vercel as `ANTHROPIC_API_KEY`.
- Decide: start with job 1 only, the **7am brief writer** (small model, numbers from our own SQL, words from the model, suggest-only)? The ranked list of 14 jobs is in `docs/AI_AGENTS_PLAN.md`. Cost is passed on through usage billing later.
- Email for the daily brief: `RESEND_API_KEY` from resend.com plus a verified sending domain.

## H. Marketplace listing (after everything above)
Use `docs/LISTING_PACK.md`: keywords, title, short and long description, 1.1.0 release notes, image and video checklist, portal order of work. Logo: say yes or no to the recoloured version I sent (it is not in the repo yet).

## I. Housekeeping
- Delete the old worktree folders: run `scripts/clean-wt.ps1` (I cannot delete them).
- Close the extra browser pop-up windows before I test in the pane; sign in to the CRM there when asked.
