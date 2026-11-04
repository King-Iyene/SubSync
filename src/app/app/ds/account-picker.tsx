"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The account selector that belongs to ONE page (Today), not to the whole app: a button that says what is counted ("All 13" or "3 of 13"), and a list with search and a
// checkbox per account. Nothing ticked means every account. It draws only when there are at least two accounts to choose between, and the page never offers it to a
// client's staff. The choice is the page's to keep (in its own address and in this browser); this component only edits a list of ids.
//
// The list opens in a layer of its own on the page (a portal with fixed placement), so no card, scroll area or sticky bar around the button can clip it or sit on top of
// its footer, and its height is fitted to the window with the footer always in view. Every row ticks on a click anywhere on the row. "Show all accounts" clears the choice
// (every account) and closes the list; "Done" closes it (the choice already applied as it was made, so no way of closing it loses a choice); Esc and a click outside close it.
export type PickerAccount = { id: string; name: string };

const WIDTH = 320;
type Place = { left: number; top: number | null; bottom: number | null; maxHeight: number };

export function LocalAccountPicker({ accounts, picked, onChange, label = "Client accounts" }: { accounts: PickerAccount[]; picked: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const set = useMemo(() => new Set(picked), [picked]);
  const shown = useMemo(() => accounts.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())), [accounts, q]);

  const close = useCallback((back = true) => { setOpen(false); setQ(""); if (back) button.current?.focus(); }, []);

  const measure = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - Math.min(WIDTH, vw - 16) - 8));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    // Below the button when there is room for a useful list, above it when that is clearly roomier.
    if (below >= 280 || below >= above) setPlace({ left, top: r.bottom + 4, bottom: null, maxHeight: Math.max(180, below) });
    else setPlace({ left, top: null, bottom: vh - r.top + 4, maxHeight: Math.max(180, above) });
  }, []);

  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      close(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true);
    };
  }, [open, close, measure]);

  if (accounts.length < 2) return null;
  const toggle = (a: string) => onChange(set.has(a) ? picked.filter((x) => x !== a) : [...picked, a]);
  const summary = picked.length === 0 ? `All ${accounts.length}` : picked.length === 1 ? accounts.find((a) => a.id === picked[0])?.name ?? "1 account" : `${picked.length} of ${accounts.length}`;
  const row = "flex min-h-10 w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-accent";
  return (
    <div className="relative" data-testid="today-account-picker">
      <button ref={button} type="button" aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" onClick={() => (open ? close() : setOpen(true))} data-testid="picker-button"
        className="ds-press inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border bg-card px-3 text-sm hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        <span className="text-muted-foreground">{label}</span>
        <span className="min-w-0 truncate font-medium" data-testid="picker-summary">{summary}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && place && createPortal(
        <div ref={panel} id={id} role="dialog" aria-label={`Choose ${label.toLowerCase()}`} data-testid="picker-popover"
          className="fixed z-[70] flex flex-col rounded-xl border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-lift)]"
          style={{ left: place.left, top: place.top ?? undefined, bottom: place.bottom ?? undefined, width: `min(${WIDTH}px, calc(100vw - 16px))`, maxHeight: place.maxHeight }}>
          <label className="relative block shrink-0">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client account" aria-label="Find a client account"
              className="min-h-9 w-full rounded-lg border bg-card py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </label>
          <ul className="mt-2 min-h-0 flex-1 overflow-y-auto" data-testid="picker-list">
            {shown.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No client account matches.</li>}
            {shown.map((a) => (
              <li key={a.id}>
                <label className={row}>
                  <input type="checkbox" className="size-4 shrink-0" checked={set.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {set.has(a.id) && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t pt-2 text-sm">
            <button type="button" className="min-h-10 rounded-lg px-2 underline underline-offset-4 hover:bg-muted" data-testid="picker-all" onClick={() => { onChange([]); close(); }}>Show all accounts</button>
            <button type="button" className="min-h-10 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90" data-testid="picker-done" onClick={() => close()}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
