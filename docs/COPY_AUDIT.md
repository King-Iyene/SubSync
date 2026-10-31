# Copy audit (31 Oct 2026)

Method: a search of every user-facing string in `src/app` and `src/lib/analytics`, plus the screens seen live.

## Internal and forbidden terms (brief 13A and 13B)

| Term | Where | Verdict |
| --- | --- | --- |
| "GoHighLevel", "HighLevel", "GHL" | Nowhere in the app UI. An automated test also scans for it | **Clean (verified)** |
| "sub-account" | Nowhere in the app UI | **Clean (verified)** |
| "Agency view" | `src/app/app/dashboard.tsx:279`, sidebar footer on every page | **S1**: brief 13B says rename it |
| "agency" in user text | 5 view files, for example "your agency", "the agency", "Agency users", "an agency" | **S2**: brief 13B says internal terms must not appear in end-user content. Use "your team" or the agency's own brand name |
| "location" | Not found in UI strings | Clean |

## Claims that are no longer true

- `meetings.tsx:92` says SubSync does not write into your CRM and needs a write permission it does not ask for. **False since 31 Oct.** (UX-03)
- The same page tells users to connect Zoom through Zapier or Make. A direct Connect Zoom now exists.
- Duplicates subtitle says "SubSync never changes your contacts: you merge in the platform". Data cleanup, on another page, does change contacts after a preview. The two pages disagree.
- Pro plan line in the developer portal reads "All views, alerts and exports". Exports exist for some pages only. Not changed (it is in the portal, King's step). Keep it honest before the plan swap.

## Jargon a non-technical buyer will not understand

Files using the term: SLA (11), stale (14), win rate (8), engagement score (6), dormant (6), churn (5), median (4), P90 (1), dwell (1). A local business owner (P4) has no way to read "SLA breach", "engagement score" or "P90".
Fix: plain words ("missed reply deadline", "health score", "slowest 10%"), each with a one-line "what this means" on tap.

## Too much text

Page subtitles run to about 190 characters and three lines before any content (Accounts, Alerts, Duplicates, Data cleanup, Clients, Meeting notes, Setup). Target: one sentence under 90 characters per page, details behind a "How is this calculated?" link.

## AI-sounding writing

A search for common filler (seamless, leverage, empower, unlock, streamline, robust, journey, delve) found **none**. The real problem is different: long, careful, explanatory sentences that read like documentation ("Every account is compared with its own last week, so a quiet account is not flagged just for being quiet."). Correct but heavy. Shorten.

## Wording that works

- "never answered 12 d 18 h", "no owner" and "9 waiting leads have no owner. Nobody is responsible for answering them." are plain and specific.
- "Not enough data" is used instead of a guessed number on Speed to lead.
