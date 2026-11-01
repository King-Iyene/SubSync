"use client";

import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { errorId } from "@/lib/design/ui-logic";
import type { ApiError } from "../session";

// The four "nothing to show yet" states every screen needs (loading, empty, error, and a definition one tap away). This file must not import
// ../ui, which re-exports some of these under their older names.

// Plain words between two thin rules: what is empty, and what to do. No icon, no tinted shape.
export function EmptyState({ title, body, action, compact = false }: { title: string; body?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`border-y text-center ${compact ? "py-5" : "py-10"}`} data-testid="empty-state">
      <p className="text-sm font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// A grey block the shape of what is coming, so the page does not jump when the data arrives. Stops pulsing for people who ask for less motion.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`ds-skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 5, label = "Loading..." }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-testid="skeleton-rows" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3"><Skeleton className="size-9 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SkeletonCards({ cards = 4, label = "Loading..." }: { cards?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-testid="skeleton-cards" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: cards }, (_, i) => <div key={i} className="rounded-lg border bg-card p-4"><Skeleton className="h-3 w-1/2" /><Skeleton className="mt-3 h-7 w-2/3" /><Skeleton className="mt-3 h-3 w-full" /></div>)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

// What went wrong, in words, with an id the person can read out so support can find it (N54: "an error ID for support"). Where the server sent its
// own id (`errorId`) that is shown; otherwise one is made here from the kind of error and the minute, which is enough to find it in the logs.
export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const status = typeof (error as ApiError).status === "number" ? (error as ApiError).status : null;
  const upgrade = status === 402;
  const sent = (error as ApiError).body?.errorId;
  // The id carries the minute it happened, so it is made in the browser after the page is up (never while the page is being prepared in advance).
  const [made, setMade] = useState<string | null>(null);
  const message = error.message;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMade(errorId(status, message, Date.now()));
  }, [status, message]);
  const id = typeof sent === "string" && /^[A-Za-z0-9-]{4,24}$/.test(sent) ? sent : made;
  return (
    <div className={`border-l-2 py-1 pl-3 text-sm ${upgrade ? "border-primary" : "border-destructive"}`} role="alert" data-testid="error-state">
      <p className="font-medium">{upgrade ? "This feature is part of the paid plan" : "Something went wrong"}</p>
      <p className="text-muted-foreground">{error.message}</p>
      {!upgrade && id && <p className="mt-1 text-xs text-muted-foreground">Error ID <strong className="font-mono text-foreground" data-testid="error-id">{id}</strong>. Quote it if you contact support.</p>}
      {onRetry && !upgrade && <button type="button" onClick={onRetry} className="mt-2 min-h-9 rounded-lg border bg-card px-3 py-1.5 text-sm hover:bg-muted">Try again</button>}
    </div>
  );
}

// A word or number with its definition one tap away (N11, principle 7). Opens on hover, focus or tap; Escape or a tap elsewhere closes it.
export function DefinitionTip({ term, children, label }: { term: ReactNode; children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={box} className="relative inline-flex items-center gap-1" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {term}
      <button type="button" aria-label={label ?? "What does this mean?"} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
        <CircleHelp aria-hidden className="size-4" />
      </button>
      {open && <span role="tooltip" id={id} className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[80vw] rounded-lg border bg-popover p-3 text-left text-xs font-normal leading-5 text-popover-foreground shadow-[var(--shadow-lift)]">{children}</span>}
    </span>
  );
}
