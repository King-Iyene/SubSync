"use client";

import { useEffect, useState } from "react";
import { InlineAlert } from "../ds";
import { TeamAiSettings } from "./ai-team/team-settings";
import { useApiClient, useData } from "../session";
import { Badge, Btn } from "../ui";

// Settings, Integrations: the AI connection and its usage panel. Bring your own AI: the customer connects their OWN AI account (OpenRouter sign-in, Sign in with ChatGPT when approved, or a pasted
// API key for Anthropic, OpenAI, Google Gemini or any OpenAI-compatible service). SubSync never pays for AI. The key is never shown again (last four characters only). Only an administrator sees this.

export type Conn = { method: "key" | "openrouter" | "chatgpt"; provider: string; baseUrl: string | null; model: string; last4: string; status: "connected" | "needs_attention"; capUsd: number; paused: boolean; shareNames: boolean; jobs: Record<string, boolean> };
type Usage = { runs: number; ok: number; rejected: number; errors: number; spendUsd: number; byJob: Record<string, { runs: number; spendUsd: number }>; lastErrors: Array<{ at: string; job: string; reason: string }>; thumbs: { up: number; down: number } };
export type Status = {
  canManage: boolean; level?: "company" | "account"; connection?: Conn | null; usage?: Usage; killed: boolean; flags: Record<string, boolean>;
  methods?: { key: boolean; openrouter: boolean; chatgpt: "off" | "coming" | "ready" };
  providers?: Array<{ id: string; name: string; steps: string; cost: string; keyHint: string }>; methodCost?: Record<string, string>;
  jobs?: Array<{ id: string; title: string }>; accountConnections?: number; note?: string;
};
type Sent = { fields: string[]; includesNames: boolean; text: string } | null;
type Preview = { ok: boolean; text?: string; error?: string; runId?: string; sent: Sent };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const DEAL_JOB_HELP: Record<string, string> = {
  deal_health: "In Pipeline, explains in plain words what is stuck or missing on one deal. The Health badge itself is worked out by rules.",
  deal_followup: "Suggests one next touch for your stuck deals. You choose which to add as an internal task, after a preview. Nothing is sent to a lead.",
  deal_winloss: "Plain-English patterns in your won and lost deals, once you have 15 closed deals.",
  deal_forecast: "Explains what could move your forecast. The forecast number comes from SubSync, never from the AI.",
};
const METHOD_NAME = { key: "your own API key", openrouter: "OpenRouter sign-in", chatgpt: "ChatGPT sign-in" } as const;

/** The page-level card (a client's staff page): fetches its own status and shows the heading and the plain intro. */
export function AiCard() {
  const { data, error, reload } = useData<Status>("ai?part=status");
  if (error || !data || !data.canManage) return null;
  return <AiPanel data={data} reload={reload} />;
}

/** The connection controls themselves. `bare` drops the heading and intro (the Your tools row already says what AI is for). */
export function AiPanel({ data, reload, bare = false }: { data: Status; reload: () => Promise<void>; bare?: boolean }) {
  const api = useApiClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [waiting, setWaiting] = useState(false);

  // The sign-in window tells this page when it is done.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !e.data || e.data.subsync !== "connection" || e.data.provider !== "ai") return;
      setWaiting(false); void reload();
      setMsg(e.data.ok ? { ok: true, text: "Your AI account is connected." } : { ok: false, text: "The sign-in did not finish. Nothing was changed." });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [reload]);

  const c = data.connection ?? null;
  const act = async (name: string, body?: unknown) => {
    setMsg(null);
    try { const r = await api.post<Record<string, unknown>>(`ai/act/${name}`, body); await reload(); return r; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return null; }
  };
  const start = async (method: "openrouter" | "chatgpt") => {
    const r = await act("start", { method });
    if (!r) return;
    const win = window.open(String(r.url), "subsync-connect", "width=560,height=720");
    if (!win) setMsg({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); else setWaiting(true);
  };

  return (
    <section className={bare ? "" : "mb-8"} data-testid="ai-card" aria-labelledby={bare ? undefined : "ai-h"}>
      {!bare && <>
        <h3 id="ai-h" className="text-sm font-semibold">AI <span className="font-normal text-muted-foreground">(optional, bring your own)</span></h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          AI can word your 7 am brief in plain English. SubSync works out every number itself; the AI only writes around them, and a check throws away any answer with a number we did not give it. It only suggests: it never messages a lead or changes your CRM.
          You connect your own AI account, so SubSync never pays for AI and you control the spend. {data.note}
        </p>
      </>}
      {bare && data.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
      {data.killed && <InlineAlert tone="warning">AI wording is switched off for everyone right now.</InlineAlert>}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      {c ? <Connected data={data} conn={c} act={act} /> : <Connect data={data} act={act} start={start} waiting={waiting} />}
      {data.usage && <UsagePanel usage={data.usage} conn={c} act={act} />}
      {c && <TeamAiSettings />}
    </section>
  );
}

type Act = (name: string, body?: unknown) => Promise<Record<string, unknown> | null>;

function Connect({ data, act, start, waiting }: { data: Status; act: Act; start: (m: "openrouter" | "chatgpt") => Promise<void>; waiting: boolean }) {
  const [provider, setProvider] = useState("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const info = data.providers?.find((p) => p.id === provider);
  const cost = data.methodCost ?? {};
  const test = async () => {
    setBusy(true);
    const r = await act("models", { provider, baseUrl, apiKey });
    setBusy(false);
    if (r) { const list = r.models as string[]; setModels(list); setModel((r.recommended as string | null) ?? list[0] ?? ""); }
  };
  const save = async () => { setBusy(true); const r = await act("connect", { provider, baseUrl, apiKey, model }); setBusy(false); if (r) { setApiKey(""); setModels(null); } };
  return (
    <div className="mt-3 space-y-4">
      <div>
        <h4 className="text-sm font-medium">Connect with OpenRouter</h4>
        <p className="text-xs text-muted-foreground">{cost.openrouter} One click: you approve on OpenRouter&apos;s own page.</p>
        <div className="mt-1"><Btn variant="primary" disabled={waiting} onClick={() => void start("openrouter")} testId="ai-openrouter">{waiting ? "Waiting for you..." : "Connect with OpenRouter"}</Btn></div>
      </div>
      <div>
        <h4 className="text-sm font-medium">Sign in with ChatGPT</h4>
        <p className="text-xs text-muted-foreground">{cost.chatgpt}</p>
        {data.methods?.chatgpt === "ready"
          ? <div className="mt-1"><Btn variant="secondary" onClick={() => void start("chatgpt")}>Sign in with ChatGPT</Btn></div>
          : <div className="mt-1"><Btn variant="secondary" disabled>Coming when OpenAI approves our app</Btn></div>}
      </div>
      <div>
        <h4 className="text-sm font-medium">Paste an API key</h4>
        <p className="text-xs text-muted-foreground">{cost.key}</p>
        <div className="mt-2 grid max-w-md gap-2">
          <label className="text-sm">Provider
            <select className="mt-1 block w-full rounded border bg-background p-2" value={provider} onChange={(e) => { setProvider(e.target.value); setModels(null); }} data-testid="ai-provider">
              {data.providers?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {info && <p className="text-xs text-muted-foreground">{info.steps} {info.cost}</p>}
          {provider === "compatible" && <label className="text-sm">Address (https)<input className="mt-1 block w-full rounded border bg-background p-2" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" /></label>}
          <label className="text-sm">API key<input className="mt-1 block w-full rounded border bg-background p-2" type="password" autoComplete="off" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setModels(null); }} placeholder={info?.keyHint} data-testid="ai-key" /></label>
          {!models ? <div><Btn variant="secondary" disabled={busy || apiKey.length < 8} onClick={() => void test()} testId="ai-test">{busy ? "Testing..." : "Test connection"}</Btn></div> : (
            <>
              <label className="text-sm">Model (from your provider&apos;s own list)
                <select className="mt-1 block w-full rounded border bg-background p-2" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </label>
              <div><Btn variant="primary" disabled={busy || !model} onClick={() => void save()} testId="ai-save">{busy ? "Saving..." : "Save connection"}</Btn></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Connected({ data, conn, act }: { data: Status; conn: Conn; act: Act }) {
  const [models, setModels] = useState<string[] | null>(null);
  const [cap, setCap] = useState(String(conn.capUsd));
  const [confirm, setConfirm] = useState("");
  const [rotate, setRotate] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const name = data.providers?.find((p) => p.id === conn.provider)?.name ?? conn.provider;
  const tone = conn.status === "connected" ? (conn.paused ? "warn" : "good") : "bad";
  const loadModels = async () => { const r = await act("models", { useSaved: true, provider: conn.provider }); if (r) setModels(r.models as string[]); };
  const runPreview = async () => { setBusy(true); const r = await act("preview", {}); setBusy(false); if (r) setPreview(r as unknown as Preview); };
  return (
    <div className="mt-3 space-y-3" data-testid="ai-connected">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={tone}>{conn.status !== "connected" ? "Needs attention" : conn.paused ? "Paused" : "Connected"}</Badge>
        <span className="font-medium">{name}</span><span className="text-muted-foreground">via {METHOD_NAME[conn.method]}, key ending {conn.last4}, model {conn.model}</span>
      </p>
      {conn.status !== "connected" && <p className="text-sm text-red-600">Your AI provider did not accept the key. Replace it below.</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Model
          {models ? <select className="mt-1 block rounded border bg-background p-2" value={conn.model} onChange={(e) => void act("update", { model: e.target.value })}>{models.includes(conn.model) ? null : <option>{conn.model}</option>}{models.map((m) => <option key={m}>{m}</option>)}</select>
            : <span className="mt-1 block"><Btn variant="secondary" onClick={() => void loadModels()}>Change model</Btn></span>}
        </label>
        <label className="text-sm">Monthly limit (US dollars)
          <input className="mt-1 block w-28 rounded border bg-background p-2" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => { if (Number(cap) !== conn.capUsd) void act("update", { capUsd: Number(cap) }); }} data-testid="ai-cap" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={conn.paused} onChange={(e) => void act("update", { paused: e.target.checked })} data-testid="ai-pause" /><span><b>Pause AI</b> (the kill switch). Nothing is sent to your AI provider while this is on.</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={conn.shareNames} onChange={(e) => void act("update", { shareNames: e.target.checked })} data-testid="ai-names" />
        <span><b>Also send names and reasons</b> (off by default). By default only counts and dollar estimates go to your AI provider. Switched on, client or person names that appear in your brief also go to your own provider, under their terms. SubSync never keeps them in clear.</span></label>
      {data.jobs?.map((j) => (
        <label key={j.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={conn.jobs[j.id] === true} onChange={(e) => void act("update", { jobs: { [j.id]: e.target.checked } })} /><span><b>{j.title}</b>{data.flags[j.id] === false ? " (not switched on for your account yet)" : ""}{DEAL_JOB_HELP[j.id] ? <span className="block text-xs text-muted-foreground">{DEAL_JOB_HELP[j.id]}</span> : null}</span></label>
      ))}
      <div className="flex flex-wrap gap-2">
        <Btn variant="secondary" disabled={busy || !data.flags.brief} onClick={() => void runPreview()} testId="ai-preview">{busy ? "Writing a sample..." : "Preview a sample"}</Btn>
        <Btn variant="secondary" onClick={() => setRotate(rotate === null ? "" : null)}>Replace key</Btn>
      </div>
      {rotate !== null && (
        <div className="flex max-w-md flex-wrap items-end gap-2">
          <label className="grow text-sm">New key<input className="mt-1 block w-full rounded border bg-background p-2" type="password" autoComplete="off" value={rotate} onChange={(e) => setRotate(e.target.value)} /></label>
          <Btn variant="primary" disabled={rotate.length < 8} onClick={() => void act("rotate", { apiKey: rotate }).then((r) => { if (r) setRotate(null); })}>Save new key</Btn>
        </div>
      )}
      {preview && <PreviewBox p={preview} act={act} />}
      <div className="flex max-w-md flex-wrap items-end gap-2 border-t pt-3">
        <label className="grow text-sm">Type <b>disconnect</b> to delete the key<input className="mt-1 block w-full rounded border bg-background p-2" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="ai-confirm" /></label>
        <Btn variant="ghost" disabled={confirm.trim().toLowerCase() !== "disconnect"} onClick={() => void act("disconnect", { confirm })} testId="ai-disconnect">Disconnect</Btn>
      </div>
    </div>
  );
}

function PreviewBox({ p, act }: { p: Preview; act: Act }) {
  const [voted, setVoted] = useState<number | null>(null);
  return (
    <div className="rounded border p-3 text-sm" data-testid="ai-preview-box">
      {p.ok ? <><p className="font-medium">AI wording (a suggestion)</p><p className="mt-1">{p.text}</p>
        <p className="mt-2 text-xs text-muted-foreground">Was this useful? <Btn variant="ghost" disabled={voted !== null} onClick={() => void act("feedback", { runId: p.runId, value: 1 }).then(() => setVoted(1))}>Yes</Btn> <Btn variant="ghost" disabled={voted !== null} onClick={() => void act("feedback", { runId: p.runId, value: -1 }).then(() => setVoted(-1))}>No</Btn></p></>
        : <p className="text-red-600">{p.error}</p>}
      {p.sent && (
        <details className="mt-2"><summary className="cursor-pointer text-xs">What was sent to your AI</summary>
          <p className="mt-1 text-xs text-muted-foreground">Fields: {p.sent.fields.join("; ")}. Names included: {p.sent.includesNames ? "yes" : "no"}.</p>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{p.sent.text}</pre></details>
      )}
    </div>
  );
}

function UsagePanel({ usage, conn, act }: { usage: Usage; conn: Conn | null; act: Act }) {
  void act;
  const pct = conn && conn.capUsd > 0 ? Math.min(100, Math.round((usage.spendUsd / conn.capUsd) * 100)) : 0;
  return (
    <div className="mt-4 rounded border p-3" data-testid="ai-usage">
      <h4 className="text-sm font-medium">AI usage this month</h4>
      <p className="mt-1 text-sm">{usage.runs} {usage.runs === 1 ? "run" : "runs"} ({usage.ok} worked, {usage.rejected} did not pass our checks, {usage.errors} failed). Estimated cost {usd(usage.spendUsd)}{conn ? ` of your ${usd(conn.capUsd)} limit` : ""}.</p>
      {conn && <div className="mt-1 h-2 w-full max-w-md overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the monthly limit used"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>}
      {conn && usage.spendUsd >= conn.capUsd && <p className="mt-1 text-sm text-amber-600">The monthly limit is reached, so AI is paused until next month or until you raise the limit.</p>}
      <p className="mt-1 text-xs text-muted-foreground">The cost is our estimate from the size of each run; your provider&apos;s own bill is what counts. Thumbs up {usage.thumbs.up}, down {usage.thumbs.down}.</p>
      {usage.lastErrors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs">{usage.lastErrors.map((e) => <li key={e.at}>{new Date(e.at).toLocaleString()}: {e.reason}</li>)}</ul>
      )}
    </div>
  );
}
