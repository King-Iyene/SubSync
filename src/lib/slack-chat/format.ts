// The words of the bot's replies in Slack (pure). Only the three characters Slack treats specially (& < >) are escaped, so an answer can never become a mention or a link.

import type { AskResult } from "../ai/data/ask.ts";

export const QUESTION_MAX = 300;
export const HELP_TEXT = "Ask me about your leads, replies, appointments, deals or data quality. For example: \"who hasn't been answered?\" or \"how many no-shows this week?\". I only answer from your numbers. I do not send anything or change anything: sending and changes are done in SubSync by a person, after a preview.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The question inside a message: mentions of the bot and other people removed, one line. */
export function questionFrom(text: string, botUserId: string | null): string {
  let t = text;
  if (botUserId) t = t.split(`<@${botUserId}>`).join(" ");
  t = t.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, " ").replace(/<![a-z]+(\^[^>]*)?(\|[^>]*)?>/g, " ").replace(/<(https?:[^>|]+)(\|[^>]*)?>/g, "$1");
  return t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** SubSync opens only inside the CRM (the CRM signs the person in), so a Slack reply never links to a SubSync address. It links to the account's CRM dashboard (when the chat belongs to one account) and says which menu to open; with no single account there is no link, only words. */
const where = (crmUrl: string | null, path: string) => (crmUrl ? `<${crmUrl}|${esc(`Open your CRM, then ${path}`)}>` : esc(`In your CRM, open ${path}`));

export function formatAnswer(r: Extract<AskResult, { ok: true }>, o: { crmUrl: string | null }): string {
  const out = [esc(r.answer.answer)];
  if (r.answer.citations.length) {
    out.push("", "*Where this comes from*");
    for (const c of r.answer.citations.slice(0, 6)) out.push(`• ${esc(c.label)}: ${esc(c.value)} (${c.rowCount.toLocaleString("en-US")} ${c.rowCount === 1 ? "row" : "rows"})`);
    out.push(where(o.crmUrl, "SubSync to see the rows behind these numbers."));
  }
  out.push("", `_${esc(r.window)}. Answered from your numbers. Nothing was sent or changed._`);
  return out.join("\n");
}

/** What a refused question says, in plain words and with the link to fix it where there is one. */
export function formatRefusal(code: string, message: string, crmUrl: string | null): string {
  switch (code) {
    case "no_connection": return `AI is not connected yet. Connect your AI key: ${where(crmUrl, "SubSync > Settings > Integrations")}.`;
    case "needs_attention": return `Your AI key needs attention. Replace it: ${where(crmUrl, "SubSync > Settings > Integrations")}.`;
    case "killed": return "AI answers are switched off right now.";
    case "paused": case "job_off": return "AI answers are switched off for this account.";
    case "cap": return "This month's AI limit for your account has been reached, so I cannot answer until it renews or the limit is raised.";
    case "rate": return "Too many questions at once. Please try again in a minute.";
    case "question": return HELP_TEXT;
    default: return esc(message || "I could not answer that safely. Try asking it another way.");
  }
}
