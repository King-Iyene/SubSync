# Today: design critique and rebuild (5 Nov 2026)

Skills used: `dataviz` (chart colours validated with its script, light and dark), `artifact-design` (AI-look list, type, neutrals, repeated elements), `anthropic-skills:humanizer` (all copy). Searched for frontend-design, UI/UX, design-critique, accessibility, typography and copy skills: none is installed in this account (only docs, xlsx, pptx, pdf, docx, google-workspace, skill-creator, import-memory, morning, humanizer, plus dataviz and artifact-design). Install a frontend-design skill if you want a fourth pass. `/code-review` and `/simplify` were run on the diff at the end (notes at the bottom).

Before: `today-before-agency-{light,dark}-{1440,1024}.png`, `today-before-agency-full-*.png`, `today-before-staff-full-*.png`.

## What read as generic AI
1. **One face for everything.** Geist, bold 600 at every size, so the headline, tiles, rows and labels had the same voice. The headline was 42px bold with two numbers in a bright accent.
2. **Navy and teal.** Every surface, border and chart was blue-tinted. The dark mode was the light mode with the lights off.
3. **Boxes everywhere.** The queue, the filter strip, the since strip, the insight cards, the forecast ring, the proof tiles and the buttons all had the same radius and border. Nothing said which box mattered.
4. **Equal-weight tiles.** Four number tiles side by side, each with a coloured left rule, a sparkle icon on "Spotted today", a ring chart for time left.
5. **Slogan headings.** "Start here", "Where the work is", "Spotted today", "Fix first".
6. **Mixed spacing.** 4, 6, 8, 12, 16, 24px steps used at random between sections.

## Hierarchy and order that was wrong
- The queue was fine, but the bars sat between it and "since you last looked", and the evidence was hidden under a closed "More detail". The one chart that explains the week (reply time) was invisible.
- The page title "Today" was the biggest thing after the sentence, and the date was missing.
- The primary button and the row buttons were the same weight.

## Copy that was wrong
- Three names for one thing: "Waiting for a reply", "unanswered", "needs you". "At risk" and "at stake" for the same money. "Stale" in code, "gone quiet" on screen.
- Headline led with the client count and the dollar total, so the number that matters (people waiting) was in the second line.
- "Click", "Show them", "Show everything" mixed with "See all". "Inside" and "within" both used for the reply target.
- Filler: "The other kinds of thing in this client account", "Right now (this page shows what is true at this moment)".

## What changed
- **Order:** one sentence, **Do this first** (the only bordered surface), since you were last here, worth a look, where the work sits, the numbers behind it (reply time line always visible), then Break it down under tabs.
- **Type:** Newsreader for the sentence, section titles and big figures; Hanken Grotesk for reading; IBM Plex Mono for small labels and aligned amounts. One scale as tokens (display, figure, title, body 15, small, label).
- **Colour:** palette A graphite and berry (default), palette B pine and jade. No blue anywhere in Today. One accent. Status colours reserved. Dark is its own design: layers by lightness, off-white ink, softened accent.
- **Words:** one word per idea, listed in `docs/features/TODAY.md`.

## Palette (tokens in `src/app/app/views/today-theme.css`)
| Token | A light | A dark | B light | B dark |
|---|---|---|---|---|
| ground / raised | #f2f1ee / #fbfaf8 | #191817 / #222120 | #eef0ec / #f9faf7 | #101a16 / #16231e |
| ink / quiet ink | #1e1c1a / #5a564f | #ece8e1 / #a8a29a | #17201c / #4e5a54 | #e6ede8 / #9badA4 |
| accent | #a3205e | #e27ba8 | #0f6b5c | #4fb79f |
| urgent / soon / fine | #b42318 / #8a5a00 / #2b7a3d | #f0877d / #e0a63c / #6fc28a | same / same / #4a7a12 | same / same / #a5cc5e |
| chart 1 to 4 | #9b1d5a #b38300 #1f8f72 #c2501f | #c9548c #b08c22 #34a383 #db6a38 | #1f8f72 #c2501f #9b1d5a #b38300 | #34a383 #db6a38 #bc4380 #b08c22 |

1. Berry and jade are far from the status hues (red 5, amber 40, green 150 degrees), so the accent never reads as a status.
2. The neutrals lean warm (A) or green (B) by a few points of chroma, so no grey looks unchosen and none is navy.
3. Dark surfaces step by lightness (sunk, ground, raised, lifted) with a hairline, never a shadow. Ink is off-white (#ece8e1), not #fff.
4. The dark accents are lighter and less saturated than the light ones, so a filled button does not glow.
5. Chart sets pass the dataviz validator in both modes (lightness band, chroma floor, colour-blind separation, normal-vision floor, 3:1 contrast). Text contrast is 4.5:1 or more for ink, quiet ink, accent, urgent, soon and fine on ground and raised (the /design page prints each ratio).

Screenshots: `today-redesign-agency-{light,dark}-1440.png`, `today-redesign-agency-{light,dark}-1024.png`, `today-redesign-staff-{light,dark}-1440.png`, palette B `today-redesign-paletteB-{light,dark}-1440.png`, and the side-by-side `today-redesign-design-palettes.png`.

## Not done (flagged)
- The side menu and the top bar stay navy (shell, outside Today). Next to Today they are the one blue left on the screen. Switching the shell tokens is the follow-up if you pick A or B.
- `f5-today.test.ts` has one failing test that already fails on main (it looks for code the shell merge removed). Not touched.
