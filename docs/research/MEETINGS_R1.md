# Meeting notes (Fathom) R1 (11 Nov 2026)
Labels as in TODAY_R1.md. Builds on docs/INTEGRATIONS_SPEC.md, docs/NOTES_COVERAGE.md, docs/features/CONNECTIONS.md, E0 to E4.

## What exists
meetings.tsx, meeting-inbox.tsx, meeting-setup.tsx (about 800 lines), src/lib/connections/{fathom,fathom-hook,ingest,routing,person,inbox,note-template,policy,echo,write-log,...}.ts, src/lib/analytics/meeting-*.ts: personal Fathom connection per user, meetings land in a private inbox until matched with certainty, then written as a note on the contact when policy allows; echo guard so our notes never count as activity. VERIFIED (read). Zoom and Google Meet are specced but deferred until a pilot asks (INTEGRATIONS_SPEC.md).
Thin: notes are text only (no extracted fields), no per-rep "calls not logged" view, no action-item tasks, no proof that a sales call produced a next step.

## Platform and Fathom
- Fathom webhooks deliver transcript, summary (markdown) and action items (description, completion, assignee) after a meeting; created by POST /webhooks or in Fathom settings; at least one content flag is required; signature in the webhook-signature header; scope is own, shared or team recordings (VERIFIED: developers.fathom.ai/webhooks, nango.dev/docs/api-integrations/fathom/webhooks, hookdeck.com/webhooks/skills/fathom-webhooks.md). The API is read-only for meeting data (same sources).
- CRM side: notes on a contact need the contacts write scope (optional scope, off until reconnect). Tasks need the same. A contact can be matched only by attendee email or phone; names are not enough (rule 13).
- NOT available: Fathom data without each user connecting their own account; admin-shared connections break provider rules (rule 12); call recordings of the CRM's own dialer (no transcripts from our read scopes).

## Competitors
| Tool | Note |
|---|---|
| Fathom, Fireflies, Otter | Notetakers; Fathom has native CRM syncs for big CRMs; GoHighLevel not among its first-class integrations (INFERENCE; verify on fathom.video) |
| Zapier or Make glue | Agencies wire Fathom to the CRM by hand (INFERENCE: zapier.com Fathom templates) |
| Gong and Chorus | Enterprise call intelligence, far above the price (INFERENCE) |
No cross-account "was the meeting logged on the right contact" tool found.

## Customer pain (INFERENCE)
1. Notes live in the notetaker and not on the contact, so the next rep does not see them.
2. Copy and paste of action items; follow-ups missed.
3. Wrong contact attached = privacy breach with a client (our rule 13 exists for this).

## Biggest sources of error
- Mis-match: wrong contact on shared email (family, assistant). Only exact email or phone, else inbox.
- Duplicate delivery of the same webhook: idempotent on recording id.
- Two reps on one call: one note, not two.
- Leaking one client's meeting into another account: tenant guard plus per-user ownership.
- Echo: our note counted as activity (rule 14).

## Moat
Meeting-to-outcome link: calls held, notes logged within 24 h, next step set, then deal moved or booked. Only we hold appointments, deals and meeting notes together: "meetings with a next step convert 2x" once enough history exists (do not claim before). Minimum sample rules apply.

## What would make an owner pay
Time saved per rep per day (no copy and paste) and a "calls held but not logged" list for owners. Weak as a lone module: demand rides on whether pilots use Fathom (UNVERIFIED: ask the 5 pilots).

## Customer's-eye check
Pays? Only agencies whose closers use Fathom. Confusing: inbox vs matched vs written; say "Waiting for you to pick the contact". Lowest money priority; polish and validate with pilots before extending.
