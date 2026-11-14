// The real SubSync logo, alone on the dark background (transparent PNG), with a gentle fade and scale in and the wordmark in light type.
import fs from "node:fs";

export const logoData = () => fs.readFileSync(new URL("../../assets/brand/subsync-logo-main-transparent.png", import.meta.url)).toString("base64");
export const logoCss = (t0, h = 520, left = 300, top = 190) => `<style>
.lg{position:absolute;left:${left}px;top:${top}px;height:${h}px;opacity:0;filter:drop-shadow(0 18px 34px rgba(0,0,0,.55));animation:lgin 1.4s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:${t0}s}
@keyframes lgin{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:none}}
.wm{position:absolute;font-size:84px;font-weight:300;letter-spacing:.06em;color:#e9f1ed;opacity:0;animation:fadein 1s ease forwards}</style>`;

// The turn to SubSync: the logo and the one-breath explanation.
export function whatScene(t0, w2, w3) {
  const chips = [["Connects every business you manage", w2], ["Watches leads and appointments", w2 + 1.8], ["Finds what is going wrong", w2 + 3.6], ["Puts a dollar figure on it", w2 + 5.4], ["Shows what to do first", w3]];
  return {
    body: logoCss(t0 + 0.1, 560, 300, 150) + `<style>.chip{position:absolute;left:960px;padding:20px 34px;border-radius:20px;background:#1b2b25;border:2px solid #3d6b58;color:#eaf4ef;font-size:48px;font-weight:700;opacity:0;animation:pop .5s cubic-bezier(.2,.9,.3,1.2) forwards}</style>
    <img class="lg" src="data:image/png;base64,${logoData()}"><div class="wm" style="left:230px;top:740px;width:560px;text-align:center;animation-delay:${t0 + 0.8}s">SubSync</div>` + chips.map(([c, d], i) => `<div class="chip" style="top:${230 + i * 112}px;animation-delay:${d.toFixed(2)}s">${c}</div>`).join(""),
    tick: "",
  };
}
