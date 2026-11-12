# Screen checklist (read before any revamp or rebuild of a screen)

**Rule: a revamp adds, never removes. Any removal must be listed in `docs/REGRESSION_AUDIT.md` with King's approval.**

Before you change a screen:
1. List every chart, table, tab, filter, action, export, print, saved view, help link and setting the current screen has.
2. Build the new design. Keep every item from step 1, in the same place or in a new tab or a section below the new content. Reuse the old component; do not rewrite it.
3. Add the new screen's tab labels and card titles to `tests/unit/required-sections.test.ts`. The test fails when a listed section disappears from the source.
4. Run `npx vitest run tests/unit/required-sections.test.ts` before you push.

If something truly has to go: write it in `docs/REGRESSION_AUDIT.md` (module, feature, why), get King's yes in chat, then remove it from the manifest in the same commit.
