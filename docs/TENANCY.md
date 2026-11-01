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

All five have row level security ON and no policy, and the public (anon) and signed-in database roles hold no privilege on them (`scripts/supabase-proof.ts` proves it against the live project with a real `set role` attempt). Only server code, which connects as the database owner, can use them. Every row carries the installation id; `user_connections` and `meeting_note_settings` are also unique per CRM user id, `meetings` per (person, tool, meeting id) and `crm_writes` per (meeting, contact, kind, part), in the database itself.

Who the person is comes only from the signed session (`personFromSession`: user id, role derived at sign-in and carried as `personRole`, kind, the one account a limited session is bound to). The routes `my-connections`, `team-connections` and `meeting-policy` live under `api/app` (no new route file):

- `my-connections` (GET, POST start and test, DELETE): every role, only ever the signed-in person's own rows. A third user asking for another person's id gets 404.
- `team-connections` (GET, POST revoke): administrators only (an account user gets 403). The company owner and administrators see every person in the company; a business's administrator sees its people; a client's administrator sees only the people whose home account is theirs; company staff see nothing until the Users list proves which accounts they can open. An administrator can revoke (provider subscription dropped, tokens erased, the person must connect again) and can never connect for someone, read their tokens or read their meetings.
- `meeting-policy` (PUT): the company rule is for the company owner only; an account's rule is for that account's administrator or for the company's administrators. The effective rule is always the most restrictive of company, account and person.

Where a meeting is saved is decided by an exact email match among the accounts the person can open and nowhere else (`src/lib/connections/meeting-plan.ts`): the same email on two records, or in two client accounts, never picks one; it waits in the person's private Meeting inbox. A client's staff are matched in their own account only. Company staff match only accounts the Users list proves they can open (unproven: none).

Outward actions (a CRM write, a meeting-tool subscription created or deleted) go through `src/lib/live-flags.ts`: with the switch off (the committed default) they are only recorded as "WOULD ..." lines (ids and field names only).

`contact_tag_events` (stage F10) holds the day SubSync first saw a tag added to, or removed from, a contact ("since SubSync started watching"; the CRM does not say when a tag was added). It carries `installation_id`, `location_id`, `contact_id`, the tag name and the kind, and is classified with the synced customer data: removed by "Delete my data", by an uninstall and by removing one client account (`src/lib/tenant-tables.ts`). Every read goes through `people-list-queries.ts`, which limits it to the accounts the caller may see (`tests/unit/people-lists-db.test.ts`).

Stage F10 also keeps three kinds of settings in `saved_views` (page `people`: a person's own smart lists; page `people-team`: lists shared with everyone who signs in to the same company or business, never created by or shown to a client's staff; page `people-prefs`: the person's dialer choice). The owner key is made on the server from the verified session; a client's staff are always held to their own account, whatever a saved list or an address says. Its routes are `people/...` under `api/app` (the one catch-all, already guarded), and a client's staff may use only `GET`, their own lists and the dialer setting (`src/lib/access.ts`). A read of the lead panel's custom fields and call history is made live for one lead at a time with that account's own token, stores nothing, and is refused unless the account is one the caller may see.

`feedback_items` and `roadmap_suggestions` (stage F8) hold what a person typed to us: feedback, a problem report (with the error ID shown on the screen) and a roadmap suggestion. Each row carries `installation_id`, a `who` key made on the server from the verified session, and the person’s kind of session; a person reads back only their own suggestions (the What’s new page), and nobody reads feedback in the app at all: King reads it through `api/admin/feedback` (the server secret only). Nothing is sent anywhere tonight: telling King is a dry-run `notify.king.would_send` line in `audit_log` with ids only. Both are kept by "Delete my data" and removed on uninstall, and both are listed in "What we store".

## Known gaps (not hidden)

- Agency staff are refused rather than limited to their accounts, because the Users API check is not built. If an agency has staff who need SubSync today, the owner and admins can use it; staff cannot.
- The Share link is public by design to anyone holding the link; it contains no names, expires in 30 days, and revocation is not built yet (planned in stage F6).
