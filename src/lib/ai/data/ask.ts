import { runJob, type Deps, type JobResult, type Refusal } from "../gateway";
import type { AiTool, Tenant } from "../tools";
import { citationHolds, DATA_TOOLS, windowOf } from "./ask-tools";

// Ask your data (docs/AI_JOBS_SPEC.md 3). The model may only call the read-only tools in ask-tools.ts; the server decides the tenant and the date window; the answer is shown only when
//   1. the gateway's number check passed (every figure was in a tool result), 2. every citation is an address a tool returned in this very run (or, for an answer remembered from an earlier
//   identical question, still holds when the tool is run again) and its count equals the rows behind it, 3. an answer that is not "cannot answer" has at least one citation.
// Names are real only when the account opted in; otherwise the model saw aliases and the server swaps the real names back here, for display only.

export const MAX_QUESTION = 300;
export type Citation = { label: string; value: string; rowsHash: string; rowCount: number };
export type AskAnswer = { answer: string; citations: Citation[]; cannotAnswer: boolean };
export type AskResult =
  | { ok: true; runId: string; cached: boolean; answer: AskAnswer; window: string; costUsd: number; tools: string[] }
  | { ok: false; code: Refusal | "question" | "unverified"; message: string };

export type AskArgs = {
  /** The verified tenant from the session: never from the request. `range` is the date bar; names/aliases are filled here. */
  tenant: Tenant;
  userKey: string | null;
  question: string;
  deps: Deps;
  registry?: Record<string, AiTool>;
  /** Re-checks a citation of a remembered answer. Defaults to running the tool again. */
  verify?: (tenant: Tenant, address: string, rowCount: number) => Promise<boolean>;
  now?: () => number;
  /** True for Slack: names never go to the AI, whatever the account allowed, because the person asking is not matched to an app role. */
  anonymous?: boolean;
};

export const cleanQuestion = (q: unknown): string => (typeof q === "string" ? q.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION) : "");

const restoreNames = (s: string, aliases: Map<string, string>) => { let out = s; for (const [alias, real] of aliases) out = out.split(alias).join(real); return out; };

export async function askData(a: AskArgs): Promise<AskResult> {
  const question = cleanQuestion(a.question);
  if (question.length < 3) return { ok: false, code: "question", message: "Type a question about your leads, replies, appointments, deals or data." };
  const now = (a.now ?? Date.now)();
  // Names go to the model only when the account's own connection allows it (the gateway enforces this again).
  let shareNames = false;
  for (const scope of a.anonymous ? [] : a.tenant.locationId ? [a.tenant.locationId, ""] : [""]) { const c = await a.deps.store.connection(a.tenant.installationId, scope); if (c) { shareNames = c.shareNames; break; } }
  const aliases = new Map<string, string>();
  const tenant: Tenant = { ...a.tenant, shareNames, aliases };
  const w = windowOf(tenant, now);
  const hour = new Date(now).toISOString().slice(0, 13);
  const text = [
    `Question: ${question}`,
    `Date bar window: ${w.label}`,
    `Who is asking about: ${tenant.locationId ? "one client account" : "all the client accounts they can see"}`,
    `Data as of (hour): ${hour}`,
  ].join("\n");

  // Record what the tools return in this run, so a citation can be matched to a real tool result.
  const seen: Array<{ name: string; rowsHash: string | null; rowCount: number | null }> = [];
  const base = a.registry ?? DATA_TOOLS;
  const recording: Record<string, AiTool> = Object.fromEntries(Object.entries(base).map(([name, tool]) => [name, {
    ...tool,
    run: async (t: Tenant, args: Record<string, unknown>) => { const r = await tool.run(t, args); seen.push({ name, rowsHash: r.rowsHash, rowCount: r.rowCount }); return r; },
  } satisfies AiTool]));

  const r: JobResult = await runJob({ ...a.deps, tools: recording }, {
    installationId: tenant.installationId, locationId: tenant.locationId ?? "", userKey: a.userKey, job: "ask_data", trigger: "ask", tenant,
    input: { text, fields: ["your question", "the date window", "whether you asked about one account or all", "the totals our tools return (counts, minutes, dollars; names only if your account allows it)"], includesNames: shareNames },
  });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  const j = r.json as { answer?: unknown; citations?: unknown; cannotAnswer?: unknown } | null;
  if (!j || typeof j.answer !== "string" || !Array.isArray(j.citations) || typeof j.cannotAnswer !== "boolean") return { ok: false, code: "unverified", message: "The answer was not in a form we could check, so it was not shown." };
  const verify = a.verify ?? citationHolds;
  const good: Citation[] = [];
  for (const c of j.citations as Array<Record<string, unknown>>) {
    if (typeof c?.rowsHash !== "string" || typeof c.rowCount !== "number" || typeof c.label !== "string" || typeof c.value !== "string") continue;
    // This run called the tool and got exactly this address and count; an answer remembered from an earlier identical question is checked by running the tool again.
    const fromRun = seen.some((s) => s.rowsHash === c.rowsHash && s.rowCount === c.rowCount);
    const holds = fromRun || (r.cached && seen.length === 0 && (await verify(tenant, c.rowsHash, c.rowCount).catch(() => false)));
    if (holds && !good.some((g) => g.rowsHash === c.rowsHash)) good.push({ label: restoreNames(c.label, aliases), value: c.value, rowsHash: c.rowsHash, rowCount: c.rowCount });
  }
  if (j.cannotAnswer) return { ok: true, runId: r.runId, cached: r.cached, answer: { answer: restoreNames(j.answer, aliases), citations: [], cannotAnswer: true }, window: w.label, costUsd: r.costUsd, tools: [...new Set(seen.map((s) => s.name))] };
  if (good.length === 0) return { ok: false, code: "unverified", message: "We could not match the answer to your rows, so it was not shown. Try asking it another way." };
  return { ok: true, runId: r.runId, cached: r.cached, answer: { answer: restoreNames(j.answer, aliases), citations: good, cannotAnswer: false }, window: w.label, costUsd: r.costUsd, tools: [...new Set(seen.map((s) => s.name))] };
}
