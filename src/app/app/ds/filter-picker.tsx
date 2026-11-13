"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { moveHighlight, pickRows, pickStatus, type PickValue } from "@/lib/design/filter-picker";

// A type-to-search box for a filter that matches an exact value (a source, a tag). It suggests what already exists in the person's account, most used first with counts, and
// also accepts any exact text ("Use ...", for a value that is not listed). The list comes from the server a few at a time (`load` gets what was typed), so thousands of
// values stay fast. Keyboard: Down and Up move, Enter picks, Escape closes. It is a labelled combobox, so a screen reader announces the count and the highlighted row.
export type PickLoad = (typed: string) => Promise<{ values: PickValue[]; more: boolean }>;

export function FilterPicker({ label, value, onChange, load, hint, placeholder = "Any", testId, normalize, refreshKey }: {
  label: string; value: string; onChange: (v: string) => void; load: PickLoad; hint: string; placeholder?: string; testId: string;
  /** Cleans a typed value before it is used (a tag is matched in lower case). */
  normalize?: (v: string) => string;
  /** Changes when the suggestions should be asked for again (the dates or accounts changed). */
  refreshKey?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [state, setState] = useState<{ values: PickValue[]; more: boolean; loading: boolean; failed: boolean }>({ values: [], more: false, loading: false, failed: false });
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef(0);
  const clean = normalize ?? ((v: string) => v);

  // The saved filter, a removed chip or Clear all changes the value from outside: the box follows it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value); }

  // Ask for the suggestions while the list is open: at once when it opens, then a moment after each key.
  useEffect(() => {
    if (!open) return;
    const n = ++asked.current;
    const t = setTimeout(() => {
      setState((s) => ({ ...s, loading: true, failed: false }));
      load(text === value ? "" : text.trim()).then(
        (r) => { if (n === asked.current) { setState({ values: r.values, more: r.more, loading: false, failed: false }); setAt(0); } },
        () => { if (n === asked.current) setState({ values: [], more: false, loading: false, failed: true }); },
      );
    }, text === value ? 0 : 200);
    return () => clearTimeout(t);
    // `load` is a new function on every render of the page; the typed text and the key decide when to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, text, refreshKey]);

  const typed = text === value ? "" : text;
  const rows = pickRows(clean(typed), state.values, normalize !== undefined);
  const commit = (v: string) => { const c = clean(v).trim(); onChange(c); setText(c); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      if (e.key === "Home" || e.key === "End") { if (!open) return; }
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setAt((a) => moveHighlight(a, e.key, rows.length));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const r = rows[at];
      if (r) commit(r.value); else if (text.trim()) commit(text);
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setText(value); }
    }
  };
  const status = state.failed ? "The suggestions could not load. You can still type an exact value." : pickStatus(state.values.length, state.more, state.loading, typed);

  return (
    <div className="relative text-xs text-muted-foreground" data-testid={testId}>
      <label htmlFor={`${id}-in`}>{label}</label>
      <div className="relative mt-0.5">
        <input
          ref={input} id={`${id}-in`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox" aria-describedby={`${id}-hint`}
          aria-activedescendant={open && rows[at] ? `${id}-opt-${at}` : undefined} autoComplete="off" spellCheck={false} maxLength={120}
          value={text} placeholder={placeholder} data-testid={`${testId}-input`}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setText(value); }}
          onKeyDown={onKey}
          className="h-11 w-full min-w-0 rounded-md border bg-card pl-2 pr-9 text-base text-foreground sm:h-9 sm:text-sm"
        />
        {(value || text) && (
          <button type="button" aria-label={`Clear ${label.toLowerCase()}`} data-testid={`${testId}-clear`} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(""); setText(""); input.current?.focus(); }}
            className="ds-press absolute right-0.5 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md hover:bg-accent sm:size-8"><X aria-hidden className="size-3.5" /></button>
        )}
        {open && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl" data-testid={`${testId}-list`}>
            <div id={listId} role="listbox" aria-label={label} className="max-h-60 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={r.kind + r.value} id={`${id}-opt-${i}`} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(r.value)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm sm:min-h-9 ${i === at ? "bg-accent" : ""}`} data-testid={r.kind === "use" ? `${testId}-use` : `${testId}-option`}>
                  {r.kind === "use" ? <span className="truncate">Use &ldquo;<b>{r.value}</b>&rdquo;</span> : <><span className="truncate">{r.value}</span><span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{r.count.toLocaleString("en-US")}</span></>}
                </div>
              ))}
            </div>
            <p className="px-2 py-1.5 text-xs text-muted-foreground" role="status" aria-live="polite" data-testid={`${testId}-status`}>{status}</p>
          </div>
        )}
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
