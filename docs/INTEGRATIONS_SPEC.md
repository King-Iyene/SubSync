# SubSync Integrations and Meeting Notes: Spec v1

Save as `docs/INTEGRATIONS_SPEC.md`. Written Nov 1, 2026 after King reviewed the live Connections screen (Slack, Fathom, Zoom).

Where this file and the older E1/E2/E3 text or note N77 disagree, **this file wins**. `CLAUDE.md` still wins on security, tenancy, and scope rules. Anything marked **CHECK** was not verified in documentation and must be proven by a real test before the UI says it works (operating principle 5).

---

## 0. What was wrong (King's review, Nov 1)

| # | Gap | Why it matters | Fixed in |
|---|---|---|---|
| 1 | Zoom connect fails: "Zoom did not say who signed in" | Zoom signed the user in, then SubSync's follow-up call was refused (section 13.1). The message also uses internal wording | 13, E0 |
| 2 | Slack connect fails: "redirect_uri did not match", and Connections is stuck on "Waiting for you..." | The return address is not saved on the Slack app. The stuck state has no timeout and no retry | 13, E0 |
| 3 | "If nobody in a meeting is a known contact, save it in [client account]" | A meeting has no home in a client account without a contact, and it can leak one client's customer into another client's CRM (same risk as N48) | 5.2, 7, E0 |
| 4 | Connections are not personal | Fathom and Zoom only ever show the connecting person's own calls. A shared or agency-assigned connection cannot work and breaks the providers' rules | 2, 3, E0 |
| 5 | One save destination (contact note) | Notes may have a size limit. GHL also offers internal comments in the conversation | 5, 8, E2b |
| 6 | One fixed content type (summary only) | Users want summary, action items, recording link, transcript, or their own format | 5, 8, E2b |
| 7 | No team or role model | Several sales teams, several users per sub-account, admins who need visibility but not content | 3, 6 |
| 8 | **New, found in research:** our own writes can corrupt our own numbers | An internal comment is an outbound message, so Speed to lead could count it as a reply. Notes may make contacts look "active" | 10, E0 |
| 9 | Fathom data can only go into a note, never into a contact field | Agencies want fields they can filter, report on, and automate on | 5, 8.1, E2b |
| 10 | No split between what admins configure and what users choose | Admins must set the menu, the mappings, and the locks; users should manage only their own connection and choices | 3.1, 6 |

---

## 1. CFO verdict on scope (read this before building anything)

1. **This spec is the right design, but it is a lot, and it is not what pays rent.** SubSync's thesis is the smoke detector (silent failures in lead handling). Meeting notes is a workflow feature. It will not sell the first paid audit. Cash is about negative 14.4 million naira a month, and the gate is "2 agencies say they would pay by day 60". Keep the order: **M1 (sellable audit) first.** Writing this spec costs nothing. Building it before the audit sells does.
2. **Fathom first, and maybe only Fathom.** Fathom's notetaker joins Zoom, Google Meet, and Microsoft Teams calls (CHECK on fathom.video). One working Fathom integration therefore covers all three meeting tools for any rep who uses Fathom. A native Zoom integration only helps reps who use Zoom's own AI summaries, and that needs a paid Zoom host plan plus Zoom's app review. Build **E0 then E2 (Fathom)**. Build **E1 (Zoom) and E3 (Google Meet) only when a real pilot user asks.** King can overrule, but the evidence says do not spend the effort first.
3. **Do not build "create a new contact for an unmatched meeting".** A new contact can trigger the client's own automations (an auto text or email to a stranger) and fill their CRM with junk. It stays out until a paying user asks and the account admin turns it on.
4. **Zoom and Slack are the slowest things to get approved** (Zoom Marketplace review for users outside KD Squares; Slack needs 10 active workspaces before Marketplace submission). Neither blocks the pilot if email, in-app, and Fathom work.
5. **Time-box.** E0 and E2 are separate stages with STOP gates. If either is running long, cut E2b (custom templates and transcripts), not the privacy and per-user rules.

---

## 2. The ownership rule (the one rule everything follows)

| Kind | Examples | Who owns it | Who can connect or disconnect it |
|---|---|---|---|
| **Personal connection** | Fathom, Zoom, Google Meet | The **person** (their GHL user) | Only that person. An admin can revoke it (forcing a reconnect) but can never connect on someone's behalf or read their tokens |
| **Workspace connection** | Slack channels, the sending email domain | The **account** (sub-account). The agency may also have its own agency-level Slack for its own cross-account digest | Sub-account admin (or agency owner) |

Consequences:
- One connection row per **person and provider**, not per account. A rep who works in three client accounts connects Fathom once. Where a meeting is saved is decided by the contact match (section 7), never by a setting.
- Every write into the CRM is made **as that person** (the note's author is their GHL user), so the CRM shows who it came from.
- Removing a person (deactivated GHL user) or uninstalling deletes their tokens, revokes the webhook subscription at the provider, and removes their stored meetings. This is part of the uninstall test.
- A "shared team connection" does not exist. If a manager wants team coverage, each rep connects their own. (Optional later: a Fathom Account Admin can connect and see team-shared calls. That is still that admin's personal connection, flagged "covers team calls", and needs the sub-account admin's consent. CHECK; Tier 3.)

---

## 3. Roles: who sees what

SubSync already knows the signed-in GHL user (id, name, role, account). Use that, not a typed name.

| Action | Sub-account user | Sub-account admin | Agency staff (own accounts) | Agency owner |
|---|---|---|---|---|
| Connect my own Fathom, Zoom, Meet | Yes | Yes | Yes | Yes |
| Set my own save preferences | Yes | Yes | Yes | Yes |
| See my own meetings and Meeting inbox | Yes | Yes | Yes | Yes |
| See **who** has connected (names, status, last activity, counts) | No | Yes (own account) | Yes (their accounts) | Yes (all) |
| Read another person's meeting content inside SubSync | **No** | **No** | **No** | **No** |
| Revoke someone's connection | No | Yes | Yes | Yes |
| Connect Slack and set alert routing | No | Yes | Yes | Yes |
| Set account policy (section 6) | No | Yes | Yes | Yes |
| Set agency default policy | No | No | No | Yes |

Managers read summaries where everyone already reads them: on the contact in the CRM. SubSync's own copy is private to the person who recorded it.

### 3.1 Who configures what (the admin sets the menu, the user chooses inside it)

| Level | What they control |
|---|---|
| **Agency owner** | The agency default policy for all accounts: allowed destinations, transcripts in the CRM, retention, caps, which settings are locked. Sees status across all accounts |
| **Sub-account admin, and agency staff for that account** | The **account setup**: which destinations are allowed (note, comment, contact field), the **field mapping** (which SubSync item fills which GHL custom field), the account's default preset for new users, which settings are **locked** (users cannot change them) or **open**, Slack and its routing, who has connected, and revoking a connection |
| **User** | Only their own: their Fathom connection, their choices among what the admin left open (preset, unmatched meetings, source priority), their own Meeting inbox, and later their own calendar connection |

A locked setting shows the user its value and one plain line: "Set by your admin."

**Slack and Fathom are opposites on purpose:** Slack is **one connection per account** (an admin connects it, with several channels allowed), plus optionally one for the agency itself for its own cross-account digest. A client's Slack never receives another client's data. Fathom is **many connections, one per user**.

### 3.2 Agency users (how they fit)

GHL tells SubSync who is signed in: user id, agency (company) id, role (admin or user), type (agency or location), the active account when the user is inside one, and whether the user owns the agency. SubSync therefore recognises five kinds of person:

| Person | How SubSync knows | What they are |
|---|---|---|
| Agency owner | type agency, owns the agency | Everything an agency admin is, plus the agency default policy |
| Agency admin | type agency, role admin | Admin of **every** account in the agency that has SubSync |
| Agency staff | type agency, role user | A user in the accounts they have access to |
| Account admin | type location, role admin | Admin of their own account only |
| Account user | type location, role user | A user in their own account only |

Rules:
1. **One person, one connection, many accounts.** A person is identified by (company id, user id). An agency user connects Fathom **once**, and it works for every account they can access. They never connect again per client.
2. **Where a meeting lands is decided by the contact match** (section 7), only among accounts the person can access. Agency owners and admins reach every agency account that has SubSync. For agency staff, SubSync checks the account's user list (needs `users.readonly`), and if it cannot prove access it does not write: the meeting goes to the Meeting inbox. **CHECK** by test which users the GHL user list shows for agency admins and for agency staff.
3. **The rules of the target account apply, meeting by meeting.** Field mapping, allowed destinations, locks, caps, and retention are per account. An agency user's own choices (preset, unmatched meetings) stay with the person but are clipped by the target account's policy and the agency default (most restrictive wins). The write log records when a choice was clipped and why.
4. **The CRM shows who did it.** The note is written as the agency user, so the client sees that staff member's name, as with any other GHL activity.
5. **The Meeting inbox is personal and spans accounts.** Each candidate contact shows its account name. The person must pick the account and the contact explicitly. No auto-pick.
6. **Agency owner and admin screens:** an agency-wide status table (every user in every account, by provider, status, counts, never content), the agency default policy, and an account picker to open any account's setup as that account's admin. A client's account admin sees only that account's table. Agency staff who have access appear in it as "Agency team".
7. **Slack:** one per account for the client's own team, plus optionally one for the agency itself (connected by the agency owner or an agency admin) for the agency's cross-account digest. A client's Slack never receives another client's data.
8. **Agency-level launch:** a user who opens SubSync at agency level (no active account) gets My connections and, if owner or admin, the agency-wide table, the default policy, and the account picker. **CHECK** with a real agency user that the app opens in this context. The Agency view built earlier suggests it does.

---

## 4. Verified facts (research, Nov 1, 2026)

**GHL, notes.** `POST https://services.leadconnectorhq.com/contacts/{contactId}/notes` creates a note. The author can be set with `userId`. Other contact write endpoints in the same docs use scope `contacts.write`. **CHECK** the exact scope shown on the Create Note page. **CHECK** by test: the real maximum note length (try 1,000 / 5,000 / 10,000 / 30,000 characters in a test account), whether line breaks render, whether HTML is allowed. The documentation found does not state a limit, so King's "notes have a limit" is unverified until tested.

**GHL, internal comments.** `POST /conversations/messages` with `type: "InternalComment"`, `contactId`, `message`, and optional `userId` (who is posting) creates a comment in the contact's conversation. It needs scope `conversations/message.write`. GHL's webhook docs say internal comments are visible only to internal users and are never sent to the contact. The comment arrives as an outbound message with `messageType: InternalComment`. The send-message docs mention one field as "required for InternalComment" in a way that is ambiguous. **CHECK** by test which field it is, whether a conversation is created when the contact has none, the maximum length, and whether it can be deleted.

**Zoom.**
- `GET /v2/users/me` for a user-managed app needs scope `user:read:user`. Without it, Zoom's developer forum shows the exact error "Invalid access token, does not contain scopes [user:read:user:admin, user:read:user]". This is the most likely cause of King's Zoom failure. King's pasted callback shows Zoom did send a valid code and state, so the sign-in itself worked.
- Summaries: `GET /meetings/{meetingId}/meeting_summary` (scope `meeting_summary:read`; the granular name may differ, so use the Zoom scope picker and search "summary"). Webhook `meeting.summary_completed` carries the summary text, a link to the full summary, the sections, and next steps.
- Requirements: the **host** needs a Pro, Business, or higher plan, and the host's "Meeting Summary with AI Companion" setting must be on. Encrypted (E2EE) meetings have no summary. Meeting UUIDs that start with `/` or contain `//` must be double-encoded.
- A September 2026 Zoom forum post reports `meeting.summary_completed` not being delivered to a development-mode General OAuth app even though the summary existed. So **never rely on the webhook alone**: also poll the summaries list on a schedule (section 15, E1).
- Scope changes: users who authorized before a scope was added must authorize again.
- Distribution: a user-managed app lets each user authorize individually. To let users outside KD Squares' own Zoom account use it, expect to need Marketplace review or Zoom's "Publishable URL" approval, a deauthorization endpoint (delete the user's data when Zoom calls it), a logo, terms, and privacy links, and separate development and production credentials. Review takes time, so start only when E1 is approved.

**Fathom** (from roadmap section 9, still true): a token sees only the connecting user's calls (and calls shared with them); refresh tokens rotate; webhooks are created per user and the secret is shown once; separate destination URL per user; the summary webhook fires once when ready. **CHECK** against the live docs whether webhooks can be told to include or leave out the transcript, summary, and action items. If they can, request **only what the user chose to save** (data minimisation).

---

## 5. What each person controls

### 5.1 My connections (every user)

One card per provider (Fathom, Zoom, Google Meet later). Each shows: **Connected as** (the provider account email), status, last meeting received, **Test connection**, **Disconnect**. States: Not connected, Waiting (max 2 minutes, then "This did not finish. Try again."), Connected, **Needs reconnect** (with the reason in plain words), Error (with a code the user can send us).

Later personal connections (not built now): the user's own calendar. Do not build it until King says what it must do (section 16, question 6).

### 5.2 My meeting notes (every user, inside what the admin allows; replaces the old account setting)

**A. What to save and where.** A small table: each item can go to **Contact note**, **Conversation comment** (internal, not visible to the contact), **Contact field** (a GHL custom field the admin has mapped, section 8.1), or **SubSync only** (not written to the CRM). A user can change only the destinations the admin allowed and the items the admin left open. The rest show "Set by your admin".

| Item | Default | Notes |
|---|---|---|
| Summary | Contact note | |
| Action items | Contact note | |
| Recording link | Contact note | A link, not the video |
| Attendees and date | Contact note | Part of the header |
| Transcript | **Not saved** (SubSync only: off) | Full text only if the user turns it on **and** policy allows (section 6). A link to the transcript in the provider is the safer default |

Presets, so nobody has to design a table: **Recommended** (the defaults above), **Full record** (adds the transcript as a conversation comment, split into parts if long), **Summary only**, **Custom** (the table plus a template, section 8).

**B. If nobody in the meeting is a known contact** (replaces the client-account dropdown, which is removed):
- **Keep it in my Meeting inbox so I can link it** (default). It is shown only to me and auto-deletes after the retention period (default 14 days).
- **Do not keep it** (only counted).
- (Not built: create a contact. See section 1, point 3.)

**C. If two tools recorded the same meeting:** use my preferred source (default Fathom, then Zoom, then Meet). The other is logged as a duplicate and not written.

**D. First automatic save:** before the first automatic write, show a preview and require the user to confirm. After that, saves are automatic.

**E. Master switch:** "Save meeting notes to the CRM" on or off. Off still allows the Meeting inbox.

---

## 6. Account policy (limits, not choices)

The agency owner sets defaults; the sub-account admin can only make them stricter. The effective rule is the **most restrictive** of agency default, account policy, and the user's own choice.

| Policy | Default |
|---|---|
| Allow writing to the CRM at all | On |
| Allow transcripts to be written to the CRM | **Off** |
| Allowed destinations | Note and comment (contact fields only after the admin has set the field mapping) |
| Meeting inbox retention | 14 days (max 30) |
| Which providers may be connected | All |
| Daily write cap | 50 per user per day, 200 per account per day |
| Internal domains (excluded from matching) | Auto-filled from the account's user emails, editable |
| Field mapping (section 8.1) | None until the admin sets it |
| Locked settings (section 3.1) | None (everything open to users) |

Admin view (status only, never content): one row per user, provider, status, last activity, meetings received this week, saved, waiting in inbox, failed.

---

## 7. Matching and routing rules (no guessing)

1. Match **external attendees** by email against contacts in the accounts that **this person can access**. Internal attendees (the account's users and listed internal domains) are ignored.
2. Exactly one contact for an attendee: write there. Several attendees each match a different contact: write to each (cap 5 contacts per meeting).
3. **One attendee email matches several contact records** (duplicates): do not guess. Send to the Meeting inbox with the reason.
4. A match is found in **more than one client account** (same email in two clients): never auto-pick. Send to the Meeting inbox. (Same reason as N48: no client's customer data reaches another client's CRM by accident.)
5. A sub-account user is only ever matched inside their own account. There is no setting to choose another.
6. No match: follow 5.2 B. The Meeting inbox lets the person search a contact (inside accounts they can access), confirm, and save. They can also dismiss, or "always ignore this email".
7. Idempotent: one write per meeting per destination, keyed by (person, provider, provider meeting id). A retry never duplicates. If the meeting summary is updated later, do not rewrite (Fathom fires once; Zoom updates are ignored in v1).

---

## 8. Content, size limits, templates

**Default template:**
```
Meeting: {title}
Date: {date} ({duration})
With: {attendees}
Recorded by: {rep}, with {tool}

Summary
{summary}

Action items
{action_items}

Recording: {recording_url}

Added by SubSync from {tool}.
```
Custom templates may use: `{title} {date} {duration} {rep} {attendees} {summary} {action_items} {recording_url} {transcript_url} {transcript} {tool}`. Variables are inserted as plain text (never as HTML), trimmed, and capped. Unknown variables are rejected when saving, with a live preview.

**Size.** Find the real limit (section 4, CHECK) and write it to `docs/features/E0.md`. If content is longer than 90 percent of the limit: split at paragraph boundaries into "Part 1 of N" items. For notes, the first part holds the summary and action items. If a transcript exceeds a sensible size (default: more than 3 parts), save a link instead, and say so in the note.

**Data minimisation.** Request from the provider only the items the user chose to save. No transcript request if transcripts are off.

### 8.1 Contact fields (GHL custom fields)

A contact field holds **one current value**, so it answers "when did we last meet?" and "what is the next step?", while notes keep the history.

- **How it is written:** update the contact with the field's id and value (`PUT /contacts/{contactId}` with a `customFields` list). This needs `contacts.write`. To show the admin the account's existing fields, SubSync reads the field definitions (a `locations/customFields` read scope; CHECK the exact name in the scope picker). Creating fields for the admin is a separate optional write scope.
- **Mapping (admin, per account):** each SubSync item maps to one field the admin picks from the existing contact fields, or with one click "Create the standard fields for me" (optional scope). Standard fields: Last meeting date, Last meeting summary (short), Next steps, Recording link, Last meeting with (rep name). Nothing is mapped until the admin does it.
- **Ordering rule:** overwrite a field only if this meeting is **newer** than the meeting that filled it (compare meeting dates). A late or retried webhook must never replace newer data.
- **Type rule:** write the right type for the field (a date into a date field, text into a text field). A mismatch or a too-long value is cut or skipped with a visible reason in the log, never half-written. CHECK the maximum length of a text field by test.
- **Warnings the admin sees, in plain words, before turning it on:** (1) a field value can be merged into emails and texts sent to the contact, so do not map a sensitive summary into a field you use in messages; (2) updating a field can start your own automations that watch that field.
- **Defaults when the admin first maps:** Last meeting date and Next steps on; Last meeting summary and Recording link off.
- **Metrics:** field writes are SubSync-caused events and are excluded like notes (section 10).

---

## 9. Privacy and consent

- A meeting involves other people's voices. Summaries can contain health, financial, or other sensitive details. Transcripts multiply that. Hence: transcripts off by default, admin policy can forbid them in the CRM, and every screen says what is stored.
- Recording-consent laws vary by country and state. SubSync does not manage consent. Each user is responsible for telling participants. The connect screen says so in one plain line.
- "What we store" lists meetings (summary, action items, recording link, attendee emails, optional transcript), connections (tokens, encrypted), and the write log. The schema-driven "What we store" test (N83) must fail if any of these is missing.
- Retention: the Meeting inbox deletes after the policy period. Stored meetings that were saved to the CRM keep summary and metadata for 90 days (default, editable), then keep only the write log (ids and times). Uninstall and "Delete my data" remove everything (tested).
- Fathom shows "not yet reviewed by Fathom". The connect screen and Trust page explain it (roadmap section 9).
- Never log summaries, transcripts, or tokens. Errors log ids and codes only.

---

## 10. Our own writes must not distort our own numbers (new)

1. **Internal comments are outbound messages.** Speed to lead and Unanswered messages must exclude `messageType: InternalComment` (ours and users') from "replied". Add a test using a real internal comment.
2. **Notes may update a contact's activity date.** "Quiet over 90 days", "never engaged", and any "last activity" metric must ignore events caused by SubSync. Keep a write log (`crm_writes`, with the note or message id) and ignore any webhook or timestamp that matches it. CHECK what a note does to the contact's dates by test.
3. **No loops.** When SubSync creates a note, GHL may fire a note-created webhook. Drop events whose id is in the write log.
4. Tag every note with "Added by SubSync" so a human can tell.
5. **Custom field writes change the contact's updated date and can start the client's automations.** Treat them like notes: log them, exclude them from activity metrics, and show the admin the warning in section 8.1.

---

## 11. Data model (sketch; follow CLAUDE.md tenancy rules)

- `user_connections`: id, installation_id, company_id, ghl_user_id, provider, provider_account_email, scopes_granted, access_token_enc, refresh_token_enc (rotating, locked refresh), expires_at, webhook_id, webhook_secret_enc, status, last_ok_at, last_error_code. Unique on (ghl_user_id, provider).
- `meeting_note_settings`: ghl_user_id, content_matrix (json), preset, unmatched_mode, source_priority, preview_confirmed_at, master_switch.
- `meeting_policies`: scope (agency or account), flags (json, including which settings are locked), set_by, set_at.
- `field_mappings`: id, location_id, item (last_meeting_date, summary, next_steps, recording_url, rep), ghl_custom_field_id, enabled, set_by, set_at.
- `meetings`: id, owner_ghl_user_id, provider, provider_meeting_id, started_at, title, attendee_emails, summary, action_items, recording_url, transcript_ref, status (saved, needs_contact, duplicate, skipped, failed), reason, expires_at.
- `crm_writes`: id, meeting_id, location_id, contact_id, kind (note, comment, or field), ghl_id, part_no, created_at, undone_at.
- All rows tenant-scoped. Tokens encrypted at rest. Provider tokens are never readable by any other user, role, or the agency.

### 11.1 Supabase rules (each one must be proven on the LIVE project, not only in tests)

1. **Migrations are files in the repo and are applied to the live Supabase project.** A check compares the repo's migration list with the live project and fails if they differ. "Works locally" does not count.
2. **Row level security is on for every new table**, with policies that follow the tenancy rules in `CLAUDE.md`. Test with real roles. No new table is readable with the public (anon) key.
3. **Tokens are encrypted before they are saved** (app-level encryption with a key held in Vercel, or Supabase Vault). Only server code can decrypt them. The service-role key lives only in server environment variables, never in the browser bundle and never in a `NEXT_PUBLIC_` variable.
4. **Webhook handlers have no signed-in user**, so they use the server client. Verify the signature first, then write, and return success only after the row is committed. Failures log a code and an id, never content.
5. **Idempotency lives in the database**, not only in code: unique constraints on `meetings` (owner, provider, provider_meeting_id) and on `crm_writes` (meeting_id, contact_id, kind, part_no), with inserts that ignore conflicts. Test two simultaneous retries of the same webhook: exactly one note results.
6. **One token refresh at a time** (Fathom's refresh token is single-use): take a row lock or advisory lock in Postgres around the refresh. Test two simultaneous refreshes.
7. **Serverless connections:** use Supabase's pooled connection from Vercel functions, so webhook bursts do not exhaust connections.
8. **Proof, written to `docs/features/E0.md` and `E2a.md`:** the list of new tables with row counts read from the live project after the real test; the names (never the values) of the Supabase environment variables present in Vercel Production; one row each from `user_connections` (token column unreadable), `meetings`, and `crm_writes` whose note id matches a note visible in the CRM.
9. **Capacity:** webhooks plus the 15-minute reconcile add load. The upgrade to Vercel Pro and Supabase Pro stays a condition before charging real customers (roadmap pending list).

---

## 12. Screens and plain-word copy

**Connections page** (Settings, Integrations): two sections, "My connections" and "Team connections (admins)". The pending state expires with a retry. Each personal card says "Connected as name@email".

**Meeting inbox** (inside Meeting notes, shown only to the owner): a list with title, date, attendee emails, reason it needs a contact, and the actions Link, Dismiss, Always ignore.

| Situation | Message |
|---|---|
| Waiting too long | "This did not finish. Try again." |
| Zoom: could not read the account | "We could not confirm which Zoom account you used. Try again. If it happens again, send us this code: Z-IDENT." |
| Slack: return address refused | "Slack refused the connection. This is a setup problem on our side, not yours. Contact us and we will fix it within 24 hours. Code: S-REDIRECT." |
| Needs a permission we do not have | "Needs permission: reconnect." |
| Provider does not offer it | "Not available from [provider] yet." |
| No contact found | "Nobody in this meeting is in your contacts. It is in your Meeting inbox for 14 days." |

---

## 13. Fix now

### 13.1 King's three actions (no code)

1. **Slack:** api.slack.com/apps, SubSync, **OAuth & Permissions, Redirect URLs**: add exactly `https://subsync.kdsquares.com/api/integrations/slack/callback`, then click **Save URLs** (a separate click). Compare the Client ID in Basic Information with `4475622980481.12455703070615`: they must match. Then in SubSync, Disconnect or cancel the stuck "Waiting for you..." and connect again.
2. **Zoom (optional now, because Zoom is hidden until E1):** marketplace.zoom.us, your SubSync app, **Scopes**: add **`user:read:user`** (Users, "View a user"). Save. In SubSync, click Connect Zoom again (anyone who connected before must reconnect). Do not add other scopes until E1.
3. **Fathom:** leave "If nobody in a meeting is a known contact" on **Do not save it (just count it)**. Do not pick a client account.

### 13.2 Claude Code (inside S0.2b, small)

Remove the "save unmatched meetings into a client account" setting everywhere (UI, API, stored value), migrate existing values to "Do not save", and test that no code path writes a meeting to a contact that was not matched by email. Hide Zoom and Google Meet behind a flag that is off by default (King's decision, Nov 1): the card, every text mention, and the listing copy, while keeping the code, the Zoom app registration, and the callback route. **Slack and Fathom stay visible.** Everything else waits for E0.

---

## 14. Scopes and release impact (release 2.2.0, batched)

Add as **optional**, with a plain reason each: `contacts.write` (create notes and update fields), `conversations/message.write` (internal comments), `users.readonly` (names; may already be planned in F2), and a custom-field read scope (show the admin the account's fields for mapping; CHECK the exact name). Add a custom-field write scope only if King wants the one-click "Create the standard fields for me". Check which of these the app already requests (the current count is 21) and add only what is missing. Each new scope forces re-approval on every install, so these go into the single 2.2.0 version with the pricing change. Without the optional scope granted, the master switch is disabled with "Needs permission: reconnect".

---

## 15. Build stages

The stage prompts live in **one place only: `docs/ROADMAP_V2.md` section 7** (E0, E2a, E2b, and E1 and E3 on demand). They implement this spec. Do not copy stage text into this file, so there is only one version to keep true.

| Stage | What it builds | Sections of this spec |
|---|---|---|
| E0 | Per-user connections, roles, agency users, policy, write log, Supabase proof | 2, 3, 6, 10, 11 |
| E2a | Fathom end to end with notes and the Meeting inbox | 5 to 9 |
| E2b | Comment and contact-field destinations, content options, admin setup and locks | 3.1, 5, 6, 8, 8.1 |
| E1, E3 | Zoom and Google Meet, only when a pilot user asks | 4 |

---

## 16. Defaults assumed (King can overrule any) and the questions

Defaults: Recommended preset; Contact note destination; unmatched goes to the Meeting inbox for 14 days; transcripts off and forbidden in the CRM by policy; caps 50 and 200 a day; Fathom preferred over Zoom over Meet; first-save preview required; admin sees status only.

Questions for King (answer only if you disagree with the default):
1. Remove the "unmatched meeting into a client account" option now, for privacy? (Recommended: yes.)
2. Fathom first, with Zoom and Google Meet only when a pilot user asks? (Recommended: yes.)
3. Who may allow transcripts in the CRM: sub-account admin only (default), or each user?
4. May a sub-account admin see **who** connected (names and status, never content)? (Default: yes.)
5. Teams: group users by a SubSync Team list (built later, with the Team directory), or only by GHL roles? (Default: SubSync Team list; E0 just stores no team.)
6. "Calendar": you said each user manages their own calendar. Should that connect their Google or Outlook calendar (for example to match meetings to booked appointments), or is it the GHL calendar they already use? Not built until you answer.

---

## 17. Sources (Nov 1, 2026)

- HighLevel API documentation: Create Note, Get All Notes, Update Note (marketplace.gohighlevel.com/docs/ghl/contacts); Send a new message with type InternalComment (docs/ghl/conversations/send-a-new-message); OutboundMessage webhook with Internal Comment example.
- Zoom developer documentation: Meetings API, Get a meeting or webinar summary; granular scopes (user:read:user); meeting summary changelog (Nov 20, 2023, webhook `meeting.summary_completed`); Zoom developer forum threads on `/users/me` scope errors, summary content, and a September 2026 report of the summary webhook not arriving for a development-mode app; third-party guides on user-managed apps, the Publishable URL approval, and the deauthorization endpoint (CHECK those two against Zoom's own pages before E1).
- Fathom: developer docs as summarised in roadmap section 9 (CHECK against live docs).
- Slack: the redirect error text King captured on Nov 1.
