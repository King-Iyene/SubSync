# Preview video: tools, sources and licences

The preview video (`assets/video-out/subsync-preview.mp4`, not committed) is made by the scripts in `scripts/video/`. Everything below was downloaded into `C:\Users\KING\video-tools\` (outside the repo). Nothing was run from an unknown site; every package comes from PyPI, the official Hugging Face repositories, or the official FFmpeg build site.

## Voice (text to speech, runs locally on the CPU)

| Item | Source | Size | Licence |
|---|---|---|---|
| Kokoro-82M model weights (`kokoro-v1_0.pth`, `config.json`, voice `af_heart.pt`) | https://huggingface.co/hexgrad/Kokoro-82M (official repo) | about 330 MB | Apache-2.0 (stated on the model card) |
| `kokoro` Python package 0.9.4 | https://pypi.org/project/kokoro/ | small | Apache-2.0 |
| `misaki` 0.9.4 (text to phonemes, used by Kokoro) | https://pypi.org/project/misaki/ | small | Apache-2.0 |
| `espeakng-loader` 0.2.4 (bundles the espeak-ng library used as the phoneme fallback) | https://pypi.org/project/espeakng-loader/ | 9 MB | espeak-ng is GPL-3.0-or-later. It only runs on the machine that makes the video and nothing from it is in the video or the repo |
| `spacy` 3.8.x and the `en_core_web_sm` model (language model used by misaki) | https://pypi.org/project/spacy/ and https://huggingface.co/spacy/en_core_web_sm (Explosion's official repo) | about 12 MB model | MIT |
| `torch` 2.15 (CPU), `numpy`, `soundfile`, `huggingface-hub`, `pyloudnorm` and their dependencies | PyPI | about 700 MB installed | BSD / Apache-2.0 / MIT |

Why Kokoro: it is the most natural-sounding open model that runs in real time on a laptop CPU (82 million parameters), the licence allows commercial use of the audio it produces, and it needs no account or API key. The voice is `af_heart` (warm, female American English), speed 0.95. Chatterbox (MIT) was not used because it needs a GPU to run at a usable speed. Piper was not used because several of its voices carry non-commercial dataset licences.

## Music

Synthesised by `scripts/video/music.py` from sine waves (a soft pad over Am9, Fmaj7, Cmaj7 and G6 with a synthetic room reverb). No recording, sample or third-party track is used, so there is no licence to follow. You may use it freely.

## Video tools

| Item | Source | Size | Licence |
|---|---|---|---|
| FFmpeg 9.0.2 "essentials" build for Windows (`ffmpeg.exe`, `ffprobe.exe`) | https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip (the build site linked from ffmpeg.org; the SHA-256 on the site was checked) | 115 MB zip | GPL-3.0 build of FFmpeg (LGPL/GPL libraries). The tool is only used to make the file; the MP4 is not affected by its licence |
| Playwright (Chromium) for recording | already a dev dependency of this repo | n/a | Apache-2.0 |
| `uv` (Python installer) and CPython 3.12.11 | `uv` was already installed; CPython came from Astral's python-build-standalone via `uv` | about 40 MB | Python licence (PSF) |

## On screen

All screens are recorded from the demo company (made-up businesses and people) with the demo and sample labels hidden by `scripts/video/lib.mjs`. The logo is the real SubSync logo (`assets/brand/subsync-logo-main.png`, cut out to `assets/brand/subsync-logo-main-transparent.png` by `scripts/video/logo-cutout.mjs`, colours unchanged). The chat message is King's own real test alert (`assets/video-in/real-slack-alert.png`). The email and the contacts list are drawn in plain HTML with no company marks. The first minute (people, objects, clocks, calendars) is drawn in code by `scripts/video/scenes.mjs`; nothing is borrowed. Music is synthesised for 262 s (it is trimmed to each video's length).

## v4 and the welcome video

- v4 (`subsync-preview.mp4`, 6:16) adds every sidebar page plus Settings, Getting started, What's new and Guides. The screens are the listing screenshots 19 to 44 (full-frame flow tree, expanded tree, bell, alert settings, getting started, what's new, guide, workflows, overview, settings pages). The tool name in the Meeting notes screen and the Connections card is covered by `scripts/video/mask.mjs`, and the feedback footer is covered on the Team screen.
- The welcome video (`subsync-welcome.mp4`, about 78 s, script in `scripts/video/script-welcome.json`) reuses the same stills, voice, music and logo treatment. Captions for the web are in `subsync-preview.vtt` and `subsync-welcome.vtt`.
- Nothing new was downloaded for v4 or the welcome video. No database or demo server was used.
