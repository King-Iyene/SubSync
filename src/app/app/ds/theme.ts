"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, isThemePref, resolveTheme, type ThemePref } from "@/lib/design/ui-logic";

// The light or dark choice (N52). It lives in this browser only (a small preference, not customer data); where the browser refuses storage
// (a private window, a blocked frame) the choice lasts until the page closes. Follows the device when the choice is "system".
const KEY = "subsync-theme";
let memory: ThemePref | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): ThemePref {
  if (memory) return memory;
  try { const v = window.localStorage.getItem(KEY); if (isThemePref(v)) return v; } catch { /* storage blocked: fall through */ }
  return DEFAULT_THEME;
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener("change", cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); mq?.removeEventListener("change", cb); window.removeEventListener("storage", cb); };
};
const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;

export function useTheme(): { pref: ThemePref; theme: "dark" | "light"; setPref: (p: ThemePref) => void } {
  const pref = useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
  const dark = useSyncExternalStore(subscribe, systemDark, () => true);
  const setPref = useCallback((p: ThemePref) => {
    memory = p;
    try { window.localStorage.setItem(KEY, p); } catch { /* kept in memory for this visit */ }
    emit();
  }, []);
  return { pref, theme: resolveTheme(pref, dark), setPref };
}
