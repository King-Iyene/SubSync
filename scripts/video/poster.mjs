// Builds the poster / cover frame: one big headline, the Today screen with its money numbers, the logo small in a corner.
// Usage: node scripts/video/poster.mjs <stills dir> <out dir> [work dir]   -> subsync-preview-poster.png (1600x900), -1280.png (1280x720), and <work>/poster-1920.png
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { logoData } from "./logo.mjs";

const [stills, out, work = out] = process.argv.slice(2);
// Crop the money tiles and the first accounts out of the Today screenshot (1600x900 space).
const crop = await sharp(path.join(stills, "01-today.png")).extract({ left: 264, top: 170, width: 1300, height: 560 }).png().toBuffer();
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(1400px 800px at 30% 15%,#1b2e27 0%,#111a17 55%,#0b100e 100%);font-family:"Segoe UI",Arial,sans-serif;color:#fff;position:relative}
h1{position:absolute;left:110px;top:92px;width:1400px;margin:0;font-size:92px;line-height:1.06;font-weight:800;letter-spacing:-.02em}
h1 em{font-style:normal;color:#e0a23a}
.logo{position:absolute;right:96px;top:78px;height:150px;filter:drop-shadow(0 8px 18px rgba(0,0,0,.5))}
.shot{position:absolute;left:110px;top:440px;width:1700px;height:586px;border-radius:26px;overflow:hidden;border:2px solid #34493f;box-shadow:0 40px 90px rgba(0,0,0,.6)}
.shot img{display:block;width:1700px;height:auto;margin-top:-6px}
.fade{position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(transparent,#0b100e)}
</style>
<h1>Know what is happening in every account you manage <em>before a customer tells you.</em></h1>
<img class="logo" src="data:image/png;base64,${logoData()}">
<div class="shot"><img src="data:image/png;base64,${crop.toString("base64")}"><div class="fade"></div></div>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(400);
const buf = await page.screenshot({ type: "png" });
await browser.close();
fs.writeFileSync(path.join(work, "poster-1920.png"), buf);
await sharp(buf).resize(1600, 900, { kernel: "lanczos3" }).png().toFile(path.join(out, "subsync-preview-poster.png"));
await sharp(buf).resize(1280, 720, { kernel: "lanczos3" }).png().toFile(path.join(out, "subsync-preview-poster-1280.png"));
console.log("poster ok");
