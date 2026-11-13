import { createHash } from "node:crypto";
import { AiError, complete, estimateCostUsd, type Cfg, type Fetch, type Method, type Msg, type ProviderId, type Reply } from "./providers";
import { JOBS, type JobId } from "./jobs";
import { checkWords, parseJsonAnswer, stringsOf, validateJson, type Verdict } from "./safety";
import { runTool, READ_TOOLS, type AiTool, type Tenant } from "./tools";

// The one server-side door to the customer's own AI provider. Every job goes through `runJob`; nothing else calls a provider. Before a call it checks, in order: the global kill switch,
// that the job is live, that the account has a connection with this job switched on and not paused, that the key still works, the idempotency cache (the same input is never paid for
// twice), the customer's monthly spend cap and a per-account rate limit. After the call it runs the post-check (safety.ts) and writes one run row. Prompts and outputs are stored only
// encrypted (the store does that). The key never leaves this file's `store.connection()` result and is never logged or returned.

export type Conn = {
  scope: string; method: Method; provider: ProviderId; baseUrl: string | null; apiKey: string; model: string; status: "connected" | "needs_attention";
  monthlyCapUsd: number; paused: boolean; shareNames: boolean; jobs: Record<string, boolean>;
};
export type RunRow = {
  installationId: string; scope: string; userKey: string | null; job: JobId; trigger: string; method: Method; provider: ProviderId; model: string; idempotencyKey: string; inputHash: string;
  tokensIn: number; tokensOut: number; costUsd: number; status: "ok" | "rejected" | "error"; reason: string | null; sentFields: string[]; includesNames: boolean;
  prompt: string; output: string | null; toolCalls: number;
};
export interface AiStore {
  /** The connection for this exact scope ('' is the company's own), key decrypted. */
  connection(installationId: string, scope: string): Promise<Conn | null>;
  cachedRun(installationId: string, scope: string, key: string): Promise<{ id: string; output: string } | null>;
  monthSpendUsd(installationId: string, scope: string, now: number): Promise<number>;
  runsSince(installationId: string, scope: string, sinceMs: number): Promise<number>;
  insertRun(row: RunRow): Promise<string>;
  markNeedsAttention(installationId: string, scope: string): Promise<void>;
}
export type Deps = { store: AiStore; fetch: Fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; killAll?: () => boolean; tools?: Record<string, AiTool> };

export type JobRequest = {
  installationId: string;
  /** The client account the note is about ('' for the whole company). The account's own connection is used first, then the company's. */
  locationId: string;
  userKey: string | null;
  job: JobId;
  trigger: "scheduled" | "preview" | "view" | "ask";
  /** Exactly what is sent to the model as the user message, built on the server from this tenant's own rows. */
  input: { text: string; fields: string[]; includesNames: boolean };
  /** A preview always makes a fresh call; everything else reuses an earlier answer for the same input. */
  fresh?: boolean;
  /** A tool-using job passes the verified tenant; the model can never choose it. */
  tenant?: Tenant;
};
export type Refusal = "unknown_job" | "planned" | "killed" | "no_connection" | "job_off" | "paused" | "needs_attention" | "cap" | "rate" | "rejected" | "error";
export type JobResult =
  | { ok: true; runId: string; text: string; json: unknown | null; cached: boolean; tokensIn: number; tokensOut: number; costUsd: number; scope: string; model: string; provider: ProviderId }
  | { ok: false; code: Refusal; message: string };

export const RATE_PER_MINUTE = 10;
export const MAX_ATTEMPTS = 3;
const MESSAGE: Record<Refusal, string> = {
  unknown_job: "That job does not exist.", planned: "That job is not built yet.", killed: "AI wording is switched off for everyone right now.", no_connection: "Connect your AI account first.",
  job_off: "This job is switched off for your account.", paused: "AI is paused for your account.", needs_attention: "Your AI key needs attention. Replace it to continue.",
  cap: "Your monthly AI spend limit is reached, so AI is paused until next month or until you raise the limit.", rate: "Too many AI runs in a minute. Try again shortly.", rejected: "The AI answer did not pass our checks, so it was not shown.", error: "The AI run did not work.",
};
const refuse = (code: Refusal, message?: string): JobResult => ({ ok: false, code, message: message ?? MESSAGE[code] });
/** The numeric VALUES of a JSON answer (numbers written inside strings, like "$4,000", are checked as part of the text instead). */
const jsonNumbers = (v: unknown): number[] => (typeof v === "number" ? [v] : Array.isArray(v) ? v.flatMap(jsonNumbers) : v && typeof v === "object" ? Object.values(v).flatMap(jsonNumbers) : []);
export const hashInput = (s: string) => createHash("sha256").update(s).digest("hex");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const idempotencyKey = (installationId: string, scope: string, job: string, inputHash: string, nonce = "") => sha(`${installationId}|${scope}|${job}|${inputHash}|${nonce}`);
export const killedGlobally = () => process.env.AI_KILL_ALL === "true";

/** The month's spend starts on the 1st (UTC). */
export const monthStart = (now: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

export async function runJob(deps: Deps, req: JobRequest): Promise<JobResult> {
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const def = JOBS[req.job];
  if (!def) return refuse("unknown_job");
  if (def.status !== "live") return refuse("planned");
  if ((deps.killAll ?? killedGlobally)()) return refuse("killed");

  // The account's own connection first, then the company's. A client's key only ever receives that client's own data: the input is already built for `req.locationId`.
  let conn: Conn | null = null;
  for (const scope of req.locationId ? [req.locationId, ""] : [""]) { conn = await deps.store.connection(req.installationId, scope); if (conn) break; }
  if (!conn) return refuse("no_connection");
  if (conn.paused) return refuse("paused");
  if (conn.jobs[req.job] !== true) return refuse("job_off");
  if (conn.status !== "connected") return refuse("needs_attention");
  // Names, emails, phones and message text may only be sent after the account's own opt-in. A job that built such an input without it is refused here, not trusted.
  if (req.input.includesNames && !conn.shareNames) return refuse("rejected", "Names were not allowed for this account, so nothing was sent.");

  const inputHash = sha(req.input.text);
  const key = idempotencyKey(req.installationId, conn.scope, req.job, inputHash, req.fresh ? String(now()) : "");
  if (!req.fresh) {
    const hit = await deps.store.cachedRun(req.installationId, conn.scope, key);
    if (hit) return { ok: true, runId: hit.id, text: hit.output, json: def.output.kind === "json" ? parseJsonAnswer(hit.output) : null, cached: true, tokensIn: 0, tokensOut: 0, costUsd: 0, scope: conn.scope, model: conn.model, provider: conn.provider };
  }
  if ((await deps.store.monthSpendUsd(req.installationId, conn.scope, now())) >= conn.monthlyCapUsd) return refuse("cap");
  if ((await deps.store.runsSince(req.installationId, conn.scope, now() - 60_000)) >= RATE_PER_MINUTE) return refuse("rate");

  const cfg: Cfg = { provider: conn.provider, baseUrl: conn.baseUrl, apiKey: conn.apiKey, model: conn.model };
  const registry = deps.tools ?? READ_TOOLS;
  const specs = def.tools.filter((t) => Object.prototype.hasOwnProperty.call(registry, t)).map((t) => registry[t].spec);
  const messages: Msg[] = [{ role: "user", content: req.input.text }];
  let tokensIn = 0, tokensOut = 0, toolCalls = 0, seenText = req.input.text, final: Reply | null = null;
  const log = async (status: RunRow["status"], reason: string | null, output: string | null) => deps.store.insertRun({
    installationId: req.installationId, scope: conn.scope, userKey: req.userKey, job: req.job, trigger: req.trigger, method: conn.method, provider: conn.provider, model: conn.model, idempotencyKey: key, inputHash,
    tokensIn, tokensOut, costUsd: estimateCostUsd(conn.model, { tokensIn, tokensOut }), status, reason, sentFields: req.input.fields, includesNames: req.input.includesNames, prompt: `${def.system}\n\n${req.input.text}`, output, toolCalls,
  });
  try {
    for (let round = 0; round <= def.maxToolRounds; round++) {
      let reply: Reply | null = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !reply; attempt++) {
        try { reply = await complete(cfg, { system: def.system, messages, maxTokens: def.maxTokens, temperature: 0.2, tools: round < def.maxToolRounds && specs.length ? specs : undefined, json: def.output.kind === "json" }, deps.fetch); }
        catch (e) {
          if (!(e instanceof AiError) || e.permanent || attempt === MAX_ATTEMPTS - 1) throw e;
          await sleep(400 * 2 ** attempt);
        }
      }
      if (!reply) break;
      tokensIn += reply.usage.tokensIn; tokensOut += reply.usage.tokensOut;
      if (reply.toolCalls.length && round < def.maxToolRounds && req.tenant) {
        messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
        for (const c of reply.toolCalls.slice(0, 4)) {
          const o = await runTool(registry, def.tools, req.tenant, c);
          toolCalls++; seenText += `\n${o.content}`;
          messages.push({ role: "tool", toolCallId: c.id, name: c.name, content: o.content });
        }
        continue;
      }
      final = reply; break;
    }
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("unknown", true, false, MESSAGE.error);
    if (err.needsReconnect) await deps.store.markNeedsAttention(req.installationId, conn.scope);
    await log("error", err.message, null);
    return refuse("error", err.message);
  }
  if (!final) { await log("error", "The AI did not finish.", null); return refuse("error"); }

  // The post-check: only an output that passes is returned (and remembered for the same input).
  const text = final.text;
  let json: unknown | null = null, verdict: Verdict = { ok: true };
  if (def.output.kind === "json") {
    json = parseJsonAnswer(text);
    verdict = json === null ? { ok: false, reason: "The AI answer was not readable." } : validateJson(json, def.output.schema);
    if (verdict.ok) { const flat = `${stringsOf(json)} ${jsonNumbers(json).join(" ")}`; verdict = checkWords(seenText, flat, def.output.maxChars * 2); }
  } else verdict = checkWords(seenText, text, def.output.maxChars);
  if (!verdict.ok) { await log("rejected", verdict.reason, text.slice(0, 2000)); return refuse("rejected", verdict.reason); }
  const runId = await log("ok", null, text);
  return { ok: true, runId, text, json, cached: false, tokensIn, tokensOut, costUsd: estimateCostUsd(conn.model, { tokensIn, tokensOut }), scope: conn.scope, model: conn.model, provider: conn.provider };
}

