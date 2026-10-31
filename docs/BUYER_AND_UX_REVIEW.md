# SubSync: Brutal Buyer, UX and Code Review Plan

Save as `docs/BUYER_AND_UX_REVIEW.md`. It extends `docs/READINESS_AND_TEST_PLAN.md` (which covers code, security, and GHL review rules). This file covers the part that one missed: **would a real buyer understand it, trust it, and pay for it.**

---

## 0. WHAT THIS CAN AND CANNOT PROVE

- **Can find:** confusing screens, wasted clicks, misleading numbers, trust problems, jargon, broken first-run, ugly or repetitive design, unsupported claims, and the objections a buyer would raise.
- **Cannot prove:** that anyone will pay. An AI playing a buyer is a cheap first filter for clarity and trust. It is not evidence of demand.
- **Evidence ladder (weakest to strongest):** an AI persona opinion, then a real person's opinion, then a real person saying "I would pay", then a real person paying for the audit, then an agency using it weekly, then an agency paying monthly. Only the last three count as proof. The review below feeds the real tests, it does not replace them.

---

## 1. HOW TO RUN IT: THREE MODES

**Mode A: automated browser run (no real logins).** Claude Code runs Playwright against a local or preview build with a **demo tenant of fake but messy data** (junk deals, $0 deals, unassigned leads, unmarked appointments, empty accounts, one huge account). It captures screenshots of every page at phone, tablet, and desktop widths, records console errors, and then writes the persona review. It needs a dev-only demo login that **must be impossible to enable in production** (separate env flag, tested). Nobody types a real password.

**Mode B: real embedded run in the GHL sandbox.** King logs in himself, in his own browser, to the **sandbox (App Test) account only**, and opens SubSync through the Test Link. A browser assistant (for example Claude in Chrome) can then drive King's already-logged-in session, or King records a Loom and screenshots. Safety rules in section 8. This is the only way to test the real iframe, SSO, and white-label links.

**Mode C: real humans.** Five 30-minute sessions with real agency owners or setters, on screen share. Protocol in section 9. This is the only mode that tests willingness to pay.

If you meant "Copilot" as GitHub Copilot or Microsoft Copilot: neither is needed. They suggest code. Claude Code plus Playwright covers Mode A, and a browser assistant covers Mode B.

---

## 2. THE PERSONAS (the reviewer must stay in character)

**P1: Agency owner, 20 clients, skeptical.** Runs GHL workflows already, has AgencyAnalytics or Looker dashboards, checks things in 5 minutes between calls. Burned by tools that promised insight and gave charts. Buys only if it saves money or prevents a client leaving. Pays about $100 to $250 a month for tools. Deal-breakers: wrong numbers, anything that looks like another dashboard, extra setup.

**P2: Agency ops manager or VA who monitors accounts daily.** Wants to know in 60 seconds which client needs attention and what exactly to do. Hates false alarms and alert spam.

**P3: Setter or closer (client-account user).** Works one account, wants today's list and nothing else. Impatient, will not read help text. Must never see other clients' data.

**P4: Local business owner (single account, non-technical).** Owns a roofing, med spa, or coaching business. Cares about "am I missing leads". Does not know what SLA, pipeline velocity, or engagement score mean.

**P5: White-label agency owner.** Resells everything under their own brand. Will drop any tool that shows GHL branding, odd domains, or "SubSync" where their brand should be.

**P6: Hostile reviewer (GHL review team plus a security-minded buyer).** Looks for scope abuse, data leaks, undisclosed storage, broken installs, and misleading claims.

---

## 3. TASKS EACH PERSONA MUST ATTEMPT (timed, no help)

1. **5-second test:** open the first screen for 5 seconds, close it, and answer: what is this product, who is it for, what would I do next?
2. **First-run:** install from scratch. Note every point of confusion, wait, or doubt.
3. **Job task:** (P1/P2) "Tell me which client account is in the most trouble and why, in under 60 seconds." (P3) "Find the lead I must contact first." (P4) "Tell me if I am missing leads." (P5) "Find anything that shows a brand other than mine."
4. **Number trust:** pick 5 numbers, click or hover for the definition, and check each against the source. Would I repeat this number to a client?
5. **Act on it:** what do I do after seeing an alert? Is the next step obvious and one click away?
6. **Bad-data test:** open an account with junk data, an empty account, a partially synced account, and a huge account.
7. **Failure test:** deny permissions, lose network, expire a token, hit a sync failure.
8. **Mobile test:** do the same job on a phone-width embedded frame.
9. **Price test:** state the price I would pay per account, the price at which I walk away, and why. Ask: "What am I getting that I cannot get from GHL workflows or AgencyAnalytics?"

---

## 4. WHAT TO AUDIT (brutally, every item)

**Product and value**
- Does each screen answer a real question, or just display data?
- Which features would this persona never use? List them as a **cut list**.
- Is the unique value (outcome monitoring across accounts) obvious on screen one?

**Numbers and trust**
- Every number needs a written definition (`docs/METRICS.md`) and a tap-to-see formula.
- Flag repeated or suspicious numbers (for example several tiles showing the same dollar total), scary estimates without a basis, and defaults that look like real data (for example a default win rate).
- Flag any figure that would embarrass the agency in front of a client.

**UX and UI**
- Visual sameness: count repeated layouts, tile styles, and list patterns; flag screens that look copy-pasted from each other.
- Hierarchy: is the most important thing the biggest thing? One primary action per screen?
- Density: too many tiles, too much text, unexplained jargon (SLA, engagement score, stale).
- Walls of data: long lists with no grouping, search, or pagination.
- States: loading, partial sync, empty, error, no-permission. Each must be explicit and calm.
- Basics: contrast, text size, keyboard use, focus states, labels on icons.
- Responsiveness inside the embedded frame at phone, tablet, and desktop widths; no horizontal scroll.
- Speed as the user feels it: slow screens, long spinners, layout jumps.

**Copy**
- Internal terms: "agency", "sub-account", "location", "GHL", "HighLevel" anywhere user-facing (including emails, errors, help).
- Claims that are unsupported or not yet true (for example features promised in the plan description).
- Spelling, grammar, tone, and anything confusing or scary.

**Code (UI layer plus risks the UI reveals)**
- Duplicated components, dead code, giant files, inconsistent styling, hardcoded strings and URLs.
- Authorization done on the client, secrets or data in the front-end bundle, console logging of customer data.
- Unflagged unfinished features reachable from the navigation.

---

## 5. THE BRUTAL RUBRIC

**Severity**
- **S0 Blocker:** wrong or misleading data, tenant leak, crash, forbidden branding or URL, secret exposed, data loss. Stops any pilot.
- **S1 Major:** core job cannot be completed or is confusing, a number cannot be trusted, onboarding stalls.
- **S2 Moderate:** friction, unclear wording, weak hierarchy, visual repetition.
- **S3 Polish:** small visual or copy issues.

**Every finding must include:** ID, severity, persona, screen or file, what is wrong, why it costs trust or money, evidence (screenshot or line), and a specific fix. No vague comments like "improve the design".

**No flattery rule:** do not praise anything unless you can name the specific behavior that works and for whom. Do not soften S0 or S1 findings. If something is unusable, say it is unusable.

**Per-persona scorecard (1 to 5, with a one-line reason each):** clarity, trust, usefulness, effort to get value, design quality, and "would I pay at $5, $9, $15 per account (yes, maybe, no) and why". Plus: **top 3 reasons I would not buy**, **top 3 things that impressed me**, and **the one thing I would remove**.

**Overall verdict:** SHIP TO PILOT, FIX THEN PILOT, or NOT READY, with the blocking list.

---

## 6. OUTPUT FILES

- `docs/UX_REVIEW.md`: findings with severity, screenshots, and fixes
- `docs/BUYER_REVIEW.md`: persona scorecards, objections, cut list, verdict
- `docs/COPY_AUDIT.md`: every internal term, unsupported claim, and wording problem
- `docs/METRIC_AUDIT.md`: every displayed number, its definition, and whether it is trustworthy
- Screenshots in `docs/review/` named by page, width, and persona

---

## 7. PROMPT FOR CLAUDE CODE (MODE A, paste as is)

```
Read CLAUDE.md, docs/READINESS_AND_TEST_PLAN.md and docs/BUYER_AND_UX_REVIEW.md. Run the brutal buyer and UX review in Mode A. Do NOT fix anything yet.

1. Create a demo tenant with realistic, messy fake data: junk and $0 deals, unassigned leads, unmarked past appointments, empty accounts, one very large account, a partially synced account, and obvious test data. Add a dev-only demo login behind an env flag that cannot be enabled in production, and add a test proving it is off in production.
2. Use Playwright to open every page in the navigation at 390px, 768px and 1440px widths. Capture screenshots to docs/review/. Record console errors, failed requests, horizontal scroll, and layout breaks.
3. Act as each persona P1 to P6 in docs/BUYER_AND_UX_REVIEW.md. Complete every task in section 3 and audit every item in section 4. Look at the screenshots, not just the code.
4. Write docs/UX_REVIEW.md, docs/BUYER_REVIEW.md, docs/COPY_AUDIT.md and docs/METRIC_AUDIT.md using the severity rubric and the no-flattery rule. Include the cut list, the top 3 reasons each persona would not buy, and an overall verdict.
5. Search the code for duplicated components and repeated layouts, and for internal terms in user-facing strings.
Then stop and wait for my approval before fixing anything.
```

---

## 8. BROWSER ASSISTANT BRIEF AND SAFETY RULES (MODE B)

Use only the **GHL sandbox (App Test) account**. Never a production agency or any real client account.

- King logs in himself. Never paste passwords or tokens into any chat or prompt. The assistant works inside King's already-logged-in browser session.
- Read-only unless King says otherwise. The assistant must **not** click Publish, Submit, Delete, Uninstall, Reinstall, billing, plan changes, or anything that sends a message to a contact.
- If any screen asks for payment, a password, or a verification code, the assistant stops and tells King.
- Do not open or summarize real customer data. If real data appears, stop and tell King.
- Report every observation as a finding using the rubric in section 5, with a screenshot.

**Brief to paste into the browser assistant:**

```
You are a brutal, in-character product reviewer. Open SubSync from the sandbox account. Act as persona P1 (skeptical agency owner), then P3 (setter), then P4 (local business owner), then P5 (white-label owner). For each persona, complete the tasks in section 3 of docs/BUYER_AND_UX_REVIEW.md and report findings with severity S0 to S3, screenshot, why it matters, and a specific fix. Do not praise anything without naming the exact behavior that works. Read-only: never click Publish, Submit, Delete, Uninstall, Reinstall, billing, or anything that messages a contact. Stop if asked for a password, payment, or code.
```

---

## 9. REAL-HUMAN PROTOCOL (MODE C)

- Five sessions, 30 minutes each: two agency owners, one ops person or setter, one white-label agency, one local business owner.
- Do not pitch. Ask: "How do you know your clients' leads are getting answered? What happened the last time one was not? What do you use today?"
- Show the Instant Audit on **their** data (sandbox copy or screen share). Say nothing. Watch where they pause, frown, or ask questions. Ask them to think aloud.
- Then ask: "What would you do with this on Monday?" and "What would you pay for this report today?" Then: "Would you pay $200 for the audit and fix plan this week?" A "yes" with a payment is evidence. A polite "interesting" is not.
- Record: date, who, what they said in their own words, what they did, objections, price quoted, and the outcome.
- Add findings to `docs/BUYER_REVIEW.md` under "real humans" and weight them above every AI persona.

---

## 10. RULE FOR ACTING ON THE RESULTS

Fix all S0 before any pilot. Fix S1 on the core jobs before pilot. Cut features that every persona would not use. If real humans will not engage after the Instant Audit demo, change the offer before writing more code.
