"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import type { PlDeal, PlDeals } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, OpenLeadButton, PanelBoundary, SkeletonRows, type LeadSeed } from "../../ds";
import { RoleChip } from "../../roles";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort } from "./format";

export const Chip = ({ tone, children }: { tone: "green" | "amber" | "red" | "violet" | "cyan" | "grey"; children: React.ReactNode }) => <span className="ap-chip" data-tone={tone}>{children}</span>;
export const stuck = (d: PlDeal) => d.staleAfterDays !== null && d.status === "open" && d.daysInStage > d.staleAfterDays;

// Slice PB mounts the deal panel content (timeline, owner, value, linked appointments, move, won/lost, note, delete) here without touching these files.
export type PlSlotName = "Details" | "RowActions" | "BulkActions";
type SlotProps = { deal?: PlDeal; deals?: PlDeal[]; onChanged?: () => void; onClose?: () => void; filters?: PlFilters };
const slots = new Map<PlSlotName, ComponentType<SlotProps>>(); const subs = new Set<() => void>(); let ver = 0;
export function registerPlSlot(name: PlSlotName, c: ComponentType<SlotProps>) { slots.set(name, c); ver++; subs.forEach((f) => f()); }
/** True once something is mounted in the slot (the checked change tools, when they are switched on for this person). */
export function useSlotMounted(name: PlSlotName): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => (slots.has(name) ? 1 : 0), () => 0) === 1;
}
export function PlSlot({ name, ...props }: { name: PlSlotName } & SlotProps) {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => ver, () => 0);
  const C = slots.get(name);
  // eslint-disable-next-line react-hooks/static-components -- a registered slot is a stable component, registered once at start-up
  return C ? <C {...props} /> : null;
}

/** What the shared lead panel opens with for a deal: the person, on the Deals tab with this deal highlighted. Null when the deal has no person. */
export const dealSeed = (d: PlDeal): LeadSeed | null => d.contactId ? { contactId: d.contactId, locationId: d.locationId, name: d.contactName ?? d.name, locationName: d.accountName, url: d.url ?? undefined, tab: "deals", dealId: d.id, note: `Deal: ${d.name}, ${d.stageName}${d.valueCents > 0 ? `, ${moneyShort(d.valueCents)}` : ""}.` } : null;

export function DealTable({ rows, showAccount, onOpen, activeId, selected, onSelect, onChanged }: { rows: PlDeal[]; showAccount: boolean; onOpen: (d: PlDeal) => void; activeId?: string | null; selected?: Set<string>; onSelect?: (id: string, on: boolean) => void; onChanged?: () => void }) {
  const quick = useSlotMounted("RowActions");
  const [cursor, setCursor] = useState(-1);
  const body = useRef<HTMLTableSectionElement>(null);
  const key = (e: React.KeyboardEvent, i: number, d: PlDeal) => {
    if (e.key === "Enter") onOpen(d);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))); setCursor(n); (body.current?.children[n] as HTMLElement | undefined)?.focus(); }
  };
  return (
    <div className="ap-scroll">
      <table className="ap-t" data-testid="pl-table">
        <thead><tr>{onSelect && <th aria-label="Select" style={{ width: 34 }} />}<th>Deal</th>{showAccount && <th>Account</th>}<th>Stage</th><th data-num>Value</th><th data-num>In stage</th><th>Owner</th><th className="text-right">Open</th>{quick && <th aria-label="Actions" />}</tr></thead>
        <tbody ref={body}>
          {rows.map((d, i) => (
            <tr key={d.id} tabIndex={cursor === i || (cursor < 0 && i === 0) ? 0 : -1} data-active={activeId === d.id ? "1" : "0"} data-tone={stuck(d) ? "amber" : undefined} onClick={() => onOpen(d)} onKeyDown={(e) => key(e, i, d)} data-testid="pl-row">
              {onSelect && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${d.name}`} checked={selected?.has(d.id) ?? false} onChange={(e) => onSelect(d.id, e.target.checked)} /></td>}
              <td><span className="ap-name">{d.name}</span> <span className="ap-sub">{d.contactName}</span></td>
              {showAccount && <td>{d.accountName}</td>}
              <td>{d.stageName}{d.status === "lost" && d.lostReason ? <span className="ap-sub"> · {d.lostReason}</span> : null}</td>
              <td data-num>{d.valueCents > 0 ? moneyShort(d.valueCents) : "No value"}</td>
              <td data-num>{stuck(d) ? <Chip tone="amber">{d.daysInStage} d, stuck</Chip> : `${d.daysInStage} d`}</td>
              <td>{d.ownerName ?? <span className="ap-sub">Nobody</span>}{d.ownerName && <RoleChip userId={d.ownerId} locationId={d.locationId} />}</td>
              <td className="text-right" onClick={(e) => e.stopPropagation()}><OpenLeadButton seed={dealSeed(d)} crmUrl={d.url} reason="This deal has no person linked, so there is nobody to open. Use the deal panel." name={d.contactName ?? d.name} showAccount={showAccount} testId="pl-row-open" /></td>
              {quick && <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><PlSlot name="RowActions" deal={d} onChanged={onChanged} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size)), from = total === 0 ? 0 : (page - 1) * size + 1, to = Math.min(total, page * size);
  return (
    <div className="ap-pager">
      <span data-testid="pl-count">{from.toLocaleString("en-US")} to {to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
      <span className="inline-flex items-center gap-2">
        <label className="sr-only" htmlFor="pl-size">Rows per page</label>
        <select id="pl-size" className="ap-field" style={{ minHeight: 36 }} value={size} onChange={(e) => onSize(Number(e.target.value))}>{[20, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft aria-hidden className="mx-auto size-4" /></button>
        <span className="tnum">{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight aria-hidden className="mx-auto size-4" /></button>
      </span>
    </div>
  );
}

/** A server-paged list of deals for one part. The count in the header is the number of rows behind it. */
export function DealList({ part = "list", filters, extra, onOpen, activeId, showAccount, empty, testId, selectable }: { part?: "list" | "needs-attention"; filters: PlFilters; extra?: Record<string, string | number | undefined>; onOpen: (d: PlDeal) => void; activeId?: string | null; showAccount: boolean; empty: string; testId: string; selectable?: boolean }) {
  const [page, setPage] = useState(1), [size, setSize] = useState(20), [sel, setSel] = useState<Set<string>>(new Set());
  // Next and previous use a keyset cursor (the page starts right after the last deal seen), so page 5,000 costs the same as page 1 and the total is not counted again.
  const [cursors, setCursors] = useState<Record<number, { after: string; total: number }>>({});
  const key = JSON.stringify(extra ?? {}) + filters.days + (filters.from ?? "") + (filters.to ?? "") + filters.locationId + filters.pipeline + filters.ownerId + filters.q;
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setPage(1); setSel(new Set()); setCursors({}); }
  const { data, error, loading, reload } = usePl<PlDeals>(part, filters, { ...extra, page, pageSize: size, after: cursors[page]?.after, total: cursors[page]?.total });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={6} label="Loading deals..." />;
  if (data.total === 0) return <EmptyState title={empty} body="Change the dates or filters above to look further back." />;
  const chosen = data.rows.filter((r) => sel.has(r.id));
  return (
    <div data-testid={testId} aria-busy={loading}>
      {selectable && sel.size > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="pl-bulkbar"><b>{sel.size} selected</b><PlSlot name="BulkActions" deals={chosen} onChanged={reload} filters={filters} /><button type="button" className="ap-link" onClick={() => setSel(new Set())}>Clear</button></div>}
      <div className="ap-tablewrap" style={{ opacity: loading ? 0.7 : 1 }}>
        <DealTable rows={data.rows} showAccount={showAccount} onChanged={reload} onOpen={onOpen} activeId={activeId} selected={selectable ? sel : undefined} onSelect={selectable ? (id, on) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }) : undefined} />
        <Pager total={data.total} page={page} size={size} onPage={(p) => { if (p === page + 1 && data.next) setCursors((c) => ({ ...c, [p]: { after: data.next!, total: data.total } })); setPage(p); }} onSize={(s) => { setSize(s); setPage(1); setCursors({}); }} />
      </div>
    </div>
  );
}

/** The right-side deal panel shell: the facts the table already has, plus the slot where slice PB mounts the timeline and the checked change tools. */
export function DealPanel({ deal, onClose, onChanged, filters }: { deal: PlDeal; onClose: () => void; onChanged: () => void; filters: PlFilters }) {
  const ref = useRef<HTMLDivElement>(null);
  const full = useSlotMounted("Details");
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  if (full) {
    // The checked change tools own the whole panel (their own header, CRM link, timeline and close).
    return (
      <>
        <div className="ap-scrim" onClick={onClose} aria-hidden />
        <div className="ap-panel" role="dialog" aria-modal="true" aria-label={`Deal ${deal.name}`} ref={ref} tabIndex={-1} data-testid="pl-panel" style={{ padding: 0 }}>
          <PanelBoundary onClose={onClose} label="The deal tools could not be shown."><PlSlot name="Details" deal={deal} onChanged={onChanged} onClose={onClose} filters={filters} /></PanelBoundary>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="ap-scrim" onClick={onClose} aria-hidden />
      <aside className="ap-panel" role="dialog" aria-modal="true" aria-label={`Deal ${deal.name}`} ref={ref} tabIndex={-1} data-testid="pl-panel">
        <div className="ap-panel-h">
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-tight">{deal.name}</h2><p className="ap-fine">{deal.accountName} · {deal.pipelineName}</p></div>
          <button type="button" className="ap-iconbtn" onClick={onClose} aria-label="Close panel" data-testid="pl-panel-close"><X aria-hidden className="size-4" /></button>
        </div>
        <div className="ap-panel-b">
          <dl className="ap-dl">
            <dt>Value</dt><dd>{deal.valueCents > 0 ? money(deal.valueCents) : "No value set"}</dd>
            <dt>Stage</dt><dd>{deal.stageName}{stuck(deal) ? <> <Chip tone="amber">Stuck {deal.daysInStage} days (normal up to {deal.staleAfterDays})</Chip></> : ` · ${deal.daysInStage} days`}</dd>
            <dt>Status</dt><dd>{deal.status === "won" ? "Won" : deal.status === "lost" ? `Lost${deal.lostReason ? `: ${deal.lostReason}` : ""}` : deal.status === "abandoned" ? "Abandoned" : "Open"}</dd>
            <dt>Owner</dt><dd>{deal.ownerName ?? "Nobody assigned"}{deal.ownerName && <RoleChip userId={deal.ownerId} locationId={deal.locationId} />}</dd>
            <dt>Contact</dt><dd>{deal.contactName ?? "Unknown"}</dd>
            <dt>Source</dt><dd>{deal.source ?? "Unknown"}</dd>
          </dl>
          <PanelBoundary label="The deal tools could not be shown."><PlSlot name="Details" deal={deal} onChanged={onChanged} filters={filters} /></PanelBoundary>
          <p className="flex justify-end"><OpenLeadButton seed={dealSeed(deal)} crmUrl={deal.url} reason="No person is linked to this deal." name={deal.contactName ?? deal.name} showAccount={false} testId="pl-panel-open" /></p>
          <p className="ap-fine">Changes to deals are made in your CRM or, once enabled, through SubSync&apos;s checked change tools (preview first, typed confirmation to delete).</p>
        </div>
      </aside>
    </>
  );
}
