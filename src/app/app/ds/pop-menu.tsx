"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A small menu opened by a button, drawn in a layer of its own on the page (a portal with fixed placement) so no card, scroll area or sticky bar around the button can clip
// it or sit on top of it. Esc and a click outside close it, and focus goes back to the button. Used for the "more" actions of a Fix first row.
export type MenuItem = { key: string; label: string; onSelect: () => void; disabled?: boolean; hint?: string };

export function PopMenu({ label, items, testId, triggerClassName, children }: { label: string; items: MenuItem[]; testId?: string; triggerClassName?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number | null; bottom: number | null } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const W = 224;

  const measure = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.right - W, vw - W - 8));
    if (vh - r.bottom >= 220 || vh - r.bottom >= r.top) setPos({ left, top: r.bottom + 4, bottom: null });
    else setPos({ left, top: null, bottom: vh - r.top + 4 });
  }, []);
  useLayoutEffect(() => { if (open) measure(); }, [open, measure]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const away = (e: Event) => { const t = e.target as Node; if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, measure]);

  return (
    <>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} title={label} data-testid={testId} onClick={() => setOpen((v) => !v)}
        className={triggerClassName ?? "ds-press inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]"}>
        {children ?? <MoreHorizontal aria-hidden className="size-4" />}
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={panel} id={id} role="menu" aria-label={label} data-testid="pop-menu" style={{ position: "fixed", left: pos.left, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, width: W, zIndex: 60 }}
          className="rounded-xl border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-lift)]">
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled} data-testid={`menu-${it.key}`} onClick={() => { setOpen(false); button.current?.focus(); it.onSelect(); }}
              className="flex min-h-9 w-full flex-col items-start justify-center rounded-lg px-3 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50">
              <span>{it.label}</span>{it.hint && <span className="text-xs text-muted-foreground">{it.hint}</span>}
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}
