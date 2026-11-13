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

// ---- shots ----------------------------------------------------------------------------------------------------------
// The app shots are the 1600x900 listing screenshots (demo company, labels hidden) with a slow zoom and a cursor, so no database or server is needed.
// Set STILLS to the folder with the PNGs (default: assets/listing/upload-ready in the main checkout).
const STILLS = process.env.STILLS || "C:/Users/KING/OneDrive/Desktop/SubSync/assets/listing/upload-ready";
const uri = (n) => "data:image/png;base64," + fs.readFileSync(path.join(STILLS, n)).toString("base64");
const S = 1.2; // 1600 -> 1920
const showStill = (id, name) => showHtml(id, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111"><div style="width:1920px;height:1080px;overflow:hidden"><main style="display:block;width:1920px;height:1080px"><img id="im" style="display:block" width="1920" height="1080" src="${uri(name)}"></main></div>`);
const swap = async (name) => { await resetZoom(); await page.evaluate((u) => { document.getElementById("im").src = u; }, uri(name)); await sleep(250); };
const P = (x, y) => [x * S, y * S];
const glide = (x, y, ms = 1200) => moveTo(page, x * S, y * S, ms);
const zoomAt = (sc, x, y, sec) => zoom(sc, x * S, y * S, sec);

if (!only || only.includes("hook")) {
  await showStill("hook", "01-today.png"); await page.mouse.move(1500, 800);
  await record("hook", async (T) => { await T.at(0.4); await zoomAt(1.14, 340, 230, 5.4); await glide(430, 300, 1900); });
}
if (!only || only.includes("speed")) {
  await showStill("speed", "02-speed-to-lead.png"); await page.mouse.move(1500, 800);
  await record("speed", async (T) => {
    await T.at(0.7); await zoomAt(1.15, 420, 520, 3.8); await glide(400, 480, 1500);
    await T.at(T.lineStart("L03") - 0.1); await resetZoom(); await zoomAt(1.12, 400, 700, 5);
    await T.at(T.lineStart("L03") + 1.2); await glide(395, 683, 1300);
    await T.at(T.lineStart("L03") + 4.0); await glide(1070, 800, 1500);
  });
}
if (!only || only.includes("appts")) {
  await showStill("appts", "03-appointments.png"); await page.mouse.move(1500, 800);
  await record("appts", async (T) => {
    await T.at(0.7); await zoomAt(1.14, 500, 700, 5.5); await glide(380, 636, 1400);
    await T.at(T.lineStart("L04") + 3.6); await glide(957, 740, 1200);
    await T.at(T.lineStart("L05") + 0.2); await glide(622, 740, 1000);
    await T.at(T.lineStart("L05") + 2.0); await glide(343, 816, 1100);
  });
}
if (!only || only.includes("funnel")) {
  await showStill("funnel", "01-today.png"); await page.mouse.move(1500, 800);
  await record("funnel", async (T) => {
    await T.at(0.7); await zoomAt(1.14, 340, 230, 4.5); await glide(300, 250, 1500);
    await T.at(T.lineEnd("L06") + 0.1); await swap("11-pipeline-funnel.png");
    await zoomAt(1.1, 870, 400, 6);
    await T.at(T.lineStart("L07") + 3.4); await glide(308, 205, 1300);
    await sleep(250); await page.mouse.down(); await sleep(70); await page.mouse.up();
    await T.at(T.lineStart("L07") + 6.4); await glide(1324, 411, 1200);
    await sleep(250); await page.mouse.down(); await sleep(70); await page.mouse.up();
  });
}
if (!only || only.includes("clients")) {
  await showStill("clients", "04-clients.png"); await page.mouse.move(1500, 800);
  await record("clients", async (T) => {
    await T.at(0.7); await zoomAt(1.12, 900, 560, 5);
    await T.at(T.lineStart("L08") + 2.4); await glide(640, 635, 1200);
    await T.at(T.lineStart("L08") + 4.6); await glide(300, 650, 1200);
  });
}

// 6. Alerts: a clean mock of a chat alert and an email, both opening the right account in the CRM.
const CARDS = (logo) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1200px 700px at 30% 20%,#162620 0%,#0d1210 55%,#0a0d0c 100%);font-family:"Segoe UI",Arial,sans-serif;color:#e8efec;overflow:hidden;position:relative}
.ttl{position:absolute;left:150px;top:96px;font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:#7fb79e;font-weight:600}
.card{position:absolute;background:#fff;color:#1d2321;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.55);opacity:0;transform:translateY(40px) scale(.97);transition:opacity .6s ease,transform .7s cubic-bezier(.2,.8,.2,1)}
.card.on{opacity:1;transform:none}
#chat{left:150px;top:190px;width:800px;padding:0}
#mail{left:1000px;top:190px;width:770px}
.chead{display:flex;align-items:center;gap:12px;padding:18px 26px;border-bottom:1px solid #e6ebe9;font-weight:700;font-size:25px;color:#33403b}
.chead span{color:#8a9893;font-weight:500}
.msg{display:flex;gap:18px;padding:26px}
.msg img{width:62px;height:62px;border-radius:14px}
.who{font-weight:800;font-size:27px}.who i{font-style:normal;font-weight:500;color:#8a9893;font-size:21px;margin-left:10px}
.body{font-size:29px;line-height:1.38;margin-top:8px;color:#26302c}
.body b{color:#b3372b}
.btn{display:inline-block;margin-top:20px;padding:15px 26px;border-radius:12px;background:#1f6f54;color:#fff;font-weight:700;font-size:25px;transition:background .2s,box-shadow .2s}
.btn.hot{background:#2a8c6a;box-shadow:0 0 0 6px rgba(42,140,106,.28)}
.mh{padding:22px 30px;border-bottom:1px solid #e6ebe9;font-size:22px;color:#6b7873;line-height:1.5}.mh b{color:#1d2321}
.mb{padding:28px 30px 32px;font-size:28px;line-height:1.45}
.mb h4{margin:0 0 12px;font-size:32px}
.mb ul{margin:10px 0 0 26px;padding:0}.mb li{margin:6px 0}
#open{position:absolute;left:560px;top:680px;width:800px;background:#101715;border:1px solid #2a3a35;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6);opacity:0;transform:translateY(24px);transition:opacity .5s ease,transform .6s cubic-bezier(.2,.8,.2,1);overflow:hidden}
#open.on{opacity:1;transform:none}
#open .bar{display:flex;align-items:center;gap:12px;padding:14px 20px;background:#18221f;color:#9fb1aa;font-size:21px}
#open .bar i{width:13px;height:13px;border-radius:50%;background:#35453f;display:block}
#open .bar span{margin-left:12px;background:#0d1412;border-radius:8px;padding:7px 16px;flex:1}
#open .acct{padding:26px 30px;font-size:34px;font-weight:700}#open .acct small{display:block;font-size:24px;font-weight:500;color:#8fb7a6;margin-top:8px}
</style>
<div class="ttl">Alerts that find you</div>
<div class="card" id="chat"><div class="chead"># client-alerts <span>Today</span></div>
<div class="msg"><img src="data:image/svg+xml;utf8,${encodeURIComponent(logo)}"><div><div class="who">SubSync <i>9:02 AM</i></div>
<div class="body"><b>Bright Smile Dental:</b> 3 people have waited over a day for a reply. About $32,935 could be at stake.</div>
<div class="btn" id="b1">Open in your CRM</div></div></div></div>
<div class="card" id="mail"><div class="mh"><b>SubSync</b> &nbsp;to you<br>Subject: <b>3 client accounts need you today</b></div>
<div class="mb"><h4>Your morning brief</h4>Here is what changed overnight:<ul><li>Bright Smile Dental: 3 people waiting over a day</li><li>Metro Auto Repair: 3 appointments with no outcome</li><li>Sunrise Roofing Co: 3 no-shows to win back</li></ul>
<div class="btn" id="b2">Open Bright Smile Dental</div></div></div>
<div id="open"><div class="bar"><i></i><i></i><i></i><span>your-crm / Bright Smile Dental / conversations</span></div><div class="acct">Bright Smile Dental<small>3 people waiting for a reply</small></div></div>`;
if (!only || only.includes("alerts")) {
  await resetZoom().catch(() => undefined);
  await showHtml("alerts", CARDS(LOGO));
  await page.mouse.move(1500, 880);
  await record("alerts", async (T) => {
    const on = (sel) => page.evaluate((s) => document.querySelector(s).classList.add("on"), sel);
    await T.at(T.lineStart("L09") + 1.7); await on("#chat");
    await T.at(T.lineStart("L09") + 3.6); await on("#mail");
    await T.at(T.lineStart("L09") + 5.0);
    const b1 = page.locator("#b1"); const c = await centerOf(b1);
    await moveTo(page, c.x, c.y, 1100);
    await page.evaluate(() => document.querySelector("#b1").classList.add("hot"));
    await sleep(250); await page.mouse.down(); await sleep(70); await page.mouse.up();
    await sleep(250); await on("#open");
  });
}

// 7. Close card with the logo.
const CLOSE = (logo) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1300px 800px at 50% 38%,#1b3a2f 0%,#0e1613 55%,#090c0b 100%);font-family:"Segoe UI",Arial,sans-serif;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;overflow:hidden}
.logo{width:150px;height:150px;opacity:0;transform:scale(.85);transition:opacity .9s ease,transform 1.1s cubic-bezier(.2,.8,.2,1)}
.word{font-size:104px;font-weight:700;letter-spacing:-.01em;opacity:0;transform:translateY(16px);transition:opacity .9s .15s ease,transform 1s .15s ease}
.big{font-size:70px;font-weight:700;color:#e9f6f0;opacity:0;transform:translateY(16px);transition:opacity .9s ease,transform 1s ease;text-align:center}
.sub{font-size:34px;color:#8fb7a6;opacity:0;transition:opacity .9s ease;text-align:center}
.show{opacity:1!important;transform:none!important}
</style>
<img class="logo" id="lg" src="data:image/svg+xml;utf8,${encodeURIComponent(logo)}"><div class="word" id="wd">SubSync</div>
<div class="big" id="bg">Install once. Free for 14 days.</div><div class="sub" id="sb">Know what is happening in every client account.</div>`;
if (!only || only.includes("close")) {
  await resetZoom().catch(() => undefined);
  await showHtml("close", CLOSE(LOGO));
  await page.mouse.move(1900, 1070);
  await record("close", async (T) => {
    const on = (id) => page.evaluate((i) => document.getElementById(i).classList.add("show"), id);
    await T.at(0.3); await on("lg"); await on("wd");
    await T.at(T.lineStart("L10") - 0.2); await on("bg");
    await T.at(T.lineEnd("L10") + 0.3); await on("sb");
  });
}

await browser.close();
if (problems.length) console.log("\nPROBLEMS:\n" + problems.join("\n"));
