"use client";

import { Check, Loader2, Trash2, Undo2, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DealAction, DealPlan, Unclog } from "@/lib/analytics/pipeline-actions";
import { ApiError, useApiClient } from "../session";
import { BTN, DANGER, ModeLine, Notes, PRIMARY, type Blocker, type Mode } from "./appointment-actions-ui";

// The action pieces of the Pipeline module (slice PB), as components and hooks for the integrator to place:
//   <DealPanel .../>              (pipeline-panel.tsx)  the right-side deal panel: details, dwell, owner, source, linked appointments, timeline, every action below
//   <DealChangeFlow .../>         one change with its preview, a reason for a lost deal, the typed confirmation for a delete, the result and a short Undo
//   <UnclogChips .../>            the one-tap fixes for a stale deal (each opens the same preview; nothing is sent by the tap itself)
//   <DealBulkBar .../>            appears when deals are ticked (one client account at a time): move, change owner, won/lost with a reason, follow-up task, delete
//   <DealRowQuickActions .../>    two small buttons for a table row: Won and Lost (each opens the preview)
//   useDealCaps()                 what this person may do, so a screen shows only those buttons
// Nothing here decides whether something is allowed: the server answers with a preview, the reasons a change is refused, and whether it is a practice run (changes from SubSync are
// switched off) or live. A delete can never be sent without the typed confirmation, and no keyboard shortcut can reach it.

export type DealCaps = { edit: boolean; reassign: boolean; del: boolean; bulk: boolean; caps: { stage: number; owner: number; status: number; task: number; delete: number }; undoMinutes: number; me: string | null; lostReasons: Array<{ id: string; label: string }> };
export type DealMeta = { team: Array<{ id: string; name: string }>; pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>; lostReasons: Array<{ id: string; label: string }> };
type PreviewAnswer = { ok: boolean; mode: Mode; needsPermission: boolean; plan: DealPlan };
type DoAnswer = { ok: boolean; done?: boolean; dryRun?: boolean; message?: string; batchId?: string; undoMinutes?: number; needsPermission?: boolean };

const FIELD = "min-h-11 w-full rounded-md border bg-background px-3 text-sm sm:min-h-9";
const msgOf = (e: unknown) => (e instanceof ApiError && typeof e.body.message === "string" ? e.body.message : e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : e instanceof Error ? e.message : "Something went wrong. Try again.");
const blockersOf = (e: unknown): Blocker[] | null => (e instanceof ApiError && Array.isArray(e.body.blockers) ? (e.body.blockers as Blocker[]) : null);

let capsShared: { api: unknown; at: number; p: Promise<DealCaps | null> } | null = null;
/** What this person may do. One shared request; a failed load simply shows no extra buttons. */
export function useDealCaps(): DealCaps | null {
  const api = useApiClient();
  const [caps, setCaps] = useState<DealCaps | null>(null);
  useEffect(() => {
    if (!capsShared || capsShared.api !== api || Date.now() - capsShared.at > 60_000) capsShared = { api, at: Date.now(), p: api.get<DealCaps>("pipeline3/act/caps").catch(() => null) };
    let live = true;
    void capsShared.p.then((c) => { if (live) setCaps(c); });
    return () => { live = false; };
  }, [api]);
  return caps;
}

/** The team, pipelines and stages of one account, for the pickers. */
export function useDealMeta(locationId: string | null): DealMeta | null {
  const api = useApiClient();
  const [meta, setMeta] = useState<{ id: string; m: DealMeta } | null>(null);
  useEffect(() => {
    if (!locationId) return;
    let live = true;
    void api.get<DealMeta>(`pipeline3/act/meta?locationId=${encodeURIComponent(locationId)}`).then((m) => { if (live) setMeta({ id: locationId, m }); }).catch(() => { /* the pickers simply stay empty */ });
    return () => { live = false; };
  }, [api, locationId]);
  return meta && meta.id === locationId ? meta.m : null;
}

export function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-card p-4 shadow-[0_0_40px_-12px_var(--primary)] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="ds-press -mr-2 -mt-2 inline-flex size-11 items-center justify-center rounded-md hover:bg-muted sm:size-9"><X aria-hidden className="size-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

// ---------------- undo ----------------

export function DealUndoButton({ locationId, batchId, onDone, minutes }: { locationId: string; batchId: string; onDone: () => void; minutes: number }) {
  const api = useApiClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  const go = async () => {
    setState("busy");
    try { await api.post("pipeline3/act/undo", { locationId, batchId }); setState("done"); onDone(); }
    catch (e) { setState(msgOf(e)); }
  };
  if (state === "done") return <span className="text-sm text-muted-foreground">Put back.</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void go()} disabled={state === "busy"} className={BTN} data-testid="deal-undo"><Undo2 aria-hidden className="size-4" />Undo (open for {minutes} min)</button>
      {state !== "idle" && state !== "busy" && <span role="alert" className="text-sm text-destructive">{state}</span>}
    </span>
  );
}

// ---------------- one change: preview, confirm, result ----------------

export type DealFlowProps = { locationId: string; opportunityId: string; action: DealAction; title: string; onClose: () => void; onChanged: () => void; extra?: ReactNode; lostReasons?: Array<{ id: string; label: string }> };

/**
 * The preview-then-confirm sheet for one change. A lost mark asks for the reason first. A delete shows which deal, says it cannot be undone and keeps its button off until the words
 * are typed.
 */
export function DealChangeFlow(p: DealFlowProps) {
  const api = useApiClient();
  const [pre, setPre] = useState<PreviewAnswer | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState<string>(p.action.kind === "status" && p.action.reason ? p.action.reason : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [res, setRes] = useState<DoAnswer | null>(null);
  const isDelete = p.action.kind === "delete";
  const needsReason = p.action.kind === "status" && (p.action.status === "lost" || p.action.status === "abandoned");
  const action = useMemo<DealAction>(() => {
    if (p.action.kind === "delete") return { kind: "delete", typed };
    if (p.action.kind === "status" && needsReason) return { ...p.action, ...(reason ? { reason: reason as never } : {}) };
    return p.action;
  }, [p.action, typed, reason, needsReason]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void api.post<PreviewAnswer>("pipeline3/act/apply", { locationId: p.locationId, opportunityId: p.opportunityId, action, step: "preview" })
        .then((r) => { if (live) { setPre(r); setErr(null); } }).catch((e) => { if (live) setErr(msgOf(e)); });
    }, isDelete ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [api, p.locationId, p.opportunityId, action, isDelete]);

  const confirm = async () => {
    setBusy(true); setErr(null); setBlockers(null);
    try { setRes(await api.post<DoAnswer>("pipeline3/act/apply", { locationId: p.locationId, opportunityId: p.opportunityId, action, step: "do" })); p.onChanged(); }
    catch (e) { setBlockers(blockersOf(e)); setErr(blockersOf(e) ? null : msgOf(e)); }
    finally { setBusy(false); }
  };

  const plan = pre?.plan;
  const needed = plan?.confirm?.words ?? [];
  const typedOk = !isDelete || needed.some((w) => w.toLowerCase() === typed.trim().toLowerCase().replace(/\s+/g, " "));
  const blocked = (plan?.blockers ?? []).filter((b) => !(isDelete && b.id === "confirm" && typedOk));
  const word = isDelete ? "Delete deal" : p.action.kind === "note" ? "Add the note" : p.action.kind === "task" ? "Create the task" : null;
  return (
    <Sheet title={p.title} onClose={p.onClose} testId={isDelete ? "deal-delete-dialog" : "deal-change-flow"}>
      {res ? (
        <div role="status" data-testid="deal-flow-result">
          <p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4 text-emerald-500" />{res.message ?? "Done."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {res.done && res.batchId && plan?.reversible && <DealUndoButton locationId={p.locationId} batchId={res.batchId} onDone={p.onChanged} minutes={res.undoMinutes ?? 30} />}
            <button type="button" onClick={p.onClose} className={PRIMARY}>Close</button>
          </div>
        </div>
      ) : (
        <>
          {p.extra}
          {needsReason && (
            <label className="mb-2 block text-sm">Why was it lost?
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} mt-1`} data-testid="deal-lost-reason">
                <option value="">Choose a reason</option>
                {(p.lostReasons ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
          )}
          {plan ? (
            <div data-testid="deal-preview">
              <p className="text-sm font-medium">{plan.summary}</p>
              {isDelete && <p className="mt-1 text-sm text-destructive">This cannot be undone.</p>}
              {plan.changes.length > 0 && !isDelete && <ul className="mt-2 divide-y rounded-md border text-sm">{plan.changes.map((c) => <li key={c.label} className="flex flex-wrap gap-x-3 px-3 py-1.5"><span className="w-24 shrink-0 text-muted-foreground">{c.label}</span><span className="line-through opacity-60">{c.from}</span><span aria-hidden>{"->"}</span><b>{c.to}</b></li>)}</ul>}
              <Notes blockers={blocked.filter((b) => !(needsReason && b.id === "reason" && !reason))} warnings={plan.warnings} />
              <Notes blockers={blockers ?? undefined} />
              {isDelete && (
                <label className="mt-3 block text-sm">Type <b>{needed[0] ?? "DELETE"}</b>{needed[1] ? <> or <b>{needed[1]}</b></> : null} to confirm
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD} mt-1`} data-testid="deal-delete-typed" aria-label="Type the confirmation" />
                </label>
              )}
              <ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void confirm()} disabled={busy || blocked.length > 0 || !typedOk || (needsReason && !reason) || (pre.mode.live && pre.needsPermission)} className={isDelete ? DANGER : PRIMARY} data-testid="deal-confirm">
                  {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : isDelete ? <Trash2 aria-hidden className="size-4" /> : <Check aria-hidden className="size-4" />}{word ?? (pre.mode.live ? "Confirm" : "Run practice")}
                </button>
                <button type="button" onClick={p.onClose} className={BTN}>Cancel</button>
              </div>
            </div>
          ) : err ? <p role="alert" className="text-sm text-destructive">{err}</p> : <p className="text-sm text-muted-foreground" role="status"><Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />Checking what would change...</p>}
          {err && plan && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        </>
      )}
    </Sheet>
  );
}

// ---------------- unclog: one-tap fixes ----------------

/** The small fixes offered on a stale deal. A tap opens the normal preview; nothing is sent by the tap itself and nothing is ever sent to the lead. */
export function UnclogChips({ items, onPick }: { items: Unclog[]; onPick: (u: Unclog) => void }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Unclog this deal" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" data-testid="deal-unclog">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Zap aria-hidden className="size-4 text-amber-500" />Get this moving</h3>
      <ul className="mt-2 space-y-2">
        {items.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} onClick={() => onPick(u)} data-testid={`deal-unclog-${u.id}`}>{u.label}</button>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">{u.why}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">Each one shows a preview first. These changes are never shown to the person.</p>
    </section>
  );
}

// ---------------- bulk ----------------

type BulkKind = "stage" | "owner" | "status" | "task" | "delete";
type BulkPreview = { ok: boolean; mode: Mode; needsPermission: boolean; plan: { allowed: Array<{ opportunityId: string; name: string; value: number | null; stage: string | null }>; skipped: Array<{ opportunityId: string; name: string; reason: string }>; overCap: number; phrase: string | null; reversible: boolean; cap: number; totalValue: number } };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const tomorrowLocal = () => { const d = new Date(Date.now() + 86_400_000); d.setHours(9, 0, 0, 0); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`; };

/** Appears when deals are ticked. One client account at a time (the caller passes the account the ticked deals belong to). */
export function DealBulkBar({ locationId, ids, caps, onChanged, onClear }: { locationId: string; ids: string[]; caps: DealCaps; onChanged: () => void; onClear: () => void }) {
  const api = useApiClient();
  const meta = useDealMeta(locationId);
  const [kind, setKind] = useState<BulkKind | null>(null);
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState<"won" | "lost" | "open">("won");
  const [reason, setReason] = useState("");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("Follow up on this deal");
  const [due, setDue] = useState(tomorrowLocal);
  const [pre, setPre] = useState<BulkPreview | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ message?: string; batchId?: string; undoable?: boolean; undoMinutes?: number } | null>(null);
  const [pipelineId, stageId] = stage.split("|");
  const body = (step: string) => ({ locationId, ids, kind, pipelineId, stageId, status, reason: reason || undefined, userId: userId || undefined, title, dueDate: new Date(due).toISOString(), step, ...(step === "do" ? { typed } : {}) });
  const ready = kind === "stage" ? !!stageId : kind === "owner" ? !!userId : kind === "status" ? status !== "lost" || !!reason : kind === "task" ? !!title.trim() && !!due : kind === "delete";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!kind || !ready) { setPre(null); return; }
    setErr(null);
    void api.post<BulkPreview>("pipeline3/act/bulk", body("preview")).then(setPre).catch((e) => setErr(blockersOf(e)?.map((b) => b.text).join(" ") ?? msgOf(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, kind, ready, stage, status, reason, userId, title, due, ids.join(",")]);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<NonNullable<typeof res>>("pipeline3/act/bulk", body("do")); setRes(r); onChanged(); }
    catch (e) { setErr(blockersOf(e)?.map((b) => b.text).join(" ") ?? msgOf(e)); }
    finally { setBusy(false); }
  };
  const n = pre?.plan.allowed.length ?? 0;
  const phraseOk = kind !== "delete" || typed.trim().toLowerCase().replace(/\s+/g, " ") === pre?.plan.phrase;
  const close = () => { setKind(null); setRes(null); setPre(null); setTyped(""); };
  const titles: Record<BulkKind, string> = { stage: "Move to a stage", owner: "Change owner", status: "Mark won or lost", task: "Create a follow-up task", delete: `Delete ${n || ids.length} deals` };
  return (
    <>
      <div className="sticky bottom-2 z-30 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-[0_0_30px_-10px_var(--primary)] backdrop-blur" role="toolbar" aria-label="Actions for the ticked deals" data-testid="deal-bulk-bar">
        <b className="tabular-nums">{ids.length} ticked</b>
        <button type="button" className={BTN} onClick={() => setKind("stage")} data-testid="deal-bulk-stage">Move</button>
        <button type="button" className={BTN} onClick={() => setKind("status")} data-testid="deal-bulk-status">Won or lost</button>
        <button type="button" className={BTN} onClick={() => setKind("task")} data-testid="deal-bulk-task">Follow-up task</button>
        {caps.reassign && <button type="button" className={BTN} onClick={() => setKind("owner")} data-testid="deal-bulk-owner">Change owner</button>}
        {caps.del && <button type="button" className={`${BTN} text-destructive`} onClick={() => { setTyped(""); setKind("delete"); }} data-testid="deal-bulk-delete"><Trash2 aria-hidden className="size-4" />Delete</button>}
        <button type="button" className={`${BTN} ml-auto`} onClick={onClear}>Clear</button>
      </div>
      {kind && (
        <Sheet title={titles[kind]} onClose={close} testId="deal-bulk-sheet">
          {res ? (
            <div role="status"><p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4 text-emerald-500" />{res.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">{res.undoable && res.batchId && <DealUndoButton locationId={locationId} batchId={res.batchId} onDone={onChanged} minutes={res.undoMinutes ?? 30} />}<button type="button" className={PRIMARY} onClick={() => { close(); onClear(); }}>Close</button></div></div>
          ) : (
            <>
              {kind === "stage" && <label className="block text-sm">Stage<select value={stage} onChange={(e) => setStage(e.target.value)} className={`${FIELD} mt-1`}><option value="">Choose a stage</option>{(meta?.pipelines ?? []).map((pl) => <optgroup key={pl.id} label={pl.name}>{pl.stages.map((s) => <option key={s.id} value={`${pl.id}|${s.id}`}>{s.name}</option>)}</optgroup>)}</select></label>}
              {kind === "owner" && <label className="block text-sm">New owner<select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${FIELD} mt-1`}><option value="">Choose a team member</option>{(meta?.team ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
              {kind === "status" && (
                <>
                  <label className="block text-sm">Mark as<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${FIELD} mt-1`}><option value="won">Won</option><option value="lost">Lost</option><option value="open">Open again</option></select></label>
                  {status === "lost" && <label className="mt-2 block text-sm">Why were they lost?<select value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} mt-1`}><option value="">Choose a reason</option>{(meta?.lostReasons ?? caps.lostReasons).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
                </>
              )}
              {kind === "task" && (
                <>
                  <label className="block text-sm">Task<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`${FIELD} mt-1`} /></label>
                  <label className="mt-2 block text-sm">Due<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${FIELD} mt-1`} /></label>
                </>
              )}
              {pre && (
                <div className="mt-3" data-testid="deal-bulk-preview">
                  <p className="text-sm font-medium">{n} deal{n === 1 ? "" : "s"} will change{pre.plan.totalValue > 0 ? `, ${money(pre.plan.totalValue)} in total` : ""}{kind === "delete" ? ". This cannot be undone." : "."}</p>
                  <ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-md border text-sm">{pre.plan.allowed.map((a) => <li key={a.opportunityId} className="flex justify-between gap-2 px-3 py-1.5"><span className="truncate">{a.name}</span><span className="shrink-0 text-xs text-muted-foreground">{a.value ? money(a.value) : "no value"}</span></li>)}</ul>
                  {pre.plan.skipped.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Left out: {pre.plan.skipped.map((s) => `${s.name} (${s.reason})`).slice(0, 5).join(", ")}{pre.plan.skipped.length > 5 ? ` and ${pre.plan.skipped.length - 5} more` : ""}.</p>}
                  {pre.plan.overCap > 0 && <p className="mt-2 text-xs text-amber-600">{pre.plan.overCap} more are over the limit of {pre.plan.cap} at a time and were left out.</p>}
                  {kind === "delete" && pre.plan.phrase && <label className="mt-3 block text-sm">Type <b>{pre.plan.phrase}</b> to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD} mt-1`} data-testid="deal-bulk-typed" aria-label="Type the confirmation" /></label>}
                  <ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
                  <div className="mt-3 flex gap-2"><button type="button" disabled={busy || n === 0 || !phraseOk || (pre.mode.live && pre.needsPermission)} onClick={() => void run()} className={kind === "delete" ? DANGER : PRIMARY} data-testid="deal-bulk-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}{pre.mode.live ? "Confirm" : "Run practice"}</button><button type="button" className={BTN} onClick={close}>Cancel</button></div>
                </div>
              )}
              {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
            </>
          )}
        </Sheet>
      )}
    </>
  );
}

// ---------------- a table row ----------------

/** Two small buttons for a table row: Won and Lost. Each opens the preview (Lost asks for the reason there). */
export function DealRowQuickActions({ locationId, opportunityId, caps, onChanged }: { locationId: string; opportunityId: string; caps: DealCaps; onChanged: () => void }) {
  const [flow, setFlow] = useState<null | "won" | "lost">(null);
  return (
    <>
      <span className="inline-flex gap-1">
        <button type="button" className={`${BTN} min-h-8 px-2 text-xs`} onClick={() => setFlow("won")} data-testid="deal-row-won">Won</button>
        <button type="button" className={`${BTN} min-h-8 px-2 text-xs`} onClick={() => setFlow("lost")} data-testid="deal-row-lost">Lost</button>
      </span>
      {flow && <DealChangeFlow locationId={locationId} opportunityId={opportunityId} action={{ kind: "status", status: flow }} title={flow === "won" ? "Mark deal won" : "Mark deal lost"} lostReasons={caps.lostReasons} onClose={() => setFlow(null)} onChanged={onChanged} />}
    </>
  );
}
