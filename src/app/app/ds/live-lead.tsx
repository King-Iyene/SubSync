"use client";

import { useEffect, useRef, useState } from "react";
import { pollPlan, IDLE_STOP_MS } from "@/lib/live/poll";
import { useApiClient } from "../session";

// The live read of one lead while its panel is open. It shows what the CRM says now (the copy is shown first, this replaces it), says plainly whether it is live, and asks the
// panel to reload its copy-based parts whenever something changed. Pauses while the tab is hidden, stops after 10 minutes without a touch, slows down on trouble.
export type LiveBody = {
  state: "ok" | "needs_permission" | "unavailable" | "rate_limited" | "off";
  note?: string; readAt?: number; rev?: string; missing?: string[];
  calls?: Array<{ at: string; direction: string | null; result: string; by: string | null }>;
  notes?: Array<{ id: string; at: string | null; by: string | null; text: string }>;
  tasks?: Array<{ id: string; title: string; due: string | null; done: boolean }>;
};

export function useLiveLead(locationId: string, contactId: string, onChange: () => void) {
  const api = useApiClient();
  const [live, setLive] = useState<LiveBody | null>(null);
  const [stopped, setStopped] = useState(false);
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; });

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout> | undefined, failures = 0, polls = 0, rev: string | null = null, running = false;
    let lastTouch = Date.now(), forceFull = true;
    const touch = () => { lastTouch = Date.now(); if (stoppedRef.current) { stoppedRef.current = false; setStopped(false); schedule(0); } };
    const stoppedRef = { current: false };
    const tick = async () => {
      if (dead || running) return;
      const plan = pollPlan({ failures, hidden: document.hidden, idleMs: Date.now() - lastTouch, polls });
      if (plan.action === "stop") { stoppedRef.current = true; setStopped(true); return; }
      if (plan.action === "pause") { schedule(plan.delayMs); return; }
      running = true;
      try {
        const body = await api.get<LiveBody>(`workbench/live?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}${plan.full || forceFull ? "&full=1" : ""}`);
        if (dead) return;
        forceFull = false; polls++;
        if (body.state === "ok") {
          failures = 0; setLive(body);
          // The first answer always reloads the copy-based parts (the copy may have been missing or old); later ones only when something changed.
          if (rev === null || (body.rev && body.rev !== rev)) change.current();
          rev = body.rev ?? rev;
        } else { failures = body.state === "rate_limited" ? failures + 2 : failures + 1; setLive(body); }
      } catch { failures++; if (!dead) setLive((l) => (l ? { ...l, state: "unavailable" } : { state: "unavailable" })); }
      running = false;
      if (!dead) schedule(pollPlan({ failures, hidden: document.hidden, idleMs: Date.now() - lastTouch, polls }).delayMs);
    };
    function schedule(ms: number) { if (timer) clearTimeout(timer); timer = setTimeout(() => void tick(), ms); }
    const onVisible = () => { if (!document.hidden) { forceFull = true; schedule(0); } };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    schedule(0);
    return () => { dead = true; if (timer) clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, touch)); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [api, locationId, contactId]);

  return { live, stopped };
}

/** "Live" with how long ago it was read, or the honest fallback. */
export function LiveBadge({ live, stopped }: { live: LiveBody | null; stopped: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ok = live?.state === "ok" && !stopped;
  const secs = live?.readAt ? Math.max(0, Math.round((now - live.readAt) / 1000)) : null;
  const text = stopped ? `Paused after ${IDLE_STOP_MS / 60000} minutes. Touch the panel to resume.`
    : !live ? "Checking your CRM..." : live.state === "ok" ? `Live. Updated ${secs ?? 0} s ago` : live.state === "off" ? "Sample data" : live.state === "needs_permission" ? "From the last sync. Reconnect to see it live." : "From the last sync. Your CRM is not answering right now.";
  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="live-badge" data-live={ok ? "1" : "0"} aria-live="polite">
      <span className={`inline-block size-2 rounded-full ${ok ? "bg-[var(--ok,#3b7e54)]" : "bg-muted-foreground/50"}`} aria-hidden />
      {text}
    </p>
  );
}

/** Tasks and notes the CRM holds for this person (read live, never stored by SubSync). */
export function LiveExtras({ live }: { live: LiveBody | null }) {
  if (!live || live.state !== "ok") return null;
  const tasks = (live.tasks ?? []).filter((t) => !t.done).slice(0, 5), notes = (live.notes ?? []).slice(0, 3);
  if (!tasks.length && !notes.length) return null;
  return (
    <div className="mt-3 space-y-2 text-sm" data-testid="live-extras">
      {tasks.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open tasks</h3><ul className="space-y-0.5">{tasks.map((t) => <li key={t.id}>{t.title}{t.due ? <span className="text-muted-foreground"> (due {new Date(t.due).toLocaleDateString()})</span> : null}</li>)}</ul></div>}
      {notes.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest notes</h3><ul className="space-y-1">{notes.map((n) => <li key={n.id} className="line-clamp-2 break-words">{n.text}{n.by ? <span className="text-muted-foreground"> ({n.by})</span> : null}</li>)}</ul></div>}
    </div>
  );
}
