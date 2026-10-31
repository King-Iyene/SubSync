# Morning report (31 Oct 2026)

Read this first. Everything below is pushed to `main` and live unless it says otherwise.

## Built and live since you last looked

- Per-account client access switches (Settings).
- Weekly Monday email and new-alert emails. Resend keys are in Vercel. **Nothing sends until you type an address in Settings.**
- Team: first-reply time, show rate, last reply and idle flag per person.
- Meeting notes (Zoom, Fathom) also write into the matched contact's notes in the CRM, once per meeting. Switch in Settings.
- Zoom: app created (SubSync), keys in Vercel, Connect Zoom button live. Zoom app is in development mode.
- Sync: small jobs first, 4 minutes of work per cron run.
- Home page: outcome message, slow-reply cost calculator, profit calculator.
- Shareable audit link (Account audit, Share link button). Names scrubbed, 30-day expiry.
- Speed to lead by source (portal 5 min, form 15, social 60) and a count of waiting leads with no owner.
- Roadmap and change log with voting.
- Dark shell, agency name and colour shown in place of SubSync.
- **Fresh data every 15 minutes** for conversations, appointments and reply times (was once a day). Confirmed live: jobs queued and finished within seconds. Speed alerts are no longer hours late.
- **Speed to lead splits "waiting right now" from "never answered"** (older than 3 days), so old leads no longer make the screen look broken.
- **Shareable audit link tested live end to end:** the public page showed totals and finding titles only, no account names.
- Home page "trust" line and the in-app help answer now say honestly that SubSync writes a meeting note into a contact.

## Needs you (blocked on a login, a decision or a click)

1. **Type your email in Settings, Weekly email,** so alerts and the Monday email can reach you. Tell me if one arrives.
2. **Press Connect Zoom** once to test the real sign-in. A real summary needs a paid Zoom host.
3. **Slack and Fathom apps** (steps in docs/CONNECTIONS_SETUP.md). Skipped as agreed.
4. **Public demo:** needs your yes, because it turns on sample data in production.
5. **Privacy policy and terms:** they do not yet say that SubSync writes a meeting note into a contact. A human must update and review them before Public.
6. **Pricing plan swap ($9), enforced mode, Version 3 in the portal:** your steps, after testing. Free and Pro both get every feature now.
7. **Real estate review:** docs/REAL_ESTATE.md has questions only you can answer.

## Not built, and why

- **Call recordings into the contact:** the real call message shape is unknown. A log of field names (no content) was added; look for "probe: call message fields" in the production logs after the next call appears, then build.
- **Usage and margin guard:** the API may not expose per-account usage. Not yet checked.
- **Live counters and alert feed on the home page:** with two installs the numbers would look empty.
- **Leaderboard "dropped lead" list, outcome pages for search:** next.

## Known issues and honest notes

- 9 of your 10 timed leads are still waiting because they are old test contacts, so Speed to lead looks bad. A "mark as test lead" control would fix the picture.
- The Zoom client secret and secret token passed through my screen reads during setup. I did not repeat them. If you want to be safe, regenerate both in Zoom and update the Vercel values.
- Two installs exist for KD Squares LTD (one agency, one business); the business one lacks calendar events and users permissions. Harmless to the agency view.
- **Two pushes failed to build tonight** (the shared audit page used a setting this project does not allow). The live site stayed on the last good version the whole time. Fixed and confirmed live. New rule saved: run `npx next build` before every push.
- Checks: unit tests 281 pass. The full automated suite passed (tenant isolation with 384 cross-reads, feature switches, Overview numbers, audit, speed to lead, roadmap, plus all earlier modules). Live deploy check passes.
