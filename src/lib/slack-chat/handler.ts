// Chat with the bot in Slack (flag slack_chat, default off). Pure core: everything that touches the world (database, Slack, the AI) is passed in, so the whole flow is
// tested with mock Slack payloads and a mock AI. Rules, in order:
//   1. The request must carry a valid Slack signature made with our signing secret, and be less than five minutes old. Anything else is refused with 401 and nothing else happens.
//   2. Slack's one-time "url_verification" challenge is echoed back (it is signed too).
//   3. With the feature off or the kill switch on, the request is acknowledged and ignored.
//   4. An event id that was already seen is acknowledged and ignored (Slack retries), so a question is answered once.
//   5. We answer 200 at once and work in the background (`later`), because Slack gives up after three seconds.
//   6. The workspace and channel decide the tenant (one company or one client account); a Slack person never chooses it. An unknown workspace gets nothing but a log line
//      (we hold no token for it, so we could not reply even if we wanted to).
//   7. Answers come only from the read-only Ask your data tools with the number check, citations and the customer's own AI key. Names are never sent to the AI from Slack.

import type { AskResult } from "../ai/data/ask.ts";
import { verifySlackSignature } from "./signature.ts";
import { formatAnswer, formatRefusal, HELP_TEXT, QUESTION_MAX, questionFrom } from "./format.ts";

export type ChatLink = { id: string; installationId: string; locationId: string | null; teamId: string; channelId: string; botToken: string; botUserId: string | null };

export type ChatDeps = {
  enabled(): Promise<boolean>;
  signingSecret: string | undefined;
  now(): number;
  /** True the first time an event id is seen; false for a repeat. */
  claimEvent(eventId: string, teamId: string, slackUser: string): Promise<boolean>;
  /** The company or client account this workspace (and channel) belongs to, or null when it is not connected. */
  findLink(teamId: string, channelId: string): Promise<ChatLink | null>;
  /** How many questions this Slack person asked since `sinceMs`. */
  recentCount(teamId: string, slackUser: string, sinceMs: number): Promise<number>;
  ask(link: ChatLink, question: string, userKey: string): Promise<AskResult>;
  post(link: ChatLink, channel: string, threadTs: string | null, text: string): Promise<void>;
  /** The account's CRM dashboard link (its own company's CRM domain), or null when the chat is not for one account. SubSync addresses are never sent to Slack. */
  crmUrl(link: ChatLink): Promise<string | null>;
  /** Run after the response is sent (Vercel `after`). */
  later(fn: () => Promise<void>): void;
  log(code: string, detail?: Record<string, unknown>): void;
};

export const RATE_WINDOW_MS = 10 * 60_000;
export const RATE_MAX = 8;

export type Reply = { status: number; body: Record<string, unknown> };

type SlackEvent = { type?: string; channel_type?: string; channel?: string; user?: string; text?: string; ts?: string; thread_ts?: string; bot_id?: string; subtype?: string };
type Envelope = { type?: string; challenge?: string; team_id?: string; event_id?: string; event?: SlackEvent };

export async function handleSlackRequest(raw: string, headers: { timestamp: string | null; signature: string | null }, d: ChatDeps): Promise<Reply> {
  const sig = verifySlackSignature({ secret: d.signingSecret, timestamp: headers.timestamp, signature: headers.signature, body: raw, nowMs: d.now() });
  if (!sig.ok) { d.log("slack_chat.refused", { reason: sig.reason }); return { status: 401, body: { error: "Not allowed" } }; }
  let env: Envelope;
  try { env = JSON.parse(raw) as Envelope; } catch { return { status: 400, body: { error: "Bad request" } }; }
  if (env.type === "url_verification") return typeof env.challenge === "string" ? { status: 200, body: { challenge: env.challenge } } : { status: 400, body: { error: "Bad request" } };
  if (env.type !== "event_callback" || !env.event) return { status: 200, body: { ok: true } };
  if (!(await d.enabled())) return { status: 200, body: { ok: true, ignored: "off" } };

  const ev = env.event, team = env.team_id ?? "", eventId = env.event_id ?? "";
  const isMention = ev.type === "app_mention";
  const isDm = ev.type === "message" && ev.channel_type === "im";
  // Our own replies, other bots and edited or deleted messages never start an answer.
  if ((!isMention && !isDm) || ev.bot_id || ev.subtype || !ev.user || !ev.channel || !team || !eventId) return { status: 200, body: { ok: true, ignored: "not_a_question" } };
  if (!(await d.claimEvent(eventId, team, ev.user))) return { status: 200, body: { ok: true, ignored: "duplicate" } };

  d.later(() => answer(team, ev, d).catch((e) => d.log("slack_chat.failed", { code: e instanceof Error ? e.name : "error" })));
  return { status: 200, body: { ok: true } };
}

async function answer(team: string, ev: SlackEvent, d: ChatDeps): Promise<void> {
  const channel = ev.channel as string, user = ev.user as string;
  const link = (await d.findLink(team, channel)) ?? (await d.findLink(team, ""));
  if (!link) { d.log("slack_chat.unknown_workspace", { team }); return; }
  const thread = ev.thread_ts ?? (ev.type === "app_mention" ? ev.ts ?? null : null);
  const say = (text: string) => d.post(link, channel, thread, text);
  const q = questionFrom(ev.text ?? "", link.botUserId);
  if (q.length === 0) return say(HELP_TEXT);
  if (q.length > QUESTION_MAX) return say(`Please keep the question under ${QUESTION_MAX} characters.`);
  if ((await d.recentCount(team, user, d.now() - RATE_WINDOW_MS)) > RATE_MAX) return say("You are asking quickly. Please wait a few minutes and ask again.");
  const r = await d.ask(link, q, `slack:${team}:${user}`);
  if (!r.ok) return say(formatRefusal(r.code, r.message, await d.crmUrl(link)));
  return say(formatAnswer(r, { crmUrl: await d.crmUrl(link) }));
}
