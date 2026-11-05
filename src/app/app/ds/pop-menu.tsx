"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "./portal-root";

// A small menu opened by a button, drawn in a layer of its own on the page (a portal with fixed placement) so no card, scroll area or sticky bar around the button can clip
// it or sit on top of it. Esc and a click outside close it, and focus goes back to the button. Used for the "more" actions of a Fix first row.
export type MenuItem = { key: string; label: string; onSelect: () => void; disabled?: boolean; hint?: string };

export function PopMenu({ label, items, testId, triggerClassName, children }: { label: string; items: MenuItem[]; testId?: string; triggerClassName?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number | null; bottom: number | null; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const W = 232;

  // Placement: below the button when the whole menu fits there, otherwise above it when it fits there, otherwise on the roomier side with its own scroll, so no item is ever out of reach.
  const measure = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight, gap = 4, edge = 8;
    const left = Math.max(edge, Math.min(r.right - W, vw - W - edge));
    const need = (panel.current?.scrollHeight ?? 320) + 2;
    const below = vh - r.bottom - gap - edge, above = r.top - gap - edge;
    if (below >= need || below >= above && above < need) setPos({ left, top: r.bottom + gap, bottom: null, maxHeight: Math.max(120, below) });
    else setPos({ left, top: null, bottom: vh - r.top + gap, maxHeight: Math.max(120, above) });
  }, []);
  const placed = pos !== null;
  // Once now, and once more when the menu is on screen so its real height decides the side.
  useLayoutEffect(() => { if (open) measure(); }, [open, placed, measure]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
    const away = (e: Event) => { const path = e.composedPath(); if (!(panel.current && path.includes(panel.current)) && !(button.current && path.includes(button.current))) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    // A scroll of the page moves the button, so the menu follows it; a scroll inside the menu itself must not.
    const follow = (e: Event) => { if (!(panel.current && e.target instanceof Node && panel.current.contains(e.target))) measure(); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", follow, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc, true); window.removeEventListener("resize", measure); window.removeEventListener("scroll", follow, true); };
  }, [open, measure]);

  return (
    <>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} title={label} data-testid={testId} onClick={() => setOpen((v) => !v)}
        className={triggerClassName ?? "ds-press inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]"}>
        {children ?? <MoreHorizontal aria-hidden className="size-4" />}
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={panel} id={id} role="menu" aria-label={label} data-testid="pop-menu" style={{ position: "fixed", left: pos.left, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, width: W, maxHeight: pos.maxHeight, zIndex: 80, pointerEvents: "auto" }}
          className="overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-lift)]">
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled} data-testid={`menu-${it.key}`} onClick={() => { setOpen(false); button.current?.focus({ preventScroll: true }); it.onSelect(); }}
              className="flex min-h-9 w-full flex-col items-start justify-center rounded-[4px] px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50">
              <span>{it.label}</span>{it.hint && <span className="text-xs text-muted-foreground">{it.hint}</span>}
            </button>
          ))}
        </div>, portalRoot())}
    </>
  );
}
