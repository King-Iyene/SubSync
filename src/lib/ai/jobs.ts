import type { Schema } from "./safety";

// The job registry: every AI job is one entry here. The gateway (gateway.ts) runs any live entry the same way: kill switches, the customer's spend cap, rate limit, idempotency,
// tool whitelist, post-check and the run log. To add a job: add an entry, write its input builder (a pure function that builds the prompt from that tenant's own rows) and its
// golden tests, and flip `status` to "live". The planned entries below are NOT built; their full specification is in docs/AI_JOBS_SPEC.md.

export const JOB_IDS = ["brief", "data_review", "data_clean", "ask_data", "dup_adjudicate", "setup_audit"] as const;
export type JobId = (typeof JOB_IDS)[number];
export const isJobId = (v: unknown): v is JobId => (JOB_IDS as readonly unknown[]).includes(v);

export type JobDef = {
  id: JobId;
  /** What a person reads in Settings. */
  title: string;
  status: "live" | "planned";
  /** suggest: the person only reads it. approve: a change is applied only after preview, typed confirmation and undo, through the existing safe tools. auto: never offered today. */
  approval: "suggest" | "approve" | "auto";
  /** aggregate: counts and dollars only. names_optin: may also carry names, emails, phones or message text, only after the account's own opt-in. */
  privacy: "aggregate" | "names_optin";
  /** small: short lines, a small model is enough. large: narrative or reasoning. Used for the cost hint only. */
  costClass: "small" | "large";
  output: { kind: "text"; maxChars: number } | { kind: "json"; schema: Schema; maxChars: number };
  /** Names from the read-only tool whitelist (tools.ts) this job may use. Empty for a job that is only given numbers. */
  tools: readonly string[];
  maxTokens: number;
  maxToolRounds: number;
  system: string;
};

const WORDS_RULES = [
  "Rules: use plain words a busy business owner understands, no jargon, no markdown, no lists, no emoji.",
  "Use ONLY the figures in the data. Copy each figure exactly as written. Never calculate, round, add up or invent a figure, and never write a time of day or a year.",
  "Money is an estimate: say 'about' or 'an estimate' when you mention dollars.",
  "Suggest what to do first. Never say anything was sent, fixed or changed, and never promise a result.",
  "Never mention how you work or that you are an AI.",
].join(" ");

export const JOBS: Record<JobId, JobDef> = {
  brief: {
    id: "brief", title: "7 am brief wording", status: "live", approval: "suggest", privacy: "names_optin", costClass: "small",
    output: { kind: "text", maxChars: 900 }, tools: [], maxTokens: 400, maxToolRounds: 0,
    system: `You write the short note at the top of a business owner's morning brief. You are given the numbers already worked out. Write 2 to 4 sentences. Money first (the estimated revenue at risk), then who or what has been waiting, then the one thing to do first. ${WORDS_RULES}`,
  },
  data_review: { id: "data_review", title: "Data review", status: "planned", approval: "suggest", privacy: "names_optin", costClass: "large", output: { kind: "json", schema: { type: "object", props: {} }, maxChars: 4000 }, tools: [], maxTokens: 1200, maxToolRounds: 6, system: "" },
  data_clean: { id: "data_clean", title: "Data cleaning proposals", status: "planned", approval: "approve", privacy: "names_optin", costClass: "small", output: { kind: "json", schema: { type: "object", props: {} }, maxChars: 4000 }, tools: [], maxTokens: 1200, maxToolRounds: 4, system: "" },
  ask_data: { id: "ask_data", title: "Ask your data", status: "planned", approval: "suggest", privacy: "names_optin", costClass: "large", output: { kind: "json", schema: { type: "object", props: {} }, maxChars: 3000 }, tools: [], maxTokens: 1200, maxToolRounds: 6, system: "" },
  dup_adjudicate: { id: "dup_adjudicate", title: "Duplicate adjudication", status: "planned", approval: "approve", privacy: "names_optin", costClass: "large", output: { kind: "json", schema: { type: "object", props: {} }, maxChars: 2000 }, tools: [], maxTokens: 600, maxToolRounds: 2, system: "" },
  setup_audit: { id: "setup_audit", title: "Setup auditor", status: "planned", approval: "suggest", privacy: "aggregate", costClass: "large", output: { kind: "json", schema: { type: "object", props: {} }, maxChars: 4000 }, tools: [], maxTokens: 1200, maxToolRounds: 6, system: "" },
};

export const liveJobs = (): JobDef[] => Object.values(JOBS).filter((j) => j.status === "live");
