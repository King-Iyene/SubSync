"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

// The account selector that belongs to ONE page (Today), not to the whole app: a button that says what is counted ("All client accounts" or "3 of 13"), and a
// list with search and a checkbox per account. Nothing picked means all. It draws only when there are at least two accounts to choose between, and the page
// never offers it to a client's staff. The choice is the page's to keep (in its own address and in this browser); this component only edits a list of ids.
export type PickerAccount = { id: string; name: string };

export function LocalAccountPicker({ accounts, picked, onChange, label = "Client accounts" }: { accounts: PickerAccount[]; picked: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const set = useMemo(() => new Set(picked), [picked]);
  const shown = useMemo(() => accounts.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())), [accounts, q]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (accounts.length < 2) return null;
  const toggle = (a: string) => onChange(set.has(a) ? picked.filter((x) => x !== a) : [...picked, a]);
  const summary = picked.length === 0 ? `All ${accounts.length}` : picked.length === 1 ? accounts.find((a) => a.id === picked[0])?.name ?? "1 account" : `${picked.length} of ${accounts.length}`;
  return (
    <div ref={box} className="relative" data-testid="today-account-picker">
      <button type="button" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => setOpen(!open)}
        className="ds-press inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border bg-card px-3 text-sm hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        <span className="text-muted-foreground">{label}</span>
        <span className="min-w-0 truncate font-medium">{summary}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={`Choose ${label.toLowerCase()}`} className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[85vw] rounded-xl border bg-popover p-2 shadow-[var(--shadow-lift)]">
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client account" aria-label="Find a client account"
              className="min-h-9 w-full rounded-lg border bg-card py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </label>
          <ul className="mt-2 max-h-64 overflow-y-auto">
            {shown.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No client account matches.</li>}
            {shown.map((a) => (
              <li key={a.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent">
                  <input type="checkbox" className="size-4" checked={set.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className="min-w-0 truncate">{a.name}</span>
                  {set.has(a.id) && <Check aria-hidden className="ml-auto size-4 shrink-0 text-primary" />}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            <button type="button" className="min-h-9 rounded-lg px-2 underline underline-offset-4 hover:bg-muted" onClick={() => onChange([])}>Show all accounts</button>
            <button type="button" className="min-h-9 rounded-lg bg-primary px-3 font-medium text-primary-foreground" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
