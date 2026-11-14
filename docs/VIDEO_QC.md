# Preview video v3: quality checklist

Checked on `assets/video-out/subsync-preview.mp4` (4:09, 1920x1080, 30 fps, 62.8 MB, mix -16.0 LUFS). Frames were extracted and looked at about every 8 to 10 seconds, plus the closing seconds. Times are minutes:seconds in the final video.

| Check | Result | Evidence |
|---|---|---|
| All 10 modules covered | Yes | Today 1:15, Speed to lead 1:35 (drawing) and 1:44 (screens), Appointments 1:56, Funnel 2:13, Find a lead 2:28, Clean-up 2:40, Clients 3:01, Account audit 3:12, Team 3:31, Alerts 3:42 |
| Real interface visible throughout the product part | Yes | Frames at 1:24 (Today), 1:50 (Speed), 2:04 (Appointments), 2:20 (Funnel), 2:32 (Find), 2:47 (Clean-up), 3:06 (Clients), 3:20 (Audit), 3:36 (Team); all are the listing screenshots plus two real captures (call list, no-show list). Nothing in the screens was redrawn |
| Key statistics readable | Yes | 1:24 $750,914 counting up to $751,385; 1:50 "13 new leads" and "24 min typical reply, target 15"; 2:04 "4 past appointments", 57%; 2:47 "163 duplicate groups"; 3:06 "2 past due, 5 need you now"; 3:20 "$258,064 a month" (labelled estimate); 3:36 "3 things need you today" |
| Illustrations explain, they do not distract | Yes | Animated pain story (0:00 to 0:58) and the lead timer (1:35). In the product part there are two labelled drawings only (duplicate pair, preview-confirm-undo steps at 2:47) |
| No unsupported or not-live features | Yes | No message sending, no ChatGPT, Zoom or Meet, no invoice resend. Alerts shown: in-app bell, Slack, email only. Clean-up claims (preview, typed confirmation for bigger changes, undo) checked in `src/app/app/views/cleanup.tsx` and `duplicates.tsx`. The audit claims only an estimate with "How this is worked out" one tap away, and the Copy a summary, Print and "See a sample to send a client" buttons that are on the screen |
| No forbidden positioning language | Yes | `grep -niE "white|brand|own name|agency owner|sub-account|highlevel|ghl"` on `scripts/video/script.json` (the captions and voice) finds nothing. Hits in code are CSS (`white-space`), the folder name `assets/brand`, and the rule text in docs. "Your brand, not ours" and "under your own name" are gone from the voice, captions, cards and docs |
| Speaks to agency operators and single businesses | Yes | 0:00 "Whether you run one business or fifty"; "every business you manage", "your connected accounts", "all your accounts in one place" |
| Voice matches visuals | Yes, with one caveat | Each highlight is tied to a phrase of the voice line (the step fires as the phrase starts). Checked at 1:24 (money at risk as "what is at risk" is said), 2:20 (replay highlight as "Replay it day by day" is said), 3:36 (team). Caveat: the capture timing can drift by about half a second on slow frames |
| Transitions smooth | Yes | 0.6 s cross-fades between all 21 shots; the last 0.7 s fades out. No cut to black in the middle, no overlapping cards (frames at 3:42, 3:58 and 4:08) |
| Closing card correct | Yes | Frames at 3:58, 4:06 and 4:08: real logo alone (no box), SubSync wordmark, "Bring your connected accounts together.", "Know what's happening, see what needs attention and take action with SubSync.", "Install once. Free for 14 days.", Install button. No caption strip on the card. Spoken words are the same as the card |
| Poster and cover frame | Yes | `subsync-preview-poster.png` (1600x900) and `-1280.png` (1280x720): Today screen with the money numbers, small logo top right, one headline. The poster is also the first two frames of the MP4, so players that show frame 1 use it as the cover |

## Known small issues

- At 3:07 the highlight label "Past due, need you now" is partly under the caption strip.
- The typed search ("Harper") on Find a lead is an overlay on the real search box. The results shown are the screen's own.
- The Today numbers in the money-at-risk counter count up to the same figure the screen shows ($751,385).
- The logo cut-out keeps a light grey bezel round the gold link, as in the original file; a faint soft edge remains there.
- The screens are made-up demo businesses; "KD Squares Test" in the chat and email is King's own test account.
- Nothing was recorded live from the app (the shared database was at its connection limit), so no new interactions such as opening a stage's deals, the merge preview or the audit report are shown; those are described and highlighted on the existing screens.
