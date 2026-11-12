"use client";

// The one small store every range reader listens to. The page range (the shell bar), a card's own range and a browser Back all tell it that the dates changed,
// so every screen re-reads the address and the saved choice at once.
const listeners = new Set<() => void>();
export const bumpRange = () => listeners.forEach((l) => l());
export function subscribeRange(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  window.addEventListener("hashchange", cb);
  window.addEventListener("subsync-range", cb);
  return () => { listeners.delete(cb); window.removeEventListener("popstate", cb); window.removeEventListener("hashchange", cb); window.removeEventListener("subsync-range", cb); };
}
