"use client";

import { X } from "lucide-react";
import { useState } from "react";
import {
  accountChoices, channelChoices, narrows, SORTS, userChoices, WAIT_CHIPS, type QueueFilter, type QueueRow, type WaitKey,
} from "@/lib/analytics/waiting-view";

// The controls of the Unanswered messages page: the wait chips, the channel, client account and person choices, the sort, and a person's saved views.
// They only read and change a QueueFilter; the rows, the counts and the order come from waiting-view.ts.
const select = "min-h-9 rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30";

export function WaitChips({ filter, counts, onChange }: { filter: QueueFilter; counts: Record<WaitKey, number>; onChange: (next: QueueFilter) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="How long they have waited" data-testid="wait-chips">
      <span className="mr-1 text-sm font-medium">Waited</span>
      {WAIT_CHIPS.map((c) => {
        const on = filter.wait === c.key;
        return (
          <button key={c.key} type="button" aria-pressed={on} onClick={() => onChange({ ...filter, wait: c.key })} data-testid={`chip-${c.key}`}
            className={`min-h-9 rounded-lg border px-3 py-1 text-sm transition-colors ${on ? "border-foreground bg-foreground font-medium text-background" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {c.label} <span className="tabular-nums opacity-80">({counts[c.key]})</span>
          </button>
        );
      })}
    </div>
  );
}

export function QueueChoices({ rows, filter, me, onChange }: { rows: QueueRow[]; filter: QueueFilter; me: string | null; onChange: (next: QueueFilter) => void }) {
  const channels = channelChoices(rows);
  const accounts = accountChoices(rows);
  const users = userChoices(rows, me);
  const set = (patch: Partial<QueueFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Narrow the list" data-testid="queue-choices">
      {channels.length > 1 && (
        <label className="flex items-center gap-1.5"><span className="text-muted-foreground">Channel</span>
          <select className={select} value={filter.channel} onChange={(e) => set({ channel: e.target.value })} aria-label="Channel">
            <option value="">All channels</option>
            {channels.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
          </select>
        </label>
      )}
      {accounts.length > 1 && (
        <label className="flex items-center gap-1.5"><span className="text-muted-foreground">Client account</span>
          <select className={`${select} max-w-[14rem]`} value={filter.account} onChange={(e) => set({ account: e.target.value })} aria-label="Client account">
            <option value="">All client accounts</option>
            {accounts.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
          </select>
        </label>
      )}
      {users.length > 1 && (
        <label className="flex items-center gap-1.5"><span className="text-muted-foreground">Assigned to</span>
          <select className={`${select} max-w-[14rem]`} value={filter.user} onChange={(e) => set({ user: e.target.value })} aria-label="Assigned to">
            <option value="">Anyone</option>
            {users.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1.5"><span className="text-muted-foreground">Order</span>
        <select className={select} value={filter.sort} onChange={(e) => set({ sort: e.target.value === "newest" ? "newest" : "longest" })} aria-label="Order">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      {narrows(filter) && <button type="button" className="min-h-9 text-xs font-medium text-primary underline" onClick={() => onChange({ ...filter, wait: "any", channel: "", account: "", user: "" })} data-testid="clear-choices">Clear these choices</button>}
    </div>
  );
}

export type ViewLite = { id: string; name: string; filters: QueueFilter };

export function SavedViews({ filter, views, max, onApply, onSave, onRemove, message }: {
  filter: QueueFilter; views: ViewLite[]; max: number;
  onApply: (f: QueueFilter) => void; onSave: (name: string) => Promise<void>; onRemove: (id: string) => Promise<void>; message: string | null;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const same = (a: QueueFilter, b: QueueFilter) => JSON.stringify(a) === JSON.stringify(b);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onSave(name.trim()); setName(""); } finally { setBusy(false); }
  };
  return (
    <details open className="text-sm" data-testid="saved-views">
      <summary className="cursor-pointer select-none text-muted-foreground">Saved views ({views.length})</summary>
      <div className="mt-2 space-y-2">
        {views.length === 0 ? <p className="text-xs text-muted-foreground">Choose your tab and filters, give them a name, and come back to them in one tap. Only you see your saved views.</p> : (
          <ul className="flex flex-wrap gap-2">
            {views.map((v) => (
              <li key={v.id} className={`inline-flex items-center rounded-lg border ${same(v.filters, filter) ? "border-foreground" : ""}`}>
                <button type="button" className="min-h-9 px-3 text-sm hover:underline" onClick={() => onApply(v.filters)} aria-label={`Use the saved view ${v.name}`}>{v.name}</button>
                <button type="button" className="inline-flex size-9 items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => void onRemove(v.id)} aria-label={`Remove the saved view ${v.name}`}><X aria-hidden className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className={`${select} w-56`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name this view, for example Over a day" aria-label="Name for the saved view" />
          <button type="submit" disabled={!name.trim() || busy} className="min-h-9 rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 disabled:opacity-50">Save this view</button>
          <span className="text-xs text-muted-foreground">{views.length} of {max}</span>
        </form>
        {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
      </div>
    </details>
  );
}
