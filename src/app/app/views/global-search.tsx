"use client";

import { ExternalLink, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchTerm } from "@/lib/people/queue";
import { ActionStrip, LeadDrawer, useContactActions } from "../ds";
import { handOff } from "../ds/remember";
import { useApiClient, useData } from "../session";
import type { GoFn } from "../nav";
import { actionPerson, toSeed, type PersonUi } from "./people-rows";

// The search box in the header (Ctrl or Cmd + K, or press "/" when no field is open): find any person in every client account the signed-in person may see, and open their panel
// without leaving the page. Searching across accounts is the one thing the CRM cannot do. Arrow keys move down the results and Enter opens one; each result has a Call button
// (it opens the CRM, see ds/contact-actions.tsx). With nothing typed it offers the last searches and the people opened lately. "See all results" opens Find and call with the words.
export function GlobalSearch({ go }: { go: GoFn }) {
  const api = useApiClient();
  const actions = useContactActions();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lead, setLead] = useState<number | null>(null);
  const [hi, setHi] = useState(0);
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

  const term = searchTerm(debounced);
  const { data, loading, error } = useData<{ rows: PersonUi[]; total: number; capped?: boolean }>(open && term.ok ? `people/search?q=${encodeURIComponent(term.q)}&page=1` : null);
  const recent = useData<{ queries: string[]; people: PersonUi[] }>(open && !term.ok ? "people/recent" : null);
  const rows = (data?.rows ?? []).slice(0, 8);
  const shownRows = term.ok ? rows : (recent.data?.people ?? []).slice(0, 5);
  const at = Math.min(hi, Math.max(0, shownRows.length - 1));
  const remember = (words: string) => { const t = searchTerm(words); if (t.ok) void api.post("people/recent", { q: t.q }).catch(() => undefined); };
  const close = () => { setOpen(false); setQ(""); setDebounced(""); setLead(null); setHi(0); };
  const openAt = (i: number) => { if (term.ok) remember(term.q); setLead(i); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ds-press inline-flex min-h-11 min-w-11 items-center sm:min-h-9 sm:min-w-0 gap-2 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground print:hidden" data-testid="global-search-open" aria-label="Search people, Control K">
        <Search aria-hidden className="size-4" /><span className="hidden sm:inline">Search people</span> <kbd className="hidden font-sans text-xs text-muted-foreground sm:inline">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-40 print:hidden" data-testid="global-search">
          <div className="absolute inset-0 bg-black/45" onClick={close} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Search people" className="absolute left-1/2 top-[12vh] w-[min(40rem,94vw)] -translate-x-1/2 border bg-popover text-popover-foreground shadow-[var(--shadow-lift)]">
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder="Name, email or phone, across every client account..." maxLength={100} aria-label="Search people" role="combobox" aria-expanded={shownRows.length > 0} aria-controls={shownRows.length > 0 ? "global-search-results" : undefined} aria-activedescendant={shownRows.length > 0 ? `gs-row-${at}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && shownRows.length > 0) { e.preventDefault(); setHi((i) => Math.min(shownRows.length - 1, i + 1)); }
                else if (e.key === "ArrowUp" && shownRows.length > 0) { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
                // Enter below calls preventDefault: the panel moves focus to its Close button, which would otherwise take this same Enter as a click.
                else if (e.key === "Enter" && shownRows.length > 0) { e.preventDefault(); openAt(at); }
                else if (e.key === "Escape") close();
              }}
              className="w-full border-b bg-transparent px-4 py-3 text-base outline-none" data-testid="global-search-input" />
            <div className="max-h-[50vh] overflow-y-auto" aria-live="polite">
              {!term.ok ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  <p>{debounced.length === 0 ? "Type a name, an email, or the last digits of a phone number." : "Type at least two letters, or three digits of a phone number. Partial names, emails and the last digits of a phone number all work."}</p>
                  {(recent.data?.queries.length ?? 0) > 0 && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-2" data-testid="gs-recent-searches"><span className="text-xs">Recent searches</span>{recent.data!.queries.slice(0, 4).map((w) => <button key={w} type="button" onClick={() => { setQ(w); setDebounced(w); input.current?.focus(); }} className="min-h-9 px-1 font-medium text-foreground hover:underline">{w}</button>)}</p>
                  )}
                  {shownRows.length > 0 && <p className="mt-2 text-xs">Recently opened</p>}
                </div>
              ) : loading && !data ? <p className="px-4 py-3 text-sm text-muted-foreground">Searching...</p>
                : error ? <p className="px-4 py-3 text-sm text-destructive" role="alert">{error.message}</p>
                : rows.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Nobody matches &quot;{debounced}&quot;. Check the spelling, or try part of the email.</p> : null}
              {shownRows.length > 0 && (
                <ul id="global-search-results" role="listbox" aria-label="People" className="divide-y" data-testid="global-search-results">
                  {shownRows.map((r, i) => {
                    const p = actionPerson(r, `gs:${r.rowId}`);
                    return (
                      <li key={r.rowId} id={`gs-row-${i}`} role="option" aria-selected={i === at} data-testid="gs-row" className={`grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-3 px-4 py-2 ${i === at ? "bg-accent" : ""}`} onMouseEnter={() => setHi(i)}>
                        <button type="button" tabIndex={-1} onClick={() => openAt(i)} className="min-h-11 min-w-0 text-left text-sm sm:min-h-9">
                          <span className="block truncate font-medium">{r.name}{r.dnd ? <span className="ml-2 text-xs font-medium text-warning">Do not disturb</span> : null}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[r.phone ?? r.email ?? "No email or phone", r.locationName].filter(Boolean).join(" · ")}</span>
                        </button>
                        {r.phone
                          ? <button type="button" tabIndex={-1} onClick={() => actions.call(p)} className="ds-press inline-flex h-11 items-center justify-center gap-1.5 rounded-md border bg-card px-2 text-sm font-medium hover:bg-accent sm:h-8" data-testid="gs-call">Call<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> {r.name}, in your CRM</span></button>
                          : <span />}
                        <div className="col-span-full empty:hidden"><ActionStrip actions={actions} k={p.key} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {term.ok && data && data.total > 0 && <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground"><span>{data.total.toLocaleString("en-US")}{data.capped ? "+" : ""} {data.total === 1 ? "match" : "matches"}. Up and down move, Enter opens.</span><button type="button" className="min-h-9 font-medium text-primary underline" onClick={() => { remember(debounced); handOff("people-q", debounced); close(); go("search"); }}>See all results</button></div>}
          </div>
          <LeadDrawer leads={shownRows.map(toSeed)} index={lead} onIndex={setLead} onClose={() => setLead(null)} />
        </div>
      )}
    </>
  );
}
