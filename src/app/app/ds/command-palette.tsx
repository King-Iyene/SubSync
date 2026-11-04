"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterCommands, type PaletteCommand } from "@/lib/analytics/today-palette";

// Today's command palette: Ctrl or Cmd + K opens a small search over what a person can do on this page (jump to a part of the page, open the list behind a number, narrow to
// a client account, switch the junk-deal control, share, print, run a saved view). Arrow keys move, Enter runs, Esc closes. While Today is open this takes Ctrl K from the
// shared people search; the first line of the list is "Search people" so that is one key press away, not lost. Every command is also a button on the page: the palette
// is a shortcut, never the only way in.
export function CommandPalette({ commands, label = "Commands" }: { commands: PaletteCommand[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const listId = useId();
  const shown = useMemo(() => filterCommands(commands, q).slice(0, 40), [commands, q]);
  const active = Math.min(at, Math.max(0, shown.length - 1));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault(); e.stopPropagation();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((o) => !o); setQ(""); setAt(0);
      }
    };
    // Capture phase on the window: this runs before the shared people search listens, and only while this page is on screen.
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  const close = () => { setOpen(false); setQ(""); const back = opener.current; opener.current = null; if (back && document.contains(back)) setTimeout(() => back.focus(), 0); };
  const run = (c: PaletteCommand | undefined) => { if (!c || c.disabled) return; close(); setTimeout(() => c.run(), 0); };

  return (
    <>
      <button type="button" onClick={() => { opener.current = document.activeElement as HTMLElement | null; setOpen(true); setQ(""); setAt(0); }} data-testid="palette-open" aria-haspopup="dialog"
        className="ds-press inline-flex min-h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] print:hidden">
        <Search aria-hidden className="size-4" /><span>{label}</span><kbd className="font-sans text-xs">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 print:hidden" data-testid="palette">
          <div className="absolute inset-0 bg-black/50" onMouseDown={close} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Commands for Today" className="absolute left-1/2 top-[12vh] w-[min(38rem,94vw)] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[var(--shadow-lift)]">
            <div className="flex items-center gap-2 border-b px-4">
              <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder="Type what you want to do or find..." aria-label="Search commands" data-testid="palette-input"
                role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={shown[active] ? `${listId}-${shown[active].id}` : undefined}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(shown.length - 1, active + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, active - 1)); }
                  else if (e.key === "Enter") { e.preventDefault(); run(shown[active]); }
                  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
                }}
                className="min-h-12 w-full bg-transparent py-3 text-base outline-none" />
            </div>
            <ul id={listId} role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto py-1" data-testid="palette-list">
              {shown.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground" role="presentation">Nothing matches &quot;{q}&quot;.</li>}
              {shown.map((c, n) => (
                <li key={c.id} id={`${listId}-${c.id}`} role="option" aria-selected={n === active} aria-disabled={c.disabled || undefined} data-testid="palette-item"
                  onMouseMove={() => setAt(n)} onClick={() => run(c)}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm ${n === active ? "bg-accent" : ""} ${c.disabled ? "opacity-50" : ""}`}>
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{c.group}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.title}</span>{c.hint && <span className="block truncate text-xs text-muted-foreground">{c.hint}</span>}</span>
                  {n === active && <CornerDownLeft aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                </li>
              ))}
            </ul>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">Up and down to choose, Enter to run, Esc to close.</p>
          </div>
        </div>
      )}
    </>
  );
}
