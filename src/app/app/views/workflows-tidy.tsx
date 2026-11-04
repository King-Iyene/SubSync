"use client";

import { useMemo, useState } from "react";
import type { RenameRule } from "@/lib/workflows/rename";
import type { WfItem } from "@/lib/workflows/model";
import { EmptyState, Section } from "../ds";
import { keyOf, type Acc } from "./workflows-parts";

// The Tidy up tab: names that need fixing (one tap to preview the fix), near duplicates inside a client account, and the same workflow compared across client
// accounts with where they differ. Everything here is read from SubSync's own copy; the only thing that can change anything is the rename preview.

export type TidyData = {
  names: Array<{ workflowId: string; locationId: string; name: string; issue: "spaces" | "copy" | "default" | "case"; words: string }>;
  fixes: Partial<Record<"spaces" | "copy" | "default" | "case", RenameRule>>;
  dupes: Array<{ locationId: string; exact: boolean; ids: string[] }>;
  compare: Array<{ name: string; accounts: number; states: string[]; drift: string[]; items: Array<{ workflowId: string; locationId: string }> }>;
};
const TITLE = { spaces: "Extra spaces", copy: "Leftover copies", default: "Still has a default name", case: "All capitals or all lower case" } as const;

export function TidyTab({ tidy, items, accounts, canChange, onFix, onShow }: {
  tidy: TidyData; items: WfItem[]; accounts: Acc[]; canChange: boolean;
  onFix: (rule: RenameRule, picked: WfItem[]) => void; onShow: (key: string, title: string, subtitle: string, list: WfItem[]) => void;
}) {
  const by = useMemo(() => new Map(items.map((w) => [keyOf(w), w])), [items]);
  const acc = useMemo(() => new Map(accounts.map((a) => [a.locationId, a.name])), [accounts]);
  const pick = (ids: Array<{ workflowId: string; locationId: string }>) => ids.map((i) => by.get(keyOf(i))).filter((w): w is WfItem => !!w);
  const [open, setOpen] = useState<string | null>(null);
  const kinds = (["spaces", "copy", "case", "default"] as const).map((k) => ({ k, list: tidy.names.filter((n) => n.issue === k) })).filter((g) => g.list.length > 0);
  return (
    <div data-testid="wf-tidy">
      <Section title="Names to fix" hint="Press Preview fix to see every name before and after. Nothing changes until you confirm.">
        {kinds.length === 0 ? <EmptyState compact title="Every name looks fine" body="No extra spaces, leftover copies or default names." /> : (
          <ul className="divide-y rounded-xl border" data-testid="wf-names">
            {kinds.map(({ k, list }) => (
              <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block font-medium">{TITLE[k]} <span className="font-normal text-muted-foreground">({list.length})</span></span>
                  <span className="block truncate text-muted-foreground">{list.slice(0, 3).map((n) => `"${n.name}"`).join(", ")}{list.length > 3 ? ` and ${list.length - 3} more` : ""}</span></span>
                {tidy.fixes[k] && canChange ? <button type="button" onClick={() => onFix(tidy.fixes[k] as RenameRule, pick(list))} data-testid={`wf-fix-${k}`} className="min-h-9 rounded-lg border px-3 font-medium hover:bg-accent">Preview fix</button>
                  : <button type="button" onClick={() => onShow(`names-${k}`, TITLE[k], "These names need a person to decide.", pick(list))} data-testid={`wf-fix-${k}`} className="min-h-9 rounded-lg border px-3 hover:bg-accent">Show them</button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Near duplicates" hint="The same name, or nearly the same words, inside one client account. Two of them can both start for the same lead.">
        {tidy.dupes.length === 0 ? <EmptyState compact title="No duplicates found" body="Checked by name only." /> : (
          <ul className="divide-y rounded-xl border" data-testid="wf-dupes">
            {tidy.dupes.map((d, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block font-medium">{d.ids.length} like this in {acc.get(d.locationId) ?? "a client account"}{d.exact ? "" : " (similar names)"}</span>
                  <span className="block truncate text-muted-foreground">{d.ids.map((id) => by.get(keyOf({ locationId: d.locationId, workflowId: id }))?.name).filter(Boolean).join(" · ")}</span></span>
                <button type="button" onClick={() => onShow(`dupe-${i}`, "Possible duplicates", "Check their triggers before you delete one.", pick(d.ids.map((id) => ({ locationId: d.locationId, workflowId: id }))))} data-testid="wf-dupe-show" className="min-h-9 rounded-lg border px-3 hover:bg-accent">Show</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Same workflow in several client accounts" hint="Matched by name. Differences usually come from a snapshot push that skipped, or overwrote, a workflow.">
        {tidy.compare.length === 0 ? <EmptyState compact title="Nothing shared yet" body="No workflow name appears in two client accounts." /> : (
          <div className="overflow-x-auto rounded-xl border"><div className="min-w-[44rem]" data-testid="wf-compare">
            {tidy.compare.slice(0, 40).map((g) => (
              <div key={g.name} className="grid grid-cols-[minmax(10rem,1.4fr)_5.5rem_minmax(12rem,2fr)_5rem] items-center gap-x-3 border-b px-3 py-2 text-sm last:border-b-0" data-testid="wf-compare-row">
                <span className="truncate font-medium">{g.name}</span>
                <span className="text-muted-foreground">{g.accounts} accounts</span>
                <span className="min-w-0 truncate">{g.drift.length ? <span className="text-warning">{g.drift.join(". ")}</span> : <span className="text-success">The same everywhere</span>}</span>
                <button type="button" aria-expanded={open === g.name} onClick={() => { setOpen(open === g.name ? null : g.name); onShow(`cmp-${g.name}`, g.name, "This workflow in each client account.", pick(g.items)); }} data-testid="wf-compare-show" className="min-h-8 text-left font-medium text-primary hover:underline">Show</button>
              </div>
            ))}
          </div></div>
        )}
      </Section>
    </div>
  );
}
