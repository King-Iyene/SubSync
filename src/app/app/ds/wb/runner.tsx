"use client";

import { Check, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { Action } from "@/lib/ghl/workbench";
import { resultText } from "@/lib/design/send-result";
import { ApiError, useApiClient } from "../../session";

// The one way the Lead workbench changes anything: ask the server for a preview, show exactly what will happen, wait for a click, then send it through the server's write gateway.
// Nothing here decides whether a change is allowed (the server does: switch, account opt-in, Do Not Disturb, quiet hours, limits). This file only shows the answer in plain words.

export type Mode = { masterOn: boolean; optedIn: boolean; live: boolean; demo: boolean };
export type Warn = { id: string; text: string };
export type Plan = { summary: string; blockers: Warn[]; warnings: Warn[]; reversible: boolean; fields: string[] };
export type Pending = { action: Action; plan: Plan; mode: Mode; /** What will be sent, shown in a quote (a message or a note). Held in the browser only. */ quote?: string; verb: string; typeName?: string };
export type Result = { tone: "done" | "dry" | "error"; text: string; /** Which kind of change this is about ("message", "note"...). */ kind?: string; undo?: Action | null; retry?: Action | null };

const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-card px-4 text-[15px] font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-10";
const PRIMARY = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-10";
const DANGER = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-destructive px-5 text-[15px] font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-10";
export const wbButtons = { BTN, PRIMARY, DANGER };

export function useRunner(locationId: string, contactId: string | null, onChanged: () => void) {
  const api = useApiClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState<string[]>([]);

  const base = useCallback((action: Action) => ({ locationId, ...(contactId ? { contactId } : {}), action }), [locationId, contactId]);

  /** Ask for the preview of one action. `quote` and `verb` are only for how it is shown. */
  const preview = useCallback(async (action: Action, o: { quote?: string; verb?: string; typeName?: string } = {}) => {
    setBusy(true); setResult(null); setAck([]);
    try {
      const r = await api.post<{ mode: Mode; plan: Plan }>("workbench/preview", base(action));
      setPending({ action, plan: o.typeName ? { ...r.plan, blockers: r.plan.blockers.filter((b) => b.id !== "confirm") } : r.plan, mode: r.mode, ...(o.quote ? { quote: o.quote } : {}), verb: o.verb ?? "Confirm", ...(o.typeName ? { typeName: o.typeName } : {}) });
    } catch (e) { setResult({ tone: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  }, [api, base]);

  const send = useCallback(async (action: Action, acks: string[]) => {
    setBusy(true);
    try {
      const r = await api.post<{ dryRun?: boolean; message?: string; summary?: string; undo?: Action | null }>("workbench/do", { ...base(action), confirm: true, ack: acks });
      setPending(null);
      // Never silent: a message says "Sent." or "Not sent: ..." in plain words, and the text stays in the box when it was not sent.
      if (r.dryRun) setResult({ tone: "dry", kind: action.kind, text: resultText(action.kind, true, r.message, r.summary) });
      else { setResult({ tone: "done", kind: action.kind, text: resultText(action.kind, false, r.message, r.summary), undo: r.undo ?? null }); onChanged(); }
    } catch (e) {
      const body = e instanceof ApiError ? e.body : {};
      if (e instanceof ApiError && e.status === 409 && Array.isArray(body.warnings)) { setPending((p) => (p ? { ...p, plan: { ...p.plan, warnings: body.warnings as Warn[] } } : p)); setResult({ tone: "error", text: "Tick the box to go ahead." }); }
      else if (e instanceof ApiError && e.status === 422 && Array.isArray(body.blockers)) { setPending((p) => (p ? { ...p, plan: { ...p.plan, blockers: body.blockers as Warn[] } } : p)); }
      else { setPending(null); setResult({ tone: "error", text: (e as Error).message, retry: action }); }
    } finally { setBusy(false); }
  }, [api, base, onChanged]);

  return {
    pending, result, busy, ack, setAck, preview,
    confirm: (typed?: string) => { if (pending) void send(pending.action.kind === "delete" ? { ...pending.action, confirmText: typed ?? "" } : pending.action, ack); },
    cancel: () => { setPending(null); setAck([]); },
    dismiss: () => setResult(null),
    /** Runs an action straight away (the person's click IS the confirm): used for undo, retry and one-tap call outcomes. */
    now: (action: Action) => void send(action, []),
  };
}
export type Runner = ReturnType<typeof useRunner>;

/** The review panel that slides up inside the lead panel: what will happen, what blocks it, what needs a tick, and the one button. */
export function ReviewSheet({ r, name }: { r: Runner; name: string }) {
  const p = r.pending;
  const [typed, setTyped] = useState("");
  if (!p && !r.result) return null;
  const blocked = (p?.plan.blockers.length ?? 0) > 0;
  const needsName = p?.typeName !== undefined;
  const nameOk = !needsName || typed.trim().toLowerCase() === (p?.typeName ?? "").trim().toLowerCase();
  const tickOk = (p?.plan.warnings ?? []).every((w) => r.ack.includes(w.id));
  const danger = p?.action.kind === "delete";
  return (
    <section className="border-t bg-popover px-5 py-4 shadow-[0_-8px_24px_-12px_rgba(0, 0, 0,0.25)]" aria-label="Review before it happens" data-testid="wb-review">
      {p && (
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[17px] font-semibold leading-snug" data-testid="wb-review-summary">{p.plan.summary}</p>
            <button type="button" aria-label="Cancel" onClick={() => { r.cancel(); setTyped(""); }} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
          </div>
          {p.quote && <blockquote className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-primary pl-3 text-[15px] leading-relaxed" data-testid="wb-review-quote">{p.quote}</blockquote>}
          {!p.mode.live && <p className="mt-2 text-sm text-muted-foreground" data-testid="wb-review-dry">{p.mode.demo ? "This is the demo: nothing is ever sent." : !p.mode.masterOn ? "Changes from SubSync are switched off, so confirming only records what would have happened. Nothing reaches your CRM." : "This account is not allowed to change things from SubSync yet (Settings), so confirming only records what would have happened."}</p>}
          {p.plan.blockers.length > 0 && <ul className="mt-2 space-y-1 text-[15px] font-medium text-destructive" data-testid="wb-review-blockers">{p.plan.blockers.map((b) => <li key={b.id}><ShieldAlert aria-hidden className="mr-1.5 inline size-4 align-text-bottom" />{b.text}</li>)}</ul>}
          {p.plan.warnings.map((w) => (
            <label key={w.id} className="mt-2 flex min-h-11 cursor-pointer items-start gap-2.5 text-[15px]">
              <input type="checkbox" className="mt-1 size-5 shrink-0" checked={r.ack.includes(w.id)} onChange={(e) => r.setAck(e.target.checked ? [...r.ack, w.id] : r.ack.filter((x) => x !== w.id))} data-testid="wb-ack" />
              <span>{w.text} I want to send it anyway.</span>
            </label>
          ))}
          {needsName && (
            <label className="mt-3 block text-sm">
              <span className="text-muted-foreground">This cannot be undone. Type <strong className="text-foreground">{p.typeName}</strong> to confirm.</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="mt-1 block min-h-11 w-full rounded-lg border bg-background px-3 text-[15px]" data-testid="wb-typed" />
            </label>
          )}
          {!p.plan.reversible && !needsName && <p className="mt-2 text-sm text-muted-foreground">This cannot be taken back once it is sent.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={r.busy || blocked || !tickOk || !nameOk} onClick={() => { r.confirm(typed); setTyped(""); }} className={danger ? wbButtons.DANGER : wbButtons.PRIMARY} data-testid="wb-confirm">{r.busy ? "Working..." : p.mode.live ? p.verb : "Record as a dry run"}</button>
            <button type="button" onClick={() => { r.cancel(); setTyped(""); }} className={wbButtons.BTN}>Cancel</button>
          </div>
        </div>
      )}
      {!p && r.result && (
        <div className="flex items-start justify-between gap-3" role="status" data-testid="wb-result" data-tone={r.result.tone}>
          <p className={`text-[15px] leading-snug ${r.result.tone === "error" ? "font-medium text-destructive" : ""}`}>
            {r.result.tone === "done" && <Check aria-hidden className="mr-1.5 inline size-4 align-text-bottom text-primary" />}
            {r.result.text}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {r.result.undo && <button type="button" onClick={() => { const u = r.result?.undo; if (u) r.now(u); }} className={wbButtons.BTN} data-testid="wb-undo"><RotateCcw aria-hidden className="size-4" />Undo</button>}
            {r.result.retry && <button type="button" onClick={() => { const u = r.result?.retry; if (u) r.now(u); }} className={wbButtons.BTN} data-testid="wb-retry">Try again</button>}
            <button type="button" aria-label="Dismiss" onClick={r.dismiss} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
          </div>
        </div>
      )}
      <span className="sr-only">{name}</span>
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}</label>;
}
export const INPUT = "block min-h-11 w-full rounded-lg border bg-background px-3 text-[15px] focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-10";
