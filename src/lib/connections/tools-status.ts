// The status words of the "Your tools" list in Settings, Connections. Pure: every word is worked out from recorded facts passed in, so each one can be tested.
// Plain words only (no internal terms). "Needs permission: reconnect" is the one phrase for a missing permission.

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
export type Status = { text: string; tone: Tone };

// ---------------- AI ----------------
export type AiFacts = {
  /** The AI status request failed because the feature is not switched on for this account (404). */
  notSwitchedOn: boolean;
  /** The request failed for another reason. */
  failed: boolean;
  canManage: boolean;
  killed: boolean;
  connection: { provider: string; model: string; status: "connected" | "needs_attention"; paused: boolean } | null;
};

const PROVIDER_WORDS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini", google: "Gemini", openrouter: "OpenRouter", compatible: "Your own service" };
export const providerWord = (p: string): string => PROVIDER_WORDS[p] ?? p;

export function aiStatus(f: AiFacts): Status {
  if (f.notSwitchedOn) return { text: "Not switched on yet", tone: "neutral" };
  if (f.failed) return { text: "Could not load", tone: "warn" };
  if (!f.canManage) return { text: "Set by your administrator", tone: "neutral" };
  if (f.killed) return { text: "Switched off for everyone", tone: "warn" };
  const c = f.connection;
  if (!c) return { text: "Not connected", tone: "neutral" };
  if (c.status !== "connected") return { text: "Needs attention", tone: "bad" };
  if (c.paused) return { text: "Paused", tone: "warn" };
  return { text: `Connected: ${providerWord(c.provider)}, ${c.model}`, tone: "good" };
}

/** The sentence under the AI row's name. */
export function aiLine(f: AiFacts): string {
  if (f.notSwitchedOn) return "AI help is not switched on for your account yet.";
  if (!f.canManage && !f.failed) return "Only an administrator connects AI. Ask yours if you want AI wording and answers.";
  const c = f.connection;
  if (!c) return "Not connected, so SubSync is not using any AI. Everything else works without it.";
  if (c.status !== "connected") return "Your AI provider did not accept the key. Open it to replace the key.";
  if (c.paused) return "Paused: nothing is sent to your AI provider until you turn it back on.";
  return "Working. Open it to see this month's usage and your limit.";
}

export const AI_WHAT = "Lets SubSync write briefs, reports and answers from your own numbers. You use your own AI account; SubSync never pays for AI and the AI never messages a lead.";

// ---------------- Email ----------------
export type EmailFacts = {
  address: string | null;
  /** From the last public-record check of the address's domain: null when never checked. */
  check: { status: "ok" | "warning" | "critical" | "error"; checkedAt: string } | null;
  sendingLive: boolean;
};

export function emailStatus(f: EmailFacts): Status {
  if (!f.address) return { text: "No address yet", tone: "neutral" };
  if (!f.check) return { text: "Address saved, not checked", tone: "info" };
  if (f.check.status === "ok") return { text: "Checked: passing", tone: "good" };
  if (f.check.status === "error") return { text: "Could not check", tone: "warn" };
  if (f.check.status === "warning") return { text: "Checked: needs attention", tone: "warn" };
  return { text: "Checked: broken records", tone: "bad" };
}

export function emailLine(f: EmailFacts): string {
  if (!f.address) return "No address saved, so no emails are sent.";
  const base = `Alert and summary emails go to ${f.address}.`;
  return f.sendingLive ? base : `${base} Sending is switched off for now, so nothing is sent yet.`;
}

export type RecordArea = "spf" | "dkim" | "dmarc";
export type RecordResult = { area: RecordArea; label: string; tone: Tone; text: string };

/** One line per record (SPF, DKIM, DMARC) from the findings of a check. A record with no problem found reads "Found". */
export function recordResults(findings: Array<{ severity: "critical" | "warning" | "info" | "good"; area: string; message: string }>): RecordResult[] {
  const labels: Record<RecordArea, string> = { spf: "SPF", dkim: "DKIM", dmarc: "DMARC" };
  const rank = { critical: 3, warning: 2, info: 1, good: 0 } as const;
  return (["spf", "dkim", "dmarc"] as const).map((area) => {
    const mine = findings.filter((x) => x.area === area).sort((a, b) => rank[b.severity] - rank[a.severity]);
    const worst = mine[0];
    if (!worst) return { area, label: labels[area], tone: "neutral" as Tone, text: "Not reported" };
    const tone: Tone = worst.severity === "critical" ? "bad" : worst.severity === "warning" ? "warn" : worst.severity === "good" ? "good" : "info";
    return { area, label: labels[area], tone, text: worst.message };
  });
}

/** What the screen says after "Send me a test". */
export function testResultText(r: { dryRun: boolean; to: string }): string {
  return r.dryRun
    ? `Sending is switched off for now, so nothing was sent. This is what would be sent to ${r.to}.`
    : `A test email was sent to ${r.to}. Check your inbox, and spam, in a minute.`;
}

// ---------------- Calendars ----------------
export type CalendarFacts = { count: number; mapped: number; permissionMissing: boolean };

export function calendarStatus(f: CalendarFacts): Status {
  if (f.permissionMissing) return { text: "Needs permission: reconnect", tone: "warn" };
  if (f.count === 0) return { text: "None read yet", tone: "neutral" };
  return { text: `${f.count} calendar${f.count === 1 ? "" : "s"}`, tone: "good" };
}

export function calendarLine(f: CalendarFacts): string {
  if (f.permissionMissing) return "SubSync cannot read your calendars yet, because this install has not approved the Calendars permission. Reconnect SubSync to allow it.";
  if (f.count === 0) return "No calendars found yet. They appear after the first sync.";
  if (f.mapped === 0) return `${f.count} calendar${f.count === 1 ? "" : "s"} found. None has a team member attached yet.`;
  return `${f.count} calendar${f.count === 1 ? "" : "s"} found. ${f.mapped} ${f.mapped === 1 ? "has" : "have"} a team member attached.`;
}

// ---------------- Slack chat ----------------
export type SlackChatFacts = {
  /** The chat feature switch for this account. */
  on: boolean;
  /** Linked workspaces (connected). */
  links: number;
  /** Messages the bot has heard in the recent window kept by the app (2 days), and when the last one came. */
  recentEvents: number;
  lastEventAt: string | null;
};
export type SlackChatState = "off" | "not_set_up" | "waiting" | "connected";

export function slackChatState(f: SlackChatFacts): SlackChatState {
  if (!f.on) return "off";
  if (f.links === 0) return "not_set_up";
  return f.recentEvents > 0 ? "connected" : "waiting";
}

export function slackChatLine(f: SlackChatFacts): string {
  switch (slackChatState(f)) {
    case "off": return "Chat: not switched on for your account yet.";
    case "not_set_up": return "Chat: not set up. Your administrator adds SubSync to Slack to turn it on.";
    case "waiting": return "Chat: set up, waiting for the first message.";
    default: return "Chat: connected. The bot has answered in Slack in the last two days.";
  }
}

export const SLACK_CHAT_NOTE = "Chat answers use your own connected AI and your own numbers. If no AI is connected, the bot says AI is not connected yet.";

// ---------------- What's connected (top of the page) ----------------
export type Chip = { name: string; text: string; tone: Tone };

export function summaryChips(p: { ai: Status; slack: { connected: boolean }; email: Status; fathom: { connected: boolean; needsReconnect: boolean } }): Chip[] {
  return [
    { name: "AI", text: p.ai.text.startsWith("Connected") ? "Connected" : p.ai.text, tone: p.ai.tone },
    { name: "Slack", text: p.slack.connected ? "Connected" : "Not connected", tone: p.slack.connected ? "good" : "neutral" },
    { name: "Email", text: p.email.text, tone: p.email.tone },
    { name: "Fathom", text: p.fathom.connected ? "Connected" : p.fathom.needsReconnect ? "Reconnect" : "Not connected", tone: p.fathom.connected ? "good" : p.fathom.needsReconnect ? "warn" : "neutral" },
  ];
}
