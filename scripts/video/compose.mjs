// Joins the clips with cross-fades, builds the voice track (-16 LUFS) and the music bed (ducked under the voice), writes the MP4s and the poster.
// Usage: node scripts/video/compose.mjs <work dir> <output dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const WORK = process.argv[2], OUT = process.argv[3];
const BIN = process.env.FFBIN || "C:/Users/KING/video-tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin";
const FF = path.join(BIN, "ffmpeg.exe");
const plan = JSON.parse(fs.readFileSync(path.join(WORK, "plan.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const run = (args, opts = {}) => execFileSync(FF, ["-y", "-hide_banner", "-v", opts.v || "error", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const w = (f) => path.join(WORK, f);
const total = plan.total;

// 1. Video: cross-fade chain.
const clips = plan.shots.map((s) => w(`clip-${s.id}.mp4`));
for (const c of clips) if (!fs.existsSync(c)) throw new Error(`missing ${c}`);
let filt = "", last = "[0:v]";
plan.shots.forEach((s, i) => {
  if (i === 0) return;
  const lbl = `[x${i}]`;
  filt += `${last}[${i}:v]xfade=transition=fade:duration=${plan.overlap}:offset=${s.start.toFixed(3)}${lbl};`;
  last = lbl;
});
filt += `${last}fade=t=out:st=${(total - 0.7).toFixed(2)}:d=0.7,format=yuv420p[v]`;
run([...clips.flatMap((c) => ["-i", c]), "-filter_complex", filt, "-map", "[v]", "-r", "30", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", total.toFixed(3), w("video.mp4")]);
console.log("video.mp4 done");

// 2. Voice bus: every line placed at its start time, then loudness-normalised to -16 LUFS (two passes).
const wavs = plan.lines.map((l) => w(`wav/${l.id}.wav`));
const vf = plan.lines.map((l, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(l.start * 1000)}:all=1[a${i}]`).join(";") + ";" + plan.lines.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${plan.lines.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(2)},atrim=0:${total.toFixed(2)}[v]`;
run([...wavs.flatMap((f) => ["-i", f]), "-filter_complex", vf, "-map", "[v]", "-ac", "1", w("voice-raw.wav")]);
const m1 = spawnSync(FF, ["-hide_banner", "-i", w("voice-raw.wav"), "-af", "loudnorm=I=-16:TP=-2:LRA=7:print_format=json", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
const j = JSON.parse(m1.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/)[0]);
run(["-i", w("voice-raw.wav"), "-af", `loudnorm=I=-16:TP=-2:LRA=7:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`, "-ac", "1", w("voice.wav")]);
console.log("voice.wav done (measured", j.input_i, "LUFS before)");

// 3. Music: faded in and out, normalised, and ducked under the voice (about 22 dB below it while someone speaks).
const fadeOut = 3.8;
const musicChain = (lufs) => `loudnorm=I=${lufs}:TP=-3:LRA=7,afade=t=in:st=0:d=2,afade=t=out:st=${(total - fadeOut).toFixed(2)}:d=${fadeOut}`;
run(["-i", w("music.wav"), "-i", w("voice.wav"), "-filter_complex",
  `[0:a]atrim=0:${total.toFixed(2)},${musicChain(-30)}[m];[1:a]asplit=2[vk][vm];[m][vk]sidechaincompress=threshold=0.015:ratio=5:attack=40:release=500:makeup=1[md];[vm]volume=1.0[vv];[md][vv]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89[mix]`,
  "-map", "[mix]", "-ar", "48000", w("mix-pre.wav")]);
const m2 = spawnSync(FF, ["-hide_banner", "-i", w("mix-pre.wav"), "-af", "loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
const j2 = JSON.parse(m2.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/)[0]);
run(["-i", w("mix-pre.wav"), "-af", `loudnorm=I=-16:TP=-1.5:LRA=9:measured_I=${j2.input_i}:measured_TP=${j2.input_tp}:measured_LRA=${j2.input_lra}:measured_thresh=${j2.input_thresh}:offset=${j2.target_offset}:linear=true,aresample=48000`, w("mix-voice.wav")]);
run(["-i", w("music.wav"), "-af", `atrim=0:${total.toFixed(2)},${musicChain(-20)}`, "-ar", "48000", w("mix-silent.wav")]);

// 4. Final files.
const mux = (audio, dest) => run(["-i", w("video.mp4"), "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", total.toFixed(3), "-movflags", "+faststart", dest]);
mux(w("mix-voice.wav"), path.join(OUT, "subsync-preview.mp4"));
mux(w("mix-silent.wav"), path.join(OUT, "subsync-preview-silent.mp4"));
// Poster: the closing card with the logo, 1600x900.
const posterAt = plan.shots.find((s) => s.id === "close").start + 11.0;
run(["-ss", posterAt.toFixed(2), "-i", w("video.mp4"), "-frames:v", "1", "-vf", "scale=1600:900:flags=lanczos", path.join(OUT, "subsync-preview-poster.png")]);
console.log("done", total.toFixed(1), "s");
