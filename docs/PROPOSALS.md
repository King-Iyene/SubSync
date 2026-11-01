# Proposals (ideas found while building; NOT built, King approves first)

Each: what, persona it helps, why it matters, effort, risk. Added by the stage agents during the overnight run.

## From stage D0 (design system and shared components)

Each: what, persona it helps, why it matters, effort, risk. All PROPOSALS; none built.

1. **"Next best thing to do" strip.** One line at the top of Today and My day that ranks the single most valuable action across pages (answer the oldest waiting lead; mark the oldest unmarked appointment; fix the account with the most no-owner leads) with one button. Persona: P3 setter, P4 owner. Why: the first screen answers "what now" without reading. Effort: medium (needs one ranking rule, written in METRICS.md, and the numbers already exist). Risk: low; a wrong ranking erodes trust, so it must show its reason in a sentence.
2. **Saved views per person.** "My Monday view": a name for a page plus its filter and card ranges, kept per user. Persona: P1, P2. Why: the filter and ranges already live in the address, so a saved view is a named address. Effort: small to medium (one small table scoped to the installation and user, classified in `tenant-tables.ts`). Risk: a new table; needs the tenancy and data-inventory tests.
3. **Copy link to this view.** A button that copies the current address (page, filter, ranges) so an owner can send a view to a colleague. Persona: P1, P5. Why: the address is already complete. Effort: very small. Risk: the link opens inside the app, so the colleague needs their own sign-in; it never carries data, only the choices.
4. **A page-level default range that cards follow.** One range control at the top of a page that sets every card's range unless a card overrides it. Persona: P2. Why: KF-4 asked for card-level ranges "in addition to" the page; today each card remembers its own. Effort: small. Risk: two levels of range can confuse; the card must say whose range it is following.
5. **Keyboard shortcuts overlay.** `?` shows the shortcuts (arrows in lists, Escape for the lead panel, `g` then a letter to jump pages). Persona: P2, P3. Why: setters live in lists all day. Effort: small. Risk: low.
6. **Print or PDF of a drilled list.** A print layout for the list behind a bar (for a team meeting). Persona: P1, P5. Effort: small (print styles exist for the audit). Risk: customer names on paper; the print view should say who printed it.
