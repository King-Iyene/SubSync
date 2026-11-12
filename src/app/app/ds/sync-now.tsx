"use client";

import { Check, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { changedLine, progressWords, type AccountProgress, type RunStatus } from "@/lib/sync/run-status";
import type { Freshness } from "@/lib/sync/freshness";
import { useApiClient, useData } from "../session";

// A visible "Sync now" in the top header with the last-synced time always beside it. Pressing it opens a status popup: Syncing (progress by account), then
// "Synced just now: N contacts, M conversations, K appointments updated" with what changed, or an error with Retry. An agency can sync one client or all of them.
// The server lets one sync start per account every 30 seconds and answers a second press with how long to wait.
type Run = RunStatus & { line?: string };
type Phase = { kind: "idle" } | { kind: "running"; since: string; run: Run | null } | { kind: "done"; run: Run } | { kind: "error"; message: string; retryAfterSec?: number };
const POLL_MS = 2000;
const GIVE_UP_MS = 120_000;

export function SyncNow({ agency = false }: { agency?: boolean }) {
  const api = useApiClient();
  const seg = useData<{ accounts?: Array<{ id: string; name: string; ignored?: boolean }> }>(agency ? "segments" : null);
  const accounts = (seg.data?.accounts ?? []).filter((a) => !a.ignored);
  const fresh = useData<{ freshness: Freshness }>("freshness");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [target, setTarget] = useState("all");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);

  const poll = useRef<(since: string, started: number) => void>(() => undefined);
  useEffect(() => { poll.current = (since, started) => {
    timer.current = setTimeout(async () => {
      if (!alive.current) return;
      try {
        const run = await api.get<Run>(`sync-run?since=${encodeURIComponent(since)}`);
        if (!alive.current) return;
        if (run.state === "syncing" && Date.now() - started < GIVE_UP_MS) { setPhase({ kind: "running", since, run }); poll.current(since, started); return; }
        if (run.state === "error") { setPhase({ kind: "error", message: run.errors[0]?.error ?? "A read failed." }); return; }
        setPhase({ kind: "done", run }); void fresh.reload();
      } catch (e) { if (alive.current) setPhase({ kind: "error", message: (e as Error).message }); }
    }, POLL_MS);
  }; });

  const start = async () => {
    const since = new Date().toISOString();
    setOpen(true); setPhase({ kind: "running", since, run: null });
    poll.current(since, Date.now());
    try { await api.post(target === "all" ? "sync" : `sync/${target}`); }
    catch (e) {
      if (timer.current) clearTimeout(timer.current);
      const msg = (e as Error).message; const wait = /in (\d+) seconds/.exec(msg)?.[1];
      setPhase({ kind: "error", message: msg, retryAfterSec: wait ? Number(wait) : undefined });
    }
  };
  const f = fresh.data?.freshness;
  const running = phase.kind === "running";
  return (
    <div className="relative print:hidden" data-testid="sync-now">
      <div className="flex items-center gap-2">
        <span className="sr-only" data-testid="sync-last" title={f?.text}>{f?.text ?? ""}</span>
        <button type="button" onClick={() => (running ? setOpen(true) : void start())} data-testid="sync-now-btn" aria-label="Sync now"
          className="ds-press inline-flex min-h-11 items-center sm:min-h-9 gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
          <RefreshCw aria-hidden className={`size-4 ${running ? "animate-spin" : ""}`} />{running ? "Syncing..." : "Sync now"}
        </button>
      </div>
      {open && (
        <div role="dialog" aria-label="Sync status" data-testid="sync-popup" className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,90vw)] rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-[var(--shadow-lift)]">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="font-semibold" data-testid="sync-title">{phase.kind === "running" ? "Syncing..." : phase.kind === "done" ? "Synced just now" : phase.kind === "error" ? "The sync did not finish" : "Sync"}</p>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="-m-1 rounded-md p-1.5 hover:bg-muted"><X aria-hidden className="size-4" /></button>
          </div>
          {accounts && accounts.length > 1 && phase.kind !== "running" && (
            <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">Sync
              <select aria-label="Which client to sync" value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-sm text-foreground">
                <option value="all">All clients</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          {phase.kind === "running" && <Progress run={phase.run} />}
          {phase.kind === "done" && <Done run={phase.run} />}
          {phase.kind === "error" && <p className="text-[var(--destructive)]" data-testid="sync-error">{phase.message}</p>}
          {phase.kind !== "running" && (
            <button type="button" onClick={() => void start()} data-testid="sync-retry" className="ds-press mt-3 inline-flex min-h-9 items-center rounded-lg border px-3 font-medium hover:bg-muted">{phase.kind === "error" ? "Retry" : "Sync again"}</button>
          )}
        </div>
      )}
    </div>
  );
}

function Progress({ run }: { run: Run | null }) {
  const total = run?.progress.total ?? 0; const pct = total > 0 ? Math.round(((run?.progress.done ?? 0) / total) * 100) : 0;
  const rows: AccountProgress[] = (run?.accounts ?? []).slice(0, 8);
  return (
    <div data-testid="sync-progress">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="mt-1.5 text-xs text-muted-foreground" role="status">{progressWords(run?.progress ?? { done: 0, total: 0 })}</p>
      {rows.length > 0 && <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">{rows.map((a) => <li key={a.locationId} className="flex justify-between gap-2"><span className="truncate">{a.name ?? "Client"}</span><span className="tabular-nums text-muted-foreground">{a.pending > 0 ? `${a.done}/${a.done + a.pending + a.failed}` : "done"}</span></li>)}</ul>}
    </div>
  );
}

function Done({ run }: { run: Run }) {
  return (
    <div data-testid="sync-done">
      <p className="flex items-center gap-1.5"><Check aria-hidden className="size-4 text-[var(--success)]" /><span data-testid="sync-line">{run.line ?? changedLine(run.changed)}</span></p>
      <p className="mt-2 text-xs font-medium text-muted-foreground">What changed</p>
      {run.changes.length === 0 ? <p className="text-xs text-muted-foreground">Nothing was new since the last read.</p> : (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs" data-testid="sync-changes">{run.changes.map((c) => <li key={c.locationId} className="flex justify-between gap-2"><span className="truncate">{c.name ?? "Client"}</span><span className="tabular-nums text-muted-foreground">{c.contacts} contacts, {c.conversations} conversations, {c.appointments} appointments</span></li>)}</ul>
      )}
    </div>
  );
}
