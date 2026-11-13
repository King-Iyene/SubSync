import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import type { AiStore, Conn, RunRow } from "./gateway";
import { chatgptKeys, refreshChatgpt } from "./oauth";
import { isProvider, type Method, type ProviderId } from "./providers";
import { JOB_IDS } from "./jobs";

// The database side of bring-your-own-AI. EVERY statement names the installation and the scope (the company's own is '', a client account's is its location id), so one tenant's
// connection, key and runs are never readable through another's. The key is encrypted at rest and only `connection()` (server code) ever decrypts it; the browser gets `publicConnection()`,
// which holds the last four characters and nothing else secret. Prompts and outputs are stored encrypted, never in clear.

const monthStartDate = (now: number) => { const d = new Date(now); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
const methodOf = (v: unknown): Method => (v === "openrouter" || v === "chatgpt" ? v : "key");
const jobsOf =(v: unknown): Record<string, boolean> => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(JOB_IDS.map((j) => [j, o[j] === true]));
};

export const dbStore: AiStore = {
  async connection(inst, scope) {
    const [r] = await sql()`select provider, method, base_url, key_enc, refresh_enc, token_expires_at, model, status, monthly_cap_usd, paused, share_names, jobs from ai_connections where installation_id = ${inst} and location_id = ${scope}`;
    if (!r || !isProvider(r.provider)) return null;
    let apiKey: string;
    try { apiKey = decryptSecret(r.key_enc as string); } catch { return null; }
    const method = methodOf(r.method);
    // ChatGPT plan sign-in (not live): the short-lived access token is refreshed just before it ends. The refresh only replaces the row it read, so two runs cannot break the chain.
    if (method === "chatgpt" && r.refresh_enc && r.token_expires_at && (r.token_expires_at as Date).getTime() - Date.now() < 60_000) {
      const keys = chatgptKeys();
      if (!keys) return null;
      try {
        const old = r.refresh_enc as string, t = await refreshChatgpt(keys, decryptSecret(old), (url, init) => fetch(url, init as RequestInit) as never);
        const won = await sql()`update ai_connections set key_enc = ${encryptSecret(t.accessToken)}, key_last4 = ${t.accessToken.slice(-4)}, refresh_enc = ${t.refreshToken ? encryptSecret(t.refreshToken) : null}, token_expires_at = ${new Date(t.expiresAt)}, updated_at = now()
          where installation_id = ${inst} and location_id = ${scope} and refresh_enc = ${old} returning 1`;
        if (won.length) apiKey = t.accessToken; else return dbStore.connection(inst, scope);
      } catch { await dbStore.markNeedsAttention(inst, scope); return null; }
    }
    return { scope, method, provider: r.provider, baseUrl: (r.base_url as string | null) ?? null, apiKey, model: r.model as string, status: r.status === "needs_attention" ? "needs_attention" : "connected",
      monthlyCapUsd: Number(r.monthly_cap_usd), paused: r.paused === true, shareNames: r.share_names === true, jobs: jobsOf(r.jobs) } satisfies Conn;
  },
  async cachedRun(inst, scope, key) {
    const [r] = await sql()`select id, output_enc from ai_runs where installation_id = ${inst} and location_id = ${scope} and idempotency_key = ${key} and status = 'ok' and output_enc is not null order by created_at desc limit 1`;
    if (!r) return null;
    try { return { id: r.id as string, output: decryptSecret(r.output_enc as string) }; } catch { return null; }
  },
  async monthSpendUsd(inst, scope, now) {
    const [r] = await sql()`select coalesce(sum(est_cost_usd), 0)::float8 s from ai_runs where installation_id = ${inst} and location_id = ${scope} and created_at >= ${monthStartDate(now)}`;
    return Number(r?.s ?? 0);
  },
  async runsSince(inst, scope, sinceMs) {
    const [r] = await sql()`select count(*)::int n from ai_runs where installation_id = ${inst} and location_id = ${scope} and created_at >= ${new Date(sinceMs)}`;
    return Number(r?.n ?? 0);
  },
  async insertRun(x: RunRow) {
    const [r] = await sql()`
      insert into ai_runs (installation_id, location_id, user_key, job, trigger, method, provider, model, idempotency_key, input_hash, tokens_in, tokens_out, est_cost_usd, status, reason, sent_fields, includes_names, prompt_enc, output_enc, tool_calls)
      values (${x.installationId}, ${x.scope}, ${x.userKey}, ${x.job}, ${x.trigger}, ${x.method}, ${x.provider}, ${x.model}, ${x.idempotencyKey}, ${x.inputHash}, ${x.tokensIn}, ${x.tokensOut}, ${x.costUsd}, ${x.status}, ${x.reason}, ${x.sentFields}, ${x.includesNames},
        ${encryptSecret(x.prompt)}, ${x.output === null ? null : encryptSecret(x.output)}, ${x.toolCalls}) returning id`;
    return r.id as string;
  },
  async markNeedsAttention(inst, scope) {
    await sql()`update ai_connections set status = 'needs_attention', updated_at = now() where installation_id = ${inst} and location_id = ${scope}`;
  },
};

// ---------------- what the screens may see ----------------

export type PublicConnection = { method: Method; provider: ProviderId; baseUrl: string | null; model: string; last4: string; status: "connected" | "needs_attention"; capUsd: number; paused: boolean; shareNames: boolean; jobs: Record<string, boolean>; connectedAt: string };

export async function publicConnection(inst: string, scope: string): Promise<PublicConnection | null> {
  const [r] = await sql()`select provider, method, base_url, model, key_last4, status, monthly_cap_usd, paused, share_names, jobs, created_at from ai_connections where installation_id = ${inst} and location_id = ${scope}`;
  if (!r || !isProvider(r.provider)) return null;
  return { method: methodOf(r.method), provider: r.provider, baseUrl: (r.base_url as string | null) ?? null, model: r.model as string, last4: r.key_last4 as string, status: r.status === "needs_attention" ? "needs_attention" : "connected",
    capUsd: Number(r.monthly_cap_usd), paused: r.paused === true, shareNames: r.share_names === true, jobs: jobsOf(r.jobs), connectedAt: (r.created_at as Date).toISOString() };
}

/** Connects (or replaces the key of) a scope. The key is encrypted here and never stored or returned in clear. */
export async function saveConnection(inst: string, scope: string, v: { provider: ProviderId; method?: Method; baseUrl: string | null; apiKey: string; refreshToken?: string | null; expiresAt?: number | null; model: string; by: string | null }): Promise<void> {
  const last4 = v.apiKey.slice(-4), method = v.method ?? "key";
  await sql().begin(async (tx) => {
    await tx`
      insert into ai_connections (installation_id, location_id, provider, method, base_url, key_enc, key_last4, refresh_enc, token_expires_at, model, status, created_by)
      values (${inst}, ${scope}, ${v.provider}, ${method}, ${v.baseUrl}, ${encryptSecret(v.apiKey)}, ${last4}, ${v.refreshToken ? encryptSecret(v.refreshToken) : null}, ${v.expiresAt ? new Date(v.expiresAt) : null}, ${v.model}, 'connected', ${v.by})
      on conflict (installation_id, location_id) do update set provider = excluded.provider, method = excluded.method, base_url = excluded.base_url, key_enc = excluded.key_enc, key_last4 = excluded.key_last4,
        refresh_enc = excluded.refresh_enc, token_expires_at = excluded.token_expires_at, model = excluded.model, status = 'connected', updated_at = now()`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${v.by ?? "system"}, 'ai.connected', ${tx.json({ scope: scope || "company", provider: v.provider, method } as never)})`;
  });
}

export type SettingsPatch = { model?: string; capUsd?: number; paused?: boolean; shareNames?: boolean; jobs?: Record<string, boolean> };
export async function updateSettings(inst: string, scope: string, p: SettingsPatch, by: string | null): Promise<boolean> {
  const cur = await publicConnection(inst, scope);
  if (!cur) return false;
  const jobs = { ...cur.jobs, ...Object.fromEntries(Object.entries(p.jobs ?? {}).filter(([k]) => (JOB_IDS as readonly string[]).includes(k)).map(([k, v]) => [k, v === true])) };
  await sql().begin(async (tx) => {
    await tx`update ai_connections set model = ${p.model ?? cur.model}, monthly_cap_usd = ${p.capUsd ?? cur.capUsd}, paused = ${p.paused ?? cur.paused}, share_names = ${p.shareNames ?? cur.shareNames}, jobs = ${tx.json(jobs as never)}, updated_at = now()
      where installation_id = ${inst} and location_id = ${scope}`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${by ?? "system"}, 'ai.settings', ${tx.json({ scope: scope || "company", paused: p.paused ?? null, shareNames: p.shareNames ?? null, capUsd: p.capUsd ?? null } as never)})`;
  });
  return true;
}

/** Disconnect deletes the key. The run log (counts and cost) stays so the month's spend is still honest. */
export async function deleteConnection(inst: string, scope: string, by: string | null): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`delete from ai_connections where installation_id = ${inst} and location_id = ${scope}`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${by ?? "system"}, 'ai.disconnected', ${tx.json({ scope: scope || "company" } as never)})`;
  });
}

export type Usage = { runs: number; ok: number; rejected: number; errors: number; spendUsd: number; byJob: Record<string, { runs: number; spendUsd: number }>; lastErrors: Array<{ at: string; job: string; reason: string }>; thumbs: { up: number; down: number } };

/** This month's numbers for one scope: counts, estimated cost and the last few failures in words. Never any prompt or output. */
export async function usage(inst: string, scope: string, now = Date.now()): Promise<Usage> {
  const from = monthStartDate(now);
  const rows = await sql()`select job, status, count(*)::int n, coalesce(sum(est_cost_usd), 0)::float8 s, count(*) filter (where feedback = 1)::int up, count(*) filter (where feedback = -1)::int down
    from ai_runs where installation_id = ${inst} and location_id = ${scope} and created_at >= ${from} group by job, status`;
  const u: Usage = { runs: 0, ok: 0, rejected: 0, errors: 0, spendUsd: 0, byJob: {}, lastErrors: [], thumbs: { up: 0, down: 0 } };
  for (const r of rows) {
    const n = Number(r.n), s = Number(r.s), j = (u.byJob[r.job as string] ??= { runs: 0, spendUsd: 0 });
    u.runs += n; u.spendUsd += s; j.runs += n; j.spendUsd += s; u.thumbs.up += Number(r.up); u.thumbs.down += Number(r.down);
    if (r.status === "ok") u.ok += n; else if (r.status === "rejected") u.rejected += n; else u.errors += n;
  }
  const errs = await sql()`select created_at, job, reason from ai_runs where installation_id = ${inst} and location_id = ${scope} and status <> 'ok' and created_at >= ${from} order by created_at desc limit 5`;
  u.lastErrors = errs.map((e) => ({ at: (e.created_at as Date).toISOString(), job: e.job as string, reason: (e.reason as string | null) ?? "The run did not work." }));
  return u;
}

/** One person's own run history (their questions and the answers they got). Another person's runs are never returned. */
export async function historyFor(inst: string, scope: string, user: string, limit = 20): Promise<Array<{ id: string; job: string; at: string; status: string; feedback: number | null; text: string | null }>> {
  const rows = await sql()`select id, job, created_at, status, feedback, output_enc from ai_runs where installation_id = ${inst} and location_id = ${scope} and user_key = ${user} order by created_at desc limit ${Math.min(50, limit)}`;
  return rows.map((r) => {
    let text: string | null = null;
    try { text = r.output_enc ? decryptSecret(r.output_enc as string) : null; } catch { text = null; }
    return { id: r.id as string, job: r.job as string, at: (r.created_at as Date).toISOString(), status: r.status as string, feedback: (r.feedback as number | null) ?? null, text };
  });
}

/** "What was sent to your AI" for one run: the exact fields, whether names were included and the exact text. Only for a run of this scope. */
export async function sentFor(inst: string, scope: string, runId: string): Promise<{ fields: string[]; includesNames: boolean; text: string; at: string } | null> {
  const [r] = await sql()`select sent_fields, includes_names, prompt_enc, created_at from ai_runs where installation_id = ${inst} and location_id = ${scope} and id = ${runId}::uuid and prompt_enc is not null`;
  if (!r) return null;
  try { return { fields: r.sent_fields as string[], includesNames: r.includes_names === true, text: decryptSecret(r.prompt_enc as string), at: (r.created_at as Date).toISOString() }; } catch { return null; }
}

/** The thumbs up or down on one run of this scope. */
export async function setFeedback(inst: string, scope: string, runId: string, value: 1 | -1): Promise<boolean> {
  const r = await sql()`update ai_runs set feedback = ${value} where installation_id = ${inst} and location_id = ${scope} and id = ${runId}::uuid returning 1`;
  return r.length > 0;
}


// ---------------- a sign-in in progress (OpenRouter and ChatGPT) ----------------

const PENDING_MINUTES = 10;
/** Remembers one sign-in for ten minutes: the single-use state, who started it (from the verified session) and the secret PKCE verifier, encrypted. */
export async function startPending(p: { state: string; installationId: string; scope: string; userKey: string; method: "openrouter" | "chatgpt"; verifier: string }): Promise<void> {
  await sql()`delete from ai_oauth_pending where expires_at < now()`;
  await sql()`insert into ai_oauth_pending (state, installation_id, location_id, user_key, method, verifier_enc, expires_at)
    values (${p.state}, ${p.installationId}, ${p.scope}, ${p.userKey}, ${p.method}, ${encryptSecret(p.verifier)}, now() + ${PENDING_MINUTES + " minutes"}::interval)`;
}
/** Takes the sign-in back exactly once: it is deleted as it is read, so a state can never be used twice. Null when it is unknown or expired. */
export async function takePending(state: string): Promise<{ installationId: string; scope: string; userKey: string; method: "openrouter" | "chatgpt"; verifier: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) return null;
  const [r] = await sql()`delete from ai_oauth_pending where state = ${state} and expires_at > now() returning installation_id, location_id, user_key, method, verifier_enc`;
  if (!r) return null;
  try { return { installationId: r.installation_id as string, scope: r.location_id as string, userKey: r.user_key as string, method: r.method as "openrouter" | "chatgpt", verifier: decryptSecret(r.verifier_enc as string) }; } catch { return null; }
}
