"use client";

// Small per-person memory kept in this browser only (a preference, not customer data): the last filter, the last range of a card, which how-to notes were
// dismissed. Every read and write is guarded: a private window or a blocked frame has no storage, and nothing may break because of that.
export function remembered(key: string): string | null {
  try { return window.localStorage.getItem(`subsync-${key}`); } catch { return null; }
}
export function remember(key: string, value: string | null): void {
  try { if (value === null) window.localStorage.removeItem(`subsync-${key}`); else window.localStorage.setItem(`subsync-${key}`, value); } catch { /* nothing is remembered; the screen still works */ }
}
