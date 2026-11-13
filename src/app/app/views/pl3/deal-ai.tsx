"use client";

import { useState, type ReactNode } from "react";
import { bandOf, HEALTH_HOW, HEALTH_WORDS, type HealthBand } from "@/lib/ai/deal-health-band";
import { useApiClient, useData } from "../../session";
import { DealChangeFlow } from "../pipeline-actions-ui";
import { Btn } from "../../ui";
import type { PlFilters } from "./data";

// The deal AI entry points (docs/AI_JOBS_SPEC.md, the four DEAL jobs). Each one asks the server what it may do (off: it shows nothing at all), shows numbers and the Health badge that our
// rules worked out, and adds words from the person's own AI only when they press the button. Everything here only SUGGESTS. A task is created only through the existing preview-and-confirm
// sheet (DealChangeFlow), never directly, and never anything is sent to a lead.

type State = "off" | "no_connection" | "job_off" | "paused" | "needs_attention" | "ready";
type Sent = { fields: string[]; includesNames: boolean; text: string } | null;
export type DealAiJobs = Partial<Record<"deal_health" | "deal_followup" | "deal_winloss" | "deal_forecast", State>>;

/** What each deal AI button should do for this person (and account). Null while loading or when AI is not switched on: show nothing. */
export function useDealAi(locationId?: string): DealAiJobs | null {
  const { data, error } = useData<{ jobs: DealAiJobs }>(`ai?part=deal-status${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ""}`);
  return error || !data ? null : data.jobs;
}

const HINT: Record<Exclude<State, "off" | "ready">, string> = {
  no_connection: "AI explanations are available. An administrator can connect an AI account in Settings, AI.",
  job_off: "This AI help is switched off for this account. An administrator can switch it on in Settings, AI.",
  paused: "AI is paused for this account.",
  needs_attention: "The AI key needs attention. An administrator can replace it in Settings, AI.",
};
const Hint = ({ state }: { state: State }) => (state === "off" || state === "ready" ? null : <p className="ap-fine" data-testid="deal-ai-hint">{HINT[state]}</p>);

const TONE: Record<HealthBand, "green" | "amber" | "red"> = { healthy: "green", needs_look: "amber", at_risk: "red" };
/** The Health badge: computed by rules from the deal's own facts. Hover or focus for how it is worked out. */
export function HealthChip({ score }: { score: number | null | undefined }) {
  const band = bandOf(score);
  if (!band) return <span className="ap-sub">-</span>;
  return <span className="ap-chip" data-tone={TONE[band]} title={HEALTH_HOW} data-testid="deal-health-chip">{HEALTH_WORDS[band]}{score !== null && score !== undefined ? ` ${score}` : ""}</span>;
}

/** The little frame every AI answer sits in: what it is, what was sent, a thumbs up or down. */
function AiBox({ title, children, sent, run, job, locationId }: { title: string; children: ReactNode; sent: Sent; run?: string | null; job: string; locationId?: string }) {
  const api = useApiClient();
  const [voted, setVoted] = useState<number | null>(null);
  const vote = (value: 1 | -1) => api.post("ai/act/deal-feedback", { job, runId: run, value, locationId }).then(() => setVoted(value)).catch(() => undefined);
  return (
    <div className="rounded-xl border p-3 text-sm" data-testid="deal-ai-box">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="font-normal normal-case">(a suggestion: SubSync worked out the numbers, your AI wrote the words)</span></p>
      <div className="mt-1 space-y-1.5">{children}</div>
      {run && <p className="mt-2 text-xs text-muted-foreground">Was this useful? <Btn variant="ghost" disabled={voted !== null} onClick={() => vote(1)}>Yes</Btn> <Btn variant="ghost" disabled={voted !== null} onClick={() => vote(-1)}>No</Btn></p>}
      {sent && <details className="mt-1"><summary className="cursor-pointer text-xs">What was sent to your AI</summary><p className="mt-1 text-xs text-muted-foreground">Fields: {sent.fields.join("; ")}. Names included: {sent.includesNames ? "yes" : "no"}.</p><pre className="mt-1 whitespace-pre-wrap text-xs">{sent.text}</pre></details>}
    </div>
  );
}

const body = (f: PlFilters) => ({ from: f.from, to: f.to, fromTime: f.fromTime, toTime: f.toTime, location: f.locationId || undefined, pipeline: f.pipeline || undefined });

type Job<T> = { status: "ok"; data: T; runId: string; cached: boolean; costUsd: number; sent: Sent } | { status: "refused"; code: string; message: string; sent: Sent } | { status: "gate"; message: string };
function useRun<T>(name: string, payload: unknown) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false), [out, setOut] = useState<Job<T> | null>(null), [err, setErr] = useState<string | null>(null);
  const go = async (fresh = false) => {
    setBusy(true); setErr(null);
    try { setOut(await api.post<Job<T>>(`ai/act/${name}`, { ...(payload as object), fresh })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, out, err, go };
}
const Notice = ({ r, err }: { r: Job<unknown> | null; err: string | null }) => (err ? <p className="text-sm text-red-600" role="alert">{err}</p> : r?.status === "refused" ? <p className="text-sm text-red-600" role="alert">{r.message}</p> : r?.status === "gate" ? <p className="text-sm text-muted-foreground" data-testid="deal-ai-gate">{r.message}</p> : null);

// ---------------- 1. one deal: Health and the explanation ----------------

type Health = {
  opportunityId: string; status: string; score: number | null; band: HealthBand | null; word: string | null; issues: Array<{ id: string; text: string }>; how: string;
  explanation: { summary: string; stuck: string; missing: string; likelyReason: string } | null; explanationRunId: string | null; sent: Sent; message: string | null;
};
/** In the deal panel (Pipeline lists and the lead panel's deal): the badge, what the rules found, and a button for the AI's plain-words explanation. */
export function DealHealthSection({ locationId, id }: { locationId: string; id: string }) {
  const jobs = useDealAi(locationId);
  const state = jobs?.deal_health ?? "off";
  const { data, reload } = useData<Health>(state === "off" ? null : `ai?part=deal-health&locationId=${encodeURIComponent(locationId)}&id=${encodeURIComponent(id)}`);
  const { busy, out, err, go } = useRun<Health>("deal-health", { locationId, id });
  if (state === "off" || !data || data.status !== "open") return null;
  const done = out?.status === "ok" ? out.data : null, ex = done?.explanation ?? data.explanation, runId = done?.explanationRunId ?? data.explanationRunId, sent = done?.sent ?? data.sent;
  return (
    <section aria-label="Deal health" className="rounded-xl border p-3" data-testid="deal-health">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Health</h3><HealthChip score={data.score} /></div>
      {data.issues.length > 0 ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm" data-testid="deal-health-issues">{data.issues.map((i) => <li key={i.id}>{i.text}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">The rules found nothing wrong.</p>}
      <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">How is this worked out?</summary><p className="ap-fine mt-1">{data.how}</p></details>
      {ex ? (
        <div className="mt-2"><AiBox title="Explained in plain words" sent={sent} run={runId} job="deal_health" locationId={locationId}>
          <p>{ex.summary}</p>
          {ex.stuck && <p><b>What is stuck:</b> {ex.stuck}</p>}
          {ex.missing && <p><b>What is missing:</b> {ex.missing}</p>}
          {ex.likelyReason && <p><b>Likely reason:</b> {ex.likelyReason}</p>}
        </AiBox></div>
      ) : state === "ready" ? <div className="mt-2"><Btn variant="secondary" disabled={busy} onClick={() => void go().then(reload)} testId="deal-ai-explain">{busy ? "Explaining..." : "Explain with AI"}</Btn></div> : <div className="mt-2"><Hint state={state} /></div>}
      <Notice r={out as Job<unknown> | null} err={err} />
    </section>
  );
}

// ---------------- 2. follow-up plan for a list of stuck deals ----------------

type Item = { ref: string; opportunityId: string; locationId: string; dealName: string; stage: string | null; channel: "call" | "text" | "email" | "review"; timing: "today" | "tomorrow" | "this_week"; say: string; why: string; task: { title: string; dueDate: string } | null };
type Plan = { items: Item[]; stuckTotal: number; asked: number; skippedDnd: number; dropped: number };
const CHANNEL: Record<Item["channel"], string> = { call: "Call", text: "Text", email: "Email", review: "Look at it in your CRM" };
const TIMING: Record<Item["timing"], string> = { today: "Today", tomorrow: "Tomorrow", this_week: "This week" };

export function FollowUpPlan({ filters, onChanged }: { filters: PlFilters; onChanged?: () => void }) {
  const jobs = useDealAi(filters.locationId || undefined);
  const state = jobs?.deal_followup ?? "off";
  const { busy, out, err, go } = useRun<Plan>("deal-followup", body(filters));
  const [task, setTask] = useState<Item | null>(null), [added, setAdded] = useState<Set<string>>(new Set());
  if (state === "off") return null;
  const plan = out?.status === "ok" ? out.data : null;
  return (
    <section className="mb-3" aria-label="Follow-up plan" data-testid="deal-followup">
      {state === "ready" ? <Btn variant="secondary" disabled={busy} onClick={() => void go()} testId="deal-followup-go">{busy ? "Planning..." : plan ? "Plan again" : "Suggest next steps (AI)"}</Btn> : <Hint state={state} />}
      <Notice r={out as Job<unknown> | null} err={err} />
      {out?.status === "ok" && plan && (
        <div className="mt-2"><AiBox title="Suggested next touch" sent={out.sent} run={out.runId} job="deal_followup" locationId={filters.locationId || undefined}>
          <p className="text-xs text-muted-foreground" data-testid="deal-followup-count">Plans for {plan.asked} of the {plan.stuckTotal} stuck deals (the biggest first; the list below has every one).{plan.skippedDnd > 0 ? ` ${plan.skippedDnd} left out because the person asked not to be contacted.` : ""} Nothing is sent to anyone.</p>
          {plan.items.length === 0 ? <p>The AI had no usable suggestion this time.</p> : (
            <ul className="divide-y">{plan.items.map((it) => (
              <li key={it.ref} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid="deal-followup-item">
                <div className="min-w-0 flex-1"><p className="font-medium">{it.dealName}{it.stage ? <span className="font-normal text-muted-foreground">, {it.stage}</span> : null}</p>
                  <p><b>{CHANNEL[it.channel]}</b>, {TIMING[it.timing].toLowerCase()}. {it.say}</p><p className="text-xs text-muted-foreground">{it.why}</p></div>
                {it.task ? (added.has(it.opportunityId) ? <span className="text-xs text-emerald-600">Task added</span> : <Btn variant="secondary" onClick={() => setTask(it)} testId="deal-followup-task">Add as an internal task</Btn>) : <span className="text-xs text-muted-foreground">No contact to put a task on</span>}
              </li>))}</ul>
          )}
        </AiBox></div>
      )}
      {task?.task && <DealChangeFlow locationId={task.locationId} opportunityId={task.opportunityId} action={{ kind: "task", title: task.task.title, dueDate: task.task.dueDate }} title="Add as an internal task" onClose={() => setTask(null)} onChanged={() => { setAdded((s) => new Set(s).add(task.opportunityId)); onChanged?.(); }} />}
    </section>
  );
}

// ---------------- 3. win and loss review, 4. forecast in words ----------------

type WL = { words: { summary: string; wins: string[]; losses: string[]; tryNext: string[] }; closed: number; won: number; lost: number };
const Bullets = ({ title, items }: { title: string; items: string[] }) => (items.length ? <div><p className="font-medium">{title}</p><ul className="list-disc pl-5">{items.map((x) => <li key={x}>{x}</li>)}</ul></div> : null);

export function WinLossReview({ filters }: { filters: PlFilters }) {
  const jobs = useDealAi(filters.locationId || undefined);
  const state = jobs?.deal_winloss ?? "off";
  const { busy, out, err, go } = useRun<WL>("deal-winloss", body(filters));
  if (state === "off") return null;
  return (
    <section className="mb-3" aria-label="Win and loss review" data-testid="deal-winloss">
      {state === "ready" ? <Btn variant="secondary" disabled={busy} onClick={() => void go()} testId="deal-winloss-go">{busy ? "Reviewing..." : "Review wins and losses (AI)"}</Btn> : <Hint state={state} />}
      <Notice r={out as Job<unknown> | null} err={err} />
      {out?.status === "ok" && (
        <div className="mt-2"><AiBox title={`What the ${out.data.closed} closed deals show`} sent={out.sent} run={out.runId} job="deal_winloss" locationId={filters.locationId || undefined}>
          <p>{out.data.words.summary}</p><Bullets title="Among the wins" items={out.data.words.wins} /><Bullets title="Among the losses" items={out.data.words.losses} /><Bullets title="Try next" items={out.data.words.tryNext} />
        </AiBox></div>
      )}
    </section>
  );
}

type FC = { words: { summary: string; couldMoveUp: string[]; couldMoveDown: string[]; doNext: string[] }; mid: number; low: number; high: number; formula: string; closedDeals: number; minClosed: number };
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export function ForecastWords({ filters }: { filters: PlFilters }) {
  const jobs = useDealAi(filters.locationId || undefined);
  const state = jobs?.deal_forecast ?? "off";
  const { busy, out, err, go } = useRun<FC>("deal-forecast", body(filters));
  if (state === "off") return null;
  return (
    <section className="mb-3" aria-label="Forecast in words" data-testid="deal-forecast">
      {state === "ready" ? <Btn variant="secondary" disabled={busy} onClick={() => void go()} testId="deal-forecast-go">{busy ? "Explaining..." : "Explain this forecast (AI)"}</Btn> : <Hint state={state} />}
      <Notice r={out as Job<unknown> | null} err={err} />
      {out?.status === "ok" && (
        <div className="mt-2"><AiBox title="Estimate, in words" sent={out.sent} run={out.runId} job="deal_forecast" locationId={filters.locationId || undefined}>
          <p className="text-xs text-muted-foreground">Estimate from SubSync: about {usd(out.data.mid)}, in a range of {usd(out.data.low)} to {usd(out.data.high)}, from {out.data.closedDeals} closed deals. Not a promise.</p>
          <details><summary className="cursor-pointer text-xs">How is this worked out?</summary><p className="ap-fine mt-1">{out.data.formula}</p></details>
          <p>{out.data.words.summary}</p><Bullets title="Could push it up" items={out.data.words.couldMoveUp} /><Bullets title="Could pull it down" items={out.data.words.couldMoveDown} /><Bullets title="Do next" items={out.data.words.doNext} />
        </AiBox></div>
      )}
    </section>
  );
}
