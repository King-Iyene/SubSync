"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LeadDrawer } from "../ds";
import { remember } from "../ds/remember";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { toSeed, type PersonUi } from "./people-module";

// The search box in the header (Ctrl or Cmd + K, or press "/" when no field is open): find any person in every client account the signed-in person may see, and
// open their panel without leaving the page. Searching across accounts is the one thing the CRM cannot do. "See all results" opens Search and filters with the words.
export function GlobalSearch({ go }: { go: GoFn }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lead, setLead] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setOpen(true); }
      else if (e.key === "Escape") setOpen((o) => (lead === null ? false : o));
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [lead]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const { data, loading, error } = useData<{ rows: PersonUi[]; total: number }>(open && debounced.length >= 2 ? `people/search?q=${encodeURIComponent(debounced)}&page=1` : null);
  const rows = (data?.rows ?? []).slice(0, 8);
  // Enter below calls preventDefault: the panel moves focus to its Close button, which would otherwise take this same Enter as a click.
  const close = () => { setOpen(false); setQ(""); setDebounced(""); setLead(null); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ds-press inline-flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground print:hidden" data-testid="global-search-open" aria-label="Search people, Control K">
        <Search aria-hidden className="size-4" /><span className="hidden sm:inline">Search people</span> <kbd className="hidden font-sans text-xs text-muted-foreground sm:inline">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-40 print:hidden" data-testid="global-search">
          <div className="absolute inset-0 bg-black/45" onClick={close} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Search people" className="absolute left-1/2 top-[12vh] w-[min(40rem,94vw)] -translate-x-1/2 border bg-popover text-popover-foreground shadow-[var(--shadow-lift)]">
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone, across every client account..." maxLength={100} aria-label="Search people"
              onKeyDown={(e) => { if (e.key === "Enter" && rows.length > 0) { e.preventDefault(); setLead(0); } if (e.key === "Escape") close(); }}
              className="w-full border-b bg-transparent px-4 py-3 text-base outline-none" data-testid="global-search-input" />
            <div className="max-h-[50vh] overflow-y-auto" aria-live="polite">
              {debounced.length < 2 ? <p className="px-4 py-3 text-sm text-muted-foreground">Type at least two letters. Partial names, emails and the last digits of a phone number all work.</p>
                : loading && !data ? <p className="px-4 py-3 text-sm text-muted-foreground">Searching...</p>
                : error ? <p className="px-4 py-3 text-sm text-destructive" role="alert">{error.message}</p>
                : rows.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Nobody matches &quot;{debounced}&quot;. Check the spelling, or try part of the email.</p>
                : (
                  <ul className="divide-y" data-testid="global-search-results">
                    {rows.map((r, i) => (
                      <li key={`${r.locationId}:${r.contactId}`}>
                        <button type="button" onClick={() => setLead(i)} className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted">
                          <span className="min-w-0"><span className="font-medium">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{r.email ?? r.phone ?? "No email or phone"}</span></span>
                          <span className="shrink-0 truncate text-xs text-muted-foreground">{r.locationName ?? ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
            {data && data.total > 0 && <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground"><span>{data.total} {data.total === 1 ? "match" : "matches"}</span><button type="button" className="min-h-8 font-medium text-primary underline" onClick={() => { remember("people-q", debounced); close(); go("search"); }}>See all results</button></div>}
          </div>
          <LeadDrawer leads={rows.map(toSeed)} index={lead} onIndex={setLead} onClose={() => setLead(null)} />
        </div>
      )}
    </>
  );
}
