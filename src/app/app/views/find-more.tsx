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
  // The newest choices are read from here, so the loader depends on the key (the text of the choices) only: a new object with the same choices must never start another read.
  const latest = useRef(filter);
  useEffect(() => { latest.current = filter; });
  const run = useCallback(async (after: string | null) => {
    const filter = latest.current;
    if (!filter || !key) return;
    live.current = key;
    // A new search (another key) starts empty. Reading the SAME search again (a refresh) keeps the people on screen until the new answer lands, so rows are never torn out from under someone who is working on one.
    setState((s) => (after ? { ...s, busy: true } : s.key === key && s.rows.length > 0 ? { ...s, loading: false, busy: true, error: null } : { key, rows: [], total: null, capped: false, next: null, loading: true, error: null, busy: false }));
    try {
      const p = filterToParams(filter);
      if (after) p.set("after", after);
      const r = await api.get<FoundPage>(`people/find?${p.toString()}`);
      if (live.current !== key) return;
      setState((s) => ({ key, rows: after ? [...s.rows, ...r.rows.filter((n) => !s.rows.some((o) => o.rowId === n.rowId))] : r.rows, total: after ? s.total : r.total, capped: after ? s.capped : r.capped, next: r.next, loading: false, error: null, busy: false }));
    } catch (e) {
      if (live.current === key) setState((s) => ({ ...s, loading: false, busy: false, error: (e as Error).message || "Could not load people." }));
    }
  }, [api, key]);
  useEffect(() => { if (key) void run(null); else { live.current = null; setState((s) => (s.key === null ? s : { ...s, key: null, rows: [], next: null })); } }, [key, run]);
  return { ...state, more: () => void run(state.next), reload: () => void run(null) };
}

// ---------------- the bar for ticked people ----------------

type Preview = { step: "preview"; line: string; will: number; already: number; notFound: number; dnd: number; names: string[] };
type Done = { step: "done"; message: string; done: number };

type OwnerPlan = { plan: { change: Array<{ contactId: string; name: string; from: string }>; same: number; protected: Array<{ name: string; reasons: string[] }>; overCap: number; cap: number; blockers: Array<{ id: string; text: string }>; needsTick: string[]; summary: string }; needsPermission: boolean };
type OwnerDone = { ok?: boolean; batchId?: string; message?: string; undoable?: boolean; undoMinutes?: number };

export function BulkBar({ picked, filter, canExport, owners = [], canOwner = false, onClear, onDone }: { picked: PersonRowOut[]; filter: SmartFilter; canExport: boolean; owners?: Array<{ id: string; name: string; count: number }>; canOwner?: boolean; onClear: () => void; onDone: () => void }) {
  const api = useApiClient();
  const [mode, setMode] = useState<"tag" | "note" | "owner" | null>(null);
  const [toUser, setToUser] = useState("");
  const [ownerPre, setOwnerPre] = useState<OwnerPlan | null>(null);
  const [ticks, setTicks] = useState<string[]>([]);
  const [ownerDone, setOwnerDone] = useState<OwnerDone | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  // Change owner works on one client account at a time (the platform rule of the Team actions): the ticked people must all be in the same one.
  const accounts = new Set(picked.map((p) => p.locationId));
  const oneAccount = accounts.size === 1 ? [...accounts][0] : null;
  const ownerBody = (step: "preview" | "do") => ({ locationId: oneAccount, contactIds: picked.map((p) => p.contactId), toUserId: toUser, step, ...(step === "do" ? { acks: ticks } : {}) });
  const reviewOwner = async () => { setBusy(true); setErr(null); try { setOwnerPre(await api.post<OwnerPlan>("people3/act/reassign", ownerBody("preview"))); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const applyOwner = async () => { setBusy(true); setErr(null); try { setOwnerDone(await api.post<OwnerDone>("people3/act/reassign", ownerBody("do"))); setOwnerPre(null); setMode(null); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const undoOwner = async () => { try { const r = await api.post<{ message?: string }>("people3/act/undo", { locationId: oneAccount, batchId: ownerDone?.batchId, step: "do" }); setUndone(r.message ?? "Put back."); onDone(); } catch (e) { setUndone((e as Error).message); } };
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
  if (picked.length === 0 && !done && !ownerDone) return canExport ? <div className="mb-2 flex justify-end"><Btn variant="secondary" onClick={() => void doExport()} testId="find-export">Export these people (CSV)</Btn></div> : null;
  return (
    <div className="mb-3 rounded-lg border bg-card p-3" role="region" aria-label="Change the ticked people" data-testid="bulk-bar">
      {done && <p className="mb-2 text-sm" role="status" data-testid="bulk-done">{done.message}</p>}
      {ownerDone && <p className="mb-2 flex flex-wrap items-center gap-2 text-sm" role="status" data-testid="bulk-owner-done">{ownerDone.message ?? "Done."}{ownerDone.undoable && ownerDone.batchId && !undone && <Btn variant="secondary" onClick={() => void undoOwner()} testId="bulk-owner-undo">Undo (open for {ownerDone.undoMinutes ?? 30} min)</Btn>}{undone && <span className="text-muted-foreground">{undone}</span>}</p>}
      {picked.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" data-testid="bulk-count">{picked.length} ticked</span>
            {picked.length > BULK_MAX && <span className="text-xs text-destructive">You can change up to {BULK_MAX} at a time.</span>}
            <Btn variant="secondary" disabled={picked.length > BULK_MAX} onClick={() => { setMode("tag"); setPre(null); setDone(null); }} testId="bulk-tag">Add a tag</Btn>
            <Btn variant="secondary" disabled={picked.length > BULK_MAX} onClick={() => { setMode("note"); setPre(null); setDone(null); }} testId="bulk-note">Add a note</Btn>
            {canOwner && <Btn variant="secondary" disabled={!oneAccount} title={oneAccount ? undefined : "Tick people from one client account to change their owner"} onClick={() => { setMode("owner"); setOwnerPre(null); setOwnerDone(null); setDone(null); }} testId="bulk-owner">Change owner</Btn>}
            {canExport && <Btn variant="ghost" onClick={() => void doExport()} testId="find-export">Export (CSV)</Btn>}
            <Btn variant="ghost" onClick={() => { reset(); onClear(); }}>Untick all</Btn>
          </div>
          {mode === "owner" && oneAccount && (
            <div className="mt-3 max-w-md space-y-2" data-testid="bulk-owner-panel">
              <SearchPick label="New owner" value={toUser} onChange={(v) => { setToUser(v); setOwnerPre(null); setTicks([]); }} anyLabel="Choose a team member" options={owners.map((o) => ({ value: o.id, label: o.name, hint: String(o.count) }))} testId="bulk-owner-pick" />
              {!ownerPre && <Btn onClick={() => void reviewOwner()} disabled={busy || !toUser} testId="bulk-owner-review">{busy ? "Checking..." : "See what will change"}</Btn>}
              {ownerPre && (
                <div data-testid="bulk-owner-preview">
                  <p className="text-sm">{ownerPre.plan.summary}</p>
                  {ownerPre.plan.change.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{ownerPre.plan.change.slice(0, 8).map((c) => `${c.name} (from ${c.from})`).join(", ")}{ownerPre.plan.change.length > 8 ? ` and ${ownerPre.plan.change.length - 8} more` : ""}</p>}
                  {ownerPre.plan.protected.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Left alone: {ownerPre.plan.protected.slice(0, 4).map((x) => `${x.name} (${x.reasons[0] ?? "protected"})`).join("; ")}</p>}
                  {ownerPre.plan.overCap > 0 && <p className="mt-1 text-xs text-muted-foreground">{ownerPre.plan.overCap} are over the limit of {ownerPre.plan.cap} at a time. Run it again for those.</p>}
                  {ownerPre.plan.blockers.map((b) => <p key={b.id} className="mt-1 text-sm text-destructive" role="alert">{b.text}</p>)}
                  {ownerPre.needsPermission && <p className="mt-1 text-sm text-destructive" role="alert">Needs permission: reconnect SubSync so it may change who owns a lead.</p>}
                  {ownerPre.plan.needsTick.map((t) => <label key={t} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={ticks.includes(t)} onChange={(e) => setTicks(e.target.checked ? [...ticks, t] : ticks.filter((x) => x !== t))} />I checked this before moving it</label>)}
                  <p className="mt-2 flex flex-wrap gap-2"><Btn variant="primary" onClick={() => void applyOwner()} disabled={busy || ownerPre.plan.change.length === 0 || ownerPre.plan.blockers.length > 0 || ownerPre.needsPermission || !ownerPre.plan.needsTick.every((t) => ticks.includes(t))} testId="bulk-owner-confirm">{busy ? "Saving..." : `Move ${ownerPre.plan.change.length} ${ownerPre.plan.change.length === 1 ? "person" : "people"}`}</Btn><Btn variant="ghost" onClick={() => { setMode(null); setOwnerPre(null); }}>Cancel</Btn></p>
                </div>
              )}
            </div>
          )}
          {mode && mode !== "owner" && (
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
