"use client";

import { useData } from "../session";

type Options = { total: number; industries: Array<{ key: string; label: string; accounts: number }>; owners: Array<{ name: string; accounts: number }> };

// "Show only": narrow the whole app to one kind of client or one person's clients. Hidden until there
// is something to choose between.
export function FilterBar({ filter, onChange }: { filter: { industry: string; owner: string }; onChange: (f: { industry: string; owner: string }) => void }) {
  const { data } = useData<Options>("segments");
  if (!data) return null;
  const kinds = data.industries.filter((i) => i.key !== "unset" || data.industries.length > 1);
  if (data.total < 2 || (kinds.length < 2 && data.owners.length < 1)) return null;
  const active = Boolean(filter.industry || filter.owner);
  const select = "rounded-lg border bg-background px-2 py-1.5 text-sm";

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm print:hidden ${active ? "border-primary/40 bg-primary/5" : "bg-muted/30"}`} role="group" aria-label="Show only">
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
      {active && <button type="button" className="text-xs underline" onClick={() => onChange({ industry: "", owner: "" })}>Show everything</button>}
      {active && <span className="text-xs text-muted-foreground">Every page below is limited to these clients.</span>}
    </div>
  );
}
