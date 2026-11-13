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

/** The address that opens exactly the rows behind one number, in the app. The person signs in there with their own role, so a row is never shown to someone who may not see it. */
export function rowsLink(appUrl: string, hash: string, label: string, locationId: string | null): string {
  const q = [`rows=${encodeURIComponent(hash)}`, locationId ? `account=${encodeURIComponent(locationId)}` : "", `label=${encodeURIComponent(label.slice(0, 80))}`].filter(Boolean).join("&");
  return `${appUrl.replace(/\/+$/, "")}/app#ask?${q}`;
}

export function formatAnswer(r: Extract<AskResult, { ok: true }>, o: { appUrl: string; locationId: string | null }): string {
  const out = [esc(r.answer.answer)];
  if (r.answer.citations.length) {
    out.push("", "*Where this comes from*");
    for (const c of r.answer.citations.slice(0, 6)) out.push(`• ${esc(c.label)}: ${esc(c.value)} (${c.rowCount.toLocaleString("en-US")} ${c.rowCount === 1 ? "row" : "rows"}) <${rowsLink(o.appUrl, c.rowsHash, c.label, o.locationId)}|Open the rows in SubSync>`);
  }
  out.push("", `_${esc(r.window)}. Answered from your numbers. Nothing was sent or changed._`);
  return out.join("\n");
}

const SETTINGS = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}/app#connections`;

/** What a refused question says, in plain words and with the link to fix it where there is one. */
export function formatRefusal(code: string, message: string, appUrl: string): string {
  switch (code) {
    case "no_connection": return `AI is not connected yet. Connect your AI key here: <${SETTINGS(appUrl)}|Connections in SubSync>.`;
    case "needs_attention": return `Your AI key needs attention. Replace it here: <${SETTINGS(appUrl)}|Connections in SubSync>.`;
    case "killed": return "AI answers are switched off right now.";
    case "paused": case "job_off": return "AI answers are switched off for this account.";
    case "cap": return "This month's AI limit for your account has been reached, so I cannot answer until it renews or the limit is raised.";
    case "rate": return "Too many questions at once. Please try again in a minute.";
    case "question": return HELP_TEXT;
    default: return esc(message || "I could not answer that safely. Try asking it another way.");
  }
}
