# SubSync preview video: script and timing

Spoken in a warm, plain voice (Kokoro, voice af_heart, speed 0.95), about 131 words a minute. Captions on screen are these exact words, cut into short pieces. Total length 73.6 s, 1920x1080, 30 fps.

| Start | Shot | Line | Spoken words |
|---|---|---|---|
| 0:00.4 | hook | L01 | Know what is happening in every client account, before your client does. |
| 0:06.0 | speed | L02 | Thirteen new leads are past your reply target right now. |
| 0:10.6 | speed | L03 | SubSync shows who has waited longest, with the deal money behind each one, so you know who to call first. |
| 0:18.0 | appts | L04 | Appointments tell the truth too. Four have no outcome marked, so your real show rate is fifty-seven percent. |
| 0:25.6 | appts | L05 | Eight no-shows are waiting to be won back. Mark the four now. |
| 0:32.1 | funnel | L06 | Eighty-seven deals have gone quiet, with about seven hundred and fifty-one thousand dollars at risk. |
| 0:38.9 | funnel | L07 | Watch your pipeline as a funnel. Replay how deals moved, day by day, then click any step to open the deals waiting there. |
| 0:50.4 | clients | L08 | Every client account sits on one screen. Five need you now, and two paid plans are past due. |
| 0:57.5 | alerts | L09 | And you don't have to go looking. SubSync sends the alert to Slack or email, with a link that opens the right account in your CRM. |
| 1:07.0 | close | L10 | Install it once. Free for fourteen days. |

## Shots

| Start | Length | Shot | What is on screen |
|---|---|---|---|
| 0:00.0 | 6.0 s | hook | Today with the money-at-risk number (slow zoom) |
| 0:05.4 | 12.5 s | speed | Speed to lead: 13 new leads past the target, who to call first |
| 0:17.4 | 14.7 s | appts | Appointments: 4 with no outcome, true show rate 57%, 8 no-shows, Mark the 4 now |
| 0:31.5 | 18.9 s | funnel | Today (87 quiet deals), then the pipeline funnel with the replay bar and a step opened |
| 0:49.8 | 7.7 s | clients | Clients: 13 accounts on one screen, 5 need you now, 2 past due plans |
| 0:56.9 | 10.0 s | alerts | Drawn chat alert and email card that open the account in the CRM |
| 1:06.3 | 7.4 s | close | SubSync logo and wordmark: Install once. Free for 14 days. |

App shots use the 1600x900 listing screenshots (demo company, labels hidden) with a slow zoom and a cursor; the alert cards and close card are drawn in HTML. Numbers spoken match those screens.

## Rebuild

1. `python tts.py script.json wav` (Kokoro, in the video-tools venv), 2. `node scripts/video/plan.mjs <work>`, 3. `node scripts/video/record.mjs <work>`, 4. `python music.py <work>/music.wav 78`, 5. `node scripts/video/compose.mjs <work> assets/video-out`. Loudness: voice -16 LUFS, music about 22 dB under the voice while someone speaks, fade-out at the end. See `docs/VIDEO_CREDITS.md`.
