"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { moreCardsNote } from "@/lib/analytics/speed6";
import { WhatIs } from "../ds/what-is";
import { LeadList } from "./speed-all";
import { SidePopup } from "./speed-popup";
import "./speed6.css";

// The shared pieces of the control-room screens: a card named as a question, the count-up number, a lead list popup and the rule that keeps a tab calm.
const subscribeMotion = (cb: () => void) => { const m = window.matchMedia("(prefers-reduced-motion: reduce)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
export const useReducedMotion = () => useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

/** A number that counts up to its value (and simply shows it with reduced motion). */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) { from.current = value; return; }
    const start = performance.now(); const a = from.current; let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - start) / 600); setShown(a + (value - a) * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); else from.current = value; };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span className="tnum">{(reduced ? value : shown).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/** A card named as the question it answers. One short line under it; the longer explanation is behind the (i). */
export function Q({ q, sub, tip, glow, span, testId, children, action, sticky }: { sticky?: boolean; q: string; sub?: string; tip?: string; glow?: "active" | "urgent" | "warn"; span?: boolean; testId?: string; children: ReactNode; action?: ReactNode }) {
  const id = useId();
  return (
    <section className={`s6-card s6-enter ${span ? "s6-span2" : ""}`} data-glow={glow} data-s6-keep={sticky ? "1" : undefined} data-testid={testId} aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={id} className="s6-q">{q}{tip && <WhatIs text={tip} />}</h3>
        {action}
      </div>
      {sub && <p className="s6-sub">{sub}</p>}
      {children}
    </section>
  );
}

/** A lead list opened from a number: the SAME list and panel as everywhere else, on top of the page. */
export function useListPopup(showAccount: boolean) {
  const [list, setList] = useState<{ title: string; params: Record<string, string> } | null>(null);
  const node = list ? <SidePopup label={list.title} onClose={() => setList(null)}><LeadList key={JSON.stringify(list.params)} title={list.title} params={list.params} showAccount={showAccount} canMine onBack={() => setList(null)} backLabel="Close" /></SidePopup> : null;
  return { open: (title: string, params: Record<string, string>) => setList({ title, params }), node };
}

// ---------------------------------------------------------------- hiding what cannot help yet
const NO_DATA = /not enough|no data yet|needs? (more|the latest|\d)|nothing to (show|judge)|too few|not recorded yet/i;
/**
 * Keeps a tab calm: shows the first `keep` cards, puts the rest behind "More", and hides any card that only says it has no data yet behind one line ("N more cards need more data").
 * It reads the cards the tab already draws (a section with a heading), so every tab gets the same rule without being rewritten.
 */
export function Fold({ keep = 3, children, testId = "fold" }: { keep?: number; children: ReactNode; testId?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ more: 0, noData: 0 });
  useEffect(() => {
    const el = root.current; if (!el) return;
    const apply = () => {
      const cards = [...el.querySelectorAll<HTMLElement>("section[aria-labelledby]")].filter((c) => !c.parentElement?.closest("section[aria-labelledby]") && !c.closest("[role=dialog]"));
      let shown = 0, more = 0, noData = 0;
      for (const c of cards) {
        const body = (c.textContent ?? "").replace(c.querySelector("h2,h3")?.textContent ?? "", "");
        const empty = !c.hasAttribute("data-s6-keep") && body.trim().length < 170 && NO_DATA.test(body);
        if (empty) { noData++; c.hidden = true; continue; }
        if (shown < keep || open) { c.hidden = false; shown++; } else { c.hidden = true; more++; }
      }
      setCounts((p) => (p.more === more && p.noData === noData ? p : { more, noData }));
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [open, keep]);
  const note = moreCardsNote(counts.noData);
  return (
    <div ref={root} data-testid={testId}>
      {children}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {(counts.more > 0 || open) && <button type="button" className="s6-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="s6-more">{open ? "Fewer" : "More"}<ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>}
        {note && <p className="s6-label" data-testid="s6-nodata">{note}</p>}
      </div>
    </div>
  );
}


/** A band: a named group on a tab, with a thin luminous divider. */
export const Band = ({ title }: { title: string }) => <h2 className="s6-band" data-testid="s6-band">{title}</h2>;
