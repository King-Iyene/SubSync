"use client";
import { groupIndexOf, groupTabs, type TabGroup } from "@/lib/group-tabs";
import { ModuleTabs } from "./template";

/** A short bar of plain group names, and under it the pages of the open group. Every page stays one click away; none is removed. */
export function GroupedTabs({ groups, available, active, labels, tips, onSelect, label, testId }: {
  groups: readonly TabGroup[]; available: readonly string[]; active: string; labels: Record<string, string>; tips?: Record<string, string>; onSelect: (key: string) => void; label: string; testId?: string;
}) {
  const shown = groupTabs(groups, available);
  const gi = groupIndexOf(shown, active);
  const cur = shown[gi];
  return (
    <div data-testid={testId}>
      <ModuleTabs pill wrap label={label} tabs={shown.map((g) => ({ label: g.label, tip: g.tip, node: null }))} value={gi} onChange={(i) => { const g = shown[i]; if (g) onSelect(g.keys.includes(active) ? active : g.keys[0]); }} />
      {cur && cur.keys.length > 1 && (
        <div role="group" aria-label={`Pages in ${cur.label}`} className="-mt-2 mb-4 flex flex-wrap gap-1.5 print:hidden" data-testid={testId ? `${testId}-pages` : undefined}>
          {cur.keys.map((k) => (
            <button key={k} type="button" aria-pressed={k === active} title={tips?.[k]} data-tip={tips?.[k]} onClick={() => onSelect(k)}
              className={`inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-sm ${k === active ? "border-primary bg-primary/10 font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{labels[k] ?? k}</button>
          ))}
        </div>
      )}
    </div>
  );
}
