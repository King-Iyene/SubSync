# SubSync welcome video: script and timing

Voice: Kokoro-82M, voice `af_heart`, speed 0.95 (local, CPU). 144 spoken words, total 1:18.4 (78.4 s), 1920x1080, 30 fps. Captions are these exact words (none on cards that carry their own words).

## Shots and timing

| Start | Length | Shot | What is on screen |
|---|---|---|---|
| 0:00.0 | 10.0 s | w_open | Welcome: open it, Today lands first |
| 0:09.4 | 13.3 s | w_sync | Welcome: first sync in the background, Updated just now |
| 0:22.1 | 9.3 s | w_today | Welcome: read Today first |
| 0:30.8 | 7.6 s | w_range | Welcome: pick your date range |
| 0:37.8 | 13.8 s | w_setup | Welcome: five-minute setup (AI, alert email, roles) |
| 0:51.0 | 9.6 s | w_check | Welcome: Getting started ticks itself |
| 0:60.0 | 10.5 s | w_help | Welcome: 60-second guides, Help and support |
| 1:09.9 | 8.4 s | w_end | Welcome: you are set (end card) |

## Voice-over, line by line

| Start | Shot | Line | Spoken words |
|---|---|---|---|
| 0:00.6 | w_open | V1 | SubSync is installed. Open it from the menu in your CRM, and you land on Today. |
| 0:10.0 | w_sync | V2 | The first sync runs in the background. It takes a few minutes, and the numbers appear as it finishes. The top bar tells you when it last updated. |
| 0:22.8 | w_today | V3 | Read Today first. It shows the money at risk, and the accounts to save first. |
| 0:31.4 | w_range | V4 | Pick your date range at the top, and the numbers follow it. |
| 0:38.4 | w_setup | V5 | Then do the five-minute setup. Connect your own AI, if you want one. Save your alert email. And give your team roles: setter, closer, or both. |
| 0:51.6 | w_check | V6 | The Getting started checklist ticks itself off as you go, so you always know what is next. |
| 1:00.6 | w_help | V7 | Need help? Every page has a sixty-second guide, and the Help and support section is in Settings. |
| 1:10.5 | w_end | V8 | You are set. Open Today and start with the first account to save. |

## Rules followed

- Connected accounts and every business you manage; no claims about branding or naming.
- Only live features are shown: in-app alerts, Slack and email. Nothing is sent to leads. No feedback pages anywhere.
- Tool names other than Slack are covered on screen (meeting-notes card and the Connections card are masked with the page background; the feedback footer is masked on the Team screen).
- Every highlight is tied to a phrase of its voice line. Real screens are the listing screenshots; two labelled drawings in Clean-up; the typed search is an overlay on the real search box.

## Rebuild

1. `node scripts/video/mask.mjs` (covers), `node scripts/video/logo-cutout.mjs`
2. `python tts.py <script.json> <work>/wav`, `python music.py <work>/music.wav 262`
3. `SCRIPT=<script.json> node scripts/video/plan.mjs <work>`
4. `node scripts/video/record-anim.mjs <work>` (pain story), `STILLS=<dir> node scripts/video/record.mjs <work>`
5. `node scripts/video/poster.mjs <stills> <out> <work>`, `node scripts/video/vtt.mjs <work> <out.vtt>`, `node scripts/video/compose.mjs <work> <out>`

No server, demo data fill or database connection is used.
