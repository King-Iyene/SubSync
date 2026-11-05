"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useApiClient } from "../session";

// People the caller set aside on Today (Done or snoozed). The one place the app shows them again outside Today: the contact panel says "Set aside until <date>. Bring back",
// and any list menu offers "Bring back". It uses Today's own actions (undo to bring back, snooze or done to set aside again): own lane only, own accounts only, decided by the server.

export type Held = { eventId: number; until: number; action: string; rowKey: string; by: string | null };
type State = { map: Record<string, Held> | null; message: { text: string; again?: Held } | null };
let state: State = { map: null, message: null };
let loading = false;
const listeners = new Set<() => void>();
const set = (n: Partial<State>) => { state = { ...state, ...n }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const heldKey = (locationId: string, contactId: string) => `${locationId}:${contactId}`;
const dayText = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function useHeld() {
  const api = useApiClient();
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (s.map !== null || loading) return;
    loading = true;
    api.get<{ held: Record<string, Held> }>("people/held").then((r) => set({ map: r.held })).catch(() => set({ map: {} })).finally(() => { loading = false; });
  }, [api, s.map]);
  const bringBack = async (key: string, name: string) => {
    const h = state.map?.[key];
    if (!h) return;
    try {
      await api.post("today/action", { action: "undo", eventId: h.eventId });
      const { [key]: _gone, ...rest } = state.map ?? {};
      void _gone;
      set({ map: rest, message: { text: `Brought back ${name}. They are in the lists again.`, again: h } });
    } catch { set({ message: { text: "Could not bring that back. Please try again." } }); }
  };
  const setAsideAgain = async (key: string) => {
    const h = state.message?.again;
    if (!h) return;
    try {
      await api.post("today/action", h.action === "done" ? { action: "done", rowKey: h.rowKey } : { action: "snooze", rowKey: h.rowKey, choice: h.until - Date.now() <= 36 * 3_600_000 ? "day" : "monday" });
      set({ map: null, message: { text: "Set aside again." } });
    } catch { set({ message: { text: "Could not set that aside again. Please try again." } }); }
    void key;
  };
  return { held: s.map ?? {}, message: s.message, bringBack, setAsideAgain, clear: () => set({ message: null }) };
}

/** In the contact panel: "Set aside until <date>. Bring back". */
export function HeldNote({ locationId, contactId, name }: { locationId: string; contactId: string; name: string }) {
  const { held, bringBack } = useHeld();
  const key = heldKey(locationId, contactId);
  const h = held[key];
  if (!h) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 border-l-2 border-warning py-1 pl-3 text-sm" data-testid="held-note">
      <span>Set aside until {dayText(h.until)}.</span>
      <button type="button" onClick={() => void bringBack(key, name)} className="min-h-9 cursor-pointer font-medium text-primary underline underline-offset-2" data-testid="held-bring-back">Bring back</button>
    </p>
  );
}

/** The result of a bring back, with Undo (set aside again). Shown above a list. */
export function HeldStatus() {
  const { message, setAsideAgain, clear } = useHeld();
  if (!message) return null;
  return (
    <p className="py-1 text-sm" role="status" data-testid="held-status">
      {message.text}
      {message.again && <button type="button" onClick={() => void setAsideAgain("")} className="ml-2 min-h-9 cursor-pointer font-medium underline" data-testid="held-undo">Undo</button>}
      <button type="button" onClick={clear} className="ml-2 min-h-9 cursor-pointer text-muted-foreground underline">Close</button>
    </p>
  );
}
