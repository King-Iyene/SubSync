# Standing prompts (King, 3 Nov 2026)

Prompt A is the "Working principles" block in `CLAUDE.md` (it applies all the time). Prompts B to E are routines Claude Code runs at the moments named below.

## Prompt B: customer walkthrough (after each module)

```
Walk through what you just built as each user in turn: agency owner, setter, client admin. For each, say what they see first, what they do, and where they'd get confused. Fix the top three problems, then add the walkthrough to docs/FEATURE_STATUS.md.
```

## Prompt C: simplify pass (end of M1 and end of M2)

```
Simplification pass. List every screen, tile and setting. For each, say who uses it and what they'd lose without it. Cut or hide anything weak behind a feature flag and keep the code. Cap Overview at about 6 tiles. Report before and after counts.
```

## Prompt D: innovation pass (once per milestone)

```
Suggest up to 3 improvements that go beyond the roadmap but fit our wedge (alerts, speed to lead, show rate, setter ops). For each, give the customer benefit, effort (S/M/L), and which existing data it reuses. Recommend one and wait for my yes before building it.
```

Never build a Prompt D proposal before King says yes (operating principle 4).

## Prompt E: daily status (anytime)

```
Status in under 10 lines: done, in progress, blocked on me, test results, and what you'd do next with your reason.
```
