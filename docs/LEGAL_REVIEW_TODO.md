# Legal review list (kept off the public pages)

The Trust page, Privacy policy and Terms are real, complete drafts written from the code. A lawyer has not reviewed them. Each item below needs a lawyer or a fact check before the app goes public.

## Needs a lawyer
- Terms, governing law and disputes: left out of the page on purpose (`GOVERNING_LAW` is `null` in `src/lib/site/legal.ts`). BLOCKING.
- Terms, limit of liability: "fees paid in the twelve months before the claim" and the exclusion of indirect loss (carried over from the earlier draft).
- Terms, "If you keep using SubSync after a change, you accept it": check that this binds in the customers' countries.
- Terms, confidentiality, third-party services, suspension and "acceptable use" wording.
- Terms, resale: the agency sets its own price and is responsible for its own customers.
- Privacy, roles: SubSync as processor for CRM data and controller for account and usage data.
- Privacy, rights: access, correction, deletion, export, and the line that people whose data is in a client's CRM should ask the business first. Check against the GDPR and Nigeria's data protection law.
- Privacy, children (under 16) wording.
- Privacy and Trust: "working toward" GDPR and Nigerian data protection law without claiming certification (`COMMITMENTS.compliance` in `src/lib/trust.ts`).
- Cross-border transfers (data held in the United States for customers in other countries): any transfer mechanism or notice that applies.
- Changes to the policy: "we say so in What's new and on the change log" is a promise; confirm it is the notice you want to give.

## Needs a fact check
- Data location (`DATA_LOCATION`): database region us-east-1 (docs/QA_ROUND3.md); app region is the hosting default. Confirm in the hosting dashboard.
- Retention: "uninstalling deletes what SubSync copied at once". Source: `uninstallText()` in `src/lib/data-inventory.ts`. Confirm the uninstall handler (`src/lib/ghl/installations.ts`) purges the same day and that database backups held by the provider are not a longer retention you must disclose.
- "No advertising or analytics trackers": no analytics package is in `package.json`; confirm nothing is added through the hosting dashboard.
- "This website sets no cookies": confirm in a browser with the network tab open.
- Local storage use (theme, folded sections, last tab) listed in Privacy, cookies.
- Sub-processors list (`PROCESSORS` in `src/lib/company.ts`): Vercel, Supabase, Resend, Slack, Fathom, the customer's own AI provider.
- Security contact: the same support address with "Security" in the subject; there is no separate security mailbox yet.
- Support reply time: "one business day" (`COMPANY.supportReply`) is a promise, not something software checks.
- Trust page security claims each have a test in `src/lib/__tests__/trust-truth.test.ts`; re-read them when the code changes.
- Sending: "off until an owner switches it on for an account" (flag `send_messages`). Confirm the flag really is off for every account at launch.
