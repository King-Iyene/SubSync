// Records the product chapters (real screens with highlights), the alerts shot and the closing card. Called from record.mjs.
import { CHAPTERS, stillPage, runChapter, alertsHtml, alertsRun, closeHtml, closeRun, welcomeEndHtml, welcomeEndRun } from "./chapters.mjs";

export async function run({ record, page, showHtml, plan, only, sleep, moveTo }) {
  // Time helpers for one shot: f(fraction of the voice line) and p(phrase of the spoken text), both in seconds inside the clip.
  const tfFor = (id) => {
    const sp = plan.shots.find((s) => s.id === id);
    const l = plan.lines.find((x) => x.shot === id), st = sp.lines[0];
    return { f: (fr) => st.clipStart + fr * st.dur, p: (ph) => { const i = l.text.indexOf(ph); if (i < 0) throw new Error(`phrase "${ph}" not in ${id}`); return Math.max(0, st.clipStart + (i / l.text.length) * st.dur - 0.25); } };
  };
  for (const id of Object.keys(CHAPTERS)) {
    if ((only && !only.includes(id)) || (!only && id.startsWith("w_"))) continue;
    const ch = CHAPTERS[id];
    await showHtml(id, stillPage(ch.img)); await page.mouse.move(1500, 800);
    const tfp = tfFor(id);
    await record(id, (T) => runChapter(page, ch, T, sleep, moveTo, tfp));
  }
  if (!only || only.includes("alerts")) {
    await showHtml("alerts", await alertsHtml()); await page.mouse.move(1500, 900);
    const tfp = tfFor("alerts");
    await record("alerts", (T) => alertsRun(page, T, sleep, moveTo, tfp));
  }
  if (only && only.includes("w_end")) {
    await showHtml("w_end", welcomeEndHtml()); await page.mouse.move(1900, 1070);
    const tfp = tfFor("w_end");
    await record("w_end", (T) => welcomeEndRun(page, T, tfp));
  }
  if (!only || only.includes("close")) {
    await showHtml("close", closeHtml()); await page.mouse.move(1900, 1070);
    const tfp = tfFor("close");
    await record("close", (T) => closeRun(page, T, tfp));
  }
}
