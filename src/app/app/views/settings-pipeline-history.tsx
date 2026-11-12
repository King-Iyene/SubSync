"use client";

import { useEffect, useState } from "react";
import type { HistorySettings } from "@/lib/analytics/pipeline3-funnel-types";
import { useApiClient, useData } from "../session";
import { Btn, Card, inputClass } from "../ui";

// Settings, Replies: the three choices behind Pipeline "Step history" and "Stuck in a step". Shown only once that feature is on.
export function PipelineHistoryCard() {
  const api = useApiClient();
  const r = useData<HistorySettings>("pipeline3?part=funnel-settings");
  const [form, setForm] = useState<HistorySettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (r.data) setForm(r.data); }, [r.data]); // eslint-disable-line react-hooks/set-state-in-effect
  if (!r.data || !form) return null;
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api.put("pipeline3/history-settings", { minSample: form.minSample, excludeTest: form.excludeTest, defaultPipeline: form.defaultPipeline ?? "" }); setMsg("Saved."); r.reload(); }
    catch { setMsg("Could not save. Only the account owner's team can change this."); }
    setBusy(false);
  };
  const dis = !r.data.canEdit;
  return (
    <Card title="Pipeline history">
      <p className="mb-3 text-sm text-muted-foreground">Used by Pipeline, Step history and Stuck in a step. SubSync writes down every deal move itself, so these numbers start from the day recording began.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="plh-pipe" className="mb-1 block text-sm font-medium">Pipeline to open first</label>
          <select id="plh-pipe" className={inputClass} disabled={dis} value={form.defaultPipeline ?? ""} onChange={(e) => setForm({ ...form, defaultPipeline: e.target.value || null })}>
            <option value="">The one with the most deals</option>
            {(r.data.pipelines ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Step history opens on this pipeline.</p>
        </div>
        <div>
          <label htmlFor="plh-min" className="mb-1 block text-sm font-medium">Fewest deals before a number shows</label>
          <input id="plh-min" type="number" min={5} max={100} className={inputClass} disabled={dis} value={form.minSample} onChange={(e) => setForm({ ...form, minSample: Number(e.target.value) })} />
          <p className="mt-1 text-xs text-muted-foreground">Below this, a step says &quot;Not enough data yet&quot; instead of a made-up figure.</p>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">Test deals</span>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis} checked={form.excludeTest} onChange={(e) => setForm({ ...form, excludeTest: e.target.checked })} />Leave them out</label>
          <p className="mt-1 text-xs text-muted-foreground">Deals named test, demo or sample. Deals with no value or no owner are always left out of the stuck money.</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">{!dis && <Btn disabled={busy} onClick={save}>Save</Btn>}{msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}{dis && <span className="text-sm text-muted-foreground">Only the account owner's team can change these.</span>}</div>
    </Card>
  );
}
