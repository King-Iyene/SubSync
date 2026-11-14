// Renders the animated scenes (pain-point story and the logo turn) frame by frame at exactly 30 fps. No server or database is used.
// Usage: node scripts/video/record-anim.mjs <work dir> [scene,...]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch } from "./lib.mjs";
import { BASE_CSS, scenes } from "./scenes.mjs";
import { whatScene } from "./logo.mjs";

const WORK = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(",") : null;
const FFMPEG = process.env.FFMPEG || "C:/Users/KING/video-tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe";
const plan = JSON.parse(fs.readFileSync(path.join(WORK, "plan.json"), "utf8"));
const ids = plan.shots.map((s) => s.id).filter((id) => id.startsWith("p_") || id === "what").filter((id) => !only || only.includes(id));
const { browser, ctx } = await launch();

async function render(id) {
  const sp = plan.shots.find((s) => s.id === id);
  const t0 = sp.head;
  const sc = id === "what" ? whatScene(t0, sp.lines[1].clipStart, sp.lines[2].clipStart) : scenes[id](t0);
  const caps = [];
  for (const l of sp.lines) {
    const total = l.chunks.reduce((a, c) => a + c.length, 0); let acc = 0;
    l.chunks.forEach((c, k) => {
      const a = l.clipStart + 0.03 + (l.dur - 0.06) * (acc / total); acc += c.length;
      const b = k === l.chunks.length - 1 ? l.clipStart + l.dur + 0.25 : l.clipStart + 0.03 + (l.dur - 0.06) * (acc / total);
      caps.push({ a, b, t: c });
    });
  }
  const html = `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style>${sc.body}<div id="cap"></div><script>
    window.__caps=${JSON.stringify(caps)};
    window.__tick=function(t){${sc.tick || ""}};
    window.__frame=function(t){document.getAnimations().forEach(function(a){a.pause();a.currentTime=t*1000;});window.__tick(t);
      var c=document.getElementById("cap"),on=null;for(var i=0;i<window.__caps.length;i++){var k=window.__caps[i];if(t>=k.a&&t<k.b){on=k;break;}}
      if(on){if(c.textContent!==on.t)c.textContent=on.t;c.style.opacity=Math.max(0,Math.min(1,(t-on.a)/0.14,(on.b-t)/0.14));}else c.style.opacity=0;};
  </script>`;
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const dir = path.join(WORK, "anim", id);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(sp.len * 30);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.__frame(t), i / 30);
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, "0")}.jpg`), await page.screenshot({ type: "jpeg", quality: 92 }));
  }
  await page.close();
  execFileSync(FFMPEG, ["-y", "-v", "error", "-framerate", "30", "-i", path.join(dir, "f%05d.jpg"), "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "30", path.join(WORK, `clip-${id}.mp4`)]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(id, n, "frames");
}
const queue = [...ids];
await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) await render(queue.shift()); }));
await browser.close();
