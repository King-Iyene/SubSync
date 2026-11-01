"use client";

import { useState } from "react";
import { useApiClient } from "../session";
import { Badge, Card, fmtInt, inputClass, Table, Td, Th } from "../ui";

// Stages and pipelines (N38, N37): the owner says which pipelines are in use and which stages are closed out, and sets a win probability for each
// stage. Deals in a closed-out stage or an unused pipeline never count as open pipeline, stale or dead; the screen starts from a suggestion made
// from the names ("Disqualified", "[Not IN USE]") and says so. Only the owner's side sees this card.
export type StageControls = {
  canEdit: boolean;
  totals: { deals: number; countedDeals: number; closedOutByName: number };
  pipelines: Array<{ name: string; notInUse: boolean; source: "owner" | "name" | "default"; why: string }>;
  stages: Array<{ pipeline: string; stage: string; deals: number; countedDeals: number; treatment: string; out: boolean; source: "owner" | "name" | "default"; why: string; probability: number | null }>;
};

const treatmentValue = (t: string) => (t === "Closed out" ? "closed_out" : t === "Ignored" ? "ignore" : "active");

export function StageRulesCard({ controls, onChanged }: { controls: StageControls; onChanged: () => Promise<void> | void }) {
  const api = useApiClient();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      await api.put("stage-rules", body);
      await onChanged();
      setNote("Saved. Every number on every screen has been counted again.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const byPipeline = [...new Set(controls.stages.map((s) => s.pipeline))];
  const rows = controls.totals.closedOutByName;
  return (
    <Card title="Stages and pipelines" action={rows > 0 ? <Badge tone="info">{rows} {rows === 1 ? "stage is" : "stages are"} closed out by name</Badge> : undefined}>
      <p className="mb-3 text-sm text-muted-foreground">
        Deals in a closed-out stage, or in a pipeline you do not use, are left out of open pipeline, stale deals and the forecast. A stage whose name says &quot;Disqualified&quot; or &quot;Wrong number&quot; is treated as closed out until you say otherwise. The win probability is your own assumption for that stage; the forecast uses it until there are 20 closed deals.
      </p>
      {controls.pipelines.length > 1 || controls.pipelines.some((p) => p.notInUse) ? (
        <ul className="mb-4 space-y-2 text-sm" aria-label="Pipelines">
          {controls.pipelines.map((p) => (
            <li key={p.name} className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{p.name}</span> <span className="text-xs text-muted-foreground">{p.why}</span></span>
              <select className="rounded-lg border bg-background px-2 py-1 text-sm" aria-label={`${p.name}: in use or not`} disabled={busy} value={p.notInUse ? "not_in_use" : "in_use"}
                onChange={(e) => save({ pipeline: p.name, stage: null, cls: e.target.value })}>
                <option value="in_use">In use</option>
                <option value="not_in_use">Not in use</option>
              </select>
              {p.source === "owner" && <button type="button" className="ml-2 text-xs underline" disabled={busy} onClick={() => save({ pipeline: p.name, stage: null, cls: null })}>Use the name instead</button>}
            </li>
          ))}
        </ul>
      ) : null}
      {byPipeline.map((pipe) => (
        <div key={pipe} className="mb-4 last:mb-0">
          <p className="mb-1 text-sm font-medium">{pipe}</p>
          <Table head={<tr><Th>Stage</Th><Th className="text-right">Open deals</Th><Th className="text-right">Counted</Th><Th>How it is treated</Th><Th>Win probability</Th></tr>}>
            {controls.stages.filter((s) => s.pipeline === pipe).map((s) => (
              <tr key={`${s.pipeline}|${s.stage}`}>
                <Td className="font-medium">{s.stage}</Td>
                <Td className="text-right tabular-nums">{fmtInt(s.deals)}</Td>
                <Td className="text-right tabular-nums">{fmtInt(s.countedDeals)}</Td>
                <Td>
                  {s.treatment === "Pipeline not in use" ? <span className="text-xs text-muted-foreground">{s.why}</span> : (
                    <>
                      <select className="rounded-lg border bg-background px-2 py-1 text-sm" aria-label={`${s.stage}: how it is treated`} disabled={busy} value={treatmentValue(s.treatment)}
                        onChange={(e) => save({ pipeline: s.pipeline, stage: s.stage, cls: e.target.value })}>
                        <option value="active">Active</option>
                        <option value="closed_out">Closed out</option>
                        <option value="ignore">Ignore</option>
                      </select>
                      {s.source === "owner" && <button type="button" className="ml-2 text-xs underline" disabled={busy} onClick={() => save({ pipeline: s.pipeline, stage: s.stage, cls: null })}>Use the name instead</button>}
                      <p className="mt-1 text-xs text-muted-foreground">{s.source === "name" ? s.why : s.source === "owner" ? "Set by you." : ""}</p>
                    </>
                  )}
                </Td>
                <Td>
                  {s.out ? <span className="text-xs text-muted-foreground">Not used</span> : (
                    <input className={`${inputClass} max-w-24`} inputMode="numeric" placeholder="Not set" aria-label={`${s.stage}: win probability in percent`} disabled={busy}
                      defaultValue={s.probability === null ? "" : String(s.probability)}
                      onBlur={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "");
                        if (raw === (s.probability === null ? "" : String(s.probability))) return;
                        void save({ pipeline: s.pipeline, stage: s.stage, winProbability: raw === "" ? null : Number(raw) });
                      }} />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
      <p className="mt-3 text-xs text-muted-foreground">Open deals shown: {fmtInt(controls.totals.deals)}. Of those, {fmtInt(controls.totals.countedDeals)} have a value and an owner. Amounts are as entered in each account; different currencies are not converted.</p>
      {note && <p className="mt-2 text-sm" role="status">{note}</p>}
    </Card>
  );
}
