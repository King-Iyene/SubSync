// The feature chapters: listing screenshots with slow zooms and a cursor, plus the alert and closing cards.
// Imported by record.mjs, which owns the browser and the frame capture. Coordinates are in the 1600x900 screenshot space.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { logoData, logoCss } from "./logo.mjs";

export const STILLS = process.env.STILLS || "C:/Users/KING/OneDrive/Desktop/SubSync/assets/listing/upload-ready";
export const SLACK = process.env.SLACK_SHOT || "C:/Users/KING/OneDrive/Desktop/SubSync/assets/video-in/real-slack-alert.png";
const S = 1.2;
const uri = (n) => "data:image/png;base64," + fs.readFileSync(path.join(STILLS, n)).toString("base64");

// ops: z = zoom (scale, x, y, seconds), g = glide cursor (x, y, ms), c = glide then click, s = swap picture, r = zoom out
export const CHAPTERS = {
  today: { img: "01-today.png", mv: [[0.0, "z", 1.15, 340, 230, 5], [0.0, "g", 430, 300, 1800], [0.3, "z", 1.12, 400, 730, 4], [0.3, "g", 310, 727, 1600], [0.62, "z", 1.1, 1470, 580, 3.5], [0.62, "g", 1470, 580, 1500]] },
  speed: { img: "02-speed-to-lead.png", mv: [[0.0, "z", 1.15, 420, 520, 4], [0.0, "g", 400, 480, 1600], [0.33, "z", 1.12, 400, 690, 4], [0.33, "g", 395, 683, 1500], [0.6, "z", 1.1, 1100, 800, 3.5], [0.6, "g", 1050, 805, 1500], [0.82, "z", 1.15, 1372, 590, 3], [0.82, "g", 1372, 590, 1200]] },
  appts: { img: "03-appointments.png", mv: [[0.0, "z", 1.14, 500, 700, 5], [0.0, "g", 380, 636, 1400], [0.2, "g", 957, 740, 1200], [0.34, "g", 622, 740, 1000], [0.46, "r"], [0.5, "s", "17-appointments-flow-tree.png"], [0.54, "z", 2.1, 1340, 800, 4], [0.54, "g", 1340, 800, 1500], [0.8, "g", 1450, 770, 1500]] },
  funnel: { img: "11-pipeline-funnel.png", mv: [[0.0, "z", 1.1, 870, 400, 6], [0.12, "g", 360, 289, 1500], [0.3, "c", 308, 205, 1400], [0.5, "z", 1.25, 470, 770, 3.5], [0.5, "g", 470, 770, 1500], [0.7, "c", 1324, 411, 1400], [0.88, "g", 1400, 300, 1200]] },
  find: { img: "06-find-a-lead.png", mv: [[0.0, "z", 1.15, 400, 270, 4], [0.0, "g", 400, 268, 1500], [0.2, "g", 640, 178, 1500], [0.4, "r"], [0.45, "s", "22-find-a-lead-going-cold.png"], [0.5, "z", 1.15, 1080, 270, 4], [0.5, "g", 1000, 300, 1500], [0.78, "g", 1540, 376, 1300]] },
  clean: { img: "09-cleanup-duplicates.png", mv: [[0.0, "z", 1.2, 330, 195, 4], [0.0, "g", 330, 195, 1500], [0.28, "g", 950, 215, 1400], [0.5, "g", 1440, 250, 1400], [0.72, "c", 1550, 250, 1400]] },
  clients: { img: "04-clients.png", mv: [[0.0, "z", 1.12, 900, 560, 5], [0.0, "g", 640, 635, 1500], [0.28, "g", 300, 650, 1400], [0.5, "r"], [0.55, "s", "05-money.png"], [0.6, "z", 1.12, 400, 540, 4], [0.6, "g", 400, 560, 1500]] },
  audit: { img: "07-account-audit.png", mv: [[0.0, "z", 1.15, 700, 345, 5], [0.0, "g", 700, 345, 1500], [0.28, "g", 330, 720, 1400], [0.47, "r"], [0.5, "s", "08-team.png"], [0.55, "z", 1.15, 340, 494, 4], [0.55, "g", 340, 494, 1500], [0.8, "g", 400, 640, 1300]] },
};

export const stillPage = (name) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111"><div style="width:1920px;height:1080px;overflow:hidden;position:relative"><main id="mn" style="display:block;width:1920px;height:1080px;position:relative;transform-origin:0 0"><img id="im" style="display:block;position:absolute;left:0;top:0" width="1920" height="1080" src="${uri(name)}"><img id="im2" style="display:block;position:absolute;left:0;top:0;opacity:0;transition:opacity .8s ease" width="1920" height="1080"></main></div>`;

export async function runChapter(page, ch, T, sleep, moveTo, tf) {
  const mn = (fn, ...a) => page.evaluate(fn, ...a);
  const zoom = (s, x, y, sec) => mn(([s, x, y, sec]) => { const m = document.getElementById("mn"); x *= 1.2; y *= 1.2; const tx = -x * (s - 1) + (960 - x) * 0.6 * (s - 1), ty = -y * (s - 1) + (540 - y) * 0.6 * (s - 1); m.style.transition = `transform ${sec}s cubic-bezier(.45,0,.35,1)`; m.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; }, [s, x, y, sec]);
  const rest = () => mn(() => { const m = document.getElementById("mn"); m.style.transition = "transform 1.2s cubic-bezier(.45,0,.35,1)"; m.style.transform = "translate(0px,0px) scale(1)"; });
  const swap = async (name) => { await mn((u) => { const b = document.getElementById("im2"); b.src = u; b.style.opacity = 1; }, uri(name)); await sleep(900); await mn(() => { const a = document.getElementById("im"), b = document.getElementById("im2"); a.src = b.src; b.style.transition = "none"; b.style.opacity = 0; void b.offsetWidth; b.style.transition = "opacity .8s ease"; }); };
  for (const [f, op, a, b, c, d] of ch.mv) {
    await T.at(tf(f));
    if (op === "z") zoom(a, b, c, d);
    else if (op === "r") rest();
    else if (op === "s") await swap(a);
    else if (op === "g") await moveTo(page, a * S, b * S, c);
    else if (op === "c") { await moveTo(page, a * S, b * S, c); await sleep(200); await page.mouse.down(); await sleep(70); await page.mouse.up(); }
  }
}

// ---- alerts: the real chat message, an email in the same style, and the CRM list it opens ---------------------------
export async function alertsHtml() {
  const buf = await sharp(SLACK).resize({ width: 1500, kernel: "lanczos3" }).sharpen({ sigma: 0.7 }).png().toBuffer();
  const slack = "data:image/png;base64," + buf.toString("base64");
  const k = 1500 / 600; // upscale factor of the chat picture
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1200px 700px at 30% 20%,#162620 0%,#0d1210 55%,#0a0d0c 100%);font-family:"Segoe UI",Arial,sans-serif;color:#e8efec;overflow:hidden;position:relative}
.ttl{position:absolute;left:210px;top:56px;font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:#7fb79e;font-weight:600}
.ph{position:absolute;inset:0;opacity:0;transition:opacity .8s ease}.ph.show{opacity:1}
#slackcard{position:absolute;left:180px;top:250px;width:1560px;padding:30px;border-radius:26px;background:#222529;border:1px solid #3a3f45;box-shadow:0 40px 100px rgba(0,0,0,.6)}
#slackcard img{display:block;width:1500px;height:${Math.round(155 * k)}px;image-rendering:auto}
.hl{position:absolute;border-radius:10px;background:rgba(224,162,58,.20);box-shadow:0 0 34px rgba(224,162,58,.55);width:0;transition:width 1s cubic-bezier(.3,.7,.2,1)}
.ul{position:absolute;height:5px;border-radius:3px;background:#4aa3ff;box-shadow:0 0 18px rgba(74,163,255,.9);width:0;transition:width .9s cubic-bezier(.3,.7,.2,1)}
#mailcard{position:absolute;left:310px;top:110px;width:1300px;border-radius:20px;background:#fff;color:#202124;box-shadow:0 40px 100px rgba(0,0,0,.6);overflow:hidden}
.mtop{display:flex;gap:18px;align-items:center;padding:18px 34px;border-bottom:1px solid #e3e6e8;color:#5f6368;font-size:24px}.mtop i{width:24px;height:24px;border-radius:6px;background:#dadce0;display:block}
.msub{padding:20px 40px 4px;font-size:38px;font-weight:600}
.mfrom{display:flex;gap:18px;align-items:center;padding:8px 40px 8px}.av{width:64px;height:64px;border-radius:50%;background:#2b6c8f;color:#fff;font-weight:700;font-size:34px;display:flex;align-items:center;justify-content:center}
.mfrom b{font-size:28px}.mfrom span{color:#5f6368;font-size:24px;display:block}
.mbody{padding:4px 40px 28px 122px;font-size:28px;line-height:1.42}.mbody ul{margin:8px 0 8px 30px;padding:0}.mbody a{color:#1a73e8;text-decoration:underline;font-weight:600}
.dot{display:inline-block;width:18px;height:18px;border-radius:50%;background:#f4900c;margin-right:8px}
#crm{position:absolute;left:200px;top:170px;width:1520px;border-radius:20px;background:#fff;color:#1f2933;box-shadow:0 40px 100px rgba(0,0,0,.6);overflow:hidden}
.ch{display:flex;justify-content:space-between;align-items:center;padding:24px 36px;border-bottom:1px solid #e4e7eb;font-size:36px;font-weight:700}.ch small{font-size:24px;font-weight:500;color:#7b8794;margin-left:14px}
.row{display:grid;grid-template-columns:70px 1.4fr 1fr 1fr 1fr;align-items:center;padding:20px 36px;border-bottom:1px solid #eef0f2;font-size:28px;color:#323f4b}.row.h{font-size:22px;color:#7b8794;text-transform:uppercase;letter-spacing:.08em;background:#f7f8fa}
.row .cb{width:26px;height:26px;border:2px solid #b8c1cc;border-radius:6px}.row .miss{color:#c0392b;font-weight:600}
.row.hi{background:#fff7e0;box-shadow:inset 6px 0 0 #e0a23a}
</style><div class="ttl" id="ttl">An alert in Slack</div>
<div class="ph" id="p1"><div id="slackcard"><img src="${slack}"></div>
 <div class="hl" id="h1" style="left:${180 + 30 + 40 * k / 2.5}px;top:${250 + 30 + 22 * k}px;height:${Math.round(20 * k)}px"></div>
 <div class="ul" id="u1" style="left:${180 + 30 + 30 * k}px;top:${250 + 30 + 150 * k}px"></div></div>
<div class="ph" id="p2"><div id="mailcard"><div class="mtop"><i></i><i></i><i></i><span>Inbox</span></div>
 <div class="msub">18 bad records came in with no source recorded</div>
 <div class="mfrom"><div class="av">S</div><div><b>SubSync</b><span>to me</span></div></div>
 <div class="mbody"><p><span class="dot"></span><b>KD Squares Test:</b> 18 bad records came in with no source recorded in the last 24 hours (usually 0.1 a day)</p>
 <p>Next: open the list, fix or remove them, and check the form or import that sends them.</p>
 <ul><li>What is wrong: 18 duplicates.</li><li>18 of the 24 records that have no source created in the last 24 hours.</li><li>The newest arrived 19 h 16 min ago.</li></ul>
 <p><a id="ml">Open the bad records in your CRM</a></p></div></div></div>
<div class="ph" id="p3"><div id="crm"><div class="ch"><span>Contacts <small>Smart list: bad records (18)</small></span><span style="font-size:24px;color:#7b8794;font-weight:500">KD Squares Test</span></div>
 <div class="row h"><span></span><span>Name</span><span>Source</span><span>Created</span><span>Duplicate of</span></div>
 ${[["Ella Brooks", "19 h ago", "Ella Brooks"], ["Noah Santos", "18 h ago", "Noah Santos"], ["Mia Lane", "15 h ago", "Mia Lane"], ["Caleb Ortiz", "12 h ago", "Caleb Ortiz"], ["Ava Morgan", "9 h ago", "Ava Morgan"], ["Jack Patel", "6 h ago", "Jack Patel"], ["Henry Foster", "3 h ago", "Henry Foster"]].map(([n, c, d], i) => `<div class="row${i === 0 ? " hi" : ""}"><span class="cb"></span><span><b>${n}</b></span><span class="miss">(none)</span><span>${c}</span><span>${d}</span></div>`).join("")}</div></div>`;
}
export async function alertsRun(page, T, sleep, moveTo, tf) {
  const show = (id) => page.evaluate((i) => document.getElementById(i).classList.add("show"), id);
  const hide = (id) => page.evaluate((i) => document.getElementById(i).classList.remove("show"), id);
  const ttl = (t) => page.evaluate((x) => { document.getElementById("ttl").textContent = x; }, t);
  const k = 2.5;
  await T.at(tf(0.0)); await show("p1");
  await T.at(tf(0.04)); await page.evaluate(([w]) => { document.getElementById("h1").style.width = w + "px"; }, [Math.round(560 * k)]);
  await T.at(tf(0.09)); await page.evaluate(([w]) => { document.getElementById("u1").style.width = w + "px"; }, [Math.round(160 * k)]);
  await moveTo(page, 180 + 30 + 120 * k, 250 + 30 + 152 * k, 1100);
  await T.at(tf(0.2)); await hide("p1"); await sleep(600); await ttl("The same alert by email"); await show("p2");
  await T.at(tf(0.31)); const b = await page.locator("#ml").boundingBox(); await moveTo(page, b.x + b.width / 2, b.y + b.height / 2, 1100);
  await T.at(tf(0.4)); await page.mouse.down(); await sleep(70); await page.mouse.up();
  await sleep(250); await hide("p2"); await sleep(600); await ttl("It opens the right account in your CRM"); await show("p3");
  await moveTo(page, 700, 520, 1500);
}

// ---- closing card: the real logo alone, then the promise ----------------------------------------------------------------
export const closeHtml = () => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1300px 800px at 35% 40%,#1a3a30 0%,#0e1613 58%,#090c0b 100%);font-family:"Segoe UI",Arial,sans-serif;color:#fff;overflow:hidden;position:relative}
#vd-cursor{display:none!important}@keyframes fadein{from{opacity:0}to{opacity:1}}
.t{position:absolute;left:960px;opacity:0;transform:translateY(14px);transition:opacity .9s ease,transform 1s ease}.t.show{opacity:1;transform:none}
.sm{font-size:50px;font-weight:600;color:#cfe3da}.big{font-size:92px;font-weight:800;letter-spacing:-.02em;line-height:1.05}.sub{font-size:34px;color:#8fb7a6}
</style>${logoCss(0.2, 580, 290, 150).replace("opacity:0;", "opacity:0;")}
<img class="lg" src="data:image/png;base64,${logoData()}"><div class="wm" style="left:220px;top:760px;width:560px;text-align:center;animation-delay:.9s">SubSync</div>
<div class="t sm" id="c1" style="top:290px">Your brand, not ours.</div>
<div class="t sm" id="c2" style="top:380px">Preview, confirm, undo.</div>
<div class="t big" id="c3" style="top:500px">Install once.<br>Free for 14 days.</div>
<div class="t sub" id="c4" style="top:760px">Know what is happening in every client account.</div>`;
export async function closeRun(page, T, tf) {
  const on = (id) => page.evaluate((i) => document.getElementById(i).classList.add("show"), id);
  await T.at(tf(0.02)); await on("c1");
  await T.at(tf(0.3)); await on("c2");
  await T.at(tf(0.62)); await on("c3");
  await T.at(tf(0.9)); await on("c4");
}
