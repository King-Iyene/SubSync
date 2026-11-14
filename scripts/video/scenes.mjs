// Animated pain-point scenes drawn in code (flat vector people and objects, SVG plus CSS animations).
// Each scene is a small function: scene(t0) -> { body, tick }, where t0 is the time (seconds into the clip) when the voice line starts.
// Everything is deterministic: record-anim.mjs sets every animation to an exact time and takes one screenshot per frame.
import fs from "node:fs";

export const COLORS = { bg: "#101614", panel: "#18221f", panel2: "#223029", sage: "#8fb7a6", sageDark: "#3d6b58", amber: "#e0a23a", red: "#d9695f", cream: "#f1ece0", ink: "#1d2321", skin1: "#e8b896", skin2: "#b97a57", skin3: "#8d5a3c" };
const C = COLORS;

export const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0}body{width:1920px;height:1080px;overflow:hidden;background:radial-gradient(1400px 800px at 30% 15%,#1a2a24 0%,#111a17 55%,#0c1210 100%);font-family:"Segoe UI",Arial,sans-serif;color:#fff;position:relative}
svg{position:absolute;left:0;top:0}
.title{position:absolute;left:110px;top:80px;max-width:1500px;font-size:84px;line-height:1.02;font-weight:800;letter-spacing:-.02em}
.title span{display:inline-block;margin-right:.22em;opacity:0;animation:pop .6s cubic-bezier(.2,.9,.3,1.15) forwards;animation-delay:var(--d,0s)}
.title .hot{color:${C.amber}}.title .bad{color:${C.red}}.title .ok{color:${C.sage}}
.pop{opacity:0;transform-box:fill-box;transform-origin:center;animation:pop .55s cubic-bezier(.2,.9,.3,1.2) forwards;animation-delay:var(--d,0s)}
@keyframes pop{0%{opacity:0;transform:translateY(24px) scale(.8)}100%{opacity:1;transform:none}}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.fade{opacity:0;animation:fadein .6s ease forwards;animation-delay:var(--d,0s)}
.blink{transform-box:fill-box;transform-origin:center;animation:blink 3.4s infinite;animation-delay:var(--b,0s)}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
.bob{animation:bob 2.2s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.limb{transform-box:fill-box;transform-origin:50% 6%}
.walk .legL{animation:swingA .62s ease-in-out infinite}.walk .legR{animation:swingB .62s ease-in-out infinite}
.walk .armL{animation:swingB .62s ease-in-out infinite}.walk .armR{animation:swingA .62s ease-in-out infinite}
@keyframes swingA{0%,100%{transform:rotate(-26deg)}50%{transform:rotate(26deg)}}
@keyframes swingB{0%,100%{transform:rotate(26deg)}50%{transform:rotate(-26deg)}}
.shake{transform-box:fill-box;transform-origin:center;animation:shake .32s linear infinite}
@keyframes shake{0%,100%{transform:rotate(-5deg) translateX(-3px)}50%{transform:rotate(5deg) translateX(3px)}}
.ring{transform-box:fill-box;transform-origin:center;opacity:0;animation:ring 1.1s ease-out infinite;animation-delay:var(--d,0s)}
@keyframes ring{0%{opacity:.8;transform:scale(.5)}100%{opacity:0;transform:scale(2.2)}}
.mv{animation:mv var(--dur,2s) cubic-bezier(.45,0,.4,1) forwards;animation-delay:var(--d,0s)}
@keyframes mv{from{transform:translateX(0)}to{transform:translateX(var(--dx,0px))}}
.spin{transform-box:fill-box;transform-origin:50% 100%;animation:spin var(--dur,8s) linear forwards}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(var(--deg,720deg))}}
.fall{animation:fall 2.2s cubic-bezier(.5,0,.8,.6) forwards;animation-delay:var(--d,0s)}
@keyframes fall{0%{transform:none;filter:none;opacity:1}30%{transform:rotate(-2deg);filter:grayscale(1) brightness(.8);opacity:1}100%{transform:translateY(520px) rotate(16deg);filter:grayscale(1) brightness(.6);opacity:0}}
.bubble{position:absolute;padding:18px 28px;border-radius:26px;background:${C.cream};color:${C.ink};font-size:40px;font-weight:700;box-shadow:0 12px 30px rgba(0,0,0,.4);opacity:0;animation:pop .5s cubic-bezier(.2,.9,.3,1.2) forwards;animation-delay:var(--d,0s)}
.bubble.red{background:#f6d6d1}.bubble.amber{background:#f6e3b8}
.counter{position:absolute;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
#cap{position:fixed;left:50%;bottom:54px;transform:translateX(-50%);max-width:1500px;padding:16px 34px;border-radius:16px;background:rgba(6,8,10,.88);color:#fff;font:600 46px/1.25 "Segoe UI",Arial,sans-serif;text-align:center;opacity:0;box-shadow:0 8px 30px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);z-index:9}
`;

// ---- reusable drawing helpers --------------------------------------------------------------------------------------
// A flat figure with its feet at (0,0), about 330 px tall. opts: x, y, s (scale), skin, shirt, hair, cls (extra classes), mood ("happy","flat","worried","angry","surprised","tired"), flip.
export function person({ x = 0, y = 0, s = 1, skin = C.skin1, shirt = C.sage, hair = "#2a2220", cls = "", mood = "happy", flip = false, arms = "down", legs = true, b = 0 } = {}) {
  const mouth = { happy: '<path d="M-14 -280 Q0 -266 14 -280" fill="none" stroke="#3a2a22" stroke-width="5" stroke-linecap="round"/>', flat: '<path d="M-12 -276 H12" stroke="#3a2a22" stroke-width="5" stroke-linecap="round"/>', worried: '<path d="M-14 -272 Q0 -284 14 -272" fill="none" stroke="#3a2a22" stroke-width="5" stroke-linecap="round"/>', angry: '<path d="M-15 -271 Q0 -284 15 -271" fill="none" stroke="#3a2a22" stroke-width="5" stroke-linecap="round"/>', surprised: '<ellipse cx="0" cy="-274" rx="9" ry="12" fill="#3a2a22"/>', tired: '<path d="M-12 -274 Q0 -278 12 -274" fill="none" stroke="#3a2a22" stroke-width="5" stroke-linecap="round"/>' }[mood];
  const brows = mood === "angry" ? '<path d="M-28 -330 L-8 -320 M28 -330 L8 -320" stroke="#2a2220" stroke-width="7" stroke-linecap="round"/>' : mood === "worried" || mood === "surprised" ? '<path d="M-28 -322 L-10 -330 M28 -322 L10 -330" stroke="#2a2220" stroke-width="6" stroke-linecap="round"/>' : mood === "tired" ? '<path d="M-28 -322 L-8 -318 M28 -322 L8 -318" stroke="#2a2220" stroke-width="6" stroke-linecap="round"/>' : "";
  const eyeRy = mood === "tired" ? 3.5 : 6;
  const armRot = { down: [0, 0], up: [150, -150], shrug: [128, -128], wave: [0, 160], hold: [0, 148], watch: [0, 118] }[arms];
  const arm = (side, rot, sx) => `<g transform="translate(${sx} -238)"><rect class="limb arm${side}" x="-10" y="0" width="20" height="104" rx="10" fill="${shirt}" style="transform:rotate(${rot}deg)"/></g>`;
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})" class="${cls}">
  ${legs ? `<rect class="limb legL" x="-30" y="-126" width="26" height="126" rx="12" fill="#2b3a36"/><rect class="limb legR" x="4" y="-126" width="26" height="126" rx="12" fill="#2b3a36"/>
  <rect x="-34" y="-12" width="32" height="14" rx="7" fill="#1b2421"/><rect x="2" y="-12" width="32" height="14" rx="7" fill="#1b2421"/>` : ""}
  <g class="bob">${arm("L", armRot[0], -40)}${arm("R", armRot[1], 40)}
  <rect x="-42" y="-256" width="84" height="148" rx="30" fill="${shirt}"/>
  <circle cx="0" cy="-306" r="46" fill="${skin}"/><path d="M-46 -312 Q-40 -362 0 -358 Q42 -362 46 -312 Q22 -334 -6 -330 Q-30 -330 -46 -312Z" fill="${hair}"/>
  <g class="blink" style="--b:${b}s"><ellipse cx="-16" cy="-306" rx="5.5" ry="${eyeRy}" fill="#222"/><ellipse cx="16" cy="-306" rx="5.5" ry="${eyeRy}" fill="#222"/></g>${brows}${mouth}</g></g>`;
}
export const desk = (x, y, w, h = 190) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#26372f"/><rect x="${x - 16}" y="${y - 22}" width="${w + 32}" height="26" rx="10" fill="#3a5246"/></g>`;
export const laptop = (x, y) => `<g><rect x="${x}" y="${y - 118}" width="190" height="118" rx="10" fill="#0e1513" stroke="#4b6a5c" stroke-width="6"/><rect x="${x + 16}" y="${y - 102}" width="158" height="12" rx="4" fill="${C.sage}" opacity=".7"/><rect x="${x + 16}" y="${y - 78}" width="110" height="10" rx="4" fill="#4b6a5c"/><rect x="${x + 16}" y="${y - 56}" width="130" height="10" rx="4" fill="#4b6a5c"/><rect x="${x - 14}" y="${y}" width="218" height="12" rx="6" fill="#5b7d6e"/></g>`;
export const phone = (x, y, cls = "", fill = "#e9f0ec") => `<g transform="translate(${x} ${y})"><g class="${cls}"><rect x="-34" y="-62" width="68" height="124" rx="14" fill="#111917" stroke="${fill}" stroke-width="6"/><rect x="-24" y="-48" width="48" height="76" rx="6" fill="${C.sageDark}"/><circle cx="0" cy="44" r="6" fill="${fill}"/></g></g>`;
export const clock = (x, y, r, dur, deg) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${C.cream}" stroke="#3a5246" stroke-width="12"/>${[...Array(12)].map((_, i) => `<rect x="-3" y="${-r + 12}" width="6" height="${i % 3 ? 10 : 18}" rx="3" fill="#47554f" transform="rotate(${i * 30})"/>`).join("")}<rect class="spin" style="--dur:${dur}s;--deg:${deg / 12}deg" x="-5" y="${-r * 0.5}" width="10" height="${r * 0.5}" rx="5" fill="${C.ink}" transform="translate(0 0)"/><rect class="spin" style="--dur:${dur}s;--deg:${deg}deg" x="-4" y="${-r * 0.78}" width="8" height="${r * 0.78}" rx="4" fill="${C.red}"/><circle r="9" fill="${C.ink}"/></g>`;
export const words = (arr, t0, gap = 0.28) => `<div class="title">${arr.map(([w, k], i) => `<span class="${k || ""}" style="--d:${(t0 + i * gap).toFixed(2)}s">${w}</span>`).join("")}</div>`;
const svg = (inner) => `<svg width="1920" height="1080" viewBox="0 0 1920 1080">${inner}<rect x="0" y="826" width="1920" height="254" fill="#0c1210"/><rect x="0" y="822" width="1920" height="6" fill="#26372f"/></svg>`;
const lerp = (a, b, p) => a + (b - a) * Math.max(0, Math.min(1, p));
const tickNum = (id, from, to, ta, tb, fmt = (n) => String(Math.round(n))) => `{const e=document.getElementById("${id}");if(e){const p=Math.max(0,Math.min(1,(t-${ta})/(${tb}-${ta})));e.textContent=(${fmt.toString()})(${from}+(${to}-${from})*(1-Math.pow(1-p,2)));}}`;

// ---- the scenes ----------------------------------------------------------------------------------------------------
export const scenes = {
  p_owner: (t0) => ({
    body: words([["Everyone", ""], ["wants", ""], ["an", ""], ["answer.", "hot"]], t0 + 0.2) + svg(`
      <g class="pop" style="--d:${t0}s">${desk(560, 650, 640)}</g>
      ${person({ x: 800, y: 780, s: 1.05, mood: "worried", legs: false, shirt: C.sage })}
      <g class="fade" style="--d:${t0}s">${desk(560, 650, 640)}${laptop(660, 650)}</g>
      <g transform="translate(0 0)">${phone(1090, 592, "shake")}</g>
      <circle class="ring" style="--d:0s" cx="1090" cy="592" r="70" fill="none" stroke="${C.amber}" stroke-width="6"/><circle class="ring" style="--d:.5s" cx="1090" cy="592" r="70" fill="none" stroke="${C.amber}" stroke-width="6"/>
      <g class="pop" style="--d:${t0 + 0.6}s"><circle cx="1130" cy="538" r="30" fill="${C.red}"/><text id="n" x="1130" y="550" text-anchor="middle" font-size="32" font-weight="800" fill="#fff">0</text></g>`) +
      `<div class="bubble amber" style="left:1250px;top:300px;--d:${t0 + 1.4}s">Any news?</div><div class="bubble red" style="left:1400px;top:420px;--d:${t0 + 2.9}s">Call me!</div><div class="bubble" style="left:1230px;top:540px;--d:${t0 + 4.4}s">Where is my report?</div>`,
    tick: tickNum("n", 0, 47, t0 + 0.6, t0 + 6.5),
  }),
  p_leads: (t0) => ({
    body: words([["A", ""], ["new", ""], ["lead.", "ok"], ["No", ""], ["reply.", "bad"]], t0 + 0.2, 0.3) + svg(`
      <g class="fade" style="--d:${t0 + 4.8}s"><rect x="110" y="470" width="190" height="352" rx="14" fill="#1d2a25" stroke="#3a5246" stroke-width="5" stroke-dasharray="14 10"/><rect x="170" y="700" width="70" height="122" rx="8" fill="#0c1210"/><text x="205" y="450" text-anchor="middle" font-size="34" font-weight="700" fill="${C.sage}">Someone else</text></g>
      <g class="mv" style="--d:${t0 + 5.2}s;--dur:1.7s;--dx:-250px"><g class="walk">${person({ x: 520, y: 822, s: 1.05, skin: C.skin2, shirt: C.amber, mood: "worried", arms: "hold", cls: "" })}</g></g>
      ${clock(1180, 470, 150, 7, 1800)}
      <g class="pop" style="--d:${t0 + 0.5}s">${phone(700, 560, "", "#e9f0ec")}</g>`) +
      `<div class="bubble" style="left:640px;top:300px;--d:${t0 + 0.9}s">Hi, can I book a visit?</div><div class="bubble amber" style="left:560px;top:215px;--d:${t0 + 3.0}s;font-size:56px">?</div>` +
      `<div class="counter" id="d" style="left:960px;top:660px;font-size:84px;color:${C.red}">0 days</div><div class="counter fade" style="left:960px;top:760px;font-size:44px;color:${C.sage};--d:${t0 + 1}s">no reply</div>`,
    tick: tickNum("d", 0, 3, t0 + 0.6, t0 + 5.6, (n) => { const d = Math.round(n); return d + (d === 1 ? " day" : " days"); }),
  }),
  p_appts: (t0) => {
    const cells = [];
    const marked = new Set([1, 6, 11]);
    let k = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
      const x = 270 + c * 150, y = 370 + r * 130, i = r * 5 + c;
      const has = [1, 3, 5, 6, 8, 11, 13].includes(i);
      cells.push(`<rect x="${x}" y="${y}" width="138" height="118" rx="10" fill="#1d2a25"/>`);
      if (has) {
        const ok = marked.has(i);
        cells.push(`<g class="pop" style="--d:${t0 + 0.6 + k * 0.22}s"><rect x="${x + 12}" y="${y + 28}" width="114" height="62" rx="12" fill="${ok ? C.sageDark : C.amber}"/><text x="${x + 69}" y="${y + 70}" text-anchor="middle" font-size="40" font-weight="800" fill="${ok ? "#fff" : C.ink}">${ok ? "✓" : "?"}</text></g>`); k++;
      }
    }
    return {
      body: words([["Was", ""], ["it", ""], ["a", ""], ["show?", "ok"], ["Nobody", ""], ["knows.", "hot"]], t0 + 0.2, 0.3) + svg(`
        <rect x="240" y="270" width="800" height="548" rx="22" fill="#18221f" stroke="#2f443b" stroke-width="5"/><rect x="240" y="270" width="800" height="62" rx="22" fill="#26372f"/><text x="280" y="313" font-size="34" font-weight="700" fill="${C.sage}">This week</text>
        ${cells.join("")}
        ${person({ x: 1420, y: 822, s: 1.05, skin: C.skin3, shirt: C.sageDark, mood: "worried", arms: "shrug", b: 1 })}
        <g class="pop" style="--d:${t0 + 3.4}s"><text x="1340" y="400" font-size="90" font-weight="800" fill="${C.amber}">?</text></g><g class="pop" style="--d:${t0 + 3.8}s"><text x="1510" y="380" font-size="70" font-weight="800" fill="${C.amber}">?</text></g>`) +
        `<div class="counter" id="u" style="left:1180px;top:880px;font-size:0px"></div><div class="counter" id="cnt" style="left:1180px;top:215px;font-size:58px;color:${C.amber}">0 with no outcome</div>`,
      tick: tickNum("cnt", 0, 4, t0 + 0.8, t0 + 2.6, (n) => Math.round(n) + " with no outcome"),
    };
  },
  p_noshow: (t0) => ({
    body: words([["The", ""], ["no-show.", "bad"], ["No", ""], ["call", ""], ["back.", "hot"]], t0 + 0.2, 0.3) + svg(`
      <g transform="translate(1330 0)"><rect x="-70" y="560" width="140" height="22" rx="8" fill="#3a5246"/><rect x="-60" y="582" width="14" height="240" fill="#3a5246"/><rect x="46" y="582" width="14" height="240" fill="#3a5246"/><rect x="-66" y="400" width="14" height="170" fill="#3a5246"/></g>
      <g class="fade" style="--d:${t0 + 1.2}s"><ellipse cx="1330" cy="470" rx="60" ry="100" fill="none" stroke="#3a5246" stroke-width="5" stroke-dasharray="12 10"/><text x="1330" y="500" text-anchor="middle" font-size="90" font-weight="800" fill="#4b6a5c">?</text></g>
      ${person({ x: 650, y: 822, s: 1.05, shirt: C.sage, mood: "worried", arms: "watch", legs: false })}
      <g>${desk(500, 700, 560, 130)}</g>
      ${clock(900, 410, 100, 7, 1440)}
      <g class="pop" style="--d:${t0 + 2.4}s">${phone(880, 640, "", "#e9f0ec")}</g>
      <g class="pop" style="--d:${t0 + 3.2}s"><g transform="translate(1330 600) rotate(-9)"><rect x="-190" y="-58" width="380" height="116" rx="14" fill="none" stroke="${C.red}" stroke-width="10"/><text x="0" y="22" text-anchor="middle" font-size="76" font-weight="900" fill="${C.red}">NO-SHOW</text></g></g>
      <g class="pop" style="--d:${t0 + 4.6}s"><circle cx="880" cy="640" r="52" fill="none" stroke="${C.red}" stroke-width="8"/><path d="M845 675 L915 605" stroke="${C.red}" stroke-width="8"/></g>`) +
      `<div class="counter" id="z" style="left:1180px;top:215px;font-size:64px;color:${C.red}">0 calls back</div>`,
    tick: `{const e=document.getElementById("z");if(e)e.textContent="0 calls back"}`,
  }),
  p_deals: (t0) => {
    const names = [["Roof repair quote", "$12,400"], ["Kitchen remodel", "$8,500"], ["Teeth whitening plan", "$3,200"], ["Annual contract", "$21,000"]];
    return {
      body: words([["Good", "ok"], ["deals", "ok"], ["go", ""], ["quiet.", "bad"]], t0 + 0.2, 0.32) + svg(`
        ${names.map(([n, v], i) => `<g class="pop" style="--d:${t0 + 0.4 + i * 0.25}s"><g class="fall" style="--d:${t0 + 2.2 + i * 0.9}s"><rect x="${150 + i * 410}" y="330" width="350" height="210" rx="20" fill="#223029" stroke="${C.sage}" stroke-width="5"/><text x="${180 + i * 410}" y="392" font-size="29" font-weight="700" fill="${C.cream}">${n}</text><text x="${180 + i * 410}" y="470" font-size="60" font-weight="800" fill="${C.sage}">${v}</text><rect x="${180 + i * 410}" y="494" width="180" height="22" rx="11" fill="#3d6b58"/></g></g>`).join("")}
        <rect x="120" y="760" width="1680" height="60" rx="12" fill="#070b0a"/><text x="960" y="803" text-anchor="middle" font-size="30" fill="#4b6a5c" font-weight="700">Out of the pipeline</text>`) +
        `<div class="counter" id="q" style="left:1180px;top:215px;font-size:60px;color:${C.red}">0 quiet deals</div>`,
      tick: tickNum("q", 0, 87, t0 + 2.2, t0 + 6.4, (n) => Math.round(n) + " quiet deals"),
    };
  },
  p_dupes: (t0) => {
    const spots = [[160, 300], [520, 380], [880, 300], [1240, 360], [1560, 300], [260, 480], [640, 560], [1010, 470], [1380, 540], [1620, 470], [150, 650], [470, 700], [820, 660], [1180, 700], [1500, 660], [330, 380], [700, 460], [1080, 580], [1440, 430], [600, 300], [980, 390], [1300, 620], [230, 560], [900, 730]];
    const card = (x, y, i, rot) => `<g class="pop" style="--d:${t0 + 0.4 + i * 0.2}s"><g transform="translate(${x} ${y}) rotate(${rot})"><rect width="270" height="108" rx="16" fill="#223029" stroke="${C.sage}" stroke-width="4"/><circle cx="48" cy="54" r="26" fill="${C.skin1}"/><rect x="92" y="30" width="150" height="16" rx="8" fill="${C.cream}"/><rect x="92" y="60" width="110" height="12" rx="6" fill="#4b6a5c"/></g></g>`;
    return {
      body: words([["Same", ""], ["contact.", "ok"], ["Again.", "hot"], ["And", ""], ["again.", "bad"]], t0 + 0.2, 0.3) + svg(spots.map(([x, y], i) => card(x, y, i, ((i * 7) % 11) - 5)).join("")) +
        `<div class="counter" id="g" style="left:1180px;top:215px;font-size:60px;color:${C.amber}">0 duplicate groups</div>`,
      tick: tickNum("g", 0, 163, t0 + 0.6, t0 + 5.6, (n) => Math.round(n) + " duplicate groups"),
    };
  },
  // Illustration: a lead waits, the timer grows past the target, and SubSync raises the alert (the screens come next).
  p_wait: (t0) => {
    const a = t0 + 1.9, b = t0 + 6.4;
    return {
      body: words([["A", ""], ["lead", "ok"], ["is", ""], ["waiting.", "bad"]], t0 + 0.3, 0.3) + svg(`
        <g class="pop" style="--d:${t0 + 0.9}s"><rect x="130" y="330" width="520" height="270" rx="26" fill="#223029" stroke="${C.sage}" stroke-width="5"/><circle cx="215" cy="420" r="46" fill="${C.skin2}"/><rect x="290" y="392" width="260" height="22" rx="11" fill="${C.cream}"/><rect x="290" y="432" width="190" height="16" rx="8" fill="#4b6a5c"/><rect x="170" y="500" width="150" height="46" rx="23" fill="${C.sageDark}"/><text x="245" y="532" text-anchor="middle" font-size="26" font-weight="700" fill="#fff">New lead</text></g>
        <g class="fade" style="--d:${t0 + 1.6}s"><rect x="760" y="340" width="900" height="30" rx="15" fill="#1d2a25"/><rect id="bar" x="760" y="340" width="0" height="30" rx="15" fill="${C.sage}"/><rect x="${760 + 900 * 15 / 180}" y="322" width="6" height="66" rx="3" fill="#fff"/><text x="${760 + 900 * 15 / 180 + 14}" y="316" font-size="30" font-weight="700" fill="#cfe3da">Target: 15 min</text></g>
        <g class="pop" style="--d:${t0 + 5.0}s"><g transform="translate(1030 745) rotate(-6)"><rect x="-210" y="-52" width="420" height="104" rx="14" fill="none" stroke="${C.red}" stroke-width="9"/><text x="0" y="22" text-anchor="middle" font-size="66" font-weight="900" fill="${C.red}">PAST TARGET</text></g></g>
        <g class="pop" style="--d:${t0 + 6.6}s"><circle cx="1750" cy="220" r="64" fill="#223029" stroke="${C.sage}" stroke-width="5"/><path d="M1750 188 q-30 0 -30 34 v22 l-12 14 h84 l-12 -14 v-22 q0 -34 -30 -34z" fill="${C.cream}"/><circle cx="1750" cy="282" r="9" fill="${C.cream}"/><circle cx="1790" cy="178" r="22" fill="${C.red}"/><text x="1790" y="187" text-anchor="middle" font-size="26" font-weight="800" fill="#fff">1</text></g>
        <circle class="ring" style="--d:${t0 + 6.7}s" cx="1750" cy="220" r="64" fill="none" stroke="${C.amber}" stroke-width="6"/><circle class="ring" style="--d:${t0 + 7.2}s" cx="1750" cy="220" r="64" fill="none" stroke="${C.amber}" stroke-width="6"/>`) +
        `<div class="counter fade" id="wt" style="left:760px;top:420px;font-size:170px;color:${C.sage};--d:${t0 + 1.8}s">0 min</div><div class="bubble amber" style="left:1290px;top:300px;--d:${t0 + 8.6}s;font-size:36px;display:none">x</div>` +
        `<div class="bubble" style="left:1290px;top:310px;--d:${t0 + 6.9}s;font-size:40px">SubSync spotted it</div>`,
      tick: `{const p=Math.max(0,Math.min(1,(t-${a})/(${b}-${a})));const m=Math.round(160*(1-Math.pow(1-p,1.6)));const e=document.getElementById("wt");if(e){e.textContent=m<60?m+" min":Math.floor(m/60)+"h "+String(m%60).padStart(2,"0")+"m";e.style.color=m<15?"${C.sage}":m<45?"${C.amber}":"${C.red}";}const bar=document.getElementById("bar");if(bar){bar.setAttribute("width",String(Math.min(900,900*m/180)));bar.setAttribute("fill",m<15?"${C.sage}":m<45?"${C.amber}":"${C.red}");}}`,
    };
  },
  p_client: (t0) => ({
    body: words([["Your", ""], ["customer", "ok"], ["finds", ""], ["out", ""], ["first.", "bad"]], t0 + 0.2, 0.3) + svg(`
      ${desk(300, 690, 520, 130)}${laptop(380, 690)}
      ${person({ x: 520, y: 790, s: 1.05, mood: "surprised", legs: false, shirt: C.sage, arms: "up", b: 1 })}
      <g>${desk(300, 690, 520, 130)}${laptop(400, 690)}</g>
      <g class="pop" style="--d:${t0 + 3.6}s"><text x="640" y="380" font-size="130" font-weight="900" fill="${C.amber}">!</text></g>
      <g class="mv" style="--d:${t0 + 0.4}s;--dur:2.4s;--dx:-640px"><g class="walk">${person({ x: 1750, y: 822, s: 1.08, skin: C.skin3, shirt: C.red, mood: "angry", flip: true, arms: "down" })}</g></g>`) +
      `<div class="bubble red" style="left:1140px;top:300px;--d:${t0 + 3.2}s;font-size:46px">Why did nobody call me?</div>`,
    tick: "",
  }),
  p_reports: (t0) => {
    const stacks = [0, 1, 2, 3, 4].map((i) => `<g class="pop" style="--d:${t0 + 0.6 + i * 0.7}s"><g transform="translate(${1010 + i * 130} 822)">${[...Array(2 + i)].map((_, j) => `<rect x="0" y="${-24 - j * 24}" width="110" height="20" rx="4" fill="${j % 2 ? C.cream : "#d6d0c2"}" transform="rotate(${((j * 5 + i * 3) % 7) - 3})"/>`).join("")}</g></g>`).join("");
    return {
      body: words([["Reports,", ""], ["built", ""], ["by", ""], ["hand.", "hot"]], t0 + 0.2, 0.3) + svg(`
        ${desk(420, 690, 520, 130)}${person({ x: 650, y: 790, s: 1.05, mood: "tired", legs: false, shirt: C.sage, b: 2 })}${desk(420, 690, 520, 130)}${laptop(520, 690)}
        <g class="pop" style="--d:${t0 + 2}s"><path d="M720 460 q10 26 0 36 q-10 -10 0 -36z" fill="#7fc3e8"/></g>
        ${stacks}
        <g class="pop" style="--d:${t0 + 0.5}s"><rect x="1400" y="340" width="300" height="250" rx="16" fill="${C.cream}"/><rect x="1400" y="340" width="300" height="64" rx="16" fill="${C.red}"/><text x="1550" y="386" text-anchor="middle" font-size="36" font-weight="800" fill="#fff">Month end</text><text x="1550" y="510" text-anchor="middle" font-size="110" font-weight="900" fill="${C.ink}">30</text></g>`) +
        `<div class="counter" id="r" style="left:1180px;top:215px;font-size:60px;color:${C.amber}">0 reports to build</div>`,
      tick: tickNum("r", 0, 13, t0 + 0.6, t0 + 5.2, (n) => Math.round(n) + " reports to build"),
    };
  },
};

