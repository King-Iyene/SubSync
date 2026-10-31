# Verification checklist results (brief section 13)

Read 31 Oct 2026 from the platform's own documentation and help centre unless stated. **Confirmed** means I read it
in the platform's pages. **Not found** means my searches did not turn it up, which is not the same as "does not
exist". **Needs a real call** means only a live request can settle it. Nothing here was tested against the live
platform this session.

| # | Question | Answer | Status |
| --- | --- | --- | --- |
| 1 | Current listing settings | Sub-account target, Everyone, bulk install yes, white-label, private (from King's screenshots in the brief) | From the brief, not re-read |
| 2 | SSO payload; agency screen from a client menu | Fields as the brief lists. We do not log real payloads, so what each kind of user sends is still unknown | **Open.** Needs a small redacted logger and a sign-in of each kind of user |
| 3 | Webhook event names | `ContactCreate`, `ContactUpdate`, `ContactDelete`, `ContactTagUpdate`, `ContactDndUpdate`; `OpportunityCreate`, `OpportunityUpdate`, `OpportunityStageUpdate`, `OpportunityStatusUpdate`, `OpportunityMonetaryValueUpdate`, `OpportunityAssignedToUpdate`, `OpportunityDelete`; `AppointmentCreate`, `AppointmentUpdate`, `AppointmentDelete`; `InboundMessage`, `OutboundMessage`, `ConversationUpdate`, `ConversationUnreadWebhook`; `AppInstall`, `AppUninstall`, `AppUpdate`; **`PlanChange`**, `AppPaymentStatus`; `UserCreate/Update/Delete`; `LocationCreate/Update` | Confirmed (names). Payload fields for PlanChange, AppUninstall and the message events not read yet |
| 3b | Webhook signing | `X-GHL-Signature`, Ed25519. The older `X-WH-Signature` (RSA) is deprecated on **1 Sept 2026** | Confirmed. Our route already uses the new header |
| 4 | Installed locations, location tokens, limits | Burst 100 requests per 10 seconds, 200,000 a day, counted per app per resource (account or company). Access token lasts 1 day; refresh token 1 year unless used, and each use issues a new one. Location token: docs show `POST /oauth/location-token`, version header `v3`, scope `oauth.write`, an agency OAuth token (private integration tokens refused), body `companyId` and `locationId`. Our code calls `/oauth/locationToken` and `/oauth/installedLocations`, which **worked on the real install on 30 Oct** | Limits and tokens confirmed. Docs and our working path differ in spelling; left alone because ours is proven. The installed-locations page and the rate-limit header names were not read |
| 5 | Appointment statuses; message fields; calls | Statuses: new, confirmed, cancelled, showed, noshow, invalid. Listing messages needs scope **`conversations/message.readonly`** and each message has `direction` (inbound or outbound), `userId`, **`source`** (`workflow`, `bulk_actions`, `campaign`, `api`, `app`), `messageType`, `dateAdded`, `status`. So a human touch can be told from automation: outbound, with a `userId`, and a source of `app` | Confirmed. Whether `source = app` is only ever a person, and whether calls appear as messages, needs a real call. The only call data scope found is Voice AI call logs |
| 6 | Free tier plus per-account billing with bulk install | Not covered by the pricing article. Differential pricing (agency base fee plus per-account fee) is documented only for target Sub-account **and** Agency Only install | **Not found.** Ask the platform's support, or test with the sandbox |
| 6b | Card on file on bulk installs | Not covered | **Not found** |
| 7 | Wallet charges and billing meters | `POST /marketplace/billing/charges` with a meter id (shown on the app's pricing page), an event reference and an optional timestamp. A meter of type Custom Event (API) can take an optional per-unit `price`; without it the meter's default price applies. The price field is described as newly added, so older API versions may refuse it | Confirmed from docs; version for `price` unconfirmed |
| 8 | Per-location usage or wallet data | Not found | **Not found** |
| 9 | Commission and payouts | The pricing help article (last modified 23 Jun 2026) says: "We currently do not deduct any commission. You receive the entire payment from our customers." Payouts go through Tipalti; an invitation email arrives, payment typically 1 to 3 days after | Confirmed wording. Still contradicts the 15% figure given earlier, so keep both in the model and check the Earnings page in the portal |
| 9b | Free trial | 1 to 90 days, set once for the whole app, once per user per app per 90 days, notice 24 hours before it ends. A failed charge on a paid plan gets a 30 day grace with retries; after a trial, retries for 3 days and then the app is uninstalled. The article does not reconcile the two | Confirmed |
| 10 | Can "Who can install" change after saving | Docs only describe the options (Both Agency and Sub-account is recommended; Agencies Only for fully white-labelled SaaS features). Nothing about editing later | **Not found.** King can see whether the field is greyed out |
| 11 | Agency-level test on a Starter plan | Done on 30 Oct: a private install worked on the Starter plan (see `DECISIONS.md`) | Verified live |
| 13 | Which accounts an agency staff user can reach | The Users API (scope `users.readonly`, agency or account token) returns `roles.locationIds`, `roles.restrictSubAccount`, `roles.type` (agency or account) and `roles.role` (admin or user). Agency-wide search by company is implied, not stated | Fields confirmed; needs a real call to confirm agency search works with our token |
| - | Get Installer Details endpoint and its scope name | Not found in the docs I could reach. The brief names `marketplace-installer-details.readonly` | **Not found**, so it is removed from the "add now" list in `SCOPE_PLAN.md` until King sees the exact name in the portal |

## What this changes

1. **Plan changes can be handled by webhook:** `PlanChange` and `AppPaymentStatus` exist. The reconcile job the brief asks for is still worth building, but not blocked by guessing event names.
2. **Speed-to-lead is feasible** with `conversations/message.readonly`, which is already on the proposed optional list. First-touch time can be measured from `dateAdded` of the first outbound message with a `userId` and a human source.
3. **Pricing questions that only the platform can answer** (free plan with per-account billing, card on file, who-can-install editing, installer details) are not in public docs. Those need King to ask platform support or look in the portal; list is in `docs/DECISIONS.md` under open questions.
4. **Commission:** model both 0% and 15% until the portal's earnings page or terms settle it.

## Still to do for the checklist

- Items 2 and 12: add a temporary logger that records only key names, `type`, `role`, `isAgencyOwner` and whether `activeLocation` is set (never names, emails or tokens), then have each kind of user open the app once.
- Read payload fields for `PlanChange`, `AppUninstall`, `InboundMessage` and `OutboundMessage`, and the installed-locations page.
- One live call to the Users API with the agency token.
