import type { ToolSpec } from "./providers";

// The WHITELIST of tools a model may call. Extension point for the next jobs (data review, ask-your-data; docs/AI_JOBS_SPEC.md). Rules, all enforced by `runTool`:
//   - a tool is one of OUR read-only analytics functions with a fixed argument schema; there is never raw SQL and never a write;
//   - a tool receives only the tenant (company and, for an account connection, that one account) taken from the verified session by the caller: the model cannot name a company or an account;
//   - arguments are checked against the tool's own validator before anything runs, and results are capped in size;
//   - every call is counted on the run (and written to the audit log by the caller) with the tool name and argument keys, never the values;
//   - a result carries the numbers and a `rows` link (the exact list in the app), so an answer can cite its numbers and open the rows; a count must equal the number of rows it opens.
// No tool is registered yet: this PR ships the platform and the 7 am brief writer. A job that lists tool names its registry does not hold is refused.

export type Tenant = {
  installationId: string; /** Null means the whole company; a string means that one client account only. */ locationId: string | null;
  /** The client accounts this person may see when the company view is limited (agency staff). Null: all of the company's. Set by the server from the verified session. */
  allowed?: string[] | null;
  /** The date bar's window (days, inclusive, in the app's one time zone: docs/DATE_RULES.md). Set by the server from the request; the model cannot pick dates. */
  range?: { from: string; to: string };
  /** Names (accounts, team members) go to the model only after the account's own opt-in; otherwise tools use stable aliases and the server swaps the real names back for display. */
  shareNames?: boolean;
  /** alias -> real name, filled by tools as they alias; used by the caller to restore names in the answer shown to the person. */
  aliases?: Map<string, string>;
};
export type ToolResult = {
  /** Plain numbers and short rows the model may quote. */
  data: unknown;
  /** The hash address of the exact list in the app, so the person can open the rows behind the numbers. */
  rowsHash: string | null;
  /** Total rows behind the numbers; must equal the rows that list opens. */
  rowCount: number | null;
};
export type AiTool = {
  spec: ToolSpec;
  /** Checks the arguments the model sent. Returns the cleaned arguments or an error in words (sent back to the model, never to the person). */
  parse(args: Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; error: string };
  run(tenant: Tenant, args: Record<string, unknown>): Promise<ToolResult>;
};

/** Empty on purpose: the first tools arrive with the jobs that need them. */
export const READ_TOOLS: Record<string, AiTool> = {};

export const MAX_RESULT_CHARS = 6_000;

export type ToolOutcome = { content: string; ok: boolean; name: string; rowsHash: string | null; rowCount: number | null };

/** Runs one tool call the model asked for. Anything not on the job's whitelist, or not in the registry, is refused. */
export async function runTool(registry: Record<string, AiTool>, allowed: readonly string[], tenant: Tenant, call: { name: string; args: Record<string, unknown> }): Promise<ToolOutcome> {
  const refuse = (why: string): ToolOutcome => ({ content: JSON.stringify({ error: why }), ok: false, name: call.name, rowsHash: null, rowCount: null });
  if (!allowed.includes(call.name) || !Object.prototype.hasOwnProperty.call(registry, call.name)) return refuse("That tool is not available.");
  const tool = registry[call.name];
  const parsed = tool.parse(call.args);
  if (!parsed.ok) return refuse(parsed.error);
  try {
    const r = await tool.run({ installationId: tenant.installationId, locationId: tenant.locationId, allowed: tenant.allowed, range: tenant.range, shareNames: tenant.shareNames, aliases: tenant.aliases }, parsed.args);
    const content = JSON.stringify({ data: r.data, rowCount: r.rowCount }).slice(0, MAX_RESULT_CHARS);
    return { content, ok: true, name: call.name, rowsHash: r.rowsHash, rowCount: r.rowCount };
  } catch {
    return refuse("That tool could not run.");
  }
}
