// Builds the web copy of the tour video from the finished master, so swapping the video later is ONE command:
//   node scripts/make-web-video.mjs [--src <master.mp4>] [--poster <poster.png>] [--plan <plan.json>] [--no-1080]
// Defaults read assets/video-out/ (the folder the video tool writes to). Output: public/video/subsync-tour-720.mp4, optionally subsync-tour-1080.mp4,
// subsync-tour-poster.jpg and subsync-tour.en.vtt (captions, built from the caption plan). The 62 MB master is never committed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const outDir = join(root, "public", "video");
const videoOut = process.env.SUBSYNC_VIDEO_OUT ?? join(root, "assets", "video-out");
const src = resolve(arg("src", join(videoOut, "subsync-preview.mp4")));
const poster = resolve(arg("poster", join(videoOut, "subsync-preview-poster-1280.png")));
const planPath = arg("plan", join(root, "scripts", "video", "captions-plan.json"));

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const base = join(home, "video-tools", "ffmpeg");
  if (existsSync(base)) for (const d of readdirSync(base)) { const p = join(base, d, "bin", "ffmpeg.exe"); if (existsSync(p)) return p; }
  return "ffmpeg";
}

const ts = (s) => { const ms = Math.round(s * 1000); const p = (n, w = 2) => String(n).padStart(w, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`; };

/** WebVTT from the caption plan: each spoken line is split into its chunks, with time shared out by length. A plan.json from the video tool also works (it has the same `lines`). */
export function buildVtt(plan) {
  const cues = [];
  for (const line of plan.lines) {
    const total = line.chunks.reduce((a, c) => a + c.length, 0) || 1;
    let t = line.start;
    for (const c of line.chunks) { const d = (line.dur * c.length) / total; cues.push(`${ts(t)} --> ${ts(t + d)}\n${c}`); t += d; }
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function main() {
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(src)) throw new Error(`Master video not found: ${src}`);
  const ff = findFfmpeg();
  const enc = (height, name, crf = "24") => {
    const out = join(outDir, name);
    execFileSync(ff, ["-y", "-i", src, "-vf", `scale=-2:${height}`, "-c:v", "libx264", "-profile:v", "high", "-crf", crf, "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], { stdio: "inherit" });
    return out;
  };
  const f720 = enc(720, "subsync-tour-720.mp4");
  console.log("720p:", (statSync(f720).size / 1048576).toFixed(1), "MB");
  if (!process.argv.includes("--no-1080")) {
    const f1080 = enc(1080, "subsync-tour-1080.mp4");
    const mb = statSync(f1080).size / 1048576;
    console.log("1080p:", mb.toFixed(1), "MB");
    if (mb > 30) console.log("1080p is over 30 MB: delete it, the site uses the 720p file.");
  }
  if (existsSync(poster)) {
    execFileSync(ff, ["-y", "-i", poster, "-vf", "scale=1280:-2", "-q:v", "3", join(outDir, "subsync-tour-poster.jpg")], { stdio: "inherit" });
  }
  if (existsSync(planPath)) {
    writeFileSync(join(outDir, "subsync-tour.en.vtt"), buildVtt(JSON.parse(readFileSync(planPath, "utf8"))));
    console.log("captions written");
  } else console.log("No caption plan found: captions were not rebuilt.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
