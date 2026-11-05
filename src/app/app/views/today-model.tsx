"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccessKind } from "@/lib/access";
import { KIND_LABEL, type Kind, type QueueRow } from "@/lib/analytics/today-queue";
import type { RecordsSpec } from "@/lib/analytics/today-records";
import { pickInsights, whyOf as whyRules } from "@/lib/analytics/today-smart";
import { specWhy, type SpecEnv } from "@/lib/analytics/today-specs";
import { applyView, canAssign as mayAssign, DONE_HOLD_DAYS, UNDO_SECONDS, type Hold } from "@/lib/analytics/today-state";
import type { TodayData } from "@/lib/analytics/today-types";
import { ApiError, useApiClient } from "../session";
import { RecordsPanel, remember, remembered, useNow, type RowAction, type RowWhy } from "../ds";

// The shared brain of Today for every role: what is on screen after Done, Snooze and the junk control are applied, the records panel, and the working queue's actions
// with their ten-second Undo. The agency page and the one-account page both use it, so a number means the same thing on both. Nothing here is written to the CRM.

const DAY = 86_400_000;
const JUNK_KEY = "today-junk";
export type Toast = { text: string; eventId: number | null; error?: boolean; /** What the Undo button does when it is not the plain undo of one action (bringing things back puts them aside again). */ redo?: () => Promise<void> };

export function useTodayModel({ t, kind, reload }: { t: TodayData; kind: AccessKind; reload: () => Promise<void> }) {
  const api = useApiClient();
  const now = useNow();
  const [excludeJunk, setJunk] = useState<boolean>(() => remembered(JUNK_KEY) !== "off");
  const [localHolds, setLocalHolds] = useState<Record<string, Hold>>({});
  const [localAssigned, setLocalAssigned] = useState<Record<string, { name: string; eventId: number }>>({});
  const [undone, setUndone] = useState<number[]>([]);
  const [panel, setPanel] = useState<RecordsSpec | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setExcludeJunk = (on: boolean) => { setJunk(on); remember(JUNK_KEY, on ? null : "off"); };
  const clock = now || t.now;

  const holds = useMemo(() => {
    const merged: Record<string, Hold> = { ...t.holds, ...localHolds };
    for (const [id, h] of Object.entries(merged)) if (undone.includes(h.eventId) || h.until <= clock) delete merged[id];
    return merged;
  }, [t.holds, localHolds, undone, clock]);
  const view = useMemo(() => applyView({ items: t.items, totals: t.totals, accounts: t.accounts, staleDays: t.staleDays, now: clock }, { holds, excludeJunk }), [t, holds, excludeJunk, clock]);
  const env: SpecEnv = useMemo(() => ({ now: clock, view, accounts: t.accounts, staleDays: t.staleDays, targetMinutes: t.targetMinutes, ledger: t.ledger, scope: t.scope, excluded: excludeJunk }), [clock, view, t, excludeJunk]);
  const insights = useMemo(() => pickInsights(t.insights, view.items), [t.insights, view.items]);
  const assigned = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const [k, a] of Object.entries(t.assigned)) out[k] = a.by ?? "a team member";
    // A mark that was undone is gone, whether the server's answer has caught up yet or not.
    for (const [k, a] of Object.entries(t.assigned)) if (undone.includes(a.eventId)) delete out[k];
    for (const [k, a] of Object.entries(localAssigned)) if (!undone.includes(a.eventId)) out[k] = a.name;
    return out;
  }, [t.assigned, localAssigned, undone]);

  const open = useCallback((spec: RecordsSpec) => setPanel(spec), []);
  const close = useCallback(() => setPanel(null), []);

  const say = (x: Toast) => {
    setToast(x);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), x.error ? 8000 : UNDO_SECONDS * 1000);
  };

  const act = async (row: QueueRow, a: RowAction) => {
    if (a === "assign" && !mayAssign(kind)) return;
    const body = a === "done" ? { action: "done", rowKey: row.key } : a === "assign" ? { action: "assign", rowKey: row.key } : { action: "snooze", rowKey: row.key, choice: a === "snooze_day" ? "day" : "monday" };
    setBusy(row.key);
    try {
      const r = await api.post<{ eventId: number; at: number; until: number | null }>("today/action", body);
      const label = `${row.accountName}, ${KIND_LABEL[row.kind].toLowerCase()}`;
      if (a === "assign") {
        setLocalAssigned((m) => ({ ...m, [row.key]: { name: "you", eventId: r.eventId } }));
        say({ text: `Assigned to you: ${label}.`, eventId: r.eventId });
      } else {
        const until = a === "done" ? r.at + DONE_HOLD_DAYS * DAY : (r.until as number);
        const mine: Record<string, Hold> = {};
        for (const id of row.itemIds) mine[id] = { eventId: r.eventId, action: a === "done" ? "done" : "snooze", until, by: "you", at: r.at, rowKey: row.key };
        setLocalHolds((m) => ({ ...m, ...mine }));
        say({ text: a === "done" ? `Marked done: ${label}.` : `Snoozed ${a === "snooze_day" ? "until tomorrow" : "until Monday"}: ${label}.`, eventId: r.eventId });
      }
      void reload();
    } catch (error) {
      say({ text: error instanceof ApiError ? error.message : "That did not work. Please try again.", eventId: null, error: true });
    } finally { setBusy(null); }
  };

  /** Bring back what was marked Done or snoozed: undoes those actions (the server only finds actions in the caller's own lane and clients), so the rows return to the list and the counts at once. */
  const bringBack = async (eventIds: number[]) => {
    const ids = [...new Set(eventIds)];
    const held = view.held.filter((h) => ids.includes(h.hold.eventId));
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => api.post("today/action", { action: "undo", eventId: id })));
    const ok = ids.filter((_, i) => results[i].status === "fulfilled");
    setUndone((u) => [...u, ...ok]);
    void reload();
    const n = held.filter((h) => ok.includes(h.hold.eventId)).length;
    if (ok.length === 0) { say({ text: "Could not bring that back. Please try again.", eventId: null, error: true }); return; }
    const first = held.find((h) => ok.includes(h.hold.eventId));
    // Undo of a bring back: set the same rows aside again.
    const again = [...new Map(held.filter((h) => ok.includes(h.hold.eventId)).map((h) => [h.hold.eventId, h.hold])).values()];
    const redo = async () => {
      for (const h of again) {
        try { await api.post("today/action", h.action === "done" ? { action: "done", rowKey: h.rowKey } : { action: "snooze", rowKey: h.rowKey, choice: h.until - h.at <= 36 * 3_600_000 ? "day" : "monday" }); } catch { /* the row may be gone; the next one still goes */ }
      }
      void reload();
    };
    say({ text: `Brought back ${n || ok.length} ${(n || ok.length) === 1 ? "item" : "items"}${first && n === 1 ? `: ${first.item.name}` : ""}. They are in the list again.`, eventId: -1, redo });
  };

  const undo = async () => {
    const id = toast?.eventId;
    if (!id) return;
    if (toast?.redo) { const r = toast.redo; setToast(null); await r(); return; }
    setToast(null);
    try {
      await api.post("today/action", { action: "undo", eventId: id });
      setUndone((u) => [...u, id]);
      void reload();
    } catch (error) {
      say({ text: error instanceof ApiError ? error.message : "Could not undo that. Please try again.", eventId: null, error: true });
    }
  };

  const rowWhy = (r: QueueRow): RowWhy[] => whyRules(r, view.items, t.zones[r.locationId] ?? "UTC").map((w) => ({ key: w.key, text: w.text, onOpen: () => open(specWhy(w.text, w.itemIds, r.accountName, env)) }));

  // Hours and the CSV use the browser's own time zone; an account's hours (coverage strip) use the account's own.
  const zone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return { now: clock, view, env, insights, assigned, panel, open, close, toast, dismissToast: () => setToast(null), act, undo, bringBack, busy, excludeJunk, setExcludeJunk, canAssign: mayAssign(kind), rowWhy, zone, canExport: true as boolean };
}
export type TodayModel = ReturnType<typeof useTodayModel>;

/** The panel and the undo message, drawn once at the bottom of the page. */
export function TodayLayers({ m }: { m: TodayModel }) {
  return (
    <>
      {m.panel && <RecordsPanel key={m.panel.key} spec={m.panel} onClose={m.close} now={m.now} zone={m.zone} canExport={m.canExport} rowAction={m.panel.key === "held" ? { label: "Bring back", bulkLabel: "Bring back all selected", run: (refs) => m.bringBack(refs) } : undefined} />}
      {m.toast && typeof document !== "undefined" && createPortal(
        <div role={m.toast.error ? "alert" : "status"} data-testid="today-toast" className="fixed bottom-4 left-4 z-[70] flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-[var(--shadow-lift)]">
          <span className="min-w-0 break-words">{m.toast.text}</span>
          {m.toast.eventId !== null && <button type="button" onClick={() => void m.undo()} data-testid="today-undo" className="ds-press shrink-0 rounded-lg px-2.5 py-1 font-semibold text-primary underline underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]">Undo</button>}
          <button type="button" onClick={m.dismissToast} aria-label="Dismiss" data-testid="today-toast-close" className="ds-press -mr-1 shrink-0 rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">x</button>
        </div>
      , document.body)}
    </>
  );
}

export type { Kind };
