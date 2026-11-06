"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "../ds/portal-root";

// The leads behind a number, as a panel on top of the page (never a new page, never a tab change). Esc, the cross and a click on the dimmed page close it; the page underneath keeps
// its scroll place, and the keyboard goes back to the number that opened it. The content is whatever list the caller shows. The lead panel (z-90) still opens above this one.
export function SidePopup({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [from] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[data-testid=lead-drawer]")) return;
      e.stopPropagation(); close.current();
    };
    document.addEventListener("keydown", esc, true);
    box.current?.focus({ preventScroll: true });
    return () => { document.removeEventListener("keydown", esc, true); from?.focus?.({ preventScroll: true }); };
  }, [from]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] print:hidden" data-testid="speed-popup">
      <div className="spd-fade absolute inset-0 bg-black/45" onClick={() => close.current()} aria-hidden />
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="spd-slide absolute inset-y-0 right-0 flex w-full flex-col border-l bg-popover text-popover-foreground shadow-[var(--shadow-lift)] outline-none md:w-[min(70vw,880px)]">
        <div className="flex justify-end px-3 pt-2"><button type="button" onClick={() => close.current()} aria-label="Close" data-testid="speed-popup-close" className="ds-press grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><X aria-hidden className="size-5" /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">{children}</div>
      </div>
    </div>,
    portalRoot(),
  );
}

/** One tooltip for the whole page: any element with data-tip="..." shows it on hover or keyboard focus. Mount once. */
export function TipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) { setTip(null); return; }
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.tip ?? "", x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: r.top });
    };
    const hide = () => setTip(null);
    document.addEventListener("pointerover", show); document.addEventListener("focusin", show);
    document.addEventListener("pointerdown", hide); document.addEventListener("focusout", hide); document.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("pointerover", show); document.removeEventListener("focusin", show); document.removeEventListener("pointerdown", hide); document.removeEventListener("focusout", hide); document.removeEventListener("scroll", hide, true); };
  }, []);
  if (!tip || typeof document === "undefined") return null;
  return createPortal(<div role="tooltip" data-testid="speed-tip" className="spd-tip pointer-events-none fixed z-[95] w-max max-w-[16rem] rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-[var(--shadow-lift)]" style={{ left: tip.x, top: tip.y - 8 }}>{tip.text}</div>, portalRoot());
}
