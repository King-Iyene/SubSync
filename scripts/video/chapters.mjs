// The product chapters: real SubSync screens (listing screenshots, 1600x900 space) with slow zooms, a cursor, highlight boxes,
// number counters, arrows, typed text and a few labelled drawings. Imported by record-tail.mjs; record.mjs owns the browser and the capture.
// Each step is [when, op, ...args]. `when` is a fraction of the voice line, or a phrase from the spoken text (the step happens as that phrase starts).
// ops: z scale x y sec | r | s picture | g x y ms | c x y ms (glide and click) | h x y w h label | x | n x y from to prefix secs |
//      t x y text ms | il name
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { logoData, logoCss } from "./logo.mjs";

export const STILLS = process.env.STILLS || "C:/Users/KING/OneDrive/Desktop/SubSync/assets/listing/upload-ready";
export const SLACK = process.env.SLACK_SHOT || "C:/Users/KING/OneDrive/Desktop/SubSync/assets/video-in/real-slack-alert.png";
const S = 1.2;
const uri = (n) => "data:image/png;base64," + fs.readFileSync(path.join(STILLS, n)).toString("base64");
const k = (v) => v / 1.2; // native 1920x1080 picture coordinates -> 1600 space

export const CHAPTERS = {
  today: { img: "01-today.png", mv: [
    [0.0, "z", 1.1, 420, 300, 6], [0.02, "g", 420, 290, 1500],
    ["what is at risk", "h", 264, 183, 318, 165, "Money at risk"], ["what is at risk", "n", 276, 212, 0, 751385, "$", 2.6],
    ["across eighty-seven", "h", 264, 340, 330, 90, "87 quiet deals"],
    ["Below it", "z", 1.12, 700, 760, 3.5], ["Below it", "h", 264, 632, 1300, 262, "Accounts to save first"], ["Below it", "g", 1384, 729, 1800],
    ["Open one", "c", 1384, 729, 900], ["Open one", "h", 1334, 715, 220, 46, "Open it, then focus"],
  ] },
  speed: { img: "02-speed-to-lead.png", mv: [
    [0.0, "z", 1.13, 420, 520, 5], [0.03, "g", 400, 480, 1500],
    ["Thirteen new", "h", 264, 455, 330, 85, "13 past the target"],
    ["Each one", "h", 1326, 560, 250, 100, "24 min typical reply, target 15"], ["Each one", "z", 1.18, 1450, 600, 3],
    ["so you know", "s", "p-race2.png"], ["so you know", "z", 1.2, 560, 400, 3], ["so you know", "h", 264, k(380), 150, 75, "Longest waits"],
    ["longest wait on top", "g", k(1806), k(422), 1400], ["longest wait on top", "h", k(317), k(370), k(1560), k(250), "Call from the top down"],
  ] },
  appts: { img: "03-appointments.png", mv: [
    [0.0, "z", 1.14, 560, 720, 5], [0.02, "g", 380, 750, 1300],
    ["Four have no outcome", "h", 284, 715, 305, 72, "4 unmarked"], ["Four have no outcome", "n", 296, 740, 0, 4, "", 1.2],
    ["so your real show rate", "h", 920, 715, 305, 72, "True show rate"], ["so your real show rate", "g", 957, 750, 1000],
    ["Eight no-shows", "h", 602, 715, 305, 72, "8 no-shows to win back"], ["Eight no-shows", "g", 700, 750, 800],
    ["with a list to call", "s", "p-noshow.png"], ["with a list to call", "z", 1.15, 700, 700, 3], ["with a list to call", "h", 264, k(840), k(1560), k(250), "Call these today"],
    ["And the flow tree", "s", "19-flow-tree-new.png"], ["And the flow tree", "z", 1.25, 900, 480, 5],
    ["from who booked it", "h", 738, 170, 110, 640, "Who booked"], ["to who took it", "h", 930, 110, 110, 740, "Who took it"], ["to what happened", "h", 1075, 110, 160, 740, "What happened"],
    ["Expand it", "s", "20-flow-tree-expanded.png"], ["Expand it", "z", 1.3, 800, 480, 6], ["every branch", "g", 1000, 420, 1600],
  ] },
  clients: { img: "04-clients.png", mv: [
    [0.0, "z", 1.12, 700, 330, 5], [0.02, "g", 350, 95, 1300],
    ["all your connected", "h", 272, 77, 165, 36, "All connected accounts"],
    ["Five need you now", "h", 264, 608, 950, 78, "Past due, need you now"], ["Five need you now", "z", 1.12, 800, 640, 3], ["Five need you now", "g", 640, 640, 1200],
  ] },
  money: { img: "05-money.png", mv: [
    [0.0, "z", 1.1, 600, 560, 5], [0.02, "g", 400, 560, 1300],
    ["failed payments", "h", 264, 625, 1300, 110, "Failed payments and late invoices"],
    ["with the money at risk", "h", 264, 790, 1300, 60, "Money at risk (estimate)"], ["with the money at risk", "g", 700, 800, 1200],
    ["so you chase", "h", 264, 505, 600, 56, "Payments that need action"],
  ] },
  find: { img: "06-find-a-lead.png", mv: [
    [0.0, "z", 1.14, 560, 360, 5], [0.02, "g", 420, 358, 1200],
    ["searches every", "h", 266, 338, 600, 40, "Search every connected account"], ["searches every", "t", 280, 345, "Harper", 900],
    ["never had a reply", "h", 264, 462, 430, 66, "62 leads never had a reply"], ["never had a reply", "n", 270, 478, 0, 62, "", 1.4],
    ["leads going cold", "s", "22-find-a-lead-going-cold.png"], ["leads going cold", "h", 275, 450, 620, 210, "Leads going cold"], ["leads going cold", "z", 1.25, 700, 520, 4],
    ["call lists", "h", 264, 300, 640, 26, "Call lists, tags, going cold"], ["call lists", "g", 560, 313, 1200],
  ] },
  audit: { img: "07-account-audit.png", mv: [
    [0.0, "z", 1.14, 640, 400, 5], [0.02, "g", 360, 360, 1300],
    ["It estimates", "h", 264, 322, 830, 108, "Estimate: leaking about $258,064 a month"],
    ["with the working", "h", 262, 494, 170, 24, "How this is worked out"], ["with the working", "g", 330, 506, 1200],
    ["lists what to fix", "z", 1.12, 700, 700, 3], ["lists what to fix", "h", 264, 640, 1300, 240, "What to fix first"],
    ["You can copy", "z", 1.0, 960, 450, 2], ["You can copy", "h", 1085, 205, 480, 40, "Copy, print, or a sample to send"], ["You can copy", "g", 1480, 226, 1500],
  ] },
  clean: { img: "09-cleanup-duplicates.png", mv: [
    [0.0, "z", 1.15, 420, 420, 6], [0.02, "g", 340, 420, 1300],
    ["Clean-up found", "h", 264, 372, 240, 62, "163 duplicate groups"], ["Clean-up found", "n", 272, 380, 0, 163, "", 1.6],
    ["certain, likely", "h", 268, 424, 310, 34, "Certain, Likely, Possible"], ["certain, likely", "g", 330, 441, 1000],
    ["You preview", "il", "dup"],
    ["bigger changes", "il", "safe"],
    ["You stay in control", "il", "none"], ["You stay in control", "h", 1200, 486, 350, 40, "You choose, every time"], ["You stay in control", "g", 1290, 505, 1300],
  ] },
  team: { img: "m-08.png", mv: [
    [0.0, "z", 1.14, 560, 440, 5], [0.02, "g", 400, 360, 1300],
    ["who follows up", "h", 264, 340, 700, 38, "Scorecards, leaderboard, workload"],
    ["three things", "h", 264, 452, 600, 124, "3 things need you today"],
    ["four leads", "h", 264, 559, 760, 24, "4 leads waiting over 2 hours"], ["four leads", "g", 560, 571, 1200],
    ["In settings", "s", "40-settings-team.png"], ["In settings", "z", 1.12, 900, 420, 3],
    ["setter, closer", "h", 498, 330, 800, 92, "Roles: setter, closer, both"], ["setter, closer", "g", 560, 402, 1000],
    ["how fast a reply", "s", "41-settings-targets.png"], ["how fast a reply", "h", 498, 250, 900, 56, "Targets: how fast a lead should hear back"],
  ] },
  funnel: { img: "11-pipeline-funnel.png", mv: [
    [0.0, "z", 1.1, 870, 420, 6], [0.02, "g", 360, 289, 1500],
    ["step by step", "h", 440, 250, 870, 390, "Every deal, step by step"],
    ["biggest leak", "h", 264, 255, 1300, 78, "Biggest leak: New Lead"], ["biggest leak", "g", 424, 291, 1000],
    ["Replay it", "h", 264, 187, 590, 38, "Replay day by day"], ["Replay it", "c", 308, 205, 1300],
    ["Click any step", "h", 1312, 332, 235, 80, "Click a step: its deals open"], ["Click any step", "c", 1324, 343, 1300],
    ["And deals with no value", "s", "12-pipeline-river.png"], ["And deals with no value", "h", 264, 366, 1000, 24, "Deals with no value still show"], ["And deals with no value", "z", 1.5, 700, 380, 4],
  ] },
  meet: { img: "m-28.png", mv: [
    [0.0, "z", 1.1, 700, 600, 6], [0.02, "g", 700, 560, 1300],
    ["Meeting notes brings in", "h", 264, 440, 1000, 38, "Your own recorded calls, in one place"],
    ["matches each one", "h", 270, 604, 1290, 68, "Matched to the contact by email, when certain"], ["matches each one", "g", 1480, 640, 1200],
    ["If it is not certain", "h", 270, 676, 1290, 62, "Not certain: it waits for you"],
    ["private inbox", "h", 536, 440, 130, 38, "Your private inbox"], ["private inbox", "g", 600, 458, 1200],
    ["Each person connects", "x"],
  ] },
  workflows: { img: "33-workflows.png", mv: [
    [0.0, "z", 1.1, 600, 520, 6], [0.02, "g", 400, 440, 1300],
    ["Ninety-five", "h", 264, 584, 320, 66, "95 in total"], ["Ninety-five", "n", 280, 604, 0, 95, "", 1.4],
    ["seventeen failing", "h", 596, 584, 316, 66, "17 failing"],
    ["nine that never ran", "h", 924, 584, 312, 66, "9 never ran (estimate)"],
    ["A health check", "h", 264, 415, 520, 168, "26 need fixing, biggest first"], ["A health check", "g", 400, 480, 1100],
  ] },
  overview: { img: "34-overview.png", mv: [
    [0.0, "z", 1.1, 700, 440, 6], [0.02, "g", 500, 400, 1300],
    ["new contacts", "h", 264, 360, 1300, 80, "New contacts, revenue won, open pipeline"],
    ["stale deals", "h", 264, 520, 480, 90, "Stale deal value"],
    ["which accounts need attention", "h", 264, 690, 880, 190, "Accounts that need attention"], ["which accounts need attention", "z", 1.15, 700, 740, 3],
    ["account health", "h", 1136, 684, 430, 50, "Account health"],
  ] },
  settings: { img: "m-37.png", mv: [
    [0.0, "z", 1.08, 700, 460, 6], [0.02, "g", 340, 380, 1300],
    ["in one place", "h", 266, 250, 220, 420, "Ten sections"],
    ["Choose when alerts", "s", "23-alert-settings.png"], ["Choose when alerts", "h", 500, 478, 900, 52, "Quiet hours"], ["Choose when alerts", "g", 520, 500, 1000],
    ["Choose when alerts", "z", 1.12, 900, 560, 3], ["daily brief", "h", 500, 638, 520, 36, "Daily brief in Slack"],
    ["See every permission", "s", "38-settings-permissions.png"], ["See every permission", "h", 498, 395, 800, 480, "Each one says why it is needed"],
    ["Give your team roles", "s", "40-settings-team.png"], ["Give your team roles", "h", 498, 330, 800, 92, "Roles"],
    ["switch off the pages", "s", "43-settings-modules.png"], ["switch off the pages", "h", 498, 350, 800, 520, "Switch pages on or off"],
    ["Nothing changes", "x"], ["Nothing changes", "g", 900, 600, 1200],
  ] },
  started: { img: "29-getting-started-checklist.png", mv: [
    [0.0, "z", 1.12, 700, 330, 6], [0.02, "g", 400, 300, 1300],
    ["ticks itself off", "h", 264, 190, 720, 28, "A bar that fills as you go"],
    ["fourteen of twenty", "h", 862, 92, 130, 34, "14 of 20 done"], ["fourteen of twenty", "n", 864, 94, 0, 14, "", 1.2],
    ["let the first sync finish", "h", 264, 225, 700, 150, "First sync"],
    ["see what needs you today", "h", 264, 380, 700, 76, "What needs you today"],
    ["find the leads still waiting", "h", 264, 486, 700, 140, "Leads still waiting"],
    ["Every step has a button", "h", 300, 430, 110, 38, "A button takes you there"], ["Every step has a button", "g", 350, 448, 1200],
  ] },
  news: { img: "30-whats-new.png", mv: [
    [0.0, "z", 1.1, 600, 460, 6], [0.02, "g", 500, 120, 1200],
    ["What is new lists", "h", 264, 60, 1000, 160, "What went live, newest first"],
    ["like the funnel that moves", "h", 264, 398, 800, 130, "A funnel that moves"], ["like the funnel that moves", "g", 360, 470, 1200],
  ] },
  guides: { img: "31-guide-how-today-works.png", mv: [
    [0.0, "z", 1.12, 700, 260, 6], [0.02, "g", 500, 200, 1300],
    ["sixty-second guide", "h", 264, 70, 380, 40, "A 60-second guide"],
    ["what it shows", "h", 264, 118, 700, 30, "What it shows"],
    ["how to read it", "h", 264, 162, 700, 88, "How to read it"],
    ["what to do next", "h", 264, 252, 700, 52, "Do next, with a button"], ["what to do next", "g", 330, 290, 1100],
  ] },
  w_open: { img: "01-today.png", mv: [
    [0.0, "z", 1.06, 360, 300, 6], [0.02, "g", 64, 72, 1400],
    ["Open it", "h", 14, 20, 196, 430, "Every page, in one menu"],
    ["you land on Today", "h", 262, 58, 130, 34, "Today opens first"], ["you land on Today", "g", 300, 76, 900],
  ] },
  w_sync: { img: "29-getting-started-checklist.png", mv: [
    [0.0, "z", 1.12, 700, 330, 6], [0.02, "g", 400, 300, 1300],
    ["The first sync runs", "h", 264, 225, 700, 150, "First sync, in the background"],
    ["the numbers appear", "s", "02-speed-to-lead.png"], ["the numbers appear", "z", 1.1, 900, 200, 4],
    ["when it last updated", "h", 1078, 30, 150, 30, "Updated just now"], ["when it last updated", "g", 1150, 44, 1100],
  ] },
  w_today: { img: "01-today.png", mv: [
    [0.0, "z", 1.1, 420, 300, 6], [0.02, "g", 420, 290, 1500],
    ["the money at risk", "h", 264, 183, 318, 165, "Money at risk"], ["the money at risk", "n", 276, 212, 0, 751385, "$", 2.2],
    ["accounts to save", "h", 264, 632, 1300, 262, "Accounts to save first"], ["accounts to save", "z", 1.12, 700, 760, 3],
  ] },
  w_range: { img: "01-today.png", mv: [
    [0.0, "z", 1.2, 1160, 40, 4], [0.02, "g", 900, 22, 1200],
    ["Pick your date range", "h", 755, 8, 810, 34, "Pick your dates"], ["Pick your date range", "c", 968, 22, 1200],
    ["follow it", "g", 1200, 22, 1400],
  ] },
  w_setup: { img: "m-37.png", mv: [
    [0.0, "z", 1.08, 700, 460, 6], [0.02, "g", 340, 380, 1300],
    ["Connect your own AI", "h", 498, 425, 800, 160, "Your own AI, if you want one"], ["Connect your own AI", "g", 598, 552, 1200],
    ["Save your alert email", "s", "23-alert-settings.png"], ["Save your alert email", "h", 500, 696, 900, 42, "Your alert email"], ["Save your alert email", "g", 700, 712, 1100],
    ["give your team roles", "s", "40-settings-team.png"], ["give your team roles", "h", 498, 330, 800, 92, "Roles: setter, closer, both"],
  ] },
  w_check: { img: "29-getting-started-checklist.png", mv: [
    [0.0, "z", 1.12, 700, 330, 6], [0.02, "g", 400, 300, 1300],
    ["ticks itself off", "h", 264, 190, 720, 28, "A bar that fills as you go"], ["ticks itself off", "h", 862, 92, 130, 34, "14 of 20 done"],
    ["what is next", "h", 264, 486, 700, 140, "Always the next step"], ["what is next", "g", 350, 448, 1200],
  ] },
  w_help: { img: "31-guide-how-today-works.png", mv: [
    [0.0, "z", 1.12, 700, 260, 6], [0.02, "g", 500, 200, 1300],
    ["sixty-second guide", "h", 264, 70, 380, 40, "A 60-second guide"], ["sixty-second guide", "h", 264, 118, 700, 140, "What it shows, how to read it"],
    ["Help and support", "s", "m-37.png"], ["Help and support", "h", 266, 640, 220, 34, "Help and support"], ["Help and support", "g", 330, 656, 1100],
  ] },
};

// Drawn explanations. They are labelled as drawings and never pretend to be the product screen.
const ILLUS = {
  dup: `<div class="il" style="left:380px;top:360px;width:1160px"><div class="ilt">Illustration: two records for one person</div>
    <div class="rec"><b>Ella Brooks</b><span>+1 555 256 2966</span><span class="miss">no email</span></div><div class="mid">same person?</div>
    <div class="rec"><b>Ella Brooks</b><span class="miss">no phone</span><span>ella@example.com</span></div><div class="mid ok">one record</div>
    <div class="rec ok"><b>Ella Brooks</b><span>+1 555 256 2966</span><span>ella@example.com</span></div></div>`,
  safe: `<div class="il" style="left:240px;top:360px;width:1440px"><div class="ilt">Illustration: how a change is made</div>
    <div class="st">1<b>Preview the changes</b></div><div class="mid">then</div><div class="st">2<b>Type a confirmation</b><i>for bigger changes</i></div><div class="mid">then</div><div class="st">3<b>Undo if you change your mind</b></div></div>`,
};

export const stillPage = (name) => `<!doctype html><meta charset="utf-8"><style>
.hb{position:absolute;border:4px solid #e0a23a;border-radius:14px;box-shadow:0 0 0 4000px rgba(5,8,7,.42),0 0 28px rgba(224,162,58,.7);opacity:0;transition:opacity .45s ease}
.hl{position:absolute;padding:8px 18px;border-radius:12px;background:#e0a23a;color:#1d2321;font:700 30px/1.15 "Segoe UI",Arial,sans-serif;white-space:nowrap;opacity:0;transition:opacity .45s ease;box-shadow:0 8px 22px rgba(0,0,0,.45)}
.cn{position:absolute;padding:6px 14px;border-radius:10px;background:#1b211e;color:#fff;font:700 52px/1.1 Georgia,"Times New Roman",serif;border:2px solid #e0a23a;box-shadow:0 0 22px rgba(224,162,58,.55);opacity:0;transition:opacity .3s}
.tp{position:absolute;padding:4px 14px;background:#0f1412;color:#fff;font:600 34px/1.2 "Segoe UI",Arial,sans-serif;border-radius:8px;border:2px solid #8fb7a6;opacity:0}
.il{position:absolute;display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;padding:54px 40px 36px;border-radius:26px;background:rgba(14,20,18,.96);border:2px solid #3d6b58;box-shadow:0 30px 80px rgba(0,0,0,.65);color:#fff;font-family:"Segoe UI",Arial,sans-serif;opacity:0;transition:opacity .5s}
.il .ilt{position:absolute;left:30px;top:14px;font-size:22px;letter-spacing:.12em;text-transform:uppercase;color:#8fb7a6;font-weight:700}
.rec{width:290px;padding:18px 22px;border-radius:16px;background:#223029;border:2px solid #4b6a5c;display:flex;flex-direction:column;gap:6px;font-size:26px}.rec b{font-size:32px}.rec span.miss{color:#e0a23a}.rec.ok{border-color:#8fb7a6;background:#2b4036}
.mid{font-size:26px;color:#e0a23a;font-weight:700}.mid.ok{color:#8fb7a6}
.st{width:300px;padding:22px;border-radius:16px;background:#223029;border:2px solid #4b6a5c;font-size:26px;display:flex;flex-direction:column;gap:8px}.st b{font-size:30px}.st i{color:#8fb7a6;font-style:normal;font-size:22px}
</style><body style="margin:0;background:#111"><div style="width:1920px;height:1080px;overflow:hidden;position:relative"><main id="mn" style="display:block;width:1920px;height:1080px;position:relative;transform-origin:0 0"><img id="im" style="display:block;position:absolute;left:0;top:0" width="1920" height="1080" src="${uri(name)}"><img id="im2" style="display:block;position:absolute;left:0;top:0;opacity:0;transition:opacity .8s ease" width="1920" height="1080"><div id="ov" style="position:absolute;left:0;top:0;width:1920px;height:1080px"></div></main></div>`;

export async function runChapter(page, ch, T, sleep, moveTo, tfp) {
  const mn = (fn, ...a) => page.evaluate(fn, ...a);
  const zoom = (s, x, y, sec) => mn(([s, x, y, sec]) => { const m = document.getElementById("mn"); x *= 1.2; y *= 1.2; const tx = -x * (s - 1) + (960 - x) * 0.6 * (s - 1), ty = -y * (s - 1) + (540 - y) * 0.6 * (s - 1); m.style.transition = `transform ${sec}s cubic-bezier(.45,0,.35,1)`; m.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; }, [s, x, y, sec]);
  const clear = () => mn(() => { const o = document.getElementById("ov"); for (const e of [...o.children]) { e.style.opacity = 0; setTimeout(() => e.remove(), 500); } });
  const swap = async (name) => { await clear(); await mn((u) => { const m = document.getElementById("mn"); m.style.transition = "transform 1s cubic-bezier(.45,0,.35,1)"; m.style.transform = "translate(0px,0px) scale(1)"; const b = document.getElementById("im2"); b.src = u; b.style.opacity = 1; }, uri(name)); await sleep(900); await mn(() => { const a = document.getElementById("im"), b = document.getElementById("im2"); a.src = b.src; b.style.transition = "none"; b.style.opacity = 0; void b.offsetWidth; b.style.transition = "opacity .8s ease"; }); };
  const box = (x, y, w, h, label) => mn(([x, y, w, h, label]) => {
    const o = document.getElementById("ov"); for (const e of [...o.children]) { e.style.opacity = 0; setTimeout(() => e.remove(), 500); }
    const b = document.createElement("div"); b.className = "hb"; b.style.cssText = `left:${x * 1.2 - 8}px;top:${y * 1.2 - 8}px;width:${w * 1.2 + 16}px;height:${h * 1.2 + 16}px`; o.appendChild(b);
    const l = document.createElement("div"); l.className = "hl"; l.textContent = label || ""; const below = y * 1.2 + h * 1.2 + 70 < 1040; l.style.top = (below ? y * 1.2 + h * 1.2 + 18 : y * 1.2 - 66) + "px"; if (label) { o.appendChild(l); l.style.left = Math.max(20, Math.min(x * 1.2 - 8, 1500 - l.offsetWidth)) + "px"; }
    void b.offsetWidth; b.style.opacity = 1; l.style.opacity = 1;
  }, [x, y, w, h, label]);
  const counter = (x, y, from, to, pre, secs) => mn(([x, y, from, to, pre, secs]) => {
    const o = document.getElementById("ov"); const c = document.createElement("div"); c.className = "cn"; c.style.left = x * 1.2 + "px"; c.style.top = y * 1.2 + "px"; c.textContent = pre + from; o.appendChild(c); void c.offsetWidth; c.style.opacity = 1;
    const t0 = performance.now(); const step = (t) => { const p = Math.min(1, (t - t0) / (secs * 1000)), e = 1 - Math.pow(1 - p, 2.2); c.textContent = pre + Math.round(from + (to - from) * e).toLocaleString("en-US"); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
  }, [x, y, from, to, pre, secs]);
  const typeIn = (x, y, text, ms) => mn(([x, y, text, ms]) => {
    const o = document.getElementById("ov"); const c = document.createElement("div"); c.className = "tp"; c.style.left = x * 1.2 + "px"; c.style.top = y * 1.2 + "px"; o.appendChild(c); c.style.opacity = 1;
    const t0 = performance.now(); const step = (t) => { const n = Math.min(text.length, Math.floor(((t - t0) / ms) * text.length) + 1); c.textContent = text.slice(0, n) + (n < text.length ? "|" : ""); if (t - t0 < ms + 100) requestAnimationFrame(step); }; requestAnimationFrame(step);
  }, [x, y, text, ms]);
  const illus = (html) => mn(([html]) => { const o = document.getElementById("ov"); o.insertAdjacentHTML("beforeend", html); const e = o.lastElementChild; void e.offsetWidth; e.style.opacity = 1; }, [html]);
  const killIl = () => mn(() => { for (const e of document.querySelectorAll("#ov .il")) { e.style.opacity = 0; setTimeout(() => e.remove(), 500); } });
  const steps = ch.mv.map((s) => ({ t: typeof s[0] === "number" ? tfp.f(s[0]) : tfp.p(s[0]), s })).sort((a, b) => a.t - b.t);
  for (const { t, s } of steps) {
    await T.at(t);
    const [, op, a, b, c, d, e, f] = s;
    if (op === "z") zoom(a, b, c, d);
    else if (op === "r") mn(() => { const m = document.getElementById("mn"); m.style.transition = "transform 1.2s cubic-bezier(.45,0,.35,1)"; m.style.transform = "translate(0px,0px) scale(1)"; });
    else if (op === "s") await swap(a);
    else if (op === "g") await moveTo(page, a * S, b * S, c);
    else if (op === "c") { await moveTo(page, a * S, b * S, c); await sleep(150); await page.mouse.down(); await sleep(70); await page.mouse.up(); }
    else if (op === "h") await box(a, b, c, d, e);
    else if (op === "x") await clear();
    else if (op === "n") await counter(a, b, c, d, e, f);
    else if (op === "t") await typeIn(a, b, c, d);
    else if (op === "il") { await clear(); await killIl(); if (a !== "none") await illus(ILLUS[a]); }
  }
}

// ---- alerts: the bell in the app, the real chat message, an email in the same style, and the CRM list it opens ---------
export async function alertsHtml() {
  const buf = await sharp(SLACK).resize({ width: 1500, kernel: "lanczos3" }).sharpen({ sigma: 0.7 }).png().toBuffer();
  const slack = "data:image/png;base64," + buf.toString("base64");
  const bellBuf = await sharp(path.join(STILLS, "01-today.png")).extract({ left: 1020, top: 22, width: 544, height: 44 }).resize({ width: 1632, kernel: "lanczos3" }).png().toBuffer();
  const bell = "data:image/png;base64," + bellBuf.toString("base64");
  const bobuf = await sharp(path.join(STILLS, "21-bell-open.png")).extract({ left: 570, top: 30, width: 460, height: 830 }).resize({ height: 760, kernel: "lanczos3" }).png().toBuffer();
  const bellopen = "data:image/png;base64," + bobuf.toString("base64");
  const kk = 1500 / 600;
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1200px 700px at 30% 20%,#162620 0%,#0d1210 55%,#0a0d0c 100%);font-family:"Segoe UI",Arial,sans-serif;color:#e8efec;overflow:hidden;position:relative}
#vd-cursor{display:none!important}
.ttl{position:absolute;left:210px;top:56px;font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:#7fb79e;font-weight:600}
.ph{position:absolute;inset:0;opacity:0;transition:opacity .8s ease}.ph.show{opacity:1}
#bopen{position:absolute;left:250px;top:110px;border-radius:18px;overflow:hidden;border:2px solid #34493f;box-shadow:0 40px 100px rgba(0,0,0,.6)}#bopen img{display:block;height:760px}
#bellcard{position:absolute;left:144px;top:300px;width:1632px;border-radius:22px;overflow:hidden;border:2px solid #34493f;box-shadow:0 40px 100px rgba(0,0,0,.6)}
#bellcard img{display:block;width:1632px}
.bhl{position:absolute;left:1560px;top:296px;width:0;height:60px;border-radius:12px;border:4px solid #e0a23a;box-shadow:0 0 30px rgba(224,162,58,.8);opacity:0;transition:opacity .5s}
.cap2{position:absolute;left:144px;top:470px;font-size:44px;font-weight:700;color:#fff;opacity:0;transition:opacity .6s}
#slackcard{position:absolute;left:180px;top:250px;width:1560px;padding:30px;border-radius:26px;background:#222529;border:1px solid #3a3f45;box-shadow:0 40px 100px rgba(0,0,0,.6)}
#slackcard img{display:block;width:1500px;height:${Math.round(155 * kk)}px;image-rendering:auto}
.hl{position:absolute;border-radius:10px;background:rgba(224,162,58,.22);box-shadow:0 0 34px rgba(224,162,58,.6);width:0;transition:width 1s cubic-bezier(.3,.7,.2,1)}
.ul{position:absolute;height:5px;border-radius:3px;background:#4aa3ff;box-shadow:0 0 18px rgba(74,163,255,.9);width:0;transition:width .9s cubic-bezier(.3,.7,.2,1)}
.tag{position:absolute;padding:8px 18px;border-radius:12px;background:#e0a23a;color:#1d2321;font-weight:700;font-size:30px;opacity:0;transition:opacity .5s}
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
</style><div class="ttl" id="ttl">In the app</div>
<div class="ph" id="p0"><div id="bellcard"><img src="${bell}"></div><div class="bhl" id="bh"></div><div class="cap2" id="bc">A bell, with the number waiting</div></div>
<div class="ph" id="pb"><div id="bopen"><img src="${bellopen}"></div><div class="tag" id="bt1" style="left:760px;top:360px;font-size:44px;padding:14px 26px">Open it, snooze it, or dismiss it</div></div>
<div class="ph" id="p1"><div id="slackcard"><img src="${slack}"></div>
 <div class="hl" id="h1" style="left:${180 + 30 + 40 * kk / 2.5}px;top:${250 + 30 + 22 * kk}px;height:${Math.round(20 * kk)}px"></div>
 <div class="ul" id="u1" style="left:${180 + 30 + 30 * kk}px;top:${250 + 30 + 150 * kk}px"></div>
 <div class="tag" id="g1" style="left:210px;top:190px">What is wrong</div><div class="tag" id="g2" style="left:210px;top:690px">What to do next, and the link</div></div>
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
export async function alertsRun(page, T, sleep, moveTo, tfp) {
  const show = (id) => page.evaluate((i) => document.getElementById(i).classList.add("show"), id);
  const hide = (id) => page.evaluate((i) => document.getElementById(i).classList.remove("show"), id);
  const ttl = (t) => page.evaluate((x) => { document.getElementById("ttl").textContent = x; }, t);
  const set = (id, css) => page.evaluate(([i, c]) => Object.assign(document.getElementById(i).style, c), [id, css]);
  const kk = 2.5;
  await ttl("In the app"); await show("pb"); await set("bt1", { opacity: 1 });

  await T.at(tfp.p("In Slack and by email")); await hide("pb"); await sleep(500); await ttl("In Slack"); await show("p1");
  await set("h1", { width: Math.round(560 * kk) + "px" }); await set("g1", { opacity: 1 });
  await T.at(tfp.p("what to do next")); await set("u1", { width: Math.round(160 * kk) + "px" }); await set("g1", { opacity: 0 }); await set("g2", { opacity: 1 });
  await moveTo(page, 180 + 30 + 120 * kk, 250 + 30 + 152 * kk, 800);
  await sleep(500); await hide("p1"); await sleep(500); await ttl("By email"); await show("p2");
  await T.at(tfp.p("links straight")); const b = await page.locator("#ml").boundingBox(); await moveTo(page, b.x + b.width / 2, b.y + b.height / 2, 900);
  await sleep(200); await page.mouse.down(); await sleep(70); await page.mouse.up();
  await sleep(250); await hide("p2"); await sleep(500); await ttl("It opens the right account in your CRM"); await show("p3");
  await moveTo(page, 700, 520, 1400);
}

// ---- closing card: the real logo alone, then the call to action (the words are on the card, so there is no caption strip) ----
export const closeHtml = () => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1300px 800px at 35% 40%,#1a3a30 0%,#0e1613 58%,#090c0b 100%);font-family:"Segoe UI",Arial,sans-serif;color:#fff;overflow:hidden;position:relative}
#vd-cursor{display:none!important}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.t{position:absolute;left:900px;width:900px;opacity:0;transform:translateY(14px);transition:opacity .9s ease,transform 1s ease}.t.show{opacity:1;transform:none}
.sm{font-size:48px;font-weight:600;color:#d3e6dc;line-height:1.25}.big{font-size:92px;font-weight:800;letter-spacing:-.02em;line-height:1.05}
.btn{display:inline-block;margin-top:6px;padding:20px 40px;border-radius:18px;background:#e0a23a;color:#1d2321;font-size:44px;font-weight:800}
</style>${logoCss(0.2, 580, 290, 150)}
<img class="lg" src="data:image/png;base64,${logoData()}"><div class="wm" style="left:220px;top:760px;width:560px;text-align:center;animation-delay:.9s">SubSync</div>
<div class="t sm" id="c1" style="top:170px">Bring your connected accounts together.</div>
<div class="t sm" id="c2" style="top:300px">Know what's happening, see what needs attention and take action with SubSync.</div>
<div class="t big" id="c3" style="top:520px">Install once.<br>Free for 14 days.</div>
<div class="t" id="c4" style="top:830px"><span class="btn">Install SubSync</span></div>`;
export async function closeRun(page, T, tfp) {
  const on = (id) => page.evaluate((i) => document.getElementById(i).classList.add("show"), id);
  await T.at(tfp.p("Bring your")); await on("c1");
  await T.at(tfp.p("Know what's")); await on("c2");
  await T.at(tfp.p("Install once")); await on("c3");
  await T.at(tfp.p("Free for") + 0.4); await on("c4");
}

export const welcomeEndHtml = () => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:radial-gradient(1300px 800px at 35% 40%,#1a3a30 0%,#0e1613 58%,#090c0b 100%);font-family:"Segoe UI",Arial,sans-serif;color:#fff;overflow:hidden;position:relative}
#vd-cursor{display:none!important}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.t{position:absolute;left:900px;width:900px;opacity:0;transform:translateY(14px);transition:opacity .9s ease,transform 1s ease}.t.show{opacity:1;transform:none}
.big{font-size:84px;font-weight:800;letter-spacing:-.02em;line-height:1.08}.sm{font-size:50px;font-weight:600;color:#d3e6dc;line-height:1.25}
</style>${logoCss(0.2, 580, 290, 150)}
<img class="lg" src="data:image/png;base64,${logoData()}"><div class="wm" style="left:220px;top:760px;width:560px;text-align:center;animation-delay:.9s">SubSync</div>
<div class="t big" id="c1" style="top:300px">You are set.</div>
<div class="t sm" id="c2" style="top:470px">Open Today and start with the first account to save.</div>`;
export async function welcomeEndRun(page, T, tfp) {
  const on = (id) => page.evaluate((i) => document.getElementById(i).classList.add("show"), id);
  await T.at(tfp.p("You are set")); await on("c1");
  await T.at(tfp.p("Open Today")); await on("c2");
}
