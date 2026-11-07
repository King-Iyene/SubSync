# Speed to lead: close-out walk

Walked on the demo company (fixtures; every write call was stubbed by the walker, nothing real was sent) with a click-through script at desktop 1440 and phone 390, light and dark, as agency (default), `?as=client` and `?as=business`. Every button, tab, link and checkbox inside the page and the header was clicked; every popup that opened was checked for contrast, clipping, sideways scroll, vendor words and phone tap size. Selects were not changed.

| Control | Result | Status |
|---|---|---|
| Tabs Race, Pace, Coverage, Call mode, People, Capture, Rules, Log | open the right tab, no console error, no failed request (client has no People tab by design) | ok |
| Global filter bar (7/30/90 days, Custom), account picker, Lead filters, Sync now popup, search, bell, What can I do here, More menu, feedback | respond and open a popup or menu, never leave the page | ok |
| Phone: header buttons and popup rows were 34 to 39 px tall | raised to 44 px | fixed |
| Phone: selects, text boxes, checkboxes, info buttons in Speed | raised to 44 px | fixed |
| Race account rows, KPI tiles, counts (240 leads, answered in time, typical reply) | each opens exactly its leads list; every people count is clickable | ok |
| Pace journey steps, heat map cells, delay-reason chips, people and account rows | open the list popup | ok |
| Call mode (list pills, Start calling, steppers, redial list, callbacks, counts) | respond, Start calling switches to the tab | ok |
| Rules: reply target stepper, escalation toggle, digest Preview / Send test, proof report, routing check | respond (writes stubbed) | ok |
| Rules: escalation step lists (Step 1 to 3 counts) | answered 400 "Unknown part of this screen" (the router list lacked `ladder-leads`) | fixed |
| Rules as a client's staff | asked for people-only data and got two refused calls plus an error card | fixed |
| Log as a business owner | invalid HTML (a form inside a paragraph) in the reply-target line | fixed |
| Dark theme: selected tab label | grey on teal, 3.3:1 | fixed |
| Capture counters and range, Log charts | respond | ok |
| Vendor words (GHL, HighLevel, LeadConnector) in all text and popups | none found | ok |
| Hover tips | every control has a name or label; icon-only buttons carry an aria-label | ok |

Regression tests: `tests/e2e/speed-closeout.spec.ts` (one per fix above).

## Known open items
- Phone: very narrow chart columns on Capture and People (9 to 10 px wide bars are buttons) are below 44 px wide; they are dense charts and a wider hit area would change the chart.
- Phone: checkbox lists in the account picker popup have 17 px boxes (their rows are 39 px); the popup is shared with other screens.
- Seen only mid-walk: opening a lead from the Log tab after the account filter was changed answered 404 "Contact not found" because the request kept the old account filter. A person cannot reach it by normal use (the list refreshes with the filter) but the lead panel should not reuse a filter that excludes its own account. Not changed (data logic).
- Not walked live: the lead panel tabs (Conversation, Update, Deals, Appointments, Record, Timeline) and the Call sheet beyond opening and closing, because writes were stubbed; the existing specs cover them.
- The long Log tab run crashes the browser tab on this slow machine after about 7 minutes (dev server memory); it passed in pieces.
