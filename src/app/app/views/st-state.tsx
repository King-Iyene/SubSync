"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { guideForView } from "@/lib/guides";
import { newViews } from "@/lib/whats-new";
import { remember } from "../ds/remember";
import { useApiClient } from "../session";

// One small answer per signed-in person: which "New" badges they dismissed, which guides they read, which pages they hid from their own menu. Kept in SubSync only.
type Marks = { news_seen: string[]; guide_read: string[]; module_hidden: string[] };
type Kind = keyof Marks;
type Ctx = {
  ready: boolean; marks: Marks; guides: boolean; settings: boolean; news: boolean;
  set: (kind: Kind, key: string, on: boolean) => Promise<void>;
  badgeFor: (view: string) => string | null;
  hidden: ReadonlySet<string>;
};
const EMPTY: Marks = { news_seen: [], guide_read: [], module_hidden: [] };
const C = createContext<Ctx>({ ready: false, marks: EMPTY, guides: false, settings: false, news: false, set: async () => {}, badgeFor: () => null, hidden: new Set() });
export const useStState = () => useContext(C);

export const GUIDE_REQUEST_KEY = "guide-open";

export function StProvider({ features, children }: { features: Record<string, boolean>; children: ReactNode }) {
  const api = useApiClient();
  const guides = features.st_guides === true, settings = features.st_settings === true, news = features.st_news === true;
  const any = guides || settings || news;
  const [marks, setMarks] = useState<Marks>(EMPTY);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!any) return;
    let live = true;
    api.get<Marks>("st/state").then((m) => { if (live) { setMarks({ ...EMPTY, ...m }); setReady(true); } }).catch(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [api, any]);
  const set = useCallback(async (kind: Kind, key: string, on: boolean) => {
    setMarks((m) => ({ ...m, [kind]: on ? [...new Set([...m[kind], key])] : m[kind].filter((k) => k !== key) }));
    try { await api.post("st/state", { kind, key, on }); } catch { /* the mark is kept for this visit; it is tried again next time */ }
  }, [api]);
  const badgeFor = useCallback((view: string) => {
    if (!news) return null;
    return newViews(Date.now(), (f) => features[f] === true, new Set(marks.news_seen)).get(view) ?? null;
  }, [news, features, marks.news_seen]);
  const value = useMemo<Ctx>(() => ({ ready, marks, guides, settings, news, set, badgeFor, hidden: new Set(marks.module_hidden) }), [ready, marks, guides, settings, news, set, badgeFor]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

/** The small "New" mark on a menu entry. Pressing it anywhere on the entry dismisses it (the menu button calls `dismiss`). */
export function NewMark({ view }: { view: string }) {
  const { badgeFor } = useStState();
  return badgeFor(view) ? <span className="rounded-full bg-sidebar-primary px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sidebar-primary-foreground" data-testid={`new-${view}`}>New</span> : null;
}

/** Called when a menu entry is opened: its badge is dismissed for this person. */
export function useDismissNew() {
  const { badgeFor, set } = useStState();
  return useCallback((view: string) => { const id = badgeFor(view); if (id) void set("news_seen", id, true); }, [badgeFor, set]);
}

/** The ? button: opens the guide for the page being shown, in Getting started. */
export function GuideHelpButton({ view, go }: { view: string; go: (v: "help") => void }) {
  const { guides } = useStState();
  const g = guideForView(view);
  if (!guides || !g) return null;
  return (
    <button type="button" aria-label={`How to use ${g.title}: open the guide`} title={`Guide: ${g.title}`} data-testid="guide-help"
      onClick={() => { remember(GUIDE_REQUEST_KEY, g.id); go("help"); }}
      className="mr-2 inline-flex size-11 items-center justify-center rounded-lg border text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground sm:size-9">?</button>
  );
}

/** Under every empty state: a link to the guide of the page it is on (read from the address), when guides are switched on. */
export function EmptyGuideLink() {
  const { guides } = useStState();
  // Read once when the empty state is drawn (the address does not change while it is on screen).
  const [view] = useState<string | null>(() => (typeof window === "undefined" ? null : window.location.hash.replace(/^#/, "").split(/[?=]/)[0] || "today"));
  const g = view ? guideForView(view) : null;
  if (!guides || !g) return null;
  return <p className="mt-3 text-sm"><a href="#help" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 sm:min-h-0" data-testid="empty-guide-link" onClick={() => remember(GUIDE_REQUEST_KEY, g.id)}>How {g.title} works: 60-second guide</a></p>;
}

/** One menu entry: left out when the person hid that page, and a click anywhere on it dismisses its "New" badge. Takes no space of its own. */
export function StNavEntry({ id, children }: { id: string; children: ReactNode }) {
  const { hidden } = useStState();
  const dismiss = useDismissNew();
  if (hidden.has(id)) return null;
  return <div className="contents" onClickCapture={() => dismiss(id)}>{children}</div>;
}
