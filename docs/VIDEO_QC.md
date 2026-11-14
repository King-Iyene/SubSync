# Preview video v4 and welcome video: quality checklist

Checked on `assets/video-out/subsync-preview.mp4` (6:16, 1920x1080, 30 fps, mix -16.0 LUFS) and `subsync-welcome.mp4` (1:18, mix -16.0 LUFS). Frames were extracted and looked at across the whole timeline (about every 10 to 15 seconds, and at each chapter). Times are minutes:seconds in the final video.

| Check | Result | Evidence |
|---|---|---|
| Every sidebar page has its own chapter, in sidebar order | Yes | Today 1:15, Speed to lead 1:35 and 1:44, Appointments 1:56, Clients 2:16, Money 2:24, Find a lead 2:34, Account audit 2:45, Clean-up 3:04, Team 3:25, Pipeline and deals 3:43, Meeting notes 3:58, Workflows 4:21, Overview 4:34, Settings 4:48, Alerts 5:08, Getting started 5:26, What's new 5:43, Guides 5:52, call to action 6:02 |
| Appointments flow tree uses the new full-frame pictures | Yes | Frame at 2:10: highlight on "Who booked"; expanded tree after "Expand it" |
| Notification scenes use full-frame pictures | Yes | Bell dropdown (21), then the real chat message, email and CRM list. The old date-bar sliver is gone |
| Real interface visible throughout the product part | Yes | Frames at 1:24, 1:50, 2:04, 2:20, 2:28, 2:40, 3:00, 3:30, 3:50, 4:05, 4:25, 4:40, 4:55, 5:12, 5:30, 5:45, 5:55 |
| Key numbers readable | Yes | $751,385 counting up (1:24), 13 past target (1:50), 163 groups (3:10), $258,064 estimate (2:50), 95 total and 17 failing (4:27), 14 of 20 done (5:30) |
| Illustrations explain, not distract | Yes | Pain story (0:00 to 0:58), lead timer (1:35), and two labelled drawings in Clean-up (3:15) |
| No unsupported or not-live features | Yes | No sending to leads, no ChatGPT, Zoom or Meet, no invoice resend; the What's new screen is shown with its first item dimmed by the highlight and never featured. Alerts: in-app, Slack, email only. Fathom wording: "matched by the attendee email when the match is certain, otherwise it waits in your private inbox, each person connects their own". Settings: "nothing changes in your CRM without a preview and a confirmation" |
| No feedback module | Yes | `grep -ni "feedback\|report a problem\|suggest something"` on `script.json`, `script-welcome.json`, `chapters.mjs`, `scenes.mjs` and the docs finds nothing. The footer line is masked on the Team screen (frame 3:30 shows no footer) |
| Tool names kept out of frames except the chat message | Yes | The Meeting notes screen and the Connections card are masked (frames 4:05 and 4:50). Slack appears only in the real alert and the Settings tour |
| No forbidden positioning language | Yes | grep for "white", "brand", "own name", "agency owner" on the voice script finds nothing (hits in code are CSS and the folder name `assets/brand`) |
| Speaks to agency operators and single businesses | Yes | "Whether you run one business or fifty", "every business you manage", "your connected accounts" |
| Voice matches visuals | Yes | Highlights are tied to phrases (checked at 2:10, 3:50, 4:27, 5:30) |
| Transitions smooth | Yes | 0.6 s cross-fades, no cut to black mid-video, last 0.7 s fades out |
| Call to action | Yes | Frames at 6:05 to 6:16: real logo alone, SubSync, the exact words, Install once, Free for 14 days, no caption strip |
| Poster and first frame | Yes | Poster 1600x900 and 1280x720 (Today screen, small logo, one headline); first two frames of the MP4 |
| Welcome video | Yes | Beats: open (0:00), first sync (0:10), Today (0:23), date range (0:32), five-minute setup (0:40), Getting started (0:54), help and guides (1:03), "You are set" end card (1:10). No call to install; ends as asked |

## Known small issues

- Two highlight labels can overlap for a moment at a hand-over (Money at 2:30, Guides at 6:00).
- The typed search ("Harper") on Find a lead is an overlay on the real search box.
- Nothing was recorded live: stills only, so interactions such as opening a stage's deals or the merge preview are described and highlighted, not shown running.
- The Workflows chapter says only what the screen shows (95 total, 17 failing, 9 never ran, 26 need fixing). The workflow blocks for the CRM builder are not shown or claimed, because no screen for them was supplied.
- The screen chapters run at about 12 to 15 frames per second, so slow zooms can look slightly steppy.
- I did not hear the voice.
