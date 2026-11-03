"use client";

import { X } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { remember, remembered } from "./remember";

// A two-line "how to use this" for a page, shown once and dismissed for good (KF-5). Remembered in this browser; where storage is blocked it simply shows
// again next visit. It is a note, not a card: a thin rule and plain words.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function HowTo({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  const dismissed = useSyncExternalStore(subscribe, () => remembered(`howto-${id}`) === "1", () => true);
  if (dismissed) return null;
  return (
    <aside className="mb-5 flex items-start gap-3 border-l-2 border-primary py-1 pl-3 text-sm print:hidden" data-testid="how-to" aria-label={title}>
      <div className="min-w-0 flex-1 leading-5"><p className="font-medium">{title}</p><div className="text-muted-foreground">{children}</div>{action && <div className="mt-1">{action}</div>}</div>
      <button type="button" aria-label="Hide this tip" onClick={() => { remember(`howto-${id}`, "1"); listeners.forEach((l) => l()); }} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"><X aria-hidden className="size-3.5" /></button>
    </aside>
  );
}
