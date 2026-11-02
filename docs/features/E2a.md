# E2a: Fathom per user, end to end (the proof)

Status: **BUILT, awaiting King's checks** (2 Nov 2026, overnight run, parallel mode, worktree `C:\Users\KING\wt\E2a`, branch `stage/E2a`). Not marked passed.

Dry-run run: no real Fathom connection or webhook was created, no real token was handled, nothing was written to a real CRM contact, note, comment or field, nothing was sent to a person. `FATHOM_WEBHOOK_LIVE` and `WRITE_GHL_LIVE` are off (committed false). Everything below that needs the real Fathom or the real CRM is **NOT VERIFIED LIVE** with its exact morning test. **All evidence is from fixtures** (signed sample payloads in Fathom's documented shape, signed with a TEST secret, a fake CRM transport, an in-memory stand-in for the database), not from a live run.

## 1. Every instruction, in my own words

From `docs/ROADMAP_V2.md` (E2a, six items and the acceptance line), `docs/INTEGRATIONS_SPEC.md` sections 5 to 9 and 12, roadmap section 9 (Fathom facts), notes N32, N77, N91, N93, N96, N97 (content part), N102, N103 and S3-c, the lead's overnight constraints, and KF-1 to KF-7 where they touch these screens.

1. **Evaluate first (principle 1)** against Fathom's live public docs (read only): webhook options, what an OAuth app can read, rate classes. Record what changed against the roadmap's facts.
2. **Per-user connect.** Rotating single-use refresh tokens with the locked refresh; a webhook created per user with its own destination URL; the secret stored at creation; signature check on the RAW body (HMAC-SHA256, about 5 minute window); dedupe on the webhook id.
3. **Matching exactly as spec section 7.** Exact email only, only among accounts the person can open, internal people ignored; duplicate contacts and cross-client matches go to the Meeting inbox; never guessed.
4. **One note per meeting per matched contact, authored as the connecting user**, Recommended preset and the default template (spec 8), idempotent, a first-save preview with confirm, daily caps, an audit log, every real write logged in `crm_writes`. All of it through the dry-run client (WRITE_GHL_LIVE off: build the request, record WOULD WRITE, send nothing).
5. **The private Meeting inbox** for unmatched and ambiguous calls: private to the owner, auto-deleted after the policy period by a small expiry job on a cron route registered in the route guards (CRON_SECRET pattern); Link, Dismiss, Always ignore; built from the D0 components; the person picks the account and the contact explicitly, no auto-pick.
6. **Wording (N77):** every screen says the same true thing; the Meeting notes page stays behind its own flag `meetings` (default off) until King confirms; Connections and the Fathom card stay visible; "Needs permission: reconnect" when the optional write permission is missing; the connect screen explains the "not yet reviewed by Fathom" notice plainly (S3-c: no numbered steps for tools most people lack).
7. **E0 leftovers:** wire `removeDeactivatedPeople` (company user list only when the users permission is granted, otherwise skip and say so) and the inbox expiry.
8. **Overnight constraints:** never create a real Fathom connection or webhook, never touch real tokens; signed sample payloads, fake transports, fixture companies.
9. **Acceptance cases as tests:** two simultaneous deliveries of one webhook give one stored meeting and one WOULD WRITE; a no-match call lands in the inbox; a duplicate-contact case lands in the inbox; two attendees give two WOULD WRITE lines; a forced and a concurrent token refresh; the off switch and uninstall deletion. Every live-only clause is a NOT VERIFIED LIVE row with King's morning test.
10. **Migration** with reserved prefix `2026110213`, additive; apply only new empty tables.
11. **KF-5:** think like the customer, add small safe improvements, log them in a "Customer-eyes improvements" table; bigger ideas are PROPOSALS.
12. **Tests:** database-backed and browser tests are written, not run. End with KEEP or CUT, labelled as fixture-based.
13. **Not overwriting other stages:** keep shell-file edits small and additive; no edits to the shared log files (this file's FOR THE LEAD sections carry them).

## 2. The five evaluation lines (principle 1)

- **(a) Decision and for whom.** A rep who just finished a call decides whether to let the summary reach the contact without retyping; an admin decides whether to trust it (who is connected, what happens to a call nobody matches); King decides whether meeting notes earn their place after M1. The spec's CFO verdict stands: this is plumbing, not the thing that sells the first audit.
- **(b) Is the data truly available, tested not assumed.** Documented, not proven: Fathom's published webhook schema, signature scheme, `triggered_for` options and rate classes were read at developers.fathom.ai on 2 Nov 2026. **Not proven (NOT VERIFIED LIVE):** that an OAuth bearer token may create webhooks (the docs list bearer as a global security scheme), the exact error for a solo plan asking for the Team-only type, the OAuth token endpoint's request style, a real delivery, whether Fathom can resend a delivery, the CRM note limits (E0 assumed 3,000 characters), the company user list endpoint. Our own database part is real: the migration was applied to the live project and the Supabase proof passed for both new tables.
- **(c) Does the CRM already do it.** The CRM stores notes but has no per-person link to a meeting tool, no inbox for calls nobody matches and no admin view of who is connected. Fathom has its own CRM sync, which needs the customer's own supported CRM; ours works with the CRM they already use and keeps unmatched calls private instead of guessing.
- **(d) Simplest version that proves value.** Fathom only; one card per person; summary and action items only (transcript never requested, never stored); a plain note on the one contact that matches by exact email; everything else waits in a private inbox the person resolves in two clicks. Comment and contact-field destinations, templates and splitting are E2b.
- **(e) Risk.** Privacy and trust (S1): a call holds other people's words, so the inbox is private to the owner, nothing is ever placed by guessing, content is removed after 14 days (unmatched) or 90 days (handled), and logs hold ids only. Production behaviour: the Meeting notes page is off and both live switches are off, so merging changes nothing a customer can see except the Connections card wording and the Fathom address (the token URL fix). Scope: no new scope (`contacts.write`, `users.readonly` already optional). Cost: none. Live database: two new empty tables.

### What changed against the roadmap's Fathom facts (record, item 1)

| Roadmap said | Live docs say (2 Nov 2026) | What I did |
| --- | --- | --- |
| Token endpoint per docs is `api.fathom.ai/external/v1/oauth2/token`, check the code | Confirmed. The code used `fathom.video/.../token`. | Fixed in `oauth.ts`; test asserts the address. The sign-in page stays on `fathom.video` (the app page shows it) |
| Solo users subscribe to `my_recordings` only; two team types are Team-plan only | Confirmed, and `my_recordings` on a Team plan EXCLUDES the person's own recordings that they shared with a team (that needs `my_shared_with_team_recordings`, Team-only) | Ask for both first; if Fathom answers 400, ask again for `my_recordings` alone (`createFathomWebhook`). Other people's calls (`shared_team_recordings`) are never requested |
| Webhook can include summary, action items, transcript | Flags `include_summary`, `include_action_items`, `include_transcript`, `include_crm_matches` (all default false; at least one must be true) | We send summary and action items true, transcript false, CRM matches false (data minimisation) |
| Payload does not say whose it is | Confirmed: the `Meeting` object has `recorded_by`, `calendar_invitees` (with `is_external`), `default_summary.markdown_formatted`, `action_items[].description`, `share_url`, `recording_id` (integer), start and end times. No event type field | One delivery address per person; the recorder and anyone Fathom says is not external are never matched; recording id is the meeting's identity |
| Signature: HMAC-SHA256, reject about 5 minutes | Confirmed: `webhook-id`, `webhook-timestamp`, `webhook-signature`; signed content `id.timestamp.body`; key is the base64 part after `whsec_`; Fathom's SDK verifies the same way | Unchanged and tested with a signer that follows this scheme |
| Rate classes: 60 per minute general, heavy 30 (sometimes 5) | Confirmed; the OAuth token endpoint is also limited to 60 per minute per app; recording downloads 30 per minute separately | We make no heavy calls: a delivery carries its summary and action items already. The only calls are the webhook create and delete, the "Test connection" list read (1 item) and token refresh |
| Refresh tokens single-use, rotate | Confirmed ("can only be used once", valid until the user revokes access); access token lifetime is not stated | Locked refresh already built (E0); E2a adds a forced refresh for a refused-but-fresh token |
| OAuth apps cannot use summary and transcript on the meetings list | **Not restated** on the pages read | Not needed: we use the webhook, not the list |
| Webhook retry behaviour | **Not described** | We acknowledge only after the row is committed and release our claim on failure so a retry is accepted |

## 3. What was built

**Delivery** (`src/lib/connections/fathom-hook.ts`, route `api/hooks/fathom/[key]`): 404 for an address nobody owns, a disconnected or revoked one, a malformed key, a switched-off feature (all the same answer); 413 over 400,000 bytes; signature check on the raw body before anything is parsed; a delivery id (`webhook-id`) claimed once per connection in the new table `meeting_deliveries` (unique index, so simultaneous deliveries give one winner); parse (`fathom.ts`); store and write through `ingest.ts`; the claim is released if saving fails (answer 500, so Fathom retries). A payload that is not a usable meeting (no recording id, nothing in it) is acknowledged and dropped. The older shared connection still takes its old path in the same route.

**Matching and planning** (`meeting-plan.ts`, `ingest.ts`): E0's rules, plus: Fathom's own `is_external: false` and the recorder join the internal list; the person's "always ignore" list; no write is attempted without `contacts.write` (the call waits as "Needs permission: reconnect", in a dry run too, because a WOULD WRITE that could never succeed would mislead); the daily cap is also enforced inside one call.

**The note** (`note-template.ts`): the spec's default template, character for character; lines and headings with nothing under them are dropped; values are plain text (tags and control characters removed); the person's choices after the account's rules decide which parts appear (Summary only has no action items or recording link); over the assumed 3,000 characters the summary is cut at a paragraph boundary and says "[Shortened here. The full summary is in SubSync.]", never losing the recording link or the footer. `fillTemplate` already rejects unknown variables (E2b builds the custom-template screen on it). Written as the connecting person through `buildNote` and the dry-run client. Real writes are logged in `crm_writes` and `audit_log` (ids only).

**First-save preview** (`inbox.ts` `confirmAndRelease`): until the person confirms how the first note looks, a matching call is held in their inbox (status needs_contact, reason preview_needed, with an expiry, never kept forever). Confirming sets the confirmation and releases the held calls under today's rules; an atomic claim means two confirms write once.

**Meeting inbox** (`inbox.ts`, `inbox-store.ts`, `api/meetings-api.ts`, `views/meeting-inbox.tsx`): private to the person (every statement names installation and user id). Link: the person searches contacts only inside accounts they can open, picks the account and contact, sees the exact note, confirms; the server re-checks account access and that the contact is in that account, then applies the same rules, cap, permission and dry-run client as an automatic note. Dismiss removes the call's text and keeps only its identity. Always ignore accepts only one of the call's own attendees. Also on the page: "what happened to my recent calls" with the exact reason when nothing was saved, and the person's two choices (automatic notes on or off; keep or do not keep unmatched calls). Routes: `meeting-inbox` under `api/app` (GET, GET `<id>/contacts`, POST `<id>/link|dismiss|ignore`, POST `confirm`, PUT `settings`), open to every role because it is the person's own inbox, behind the `meetings` flag (404 when off).

**Expiry and E0 leftovers** (`maintenance.ts`, cron `api/cron/meeting-expiry`, daily 03:20 in `vercel.json`, `CRON_SECRET`, registered in `route-guards.ts` and `docs/TENANCY.md`): removes inbox calls whose time is up, handled calls after 90 days, delivery ids after 30 days, and calls `removeDeactivatedPeople` with the CRM's user list only when the install holds `users.readonly`; the list is refused when empty, shorter than the platform's own count, or when it would remove more than half of the people at once; every skip is counted with a reason in the answer (counts only).

**Connect and screens** (`connections.tsx`, `meetings.tsx`): the Fathom card says plainly what happens to a call, has an expandable "Fathom will say SubSync is not yet reviewed. What does that mean?" (why the notice appears, what is read, what is kept, how to disconnect), shows "Needs permission: reconnect" when the install lacks `contacts.write`, and, only while the Meeting notes page is on, a link with the count of calls waiting. The Meeting notes page now opens on "My Meeting inbox"; the older private-address list is under "Older meeting notes", renamed "Advanced", and uses the shared wording module `meeting-wording.ts` (merged from F8) so every screen says the same thing.

**Connect fixes:** token address (above); webhook creation falls back for solo plans; if the delivery secret cannot be stored, the new subscription is deleted rather than left unusable; "Test connection" retries once with a forced refresh when Fathom refuses a token that looked fresh.

**Migration** `supabase/migrations/20261102130000_e2a_fathom_inbox.sql`, APPLIED: `meeting_deliveries` and `meeting_ignored_emails`, both new and empty, RLS on, no policy, privileges of the public and signed-in roles revoked. Classified in `tenant-tables.ts`, `data-inventory.ts` ("What we store") and `docs/TENANCY.md`.

## 4. Evidence (fixtures, not live)

Commands I ran (the full suite and the integration chain and e2e were NOT run, per speed mode and parallel mode):

| Command | Result |
| --- | --- |
| `npx next typegen` then `npx tsc --noEmit` | no errors (before and after the merge) |
| `npx eslint` on every new and changed file | 0 errors (one older warning in `router.ts`: `buildDigest` unused) |
| `SUPABASE_DB_PASSWORD= DATABASE_URL= POSTGRES_URL= npx vitest run tests/unit/e2a-fathom-delivery.test.ts tests/unit/e2a-inbox.test.ts tests/unit/e2a-template-oauth-refresh.test.ts tests/unit/e0-ingest.test.ts tests/unit/e0-roles-policy-plan.test.ts tests/unit/e0-messages-refresh-echo.test.ts tests/unit/data-inventory.test.ts tests/unit/route-registry.test.ts` (after the merge) | `Test Files  8 passed (8)`, `Tests  151 passed | 1 skipped (152)` |
| `node --test src/lib/__tests__/` before the merge | `ℹ tests 513`, `ℹ pass 513`, `ℹ fail 0` |
| `node --env-file=.env.local --import tsx scripts/apply-migration.ts supabase/migrations/20261102130000_e2a_fathom_inbox.sql` | `Applied supabase/migrations/20261102130000_e2a_fathom_inbox.sql` |
| `node --env-file=.env.local --import tsx scripts/supabase-proof.ts` (read only) | `Supabase proof: 29 passed, 1 failed, 6 not verified live`. Both new tables: RLS on, no policy, anon and authenticated refused (7 of 7 tables), row counts 0. The one FAIL is not from E2a: other parallel stages applied tables live (`roadmap_suggestions`, `notification_*`, `client_*`, ...) that were not in my worktree at that moment, and `saved_views` is in my files; the comparison of this stage's own tables and columns is clean |

After merging `overnight/2026-11-01` (this run was cut off once by the usage limit and resumed): `npx tsc --noEmit` clean. The full pure suite then shows failures that are NOT in files this stage touches and exist on the merged branch: `tests/unit/client-access.test.ts` ("GET /people for a client", from F10's People route), `tests/unit/f5-today.test.ts` (Today no longer mounts the watching panel, F5), `src/lib/__tests__/meeting-wording.test.ts` (expects the older meeting note code to build the note URL itself; E0 moved it into the one write client, `meeting-crm.ts` is untouched by me), `scope-experience.test.ts` (Speed page lacks the shared permission words, F2/D0) and `settings-sections.test.ts` (F5 filled a slot). I list them for the lead; I did not edit those files.

Tests I wrote and RAN (pure): `tests/unit/e2a-fathom-delivery.test.ts` (29), `e2a-inbox.test.ts` (18), `e2a-template-oauth-refresh.test.ts` (19), with `e2a-support.ts` (signer, sample payload, in-memory stand-in). I changed three older assertions on purpose: `e0-ingest.test.ts` (a held first call now waits in the inbox with an expiry instead of being kept forever; a refused permission now waits as "Needs permission" instead of failing; a new test for an error answer that stays failed), `client-access.test.ts` (the inbox doors listed), `connections.test.ts` (the new token address and the `triggers` field), and the Zoom-wording allowlist counts in `zoom-hidden.test.ts`.

Tests I wrote and did NOT run (the lead runs them after the merge): `tests/unit/e2a-db.test.ts` (13 tests against the real database with fixture companies: three simultaneous deliveries give one meeting, one claimed delivery and one WOULD WRITE line; a contact with the same email in another company is never matched; no-match, duplicate-contact and two-attendee cases; the inbox is private; Link, Dismiss, Always ignore; the first-save race; missing permission; a revoked address; a forced and a concurrent refresh against the real row lock with a fake single-use Fathom; uninstall deletes everything; the daily clean-up; the new tables closed to anon and signed-in roles) and `tests/e2e/e2a-fathom.spec.ts` (4 browser tests, three widths).

### Evidence table (one row per instruction)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Evaluate against live docs, record changes | DONE | section 2 table; fixed token address and solo-plan fallback; tests in `e2a-template-oauth-refresh.test.ts` |
| 2 | Per-user connect, locked refresh, per-user webhook and address, secret stored at creation, raw-body signature, dedupe on webhook id | DONE with fixtures; live parts NOT VERIFIED LIVE | `fathom-hook.ts`, `oauth.ts`, `personal-flow.ts`, `meeting_deliveries`; tests "a delivery is refused unless it is genuinely Fathom's", "the same delivery twice gives one stored meeting and one note", the refresh tests |
| 3 | Matching as spec 7, no guessing | DONE | `e2a-fathom-delivery.test.ts` "matching is exact and never guessed" (no match, duplicate, cross-account, name or phone never matches, staff unproven, ignored, discard) |
| 4 | One note per contact, as the person, template, idempotent, preview, caps, audit, `crm_writes`, dry run | DONE with fixtures | the note test (exact text), the two-attendee test (two WOULD WRITE), preview tests, cap tests, `recordWrite` audit row. Splitting into parts: SKIPPED (E2b) |
| 5 | Private Meeting inbox, expiry job on a cron route, Link / Dismiss / Always ignore, explicit pick | DONE with fixtures | `e2a-inbox.test.ts`, `meeting-inbox.tsx`, `api/cron/meeting-expiry`. Expiry SQL against the real database: test written, not run |
| 6 | Wording (N77), flag, "Needs permission: reconnect", plain explanation of the Fathom notice | DONE | `connections.tsx`, `meetings.tsx`, shared `meeting-wording.ts`, e2e spec (written, not run) |
| 7 | E0 leftovers: removed people and expiry | DONE in code; live read of the CRM user list NOT VERIFIED LIVE | `maintenance.ts`, `decideRemoval` tests |
| 8 | Overnight constraints | DONE | no real connection, no real token, switches off |
| 9 | Acceptance cases as tests | DONE (fixtures); DB versions written, not run | listed above |
| 10 | Migration, prefix 2026110213 | DONE | applied, proof PASS for both tables |
| 11 | KF-5 table and proposals | DONE | sections 7 and FOR THE LEAD |
| 12 | DB and browser tests written not run; KEEP or CUT | DONE | section 9 |
| 13 | No edits to shared logs; small shell edits | DONE | `router.ts`, `access.ts`, `route-guards.ts`, `vercel.json`, `tenant-tables.ts`, `data-inventory.ts` got one-line additions |

### NOT VERIFIED LIVE rows (each with King's morning test)

| Roadmap acceptance clause | Why not verified | Exact morning test |
| --- | --- | --- |
| The webhook writes a row to the live Supabase project (show it) | needs a real connection and a real delivery | 1. Set `FATHOM_WEBHOOK_LIVE=true` only in the environment you test on (leave `WRITE_GHL_LIVE` off). 2. Open Connections, press Connect under Fathom with your own login, accept Fathom's "not yet reviewed" page. 3. Record a 2 minute call with a contact from KD Squares Test whose email you know (Fathom sends nothing without a summary). 4. Within a few minutes run `node --env-file=.env.local --import tsx scripts/supabase-proof.ts` and check the counts, or ask me for a read of `meetings` and `meeting_deliveries` (counts and statuses only). Expect one `meetings` row with status `needs_contact` and reason `preview_needed` (the first call waits for your OK) |
| Two simultaneous retries of the same webhook produce exactly one note | Fathom's retry cannot be triggered on demand, and a signed replay needs the secret | The simultaneous case is proven on the real database by `tests/unit/e2a-db.test.ts` (the lead runs it). Live: in Fathom's webhook settings use a resend or test button if one exists (UNSURE), then check that `meetings` and `crm_writes` still show one row for that call |
| A real note on a real contact authored as King | needs `WRITE_GHL_LIVE=true` and a real call | Switch the Meeting notes page on (`meetings` flag), open it, read the "Check how your first note will look" preview, press confirm. Then set `WRITE_GHL_LIVE=true`, record another short call with that contact, and open the contact in your CRM: one note, author King, text as in the preview. Check `crm_writes` has one row with that note's id |
| A no-match call in the inbox; a duplicate-contact case in the inbox | needs real calls | Record a call with an email that is not a contact, and one with an email that two test contacts share. Both appear under My Meeting inbox with the plain reason; Link one to a contact and check one note appears (or one WOULD WRITE line while the switch is off) |
| Two attendees write two notes | needs a real call | Record a call with two test contacts invited; expect two notes |
| A second unrelated Fathom account works | needs a second real Fathom login | Repeat Connect and one short call with a Fathom account that is not King's (a free account is enough); check its call arrives for that person only and King's inbox does not show it |
| A forced and a concurrent token refresh both work against Fathom | needs real tokens and a token old enough | Press Test connection twice quickly (and again after an hour): both answer "Fathom answered. The connection works." and `last_error_code` stays empty. The refresh-token rotation against a fake single-use Fathom is proven in `e2a-template-oauth-refresh.test.ts` and on the real row lock in `e2a-db.test.ts` |
| The off switch and uninstall deletion | needs real subscriptions | Press Disconnect on the card (with `FATHOM_WEBHOOK_LIVE=true`): the webhook disappears from Fathom's settings and the next delivery answers 404. Uninstall on a test install: `user_connections`, `meetings`, `meeting_deliveries` have no rows for it |
| Fathom accepts the bearer token to create a webhook, and a solo plan answers 400 to the Team-only type | not proven | The first Connect shows it: success means the bearer token works; if you see "we could not set up delivery ... F-HOOK" send me the code |
| Company user list for removed people | needs a real agency install and `users.readonly` | After the merge, call the cron once with `CRON_SECRET`: the answer lists counts and skip reasons; with a real agency and one connected person who is still active, `people.removed` must be 0 |

## 5. SKIPPED / BLOCKED rows (not silence)

| Row | Reason |
| --- | --- |
| Splitting a long note into "Part 1 of N" | E2b item 3. E2a cuts the summary visibly at 3,000 characters (the E0 assumed limit) |
| Comment and contact-field destinations, presets screen, custom templates, locks | E2b |
| Transcript | never requested, never stored; E2b decides |
| "Connected as" email | no Fathom endpoint is known that returns the connecting account's email; the card shows the CRM name (carried from E0) |
| A resync or poll for a missed delivery | Fathom documents no retry behaviour; reconcile by polling is a proposal below |
| Company staff matching | still proven nowhere (the Users list per staff member is unread), so staff match nothing and their calls wait in the inbox, as in E0 |
| Real note limits | still E0's assumed 3,000 characters until `scripts/ghl-write-limits.ts` runs |
| Browser run, DB run, full suite | not allowed in parallel mode |

## 6. UNSURE

1. Whether Fathom accepts an OAuth bearer token on `POST /webhooks` (docs list bearer as a global option, never shown for this call).
2. Whether the 400 fallback is the right signal for a solo plan (the docs say the type is Team-only but not the error).
3. The OAuth token request style (form body with client id and secret, as E0 built, versus a Basic header).
4. Names and duration are not stored (only emails), so a note written later from the inbox lists email addresses in "With:" and has no duration.
5. A held first call and an unmatched call share the 14 day expiry (the shortest account rule); a person who never opens the page loses them silently. The Connections card shows the count only while the page is on.
6. The Meeting notes page is off by default, so until King turns it on nobody can confirm the first-save preview, and the first call waits (and expires). That is intended for the proof; it means no note is ever written before the flag is on.
7. The users list endpoint and its pagination shape (`GET /users/search?companyId=`) are unproven; the removal step checks the answer against its own count and skips on any doubt.
8. The migration ledger of the platform lists only 5 of 34 files (carried from E0).

## 7. Customer-eyes improvements (KF-5)

| What was changed | Persona | Where |
| --- | --- | --- |
| A plain preview of exactly the note that will be written, shown before the first automatic save, with a real call when there is one and a marked sample when not | P1 skeptical owner, P3 setter | Meeting inbox |
| "What happened to my recent calls": every handled call says what happened, and when nothing was saved, exactly why ("Nothing was saved: nobody on this call matched a contact...") | P3, P2 | Meeting inbox |
| The inbox row says how many days are left before a waiting call is removed | P3 | Meeting inbox |
| Link shows the exact note before it is added and the contact's address in your CRM to double-check | P3, P1 | Meeting inbox |
| "Not a client?" Always ignore this email, next to the Link panel, for vendors and family | P3 | Meeting inbox |
| Search for a contact by name, email or phone, optionally inside one account, with the account name on every result | P2 ops, P5 | Meeting inbox |
| The Fathom notice explained before you press Connect, in two short paragraphs | P4, P1 | Connections |
| "Needs permission: reconnect" with one sentence of what that means and what still works | P2, P3 | Connections, Meeting inbox |
| A count of waiting calls with a link, on the card | P3 | Connections |
| A "Test mode" line that says plainly nothing is written to the CRM yet, instead of a note silently not appearing | P1, P2 | Meeting inbox |
| Empty states that say what to do next with one button | all | Meeting inbox |
| Dismiss removes the call's text immediately (privacy by default) | P1 | Meeting inbox |

## 8. King's 5 checks (plain words, in order)

1. Open Connections. Under Fathom you should see what happens to a call in one paragraph and a line "Fathom will say SubSync is not yet reviewed. What does that mean?" that opens a short plain explanation. Nothing mentions Zoom or Google Meet.
2. Run `node --env-file=.env.local --import tsx scripts/supabase-proof.ts`. The two new tables `meeting_deliveries` and `meeting_ignored_emails` show RLS on, no policy, anon and signed-in refused, 0 rows. (The one FAIL about migration files versus live tables is other stages' tables; ask me if it still shows after the merge.)
3. Ask the lead to run `npx vitest run tests/unit/e2a-db.test.ts` and check all 13 pass (simultaneous deliveries give one meeting and one WOULD WRITE; the inbox is private; uninstall deletes everything).
4. Confirm in Vercel that `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE`, `SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE` are not `true` and the `meetings` flag is off. Check that `vercel.json` now has the daily `meeting-expiry` cron and call it once with `CRON_SECRET`: it should answer with counts only.
5. When you are ready for the live proof, do the morning tests in the NOT VERIFIED LIVE table in order, starting with the real Connect.

## 9. Recommendation: KEEP (based on fixtures, not on a live run)

Evidence for KEEP: every acceptance case that can be tested without Fathom passes against signed sample payloads and an in-memory stand-in (66 new pure tests plus the E0 ones, 151 passing in the final run); the same properties are written against the real database for the lead to run; the migration is applied and the Supabase proof passes for the new tables; matching never guesses in any path; nothing outward happens with the switches off; no new scope. Risks that decide whether KEEP survives: the five unproven Fathom behaviours in section 6 (a bearer token creating a webhook, the solo-plan fallback, the token request style, a real delivery, a resend). If the first real Connect fails at the webhook step, fix and retest before building E2b; if Fathom's review program rules out the unreviewed notice for pilot users, narrow to King's own account first. Per the CFO verdict this is plumbing, not the thing that sells the audit: KEEP it small and do not start E2b until the live morning tests pass.

## 10. Skill note

No skill was invoked; this stage is server logic, one migration and screens built from the D0 components.

---

## FOR THE LEAD: log entry

**Stage E2a (Fathom per user, end to end): BUILT, awaiting King's checks.** Worktree `C:\Users\KING\wt\E2a`, branch `stage/E2a`, not pushed. Merged `overnight/2026-11-01` into it (conflicts in `connections.tsx`, `meetings.tsx`, `router.ts`, `tenant-tables.ts`, `client-access.test.ts` resolved keeping both sides; `tsc` clean).

- **Decisions for King (DECIDED FOR KING, please review):**
  1. A first matching call waits in the person's inbox (needs_contact, reason preview_needed, with an expiry) until they confirm the preview; the `meetings` flag being off means nobody can confirm, so no note is written until the flag is on.
  2. No attempt to write without `contacts.write`: the call waits as "Needs permission: reconnect", in dry run too.
  3. Fathom triggers: both own and own-shared-with-team first, falling back to own recordings on a 400.
  4. The OAuth token address now follows Fathom's docs (`api.fathom.ai`); the sign-in page stays `fathom.video`.
  5. Handled calls keep their text 90 days (spec 9), unmatched 14 days or the shortest account rule; delivery ids 30 days; the daily cron `meeting-expiry` at 03:20.
  6. Removal of people who left the CRM only runs with `users.readonly`, a complete list and never more than half at once.
  7. The Meeting inbox routes are open to every role (the person's own inbox), behind the `meetings` flag.
- **UNSURE:** section 6 (eight items).
- **NOT VERIFIED LIVE:** section 4 table (nine rows).
- **Migrations:** `20261102130000_e2a_fathom_inbox.sql` APPLIED to the live database (additive; two new empty tables `meeting_deliveries`, `meeting_ignored_emails`; RLS on, no policy, anon and authenticated privileges revoked). No backup needed (new tables); counts after: both 0. Held: none.
- **The full suite, the integration chain and the e2e were not run.** DB and browser tests are written, not run.
- **Failures on the merged branch that are not in this stage's files** (for the lead to route): `client-access.test.ts` (GET /people), `f5-today.test.ts`, `meeting-wording.test.ts`, `scope-experience.test.ts`, `settings-sections.test.ts`.

## FOR THE LEAD: NEEDS_KING additions

- **Section 11 ("King applies with the merge"): nothing is held.** The migration is already applied.
- **Live switches (carried from E0):** all four stay off. For the proof, `FATHOM_WEBHOOK_LIVE=true` first (King's own Connect), then the `meetings` flag on, then `WRITE_GHL_LIVE=true` for one real note. Order and exact steps are in the NOT VERIFIED LIVE table.
- **Vercel:** the new cron entry is in `vercel.json` (daily `/api/cron/meeting-expiry`); it needs the existing `CRON_SECRET`. Confirm the plan allows five crons (the file already had four).
- **Fathom app page (King):** the redirect URL registered must equal `https://subsync.kdsquares.com/api/integrations/fathom/callback` (the path the code uses; the roadmap noted `/api/oauth/fathom/callback`). Apply to Fathom's verification program when it opens (the connect screen says SubSync will).
- **Section 12 (scopes for release 2.2.0):** nothing new. `contacts.write` (notes) and `users.readonly` (removed people) are already optional scopes; the screens say "Needs permission: reconnect" without them.

## FOR THE LEAD: coverage updates

```
node scripts/notes-coverage.mjs set N32 DONE-TONIGHT "E0 + E2a: Connections page with one-click connect, Test connection, Disconnect, plain words; Meeting notes page now opens on a private Meeting inbox, older private addresses under Advanced (docs/features/E2a.md; screens built, browser run pending)"
node scripts/notes-coverage.mjs set N77 DONE-TONIGHT "one true statement on every screen via meeting-wording.ts (F8) plus E2a's inbox, preview and Test mode lines; Needs permission: reconnect when contacts.write is missing; live proof NOT VERIFIED LIVE (docs/features/E2a.md)"
node scripts/notes-coverage.mjs set N91 DONE-TONIGHT "E0 code part; Zoom stays hidden; King adds user:read:user on the Zoom app before E1"
node scripts/notes-coverage.mjs set N93 DONE-TONIGHT "unmatched, duplicate and cross-account calls wait in the person's private Meeting inbox with expiry; Link needs an explicit account and contact; Dismiss and Always ignore; never a guess (e2a-fathom-delivery.test.ts, e2a-inbox.test.ts; DB version written, not run)"
node scripts/notes-coverage.mjs set N96 PLANNED-LATER "E0 write client and limits; E2a writes the contact note only with a visible cut at 3,000 characters; destinations and Part 1 of N are E2b"
node scripts/notes-coverage.mjs set N97 PLANNED-LATER "E2a: Recommended preset and the default template (spec 8) with a first-save preview, transcript never requested; presets screen, custom templates and Part 1 of N are E2b"
node scripts/notes-coverage.mjs set N102 DONE-TONIGHT "transcript never requested or stored; inbox removal 14 days (or the account rule), handled calls 90 days, delivery ids 30 days; Dismiss removes the text at once; logs hold ids only; What we store lists the two new tables"
node scripts/notes-coverage.mjs set N103 PLANNED-LATER "E0 proof plus E2a: two new tables applied to the live project, supabase-proof.ts PASS for both (RLS, no policy, anon refused); simultaneous-delivery and refresh proofs written in e2a-db.test.ts (not run); a real webhook is NOT VERIFIED LIVE"
node scripts/notes-coverage.mjs set S3-c DONE-TONIGHT "the Fathom connect card explains the not-yet-reviewed notice in plain words with no numbered steps; the older private-address steps are under Advanced"
```

## FOR THE LEAD: proposals (for `docs/PROPOSALS.md`)

1. **Reconcile by polling** the person's recent Fathom meetings (one item page, light class) every 15 minutes, to recover a delivery that never arrived, as Zoom will need (P3, P2; medium effort, uses 1 call per person per run; risk low).
2. **Show the person's name and the call length in a note written from the inbox**, by keeping names (not only emails) with a held call (P3; small).
3. **An admin "who has calls waiting" weekly count** (numbers only, never content) so unmatched calls do not rot (P2; small).
4. **A "Resend" button in Test connection** that asks Fathom for the person's latest call and runs it through the same path, as a one-click proof for new users (P3, P1; medium; needs a heavy-class call, 1 per click).
5. **A reminder in the product** when the first call is waiting for the person's OK ("Your first call is waiting: check the note") by in-app notice, after F9 builds notices (P3; small; no outward send).
6. **Use Fathom's own CRM match** (`include_crm_matches`) as a second opinion only for the inbox suggestion, never as an auto-match (P2; medium; privacy review first).

## FOR THE LEAD: METRICS/DECISIONS text

**METRICS:** no metric changed. Meeting notes add no number to any screen; a written note is logged in `crm_writes`, so it is already excluded from reply, activity and engagement numbers (E0).

**DECISIONS (for `docs/DECISIONS.md`), 2 Nov 2026:**
- A delivery is claimed by its own id in the database before it is processed, and the claim is given back if saving fails. Reason: Fathom's retry behaviour is undocumented, and "acknowledge only after the row is committed" must also hold when two copies arrive at once.
- Fathom's token address is `api.fathom.ai` (docs), sign-in page `fathom.video` (app page). Reason: the docs are the source of truth for the API; the app page is for the browser step.
- A first call waits for the person's OK in their inbox with an expiry. Reason: the spec's first-save preview must not keep content forever.
- No write is attempted without the add-notes permission, in dry run too. Reason: a WOULD WRITE that cannot succeed misleads.
- Removal of people uses the CRM's user list only when complete and plausible. Reason: a failed or partial read must never wipe people out.

## Files changed

New: `src/lib/connections/{fathom,fathom-hook,note-template,inbox,inbox-store,maintenance}.ts`, `src/lib/api/meetings-api.ts`, `src/app/app/views/meeting-inbox.tsx`, `src/app/api/cron/meeting-expiry/route.ts`, `supabase/migrations/20261102130000_e2a_fathom_inbox.sql`, `tests/unit/e2a-{support,fathom-delivery,inbox,template-oauth-refresh,db}`, `tests/e2e/e2a-fathom.spec.ts`, `docs/features/E2a.md`.

Changed (small, additive unless noted): `src/lib/connections/{ingest,ingest-store,meeting-plan,oauth,personal,personal-flow,refresh}.ts` (ingest rewritten around `planFor`, `deliverNotes`, `settle`), `src/app/api/hooks/fathom/[key]/route.ts` (thin; legacy path kept), `src/lib/api/{router,connections-api}.ts`, `src/lib/{access,route-guards,tenant-tables,data-inventory}.ts`, `src/app/app/views/{connections,meetings}.tsx`, `scripts/supabase-proof.ts`, `vercel.json`, `docs/TENANCY.md`; tests: `src/lib/__tests__/{connections,zoom-hidden}.test.ts`, `tests/unit/{client-access,e0-ingest}.test.ts`.
