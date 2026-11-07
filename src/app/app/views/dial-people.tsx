"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { DialButton } from "../ds/dial-button";
import { LeadDrawer, type LeadSeed } from "../ds/lead-drawer";

// A slim popup that lists exactly the people behind a count in Call mode, paged 20/50/100. Each row says who, where, and (when known) the touch counter and next try.
export type PersonRow = { key: string; name: string; account?: string | null; chip?: string; chipTone?: "cyan" | "amber" | "red"; detail?: string; tip?: string;
  /** When set, the row opens the shared lead panel, shows the number and a Call button, and can be ticked. */
  seed?: LeadSeed; phone?: string | null; dnd?: boolean; timeZone?: string | null; url?: string };

export function PeoplePopup({ title, note, rows, onClose, onSendSelected }: { title: string; note?: string; rows: PersonRow[]; onClose: () => void; onSendSelected?: (keys: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [lead, setLead] = useState<number | null>(null);
  const withSeed = rows.filter((r) => r.seed);
  const [size, setSize] = useState(20);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && lead === null) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, lead]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * size, at * size + size);
  if (lead !== null) return <LeadDrawer leads={withSeed.map((r) => r.seed as LeadSeed)} index={lead} onIndex={setLead} onClose={() => setLead(null)} />;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title} data-testid="people-popup" onClick={onClose}>
      <div className="s6 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-card p-4 text-card-foreground shadow-[var(--shadow-lift)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div><h3 className="text-base font-semibold">{title}</h3>{note && <p className="s6-label mt-0.5">{note}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="ds-press -m-1 rounded-md p-2 hover:bg-muted"><X aria-hidden className="size-4" /></button>
        </div>
        {rows.length === 0 ? <p className="s6-label py-4">Nobody here.</p> : (
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border text-sm" data-testid="people-rows">
            {shown.map((r) => (
              <li key={r.key} title={r.tip ?? r.detail ?? r.name} data-testid="people-row" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
                {onSendSelected && r.seed && <input type="checkbox" aria-label={`Select ${r.name}`} data-testid="people-pick" checked={picked.includes(r.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.key] : picked.filter((k) => k !== r.key))} />}
                {r.seed ? <button type="button" data-testid="people-open" className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:underline" onClick={() => setLead(withSeed.findIndex((x) => x.key === r.key))}>{r.name}{r.account ? <span className="s6-label font-normal"> · {r.account}</span> : null}</button>
                  : <span className="min-w-0 flex-1 truncate font-medium">{r.name}{r.account ? <span className="s6-label font-normal"> · {r.account}</span> : null}</span>}
                {r.seed && r.phone && <span className="s6-label tabular-nums" data-testid="people-phone">{r.phone}</span>}
                {r.seed && <span title="Opens the lead in your CRM's own dialer. SubSync cannot start a call itself."><DialButton phone={r.phone} contactUrl={r.url} dnd={r.dnd} timeZone={r.timeZone} compact /></span>}
                {r.chip && <span className="s6-chip" data-tone={r.chipTone ?? "cyan"}>{r.chip}</span>}
                {r.detail && <span className="s6-label w-full">{r.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        {onSendSelected && <div className="mt-2 flex items-center justify-between gap-2"><span className="s6-label">{picked.length} selected</span><button type="button" className="s6-btn" data-kind="primary" disabled={picked.length === 0} data-testid="people-send" onClick={() => onSendSelected(picked)}>Send selected to CRM call queue</button></div>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{rows.length.toLocaleString("en-US")} {rows.length === 1 ? "person" : "people"}. Page {at + 1} of {pages}.</span>
          <span className="flex items-center gap-1.5">
            <select aria-label="Rows per page" className="min-h-8 rounded-md border bg-card px-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>{[20, 50, 100].map((p) => <option key={p} value={p}>{p} rows</option>)}</select>
            <button type="button" className="min-h-8 rounded-md border px-2 disabled:opacity-40" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
            <button type="button" className="min-h-8 rounded-md border px-2 disabled:opacity-40" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
          </span>
        </div>
      </div>
    </div>
  );
}
