import { factsText, type AlertFacts } from "../../notifications/alert-text";
import { realDeps } from "../brief";
import { runJob, type Deps } from "../gateway";
import { checkWords, numbersNotInInput } from "../safety";
import { loadEffective, type Effective } from "./prefs";

// The AI writes the sentence under an alert's headline in Slack, from the alert's facts only (alert-text.ts `factsText`). The headline, the causes and the link stay the data-specific
// template, so a figure in the message never depends on the model. Order of checks: the account's own switch (Settings, AI), then the gateway (kill switches, the customer's key and
// job switch, monthly cap, rate limit, number guard: every figure must be in the facts), then a second number check here. Any failure returns null and the caller keeps the template.
// Suggest only: it only words a message that SubSync would have sent anyway; it never reaches a lead and never writes to the CRM.

export const ALERT_REPORT_MAX = 420;

export type Writer = { inst: string; locationId: string; featureOn: boolean; deps?: Deps; /** The account's own choices, when the caller already has them (tests). */ eff?: Effective };

/** The AI-written next-step sentence for one alert, or null (off, no key, over a cap, rejected by the guard, or an error). */
export async function aiAlertBody(w: Writer, facts: AlertFacts): Promise<string | null> {
  if (!w.featureOn) return null;
  try {
    const eff = w.eff ?? (await loadEffective(w.inst, w.locationId));
    if (!eff.jobs.alert_report) return null;
    const text = factsText(facts);
    const r = await runJob(w.deps ?? realDeps(), {
      installationId: w.inst, locationId: w.locationId, userKey: null, job: "alert_report", trigger: "scheduled",
      input: { text: `${text}\nTone: ${eff.tone}`, fields: ["the alert's counts, window and usual level", "its biggest causes", "your tone choice"], includesNames: false },
    });
    if (!r.ok) return null;
    const out = r.text.replace(/\s+/g, " ").trim();
    if (!out || out.length > ALERT_REPORT_MAX || /[<>]/.test(out)) return null;
    if (!checkWords(text, out, ALERT_REPORT_MAX).ok || numbersNotInInput(text, out).length > 0) return null;
    return out;
  } catch { return null; }
}
