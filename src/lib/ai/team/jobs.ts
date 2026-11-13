import type { JobDef } from "../jobs";

// The six team and client jobs (docs/AI_AGENTS_PLAN.md section 9). Each is suggest-only: our SQL works out every number, the model only writes words around them, the number guard in
// safety.ts throws away any answer with a figure we did not give it, and an agency person reads and edits every client-facing text and sends it themselves. Registered in ../jobs.ts with one spread.

export const TEAM_JOB_IDS = ["report_summary", "lead_story", "coach_note", "anomaly_explain", "meeting_summary", "one_thing"] as const;
export type TeamJobId = (typeof TEAM_JOB_IDS)[number];

/** Jobs that stay off until the account switches them on (they read people's numbers or meeting text). The rest default on once the feature flag and the connection switch are on. */
export const OPT_IN_JOBS: readonly TeamJobId[] = ["coach_note", "meeting_summary"];

export const WORDS = [
  "Rules: plain words a busy business owner understands, no jargon, no markdown, no emoji.",
  "Use ONLY the figures in the data. Copy each figure exactly as written. Never calculate, round, add up or invent a figure, and never write a time of day or a year.",
  "Money is an estimate or a recorded value: say 'about' or 'recorded' when you mention dollars.",
  "Never say anything was sent, fixed or changed, and never promise a result. Never mention how you work or that you are an AI.",
  "Follow the Tone line in the data.",
].join(" ");

const str = (maxLength: number) => ({ type: "string", maxLength }) as const;

export const TEAM_JOBS: Record<TeamJobId, JobDef> = {
  report_summary: {
    id: "report_summary", title: "Monthly client report summary", status: "live", approval: "suggest", privacy: "aggregate", costClass: "large",
    output: { kind: "json", maxChars: 2400, schema: { type: "object", props: { whatHappened: str(700), caughtAndFixed: str(500), wins: { type: "array", items: str(220), maxItems: 3 }, nextMonth: { type: "array", items: str(220), maxItems: 3 } } } },
    tools: [], maxTokens: 800, maxToolRounds: 0,
    system: `You write the summary at the top of a monthly report that a company gives to one of its own clients. You are given the month's figures already worked out. Answer with one JSON object: {"whatHappened": 2 to 4 sentences on what happened this month, "caughtAndFixed": 1 to 2 sentences on the problems found and cleared (empty text if none were recorded), "wins": up to 3 short wins taken from figures that improved, "nextMonth": up to 3 short things to focus on next month, written as plans and not promises}. Speak to the client about their business. Leave out any figure that says it was not measured. ${WORDS}`,
  },
  lead_story: {
    id: "lead_story", title: "Lead stories", status: "live", approval: "suggest", privacy: "aggregate", costClass: "small",
    output: { kind: "json", maxChars: 6000, schema: { type: "object", props: { stories: { type: "array", maxItems: 25, items: { type: "object", props: { id: str(8), line: str(190) } } } } } },
    tools: [], maxTokens: 1500, maxToolRounds: 0,
    system: `You turn each lead's recorded journey into one plain sentence the company can show its client. You are given leads as L1, L2 and so on, with the facts already worked out. Answer with one JSON object: {"stories":[{"id":"L1","line":"one sentence"}]} with one entry per lead, using each id exactly as given. Say only what the facts say: when they arrived, how fast a person replied or that nobody did, any booking and how it ended. Never guess a reason and never blame a person. ${WORDS}`,
  },
  coach_note: {
    id: "coach_note", title: "Setter and closer coaching notes", status: "live", approval: "suggest", privacy: "aggregate", costClass: "large",
    output: { kind: "json", maxChars: 900, schema: { type: "object", props: { strengths: { type: "array", items: str(200), maxItems: 2 }, fix: str(260) } } },
    tools: [], maxTokens: 450, maxToolRounds: 0,
    system: `You write a short private coaching note for one team member, read by them and their manager. You are given the person's own figures next to the middle figure of their own team. Answer with one JSON object: {"strengths": up to 2 things that are going well (only where the person is at or ahead of the team middle), "fix": ONE specific thing to work on this month, with one concrete step}. Be neutral and kind. Never rank or compare the person with a named colleague, never say best, worst or bottom, never judge character. If a figure is missing, do not mention it. ${WORDS}`,
  },
  anomaly_explain: {
    id: "anomaly_explain", title: "Why did this number move?", status: "live", approval: "suggest", privacy: "aggregate", costClass: "large",
    output: { kind: "json", maxChars: 1400, schema: { type: "object", props: { summary: str(220), reasons: { type: "array", maxItems: 4, items: { type: "object", props: { reason: str(210), check: str(210) } } } } } },
    tools: [], maxTokens: 600, maxToolRounds: 0,
    system: `A number for one client account moved outside its own normal range (found by our code). You are given the movement and some context facts. Answer with one JSON object: {"summary": one sentence on what moved, "reasons": up to 4 possible reasons, each {"reason": a possibility drawn only from the context facts, written as 'could be' or 'may be', "check": one thing to look at in the CRM to confirm or rule it out}}. These are candidates, not conclusions. ${WORDS}`,
  },
  meeting_summary: {
    id: "meeting_summary", title: "Meeting summary and follow-up draft", status: "live", approval: "suggest", privacy: "names_optin", costClass: "small",
    output: { kind: "json", maxChars: 1500, schema: { type: "object", props: { summary: str(240), followUp: str(800) } } },
    tools: [], maxTokens: 600, maxToolRounds: 0,
    system: `You are given the summary and action items a meeting tool wrote for one recorded call. Answer with one JSON object: {"summary": one plain sentence, "followUp": a short, friendly follow-up message the person could send afterwards, using only what the call said, ending with the agreed next step if there was one}. The follow-up is a draft for the person to read and send themselves. Never claim anything was agreed that the summary does not say. ${WORDS}`,
  },
  one_thing: {
    id: "one_thing", title: "Weekly one thing to fix", status: "live", approval: "suggest", privacy: "aggregate", costClass: "small",
    output: { kind: "text", maxChars: 420 }, tools: [], maxTokens: 220, maxToolRounds: 0,
    system: `You write the single most important thing to fix this week for one client account, in 1 or 2 sentences. You are given the top item (already chosen by our code, with its count and any dollar figure) and some other items for context. Say what it is, what it is worth if a dollar figure is given, and the first step to take. Mention only the top item. ${WORDS}`,
  },
};
