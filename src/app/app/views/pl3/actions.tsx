"use client";

import { useEffect } from "react";
import { DealBulkBar, DealRowQuickActions, useDealCaps } from "../pipeline-actions-ui";
import { DealPanel as ChangePanel } from "../pipeline-panel";
import { registerPlSlot } from "./parts";

// Mounts slice PB's checked change tools into the module's slots: the whole deal panel (timeline, move, owner, value, won or lost, note, task, one-tap fixes, undo, typed delete),
// the small row menu, and the bulk bar. Each one asks the server what this person may do and shows nothing it would refuse (the server checks again on every request).

function Details({ deal, onChanged, onClose }: { deal?: { id: string; locationId: string }; onChanged?: () => void; onClose?: () => void }) {
  if (!deal) return null;
  return <ChangePanel locationId={deal.locationId} id={deal.id} onClose={onClose ?? (() => undefined)} onChanged={onChanged} />;
}

function RowActions({ deal, onChanged }: { deal?: { id: string; locationId: string; status: string }; onChanged?: () => void }) {
  const caps = useDealCaps();
  if (!deal || !caps || !caps.edit || deal.status !== "open") return null;
  return <DealRowQuickActions locationId={deal.locationId} opportunityId={deal.id} caps={caps} onChanged={onChanged ?? (() => undefined)} />;
}

function BulkActions({ deals, onChanged }: { deals?: Array<{ id: string; locationId: string }>; onChanged?: () => void }) {
  const caps = useDealCaps();
  if (!deals || deals.length === 0 || !caps || !caps.bulk) return null;
  const where = new Set(deals.map((d) => d.locationId));
  if (where.size > 1) return <span className="ap-fine" data-testid="pl-bulk-one-account">Pick deals from one client account at a time to change them together.</span>;
  return <DealBulkBar locationId={deals[0].locationId} ids={deals.map((d) => d.id)} caps={caps} onChanged={onChanged ?? (() => undefined)} onClear={() => onChanged?.()} />;
}

let done = false;
/** Registers the three slots once. The module calls this on mount; the pl_actions flag and the person's role decide what the server lets through. */
export function useMountDealActions(enabled: boolean) {
  useEffect(() => {
    if (!enabled || done) return;
    done = true;
    registerPlSlot("Details", Details);
    registerPlSlot("RowActions", RowActions);
    registerPlSlot("BulkActions", BulkActions);
  }, [enabled]);
}
