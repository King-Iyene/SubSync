"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LeadDrawer, type LeadSeed } from "./lead-drawer";

// ONE place that holds the open lead panel for every "Open" button. The panel used to live inside the row that opened it, so when the list behind it refreshed (a new search answer, a
// sync, a re-read) the row was replaced and the panel vanished in the middle of typing. Here the panel belongs to the page shell: rows may come and go, it stays until the person closes it.
// Without a host on screen (a test, an embedded screen) the button falls back to a panel of its own, as before.

type Open = { seed: LeadSeed; showAccount: boolean };
let current: Open | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function openLeadPanel(seed: LeadSeed, showAccount = true) { current = { seed, showAccount }; emit(); }
export function closeLeadPanel() { if (current) { current = null; emit(); } }
/** True while a host is mounted (read by the buttons to decide where the panel is drawn). */
export function useHasLeadHost(): boolean { return useSyncExternalStore(subscribe, () => hosts > 0, () => false); }

export function LeadDrawerHost() {
  const open = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => { hosts++; emit(); return () => { hosts--; if (hosts === 0) current = null; emit(); }; }, []);
  if (!open) return null;
  return <LeadDrawer leads={[open.seed]} index={0} onIndex={() => undefined} onClose={closeLeadPanel} showAccount={open.showAccount} />;
}
