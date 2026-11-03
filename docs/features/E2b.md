# E2b: Save destinations (note, comment, contact field) and content options

Status: **BUILT, awaiting King's checks** (3 Nov 2026). Everything stays behind the Meeting notes switch (`meetings`) and the dry-run switches (`WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE` off). No real CRM, Fathom, Slack or email call was made: the CRM transport in every test is a fake, field definitions come from a fake reader. All evidence is fixtures plus a throwaway local Postgres. Marks: VERIFIED = proven by a test here; INFERENCE = reasoning; CHECK = needs the real service.

## Evaluation (principle 1)
- (a) Who and what next: a rep wants the call in the right place on the contact; an account admin wants one layout and the CRM fields filled; the company owner sets defaults once. DECISIONS.md has the two lines.
- (b) Data: the call content comes from E2a. CRM write shapes (note, internal comment, field update) are the E0 shapes, **CHECK** live. Field definitions need the optional read permission `locations/customFields.readonly` (already in the scope list). The comment destination needs `conversations/message.write`, which is **not** in the app's scopes and which the Trust page says is never asked for (see decisions below).
- (c) The CRM stores notes but cannot split by tool, lock a layout per account or keep older calls from overwriting newer field values.
- (d) Simplest proof: the table, four layouts, field mapping with newest-wins.
- (e) Risk: a field write can start the client's automations or be merged into messages (two warnings, acknowledgement required); transcripts (off by default, never stored by SubSync).

## What was checked against the code, and what was built
| # | Item | State |
|---|---|---|
| 1 | Comment and contact-field destinations | Built. `delivery.ts`, `contact-fields.ts`, `ingest.ts`. Limits are E0's ASSUMED ones (note 3,000, comment 2,000, text field 500) plus an assumed 2,000 for a long text field. Real values still need E0's morning test (`scripts/ghl-write-limits.ts`) |
| 1 | Spec 8.1 | Admin mapping (`field_mappings`, UI "Account setup"), newer wins (lock per contact + `field_write_state`), type rules (date to date or text, text to text, link to text, cut at a word or skipped with the reason), two warnings with acknowledgement, field writes logged in `crm_writes` so they are excluded from activity numbers |
| 2 | Table, presets, templates | Built. Table with reasons for greyed options, four layouts, own layout with live preview that rejects unknown words (also wrong capitals and spaces) |
| 3 | Parts | `content-split.ts`: over 90 percent of the limit splits at paragraph, then line, sentence, word. A transcript needing more than 3 parts becomes a link |
| 4 | Transcript | Off by default. Written only if the person's table has it AND the account (and company) allow it. Fathom delivery's transcript is not even read unless the choices could use it; the webhook is created asking only for what is chosen. SubSync never stores the text (schema check added) |
| 5 | Source priority | `source-priority.ts`, wired into ingest. Never two notes: preferred tool wins while possible, a note already written is never doubled. Cannot fire for real until Zoom exists |
| 6 | Admin setup and locks | Per account: allowed places, default layout, unmatched default, 4 locks ("Set by your admin"). Company owner defaults editor. Company layer sits above account |

## Extra within scope (principle 2)
The "What will happen" preview shows per destination exactly what a sample call becomes, and for fields the value, the cut, or the plain reason it is skipped.

## Things found and decided (King to confirm)
1. **E0 gap fixed.** With no company rule saved, the company layer used the careful defaults, so a business that installed the app itself could never allow a field or a transcript. Now "no company rule" limits nothing; a saved company rule is a ceiling. E0 tests still pass.
2. **Per-part idempotency** moved into the database: the right to write a part is taken in `crm_writes` before the write and given back if it fails (E2a only logged after).
3. **Comment permission.** `conversations/message.write` is not in `GHL_SCOPES`, and `trust-truth.test.ts` asserts it never is. Until King decides (add as optional in the 2.2.0 batch and reword the Trust page: "internal comments only, never sends to a contact"), a comment choice is clipped to "SubSync only" with "Needs permission: reconnect". Nothing was changed in scopes.
4. Transcript turned on after connecting: Fathom fixes what a webhook carries at creation, so the person must reconnect once (said in the UI). Whether Fathom can update a webhook is **CHECK**.
5. "Create the standard fields for me" (optional write scope) is NOT built (PROPOSAL, needs a new scope).
6. A transcript is not available for a call linked later from the inbox (never stored); such a call gets no transcript item.

## Evidence
- New tests: `tests/unit/e2b-pure.test.ts` (56), `e2b-ingest.test.ts` (32), `e2b-db.test.ts` (19, real local Postgres), support `e2b-support.ts`. Full `tests/unit`: 700 passed, 2 failed (`token-storage`, `sync-reliability-db` need real installs in the database; they fail on an empty local DB regardless of this stage). Node tests banned-terms, zoom-hidden, trust-truth, meeting-wording pass. `tsc` and `eslint` clean.
- Migration `supabase/migrations/20261103090000_e2b_setup.sql` applied twice to the local DB (idempotent): tables `field_mappings`, `field_write_state`, columns `meeting_note_settings.custom_template`, `preset_chosen`. Registered in `tenant-tables.ts` and `data-inventory.ts`; schema drift and purge tests pass.
- Acceptance: field written only when mapped (ingest test, DB test); older meeting never overwrites newer, including two at once under the lock (DB test); locked setting refused with "Set by your admin" (API test, 409) and also overridden at write time; long summary splits in both destinations; transcript only when user and policy allow; Speed to lead and "waiting" ignore our comment (test with the platform's message shape); echo of our own write is dropped by id.
- Browser (Chrome, demo data, dev server port 3103, stopped): page renders at 1280 and 390 wide, no sideways scroll, no console errors, bad layout word is refused with the word named, no banned terms.

## NOT verified live
Real note, comment and field limits and rendering; field data type names and date format; whether a comment creates a conversation; field update starting automations; Fathom transcript delivery and webhook update; the custom-fields read; the real Users-list access for staff (unchanged from E0).

## King's 5 checks
1. Meeting notes > "What to save and where": pick Custom, write a layout with `{nope}`: it is refused with that word named; remove it and the preview updates.
2. Account setup (as an admin): choose a Next steps field. Without ticking the warnings box the Save button stays off. Turn on "Contact field" afterwards.
3. Lock "default layout" for an account, then sign in as a plain user of it: the layouts are greyed with "Set by your admin."
4. With the write switch still off, send a test Fathom call: the audit log shows `WOULD WRITE crm.field.update` and nothing reaches the CRM.
5. On KD Squares Test only, run the E0 limits script, paste the table, and set `ASSUMED_LIMITS`; then switch `WRITE_GHL_LIVE` on for one call and look at the note, the comment and the field on a `zz` contact.

## Recommendation: KEEP
Contained behind the flag, additive, 700 tests green, nothing sent. Cut candidate if time is short: custom layouts and the source-order list (no user until Zoom).
