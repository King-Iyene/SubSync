# Tenancy: who can see what, and what guards each door

Written for runbook stage S0.2 (31 Oct 2026). `tests/unit/route-registry.test.ts` fails if a route or page exists that is not listed here, so this file cannot silently fall behind. The same table lives in code at `src/lib/route-guards.ts`.

## The rule (CLAUDE.md 4.2)

A person in one client account never sees another client account's data. An agency never sees another agency's data. The server decides, from the verified sign-in, never from an id in the request.

## How identity becomes access

1. The CRM sends an encrypted user context. `/api/sso` decrypts it with the app's shared secret. A payload that does not decrypt is refused.
2. `deriveIdentity` (`src/lib/identity.ts`) reads only that decrypted payload and returns one of five roles. `isAgencyOwner` counts only when it is exactly the boolean `true`. A missing or unknown role becomes the least privileged role of that user type.
3. `decideForIdentity` (`src/lib/access.ts`) turns the role into a session kind:

| Role | Who | Session kind | What they get |
| --- | --- | --- | --- |
| agency_owner | Agency owner | agency | Every client account of that agency, plus plan and settings, and the only role that may press "Delete my data" |
| agency_admin | Agency administrator | agency | The same |
| agency_staff | Agency staff (role user, not owner) | none | **Refused.** Until their access to each client account can be verified through the Users API (a CHECK item in the brief), staff see nothing. Default deny |
| account_admin | A client account's administrator | business, or client | Their own account only. Business kind (full tools) when their business installed the app; client kind (read-only) when the agency switched client view on |
| account_user | A client account's staff | client | Their own account only, read-only, no settings or plan pages, even when their business installed the app |

4. `/api/sso` signs a one-hour session (HMAC) that carries the company key, the kind, and for business and client kinds the one location id. Every sign-in is recorded in `identity_log` (role, user type, outcome; no names or emails).

## The guards on every request to `/api/app`

- `authenticate` (`src/lib/api/auth.ts`) verifies the session signature and expiry, resolves the installation, and refuses a limited session that has no location.
- `routeAllowed` (`src/lib/access.ts`) is default deny: each session kind has an explicit list of method and path pairs. Client sessions are read-only plus four harmless writes (feedback, a problem report, a roadmap vote or suggestion, the page-view counter and roadmap votes).
- Every query takes the installation id from the session. For business and client sessions every query is also restricted to the single location id (`limitTo`). The id in a URL is only ever used to pick one of the caller's own records, and an id belonging to someone else returns 404.
- Agency-only controls on an account (ignore, owner, client view) are refused for business and client sessions.
- "Delete my data" (`POST settings/purge`) is for one person only: the agency owner, or the administrator of a business that installed the app for itself (`mayDeleteData` in `src/lib/access.ts`, set at sign-in and carried in the signed session as `dataOwner`; a session without it can never delete). It needs the typed word DELETE, and every attempt, refused or done, is written to the audit log, which the deletion itself does not remove.
- A client's staff are refused everything outside a short list of read-only views of their own account, and the list is the only door: `tests/unit/client-access.test.ts` asks every route the router handles, and `scripts/check-tenancy.ts` asks them over HTTP against two real companies that have fees, notes, owner labels, keys and saved lists, and searches every answer for those secrets. Switching a client's access off is checked on the very next request (`clientViewOn` runs on every call, not only at sign-in).

## Every route and page

| Route | Guard kind | What protects it |
| --- | --- | --- |
| `api/app/[...path]` | session | Signed session; route policy by kind; installation and location scoping on every query |
| `api/sso` | signature | Shared-secret decryption; role from the payload only; staff refused |
| `api/webhooks/ghl` | signature | Ed25519 signature on the raw body; duplicate ids dropped; bad signature gets 401 and changes nothing |
| `api/hooks/zoom` | signature | Zoom signature with a freshness window |
| `api/hooks/fathom/[key]` | token | Long random key per connection plus the provider's signature; unknown key gets 404 |
| `api/hooks/meeting/[token]` | token | Private address token, stored only as a hash; unknown token gets 404 |
| `api/integrations/[provider]/callback` | state | Signed, expiring state tied to the installation; forged state gets 400 |
| `api/oauth/callback` | state | One-time authorization code from the platform |
| `api/oauth/install` | redirect_only | Redirects to the platform's install screen; returns no data |
| `api/email/unsubscribe` | token | Signed token naming the installation and the address the email went to; a GET only shows a button, the POST removes that one address |
| `api/mcp` | api_key | Per-installation API key stored hashed; every tool scoped to that installation |
| `api/cron/sync` | secret | Bearer CRON_SECRET; idle while the kill switch is on |
| `api/cron/daily` | secret | Bearer CRON_SECRET; idle while the kill switch is on |
| `api/cron/digest` | secret | Bearer CRON_SECRET |
| `api/cron/weekly` | secret | Bearer CRON_SECRET; idle while the kill switch is on |
| `api/cron/data-health` | secret | Bearer CRON_SECRET; idle while the kill switch is on; read only toward the CRM: daily scores, quality alerts through the shared dispatcher, weekly digest rehearsal |
| `api/cron/workflows` | secret | Bearer CRON_SECRET; idle while the kill switch is on; read only, Workflows alerts and the weekly Proof email (dry run unless SEND_EMAIL_LIVE) |
| `api/cron/meeting-expiry` | secret | Bearer CRON_SECRET; once a day removes inbox calls whose time is up, handled calls' text after 90 days, old delivery ids, and a person who left the CRM (only with the users permission and a complete list); counts only; idle while the kill switch is on |
| `api/cron/watchdog` | secret | Bearer CRON_SECRET; the internal sync alarm, writes audit lines (ids, times, counts) and sends nothing; idle while the kill switch is on |
| `api/admin/diagnostics` | secret | Bearer CRON_SECRET only, read only; sync health of every real install (short ids, times, counts), no customer data |
| `api/admin/feedback` | secret | Bearer CRON_SECRET only, read only; the feedback, problem reports, roadmap suggestions and vote counts people sent, companies as short ids |
| `api/admin/capabilities` | secret | Bearer CRON_SECRET only, read only; which data the platform gives the app, install by install (field names, counts and statuses, never a value or a token); at most 70 GET requests per call |
| `/audit/[id]` | public_by_design | Shared audit snapshot: 192-bit random id, 14-day expiry, switch-off by its owner, rate limited, totals, finding titles and a fix plan only, account names removed |
| `/` | public_static | Marketing page |
| `/app` | public_static | App shell with no data; data comes from `api/app` with a session |
| `/design` | public_static | The style guide (stage D0): tokens and shared components on made-up sample data produced in the page's own code; no sign-in, no tenant data, no API calls, noindex |
| `/installed` | public_static | Static page |
| `/installed/error` | public_static | Static page |
| `/trust` | public_static | Trust page (stage F8): what is read, stored, requested and processed, produced from the inventory and the scope list and checked claim by claim by a test; no tenant data |
| `/privacy` | public_static | Legal page with no tenant data. Its lists of what is stored and deleted come from `src/lib/data-inventory.ts`, checked against the schema; the one thing read per request is the global switch for Zoom and Google Meet |
| `/support` | public_static | Static page |
| `/terms` | public_static | Static legal page |

There are no server actions in this app (all writes go through `api/app`, `api/hooks/*`, `api/webhooks/ghl` or `api/integrations`).

## Database queries

There are several hundred queries; they are not listed one by one. They are all written through the shared layer: each takes `installationId` from the session, and each tenant table has an `installation_id` column. `tests/unit/tenant-tables.test.ts` fails if a table with an `installation_id` or `location_id` exists that is not classified in `src/lib/tenant-tables.ts`. The cross-tenant attack suite (`scripts/check-tenancy.ts`, 384 cross-reads plus write attacks) proves the scoping from the outside.

## What happens at uninstall

`purgeInstallation` empties the stored tokens at once and deletes every table in `UNINSTALL_DELETE` (`src/lib/tenant-tables.ts`): all copied customer data, settings, API keys, connection tokens, meeting notes, cleanup snapshots, share links and sign-in links. Kept on purpose: `audit_log`, `install_plans`, `identity_log` (no customer data) and the installation row with its tokens emptied. The kill switch does not stop this: install and uninstall bookkeeping keeps running during maintenance.

## What is stored, and what each button removes

`src/lib/data-inventory.ts` lists every table, and every column that holds personal data, with a plain-words label. `tests/unit/data-inventory.test.ts` compares it with the migration files and the live database and fails for a table or a personal-looking column that is not listed. The Settings card "What we store", the privacy page and the help answer about removing data are produced from it, and `tests/unit/uninstall-purge.test.ts` checks what they say against real rows.

`saved_views` (stage F4) holds a person's own named choices on the Unanswered messages page. It carries `installation_id` and an `owner` key made on the server from the verified session (kind, account, sign-in id), so a person reads and removes only their own views (`tests/unit/inbox-views-db.test.ts`); it holds filter choices only, never customer data. Kept by "Delete my data", removed on uninstall. Its routes are `inbox/views` under `api/app` (the one catch-all, already guarded); a client's staff may keep their own (`src/lib/access.ts`).

## Connections (stage E0)

A personal tool (Fathom; Zoom and Google Meet later) belongs to the PERSON who connected it. A workspace tool (Slack) belongs to the installation and needs an administrator. Nothing is shared, assigned or connected on someone's behalf.

| New table | Holds | Who can read it | On uninstall | On "Delete my data" |
| --- | --- | --- | --- | --- |
| `user_connections` | one row per CRM user and tool: the connected account's email, status, counts, and the encrypted tokens and delivery secret | the person (their own row, through `personFromSession`); an administrator sees status and counts only, within their scope. No screen query selects a token column (`SAFE_COLUMNS`) | deleted (after the provider subscription is dropped) | kept |
| `meeting_note_settings` | one person's choices (what to save and where) | the person | deleted | kept |
| `meeting_policies` | the company rule and each client account's rule | administrators (company owner for the company rule; an account's administrator for their own account) | deleted | kept |
| `meetings` | meetings that arrived through ONE person's tool: title, attendee emails, summary, action items, recording link | only the person who recorded them. Nobody else, whatever their role, can read another person's meeting in SubSync | deleted | deleted |
| `crm_writes` | every note, comment or field SubSync itself put in the CRM, with the id the CRM gave it (ids and times only) | server code only (it keeps our writes out of our numbers) | deleted | deleted |

| `meeting_deliveries` (stage E2a) | one row per Fathom delivery already handled (connection id and the delivery's own id, nothing of the call), so a retry is handled once | server code only | deleted | deleted |
| `meeting_ignored_emails` (stage E2a) | the email addresses one person chose to "always ignore" in their Meeting inbox | the person only (through `personFromSession`) | deleted | kept |

All seven have row level security ON and no policy, and the public (anon) and signed-in database roles hold no privilege on them (`scripts/supabase-proof.ts` proves it against the live project with a real `set role` attempt). Only server code, which connects as the database owner, can use them. Every row carries the installation id; `user_connections` and `meeting_note_settings` are also unique per CRM user id, `meetings` per (person, tool, meeting id) and `crm_writes` per (meeting, contact, kind, part), in the database itself.

Who the person is comes only from the signed session (`personFromSession`: user id, role derived at sign-in and carried as `personRole`, kind, the one account a limited session is bound to). The routes `my-connections`, `team-connections` and `meeting-policy` live under `api/app` (no new route file):

- `my-connections` (GET, POST start and test, DELETE): every role, only ever the signed-in person's own rows. A third user asking for another person's id gets 404.
- `team-connections` (GET, POST revoke): administrators only (an account user gets 403). The company owner and administrators see every person in the company; a business's administrator sees its people; a client's administrator sees only the people whose home account is theirs; company staff see nothing until the Users list proves which accounts they can open. An administrator can revoke (provider subscription dropped, tokens erased, the person must connect again) and can never connect for someone, read their tokens or read their meetings.
- `meeting-policy` (PUT): the company rule is for the company owner only; an account's rule is for that account's administrator or for the company's administrators. The effective rule is always the most restrictive of company, account and person.

Where a meeting is saved is decided by an exact email match among the accounts the person can open and nowhere else (`src/lib/connections/meeting-plan.ts`): the same email on two records, or in two client accounts, never picks one; it waits in the person's private Meeting inbox. A client's staff are matched in their own account only. Company staff match only accounts the Users list proves they can open (unproven: none).

Outward actions (a CRM write, a meeting-tool subscription created or deleted) go through `src/lib/live-flags.ts`: with the switch off (the committed default) they are only recorded as "WOULD ..." lines (ids and field names only).

## Notifications (stage F9)

Alerts, the daily brief and the weekly summary reach people through ONE dispatcher (`src/lib/notifications/dispatcher.ts`): the in-app bell, email and Slack. Every email and every Slack post goes through the live switches (`SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, committed off): with a switch off the request is described in the log and the audit table (ids only, never the words) and nothing is sent.

| New table | Holds | Who can read it | On uninstall | On "Delete my data" |
| --- | --- | --- | --- | --- |
| `notification_prefs` | one row per kind of message per installation: channels, email recipients, time, quiet hours, the company's own wording | administrators of that installation (checked in the handler; a client's staff get 403) | deleted | kept |
| `notification_destinations` | one row per Slack channel an administrator authorised: label, status, the client account it is limited to (or the whole company), and the channel address, ENCRYPTED (`webhook_url_enc`) | administrators see label and status only; the address is decrypted on the server only at the moment of sending and is never returned by any endpoint | deleted | kept |
| `notifications` | the bell: one row per item, the words a person reads, the page it links to | every person sees only their own scope: an agency all of its accounts, a business its own account and company-wide items, a client's staff ONLY items about their own account (`listBell`, `setBellState`) | deleted | deleted |
| `notification_states` | one person's read, dismissed and snoozed marks on an item, keyed by the signed-in user id | only that person (the key is taken from the session, never from the request) | deleted | deleted |
| `notification_deliveries` | the dispatcher's ledger: one row per message to one place (bell, email address, Slack channel), with status, attempts and the words | server code only | deleted | deleted |

All five have row level security ON and no policy, and the public (anon) and signed-in database roles hold no privilege on them (applied to the live project and read back: `rls=true`, 0 policies, anon and authenticated cannot select). Every row carries the installation id.

Rules that keep one client's data away from another:

- A Slack channel made for ONE client account (`notification_destinations.location_id`) only ever receives that account's own messages. Another client's alert, or a message about all accounts (the daily brief), is never delivered to it (`eligibleDestinations`, checked when a message is planned AND again when it is sent). A channel with no account belongs to the company and receives everything the company's own owner sees.
- The bell for a client's staff lists only items whose `location_id` is their own account; a read, dismiss or snooze of any other item answers 404, the same as an item that does not exist.
- Routes: `notifications` (GET, POST read-all, read, dismiss, snooze) is open to every kind of person; `notification-prefs` (GET, PUT, POST preview and test, DELETE copy) and `notification-destinations` (GET, POST slack/start, advanced and test, DELETE) are for administrators only (a client's account user gets 403 from the route policy, and a business or company person who is not an administrator gets 403 from the handler). No route returns a channel address.
- The Slack sign-in callback is the existing `api/integrations/[provider]/callback`; its signed state now also names the waiting destination row, which belongs to the installation that started it. A waiting row that never finishes shows "This did not finish. Try again." after two minutes.
- The "stop these emails" link removes that one address from the settings AND from every kind of message in `notification_prefs` (matched by the signed address tag), and a message already waiting for it is skipped.
`contact_tag_events` (stage F10) holds the day SubSync first saw a tag added to, or removed from, a contact ("since SubSync started watching"; the CRM does not say when a tag was added). It carries `installation_id`, `location_id`, `contact_id`, the tag name and the kind, and is classified with the synced customer data: removed by "Delete my data", by an uninstall and by removing one client account (`src/lib/tenant-tables.ts`). Every read goes through `people-list-queries.ts`, which limits it to the accounts the caller may see (`tests/unit/people-lists-db.test.ts`).

Stage F10 also keeps three kinds of settings in `saved_views` (page `people`: a person's own smart lists; page `people-team`: lists shared with everyone who signs in to the same company or business, never created by or shown to a client's staff; page `people-prefs`: the person's dialer choice). The owner key is made on the server from the verified session; a client's staff are always held to their own account, whatever a saved list or an address says. Its routes are `people/...` under `api/app` (the one catch-all, already guarded), and a client's staff may use only `GET`, their own lists and the dialer setting (`src/lib/access.ts`). A read of the lead panel's custom fields and call history is made live for one lead at a time with that account's own token, stores nothing, and is refused unless the account is one the caller may see.

`feedback_items` and `roadmap_suggestions` (stage F8) hold what a person typed to us: feedback, a problem report (with the error ID shown on the screen) and a roadmap suggestion. Each row carries `installation_id`, a `who` key made on the server from the verified session, and the person’s kind of session; a person reads back only their own suggestions (the What’s new page), and nobody reads feedback in the app at all: King reads it through `api/admin/feedback` (the server secret only). Nothing is sent anywhere tonight: telling King is a dry-run `notify.king.would_send` line in `audit_log` with ids only. Both are kept by "Delete my data" and removed on uninstall, and both are listed in "What we store".

The Clients module (stage C1) adds four tables, each with `installation_id` (removed on uninstall, kept by "Delete my data") and classified in `src/lib/tenant-tables.ts` and `src/lib/data-inventory.ts`: `client_notes` (the log of conversations and notes, with who wrote it and when), `onboarding_templates` (checklist templates, steps as JSON), `client_steps` (who is on one step of one client, its due date, who finished it; also the extra steps added to one client) and `client_step_history` (what happened to a step). The three that carry a `location_id` are also in `LOCATION_DELETE`, so removing one client account removes its notes, steps and history. Their routes are `clients/<id>/notes` and `client-onboarding/...` under `api/app` (the one catch-all): agency sessions only, refused for a business and for a client's staff by the route policy (`src/lib/access.ts`, tested in `tests/unit/c1-access.test.ts`). Every read and write takes the installation from the signed session and treats a client account that is not the company's own, or not in the caller's allowed list, as not found (`locationVisible` in `src/lib/analytics/client-success-queries.ts`, proved in `tests/unit/clients-db.test.ts` and in the cross-tenant attacks added to `scripts/check-tenancy.ts`). The one new route a business or a client's staff may call is the read-only `client-trends/<id>`: the daily series and appointment weeks of their own account, checked against their single account like every other read.

## Known gaps (not hidden)

- Agency staff are refused rather than limited to their accounts, because the Users API check is not built. If an agency has staff who need SubSync today, the owner and admins can use it; staff cannot.
- The Share link is public by design to anyone holding the link; it contains no names, expires in 30 days, and revocation is not built yet (planned in stage F6).

## Meeting inbox and Fathom delivery (stage E2a)

No new route file except the cron above. The Meeting inbox is the route `meeting-inbox` under `api/app` (the one catch-all, already guarded): GET (the person's own waiting and recent calls), GET `<id>/contacts` (search), POST `<id>/link`, `<id>/dismiss`, `<id>/ignore`, POST `confirm`, PUT `settings`. Open to every kind of session and every role, because it is the signed-in person's OWN inbox: every statement names the installation id AND the person's user id (`src/lib/connections/inbox-store.ts`), the person comes only from the signed session (`personFromSession`), and a call id from another person finds nothing (404). A contact search runs only inside the accounts the person can open (`accessibleAccounts`), and a "Link" is checked again on the server: the account must be one the person can open and the contact must be in it. The Meeting notes page itself stays behind the `meetings` switch (off by default); with it off the inbox routes answer 404.

A delivery to `api/hooks/fathom/[key]` is verified (signature on the raw body, 5 minute window) before anything is read; the delivery's own id is claimed once in `meeting_deliveries` (unique per connection), so a retry or two simultaneous deliveries are handled once.

Stage E2b: `meeting-setup` (GET, POST preview, PUT mine) is the signed-in person's own choices; `meeting-setup/account` and `meeting-setup/fields` are for administrators of that account (company staff by role), the type of a mapped field is read from the account, never from the request.

## Duplicate review (stage DUP)

`duplicate_snoozes` (new, additive, `installation_id` and `location_id` on every row, ids and a date only) holds "Not now" on a group; `duplicate_reviews` (existing) holds "not a duplicate" and "merged in the CRM". Both are removed with the account's data and on uninstall (`src/lib/tenant-tables.ts`). The routes live under the one guarded catch-all `api/app/[...path]`: `GET duplicates`, `GET duplicates/obvious`, `POST duplicates/review|undo|snooze|unsnooze|merge` for every kind (a client's staff included, for their OWN account), `POST duplicates/bulk` for an agency or a business only. Every handler takes the accounts from the verified session (`allowedIds`), and a contact id from the browser is re-read from the caller's own account before anything is recorded or merged; another account's contact answers "not found" (`tests/unit/duplicates-db.test.ts`, `tests/e2e/duplicates-merge.spec.ts`). A group never spans two accounts. The merge route never writes while `WRITE_GHL_LIVE` is off, and never for the demo.

## People rebuild (stage PEOPLE)

`people/home`, `people/queue`, `people/person/<account>/<id>`, `people/recent` (GET, POST, DELETE), `people/seen` (PUT) and `people/outcome` (POST) all derive the accounts from the signed session (`allowed`); an account or contact in the address only ever narrows inside them, and every query joins to those accounts again (the batch read of contacts too), so a person outside them is "not found" and never read. A client's staff may read the lists and the panel, mark a person opened, remember a search and log a call, for their own account only (`PEOPLE_DAILY_RULES` in `src/lib/access.ts`). `saved_views` gains one more kind of row, page `people-recent` (the signed-in person's last searches and opened people, ids and a time only); no new table. `scripts/check-tenancy.ts` has the new read addresses and the two forged writes (not run by this stage: the lead runs it alone).
