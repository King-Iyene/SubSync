"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; hint?: string };

/** A picker you can type into: for lists that run to 50+ people or many calendars. Arrow keys, Enter and Escape work; the first choice is always "any". */
export function SearchSelect({ label, value, options, anyLabel, extra, onChange, testId }: { label: string; value: string; options: SelectOption[]; anyLabel: string; extra?: SelectOption[]; onChange: (v: string) => void; testId?: string }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [at, setAt] = useState(0);
  const id = useId(), box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const all = useMemo(() => [{ value: "", label: anyLabel }, ...(extra ?? []), ...options], [anyLabel, extra, options]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? all.filter((o) => o.label.toLowerCase().includes(t)) : all).slice(0, 40); }, [all, q]);
  const current = all.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const pick = (o: SelectOption) => { onChange(o.value); setOpen(false); setQ(""); };
  return (
    <div className="ap-ss" ref={box}>
      <button type="button" className="ap-field ap-ss-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} data-testid={testId} data-on={value ? "1" : undefined}
        onClick={() => { setOpen((o) => !o); setAt(0); setTimeout(() => input.current?.focus(), 0); }}>
        <span className="ap-ss-v">{value && current ? current.label : anyLabel}</span><ChevronDown aria-hidden className="size-4 flex-none" />
      </button>
      {open && (
        <div className="ap-ss-pop">
          <div className="apc-input"><Search aria-hidden className="size-4" />
            <input ref={input} role="combobox" aria-expanded aria-controls={id} aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}`} value={q}
              onChange={(e) => { setQ(e.target.value); setAt(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, shown.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
                else if (e.key === "Enter" && shown[at]) { e.preventDefault(); pick(shown[at]); }
                else if (e.key === "Escape") setOpen(false);
              }} />
          </div>
          <ul id={id} role="listbox" aria-label={label} className="ap-ss-list">
            {shown.length === 0 ? <li className="apc-none">Nothing matches that.</li> : shown.map((o, i) => (
              <li key={o.value || "any"} role="option" aria-selected={o.value === value} data-on={i === at ? "1" : undefined} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setAt(i)}>
                <span className="apc-opt-name">{o.label}</span>{o.hint && <small>{o.hint}</small>}{o.value === value && <Check aria-hidden className="size-4" />}
              </li>
            ))}
            {all.length > shown.length && !q && <li className="apc-none">{all.length - shown.length} more. Type to narrow it down.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
