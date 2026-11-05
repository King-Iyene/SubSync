"use client";

import { Bookmark, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "./portal-root";
import { describeTodayView, type TodayView } from "@/lib/analytics/today-palette";
import { useApiClient, useData } from "../session";

// Saved views of Today: "Views" opens a small list of the person's own saved views (press one to apply it), with a name box to save the current choice. A view keeps only
// which client accounts and the junk switch. It draws in its own layer on the page, like the account list, so nothing clips or covers it.
type Saved = { id: string; name: string; view: TodayView };
type Listing = { views: Saved[]; max: number };

export function ViewsMenu({ current, names, onApply, open: controlled, onOpenChange, hideTrigger = false }: {
  current: TodayView; names: ReadonlyMap<string, string>; onApply: (v: TodayView) => void;
  /** Controlled use: the page's "More" menu opens it, so it draws no button of its own and places itself at the top right. */
  open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean;
}) {
  const api = useApiClient();
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = useCallback((v: boolean | ((o: boolean) => boolean)) => { const next = typeof v === "function" ? v(open) : v; if (onOpenChange) onOpenChange(next); else setOwn(next); }, [open, onOpenChange]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const list = useData<Listing>(open ? "today/views" : null);
  const [saved, setSaved] = useState<Listing | null>(null);
  const views = saved?.views ?? list.data?.views ?? [];
  const max = saved?.max ?? list.data?.max ?? 10;

  const measure = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 328)), top: r.bottom + 4 });
    else setPos({ left: Math.max(8, window.innerWidth - 336), top: 120 });
  }, []);
  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const t = e.target as Node; if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc, true);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, measure, setOpen]);

  const save = async () => {
    setMsg(null);
    try { setSaved(await api.post<Listing>("today/views", { name, accounts: current.accounts, excludeJunk: current.excludeJunk })); setName(""); setMsg("Saved."); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not save the view."); }
  };
  const remove = async (v: Saved) => {
    setMsg(null);
    try { setSaved(await api.del<Listing>(`today/views/${v.id}`)); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not remove the view."); }
  };

  return (
    <>
      {!hideTrigger && <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)} data-testid="views-button"
        className="ds-press inline-flex min-h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] print:hidden">
        <Bookmark aria-hidden className="size-4 text-muted-foreground" />Views
      </button>}
      {open && pos && createPortal(
        <div ref={panel} id={id} role="dialog" aria-label="Saved views of Today" data-testid="views-popover" style={{ position: "fixed", left: pos.left, top: pos.top, width: "min(320px, calc(100vw - 16px))", zIndex: 60 }}
          className="rounded-[6px] border border-[var(--t-rule2)] bg-popover p-2 text-sm text-popover-foreground shadow-[var(--shadow-lift)] print:hidden">
          <ul className="max-h-60 overflow-y-auto" data-testid="views-list">
            {views.length === 0 && <li className="px-2 py-2 text-muted-foreground">{list.loading && !saved ? "Loading" : "No saved views yet."}</li>}
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <button type="button" onClick={() => { onApply(v.view); setOpen(false); }} data-testid="views-apply" className="min-h-10 min-w-0 flex-1 rounded-lg px-2 text-left hover:bg-accent">
                  <span className="block truncate font-medium">{v.name}</span><span className="block truncate text-xs text-muted-foreground">{describeTodayView(v.view, names)}</span>
                </button>
                <button type="button" aria-label={`Remove the view ${v.name}`} onClick={() => void remove(v)} className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><Trash2 aria-hidden className="size-4" /></button>
              </li>
            ))}
          </ul>
          <form className="mt-2 border-t pt-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
            <p className="mb-1 px-1 text-xs text-muted-foreground">Save this view: {describeTodayView(current, names)}.</p>
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name this view" aria-label="Name this view" data-testid="views-name" className="min-h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
              <button type="submit" disabled={!name.trim() || views.length >= max} data-testid="views-save" className="min-h-9 rounded-lg bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50">Save</button>
            </div>
            {views.length >= max && <p className="mt-1 px-1 text-xs text-muted-foreground">You can keep {max} views. Remove one to add another.</p>}
            {msg && <p className="mt-1 px-1 text-xs" role="status">{msg}</p>}
          </form>
        </div>, portalRoot())}
    </>
  );
}
