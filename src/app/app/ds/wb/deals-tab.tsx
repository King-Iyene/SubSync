"use client";

import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import { tagColor } from "@/lib/people/tag-colors";
import { cleanMoneyInput, defaultPipelineId, fmtMoneyExact, groupThousands, orderDeals, valueChangeWarning } from "@/lib/people/deal-view";
import { fmtMoney } from "../../ui";
import { DealHealthSection } from "../../views/pl3/deal-ai";
import { DealFacts, DealGroup, DealHistory, DealSummary, MoveStage, StageSteps } from "./deals-rich";
import { INPUT, wbButtons, type Runner } from "./runner";
import type { WbContext, WbDeal } from "./types";

// The deals tab: stage, value, status and owner of each of this person's deals, changed in place. Each change is previewed first and goes through the server's write gateway.

const stageStyle = (n: string) => { const c = tagColor(n); return { "--tg-bg-l": c.light.bg, "--tg-fg-l": c.light.fg, "--tg-bg-d": c.dark.bg, "--tg-fg-d": c.dark.fg } as React.CSSProperties; };
const STATUS_WORD: Record<string, string> = { open: "Open", won: "Won", lost: "Lost", abandoned: "Abandoned" };

const STATUS_CHIP: Record<string, string> = { open: "border-primary/40 bg-primary/10 text-primary", won: "border-success/50 bg-success/10 text-success", lost: "border-destructive/50 bg-destructive/10 text-destructive", abandoned: "border-border bg-muted text-muted-foreground" };

function DealCard({ d, ctx, runner, focus, now, contactId, locationId }: { d: WbDeal; ctx: WbContext; runner: Runner; focus: boolean; now: number; contactId: string; locationId: string }) {
  const stages = ctx.pipelines.find((p) => p.id === d.pipelineId)?.stages ?? [];
  const [stage, setStage] = useState(d.stageId ?? "");
  const [value, setValue] = useState(String(Math.round(d.value)));
  const [name, setName] = useState(d.name ?? "");
  const [owner, setOwner] = useState(d.ownerId ?? "");
  const stageChanged = !!stage && stage !== d.stageId;
  const valueChanged = value.trim() !== "" && Number(value) !== Math.round(d.value);
  const ownerChanged = !!owner && owner !== d.ownerId;
  const valueWarn = valueChanged ? valueChangeWarning(d.value, Number(value)) : null;
  const nameChanged = name.trim() !== "" && name.trim() !== (d.name ?? "");
  const review = () => {
    const bits = [stageChanged && `stage to ${stages.find((s) => s.id === stage)?.name ?? "the new stage"}`, valueChanged && `value to ${fmtMoney(Number(value))}`, ownerChanged && `owner to ${ctx.users.find((u) => u.id === owner)?.name ?? "the new owner"}`].filter(Boolean).join(", ");
    void runner.preview({ kind: "deal", opportunityId: d.id, ...(stageChanged ? { stageId: stage, ...(d.pipelineId ? { pipelineId: d.pipelineId } : {}) } : {}), ...(valueChanged ? { value: Number(value) } : {}), ...(nameChanged ? { name: name.trim() } : {}), ...(ownerChanged ? { ownerId: owner } : {}) }, { quote: `Change ${bits}`, verb: "Save deal" });
  };
  const close = (status: "won" | "lost" | "open") => void runner.preview({ kind: "deal", opportunityId: d.id, status }, { verb: status === "won" ? "Mark won" : status === "lost" ? "Mark lost" : "Reopen" });
  return (
    <li className={`rounded-xl border p-4 ${focus ? "ring-2 ring-primary/50" : ""}`} data-testid="wb-deal">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-[16px] font-semibold leading-snug">{d.name ?? "Untitled deal"}</p>
        <p className="shrink-0 text-[16px] font-semibold tabular-nums">{fmtMoney(d.value)}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground"><span className={`mr-1.5 inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CHIP[d.status] ?? STATUS_CHIP.abandoned}`} data-testid="deal-status">{STATUS_WORD[d.status] ?? d.status}</span>{d.stageName && <span style={stageStyle(d.stageName)} className="tag-pill mr-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold" data-testid="deal-stage">{d.stageName}</span>}{ctx.pipelines.find((x) => x.id === d.pipelineId)?.name ?? d.pipelineName ?? "Pipeline"} · {STATUS_WORD[d.status] ?? d.status}</p>
      <StageSteps stages={stages} stageId={d.stageId} />
      <DealFacts d={d} ctx={ctx} now={now} />
      {d.status === "open" && <div className="mt-3"><DealHealthSection locationId={locationId} id={d.id} /></div>}
      <MoveStage d={d} ctx={ctx} runner={runner} />
      {d.status === "open" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="col-span-2 block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Deal name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={INPUT} data-testid="wb-deal-name" /></label>
          <label className="col-span-2 block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Stage</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={INPUT} data-testid="wb-deal-stage" disabled={stages.length === 0}>{stages.length === 0 && <option value="">{d.stageName ?? "Unknown"}</option>}{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Value ($)</span>
            <input inputMode="decimal" value={groupThousands(value)} onChange={(e) => setValue(cleanMoneyInput(e.target.value))} className={INPUT} data-testid="wb-deal-value" aria-describedby={`val-${d.id}`} />
            <span id={`val-${d.id}`} className="mt-1 block text-xs text-muted-foreground">{value.trim() !== "" ? fmtMoneyExact(Number(value)) : "No value"}</span></label>
          {valueWarn && <p className="col-span-2 text-sm font-medium text-warning" role="alert" data-testid="wb-deal-value-warn">{valueWarn}</p>}
          <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Owner</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={INPUT}><option value="">{d.ownerId ? "Choose..." : "No owner"}</option>{ctx.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <div className="col-span-2 flex flex-wrap gap-2">
            <button type="button" disabled={!(stageChanged || valueChanged || ownerChanged || nameChanged) || runner.busy} onClick={review} className={wbButtons.PRIMARY} data-testid="wb-deal-save">Review changes</button>
            <button type="button" disabled={runner.busy} onClick={() => close("won")} className={wbButtons.BTN} data-testid="wb-deal-won">Mark won</button>
            <button type="button" disabled={runner.busy} onClick={() => close("lost")} className={wbButtons.BTN} data-testid="wb-deal-lost">Mark lost</button>
          </div>
        </div>
      ) : <button type="button" disabled={runner.busy} onClick={() => close("open")} className={`${wbButtons.BTN} mt-3`}>Reopen this deal</button>}
      <DealHistory d={d} locationId={locationId} contactId={contactId} />
      {ctx.dealsUrl && <a href={ctx.dealsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" data-testid="deal-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
    </li>
  );
}

function NewDeal({ ctx, runner, onClose }: { ctx: WbContext; runner: Runner; onClose: () => void }) {
  const [pipeline, setPipeline] = useState(() => defaultPipelineId(ctx.pipelines, ctx.deals, ctx.pipelineUse));
  const stages = ctx.pipelines.find((p) => p.id === pipeline)?.stages ?? [];
  const [stage, setStage] = useState(stages[0]?.id ?? "");
  const [name, setName] = useState(`${ctx.name}`);
  const [value, setValue] = useState("");
  const [owner, setOwner] = useState("");
  const ok = !!pipeline && !!stage && name.trim().length > 0;
  if (ctx.pipelines.length === 0) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground" data-testid="wb-newdeal-nopipe">This account has no pipeline SubSync has copied yet, so a deal cannot be started here. Open your CRM to create one.</p>;
  return (
    <form className="grid grid-cols-2 gap-2 rounded-xl border bg-card p-4" data-testid="wb-newdeal" onSubmit={(e) => { e.preventDefault(); if (ok) void runner.preview({ kind: "deal_create", pipelineId: pipeline, stageId: stage, name: name.trim(), ...(value.trim() ? { value: Number(value) } : {}), ...(owner ? { ownerId: owner } : {}) }, { verb: "Create deal" }); }}>
      <label className="col-span-2 block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Deal name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={INPUT} data-testid="wb-newdeal-name" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Pipeline</span><select value={pipeline} onChange={(e) => { setPipeline(e.target.value); setStage(ctx.pipelines.find((p) => p.id === e.target.value)?.stages[0]?.id ?? ""); }} className={INPUT} data-testid="wb-newdeal-pipeline">{!pipeline && <option value="">Choose a pipeline</option>}{ctx.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Stage</span><select value={stage} onChange={(e) => setStage(e.target.value)} className={INPUT} data-testid="wb-newdeal-stage">{stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></label>
      <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Value ($)</span><input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} className={INPUT} data-testid="wb-newdeal-value" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium text-muted-foreground">Owner</span><select value={owner} onChange={(e) => setOwner(e.target.value)} className={INPUT}><option value="">No owner</option>{ctx.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <div className="col-span-2 flex gap-2"><button type="submit" disabled={!ok || runner.busy} className={wbButtons.PRIMARY} data-testid="wb-newdeal-review">Review new deal</button><button type="button" onClick={onClose} className={wbButtons.BTN}>Cancel</button></div>
    </form>
  );
}

function DealList({ ctx, runner, focusId, contactId, locationId }: { ctx: WbContext; runner: Runner; focusId?: string | null; contactId: string; locationId: string }) {
  const [now] = useState(() => Date.now());
  const ordered = orderDeals(ctx.deals);
  const open = ordered.filter((d) => d.status === "open"), closed = ordered.filter((d) => d.status !== "open");
  const card = (d: WbDeal) => <DealCard key={`${d.id}-${d.stageId}-${d.value}-${d.status}-${d.ownerId}`} d={d} ctx={ctx} runner={runner} focus={d.id === focusId} now={now} contactId={contactId} locationId={locationId} />;
  // One deal: shown as before. Several: open first (largest first), the closed ones under their own heading. The counts equal the rows.
  if (ordered.length === 1) return <ul className="space-y-3" data-testid="wb-deals">{ordered.map(card)}</ul>;
  return (
    <div className="space-y-3" data-testid="wb-deals">
      <DealGroup title="Open deals" count={open.length} defaultOpen testid="deal-group-open"><ul className="space-y-3">{open.map(card)}</ul></DealGroup>
      <DealGroup title="Won and lost deals" count={closed.length} defaultOpen={open.length === 0} testid="deal-group-closed"><ul className="space-y-3">{closed.map(card)}</ul></DealGroup>
    </div>
  );
}

export function DealsTab({ ctx, runner, focusId, contactId, locationId }: { ctx: WbContext; runner: Runner; focusId?: string | null; contactId: string; locationId: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAdding(!adding)} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/20" data-testid="wb-newdeal-open"><Plus aria-hidden className="size-4" />New deal</button>
        {ctx.dealsUrl && <a href={ctx.dealsUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-1 text-sm font-medium text-primary underline underline-offset-4" data-testid="wb-deals-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
      </div>
      <DealSummary deals={ctx.deals} />
      {adding && <NewDeal ctx={ctx} runner={runner} onClose={() => setAdding(false)} />}
      {ctx.deals.length === 0
        ? <p className="rounded-xl border border-dashed p-4 text-[15px] text-muted-foreground" data-testid="wb-deals-empty">No deals yet. Use New deal to start one for this person.</p>
        : <DealList ctx={ctx} runner={runner} focusId={focusId} contactId={contactId} locationId={locationId} />}
    </div>
  );
}
