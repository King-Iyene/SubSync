"use client";

import { useEffect, useRef, useState } from "react";
import { retryView, RETRY_WAIT_MS } from "@/lib/design/slow-retry";
import { Btn } from "../ui";
import { EmptyState, Skeleton } from "./states";

/** What a slow block shows in place of its content: a plain note and a Try again that really asks the server again, shows progress, and stops after three presses with a clear message. */
export function SlowRetry({ reload, compact = false }: { reload: () => void | Promise<unknown>; compact?: boolean }) {
  const [tries, setTries] = useState(0), [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const press = () => {
    setTries((n) => n + 1); setWaiting(true);
    void reload();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setWaiting(false), RETRY_WAIT_MS);
  };
  const v = retryView(tries, waiting);
  return (
    <div role="status" aria-live="polite" data-testid="slow-retry" data-state={v.kind}>
      <EmptyState compact={compact} title={v.title} body={v.body} action={v.kind === "progress" ? <Skeleton className="h-6 w-40" /> : v.button ? <Btn onClick={press}>{v.button}</Btn> : undefined} />
    </div>
  );
}
