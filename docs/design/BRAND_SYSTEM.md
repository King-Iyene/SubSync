# SubSync brand system: "Ledger"

Status: implemented in tokens (one place), 12 Nov 2026. Replaces the cyan/teal-on-navy look, which read as generic AI.

## Idea
SubSync is a revenue-protection tool: it shows money kept and money leaking. The look borrows from accounting ledgers and good financial print: warm paper, graphite ink, one deep forest green ("money kept"), serif headlines, hairline rules. Calm and mature, not sci-fi.

## Palette (3 colours + soft status)
| Role | Light | Dark | Use |
|---|---|---|---|
| Graphite (ink and paper) | bg `#f5f3ee`, card `#fffefb`, ink `#1d1c19`, muted text `#5a564d`, border `#dcd7cb` | bg `#151513`, card `#1d1d1a`, ink `#ece9e2`, muted text `#aaa599`, border white 12% | All surfaces and text |
| Forest (the ONE accent) | `#2d5c45` | `#8fbf9f` (sage) | One primary button, active tab, key number, links, focus ring |
| Ochre (highlight) | `#b79a57` (gold) | `#c2a25e` | The single recommended action, plan marks. Never a status |
| Success | `#3a7339` | `#8dbf78` | Status only, always with icon or word |
| Warning | `#84570f` | `#d9a74f` | Status only |
| Danger | `#a23a2d` | `#e08a7d` | Status only |
| Info / chart slate | `#4f6f8f` | `#8aa6c4` | Charts, neutral info |

Chart set (categorical, muted): forest, ochre, slate blue, dusty mauve, stone (`--chart-1..5`). Sequential ramps (journey river) run forest to ochre at 26-30% saturation. No neon, no rainbow.
Contrast: every text pair is checked for 4.5:1 and every mark for 3:1 in both themes by `src/lib/__tests__/design-tokens.test.ts` (reads `globals.css`). Success and the forest accent share a green family on purpose; success is only ever shown with an icon or a word, and sits yellower than the accent.

## Where the tokens live (change here, everything follows)
- `src/app/globals.css`: `:root` and `.dark` (app-wide shadcn tokens), plus a `@theme` block that pulls Tailwind's saturated colour families to low chroma (so any `bg-amber-100` style class is muted too).
- `src/app/app/views/today-theme.css`: `--t-*` for Today (ground, ink, rule, accent, status, charts).
- `src/app/app/views/speed6.css`: `--s6-*` used by Speed to lead, Appointments, Clients, Money, Find a lead, Team, Pipeline, Meetings, Workflows, Clean-up, Call mode (cl3, ap3, td3, bf, fn, pm, pp3, wg, unanswered share these tokens). The last block of the file is the flat pass (no glow, no gradients).
- `src/lib/design/color.ts` `SURFACE`: the card colours the agency-accent contrast check runs against.

## Type
Headlines (h1, h2, the one Today sentence, big figures): Newsreader (serif, 500-600). UI and body: Hanken Grotesk (400-600). Labels and aligned numbers: IBM Plex Mono. All self-hosted by next/font (no extra requests). Scale: 0.6875 label, 0.8125 small, 0.9375 body, 1.25 title, 1.75-2.25 display/figure. Numbers use tabular figures.

## Shape, space, icons, motion
- Radius 8px (`--radius: 0.5rem`); chips 4-6px; no pill-everything.
- Spacing: 4px grid; page gutter 16px mobile / 24px desktop.
- One icon style: lucide, 1.5px stroke, currentColor. No filled or multicolour icons.
- Motion: 150 ms, ease-out; fades and 6px rises only. No glow, no pulse halos, no gradient text, no neon, no glassmorphism. All motion stops for reduced-motion.

## Components
- Buttons: 1 primary (solid forest, white text), secondary (1px outline), tertiary (ghost text). One primary per screen.
- Cards: flat, 1px border, no shadow stack (`--shadow-card` is a 1px hairline or none).
- Chips: tinted 8-14% of their status colour with a word or icon; never saturated fills.
- Tags (per-name colours): 30-40% saturation, readable pairs checked by test.

## Before / after tokens
| Token | Before (light) | After (light) | Before (dark) | After (dark) |
|---|---|---|---|---|
| `--background` | `#eef3fa` | `#f5f3ee` | `#141d2f` | `#151513` |
| `--card` | `#ffffff` | `#fffefb` | `#1b263b` | `#1d1d1a` |
| `--foreground` | `#0b1730` | `#1d1c19` | `#f1f5fb` | `#ece9e2` |
| `--muted-foreground` | `#3f5170` | `#5a564d` | `#aebcd2` | `#aaa599` |
| `--primary` / `--ring` | `#0b6f9e` | `#2d5c45` | `#5bbce3` | `#8fbf9f` |
| `--accent` (wash) | `#d6e9f6` | `#e2eae3` | `#2a3a57` | `#2c352e` |
| `--border` | `#d0dcec` | `#dcd7cb` | `#ffffff26` | `#ffffff1f` |
| `--destructive` | `#b42318` | `#a23a2d` | `#ff7a85` | `#e08a7d` |
| `--success` | `#0d7a4f` | `#3a7339` | `#3dd598` | `#8dbf78` |
| `--warning` | `#8a5a00` | `#84570f` | `#f59e3f` | `#d9a74f` |
| `--gold` | `#d4ad58` | `#b79a57` | `#d4ad58` | `#c2a25e` |
| `--chart-1..5` | blue, gold, purple, green, orange | forest, ochre, slate, mauve, stone | blue, gold, violet, green, orange | sage, ochre, slate, rose, stone |
| `--sidebar` | `#f9fbff` | `#efece4` | `#151e2e` | `#191917` |
| `--radius` | 0.75rem | 0.5rem | same | same |
| `--shadow-card` | blue-tinted stack | 1px hairline | black stack | none |
| `--s6-cyan` (Speed etc.) | `#0b6f9e` | `#2d5c45` | `#22d3ee` | `#8fbf9f` |
| `--s6-violet` | `#6d4fd6` | `#4f6f8f` | `#a78bfa` | `#8aa6c4` |
| `--s6-magenta` | `#b8236f` | `#8f5a6b` | `#f472b6` | `#c58d9c` |
| `--s6-lime` | `#4d7c0f` | `#5b7a3a` | `#a3e635` | `#a3bf86` |
| `--s6-amber` | `#92580a` | `#84570f` | `#fbbf24` | `#d9a74f` |
| `--s6-red` | `#b42318` | `#a23a2d` | `#fb7185` | `#e08a7d` |
| `--s6-green` | `#0d7a4f` | `#3a7339` | `#4ade80` | `#8dbf78` |
| `--t-accent` (Today) | `#1f4e8c` | `#2d5c45` | `#6f9ad8` | `#8fbf9f` |
| Journey river | hue 196 to 28 at 85-92% saturation, glow blur | hue 150 to 38 at 26-30%, no blur | same | same |
| Glows / gradients (Speed cards, dots, bars, flow lines, tab glow, mesh) | on | off | on | off |
| Tailwind colour classes | default saturated | chroma x0.22-0.55 | same | same |

## Not changed (flag)
- The product mark image (`/brand/subsync-logo.png`) is a raster asset; the in-app wordmark text uses the new tokens, but the logo file itself needs a new asset from King/design.
- Partner logos (`brand-marks.ts`) keep their own brand colours.
- Agency-chosen accent colours still override `--primary` at run time (contrast-checked).
