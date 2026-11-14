// Builds the timeline from the real length of each voice line. Usage: node scripts/video/plan.mjs <work dir with wav/>
// Output: <work>/plan.json  (shots with clip length, lines with start time inside the clip and on the final timeline, caption chunks)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WORK = process.argv[2];
const FFPROBE = process.env.FFPROBE || "C:/Users/KING/video-tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe";
const lines = JSON.parse(fs.readFileSync(process.env.SCRIPT || new URL("./script.json", import.meta.url), "utf8"));
const dur = (f) => parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

const OVERLAP = 0.6, GAP = 0.5;
// head = quiet time before the first line, tail = hold after the last line (the shot's own end, which also fades into the next shot).
const order = [...new Set(lines.map((l) => l.shot))];
const SHOTS = order.map((id) => ({ id, head: id.startsWith("p_") || id === "what" ? 0.5 : 0.6, tail: id === "p_client" ? 1.2 : id.startsWith("p_") ? 0.4 : id === "what" ? 0.9 : id === "close" ? 3.4 : 1.5 + parseFloat(process.env.TAIL_EXTRA || 0) }));

function chunks(text) {
  // Cut at sentence ends and commas, then split anything still over ~58 characters at a space near the middle.
  const parts = text.match(/[^.,]+[.,]?/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= 58) { out.push(p); continue; }
    const mid = p.lastIndexOf(" ", Math.floor(p.length / 2) + 6);
    out.push(p.slice(0, mid).trim(), p.slice(mid).trim());
  }
  // Join tiny fragments ("Mark the four now.") onto a neighbour only when both stay short.
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && (last.length < 22 || c.length < 14) && last.length + c.length < 60 && !/[.]$/.test(last)) merged[merged.length - 1] = `${last} ${c}`; else merged.push(c);
  }
  return merged;
}

let cursor = 0; // start of the current shot on the final timeline
const plan = { overlap: OVERLAP, shots: [], lines: [], total: 0 };
for (const s of SHOTS) {
  const ls = lines.filter((l) => l.shot === s.id);
  let t = s.head;
  const inShot = [];
  ls.forEach((l, i) => {
    const d = dur(path.join(WORK, "wav", `${l.id}.wav`));
    const lineObj = { ...l, dur: d, clipStart: t, start: cursor + t, chunks: chunks(l.text) };
    inShot.push(lineObj); plan.lines.push(lineObj);
    t += d + (i < ls.length - 1 ? GAP : 0);
  });
  const len = t + s.tail;
  plan.shots.push({ id: s.id, start: cursor, len, head: s.head, tail: s.tail, lines: inShot.map((l) => ({ id: l.id, clipStart: l.clipStart, dur: l.dur, chunks: l.chunks })) });
  cursor += len - OVERLAP;
}
plan.total = cursor + OVERLAP;
fs.writeFileSync(path.join(WORK, "plan.json"), JSON.stringify(plan, null, 1));
console.log("shots:", plan.shots.map((s) => `${s.id} ${s.len.toFixed(1)}s`).join(", "), "| total", plan.total.toFixed(1), "s");
