"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { money } from "@/lib/analytics/finance-core";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { useApiClient } from "../../session";
import { fnfxOn, msg, notSwitchedOn } from "./data";
import { sample } from "./fixtures";

// Small pieces shared by the Finance tabs. Plain words, one currency at a time, no scores without their formula.
export const NOT_FROM_PLATFORM = "Not available from the platform yet";
export const NOT_ENOUGH = "Not enough data";
export const num = (n: number) => n.toLocaleString("en-US");
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export const ago = (iso: string | null | undefined): string => { if (!iso) return "Never"; const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "Just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };

/** "$2,780 and EUR 90": one currency at a time, never a single added-up number. */
export function Money({ items, testId, empty = "No money yet" }: { items: ReadonlyArray<{ amount: number; currency: string }>; testId?: string; empty?: string }) {
  if (!items.length) return <span data-testid={testId}>{empty}</span>;
  return <span data-testid={testId}>{items.map((m, i) => <span key={m.currency}>{i ? " and " : ""}{money(m.amount, m.currency)}</span>)}</span>;
}

type Loaded<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };
/** Loading, error ("not switched on" is its own plain note) and empty states in one place. */
export function Load<T>({ r, children, empty, label = "Loading..." }: { r: Loaded<T>; children: (d: T) => ReactNode; empty?: (d: T) => boolean | string; label?: string }) {
  if (r.loading && !r.data) return <SkeletonRows rows={5} label={label} />;
  if (r.error && notSwitchedOn(r.error)) return <EmptyState title="Not switched on yet" body="This part of Finance is not switched on for your account yet." />;
  if (r.error) return <ErrorState error={r.error as Error} onRetry={r.reload} />;
  if (!r.data) return null;
  const e = empty ? empty(r.data) : false;
  return e ? <EmptyState title="Nothing to show yet" body={typeof e === "string" ? e : "Nothing here yet."} /> : <>{children(r.data)}</>;
}

/** The formula behind an estimate, one tap away. */
export function How({ title = "How this is worked out", children }: { title?: string; children: ReactNode }) {
  return <details className="fn-how"><summary>{title}</summary><p>{children}</p></details>;
}

export const SampleNote = () => <p className="fn-sample" role="status" data-testid="fn-sample">Sample data: these are not your real accounts, people or money, and nothing here is saved.</p>;

/** A destructive or locking change: the person types the exact name first. */
export function Typed({ name, verb, onConfirm, onCancel, busy }: { name: string; verb: string; onConfirm: (typed: string) => void; onCancel: () => void; busy?: boolean }) {
  const [t, setT] = useState("");
  const ok = t.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== "";
  return (
    <div className="fn-typed" role="group" aria-label={`Confirm: ${verb}`} data-testid="fn-typed">
      <span>To {verb}, type <b>{name}</b> below.</span>
      <input className="ap-field" value={t} onChange={(e) => setT(e.target.value)} aria-label={`Type ${name} to confirm`} autoFocus data-testid="fn-typed-input" />
      <span className="fn-end" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="s6-btn" data-kind="primary" disabled={!ok || busy} onClick={() => onConfirm(t)} data-testid="fn-typed-go">{verb[0].toUpperCase() + verb.slice(1)}</button>
        <button type="button" className="s6-btn" onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}

/** A searchable picker for client accounts or team members (50 or more of either). Asks the server for the best 20 matches as the person types; nothing is listed in full. */
export function Picker({ what, value, label, onPick, placeholder, clearable = false, testId }: { what: "account" | "person"; value: { id: string; name: string } | null; label: string; onPick: (v: { id: string; name: string } | null) => void; placeholder?: string; clearable?: boolean; testId?: string }) {
  const api = useApiClient(), fx = fnfxOn();
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [rows, setRows] = useState<Array<{ id: string; name: string }> | null>(null), [err, setErr] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const d = fx ? (sample("find", { what, q }, false) as { rows: Array<{ id: string; name: string }> }) : await api.get<{ rows: Array<{ id: string; name: string }> }>(`finance?part=find&what=${what}&q=${encodeURIComponent(q)}`);
        setRows(d.rows); setErr(false);
      } catch { setErr(true); }
    }, 200);
    return () => clearTimeout(t);
  }, [api, fx, open, q, what]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="fn-pick" ref={box} data-testid={testId}>
      <span className="ap-fine">{label}</span>
      <div className="flex gap-2">
        <button type="button" className="ap-field" style={{ textAlign: "left", cursor: "pointer", flex: 1 }} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{value ? value.name : placeholder ?? (what === "account" ? "Choose a client account" : "Choose a person")}</button>
        {clearable && value && <button type="button" className="ap-link" onClick={() => onPick(null)}>Clear</button>}
      </div>
      {open && (
        <div className="fn-pick-list" role="listbox" aria-label={label}>
          <input className="ap-field" style={{ width: "100%", borderRadius: 0 }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search" aria-label={`Search ${what === "account" ? "accounts" : "people"}`} data-testid="fn-pick-search" />
          {err ? <p className="ap-fine" style={{ padding: 8 }}>Could not search. Try again.</p> : rows === null ? <p className="ap-fine" style={{ padding: 8 }}>Searching...</p> : rows.length === 0 ? <p className="ap-fine" style={{ padding: 8 }}>No match.</p> : rows.map((r) => <button key={r.id} type="button" role="option" aria-selected={value?.id === r.id} onClick={() => { onPick(r); setOpen(false); setQ(""); }}>{r.name}</button>)}
        </div>
      )}
    </div>
  );
}

/** Wraps a write: shows the error in words and keeps the screen as it was. */
export function useAct(onDone?: () => void) {
  const [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (fnfxOn()) { setNote("Sample data: nothing is saved."); return; }
    setBusy(true); setNote(null);
    try { await fn(); if (ok) setNote(ok); onDone?.(); } catch (e) { setNote(msg(e)); } finally { setBusy(false); }
  };
  return { busy, note, setNote, run };
}
