"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { filterToParams, type SmartFilter } from "@/lib/people/filters";
import { BULK_MAX } from "@/lib/people/find";
import type { PersonRowOut } from "@/lib/people/types";
import { useApiClient } from "../session";
import { Btn, fmtInt, inputClass } from "../ui";

// Find a lead, the parts only the new search shows (flags fl_find and fl_bulk; docs/features/FINDLEAD_BRIEF.md): a searchable picker for the long lists (50 accounts, 60 owners, 300 tags),
// "Load more" that keeps its place on the server (a keyset, so page 5,000 is as quick as page 2), and the bar that appears when people are ticked: add a tag, add a note, export.
// Calm and flat: the ticked count, then plain buttons. Nothing here deletes anything, and nothing messages anybody.

export type PickOption = { value: string; label: string; hint?: string };

/** A select that can be typed into. The list shows the first 40 matches and says how many more there are, so a thousand options never become a thousand rows. */
export function SearchPick({ label, value, onChange, options, anyLabel, testId }: { label: string; value: string; onChange: (v: string) => void; options: PickOption[]; anyLabel: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const all = [{ value: "", label: anyLabel } as PickOption, ...options];
    return n ? all.filter((o) => o.value !== "" && o.label.toLowerCase().includes(n)) : all;
  }, [options, q, anyLabel]);
  const current = value ? options.find((o) => o.value === value)?.label ?? value : anyLabel;
  const close = useCallback(() => { setOpen(false); setQ(""); setAt(0); }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open, close]);
  const pick = (v: string) => { onChange(v); close(); };
  const LIMIT = 40;
  return (
    <div ref={box} className="relative" data-testid={testId}>
      <span className="mb-1 block text-xs font-medium" id={`${id}-l`}>{label}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-l ${id}-b`} id={`${id}-b`} onClick={() => setOpen(!open)}
        className={`${inputClass} flex min-h-11 items-center justify-between gap-2 text-left sm:min-h-10`}>
        <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>{current}</span><ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg border bg-card shadow-lg" role="presentation">
          <div className="relative border-b p-2">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input ref={input} type="search" value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder={`Find ${label.toLowerCase()}`} aria-label={`Find ${label.toLowerCase()}`} autoComplete="off" spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); close(); }
                else if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(Math.min(shown.length, LIMIT) - 1, at + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, at - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); const o = shown[at]; if (o) pick(o.value); }
              }}
              className={`${inputClass} min-h-10 pl-8`} />
          </div>
          <ul role="listbox" aria-label={label} className="max-h-60 overflow-y-auto py-1">
            {shown.slice(0, LIMIT).map((o, i) => (
              <li key={o.value || "any"} role="option" aria-selected={o.value === value}>
                <button type="button" onClick={() => pick(o.value)} onMouseEnter={() => setAt(i)} className={`flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm ${i === at ? "bg-accent" : ""}`}>
                  <span className="truncate">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">{o.hint}{o.value === value && <Check aria-hidden className="size-3.5 text-foreground" />}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Nothing matches. Check the spelling.</li>}
            {shown.length > LIMIT && <li className="px-3 py-2 text-xs text-muted-foreground">{fmtInt(shown.length - LIMIT)} more. Type to narrow the list.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------- Load more (keyset) ----------------

type FoundPage = { total: number | null; capped: boolean; next: string | null; rows: PersonRowOut[] };

/** The first page of a search, and "more" pages that carry on from where the last one ended. A new search (a new `key`) starts over. */
export function useFound(filter: SmartFilter | null) {
  const api = useApiClient();
  const key = filter ? JSON.stringify(filter) : null;
  const [state, setState] = useState<{ key: string | null; rows: PersonRowOut[]; total: number | null; capped: boolean; next: string | null; loading: boolean; error: string | null; busy: boolean }>({ key: null, rows: [], total: null, capped: false, next: null, loading: false, error: null, busy: false });
  const live = useRef<string | null>(null);
  const run = useCallback(async (after: string | null) => {
    if (!filter || !key) return;
    live.current = key;
    setState((s) => (after ? { ...s, busy: true } : { key, rows: [], total: null, capped: false, next: null, loading: true, error: null, busy: false }));
    try {
      const p = filterToParams(filter);
      if (after) p.set("after", after);
      const r = await api.get<FoundPage>(`people/find?${p.toString()}`);
      if (live.current !== key) return;
      setState((s) => ({ key, rows: after ? [...s.rows, ...r.rows] : r.rows, total: after ? s.total : r.total, capped: after ? s.capped : r.capped, next: r.next, loading: false, error: null, busy: false }));
    } catch (e) {
      if (live.current === key) setState((s) => ({ ...s, loading: false, busy: false, error: (e as Error).message || "Could not load people." }));
    }
  }, [api, filter, key]);
  useEffect(() => { if (key) void run(null); else { live.current = null; setState((s) => (s.key === null ? s : { ...s, key: null, rows: [], next: null })); } }, [key, run]);
  return { ...state, more: () => void run(state.next), reload: () => void run(null) };
}

// ---------------- the bar for ticked people ----------------

type Preview = { step: "preview"; line: string; will: number; already: number; notFound: number; dnd: number; names: string[] };
type Done = { step: "done"; message: string; done: number };

export function BulkBar({ picked, filter, canExport, onClear, onDone }: { picked: PersonRowOut[]; filter: SmartFilter; canExport: boolean; onClear: () => void; onDone: () => void }) {
  const api = useApiClient();
  const [mode, setMode] = useState<"tag" | "note" | null>(null);
  const [text, setText] = useState("");
  const [pre, setPre] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = picked.map((p) => ({ locationId: p.locationId, contactId: p.contactId }));
  const body = (step: "preview" | "do") => ({ action: mode, ...(mode === "tag" ? { tag: text } : { text }), targets, step, ...(step === "do" ? { confirm: true } : {}) });
  const reset = () => { setMode(null); setText(""); setPre(null); setErr(null); };
  const review = async () => { setBusy(true); setErr(null); try { setPre(await api.post<Preview>("people/bulk", body("preview"))); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); setErr(null); try { setDone(await api.post<Done>("people/bulk", body("do"))); reset(); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const doExport = async () => { setErr(null); try { await api.download(`people/export?${filterToParams(filter).toString()}`, "people.csv"); } catch (e) { setErr((e as Error).message); } };
  if (picked.length === 0 && !done) return canExport ? <div className="mb-2 flex justify-end"><Btn variant="secondary" onClick={() => void doExport()} testId="find-export">Export these people (CSV)</Btn></div> : null;
  return (
    <div className="mb-3 rounded-lg border bg-card p-3" role="region" aria-label="Change the ticked people" data-testid="bulk-bar">
      {done && <p className="mb-2 text-sm" role="status" data-testid="bulk-done">{done.message}</p>}
      {picked.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" data-testid="bulk-count">{picked.length} ticked</span>
            {picked.length > BULK_MAX && <span className="text-xs text-destructive">You can change up to {BULK_MAX} at a time.</span>}
            <Btn variant="secondary" disabled={picked.length > BULK_MAX} onClick={() => { setMode("tag"); setPre(null); setDone(null); }} testId="bulk-tag">Add a tag</Btn>
            <Btn variant="secondary" disabled={picked.length > BULK_MAX} onClick={() => { setMode("note"); setPre(null); setDone(null); }} testId="bulk-note">Add a note</Btn>
            {canExport && <Btn variant="ghost" onClick={() => void doExport()} testId="find-export">Export (CSV)</Btn>}
            <Btn variant="ghost" onClick={() => { reset(); onClear(); }}>Untick all</Btn>
          </div>
          {mode && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium" htmlFor="bulk-text">{mode === "tag" ? "Tag to add (up to 60 characters)" : "Note to add (kept in your CRM on each person)"}</label>
              {mode === "tag"
                ? <input id="bulk-text" className={`${inputClass} max-w-sm`} value={text} onChange={(e) => { setText(e.target.value); setPre(null); }} maxLength={60} data-testid="bulk-text" />
                : <textarea id="bulk-text" className={`${inputClass} max-w-xl`} rows={3} value={text} onChange={(e) => { setText(e.target.value); setPre(null); }} maxLength={2000} data-testid="bulk-text" />}
              {!pre && <Btn onClick={() => void review()} disabled={busy || !text.trim()} testId="bulk-review">{busy ? "Checking..." : "See what will change"}</Btn>}
              {pre && (
                <div data-testid="bulk-preview">
                  <p className="text-sm">{pre.line}</p>
                  {pre.names.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{pre.names.join(", ")}{pre.will > pre.names.length ? ` and ${pre.will - pre.names.length} more` : ""}</p>}
                  <p className="mt-2 flex flex-wrap gap-2">
                    <Btn variant="primary" onClick={() => void apply()} disabled={busy || pre.will === 0} testId="bulk-confirm">{busy ? "Saving..." : `Save to ${pre.will} ${pre.will === 1 ? "person" : "people"}`}</Btn>
                    <Btn variant="ghost" onClick={reset}>Cancel</Btn>
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {err && <p className="mt-2 text-sm text-destructive" role="alert">{err}</p>}
    </div>
  );
}
