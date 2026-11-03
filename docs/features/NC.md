# NC: logo, new client account flow, Pipeline tabs

## 1. Agency logo (N52, N85)
- Detected: `whitelabelDetails.logoUrl` from the INSTALL event and sign-in is checked (https only, no `?` or `#`, no credentials, no port, no IP) and stored in `settings.detected_logo_url`. The owner's own address (Settings, "Logo web address", live preview) is `settings.brand_logo_url` and wins. Migration `20261103100000_nc_brand_logo.sql` (additive). Listed in the data inventory; `settings` was already a tenant table.
- Shown in: menu header, printed audit, quarterly review, account report, shared audit page, alert and notification emails. The server never fetches it. The browser loads it with a fixed height and falls back to the name (or the SubSync mark) on error.
- SubSync mark: `/brand/subsync-logo.png`, then `/brand/subsync-logo-512.png` until King's file exists. Used in the menu (32px, name beside it), favicon metadata, reports and shared audit with no agency logo, and email headers.
- Tests: `src/lib/__tests__/brand-logo.test.ts`, `tests/e2e/nc.spec.ts`.
- Not verified live: a real white-label INSTALL or sign-in carrying `logoUrl` (field name taken from the docs). The favicon cannot fall back inside the browser: until `subsync-logo.png` exists the tab may show a broken icon.

## 2. New client account flow
- `handleLocations` compares the installed list with known accounts. Nothing is announced on a company's first read. A new account gets one in-app notice "New client account: NAME" ("First sync is running."), one `audit_log` row (`client_account_added`) and due dates on its template steps (7 days). The automatic checklist steps need no storage. When contacts and deals are both read, "First sync done: N contacts, N deals".
- Idempotent through the notification dedupe key. Notices are company wide (client staff do not see them). An INSTALL with no company id re-reads the installed locations of every live company install.
- Tests: `tests/unit/nc-new-client-db.test.ts` (idempotence, isolation).
- Not verified live: a real bulk install webhook, and email or Slack for this notice (in-app only).

## 3. Pipeline tabs (P1)
- Tabs: Overview, Stages and bottlenecks, Stale deals, Forecast, Compare, at most four blocks each, one line under each title. No metric changed. The chart uses the design system line chart (axes). Stale and other deal lists open the lead panel (contact id added to the stale and pipeline reads). `#pipelines` and `#deals` still open it.
- Not verified: a human walk through of every tab on real data; the lead panel opens only for deals with a contact.

## Checks not green for reasons outside this work
`scripts/check-api.ts` (getting started step count 13 vs 14) and `check-tenancy.ts` (meeting notes) fail on meetings, which this work did not touch.
