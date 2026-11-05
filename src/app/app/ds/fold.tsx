"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/** A block the person can fold away; open or closed is remembered for them (private windows just forget it). `bare` leaves the title to the content (it still gets a small fold button). */
export function Fold({ id, title, children, className = "", bare = false }: { id: string; title: string; children: ReactNode; className?: string; bare?: boolean }) {
  const key = `subsync.fold.${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "0"; } catch { return true; } });
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* not available */ } return !o; }); };
  return (
    <div className={className} data-testid={`fold-${id}`}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-label={`${open ? "Fold" : "Unfold"} ${title}`} className={`flex min-h-9 w-full cursor-pointer items-center gap-1.5 text-left ${bare ? "justify-end text-xs text-muted-foreground" : "text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"}`} data-testid={`fold-${id}-toggle`}>
        {!bare && title}<ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />{bare && !open && <span>{title}</span>}
      </button>
      {open && children}
    </div>
  );
}
