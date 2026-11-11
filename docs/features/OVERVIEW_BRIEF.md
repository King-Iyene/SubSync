# Overview: retire into Today > Numbers (small, no separate builder)

Rules: as docs/features/TODAY_BRIEF.md. Read docs/research/OVERVIEW_R1.md.

## Evaluation (principle 1)
(a) Who and next step: the owner who wants the headline numbers; they open the row behind a number. Missing, they say "where did the numbers go", only if a tile moved without a trail. (b) Data: module rollups already built. (c) Native and competitors already show KPI tiles (commodity). (d) Simplest: delete nothing, hide the nav entry, redirect. (e) Risk: broken old links and emails; two screens giving two answers.

## Work (done by the Today builder, last, about half a day)
1. Add Numbers tab (TODAY_BRIEF.md item 3), max 6 tiles; the six chosen by the builder from Speed median, unanswered, show rate, open deals, stale deals, accounts needing attention.
2. Route `#overview` and every email or notification link to Today > Numbers. Test every `go("overview")` call site.
3. Nav: set flag `ov_screen` OFF by default and remove the "Overview" entry from More; keep overview.tsx and exec-summary.tsx (no deletion; CLAUDE.md "do not rewrite working code to tidy it").
4. Metric trust: apply 13A rules (exclude $0 and ownerless deals from dollar tiles, per-stage stale, minimum 20 closed for win rate, label estimates, formula one tap away) and unit-test each in docs/METRICS.md.
5. Typed-confirmation does not apply (no deletes). No writes.

## Setup
Same worktree and branch as Today (stage/td), same port 3641. Flag: `ov_screen` (OFF, legacy). No migration. Tests: redirect test, six-tile cap test, counts equal rows.

## Customer's-eye check
Owner opens an old email link: lands on Numbers with a one-line "Overview moved here". Nothing is missing that they used.

## Done when
Redirect live, old entry hidden, FEATURE_STATUS.md says "Overview: merged into Today".
