"use client";

import { useState } from "react";
import { BASIS_HELP, BASIS_TITLE, NOT_READABLE, SALE_BASES, type SaleBasis } from "@/lib/analytics/sale-basis-core";
import { useApiClient, useData } from "../session";
import { Btn, Card } from "../ui";

// Settings, Targets: how SubSync counts a sale. One choice for the whole company. Every "Sold" and "Closed" figure (Appointments, people tables) reads it and prints the choice beside the number.
type Opt = { id: SaleBasis; title: string; help: string; available: boolean };
type Got = { basis: SaleBasis; countWithoutValue: boolean; canChange: boolean; paymentsReadable: boolean; options: Opt[] };

export function SaleBasisSettings() {
  const api = useApiClient();
  const got = useData<Got>("appointments/sale-basis");
  const [edit, setEdit] = useState<{ basis: SaleBasis; countWithoutValue: boolean } | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  if (got.error) return <Card title="How do we count a sale?"><p className="text-sm text-muted-foreground" role="alert">Could not load this setting. <button type="button" className="underline" onClick={got.reload}>Try again</button></p></Card>;
  if (!got.data) return <Card title="How do we count a sale?"><p className="text-sm text-muted-foreground" role="status">Loading...</p></Card>;
  const d = got.data, form = edit ?? { basis: d.basis, countWithoutValue: d.countWithoutValue }, locked = !d.canChange;
  const options: Opt[] = d.options?.length ? d.options : SALE_BASES.map((id) => ({ id, title: BASIS_TITLE[id], help: BASIS_HELP[id], available: true }));
  const set = (v: Partial<typeof form>) => { setEdit({ ...form, ...v }); setState("idle"); };
  const dirty = form.basis !== d.basis || form.countWithoutValue !== d.countWithoutValue;
  const save = async () => {
    setState("saving");
    try { await api.put("appointments/sale-basis", form); got.reload(); setEdit(null); setState("saved"); } catch { setState("error"); }
  };
  return (
    <Card title="How do we count a sale?">
      <div data-testid="sale-basis-settings">
        <p className="mb-3 text-sm text-muted-foreground">Some teams enter the money on a deal and some do not. Pick the one that matches how yours works. Every Sold and Closed figure follows it and says which one it used.</p>
        <fieldset disabled={locked} className="mb-3 space-y-2" aria-label="How a sale is counted">
          {options.map((o) => (
            <label key={o.id} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${form.basis === o.id ? "border-primary" : "border-border"} ${o.available ? "" : "opacity-70"}`}>
              <input type="radio" name="sale-basis" className="mt-1 size-4" value={o.id} checked={form.basis === o.id} onChange={() => set({ basis: o.id })} data-testid={`sale-basis-${o.id}`} />
              <span><span className="block font-medium">{o.title}</span><span className="block text-muted-foreground">{o.help}</span>{!o.available && <span className="block text-muted-foreground">{NOT_READABLE}. Sales will show as not available until payments are readable.</span>}</span>
            </label>
          ))}
        </fieldset>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4" disabled={locked} checked={form.countWithoutValue} onChange={(e) => set({ countWithoutValue: e.target.checked })} data-testid="sale-basis-novalue" />
          <span><span className="block font-medium">Count a sale without a dollar value</span><span className="block text-muted-foreground">On: a sale counts even when the deal has no amount. Off: only sales with an amount above zero count.</span></span>
        </label>
        {locked ? <p className="text-xs text-muted-foreground" data-testid="sale-basis-readonly">Only the company owner or an administrator can change this.</p> : (
          <div className="flex items-center gap-3">
            <Btn variant="primary" onClick={() => void save()} disabled={state === "saving" || !dirty} testId="sale-basis-save">{state === "saving" ? "Saving..." : "Save"}</Btn>
            {state === "saved" && <span className="text-sm text-muted-foreground" role="status">Saved. The figures update on the next load.</span>}
            {state === "error" && <span className="text-sm text-destructive" role="alert">Could not save. Try again.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}
