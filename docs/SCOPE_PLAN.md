# Permission (scope) plan

Brief 13A: few permissions is a trust advantage (the biggest competitor asks for 165). The catch is that
every permission added later makes every installed agency approve again. So before any outside agency
installs, every read permission that Waves 1 and 2 will need should already be in the listing as an
OPTIONAL permission, and the app must keep working when an optional one is not granted.

Names below are from the platform's own scope list (read 31 Oct 2026). Which endpoint needs which scope is
marked CHECK where the list only describes it loosely.

## Today (7 required, 2 optional, all read-only except oauth.write)

| Scope | Why | Used by |
| --- | --- | --- |
| `locations.readonly` | Names, time zones of client accounts | everything |
| `contacts.readonly` | Contacts | search, data health, leads, call lists |
| `opportunities.readonly` | Deals and pipelines | pipeline, stale deals, Instant Audit |
| `conversations.readonly` | Conversation summaries (last message, direction, time) | inbox and SLA |
| `calendars.readonly` | Calendars | setup checklist |
| `oauth.readonly` | List the accounts the app is installed on | sync |
| `oauth.write` | Mint a per-account token from the agency token | sync (kept: no read-only way to do this, CHECK) |
| optional `calendars/events.readonly` | Appointments | appointments, insights, no-show recovery |
| optional `users.readonly` | Team member names | team names on lists and leaderboards |

Nothing in this list is unused today. `oauth.write` sounds scary but it is the permission that lets the app
read one client account at a time with a token limited to that account.

## Proposed new OPTIONAL read permissions (add in the portal before any pilot install)

| Scope | Needed for | Wave | Status |
| --- | --- | --- | --- |
| `conversations/message.readonly` | The messages inside a conversation: who sent each one, a person or automation, and when. This is the only way to measure true speed-to-lead (first human touch) and who answered | 1 (#1, #3) | CHECK that the "list messages in a conversation" endpoint accepts this scope; the platform lists it for message recordings and transcriptions and the message webhooks |
| `locations/tags.readonly` | Tag names for hot-lead queues and lead source grouping | 1 (#4), 2 | confirmed to exist |
| `locations/customFields.readonly` | Reading a lead-source custom field for source attribution | 3 | confirmed to exist; not needed before Wave 3, so can wait |
| `marketplace-installer-details.readonly` | Reconcile each install's plan (the brief's "Get installer details") | pricing gate | confirmed in the brief; CHECK the exact name in the portal |

Recommendation: add the first, second and fourth now (they unblock Wave 1 and the pricing reconcile) and
leave custom fields until Wave 3. Not recommended: `voice-ai-dashboard.readonly` (it only covers the
platform's Voice AI call logs, not ordinary calls, so it would not give call data), and any write scope.
The `contacts.write` permission that Data cleanup needs stays out while that feature is switched off.

## How to add them (King, in the developer portal)

1. Open the developer portal, My Apps, SubSync, then Advanced Settings, then Auth.
2. Under Scopes choose Add scope, tick `conversations/message.readonly`, `locations/tags.readonly` and
   `marketplace-installer-details.readonly`, and for each choose **Optional**, not Required.
3. Save the draft. Send me a screenshot of the scope list.
4. I will then add the same names to the install link in `src/lib/ghl/scopes.ts` and make each feature say
   "needs permission" instead of failing when it is not granted (the appointments page already works this
   way). I must not change the code first: asking for a permission the listing does not have makes the
   install fail.
5. Reinstall on the test agency to approve the new optional ones.

## What is checked

`scopes.ts` is the single list used for the install link; a unit test pins it. Features that depend on an
optional scope store `needs_permission` for that account and show a plain banner, never an error.
