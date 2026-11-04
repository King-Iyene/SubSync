"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

// The command palette of the Workflows page: Ctrl or Cmd + Shift + K. It finds a page, an action, a saved view or one workflow or campaign by name, and runs it.
// Ctrl K stays the people search of the whole app. Arrow keys move, Enter runs, Esc closes; every row is also a button you can press.
export type Command = { id: string; group: "Go to" | "Do" | "Saved views" | "Items"; label: string; hint?: string; run: () => void };

export function WfPalette({ commands, items, onClose }: { commands: Command[]; items: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const match = (c: Command) => !t || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(t);
    return [...commands.filter(match), ...(t ? items.filter(match).slice(0, 8) : [])];
  }, [q, commands, items]);
  const cur = Math.min(at, Math.max(0, rows.length - 1));
  const run = (c: Command | undefined) => { if (!c) return; onClose(); c.run(); };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh]" data-testid="wf-palette" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-2xl border bg-background shadow-xl">
        <label className="flex items-center gap-2 border-b px-4"><Search aria-hidden className="size-4 text-muted-foreground" />
          <span className="sr-only">Type a page, an action or a name</span>
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder="Type a page, an action or a workflow name" data-testid="wf-palette-input" className="h-12 w-full bg-transparent text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(rows.length - 1, cur + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, cur - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(rows[cur]); }
            }} />
        </label>
        <ul role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-1">
          {rows.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches.</li> : rows.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === cur}>
              <button type="button" onClick={() => run(c)} onMouseEnter={() => setAt(i)} data-testid="wf-palette-row" className={`grid min-h-10 w-full grid-cols-[5.5rem_1fr_auto] items-center gap-2 rounded-lg px-3 text-left text-sm ${i === cur ? "bg-accent" : ""}`}>
                <span className="text-xs text-muted-foreground">{c.group}</span><span className="truncate">{c.label}</span><span className="truncate text-xs text-muted-foreground">{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
