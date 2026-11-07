import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(() => { try { localStorage.setItem("subsync-theme", "dark"); localStorage.setItem("subsync.speed.tour6", "1"); localStorage.setItem("subsync.speed.tour6.seen", "1"); } catch {} });
await p.goto("http://localhost:3351/app#speed"); await p.reload(); await p.waitForTimeout(7000);
const r = await p.evaluate(() => [...document.querySelectorAll('[aria-pressed="true"],[aria-selected="true"]')].slice(0, 8).map((e) => { const s = getComputedStyle(e); return [e.textContent.trim().slice(0, 18), s.color, s.backgroundColor]; }));
console.log(JSON.stringify(r));
console.log(await p.evaluate(() => [document.documentElement.className, document.documentElement.dataset.theme, getComputedStyle(document.documentElement).getPropertyValue("--primary-foreground")]));
await b.close();
