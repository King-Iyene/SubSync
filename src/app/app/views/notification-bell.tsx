"use client";

import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GoFn, ViewId } from "../nav";
import { ErrorState, EmptyState, SkeletonRows } from "../ds";
import { useApiClient } from "../session";
import { Badge, Btn, severityTone } from "../ui";
import { ageText } from "@/lib/notifications/bell";

// The in-app notification centre (stage F9, N42): a bell with the number of unread items, a list with severity, a link to the thing, and dismiss and snooze
// for each. What a person sees, and their read, dismiss and snooze marks, are theirs alone; a client's staff only ever receive their own account's items
// (the server decides). It looks again every minute, when the page comes back into view, and when it is opened.

type Item = { id: string; type: string; severity: "info" | "warning" | "critical"; title: string; body: string | null; link: { view: string | null; locationId: string | null }; createdAt: string; read: boolean };
type BellData = { now: number; unread: number; canManage: boolean; snooze: Array<{ id: string; label: string }>; items: Item[] };

const POLL_MS = 60_000;

export function NotificationBell({ go }: { go: GoFn }) {
  const api = useApiClient();
  const [data, setData] = useState<BellData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<BellData>("notifications"));
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // The first read happens after the first paint, and then on a timer and whenever the page is shown again.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  const act = async (id: string, action: "read" | "dismiss" | "snooze", choice?: string) => {
    try { await api.post(`notifications/${id}/${action}`, action === "snooze" ? { choice } : undefined); await load(); } catch (e) { setError(e as Error); }
  };
  const readAll = async () => { try { await api.post("notifications/read-all"); await load(); } catch (e) { setError(e as Error); } };
  const openItem = (i: Item) => {
    void act(i.id, "read");
    setOpen(false);
    if (i.link.view) go(i.link.view as ViewId, i.link.locationId ?? undefined);
  };

  const unread = data?.unread ?? 0;
  return (
    <div ref={root} className="relative" data-testid="bell">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => { setOpen((v) => !v); void load(); }}
        className="relative flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 sm:min-h-9 sm:min-w-0 text-sm text-muted-foreground hover:text-foreground">
        <Bell aria-hidden className="size-[18px]" />
        {unread > 0 && <span data-testid="bell-count" className="text-xs font-semibold tabular-nums text-foreground">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" data-testid="bell-panel" className="absolute right-0 z-30 mt-1 w-[min(26rem,92vw)] border bg-background shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <div className="flex items-center gap-1">
              {unread > 0 && <Btn variant="ghost" onClick={() => void readAll()}>Mark all read</Btn>}
              {data?.canManage && <Btn variant="ghost" onClick={() => { setOpen(false); go("notifications"); }}>Settings</Btn>}
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {loading && !data ? <div className="p-3"><SkeletonRows rows={3} label="Loading notifications" /></div>
              : error && !data ? <div className="p-3"><ErrorState error={error} onRetry={() => void load()} /></div>
              : data && data.items.length === 0 ? <EmptyState compact title="Nothing needs you right now" body="New alerts and your daily brief appear here." action={data.canManage ? <Btn onClick={() => { setOpen(false); go("notifications"); }}>Choose what you get</Btn> : undefined} />
              : (
                <ul className="divide-y">
                  {data?.items.map((i) => (
                    <li key={i.id} className="px-3 py-2.5" data-testid="bell-item">
                      <div className="flex items-start gap-2">
                        <Badge tone={severityTone(i.severity)}>{i.severity}</Badge>
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => openItem(i)} className={`block w-full text-left text-sm hover:underline ${i.read ? "text-muted-foreground" : "font-medium"}`}>{i.title}</button>
                          <p className="text-xs text-muted-foreground">{ageText(Date.parse(i.createdAt), data.now)}{i.read ? "" : " · new"}</p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-1">
                        <Btn variant="ghost" onClick={() => openItem(i)}>Open</Btn>
                        <label className="sr-only" htmlFor={`snooze-${i.id}`}>Snooze</label>
                        <select id={`snooze-${i.id}`} defaultValue="" className="rounded border bg-background px-1.5 py-1 text-xs" onChange={(e) => { if (e.target.value) void act(i.id, "snooze", e.target.value); }}>
                          <option value="">Snooze...</option>
                          {data.snooze.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                        <Btn variant="ghost" onClick={() => void act(i.id, "dismiss")}>Dismiss</Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          {error && data && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Could not refresh just now. Showing what we had.</p>}
        </div>
      )}
    </div>
  );
}
