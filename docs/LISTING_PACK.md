# Marketplace listing pack (paste into the developer portal AFTER all builds are done)

Rules: no GoHighLevel/HighLevel/GHL name or logo in the app logo, listing images, website or screenshots (portal warning). Say "client accounts", "your CRM", "business accounts". Promise only what is live and verified (CLAUDE.md principle 5). White-label listing.

## 1. Search keywords (the Search keywords field; people search these words)
Primary (buyer intent, put first): speed to lead, lead response time, missed calls, unanswered leads, no-show recovery, show rate, appointment reminders, lead follow up, sales pipeline, stale deals.
Agency words: agency dashboard, all client accounts, multi account dashboard, client health, client retention, churn alerts, white label reporting, agency reporting, snapshot of all accounts.
Outcome words: lead alerts, sla alerts, call queue, power dialer helper, daily brief, 7am brief, revenue at risk, stuck deals, setter performance, closer performance, team performance.
Data-health words: duplicate contacts, merge duplicates, clean contacts, data quality, find lead, contact search, lead source, tags.
Rules for the field: 15 to 25 short phrases, no brand names of competitors, no misspellings, no "best/#1" claims; check the portal's character limit and drop from the bottom of each group, not the top.
Validate after publishing: search each primary keyword inside the marketplace and note where SubSync appears; swap the weakest 5 each month (record in docs/DECISIONS.md).

## 2. Listing title and short description
- Title (max about 30 chars): SubSync: Lead Response and Client Health
- Short description (one sentence): Know what is happening in every client account before your client does: unanswered leads, missed calls, no-shows and stuck deals, ranked by money, with one click to fix.
- Alternative short: The check that your clients' leads are actually being answered, in every account.

## 3. Long description (outline; keep every line true today)
1. Who it is for: agencies and appointment-driven businesses (home services, med spas, solar, real estate, coaches).
2. What it does (live): Today (what to do first, money at risk), Speed to lead (first reply time, missed calls, waiting on the client alerts), Appointments (show rate, outcomes, no-show recovery), Clients (health of every account), Pipeline (stage history, deals stuck in a step), Find a lead (search across accounts, call lists), Money (plans, failed payments when permission granted, payouts), Clean-up (duplicates, data quality, never touches Do Not Disturb), Meeting notes, Workflows health, 7am brief.
3. Trust: few permissions, changes things in your CRM and sends texts and emails only when a person presses the button, after a preview and a confirm, never to a contact who asked not to be contacted, data deleted on uninstall, clear what we store.
4. Price: free plan plus $11.50 per client account per month after the plan swap (state only after the plan exists).
5. Support: email, first reply within 24 hours.
6. AI (add this one honest line only once ai_byo is on and verified): "Optional AI wording for your 7 am brief: you connect your own AI account (OpenRouter, an API key from Anthropic, OpenAI or Google, or ChatGPT sign-in once OpenAI approves it), you set the monthly limit, and it only suggests: it never messages your leads or changes your CRM."
Do NOT mention: exports, messaging leads, any other AI feature, anything switched off (live sends, writes) until it is live.

## 4. Release notes for 1.1.0 (mandatory field)
New: Today money strip, Speed to lead "Waiting on the client" alerts, Pipeline step history and stuck deals, Call mode redesign, faster loading, calmer look, duplicates preview. New optional permissions (payments, workflows, calendars, users, tags): each unlocks one screen; nothing breaks if you skip them. Existing installs press Update and approve the optional permissions they want. The call queue workflow is created for you automatically where your CRM allows it (it only creates call tasks for your team and never messages your contacts); otherwise it is a 2-minute guided setup.

## 5. Images and video checklist (no vendor name or logo in them)
- Logo: forest-green mark (public/brand/subsync-logo.svg and PNGs, PR 87).
- 5 screenshots at the portal size: Today money strip; Speed to lead Waiting on the client; Pipeline stuck in a step; Duplicates with Show copies; Money. Use SAMPLE data and label "Sample data".
- Loom demo (required): install, setup, main flows, errors and edge cases, uninstall; show what syncs and when.
- Support page, privacy policy, terms reviewed by a human.

## 6. Order of work in the portal
Clear all scopes then tick the 30 from docs/RELEASE_1_1_0.md (Optional) > fill title, short and long description, keywords > upload logo and screenshots > release notes > Minor release > Update the test account > re-check Money, Workflows, Appointments with permissions granted.
