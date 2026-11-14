// The permissions video for the marketplace review form ("why you need the scopes, how the data is used").
// Scenes are in scripts/video/script-scopes.json. Cards are drawn in HTML; screens are real screenshots of the demo company (made-up businesses and people, no real customer data),
// with the caption burned in by the same helper the tour video uses. Narration is Kokoro (local, Apache-2.0), the same voice as the tour.
//   node scripts/video/scopes-video.mjs shots     (needs the demo server: npm run build, then node scripts/demo-server.mjs 3410; BASE=http://localhost:3410)
//   node scripts/video/scopes-video.mjs tts
//   node scripts/video/scopes-video.mjs compose
//   node scripts/video/scopes-video.mjs all
// Output: assets/video-out/subsync-scopes.mp4, subsync-scopes-poster.png, subsync-scopes.vtt (work files in assets/video-out/scopes-work). Nothing is uploaded.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launch, scanText, sleep, caption, BASE, W, H } from "./lib.mjs";

// Own screen opener: one page load (no reload), then wait until real numbers are on screen.
async function open(page, hash) {
  const BAD = /taking longer|taking too long|something went wrong|Error ID|Loading.../i;
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/app?shots=1#${hash}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const ok = await page.waitForSelector("main", { timeout: 180000 }).then(() => true).catch(() => false);
    if (!ok) { await page.screenshot({ path: path.join(WORK, `fail-${hash}-${i}.png`) }).catch(() => undefined); console.log("main not visible, try", i, hash); continue; }
    await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 400 }).catch(() => undefined);
    // The remote database can be slow: poll for up to 3 minutes, pressing Try again, until the screen has real content.
    for (let k = 0; k < 36; k++) {
      await sleep(5000);
      const t = await page.locator("main").innerText();
      const busy = await page.locator("main [class*=skeleton i], main [class*=animate-pulse], main [aria-busy=true]").count();
      if (!BAD.test(t) && busy === 0) { await sleep(2500); return; }
      if (k % 4 === 3) for (const b of await page.getByRole("button", { name: /^try again$/i }).all()) await b.click({ timeout: 800 }).catch(() => undefined);
    }
  }
  throw new Error(`screen ${hash} never finished loading`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const OUT = process.env.SUBSYNC_VIDEO_OUT || path.join(root, "assets", "video-out");
const WORK = path.join(OUT, "scopes-work");
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const FFMPEG = process.env.FFMPEG || path.join(HOME, "video-tools", "ffmpeg", "ffmpeg-9.0.2-essentials_build", "bin", "ffmpeg.exe");
const PY = process.env.VIDEO_PY || path.join(HOME, "video-tools", "venv", "Scripts", "python.exe");
const script = JSON.parse(fs.readFileSync(path.join(here, "script-scopes.json"), "utf8"));
const scenes = script.scenes;
fs.mkdirSync(path.join(WORK, "img"), { recursive: true });
fs.mkdirSync(path.join(WORK, "wav"), { recursive: true });
fs.mkdirSync(path.join(WORK, "clips"), { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const logo = "data:image/png;base64," + fs.readFileSync(path.join(root, "assets", "brand", "subsync-logo-main-transparent.png")).toString("base64");

function cardHtml(s) {
  const base = `*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;background:#070b10;color:#eef2f6;font-family:"Segoe UI",Arial,Helvetica,sans-serif;overflow:hidden}
  body{background:radial-gradient(1100px 600px at 85% -10%,rgba(56,189,248,.16),transparent 60%),radial-gradient(900px 500px at -5% 110%,rgba(99,102,241,.14),transparent 60%),#070b10}
  .logo{position:absolute;right:70px;top:48px;height:54px}`;
  if (s.style === "intro" || s.style === "outro") {
    return `<style>${base}.c{position:absolute;inset:0 0 180px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 200px;gap:34px}
    .c img{height:150px}.c h1{font-size:84px;font-weight:700;letter-spacing:-1px}.c p{font-size:38px;line-height:1.35;color:#9fb0c0;max-width:1300px}</style>
    <div class="c"><img src="${logo}"><h1>${esc(s.title)}</h1><p>${esc(s.sub)}</p></div>`;
  }
  const dense = !!s.dense || s.rows.length >= 6, fs1 = dense ? 25 : 31, fs2 = dense ? 18 : 21, gap = dense ? 10 : 16;
  const rows = s.rows.map((r) => {
    const tag = r.k === "read" ? `<span class="t r">READ</span>` : r.k === "change" ? `<span class="t c">CHANGE</span>` : `<span class="t n">NOT ASKED</span>`;
    return `<div class="row">${tag}<div><div class="l">${esc(r.label)}</div><div class="sc">${r.scopes.map((x) => `<code>${esc(x)}</code>`).join("")}</div></div></div>`;
  }).join("");
  const foot = s.keep || dense ? "" : `<div class="note">Change permissions always show a preview first. Nothing is sent or deleted without a confirm.</div>`;
  return `<style>${base}
  .wrap{position:absolute;left:90px;right:90px;top:46px;bottom:200px;display:flex;flex-direction:column;gap:22px}
  h1{font-size:68px;font-weight:700;letter-spacing:-.5px;display:flex;align-items:center;gap:28px}
  .badge{font-size:26px;font-weight:600;padding:6px 20px;border-radius:999px;background:rgba(56,189,248,.14);color:#7dd3fc;border:1px solid rgba(56,189,248,.35)}
  .rows{display:flex;flex-direction:column;gap:${gap}px}
  .row{display:flex;gap:22px;align-items:flex-start;padding:${dense ? 9 : 14}px 22px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
  .t{flex:none;width:130px;text-align:center;font-size:19px;font-weight:700;letter-spacing:1px;padding:7px 0;border-radius:8px;margin-top:3px}
  .t.r{background:rgba(52,211,153,.14);color:#6ee7b7}.t.c{background:rgba(251,191,36,.14);color:#fcd34d}.t.n{background:rgba(248,113,113,.14);color:#fca5a5}
  .l{font-size:${fs1}px;font-weight:600;line-height:1.25}.sc{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  code{font:600 ${fs2}px Consolas,"Cascadia Mono",monospace;color:#a5b4fc;background:rgba(99,102,241,.14);padding:3px 10px;border-radius:7px}
  .note{font-size:24px;color:#8a9bab}</style>
  <img class="logo" src="${logo}"><div class="wrap"><h1>${esc(s.title)}<span class="badge">${esc(s.badge || "")}</span></h1><div class="rows">${rows}</div>${foot}</div>`;
}

async function shots() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  const cards = {};
  await ctx.route("**/__card/*", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: cards[new URL(r.request().url()).pathname.split("/").pop()] }));
  const problems = [];
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  for (const s of scenes) {
    if (only && !only.includes(s.id)) continue;
    const file = path.join(WORK, "img", `${s.id}.png`);
    if (s.kind === "card") {
      cards[s.id] = `<!doctype html><html><head><meta charset="utf-8"></head><body>${cardHtml(s)}</body></html>`;
      await page.goto(`${BASE}/__card/${s.id}`, { waitUntil: "load" });
    } else {
      try { await open(page, s.go.hash); } catch (e) { problems.push(`${s.id}: ${e.message}`); console.log("SKIPPED", s.id); continue; }
      for (const name of s.go.click || []) {
        const loc = page.getByRole("tab", { name }).or(page.getByRole("button", { name })).or(page.getByText(name, { exact: true })).first();
        await loc.click({ timeout: 8000 }).catch((e) => problems.push(`${s.id}: could not click "${name}": ${e.message.split("\n")[0]}`));
        for (let k = 0; k < 18; k++) {
          await sleep(5000);
          const busy = await page.locator("main [class*=skeleton i], main [class*=animate-pulse], main [aria-busy=true]").count();
          if (busy === 0 && !/taking longer|taking too long|something went wrong|Error ID|Loading\.\.\./i.test(await page.locator("main").innerText())) break;
        }
        await sleep(2500);
      }
      if (s.go.scrollTo) {
        let target = page.getByText(s.go.scrollTo, { exact: true }).first();
        if (!(await target.waitFor({ timeout: 4000 }).then(() => true).catch(() => false))) target = page.getByText(s.go.scrollTo).first();
        await target.evaluate((el) => el.scrollIntoView({ block: "start" }), null, { timeout: 8000 }).catch((e) => problems.push(`${s.id}: could not scroll to "${s.go.scrollTo}": ${e.message.split("\n")[0]}`));
        await page.mouse.wheel(0, -110);
        await sleep(1200);
      }
      // Hide the "Sample data" notes and the example-data line: they are app text that must not be on the video.
      await page.evaluate(() => { for (const el of document.querySelectorAll("p,div,span")) if (el.childElementCount === 0 && /^Sample data/.test((el.textContent || "").trim())) el.style.display = "none"; const c = document.getElementById("vd-cursor"); if (c) c.style.display = "none"; });
      await page.mouse.move(W - 40, H - 40);
      const bad = await scanText(page);
      if (bad) problems.push(`${s.id}: on-screen text matched "${bad}"`);
    }
    await caption(page, s.caption);
    await sleep(700);
    await page.screenshot({ path: file });
    console.log("shot", s.id);
  }
  await browser.close();
  if (problems.length) { console.log("PROBLEMS:\n" + problems.join("\n")); fs.writeFileSync(path.join(WORK, "problems.txt"), problems.join("\n")); }
}

function tts() {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const lines = scenes.filter((s) => !only || only.includes(s.id)).map((s) => ({ id: s.id, text: s.text, speed: 0.97 }));
  fs.writeFileSync(path.join(WORK, "lines.json"), JSON.stringify(lines, null, 1));
  execFileSync(PY, ["-I", path.join(here, "tts.py"), path.join(WORK, "lines.json"), path.join(WORK, "wav")], { stdio: "inherit", env: { ...process.env, HF_HUB_OFFLINE: "1", PYTHONIOENCODING: "utf-8" } });
}

function wavSeconds(f) {
  const b = fs.readFileSync(f);
  let o = 12, rate = 24000, ch = 1, bits = 16, data = 0;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === "data") { data = Math.min(sz, b.length - o - 8); break; }
    o += 8 + sz + (sz % 2);
  }
  return data / (rate * ch * (bits / 8));
}
const ts = (s) => { const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`; };

function compose() {
  const list = [], cues = [];
  let t = 0;
  for (const s of scenes) {
    const wav = path.join(WORK, "wav", `${s.id}.wav`), img = path.join(WORK, "img", `${s.id}.png`);
    const narr = wavSeconds(wav), lead = 0.5, tail = s.kind === "card" ? 1.6 : 1.0, dur = lead + narr + tail;
    const clip = path.join(WORK, "clips", `${s.id}.mp4`);
    const zoom = s.kind === "screen" ? `scale=2880:-2,zoompan=z='1+0.00028*on':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,` : `scale=${W}:${H},fps=30,`;
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", "30", "-loop", "1", "-t", dur.toFixed(3), "-i", img, "-i", wav,
      "-filter_complex", `[0:v]${zoom}format=yuv420p[v];[1:a]adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad=whole_dur=${dur.toFixed(3)},aformat=sample_rates=44100:channel_layouts=stereo[a]`,
      "-map", "[v]", "-map", "[a]", "-t", dur.toFixed(3), "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", "-r", "30", clip], { stdio: "inherit" });
    list.push(`file '${clip.replace(/\\/g, "/")}'`);
    const sentences = s.text.match(/[^.!?]+[.!?]+/g) || [s.text];
    const tot = sentences.reduce((a, x) => a + x.length, 0);
    let ct = t + lead;
    for (const x of sentences) { const d = (narr * x.length) / tot; cues.push(`${ts(ct)} --> ${ts(ct + d)}\n${x.trim()}`); ct += d; }
    t += dur;
    console.log("clip", s.id, dur.toFixed(1), "s");
  }
  fs.writeFileSync(path.join(WORK, "list.txt"), list.join("\n"));
  const out = path.join(OUT, "subsync-scopes.mp4");
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(WORK, "list.txt"), "-c", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
  fs.writeFileSync(path.join(OUT, "subsync-scopes.vtt"), `WEBVTT\n\n${cues.join("\n\n")}\n`);
  fs.copyFileSync(path.join(WORK, "img", "S00.png"), path.join(OUT, "subsync-scopes-poster.png"));
  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log(`DONE ${out}  ${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}  ${mb} MB`);
}

const cmd = process.argv[2] || "all";
if (cmd === "shots" || cmd === "all") await shots();
if (cmd === "tts" || cmd === "all") tts();
if (cmd === "compose" || cmd === "all") compose();
