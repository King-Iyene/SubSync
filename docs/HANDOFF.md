# Handoff (2026-11-03)

Source of truth: CLAUDE.md. Roadmap files ROADMAP_V2.md, INTEGRATIONS_SPEC.md and
KING_REVIEW_NOTES.md were on King's desktop and are NOT in this repo checkout.
The overnight branch `overnight/2026-11-01` was also not on the remote when this was written.
First step for the next session: confirm that branch is pushed, check it out, and read those three docs.

## Reported done on the overnight branch (not verifiable from main-s6rbxo)
S0.2 identity/roles/tenancy (f5d7576), S0.3 white-label hygiene (bedc59e), F1 pipeline metrics (20480e0),
F2 speed to lead (fbabd35), F3 appointments (3b36eeb), F6 share-link hardening, F4/F5 Inbox + Today,
F7-F10 Search/Sentiment/Replay/Audit, E1-E4 integrations, Z1-Z3 capture fields/audit export/share audit page.

## Left for M1 (S0.2b, S0.4, F1, D0, F2, F3, F6)
- S0.2b and S0.4: not reported as done. Read their definitions in ROADMAP_V2.md. D0: same.
- Real sign-in as each role (owner, admin, staff, client admin, client user): pending. King's own role is unconfirmed.
- Real-data verification for F1/F2/F3/F6 against a manual count in the CRM, recorded in docs/FEATURE_STATUS.md.
- White-label install screen URL: verified in docs only, not clicked through.
## Left for M2
- Not defined in the context I had. Take it from ROADMAP_V2.md; do not guess.

## Tests still to run (deferred to the end of the overnight run)
1. npm run lint, npx tsc --noEmit, npm run build
2. npm test, then the full Vitest suite if present on the overnight branch
3. Tenant isolation tests: two fake agencies, several locations, cross-tenant ID tampering must fail. Last run timed out; rerun.
4. Entitlement tests in both ENTITLEMENTS_MODE=open and enforced
5. White-label string scan: no "GoHighLevel", "HighLevel" or "GHL" in UI, emails or errors
6. Integration checks: tenancy, flags, metrics, audit, speed, roadmap (API, connections, appointment-insights passed earlier;
   one 503 on connections came from a stale dev server)
7. Browser suite (Playwright) on key screens
8. Real data: Z1 capture-field counts, audit export, share page, business hours, outbound calls (only unit-tested)
9. Share links: revoke, expiry, rate limit

## Blockers for King
- Retry/backoff tuning for midnight API calls needs approval (N98)
- E2a Zoom scope expansion
- F9 product-name hiding, and the other "never start" items
- Pre-pilot gate (CLAUDE.md section 6): Pro at $9, delete the $5 plan, map the new planId, switch to enforced
