"use client";

import { useData } from "../session";

type Options = { total: number; testAccounts?: number; industries: Array<{ key: string; label: string; accounts: number }>; owners: Array<{ name: string; accounts: number }> };

// "Show only": narrow the whole app to one kind of client or one person's clients. Hidden until there
// is something to choose between.
type Filter = { industry: string; owner: string; hideTest: boolean };
export function FilterBar({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  const { data } = useData<Options>("segments");
  if (!data) return null;
  const kinds = data.industries.filter((i) => i.key !== "unset" || data.industries.length > 1);
  const tests = data.testAccounts ?? 0;
  if (data.total < 2 || (kinds.length < 2 && data.owners.length < 1 && tests < 1)) return null;
  const active = Boolean(filter.industry || filter.owner || filter.hideTest);
  const select = "rounded-lg border bg-card px-2.5 py-1.5 text-sm shadow-sm outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30";

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm shadow-[var(--shadow-card)] print:hidden ${active ? "border-primary/40 bg-accent/60" : "bg-card"}`} role="group" aria-label="Show only">
      <span className="font-medium">Show only</span>
      <select className={select} aria-label="Industry" value={filter.industry} onChange={(e) => onChange({ ...filter, industry: e.target.value })}>
        <option value="">All industries ({data.total})</option>
        {kinds.map((i) => <option key={i.key} value={i.key}>{i.label} ({i.accounts})</option>)}
      </select>
      {data.owners.length > 0 && (
        <select className={select} aria-label="Account owner" value={filter.owner} onChange={(e) => onChange({ ...filter, owner: e.target.value })}>
          <option value="">Every owner</option>
          {data.owners.map((o) => <option key={o.name} value={o.name}>{o.name} ({o.accounts})</option>)}
        </select>
      )}
      {tests > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5" checked={filter.hideTest} onChange={(e) => onChange({ ...filter, hideTest: e.target.checked })} />
          Hide {tests} test account{tests === 1 ? "" : "s"}
        </label>
      )}
      {active && <button type="button" className="text-xs underline" onClick={() => onChange({ industry: "", owner: "", hideTest: false })}>Show everything</button>}
      {active && <span className="text-xs text-muted-foreground">Every page below is limited to these clients.</span>}
    </div>
  );
}
