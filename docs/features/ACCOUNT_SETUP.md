# Account setup (stage AS)

Read-only checklist per account. Code: src/lib/setup-check (model.ts rules and words, read.ts live reads, run.ts server and memory copy, demo.ts), route src/lib/api/setup-check-routes.ts (`GET /api/app/setup-check?locationId=&fresh=1`), screen src/app/app/views/account-setup.tsx. Flag `as_check`, on by default.

## Calls (VERIFIED against the platform's published API description, apps/*.json, 14 Nov 2026)
| Row | Call | Version | Permission it needs |
| --- | --- | --- | --- |
| Pipelines and stages | GET /opportunities/pipelines?locationId | 2021-07-28 | opportunities.readonly |
| Custom objects | GET /objects/?locationId | 2021-07-28 | objects/schema.readonly |
| Records in a custom object | POST /objects/{key}/records/search (reads `total` only) | 2021-07-28 | objects/record.readonly |
| Custom values | GET /locations/{id}/customValues | 2021-07-28 | locations/customValues.readonly |
| Templates | GET /locations/{id}/templates?originId (NOT VERIFIED LIVE: originId is the account id) | 2021-07-28 | locations/templates.readonly |
| Tasks | POST /locations/{id}/tasks/search `{completed:false}` (a read) | 2021-07-28 | locations/tasks.readonly |
| Files | GET /medias/files?altType=location&type=file (NOT VERIFIED LIVE: type value) | 2021-07-28 | medias.readonly |
| Email designs | GET /emails/builder (NOT VERIFIED LIVE: list shape) | 2021-07-28 | emails/builder.readonly |
| Email campaigns | GET /emails/schedule | 2021-07-28 | emails/schedule.readonly |
| Phone numbers | GET /phone-system/numbers/location/{id} | 2021-07-28 | phonenumbers.read |
| Number pools | GET /phone-system/number-pools?locationId | 2021-07-28 | numberpools.read |
| Rooms, equipment | GET /calendars/resources/{rooms or equipments} | 2021-04-15 | calendars/resources.readonly |

## Not available from the platform (no read in the published description)
Notes across an account (only per contact), repeating tasks (only get, make or change by id), features switched on in an account, sending-domain verification (`/email/verify` checks one address and costs credits, so it is not called), the SaaS flag (company-login endpoints only).

## Names that differ from the brief
files = `medias.readonly` (not files.readonly); pipelines = `opportunities.readonly` (not pipelines.readonly); templates = `locations/templates.readonly` (no emails/templates.readonly). `notes.readonly`, `recurring-tasks.readonly`, `locations.features.read` and `lc-email.readonly` are not in the published description, so asking for them unlocks nothing SubSync can show. The scopes list and docs/SCOPES.md are owned by the Scopes PR.

## Privacy
Counts only. Phone numbers: last four digits. Nothing in the database; a five minute copy of the counts in server memory keyed by company and account. A client's own staff have no access rule for this address.
