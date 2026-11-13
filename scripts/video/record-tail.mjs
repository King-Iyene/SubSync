// Records the stills-based chapters, the alerts shot and the closing card (v2). Called from record.mjs.
import { CHAPTERS, stillPage, runChapter, alertsHtml, alertsRun, closeHtml, closeRun } from "./chapters.mjs";

export async function run({ record, page, showHtml, plan, only, sleep, moveTo }) {
  const tfFor = (id) => { const sp = plan.shots.find((s) => s.id === id); const end = sp.lines[sp.lines.length - 1].clipStart + sp.lines[sp.lines.length - 1].dur; return (f) => sp.head + f * (end - sp.head); };
  for (const id of Object.keys(CHAPTERS)) {
    if (only && !only.includes(id)) continue;
    const ch = CHAPTERS[id];
    await showHtml(id, stillPage(ch.img)); await page.mouse.move(1500, 800);
    const tf = tfFor(id);
    await record(id, (T) => runChapter(page, ch, T, sleep, moveTo, tf));
  }
  if (!only || only.includes("alerts")) {
    await showHtml("alerts", await alertsHtml()); await page.mouse.move(1500, 900);
    const tf = tfFor("alerts");
    await record("alerts", (T) => alertsRun(page, T, sleep, moveTo, tf));
  }
  if (!only || only.includes("close")) {
    await showHtml("close", closeHtml()); await page.mouse.move(1900, 1070);
    const tf = tfFor("close");
    await record("close", (T) => closeRun(page, T, tf));
  }
}
