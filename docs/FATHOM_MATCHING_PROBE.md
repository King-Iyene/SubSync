# Fathom matching probe (13 Nov 2026)

Question from King: is Fathom working, and why did "Match to a lead" find nobody? Read-only look at the live database (counts only; no names, emails or meeting text were printed or are kept here).

## 1. Is Fathom receiving calls? Yes.

- 6 Fathom connections exist. Two belong to real people (the rest are demo-fill rows with identical timestamps and made-up attendees).
- Real deliveries received: 5 (one signed delivery id each, all accepted once): 4 on one connection (6, 9, 9 and 11 Nov), 1 on the other (12 Nov, about 39 hours before King looked: that is the "Last call received 39h ago").
- Real statuses: 1 added by hand (linked), 1 matched and recorded as "WOULD WRITE" (test mode, `WRITE_GHL_LIVE` off), 3 waiting (`no_external_attendee`).

## 2. What the attendee data looks like

| Real call | Invitee emails stored | Result |
|---|---|---|
| 12 Nov | 1 | matched with certainty, test mode |
| 6 Nov | 0 | had to be linked by hand |
| 9 Nov (two calls) | 0 | waiting |
| 11 Nov | 0 | waiting |

The webhook stores `attendee_emails` only. All four deliveries on the first connection arrived with **no usable invitee email** (an ad-hoc call that was not on a calendar invite carries no `calendar_invitees`; Fathom then has nobody to name). The matcher cannot match what it is not given. The cause is on the delivery, not in the matcher. Until now SubSync also stored no names and no counts, so this could not even be diagnosed. (The delivery format itself was never verified against a live payload: the parser comment says so.)

## 3. What the matcher did before this change

- Exact email only, case-insensitive on the SQL side (`lower(email) = any(...)`), looking at ALL outside attendees (not only the first), recorder and `is_external:false` invitees excluded.
- Searched `cached_contacts` of every account the person may open (company owner and admin: all installed, non-ignored accounts; company staff: only accounts proven by the Users list, and nothing is proven yet, so staff match nothing; client: own account). No "top N" cap on the cache (limit 500 rows on a lookup by email, indexed by `cached_contacts_dupe_email_idx`).
- Ambiguous (same email on two contacts, or in two accounts): the whole call waits, with a reason.
- Secondary emails: not stored in the cache (no column), so never matched.
- Manual "Match to a lead": a separate `LIKE %q%` over a concatenated name and email, ordered A to Z, top 20, phone only from 4 digits. Not the Find a lead engine. Company staff without proven access got no results at all.

Live cache facts: 10,277 cached contacts in 41 accounts, 7,447 with an email, 66 mixed-case emails (handled by `lower`), 0 with stray spaces, 137 with a plus tag, 40 emails that exist in more than one account. **16 of the 58 installed accounts have no cached contacts yet**, so a contact in one of those accounts cannot be matched until the contact sync reaches it.

## 4. Why each waiting call did not match (anonymised)

1. 9 Nov call: Fathom sent no invitee email at all (0 attendees stored). Old wording said "everyone works with you", which was wrong.
2. 9 Nov call (second): same as 1.
3. 11 Nov call: same as 1.

Nothing in these three was an email that exists in a CRM contact but was missed: there was no email to look up. The demo-fill waiting rows are synthetic (their emails exist in no cached contact) and are not evidence.

Also found: the card said "2 waiting" while the real count was 3 for one person, because it showed a running tally (`skipped_count`) that never went down when a call was linked or added later.

## 5. What changed (PR fix/fathom-auto-match)

- Reasons in plain words: "Fathom did not send anyone's email for this call" (new reason `no_attendee_emails`) versus "None of the attendees' emails is in your CRM yet" versus "Everyone on this call works with you".
- The webhook now also keeps the outside invitees' names and counts only (invitees, with email, outside) for diagnosis, and reads speaker-matched emails when the person chose to read the transcript.
- Certain stays: exactly one contact in one account the person can open has an attendee's exact email (any letter case, trimmed).
- "Possible matches" in the inbox with evidence and one click ("Add to this one", then the usual preview and confirm): the same email on several contacts or accounts, the same mailbox with a plus tag (suggestion only), the same full name as an outside invitee. Never written by itself.
- A call matched with certainty but held by a rule, a limit or a missing permission remembers the contact: "Matched to ... It will be added when notes are switched on."
- Waiting calls are looked at again by themselves: after the account's contacts sync (the sync job, every few minutes) and every night, plus a "Check again now" button. Idempotent: one winner per call, every note part claimed once, notes logged in `crm_writes` so they never count as replies or activity.
- Manual search now uses the Find a lead engine over every account the person can open (name words, email prefix, phone digits, exact email or full name first), and starts from the attendee's name or email.
- Card counts "waiting" from the calls really waiting.

## 6. Not done, and why

- Secondary emails: the cache has no column for them. Needs the contact sync to store `additionalEmails` and a backfill (touches the stable sync core). Proposed as the next step.
- Live CRM lookup by email as a fallback for the 16 accounts with no cache: not built. It needs a read through the gateway per account (rate limits) and a decision on how many accounts to ask; the better fix is to finish syncing those accounts. Proposed.
- "Create the lead" from an unmatched call: no safe contact-create exists in the write gateway, so skipped.
- Company staff matching stays empty until the Users list can prove which accounts a staff member can open (existing rule, unchanged).
- Not verified against a live Fathom payload with invitees; the next real call will fill the new counts.
