// Shared helpers for the preview video: browser setup, on-screen cursor, captions, zoom, label clean-up, frame capture.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.BASE || "http://localhost:3410";
export const W = 1920, H = 1080;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BANNED = /gohighlevel|high\s?level|\bghl\b|leadconnector|\bdemo\b|sample data|\(sample\)|fictional|made-up|taking longer|taking too long|something went wrong|error id/i;

// Injected into every page: hides demo/sample labels, draws the cursor and the caption pill.
const INIT = () => {
  try { localStorage.setItem("subsync-theme", "dark"); localStorage.setItem("subsync.speed.tour6", "1"); sessionStorage.setItem("subsync-shots", "1"); } catch { /* ignore */ }
  const css = document.createElement("style");
  css.textContent = `
    #vd-cursor{position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55))}
    #vd-cursor .ring{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.9);opacity:0;transform:scale(.4)}
    #vd-cursor.click .ring{animation:vdring .45s ease-out}
    @keyframes vdring{0%{opacity:.95;transform:scale(.4)}100%{opacity:0;transform:scale(1.9)}}
    #vd-cap{position:fixed;left:50%;bottom:54px;transform:translateX(-50%) translateY(8px);z-index:2147483646;max-width:1500px;padding:16px 34px;border-radius:16px;background:rgba(6,8,10,.88);color:#fff;font:600 40px/1.25 "Segoe UI",Arial,Helvetica,sans-serif;letter-spacing:.1px;text-align:center;opacity:0;transition:opacity .28s ease,transform .28s ease;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12)}
    #vd-cap.on{opacity:1;transform:translateX(-50%) translateY(0)}
    #vd-cap.hook{font-size:50px;max-width:1500px;padding:22px 44px}
    html{scrollbar-width:none} ::-webkit-scrollbar{display:none}
  `;
  const mount = () => {
    if (document.getElementById("vd-cursor")) return;
    document.documentElement.appendChild(css);
    const c = document.createElement("div"); c.id = "vd-cursor";
    c.innerHTML = '<div class="ring"></div><svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.4 1.3 3.6 6.6-2.9 1.6-3.6-6.6L5 18.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const cap = document.createElement("div"); cap.id = "vd-cap"; document.documentElement.appendChild(cap);
    window.addEventListener("mousemove", (e) => { c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    window.addEventListener("mousedown", () => { c.classList.remove("click"); void c.offsetWidth; c.classList.add("click"); }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  // Remove the demo/sample labels (they are text from the app that must not be on screen).
  const clean = () => {
    for (const el of document.querySelectorAll("p,div,span")) {
      if (el.childElementCount === 0 && /^Sample data\. Nothing here is refreshed/.test(el.textContent || "")) {
        el.style.display = "none";
        const nx = el.nextElementSibling;
        if (nx && /^Each account/.test((nx.textContent || "").trim())) nx.style.display = "none";
      }
      if (el.childElementCount === 0 && /^Demo Admin$/.test((el.textContent || "").trim())) el.textContent = "Agency owner";
    }
    for (const h of document.querySelectorAll("h2,h3")) {
      if (/^Ask your data$/.test((h.textContent || "").trim())) { const b = h.closest("section,div"); if (b && b.parentElement && !b.querySelector("main")) b.style.display = "none"; }
    }
  };
  new MutationObserver(clean).observe(document, { childList: true, subtree: true, characterData: true });
  setInterval(clean, 400);
};

export async function launch() {
  const browser = await chromium.launch({ args: ["--hide-scrollbars", "--disable-lcd-text", "--font-render-hinting=none"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark" });
  await ctx.addInitScript(INIT);
  return { browser, ctx };
}

// Open a screen and wait until real numbers are on it (no "taking longer", no loading text).
export async function openScreen(page, hash, { settle = 2500, tries = 7, warm = 0 } = {}) {
  if (warm) { await page.goto(`${BASE}/app?shots=1#${hash}`, { waitUntil: "domcontentloaded" }); await sleep(warm); }
  for (let i = 0; i < tries; i++) {
    await page.goto(`${BASE}/app?shots=1#${hash}`, { waitUntil: "domcontentloaded" });
    if ((warm || i > 0) && page.url().includes("#")) await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 90000 });
    await page.waitForLoadState("networkidle", { timeout: 40000 }).catch(() => undefined);
    await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 400 }).catch(() => undefined);
    await sleep(settle);
    const t = await page.locator("main").innerText();
    const bad = t.match(/.{0,60}(taking longer|taking too long|something went wrong|Error ID|Loading...).{0,40}/is); if (!bad) return; if (i === tries - 1) console.log("still:", bad[0].split("\n").join(" "));
    for (const b of await page.getByRole("button", { name: /^try again$/i }).all()) await b.click({ timeout: 800 }).catch(() => undefined);
    await sleep(14000);
  }
  throw new Error(`screen ${hash} never finished loading`);
}

export async function scanText(page) {
  const t = await page.locator("body").innerText();
  const m = t.match(BANNED);
  return m ? m[0] : null;
}

// Smooth mouse glide with ease-in-out, ~60 steps per second.
let mx = 960, my = 540;
export async function moveTo(page, x, y, ms = 900) {
  const x0 = mx, y0 = my, steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    await sleep(ms / steps);
  }
  mx = x; my = y;
}
export async function centerOf(loc) {
  await loc.scrollIntoViewIfNeeded({ timeout: 6000 }).catch(() => undefined);
  const b = await loc.boundingBox({ timeout: 6000 }).catch(() => null);
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}
export async function glideClick(page, loc, ms = 900) {
  const c = await centerOf(loc.first());
  if (!c) throw new Error("click target not found");
  await moveTo(page, c.x, c.y, ms);
  await sleep(120);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
}
export async function hoverGlide(page, loc, ms = 900) {
  const c = await centerOf(loc.first());
  if (c) await moveTo(page, c.x, c.y, ms);
}

// Slow zoom into a point of the page (CSS transition on body; the cursor and captions sit outside it).
export async function zoom(page, scale, cx, cy, seconds = 5) {
  await page.evaluate(([s, x, y, sec]) => {
    const b = document.body;
    b.style.transformOrigin = `${x}px ${y}px`;
    b.style.transition = `transform ${sec}s cubic-bezier(.45,0,.35,1)`;
    b.style.transform = `scale(${s})`;
  }, [scale, cx, cy, seconds]);
}
export async function caption(page, text, kind = "") {
  await page.evaluate(([t, k]) => {
    const c = document.getElementById("vd-cap"); if (!c) return;
    if (!t) { c.classList.remove("on"); return; }
    c.className = k ? k : ""; c.textContent = t; void c.offsetWidth; c.classList.add("on");
  }, [text, kind]);
}

// Screencast capture: collects JPEG frames with timestamps; later turned into a 30 fps clip.
export async function startCapture(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    const i = frames.length;
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64"));
    frames.push(f.metadata.timestamp);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 94, everyNthFrame: 1, maxWidth: W, maxHeight: H });
  return { frames, stop: async () => { await cdp.send("Page.stopScreencast").catch(() => undefined); await cdp.detach().catch(() => undefined); } };
}
