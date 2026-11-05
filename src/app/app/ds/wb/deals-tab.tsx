"use client";

import { useState } from "react";
import { fmtMoney } from "../../ui";
import { INPUT, wbButtons, type Runner } from "./runner";
import type { WbContext, WbDeal } from "./types";

// The deals tab: stage, value, status and owner of each of this person's deals, changed in place. Each change is previewed first and goes through the server's write gateway.

const STATUS_WORD: Record<string, string> = { open: "Open", won: "Won", lost: "Lost", abandoned: "Abandoned" };

function DealCard({ d, ctx, runner, focus }: { d: WbDeal; ctx: WbContext; runner: Runner; focus: boolean }) {
  const stages = ctx.pipelines.find((p) => p.id === d.pipelineId)?.stages ?? [];
  const [stage, setStage] = useState(d.stageId ?? "");
  const [value, setValue] = useState(String(Math.round(d.value)));
  const [owner, setOwner] = useState(d.ownerId ?? "");
  const stageChanged = !!stage && stage !== d.stageId;
  const valueChanged = value.trim() !== "" && Number(value) !== Math.round(d.value);
  const ownerChanged = !!owner && owner !== d.ownerId;
  const review = () => {
    const bits = [stageChanged && `stage to ${stages.find((s) => s.id === stage)?.name ?? "the new stage"}`, valueChanged && `value to ${fmtMoney(Number(value))}`, ownerChanged && `owner to ${ctx.users.find((u) => u.id === owner)?.name ?? "the new owner"}`].filter(Boolean).join(", ");
    void runner.preview({ kind: "deal", opportunityId: d.id, ...(stageChanged ? { stageId: stage, ...(d.pipelineId ? { pipelineId: d.pipelineId } : {}) } : {}), ...(valueChanged ? { value: Number(value) } : {}), ...(ownerChanged ? { ownerId: owner } : {}) }, { quote: `Change ${bits}`, verb: "Save deal" });
  };
  const close = (status: "won" | "lost" | "open") => void runner.preview({ kind: "deal", opportunityId: d.id, status }, { verb: status === "won" ? "Mark won" : status === "lost" ? "Mark lost" : "Reopen" });
  return (
    <li className={`rounded-xl border p-4 ${focus ? "ring-2 ring-primary/50" : ""}`} data-testid="wb-deal">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-[16px] font-semibold leading-snug">{d.name ?? "Untitled deal"}</p>
        <p className="shrink-0 text-[16px] font-semibold tabular-nums">{fmtMoney(d.value)}</p>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{ctx.pipelines.find((x) => x.id === d.pipelineId)?.name ?? d.pipelineName ?? "Pipeline"} · {d.stageName ? `${d.stageName} · ` : ""}{STATUS_WORD[d.status] ?? d.status}</p>
      {d.status === "open" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="col-span-2 block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Stage</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={INPUT} data-testid="wb-deal-stage" disabled={stages.length === 0}>{stages.length === 0 && <option value="">{d.stageName ?? "Unknown"}</option>}{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Value ($)</span>
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} className={INPUT} data-testid="wb-deal-value" /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Owner</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={INPUT}><option value="">{d.ownerId ? "Choose..." : "No owner"}</option>{ctx.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <div className="col-span-2 flex flex-wrap gap-2">
            <button type="button" disabled={!(stageChanged || valueChanged || ownerChanged) || runner.busy} onClick={review} className={wbButtons.PRIMARY} data-testid="wb-deal-save">Review changes</button>
            <button type="button" disabled={runner.busy} onClick={() => close("won")} className={wbButtons.BTN} data-testid="wb-deal-won">Mark won</button>
            <button type="button" disabled={runner.busy} onClick={() => close("lost")} className={wbButtons.BTN} data-testid="wb-deal-lost">Mark lost</button>
          </div>
        </div>
      ) : <button type="button" disabled={runner.busy} onClick={() => close("open")} className={`${wbButtons.BTN} mt-3`}>Reopen this deal</button>}
    </li>
  );
}

export function DealsTab({ ctx, runner, focusId }: { ctx: WbContext; runner: Runner; focusId?: string | null }) {
  if (ctx.deals.length === 0) return <p className="rounded-xl border border-dashed p-4 text-[15px] text-muted-foreground" data-testid="wb-deals-empty">No deals for this person.</p>;
  return <ul className="space-y-3" data-testid="wb-deals">{ctx.deals.map((d) => <DealCard key={`${d.id}-${d.stageId}-${d.value}-${d.status}-${d.ownerId}`} d={d} ctx={ctx} runner={runner} focus={d.id === focusId} />)}</ul>;
}
