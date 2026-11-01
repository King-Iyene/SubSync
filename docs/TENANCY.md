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
| agency_owner | Agency owner | agency | Every client account of that agency, plus plan and settings |
| agency_admin | Agency administrator | agency | The same |
| agency_staff | Agency staff (role user, not owner) | none | **Refused.** Until their access to each client account can be verified through the Users API (a CHECK item in the brief), staff see nothing. Default deny |
| account_admin | A client account's administrator | business, or client | Their own account only. Business kind (full tools) when their business installed the app; client kind (read-only) when the agency switched client view on |
| account_user | A client account's staff | client | Their own account only, read-only, no settings or plan pages, even when their business installed the app |

4. `/api/sso` signs a one-hour session (HMAC) that carries the company key, the kind, and for business and client kinds the one location id. Every sign-in is recorded in `identity_log` (role, user type, outcome; no names or emails).

## The guards on every request to `/api/app`

- `authenticate` (`src/lib/api/auth.ts`) verifies the session signature and expiry, resolves the installation, and refuses a limited session that has no location.
- `routeAllowed` (`src/lib/access.ts`) is default deny: each session kind has an explicit list of method and path pairs. Client sessions are read-only plus two harmless writes (the page-view counter and roadmap votes).
- Every query takes the installation id from the session. For business and client sessions every query is also restricted to the single location id (`limitTo`). The id in a URL is only ever used to pick one of the caller's own records, and an id belonging to someone else returns 404.
- Agency-only controls on an account (ignore, owner, client view) are refused for business and client sessions.

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
| `/audit/[id]` | public_by_design | Shared audit snapshot: 192-bit random id, 14-day expiry, switch-off by its owner, rate limited, totals, finding titles and a fix plan only, account names removed |
| `/` | public_static | Marketing page |
| `/app` | public_static | App shell with no data; data comes from `api/app` with a session |
| `/installed` | public_static | Static page |
| `/installed/error` | public_static | Static page |
| `/privacy` | public_static | Static legal page |
| `/support` | public_static | Static page |
| `/terms` | public_static | Static legal page |

There are no server actions in this app (all writes go through `api/app`, `api/hooks/*`, `api/webhooks/ghl` or `api/integrations`).

## Database queries

There are several hundred queries; they are not listed one by one. They are all written through the shared layer: each takes `installationId` from the session, and each tenant table has an `installation_id` column. `tests/unit/tenant-tables.test.ts` fails if a table with an `installation_id` or `location_id` exists that is not classified in `src/lib/tenant-tables.ts`. The cross-tenant attack suite (`scripts/check-tenancy.ts`, 384 cross-reads plus write attacks) proves the scoping from the outside.

## What happens at uninstall

`purgeInstallation` empties the stored tokens at once and deletes every table in `UNINSTALL_DELETE` (`src/lib/tenant-tables.ts`): all copied customer data, settings, API keys, connection tokens, meeting notes, cleanup snapshots, share links and sign-in links. Kept on purpose: `audit_log`, `install_plans`, `identity_log` (no customer data) and the installation row with its tokens emptied. The kill switch does not stop this: install and uninstall bookkeeping keeps running during maintenance.

## Known gaps (not hidden)

- Agency staff are refused rather than limited to their accounts, because the Users API check is not built. If an agency has staff who need SubSync today, the owner and admins can use it; staff cannot.
- The Share link is public by design to anyone holding the link; it contains no names, expires in 30 days, and revocation is not built yet (planned in stage F6).
