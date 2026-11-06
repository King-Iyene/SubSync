# Call mode (stage DIAL, branch `stage/dial`): a power dialer without telephony

**Where:** Speed to lead, tab "Call mode" (src/app/app/views/dial-mode.tsx). Pure rules in src/lib/dial/dial.ts, endpoints in src/lib/api/dial-routes.ts (`/api/app/dial/*`).

**Why no telephony:** the CRM API has no endpoint that places a call or starts its power dialer (docs/features/MOAT.md, "Calling"). So the customer's calls run through THEIR OWN CRM phone (own provider and number); SubSync costs nothing extra for calling. SubSync only orders the list, shows the lead and logs the outcome. "Call in your CRM" opens the contact through the white-label link; `tel:` is used only when the person chose their own phone app (Dialer setting).

## What it does
1. **Lists:** missed calls with no callback (from `touch_events`, last 7 days, no later outbound touch or logged outcome), new leads not yet reached, hot leads untouched 3 days, no-shows to recover, and saved filters (the existing call lists). Ranked by money and decay (`rankScore`: open deal value on a log scale up to 40, freshness 20 down to 2, list priority up to 30). Top 150 per session; the list is frozen when the session starts.
2. **Card:** big name and number with Copy, why they are on the list, open deals, tags and last touches ("their story", from the lead panel's context and life story), an editable call script (`{name}`, `{me}`, `{business}`), quiet-hours warning (8am to 9pm in their zone; the call button waits for "I understand"), and "Call in your CRM". Do Not Disturb and no-number leads are skipped automatically and counted.
3. **Outcomes (keys 1 to 7):** no answer, left voicemail, spoke, booked, wrong number, call back later (asks for a time), not interested / do not call. Each: SubSync's own record (`call_outcomes`, so the lead leaves the call lists for 12 hours), a metadata-only `touch_events` row (source `subsync_call`, outcome word, the person's user id, never text), and optionally a short note (plus a task for call back) through the workbench gateway: preview, then confirm (the tap is the confirm), dry run until writes are switched on, audited. A checkbox "Also write a short note to your CRM" turns the CRM part off.
4. **Flow:** auto-advance, progress bar ("7 of 24"), Skip (N), session summary (calls, reached, booked, minutes saved as a labelled estimate of 40 seconds a lead), calm finish (motion respects reduced-motion).
5. **Managers:** calls and outcomes per person in the last 12 hours, calls an hour. A client's staff see only their own numbers and only leads assigned to them (decided on the server from the session, `ctx.kind === "client"`).

## Data and access
- No new table. One additive migration `20261110090000_call_script.sql` (`locations.call_script`, plain text, NOT applied). Until it runs, saving a script answers "needs the latest database update" and the script is kept in the browser.
- Access rules: `GET/POST dial` for client staff and business, `PUT dial/script` business only (the handler also refuses a client). Every id is re-checked against the caller's accounts.
- Touch events from Call mode count as a person's outbound call in Speed metrics (time = when the outcome was logged, never earlier than the call).

## Not verified
Nothing was run against a real CRM. Browser tests mock the list, context and gateway answers; ranking, DND skip, outcome mapping and stats are unit tested (src/lib/__tests__/dial.test.ts). The missed-call SQL, the own-queue filter and the stats query were type checked but not run against a database.
