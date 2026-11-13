// Records every shot of the preview video from the running demo (screenshot mode) as 30 fps clips.
// Usage: node scripts/video/record.mjs <work dir> [shot,shot...]     (needs plan.json from plan.mjs, the demo server on BASE)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, openScreen, scanText, sleep, moveTo, glideClick, hoverGlide, centerOf, caption, startCapture, BASE } from "./lib.mjs";

const WORK = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(",") : null;
const FFMPEG = process.env.FFMPEG || "C:/Users/KING/video-tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe";
const plan = JSON.parse(fs.readFileSync(path.join(WORK, "plan.json"), "utf8"));
const LOGO = fs.readFileSync(new URL("../../public/brand/subsync-logo.svg", import.meta.url), "utf8");
const shotPlan = (id) => plan.shots.find((s) => s.id === id);

const { browser, ctx } = await launch();
const page = await ctx.newPage();
const problems = [];
const pages = {};
await ctx.route("**/__v/*", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: pages[new URL(r.request().url()).pathname.split("/").pop()] }));
const showHtml = async (name, html) => { pages[name] = html; await page.goto(`${BASE}/__v/${name}`, { waitUntil: "load" }); };

// ---- page helpers -------------------------------------------------------------------------------------------------
const scrollTo = (y, ms = 900) => page.evaluate(([yy, dur]) => new Promise((res) => {
  const els = [document.querySelector("main"), document.scrollingElement].filter(Boolean);
  const el = els.find((e) => e.scrollHeight > e.clientHeight + 4) || els[1];
  const y0 = el.scrollTop, t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; el.scrollTop = y0 + (yy - y0) * e; p < 1 ? requestAnimationFrame(step) : res(); };
  requestAnimationFrame(step);
}), [y, ms]);
const scrollToEl = async (loc, topPad = 220, ms = 900) => {
  const y = await loc.first().evaluate((e, pad) => { const r = e.getBoundingClientRect(); const els = [document.querySelector("main"), document.scrollingElement].filter(Boolean); const el = els.find((x) => x.scrollHeight > x.clientHeight + 4) || els[1]; return el.scrollTop + r.top - pad; }, topPad);
  await scrollTo(Math.max(0, y), ms);
};
// Zoom the content pane (not the sidebar or the captions) slowly toward a point given in viewport pixels.
const zoom = (scale, cx, cy, sec = 5) => page.evaluate(([s, x, y, d]) => {
  const m = document.querySelector("main"); if (!m) return;
  const r = m.getBoundingClientRect();
  m.parentElement.style.overflow = "hidden";
  m.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
  m.style.transition = `transform ${d}s cubic-bezier(.45,0,.35,1)`;
  m.style.transform = `scale(${s})`;
}, [scale, cx, cy, sec]);
const resetZoom = () => page.evaluate(() => { const m = document.querySelector("main"); if (m) { m.style.transition = "none"; m.style.transform = "none"; } });

async function clean(id) {
  const bad = await scanText(page);
  if (bad) { problems.push(`${id}: on-screen text matched "${bad}"`); console.log(`  WARN ${id}: "${bad}" on screen`); }
}

// ---- recording ------------------------------------------------------------------------------------------------------
async function record(id, choreo) {
  if (only && !only.includes(id)) return;
  const sp = shotPlan(id);
  const dir = path.join(WORK, "frames", id);
  fs.rmSync(dir, { recursive: true, force: true });
  const cap = await startCapture(page, dir);
  for (let i = 0; i < 40 && cap.frames.length === 0; i++) { await page.mouse.move(5, 5 + (i % 2)); await sleep(100); }
  await sleep(150);
  const epoch0 = Date.now() / 1000, p0 = performance.now();
  const at = async (sec) => { const w = sec * 1000 - (performance.now() - p0); if (w > 0) await sleep(w); };
  const T = { at, lineStart: (lid) => sp.lines.find((l) => l.id === lid).clipStart, lineEnd: (lid) => { const l = sp.lines.find((x) => x.id === lid); return l.clipStart + l.dur; } };

  const captions = (async () => {
    for (const l of sp.lines) {
      const chunks = id === "hook" ? [{ t: plan.lines.find((x) => x.id === l.id).text, kind: "hook" }] : l.chunks.map((t) => ({ t }));
      const total = chunks.reduce((a, c) => a + c.t.length, 0);
      let acc = 0;
      for (const c of chunks) {
        await at(l.clipStart + 0.03 + (l.dur - 0.06) * (acc / total));
        await caption(page, c.t, c.kind);
        acc += c.t.length;
      }
      await at(l.clipStart + l.dur + 0.25);
      await caption(page, "");
    }
  })();
  const oops = (e) => { const m = String(e).split(String.fromCharCode(10))[0].slice(0, 160); problems.push(`${id}: ${m}`); console.log("  CHOREO ERROR", id, m); };
  await Promise.all([choreo(T).catch(oops), captions]);
  await at(sp.len);
  await cap.stop();
  await caption(page, "");
  // Frames -> 30 fps clip. Each frame is held until the next one arrived; the first frame is held from the clip start.
  const ts = cap.frames;
  const lines = [];
  let used = 0;
  for (let i = 0; i < ts.length; i++) {
    const start = Math.max(ts[i], epoch0), end = Math.min(i + 1 < ts.length ? ts[i + 1] : epoch0 + sp.len, epoch0 + sp.len);
    if (end <= epoch0 || start >= epoch0 + sp.len) continue;
    const d = Math.max(end - start, 1 / 60);
    lines.push(`file '${path.join(dir, `f${String(i).padStart(5, "0")}.jpg`).split("\\").join("/")}'`, `duration ${d.toFixed(4)}`);
    used++;
  }
  // The concat demuxer needs the last file repeated without a duration.
  const lastFile = lines.filter((l) => l.startsWith("file")).pop();
  lines.push(lastFile);
  fs.writeFileSync(path.join(dir, "list.txt"), lines.join("\n"));
  const out = path.join(WORK, `clip-${id}.mp4`);
  execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", `fps=30,scale=1920:1080,format=yuv420p`, "-t", sp.len.toFixed(3), "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-r", "30", out]);
  console.log(`${id}: ${cap.frames.length} frames (${used} used) -> ${path.basename(out)} (${sp.len.toFixed(1)}s)`);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function prepare(hash, settle, warm = 0) {
  await resetZoom().catch(() => undefined);
  await openScreen(page, hash, { settle, warm });
  await page.mouse.move(1240, 640);
}

await (await import("./record-tail.mjs")).run({ record, page, showHtml, plan, only, sleep, moveTo });
await browser.close();
if (problems.length) console.log("\nPROBLEMS:\n" + problems.join("\n"));

