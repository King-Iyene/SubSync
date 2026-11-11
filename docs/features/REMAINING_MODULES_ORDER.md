# Remaining modules: build order and merges (11 Nov 2026)

Done: Speed to lead, Appointments, Pipeline, Clients, Team. Priority per King: money first, customer second, innovation third. Briefs: TODAY, AUDIT, WORKFLOWS, CLEANUP, DATA_HEALTH, MEETINGS, OVERVIEW (docs/features/*_BRIEF.md); research in docs/research/*_R1.md.

## Ranking by money impact
| # | Module | Why (money) | Builder (port) |
|---|---|---|---|
| 1 | Today (absorbs Overview) | Retention: the page and 7 am email that make the agency open the app daily; the weekly receipt justifies the $11.50 per account when clients ask "what are we paying for". Reads finished modules so it needs little new data | TD 3641 |
| 2 | Account audit | Acquisition: install-day hook and the agency's sales asset; history gives baseline and "then vs now". Already built, a small high-return pass | AU 3642 |
| 3 | Workflows | Replaces a $150 to $500 per month consultant check (INFERENCE); the "automation stopped, N leads affected" alert is the wedge's sharpest proof. Needs a live probe first | WF 3643 |
| 4 | Clean-up (absorbs Duplicates; Data health becomes its Health tab) | Honest numbers and no double-texting; weekly "new duplicates" alert and receipt. Merge writing waits on King's switch | CU 3644 |
| 5 | Data health | Same-day bad-import alert; small once merged with Clean-up | DH 3645 |
| 6 | Meeting notes | Only agencies whose closers use Fathom pay; validate with pilots first | MN 3646 |
| 7 | Overview | Retire (no money by itself) | inside TD |

Order of work: Today -> Audit -> Workflows -> Clean-up -> Data health -> Meeting notes. Today and Audit can run in parallel (no shared tables). Workflows starts with a read-only live probe. Clean-up before Data health so they share one score.

## Merges
- **Overview into Today:** Today already holds the numbers; Overview repeats them with stale tiles. Becomes Today > Numbers (max 6 tiles); #overview redirects; code kept, flag `ov_screen` OFF.
- **Duplicates into Clean-up:** already one nav entry; finish by also putting Data health there as the tab "Health", one score and one vocabulary. Separate More entry hidden.
- **Workflows stays separate** (different job: automations) but sends its stopped-automation count to Today.
- **Meeting notes stays separate** (personal connections, different safety rules).
- **Audit stays separate** (sales and onboarding use) but its findings feed Today's list and the client receipt.

## Collision-free allocation
Migration timestamps (from 20261204090000, one block per builder): TD 20261204*, AU 20261205*, WF 20261206*, CU 20261207*, DH 20261208*, MN 20261209*. Ports 3641 to 3646 (OV rides TD). Branches stage/td, stage/au, stage/wf, stage/cu, stage/dh, stage/mn. Flag prefixes td_, au_, wf_, cu_, dh_, mn_, ov_.

## Shared rules for every builder (restated)
Real GHL data only, list what is not available on screen; counts equal rows, every number clickable; 1M+ rows (SQL aggregates, rollups, keyset paging); typed confirmation for every delete, preview for edits; writes through the safe gateway; tenant guard on every id with xtest- DB tests; calm design, max 3 colours; record history before building screens; customer's-eye "why would I pay" pass before done; flags ON in the live app after the tenancy check.

## Research loop (11 Nov 2026)
After each module ships (flag ON in the live app), run one research and learn pass before the next big build:
1. Use the live module as a customer would (agency owner, setter, client admin); note what is confusing or slow.
2. Compare with 3 to 5 competitor products and the GHL ideas board, communities and reviews; label VERIFIED / INFERENCE / UNVERIFIED with links.
3. Check the API for unused data and silent limits (caps, windows, paging); check filters, empty states and numbers against a manual count.
4. Write docs/research/MODULE_Rn_*.md (under 150 lines): ranked improvements, money first, customer second, innovation third; each with data needed, effort S/M/L, buildable with data we hold yes/no.
5. King picks; builders take the list. Example: docs/research/APPOINTMENTS_R5_LEADERS_AND_GAPS.md.
