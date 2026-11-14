// Writes a WebVTT captions file from plan.json (same words and timing as the burned-in captions).
// Usage: node scripts/video/vtt.mjs <work dir> <out.vtt>
import fs from "node:fs";
import path from "node:path";
const [work, out] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(path.join(work, "plan.json"), "utf8"));
const f = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`; };
let o = "WEBVTT\n\n";
for (const l of plan.lines) {
  const total = l.chunks.reduce((a, c) => a + c.length, 0);
  let acc = 0;
  l.chunks.forEach((c, k) => {
    const a = l.start + 0.03 + (l.dur - 0.06) * (acc / total); acc += c.length;
    const b = k === l.chunks.length - 1 ? l.start + l.dur + 0.2 : l.start + 0.03 + (l.dur - 0.06) * (acc / total);
    o += `${f(a)} --> ${f(b)}\n${c}\n\n`;
  });
}
fs.writeFileSync(out, o);
console.log("vtt", plan.lines.length, "lines");
